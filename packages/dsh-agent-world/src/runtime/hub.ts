/**
 * 事件广播（BACKLOG M3-4）。
 *
 * ## 它为什么住在运行时，而不是协议层
 *
 * 协议层只定义**形状**（`EventSinkPort` / `EventSourcePort`），不认识"扇出"这件事。
 * 广播是运行时的事：运行时是唯一同时握着"模拟内核推出来的事件"和"若干订阅者"的地方。
 *
 * ## 一条硬约束：`publish` 是同步的，而且它在模拟循环里
 *
 * `EventSinkPort.publish` 的契约是**同步**（确定性要求：模拟内核不该等 IO）。
 * 于是这里有一个必须防的坑：**任何一个订阅者抛异常或写阻塞，都会拖垮整条模拟循环**。
 * 所以：
 * 1. 每个订阅者单独 try/catch——一个坏订阅者不能让别人收不到事件；
 * 2. 订阅者不返回 Promise、也不允许 await（类型上就是同步回调）；
 * 3. 慢客户端的问题由**订阅者自己**处理（SSE 那边在 `res.write` 返回 false 时主动断开），
 *    而不是让广播层去缓冲——广播层一缓冲，就是"内存随慢客户端增长"。
 */
import type { EventSinkPort, EventSourcePort } from '../protocol/index.js'
import type { WorldEvent } from '../domain/types.js'

/** 事件广播。同时是出口（模拟内核往里丢）与入口（订阅者从它取）。 */
export interface EventHub extends EventSinkPort, EventSourcePort {
  /** 当前订阅者数量（诊断：连接泄漏时它会一直涨）。 */
  readonly subscriberCount: number
  /** 订阅者抛异常的次数（诊断：正常应当是 0）。 */
  readonly listenerErrors: number
}

/** 造一个事件广播。 */
export function createEventHub(): EventHub {
  const listeners = new Set<(events: readonly WorldEvent[]) => void>()
  let listenerErrors = 0

  return {
    get subscriberCount(): number {
      return listeners.size
    },

    get listenerErrors(): number {
      return listenerErrors
    },

    publish(events: readonly WorldEvent[]): void {
      if (events.length === 0 || listeners.size === 0) return

      // 先快照成数组再遍历：订阅者可能在回调里取消订阅（比如连接刚好断开），
      // 直接遍历 Set 会在迭代中途改变集合——那是最难复现的一类 bug。
      for (const listener of [...listeners]) {
        try {
          listener(events)
        } catch {
          // 刻意**吞掉但不假装没发生**：计数留着，调用方可以去读。
          // 让一个坏订阅者把模拟循环带崩，代价远大于丢掉一批事件。
          listenerErrors += 1
        }
      }
    },

    subscribe(listener: (events: readonly WorldEvent[]) => void): () => void {
      listeners.add(listener)
      // 返回的取消函数必须幂等：调用方（res 的 close 处理器）可能因为
      // 'close' 与 'error' 都触发而调用两次。
      return () => {
        listeners.delete(listener)
      }
    },
  }
}
