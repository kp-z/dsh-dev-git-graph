/**
 * 角色 ↔ DSH 会话的绑定（BACKLOG M6-1，GOAL.md 决策 D36）。
 *
 * ## 这个模块负责的四件事
 *
 * 1. **懒创建**：第一次搭话才 `createAgent()`；之后**同一角色复用同一会话**。
 * 2. **上限**：同时唤醒的角色数有上限，超了给**能直接下手**的原因（不是静默失败）。
 * 3. **释放**：`release()` 单个、`disposeAll()` 全部（插件卸载 / 世界重开时调）。
 * 4. **人设**：用 `seed` 注入一条 `system/message`，文本由 `systemPromptFor` 提供
 *    （内容来自 `rosters`，**代码里没有人设**——红线第 2 条）。
 *
 * ## 依赖全部可注入，所以测试里不会真的调模型
 *
 * `factory`（建会话）与 `transport`（发话 / 收话）都是接口。生产实现见 `dsh-adapter.ts`；
 * 测试给一个计数器 + 假 handle 就能把整条链路跑完，一次模型调用都不会发生。
 *
 * ## 不确定性留在这里
 *
 * `src/sim/`、`src/domain/`、`src/content/` 里不许有 `Date.now()`/`Math.random()`
 * （红线第 4 条）。bridge 是宿主侧、非确定性边界之外，**允许**：所以本文件用 `now`
 * （默认 `Date.now`）给 seed 打时间戳。但仍然把 `now` 做成可注入的——
 * 测试里时间必须是确定的，否则"同一角色两次搭话只建一次会话"这类断言难以复现。
 */
import { decodeBridgeEvent } from './decode.js'

import type {
  AgentFactory,
  BridgeAgentOptions,
  BridgeFailureCode,
  BridgeReadiness,
  BridgeReply,
  BridgeTurnEnd,
  CharacterBridge,
  CharacterBridgeOptions,
  DisposeAllResult,
  ReleaseResult,
  SayOptions,
  SayResult,
  SessionTransport,
  WaitForReplyOptions,
  WaitReplyResult,
  WakeResult,
} from './types.js'

export type {
  CharacterBridge,
  CharacterBridgeOptions,
  DisposeAllResult,
  ReleaseResult,
  SayOptions,
  SayResult,
  WaitForReplyOptions,
  WaitReplyResult,
  WakeResult,
} from './types.js'

/** 上限的兜底值。数量级与 `config.maxAgents` 一致，但语义是"同时醒着的会话数"。 */
export const DEFAULT_MAX_LIVE_SESSIONS = 4

/** 等回复的默认超时。够慢模型说一句话，又不至于让面板一直转圈。 */
export const DEFAULT_REPLY_TIMEOUT_MS = 60_000

/** 一个角色的活动会话。 */
interface LiveSession {
  readonly characterId: string
  readonly sessionId: string
  readonly handle: { dispose(): Promise<void> }
  readonly createdAt: number
}

/** 等回复的挂起者。字段可变 —— 超时 / 取消要能就地拆掉。 */
interface ReplyWaiter {
  readonly characterId: string
  readonly resolve: (result: WaitReplyResult) => void
  timer: ReturnType<typeof setTimeout> | undefined
  onAbort: (() => void) | undefined
  readonly signal: AbortSignal | undefined
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** 从 `RemoteError` 上取 `code`（BRIDGE-RECON §2.1：`session/not-found` 等）。 */
function codeOf(error: unknown): string | undefined {
  if (typeof error === 'object' && error !== null) {
    const code = (error as { code?: unknown }).code
    if (typeof code === 'string') return code
  }
  return undefined
}

/** 一个只会失败的通用结果 —— `wake`/`say` 的失败分支形状相同，故共用。 */
type Failure = { readonly ok: false; readonly characterId: string; readonly code: BridgeFailureCode; readonly reason: string }

/**
 * 建一个角色 ↔ 会话的绑定管理器。
 *
 * @param options - 见 {@link CharacterBridgeOptions}；`factory` 与 `systemPromptFor` 必填。
 */
/**
 * 人设 section 的名字。
 *
 * **刻意与第三方预设人格同名**：`systemPrompt.section()` 的契约是
 * "作用域内的同名 section 覆盖全局的"，而我们要顶掉的正是别人用这个名字注册的人格
 * （实测：`@sunjuntao/dsh-prompt-library` 用 `deployment:persona`）。
 * 换一个名字不会覆盖，只会让两套人格同时出现在 prompt 里——那正是 R33 之前的表现。
 */
const PERSONA_SECTION_NAME = 'deployment:persona'

export function createCharacterBridge(options: CharacterBridgeOptions): CharacterBridge {
  const factory: AgentFactory = options.factory
  const transport: SessionTransport | undefined = options.transport
  const maxLiveSessions = options.maxLiveSessions ?? DEFAULT_MAX_LIVE_SESSIONS
  const now = options.now ?? (() => Date.now())
  const requestIdPrefix = options.requestIdPrefix ?? 'agent-world-say'
  const sessionIdFor = options.sessionIdFor ?? ((characterId: string) => `agent-world:${characterId}`)

  /** 已唤醒的角色。**这是"同一角色复用同一会话"的唯一真相来源。** */
  const sessions = new Map<string, LiveSession>()
  /** sessionId → characterId，用于把事件反查回角色。 */
  const bySessionId = new Map<string, string>()
  /** 正在创建中的角色：并发搭话时**共用同一个 Promise**，不会建出两个会话。 */
  const inflight = new Map<string, Promise<WakeResult>>()

  const replyListeners = new Set<(reply: BridgeReply) => void>()
  const turnEndListeners = new Set<(turnEnd: BridgeTurnEnd) => void>()
  const waiters = new Set<ReplyWaiter>()

  let unsubscribe: (() => void) | undefined
  let requestSeq = 0
  let disposed = false

  function fail(characterId: string, code: BridgeFailureCode, reason: string): Failure {
    return { ok: false, characterId, code, reason }
  }

  /** 体检：没有传输层 / 模型没配置时**在建会话之前**就退化，省下一次注定失败的开销。 */
  async function readiness(): Promise<BridgeReadiness> {
    if (transport === undefined) {
      return {
        ok: false,
        code: 'service-unavailable',
        reason:
          'DSH 会话服务不可用（读不到 ctx.sessionController）：这个角色建不了会话。' +
          '确认插件加载的 profile 里挂了会话服务。',
      }
    }
    if (options.checkReady === undefined) return { ok: true }
    return options.checkReady()
  }

  function settleWaiter(waiter: ReplyWaiter, result: WaitReplyResult): void {
    waiters.delete(waiter)
    if (waiter.timer !== undefined) clearTimeout(waiter.timer)
    if (waiter.onAbort !== undefined && waiter.signal !== undefined) {
      waiter.signal.removeEventListener('abort', waiter.onAbort)
    }
    waiter.resolve(result)
  }

  /** 懒订阅：**第一次真的建起会话时**才挂上事件总线，没人搭话就不占监听位。 */
  function ensureSubscribed(): void {
    if (unsubscribe !== undefined || transport === undefined) return
    unsubscribe = transport.subscribe((sessionId, event) => {
      const characterId = bySessionId.get(sessionId)
      if (characterId === undefined) return

      const decoded = decodeBridgeEvent(sessionId, event)
      if (decoded === undefined) return

      if (decoded.kind === 'reply') {
        const reply: BridgeReply = { characterId, ...decoded.reply }
        for (const listener of [...replyListeners]) {
          try {
            listener(reply)
          } catch (error) {
            options.onError?.(`回复监听器抛了（已忽略，不影响其它监听器）：${messageOf(error)}`)
          }
        }
        for (const waiter of [...waiters]) {
          if (waiter.characterId !== characterId) continue
          settleWaiter(waiter, { ok: true, reply })
        }
        return
      }

      const turnEnd: BridgeTurnEnd = { characterId, ...decoded.turnEnd }
      for (const listener of [...turnEndListeners]) {
        try {
          listener(turnEnd)
        } catch (error) {
          options.onError?.(`turn/end 监听器抛了（已忽略）：${messageOf(error)}`)
        }
      }
      // `error` 结束的轮次不会再有 assistant/message —— 等回复的人不能一直挂着。
      if (decoded.turnEnd.kind === 'error') {
        const reason =
          `这一轮模型报错（${decoded.turnEnd.errorMessage ?? '没有给错误详情'}）：` +
          '角色会保持原来的行为，检查模型配置或稍后重试。'
        for (const waiter of [...waiters]) {
          if (waiter.characterId !== characterId) continue
          settleWaiter(waiter, { ok: false, code: 'prompt-failed', reason })
        }
      }
    })
  }

  async function createSession(characterId: string, signal: AbortSignal | undefined): Promise<WakeResult> {
    const ready = await readiness()
    // readiness 可能是异步的（模型目录要查远端），这中间插件可能已经被卸载 ——
    // 那就不要再建了一个马上又要扔的会话（卸载路径上每一毫秒都还可能有人搭话）。
    if (disposed) {
      return fail(characterId, 'disposed', '插件已卸载或世界已重开：这个角色没有被唤醒。')
    }
    if (!ready.ok) return fail(characterId, ready.code, ready.reason)

    if (sessions.size >= maxLiveSessions) {
      return fail(
        characterId,
        'capacity',
        `同时唤醒的角色已达上限（${maxLiveSessions}）：先用 release() 让某个角色下线，` +
          '或调大插件的 maxLiveSessions。这个角色没有被唤醒，他保持原来的行为。',
      )
    }

    const sessionId = sessionIdFor(characterId)

    // 人设文本**必须来自调用方**（内容库）；这里不拼任何字面量。空文本会在这里抛，
    // 统一按 create-failed 报出去 —— 让"花名册缺字段"这件事有一个可下手的原因。
    let personaText: string
    try {
      personaText = options.systemPromptFor(characterId)
      if (typeof personaText !== 'string' || personaText.trim() === '') {
        throw new Error('人设文本是空的：system prompt 不能为空（内容库的 rosters 条目可能缺字段）')
      }
    } catch (error) {
      return fail(characterId, 'create-failed', `人设生成失败：${messageOf(error)}`)
    }

    // ── 人设挂在哪：**agent 自己的 system prompt section**，不是 seed（R33 真机纠正）──
    //
    // 见 `types.ts` 的 `BridgeSectionRegistrar`：seed 里的 system 消息会被 agent loop
    // 每轮重新组装的 system prompt 覆盖（真机上表现为角色自称"词库助手"——那是 profile 里
    // 第三方预设的人格）。改成在 agent 自己的作用域里注册同名 section 去**覆盖**它。
    const setup = (agentCtx: { systemPrompt?: unknown; tools?: unknown }): void => {
      const registrar = agentCtx?.systemPrompt as
        | { section?: (input: { name: string; order: number; text: string }) => unknown; getSectionOrder?: (n: string) => number | undefined }
        | undefined
      if (registrar === undefined || typeof registrar.section !== 'function') {
        // 没有 systemPrompt 服务时**不静默**：人设没挂上意味着角色会说别人的话，
        // 这是那种"看起来能跑、但完全不对"的失败，必须让上层看得见。
        options.onError?.(`会话没有 systemPrompt 服务，${characterId} 的人设挂不上（他会说成预设人格）`)
        return
      }
      // 用**同名 section** 覆盖第三方预设的人格；顺序取内置的 persona 段序（缺失则用 0，
      // 与 `dsh-system-prompt` 的 DEPLOYMENT_PERSONA_PREFIX 一致）。
      const order = registrar.getSectionOrder?.('DEPLOYMENT_PERSONA_PREFIX') ?? 0
      registrar.section({ name: PERSONA_SECTION_NAME, order, text: personaText })
      restrictTools(agentCtx)
    }

    // ── 工具：角色**只许**动世界（R34，D35 由注册表强制）──────────────────────
    //
    // 与人设 section 同一个思路：只在**这个 agent 自己的作用域**里生效，不碰用户其它会话。
    // allow 列表先用 `get` 过滤——`restrict` 遇到未知名字会抛，而某个工具在这个 profile 里
    // 没注册（比如没装世界工具的部署）不该让整个角色建不起来。
    const restrictTools = (agentCtx: { tools?: unknown }): void => {
      const wanted = options.characterTools
      if (wanted === undefined) return
      const scope = agentCtx?.tools as
        | { restrict?: (f: { allow: readonly string[] }) => unknown; get?: (n: string) => unknown }
        | undefined
      if (scope === undefined || typeof scope.restrict !== 'function') {
        // 拿不到工具注册表就**说出来**：没限制住意味着角色握着 bash/写文件，必须让上层看见。
        options.onError?.(`会话没有 tools 服务，${characterId} 的工具没能限制（他可能拿得到 bash 等全部工具）`)
        return
      }
      const allow = typeof scope.get === 'function' ? wanted.filter((n) => scope.get!(n) !== undefined) : [...wanted]
      if (allow.length === 0) {
        // 一个都看不见时**不能**传空 allow（契约：空过滤器会抛）。改为全部拒绝的语义只能靠 deny，
        // 而 deny 也要已知名字——所以这里退化为"不限制 + 报出来"，而不是静默放行。
        options.onError?.(`${characterId} 的世界工具在这个 profile 里一个都没注册，工具未限制`)
        return
      }
      scope.restrict({ allow })
    }

    // 实时读取优先（用户改了默认模型，下一个被唤醒的角色就用新的），读不到再用静态配置。
    let agentOptions: BridgeAgentOptions | undefined = options.agentOptions
    if (options.agentOptionsFor !== undefined) {
      try {
        agentOptions = options.agentOptionsFor() ?? agentOptions
      } catch (error) {
        // 读模型选择失败不该让唤醒直接崩：退回静态配置，并让原因可见。
        options.onError?.(`读取默认模型失败，退回静态配置：${messageOf(error)}`)
      }
    }
    // 工作目录：宿主会校验**必须是绝对路径**，所以相对路径一律不带（宁可让宿主报缺 {{cwd}}，
    // 也不要传一个非法值把整轮对话打死）。
    let cwd: string | undefined
    try {
      const candidate = options.cwdFor?.()
      if (typeof candidate === 'string' && candidate.startsWith('/')) cwd = candidate
    } catch (error) {
      options.onError?.(`读取工作目录失败（已忽略）：${messageOf(error)}`)
    }

    const createOptions = {
      sessionId,
      // **不再传 seed**：人设改走 `setup` 里的 section（见上面的长注释）。
      // seed 的形状（消息 id、turn/step 框）是 R30 为"把人设塞进会话"付的学费，
      // 现在那条路已经不用了 —— 留着它只会让"人设到底在哪"变成两个答案。
      setup,
      ...(agentOptions === undefined ? {} : { agentOptions }),
      ...(cwd === undefined ? {} : { cwd }),
      ...(signal === undefined ? {} : { signal }),
    }

    let handle: { readonly agent: { readonly id: string }; dispose(): Promise<void> }
    let resumed = false
    try {
      handle = await factory.createAgent(createOptions)
    } catch (error) {
      // ── "这个会话已经存在" 是**正常路径**，不是错误（R30 真宿主验证）──────────
      //
      // 挂上 `sessionPersistence` 之后，上次运行建过的会话会落盘，这次用同一个 id
      // 再建就会抛 `session "agent-world:agent-1" already exists`。
      //
      // **正确反应是接回那条会话，而不是换一个新 id**：换 id 会让这个角色忘掉
      // 上一次跟他说过的话——而"昨天跟阿金交代过的事他记得"正是这个产品要的东西。
      // 所以：能 resume 就 resume；不能（宿主没有持久化后端）才报原因。
      if (factory.resumeAgent !== undefined) {
        try {
          handle = await factory.resumeAgent({
            resumeSessionId: sessionId,
            // 接回已有会话时**同样**要挂人设 section：会话是从磁盘恢复的，
            // 而 section 是进程内的注册，不挂就没人设（角色会说成预设人格）。
            setup,
            ...(agentOptions === undefined ? {} : { agentOptions }),
            ...(signal === undefined ? {} : { signal }),
          })
          resumed = true
        } catch (resumeError) {
          return fail(
            characterId,
            'create-failed',
            `会话创建失败：${messageOf(error)}；接回已有会话也失败：${messageOf(resumeError)}`,
          )
        }
      } else {
        return fail(characterId, 'create-failed', `会话创建失败：${messageOf(error)}`)
      }
    }

    // createAgent 期间 bridge 可能已被 dispose（插件卸载）；那样必须立刻清掉刚建的会话，
    // 否则它就是一个没人再能关掉的泄漏。
    if (disposed) {
      try {
        await handle.dispose()
      } catch (error) {
        options.onError?.(`释放刚建的会话时出错（已忽略）：${messageOf(error)}`)
      }
      return fail(characterId, 'disposed', '插件已卸载或世界已重开：刚建的会话已被立即释放。')
    }

    sessions.set(characterId, { characterId, sessionId, handle, createdAt: now() })
    bySessionId.set(sessionId, characterId)
    ensureSubscribed()
    // `created: false` 表示这次是**接回**已有会话（角色记得上次说过的话）。
    return { ok: true, characterId, sessionId, created: !resumed, liveCount: sessions.size }
  }

  async function wake(characterId: string): Promise<WakeResult> {
    if (disposed) {
      return fail(characterId, 'disposed', '插件已卸载或世界已重开：所有角色会话都已释放，需要重新加载插件。')
    }
    if (typeof characterId !== 'string' || characterId === '') {
      return fail(String(characterId), 'create-failed', '角色 id 是空的：面板传来的角色标识不合法。')
    }

    const existing = sessions.get(characterId)
    if (existing !== undefined) {
      return { ok: true, characterId, sessionId: existing.sessionId, created: false, liveCount: sessions.size }
    }

    // 并发去重：同一个角色的两次搭话同时到达时，**共用同一个创建过程**。
    const pending = inflight.get(characterId)
    if (pending !== undefined) return pending

    const creating = createSession(characterId, undefined)
    inflight.set(characterId, creating)
    try {
      return await creating
    } finally {
      inflight.delete(characterId)
    }
  }

  async function say(characterId: string, text: string, sayOptions: SayOptions = {}): Promise<SayResult> {
    // 空消息先挡掉：DSH 的 prompt 也会拒（`gateway/bad-request`），但那个原因对用户不友好。
    if (typeof text !== 'string' || text.trim() === '') {
      return fail(characterId, 'empty-input', '消息是空的（或只有空白）：先打点字再发。')
    }

    const woken = await wake(characterId)
    if (!woken.ok) return woken

    // 传输层一定在：`wake` 的 readiness 已经查过它。这里再取一次纯粹是为了收窄类型。
    const channel = transport
    if (channel === undefined) {
      return fail(characterId, 'service-unavailable', 'DSH 会话服务不可用：这条消息没有投递出去。')
    }

    requestSeq += 1
    const requestId = sayOptions.requestId ?? `${requestIdPrefix}:${characterId}:${requestSeq}`

    try {
      await channel.prompt(
        {
          requestId,
          sessionId: woken.sessionId,
          mode: sayOptions.mode ?? 'queue',
          content: [{ type: 'text', text }],
        },
        sayOptions.signal ?? new AbortController().signal,
      )
    } catch (error) {
      const code = codeOf(error)
      return fail(
        characterId,
        'prompt-failed',
        `消息投递失败${code === undefined ? '' : `（${code}）`}：${messageOf(error)}`,
      )
    }

    return { ok: true, characterId, sessionId: woken.sessionId, requestId, created: woken.created }
  }

  function waitForReply(characterId: string, waitOptions: WaitForReplyOptions = {}): Promise<WaitReplyResult> {
    if (disposed) {
      return Promise.resolve({ ok: false, code: 'disposed', reason: '插件已卸载或世界已重开：不会再收到回复。' })
    }

    const timeoutMs = waitOptions.timeoutMs ?? DEFAULT_REPLY_TIMEOUT_MS
    const signal = waitOptions.signal

    return new Promise<WaitReplyResult>((resolve) => {
      const waiter: ReplyWaiter = { characterId, resolve, timer: undefined, onAbort: undefined, signal }

      if (timeoutMs > 0) {
        waiter.timer = setTimeout(() => {
          settleWaiter(waiter, {
            ok: false,
            code: 'timeout',
            reason: `等了 ${timeoutMs}ms 还没等到回复：模型可能很慢或没有响应，角色保持原来的行为。`,
          })
        }, timeoutMs)
      }

      if (signal !== undefined) {
        waiter.onAbort = () => {
          settleWaiter(waiter, { ok: false, code: 'timeout', reason: '等待被取消（调用方放弃了这条消息）。' })
        }
        signal.addEventListener('abort', waiter.onAbort, { once: true })
      }

      waiters.add(waiter)
    })
  }

  function releaseWaitersOf(characterId: string, result: WaitReplyResult): void {
    for (const waiter of [...waiters]) {
      if (waiter.characterId !== characterId) continue
      settleWaiter(waiter, result)
    }
  }

  async function release(characterId: string): Promise<ReleaseResult | undefined> {
    const live = sessions.get(characterId)
    if (live === undefined) return undefined

    sessions.delete(characterId)
    bySessionId.delete(live.sessionId)
    inflight.delete(characterId)

    // 释放了会话就不会再有回复 —— 挂着的等待者必须立刻知道，不能一直转圈。
    releaseWaitersOf(characterId, {
      ok: false,
      code: 'released',
      reason: `角色 ${characterId} 的会话已被释放：这条回复不会来了。再跟他说一句话会重新建会话。`,
    })

    try {
      await live.handle.dispose()
      return { characterId, sessionId: live.sessionId, closed: true, error: undefined }
    } catch (error) {
      return { characterId, sessionId: live.sessionId, closed: false, error: messageOf(error) }
    }
  }

  async function disposeAll(): Promise<DisposeAllResult> {
    disposed = true
    unsubscribe?.()
    unsubscribe = undefined

    const live = [...sessions.values()]
    sessions.clear()
    bySessionId.clear()
    inflight.clear()
    requestSeq = 0

    for (const waiter of [...waiters]) {
      settleWaiter(waiter, {
        ok: false,
        code: 'disposed',
        reason: '插件已卸载或世界已重开：所有角色会话都已释放。',
      })
    }
    replyListeners.clear()
    turnEndListeners.clear()

    const results = await Promise.all(
      live.map(async (session): Promise<ReleaseResult> => {
        try {
          await session.handle.dispose()
          return { characterId: session.characterId, sessionId: session.sessionId, closed: true, error: undefined }
        } catch (error) {
          return {
            characterId: session.characterId,
            sessionId: session.sessionId,
            closed: false,
            error: messageOf(error),
          }
        }
      }),
    )

    return { disposed: results.length, failures: results.filter((r) => r.error !== undefined) }
  }

  return {
    wake,
    say,
    waitForReply,
    onReply(listener) {
      replyListeners.add(listener)
      return () => {
        replyListeners.delete(listener)
      }
    },
    onTurnEnd(listener) {
      turnEndListeners.add(listener)
      return () => {
        turnEndListeners.delete(listener)
      }
    },
    sessionFor(characterId) {
      const live = sessions.get(characterId)
      return live === undefined ? undefined : { characterId: live.characterId, sessionId: live.sessionId }
    },
    liveCount: () => sessions.size,
    liveCharacters: () => [...sessions.keys()],
    release,
    disposeAll,
    isDisposed: () => disposed,
  }
}

/**
 * `prompt` 的失败原因是不是"内容不合法"。
 * （DSH 侧返回 `RemoteError('gateway/bad-request')`，见 BRIDGE-RECON §3.2。）
 */
export function isBadRequest(error: unknown): boolean {
  return codeOf(error) === 'gateway/bad-request'
}
