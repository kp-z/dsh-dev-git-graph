/*
 * Agent World 面板 —— 2D 俯视图（M3-5），数据走 **SSE 增量**（M3-6）。
 *
 * ── 数据流 ────────────────────────────────────────────────────────────────────
 *
 *   1) 启动拉一次**全量快照**（`GET api/world`）；
 *   2) 之后只收 `EventSource(api/events)` 推来的**增量**，就地应用到本地世界。
 *
 * **没有轮询分支**。两条路都活着就会有两个真相：一边轮询一边收增量，
 * 出现不一致时根本判断不出是谁错的。断线由 `EventSource` 自己重连
 * （服务端会按 `Last-Event-ID` 补发断线期间的事件），所以不需要兜底轮询。
 *
 * 增量应用逻辑在 `world-update.js` 里——**纯函数、可以被 node 测**。
 * 留在这里的话，"事件够不够重建画面"就只能靠肉眼看了，而它出问题的表现
 * （角色永远坐在工位上）看起来像渲染层没刷新。
 */

import { applyEvents, decideOnBatch, pruneMessages } from './world-update.js'

const SNAPSHOT_API = './api/world'
const COMMAND_API = './api/command'
const EVENTS_API = './api/events'
/** 超过这么久没收到任何消息（含 sync 心跳），就在状态栏上明说。 */
const STALE_AFTER_MS = 8000

const canvas = document.getElementById('town')
const ctx = canvas.getContext('2d')
const $status = document.getElementById('status')
const $roster = document.getElementById('roster')
const $tasks = document.getElementById('tasks')
const $content = document.getElementById('content')

/** 本地世界（快照起家，之后靠增量维护）。 */
let world = null
/** 快照里的静态部分（场景描述、内容概况、主题、时钟参数）。 */
let meta = null
/** 本地时钟的基准：最近一次收到权威时间的墙钟时刻。 */
let syncBaseMs = 0
/** 最近一次收到任何消息的墙钟时刻（判"过期"用）。 */
let lastMessageMs = 0
/** 连接状态。 */
let connected = false
/** 事件里已经用掉的最后一个 seq。 */
let lastSeq = 0
/** 当前视图：`top`（2D 俯视）或 `3d`。 */
let mode = 'top'
/** 3D 渲染器；没启用或加载失败时是 null。 */
let scene3d = null
/** 3D 加载失败的原因（显示给用户，别再让用户猜）。 */
let scene3dError = null

/** 上一次真正渲染的时刻（节流用）。 */
let lastRenderMs = -1
/** 节流间隔：约 60fps。 */
const RENDER_MIN_GAP_MS = 16

/**
 * 当前的 tick。
 *
 * 没有变更事件的那些步**不会产生任何事件**（没人动就没有帧事件，没人在干活就没有进度事件），
 * 所以本地要在两次权威时间之间自己往前走：每条事件与 `sync` 心跳都会校正基准。
 */
function currentTick() {
  if (world === null) return 0
  const slipped = Math.floor(Math.max(0, performance.now() - syncBaseMs) / (meta?.tickMs ?? 100))
  return world.tick + slipped
}

/** 把设计尺寸写进 canvas 属性，避免高分屏下模糊。 */
function fitCanvas() {
  const rect = canvas.getBoundingClientRect()
  const dpr = window.devicePixelRatio || 1
  canvas.width = Math.max(320, Math.floor(rect.width * dpr))
  canvas.height = Math.max(320, Math.floor(rect.height * dpr))
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
}

const STATE_LABEL = {
  idle: '待命', walking: '赶路', working: '干活', talking: '交谈',
  blocked: '受阻', celebrating: '庆祝', sleeping: '休息',
}
const TASK_LABEL = {
  pending: '待办', ready: '可领取', in_progress: '进行中',
  blocked: '受阻', done: '完成', failed: '失败',
}
const ROLE_LABEL = { lead: 'lead', engineer: '工程师', reviewer: '评审', researcher: '调研', ops: '运维', docs: '文档' }

/** 画场景。只依赖 `scene`（ScenePlan），不读 `world` 的几何字段。 */
function draw(scene) {
  const W = canvas.clientWidth
  const H = canvas.clientHeight
  ctx.clearRect(0, 0, W, H)

  const half = scene.extent.half
  const scale = Math.min(W, H) / (half * 2 * 1.06)
  const toX = (x) => W / 2 + x * scale
  const toY = (z) => H / 2 + z * scale

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
 * 画飞行中的纸条。
 *
 * 送达时刻来自**消息自己带的 `deliverAtTick`**（服务端在"开始飞"的那一刻就给出来了），
 * 所以这里不抄投递延迟常量——那是两处真相，改一处就会让纸条的落点与"已送达"对不上。
 * 快照里带回来的老消息没这个字段，退回用 `messageDeliveryTicks` 推算。
 */
function drawNotes(scene, tick) {
  if (world === null) return
  const byId = new Map(scene.actors.map((a) => [a.id, a]))
  const half = scene.extent.half
  const W = canvas.clientWidth
  const H = canvas.clientHeight
  const scale = Math.min(W, H) / (half * 2 * 1.06)
  const toX = (x) => W / 2 + x * scale
  const toY = (z) => H / 2 + z * scale
  const fallbackDelay = meta?.messageDeliveryTicks ?? 10

  // 同一 tick 发出的多条纸条会完全重叠（一个人刚完工汇报、同时把活交接出去），
  // 不错开的话后画的会把先画的整个盖住——而画面上看起来只是"只有一张纸"。
  let drawn = 0
  for (const m of world.messages) {
    if (m.deliveredAtTick !== null) continue
    const at = m.atTick ?? 0
    const deliverAt = m.deliverAtTick ?? at + fallbackDelay
    const t = (tick - at) / Math.max(1, deliverAt - at)
    if (t < 0 || t > 1) continue
    const from = byId.get(m.from)
    const to = byId.get(m.to)
    if (!from || !to) continue

    const ox = (drawn % 3) * 5 - 5
    const oy = Math.floor(drawn / 3) * 5 - 2
    drawn += 1

    const x = toX(from.x + (to.x - from.x) * t) + ox
    const y = toY(from.z + (to.z - from.z) * t) + oy

    ctx.save()
    ctx.setLineDash([3, 5])
    ctx.strokeStyle = 'rgba(255,255,255,0.18)'
    ctx.lineWidth = 1
    ctx.beginPath()
    ctx.moveTo(toX(from.x), toY(from.z))
    ctx.lineTo(toX(to.x), toY(to.z))
    ctx.stroke()
    ctx.restore()

    // 颜色来自内容的 skins 库（快照里的 noteColors），不在代码里写字面色值。
    ctx.fillStyle = scene.noteColors?.[m.kind] ?? '#FF00FF'
    ctx.strokeStyle = 'rgba(0,0,0,0.5)'
    ctx.lineWidth = 1
    ctx.fillRect(x - 3, y - 2.5, 6, 5)
    ctx.strokeRect(x - 3, y - 2.5, 6, 5)
  }
}

function renderSide(scene, tick) {
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
    .sort((x, y) => (order[x.status] ?? 9) - (order[y.status] ?? 9) || (x.ordinal ?? 0) - (y.ordinal ?? 0))
    .map((t) => {
      const owner = t.owner ? (world.agents.find((a) => a.id === t.owner)?.name ?? t.owner) : '无人'
      const pct = t.status === 'in_progress' ? ` ${Math.round(t.progress * 100)}%` : ''
      return `<li class="t-${t.status}"><span class="badge">${TASK_LABEL[t.status] ?? t.status}${pct}</span> ${t.title} <span class="dim">· ${owner}</span></li>`
    })
    .join('')

  const libs = meta.libraries.filter((l) => l.count > 0).map((l) => `${l.title} ${l.count}`).join(' · ')
  const theme = meta.theme
  $content.textContent =
    `${meta.packs.map((p) => `${p.id}@${p.version}`).join('、')} — ${libs}` +
    (theme ? ` · 主题：${theme.name}（${theme.camera.projection} ${theme.camera.yawDeg}°/${theme.camera.pitchDeg}°）` : '')

  const states = world.agents.reduce((acc, a) => ({ ...acc, [a.state]: (acc[a.state] ?? 0) + 1 }), {})
  const stateText = Object.entries(states).map(([k, v]) => `${STATE_LABEL[k] ?? k} ${v}`).join(' ')
  const flying = world.messages.filter((m) => (m.deliverAtTick ?? 0) > tick).length
  const silentFor = performance.now() - lastMessageMs

  $status.innerHTML = [
    `tick <b>${tick}</b>`,
    world.paused ? '<b class="warn">已暂停</b>' : '<b class="ok">运行中</b>',
    connected ? '<span class="dim">事件流已连接</span>' : '<b class="warn">事件流重连中</b>',
    `seq ${lastSeq}`,
    flying > 0 ? `飞行中纸条 ${flying}` : '',
    (meta.persistErrors ?? 0) > 0 ? `<b class="warn">落盘失败 ${meta.persistErrors} 次</b>` : '',
    // 数据旧了必须说出来：否则"画面不动"会被理解成"世界停了"，而那是两件事。
    silentFor > STALE_AFTER_MS ? `<b class="warn">${Math.round(silentFor / 1000)} 秒没收到事件</b>` : '',
    stateText,
  ]
    .filter(Boolean)
    .join(' · ')
  void scene
}

/**
 * 渲染一帧（按时间戳节流，约 60fps）。
 *
 * **刻意不用 `requestAnimationFrame`**：rAF 在**不可见的标签页里根本不触发**。
 * 而这个面板的典型场景恰恰是"agent 在跑、人不一定在看"——用 rAF 的话，
 * 面板在我们盯着它之前一直是空的（DOM 与画布都停在初始状态），
 * 而这会让"自动化核验"读到一份陈旧 DOM，看起来像面板坏了。
 *
 * 这是真的踩到的：第一版用 rAF 节流，页面在后台时状态栏一直停在"连接中…"，
 * 而同一时刻手动 `fetch` + `EventSource` 都完全正常。
 *
 * 时间戳节流在隐藏标签页里也照常工作（定时器会被浏览器降频，但不会完全不触发），
 * 而这里每次渲染的代价只是十来个 `<li>` 与一次 canvas 重绘。
 */
/**
 * 切到 3D。
 *
 * **动态 `import()` 而不是顶层 import**：three 是 vendor 进来的大文件，
 * 它加载失败（文件缺失、浏览器不支持 import map、没有 WebGL）时，
 * 顶层 import 会把**整个面板**带崩——包括那个"唯一能看清模拟对不对"的俯视图。
 * 动态导入让失败退化成"3D 不可用 + 一句原因"，2D 照常。
 */
async function enable3d() {
  if (scene3d !== null) return true
  if (scene3dError !== null) return false
  try {
    const module = await import('./scene3d.js')
    scene3d = module.createScene3d(document.getElementById('town3d'), {
      onError: (error) => {
        scene3dError = String(error)
        showHint(`3D 渲染出错：${scene3dError}`)
      },
    })
    return true
  } catch (error) {
    // 原因要显示出来：只写"3D 不可用"的话，用户没法判断是少了文件还是浏览器不支持。
    scene3dError = error instanceof Error ? error.message : String(error)
    showHint(`3D 不可用：${scene3dError}（俯视图不受影响）`)
    return false
  }
}

/** 显示一行提示（3D 的问题都在这里说）。 */
function showHint(text) {
  const hint = document.getElementById('view-hint')
  if (hint === null) return
  hint.textContent = text
  hint.hidden = text === ''
}

/** 切换视图。 */
async function setMode(next) {
  if (next === '3d' && !(await enable3d())) next = 'top' // 起不来就留在俯视图，不装作切过去了
  mode = next

  document.getElementById('town').hidden = next !== 'top'
  document.getElementById('town3d').hidden = next !== '3d'
  document.getElementById('view-top').classList.toggle('active', next === 'top')
  document.getElementById('view-3d').classList.toggle('active', next === '3d')

  if (next === '3d' && scene3d !== null) {
    if (meta !== null) scene3d.setPlan(meta.scene)
    scene3d.resize()
  } else if (next === 'top') {
    fitCanvas()
  }
  render(true)
}

function render(force = false) {
  if (world === null || meta === null) return
  const now = performance.now()
  if (!force && now - lastRenderMs < RENDER_MIN_GAP_MS) return
  lastRenderMs = now
  const tick = currentTick()
  if (mode === '3d' && scene3d !== null) {
    scene3d.render(world)
  } else {
    draw(meta.scene)
    drawNotes(meta.scene, tick)
  }
  // 侧栏（花名册/工单）两种视图共用：它是文本，与场景无关。
  renderSide(meta.scene, tick)
}

/** 拉一次全量快照。启动时、以及发现 gap/reset 时用。 */
async function loadSnapshot() {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 5000)
  try {
    const res = await fetch(`${SNAPSHOT_API}?t=${Date.now()}`, { cache: 'no-store', signal: controller.signal })
    if (!res.ok) {
      const body = await res.json().catch(() => ({}))
      $status.innerHTML = `<b class="warn">读不到世界（HTTP ${res.status}）</b> ${body.error ?? ''}`
      return
    }
    const snap = await res.json()
    world = snap.world
    meta = {
      scene: snap.scene,
      libraries: snap.content.libraries,
      packs: snap.content.packs,
      theme: snap.scene?.theme ?? null,
      tickMs: snap.runtime.tickMs,
      messageDeliveryTicks: snap.runtime.messageDeliveryTicks,
      persistErrors: snap.runtime.diagnostics.persistErrors,
    }
    lastSeq = snap.seq
    syncBaseMs = performance.now()
    lastMessageMs = performance.now()
    // 3D 用**快照里的** ScenePlan 重建静态部分（地面/站点/光照/相机），位姿由 `world` 每帧提供。
    // 换快照就重建——那是布局可能真的变了的时候。
    if (mode === '3d' && scene3d !== null) {
      scene3d.setPlan(snap.scene)
      scene3d.resize()
    }
    render(true) // 首屏**强制**画一次：节流不该让"打开面板"这一步被跳过
  } catch (error) {
    $status.innerHTML = `<b class="warn">读不到世界</b> ${error}`
  } finally {
    clearTimeout(timer)
  }
}

/** 收到一批增量。 */
function receive(events) {
  if (world === null || events.length === 0) return
  applyEvents(world, events)
  const last = events[events.length - 1]
  if (last !== undefined) lastSeq = Math.max(lastSeq, last.seq)
  // 每条事件都是一次权威时间校准。
  syncBaseMs = performance.now()
  pruneMessages(world)
  render()
}

/** 连事件流。断线由 EventSource 自己重连，服务端按 Last-Event-ID 补发。 */
function connect() {
  const source = new EventSource(EVENTS_API)

  source.onopen = () => {
    connected = true
    lastMessageMs = performance.now()
    render()
  }

  source.onerror = () => {
    // 不在这里重连：EventSource 自己会，而且**它会带上 Last-Event-ID**，
    // 服务端据此补发断线期间的事件。自己再写一套重连只会和它打架。
    connected = false
    render()
  }

  source.onmessage = (frame) => {
    lastMessageMs = performance.now()
    let message
    try {
      message = JSON.parse(frame.data)
    } catch {
      return
    }

    if (message.type === 'events') {
      const first = message.events?.[0]
      // **gap 自愈的客户端一半**：判定逻辑在 `decideOnBatch` 里（纯函数、有测试）。
      // 重点是**倒退也算断裂**——重开一局时 seq 从头开始，
      // 只看"是否跳过了一段"会漏掉这种情况，于是新世界的事件被叠到旧世界上，
      // 而画面上只是一堆对不上的状态，不会报任何错。
      if (first !== undefined && decideOnBatch(first.seq, lastSeq) === 'resync') {
        void loadSnapshot()
        return
      }
      receive(message.events ?? [])
      return
    }

    if (message.type === 'sync') {
      if (world === null) return
      // 权威时间。刻意走 applyEvents（而不是在这里赋值），
      // 让"sync 怎么处理"只有一处实现、也有测试。
      applyEvents(world, [{ seq: message.seq, tick: message.tick, type: 'sync', payload: message }])
      syncBaseMs = performance.now()
      connected = true
      render()
      return
    }

    if (message.type === 'reset') {
      // 服务端明说"补不齐"（那段历史已经滚出环形缓冲）。
      void loadSnapshot()
      return
    }

    if (message.type === 'hello') {
      lastSeq = Math.max(lastSeq, message.seq ?? 0)
      render()
    }
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
      // 成功的话世界状态会经事件流回来（`world.paused` 事件），不需要手动刷新。
    } catch (error) {
      $status.innerHTML = `<b class="warn">命令失败</b> ${error}`
    }
  })
})

window.addEventListener('resize', () => {
  fitCanvas()
  if (scene3d !== null) scene3d.resize()
  render(true)
})

document.getElementById('view-top').addEventListener('click', () => void setMode('top'))
document.getElementById('view-3d').addEventListener('click', () => void setMode('3d'))

// 本地时钟的可见部分：每 250ms 重画一次，让"没事件但时间在走"看得见，
// 也让纸条在两次事件之间平滑飞行。
setInterval(render, 250)

fitCanvas()
void loadSnapshot()
connect()
