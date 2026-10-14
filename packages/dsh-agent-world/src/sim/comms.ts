/**
 * 协作消息的产生（BACKLOG M2.5-2）。
 *
 * ## 它修的是一个"链路建好了但没有数据源"的问题
 *
 * 邮箱（延迟投递、飞行中判定、纸条动画的数据来源）在 R6 就建好并且有测试，
 * 但**模拟里没有任何一处会发消息**——跑 700 步 `world.messages` 是 0 条。
 * 一条从不被使用的链路，等于是"设计上支持"而不是"能用"。
 *
 * ## 发什么、发给谁：只发两处，都是真实的交接
 *
 * | 时机 | 消息 | 收件人 |
 * |---|---|---|
 * | 某人领到一张**有前置**的单 | `handoff` | 完成前置的那个人 |
 * | 某张单完工 | `report` | `lead` |
 *
 * 只加这两处是为了守住事件量策略：**消息是离散量，不能按 tick 发**。
 * 一张单最多产生两条，跑一整天也就几百条——而 `MESSAGE_RING_SIZE` 已经把上界兜住了。
 *
 * ## 为什么"领单时给上一个人发"而不是"完工时通知下一个人"
 *
 * 后者需要"谁在等这张单"的概念，而 `ready` 是由依赖求值**派生**的、没人在排队。
 * 前者只需回看 `blockedBy` 里已完成的那张单，数据都在手边。
 *
 * ## 文案
 *
 * 正文由**内容里的标题**拼出来（`任务标题 → 任务标题`），连接符在代码里。
 * 消息正文要不要也进内容库（第 11 个库）见 BACKLOG 里的待定项——
 * 现在它读起来是"信息"而不是"邀请"，这是刻意的：宁可机械，也不要凭空编出
 * 一个模拟内核没真的表达过的语义（比如"麻烦你了"）。
 */
import type { Claim } from './scheduler.js'
import type { SendOutcome } from './mailbox.js'
import { sendMessages } from './mailbox.js'
import type { MessageDraft } from './mailbox.js'
import type { Task, World } from '../domain/types.js'

/** 一次消息产生的结果。 */
export interface CommsOutcome {
  /** 新入队并开始飞行的消息（含预计送达 tick）。 */
  queued: SendOutcome['sent']
}

/**
 * 根据本 tick 的派工与完工，产生协作消息。
 *
 * **会就地修改 `world.messages` 与 `world.messageSeq`**（通过 `sendMessages`）。
 *
 * @param world - 世界（就地修改）。
 * @param claims - 本 tick 的派工结果。
 * @param completed - 本 tick 完工的工单。
 */
export function dispatchComms(
  world: World,
  claims: readonly Claim[],
  completed: readonly { taskId: string; agentId: string }[],
): CommsOutcome {
  const tasks = new Map(world.tasks.map((t) => [t.id, t]))
  const drafts: MessageDraft[] = []

  // ── 交接：领到有前置的单，就给完成前置的那个人 ──
  for (const claim of claims) {
    const task = tasks.get(claim.taskId)
    if (task === undefined) continue

    const done = task.blockedBy
      .map((id) => tasks.get(id))
      .filter((t): t is Task => t !== undefined && t.status === 'done')
    if (done.length === 0) continue

    // 取"最近完成的那个"作为交接方：并列时用序号大的（确定性的选法，
    // 不依赖数组顺序——那会随任务的实例化顺序漂移）。
    const previous = done.reduce((best, t) =>
      (t.finishedAtTick ?? -1) > (best.finishedAtTick ?? -1) ||
      ((t.finishedAtTick ?? -1) === (best.finishedAtTick ?? -1) && t.ordinal > best.ordinal)
        ? t
        : best,
    )
    const from = previous.owner
    // 自己做的前置就不发给自己——那会变成"一个人给自己递纸条"，纯噪声。
    if (from === null || from === claim.agentId) continue

    drafts.push({
      from,
      to: claim.agentId,
      kind: 'handoff',
      body: `${previous.title} → ${task.title}`,
    })
  }

  // ── 汇报：完工了就报给 lead ──
  const lead = world.agents.find((a) => a.role === 'lead')
  if (lead !== undefined) {
    for (const done of completed) {
      // lead 自己干的活不用汇报给自己。
      if (done.agentId === lead.id) continue
      const task = tasks.get(done.taskId)
      if (task === undefined) continue
      drafts.push({ from: done.agentId, to: lead.id, kind: 'report', body: task.title })
    }
  }

  if (drafts.length === 0) return { queued: [] }
  return { queued: sendMessages(world, drafts).sent }
}
