/**
 * 事件端口（BACKLOG M1.6-3，第一个消费者是 M2 的 `sim/emit.ts`）。
 *
 * ## 为什么先把接口定下来
 *
 * 模拟内核产出事件，而**谁来消费事件不该由模拟内核决定**：可能是运行时广播给 SSE，
 * 可能是测试直接收集数组，可能是将来写进 jsonl。如果 `sim/` 直接调用 runtime 的广播函数，
 * 模拟内核就被焊死在"一定有个 HTTP 服务器"上了——而它的一半价值恰恰是可以 headless 跑。
 *
 * 所以：`sim` 只往 `EventSinkPort` 里丢，谁接是别人的事。
 */
import type { WorldEvent } from '../../domain/types.js'

/** 事件出口。模拟内核只认识它。 */
export interface EventSinkPort {
  /**
   * 发布一批事件。
   *
   * @param events - 本 tick 产生的变化。**同步**调用：确定性要求下，模拟内核不该等 IO。
   */
  publish(events: readonly WorldEvent[]): void
}

/** 事件入口。运行时/面板/测试用它订阅。 */
export interface EventSourcePort {
  /**
   * 订阅事件。
   *
   * @param listener - 收到一批事件时调用。
   * @returns 取消订阅的函数。**必须能取消**，否则热重载会泄漏订阅者。
   */
  subscribe(listener: (events: readonly WorldEvent[]) => void): () => void
}

/** 一个什么都不做的出口。测试与 headless 场景用它，省得每个调用点都判空。 */
export const nullEventSink: EventSinkPort = {
  publish(): void {
    /* 刻意什么都不做：没有订阅者时事件就是被丢掉的，这不是错误。 */
  },
}
