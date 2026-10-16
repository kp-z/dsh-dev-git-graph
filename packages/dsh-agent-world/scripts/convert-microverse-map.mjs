#!/usr/bin/env node
/**
 * 把 Microverse 的 Godot 场景（`scene/maps/Office.tscn`）转成我们的内容格式（R61）。
 *
 * ## 为什么要有这个脚本，而不是"我手工把那 1300 格抄一遍"
 *
 * Microverse 是一个**做好的游戏**，办公室是它设计好的关卡。我们最初的做法是拿它的素材
 * **自己重新拼**一个办公室——结果很难看，而且和原版毫无关系。正确做法是**把它解出来**。
 *
 * 手工抄不可行也不可维护（原版换地图、我们想换房间，都得重来），所以要一个**可重跑的转换器**。
 *
 * ## 输入依赖
 *
 * 需要一份 Microverse 的 checkout（脚本不自己去 clone，因为网络与体积都不可控）：
 *
 *   git clone --depth 1 https://github.com/KsanaDock/Microverse.git /tmp/microverse
 *   node scripts/convert-microverse-map.mjs /tmp/microverse scene/maps/Office.tscn
 *
 * ## Godot 场景格式（三处踩过的坑，都写在这里免得下一个人重踩）
 *
 * 1. **`tile_map_data` 有 2 字节文件头**。Godot 4 的 `TileMapLayer` 把它存成
 *    `PackedByteArray`：先是 2 字节（版本/标记），然后**每格 12 字节**：
 *    `int16 x, int16 y, int16 source_id, int16 atlas_x, int16 atlas_y, int16 alternative`。
 *    我一开始按"无头、12 字节"解，结果 9326 字节除不尽，而且解出来"37 格全在 x=0 一列"——
 *    那种荒谬结果就是**格式解错**的信号，不要当数据怪。
 * 2. **`RectangleShape2D` 用的是 `size`（全宽全高），不是 `extents`（半宽）**。
 *    按 `extents` 解会得到 0 个房间（一个字段名之差，静默失败）。
 * 3. 图集要靠**两级间接**才能拿到：`TileSet.sources/<id> = SubResource(...)`
 *    → `TileSetAtlasSource.<id>.texture = ExtResource(...)` → `ext_resource.path`。
 *
 * ## 输出
 *
 * `--out` 指定的 TS 模块（缺省 `src/content/packs/office-map.ts`），导出：
 * - `OFFICE_MAP`：尺寸、图层（每格 `[x, y, 图集序号, atlas_x, atlas_y]`）、房间、家具实例
 *
 * **这个文件是生成的，不要手改**——改转换器然后重跑。
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname } from 'node:path'

const repo = process.argv[2]
const sceneArg = process.argv[3] ?? 'scene/maps/Office.tscn'
const outIdx = process.argv.indexOf('--out')
if (repo === undefined) {
  console.error('用法: node scripts/convert-microverse-map.mjs <microverse 仓库路径> [场景相对路径] [--out 输出.ts]')
  process.exit(1)
}
const scenePath = `${repo.replace(/\/$/, '')}/${sceneArg}`
const outPath = outIdx >= 0 ? process.argv[outIdx + 1] : 'src/content/packs/office-map.ts'

const src = readFileSync(scenePath, 'utf8')

// ── ① ext_resource：id → 资源路径（纹理与 PackedScene 都走它）────────────────
const extById = new Map()
for (const m of src.matchAll(/\[ext_resource type="([^"]+)"[^\]]*path="res:\/\/([^"]+)" id="([^"]+)"\]/g)) {
  extById.set(m[3], { type: m[1], path: m[2] })
}

// ── ② TileSetAtlasSource：图集 → 纹理路径 ────────────────────────────────────
const atlasTexture = new Map()
for (const m of src.matchAll(/\[sub_resource type="TileSetAtlasSource" id="([^"]+)"\]\s*\ntexture = ExtResource\("([^"]+)"\)/g)) {
  const ext = extById.get(m[2])
  if (ext !== undefined) atlasTexture.set(m[1], ext.path)
}

// ── ③ TileSet：source_id → 图集（**按 TileSet 分开存**）────────────────────────
//
// ⚠️ 这个文件里有**两个 TileSet**（`TileSet_bnfxt` 与 `TileSet_pbbta`），而每个
// `TileMapLayer` 用 `tile_set = SubResource(...)` **各自指定**用哪一个。
// 我第一版把全文件的 `sources/N` 平铺成一张表 → **后一个 TileSet 覆盖前一个**，
// 于是解出来的图集清单是错的（多出几个、少几个都看不出来，只是画面会怪）。
// 正确做法：先按 TileSet 分组，再按图层引用的那个查。
const sourceToAtlasByTileset = new Map()
for (const m of src.matchAll(/\[sub_resource type="TileSet" id="([^"]+)"\]([\s\S]*?)(?=\n\[sub_resource|\n\[node|\n?$)/g)) {
  const table = new Map()
  for (const s of m[2].matchAll(/sources\/(\d+) = SubResource\("([^"]+)"\)/g)) table.set(Number(s[1]), s[2])
  sourceToAtlasByTileset.set(m[1], table)
}
/** 图层没写 tile_set 时的兜底：只有一个 TileSet 的场景照常能跑。 */
const soleTileset = sourceToAtlasByTileset.size === 1 ? [...sourceToAtlasByTileset.keys()][0] : null

// ── ④ 图层：解 tile_map_data ─────────────────────────────────────────────────
const layers = []
for (const m of src.matchAll(/\[node name="([^"]+)" type="TileMapLayer"[^\]]*\]([\s\S]*?)(?=\n\[node |\n?$)/g)) {
  const name = m[1]
  const data = /tile_map_data = PackedByteArray\("([^"]+)"\)/.exec(m[2])
  if (data === null) continue
  // 这一层用哪个 TileSet（决定 source_id 怎么查）
  const tsId = /tile_set = SubResource\("([^"]+)"\)/.exec(m[2])?.[1] ?? soleTileset
  const sourceToAtlas = sourceToAtlasByTileset.get(tsId) ?? new Map()
  if (sourceToAtlas.size === 0) console.warn(`⚠️  ${name}: 找不到 TileSet ${tsId} 的 source 映射`)
  const raw = Buffer.from(data[1], 'base64')
  const count = Math.floor((raw.length - 2) / 12)
  if ((raw.length - 2) % 12 !== 0) {
    console.warn(`⚠️  ${name}: (${raw.length} - 2) 不能被 12 整除，格式可能变了`)
  }
  const cells = []
  const usedAtlas = []
  for (let i = 0; i < count; i++) {
    const o = 2 + i * 12
    const [x, y, s, ax, ay] = [raw.readInt16LE(o), raw.readInt16LE(o + 2), raw.readInt16LE(o + 4), raw.readInt16LE(o + 6), raw.readInt16LE(o + 8)]
    const atlasPath = atlasTexture.get(sourceToAtlas.get(s))
    if (atlasPath === undefined) continue
    const file = atlasPath.split('/').pop()
    let idx = usedAtlas.indexOf(file)
    if (idx < 0) { usedAtlas.push(file); idx = usedAtlas.length - 1 }
    cells.push([x, y, idx, ax, ay])
  }
  layers.push({ name, atlasFiles: usedAtlas, cells })
}

// ── ⑤ 房间：Area2D(groups=room_area) + 紧跟的 CollisionShape2D ────────────────
// Godot 4 的 RectangleShape2D 用 `size`（全宽全高），半宽 = size / 2。
const shapeHalf = new Map()
for (const m of src.matchAll(/\[sub_resource type="RectangleShape2D" id="([^"]+)"\]\s*\nsize = Vector2\(([\d.]+), ([\d.]+)\)/g)) {
  shapeHalf.set(m[1], [Number(m[2]) / 2, Number(m[3]) / 2])
}
const blocks = src.split(/\n(?=\[node )/)
const rooms = []
const objects = []
let pendingRoom = null
for (const b of blocks) {
  const head = /^\[node name="([^"]+)"(?: type="([^"]+)")?(?: parent="([^"]+)")?(?: instance=ExtResource\("([^"]+)"\))?/.exec(b)
  if (head === null) continue
  const [, name, type, parent, instance] = head
  if (type === 'Area2D' && b.includes('room_area')) {
    pendingRoom = {
      node: name,
      name: /room_name = "([^"]*)"/.exec(b)?.[1] ?? '未命名房间',
      desc: /room_desc = "([^"]*)"/.exec(b)?.[1] ?? '',
    }
  } else if (name === 'CollisionShape2D' && pendingRoom !== null) {
    const pos = /position = Vector2\((-?[\d.]+), (-?[\d.]+)\)/.exec(b)
    const shape = /shape = SubResource\("([^"]+)"\)/.exec(b)
    const half = shape !== null ? shapeHalf.get(shape[1]) : undefined
    if (pos !== null && half !== undefined) {
      const [cx, cy] = [Number(pos[1]), Number(pos[2])]
      const [ex, ey] = half
      pendingRoom.rectPx = [cx - ex, cy - ey, cx + ex, cy + ey]
      rooms.push(pendingRoom)
    }
    pendingRoom = null
  } else if (instance !== undefined) {
    const ext = extById.get(instance)
    const pos = /position = Vector2\((-?[\d.]+), (-?[\d.]+)\)/.exec(b)
    if (ext !== undefined && pos !== null && ext.type === 'PackedScene') {
      objects.push({ node: name, parent: parent ?? '.', prefab: ext.path.split('/').pop(), px: [Number(pos[1]), Number(pos[2])] })
    }
  }
}

const width = Math.max(...layers.flatMap((l) => l.cells.map((c) => c[0]))) + 1
const height = Math.max(...layers.flatMap((l) => l.cells.map((c) => c[1]))) + 1
const CELL = 32
const cellRect = (r) => [Math.round(r[0] / CELL), Math.round(r[1] / CELL), Math.round(r[2] / CELL), Math.round(r[3] / CELL)]

const body = `/**
 * **本文件由脚本生成，不要手改**：\`scripts/convert-microverse-map.mjs\`。
 *
 * 数据来源：Microverse 的 \`scene/maps/${sceneArg.split('/').pop()}\`（Godot 场景）。
 * 房间的**名字与描述是原版写好的中文**——它们属于内容库，不是我们编的。
 *
 * 重新生成：
 * \`\`\`sh
 * git clone --depth 1 https://github.com/KsanaDock/Microverse.git /tmp/microverse
 * node scripts/convert-microverse-map.mjs /tmp/microverse ${sceneArg}
 * \`\`\`
 */

export interface OfficeMapLayer {
  readonly name: string
  /** 这一层用到的图集文件名（相对 \`vendor/microverse/maps/\`），格子里存的是它的下标。 */
  readonly atlasFiles: readonly string[]
  /** 每格 \`[x, y, 图集下标, atlas_x, atlas_y]\`。 */
  readonly cells: ReadonlyArray<readonly number[]>
}

export interface OfficeMapRoom {
  readonly node: string
  readonly name: string
  readonly desc: string
  /** 像素矩形 \`[x0, y0, x1, y1]\`（原版坐标）。 */
  readonly rectPx: readonly number[]
}

export interface OfficeMapObject {
  readonly node: string
  readonly parent: string
  readonly prefab: string
  /** 像素中心（原版坐标）。 */
  readonly px: readonly number[]
}

export const OFFICE_MAP = {
  /** 地图尺寸（格）。 */
  width: ${width},
  height: ${height},
  /** 一格多少像素。 */
  cellPx: ${CELL},
  /** 场景来源（供追溯）。 */
  source: 'microverse/${sceneArg}',
  layers: ${JSON.stringify(layers.map((l) => ({ name: l.name, atlasFiles: l.atlasFiles, cells: l.cells })))},
  rooms: ${JSON.stringify(rooms.map((r) => ({ node: r.node, name: r.name, desc: r.desc, rectPx: r.rectPx })))},
  objects: ${JSON.stringify(objects)},
  /** 房间的格矩形（由 \`rectPx\` 算出来，单独存一份省得每处都算）。 */
  roomsInCells: ${JSON.stringify(rooms.map((r) => ({ node: r.node, name: r.name, cells: cellRect(r.rectPx) })))},
} as const
`

mkdirSync(dirname(outPath), { recursive: true })
writeFileSync(outPath, body)

const cellTotal = layers.reduce((a, l) => a + l.cells.length, 0)
console.log(`  ✓ ${outPath}`)
console.log(`    地图 ${width}×${height} 格 · ${layers.length} 层 · ${cellTotal} 格`)
console.log(`    房间 ${rooms.length} 个：${rooms.map((r) => r.name).join('、')}`)
console.log(`    家具/角色实例 ${objects.length} 个`)
console.log(`    用到的图集 ${[...new Set(layers.flatMap((l) => l.atlasFiles))].length} 个`)
