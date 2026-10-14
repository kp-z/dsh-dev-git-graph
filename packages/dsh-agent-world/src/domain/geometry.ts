/**
 * 平面几何小工具（BACKLOG M1-7 会用到，M1-2 先用上 stationSlot）。
 *
 * 放在 domain 而不是渲染层，是因为**寻路与到站吸附是业务规则，不是表现**：
 * "角色最终站在哪个点"决定了任务是否算"已到站"，渲染层无权决定。
 */
import type { Station, Vec2 } from './types.js'

/** 两点的欧氏距离（俯视平面）。 */
export function distance(a: Vec2, b: Vec2): number {
  return Math.hypot(b.x - a.x, b.z - a.z)
}

/** a → b 的方向角（弧度，用于 agent.facing）。 */
export function angleTo(a: Vec2, b: Vec2): number {
  return Math.atan2(b.z - a.z, b.x - a.x)
}

/** 朝目标移动最多 `maxStep` 距离，返回新位置与"是否还没到"。 */
export function stepToward(from: Vec2, to: Vec2, maxStep: number): { position: Vec2; arrived: boolean } {
  const d = distance(from, to)
  if (d <= maxStep || d === 0) {
    return { position: { ...to }, arrived: true }
  }
  const t = maxStep / d
  return {
    position: { x: from.x + (to.x - from.x) * t, z: from.z + (to.z - from.z) * t },
    arrived: false,
  }
}

/**
 * 第 `index` 个角色在这个站点应该站的位置（绝对坐标）。
 *
 * 索引超出 slots 长度时取最后一个——**不报错**。理由：容量是软约束，
 * 一个站点偶尔多挤一个人，比让调度器在边界情况下崩掉要好。
 * 真正的容量控制在调度器（claim 之前检查），这里只负责给坐标。
 */
export function stationSlot(station: Station, index: number): Vec2 {
  const slot = station.slots[Math.min(Math.max(index, 0), station.slots.length - 1)]
  if (!slot) return { ...station.anchor }
  return { x: station.anchor.x + slot.x, z: station.anchor.z + slot.z }
}

/** 点是否落在地段的矩形内（用于"角色走出边界"的自检）。 */
export function withinBounds(
  point: Vec2,
  bounds: { min: Vec2; max: Vec2 },
): boolean {
  return (
    point.x >= bounds.min.x &&
    point.x <= bounds.max.x &&
    point.z >= bounds.min.z &&
    point.z <= bounds.max.z
  )
}

/** 把弧度规整到 (-π, π]。 */
export function normalizeAngle(rad: number): number {
  let a = rad
  while (a > Math.PI) a -= Math.PI * 2
  while (a <= -Math.PI) a += Math.PI * 2
  return a
}
