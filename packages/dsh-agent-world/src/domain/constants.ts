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
export const EVENT_RING_SIZE = 500

/** 角色一条 tick 的移动速度（世界单位 / tick）。走一个地块约 1 秒。 */
export const WALK_SPEED = 0.06

/** 到一个站点后，一条 tick 推进多少进度。1 / 这个值 = 需要多少 tick。 */
export const WORK_SPEED = 0.004

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
