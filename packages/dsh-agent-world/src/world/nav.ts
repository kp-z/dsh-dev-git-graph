/**
 * 从**内容**搭出导航网格（R64 物理）。
 *
 * 存在的理由与 `hangoutsForWorld` 完全一样：**建世界与读档重算必须共用同一个函数**。
 * 两份实现一定会漂移，而那时的症状是"新开一局走得对、读旧档穿墙"，
 * 且只在旧档上复现——R47/R48 那个坑就是这个形状。
 *
 * ## 数据从哪来
 *
 * `maps` 库的条目带 `walkable`（一维布尔数组，由原版 Godot 图块的**物理多边形**解出，
 * 见 `scripts/convert-microverse-map.mjs`）。所以这里是纯换算，不猜任何东西：
 *
 * ```text
 * 地图 37×21 格、一格 32px、一格 = 2 世界单位
 * 世界左上角 = (-halfW, -halfH) = (-37, -21)        ← 世界坐标是中心为 0
 * 格 (col,row) 的中心 = (-37 + (col+0.5)*2, -21 + (row+0.5)*2)
 * ```
 */
import type { MapEntry } from '../content/kinds.js'
import type { NavGrid, Vec2 } from '../domain/types.js'

/** 把 `maps` 条目变成 `NavGrid`；条目没带 `walkable` 就返回 null（退回直线走）。 */
export function navFromMap(map: MapEntry | null | undefined): NavGrid | null {
  if (map === null || map === undefined) return null
  const walkable = (map as { walkable?: readonly boolean[] }).walkable
  if (!Array.isArray(walkable) || walkable.length !== map.width * map.height) return null
  const unitsPerCell = map.unitsPerCell
  return {
    width: map.width,
    height: map.height,
    unitsPerCell,
    // 世界是中心为 0，网格是左上角为 0 —— 这就是那半个地图的偏移，差一点整张图就错位。
    originX: -(map.width * unitsPerCell) / 2,
    originZ: -(map.height * unitsPerCell) / 2,
    blocked: walkable.map((v) => v !== true),
  }
}

/**
 * 离 `p` 最近的可行走格中心（确定性：同半径按格序号取最小）。
 *
 * 用途：地图更新后，存档里可能有人正站在"现在不能走"的格上（R229 的家具占位就是这样
 * 把 leader 所在格变成不可走的）。不修的话，他会被物理体卡在桌子里。返回 null =
 * 整张图没有可走格（内容坏了），调用方应当保留原位置而不是瞎挪。
 */
export function nearestWalkablePoint(nav: NavGrid, p: Vec2): Vec2 | null {
  const col = Math.round((p.x - nav.originX) / nav.unitsPerCell - 0.5)
  const row = Math.round((p.z - nav.originZ) / nav.unitsPerCell - 0.5)
  const walkable = (c: number, r: number): boolean => {
    if (c < 0 || c >= nav.width || r < 0 || r >= nav.height) return false
    return nav.blocked[r * nav.width + c] !== true
  }
  if (walkable(col, row)) return { x: p.x, z: p.z }
  const maxR = Math.max(nav.width, nav.height)
  for (let radius = 1; radius < maxR; radius += 1) {
    let best: { c: number; r: number } | null = null
    for (let dr = -radius; dr <= radius; dr += 1) {
      for (let dc = -radius; dc <= radius; dc += 1) {
        if (Math.abs(dr) !== radius && Math.abs(dc) !== radius) continue
        const c = col + dc
        const r = row + dr
        if (!walkable(c, r)) continue
        if (best === null || r * nav.width + c < best.r * nav.width + best.c) best = { c, r }
      }
    }
    if (best !== null) {
      return {
        x: nav.originX + (best.c + 0.5) * nav.unitsPerCell,
        z: nav.originZ + (best.r + 0.5) * nav.unitsPerCell,
      }
    }
  }
  return null
}
