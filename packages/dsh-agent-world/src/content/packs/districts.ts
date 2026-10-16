/**
 * 默认小镇的四个地块。
 *
 * ## 为什么单独一个模块（R55，与 `stations.ts` 同一条理由）
 *
 * `pack.pixel` 要**复用同一份边界**、只声明"地面铺哪张图"。而 `default.ts` 的
 * `builtinPacks()` 引用了 `pixel.ts`——两边互相 import 就是循环，
 * 运行时表现为 `ReferenceError: Cannot access 'DEFAULT_DISTRICTS' before initialization`，
 * 而**整个内容层加载失败**（R48 在站点上踩过同一个坑，这次是地块）。
 *
 * 抽出来之后依赖方向是单向的：`default.ts` 与 `pixel.ts` 都 → `districts.ts`。
 */
import type { DistrictEntry } from '../kinds.js'

/** 小镇边长的一半（世界单位）。地块按四象限切。 */
const HALF = 8

function box(minX: number, minZ: number, maxX: number, maxZ: number) {
  return { min: { x: minX, z: minZ }, max: { x: maxX, z: maxZ } }
}

export const DEFAULT_DISTRICTS: DistrictEntry[] = [
  { id: 'district.engineering', name: '工程区', kind: 'engineering', bounds: box(-HALF, -HALF, 0, 0), ground: 'skin.ground.engineering' },
  { id: 'district.infra', name: '机房', kind: 'infra', bounds: box(0, -HALF, HALF, 0), ground: 'skin.ground.infra' },
  { id: 'district.meeting', name: '会议区', kind: 'meeting', bounds: box(-HALF, 0, 0, HALF), ground: 'skin.ground.meeting' },
  { id: 'district.commons', name: '公共区', kind: 'commons', bounds: box(0, 0, HALF, HALF), ground: 'skin.ground.commons' },
]
