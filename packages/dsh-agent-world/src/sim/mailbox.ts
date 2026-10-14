/**
 * 邮箱（BACKLOG M2-6）。
 *
 * 消息在这个世界里的作用不是"传数据"，而是**让协作看得见**：
 * 一张纸条从 A 飞到 B，是"这两个人之间发生了什么"的唯一可视化依据。
 *
 * ## 投递有延迟，而且是定量的
 *
 * 立刻送达的话，渲染层来不及画飞行过程，只能看到纸条瞬移；延迟太久又会让人以为卡住了。
 * 所以投递延迟是 `MESSAGE_DELIVERY_TICKS` 个 tick —— **写死在常量里而不是由内容决定**：
 * 它是模拟的时间语义，不是可替换的美术。真要改观感，改的是渲染层怎么插值这段飞行。
 *
 * ## 不在这里发事件
 *
 * 返回"投出去哪些、送达哪些"，事件由 `emit.ts` 统一产出。
 */
import { MESSAGE_DELIVERY_TICKS } from '../domain/constants.js'
import type { Message, World } from '../domain/types.js'

/** 要投递的一条消息（还没进世界）。 */
export interface MessageDraft {
  from: string
  to: string
  kind: Message['kind']
  body: string
}

/** 入队结果。 */
export interface SendOutcome {
  /** 新入队的消息 id。 */
  queued: string[]
}

/** 投递结果。 */
export interface DeliverOutcome {
  /** 本 tick 送达的消息。 */
  delivered: { messageId: string; from: string; to: string }[]
  /** 本 tick 正在飞行中的消息 id（渲染层据此画纸条）。 */
  inFlight: string[]
}

/**
 * 把一批消息放进世界的邮箱。
 *
 * **会就地修改 `world.messages`。**
 *
 * @param world - 世界（就地修改）。
 * @param drafts - 要投递的消息。
 * @param tick - 入队时刻；不传用 `world.tick`。
 */
export function sendMessages(
  world: World,
  drafts: readonly MessageDraft[],
  tick: number = world.tick,
): SendOutcome {
  const queued: string[] = []
  for (const draft of drafts) {
    // 消息 id 不从 seq 派生：seq 属于事件日志，两者混用会让"事件序号不跳号"这条保证失效。
    const id = `msg-${world.messages.length + 1}`
    world.messages.push({
      id,
      from: draft.from,
      to: draft.to,
      kind: draft.kind,
      body: draft.body,
      atTick: tick,
      deliveredAtTick: null,
    })
    queued.push(id)
  }
  return { queued }
}

/**
 * 推进一 tick 的投递。
 *
 * **会就地修改 `world.messages`。**
 *
 * @param world - 世界（就地修改）。
 */
export function deliverMessages(world: World): DeliverOutcome {
  const delivered: DeliverOutcome['delivered'] = []
  const inFlight: string[] = []

  for (const message of world.messages) {
    if (message.deliveredAtTick === null) {
      if (world.tick - message.atTick >= MESSAGE_DELIVERY_TICKS) {
        message.deliveredAtTick = world.tick
        delivered.push({ messageId: message.id, from: message.from, to: message.to })
      } else {
        inFlight.push(message.id)
      }
    }
  }

  return { delivered, inFlight }
}

/**
 * 判断一条消息是否还在飞行中。
 *
 * 面板与 HUD 都用它，别各自写一遍 `deliveredAtTick === null` 的判断——
 * 两者的口径一旦不同，就会出现"纸条画出来了但列表里显示已送达"。
 */
export function isInFlight(message: Message, tick: number): boolean {
  return message.deliveredAtTick === null && tick >= message.atTick
}
