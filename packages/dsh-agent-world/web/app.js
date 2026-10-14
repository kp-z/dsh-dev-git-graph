/*
 * Agent World 面板 —— 2D 俯视图（M3-5 的最小可见版本）。
 *
 * 它**不是**最终的 3D 场景（那是 M4）。它存在的理由是两件事：
 *   1. 让模拟立刻"看得见"——在那之前只能读工具输出的文本；
 *   2. 当 3D 调不出来的时候，它是唯一能看清模拟对不对的窗口。
 * 所以这个俯视图**值得永久保留**，M4 之后作为"调试视图"切换。
 *
 * ── 它只吃两样东西 ───────────────────────────────────────────────────────────
 *
 * - `snapshot.scene`（**ScenePlan**）：要摆什么。地块、站点、角色，颜色**已经解析好**。
 * - `snapshot.world`：花名册与工单板这类文本内容。
 *
 * 关键在于：**这里没有任何 token 解析**。以前的版本要自己剥 `skin.` 前缀再查
 * `palette`，现在不用了——那份活归服务端（决策 D22）。所以将来换成 three.js，
 * 换掉的只是"怎么把 ScenePlan 画出来"，不会碰到上游任何一层。
 */

const API = './api/world'
const COMMAND_API = './api/command'
const POLL_MS = 400

const canvas = document.getElementById('town')
const ctx = canvas.getContext('2d')
const $status = document.getElementById('status')
const $roster = document.getElementById('roster')
const $tasks = document.getElementById('tasks')
const $content = document.getElementById('content')

let latest = null
/** 上一次成功取到快照的时刻（ms）。面板靠它显示"多久没更新了"。 */
let lastOkAt = 0
/** 请求超时（ms）。 */
const FETCH_TIMEOUT_MS = 4000
/** 超过这么久没更新，就在状态栏上明确说出来。 */
const STALE_AFTER_MS = 3000

/** 把设计尺寸写进 canvas 属性，避免高分屏下模糊。 */
function fitCanvas() {
  const rect = canvas.getBoundingClientRect()
  const dpr = window.devicePixelRatio || 1
  canvas.width = Math.max(320, Math.floor(rect.width * dpr))
  canvas.height = Math.max(320, Math.floor(rect.height * dpr))
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
}

const STATE_LABEL = {
  idle: '待命',
  walking: '赶路',
  working: '干活',
  talking: '交谈',
  blocked: '受阻',
  celebrating: '庆祝',
  sleeping: '休息',
}
const TASK_LABEL = {
  pending: '待办',
  ready: '可领取',
  in_progress: '进行中',
  blocked: '受阻',
  done: '完成',
  failed: '失败',
}
const ROLE_LABEL = {
  lead: 'lead',
  engineer: '工程师',
  reviewer: '评审',
  researcher: '调研',
  ops: '运维',
  docs: '文档',
}

/**
 * 画一帧。
 *
 * 只依赖 `scene`，不读 `world` 的几何字段——这就是"渲染层是哑客户端"的样子。
 */
function draw(scene) {
  const W = canvas.clientWidth
  const H = canvas.clientHeight
  ctx.clearRect(0, 0, W, H)

  // 世界坐标 [-half, half] → 画布，留 6% 边距。半径来自内容（小镇多大是内容说了算）。
  const half = scene.extent.half
  const pad = 0.06
  const scale = Math.min(W, H) / (half * 2 * (1 + pad))
  const toX = (x) => W / 2 + x * scale
  const toY = (z) => H / 2 + z * scale

  // 1) 地面
  ctx.font = '11px system-ui, sans-serif'
  for (const g of scene.ground) {
    const x = toX(g.x - g.width / 2)
    const y = toY(g.z - g.depth / 2)
    ctx.fillStyle = g.color
    ctx.fillRect(x, y, g.width * scale, g.depth * scale)
    ctx.strokeStyle = 'rgba(255,255,255,0.10)'
    ctx.lineWidth = 1
    ctx.strokeRect(x + 0.5, y + 0.5, g.width * scale - 1, g.depth * scale - 1)
    ctx.fillStyle = 'rgba(255,255,255,0.55)'
    ctx.fillText(g.name, x + 8, y + 16)
  }

  // 2) 站点
  for (const p of scene.props) {
    const size = p.capacity > 1 ? 16 : 12
    const x = toX(p.x) - size / 2
    const y = toY(p.z) - size / 2
    ctx.fillStyle = p.color
    ctx.fillRect(x, y, size, size)
    ctx.strokeStyle = p.occupied ? '#ffffff' : 'rgba(0,0,0,0.35)'
    ctx.lineWidth = p.occupied ? 2 : 1
    ctx.strokeRect(x, y, size, size)
  }

  // 3) 角色
  for (const a of scene.actors) {
    const cx = toX(a.x)
    const cy = toY(a.z)
    const r = 7
    ctx.beginPath()
    ctx.arc(cx, cy, r, 0, Math.PI * 2)
    if (a.state === 'walking') {
      // 空心 = 在路上。一眼能分辨"在站上"和"赶路中"。
      ctx.lineWidth = 2.5
      ctx.strokeStyle = a.color
      ctx.stroke()
    } else {
      ctx.fillStyle = a.color
      ctx.fill()
      ctx.lineWidth = 1.5
      ctx.strokeStyle = 'rgba(0,0,0,0.45)'
      ctx.stroke()
    }
    ctx.fillStyle = 'rgba(255,255,255,0.85)'
    ctx.font = '10px system-ui, sans-serif'
    ctx.textAlign = 'center'
    ctx.fillText(a.name, cx, cy - r - 4)
    ctx.textAlign = 'start'
  }
}

/**
 * 画飞行中的纸条（M2.5-2 让这件事终于有数据了）。
 *
 * 位置按 `tick` 在"发出"与"送达"之间线性插值——**投递延迟是服务端告诉我们的**
 * （`runtime.messageDeliveryTicks`），不在这里写死。所以以后改延迟不会出现
 * "纸条早到了/晚到了"这种对不上的现象。
 */
function drawNotes(scene, world, deliveryTicks) {
  if (!deliveryTicks || deliveryTicks <= 0) return
  const byId = new Map(scene.actors.map((a) => [a.id, a]))
  const half = scene.extent.half
  const W = canvas.clientWidth
  const H = canvas.clientHeight
  const scale = Math.min(W, H) / (half * 2 * 1.06)
  const toX = (x) => W / 2 + x * scale
  const toY = (z) => H / 2 + z * scale

  // 同一 tick 发出的多条纸条会**完全重叠**（比如一个人刚完工汇报、同时把活交接出去，
  // 两张纸都从同一个人手上出发）。不错开的话，后画的那张会把先前那张整个盖住——
  // 而画面上看起来只是"只有一张纸"，不会有人想到是渲染问题。
  // 这是用像素计数发现的（report 色的像素数是 0），肉眼扫截图看不出来。
  let drawn = 0
  for (const m of world.messages) {
    if (m.deliveredAtTick !== null) continue          // 已送达
    const t = (world.tick - m.atTick) / deliveryTicks
    if (t < 0 || t > 1) continue                       // 还没发出 / 已经超出飞行窗口
    const from = byId.get(m.from)
    const to = byId.get(m.to)
    if (!from || !to) continue

    const ox = (drawn % 3) * 5 - 5
    const oy = Math.floor(drawn / 3) * 5 - 2
    drawn += 1

    const x = toX(from.x + (to.x - from.x) * t) + ox
    const y = toY(from.z + (to.z - from.z) * t) + oy

    // 一条淡虚线表示飞行路线，让人看懂"从谁到谁"。
    ctx.save()
    ctx.setLineDash([3, 5])
    ctx.strokeStyle = 'rgba(255,255,255,0.18)'
    ctx.lineWidth = 1
    ctx.beginPath()
    ctx.moveTo(toX(from.x), toY(from.z))
    ctx.lineTo(toX(to.x), toY(to.z))
    ctx.stroke()
    ctx.restore()

    // 纸条本体：小方块。颜色**来自内容的 skins 库**（`scene.noteColors`），
    // 不在代码里写字面色值——那样"换个纸条颜色"就得改代码，直接违反第一条红线。
    ctx.fillStyle = scene.noteColors?.[m.kind] ?? '#FF00FF'
    ctx.strokeStyle = 'rgba(0,0,0,0.5)'
    ctx.lineWidth = 1
    ctx.fillRect(x - 3, y - 2.5, 6, 5)
    ctx.strokeRect(x - 3, y - 2.5, 6, 5)
  }
}

function renderSide(snapshot) {
  const world = snapshot.world

  $roster.innerHTML = world.agents
    .map((a) => {
      const where = a.station
        ? (world.stations.find((s) => s.id === a.station)?.name ?? a.station)
        : a.targetStation
          ? `→ ${world.stations.find((s) => s.id === a.targetStation)?.name ?? a.targetStation}`
          : '广场'
      const task = a.carrying ? (world.tasks.find((t) => t.id === a.carrying)?.title ?? a.carrying) : null
      return `<li><b>${a.name}</b> <span class="dim">${ROLE_LABEL[a.role] ?? a.role}</span> · ${STATE_LABEL[a.state] ?? a.state} @ ${where}${task ? ` · <i>${task}</i>` : ''}</li>`
    })
    .join('')

  const order = { in_progress: 0, ready: 1, pending: 2, blocked: 3, done: 4, failed: 5 }
  $tasks.innerHTML = [...world.tasks]
    .sort((x, y) => (order[x.status] ?? 9) - (order[y.status] ?? 9) || x.ordinal - y.ordinal)
    .map((t) => {
      const owner = t.owner ? (world.agents.find((a) => a.id === t.owner)?.name ?? t.owner) : '无人'
      const pct = t.status === 'in_progress' ? ` ${Math.round(t.progress * 100)}%` : ''
      return `<li class="t-${t.status}"><span class="badge">${TASK_LABEL[t.status] ?? t.status}${pct}</span> ${t.title} <span class="dim">· ${owner}</span></li>`
    })
    .join('')

  const libs = snapshot.content.libraries
    .filter((l) => l.count > 0)
    .map((l) => `${l.title} ${l.count}`)
    .join(' · ')
  const theme = snapshot.scene?.theme
  $content.textContent = `${snapshot.content.packs.map((p) => `${p.id}@${p.version}`).join('、')} — ${libs}${theme ? ` · 主题：${theme.name}（${theme.camera.projection} ${theme.camera.yawDeg}°/${theme.camera.pitchDeg}°）` : ''}`

  const states = world.agents.reduce((acc, a) => ({ ...acc, [a.state]: (acc[a.state] ?? 0) + 1 }), {})
  const stateText = Object.entries(states)
    .map(([k, v]) => `${STATE_LABEL[k] ?? k} ${v}`)
    .join(' ')
  $status.innerHTML = [
    `tick <b>${world.tick}</b>`,
    world.paused ? '<b class="warn">已暂停</b>' : '<b class="ok">运行中</b>',
    `seq ${snapshot.seq}`,
    `事件 ${snapshot.runtime.diagnostics.ticks} 步`,
    snapshot.runtime.pending > 0 ? `待处理命令 ${snapshot.runtime.pending}` : '',
    (() => {
      const flying = world.messages.filter((m) => m.deliveredAtTick === null).length
      return flying > 0 ? `飞行中纸条 ${flying}` : ''
    })(),
    // 画布上的一切都来自上一帧成功取到的快照。数据旧了就必须说出来——
    // 否则"画面不动"会被理解成"世界停了"，而这两件事完全不同。
    Date.now() - lastOkAt > STALE_AFTER_MS
      ? `<b class="warn">数据已过期 ${Math.round((Date.now() - lastOkAt) / 1000)} 秒</b>`
      : '',
    // 落盘失败是"世界照常跑、但存档其实是坏的"那种故障，必须一眼看到。
    (snapshot.runtime.diagnostics.persistErrors ?? 0) > 0
      ? `<b class="warn">落盘失败 ${snapshot.runtime.diagnostics.persistErrors} 次</b>`
      : '',
    stateText,
  ]
    .filter(Boolean)
    .join(' · ')
}

/**
 * 取一次快照。
 *
 * **必须带超时**。没有超时的话，一个挂住的连接会让面板永远停在最后一帧，
 * 而画面上看不出任何异常——看起来就像"世界不跑了"。这是真的踩到的：
 * 我把验证服务器重启了一次，页面就静静地冻在一个旧 tick 上，状态栏还写着"运行中"。
 */
async function poll() {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)
  try {
    const res = await fetch(`${API}?t=${Date.now()}`, { cache: 'no-store', signal: controller.signal })
    if (!res.ok) {
      const body = await res.json().catch(() => ({}))
      $status.innerHTML = `<b class="warn">读不到世界（HTTP ${res.status}）</b> ${body.error ?? ''}`
      return
    }
    const snapshot = await res.json()
    latest = snapshot
    lastOkAt = Date.now()
    draw(snapshot.scene)
    drawNotes(snapshot.scene, snapshot.world, snapshot.runtime.messageDeliveryTicks)
    renderSide(snapshot)
  } catch (error) {
    const why = controller.signal.aborted ? `超时（${FETCH_TIMEOUT_MS}ms 没响应）` : error
    const ago = lastOkAt === 0 ? '从未成功过' : `画面停留在 ${Math.round((Date.now() - lastOkAt) / 1000)} 秒前的状态`
    $status.innerHTML = `<b class="warn">读不到世界</b> ${why} · ${ago}`
  } finally {
    clearTimeout(timer)
  }
}

document.querySelectorAll('button[data-command]').forEach((button) => {
  button.addEventListener('click', async () => {
    const kind = button.dataset.command
    try {
      const res = await fetch(COMMAND_API, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ command: { kind } }),
      })
      const body = await res.json()
      if (!res.ok) $status.innerHTML = `<b class="warn">命令被拒</b> ${body.error ?? ''}`
      else poll()
    } catch (error) {
      $status.innerHTML = `<b class="warn">命令失败</b> ${error}`
    }
  })
})

window.addEventListener('resize', () => {
  fitCanvas()
  if (latest) {
    draw(latest.scene)
    drawNotes(latest.scene, latest.world, latest.runtime.messageDeliveryTicks)
  }
})

fitCanvas()
poll()
setInterval(poll, POLL_MS)
