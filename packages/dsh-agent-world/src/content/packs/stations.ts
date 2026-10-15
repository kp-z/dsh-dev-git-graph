/**
 * 默认小镇的站点定义。
 *
 * ## 为什么单独一个模块（R48 从 `default.ts` 搬出来）
 *
 * `pack.kenney-furniture` 要**复用同一份锚点与能力**、只把外观换成组合件（M4-11）。
 * 而 `default.ts` 的 `builtinPacks()` 引用了家具包——两边互相 import 会变成循环，
 * 运行时表现为 `ReferenceError: Cannot access 'DEFAULT_STATIONS' before initialization`，
 * 而**整个内容层加载失败**（一次报 22 个测试红，看起来像 22 个不同的错）。
 *
 * 抽成独立模块是最小的修法：**依赖方向变成单向**（两边 → `stations.ts`）。
 *
 * 每个站点声明**一件**家具（`model`）；"一个工位是桌+椅+显示器"这种组合由
 * 家具包用 `props` 补上——那些小件是那套 GLB 才有的东西。
 */
import type { StationEntry } from '../kinds.js'

export const DEFAULT_STATIONS: StationEntry[] = [
  { id: 'station.desk-a', name: '工位 A', kind: 'desk', district: 'district.engineering', relativeTo: 'district.engineering', anchor: { x: -1, z: -1 }, capacity: 1, capabilities: ['code'], model: 'model.station.desk' },
  { id: 'station.desk-b', name: '工位 B', kind: 'desk', district: 'district.engineering', relativeTo: 'district.engineering', anchor: { x: 1.5, z: -1 }, capacity: 1, capabilities: ['code'], model: 'model.station.desk' },
  { id: 'station.desk-c', name: '工位 C', kind: 'desk', district: 'district.engineering', relativeTo: 'district.engineering', anchor: { x: -1, z: 1.5 }, capacity: 1, capabilities: ['code'], model: 'model.station.desk' },
  { id: 'station.review-table', name: '评审桌', kind: 'desk', district: 'district.engineering', relativeTo: 'district.engineering', anchor: { x: 1.5, z: 1.5 }, capacity: 2, capabilities: ['review'], model: 'model.station.desk' },
  { id: 'station.server-rack', name: '机柜', kind: 'server', district: 'district.infra', relativeTo: 'district.infra', anchor: { x: -2, z: -1 }, capacity: 1, capabilities: ['compute'], model: 'model.station.server' },
  { id: 'station.lab-bench', name: '实验台', kind: 'lab', district: 'district.infra', relativeTo: 'district.infra', anchor: { x: 1.5, z: -1 }, capacity: 1, capabilities: ['research'], model: 'model.station.lab' },
  { id: 'station.war-room', name: '作战室', kind: 'meeting', district: 'district.meeting', relativeTo: 'district.meeting', anchor: { x: -1, z: -1 }, capacity: 4, capabilities: ['converse'], model: 'model.station.meeting' },
  { id: 'station.board', name: '告示板', kind: 'meeting', district: 'district.meeting', relativeTo: 'district.meeting', anchor: { x: 1.5, z: -1 }, capacity: 1, capabilities: ['review', 'converse'], model: 'model.station.meeting' },
  { id: 'station.mailroom', name: '收发室', kind: 'mailroom', district: 'district.commons', relativeTo: 'district.commons', anchor: { x: -1, z: -1 }, capacity: 1, capabilities: ['deliver'], model: 'model.station.mailroom' },
  { id: 'station.breakroom', name: '休息区', kind: 'breakroom', district: 'district.commons', relativeTo: 'district.commons', anchor: { x: 1.5, z: -1 }, capacity: 3, capabilities: ['rest'], model: 'model.station.breakroom' },
]
