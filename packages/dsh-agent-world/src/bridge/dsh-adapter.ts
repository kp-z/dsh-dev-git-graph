/**
 * 把 DSH 的真实服务接到 bridge 的注入点上（M6-0 查到的契约在这里落地）。
 *
 * ## 为什么入参是 `unknown`，而不是 cordis 的 `Context`
 *
 * 本包不依赖 `@deepseek-ai/dsh-agent-loop` / `dsh-api-session-controller`
 * （peer 依赖只有 cordis / dsh-tools / schemastery），拿不到那两个服务的类型。
 * 更重要的是：`ctx.get('sessionController')` 在没挂会话服务的 profile 里**返回 `undefined`**，
 * 而这正是红线第 6 条要求退化的场景之一。
 *
 * 所以这里**运行时探测**，而不是编译期断言：探测失败就返回 `undefined`，
 * 由 bridge 翻译成"DSH 会话服务不可用"这种可下手的原因。
 * 入参 `unknown` 也让调用方（`src/index.ts`）零摩擦传自己的 `ctx`。
 *
 * 契约来源见 `docs/BRIDGE-RECON.md` §2.1 / §2.2 / §3.2。
 */
import { createCharacterBridge } from './character-bridge.js'
import type {
  AgentFactory,
  BridgeAgentHandle,
  BridgeAgentOptions,
  BridgeResumeAgentOptions,
  BridgeCreateAgentOptions,
  BridgePromptRequest,
  BridgeReadiness,
  BridgeSessionEvent,
  CharacterBridge,
  SessionTransport,
} from './types.js'

/** 从形如对象上取一个方法；拿不到就 `undefined`（不抛）。 */
function pluck(target: unknown, key: string): ((...args: never[]) => unknown) | undefined {
  if (typeof target !== 'object' || target === null) return undefined
  const value = (target as Record<string, unknown>)[key]
  return typeof value === 'function' ? (value as (...args: never[]) => unknown) : undefined
}

/** `ctx.get(name)` 的运行时探测；没有 `get` 或查不到都返回 `undefined`。 */
function getService(ctx: unknown, key: string): unknown {
  const get = pluck(ctx, 'get')
  if (get === undefined) return undefined
  try {
    return (get as unknown as (this: unknown, name: string) => unknown).call(ctx, key)
  } catch {
    return undefined
  }
}

/** 从 `Session` 上取 `id`（`Session` 有 `get id(): SessionId`）。 */
function sessionIdOf(session: unknown): string | undefined {
  if (typeof session !== 'object' || session === null) return undefined
  const id = (session as { id?: unknown }).id
  return typeof id === 'string' && id !== '' ? id : undefined
}

/**
 * 把事件总线上的 `unknown` 规格化成 {@link BridgeSessionEvent}。
 *
 * 相邻插件（`dsh-mermaid-comm`）的写法是把事件参数当 `any` 用；这里多走一步：
 * 先确认 `type` 是字符串，缺 `seq`/`time` 就补 0。**不撒谎**（不写 `as BridgeSessionEvent`），
 * 因为任何插件都能往会话日志里 append 自定义事件。
 */
export function normalizeSessionEvent(value: unknown): BridgeSessionEvent | undefined {
  if (typeof value !== 'object' || value === null) return undefined
  const event = value as Record<string, unknown>
  if (typeof event.type !== 'string') return undefined
  return {
    type: event.type,
    seq: typeof event.seq === 'number' ? event.seq : 0,
    time: typeof event.time === 'number' ? event.time : 0,
    ...(event.data === undefined ? {} : { data: event.data }),
    ...(event.surfaceOp === undefined ? {} : { surfaceOp: event.surfaceOp }),
    ...(event.sourceEventSeqs === undefined ? {} : { sourceEventSeqs: event.sourceEventSeqs }),
  }
}

/**
 * 包住 `ctx.agentLoop.createAgent(ownerCtx, options)`。
 *
 * `ownerCtx` 必须传**插件自己的 ctx** —— 契约里写的是
 * "caller context that structurally owns the lifecycle"，传别的会让会话的生命周期
 * 挂错地方（插件卸载时它不会被一起释放）。
 *
 * @returns 没有 `agentLoop` 服务时 `undefined`。
 */
export function createAgentFactory(ctx: unknown): AgentFactory | undefined {
  const agentLoop = getService(ctx, 'agentLoop')
  const createAgent = pluck(agentLoop, 'createAgent')
  if (createAgent === undefined) return undefined

  const resume = pluck(agentLoop, 'resume')

  return {
    async createAgent(options: BridgeCreateAgentOptions): Promise<BridgeAgentHandle> {
      // `cwd` 在 **`options.meta` 里**（`createAgent(ownerCtx, options)` 只有两个参数）。
      // 我第一版猜成"第三个参数"，被自己的测试当场抓住——所以这行有测试守着。
      const { cwd, ...rest } = options
      const payload = cwd === undefined ? rest : { ...rest, meta: { cwd } }
      const handle = await (
        createAgent as unknown as (owner: unknown, opts: unknown) => Promise<BridgeAgentHandle>
      ).call(agentLoop, ctx, payload)
      return handle
    },

    // 只有宿主提供了 resume 才暴露它 —— 没有持久化后端时它也不存在，那时保持"建不了就报原因"。
    ...(resume === undefined
      ? {}
      : {
          async resumeAgent(options: BridgeResumeAgentOptions): Promise<BridgeAgentHandle> {
            return await (resume as unknown as (owner: unknown, opts: unknown) => Promise<BridgeAgentHandle>).call(
              agentLoop,
              ctx,
              options,
            )
          },
        }),
  }
}

/**
 * 把"发话"和"收话"包成一个 {@link SessionTransport}：
 *
 * - 发话：`ctx.sessionController.prompt(request, signal)`（BRIDGE-RECON §2.1 / §3）
 * - 收话：`ctx.on('session/event', (session, event) => ...)`（BRIDGE-RECON §4）
 *
 * @returns 缺少 `sessionController` 或 `ctx.on` 时 `undefined`。
 */
export function createSessionTransport(ctx: unknown): SessionTransport | undefined {
  const controller = getService(ctx, 'sessionController')
  const prompt = pluck(controller, 'prompt')
  const on = pluck(ctx, 'on')
  if (prompt === undefined || on === undefined) return undefined

  return {
    async prompt(request: BridgePromptRequest, signal: AbortSignal): Promise<unknown> {
      return (prompt as unknown as (this: unknown, req: unknown, sig: unknown) => Promise<unknown>).call(
        controller,
        request,
        signal,
      )
    },

    subscribe(listener: (sessionId: string, event: BridgeSessionEvent) => void): () => void {
      const maybeDispose = (
        on as unknown as (this: unknown, name: string, cb: (...args: unknown[]) => void) => unknown
      ).call(ctx, 'session/event', (session: unknown, event: unknown) => {
        const sessionId = sessionIdOf(session)
        if (sessionId === undefined) return
        const normalized = normalizeSessionEvent(event)
        if (normalized === undefined) return
        listener(sessionId, normalized)
      })
      return typeof maybeDispose === 'function' ? (maybeDispose as () => void) : () => {}
    },
  }
}

/**
 * **只订阅、不发话**的事件通道（R38，给套壳路径用）。
 *
 * 套壳路径发话走 `agent_teams_send_message`（工具），根本不用 `sessionController.prompt`；
 * 它只需要从成员会话的事件流里收回复。而 `createSessionTransport` 要求 `sessionController`
 * 也在——R38 真机上 web profile 里 `sessionController` 一直是 pending
 * （宿主日志：`ui-deliverables … pending (waiting for service: sessionController)`），
 * 于是套壳路径被一个**它根本不用**的服务卡死。依赖要按实际用到的算。
 *
 * @returns 没有 `ctx.on` 时 `undefined`。
 */
export function createSessionEventFeed(
  ctx: unknown,
): { subscribe(listener: (sessionId: string, event: BridgeSessionEvent) => void): () => void } | undefined {
  const on = pluck(ctx, 'on')
  if (on === undefined) return undefined
  return {
    subscribe(listener) {
      const maybeDispose = (
        on as unknown as (this: unknown, name: string, cb: (...args: unknown[]) => void) => unknown
      ).call(ctx, 'session/event', (session: unknown, event: unknown) => {
        const sessionId = sessionIdOf(session)
        if (sessionId === undefined) return
        const normalized = normalizeSessionEvent(event)
        if (normalized === undefined) return
        listener(sessionId, normalized)
      })
      return typeof maybeDispose === 'function' ? (maybeDispose as () => void) : () => {}
    },
  }
}

/**
 * 读用户在 DSH 里选的**默认模型**：`ctx.agentDefaultModel.currentSelection()`。
 *
 * 这是官方会话控制器在"新会话还没写过请求头"时用的同一个来源
 * （`dsh-api-session-controller`：`if (loggedHeader === undefined) return defaultModel.currentSelection()`），
 * 所以角色和用户自己开的对话**用的是同一个模型**，不另造一套配置。
 *
 * @returns `{provider, model, reasoningEffort?}`；没有该服务或读不到时 `undefined`。
 */
export function readDefaultModelSelection(ctx: unknown): BridgeAgentOptions | undefined {
  const service = getService(ctx, 'agentDefaultModel')
  const current = pluck(service, 'currentSelection')
  if (current === undefined) return undefined
  const raw = (current as unknown as (this: unknown) => unknown).call(service)
  if (typeof raw !== 'object' || raw === null) return undefined
  const sel = raw as Record<string, unknown>
  if (typeof sel.provider !== 'string' || sel.provider === '') return undefined
  if (typeof sel.model !== 'string' || sel.model === '') return undefined
  return {
    provider: sel.provider,
    model: sel.model,
    ...(typeof sel.reasoningEffort === 'string' && sel.reasoningEffort !== '' ? { reasoningEffort: sel.reasoningEffort } : {}),
  }
}

/**
 * 模型可用性体检：查 `sessionController.modelCatalog()`。
 *
 * **查不出来时不拦**（返回 `ok:true`）—— 探测失败不等于模型不可用，
 * 真不可用时 `createAgent` / `prompt` 会给出更确切的原因。
 * 只有**明确查到"一个可路由的模型都没有"**才报 `no-model`，那时面板就能直接说
 * "去设置里选个模型"，而不是让用户对着一个永远不回的输入框猜。
 */
export async function checkModelReadiness(ctx: unknown, selected?: { provider?: string }): Promise<BridgeReadiness> {
  const controller = getService(ctx, 'sessionController')
  if (controller === undefined) {
    return {
      ok: false,
      code: 'service-unavailable',
      reason:
        'DSH 会话服务不可用（读不到 ctx.sessionController）：这个角色建不了会话。' +
        '确认插件加载的 profile 里挂了会话服务。',
    }
  }

  const modelCatalog = pluck(controller, 'modelCatalog')
  if (modelCatalog === undefined) return { ok: true }

  let catalog: unknown
  try {
    catalog = await (modelCatalog as unknown as (this: unknown) => Promise<unknown>).call(controller)
  } catch {
    // 目录查询失败（例如 provider 临时不可达）不该冒充"没模型"。
    return { ok: true }
  }

  if (typeof catalog !== 'object' || catalog === null) return { ok: true }
  const record = catalog as Record<string, unknown>

  const routable = Array.isArray(record.routableProviders) ? record.routableProviders : undefined
  const groups = Array.isArray(record.groups) ? record.groups : undefined
  const hasRoutable = routable === undefined || routable.length > 0
  const hasGroups = groups === undefined || groups.length > 0

  // ── 光"有 provider 可路由"不够，还要问"**你选的那个**有没有适配器"（R31 真机踩出来的）──
  //
  // 真宿主上 `agentDefaultModel` 指向 `deepseek-official`，而它那把 key 已失效；
  // 或指向一个这个 profile 没装适配器的 provider（`no adapter registered for provider "…"`）。
  // 两种情况下旧检查都返回 ok，于是**每一轮都要等模型调用失败才知道**，
  // 而且报错来自模型层、看不出是路由问题。现在在搭话前就说清：选的是谁、可用的有哪些。
  const selectedProvider = selected?.provider
  if (selectedProvider !== undefined && selectedProvider !== '' && routable !== undefined && routable.length > 0) {
    if (!routable.some((name) => name === selectedProvider)) {
      return {
        ok: false,
        code: 'no-model',
        reason:
          `模型没配置：当前选的是 \`${selectedProvider}\`，但这个 profile 里没有它的适配器（或没有可用的凭据）。` +
          `可用的 provider：${routable.join('、')}。去 DSH 设置里把默认模型换成一个可用的，再搭话。`,
      }
    }
  }

  if (hasRoutable && hasGroups) return { ok: true }

  const failures = Array.isArray(record.failures) ? record.failures : []
  const detail = failures
    .slice(0, 3)
    .map((failure) => {
      if (typeof failure !== 'object' || failure === null) return String(failure)
      const row = failure as Record<string, unknown>
      const name = typeof row.name === 'string' ? row.name : 'provider'
      const message = typeof row.message === 'string' ? row.message : '未知原因'
      return `${name}：${message}`
    })
    .join('；')

  return {
    ok: false,
    code: 'no-model',
    reason:
      '模型没配置：当前没有一个可路由的模型，角色说不出话。' +
      '去 DSH 设置里选一个模型（或配置 provider 的 API key）之后再搭话。' +
      (detail === '' ? '' : `\nprovider 报的原因：${detail}`),
  }
}

/** `createDshCharacterBridge()` 的入参。 */
export interface DshBridgeOptions {
  /**
   * **必填**：这个角色的 system prompt（人设）。
   *
   * M6-1 里由调用方给一个占位；M6-2 换成从 `rosters` 生成。
   * bridge 与 adapter 都不关心里面写的是谁 —— 红线第 2 条。
   */
  readonly systemPromptFor: (characterId: string) => string
  readonly maxLiveSessions?: number
  readonly sessionIdFor?: (characterId: string) => string
  readonly requestIdPrefix?: string
  readonly onError?: (reason: string) => void
  /** 会话工作目录（绝对路径）。默认 `process.cwd()`——与插件的 contentDir / stateDir 同一基准。 */
  readonly cwdFor?: () => string | undefined
  /** 见 `CharacterBridgeOptions.characterTools`。 */
  readonly characterTools?: readonly string[]
}

/** `createDshCharacterBridge()` 的结果：要么装好了，要么给出装不上的原因。 */
export type DshBridgeResult =
  | { readonly ok: true; readonly bridge: CharacterBridge }
  | {
      readonly ok: false
      /**
       * 失败的种类。**调用方要靠它决定这条消息该多严重**：
       * - `no-agent-loop`：整个 profile 没有 agent 能力（headless）。**这是正常配置**，
       *   所以组合根应当只记 info —— 把它写成 warn 会让正常部署一直有噪音，
       *   而"warn 是常态"就等于没有 warn。
       * - `no-session-service`：有 agentLoop 却拿不到会话服务，是**真的装错了**，值得 warn。
       */
      readonly code: 'no-agent-loop' | 'no-session-service'
      readonly reason: string
    }

/**
 * 一步装好：`agentLoop` + `sessionController` + 事件总线 → {@link CharacterBridge}。
 *
 * 插件卸载 / 世界重开时调 `bridge.disposeAll()` 释放全部会话（GOAL.md 决策 D36 的成本可控）。
 *
 * @param ctx - 插件自己的 cordis `Context`（原样传即可）。
 * @param options - 人设来源与上限。
 */
export function createDshCharacterBridge(ctx: unknown, options: DshBridgeOptions): DshBridgeResult {
  const factory = createAgentFactory(ctx)
  if (factory === undefined) {
    return {
      ok: false,
      code: 'no-agent-loop',
      reason: 'DSH 的 agentLoop 服务不可用（读不到 ctx.agentLoop.createAgent）：这个插件建不了角色会话。',
    }
  }

  const transport = createSessionTransport(ctx)
  if (transport === undefined) {
    return {
      ok: false,
      code: 'no-session-service',
      reason:
        'DSH 的会话服务不可用（读不到 ctx.sessionController.prompt 或 ctx.on）：' +
        '角色会话能建但说不了话，所以没有启用对话。确认 profile 里挂了会话服务。',
    }
  }

  const bridgeOptions = {
    factory,
    transport,
    systemPromptFor: options.systemPromptFor,
    checkReady: () => checkModelReadiness(ctx, readDefaultModelSelection(ctx)),
    agentOptionsFor: () => readDefaultModelSelection(ctx),
    // 角色的工作目录 = 插件的工作区（与 contentDir / stateDir 同一个基准），不是 .agent-world。
    cwdFor: options.cwdFor ?? (() => process.cwd()),
    ...(options.characterTools === undefined ? {} : { characterTools: options.characterTools }),
    ...(options.maxLiveSessions === undefined ? {} : { maxLiveSessions: options.maxLiveSessions }),
    ...(options.sessionIdFor === undefined ? {} : { sessionIdFor: options.sessionIdFor }),
    ...(options.requestIdPrefix === undefined ? {} : { requestIdPrefix: options.requestIdPrefix }),
    ...(options.onError === undefined ? {} : { onError: options.onError }),
  }

  return { ok: true, bridge: createCharacterBridge(bridgeOptions) }
}


/**
 * 给套壳路径用的"队长"会话（R37）。
 *
 * 队长就是一个**普通 DSH 会话**——它自己从不需要发言，只是 `agent_teams_*` 工具
 * 认的那个调用者身份（`tools.js` 的 `requireCaptain`）。所以这里直接复用旧实现那套
 * create/resume 兜底：会话已存在就接回来，接不回来就把原因抛出去。
 *
 * `cwd` 很关键：agent-teams 把团队状态放在 `<cwd>/<stateDir>/<teamId>/`，
 * 而它从 `agent.session.header.cwd` 取（`tools.js` 的 `workspaceOf`）。
 */
export function createTeamsCaptain(
  ctx: unknown,
  options: { readonly cwd: string; readonly onError?: (reason: string) => void },
): ((sessionId: string, cwd: string) => Promise<BridgeAgentHandle>) | undefined {
  const factory = createAgentFactory(ctx)
  if (factory === undefined) return undefined

  return async (sessionId: string, cwd: string): Promise<BridgeAgentHandle> => {
    const agentOptions = readDefaultModelSelection(ctx)
    const setup = (agentCtx: { tools?: unknown }): void => {
      // 队长要用 agent_teams_* 工具，所以**不能**限制它的工具面；
      // 这里什么都不做，只是把"为什么不限制"写清楚，免得下一个人以为漏了。
      void agentCtx
    }
    const base = {
      sessionId,
      cwd,
      setup,
      ...(agentOptions === undefined ? {} : { agentOptions }),
    }
    try {
      return await factory.createAgent(base)
    } catch (error) {
      if (factory.resumeAgent === undefined) throw error
      try {
        return await factory.resumeAgent({ resumeSessionId: sessionId, setup, ...(agentOptions === undefined ? {} : { agentOptions }) })
      } catch (resumeError) {
        throw new Error(
          `队长会话建不起来：${errorText(error)}；接回已有会话也失败：${errorText(resumeError)}`,
        )
      }
    }
  }
}

/** 把任意抛出值变成一句话（这个文件里只有套壳路径用到）。 */
function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
