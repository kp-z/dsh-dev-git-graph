/**
 * 运行时端口（BACKLOG M3-3）。
 *
 * 路由（HTTP 层）要往世界的下一步塞命令，但它不该 import `src/runtime/` 那个具体模块——
 * 按 D16，模块之间只通过 `protocol/` 通信。所以命令入口定义成这里的接口，
 * `src/runtime/index.ts` 实现它。
 *
 * 这也不是洁癖：`routes` 的单测只要塞一个假端口就能验"POST 一条命令会不会被入队"，
 * 不用起真正的世界与定时器。
 */
import type { WorldCommand } from '../wire/commands.js'

/**
 * 运行时诊断计数。
 *
 * 路由会把它放进 `GET /api/world` 的响应里——这是回答"它到底在跑吗"的唯一出口。
 * 之前它只能看日志，那对排查没有用。
 */
export interface RuntimeDiagnostics {
  /**
   * 已推进的 tick 数。
   *
   * **暂停期间不增加**：它统计的是"世界前进了几次"，不是"循环转了几圈"。
   * 两者在暂停时会分叉，而分叉的症状是"HUD 说已经跑了 600 步、可 tick 才 388"
   * ——看的人只会以为哪里坏了。（R10 之前它就是这么错的。）
   */
  ticks: number
  /** 处理过的重开请求。 */
  resets: number
  /** 处理过的派单请求。 */
  dispatches: number
  /** 收到但没人能处理的招募请求数（M7 之前接不上）。 */
  unhandledHires: number
  /** `step()` 抛异常的累计次数。 */
  errors: number
}

/** 运行时端口。 */
export interface RuntimePort {
  readonly running: boolean
  readonly diagnostics: RuntimeDiagnostics
  /** 还没被下一步取走的命令条数（诊断用）。 */
  readonly pending: number
  /**
   * 一条消息从发出到送达要多少 tick。
   *
   * **为什么放在端口上而不是让路由去 import `domain/constants`**：
   * 路由是传输层，它不该认识模拟内核的常量——边界检查器会（也确实）拦下那种 import。
   * 这条延迟属于**模拟的时间语义**，而运行时就是路由能看到模拟的唯一出口。
   * 顺带它也解决了一个更实际的问题：渲染层拿到它才能算"纸条飞到哪了"，
   * 否则就得自己抄一遍这个数字，改一处就会让纸条落点与"已送达"对不上。
   */
  readonly messageDeliveryTicks: number
  /**
   * 把一条命令排进"下一步要处理"的队列。
   *
   * **不是立刻执行**：命令要经 `step()` 的 ingest 段，才能保证它影响的是
   * "命令到达的那一 tick"，而不是"HTTP 请求到达的那个瞬间"——
   * 后者会让世界的行为取决于网络时序，破坏确定性。
   *
   * 队满时**抛错**而不是静默丢弃：静默丢弃会让"我点了暂停它没停"无从解释。
   */
  enqueue(command: WorldCommand): void
}
