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
import { createDialogueUi } from './dialogue-ui.js'
import { dialogueEventsFromFrame } from './dialogue-state.js'

const SNAPSHOT_API = './api/world'
const COMMAND_API = './api/command'
const EVENTS_API = './api/events'
/** 发话端点（M6-5 的发送侧；回复走 SSE 的 `dialogue` 帧，见 `src/protocol/dialogue.ts`）。 */
const SAY_API = './api/say'
/** 超过这么久没收到任何消息（含 sync 心跳），就在状态栏上明说。 */
const STALE_AFTER_MS = 8000
/**
 * "他在想…"最多挂多少步。
 *
 * 契约要求宿主超时时发 `failed`，但**宿主自己挂了**那条事件就永远不会来——
 * 那时面板会一直显示"他在想…"，也就是在装作没事（GOAL 红线 6）。
 * 所以面板也有一条自己的兜底：同步心跳每次来都查一遍。
 */
const DIALOGUE_SILENT_TICKS = 300
/** 点角色时的容差（像素）：点在小人旁边一点也算点到他了。 */
const PICK_SLOP_PX = 16

const canvas = document.getElementById('town')
const ctx = canvas.getContext('2d')
const $status = document.getElementById('status')
const $roster = document.getElementById('roster')
const $tasks = document.getElementById('tasks')
const $content = document.getElementById('content')
const $bubbles = document.getElementById('bubbles')
/** 3D 画布：拾取（点人）与气泡投影都用它。 */
const canvas3d = document.getElementById('town3d')

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
/**
 * **下一个期望**的事件序号（不是「已经消费的最后一个」）。
 *
 * 这个区别是 R21 修掉的一个真 bug 的根因，详见 `world-update.js` 里 `decideOnBatch` 的注释：
 * `world.seq`（快照与 `hello` 里给的就是它）在协议里的含义是「下一个要分配的号」。
 * 面板原来把它当「最后消费的号」，于是每来一批事件都判定成「缺了一段」而重拉快照——
 * 每秒约 10 次请求 + 每次重建泄漏约 6 个纹理，而画面看起来完全正常。
 */
let nextSeq = 1
/** 上一次重拉快照的时刻，用来给重拉做节流（异常情况下不要形成请求风暴）。 */
let lastResyncMs = 0
/** 两次重拉之间至少间隔这么久。 */
const RESYNC_MIN_GAP_MS = 1000
/** 当前视图：`top`（2D 俯视）或 `3d`。 */
let mode = 'top'
/** 3D 渲染器；没启用或加载失败时是 null。 */
let scene3d = null
/** 3D 加载失败的原因（显示给用户，别再让用户猜）。 */
let scene3dError = null
/** 对话面板（M6-5）。状态机在 `dialogue-state.js`，DOM 在 `dialogue-ui.js`。 */
let dialogue = null
/** 头顶气泡的 DOM 节点（按 agentId 复用，只改位置与文本，不每帧重建）。 */
const bubbleNodes = new Map()

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

/**
 * 俯视图要画的角色：**实时位姿**（`world.agents`）+ **内容里的颜色**（`scene.actors`）。
 *
 * 原来这里直接遍历 `scene.actors`——那是**快照那一帧**的静态布局，
 * 于是俯视图里的人从来不动（"角色永远站在开局的位置"），而 3D 视图吃的是 `world.agents`：
 * 两个视图会给出互相矛盾的两个真相，而看起来都"正常"。
 * 颜色仍然只来自内容（ScenePlan），不在代码里写角色色（与 D31/D37 同源）。
 */
function liveActors(scene) {
  const plan = scene.actors ?? []
  if (world === null || world.agents === undefined) return plan
  const byId = new Map(plan.map((a) => [a.id, a]))
  // 快照还没回来、或角色是新加的时候退回一个中性色（与图例同色），而不是凭空编一个人设。
  const fallback = '#4fa3d1'
  return world.agents.map((a) => ({
    id: a.id,
    name: a.name,
    state: a.state,
    x: a.position?.x ?? byId.get(a.id)?.x ?? 0,
    z: a.position?.z ?? byId.get(a.id)?.z ?? 0,
    color: byId.get(a.id)?.color ?? fallback,
  }))
}

/** 画场景。只依赖 `scene`（ScenePlan）+ 实时位姿；不读内容的字面值。 */
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

  for (const a of liveActors(scene)) {
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
  const byId = new Map(liveActors(scene).map((a) => [a.id, a]))
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
  // 花名册每一行都是"跟他说话"的入口（俯视与 3D 都点得到，因为它不在画布上）。
  const thinking = new Set((dialogue?.thinkingTurns() ?? []).map((t) => t.agentId))
  const talkingTo = dialogue?.agentId() ?? null
  $roster.innerHTML = world.agents
    .map((a) => {
      const where = a.station
        ? (world.stations.find((s) => s.id === a.station)?.name ?? a.station)
        : a.targetStation
          ? `→ ${world.stations.find((s) => s.id === a.targetStation)?.name ?? a.targetStation}`
          : '广场'
      const task = a.carrying ? (world.tasks.find((t) => t.id === a.carrying)?.title ?? a.carrying) : null
      const cls = `roster-row${a.id === talkingTo ? ' active' : ''}`
      // "他在想…"要落在**花名册这一行**上：面板可能已经关了（或你在看别人），
      // 但"我发出去的那句话还没回"是用户最需要知道的状态。
      const pending = thinking.has(a.id) ? ' <b class="warn">他在想…</b>' : ''
      return `<li class="${cls}" data-agent="${a.id}" title="点这里跟他说话"><b>${a.name}</b> <span class="dim">${ROLE_LABEL[a.role] ?? a.role}</span> · ${STATE_LABEL[a.state] ?? a.state} @ ${where}${task ? ` · <i>${task}</i>` : ''}${pending}</li>`
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

  // 3D 模式下把渲染器的真实计数显示出来——"不卡"要能被看见，否则只是承诺。
  let perf = ''
  if (mode === '3d' && scene3d !== null) {
    const st = scene3d.stats()
    perf = `${st.fps} fps · 帧 ${st.frameMs}ms（簿记 ${st.applyMs} / 绘制 ${st.drawMs}）· 绘制 ${st.drawCalls} · 三角形 ${st.triangles.toLocaleString()} · 纹理 ${st.textures} · 几何 ${st.geometries} · 重建 ${st.planRebuilds}`
  }

  const states = world.agents.reduce((acc, a) => ({ ...acc, [a.state]: (acc[a.state] ?? 0) + 1 }), {})
  const stateText = Object.entries(states).map(([k, v]) => `${STATE_LABEL[k] ?? k} ${v}`).join(' ')
  const flying = world.messages.filter((m) => (m.deliverAtTick ?? 0) > tick).length
  const silentFor = performance.now() - lastMessageMs
  const waiting = dialogue?.thinkingTurns().length ?? 0

  $status.innerHTML = [
    `tick <b>${tick}</b>`,
    world.paused ? '<b class="warn">已暂停</b>' : '<b class="ok">运行中</b>',
    connected ? '<span class="dim">事件流已连接</span>' : '<b class="warn">事件流重连中</b>',
    `下一个 seq ${nextSeq}`,
    perf,
    flying > 0 ? `飞行中纸条 ${flying}` : '',
    // "有几句话还在等回复"要看得见：不然用户会以为面板没收到（然后重发一遍）。
    waiting > 0 ? `<b class="warn">${waiting} 句话在等回复</b>` : '',
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
      // 内容引用了渲染器没有的构建器时**必须说出来**：那种情况下画面会多出
      // 几个品红方块，而"为什么是品红"完全看不出来。
      onMissing: ({ models, builders, registered, assets }) => {
        const parts = []
        if (builders.length > 0) {
          parts.push(`缺构建器 ${builders.join(' / ')}（已实现：${registered.join(' / ')}）`)
        }
        if (models.length > 0) parts.push(`缺模型 ${models.join(' / ')}`)
        // 资源加载失败**单独一类**：它不是"内容写错了"，而是"文件没发出去 / 路径不对"，
        // 排查动作完全不同（去看 src/vendor/ 与白名单，而不是去看内容）。
        if (assets !== undefined && assets.length > 0) {
          parts.push(`模型文件加载失败 ${assets.join('；')}`)
        }
        showHint(`内容引用了渲染器给不出的模型：${parts.join('；')}。这些位置画的是品红占位块。`)
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

/**
 * 头顶气泡（M6-5）。
 *
 * 位置每帧算：3D 走 `scene3d.projectToScreen`（正交相机投影 + 角色实测头顶高度），
 * 俯视走**与 `draw()` 完全同一套比例**——抄第二份公式出来，气泡和人的位置就会慢半拍地不一致，
 * 而那种错看起来像"气泡没跟着走"。节点按 agentId 复用：这个循环每秒要跑十几次，
 * 每帧重建 DOM 就是一直在制造垃圾。
 */
function updateBubbles() {
  if ($bubbles === null || meta === null) return
  const list = dialogue === null ? [] : dialogue.bubblesFor(performance.now())
  const scene = meta.scene
  const W = canvas.clientWidth
  const H = canvas.clientHeight
  const half = scene.extent?.half ?? 8
  const scale = Math.min(W, H) / (half * 2 * 1.06)
  const seen = new Set()

  for (const bubble of list) {
    const agent = world?.agents.find((a) => a.id === bubble.agentId)
    if (agent === undefined) continue

    let x = 0
    let y = 0
    let visible = true
    if (mode === '3d' && scene3d !== null && canvas3d.hidden === false) {
      const p = scene3d.projectToScreen(agent.position.x, scene3d.topYOf(agent.id), -agent.position.z)
      x = p.x
      y = p.y - 4
      visible = p.behind === false && p.width > 0
    } else if (mode === 'top' && canvas.hidden === false) {
      // 与 `draw()` 同样的换算（比例、中心），再往上抬过角色名那一行。
      x = W / 2 + agent.position.x * scale
      y = H / 2 + agent.position.z * scale - 26
    } else {
      visible = false
    }
    if (!visible) continue

    seen.add(agent.id)
    let entry = bubbleNodes.get(agent.id)
    if (entry === undefined) {
      const node = document.createElement('div')
      const name = document.createElement('b')
      const text = document.createElement('span')
      node.append(name, text)
      $bubbles.append(node)
      entry = { node, name, text, sig: null }
      bubbleNodes.set(agent.id, entry)
    }
    const sig = `${bubble.phase}\u0001${bubble.text}`
    if (entry.sig !== sig) {
      // 名字来自世界数据；文本用 textContent（回复正文是模型产出的内容，不是标记）。
      entry.node.className = `bubble d-${bubble.phase}`
      entry.name.textContent = agent.name
      entry.text.textContent = bubble.text
      entry.sig = sig
    }
    entry.node.style.left = `${Math.round(x)}px`
    entry.node.style.top = `${Math.round(y)}px`
  }

  // 淡出/离场的气泡要**真的摘掉**，否则 DOM 会随着"聊过多少人"一直涨。
  for (const [agentId, entry] of bubbleNodes) {
    if (seen.has(agentId)) continue
    entry.node.remove()
    bubbleNodes.delete(agentId)
  }
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
  updateBubbles()
  // 面板只重画签名变了的东西；"他在想…（12s）"里的秒数靠这次调用更新。
  dialogue?.render(now)
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
    // 快照的 `seq` 就是「下一个要分配的号」，所以直接赋值——这正是修掉那个 bug 的关键一步。
    nextSeq = snap.seq
    // 角色的名字只从世界数据来（D37：人设是内容，代码里没有角色名）。
    dialogue?.setAgents(world.agents)
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

// ── 对话（M6-5）───────────────────────────────────────────────────────────────
//
// 端点在契约里（`src/protocol/dialogue.ts`）：`POST ./api/say` 只表示"话收到了"，
// 回复走 SSE 的 `DialogueEvent`。所以这里**不轮询、不在请求里等模型**——
// R21 的教训是"前端卡顿常常来自在错误的层等了不该等的东西"。

/**
 * 发一次话。**宿主拥有端点，面板只负责把失败翻成能下手的人话**。
 *
 * 刻意**不重试**：契约说这条请求是同步收话，失败就是失败；
 * 静默重试只会让同一句话在宿主那边出现两遍，而用户完全不知道。
 *
 * @param {{agentId: string, text: string}} request - `SayRequest`。
 * @returns {Promise<{ok: true, turnId?: string} | {ok: false, status: number, reason?: string, text?: string, error?: unknown}>}
 */
async function sayToAgent({ agentId, text }) {
  const controller = new AbortController()
  // 收话应当**立刻**返回（模型在后台想）；等 10 秒还没回说明端点那边在等不该等的东西。
  const timer = setTimeout(() => controller.abort(), 10000)
  try {
    const res = await fetch(SAY_API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ agentId, text }),
      signal: controller.signal,
    })
    // 响应体可能是 HTML（404 页面、反向代理），所以解析失败也要能过去——
    // 直接 `res.json()` 会让这种最常见的失败变成一个看不懂的 SyntaxError。
    const rawText = await res.text().catch(() => null)
    let body = null
    if (rawText !== null && rawText !== '') {
      try {
        body = JSON.parse(rawText)
      } catch {
        body = null
      }
    }
    if (!res.ok) return { ok: false, status: res.status, reason: body?.reason, text: rawText ?? undefined }
    if (body === null || body.accepted !== true) {
      return {
        ok: false,
        status: res.status,
        reason: body?.reason ?? (body === null ? '响应不是 JSON' : undefined),
        text: rawText ?? undefined,
      }
    }
    return { ok: true, turnId: body.turnId }
  } catch (error) {
    return { ok: false, status: 0, error }
  } finally {
    clearTimeout(timer)
  }
}

/** 点到人之后：再点一次同一个人就关掉（toggle 比"必须找关闭按钮"少一步）。 */
function openDialogueFor(agentId) {
  if (agentId === null || agentId === undefined || dialogue === null) return
  dialogue.toggle(agentId)
  render(true)
}

/**
 * 俯视图里点到谁了。
 *
 * 换算比例**与 `draw()` 一致**（同样的 `scale` 与中心），容差按**像素**算：
 * 用世界单位当容差，在缩小视角下会变得几乎点不中。
 */
function pickTopActor(clientX, clientY) {
  if (world === null || meta === null) return null
  const rect = canvas.getBoundingClientRect()
  const half = meta.scene.extent?.half ?? 8
  const scale = Math.min(canvas.clientWidth, canvas.clientHeight) / (half * 2 * 1.06)
  if (!(scale > 0)) return null
  const wx = (clientX - rect.left - canvas.clientWidth / 2) / scale
  const wz = (clientY - rect.top - canvas.clientHeight / 2) / scale
  let best = null
  let bestPx = PICK_SLOP_PX
  for (const a of world.agents) {
    const distance = Math.hypot((a.position.x - wx) * scale, (a.position.z - wz) * scale)
    if (distance <= bestPx) {
      best = a.id
      bestPx = distance
    }
  }
  return best
}

/**
 * 画布上的点击：**按下与抬起在同一点、且时间不太长，才算点击**。
 *
 * 3D 的 `OrbitControls` 一直在监听拖拽——不判位移的话，"转个视角"会顺手弹出对话面板，
 * 而那时用户根本不知道自己点到谁了。
 */
function bindPick(canvasEl, pick) {
  let downX = 0
  let downY = 0
  let downAt = 0
  canvasEl.addEventListener('pointerdown', (event) => {
    downX = event.clientX
    downY = event.clientY
    downAt = event.timeStamp
  })
  canvasEl.addEventListener('pointerup', (event) => {
    if (Math.abs(event.clientX - downX) > 5 || Math.abs(event.clientY - downY) > 5) return
    if (event.timeStamp - downAt > 700) return
    openDialogueFor(pick(event.clientX, event.clientY))
  })
}

/** 收到一批增量。 */
function receive(events) {
  if (world === null || events.length === 0) return
  applyEvents(world, events)
  const last = events[events.length - 1]
  // 应用之后，「下一个期望号」= 最后一条 + 1（**不是「最后一条」**）。
  if (last !== undefined) nextSeq = last.seq + 1
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

    // 对话帧（M6-5）。帧的确切形状**不在冻结的契约里**，所以形状由
    // `dialogueEventsFromFrame` 认（`{type:'dialogue'}`、夹在世界事件批里、事件本体都认）；
    // 认不出就当没这条——**一条未知的帧不能把事件流带停**。
    const dialogueEvents = dialogueEventsFromFrame(message)
    if (dialogueEvents.length > 0) dialogue?.ingest(dialogueEvents, performance.now())

    if (message.type === 'events') {
      const first = message.events?.[0]
      // **gap 自愈的客户端一半**：判定逻辑在 `decideOnBatch` 里（纯函数、有测试）。
      // 重点是**倒退也算断裂**——重开一局时 seq 从头开始，
      // 只看"是否跳过了一段"会漏掉这种情况，于是新世界的事件被叠到旧世界上，
      // 而画面上只是一堆对不上的状态，不会报任何错。
      if (first !== undefined && decideOnBatch(first.seq, nextSeq) === 'resync') {
        // **节流**：即使语义正确，异常情况下（服务端反复重开、或内容真的对不上）
        // 也不能形成「每批事件重拉一次」的请求风暴。合并到最多每秒一次。
        const now = performance.now()
        if (now - lastResyncMs >= RESYNC_MIN_GAP_MS) {
          lastResyncMs = now
          void loadSnapshot()
        }
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
      // 心跳顺带查一遍"有没有哪句话等太久了"：宿主挂了的话 `failed` 永远不会来，
      // 而面板一直显示"他在想…"就是在装作没事（红线 6）。
      dialogue?.expire(currentTick(), performance.now())
      render()
      return
    }

    if (message.type === 'reset') {
      // 服务端明说"补不齐"（那段历史已经滚出环形缓冲）。
      // **刻意不清空对话历史**：对话是世界里的事件（D38），而 M6-6 要能回放上一局的对话——
      // 在这里顺手清掉，会让"回放"那一半永远看不见东西。重开一局该由宿主发重置事件来说明。
      void loadSnapshot()
      return
    }

    if (message.type === 'hello') {
      // 同理：`hello.seq` 是「下一个要分配的号」，不是「最后一条」。
      if (typeof message.seq === 'number') nextSeq = message.seq
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

// ── 对话面板的装配（M6-5）─────────────────────────────────────────────────────
//
// 面板的 `send` 由这里提供：**端点只在这一个文件里**（UI 不碰网络，逻辑在纯模块里）。
dialogue = createDialogueUi({
  send: sayToAgent,
  // 状态一变就强制重绘一次：花名册上的"他在想…"与当前正在说话的那一行要立刻跟着变。
  onChanged: () => render(true),
  // "等太久"的门槛放在这里（面板自己的兜底，见 dialogue-ui.js 的 expire）。
  maxAgeTicks: DIALOGUE_SILENT_TICKS,
})
dialogue.setTickSource(() => currentTick())

// 花名册那一行也是入口。**事件委托**：`renderSide` 每帧重建 `li`，
// 挂在 `li` 上的监听器会随着重建一起消失（而那种 bug 看起来像"点了没反应"）。
$roster.addEventListener('click', (event) => {
  const row = event.target.closest?.('[data-agent]')
  if (row !== null && row !== undefined) openDialogueFor(row.dataset.agent)
})

bindPick(canvas, pickTopActor)
bindPick(canvas3d, (clientX, clientY) => (scene3d === null ? null : scene3d.pickActor(clientX, clientY)))

// 本地时钟的可见部分：每 250ms 重画一次，让"没事件但时间在走"看得见，
// 也让纸条在两次事件之间平滑飞行。
setInterval(render, 250)

// `?debug=1` 时才把对话状态机挂出去。
//
// 为什么需要**注入**这一条：M6-3 的宿主端点还没上线，所以"回复气泡"这一半
// 在浏览器里没有真来源。挂了它就能注入一条 `DialogueEvent` 帧来验**渲染这一半**
// （PROGRESS 里写明了这是注入、不是端到端）。跟 `__agentWorldScene3d` 同一个口径。
if (new URLSearchParams(globalThis.location?.search ?? '').has('debug')) {
  globalThis.__agentWorldDialogue = {
    state: dialogue.state,
    ingest: (events) => dialogue.ingest(events, performance.now()),
    expire: (nowTick) => dialogue.expire(nowTick, performance.now()),
    bubbles: () => dialogue.bubblesFor(performance.now()),
    say: sayToAgent,
  }
}

fitCanvas()
void loadSnapshot()
connect()
