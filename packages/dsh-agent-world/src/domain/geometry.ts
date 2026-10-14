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

/**
 * 在一个矩形里排布 `count` 个尽量分散的点（确定性栅格）。
 *
 * 用途是"待命的角色站在哪"（BACKLOG M2.5-1）。选栅格而不是随机：
 * 模拟内核不许用 `Math.random()`，而且随机点在重开一局后位置会变——
 * "同 seed 同结果"这条性质不该为了让人站得好看而破掉。
 */
export function latticeIn(bounds: { min: Vec2; max: Vec2 }, count: number): Vec2[] {
  if (count <= 0) return []

  const cols = Math.max(1, Math.ceil(Math.sqrt(count)))
  const rows = Math.max(1, Math.ceil(count / cols))

  const minX = Math.min(bounds.min.x, bounds.max.x)
  const maxX = Math.max(bounds.min.x, bounds.max.x)
  const minZ = Math.min(bounds.min.z, bounds.max.z)
  const maxZ = Math.max(bounds.min.z, bounds.max.z)

  // 内缩 20%：贴着地块边缘站，看起来像随时要走出去。
  const x0 = minX + (maxX - minX) * 0.2
  const x1 = maxX - (maxX - minX) * 0.2
  const z0 = minZ + (maxZ - minZ) * 0.2
  const z1 = maxZ - (maxZ - minZ) * 0.2

  const out: Vec2[] = []
  for (let i = 0; i < count; i++) {
    const c = i % cols
    const r = Math.floor(i / cols)
    out.push({
      // 只有一列/一行时就取中点，否则按比例铺开（避免除以 0）。
      x: cols === 1 ? (x0 + x1) / 2 : x0 + ((x1 - x0) * c) / (cols - 1),
      z: rows === 1 ? (z0 + z1) / 2 : z0 + ((z1 - z0) * r) / (rows - 1),
    })
  }
  return out
}

/**
 * 矩形的中心点。
 *
 * 住在几何层而不是内容层：它是纯粹的形状运算，内容层只是它的一个调用方。
 * （R8 之前它在 `content/instantiate.ts` 里叫 `districtCenter`，导致场景描述层
 * 为了算一个中心点就得 import 整个内容层。）
 */
export function boundsCenter(bounds: { min: Vec2; max: Vec2 }): Vec2 {
  return { x: (bounds.min.x + bounds.max.x) / 2, z: (bounds.min.z + bounds.max.z) / 2 }
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
