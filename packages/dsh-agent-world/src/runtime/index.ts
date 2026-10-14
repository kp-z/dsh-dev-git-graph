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
import type { EventSinkPort, WorldServicePort } from '../protocol/index.js'
import { nullEventSink } from '../protocol/index.js'
import type { StepResult } from '../sim/index.js'
import { step } from '../sim/index.js'

/** 运行时的诊断计数。挂在工具/日志里，用来回答"它到底在跑吗"。 */
export interface RuntimeDiagnostics {
  /** 已推进的 tick 数（由本运行时推进的，不含手动 advance 之外的来源）。 */
  ticks: number
  /** 处理过的重开请求。 */
  resets: number
  /** 处理过的派单请求。 */
  dispatches: number
  /**
   * 收到但**没人能处理**的招募请求数。
   *
   * 招募要把角色映射到真实 subagent（M7 的 bridge），现在还没有那个能力。
   * 刻意计数而不是静默丢弃：静默丢弃会让"我让招募一个人，它什么都没发生"无从解释。
   */
  unhandledHires: number
  /** `step()` 抛异常的累计次数。 */
  errors: number
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
}

/** 世界运行时。 */
export interface Runtime {
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
}

/**
 * 建一个运行时。
 *
 * @param options - 依赖与选项。
 */
export function createRuntime(options: RuntimeOptions): Runtime {
  const { service, tickMs } = options
  const sink = options.sink ?? nullEventSink
  const diagnostics: RuntimeDiagnostics = {
    ticks: 0,
    resets: 0,
    dispatches: 0,
    unhandledHires: 0,
    errors: 0,
  }

  let timer: ReturnType<typeof setInterval> | null = null

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

    let result: StepResult
    try {
      result = step(world)
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
    diagnostics.ticks += 1
    return result
  }

  return {
    get running() {
      return timer !== null
    },
    diagnostics,

    start(): void {
      if (timer !== null) return // 幂等：重复 start 不该起第二个定时器
      timer = setInterval(tickOnce, tickMs)
    },

    stop(): void {
      if (timer === null) return
      clearInterval(timer)
      timer = null
    },

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
