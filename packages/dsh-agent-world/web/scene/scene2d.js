/*
 * 俯视图渲染（R32 从旧的 app.js 抽出）—— 2D canvas 的那一套。
 *
 * ── 它和 3D 的关系 ────────────────────────────────────────────────────────────
 *
 * 两个渲染器**吃同一份输入**：`ScenePlan`（布局/外观）+ 实时 `world`（位姿/状态）。
 * 俯视图**永久保留**（决策 D21）：3D 调不出来的时候，它是唯一能看清模拟对不对的窗口。
 *
 * ── 一条纪律：颜色只来自内容 ──────────────────────────────────────────────────
 *
 * 地块/站点/角色/纸条的颜色全部取自 `ScenePlan`（由内容库 `skins` 解析好）。
 * 这里只画形状与层级——**没有一处写死的调色板**，换皮肤就等于换一张图。
 *
 * ── 三个几何函数只写一遍 ──────────────────────────────────────────────────────
 *
 * `metrics()`（比例与中心）是所有换算的唯一来源。画的、点的、挂气泡的都用它，
 * 各写一份的话，三者会以"慢半拍"的方式不一致——而那种错看起来像"渲染没刷新"。
 */

import { assignColorVariants, lightnessLadder, variantColor } from '../core/pixel-recolor.js'
import { directionOf, frameIndex, frameRect, integerZoom, pickAnimation, spriteBox } from '../core/pixel-sheet.js'
import { createSheetLoader } from './sheet-loader.js'

/** 俯视场景留边：世界边长 × 这个系数决定画面里小镇占多大（1.06 = 四周留一点空）。 */
const FIT = 1.06

/**
 * 一个世界单位 = 一格 = 16 源像素（库里像素资源的主尺寸就是 16×16）。
 *
 * 这个数字决定"缩放一定取整数倍"这件事能不能落地：世界 16×16 格 = 256 源像素，
 * 舞台约 740×650 → `floor(650 / (256×1.06)) = 2` 倍。**整数倍**是像素画的命：
 * 2.5 倍会让有的像素占 2 格、有的占 3 格，整张图糊成一片。
 */
const TILE_PX = 16

/** 缩放上限：再大就看不到整个小镇了（俯视图要的是"一眼看全"）。 */
const MAX_ZOOM = 6

/**
 * canvas 里的字体**不能写 CSS 变量**（`ctx.font` 只认真的字体描述串，写 `var(...)` 会被静默忽略、
 * 于是沿用上一次的字体——那种"字号没生效"很难归因）。所以这里写死一个字体栈，
 * 与 `styles/tokens.css` 里的 `--ui-font` 保持同一个顺序。
 */
const UI_FONT = 'system-ui, -apple-system, "PingFang SC", "Hiragino Sans GB", sans-serif'

function rounded(ctx, x, y, w, h, r) {
  const radius = Math.max(0, Math.min(r, Math.min(w, h) / 2))
  ctx.beginPath()
  ctx.moveTo(x + radius, y)
  ctx.arcTo(x + w, y, x + w, y + h, radius)
  ctx.arcTo(x + w, y + h, x, y + h, radius)
  ctx.arcTo(x, y + h, x, y, radius)
  ctx.arcTo(x, y, x + w, y, radius)
  ctx.closePath()
}

/**
 * 建一个俯视渲染器。
 *
 * @param {HTMLCanvasElement} canvas
 * @param {{ pickSlopPx?: number }} [options]
 */
export function createScene2d(canvas, options = {}) {
  const pickSlopPx = Number.isFinite(options.pickSlopPx) ? options.pickSlopPx : 16
  const ctx = canvas.getContext('2d')
  /**
   * 精灵加载器（R51）：按 url 缓存 `<img>`、按"角色配色"缓存重上色结果。
   *
   * 放在渲染器里而不是全局单例：一个页面可能有多个画布（未来的小地图/回放），
   * 但**同一个 url 的图只该加载一次**——所以真正的缓存键是 url，实例各自持有一份引用。
   */
  const loader = options.loader ?? createSheetLoader({ baseUrl: options.assetBaseUrl ?? './vendor/' })
  /** 地面（整块世界的离屏画布）缓存：按地块配色签名失效。 */
  let groundCache = null
  /** 最近一次拿到的世界与场景（`pick`/`anchorOf` 要用；由 `render` 更新）。 */
  let lastWorld = null
  let lastScene = null

  /** 把设计尺寸写进 canvas 属性，避免高分屏下模糊。 */
  function resize() {
    const rect = canvas.getBoundingClientRect()
    const dpr = window.devicePixelRatio || 1
    canvas.width = Math.max(320, Math.floor(rect.width * dpr))
    canvas.height = Math.max(320, Math.floor(rect.height * dpr))
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  }

  /** 唯一的几何来源：世界坐标 ↔ 画布像素。 */
  function metrics(scene) {
    const width = canvas.clientWidth
    const height = canvas.clientHeight
    const half = scene?.extent?.half ?? 8
    const worldPx = Math.round(half * 2 * TILE_PX)
    // **整数倍**（不是"刚好铺满"那个小数）：见 `TILE_PX` 的注释。
    const zoom = integerZoom({
      viewWidth: width,
      viewHeight: height,
      worldPixelsW: worldPx,
      worldPixelsH: worldPx,
      fit: FIT,
      maxZoom: MAX_ZOOM,
    })
    const scale = TILE_PX * zoom
    return {
      width,
      height,
      half,
      zoom,
      worldPx,
      scale,
      toX: (x) => width / 2 + x * scale,
      toY: (z) => height / 2 + z * scale,
    }
  }

  /**
   * 俯视图要画的角色：**实时位姿**（`world.agents`）+ **内容里的颜色**（`scene.actors`）。
   *
   * 只遍历 `scene.actors` 的话，画的是**快照那一帧**的静态布局，人会永远站在开局的位置；
   * 而 3D 吃的是 `world.agents`——两个视图给出互相矛盾的真相，且看起来都"正常"。
   */
  function liveActors(world, scene) {
    const plan = scene?.actors ?? []
    if (world === null || world?.agents === undefined) return plan
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
      // R51：精灵要按朝向选动画、按模型条目查图集。两个都来自**实时世界 + 内容计划**，
      // 缺了就只能退回色块（所以这里给的是 null 而不是编一个默认值）。
      facing: Number.isFinite(a.facing) ? a.facing : (byId.get(a.id)?.facing ?? 0),
      modelId: byId.get(a.id)?.modelId ?? null,
    }))
  }

  /**
   * 地块 → **整块世界的离屏画布**（像素砖），每帧只 blit 一次。
   *
   * 为什么不每帧逐格画：世界 16×16 格 = 256 个方块 × 每帧，纯浪费；
   * 而地块是**静态**的（颜色来自内容），只有配色变了才需要重画。
   * 砖块的浅/深色**不另发明配色**：用 `lightnessLadder(地块色)` 从内容给的那个色推出来。
   */
  function groundCanvas(scene) {
    const half = scene?.extent?.half ?? 8
    const worldPx = Math.round(half * 2 * TILE_PX)
    const districts = scene?.ground ?? []
    const signature = `${worldPx}|${districts.map((g) => `${g.id}:${g.color}:${g.x},${g.z},${g.width},${g.depth}`).join(';')}`
    if (groundCache !== null && groundCache.signature === signature) return groundCache.canvas

    const surface = document.createElement('canvas')
    surface.width = worldPx
    surface.height = worldPx
    const g = surface.getContext('2d')
    g.imageSmoothingEnabled = false
    // 世界坐标 → 世界像素：x ∈ [-half, half] → [0, worldPx]
    const px = (value) => (value + half) * TILE_PX

    for (const district of districts) {
      const x0 = Math.round(px(district.x - district.width / 2))
      const y0 = Math.round(px(district.z - district.depth / 2))
      const w = Math.round(district.width * TILE_PX)
      const h = Math.round(district.depth * TILE_PX)
      const ladder = lightnessLadder(district.color) ?? [district.color, district.color, district.color]
      g.fillStyle = ladder[1]
      g.fillRect(x0, y0, w, h)
      const cols = Math.max(1, Math.round(w / TILE_PX))
      const rows = Math.max(1, Math.round(h / TILE_PX))
      for (let ty = 0; ty < rows; ty += 1) {
        for (let tx = 0; tx < cols; tx += 1) {
          const cx = x0 + tx * TILE_PX
          const cy = y0 + ty * TILE_PX
          // 棋盘格 + 上/左两条缝 = 一眼看得出"这是格子地面"，且不抢人物。
          g.fillStyle = (tx + ty) % 2 === 0 ? ladder[0] : ladder[1]
          g.fillRect(cx + 1, cy + 1, TILE_PX - 1, TILE_PX - 1)
          g.fillStyle = ladder[2]
          g.fillRect(cx, cy, TILE_PX, 1)
          g.fillRect(cx, cy, 1, TILE_PX)
        }
      }
    }
    groundCache = { signature, canvas: surface }
    return surface
  }

  /** 站点的一件家具：有图集就画精灵，没有就什么都不画（由调用方退回老画法）。 */
  function drawPropSprite(model, sheet, { cx, groundY, scale, mirror }) {
    const art = loader.sprite(model.url, null)
    if (art === null) return false
    const picked = pickAnimation(sheet, { state: 'idle', direction: null })
    if (picked === null) return false
    const frame = frameRect(sheet, picked.anim, 0)
    const box = spriteBox(sheet, frame, { cx, groundY, scale })
    drawFrame(art.source, frame, box, mirror === true || picked.anim.mirror === true)
    return true
  }

  /** 一帧的绘制（含镜像）——所有精灵都走这里，省得每处各写一遍 save/scale。 */
  function drawFrame(source, frame, box, mirror) {
    if (mirror) {
      ctx.save()
      ctx.translate(box.x + box.w, box.y)
      ctx.scale(-1, 1)
      ctx.drawImage(source, frame.sx, frame.sy, frame.sw, frame.sh, 0, 0, box.w, box.h)
      ctx.restore()
      return
    }
    ctx.drawImage(source, frame.sx, frame.sy, frame.sw, frame.sh, box.x, box.y, box.w, box.h)
  }

  /** 画地块与站点。 */
  function drawGroundAndProps(scene, m) {
    // 地面：整块 blit（缩放是整数倍 + 关掉插值 → 像素不会糊）。
    const ground = groundCanvas(scene)
    const side = m.worldPx * m.zoom
    ctx.imageSmoothingEnabled = false
    ctx.drawImage(ground, Math.round(m.toX(-m.half)), Math.round(m.toY(-m.half)), side, side)

    ctx.textAlign = 'start'
    for (const g of scene.ground) {
      const x = m.toX(g.x - g.width / 2)
      const y = m.toY(g.z - g.depth / 2)
      // 区块名：地面已经是砖了，名字加一层暗描边保证在花纹上也读得清。
      ctx.font = `600 11px ${UI_FONT}`
      ctx.fillStyle = 'rgba(0,0,0,0.55)'
      ctx.fillText(g.name, x + 11, y + 18)
      ctx.fillStyle = 'rgba(255,255,255,0.85)'
      ctx.fillText(g.name, x + 10, y + 17)
    }

    const models = new Map((scene.models ?? []).map((model) => [model.id, model]))
    const props = [...scene.props].sort((a, b) => a.z - b.z)
    for (const p of props) {
      const parts = Array.isArray(p.parts) ? p.parts : []
      let spriteCount = 0
      // 逐件画（顺序有意义：内容里的摆法就是绘制顺序）；同站点的件按 dz 排一下前后。
      for (const part of [...parts].sort((a, b) => (a.dz ?? 0) - (b.dz ?? 0))) {
        const model = models.get(part.modelId)
        if (model === undefined || model?.sheet === null || model?.sheet === undefined || model.url === null) continue
        const drew = drawPropSprite(model, model.sheet, {
          cx: m.toX(p.x + (part.dx ?? 0)),
          // **+z 朝屏幕下方**：家具的"往后"是 -z，所以 dz 直接加到 z 上。
          groundY: m.toY(p.z + (part.dz ?? 0)),
          scale: m.zoom,
          mirror: false,
        })
        if (drew) spriteCount += 1
      }
      if (spriteCount > 0) continue

      // ── 回退：没有图集就画色块（R47 的教训：缺东西要**一眼看得出来**，不能白屏）──
      const size = p.capacity > 1 ? 18 : 13
      const x = m.toX(p.x) - size / 2
      const y = m.toY(p.z) - size / 2
      rounded(ctx, x, y, size, size, 4)
      ctx.fillStyle = p.color
      ctx.fill()
      // 被占用的站点带一圈亮边："谁在用"是这个世界最常看的一件事。
      ctx.strokeStyle = p.occupied ? 'rgba(255,255,255,0.85)' : 'rgba(0,0,0,0.35)'
      ctx.lineWidth = p.occupied ? 2 : 1
      ctx.stroke()
    }
  }

  /**
   * 画角色：有图集就画**精灵**（按朝向选动画 + 按角色配色重上色），没有就退回圆点。
   *
   * 名字照旧画在头顶——精灵认不出是谁，而"谁在哪"是这个世界最常看的一件事。
   */
  function drawActors(world, scene, m, nowMs) {
    const models = new Map((scene.models ?? []).map((model) => [model.id, model]))
    ctx.textAlign = 'center'
    // 按 z 排队（+z 朝下）：远的先画，近的压在上面——俯视图的遮挡关系就靠这个。
    const actors = [...liveActors(world, scene)].sort((a, b) => a.z - b.z)
    // 撞色兜底（R51）：同一配色的第 2、3… 个角色在色相上错开（按 id 排序 → 稳定）。
    // 不这么做的话，3 个工程师是同一个 `#38BDF8`、画出来 3 个一模一样的人。
    // 与花名册**共用同一份分配**（`assignColorVariants`）：两边各算一份会错开色号。
    const variantOf = assignColorVariants(actors)
    for (const a of actors) {
      const cx = m.toX(a.x)
      const cy = m.toY(a.z)
      const model = a.modelId === null ? undefined : models.get(a.modelId)
      let drew = false
      if (model?.sheet !== null && model?.sheet !== undefined && typeof model.url === 'string') {
        // 有图集就按角色自己的配色重上色（8 个人各不相同靠的就是这一步）。
        const art = loader.sprite(model.url, a.color, variantOf.get(a.id) ?? 0)
        const picked = art === null ? null : pickAnimation(model.sheet, { state: a.state, direction: directionOf(a.facing) })
        if (art !== null && picked !== null) {
          const frame = frameRect(model.sheet, picked.anim, frameIndex(picked.anim, nowMs))
          const box = spriteBox(model.sheet, frame, { cx, groundY: cy, scale: m.zoom })
          ctx.imageSmoothingEnabled = false
          drawFrame(art.source, frame, box, picked.anim.mirror === true)
          drew = true
        }
      }

      if (!drew) {
        // ── 回退：圆点（老画法；只把颜色换成**与花名册同一个变体色**，见下）──
        // 回退时也要认得出谁是谁：花名册的色点用的是变体色，地图上却用原色的话，
        // 两边会对不上（3 个工程师在花名册里是三个色、在地图上是同一个色）。
        const fallbackColor = variantColor(a.color, variantOf.get(a.id) ?? 0)
        const r = 7
        if (a.state === 'walking') {
          // 空心 = 在路上。一眼能分辨"在站上"和"赶路中"。
          ctx.beginPath()
          ctx.arc(cx, cy, r, 0, Math.PI * 2)
          ctx.lineWidth = 2.5
          ctx.strokeStyle = fallbackColor
          ctx.stroke()
        } else {
          ctx.beginPath()
          ctx.arc(cx, cy, r, 0, Math.PI * 2)
          ctx.fillStyle = fallbackColor
          ctx.fill()
          ctx.lineWidth = 1.5
          ctx.strokeStyle = 'rgba(0,0,0,0.45)'
          ctx.stroke()
        }
      }

      ctx.fillStyle = 'rgba(255,255,255,0.85)'
      ctx.font = `10px ${UI_FONT}`
      const lift = drew ? m.zoom * 36 + 4 : 11
      ctx.fillText(a.name, cx, cy - lift)
    }
    ctx.textAlign = 'start'
  }

  /**
   * 画飞行中的纸条。
   *
   * 送达时刻来自**消息自己带的 `deliverAtTick`**（服务端在"开始飞"的那一刻就给出来了），
   * 所以这里不抄投递延迟常量——那是两处真相，改一处就会让纸条的落点与"已送达"对不上。
   * 快照里带回来的老消息没这个字段，退回用 `messageDeliveryTicks` 推算。
   */
  function drawNotes(world, scene, tick, messageDeliveryTicks, m) {
    if (world === null) return
    const byId = new Map(liveActors(world, scene).map((a) => [a.id, a]))
    const fallbackDelay = messageDeliveryTicks ?? 10

    // 同一 tick 发出的多条纸条会完全重叠（一个人刚完工汇报、同时把活交接出去），
    // 不错开的话后画的会把先画的整个盖住——而画面上看起来只是"只有一张纸"。
    let drawn = 0
    for (const message of world.messages) {
      if (message.deliveredAtTick !== null) continue
      const at = message.atTick ?? 0
      const deliverAt = message.deliverAtTick ?? at + fallbackDelay
      const t = (tick - at) / Math.max(1, deliverAt - at)
      if (t < 0 || t > 1) continue
      const from = byId.get(message.from)
      const to = byId.get(message.to)
      if (!from || !to) continue

      const ox = (drawn % 3) * 5 - 5
      const oy = Math.floor(drawn / 3) * 5 - 2
      drawn += 1

      const x = m.toX(from.x + (to.x - from.x) * t) + ox
      const y = m.toY(from.z + (to.z - from.z) * t) + oy

      ctx.save()
      ctx.setLineDash([3, 5])
      ctx.strokeStyle = 'rgba(255,255,255,0.18)'
      ctx.lineWidth = 1
      ctx.beginPath()
      ctx.moveTo(m.toX(from.x), m.toY(from.z))
      ctx.lineTo(m.toX(to.x), m.toY(to.z))
      ctx.stroke()
      ctx.restore()

      // 颜色来自内容的 skins 库（快照里的 noteColors），不在代码里写字面色值。
      ctx.fillStyle = scene.noteColors?.[message.kind] ?? '#FF00FF'
      ctx.strokeStyle = 'rgba(0,0,0,0.5)'
      ctx.lineWidth = 1
      ctx.fillRect(x - 3, y - 2.5, 6, 5)
      ctx.strokeRect(x - 3, y - 2.5, 6, 5)
    }
  }

  /**
   * 画一帧。
   *
   * @param {{world: object, scene: object, tick: number, messageDeliveryTicks?: number}} input
   */
  function render(input) {
    const { world, scene, tick, messageDeliveryTicks } = input
    if (world === null || scene === null) return
    lastWorld = world
    lastScene = scene
    const m = metrics(scene)
    ctx.clearRect(0, 0, m.width, m.height)
    // 像素画的第一条纪律：**关掉插值**。`resize()` 改过 canvas 尺寸会重置状态，
    // 所以放在每帧开头（一行，省得将来有人把 resize 挪到别处）。
    ctx.imageSmoothingEnabled = false
    ctx.font = `11px ${UI_FONT}`
    // 渲染层允许看时钟（`src/sim` 才禁止）：帧序列要按真实时间推进。
    const nowMs = Number.isFinite(input.nowMs) ? input.nowMs : (globalThis.performance?.now?.() ?? 0)
    drawGroundAndProps(scene, m)
    drawActors(world, scene, m, nowMs)
    drawNotes(world, scene, tick, messageDeliveryTicks, m)
  }

  /**
   * 点到谁了（点不到返回 null）。
   *
   * 换算与画的**同一套 `metrics`**；容差按**像素**算——用世界单位当容差，
   * 在缩小视角下会变得几乎点不中。
   */
  function pick({ world, scene, clientX, clientY }) {
    const source = scene ?? lastScene
    const sourceWorld = world ?? lastWorld
    if (sourceWorld === null || source === null) return null
    const m = metrics(source)
    if (!(m.scale > 0)) return null
    const rect = canvas.getBoundingClientRect()
    const wx = (clientX - rect.left - m.width / 2) / m.scale
    const wz = (clientY - rect.top - m.height / 2) / m.scale
    let best = null
    let bestPx = pickSlopPx
    for (const a of sourceWorld.agents) {
      const distance = Math.hypot((a.position.x - wx) * m.scale, (a.position.z - wz) * m.scale)
      if (distance <= bestPx) {
        best = a.id
        bestPx = distance
      }
    }
    return best
  }

  /**
   * 角色头顶在**画布内**的像素位置（气泡挂钩用，俯视这一半）。
   * 3D 那一半在 `scene3d.projectToScreen()`；两者必须给出同一种坐标：画布相对像素。
   */
  function anchorOf({ world, scene, agentId }) {
    const source = scene ?? lastScene
    const sourceWorld = world ?? lastWorld
    if (source === null || sourceWorld === null) return null
    const agent = sourceWorld.agents.find((a) => a.id === agentId)
    if (agent === undefined) return null
    const m = metrics(source)
    // 往上抬过角色名那一行（名字画在圆点上方 11px 处）。
    return { x: m.toX(agent.position.x), y: m.toY(agent.position.z) - 26, width: m.width, height: m.height, behind: false }
  }

  return { resize, render, pick, anchorOf, metrics, liveActors, loader }
}
