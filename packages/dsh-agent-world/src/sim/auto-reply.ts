/**
 * R313：tick 自动回复。
 *
 * 世界里的消息不是聊天记录，而是协作可见化：手递手 / 问题 / 汇报。
 * 但“消息送达后对方永远沉默”会让协作看起来断了。这里给**需要回执的消息**
 * （question / handoff）生成一条确定性的 answer，进入同一个延迟邮箱——
 * 不即时回，仍按 MESSAGE_DELIVERY_TICKS 飞行，渲染层能看到回信。
 *
 * 防环：只回复 question / handoff；answer / report / dispatch 不触发回复。
 * 防自环：from === to 的消息不回。
 */
import type { DeliverOutcome, SendOutcome } from './mailbox.js'
import { sendMessages } from './mailbox.js'
import type { Message, World } from '../domain/types.js'

const REPLY_TO: ReadonlySet<Message['kind']> = new Set(['question', 'handoff'])

export function queueAutoReplies(world: World, delivered: DeliverOutcome['delivered']): SendOutcome['sent'] {
  if (delivered.length === 0) return []
  const byId = new Map(world.messages.map((message) => [message.id, message]))
  const drafts = []
  for (const receipt of delivered) {
    const message = byId.get(receipt.messageId)
    if (message === undefined || !REPLY_TO.has(message.kind)) continue
    if (message.from === message.to) continue
    if (!world.agents.some((agent) => agent.id === message.to)) continue
    drafts.push({
      from: message.to,
      to: message.from,
      kind: 'answer' as const,
      body: `收到：${message.body}`,
    })
  }
  if (drafts.length === 0) return []
  return sendMessages(world, drafts).sent
}
