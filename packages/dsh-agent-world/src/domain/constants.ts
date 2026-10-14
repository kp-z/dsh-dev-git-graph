/**
 * 世界常量 —— 布局、配色、调参（BACKLOG M1-1）。
 *
 * 这里放的都是"改一个数就会改变世界观感或手感"的值，集中一处便于调。
 * 凡是**推导得出来**的值都不要放这里（例如站点坐标由 `create.ts` 从地段 bounds 推），
 * 否则两处真相早晚打架。
 */
import type { Capability, District, DistrictKind, Station, StationKind } from './types.js'

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

// ── 配色 ────────────────────────────────────────────────────────────────────
//
// 美术方向（docs/ARCHITECTURE.md §5.4）：CC0 低多边形 + 温暖斜俯视。
// 参考《Monument Valley》的配色克制、《Animal Crossing》的暖光、《Mini Motorways》的极简几何。
// 所以：**低饱和暖色地面 + 高饱和角色**，角色永远是画面里最跳的那个东西。

/** 地段地面色。低饱和、暖，彼此只差一点点，靠明度区分而不是靠色相。 */
export const DISTRICT_GROUND: Record<DistrictKind, string> = {
  engineering: '#6f7d5a',
  meeting: '#8a7a5c',
  infra: '#5c6b78',
  commons: '#7d6f5a',
}

/** 角色配色。高饱和，同名角色固定同色（由 createWorld 用 rng 分配后写死）。 */
export const AGENT_PALETTE = [
  '#e8552f',
  '#f2a03d',
  '#4fa3d1',
  '#6fbf73',
  '#a86bd1',
  '#e05a8a',
  '#d9c04a',
  '#3fb8a8',
] as const

/** 职业主色：lead 永远是暖金，好在小镇里一眼找到"工头"。 */
export const ROLE_COLOR: Record<string, string> = {
  lead: '#f0b429',
  engineer: '#4fa3d1',
  reviewer: '#a86bd1',
  researcher: '#3fb8a8',
  ops: '#e05a8a',
  docs: '#6fbf73',
}

// ── 默认小镇 ────────────────────────────────────────────────────────────────
//
// 布局规则：小镇是 16x16 的世界单位，原点在中心，四个地段按象限分。
// 这样 (0,0) 永远是小镇中心广场，相机默认就看向这里。

/** 小镇半边长。世界坐标范围 [-TOWN_HALF, TOWN_HALF]。 */
export const TOWN_HALF = 8

/** 默认地段。bounds 是占地矩形。 */
export const DEFAULT_DISTRICTS: readonly District[] = [
  {
    id: 'engineering',
    name: '工程区',
    kind: 'engineering',
    bounds: { min: { x: -TOWN_HALF, z: -TOWN_HALF }, max: { x: 0, z: 0 } },
    ground: DISTRICT_GROUND.engineering,
  },
  {
    id: 'infra',
    name: '机房',
    kind: 'infra',
    bounds: { min: { x: 0, z: -TOWN_HALF }, max: { x: TOWN_HALF, z: 0 } },
    ground: DISTRICT_GROUND.infra,
  },
  {
    id: 'meeting',
    name: '会议区',
    kind: 'meeting',
    bounds: { min: { x: -TOWN_HALF, z: 0 }, max: { x: 0, z: TOWN_HALF } },
    ground: DISTRICT_GROUND.meeting,
  },
  {
    id: 'commons',
    name: '公共区',
    kind: 'commons',
    bounds: { min: { x: 0, z: 0 }, max: { x: TOWN_HALF, z: TOWN_HALF } },
    ground: DISTRICT_GROUND.commons,
  },
] as const

/**
 * 站点模板：`slots` 是按 capacity 生成的环形/并排偏移。
 *
 * 之所以在这里用「声明式模板 + 由 create.ts 实例化」，是因为站点坐标全都锚定在
 * 地段的中心，改动小镇尺寸时不用手改十个坐标。
 */
export interface StationTemplate {
  id: string
  name: string
  kind: StationKind
  district: string
  /** 相对地段中心的偏移。 */
  offset: { x: number; z: number }
  capacity: number
  capabilities: Capability[]
}

export const DEFAULT_STATIONS: readonly StationTemplate[] = [
  // 工程区：三张工位，写代码；一张评审桌，评审也在这里（紧凑的小镇，不必为评审单开楼）。
  { id: 'desk-a', name: '工位 A', kind: 'desk', district: 'engineering', offset: { x: -5, z: -5 }, capacity: 1, capabilities: ['code'] },
  { id: 'desk-b', name: '工位 B', kind: 'desk', district: 'engineering', offset: { x: -2.5, z: -5 }, capacity: 1, capabilities: ['code'] },
  { id: 'desk-c', name: '工位 C', kind: 'desk', district: 'engineering', offset: { x: -5, z: -2.5 }, capacity: 1, capabilities: ['code'] },
  { id: 'review-table', name: '评审桌', kind: 'desk', district: 'engineering', offset: { x: -2.5, z: -2.5 }, capacity: 2, capabilities: ['review'] },
  // 机房：跑测试/构建的地方。
  { id: 'server-rack', name: '机柜', kind: 'server', district: 'infra', offset: { x: 4, z: -5 }, capacity: 1, capabilities: ['compute'] },
  { id: 'lab-bench', name: '实验台', kind: 'lab', district: 'infra', offset: { x: 4, z: -2.5 }, capacity: 1, capabilities: ['research'] },
  // 会议区：派单与讨论。
  { id: 'war-room', name: '作战室', kind: 'meeting', district: 'meeting', offset: { x: -4, z: 4 }, capacity: 4, capabilities: ['converse'] },
  { id: 'board', name: '告示板', kind: 'meeting', district: 'meeting', offset: { x: -2, z: 4 }, capacity: 1, capabilities: ['review', 'converse'] },
  // 公共区：收发与休息。
  { id: 'mailroom', name: '收发室', kind: 'mailroom', district: 'commons', offset: { x: 4, z: 4 }, capacity: 1, capabilities: ['deliver'] },
  { id: 'breakroom', name: '休息区', kind: 'breakroom', district: 'commons', offset: { x: 2, z: 4 }, capacity: 3, capabilities: ['rest'] },
] as const

/** 地段中心（由 bounds 推，不手写）。 */
export function districtCenter(bounds: { min: { x: number; z: number }; max: { x: number; z: number } }): {
  x: number
  z: number
} {
  return {
    x: (bounds.min.x + bounds.max.x) / 2,
    z: (bounds.min.z + bounds.max.z) / 2,
  }
}

/**
 * 生成站点的 slot 偏移。
 *
 * 单容量：就站中心。
 * 多容量：沿 x 轴并排，间距 0.9 —— 会议桌那种"大家围一圈"的精确排布留给渲染层，
 * domain 只保证**不重叠**，因为重叠会让寻路卡住。
 */
export function slotsFor(capacity: number): { x: number; z: number }[] {
  if (capacity <= 1) return [{ x: 0, z: 0 }]
  const gap = 0.9
  const start = -((capacity - 1) * gap) / 2
  return Array.from({ length: capacity }, (_, i) => ({ x: start + i * gap, z: 0 }))
}

/** 站点的能力 → 工位颜色（渲染层用；domain 只提供数据，不强制）。 */
export const STATION_KIND_COLOR: Record<StationKind, string> = {
  desk: '#c9a227',
  meeting: '#b06a3b',
  server: '#4a5a6a',
  mailroom: '#8f6f4a',
  lab: '#5f8f7a',
  breakroom: '#7a8f5f',
}

/** 把 StationTemplate 实例化成 Station（地段中心 + 偏移）。 */
export function instantiateStation(template: StationTemplate, center: { x: number; z: number }): Station {
  return {
    id: template.id,
    name: template.name,
    kind: template.kind,
    district: template.district,
    anchor: { x: center.x + template.offset.x, z: center.z + template.offset.z },
    capacity: template.capacity,
    capabilities: [...template.capabilities],
    slots: slotsFor(template.capacity),
  }
}
