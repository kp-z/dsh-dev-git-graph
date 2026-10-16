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
import type { NavGrid } from '../domain/types.js'

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
