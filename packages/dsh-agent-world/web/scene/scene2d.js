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

/** 俯视场景留边：世界边长 × 这个系数决定画面里小镇占多大（1.06 = 四周留一点空）。 */
const FIT = 1.06

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
    const scale = Math.min(width, height) / (half * 2 * FIT)
    return {
      width,
      height,
      half,
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
    }))
  }

  /** 画地块与站点。 */
  function drawGroundAndProps(scene, m) {
    for (const g of scene.ground) {
      const x = m.toX(g.x - g.width / 2)
      const y = m.toY(g.z - g.depth / 2)
      const w = g.width * m.scale
      const d = g.depth * m.scale
      rounded(ctx, x, y, w, d, 10)
      ctx.fillStyle = g.color
      ctx.fill()
      ctx.strokeStyle = 'rgba(255,255,255,0.10)'
      ctx.lineWidth = 1
      ctx.stroke()
      ctx.fillStyle = 'rgba(255,255,255,0.55)'
      ctx.font = `600 11px ${UI_FONT}`
      ctx.fillText(g.name, x + 10, y + 17)
    }

    for (const p of scene.props) {
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

  /** 画角色（圆点 + 名字）。 */
  function drawActors(world, scene, m) {
    ctx.textAlign = 'center'
    for (const a of liveActors(world, scene)) {
      const cx = m.toX(a.x)
      const cy = m.toY(a.z)
      const r = 7
      if (a.state === 'walking') {
        // 空心 = 在路上。一眼能分辨"在站上"和"赶路中"。
        ctx.beginPath()
        ctx.arc(cx, cy, r, 0, Math.PI * 2)
        ctx.lineWidth = 2.5
        ctx.strokeStyle = a.color
        ctx.stroke()
      } else {
        ctx.beginPath()
        ctx.arc(cx, cy, r, 0, Math.PI * 2)
        ctx.fillStyle = a.color
        ctx.fill()
        ctx.lineWidth = 1.5
        ctx.strokeStyle = 'rgba(0,0,0,0.45)'
        ctx.stroke()
      }
      ctx.fillStyle = 'rgba(255,255,255,0.85)'
      ctx.font = `10px ${UI_FONT}`
      ctx.fillText(a.name, cx, cy - r - 4)
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
    ctx.font = `11px ${UI_FONT}`
    drawGroundAndProps(scene, m)
    drawActors(world, scene, m)
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

  return { resize, render, pick, anchorOf, metrics, liveActors }
}
