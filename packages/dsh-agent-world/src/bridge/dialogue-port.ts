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
export type DialogueReply = { readonly ok: true; readonly text: string } | { readonly ok: false; readonly reason: string }

/**
 * 对话端口（与 `src/routes/dialogue.ts` 的 `DialoguePort` **结构等价**）。
 *
 * 手写这一份而不是 import，正是上面那条边界规则的代价 —— 代价很小，
 * 换来的是传输层与 agent 生命周期彻底解耦。
 */
export interface DialoguePortFace {
  say(characterId: string, text: string): Promise<DialogueAck>
  waitForReply(characterId: string, timeoutMs: number): Promise<DialogueReply>
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

    async waitForReply(characterId: string, timeoutMs: number): Promise<DialogueReply> {
      const result = await bridge.waitForReply(characterId, {
        timeoutMs: timeoutMs > 0 ? timeoutMs : fallbackTimeoutMs,
      })
      return result.ok ? { ok: true, text: result.reply.text } : { ok: false, reason: result.reason }
    },

    liveCount: () => bridge.liveCount(),
  }
}
