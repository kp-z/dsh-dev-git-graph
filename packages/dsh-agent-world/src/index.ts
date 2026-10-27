/**
 * dsh-agent-world —— host 入口。
 *
 * 装配逻辑一句话：**内容、世界、模拟循环必挂，界面可选**。
 * - `tools` 是硬依赖：没有工具注册表，模型无法与世界交互，这个插件就没有意义。
 * - `webServer`（M3-3 之后）会用 `ctx.inject` 按需等待：没有它时世界照跑，只是没有 3D 面板。
 *   把"模拟能力"与"展示能力"解耦，是为了让世界不依赖宿主是否恰好挂了 HTTP 服务。
 *
 * 当前进度（R7）：内容库层 + 契约层 + 模拟内核 + 运行时（**世界会动了**）。
 * 落盘与 HTTP/SSE 见 BACKLOG M3，3D 面板见 M4。
 * 架构见 docs/ARCHITECTURE.md，内容模型见 docs/CONTENT.md，协议见 docs/PROTOCOL.md。
 */
import { appendFileSync, existsSync, renameSync } from 'node:fs'
import { join, resolve } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import {
  buildCharacterSystemPrompt,
  createDshCharacterBridge,
  createSessionEventFeed,
  createSessionTransport,
  createTeamsCaptain,
  createTeamsPort,
  readDefaultModelSelection,
  seatForAgent,
  toLazyDialoguePort,
} from './bridge/index.js'
import type { DispatchOutcome, WorldServicePort } from './protocol/index.js'
import type { World } from './domain/types.js'
import type { TeamsPort } from './bridge/index.js'
import type { CharacterBridge } from './bridge/index.js'
import { type AgentWorldConfig, resolveConfig } from './config.js'
import { resolveContentRoot } from './content/load-files.js'
import { createHandler } from './routes/index.js'
import type { DialogueChannel } from './routes/dialogue.js'
import { createEventHub, createRuntime } from './runtime/index.js'
import { planTeamSync } from './sim/index.js'
import { createWorldStore } from './store/index.js'
import { skillForTool } from './sim/tool-skill.js'
import { createPluginState } from './state.js'
import { createPersonaStore } from './persona/store.js'
import { registerDispatchTool } from './tools/dispatch.js'
import { registerWorldTools } from './tools/world.js'

/** Loader entry id（kebab-case，全局唯一，配置覆盖靠它定位）。 */
export const name = 'agent-world'

/**
 * 硬依赖：模型可见工具注册表。
 * 不写运行时兜底——缺它就 fail-loud，符合本仓库 docs/DEVELOPMENT.md §2 的约定。
 */
export const inject = ['tools']

/**
 * 插件入口。
 *
 * @param ctx - cordis 上下文。
 * @param config - Loader 传进来的**原始**配置（schema default 不会被自动填充，故走 resolveConfig）。
 */
/** 从 agent/error 的负载里尽量取出会话 id（不同版本形状不同）。 */
function this_agentId(record: Record<string, unknown>): string | undefined {
  const a = record['agent'] as { id?: unknown } | undefined
  return typeof a?.id === 'string' ? a.id : undefined
}

export function apply(ctx: Context, config: Partial<AgentWorldConfig> = {}): void {
  const resolved = resolveConfig(config)
  /** R350：游戏模式（可在主对话 header 切换，不需要重启插件）。 */
  let gameModeEnabled = resolved.gameMode
  const personaStore = createPersonaStore(join(resolved.stateDir, 'personas.json'))
  const logger = ctx.logger('agent-world')

  // 外部内容目录的解析结果要**原样打出来**：用户配了 contentDir 却没生效时，
  // 第一个问题永远是"它到底去读哪个目录了"。
  const contentRoot = resolveContentRoot(resolved.contentDir, process.cwd())
  if (contentRoot.root !== null) {
    logger.info(`外部内容目录：${contentRoot.root}（${contentRoot.reason}）`)
  }

  // 存档目录：`stateDir` 目前按 `process.cwd()` 解析（与 contentDir 同一个基准，
  // 而"相对哪个 workspace"这件事是 M1.5-6 的待定项——多工作区时任何自动挑选都是猜）。
  // 把解析结果**原样打出来**：写盘位置是用户第一个会问的问题。
  const storeDir =
    resolved.persistEveryTicks > 0 ? resolve(process.cwd(), resolved.stateDir) : null
  if (storeDir !== null) logger.info(`世界存档目录：${storeDir}`)

  // R166 Phase C：旧的**全局** world.json 不再参与会话世界。归档它，不删；
  // 每个会话的世界在 `storeDir/sessions/<会话编码>/world.json`。
  if (storeDir !== null) {
    const legacy = join(storeDir, 'world.json')
    const archive = join(storeDir, 'world.legacy.json')
    try {
      if (existsSync(legacy) && !existsSync(archive)) {
        renameSync(legacy, archive)
        logger.info(`已归档旧的全局世界：${archive}`)
      }
    } catch (error) {
      logger.warn(`归档旧全局世界失败（不影响会话世界）：${error instanceof Error ? error.message : String(error)}`)
    }
  }

  const state = createPluginState(resolved, { externalRoot: contentRoot.root, storeDir })
  /** R175：sessionQuery 是软依赖；先 inject 捕获，避免请求时 ctx.get 拿不到。 */
  let sessionQueryService:
    | { readSession?(id: string): Promise<unknown> }
    | undefined
  let sessionControllerService:
    | { prompt?(request: Record<string, unknown>, signal?: AbortSignal): Promise<unknown>
    inspect?(sessionId: string, signal?: AbortSignal): Promise<{ events?: readonly { type?: string; time?: number; data?: Record<string, unknown> }[] }> }
    | undefined
  ctx.inject(['sessionController'], (host) => {
    sessionControllerService = (host as unknown as {
      sessionController?: { prompt?(request: Record<string, unknown>, signal?: AbortSignal): Promise<unknown>
    inspect?(sessionId: string, signal?: AbortSignal): Promise<{ events?: readonly { type?: string; time?: number; data?: Record<string, unknown> }[] }> }
    }).sessionController
  })
  ctx.inject(['sessionQuery'], (host) => {
    sessionQueryService = (host as unknown as {
      sessionQuery?: { readSession?(id: string): Promise<unknown> }
    }).sessionQuery
  })
  let agentsService: { get?(id: string): { id?: string } | undefined } | undefined
  let agentTeamsService:
    | {
        membership?(agent: { id?: string }): unknown
        listMembers?(agent: { id?: string }): unknown
        listTasks?(agent: { id?: string }): unknown
        sendMessage?(
          caller: { id?: string },
          request: { target: string; content: readonly unknown[]; signal: AbortSignal },
        ): Promise<unknown>
        createTask?(caller: { id?: string }, request: Record<string, unknown>): Promise<unknown>
        updateTask?(caller: { id?: string }, request: Record<string, unknown>): Promise<unknown>
      }
    | undefined
  ctx.inject(['agents', 'agentTeams'], (host) => {
    const h = host as unknown as {
      agents?: { get?(id: string): { id?: string } | undefined }
      agentTeams?: {
        membership?(agent: { id?: string }): unknown
        listMembers?(agent: { id?: string }): unknown
        listTasks?(agent: { id?: string }): unknown
      }
    }
    agentsService = h.agents
    agentTeamsService = h.agentTeams
  })

  // ── D41/R43：把小镇的工单接到 agent-teams 的任务上 ────────────────────────────
  //
  // 两件事：
  // ① **派单时同时在团队里建任务**：小镇的工单是"投影"（谁在哪、什么时候到），
  //    团队的任务才是"谁做什么、做完没有"。所以要成对创建，再把两张单对应起来。
  // ② **轮询团队状态并同步回小镇**：团队说"派给谁了/做完了/失败了" → 算成命令 → 进世界。
  //
  // 两边都**只通过命令改世界**（`taskLink` / `taskAssign` / `taskComplete` / `taskFail`），
  // 命令照旧进 journal，所以回放仍然确定（D41 ③）。
  const TEAM_SYNC_INTERVAL_TICKS = 20
  let lastTeamSyncTick = -1
  let teamSyncBusy = false
  let teamSyncErrors = 0

  /**
   * 派单的"团队侧"：为刚建出来的小镇工单在团队里建对应任务，并回填对应关系。
   *
   * 依赖关系要**映射**：小镇的 `blockedBy` 是小镇 id（`task-3`），团队要的是团队 id（`t3`）。
   * 所以先建没有依赖的、记下映射，再建依赖它们的——按 `blockedBy` 的拓扑序建。
   */
  const linkNewTasksToTeam = async (addedTaskIds: readonly string[]): Promise<void> => {
    // 有 Agent World 视图时不接管团队；团队任务归 native plan。
    if (state.activeSessionId !== null) return
    const world = state.currentWorld()
    if (world === null || addedTaskIds.length === 0) return
    const port = acquireTeamsPort()
    if (!port.ok) return
    const added = new Set(addedTaskIds)
    const localToTeam = new Map<string, string>()
    let pending = world.tasks.filter((t) => added.has(t.id))

    // 最多转 N 轮：每轮建"依赖都已映射好"的那些。有环或跨集合依赖时剩下的会被跳过（内容校验本来就禁环）。
    // ⚠️ 上界必须在循环**外**算（R43 真机抓到）：`pending` 在循环里会缩短，拿它当上界的话
    // 三张单的流水线只建了两张——第三张被提前截断，而且不报错。
    const maxRounds = pending.length
    for (let round = 0; round < maxRounds && pending.length > 0; round += 1) {
      const ready = pending.filter((t) => t.blockedBy.every((dep) => !added.has(dep) || localToTeam.has(dep)))
      if (ready.length === 0) break
      for (const task of ready) {
        const teamId = await port.port.createTask({
          subject: task.title,
          description: task.description,
          dependencies: task.blockedBy.map((dep) => localToTeam.get(dep)).filter((id): id is string => id !== undefined),
        })
        localToTeam.set(task.id, teamId)
        runtime.enqueue({ kind: 'taskLink', taskId: task.id, externalId: teamId })
      }
      pending = pending.filter((t) => !localToTeam.has(t.id))
    }
  }

  /** 把团队状态同步回小镇。一轮只发一次命令，失败只记日志不打断世界。 */
  const syncTeamOnce = async (): Promise<void> => {
    // 有 Agent World 视图时不接管团队；世界任务板只显示 native 产物（后续接入）。
    if (state.activeSessionId !== null) return
    if (teamSyncBusy) return
    const world = state.currentWorld()
    if (world === null) return
    const port = acquireTeamsPort()
    if (!port.ok) return
    teamSyncBusy = true
    try {
      const rows = await port.port.readTasks()
      const commands = planTeamSync({
        tasks: rows.map((r) => ({
          id: r.id,
          subject: r.subject,
          status: r.status,
          ...(r.assignee === '' ? {} : { assignee: r.assignee }),
          dependencies: r.dependencies,
          ...(r.output === '' ? {} : { output: r.output }),
          ...(r.attemptId === '' ? {} : { attemptId: r.attemptId }),
        })),
        worldTasks: world.tasks.map((t) => ({
          id: t.id,
          externalId: t.externalId,
          status: t.status,
          owner: t.owner,
          attemptId: t.attemptId,
        })),
        agentIdForMember: (name: string) => world.agents.find((a) => a.name === name)?.id ?? null,
      })
      for (const command of commands) runtime.enqueue(command)
    } catch (error) {
      teamSyncErrors += 1
      // 同步失败不该打断世界：世界继续跑，只是这一轮没跟上团队。
      if (teamSyncErrors <= 3) {
        logger.warn(`团队任务同步失败（第 ${teamSyncErrors} 次，世界继续跑）：${error instanceof Error ? error.message : String(error)}`)
      }
    } finally {
      teamSyncBusy = false
    }
  }

  // 内容层的问题不阻断插件加载——照 dsh-daily 的做法：
  // 插件树加载失败会让**整个 dsh 起不来**，那个代价远大于"世界暂时建不出来"。
  const errors = state.issues().filter((i) => i.level === 'error')
  if (errors.length > 0) {
    const detail = errors
      .slice(0, 5)
      .map((e) => `[${e.where}] ${e.message}`)
      .join('；')
    logger.error(
      `内容层有 ${errors.length} 个错误，世界不会被创建（插件仍可用，agent_world_status 会列出细节）：${detail}`,
    )
    return
  }

  const warnings = state.issues().filter((i) => i.level === 'warning')
  if (warnings.length > 0) {
    logger.warn(
      `内容层有 ${warnings.length} 个警告：${warnings.slice(0, 3).map((w) => `[${w.where}] ${w.message}`).join('；')}`,
    )
  }

  // 世界先建出来（这样 agent_world_status 立刻有东西可看）。
  // **注意 `ensureWorld()` 会先试着接回上次的存档**——所以下面这句日志之前世界可能已经不是新的了。
  // `autoStart` 只决定**要不要开始推进**——配置的语义是"是否推进"，不是"是否存在"。
  try {
    state.ensureWorld()
  } catch (error) {
    logger.error(`建世界失败（已忽略，不影响 dsh 启动）：${error instanceof Error ? error.message : String(error)}`)
    return
  }

  // 事件广播：运行时往里**推**，SSE 订阅者往里**取**。同一个对象两副面孔。
  const hub = createEventHub()

  const runtime = createRuntime({
    service: state,
    tickMs: state.tickMs,
    idleActionsEnabled: resolved.idleActionsEnabled,
    sink: hub,
    ...(storeDir === null
      ? {}
      : {
          persist: {
            store: createWorldStore(storeDir),
            checkpointEveryTicks: resolved.persistEveryTicks,
          },
        }),
    onError: (error) =>
      logger.error(`模拟循环出错（已继续，诊断计数见 errors）：${error instanceof Error ? error.message : String(error)}`),
    // D41/R43：每隔一段 tick 把团队状态同步回小镇。**同步返回**（见 onTick 说明），
    // 真正的读与算丢给一个不等待的 promise。
    onTick: (tick) => {
      if (tick - lastRosterSyncTick >= TEAM_SYNC_INTERVAL_TICKS) {
        lastRosterSyncTick = tick
        void syncRoster()
        syncPersonaProgress(state.currentWorld() ?? ({ agents: [], tasks: [] } as never))
      }
      if (tick - lastTeamSyncTick < TEAM_SYNC_INTERVAL_TICKS) return
      lastTeamSyncTick = tick
      void syncTeamOnce()
    },
  })

  /**
   * R353：任务完成 → Persona 关联 + XP。
   *
   * 只在“这张单第一次进入 persona.taskIds”时结算，所以刷新/重放不会重复加经验。
   * 数据仍在 personaStore 里，不另造一套成就表。
   */
  function syncPersonaProgress(world: World): void {
    for (const agent of world.agents) {
      const key = agent.boundAgentId ?? agent.id
      if (personaStore.get(key) === null) {
        personaStore.upsert({ id: key, name: agent.name, role: agent.role, skills: [agent.role] })
      }
    }
    for (const task of world.tasks) {
      if (task.owner === null) continue
      const agent = world.agents.find((candidate) => candidate.id === task.owner)
      if (agent === undefined) continue
      const key = agent.boundAgentId ?? agent.id
      personaStore.linkTask(key, task.id)
      const persona = personaStore.get(key)
      if (task.status === 'done' && persona !== null && !persona.awardedTaskIds.includes(task.id)) {
        personaStore.awardTask(key, task.id, 40)
      }
    }
  }

  /**
   * R166：把**当前会话**的真实 subagent 子会话投影成镇上角色。
   *
   * 只读 `subagents.listChildren(sessionId)`；没有子会话时镇上只有队长。
   * 失败不抛（subagents 服务可能还没挂上）；下一次 tick 再试。
   */
  let rosterSyncBusy = false
  let lastRosterSyncTick = -1
  const syncRoster = async (): Promise<void> => {
    const sessionId = state.activeSessionId
    if (sessionId === null || rosterSyncBusy) return
    const subagents = (ctx as unknown as { get(name: string): unknown }).get('subagents') as
      | { listChildren?(parentSessionId: string, signal?: AbortSignal): Promise<readonly { id: string; label?: string }[]> }
      | undefined
    if (typeof subagents?.listChildren !== 'function') return
    rosterSyncBusy = true
    try {
      // experimental 的 Lead 就是会话本身；旧 agent-teams 才用派生队长。
      const experimental = typeof agentTeamsService?.listMembers === 'function'
      const parent = experimental ? sessionId : captainSessionIdFor(sessionId)
      const children = await subagents.listChildren(parent)
      const merged = [...children]
      if (experimental) {
        const lead = agentsService?.get?.(sessionId)
        const members = lead === undefined ? [] : (agentTeamsService?.listMembers?.(lead) ?? []) as readonly { id?: unknown; name?: unknown }[]
        const known = new Set(merged.map((child) => child.label?.slice(child.label.lastIndexOf(':') + 1)))
        for (const member of members) {
          const name = typeof member.name === 'string' ? member.name : ''
          if (name === '' || name === 'lead' || name === 'captain' || known.has(name)) continue
          merged.push({ id: typeof member.id === 'string' ? member.id : name, label: `agent-teams:${name}` })
        }
      }
      const leadMember = experimental ? (agentTeamsService?.listMembers?.(agentsService?.get?.(sessionId)!) as readonly { role?: unknown; name?: unknown }[] | undefined)?.find((m) => m.role === 'lead') : undefined
      const leadName = typeof leadMember?.name === 'string' ? leadMember.name : undefined
      state.syncSubagents(sessionId, merged, leadName)
    } catch (error) {
      logger.warn(`同步 subagent 花名册失败（下次再试）：${error instanceof Error ? error.message : String(error)}`)
    } finally {
      rosterSyncBusy = false
    }
  }

  // **先挂清理，再启动。**
  //
  // 顺序是刻意的：dsh 支持热重载，泄漏的 setInterval 会让"改一次代码多一个世界在跑"，
  // 而症状是 CPU 慢慢爬高——很难归因到某个插件。如果先 start 再挂清理，
  // 而挂清理这一步抛了（比如 ctx 形状不对），定时器就**已经泄漏了**，没有任何人再能停它。
  ctx.effect(() => () => {
    runtime.stop()
    state.deactivate()
  }, 'agent-world: runtime')

  if (resolved.autoStart) runtime.start()

  // ── 对话：角色 ↔ DSH Agent 会话（M6-1 / M6-3）─────────────────────────────
  //
  // 这一步把"世界里的小人物"接到 DSH 的 AI 基座上：每个角色**第一次被搭话时才**建一个
  // 真实的 Agent 会话（D36 懒创建），上限由 `maxLiveSessions` 控，卸载时全部 dispose。
  //
  // 拿不到会话服务时**不阻塞插件加载**：世界与面板照跑，`/api/say` 仍会登记对话，
  // 然后以一条写清了原因的 SSE `failed` 事件收场（红线第 6 条：失败要退化，不要卡住）。
  //
  // ⚠️ **建桥必须是惰性的**（R30 在真宿主上踩出来的）：插件加载那一刻，`sessionController`
  // 往往还没挂上 —— cordis 只按 `inject` 图排序，而我们只声明了 `tools`。原来在这里同步建一次，
  // 结果被定死成"没有会话服务"，`/api/say` 从此每条都失败。现在推迟到第一次真正要说话时，
  // 成功后记住；失败则每次都给出**当次**的原因（服务没挂上 / 挂了又掉了，诊断上不是一回事）。
  let liveBridge: CharacterBridge | undefined
  /** 当前真正打开着 Agent World 视图的会话；null = 没有视图。 */
  let viewSessionId: string | null = null
  let lastFailureCode: string | undefined
  const dialoguePort = toLazyDialoguePort(() => {
    const wiring = createDshCharacterBridge(ctx, {
      systemPromptFor: createPersonaResolver(state, () => gameModeEnabled, personaStore),
      // 角色只许看世界、读内容、派单（D35）。**不给 agent_world_open**：那会让一个角色重开整个世界。
      characterTools: ['agent_world_status', 'agent_world_content', 'agent_world_dispatch'],
      maxLiveSessions: resolved.maxLiveSessions,
      requestIdPrefix: 'agent-world-say',
      onError: (reason) => logger.warn(`对话桥：${reason}`),
    })
    if (wiring.ok) {
      liveBridge = wiring.bridge
      logger.info(`对话通道已就绪：上限 ${resolved.maxLiveSessions} 个角色会话（懒创建，超限会给出原因）`)
      return { ok: true, bridge: wiring.bridge }
    }
    // 同一种失败只记一次日志：每次搭话都重试，若每次都写一行，日志就会被同一句话淹没。
    if (lastFailureCode !== wiring.code) {
      lastFailureCode = wiring.code
      // headless profile 里没有 agent 能力是**正常配置**，记 info；
      // 有 agentLoop 却拿不到会话服务才值得 warn —— 把常态写成 warn，真正的警告就会被淹掉。
      if (wiring.code === 'no-agent-loop') logger.info(`对话通道未启用（这个 profile 没有 agent 能力，属于正常配置）：${wiring.reason}`)
      else logger.warn(`对话通道暂不可用（有 agentLoop 却拿不到会话服务）：${wiring.reason}`)
    }
    return { ok: false, reason: wiring.reason }
  })
  // 卸载 / 热重载时把所有角色的会话一起释放 —— 否则每改一次代码就多几个活着的会话
  // （与上面那个 setInterval 泄漏同类：症状是成本慢慢爬高，很难归因到某个插件）。
  ctx.effect(() => () => {
    void liveBridge?.disposeAll()
  }, 'agent-world: dialogue bridge')

  // ── R37：套壳 dsh-agent-teams 的对话后端 ────────────────────────────────────
  //
  // 用户原话："为什么不直接在 dsh-agent-teams 这个插件上套壳？" —— 他是对的。
  // 角色变成 agent-teams 名册里的成员：会话生命周期、信箱、持久化、冷启动接回都归它管，
  // 我们只当队长（队长就是一个普通 DSH 会话，它自己从不需要发言）。
  // 与上面的惰性端口**同样惰性**：加载那一刻 tools/subagents 可能还没挂上（R30 的教训）。
  const resolveSeat = createSeatResolver(state)
  /**
   * R166：TeamsPort 不再是一个全局固定队长，而是**按会话缓存**。
   *
   * 打开哪个会话的 Agent World，就只和那个会话的团队说话；队长就是该会话自己
   * （`ctx.agents.get(sessionId)` 的 live agent），不再另建 `agent-world:captain`。
   */
  const teamsPorts = new Map<string, TeamsPort>()
  /**
   * 每个会话一个**独立的队长会话**，而不是直接拿用户会话当队长。
   *
   * 真机结论：用户会话在 UI 里被写句柄占用，且空闲时没有 live Agent；
   * 拿它当 agent_teams 的 captain 会撞 already exists/active write handle，
   * 或拿到的 {id} handle 在工具里读 `agent.header` 直接崩。
   */
  const captainSessionIdFor = (conversationId: string): string => `agent-world:captain:${conversationId}`
  /**
   * 每个会话的团队名必须不同。agent-teams 的 teamId 是从团队名 slug 出来的；
   * 固定 `Agent World G2` 会被旧队长占用（真机：team id "agent-world-g2" is taken by another captain）。
   */
  const teamNameFor = (conversationId: string): string =>
    conversationId === resolved.captainSessionId
      ? resolved.teamName
      : `${resolved.teamName} #${conversationId.slice(-8)}`
  const createCaptainBase = createTeamsCaptain(ctx, { cwd: process.cwd() })
  const createCaptain = async (sessionId: string, cwd: string) => {
    if (createCaptainBase === undefined) throw new Error('拿不到 agentLoop：建不了会话级队长会话')
    return await createCaptainBase(sessionId, cwd)
  }
  function acquireTeamsPort(
    conversationId: string = state.activeSessionId ?? resolved.captainSessionId,
  ): { ok: true; port: TeamsPort } | { ok: false; reason: string } {
    const sessionId = conversationId === resolved.captainSessionId
      ? resolved.captainSessionId
      : captainSessionIdFor(conversationId)
    const existing = teamsPorts.get(sessionId)
    if (existing !== undefined) return { ok: true, port: existing }
    const tools = (ctx as unknown as { get(name: string): unknown }).get('tools')
    const subagents = (ctx as unknown as { get(name: string): unknown }).get('subagents')
    if (subagents === undefined) {
      return {
        ok: false,
        reason:
          '拿不到 ctx.subagents：agent-teams 的成员是 subagents 建出来的持久子会话，没有它就没有成员。' +
          '确认这个 profile 挂了 dsh-subagent 与 dsh-agent-teams。',
      }
    }
    const feed = createSessionEventFeed(ctx)
    if (feed === undefined) {
      return {
        ok: false,
        reason: '拿不到会话事件总线（ctx.on）：能建团队但收不到成员的回复。再搭一次话试试；一直这样说明宿主没有事件总线。',
      }
    }
    const port = createTeamsPort(
      tools,
      subagents,
      feed,
      {
        captainSessionId: sessionId,
        cwd: process.cwd(),
        teamName: teamNameFor(conversationId),
        teamDescription: resolved.teamDescription,
        memberNameFor: (id) =>
          state.currentWorld()?.agents.find((agent) => agent.id === id)?.name ?? resolveSeat(id).name,
        memberRoleFor: (id) => {
          const actor = state.currentWorld()?.agents.find((agent) => agent.id === id)
          return actor !== undefined && (actor as { boundAgentId?: string | null }).boundAgentId === null ? 'lead' : resolveSeat(id).role
        },
        personaFor: (id) => {
          const actor = state.currentWorld()?.agents.find((agent) => agent.id === id)
          // R173：leader 的显示名/成员名固定为 leader，人设也不能再自称内容花名册里的名字
          // （真机回复里冒出了「工头阿金」——名字从 persona 漏回来了）。
          if (actor !== undefined && (actor as { boundAgentId?: string | null }).boundAgentId === null) {
            return '你是这个团队的 leader，负责统筹与回答。始终用「lead」自称，不要使用花名册里的其它人名。'
          }
          return resolveSeat(id).persona
        },
        toolPolicy: resolved.memberToolPolicy,
        agentOptionsFor: () => readDefaultModelSelection(ctx),
        onError: (reason) => logger.warn(`agent-teams 套壳：${reason}`),
        createCaptain,
      },
    )
    teamsPorts.set(sessionId, port)
    logger.info(`对话后端：agent-teams（队长会话 ${sessionId}，团队「${resolved.teamName}」）`)
    return { ok: true, port }
  }
  const teamsDialoguePort = {
    async say(characterId: string, text: string) {
      const got = acquireTeamsPort()
      if (!got.ok) return { ok: false as const, reason: got.reason }
      return got.port.say(characterId, text)
    },
    async waitForReply(
      characterId: string,
      timeoutMs: number,
      onProgress?: (actions: readonly { name: string; detail?: string; ok: boolean }[]) => void,
    ) {
      const got = acquireTeamsPort()
      if (!got.ok) return { ok: false as const, reason: got.reason }
      return got.port.waitForReply(characterId, timeoutMs, onProgress)
    },
    liveCount: () => [...teamsPorts.values()].reduce((sum, port) => sum + port.liveCount(), 0),
  }
  ctx.effect(() => () => {
    for (const port of teamsPorts.values()) void port.dispose()
    teamsPorts.clear()
  }, 'agent-world: agent-teams ports')

  /**
   * R166 Phase C：工具调用按**调用者会话**定位世界。
   *
   * `ctx.agents.currentInitiator()` 是这次工具调用所属的会话 Agent。没有视图时只把世界
   * 载入内存、**不启动 ticker**（没人看就不跑）；有别的会话的视图开着时直接拒绝，
   * 避免把别人正在跑的世界换掉。
   */
  const currentInitiatorId = (): string | undefined => {
    const getService = (ctx as unknown as { get?: (name: string) => unknown }).get
    const agents = (typeof getService === 'function' ? getService.call(ctx, 'agents') : undefined) as
      | { currentInitiator?(): { id?: unknown } | undefined }
      | undefined
    const id = agents?.currentInitiator?.()?.id
    return typeof id === 'string' && id !== '' ? id : undefined
  }
  const ensureCallerSession = (): void => {
    const caller = currentInitiatorId()
    if (caller === undefined || state.activeSessionId === caller) return
    if (viewSessionId !== null && viewSessionId !== caller) {
      throw new Error(`另一个会话（${viewSessionId}）的 Agent World 正开着；先切回当前会话再操作它的世界。`)
    }
    runtime.stop()
    state.activateSession(caller)
    // 没有视图就不启动 ticker；下次打开该会话视图时 activate 会重新 start。
  }
  const sessionWorld = new Proxy(state as unknown as WorldServicePort, {
    get(target, prop, receiver) {
      const value = Reflect.get(target, prop, receiver)
      if (typeof value !== 'function') return value
      return (...args: unknown[]) => {
        ensureCallerSession()
        return (value as (...a: unknown[]) => unknown).apply(target, args)
      }
    },
  }) as WorldServicePort
  registerWorldTools(ctx, sessionWorld)

  // ── 派单后立刻在团队里建对应任务（D41，R43）────────────────────────────────
  //
  // 包在 `state.dispatch` 外面而不是改 `state`：`state`（世界服务）不该认识 agent-teams，
  // 那是编排层的事。`state` 的方法全是闭包（`this.` 出现 0 次），所以展开一层是安全的。
  const teamAwareWorld = new Proxy(sessionWorld, {
    get(target, prop, receiver) {
      if (prop === 'dispatch') {
        return (taskSet: string): DispatchOutcome => {
          ensureCallerSession()
          const outcome = target.dispatch(taskSet)
          void linkNewTasksToTeam(outcome.addedTaskIds).catch((error) => {
            logger.warn(
              `在团队里建对应任务失败（小镇的工单照常建好了）：${error instanceof Error ? error.message : String(error)}`,
            )
          })
          return outcome
        }
      }
      return Reflect.get(target, prop, receiver)
    },
  }) as WorldServicePort
  registerDispatchTool(ctx, teamAwareWorld)

  /**
   * R174：Agent World 打开时，世界是 **dsh-agent-teams staged plan 的只读投影**。
   *
   * 不再从游戏里自动建队/加成员（那会绕过 Pre-run plan review，并制造
   * already exists / team id taken / agent.header 缺失）。团队由对话里的 captain
   * 走原生 staged plan，批准后成员才 spawn；世界只负责把已 spawn 的 children 画出来。
   *
   * 没有 active 会话（headless/测试/旧 API）时仍保留旧 teams 后端，避免影响其它入口。
   */
  /**
   * R177：experimental profile 没有 staged plan，也没有 agent_teams_*。
   * 点击已 spawn 的成员时，直接走 TeamService.sendMessage；captain 是对话本身，不能从世界里投递。
   */
  /**
   * R189：experimental 成员回复桥。
   *
   * TeamService.sendMessage 只保证投递，回复落在成员自己的 session 里。
   * 这里监听 `session/event` 的 assistant/message，按成员 session id 把第一条
   * 非空文本回传给 waitForReply；超时/无回复由调用方按失败处理。
   */
  const replyWaiters = new Map<string, { resolve(text: string): void; timer: ReturnType<typeof setTimeout> }[]>()
  const listen = (ctx as unknown as {
    on?: (name: string, handler: (session: { id?: string }, event: { type?: string; data?: Record<string, unknown> }) => void) => unknown
  }).on
  if (typeof listen === 'function') {
    const dispose = listen('session/event', (session, event) => {
      if (event.type !== 'assistant/message') return
      const sessionId = typeof session?.id === 'string' ? session.id : ''
      const waiters = replyWaiters.get(sessionId)
      if (waiters === undefined || waiters.length === 0) return
      const message = event.data?.['message'] as { content?: unknown } | undefined
      const blocks = Array.isArray(message?.content) ? message.content : []
      const texts = blocks
        .filter((block): block is { type: string; text: string } => {
          const b = block as Record<string, unknown>
          return b?.['type'] === 'text' && typeof b['text'] === 'string' && b['text'].trim() !== ''
        })
        .map((block) => block.text)
      const text = texts.join('\n\n').trim()
      if (text === '') return
      const waiter = waiters.shift()
      if (waiter === undefined) return
      clearTimeout(waiter.timer)
      waiter.resolve(text)
      if (waiters.length === 0) replyWaiters.delete(sessionId)
    })
    // 会话 feed 可能在插件已失活后才被创建（例如新建会话立刻开工）。
    // cordis 会拒绝在 inactive context 上注册 effect；此时不需要 cleanup，
    // 直接释放订阅即可，不能让一个开工按钮被 cleanup 注册失败打断。
    try {
      ctx.effect(() => () => { (dispose as (() => void) | undefined)?.() })
    } catch (error) {
      if (!(error instanceof Error) || !/inactive context/i.test(error.message)) throw error
      ;(dispose as (() => void) | undefined)?.()
    }
  }
  /**
   * R340：主会话事件 → 世界的对话气泡。
   *
   * 场景里搭话走 `/api/say`，但用户在**主界面**直接对话时没有经过这条链；
   * 这里把同一个 active session（以及 subagent session）的 user/assistant 消息
   * 注入 dialogue SSE，气泡/状态就不再只对场景搭话生效。
   */
  let mainDialogueChannel: DialogueChannel | null = null
  let mainTurnSeq = 0
  const turnBySession = new Map<string, string>()
  if (typeof listen === 'function') {
    const disposeDialogue = listen('session/event', (session, event) => {
      if (mainDialogueChannel === null) return
      if (event.type !== 'user/message' && event.type !== 'assistant/message' && event.type !== 'tool/result') return
      const world = state.currentWorld()
      if (world === null) return
      const sessionId = typeof session?.id === 'string' ? session.id : ''
      const lead = world.agents.find((agent) => agent.boundAgentId === null)
      const actor = world.agents.find((agent) => agent.boundAgentId === sessionId)
        ?? (sessionId === state.activeSessionId ? lead : undefined)
      if (actor === undefined) return
      const message = event.data?.['message'] as { content?: unknown } | undefined
      const blocks = Array.isArray(message?.content) ? message.content : []
      // R364：工具调用 → 去工位；tool/result → 收工。只在游戏模式里映射，普通 profile 不被扰动。
      if (gameModeEnabled) {
        if (event.type === 'assistant/message') {
          const toolNames = blocks
            .filter((block) => (block as Record<string, unknown>)?.['type'] === 'tool-call')
            .map((block) => String((block as Record<string, unknown>)?.['name'] ?? ''))
          if (toolNames.length > 0) {
            const name = toolNames[0] ?? ''
            runtime.enqueue({ kind: 'agentActivity', agentId: actor.id, activity: 'work', ticks: 60, skill: skillForTool(name) })
          }
        } else if (event.type === 'tool/result') {
          runtime.enqueue({ kind: 'agentActivity', agentId: actor.id, activity: 'idle', ticks: 0 })
        }
      }
      const text = blocks
        .filter((block): block is { type: string; text: string } => {
          const b = block as Record<string, unknown>
          return b?.['type'] === 'text' && typeof b['text'] === 'string' && b['text'].trim() !== ''
        })
        .map((block) => block.text).join('\n\n').trim()
      if (text === '') return
      const tick = world.tick
      if (event.type === 'user/message') {
        const turnId = `main-${String(++mainTurnSeq)}`
        turnBySession.set(sessionId, turnId)
        mainDialogueChannel.publish({
          turnId, tick, phase: 'thinking',
          from: { kind: 'god' }, to: { kind: 'agent', id: actor.id }, text,
        })
        return
      }
      const replyTurn = turnBySession.get(sessionId) ?? `main-${String(++mainTurnSeq)}`
      turnBySession.delete(sessionId)
      mainDialogueChannel.publish({
        turnId: replyTurn,
        tick, phase: 'replied',
        from: { kind: 'agent', id: actor.id }, to: { kind: 'god' }, text,
      })
    })
    try {
      ctx.effect(() => () => { (disposeDialogue as (() => void) | undefined)?.() })
    } catch (error) {
      if (!(error instanceof Error) || !/inactive context/i.test(error.message)) throw error
      ;(disposeDialogue as (() => void) | undefined)?.()
    }
  }
  const pendingReplies = new Map<string, Promise<string>>()
  const captainSentAt = new Map<string, number>()
  function replyFor(sessionId: string, timeoutMs = 60_000): Promise<string> {
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        const waiters = replyWaiters.get(sessionId) ?? []
        const index = waiters.findIndex((w) => w.resolve === resolve)
        if (index >= 0) waiters.splice(index, 1)
        if (waiters.length === 0) replyWaiters.delete(sessionId)
        resolve('')
      }, timeoutMs)
      const waiter = { resolve, timer }
      const waiters = replyWaiters.get(sessionId) ?? []
      waiters.push(waiter)
      replyWaiters.set(sessionId, waiters)
    })
  }
  const experimentalDialoguePort = {
    async say(characterId: string, text: string): Promise<{ ok: true } | { ok: false; reason: string }> {
      const lead = agentsService?.get?.(state.activeSessionId ?? '')
      if (lead === undefined) return { ok: false, reason: 'experimental：Lead Agent 不在线，先在对话里打开这个会话。' }
      const actor = state.currentWorld()?.agents.find((agent) => agent.id === characterId)
      if (actor === undefined) return { ok: false, reason: '没有这个角色：先等成员 spawn 出来。' }
      if ((actor as { boundAgentId?: string | null }).boundAgentId === null) {
        // R198：captain 就是当前会话的 Lead；通过 sessionController.prompt 把话送进对话，
        // 回复仍由 session/event 桥接回场景气泡。
        const sessionId = state.activeSessionId ?? ''
        if (sessionId === '' || typeof sessionControllerService?.prompt !== 'function') {
          return { ok: false, reason: 'captain 对话通道不可用：拿不到 sessionController。' }
        }
        try {
          captainSentAt.set(characterId, Date.now())
          pendingReplies.set(characterId, replyFor(sessionId))
          await sessionControllerService.prompt({
            requestId: `agent-world-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
            sessionId,
            mode: 'steer',
            content: [{ type: 'text', text }],
          }, new AbortController().signal)
          return { ok: true }
        } catch (error) {
          return { ok: false, reason: error instanceof Error ? error.message : String(error) }
        }
      }
      if (typeof agentTeamsService?.sendMessage !== 'function') {
        return { ok: false, reason: 'experimental agentTeams 服务不可用。' }
      }
      try {
        const members = agentTeamsService.listMembers?.(lead) as readonly { id?: unknown; name?: unknown }[] | undefined
        const memberId = (members ?? []).find((m) => m.name === actor.name)?.id
        if (typeof memberId === 'string' && memberId !== '') {
          pendingReplies.set(characterId, replyFor(memberId))
        }
        await agentTeamsService.sendMessage(lead, {
          target: actor.name,
          content: [{ type: 'text', text }],
          signal: new AbortController().signal,
        })
        return { ok: true }
      } catch (error) {
        return { ok: false, reason: error instanceof Error ? error.message : String(error) }
      }
    },
    async waitForReply(characterId: string, timeoutMs = 60_000, _onProgress?: (actions: readonly { name: string; detail?: string; ok: boolean }[]) => void): Promise<{ ok: true; text: string; actions: [] } | { ok: false; reason: string }> {
      const actor = state.currentWorld()?.agents.find((agent) => agent.id === characterId)
      // Lead 的主对话可能在跑别的任务，assistant/message 事件不一定落在 world 的监听里；
      // 用 sessionController.inspect 直接轮询会话日志兜底。
      const sentAt = captainSentAt.get(characterId)
      if (sentAt !== undefined && typeof sessionControllerService?.inspect === 'function') {
        const deadline = Date.now() + Math.max(1000, timeoutMs)
        const extract = (data: Record<string, unknown> | undefined): string => {
          const message = data?.['message'] as { content?: unknown } | undefined
          const blocks = Array.isArray(message?.content) ? message.content : []
          return blocks
            .filter((block): block is { type: string; text: string } => {
              const b = block as Record<string, unknown>
              return b?.['type'] === 'text' && typeof b['text'] === 'string' && b['text'].trim() !== ''
            })
            .map((block) => block.text)
            .join('\n\n')
            .trim()
        }
        while (Date.now() < deadline) {
          try {
            const inspection = await sessionControllerService.inspect(state.activeSessionId ?? '')
            for (const event of [...(inspection?.events ?? [])].reverse()) {
              if (event.type !== 'assistant/message') continue
              if (typeof event.time === 'number' && event.time < sentAt - 1000) break
              const text = extract(event.data)
              if (text !== '') {
                captainSentAt.delete(characterId)
                pendingReplies.delete(characterId)
                return { ok: true, text, actions: [] }
              }
            }
          } catch (error) { /* 继续轮询 */ }
          await new Promise((resolve) => setTimeout(resolve, 700))
        }
        captainSentAt.delete(characterId)
        pendingReplies.delete(characterId)
        return { ok: false, reason: `${actor?.name ?? characterId} 没有在超时内回复` }
      }
      const pending = pendingReplies.get(characterId)
      if (pending === undefined) {
        return { ok: true, text: `已发送给 ${actor?.name ?? characterId}`, actions: [] }
      }
      pendingReplies.delete(characterId)
      const text = await Promise.race([
        pending,
        new Promise<string>((resolve) => setTimeout(() => resolve(''), Math.max(1000, timeoutMs))),
      ])
      if (text === '') return { ok: false, reason: `${actor?.name ?? characterId} 没有在超时内回复` }
      return { ok: true, text, actions: [] }
    },
    liveCount: () => 0,
  }
  const nativePlanReadOnlyPort = {
    async say(): Promise<{ ok: false; reason: string }> {
      return {
        ok: false,
        reason:
          'Agent World 是只读投影：请先在对话里用 dsh-agent-teams 的 Pre-run plan review 批准团队计划；' +
          '成员 spawn 后会自动出现在镇上。',
      }
    },
    async waitForReply(): Promise<{ ok: false; reason: string }> {
      return { ok: false, reason: 'Agent World 是只读投影，不直接向成员发消息。' }
    },
    liveCount: () => 0,
  }
  const activeDialoguePort = resolved.dialogueBackend === 'native'
    ? dialoguePort
    : {
        say: (...args: Parameters<typeof teamsDialoguePort.say>) => {
          if (state.activeSessionId === null) return teamsDialoguePort.say(...args)
          return typeof agentTeamsService?.sendMessage === 'function'
            ? experimentalDialoguePort.say(...args)
            : nativePlanReadOnlyPort.say()
        },
        waitForReply: (...args: Parameters<typeof teamsDialoguePort.waitForReply>) => {
          if (state.activeSessionId === null) return teamsDialoguePort.waitForReply(...args)
          return typeof agentTeamsService?.sendMessage === 'function'
            ? experimentalDialoguePort.waitForReply(...args)
            : nativePlanReadOnlyPort.waitForReply()
        },
        liveCount: () => (state.activeSessionId !== null ? 0 : teamsDialoguePort.liveCount()),
      }

  // ── 诊断：把宿主侧的 agent 报错**带 stack** 写出来（R31）─────────────────────
  //
  // 宿主拒绝一条事件时，那条事件**不会落盘、也不会发 session/event**（后者是提交后才推送）；
  // `turn/end` 里只剩一句 message。所以 R30 卡在 "producer-owned source kind" 上看不到是哪条。
  // `agent/error` 带的是**原始 Error 对象**——把它的 stack 打出来就能定位到产出那条事件的代码。
  //
  // 只记**本插件建的会话**（id 以 agent-world: 开头），不碰用户其它会话的报错。
  // 默认只进 logger；设了 AGENT_WORLD_TRACE_FILE 时额外追加到那个文件（宿主日志常常看不到）。
  const traceFile = process.env['AGENT_WORLD_TRACE_FILE']
  const onAgentError = (payload: unknown, ...rest: unknown[]): void => {
    try {
      const record = (typeof payload === 'object' && payload !== null ? payload : {}) as Record<string, unknown>
      const agent = (rest[0] ?? record['agent']) as { id?: unknown; session?: { id?: unknown } } | undefined
      const id = String(agent?.id ?? agent?.session?.id ?? (this_agentId(record) ?? ''))
      if (id !== '' && !id.startsWith('agent-world:')) return
      const error = record['error']
      const stack = error instanceof Error ? (error.stack ?? error.message) : String(error)
      const line = `[agent-world] agent/error session=${id || '?'} turn=${String(record['turn'])} step=${String(record['step'])}\n${stack}`
      logger.warn(line)
      if (traceFile) appendFileSync(traceFile, `${new Date().toISOString()} ${line}\n\n`)
    } catch {
      // 诊断钩子自己出错绝不能影响对话
    }
  }
  const on = (ctx as unknown as { on?: (name: string, cb: (...args: unknown[]) => void) => unknown }).on
  if (typeof on === 'function') {
    const off = on.call(ctx, 'agent/error', onAgentError)
    if (typeof off === 'function') ctx.effect(() => off as () => void, 'agent-world: error trace')
  }

  // ── HTTP：面板 + API ─────────────────────────────────────────────────────
  //
  // `webServer` 是**软依赖**：没有它时世界照跑，只是没有界面。用 `ctx.inject` 而不是写进
  // 顶层 `inject` ——写进去会让这个插件在 headless profile 里直接加载失败，
  // 而"世界能不能跑"和"有没有人看"本来就不该绑在一起（架构 §2 的第一原则）。
  ctx.inject(['webServer'], (host) => {
    const webServer = (host as unknown as {
      webServer: { register(route: { kind: 'prefix'; path: string; handler: unknown }): () => void }
    }).webServer

    const handler = createHandler(
      resolved.routePrefix,
      {
        service: state,
        runtime,
        source: hub,
        tickMs: state.tickMs,
        maxLiveSessions: resolved.maxLiveSessions,
        dialogue: activeDialoguePort,
        gameMode: { get: () => gameModeEnabled, set: (enabled) => { gameModeEnabled = enabled; const world = state.currentWorld(); if (world !== null) world.gameMode = enabled } },
        personas: {
          list: () => personaStore.list() as unknown as Record<string, unknown>[],
          upsert: (input) => personaStore.upsert(input as never) as unknown as Record<string, unknown>,
          addXp: (id, amount) => personaStore.addXp(id, amount) as unknown as Record<string, unknown> | null,
          linkTask: (id, taskId) => personaStore.linkTask(id, taskId) as unknown as Record<string, unknown> | null,
        },
        onDialogueChannel: (channel) => { mainDialogueChannel = channel },
        // R166：一个会话一个世界；同一时刻只有激活的那个在跑。
        activateSession: (sessionId: string) => {
          viewSessionId = sessionId
          runtime.stop()
          const world = state.activateSession(sessionId)
          if (resolved.autoStart) runtime.start()
          void syncRoster()
          return world
        },
        deactivateSession: () => {
          viewSessionId = null
          runtime.stop()
          state.deactivate()
        },
        // R162：header 要显示"这个世界对应的会话名"。
        // 队长会话的标题在 session 日志里，异步读；读不到就让前端退回 teamName / id。
        worldSession: async () => {
          const id = resolved.captainSessionId
          const teamName = resolved.teamName
          try {
            const query = ctx.get('sessionQuery') as
              | { readTitle?: (sessionId: string) => Promise<{ title?: string } | undefined> }
              | undefined
            const snapshot = typeof query?.readTitle === 'function' ? await query.readTitle(id) : undefined
            const title = typeof snapshot?.title === 'string' && snapshot.title !== '' ? snapshot.title : null
            return { id, teamName, title }
          } catch {
            return { id, teamName, title: null }
          }
        },
        teamRoster: async (sessionId: string) => {
          const lead = agentsService?.get?.(sessionId)
          if (lead === undefined) return { available: false, reason: 'Lead Agent 不在线：先打开这个会话再试' }
          const teams = agentTeamsService
          if (typeof teams?.membership !== 'function' || typeof teams.listMembers !== 'function' || typeof teams.listTasks !== 'function') {
            return { available: false, reason: 'experimental agentTeams 服务不可用（当前 profile 没装/未激活）' }
          }
          try {
            const membership = teams.membership(lead) as { id?: unknown; name?: unknown; role?: unknown } | undefined
            const members = teams.listMembers(lead) as readonly Record<string, unknown>[] | undefined
            const tasks = teams.listTasks(lead) as readonly Record<string, unknown>[] | undefined
            // 不能把 Agent/service 对象直接序列化（真机：cannot get property "toJSON" without inject）。
            return {
              available: true,
              provider: 'experimental',
              lead: membership === undefined ? null : {
                id: String(membership.id ?? ''),
                name: String(membership.name ?? ''),
                role: String(membership.role ?? ''),
              },
              members: (members ?? []).map((m) => ({
                id: String(m['id'] ?? ''),
                name: String(m['name'] ?? ''),
                role: String(m['role'] ?? ''),
                status: String(m['status'] ?? ''),
                description: typeof m['description'] === 'string' ? m['description'] : '',
                model: typeof m['model'] === 'string' ? m['model'] : '',
              })),
              tasks: (tasks ?? []).map((t) => ({
                id: String(t['id'] ?? ''),
                subject: String(t['subject'] ?? ''),
                description: typeof t['description'] === 'string' ? t['description'] : '',
                status: String(t['status'] ?? ''),
                ownerName: typeof t['ownerName'] === 'string' ? t['ownerName'] : '',
                ready: t['ready'] === true,
                // R207：依赖/版本是看图与 CAS 的输入，之前被 sanitize 掉了，导致 0 条边。
                blockedBy: Array.isArray(t['blockedBy']) ? t['blockedBy'].filter((id): id is string => typeof id === 'string') : [],
                revision: Number.isFinite(t['revision']) ? Number(t['revision']) : undefined,
              })),
            }
          } catch (error) {
            return { available: false, reason: error instanceof Error ? error.message : String(error) }
          }
        },
        teamTask: async (payload: Record<string, unknown>) => {
          const rootSessionId = typeof payload.rootSessionId === 'string' ? payload.rootSessionId : ''
          const lead = agentsService?.get?.(rootSessionId)
          if (lead === undefined) return { ok: false, error: 'Lead Agent 不在线：先打开这个会话再试' }
          const teams = agentTeamsService
          if (typeof teams?.createTask !== 'function' || typeof teams.updateTask !== 'function' || typeof teams.listTasks !== 'function') {
            return { ok: false, error: 'experimental agentTeams 任务服务不可用' }
          }
          const action = payload.action
          try {
            if (action === 'create') {
              const subject = typeof payload.subject === 'string' ? payload.subject.trim() : ''
              if (subject === '') return { ok: false, error: '任务标题不能为空' }
              const task = await teams.createTask!(lead, {
                subject,
                description: typeof payload.description === 'string' && payload.description.trim() !== ''
                  ? payload.description
                  : subject,
              })
              const owner = typeof payload.owner === 'string' ? payload.owner.trim() : ''
              if (owner === '') return { ok: true, task }
              const created = task as { id?: unknown; revision?: unknown }
              const assigned = await teams.updateTask(lead, {
                taskId: String(created.id ?? ''),
                expectedRevision: Number(created.revision ?? 1),
                action: 'reassign',
                owner,
              })
              return { ok: true, task: assigned }
            }
            if (action === 'update') {
              // projection 的 task 行不总是带 revision（真机 task.revision undefined）。
              // 缺失时用官方 listTasks 反查当前 revision，再走同一条 CAS。
              let expectedRevision = payload.expectedRevision
              if (typeof expectedRevision !== 'number') {
                const current = await teams.listTasks!(lead) as readonly { id?: unknown; revision?: unknown }[]
                expectedRevision = current.find((row) => row.id === payload.taskId)?.revision
              }
              const doUpdate = async (revision: unknown) => teams.updateTask!(lead, {
                taskId: payload.taskId,
                expectedRevision: revision,
                action: payload.updateAction,
                ...(typeof payload.owner === 'string' && payload.owner !== '' ? { owner: payload.owner } : {}),
              })
              try {
                const task = await doUpdate(expectedRevision)
                return { ok: true, task }
              } catch (error) {
                // 官方 projection 的 task 行不带 revision 时，服务仍会报出当前 revision。
                // 只在这种“本来就没有 CAS 基线”的情况下重试一次；不是掩盖真实冲突。
                const message = error instanceof Error ? error.message : String(error)
                const match = /current revision is (\d+)/.exec(message)
                if (match !== null) {
                  const task = await doUpdate(Number(match[1]))
                  return { ok: true, task }
                }
                throw error
              }
            }
            return { ok: false, error: '未知任务动作' }
          } catch (error) {
            return { ok: false, error: error instanceof Error ? error.message : String(error) }
          }
        },
        history: async (agentId: string) => {
          const world = state.currentWorld()
          const actor = world?.agents.find((a) => a.id === agentId)
          const sessionId = actor?.boundAgentId ?? state.activeSessionId
          if (sessionId === null || sessionId === undefined || typeof sessionControllerService?.inspect !== 'function') {
            return { ok: false, messages: [] }
          }
          try {
            // sessionQuery 的日志含 user/message；sessionController.inspect 在真机上只回 assistant。
            const query = sessionQueryService
            const inspection = typeof query?.readSession === 'function'
              ? await query.readSession(sessionId) as { events?: readonly { type?: string; time?: number; data?: Record<string, unknown> }[] }
              : await sessionControllerService.inspect(sessionId)
            const messages: { role: 'user' | 'assistant'; text: string; time: number }[] = []
            const extract = (data: Record<string, unknown> | undefined): string => {
              const message = data?.['message'] as { content?: unknown } | undefined
              const direct = data?.['content']
              const blocks = Array.isArray(direct) ? direct : Array.isArray(message?.content) ? message.content : []
              return blocks
                .filter((block): block is { type: string; text: string } => {
                  const b = block as Record<string, unknown>
                  return b?.['type'] === 'text' && typeof b['text'] === 'string' && b['text'].trim() !== ''
                })
                .map((block) => block.text)
                .join('\n\n')
                .trim()
            }
            for (const event of inspection?.events ?? []) {
              if (event.type !== 'user/message' && event.type !== 'assistant/message') continue
              const text = extract(event.data)
              if (text === '') continue
              // 上下文注入/调度提醒不是用户说的话，不能当成聊天气泡。
              if (/^(Current runtime context\.|This snapshot supersedes|\[SCHEDULE REMINDER|<system-reminder>|Time sampled while preparing turn|【灵枢最近记忆】)/.test(text) || text.includes('【灵枢最近记忆】')) continue
              messages.push({ role: event.type === 'user/message' ? 'user' : 'assistant', text, time: Number(event.time ?? 0) })
            }
            return { ok: true, sessionId, messages: messages.slice(-200) }
          } catch (error) {
            return { ok: false, messages: [], error: error instanceof Error ? error.message : String(error) }
          }
        },
        teamPlan: async (sessionId: string) => {
          const query = sessionQueryService
          if (typeof query?.readSession !== 'function') return null
          try {
            const snapshot = await query.readSession(sessionId) as { events?: readonly { type?: string; data?: Record<string, unknown> }[] } | undefined
            const events = snapshot?.events ?? []
            for (let i = events.length - 1; i >= 0; i -= 1) {
              const event = events[i]
              if (event?.type !== 'tool/call') continue
              const data = event.data ?? {}
              if (data.name !== 'agent_teams_create') continue
              let args: Record<string, unknown> = {}
              try { args = JSON.parse(typeof data.arguments === 'string' ? data.arguments : '{}') as Record<string, unknown> } catch { continue }
              const plan = args.plan as { members?: unknown; tasks?: unknown } | undefined
              if (plan === undefined) continue
              return {
                name: typeof args.name === 'string' ? args.name : '',
                description: typeof args.description === 'string' ? args.description : '',
                approval: typeof args.approval === 'string' ? args.approval : 'required',
                members: Array.isArray(plan.members) ? plan.members : [],
                tasks: Array.isArray(plan.tasks) ? plan.tasks : [],
              }
            }
            return null
          } catch {
            return null
          }
        },
      },
      (error, request) => {
        const detail = error instanceof Error ? error.message : String(error)
        logger.warn(`HTTP ${request.method} ${request.pathname} 出错：${detail}`)
      },
    )

    // 整个插件只占**一个**路由座位（一个前缀），所以与别的插件不可能撞——
    // 而 `webServer.register` 撞了是会抛的，且 fallback 座位已被官方 SPA 占用，不能抢。
    const dispose = webServer.register({ kind: 'prefix', path: resolved.routePrefix, handler })
    host.effect(() => dispose, 'agent-world: http routes')

    logger.info(
      `面板与 API 挂在 ${resolved.routePrefix}/（同宿主地址）· 快照 ${resolved.routePrefix}/api/world · 搭话 ${resolved.routePrefix}/api/say · 事件流 ${resolved.routePrefix}/api/events`,
    )
  })

  const restored = state.restoredFrom()
  if (restored !== null) {
    logger.info(
      `已从存档接回世界（存档在 tick ${restored.savedAtTick}，用 ${restored.packVersions
        .map((p) => `${p.id}@${p.version}`)
        .join('、')} 装）——不是新开的一局。`,
    )
  }

  logger.info(
    `已就绪：${state.describeContent()} · 世界${
      resolved.autoStart ? `每 ${state.tickMs}ms 推进一次（autoStart）` : '已建好但未开始推进（autoStart=false）'
    }`,
  )
}

/**
 * 角色 → system prompt（M6-2）。
 *
 * ## 这里做的是"取内容"，不是"造人设"
 *
 * 人设与说话方式**全部来自花名册**（决策 D37）：本函数只负责
 * **把世界里的角色对上花名册的座位**，再把世界此刻的事实一起交给
 * {@link buildCharacterSystemPrompt} 那个纯模板。所以"换一个花名册 = 换一套性格"。
 *
 * ## ⚠️ 为什么不能按 `role` 找座位（这里踩过一次）
 *
 * 默认花名册里有**三个 `engineer`**。按 `role` 反查会让这三个角色拿到**同一份人设**，
 * 而它**不会报错**——症状只是"这三个角色说话一模一样"，极难归因。
 * 所以用 `seatForAgent()`：**序号优先**（域自己的规则 `roster.seats[i] → agent-<i+1>`，
 * 见 `content/instantiate.ts`），名字兜底，名字有歧义时**宁可报错也不猜**。
 *
 * ## 失败要给出能直接下手的原因
 *
 * 拿不到人设就**抛**（而不是发一条空 prompt）：空人设的症状是"所有人都像同一个人"，
 * 那种失败比"这个角色说不出话"更难查。抛出后 bridge 会把原因变成
 * `会话创建失败：<原因>`（或者人设生成失败），一路带到面板上。
 *
 * @param state - 插件状态（读世界 + 读内容注册表）。
 */
/**
 * 角色 id → 花名册席位（R37）。
 *
 * 套壳 `dsh-agent-teams` 时，一个角色要三样东西：**成员名**（团队名册里的唯一键）、
 * **岗位**（写进成员人设的 role）、**人设正文**（走 `executionPrompt`）。
 * 这三样都从同一个席位上取，所以解析逻辑收在一处——分成三个函数就会出现三份
 * "怎么按 agent-N 找座位"的实现，迟早不一致。
 */
interface ResolvedSeat {
  readonly name: string
  readonly role: string
  readonly persona: string
}

function createSeatResolver(state: ReturnType<typeof createPluginState>): (characterId: string) => ResolvedSeat {
  return (characterId: string): ResolvedSeat => {
    const world = state.currentWorld()
    if (world === null) {
      throw new Error('世界还没建出来，读不到这个角色是谁（人设来自内容库的花名册）。')
    }

    const agent = world.agents.find((candidate) => candidate.id === characterId)
    if (agent === undefined) {
      const ids = world.agents.map((candidate) => candidate.id)
      throw new Error(
        `世界里没有 "${characterId}" 这个角色，生成不了人设。` +
          `可用角色：${ids.length > 0 ? ids.join(' / ') : '（一个都没有）'}`,
      )
    }

    // 世界记录的是"用哪个场景装出来的"，场景引用花名册。跟着这条链走，
    // 就不需要在这里写任何内容 id（写死的 id 会让换内容包变成改代码）。
    const scene = state.registry.require(
      'scenes',
      world.origin.scene,
      `给「${agent.name}」(${characterId}) 生成人设时读场景（它引用花名册）`,
    )
    const roster = state.registry.require(
      'rosters',
      scene.roster,
      `给「${agent.name}」(${characterId}) 生成人设时读花名册`,
    )

    const seat = seatForAgent(roster.seats, agent)
    if (seat === undefined) {
      const seats = roster.seats.map((s) => `${s.name}(${s.role})`)
      throw new Error(
        `花名册「${roster.id}」里找不到「${agent.name}」(${characterId}) 对应的座位，所以生成不了人设。` +
          `花名册里的座位：${seats.join(' / ')}。` +
          '（座位与角色按 agent-N ↔ 第 N 个座位的顺序对应；名字必须唯一，否则无法判断是哪一位。）',
      )
    }

    const carrying = agent.carrying
    const taskTitle =
      carrying === null ? null : (world.tasks.find((task) => task.id === carrying)?.title ?? null)

    return {
      name: seat.name,
      role: seat.role,
      persona: buildCharacterSystemPrompt(
        seat,
        {
          worldName: world.name,
          tick: world.tick,
          state: agent.state,
          stationName: stationLabel(state, agent.station),
          taskTitle,
          walkingTo: stationLabel(state, agent.targetStation),
        },
        scene.residentRules ?? [],
      ),
    }
  }
}

/** 旧签名（人设正文）：套壳路径之外的调用方还在用。 */
function createPersonaResolver(state: ReturnType<typeof createPluginState>, gameMode: () => boolean, personas: ReturnType<typeof createPersonaStore>): (characterId: string) => string {
  const resolve = createSeatResolver(state)
  const GAME_PROMPT = [
    '你现在在一个可玩的办公室里，而不是只做文本问答。',
    '保持角色人设；回复简短、有动作感，优先用一句话说明你要去做什么。',
    '你拥有 level / skills / preferences 的游戏化设定：升级靠完成任务，技能决定你更适合工位、会议还是休息。',
    '每次行动要能在场景里对应到工作 / 开会 / 休息；不知道做什么时，先看世界状态再决定。',
  ].join('\n')
  return (characterId) => {
    const seat = resolve(characterId)
    if (!gameMode()) return seat.persona
    const world = state.currentWorld()
    const actor = world?.agents.find((agent) => agent.id === characterId)
    const key = actor?.boundAgentId ?? actor?.id ?? characterId
    const saved = personas.get(key) ?? personas.upsert({ id: key, name: actor?.name ?? key, role: actor?.role ?? 'engineer', prompt: seat.persona })
    // 把等级/技能/任务关联注入，让 subagent 不只是“知道人设”，还知道自己的成长与手头关系。
    const growth = [
      `Level ${saved.level} / XP ${saved.xp}`,
      saved.skills.length > 0 ? `Skills: ${saved.skills.join(', ')}` : 'Skills: 尚未学习',
      saved.taskIds.length > 0 ? `Linked tasks: ${saved.taskIds.slice(-5).join(', ')}` : 'Linked tasks: 无',
      saved.prompt.trim() !== '' ? `Persona note: ${saved.prompt}` : '',
    ].filter(Boolean).join('\n')
    return `${seat.persona}\n\n${GAME_PROMPT}\n\n${growth}`
  }
}

/**
 * 站点 id → 站点名。
 *
 * 站点名是**内容**，所以走注册表取；取不到时退回 id 本身——
 * 那也是事实（比编一个名字诚实），而且不会因为一个名字缺失就让人设生成失败。
 */
function stationLabel(state: ReturnType<typeof createPluginState>, stationId: string | null): string | null {
  if (stationId === null) return null
  return state.registry.get('stations', stationId)?.data.name ?? stationId
}
