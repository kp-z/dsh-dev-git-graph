/**
 * 把「导航网格 + 精细碰撞体 + 站点」收拢成**一套** `SceneSpace`（R227）。
 *
 * ## 为什么要有这个文件
 *
 * 这三样东西以前各自为政：
 * - `nav.blocked` 决定"能不能走"（服务端寻路）；
 * - `*-colliders.json` 决定"客户端物理挡什么"（手动操控）；
 * - 站点外观自己决定"深度和吸附点"。
 *
 * 三份数据没有互相校验，实测漂移：office 场景 248 个 blocked 格里 **55 格没有碰撞体**，
 * 表现就是"角色能走上墙、能上桌子"。修法不是再补一个特判，而是**先合成一份**，
 * 让所有消费方读同一个结构：
 *
 * | 消费方 | 读什么 |
 * |---|---|
 * | 服务端寻路 / 手动落点 | `nav.blocked` |
 * | 客户端物理 | `obstacles`（fine ∪ 按格补的缺口） |
 * | 渲染深度 | `entities[].base`（底边世界 z） |
 * | 审计 / 调试 | `audit` |
 *
 * ## 这个文件是纯函数
 *
 * 不读盘、不碰 fs、不认渲染器——`node --test` 可以直接验。
 * 从哪读精细碰撞体是调用方（`routes/api.ts`）的事。
 */
import type { NavGrid, Station, Vec2 } from '../domain/types.js'
import type { SceneObstacle, SceneRect, SceneSpace, SceneSpaceEntity } from '../protocol/scene.js'

/** 精细碰撞体的一条：`[x, y, w, h]`，**地图像素坐标**（与底图同源）。 */
export type FineRect = readonly [number, number, number, number]

/** 建空间要的输入。 */
export interface BuildSceneSpaceInput {
  /** 导航网格；null = 没有地图，整套空间数据为 null（老内容回退）。 */
  nav: NavGrid | null
  /** 精细碰撞体（地图像素坐标）；null/空数组 = 没有精细数据，按整格补。 */
  fineRects: readonly FineRect[] | null
  /** 站点（提供占地、深度基准、吸附点）。 */
  stations: readonly Station[]
  /** 美术占位格（`row*width+col`）：画面上明显是家具、但物理多边形漏掉的格子。 */
  occupancyCells?: readonly number[] | null
  /** 小连通块的整块外接矩形（地图像素）；用来让整件物体只补一块，而不是"半截墙"。 */
  occupancyRects?: readonly (readonly [number, number, number, number])[] | null
  /** 是否在读手改覆盖（覆盖时自动推导停用，审计里标明）。 */
  override?: boolean
  /** 一格多少像素；只用于把「地图像素」换算成「世界单位」。 */
  tilePx?: number
}

/** 一格的世界坐标（取格左上角；审计与补格都用它）。 */
function cellRect(nav: NavGrid, col: number, row: number): SceneRect {
  return {
    x: nav.originX + col * nav.unitsPerCell,
    z: nav.originZ + row * nav.unitsPerCell,
    w: nav.unitsPerCell,
    h: nav.unitsPerCell,
  }
}

/** 世界坐标 → 格。与 `sim/pathfind.ts` 的 `cellOf` 同一套取整规则（这里不能 import sim）。 */
function cellOf(nav: NavGrid, p: Vec2): { col: number; row: number } {
  return {
    col: Math.round((p.x - nav.originX) / nav.unitsPerCell - 0.5),
    row: Math.round((p.z - nav.originZ) / nav.unitsPerCell - 0.5),
  }
}

/** 这一格能站吗？越界一律不能（与 `sim/pathfind.ts` 的 `isWalkable` 同义）。 */
function walkable(nav: NavGrid, col: number, row: number): boolean {
  if (col < 0 || col >= nav.width || row < 0 || row >= nav.height) return false
  return nav.blocked[row * nav.width + col] !== true
}

/** 点是否落在矩形里（左闭右闭；审计只需要"格中心有没有被盖住"）。 */
function inside(rect: SceneRect, x: number, z: number): boolean {
  return x >= rect.x && x <= rect.x + rect.w && z >= rect.z && z <= rect.z + rect.h
}

/**
 * 建一套 `SceneSpace`。
 *
 * @returns `nav === null` 时返回 null（老内容没有地图，整套回退）。
 */
export function buildSceneSpace(input: BuildSceneSpaceInput): SceneSpace | null {
  const { nav, stations } = input
  if (nav === null) return null
  const tilePx = Number.isFinite(input.tilePx) && (input.tilePx ?? 0) > 0 ? input.tilePx as number : 16

  // ── 1. 精细碰撞体：地图像素 → 世界单位 ──
  const fine: SceneObstacle[] = []
  for (const rect of input.fineRects ?? []) {
    if (!Array.isArray(rect) || rect.length < 4) continue
    const [rx, ry, rw, rh] = rect
    if (!(rw > 0) || !(rh > 0)) continue
    fine.push({
      x: nav.originX + rx / tilePx,
      z: nav.originZ + ry / tilePx,
      w: rw / tilePx,
      h: rh / tilePx,
      source: 'fine',
    })
  }

  // ── 2. 审计：nav 与精细几何差多少 ──
  //
  // ⚠️ R229 纠正：这里**不再补整格**。R226/R227 曾把"格中心没被盖住"的 blocked 格
  // 补成整格矩形，结果造出一批"看不见的墙"——wall 的美术只占格子的一部分（实测：
  // 113 个 blocked 格是 10%–95% 的部分覆盖），补整格就挡到了视觉上是地板的地方。
  //
  // 物理真相 = **精细几何**（按美术 alpha 算出）；nav 只是寻路用的保守网格。
  // 两者不一致是**已知事实**，用 `uncoveredCells` 报出来，不擅自"修"。
  let blockedCells = 0
  let uncoveredCells = 0
  for (let row = 0; row < nav.height; row += 1) {
    for (let col = 0; col < nav.width; col += 1) {
      if (nav.blocked[row * nav.width + col] !== true) continue
      blockedCells += 1
      const rect = cellRect(nav, col, row)
      const cx = rect.x + rect.w / 2
      const cz = rect.z + rect.h / 2
      if (!fine.some((item) => inside(item, cx, cz))) uncoveredCells += 1
    }
  }

  // ── 3. 实体：占地 + 深度基准 + 吸附点 ──
  const entities: SceneSpaceEntity[] = []
  let slots = 0
  let slotsBlocked = 0
  for (const station of stations) {
    const cell = cellOf(nav, station.anchor)
    entities.push({
      id: station.id,
      kind: 'station',
      footprint: cellRect(nav, cell.col, cell.row),
      // 底边 = 站点锚点的世界 z（渲染器以前就是这么算深度的，这里只是把它写进契约）。
      base: station.anchor.z,
      slots: station.slots.map((slot) => ({ x: slot.x, z: slot.z })),
    })
    for (const slot of station.slots) {
      slots += 1
      const c = cellOf(nav, slot)
      if (!walkable(nav, c.col, c.row)) slotsBlocked += 1
    }
  }

  // ── 2.5 美术占位格：画面上确实有家具，整格挡（不是"看不见的墙"）──
  const art: SceneObstacle[] = []
  // 整块外接矩形（地图像素 → 世界单位）；同块只加一次。
  const artRects: SceneObstacle[] = []
  const seenArt = new Set<string>()
  for (const rect of input.occupancyRects ?? []) {
    if (!Array.isArray(rect) || rect.length < 4) continue
    const [rx, ry, rw, rh] = rect
    if (!(rw > 0) || !(rh > 0)) continue
    const key = `${rx},${ry},${rw},${rh}`
    if (seenArt.has(key)) continue
    seenArt.add(key)
    artRects.push({
      x: nav.originX + rx / tilePx,
      z: nav.originZ + ry / tilePx,
      w: rw / tilePx,
      h: rh / tilePx,
      source: 'art',
    })
  }
  for (const index of input.occupancyCells ?? []) {
    if (!Number.isInteger(index) || index < 0 || index >= nav.width * nav.height) continue
    const col = index % nav.width
    const row = Math.floor(index / nav.width)
    const cell = cellRect(nav, col, row)
    const cx = cell.x + cell.w / 2
    const cz = cell.z + cell.h / 2
    // 精细几何已经盖住格中心 → 物理上本来就挡得住，不重复加。
    if (fine.some((item) => inside(item, cx, cz))) continue
    // 这一格属于某个"小而独立"的整块 → 用整块矩形（否则只盖半截墙）。
    const block = artRects.find((item) => inside(item, cx, cz))
    if (block !== undefined) {
      if (!art.includes(block)) art.push(block)
      continue
    }
    art.push({ ...cell, source: 'art' })
  }

  // 物理障碍 = 精细几何 + 美术占位；nav 是另一层（寻路），不拿它生成碰撞体。
  const obstacles: SceneObstacle[] = [...fine, ...art]
  return {
    nav: {
      width: nav.width,
      height: nav.height,
      unitsPerCell: nav.unitsPerCell,
      originX: nav.originX,
      originZ: nav.originZ,
      blocked: nav.blocked,
    },
    obstacles,
    entities,
    audit: {
      blockedCells,
      fineRects: fine.length,
      uncoveredCells,
      obstacles: obstacles.length,
      artCells: art.length,
      override: input.override === true,
      entities: entities.length,
      slots,
      slotsBlocked,
    },
  }
}
