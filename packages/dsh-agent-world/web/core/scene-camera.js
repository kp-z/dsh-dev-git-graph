/*
 * 2D 相机与拾取（R57）—— **纯函数**，画布渲染器与 Pixi 渲染器**共用这一份**。
 *
 * ── 为什么要抽出来 ──────────────────────────────────────────────────────────
 *
 * R57 把渲染从 canvas2D 换成 PixiJS，但有一条硬要求：**点选行为不能变**
 * （点角色选中角色、点站点选中站点、气泡锚点还是那个位置）。
 * 如果两个渲染器各写一份换算，"行为一致"就只能靠人肉对比，而且换渲染器的那天
 * 一定会漂。所以换算只有这一份：`cameraFor` / `pickActor` / `anchorFor`。
 *
 * 纯函数也意味着这些行为**能在 node 里测**，不必开浏览器。
 */

/** 一个世界单位 = 一格 = 16 源像素（像素资源的主尺寸）。 */
export const TILE_PX = 16

/** 缩放上限：再大就看不到整个小镇了（俯视图要的是"一眼看全"）。 */
export const MAX_ZOOM = 6

/** 俯视场景留边：世界边长 × 这个系数决定画面里小镇占多大（1.06 = 四周留一点空）。 */
export const FIT = 1.06

/** 气泡锚点比角色脚下高多少像素（名字/精灵头顶之上）。 */
export const ANCHOR_LIFT_PX = 26

/**
 * 相机：世界坐标 ↔ 画布像素的唯一来源。
 *
 * **整数倍缩放**是像素画的命：2.5 倍会让有的像素占 2 格、有的占 3 格，整张图糊成一片。
 * 所以先算"能放下几倍"，取整，再拿它当比例。
 */
export function cameraFor(input = {}) {
  const width = Number.isFinite(input.viewWidth) ? input.viewWidth : 0
  const height = Number.isFinite(input.viewHeight) ? input.viewHeight : 0
  const half = Number.isFinite(input.half) ? input.half : 8
  const tilePx = Number.isFinite(input.tilePx) && input.tilePx > 0 ? input.tilePx : TILE_PX
  const fit = Number.isFinite(input.fit) && input.fit > 0 ? input.fit : FIT
  const maxZoom = Number.isFinite(input.maxZoom) ? input.maxZoom : MAX_ZOOM
  const worldPx = Math.round(half * 2 * tilePx)
  const raw = Math.min(width / Math.max(1, worldPx * fit), height / Math.max(1, worldPx * fit))
  const zoom = Number.isFinite(raw) ? Math.min(maxZoom, Math.max(1, Math.floor(raw))) : 1
  const scale = tilePx * zoom
  return {
    width,
    height,
    half,
    zoom,
    worldPx,
    scale,
    toX: (x) => width / 2 + x * scale,
    toY: (z) => height / 2 + z * scale,
    toWorldX: (px) => (px - width / 2) / scale,
    toWorldZ: (py) => (py - height / 2) / scale,
  }
}

/**
 * 俯视图要画的角色：**实时位姿**（`world.agents`）+ **内容里的外观**（`scene.actors`）。
 *
 * 只遍历 `scene.actors` 的话，画的是**快照那一帧**的静态布局，人会永远站在开局的位置；
 * 而 3D 吃的是 `world.agents`——两个视图给出互相矛盾的真相，且看起来都"正常"。
 */
export function liveActors(world, scene) {
  const plan = scene?.actors ?? []
  if (world === null || world === undefined || world.agents === undefined) return plan
  const byId = new Map(plan.map((a) => [a.id, a]))
  // 快照还没回来、或角色是新加的时候退回一个中性色，而不是凭空编一个人设（D37）。
  const fallback = scene?.noteColors?.report ?? '#7C8CFF'
  return world.agents.map((a) => ({
    id: a.id,
    name: a.name,
    state: a.state,
    x: a.position?.x ?? byId.get(a.id)?.x ?? 0,
    z: a.position?.z ?? byId.get(a.id)?.z ?? 0,
    color: byId.get(a.id)?.color ?? fallback,
    facing: Number.isFinite(a.facing) ? a.facing : (byId.get(a.id)?.facing ?? 0),
    modelId: byId.get(a.id)?.modelId ?? null,
  }))
}

/**
 * 点到谁了（点不到返回 null）。
 *
 * 容差按**像素**算——用世界单位当容差，在缩小视角下会变得几乎点不中。
 *
 * @param {{world: object, scene: object, camera: object, clientX: number, clientY: number, rect: {left: number, top: number}, pickSlopPx?: number, agents?: ReadonlyArray<object>}} input
 */
export function pickActor(input) {
  const world = input.world
  const camera = input.camera
  if (world === null || world === undefined || camera === null || camera === undefined) return null
  if (!(camera.scale > 0)) return null
  const rect = input.rect ?? { left: 0, top: 0 }
  const slop = Number.isFinite(input.pickSlopPx) ? input.pickSlopPx : 16
  const wx = camera.toWorldX(input.clientX - rect.left)
  const wz = camera.toWorldZ(input.clientY - rect.top)
  const agents = input.agents ?? world.agents ?? []
  let best = null
  let bestPx = slop
  for (const a of agents) {
    const distance = Math.hypot((a.position.x - wx) * camera.scale, (a.position.z - wz) * camera.scale)
    if (distance <= bestPx) {
      best = a.id
      bestPx = distance
    }
  }
  return best
}

/**
 * 角色头顶在**画布内**的像素位置（HTML 气泡挂钩用）。
 *
 * 3D 那一半在 `scene3d.projectToScreen()`；两者必须给出同一种坐标：画布相对像素。
 */
export function anchorFor(input) {
  const world = input.world
  const camera = input.camera
  if (world === null || world === undefined || camera === null || camera === undefined) return null
  const agent = (world.agents ?? []).find((a) => a.id === input.agentId)
  if (agent === undefined) return null
  const lift = Number.isFinite(input.liftPx) ? input.liftPx : ANCHOR_LIFT_PX
  return {
    x: camera.toX(agent.position.x),
    y: camera.toY(agent.position.z) - lift,
    width: camera.width,
    height: camera.height,
    behind: false,
  }
}

/**
 * 平铺相位（像素）：区左边界相对**全局网格**偏了多少。
 *
 * 四个区共用同一张砖，所以相位必须按**世界网格**算，不能各从自己的左上角起贴
 * （否则跨区交界处花纹错半格 = 一条明显的缝）。
 */
export function tilePhasePx(input) {
  const tileUnits = Number.isFinite(input.tileUnits) && input.tileUnits > 0 ? input.tileUnits : 2
  const scale = Number.isFinite(input.scale) ? input.scale : 1
  const left = Number.isFinite(input.leftWorld) ? input.leftWorld : 0
  const gridStart = Math.floor(left / tileUnits) * tileUnits
  return Math.round((left - gridStart) * scale)
}
