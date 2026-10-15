/**
 * bridge/ 的对外契约（BACKLOG M6-1）。
 *
 * ## 为什么这里全是"自己写的最小结构"，而不是 `import type` DSH 的类型
 *
 * `dsh-agent-world` 的 `package.json` 里**没有** `@deepseek-ai/dsh-agent-loop` /
 * `dsh-api-session-controller` 这些包（peer 依赖只有 cordis / dsh-tools / schemastery）。
 * 直接 import 它们会让 `tsc` 在别人的机器上失败，也会把插件和 DSH 内部包名绑死。
 *
 * 所以 bridge 只声明它**真正用到的那几个字段**，并保证与 Inspect 查到的契约逐字对齐
 * （见 `docs/BRIDGE-RECON.md`）。这样做的第二个好处是顺手解决了"测试不许真调模型"：
 * 契约是普通的 interface，测试里给一个假实现就能跑完整条链路。
 *
 * ## 与 DSH 真实契约的对应关系
 *
 * | 这里的名字 | DSH 真名 | 来源 |
 * |---|---|---|
 * | {@link BridgeAgent} | `Agent` | `{ readonly id: SessionId }` |
 * | {@link BridgeAgentHandle} | `AgentHandle` | `{ agent, dispose() }` |
 * | {@link BridgeSessionEvent} | `SessionEvent` | `{type,seq,time,data,surfaceOp?}` |
 * | {@link SystemMessageSeedEvent} | `SessionEventMap['system/message']` | `{turn,step,message}` |
 * | {@link BridgePromptPart} | `PromptContentPart` | 只用 `{type:'text',text}` 分支 |
 * | {@link BridgePromptRequest} | `SessionPromptRequest` | `{requestId,sessionId,mode,content}` |
 */

/** DSH 侧 Agent 的最小结构。**注意它只有 `id`，没有 prompt/send 方法**（BRIDGE-RECON §2.3）。 */
export interface BridgeAgent {
  readonly id: string
}

/** `agentLoop.createAgent()` / `agents.create()` 的返回值。 */
export interface BridgeAgentHandle {
  readonly agent: BridgeAgent
  dispose(): Promise<void>
}

/**
 * 一条 `SessionEvent` 里 bridge 关心的字段。
 *
 * 故意把 `data` / `surfaceOp` 留成 `unknown`：它们由解码器收窄
 * （见 `decodeBridgeEvent`），而不是靠类型断言骗过编译器。
 */
export interface BridgeSessionEvent {
  readonly type: string
  readonly seq: number
  readonly time: number
  readonly data?: unknown
  readonly surfaceOp?: unknown
  readonly sourceEventSeqs?: unknown
  readonly ignorable?: true
}

/** `agentOptions` 里 bridge 透传的部分。 */
export interface BridgeAgentOptions {
  readonly provider?: string
  readonly model?: string
  readonly reasoningEffort?: string
  readonly maxTokens?: number
}

/**
 * `seed` 里的那条 `system/message` —— **人设就是从这里进去的**（GOAL.md 决策 D37）。
 *
 * **注意**：这个类型的字面量里没有任何角色名或台词。`text` 由调用方从内容库
 * （`rosters`）取，M6-2 才接上；bridge 只负责把它塞成一条合法的 seed 事件。
 */
export interface SystemMessageSeedEvent {
  readonly type: 'system/message'
  readonly seq: number
  readonly time: number
  readonly data: {
    readonly turn: number
    readonly step: number
    readonly message: {
      readonly role: 'system'
      readonly source: { readonly kind: 'system-prompt' }
      readonly content: readonly { readonly type: 'text'; readonly text: string }[]
      /**
       * **必填**（R30 真宿主验证）：`dsh-session` 的 `assertMessageEventShape` 要求
       * `typeof message.id === "string" && message.id !== ""`，否则整条 seed 被拒：
       * `seed system/message at index 0 lacks an identified message`。
       * 这正是 BRIDGE-RECON §6 的 U1，答案是"强制"。
       */
      readonly id: string
    }
  }
  readonly surfaceOp: 'append'
}

/**
 * seed 里包住人设消息的**框事件**（R30 真宿主验证）。
 *
 * `dsh-session` 的不变量要求 `system/message` 落在一个**已打开的** turn/step 里
 * （`requireOpenStep`），turn/step 编号从 1 起，seq 严格递增；而 seed 结束后 agent
 * 会自己 `turn/start` 下一轮，所以**这个框必须自己关上**，否则下一轮会撞上
 * "turn/start while turn 1 is still open"。
 */
export type SeedFrameEvent =
  | { readonly type: 'turn/start'; readonly seq: number; readonly time: number; readonly data: { readonly turn: number } }
  | { readonly type: 'step/start'; readonly seq: number; readonly time: number; readonly data: { readonly turn: number; readonly step: number } }
  | { readonly type: 'step/end'; readonly seq: number; readonly time: number; readonly data: { readonly turn: number; readonly step: number } }
  | {
      readonly type: 'turn/end'
      readonly seq: number
      readonly time: number
      readonly data: { readonly turn: number; readonly reason: { readonly kind: 'completed' } }
    }

/** seed 里的任何一条事件。M6-6 要放"上一局对话"回放时在这里扩。 */
export type BridgeSeedEvent = SystemMessageSeedEvent | SeedFrameEvent

/** `CreateAgentOptions` 里 bridge 用到的部分。 */
export interface BridgeCreateAgentOptions {
  readonly sessionId: string
  readonly seed?: readonly BridgeSeedEvent[]
  readonly agentOptions?: BridgeAgentOptions
  /**
   * 会话的工作目录（**必须是绝对路径**，宿主会校验）。
   *
   * R30 真宿主验证：不给它，这个 profile 的 persona 模板 `Your working directory is {{cwd}}`
   * 就没有值，整轮报 `prompt variable "{{cwd}}" has no value`。
   *
   * ⚠️ **不能填插件的存档目录**：角色以后要用工具干活（读代码、改文件），
   * 它的工作目录应该是**用户的工作区**，而不是我们自己的 `.agent-world`。
   */
  readonly cwd?: string
  readonly signal?: AbortSignal
}

/**
 * **可注入的 Agent 工厂** —— 这条注入是"测试不许真调模型"的实现方式。
 *
 * 生产环境：`createAgentFactory(ctx)`（见 `dsh-adapter.ts`）包住 `ctx.agentLoop.createAgent`。
 * 测试环境：一个计数器 + 假 handle，永远不会碰模型。
 */
export interface AgentFactory {
  createAgent(options: BridgeCreateAgentOptions): Promise<BridgeAgentHandle>
  /**
   * 从**已有的持久化会话**恢复一个 agent（可选，缺了就不做 resume 兜底）。
   *
   * R30 真宿主验证：`sessionPersistence` 一旦挂上，上次运行建过的会话会落盘，
   * 这次再用同一个 sessionId 建就会抛 `session "…" already exists`。
   * 正确反应不是换一个新 id（那会丢掉这个角色说过的话），而是**接回原来那条会话**。
   */
  resumeAgent?(options: BridgeResumeAgentOptions): Promise<BridgeAgentHandle>
}

/** `resume` 用到的部分（与 `CreateAgentOptions.resumeSessionId` 对应）。 */
export interface BridgeResumeAgentOptions {
  readonly resumeSessionId: string
  readonly agentOptions?: BridgeAgentOptions
  readonly signal?: AbortSignal
}

/** `PromptContentPart` 的 text 分支（BRIDGE-RECON §3.3）。 */
export interface BridgePromptPart {
  readonly type: 'text'
  readonly text: string
}

/**
 * `SessionPromptRequest`。
 *
 * `mode`：`'queue'` = 排队到下一个 turn（对话语义，默认用这个）；
 * `'steer'` = 插进当前 step（"打断他正在做的事"才用）。
 */
export interface BridgePromptRequest {
  readonly requestId: string
  readonly sessionId: string
  readonly mode: 'queue' | 'steer'
  readonly content: readonly BridgePromptPart[]
  readonly clientTimeZone?: string
}

/**
 * **可注入的会话传输层** —— 对应 DSH 的两件事：
 * 发话 = `ctx.sessionController.prompt()`；收话 = `ctx.on('session/event', ...)`。
 *
 * 把两者绑在一个接口里，是因为它们在真实实现里也总是一起用
 * （发了话不收回复 = 角色自言自语），而分开注入会让测试的假对象多一份样板。
 */
export interface SessionTransport {
  /** 对应 `sessionController.prompt(request, signal)`；成功返回 `{accepted:true}`。 */
  prompt(request: BridgePromptRequest, signal: AbortSignal): Promise<unknown>
  /** 对应 `ctx.on('session/event', (session, event) => ...)`；返回取消订阅函数。 */
  subscribe(listener: (sessionId: string, event: BridgeSessionEvent) => void): () => void
}

/** 开火前的可用性体检结论。 */
export type BridgeReadiness =
  | { readonly ok: true }
  | { readonly ok: false; readonly code: BridgeFailureCode; readonly reason: string }

/**
 * 绑定失败的原因码。
 *
 * 每一个都必须能翻译成**用户能直接下手**的一句话（GOAL.md 红线第 6 条：
 * "失败要退化，不要卡住"）——所以宁可多一个码，也不要合并成一句"出错了"。
 */
export type BridgeFailureCode =
  /** 没有 `ctx.sessionController`（宿主没挂会话服务）。 */
  | 'service-unavailable'
  /** 没有可用的模型（设置里没选模型 / 没配 key）。 */
  | 'no-model'
  /** 同时唤醒的角色已达上限（D36 成本上限）。 */
  | 'capacity'
  /** `createAgent()` 抛了。 */
  | 'create-failed'
  /** 投递消息失败（`RemoteError.code` 会带在 reason 里）。 */
  | 'prompt-failed'
  /** 空消息或纯空白。 */
  | 'empty-input'
  /** 角色已被释放。 */
  | 'released'
  /** 插件已卸载 / 世界已重开，bridge 不再工作。 */
  | 'disposed'
  /** 等回复等超时了。 */
  | 'timeout'

/** `wake()` 的结果。 */
export type WakeResult =
  | {
      readonly ok: true
      readonly characterId: string
      readonly sessionId: string
      /** `true` = 这一下真的建了会话；`false` = 复用了已有的。 */
      readonly created: boolean
      readonly liveCount: number
    }
  | { readonly ok: false; readonly characterId: string; readonly code: BridgeFailureCode; readonly reason: string }

/** `say()` 的结果。 */
export type SayResult =
  | {
      readonly ok: true
      readonly characterId: string
      readonly sessionId: string
      readonly requestId: string
      /** 这一句是复用会话说的还是刚唤醒时说的（面板可以用它提示"首次唤醒这位角色"）。 */
      readonly created: boolean
    }
  | { readonly ok: false; readonly characterId: string; readonly code: BridgeFailureCode; readonly reason: string }

/** 从 `assistant/message` 解出来的一条回复。 */
export interface BridgeReply {
  readonly characterId: string
  readonly sessionId: string
  readonly text: string
  readonly turn: number
  readonly step: number
  /** `assistant/message` 上的 `interrupted: true` —— 被打断的半句话。 */
  readonly interrupted: boolean
}

/** 一轮的结束（`turn/end`）。 */
export interface BridgeTurnEnd {
  readonly characterId: string
  readonly sessionId: string
  readonly turn: number
  /** `TurnEndReason.kind`：completed / aborted / blocked / error / max-tokens / interrupted / forked。 */
  readonly kind: string
  /** `kind === 'error'` 时的 `LlmFailure.message`；别的 kind 下是 `undefined`。 */
  readonly errorMessage: string | undefined
}

/** 等一条回复的结果。 */
export type WaitReplyResult =
  | { readonly ok: true; readonly reply: BridgeReply }
  | { readonly ok: false; readonly code: BridgeFailureCode; readonly reason: string }

/** 释放一个角色时的结果。 */
export interface ReleaseResult {
  readonly characterId: string
  readonly sessionId: string
  readonly closed: boolean
  /** `dispose()` 抛了的时候带原因；成功时 `undefined`。 */
  readonly error: string | undefined
}

/** `disposeAll()` 的汇总。 */
export interface DisposeAllResult {
  readonly disposed: number
  readonly failures: readonly ReleaseResult[]
}

/**
 * 生成 system prompt 需要的**座位形状** —— `RosterSeat`（内容层）的结构子集。
 *
 * 为什么在这里另声明一份而 import 内容层的类型：`bridge` 的边界规则里没有 `content`
 * （见 `src/protocol/boundaries.ts`）。这与 `DialoguePort` 那处的取舍同源——
 * 各层只声明自己真正用到的那几个字段，而 `RosterSeat` 恰好满足这个形状。
 *
 * **注意 `role` 的用途只有一个**：在 prompt 里如实报出他的岗位。
 * **绝不能拿 `role` 反查座位**——一个花名册里有多个同 role 的座位，
 * 那样会让他们共用一份人设（不报错，只是"说话一模一样"）。
 */
export interface PersonaSeat {
  readonly name: string
  readonly role: string
  /** 这个人是谁（身份/性格/在意什么/怕什么）。**来自内容**（D37）。 */
  readonly persona: string
  /** 他怎么说话（语气/句长/口头禅/不说什么）。**来自内容**（D37）。 */
  readonly speechStyle: string
}

/**
 * 拼 prompt 用的**世界事实**。
 *
 * 这里刻意只有事实（名字、时钟、状态、站点、工单），**没有一个句子**——
 * 措辞在 `persona-prompt.ts` 的模板里，所以"给模型的上下文"不会变成藏起来的台词。
 */
export interface WorldContextFacts {
  readonly worldName: string
  readonly tick: number
  /** `AgentState` 的值（`idle` / `working` / …）。 */
  readonly state: string
  /** 所在站点的**名字**（解析不出来时可以是 id；null 表示不在站点上）。 */
  readonly stationName: string | null
  /** 手上的工单标题；空手时为 null。 */
  readonly taskTitle: string | null
  /** 正在前往的站点名；不在路上时为 null。 */
  readonly walkingTo: string | null
}

/** `say()` 的可选项。 */
export interface SayOptions {
  /** 默认 `'queue'`（排队到下一个 turn）。用 `'steer'` 才是"插进他正在做的事"。 */
  readonly mode?: 'queue' | 'steer'
  readonly signal?: AbortSignal
  /**
   * 覆盖 requestId。**requestId 是幂等键**（BRIDGE-RECON §3.2 事实 1）：
   * 面板断线重发时带上同一个 requestId，角色不会把同一句说两遍。
   */
  readonly requestId?: string
}

/** `waitForReply()` 的可选项。 */
export interface WaitForReplyOptions {
  /** 默认 60s。`0` = 不超时（测试里用）。 */
  readonly timeoutMs?: number
  readonly signal?: AbortSignal
}

/**
 * 建 bridge 的参数。
 *
 * 除了 `factory` 与 `systemPromptFor`，其余全部可选 —— 这样生产装配代码短，
 * 测试也能只给必需项就构造出一个完全确定的 bridge。
 */
export interface CharacterBridgeOptions {
  /** **必填**：建会话的工厂。测试里给假的，就不会真的调模型。 */
  readonly factory: AgentFactory
  /** 发话 / 收话的通道；缺失时 `wake()` 直接给 `service-unavailable`。 */
  readonly transport?: SessionTransport
  /**
   * **必填**：这个角色的 system prompt（人设）。
   *
   * 由调用方从内容库（`rosters`）生成 —— **bridge 里没有任何角色名或台词**（红线第 2 条）。
   */
  readonly systemPromptFor: (characterId: string) => string
  /** 同时唤醒的角色上限，默认 {@link DEFAULT_MAX_LIVE_SESSIONS}。 */
  readonly maxLiveSessions?: number
  /**
   * 开火前的可用性体检（生产环境查 `sessionController.modelCatalog()`）。
   * 返回 `no-model` 时就是那句"模型没配置"。可以是异步的——模型目录是异步查的。
   */
  readonly checkReady?: () => BridgeReadiness | Promise<BridgeReadiness>
  /** 角色 id → 会话 id。默认 `agent-world:<characterId>`。 */
  readonly sessionIdFor?: (characterId: string) => string
  /** 透传给 `createAgent` 的模型选择。 */
  readonly agentOptions?: BridgeAgentOptions
  /**
   * **建会话那一刻**才读的模型选择（优先于 `agentOptions`）。
   *
   * R30 真宿主验证：不给模型，agent 组 system prompt 时 `{{model}}` 没有值，
   * 整轮报 `prompt variable "{{model}}" has no value for this assembly`。
   * 做成函数而不是常量，是为了**用户在 DSH 设置里改了默认模型，下一个被唤醒的角色就用新的**。
   * 返回 `undefined` 表示读不到，此时退回 `agentOptions`。
   */
  readonly agentOptionsFor?: () => BridgeAgentOptions | undefined
  /**
   * 会话工作目录（绝对路径）。默认 `process.cwd()` —— 插件的其它相对路径
   * （内容目录、存档目录）也是以它为基准的，所以角色与插件看的是同一个工作区。
   */
  readonly cwdFor?: () => string | undefined
  /** 时间源。默认 `Date.now`；测试传固定值以保证可复现。 */
  readonly now?: () => number
  /** requestId 前缀，默认 `agent-world-say`。 */
  readonly requestIdPrefix?: string
  /** 监听器抛错时的旁路日志（默认静默 —— 一个坏监听器不该打断整条对话）。 */
  readonly onError?: (reason: string) => void
}

/** 角色 ↔ 会话绑定管理器。 */
export interface CharacterBridge {
  /** 懒创建：第一次调用才建会话，之后复用。并发的两次调用只会建一个。 */
  wake(characterId: string): Promise<WakeResult>
  /** 给角色说一句话（内部先 `wake`）。返回的是"投递被接受"，不是回复本身。 */
  say(characterId: string, text: string, options?: SayOptions): Promise<SayResult>
  /** 等这个角色的下一条 `assistant/message`。 */
  waitForReply(characterId: string, options?: WaitForReplyOptions): Promise<WaitReplyResult>
  /** 订阅所有角色的回复；返回取消订阅。 */
  onReply(listener: (reply: BridgeReply) => void): () => void
  /** 订阅所有角色的 `turn/end`（做"思考中"指示与错误提示用）。 */
  onTurnEnd(listener: (turnEnd: BridgeTurnEnd) => void): () => void
  /** 已经唤醒的角色查会话；没醒时 `undefined`（**不会**顺手创建）。 */
  sessionFor(characterId: string): { readonly characterId: string; readonly sessionId: string } | undefined
  /** 当前活着的会话数 —— 面板"已唤醒角色数"的数据源（红线第 5 条：成本可见）。 */
  liveCount(): number
  liveCharacters(): readonly string[]
  /** 让一个角色下线（不传参就是没醒，返回 `undefined`）。 */
  release(characterId: string): Promise<ReleaseResult | undefined>
  /** 释放全部。插件卸载 / 世界重开时调；之后 bridge 不再工作。 */
  disposeAll(): Promise<DisposeAllResult>
  isDisposed(): boolean
}
