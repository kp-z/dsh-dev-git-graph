/**
 * 协议管家 host 入口。
 *
 * 装配逻辑一句话：**存储必挂，路由与工具可选**。
 * - `storageDomain` 是硬依赖——没有它这个插件没有记忆，也就没有意义。
 * - `webServer` 与 `tools` 用 `ctx.inject` 按需等待：没有 webServer 时监控照跑（只是没界面），
 *   没有 tools 时静态探查照跑。把监控能力和展示能力解耦，是为了让"盯着代码里的契约变化"
 *   这件事不依赖宿主是否恰好挂载了某个包。
 *
 * 运行时内省（工具注册表）与文件探查在此汇合：前者给出宿主自己那些边界，后者给出仓库里
 * 那些边界，两者用同一个候选模型，因此在纳管对话框里是同一张清单。
 */
import type http from 'node:http'
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { FILE_EXTRACTORS } from './extract/index.js'
import { candidatesFromTools, RUNTIME_FILE } from './extract/tools.js'
import type { ToolLike } from './extract/tools.js'
import { commitInit, previewInit } from './manage.js'
import { evolveProject, WORKTREE } from './evolve.js'
import { commitsBetween, headSha, isDirty } from './git.js'
import { Observer, SOURCE_TOOLS } from './observe.js'
import { panelPath, readPanel } from './panel.js'
import { DEFAULT_EXCLUDE_DIRS } from './scan.js'
import { EventHub, HttpError, registerRoutes } from './routes.js'
import { ButlerStore } from './store.js'
import { watchProject } from './watch.js'
import type { Watcher } from './watch.js'
import type { Candidate, ChangeRecord, ContractRecord, DecisionRecord, ProjectRecord } from './types.js'

/** Loader entry id（kebab-case，全局唯一）。 */
export const name = 'contract-butler'

/** 硬依赖：领域存储。其余服务在 apply 内部按需等待。 */
export const inject = ['storageDomain']

/** 插件配置 schema。 */
export const ContractButlerConfig = z.object({
  /** 单次扫描的文件数上限。 */
  scanMaxFiles: z.number().default(2000),
  /** 额外排除的目录名（追加在默认表之后）。 */
  excludeDirs: z.array(z.string()).default([]),
  /** 是否对纳管项目开启文件监视。 */
  watchEnabled: z.boolean().default(true),
  /** 监视去抖窗口（ms）。 */
  debounceMs: z.number().default(500),
  /** 运行时观测的内存环形缓冲条数。 */
  liveRingSize: z.number().default(500),
  /** 每条契约保留的快照条数。 */
  snapshotKeep: z.number().default(50),
  /** 载荷样本的字节上限。 */
  payloadMaxBytes: z.number().default(8192),
  /** 是否采集载荷样本；默认关（只留形状与判定）。 */
  capturePayloads: z.boolean().default(false),
  /** 需要打码的键名。 */
  redactKeys: z
    .array(z.string())
    .default(['authorization', 'token', 'api_key', 'apikey', 'password', 'secret', 'cookie']),
  /** 是否把 `ctx.tools` 里的工具边界并入候选。 */
  introspectTools: z.boolean().default(true),
})

/** 从 schema 推导的配置类型。 */
export type ContractButlerConfig = Schemastery.TypeT<typeof ContractButlerConfig>

/** 工具注册表的只读视图。 */
interface ToolRegistryLike {
  schemas(scope?: unknown): unknown[]
  get(name: string, scope?: unknown): ToolLike | undefined
}

/** webServer 服务视图。 */
interface WebServerLike {
  register(spec: {
    kind: 'exact' | 'prefix'
    path: string
    handler: (req: http.IncomingMessage, res: http.ServerResponse) => void
  }): () => void
}

/** 存储设施服务视图。 */
interface StorageDomainLike {
  open(spec: unknown): Promise<{
    table<T>(name: string): {
      get(key: string): T | undefined
      entries(): IterableIterator<[string, T]>
      keys(): IterableIterator<string>
      readonly size: number
      put(key: string, value: T): Promise<void>
      delete(key: string): Promise<boolean>
      update(key: string, fn: (record: T) => T): Promise<T>
    }
    close(): Promise<void>
  }>
}

/** 规范化后的配置。 */
interface Settings {
  scanMaxFiles: number
  excludeDirs: string[]
  watchEnabled: boolean
  debounceMs: number
  liveRingSize: number
  snapshotKeep: number
  payloadMaxBytes: number
  capturePayloads: boolean
  redactKeys: string[]
  introspectTools: boolean
}

/** 从 Loader 传来的 patch 原始值里取默认值。 */
function normalize(config: Partial<ContractButlerConfig>): Settings {
  return {
    scanMaxFiles: config.scanMaxFiles ?? 2000,
    excludeDirs: config.excludeDirs ?? [],
    watchEnabled: config.watchEnabled ?? true,
    debounceMs: config.debounceMs ?? 500,
    liveRingSize: config.liveRingSize ?? 500,
    snapshotKeep: config.snapshotKeep ?? 50,
    payloadMaxBytes: config.payloadMaxBytes ?? 8192,
    capturePayloads: config.capturePayloads ?? false,
    redactKeys: config.redactKeys ?? ['authorization', 'token', 'api_key', 'apikey', 'password', 'secret', 'cookie'],
    introspectTools: config.introspectTools ?? true,
  }
}

/**
 * 插件入口。
 *
 * 注意：Loader 传入的 config 是 patch 原始值（可为 undefined），必须提供默认值兜底——
 * schema 的 default 只影响设置页/校验，不自动填进 config。
 */
export function apply(ctx: Context, config: Partial<ContractButlerConfig> = {}): void {
  const settings = normalize(config ?? {})
  const excludeDirs = [...DEFAULT_EXCLUDE_DIRS, ...settings.excludeDirs]
  const logger = ctx.logger('contract-butler')
  const hub = new EventHub()
  const watchers = new Map<string, Watcher>()

  let store: ButlerStore | null = null
  let observer: Observer | null = null
  /** 串行化写操作：监视触发的重扫与手工纳管不能交叉写同一批记录。 */
  let queue: Promise<unknown> = Promise.resolve()

  /** 把所有写操作排进同一条链。 */
  const serialize = <T>(task: () => Promise<T>): Promise<T> => {
    const next = queue.then(task, task)
    queue = next.catch(() => undefined)
    return next
  }

  /** 需要存储的处理器用它取，避免到处判空。 */
  const requireStore = (): ButlerStore => {
    if (store === null) throw new HttpError(503, '存储尚未就绪（storageDomain 未挂载）')
    return store
  }

  /**
   * 收集运行时内省出来的候选（工具注册表的边界）。
   *
   * 先 `schemas()` 枚举名字，再 `get(name)` 取完整定义——因为 `schemas()` 只给模型可见字段，
   * 不含输出声明，而输出恰恰是契约的一半。
   */
  const runtimeCandidates = (): Candidate[] => {
    if (!settings.introspectTools) return []
    const registry = ctx.get('tools') as ToolRegistryLike | undefined
    if (registry === undefined || typeof registry.schemas !== 'function') return []
    const full: ToolLike[] = []
    for (const raw of registry.schemas()) {
      if (raw === null || typeof raw !== 'object') continue
      const schema = raw as { name?: unknown; description?: unknown; parameters?: unknown }
      if (typeof schema.name !== 'string' || schema.name === '') continue
      const definition = typeof registry.get === 'function' ? registry.get(schema.name) : undefined
      full.push({
        name: schema.name,
        ...(typeof schema.description === 'string' ? { description: schema.description } : {}),
        parameters: definition?.parameters ?? schema.parameters,
        ...(definition?.output === undefined ? {} : { output: definition.output }),
      })
    }
    return candidatesFromTools(full)
  }

  /** 项目摘要：给面板的列表用。 */
  const projectSummary = (project: ProjectRecord) => {
    const current = requireStore()
    const contracts = current.contractsOf(project.id)
    const changes = current.changesOf(project.id)
    const findings = current.observationsOf(project.id).filter((item) => !item.ok)
    return {
      ...project,
      contractCount: contracts.length,
      changeCount: changes.length,
      findingCount: findings.length,
    }
  }

  /** 契约 + 它自己的演化与观测，给详情用。 */
  const contractDetail = (contract: ContractRecord, fresh: Set<string>) => {
    const current = requireStore()
    const all = current
      .observationsOf(contract.projectId)
      .filter((item) => item.contractId === contract.id)
      .sort((a, b) => b.at - a.at)
    const changes = current
      .changesOf(contract.projectId)
      .filter((item) => item.contractId === contract.id)
      // `fresh` 是"在这次对比区间之内"的标记，由宿主算好随记录一起下去；面板不重新推一遍
      // 区间——两边各算一次必然会分叉，而用户只信其中一边。
      .map((item) => ({ ...item, fresh: fresh.has(item.id) }))
    // 决策也要下发，否则人做过的事在界面上不留痕，等于没做。
    const changeIds = new Set(changes.map((item) => item.id))
    const observationIds = new Set(all.map((item) => item.id))
    const decisions = current.decisionsOf(contract.projectId).filter((item) => {
      if (item.targetKind === 'contract') return item.targetId === contract.id
      if (item.targetKind === 'change') return changeIds.has(item.targetId)
      return observationIds.has(item.targetId)
    })
    return {
      contract,
      changes,
      // 观测**全部**下发（最近若干次），而不是只下发失败的：界面要能分清"从没调用过"、
      // "调用过且都对"、"调用过但对不上"这三种情况。只给失败集合的话，前两种会退化成同一句
      // 话——那正是这个工具最不该说错的地方。
      observations: all.slice(0, 20),
      observedTotal: all.length,
      findings: all.filter((item) => !item.ok),
      decisions,
    }
  }

  /**
   * 算出某个项目"这次对比之内"的演化记录 id。
   *
   * 语义就是界面顶部那条版本条的区间：基线（不含）→ 现在的 HEAD（含），外加所有未提交的改动
   * （工作区的改动永远算"这次的"）。基线之后被 rebase 掉的提交自然不在可达集里，也就不会被
   * 误报成"变过"。
   */
  const freshChangeIds = async (project: ProjectRecord): Promise<Set<string>> => {
    const current = requireStore()
    const ids = new Set<string>()
    const all = current.changesOf(project.id)
    if (project.vcs === 'none') {
      for (const item of all) ids.add(item.id)
      return ids
    }
    const head = await headSha(project.root)
    const left = project.baselineSha ?? ''
    if (head !== '') {
      const reachable = await commitsBetween(project.root, left, head)
      if (reachable !== null) {
        for (const item of all) if (reachable.has(item.sha)) ids.add(item.id)
      }
    }
    for (const item of all) if (item.sha === WORKTREE) ids.add(item.id)
    return ids
  }

  /**
   * 按版本区间过滤演化记录。
   *
   * 可达性用 git 自己算（`rev-list from..to`），不比较时间戳或数组下标：rebase / merge 之后，
   * "哪一版在另一版之前"只有提交图知道。区间解析不了时**不假装成功**——如实返回
   * `rangeInvalid`，让界面把它标成"这两版之间没法比较"。
   */
  const changesInRange = async (
    project: ProjectRecord,
    from: string,
    to: string,
  ): Promise<{ changes: ChangeRecord[]; rangeInvalid: boolean }> => {
    const all = requireStore().changesOf(project.id)
    if (from === '' && to === '') return { changes: all, rangeInvalid: false }
    if (project.vcs === 'none') return { changes: all, rangeInvalid: true }
    const right = to === '' ? (await headSha(project.root)) || (project.baselineSha ?? '') : to
    const left = from === '' ? (project.baselineSha ?? '') : from
    if (right === WORKTREE || left === WORKTREE) {
      // 任一端是工作区时没有提交图可言：工作区的改动全算，已提交的按"最新一版可达"处理。
      const head = await headSha(project.root)
      const reachable = head === '' ? null : await commitsBetween(project.root, '', head)
      if (reachable === null) return { changes: all, rangeInvalid: true }
      return {
        changes: all.filter((item) => item.sha === WORKTREE || reachable.has(item.sha)),
        rangeInvalid: right === WORKTREE && left !== WORKTREE ? left !== (project.baselineSha ?? '') : false,
      }
    }
    const reachable = await commitsBetween(project.root, left, right)
    if (reachable === null) return { changes: all, rangeInvalid: true }
    return { changes: all.filter((item) => reachable.has(item.sha)), rangeInvalid: false }
  }

  /** 启动某个项目的监视，已经在监视的先停掉。 */
  const watchProjectNow = (project: ProjectRecord): void => {
    watchers.get(project.id)?.close()
    watchers.delete(project.id)
    if (!settings.watchEnabled) return
    const watcher = watchProject({
      root: project.root,
      excludeDirs: project.scan.excludeDirs,
      debounceMs: settings.debounceMs,
      handlers: {
        onBatch: (files) => {
          void serialize(async () => {
            const current = store
            if (current === null) return
            const latest = current.projects().get(project.id)
            if (latest === undefined) return
            const result = await evolveProject({
              store: current,
              project: latest,
              extractors: FILE_EXTRACTORS,
              runtimeCandidates: runtimeCandidates(),
              snapshotKeep: settings.snapshotKeep,
              // 拿不到具体文件名的批次（'' ）退化为全量重扫。
              ...(files.includes('') ? {} : { only: files }),
            })
            observer?.invalidate()
            if (result.changes.length > 0 || result.newCandidates.length > 0) {
              hub.broadcast('changed', {
                projectId: project.id,
                changes: result.changes,
                newCandidates: result.newCandidates.length,
              })
            }
          })
        },
        onError: (error) => {
          logger.warn(`监视 ${project.root} 出错：${String(error)}`)
        },
      },
    })
    watchers.set(project.id, watcher)
    if (watcher.polling) logger.info(`${project.root} 退回轮询模式（递归监视不可用）`)
  }

  // ── 存储：挂上就打开领域，并把已有项目的监视恢复起来 ─────────────────────────────
  ctx.inject(['storageDomain'], (host) => {
    const facility = (host as unknown as { storageDomain: StorageDomainLike }).storageDomain
    let disposed = false
    void (async () => {
      const opened = await ButlerStore.open({ open: (spec) => facility.open(spec) })
      if (disposed) {
        await opened.close()
        return
      }
      store = opened
      observer = new Observer(opened, {
        store: opened,
        payloadMaxBytes: settings.payloadMaxBytes,
        redactKeys: settings.redactKeys,
        capturePayloads: settings.capturePayloads,
        ringSize: settings.liveRingSize,
      })
      for (const [, project] of opened.projects().entries()) watchProjectNow(project)
      logger.info(`存储就绪（${opened.projects().size} 个已纳管项目）`)
    })().catch((error: unknown) => {
      logger.error(`打开存储失败：${String(error)}`)
    })
    return () => {
      disposed = true
      for (const watcher of watchers.values()) watcher.close()
      watchers.clear()
      const opened = store
      store = null
      observer = null
      if (opened !== null) void opened.close()
    }
  })

  // ── 运行层：订阅 tools/result 做观测 ───────────────────────────────────────────
  ctx.inject(['tools'], () => {
    // `tools/result` 是宿主工具管道发出的事件，不在本包可见的 Events 声明合并里，所以这里
    // 按名字订阅：这正是"零埋点观测"要付的代价——耦合一个事件名，而不是耦合每个工具。
    const events = ctx as unknown as {
      on(name: string, listener: (...args: unknown[]) => void): () => void
    }
    events.on('tools/result', (...args: unknown[]) => {
      const current = observer
      if (current === null) return
      const [exec, result] = args
      if (exec === null || typeof exec !== 'object') return
      const call = exec as { name?: unknown; arguments?: unknown }
      if (typeof call.name !== 'string') return
      const outcome = (result ?? {}) as { isError?: unknown; value?: unknown }
      void current
        .observe({
          subject: call.name,
          args: call.arguments,
          value: outcome.value,
          failed: outcome.isError === true,
        })
        .then((record) => {
          if (!record.ok) hub.broadcast('finding', record)
        })
        .catch((error: unknown) => {
          logger.warn(`记录观测失败：${String(error)}`)
        })
    })
  })

  // ── HTTP：路由表 + SSE ────────────────────────────────────────────────────────
  ctx.inject(['webServer'], (host) => {
    const webServer = (host as unknown as { webServer: WebServerLike }).webServer
    const disposers = registerRoutes(webServer, [
      {
        method: 'GET',
        path: '/projects',
        handler: () => {
          const current = requireStore()
          return {
            projects: [...current.projects().entries()].map(([, project]) => projectSummary(project)),
            source: SOURCE_TOOLS,
          }
        },
      },
      {
        method: 'POST',
        path: '/init',
        handler: async ({ body }) => {
          const input = body === null || typeof body !== 'object' ? {} : (body as Record<string, unknown>)
          const root = typeof input.root === 'string' ? input.root : ''
          if (root === '') throw new HttpError(400, '缺少 root（要纳管的项目绝对路径）')
          if (!root.startsWith('/') && !/^[a-zA-Z]:/.test(root)) throw new HttpError(400, 'root 必须是绝对路径')
          const title = typeof input.title === 'string' ? input.title : undefined
          const include = Array.isArray(input.include)
            ? input.include.filter((item): item is string => typeof item === 'string')
            : undefined
          const options = {
            root,
            extractors: FILE_EXTRACTORS,
            scan: { maxFiles: settings.scanMaxFiles, excludeDirs },
            runtimeCandidates: runtimeCandidates(),
            ...(title === undefined ? {} : { title }),
          }
          // `confirm` 缺席时只做预览：探索别人仓库这件事不该有副作用。
          if (input.confirm !== true) return { preview: await previewInit(options) }
          const result = await serialize(() =>
            commitInit(requireStore(), { ...options, ...(include === undefined ? {} : { include }) }),
          )
          observer?.invalidate()
          watchProjectNow(result.project)
          hub.broadcast('project', result.project)
          return { result }
        },
      },
      {
        method: 'GET',
        path: '/contracts',
        handler: async ({ query }) => {
          const current = requireStore()
          const projectId = query.get('project') ?? ''
          const projects = [...current.projects().entries()].map(([, project]) => project)
          const scope = projectId === '' ? projects : projects.filter((project) => project.id === projectId)
          const contracts: unknown[] = []
          for (const project of scope) {
            const fresh = await freshChangeIds(project)
            for (const contract of current.contractsOf(project.id)) {
              contracts.push(contractDetail(contract, fresh))
            }
          }
          return { contracts }
        },
      },
      {
        method: 'GET',
        path: '/contracts/:id',
        handler: async ({ query }) => {
          const current = requireStore()
          const id = query.get('id') ?? ''
          const contract = current.contracts().get(id)
          if (contract === undefined) throw new HttpError(404, `没有这条契约：${id}`)
          const project = current.projects().get(contract.projectId)
          const fresh = project === undefined ? new Set<string>() : await freshChangeIds(project)
          const twins = contract.twins
            .map((twin) => current.contracts().get(twin))
            .filter((item): item is ContractRecord => item !== undefined)
            .map((twin) => contractDetail(twin, fresh))
          return { ...contractDetail(contract, fresh), twins }
        },
      },
      {
        method: 'GET',
        path: '/changes',
        handler: async ({ query }) => {
          const current = requireStore()
          const projectId = query.get('project') ?? ''
          const project = current.projects().get(projectId)
          if (project === undefined) throw new HttpError(404, `没有这个项目：${projectId}`)
          const range = await changesInRange(project, query.get('from') ?? '', query.get('to') ?? '')
          return {
            ...range,
            project,
            dirty: project.vcs === 'git' ? await isDirty(project.root) : false,
          }
        },
      },
      {
        method: 'GET',
        path: '/observations',
        handler: ({ query }) => {
          const current = requireStore()
          const projectId = query.get('project') ?? ''
          const parsed = Number.parseInt(query.get('limit') ?? '50', 10)
          const limit = Number.isFinite(parsed) ? parsed : 50
          return {
            observations: observer?.recent(projectId, limit) ?? current.observationsOf(projectId).slice(0, limit),
          }
        },
      },
      {
        method: 'GET',
        path: '/status',
        handler: () => ({
          active: [...watchers.keys()],
          polling: [...watchers.values()].filter((watcher) => watcher.polling).length,
          subscribers: hub.size,
          excludeDirs,
          scanMaxFiles: settings.scanMaxFiles,
          watchEnabled: settings.watchEnabled,
          capturePayloads: settings.capturePayloads,
          liveRingSize: settings.liveRingSize,
          snapshotKeep: settings.snapshotKeep,
          payloadMaxBytes: settings.payloadMaxBytes,
          redactKeys: settings.redactKeys,
          runtimeFile: RUNTIME_FILE,
        }),
      },
      {
        method: 'POST',
        path: '/rescan',
        handler: async ({ body }) => {
          const input = body === null || typeof body !== 'object' ? {} : (body as Record<string, unknown>)
          const projectId = typeof input.project === 'string' ? input.project : ''
          const current = requireStore()
          const project = current.projects().get(projectId)
          if (project === undefined) throw new HttpError(404, `没有这个项目：${projectId}`)
          const result = await serialize(() =>
            evolveProject({
              store: current,
              project,
              extractors: FILE_EXTRACTORS,
              runtimeCandidates: runtimeCandidates(),
              snapshotKeep: settings.snapshotKeep,
            }),
          )
          observer?.invalidate()
          hub.broadcast('changed', {
            projectId: project.id,
            changes: result.changes,
            newCandidates: result.newCandidates.length,
          })
          return { result }
        },
      },
      {
        method: 'POST',
        path: '/decisions',
        handler: async ({ body }) => {
          const input = body === null || typeof body !== 'object' ? {} : (body as Record<string, unknown>)
          const projectId = typeof input.project === 'string' ? input.project : ''
          const action = input.action
          if (action !== 'ack' && action !== 'accept-baseline' && action !== 'silence' && action !== 'scope') {
            throw new HttpError(400, 'action 必须是 ack / accept-baseline / silence / scope 之一')
          }
          const current = requireStore()
          const project = current.projects().get(projectId)
          if (project === undefined) throw new HttpError(404, `没有这个项目：${projectId}`)
          const targetKind =
            input.targetKind === 'change' || input.targetKind === 'observation' ? input.targetKind : 'contract'
          const targetId = typeof input.targetId === 'string' ? input.targetId : ''
          // 决策必须落在真实存在的对象上。悬空决策比拒绝更糟：界面上它什么也不解释，却会让
          // 后来的人以为"这件事已经被处理过了"。
          const targetTable: { get(key: string): { projectId: string } | undefined } =
            targetKind === 'change'
              ? current.changes()
              : targetKind === 'observation'
                ? current.observations()
                : current.contracts()
          const target = targetTable.get(targetId)
          if (target === undefined) throw new HttpError(404, `没有这条${targetKind === 'change' ? '演化' : targetKind === 'observation' ? '观测' : '契约'}：${targetId}`)
          if (target.projectId !== projectId) throw new HttpError(400, '决策的对象不属于这个项目')
          const now = Date.now()
          const record: DecisionRecord = {
            id: `dc_${now.toString(36)}_${Math.floor(Math.random() * 1e6).toString(36)}`,
            projectId,
            targetKind,
            targetId,
            action,
            by: typeof input.by === 'string' && input.by !== '' ? input.by : 'local',
            at: now,
            note: typeof input.note === 'string' ? input.note : '',
          }
          await serialize(async () => {
            await current.decisions().put(record.id, record)
            // 「接受为新基线」真的把基线往前推——这是唯一会移动基线的动作。
            if (action === 'accept-baseline' && project.vcs === 'git') {
              const head = await headSha(project.root)
              if (head !== '') {
                await current
                  .projects()
                  .update(projectId, (item) => ({ ...item, baselineSha: head, baselineHash: null }))
              }
            }
          })
          hub.broadcast('decision', record)
          return { record }
        },
      },
      {
        method: 'GET',
        path: '/runtime',
        handler: () => ({
          candidates: runtimeCandidates(),
          note: `来自工具注册表（${RUNTIME_FILE}），含宿主自带工具与所有 MCP 服务器注册的工具`,
        }),
      },
      {
        method: 'GET',
        path: '/panel',
        raw: (_req, res) => {
          void readPanel()
            .then((html) => {
              res.writeHead(200, {
                'Content-Type': 'text/html; charset=utf-8',
                'Cache-Control': 'no-store',
              })
              res.end(html)
            })
            .catch((error: unknown) => {
              res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' })
              res.end(`面板读不出来：${String(error)}\n路径：${panelPath()}`)
            })
        },
      },
      {
        method: 'GET',
        path: '/events',
        raw: (req, res) => {
          hub.subscribe(res, { type: 'ready', data: { projects: [...watchers.keys()] } })
          req.on('close', () => {
            // EventHub 自己也会在 res close 时摘掉订阅，这里只是提前让连接语义明确。
          })
        },
      },
    ])
    logger.info(`路由已挂载（${disposers.length} 条）`)
    return () => {
      for (const dispose of disposers) dispose()
      hub.close()
    }
  })
}
