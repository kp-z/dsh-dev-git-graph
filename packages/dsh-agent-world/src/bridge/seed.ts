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
import type { SystemMessageSeedEvent } from './types.js'

/** seed 事件在会话里的位置。见 BRIDGE-RECON §6 U2：`seq` 是否必须自洽还没真机验证。 */
export const SEED_SEQ = 0

/** seed 的 turn/step。seed 是"进入模型视角的第一段历史"，故取 0。 */
export const SEED_TURN = 0
export const SEED_STEP = 0

export interface BuildSystemSeedOptions {
  /** 事件时间戳（ms）。**默认 `0`** —— 让这个函数保持纯函数，真机由调用方传 `now()`。 */
  readonly time?: number
  readonly seq?: number
  readonly turn?: number
  readonly step?: number
  /** 见 BRIDGE-RECON §6 U1：不确定 `MessageBase` 是否强制要 `id`，给了就带上。 */
  readonly messageId?: string
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
  options: BuildSystemSeedOptions = {},
): SystemMessageSeedEvent {
  if (typeof text !== 'string' || text.trim() === '') {
    throw new Error('人设文本是空的：system prompt 不能为空（内容库的 rosters 条目可能缺字段）')
  }

  const message: SystemMessageSeedEvent['data']['message'] = {
    role: 'system',
    source: { kind: 'system-prompt' },
    content: [{ type: 'text', text }],
    ...(options.messageId === undefined ? {} : { id: options.messageId }),
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
