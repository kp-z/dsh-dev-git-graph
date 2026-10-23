/*
 * 场景布局的**纯逻辑**（R58）：只留"Phaser 不知道、只有我们自己知道"的事。
 *
 * ── 为什么这个文件这么小 ────────────────────────────────────────────────────
 *
 * R57 之前，帧切分/帧推进/精灵盒/相机/拾取都是我们手写的（`pixel-sheet.js` +
 * `scene-camera.js`，272 行）。R58 换 Phaser 之后这些**全部交出去了**：
 *
 * | 原来的活 | 现在谁干 |
 * |---|---|
 * | 切帧（`frameRect`） | `this.load.spritesheet(key, url, { frameWidth, frameHeight })` |
 * | 帧推进（`frameIndex`） | `this.anims.create({ key, frames, frameRate })` + `sprite.play(key)` |
 * | 精灵盒/锚点（`spriteBox`） | `sprite.setOrigin(0.5, anchor === 'bottom' ? 1 : 0.5)` |
 * | 相机缩放/居中（`cameraFor`） | `this.cameras.main.setZoom(z)` + `centerOn(0, 0)` |
 * | 屏幕↔世界（`pickActor`/`anchorFor`） | `camera.getWorldPoint()` / `camera.worldView` |
 * | 平铺（`planGroundTiles`） | `this.add.tileSprite(...)` + `tilePositionX/Y` |
 * | WebGL 起不来的回退 | `type: Phaser.AUTO` |
 *
 * 剩下的两类**不能交出去**：
 * ① **内容语义**：`walking`→`walk`、`facing` 弧度→四向、动画回退链、多带图集怎么变成
 *    线性帧号——这是**我们协议里的约定**（`SceneSheetSpec`），引擎不可能知道。
 * ② **产品规则**：像素画必须整数倍缩放、气泡抬多高、平铺相位必须对齐世界格。
 *
 * 这一层是纯函数，所以它能在 node 里测——引擎那一半由浏览器里的实测覆盖。
 */

/** 四向（顺序固定，便于测试与稳定输出）。 */
export const FOUR_DIRECTIONS = ['down', 'up', 'left', 'right']

/** 一个世界单位 = 一格 = 16 源像素。 */
export const TILE_PX = 16

/** 缩放上限（俯视图要"一眼看全"）。 */
export const MAX_ZOOM = 6

/** 世界边长 × 这个系数决定画面里小镇占多大。 */
export const FIT = 1.06

/** 气泡锚点比角色脚下高多少像素。 */
export const ANCHOR_LIFT_PX = 26

/**
 * `facing`（弧度，`atan2(Δz, Δx)`，屏幕 +z 朝下）量化成四向。
 *
 * `0 = right`、`π/2 = down`、`π = left`、`-π/2 = up`。
 * **正好 45° 的两可情形约定归竖向**：`cos(-3π/4)` 与 `sin(-3π/4)` 在浮点里差最后一位，
 * 不给偏置的话"朝向"会变成浮点的运气。
 */
export function directionOf(facing) {
  const value = Number.isFinite(facing) ? facing : 0
  const dz = Math.sin(value)
  const dx = Math.cos(value)
  const bias = 1e-9
  if (Math.abs(dz) + bias >= Math.abs(dx)) return dz >= 0 ? 'down' : 'up'
  return dx >= 0 ? 'right' : 'left'
}

/**
 * 状态 → **动画带**。以内容库 `ScenePlan.actions` 为准（它是"动作库"，渲染器只执行）。
 *
 * 为什么必须走它：`working` 这类状态在动作库里是**两条**动作（`action.work.sit` 带 `sit`、
 * 权重 3；`action.work.stand` 带 `idle`、权重 1）。渲染器自己只认"walking 走、其余站着"的话，
 * 坐着干活的人会**站着**——界面看起来完全正常，所以这种错很难发现（R64 实测到过）。
 * 多条同状态时取**权重最大**的那条：确定、可预期，权重仍然表达"更倾向坐着"。
 *
 * `actions` 缺失时退回老规则（只有走路与站着）——那是回退路径，不是废弃路径。
 */
export function bandOfState(actions, state) {
  if (Array.isArray(actions)) {
    let best = null
    for (const action of actions) {
      if (action === null || action === undefined || action.state !== state) continue
      if (action.band === null || action.band === undefined) continue
      const weight = Number.isFinite(action.weight) ? action.weight : 1
      if (best === null || weight > best.weight) best = { band: action.band, weight }
    }
    if (best !== null) return best.band
  }
  return state === 'walking' ? 'walk' : 'idle'
}

/** R316：站点类型覆盖动作带——同一 working，会议桌站、工位坐、休息区坐。 */
export function bandForActor(actions, actor) {
  const kind = actor?.stationKind
  if (kind === 'meeting' && actor?.state === 'working') return 'idle'
  if (kind === 'mailroom' && actor?.state === 'working') return 'idle'
  if (kind === 'breakroom' && actor?.state === 'working') return 'sit'
  return bandOfState(actions, actor?.state)
}

/** 状态 → 动作名（**没有动作库时的老规则**；有 `actions` 请用 `bandOfState`）。 */
export function actionOf(state) {
  return state === 'walking' ? 'walk' : 'idle'
}

/** 动画 key：契约里是点分的 `walk.down`；Phaser 的 key 用连字符更省事（也避免和属性路径混淆）。 */
export function animationKey(action, direction) {
  return direction === null || direction === undefined ? action : `${action}-${direction}`
}

/** 契约里的动画名 → Phaser 的 key（`walk.down` → `walk-down`；不分的 `idle` 原样）。 */
export function keyOfAnimationName(name) {
  return String(name).replace(/\./g, '-')
}

/**
 * 动画回退链（**语义不变**，只是改成先算出候选 key 再问引擎有没有）：
 * `动作.方向` → `动作` → `idle.方向` → `idle`。
 */
export function animationCandidates(input = {}) {
  // 允许直接给 `band`（内容库算出来的）；没给就按老规则从 state 推。
  const action = input.band ?? actionOf(input.state)
  const direction = input.direction ?? null
  const out = []
  if (direction !== null) out.push(animationKey(action, direction))
  out.push(animationKey(action, null))
  if (direction !== null) out.push(animationKey('idle', direction))
  out.push(animationKey('idle', null))
  return [...new Set(out)]
}

/**
 * 选出真正存在的动画 key（`exists` 由引擎给：Phaser 的 `this.anims.exists`）。
 * 候选链一个都不存在时返回 `null`——调用方据此保留"没动画"的状态，而不是放错动画。
 */
export function resolveAnimationKey(exists, input = {}) {
  for (const key of animationCandidates(input)) {
    if (exists(key) === true) return key
  }
  return null
}

/** 一条带里有多少帧（`row * framesPerRow + col` 的 `framesPerRow`）。 */
export function framesPerRow(sheet, imageWidth) {
  const cellW = Math.max(1, Math.round(Number(sheet?.cellW) || 1))
  const width = Math.round(Number(imageWidth) || 0)
  return Math.max(1, Math.floor(width / cellW))
}

/** 多带图集的 `(col, row)` → Phaser spritesheet 的**线性帧号**。 */
export function frameIndexOf(framesPerRowValue, col, row) {
  const perRow = Math.max(1, Math.floor(Number(framesPerRowValue) || 1))
  const c = Math.max(0, Math.floor(Number(col) || 0))
  const r = Math.max(0, Math.floor(Number(row) || 0))
  return r * perRow + c
}

/**
 * 一条动画的**帧号数组**（喂给 `this.anims.create({ frames })`）。
 *
 * 契约：一帧在 `(col + i, row)`，`row` 是**带**号；`layout:'column'` 时沿带号走
 * （即帧号 `+framesPerRow` 递增）。这个换算是**纯数据**，在装载时算一次。
 */
export function animationFrameList(sheet, anim, perRow) {
  const col = Math.max(0, Math.floor(Number(anim?.col) || 0))
  const row = Math.max(0, Math.floor(Number(anim?.row) || 0))
  const count = Math.max(1, Math.floor(Number(anim?.frames) || 1))
  const columns = anim?.layout === 'column'
  const frames = []
  for (let i = 0; i < count; i += 1) {
    frames.push(columns ? frameIndexOf(perRow, col, row + i) : frameIndexOf(perRow, col + i, row))
  }
  return frames
}

/** 一条动画的帧间隔（毫秒）→ Phaser 的 `frameRate`（帧/秒）。 */
export function frameRateOf(anim) {
  const ms = Number(anim?.frameMs)
  if (!Number.isFinite(ms) || ms <= 0) return 0
  return 1000 / ms
}

/** 多带图集 → 锚点（`bottom` = 底边贴地；`center` = 居中）。 */
export function originOf(sheet) {
  return sheet?.anchor === 'bottom' ? [0.5, 1] : [0.5, 0.5]
}

/**
 * 世界的取景框（R62）：**世界是中心为 0 的矩形**，底图是"左上角为 0"的一张图。
 *
 * 有底图（`plan.map`）时按**图**算；没有时退回 `extent.half`（原来是正方形 16×16）。
 * 两个量在这里定死、别处都从它推，就不会出现"差了半张图"那种错：
 * · `halfW/halfH`：世界半宽/半高（单位）→ 图左上角的世界坐标 = `(-halfW, -halfH)`
 * · `originPxX/Y`：图左上角的**世界像素**坐标（世界像素 = 单位 × 16）
 *
 * 真机那一档：37×21 格、`cellPx=32`、`unitsPerCell=2` → 74×42 单位、1184×672 像素、
 * 原点在 `(-592, -336)`。
 */
export function worldFrame(plan, tilePx = TILE_PX) {
  const map = plan?.map ?? null
  const unitsPerCell = Number(map?.unitsPerCell)
  const cellPx = Number(map?.cellPx)
  if (map !== null && Number.isFinite(map?.width) && Number.isFinite(map?.height) && Number.isFinite(cellPx) && cellPx > 0) {
    const perCell = Number.isFinite(unitsPerCell) && unitsPerCell > 0 ? unitsPerCell : 2
    const halfW = (map.width * perCell) / 2
    const halfH = (map.height * perCell) / 2
    return {
      source: 'map',
      halfW,
      halfH,
      unitsPerCell: perCell,
      cellPx,
      worldPxW: Math.round(map.width * cellPx),
      worldPxH: Math.round(map.height * cellPx),
      originPxX: Math.round(-halfW * tilePx),
      originPxY: Math.round(-halfH * tilePx),
    }
  }
  const half = Number.isFinite(plan?.extent?.half) ? plan.extent.half : 8
  const worldPx = Math.round(half * 2 * tilePx)
  return {
    source: 'extent',
    halfW: half,
    halfH: half,
    unitsPerCell: 1,
    cellPx: tilePx,
    worldPxW: worldPx,
    worldPxH: worldPx,
    originPxX: Math.round(-half * tilePx),
    originPxY: Math.round(-half * tilePx),
  }
}

/**
 * **整数倍**缩放：像素画的命（2.5 倍会让有的像素占 2 格、有的占 3 格，整张图糊成一片）。
 *
 * R62 起**按两个轴分别算**：世界从 16×16 正方形变成 74×42（和屏幕一样是横的），
 * 只按短边算会把横着的办公室挤成"格子很小看不清"。
 * `worldPixels` 是正方形世界的兼容入口（老调用方还在用）。
 */
export function integerZoom(input = {}) {
  const viewWidth = Number(input.viewWidth) || 0
  const viewHeight = Number(input.viewHeight) || 0
  const worldW = Math.max(1, Number(input.worldPixelsW) || Number(input.worldPixels) || 1)
  const worldH = Math.max(1, Number(input.worldPixelsH) || Number(input.worldPixels) || 1)
  const fit = Number.isFinite(input.fit) && input.fit > 0 ? input.fit : FIT
  const maxZoom = Number.isFinite(input.maxZoom) ? input.maxZoom : MAX_ZOOM
  const raw = Math.min(viewWidth / (worldW * fit), viewHeight / (worldH * fit))
  if (!Number.isFinite(raw) || raw < 1) return 1
  return Math.min(maxZoom, Math.floor(raw))
}

/**
 * 用户能缩放到哪些档位（R65）——**整数倍**，所以是一个离散的阶梯，不是连续值。
 *
 * 为什么是"档位"而不是"连续缩放"：像素画的命是整数倍（`MAX_ZOOM` 那段注释里写了
 * 2.5 倍会让有的像素占 2 格、有的占 3 格，整张图糊成一片）。所以滚轮不是一个连续的
 * `zoom *= 1.1`，而是**在阶梯上走一格**——这也是为什么"缩放到某处"必须知道"当前是哪一档"。
 *
 * 档位从 1 开始：小于 1 会把像素画缩小采样，同样糊（而且全世界只有 1184×672，
 * 缩到 0.5 倍时字就看不清了）。上限 `MAX_ZOOM`。
 */
export function zoomLevels(maxZoom = MAX_ZOOM) {
  const top = Math.max(1, Math.floor(Number.isFinite(maxZoom) ? maxZoom : MAX_ZOOM))
  const out = []
  for (let z = 1; z <= top; z += 1) out.push(z)
  return out
}

/**
 * 适配档（"一眼看全"）：屏幕上**装得下整个取景框**的最大整数倍。
 *
 * 这就是 R58 起相机默认用的那个 `integerZoom`——抽出来是因为现在有两个用它的地方：
 * 进场的默认视图，以及"复位"按钮。两处各算一份迟早会飘。
 */
export function fitZoom(input = {}) {
  return integerZoom(input)
}

/**
 * 在档位阶梯上走 `step` 格（+1 放大、-1 缩小、0 不动）。
 *
 * 两个边界行为是刻意的：
 * - **越界时停在边界档**（不是回绕、也不是不变）——用户连续滚到顶再滚，应当停在最大档，
 *   而不是突然跳回最小档；
 * - **`levels` 为空时返回 `current`**：没有可用档位是"内容/配置不对"，
 *   那时不动比乱动安全（渲染层不会因此白屏）。
 *
 * `current` 不在阶梯上时（比如窗口刚变、fit 档变了）**先归到最近的一档再走**——
 * 否则"在 1.7 倍上滚一格"会算出 2.7 这种非整数档。
 */
export function steppedZoom(current, step, levels) {
  const list = Array.isArray(levels) && levels.length > 0 ? levels : null
  const value = Number.isFinite(current) ? current : 1
  if (list === null) return value
  const delta = Number.isFinite(step) ? Math.trunc(step) : 0
  let nearest = 0
  for (let i = 1; i < list.length; i += 1) {
    if (Math.abs(list[i] - value) < Math.abs(list[nearest] - value)) nearest = i
  }
  const index = Math.min(list.length - 1, Math.max(0, nearest + delta))
  return list[index]
}

/**
 * 平铺相位（像素）：区左边界相对**世界网格**偏了多少。
 *
 * 四个区共用同一张砖，所以相位必须按世界网格算，不能各从自己的左上角起贴
 * （否则跨区交界处花纹错半格 = 一条明显的缝；R55 为此逐像素量过缝率）。
 */
export function tilePhasePx(input = {}) {
  const tileUnits = Number.isFinite(input.tileUnits) && input.tileUnits > 0 ? input.tileUnits : 2
  const scale = Number.isFinite(input.scale) ? input.scale : 1
  const left = Number.isFinite(input.leftWorld) ? input.leftWorld : 0
  const gridStart = Math.floor(left / tileUnits) * tileUnits
  return Math.round((left - gridStart) * scale)
}

/**
 * 覆盖层（头顶标签 / 纸条 / 气泡）的**深度带**。
 *
 * ## 为什么单独列出来
 *
 * 场景主体（地板、家具、墙、角色、椅子）都在 `entities` 一个容器里按"底边 Y"排序；
 * 覆盖层在**另外三个容器**里。Phaser 的跨容器顺序 = **容器加入显示列表的顺序**，
 * 容器内部的顺序 = 子对象插入顺序（除非显式 `sort('depth')`）。
 *
 * 所以覆盖层的"谁压谁"只有两条规则，必须写死、可审计：
 * 1. **跨层**：`ground < entities < notes < labels < bubbles`（加入顺序，见 scene-phaser）；
 * 2. **层内**：深度带决定标签的相对顺序（名字压工单行，气泡永远最高）。
 *
 * 这些值以前散在渲染器里当字面量（4/5/1000），既看不出意图，也没法测。
 */
export const OVERLAY_DEPTHS = {
  /** 头顶工单行：先读人，再读单。 */
  task: 4,
  /** 角色名：压住工单行。 */
  name: 5,
  /** 飞行中的纸条；不与标签争，位置本来就分开。 */
  note: 4,
  /** 对话气泡：永远最上层（它是"当前正在说的话"）。 */
  bubble: 1000,
}

/** 覆盖层深度带的取值。未知种类直接抛——静默给 0 会让它沉到最底下。 */
export function overlayDepthOf(kind) {
  const depth = OVERLAY_DEPTHS[kind]
  if (depth === undefined) throw new Error(`未知的覆盖层种类：${String(kind)}`)
  return depth
}

/**
 * 把 `SceneSpace.obstacle`（**世界单位**）换算成 Phaser 的矩形参数（像素）。
 *
 * 这是一个只有三行的函数，但它防的是经典的"差 16 倍"：`obstacle.x` 已经含了
 * `originX`，所以这里只乘 `TILE_PX`，**不许再加一次原点**。
 * R227 第一版就在渲染器里加了两次，被这条测试拦住。
 */
export function obstacleRectToPixels(obstacle, tilePx = TILE_PX) {
  const w = obstacle.w * tilePx
  const h = obstacle.h * tilePx
  return { x: obstacle.x * tilePx + w / 2, y: obstacle.z * tilePx + h / 2, w, h }
}

/**
 * 俯视图要画的角色：**实时位姿**（`world.agents`）+ **内容里的外观**（`scene.actors`）。
 *
 * 这也不是引擎的活：引擎不知道"世界"和"内容计划"是两份数据。
 * 只遍历 `scene.actors` 的话人会永远站在开局位置——两个视图给出互相矛盾的真相。
 */
export function liveActors(world, scene) {
  const plan = scene?.actors ?? []
  if (world === null || world === undefined || world.agents === undefined) return plan
  const byId = new Map(plan.map((a) => [a.id, a]))
  const fallback = scene?.noteColors?.report ?? '#7C8CFF'
  return world.agents.map((a) => ({
    id: a.id,
    name: a.name,
    state: a.state,
    x: a.position?.x ?? byId.get(a.id)?.x ?? 0,
    z: a.position?.z ?? byId.get(a.id)?.z ?? 0,
    color: byId.get(a.id)?.color ?? fallback,
    // ⚠️ 兜底**不要用 0**：`directionOf(0)` 恰好是 "right"，于是"缺朝向"会静默变成
    // "所有人都在向右看"（用户反馈：「只要朝向不是向右就会跳向右」）。
    // 先退到内容里的静态朝向，再退到 `π/2`（down，中性），不再凭空造出 right。
    facing: Number.isFinite(a.facing)
      ? a.facing
      : (Number.isFinite(byId.get(a.id)?.facing) ? byId.get(a.id).facing : Math.PI / 2),
    modelId: byId.get(a.id)?.modelId ?? null,
  }))
}
