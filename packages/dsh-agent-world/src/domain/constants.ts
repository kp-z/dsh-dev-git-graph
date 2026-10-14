/**
 * 数值调参常量（BACKLOG M1-5）。
 *
 * ## 这里只放"数字"，不放"内容"
 *
 * 分层规矩（决策 D10）：
 * - **代码 = 机制**：怎么走、怎么调度、多少 tick 一次。→ 本文件。
 * - **内容 = 数据**：小镇长什么样、有哪几个站点、角色叫什么、走路播哪个剪辑。
 *   → `src/content/packs/`。
 *
 * 所以 `DEFAULT_DISTRICTS` / `AGENT_PALETTE` / `ROLE_COLOR` 这些**已经搬走了**
 * （R1 时它们硬编码在这里，是"内容与代码混着"的典型症状，见 PROGRESS 的 R2 记录）。
 * 谁还想往本文件加"某个站点叫什么"，请先看决策 D10。
 */

/** 逻辑 tick 间隔（ms）。10Hz 足够，渲染层负责插值出 60fps。 */
export const DEFAULT_TICK_MS = 100

/** 事件环形缓冲上限。够 HUD 回看，又不至于把 world.json 撑爆。 */
/**
 * 邮箱里最多留多少条消息。
 *
 * `events` 早就有环形缓冲，`messages` 之前没有——因为 R6 之前**没有任何东西会发消息**，
 * 它永远是空的。M2.5-2 接上发送方之后就不一样了：一张工单两次消息，
 * 跑一整天就是几百条。所以现在补上界。
 *
 * 裁剪只丢**已送达**的旧消息：未送达的纸条还在飞，丢了就是渲染层凭空少一张纸。
 */
export const MESSAGE_RING_SIZE = 200

export const EVENT_RING_SIZE = 500

/** 角色一条 tick 的移动速度（世界单位 / tick）。走一个地块约 1 秒。 */
export const WALK_SPEED = 0.06

/**
 * 到一个站点后，一条 tick 推进多少进度。1 / 这个值 = 需要多少 tick。
 *
 * 这是**兜底**：任务在内容库里声明了 `estimateTicks` 时用那个值（让"预估"真的有含义），
 * 没声明才用它。
 */
export const WORK_SPEED = 0.004

/** 没声明 `estimateTicks` 的任务，默认要多少 tick 完成。 */
export const DEFAULT_TASK_TICKS = Math.round(1 / WORK_SPEED)

/**
 * 一条消息要飞多少个 tick 才送达。
 *
 * 写死在常量里而不是由内容决定：它是**模拟的时间语义**，不是可替换的美术。
 * 立刻送达会让渲染层只能看到纸条瞬移；延迟太久又像卡住了。10 tick ≈ 1 秒。
 */
export const MESSAGE_DELIVERY_TICKS = 10

/**
 * 进度里程碑的粒度：每推进 10% 记一条事件。
 *
 * 为什么需要它：进度每 tick 都在变，如果每次都发事件，24 个角色 ≈ 每秒上百条，
 * 会把"环形缓冲只留 500 条"冲爆，客户端也会被淹。里程碑让事件量与**任务数**相关，
 * 而不是与**tick 数**相关。HUD 的进度条不需要每一帧都收到推送——它自己插值。
 */
export const PROGRESS_MILESTONES = 10

/** 同屏角色上限。超过就排队等待招募（性能预算，见 docs/ARCHITECTURE.md §5.3）。 */
export const MAX_AGENTS = 24

/**
 * 生成站点的 slot 偏移。
 *
 * 单容量：就站中心。
 * 多容量：沿 x 轴并排，间距 0.9 —— 会议桌那种"大家围一圈"的精确排布留给渲染层，
 * content 层只保证**不重叠**，因为重叠会让寻路卡住。
 */
export function slotsFor(capacity: number): { x: number; z: number }[] {
  if (capacity <= 1) return [{ x: 0, z: 0 }]
  const gap = 0.9
  const start = -((capacity - 1) * gap) / 2
  return Array.from({ length: capacity }, (_, i) => ({ x: start + i * gap, z: 0 }))
}
