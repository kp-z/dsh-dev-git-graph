/**
 * 世界运行时（BACKLOG M3-2）。
 *
 * ## 它解决的是一句很直白的话：**没人驱动 `step()`，世界就是静止的**
 *
 * R6 结束时模拟内核已经完成、1000 tick 确定性验收通过，但插件加载后 `world.tick`
 * 一直是 0 —— 因为没有任何东西在按节拍调 `step()`。本模块就是那个节拍器。
 *
 * ## 职责边界
 *
 * 运行时是**唯一**允许同时认识"模拟内核"与"内容服务"的地方：
 * `step()` 会在 `StepResult.requests` 里把它做不了的事（`reset` / `dispatch` / `hire`）
 * 转交出来，因为那些都需要内容，而 `sim/` 按边界规则不许 import `content/`。
 * 运行时在这儿把它们接上。
 *
 * 它**不做业务判断**：谁该做哪张单是调度器的事，它只管按节拍推。
 *
 * ## 清理是硬要求
 *
 * `stop()` 必须清掉定时器。dsh 支持插件热重载，泄漏的 `setInterval` 会让
 * "改一次代码多一个世界在跑"，而症状是 CPU 慢慢爬高——很难归因到某个插件。
 * 所以 `index.ts` 里用 `ctx.effect()` 挂清理，别依赖进程退出。
 */
export type { EventHub } from './hub.js'
export { createEventHub } from './hub.js'

import { MESSAGE_DELIVERY_TICKS } from '../domain/constants.js'
import type { WorldEvent } from '../domain/types.js'
import type { WorldStore } from '../store/index.js'
import type { EventSinkPort, RuntimeDiagnostics, RuntimePort, WorldCommand, WorldServicePort } from '../protocol/index.js'
import { nullEventSink } from '../protocol/index.js'
import type { StepResult } from '../sim/index.js'
import { step } from '../sim/index.js'

// 诊断计数的形状定义在协议层（`protocol/ports/runtime.ts`）——路由要把它们发给面板，
// 而 routes 按边界规则不许 import 本模块。这里只转出。
export type { RuntimeDiagnostics }

/** 落盘选项。不给就不落盘（世界只活在内存里）。 */
export interface PersistOptions {
  /** 世界存档。 */
  store: WorldStore
  /**
   * 每多少 tick 存一次快照并刷一次事件。
   *
   * 事件是**攒着一起写**的：每 tick 一次 append 就是每秒 10 次磁盘写入，
   * 而它们加起来还没一次快照大。代价是崩溃时最多丢这么多 tick 的事件——
   * 而 `world.json` 的快照也是同一个粒度，所以两者对得上，不会出现
   * "世界是第 700 tick 的、事件却只到 650"这种对不上的存档。
   */
  checkpointEveryTicks: number
}

/** 建运行时需要的依赖。 */
export interface RuntimeOptions {
  /** 世界服务端口（提供 `currentWorld` / `open` / `dispatch`）。 */
  service: WorldServicePort
  /** 逻辑 tick 间隔（ms）。 */
  tickMs: number
  /**
   * 事件出口。默认丢弃。
   *
   * M3-4 会把 SSE 的广播器接到这里——**注意运行时只往端口里丢，不认识 HTTP**。
   */
  sink?: EventSinkPort
  /** `step()` 出错时的回调（记日志用）。默认吞掉，但 `diagnostics.errors` 会累加。 */
  onError?: (error: unknown) => void
  /** 落盘。不传则世界只活在内存里。 */
  persist?: PersistOptions
}

/** 世界运行时。实现协议层的 `RuntimePort`（路由只认那个接口）。 */
export interface Runtime extends RuntimePort {
  readonly running: boolean
  /** 开始按节拍推进。重复调用是幂等的。 */
  start(): void
  /** 停止并清掉定时器。重复调用是幂等的。 */
  stop(): void
  /**
   * 手动推进 N 步。
   *
   * 给测试与"快进"用。**它和 `start()` 不冲突**：运行时不会因为手动推过就改变状态。
   *
   * @returns 最后一步的结果；没有世界时返回 null。
   */
  advance(ticks: number): StepResult | null
  /** 推进一步。 */
  tickOnce(): StepResult | null
  /** 诊断计数（实时对象，读它即可）。 */
  readonly diagnostics: RuntimeDiagnostics
  /**
   * 立刻把攒着的事件与当前快照写下去。
   *
   * `stop()` 会调用它（**不能丢**：进程退出前那一段是最后的机会），
   * 测试与"手动存档"也用它。没配落盘时是空转。
   */
  flush(): Promise<void>
}

/**
 * 建一个运行时。
 *
 * @param options - 依赖与选项。
 */
export function createRuntime(options: RuntimeOptions): Runtime {
  const { service, tickMs, persist } = options
  const sink = options.sink ?? nullEventSink
  const diagnostics: RuntimeDiagnostics = {
    ticks: 0,
    resets: 0,
    dispatches: 0,
    unhandledHires: 0,
    errors: 0,
    persistErrors: 0,
  }

  /** 攒着还没写下去的事件。 */
  let pendingEvents: WorldEvent[] = []
  /** 最近一次成功落盘到哪个 seq（诊断用：一眼看出"存档落后多少"）。 */
  let persistedSeq = 0

  /**
   * 把当前世界与攒着的事件写下去。
   *
   * 顺序是**先事件后快照**：反过来的话，快照会声称"世界到了第 700 tick"，
   * 而事件日志才写到 650——万一这时崩了，读档的人会看到一个比历史更靠前的世界。
   * 先写事件，最坏情况是"事件多了几条、快照旧一点"，那是**可解释**的。
   */
  const packVersions = () => service.content().view().packs.map((p) => ({ id: p.id, version: p.version }))

  const flush = async (): Promise<void> => {
    if (persist === undefined) return

    const batch = pendingEvents
    pendingEvents = []
    try {
      if (batch.length > 0) await persist.store.appendEvents(batch)
      const world = service.currentWorld()
      if (world !== null) await persist.store.saveWorld(world, packVersions())
      persistedSeq = world?.seq ?? persistedSeq
    } catch (error) {
      diagnostics.persistErrors += 1
      // 写失败的事件**放回去**：下次 checkpoint 再试。丢掉才是真的丢历史。
      pendingEvents = [...batch, ...pendingEvents]
      options.onError?.(error)
    }
  }

  /**
   * 同步落盘。**只在关停路径上用。**
   *
   * `stop()` 之后进程可能立刻退出，而 `await` 出去的写根本没机会跑完——
   * 那正是"最后一段历史丢了"的成因。所以在关停路径上宁可用阻塞式的 fsync。
   */
  const flushSync = (): void => {
    if (persist === undefined) return
    const batch = pendingEvents
    pendingEvents = []
    try {
      if (batch.length > 0) persist.store.appendEventsSync(batch)
      const world = service.currentWorld()
      if (world !== null) persist.store.saveWorldSync(world, packVersions())
      persistedSeq = world?.seq ?? persistedSeq
    } catch (error) {
      diagnostics.persistErrors += 1
      pendingEvents = [...batch, ...pendingEvents]
      options.onError?.(error)
    }
  }

  let timer: ReturnType<typeof setInterval> | null = null

  /**
   * 待处理命令队列。
   *
   * 命令**不立刻执行**，而是排到下一步由 `step()` 的 ingest 段统一处理——
   * 这样它影响的是"命令到达的那一 tick"，而不是"HTTP 请求到达的那个瞬间"。
   * 后者会让世界的行为取决于网络时序，直接破坏确定性。
   */
  const queue: WorldCommand[] = []
  /** 队列上限：10Hz 的循环配 1000 条积压已经很离谱了，再多说明循环卡死了。 */
  const MAX_QUEUE = 1000

  /** 处理 `step()` 转交出来的、需要内容的动作。 */
  const handleRequests = (result: StepResult): void => {
    const { reset, dispatch, hire } = result.requests

    // 顺序有讲究：先重开再派单——反过来会把单派进马上要被丢掉的那个世界。
    if (reset !== null) {
      service.open(reset.name ?? undefined)
      diagnostics.resets += 1
    }
    for (const taskSet of dispatch) {
      try {
        service.dispatch(taskSet)
        diagnostics.dispatches += 1
      } catch (error) {
        // 派单失败（比如任务集 id 打错）不该拖垮整个循环，但必须被记下来。
        diagnostics.errors += 1
        options.onError?.(error)
      }
    }
    if (hire.length > 0) {
      // M7 之前没人能做这件事。计数而不是静默丢弃。
      diagnostics.unhandledHires += hire.length
    }
  }

  const tickOnce = (): StepResult | null => {
    const world = service.currentWorld()
    if (world === null) return null

    // 取走本步要处理的命令（取空，避免下一步重复处理）。
    const commands = queue.splice(0, queue.length)
    const tickBefore = world.tick

    let result: StepResult
    try {
      result = step(world, commands)
    } catch (error) {
      diagnostics.errors += 1
      options.onError?.(error)
      return null
    }

    try {
      handleRequests(result)
    } catch (error) {
      diagnostics.errors += 1
      options.onError?.(error)
    }

    sink.publish(result.events)

    // 只在世界真的前进时计数：暂停时 step 会早退，tick 不动，那一步不该算进来。
    if (world.tick > tickBefore) {
      diagnostics.ticks += 1

      if (persist !== undefined) {
        pendingEvents.push(...result.events)
        const every = persist.checkpointEveryTicks
        if (every > 0 && world.tick % every === 0) {
          // 不 await：checkpoint 不能拖慢模拟循环。失败会被记进 persistErrors 并留待下次重试。
          void flush()
        }
      }
    }
    return result
  }

  return {
    get running() {
      return timer !== null
    },
    diagnostics,

    get pending() {
      return queue.length
    },

    // 模拟的时间语义从运行时透出去，路由就不用（也不许）去 import domain 的常量。
    get messageDeliveryTicks() {
      return MESSAGE_DELIVERY_TICKS
    },

    enqueue(command: WorldCommand): void {
      if (queue.length >= MAX_QUEUE) {
        throw new Error(
          `命令队列已积压 ${queue.length} 条（上限 ${MAX_QUEUE}）——模拟循环大概卡住了。` +
            '请先查 runtime.diagnostics.errors 与日志。静默丢弃会让"我点了暂停它没停"无从解释，所以这里直接报错。',
        )
      }
      queue.push(command)
    },

    start(): void {
      if (timer !== null) return // 幂等：重复 start 不该起第二个定时器
      timer = setInterval(tickOnce, tickMs)
    },

    stop(): void {
      // **同步刷**：这一步之后进程可能立刻退出，异步写不保证跑得完。
      // 即使定时器已经停了也要刷：可能还有上一轮攒着的事件没写下去。
      flushSync()
      if (timer === null) return
      clearInterval(timer)
      timer = null
    },

    flush,

    tickOnce,

    advance(ticks: number): StepResult | null {
      let last: StepResult | null = null
      for (let i = 0; i < Math.max(0, ticks); i++) {
        last = tickOnce()
        if (last === null) break // 没世界了（比如被 reset 掉又没建起来）
      }
      return last
    },
  }
}
