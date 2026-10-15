/**
 * `seed` 的构造（GOAL.md 决策 D37 / 里程碑 M6-1）。
 *
 * ## 这里为什么一个字的人设都没有
 *
 * 红线第 2 条：**人设是内容**。代码里不许出现角色名、性格描述、台词。
 * 所以本文件只做一件事：把**调用方给的**一段文本装成一条合法的 `system/message` seed 事件。
 * M6-2 从 `rosters` 生成那段文本；bridge 不需要知道里面写的是谁。
 *
 * ## 形状是查出来的，不是猜的
 *
 * `SessionEventMap['system/message'] = { turn, step, message: SystemMessage }`
 * 且 `system/message` 属于 `SurfaceEventType`，所以外层还要带 `surfaceOp`
 * （见 `docs/BRIDGE-RECON.md` §2.2、§2.3）。
 */
import type { BridgeSeedEvent, SystemMessageSeedEvent } from './types.js'

/**
 * 人设消息在 seed 框里的位置：`turn/start`(0) → `step/start`(1) → **system/message(2)** → …
 * BRIDGE-RECON §6 U2 已在 R30 由真宿主回答：seq 必须**严格递增**，从 0 起。
 */
export const SEED_SEQ = 2

/**
 * seed 的 turn/step。**从 1 起**——R30 真宿主拒绝过 0：
 * `format v4 system/message turn must be positive`。
 */
export const SEED_TURN = 1
export const SEED_STEP = 1

export interface BuildSystemSeedOptions {
  /** 事件时间戳（ms）。**默认 `0`** —— 让这个函数保持纯函数，真机由调用方传 `now()`。 */
  readonly time?: number
  readonly seq?: number
  readonly turn?: number
  readonly step?: number
  /**
   * system 消息的 id。**必填**——R30 在真宿主上验证了 BRIDGE-RECON §6 的 U1：
   * `dsh-session` 拒绝没有 id 的消息（`seed system/message at index 0 lacks an identified message`）。
   * 这个 bug 在所有用假 agentLoop 的测试里都看不见，**只有真宿主照得出来**。
   */
  readonly messageId: string
}

/**
 * 把一段人设文本装成一条 `system/message` seed 事件。
 *
 * @param text - **由调用方（内容库）提供**的系统提示词。bridge 不认识它的内容。
 * @param options - 事件元数据；`time` 默认 0 以便测试可重放。
 * @throws 当 `text` 是空串或纯空白 —— 空人设是内容错误，静默发一条空 system prompt 更难查。
 */
export function buildSystemPromptSeed(
  text: string,
  options: BuildSystemSeedOptions,
): SystemMessageSeedEvent {
  if (typeof text !== 'string' || text.trim() === '') {
    throw new Error('人设文本是空的：system prompt 不能为空（内容库的 rosters 条目可能缺字段）')
  }
  // 与 dsh-session 的判据完全一致（非空字符串）。在这里先拦下来，是为了让失败发生在
  // **我们自己的代码里、带着我们的话**，而不是在宿主深处变成一句英文的 "lacks an identified message"。
  if (typeof options.messageId !== 'string' || options.messageId === '') {
    throw new Error('seed 的 messageId 必须是非空字符串：DSH 会话会拒绝没有 id 的消息（BRIDGE-RECON §6 U1）')
  }

  const message: SystemMessageSeedEvent['data']['message'] = {
    role: 'system',
    source: { kind: 'system-prompt' },
    content: [{ type: 'text', text }],
    id: options.messageId,
  }

  return {
    type: 'system/message',
    seq: options.seq ?? SEED_SEQ,
    time: options.time ?? 0,
    data: {
      turn: options.turn ?? SEED_TURN,
      step: options.step ?? SEED_STEP,
      message,
    },
    surfaceOp: 'append',
  }
}

/**
 * 一个**完整、自我闭合**的人设 seed（这是 bridge 真正要交给 `createAgent` 的东西）。
 *
 *     seq0 turn/start{1} → seq1 step/start{1,1} → seq2 system/message → seq3 step/end → seq4 turn/end{completed}
 *
 * ## 为什么要这个框（R30 在真宿主上一条一条撞出来的）
 *
 * 1. `lacks an identified message` → 消息必须有非空 `id`；
 * 2. `format v4 system/message turn must be positive` → turn/step 从 1 起；
 * 3. `requireOpenStep` → `system/message` 必须落在**已打开的** turn/step 里；
 * 4. seed 结束后 agent 会 `turn/start` 下一轮 → 框必须**自己关上**，否则撞
 *    "turn/start while turn 1 is still open"。
 *
 * 这四条在任何用假 agentLoop 的测试里都看不见——假的照单全收。
 *
 * @param text - 由调用方（内容库）提供的人设文本。
 * @param options - `messageId` 必填；`time` 由调用方给（保持纯函数）。
 */
export function buildPersonaSeed(
  text: string,
  options: { readonly messageId: string; readonly time?: number },
): BridgeSeedEvent[] {
  const time = options.time ?? 0
  const turn = SEED_TURN
  const step = SEED_STEP
  return [
    { type: 'turn/start', seq: 0, time, data: { turn } },
    { type: 'step/start', seq: 1, time, data: { turn, step } },
    buildSystemPromptSeed(text, { messageId: options.messageId, time, seq: SEED_SEQ, turn, step }),
    { type: 'step/end', seq: 3, time, data: { turn, step } },
    { type: 'turn/end', seq: 4, time, data: { turn, reason: { kind: 'completed' } } },
  ]
}
