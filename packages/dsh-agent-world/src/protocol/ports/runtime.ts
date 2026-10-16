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
  /**
   * 落盘失败次数。
   *
   * **必须有出口**：写盘失败是那种"世界照常在跑、但存档其实是坏的"的故障，
   * 没有计数就只能靠翻日志。面板读到非 0 会直接在状态条上报警。
   */
  persistErrors: number
  /**
   * **最近一次调度里"派不出去"的单**（R67）。
   *
   * ## 为什么要有这个字段
   *
   * `claimTasks()` 一直在算这个列表（`{ taskId, reason, detail }`，`detail` 是给人看的中文，
   * 例如"没有任何站点能承载能力 [research] 且还有空位"），但**从来没有出口**——
   * 算完就丢。于是面板只能看到"这张单挂着"，而**看不到"为什么没人接它"**。
   * 用户的原话是"让他们干活"，而"不动且不说为什么"正是最像坏掉的状态。
   *
   * ## 语义（三条，别误解）
   *
   * · 这是**最近一次**调度的快照，不是累积——上一 tick 卡住的单这一 tick 能派了，它就不在里面；
   * · 一张单**每 tick 至多一条**（同一张单不会因为多个原因重复出现）；
   * · **有上限**（见 `STALLED_DIAGNOSTIC_CAP`）：它只用于"让用户看懂卡在哪"，
   *   不是审计日志。没有上限的话，"100 张单没工位"会让每帧的快照都背 100 条。
   *
   * ⚠️ 它**只解释"调度器为什么现在不派"**。另一类"永远等不到"（`blockedBy` 里有失败的单）
   * 是**任务表自身的性质**，由面板从 `tasks` 直接算出来即可，不必也不该走这个字段——
   * 两件事的出口不同：那个是"这张单已经死了"，这个是"这张单还活着但此刻派不出去"。
   */
  stalled: readonly StalledTask[]
}

/** 一张"派不出去"的单（`RuntimeDiagnostics.stalled` 的元素）。 */
export interface StalledTask {
  readonly taskId: string
  /**
   * 派不出去的原因类别。
   *
   * · `no-worker` —— 没有空闲的人（都在忙，或者等着外部团队指派）；
   * · `no-station` —— 没有人能承载它要求的能力（`requires`）的空位。
   *
   * 用**联合类型**而不是自由字符串：面板要按类别给不同的提示，而自由字符串会让
   * "加了一个新原因但面板没处理"变成静默的显示错误。
   */
  readonly reason: 'no-station' | 'no-worker'
  /** 给人看的说明（中文，可直接显示）。 */
  readonly detail: string
}

/**
 * `stalled` 的上限。
 *
 * 定成 20 的理由：面板一次能读的"卡住原因"不超过一屏；而它的用途是**归因**
 *（"为什么不动"），不是列出每一张。真的卡了 100 张时，用户需要知道的是
 *"有一批单没工位"，而不是逐条读 100 行。
 */
export const STALLED_DIAGNOSTIC_CAP = 20

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
