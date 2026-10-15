/**
 * `bridge` → `routes` 的对话端口适配（M6-3）。
 *
 * ## 为什么要一个适配层，而不是让 routes 直接 import bridge
 *
 * `src/protocol/boundaries.ts` 规定 `routes` 只许 import
 * `['protocol','runtime','scene']` —— **不许 import `bridge`**。这条规则不要为了省事破掉：
 * 破掉之后传输层就开始认识"会话怎么建、模型怎么选"，于是同一个能力以后经工具暴露给模型时，
 * 两条路会开始漂移。
 *
 * 所以两边**各自声明自己需要的最小形状**：
 * - `src/routes/dialogue.ts` 声明 `DialoguePort`（它只想要 3 个方法）；
 * - 本文件返回结构完全一样的对象。
 *
 * 因为 TS 是结构类型，`src/index.ts`（组合根，允许认识所有人）把这里的返回值直接当
 * `DialoguePort` 传进去就行 —— 中间不需要任何 `as`。
 *
 * ## 形状上的一个刻意差别
 *
 * bridge 的 `say()` 返回 `{ok, characterId, sessionId, requestId, created}`（信息更多），
 * 而端口只要 `{ok} | {ok:false,reason}`。**故意收窄**：传输层不需要知道会话 id，
 * 多给它的字段迟早会被拿去用。
 */
import { DEFAULT_REPLY_TIMEOUT_MS } from './character-bridge.js'
import type { CharacterBridge } from './types.js'

/** 一次搭话被接收 / 被拒。 */
export type DialogueAck = { readonly ok: true } | { readonly ok: false; readonly reason: string }

/** 一条回复 / 等不到的原因。 */
/** 一次工具调用（R35）。与 `protocol/dialogue.ts` 的 `DialogueAction` 同形。 */
export interface DialogueAction {
  readonly name: string
  readonly detail?: string
  readonly ok: boolean
}

export type DialogueReply =
  | { readonly ok: true; readonly text: string; readonly actions: readonly DialogueAction[] }
  | { readonly ok: false; readonly reason: string }

/**
 * 对话端口（与 `src/routes/dialogue.ts` 的 `DialoguePort` **结构等价**）。
 *
 * 手写这一份而不是 import，正是上面那条边界规则的代价 —— 代价很小，
 * 换来的是传输层与 agent 生命周期彻底解耦。
 */
export interface DialoguePortFace {
  say(characterId: string, text: string): Promise<DialogueAck>
  waitForReply(
    characterId: string,
    timeoutMs: number,
    onProgress?: (actions: readonly DialogueAction[]) => void,
  ): Promise<DialogueReply>
  liveCount(): number
}

export interface ToDialoguePortOptions {
  /** 端口层的兜底超时；调用方给的 `timeoutMs <= 0` 时用它。 */
  readonly replyTimeoutMs?: number
}

/**
 * 把一个 {@link CharacterBridge} 收窄成对话端口。
 *
 * @param bridge - 已经装好的角色 ↔ 会话绑定。
 * @param options - 超时兜底。
 */
export function toDialoguePort(
  bridge: CharacterBridge,
  options: ToDialoguePortOptions = {},
): DialoguePortFace {
  const fallbackTimeoutMs = options.replyTimeoutMs ?? DEFAULT_REPLY_TIMEOUT_MS

  return {
    async say(characterId: string, text: string): Promise<DialogueAck> {
      const result = await bridge.say(characterId, text)
      return result.ok ? { ok: true } : { ok: false, reason: result.reason }
    },

    async waitForReply(
      characterId: string,
      timeoutMs: number,
      onProgress?: (actions: readonly DialogueAction[]) => void,
    ): Promise<DialogueReply> {
      const result = await bridge.waitForReply(characterId, {
        timeoutMs: timeoutMs > 0 ? timeoutMs : fallbackTimeoutMs,
        ...(onProgress === undefined ? {} : { onProgress }),
      })
      return result.ok
        ? { ok: true, text: result.reply.text, actions: result.reply.actions }
        : { ok: false, reason: result.reason }
    },

    liveCount: () => bridge.liveCount(),
  }
}

/** 建桥的**延迟**尝试结果。 */
export type BridgeAttempt =
  | { readonly ok: true; readonly bridge: CharacterBridge }
  | { readonly ok: false; readonly reason: string }

/**
 * 惰性解析版本：**第一次真正要说话时**才建桥，成功后记住。
 *
 * ## 为什么必须有这个（R30 在真宿主上踩出来的）
 *
 * 原来 `src/index.ts` 是在**插件加载那一刻**同步调一次 `createDshCharacterBridge(ctx)`，
 * 算完就把结果定死。在真宿主上这直接坏了：
 *
 * - cordis 的加载次序由 `inject` 图决定，我们只声明了 `inject = ['tools']`，
 *   所以插件在 `tools` 就绪时就加载，**不等 `sessionController`**；
 * - 那一刻 `ctx.get('sessionController')` 还是 `undefined` → 判定 `no-session-service`
 *   → 端口**永久**是 `undefined`，于是 `/api/say` 每条都回
 *   "对话通道没启用（DSH 会话服务不可用）"。
 *
 * 而配置里 `session-controller`（第 461 行）明明排在 `agent-world`（第 1408 行）**之前**——
 * 所以**这不是配置问题，是"用加载时刻去判断一个后来才存在的服务"**。
 * 用 `ctx.inject` 等它出现也可以，但那会把这个端口绑死在某个挂载时机上；
 * 惰性解析对**任何**挂载顺序都成立，而且顺带覆盖了热重载。
 *
 * ## 失败仍然要可下手（红线第 6 条）
 *
 * 每次失败都返回**当次**尝试的原因，而不是一个缓存的旧字符串 ——
 * 因为"服务还没挂上"和"服务挂了又掉了"对用户是同一句话，但对诊断不是。
 * 只有**成功**会被记住。
 */
export function toLazyDialoguePort(
  attempt: () => BridgeAttempt,
  options: ToDialoguePortOptions = {},
): DialoguePortFace {
  const fallbackTimeoutMs = options.replyTimeoutMs ?? DEFAULT_REPLY_TIMEOUT_MS
  let resolved: CharacterBridge | undefined

  /**
   * 拿到桥：成功过就直接用，否则重试一次。
   *
   * @returns 桥，或者这次建不起来的原因。
   */
  const acquire = (): BridgeAttempt => {
    if (resolved !== undefined) return { ok: true, bridge: resolved }
    const next = attempt()
    if (next.ok) resolved = next.bridge
    return next
  }

  return {
    async say(characterId: string, text: string): Promise<DialogueAck> {
      const got = acquire()
      if (!got.ok) return { ok: false, reason: got.reason }
      const result = await got.bridge.say(characterId, text)
      return result.ok ? { ok: true } : { ok: false, reason: result.reason }
    },

    async waitForReply(
      characterId: string,
      timeoutMs: number,
      onProgress?: (actions: readonly DialogueAction[]) => void,
    ): Promise<DialogueReply> {
      const got = acquire()
      if (!got.ok) return { ok: false, reason: got.reason }
      const result = await got.bridge.waitForReply(characterId, {
        timeoutMs: timeoutMs > 0 ? timeoutMs : fallbackTimeoutMs,
        // 惰性端口才是生产路径（R30）。这里漏接 `onProgress`，真宿主上就永远没有 acting 帧，
        // 而所有走直接端口的测试都会是绿的——两个端口必须同步改。
        ...(onProgress === undefined ? {} : { onProgress }),
      })
      return result.ok
        ? { ok: true, text: result.reply.text, actions: result.reply.actions }
        : { ok: false, reason: result.reason }
    },

    // 还没建起来时是 0，而不是抛 —— 诊断接口不该因为没装好就炸。
    liveCount: () => resolved?.liveCount() ?? 0,
  }
}
