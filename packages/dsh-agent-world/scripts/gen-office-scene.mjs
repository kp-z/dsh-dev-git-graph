#!/usr/bin/env node
/**
 * 从 `office-map.ts`（R61 解出来的原版场景）生成**内容包**：房间 → 分区、椅子 → 站点。
 *
 * ## 为什么站点不需要 props
 *
 * 之前每个站点要手写 `props`（桌、椅、显示器…）。现在**地图本身就把家具画好了**
 * （1322 格原版图块），所以站点只需要"人站哪 + 能干什么"。这是复原原版场景带来的
 * 一个真实简化：家具位置不再是我们维护的数据。
 *
 * ## 坐标
 *
 * 地图 37×21 格、一格 32px。取 **1 格 = 2 世界单位**（延续"16 源像素 = 1 单位"的老约定），
 * 于是世界是 **74×42 单位**，原点在中心。格坐标 → 世界：`px / 16 - (halfW, halfH)`。
 *
 * ## 房间 → DistrictKind 的映射是**有损的**
 *
 * 原版有 9 个房间，我们的 `DistrictKind` 只有 4 个值（`engineering|meeting|infra|commons`），
 * 而它决定强调色（`accent.<kind>`）。所以 9 个房间会**共用 4 种配色**。
 * 这是刻意的妥协（扩展 `DistrictKind` 会牵动调色板与 UI），写在 `ROOM_KIND` 表里、
 * 一眼能看出哪几个房间同色。
 *
 * 输出 `src/content/packs/office-scene.ts`。**生成物，不要手改**。
 */
import { readFileSync, writeFileSync } from 'node:fs'

const mapSrc = readFileSync('src/content/packs/office-map.ts', 'utf8')
const grab = (key) => {
  const m = new RegExp(`${key}: (\\[[\\s\\S]*?\\]|\\d+),\\n`).exec(mapSrc)
  return m === null ? null : JSON.parse(m[1])
}
const W = Number(/width: (\d+),/.exec(mapSrc)[1])
const H = Number(/height: (\d+),/.exec(mapSrc)[1])
const CELL = Number(/cellPx: (\d+),/.exec(mapSrc)[1])
const rooms = JSON.parse(/rooms: (\[[\s\S]*?\]),\n  objects:/.exec(mapSrc)[1])
const roomsInCells = JSON.parse(/roomsInCells: (\[[\s\S]*?\]),\n\} as const/.exec(mapSrc)[1])
const objects = JSON.parse(/objects: (\[[\s\S]*?\]),\n  \/\*\* 房间的格矩形/.exec(mapSrc)[1])

/** 房间名 → 我们的 `DistrictKind`（有损，见文件头）。 */
const ROOM_KIND = {
  办公室: 'engineering',   // 14 个工位，工程师与财务都在这
  会议室: 'meeting',
  HR办公室: 'engineering',
  老板办公室: 'engineering',
  茶水间: 'commons',
  健身房: 'commons',
  接待处: 'commons',
  等候大厅: 'commons',
  卫生间: 'infra',
}
/** 房间名 → 站点的能力（任务按能力找工位，不直接指定站点）。 */
// ⚠️ 能力是**固定集合**（`Capability`：code|review|research|converse|compute|deliver|rest）。
// 我第一版按房间语义编了 meet/hire/decide/greet/wait —— 验证器全拦了（51 条错误）。
// 这是对的：能力是任务调度的契约，不是自由文本，不能每个房间发明一个。
const ROOM_CAPS = {
  办公室: ['code', 'review'],
  会议室: ['converse'],
  HR办公室: ['review', 'converse'],
  老板办公室: ['converse'],
  茶水间: ['rest'],
  健身房: ['rest'],
  接待处: ['deliver', 'converse'],
  等候大厅: ['rest'],
  卫生间: ['rest'],
}
const ROOM_STATION_KIND = {
  办公室: 'desk', 会议室: 'meeting', HR办公室: 'desk', 老板办公室: 'desk',
  茶水间: 'breakroom', 健身房: 'breakroom', 接待处: 'mailroom', 等候大厅: 'breakroom', 卫生间: 'breakroom',
}

const halfW = (W * 2) / 2
const halfH = (H * 2) / 2
const toWorld = (px) => [round(px[0] / 16 - halfW), round(px[1] / 16 - halfH)]
function round(v) { return Math.round(v * 100) / 100 }

// ── 分区：9 个房间 ───────────────────────────────────────────────────────────
const districts = rooms.map((r, i) => {
  const [c0, r0, c1, r1] = roomsInCells[i].cells
  const kind = ROOM_KIND[r.name] ?? 'commons'
  return {
    id: `district.${i}`, name: r.name, desc: r.desc, kind,
    bounds: { min: { x: c0 * 2 - halfW, z: r0 * 2 - halfH }, max: { x: c1 * 2 - halfW, z: r1 * 2 - halfH } },
  }
})
const roomOf = (px) => rooms.findIndex((r) => px[0] >= r.rectPx[0] && px[0] <= r.rectPx[2] && px[1] >= r.rectPx[1] && px[1] <= r.rectPx[3])

// ── 站点：24 把椅子 ─────────────────────────────────────────────────────────
const chairs = objects.filter((o) => o.prefab.includes('Chair'))
const stations = chairs.map((c, i) => {
  const ri = roomOf(c.px)
  const room = rooms[ri] ?? { name: '办公室' }
  const [x, z] = toWorld(c.px)
  return {
    id: `station.seat-${String(i + 1).padStart(2, '0')}`,
    name: `${room.name}座位 ${i + 1}`,
    kind: ROOM_STATION_KIND[room.name] ?? 'desk',
    district: `district.${ri < 0 ? 0 : ri}`,
    anchor: { x, z }, capacity: 1,
    capabilities: ROOM_CAPS[room.name] ?? ['code'],
    slots: [{ x: 0, z: 0 }],
  }
})

const out = `/**
 * **本文件由脚本生成，不要手改**：\`scripts/gen-office-scene.mjs\`。
 *
 * 内容来源：Microverse 原版场景解出来的 \`office-map.ts\`。
 * **房间名与描述是原版写好的中文**。
 *
 * - 9 个房间 = 分区（\`desc\` 是原版给的房间描述）
 * - 24 把椅子 = 站点（**不需要 props**：地图已经把家具画好了）
 * - 椅子数与原版描述逐房间吻合（办公室 14 = 财务 6 + 工程 8、会议室 4、HR 3、老板 2、接待 1）
 *
 * 重新生成：\`node scripts/gen-office-scene.mjs\`
 */

export interface OfficeSceneDistrict {
  readonly id: string
  readonly name: string
  readonly desc: string
  readonly kind: string
  readonly bounds: { readonly min: { readonly x: number; readonly z: number }; readonly max: { readonly x: number; readonly z: number } }
}

export interface OfficeSceneStation {
  readonly id: string
  readonly name: string
  readonly kind: string
  readonly district: string
  readonly anchor: { readonly x: number; readonly z: number }
  readonly capacity: number
  readonly capabilities: readonly string[]
  readonly slots: ReadonlyArray<{ readonly x: number; readonly z: number }>
}

/** 世界尺寸（世界单位）——由地图格数 × 2 得来。 */
export const OFFICE_WORLD = { halfW: ${halfW}, halfH: ${halfH} } as const

/** 底图（已烘好的整张办公室）。 */
export const OFFICE_BACKGROUND = {
  url: 'microverse/scene/office.png',
  width: ${W},
  height: ${H},
  cellPx: ${CELL},
  /** 一格 = 多少世界单位。 */
  unitsPerCell: 2,
} as const

export const OFFICE_DISTRICTS: readonly OfficeSceneDistrict[] = ${JSON.stringify(districts, null, 2)}

export const OFFICE_STATIONS: readonly OfficeSceneStation[] = ${JSON.stringify(stations, null, 2)}
`
writeFileSync('src/content/packs/office-scene.ts', out)
console.log(`  ✓ src/content/packs/office-scene.ts`)
console.log(`    分区 ${districts.length} 个：${districts.map((d) => d.name).join('、')}`)
console.log(`    站点 ${stations.length} 个（世界 ${halfW * 2}×${halfH * 2}）`)
const byRoom = {}
for (const s of stations) byRoom[s.name.split('座位')[0]] = (byRoom[s.name.split('座位')[0]] ?? 0) + 1
console.log(`    按房间：${Object.entries(byRoom).map(([k, v]) => `${k} ${v}`).join(' / ')}`)
