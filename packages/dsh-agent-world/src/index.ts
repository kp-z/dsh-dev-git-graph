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
import { appendFileSync } from 'node:fs'
import { resolve } from 'node:path'
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
import type { TeamsPort } from './bridge/index.js'
import type { CharacterBridge } from './bridge/index.js'
import { type AgentWorldConfig, resolveConfig } from './config.js'
import { resolveContentRoot } from './content/load-files.js'
import { createHandler } from './routes/index.js'
import { createEventHub, createRuntime } from './runtime/index.js'
import { createWorldStore } from './store/index.js'
import { createPluginState } from './state.js'
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

  const state = createPluginState(resolved, { externalRoot: contentRoot.root, storeDir })

  registerWorldTools(ctx, state)
  registerDispatchTool(ctx, state)

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
  })

  // **先挂清理，再启动。**
  //
  // 顺序是刻意的：dsh 支持热重载，泄漏的 setInterval 会让"改一次代码多一个世界在跑"，
  // 而症状是 CPU 慢慢爬高——很难归因到某个插件。如果先 start 再挂清理，
  // 而挂清理这一步抛了（比如 ctx 形状不对），定时器就**已经泄漏了**，没有任何人再能停它。
  ctx.effect(() => () => {
    runtime.stop()
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
  let lastFailureCode: string | undefined
  const dialoguePort = toLazyDialoguePort(() => {
    const wiring = createDshCharacterBridge(ctx, {
      systemPromptFor: createPersonaResolver(state),
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
  let teamsPort: TeamsPort | undefined
  function acquireTeamsPort(): { ok: true; port: TeamsPort } | { ok: false; reason: string } {
    if (teamsPort !== undefined) return { ok: true, port: teamsPort }
    const tools = (ctx as unknown as { get(name: string): unknown }).get('tools')
    const subagents = (ctx as unknown as { get(name: string): unknown }).get('subagents')
    const createCaptain = createTeamsCaptain(ctx, { cwd: process.cwd() })
    if (createCaptain === undefined) {
      return { ok: false, reason: '拿不到 agentLoop：建不了队长会话，所以没法套壳 agent-teams。' }
    }
    if (subagents === undefined) {
      return {
        ok: false,
        reason:
          '拿不到 ctx.subagents：agent-teams 的成员是 subagents 建出来的持久子会话，没有它就没有成员。' +
          '确认这个 profile 挂了 dsh-subagent 与 dsh-agent-teams。',
      }
    }
    // ⚠️ **暂时性失败不许缓存**（R38 真机踩到，与 R30 同一条教训）：事件通道比我们晚挂上时，
    // 若把"没有事件通道"的端口建好并记住，之后每次搭话都拿不到回复。所以缺它时**不建端口**，下次再试。
    // 只要 `ctx.on`：套壳路径发话走工具，不需要 `sessionController`（R38：它在 web profile 里一直 pending）。
    const feed = createSessionEventFeed(ctx)
    if (feed === undefined) {
      return {
        ok: false,
        reason: '拿不到会话事件总线（ctx.on）：能建团队但收不到成员的回复。再搭一次话试试；一直这样说明宿主没有事件总线。',
      }
    }
    teamsPort = createTeamsPort(
      tools,
      subagents,
      feed,
      {
        captainSessionId: 'agent-world:captain',
        cwd: process.cwd(),
        teamName: resolved.teamName,
        teamDescription: resolved.teamDescription,
        memberNameFor: (id) => resolveSeat(id).name,
        memberRoleFor: (id) => resolveSeat(id).role,
        personaFor: (id) => resolveSeat(id).persona,
        toolPolicy: resolved.memberToolPolicy,
        agentOptionsFor: () => readDefaultModelSelection(ctx),
        onError: (reason) => logger.warn(`agent-teams 套壳：${reason}`),
        createCaptain,
      },
    )
    logger.info(`对话后端：agent-teams（队长会话 agent-world:captain，团队「${resolved.teamName}」）`)
    return { ok: true, port: teamsPort }
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
    liveCount: () => teamsPort?.liveCount() ?? 0,
  }
  ctx.effect(() => () => {
    void teamsPort?.dispose()
  }, 'agent-world: agent-teams port')

  /** 按配置选后端。`native` 是 R24–R36 手写的那套，留作对照与回退。 */
  const activeDialoguePort = resolved.dialogueBackend === 'native' ? dialoguePort : teamsDialoguePort

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
function createPersonaResolver(state: ReturnType<typeof createPluginState>): (characterId: string) => string {
  const resolve = createSeatResolver(state)
  return (characterId) => resolve(characterId).persona
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
