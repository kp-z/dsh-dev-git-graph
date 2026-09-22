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
import { panelPath, readPanel, readVendor, vendorNameOf, vendorPath } from './panel.js'
import { DEFAULT_EXCLUDE_DIRS, listProjectFiles } from './scan.js'
import { EventHub, HttpError, registerRoutes } from './routes.js'
import { aiKey, ButlerStore } from './store.js'
import { FACET_AXES, FACET_VALUE_LABELS, stateFacets, structuralFacets } from './facets.js'
import { buildNeighbourIndex, clampBatch, hashOf, understandContracts } from './aiWorkflow.js'
import { createHostAi, describeHostAi } from './hostAi.js'
import type { HostAiServices } from './hostAi.js'
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
  /** 递归监视不可用时，轮询兜底的间隔（ms）。 */
  pollMs: z.number().default(5000),
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
  /** AI 理解时每批多少条契约（20~30，超出的值会被夹住）。 */
  understandBatchSize: z.number().default(24),
  /**
   * 指定 AI 理解用哪个模型：`provider:model` 直接指名，或只给模型名（在宿主已注册的 provider 里找）。
   * 空串 = 用宿主自己选定的默认模型（`agentDefaultModel`）。挑不出来是 503 + 可读原因，不会悄悄换一个。
   */
  understandModel: z.string().default(''),
  /**
   * 钉死 AI 理解走哪个 provider（配 `understandModel` 指定模型；不配就取它最可能能用的那条）。
   * 空串 = 按宿主的默认模型；默认模型指着一个没注册 adapter 的 provider 时会自动避开。
   */
  understandProvider: z.string().default(''),
  /** AI 理解的并发批次数。 */
  understandConcurrency: z.number().default(3),
  /** 单批的模型调用超时（ms）。 */
  understandTimeoutMs: z.number().default(90_000),
  /** 单批的输出上限（token）。 */
  /**
   * 一次调用的输出预算（含模型的思考 token）。默认 16000，是**实测**定的：同一批真契约在
   * `mmt · deepseek-v4-flash-tencent` 上，4000 会截断（23 秒后整批失败），16000 正常返回并通过校验。
   * 调小它只该是因为某条线的输出上限更小（被拒会照实报错并换下一条候选）。
   */
  understandMaxTokens: z.number().default(16000),
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
  pollMs: number
  liveRingSize: number
  snapshotKeep: number
  payloadMaxBytes: number
  capturePayloads: boolean
  redactKeys: string[]
  introspectTools: boolean
  understandBatchSize: number
  understandModel: string
  understandProvider: string
  understandConcurrency: number
  understandTimeoutMs: number
  understandMaxTokens: number
}

/** 从 Loader 传来的 patch 原始值里取默认值。 */
function normalize(config: Partial<ContractButlerConfig>): Settings {
  return {
    scanMaxFiles: config.scanMaxFiles ?? 2000,
    excludeDirs: config.excludeDirs ?? [],
    watchEnabled: config.watchEnabled ?? true,
    debounceMs: config.debounceMs ?? 500,
    pollMs: config.pollMs ?? 5000,
    liveRingSize: config.liveRingSize ?? 500,
    snapshotKeep: config.snapshotKeep ?? 50,
    payloadMaxBytes: config.payloadMaxBytes ?? 8192,
    capturePayloads: config.capturePayloads ?? false,
    redactKeys: config.redactKeys ?? ['authorization', 'token', 'api_key', 'apikey', 'password', 'secret', 'cookie'],
    introspectTools: config.introspectTools ?? true,
    understandBatchSize: config.understandBatchSize ?? 24,
    understandModel: config.understandModel ?? '',
    understandProvider: config.understandProvider ?? '',
    understandConcurrency: config.understandConcurrency ?? 3,
    understandTimeoutMs: config.understandTimeoutMs ?? 90_000,
    understandMaxTokens: config.understandMaxTokens ?? 16000,
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
      // 分面在这里补齐：结构性的由 facets.ts 算，事态要看这次区间与观测结果。
      // 面板只按 tag 做集合运算，不自己判断归属——两边各算一次必然会分叉。
      facets: [
        ...structuralFacets(contract),
        ...stateFacets({
          changed: changes.some((item) => item.fresh),
          finding: all.some((item) => !item.ok),
        }),
      ],
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
      pollMs: settings.pollMs,
      maxFiles: project.scan.maxFiles,
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
  /* DSH 自己的项目清单（宿主 `workspaceRegistry`）。纳管时从它里面选，而不是让人手输绝对
     路径。它是可选依赖：拿不到就如实说"读不到项目列表"，其余能力照常。 */
  type WorkspaceItem = { id: string; path: string; title: string }
  let workspaceList: (() => unknown[]) | undefined
  ctx.inject(['workspaceRegistry'], (host) => {
    const registry = (host as unknown as {
      workspaceRegistry: { list?: () => unknown[] }
    }).workspaceRegistry
    // 先取成局部常量：可选属性不会在闭包里保持窄化。
    const listFn = registry === undefined || typeof registry.list !== "function"
      ? undefined
      : (registry.list.bind(registry) as () => unknown[])
    if (typeof listFn === 'function') {
      workspaceList = () => listFn()
    }
  })

  /* 工作区记录的形状由宿主的包决定，这里只认三个字段，认不出就跳过——宁可不列，不猜。 */
  const readWorkspace = (raw: unknown): WorkspaceItem | null => {
    if (raw === null || typeof raw !== 'object') return null
    const item = raw as { id?: unknown; path?: unknown; title?: unknown }
    if (typeof item.path !== 'string' || item.path === '') return null
    return {
      id: typeof item.id === 'string' && item.id !== '' ? item.id : item.path,
      path: item.path,
      title: typeof item.title === 'string' && item.title !== '' ? item.title : item.path,
    }
  }

  /**
   * 现取宿主的 AI 面（`llm` + `agentDefaultModel`）。
   *
   * **每次请求现取**，不缓存句柄：服务可能晚于本插件挂上来，宿主重载后旧句柄也不该被认死。
   * 取不到就是取不到——这里不猜、不兜底、更不自建通道，缺什么由 `hostAi.ts` 说清。
   */
  const hostAiServices = (): HostAiServices => {
    const pick = <T>(name: string): T | undefined => {
      try {
        const service = ctx.get(name) as T | undefined
        return service === undefined ? undefined : service
      } catch {
        // 宿主的服务在"不可用"状态下 get 可能抛，这里只是探测，抛了就等于没有。
        return undefined
      }
    }
    return {
      llm: pick<HostAiServices['llm']>('llm'),
      defaultModel: pick<HostAiServices['defaultModel']>('agentDefaultModel'),
    }
  }

  ctx.inject(['webServer'], (host) => {
    const webServer = (host as unknown as { webServer: WebServerLike }).webServer
    const disposers = registerRoutes(webServer, [
      {
        /**
         * DSH 里有哪些项目，以及它们是否已被纳管。
         *
         * 纳管对话框靠它把"手输绝对路径"换成"从项目里挑"——路径由宿主给，不由人记。
         */
        method: 'GET',
        path: '/workspaces',
        handler: () => {
          const current = requireStore()
          const byRoot = new Map<string, string>()
          for (const [, project] of current.projects().entries()) byRoot.set(project.root, project.id)
          // 取到局部常量：`workspaceList` 是随时可能被解绑的闭包变量。
          const list = workspaceList
          if (list === undefined) return { source: 'unavailable', workspaces: [] }
          const items: WorkspaceItem[] = []
          for (const raw of list()) {
            const item = readWorkspace(raw)
            if (item !== null) items.push(item)
          }
          return {
            source: 'workspaceRegistry',
            workspaces: items.map((item) => {
              const projectId = byRoot.get(item.path)
              return {
                id: item.id,
                path: item.path,
                title: item.title,
                managed: projectId !== undefined,
                projectId: projectId ?? null,
              }
            }),
          }
        },
      },
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
          return { contracts, axes: FACET_AXES, labels: FACET_VALUE_LABELS }
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
        handler: async () => ({
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
          /* AI 面的现状：面板那条加载动画要显示"用的是哪个模型"，出问题时人也要能一眼看到
             "到底有没有 AI、缺什么"。这里只给服务名与路由名，**不给任何凭据**
             （插件这一侧也从来不认识凭据）。 */
          understand: await (async () => {
            const status = await describeHostAi(hostAiServices(), settings.understandModel, settings.understandProvider)
            return {
              batchSize: settings.understandBatchSize,
              concurrency: settings.understandConcurrency,
              timeoutMs: settings.understandTimeoutMs,
              model: settings.understandModel,
              provider: settings.understandProvider,
              /* 这条路走的是宿主的 llm 服务，不是插件自建通道。 */
              path: status.path,
              available: status.available,
              route: status.route,
              /* 首选发不出去时会按这个顺序换线——调不通的时候，这一行就是"接下来会试什么"。 */
              fallbacks: status.fallbacks,
              /* 与旧版字段兼容：`channels` 就是"现在能用哪条路由"，没有就空表。 */
              channels: status.route === null ? [] : [status.route],
              providers: status.providers,
              reason: status.reason,
              notes: status.notes,
            }
          })(),
        }),
      },
      {
        /**
         * 生成前的**只读预告**：按现在的真实状态算出"这一次点下去到底会发生什么"。
         *
         * 存在的理由：面板把「重新扫描 / 重新生成 / AI 理解」三个按钮并成了一个「生成」+
         * 一个选择弹窗，弹窗里必须写出"将重扫 112 个文件；31 条契约缺 AI 说明，会问 2 批模型"
         * 这样的话。这些数字**只能在这里算**：文件数要按扫描器同一套排除规则真的走一遍目录，
         * "这一条要不要问模型"要看内容哈希与 AI 缓存表对不对得上。面板拿不到这些事实，硬在
         * 前端猜一个数字，就是让人照着一句假话做决定。
         *
         * 与真实动作的对应关系（口径必须一模一样，否则预告就是骗人）：
         * - `code.mode = 'rescan'` → 走 `evolveProject` 的扫描：同一套 `project.scan` 排除规则、
         *   同一个 `listProjectFiles`；**不写任何东西**（这里只数文件）。
         * - `code.mode = 'rebuild'` → `clearGenerated` 会清掉哪些，就用 `countGenerated` 数哪些
         *   （两者共用 `generatedScope()` 那一套判据）。
         * - `ai` → 与 `understandContracts` 逐条判定缓存命中用的**同一个** `hashOf`：命中就不问
         *   模型；`force` 时全部重问。批数按 `clampBatch` 之后的大小切，与真实分批一致。
         *
         * 全程零副作用：不写库、不调模型、不动预算。
         */
        method: 'POST',
        path: '/generate/plan',
        handler: async ({ body }) => {
          const input = body === null || typeof body !== 'object' ? {} : (body as Record<string, unknown>)
          const projectId =
            typeof input.projectId === 'string'
              ? input.projectId
              : typeof input.project === 'string'
                ? input.project
                : ''
          if (projectId === '') throw new HttpError(400, '缺少 projectId（要预告的项目 id）')
          const current = requireStore()
          const project = current.projects().get(projectId)
          if (project === undefined) throw new HttpError(404, `没有这个项目：${projectId}`)

          const all = current.contractsOf(projectId)
          const byId = new Map(all.map((contract) => [contract.id, contract]))
          const wanted = Array.isArray(input.contractIds)
            ? input.contractIds.filter((item): item is string => typeof item === 'string' && item !== '')
            : []
          if (wanted.length > 0) {
            const absent = wanted.filter((id) => !byId.has(id))
            if (absent.length > 0) throw new HttpError(404, `没有这些契约：${absent.join('、')}`)
          }
          /* 范围只有一个机制：`contractIds`——与 `/understand` 逐字同构。
             刻意**不做**"面板给个目录名、宿主自己过滤"这种方便接口：那样"范围内多少条"（宿主
             按目录前缀算）与"实际会问多少条"（面板传的那批 id）就成了两套算法，一旦分叉，
             预告就是假的。目录是面板那边的概念（左树），由面板把那一批 id 算出来传进来即
             可——两边算的是同一份清单，想分叉都没有地方分叉。 */
          const scoped = wanted.length > 0
            ? wanted.map((id) => byId.get(id)).filter((item): item is ContractRecord => item !== undefined)
            : all

          /* 逐条判定"要不要问模型"：判据与 `understandContracts` 的缓存命中判定逐字对应
             （缓存行存在 + 属于这条契约 + 哈希对得上 = 命中，不问模型）。 */
          const force = input.force === true
          const index = buildNeighbourIndex(scoped)
          let cached = 0
          for (const contract of scoped) {
            if (force) break
            const hash = hashOf(contract, index)
            const row = current.ai().get(aiKey(contract.id))
            if (row !== undefined && row.contractId === contract.id && row.hash === hash) cached += 1
          }
          const pending = force ? scoped.length : scoped.length - cached
          const batchSize = clampBatch(settings.understandBatchSize)
          /* AI 面现取：宿主没有可用模型时，弹窗当场就能说清"这一步会失败、原因是什么"，
             而不是等人点完再来一个 503。取不到就是取不到，这里不猜、不兜底。 */
          const availability = await describeHostAi(hostAiServices(), settings.understandModel, settings.understandProvider)

          /* 代码那一步的预告：只有点名要看的时候才真走一遍目录（只读）。`listProjectFiles` 与
             `scanProject` 共用同一个 walker，所以这个数就是 `/rescan` 会读到的文件数。 */
          const mode = input.mode === 'rebuild' ? 'rebuild' : input.mode === 'rescan' ? 'rescan' : 'none'
          let code: { mode: 'rescan' | 'rebuild'; files: number; truncated: boolean; maxFiles: number } | null = null
          if (mode !== 'none') {
            const walk = await listProjectFiles(project.root, project.scan.excludeDirs, project.scan.maxFiles)
            code = { mode, files: walk.files.length, truncated: walk.truncated, maxFiles: project.scan.maxFiles }
          }

          return {
            ok: true,
            projectId,
            scope: {
              kind: wanted.length > 0 ? 'contracts' : 'project',
              contracts: scoped.length,
              /** 这次**会问模型**的条数（缓存命中的不在内；`force` 时就是全部）。 */
              pending,
              cached: force ? 0 : cached,
            },
            ai: {
              projectContracts: all.length,
              batchSize,
              batches: pending === 0 ? 0 : Math.ceil(pending / batchSize),
              force,
              available: availability.available,
              route: availability.route,
              reason: availability.reason,
            },
            code,
            /* 重建会清掉多少：永远给（它就是"现在的状态"），面板据此把不可撤销摆在弹窗里。
               与真正的 `clearGenerated` 共用一套判据，所以这个数不是估的，是要清的那一批。 */
            generated: current.countGenerated(projectId),
          }
        },
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
        /**
         * 重新生成：清掉这个项目已生成的数据，再按当前代码重抽一遍。
         *
         * 与「重新扫描」的区别是**破坏性**：重扫只往前推（比形状、记演化），重建把契约 / 快照 /
         * 演化 / 观测 / 决策全清掉再重写一遍。所以它复用**纳管那条扫描路径**（`commitInit`）而不是
         * `evolveProject`——后者只会更新已存在的契约，契约一旦清空，它没有东西可以比，也就写不出
         * 任何契约。
         *
         * 两条边界：
         * - 项目记录保留。纳管范围与基线是人的决定，不是扫描器的产物；基线的移动只属于
         *   「接受为新基线」那一件事。
         * - `include` 沿用原范围。重建之后新冒出来的候选仍然要人点头才进来，这是既有的口径
         *   （见 /init 与 /rescan 的一贯做法）。
         */
        method: 'POST',
        path: '/rebuild',
        handler: async ({ body }) => {
          const input = body === null || typeof body !== 'object' ? {} : (body as Record<string, unknown>)
          // 面板发 `projectId`；`project` 也认，和相邻路由的字段名保持兼容。
          const projectId =
            typeof input.projectId === 'string'
              ? input.projectId
              : typeof input.project === 'string'
                ? input.project
                : ''
          if (projectId === '') throw new HttpError(400, '缺少 projectId（要重新生成的项目 id）')
          const current = requireStore()
          const project = current.projects().get(projectId)
          if (project === undefined) throw new HttpError(404, `没有这个项目：${projectId}`)
          const rebuilt = await serialize(async () => {
            const cleared = await current.clearGenerated(projectId)
            const result = await commitInit(current, {
              root: project.root,
              extractors: FILE_EXTRACTORS,
              scan: project.scan,
              runtimeCandidates: runtimeCandidates(),
              title: project.title,
              include: [...project.include],
            })
            // 把"不是抽出来"的那几项放回项目记录。`commitInit` 会按当时的 HEAD 重新定基线、
            // 并把纳管时刻改写成现在——那两件事都不该由一次重建代办。
            await current.projects().update(projectId, (record) => ({
              ...record,
              title: project.title,
              vcs: project.vcs,
              baselineSha: project.baselineSha,
              baselineHash: project.baselineHash,
              createdAt: project.createdAt,
            }))
            return { cleared, contracts: result.contracts, skipped: result.skipped.length }
          })
          observer?.invalidate()
          hub.broadcast('changed', { projectId, changes: [], newCandidates: 0 })
          const latest = current.projects().get(projectId) ?? project
          const fresh = await freshChangeIds(latest)
          return {
            ok: true,
            // 和 `/contracts` 同构：面板拿到就能直接照着渲染，不必再打一次列表接口。
            contracts: current.contractsOf(projectId).map((contract) => contractDetail(contract, fresh)),
            axes: FACET_AXES,
            labels: FACET_VALUE_LABELS,
            cleared: rebuilt.cleared,
            regenerated: rebuilt.contracts,
            skipped: rebuilt.skipped,
          }
        },
      },
      {
        /**
         * AI 理解：把扫描出来的契约交给模型，换回"人一眼看懂的中文职责"。
         *
         * 这是新工作流的第二段（第一段是既有的确定性抽取），与「重新生成」的区别是它**不删任何
         * 东西**：只在契约记录上补 `aiTitle` / `aiFamily` / `aiRelations` / `aiHash` / `aiAt`，
         * 原始 `title`（符号名）一个字都不动。
         *
         * 几个刻意的口径：
         * - `contractIds` 给了就只理解这几条（面板详情页的「重新理解」走这条路，配 `force`）；
         *   没给就理解这个项目下**全部**纳管契约；`limit` 给了就再裁到前 N 条（**在分批之前**裁，
         *   否则第一批还是整批，"先看前几条效果"就落空）。
         * - 缓存按内容哈希：内容没变的契约直接读缓存、不问模型，所以第二次调用通常几秒就回来。
         * - `force: true` 忽略缓存全部重问。
         * - 一批不合格就整批拒绝：那几条既不写回也不进缓存，原始返回与原因随响应回显（面板能
         *   展开看）。**绝不**在本地补一个中文标题顶上。
         * - 模型从**宿主自己的 llm 服务**上要（`hostAi.ts`）：插件不自建通道、不读配置里的密钥。
         *   宿主没挂 llm / 没有可用 provider 时是明确的 503 + 可读原因；宿主默认模型指着一个没注册
         *   adapter 的 provider 时，会在已注册的 provider 里找同名模型继续用（`notes` 里如实记）。
         */
        method: 'POST',
        path: '/understand',
        handler: async ({ body }) => {
          const input = body === null || typeof body !== 'object' ? {} : (body as Record<string, unknown>)
          const projectId =
            typeof input.projectId === 'string'
              ? input.projectId
              : typeof input.project === 'string'
                ? input.project
                : ''
          if (projectId === '') throw new HttpError(400, '缺少 projectId（要理解的项目 id）')
          const current = requireStore()
          const project = current.projects().get(projectId)
          if (project === undefined) throw new HttpError(404, `没有这个项目：${projectId}`)

          const all = current.contractsOf(projectId)
          const byId = new Map(all.map((contract) => [contract.id, contract]))
          const wanted = Array.isArray(input.contractIds)
            ? input.contractIds.filter((item): item is string => typeof item === 'string' && item !== '')
            : []
          if (wanted.length > 0) {
            const absent = wanted.filter((id) => !byId.has(id))
            if (absent.length > 0) throw new HttpError(404, `没有这些契约：${absent.join('、')}`)
          }
          /* `limit`：这次最多理解多少条。**必须在分批之前**裁掉多余的候选——否则第一批照样是整批
             24 条，"只想先看前几条的生成效果"就落空了。（面板不用它；手动验证与脚本用它。） */
          const limit = typeof input.limit === 'number' && Number.isFinite(input.limit) && input.limit > 0
            ? Math.floor(input.limit)
            : 0
          const candidates = wanted.length > 0
            ? wanted.map((id) => byId.get(id)).filter((item): item is ContractRecord => item !== undefined)
            : all
          const contracts = limit > 0 ? candidates.slice(0, limit) : candidates
          if (contracts.length === 0) throw new HttpError(400, '这个项目下没有纳管的契约，先扫描 / 纳管再理解')

          /* AI 面在**每次请求时**现取：宿主换模型 / 换 provider 不该要求重启插件。挑不出路由
             （宿主没挂 llm、没有可用 provider、指名模型不存在）就是明确的 503 + 可读原因，
             绝不悄悄退回一条自建通道。 */
          const ai = await createHostAi({
            services: hostAiServices(),
            model: settings.understandModel,
            provider: settings.understandProvider,
            maxTokens: settings.understandMaxTokens,
            timeoutMs: settings.understandTimeoutMs,
          })
          if (!ai.ok) throw new HttpError(503, ai.reason)
          /* `ai.notes` 是同一个数组：调用期间"换线"之类的运行期说明会**追加**进去，所以两头都刷一次，
             且只刷新增的（既不漏掉换线，也不重复刷屏）。 */
          let notesLogged = 0
          const flushNotes = (): void => {
            for (; notesLogged < ai.notes.length; notesLogged += 1) logger.warn(`AI 面：${ai.notes[notesLogged]}`)
          }
          flushNotes()
          const caller = ai.caller

          const batchSize = typeof input.batchSize === 'number' ? input.batchSize : settings.understandBatchSize
          const force = input.force === true
          /* 与监视触发的重扫排在同一条写链上：理解要往契约记录里写东西，交叉写同一批记录是
             这个插件从第一天起就不允许的事。 */
          const summary = await serialize(() =>
            understandContracts({
              store: current,
              projectId,
              contracts,
              caller,
              batchSize,
              concurrency: settings.understandConcurrency,
              force,
              onProgress: (progress) => {
                hub.broadcast('understand', {
                  projectId,
                  stage: 'ai',
                  done: progress.done,
                  total: progress.total,
                  batch: progress.batch,
                  /* 面板说人话要的两样：正在问哪几条（契约名）+ 条口径的进度。 */
                  names: progress.names,
                  contractsDone: progress.contractsDone,
                  contractsTotal: progress.contractsTotal,
                })
              },
            }),
          )
          /* 跑完了再把新增的说明刷出去：换线是发生在调用期间的，这里才是它真正出现的时刻。 */
          flushNotes()
          hub.broadcast('understand', {
            projectId,
            stage: 'done',
            done: summary.batches,
            total: summary.batches,
            ok: summary.ok,
            understood: summary.understood,
            cached: summary.cached,
            requested: summary.requested,
            failed: summary.failures.length,
          })

          /* 一条都没成 → 明确的 4xx/5xx，而不是"200 但什么都没发生"。面板据此退回"只有原始
             记录"的基线视图（它本来就没有本地补写中文这条路）。 */
          if (summary.understood === 0 && summary.failures.length > 0) {
            const first = summary.failures[0]
            throw new HttpError(
              422,
              `AI 返回没有一批通过校验：${summary.failures.length} 批被拒绝。` +
                (first === undefined ? '' : `最早一批（第 ${first.index} 批，${first.ids.length} 条）的原因：${first.why}`),
              {
                failures: summary.failures,
                batches: summary.batches,
                channels: summary.channels,
                ms: summary.ms,
              },
            )
          }

          const fresh = await freshChangeIds(project)
          return {
            ok: summary.ok,
            summary: {
              ...summary,
              // 逐条结果够面板写报告了；`entries` 也留着，报告要给出"符号名 → 中文职责"的对照。
              entries: summary.entries,
            },
            /* 和 /contracts、/rebuild 同构：面板拿到就能直接照着渲染，不必再打一次列表接口。 */
            contracts: current.contractsOf(projectId).map((contract) => contractDetail(contract, fresh)),
            axes: FACET_AXES,
            labels: FACET_VALUE_LABELS,
          }
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
        path: '/vendor/:file',
        /* 面板的第三方资源（Tabulator）。**只读 + 白名单**：名字对不上、带 `/`、带 `..`、
           编码穿越一律 404——别的一概不谈。命中就给一年 immutable：文件名带版本号查询串
           （`?v=6.5.3`），换版本时 URL 变了，所以长缓存不会让人卡在旧文件上。 */
        raw: (req, res) => {
          if ((req.method ?? 'GET').toUpperCase() !== 'GET') {
            res.writeHead(405, { 'Content-Type': 'text/plain; charset=utf-8' })
            res.end('这个资源只接受 GET\n')
            return
          }
          const pathname = new URL(req.url ?? '/', 'http://localhost').pathname
          const name = vendorNameOf(pathname)
          /* 两道门：名字要能从路径里取出来，而且必须在白名单里。
             两道都走不通就都是 404——**不区分**"名字不合法"和"没这个东西"，免得探测者
             从状态码差异里读出目录里有什么。（少了白名单这一道，`ghost.js` 会掉进下面
             那个 500 分支，把"没有这个资源"说成"读不出来"，这正是本文件里踩过的坑。） */
          if (name === null || vendorPath(name) === null) {
            res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' })
            res.end(`没有这个资源：${pathname}\n`)
            return
          }
          void readVendor(name)
            .then(({ body, type }) => {
              res.writeHead(200, {
                'Content-Type': type,
                'Cache-Control': 'public, max-age=31536000, immutable',
                'X-Content-Type-Options': 'nosniff',
              })
              // 直接吐字节：JS/CSS 是文本也不当字符串过一道，省得哪天加了二进制资源才发现。
              res.end(body)
            })
            .catch((error: unknown) => {
              res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' })
              res.end(`资源读不出来：${String(error)}\n路径：${vendorPath(name)}`)
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

