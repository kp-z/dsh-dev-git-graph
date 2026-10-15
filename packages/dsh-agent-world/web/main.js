/*
 * 装配根（R32）—— `main.js` **只做装配**，不写业务。
 *
 * 它把四块东西接起来：
 *   1) `net/connection.js`：一次快照 + 一条 SSE 增量流；
 *   2) `scene/*`：两个渲染器（2D 永远在，3D 按需动态加载）；
 *   3) `ui/*`：顶栏、抽屉（花名册/工单/对话）、图例、底部看板；
 *   4) `core/*`：纯逻辑（增量应用、对话状态机、看板布局）。
 *
 * 装配处唯一该有的东西是**接线与节流**：谁在什么时候调谁。
 * 任何"算"的逻辑都该在 `core/` 或对应模块里——那才测得动。
 *
 * ── 一帧里发生什么（渲染循环）────────────────────────────────────────────────
 *
 *   setInterval(250ms) ──► render()  ──► 画场景（2D 或 3D）
 *                                      ├─ 花名册/工单/顶栏（都是文本，签名没变就不动 DOM）
 *                                      ├─ 头顶气泡（位置每帧算）
 *                                      └─ 对话面板（只重画变了的那些行）
 *
 * **刻意不用 `requestAnimationFrame`**：rAF 在**不可见的标签页里根本不触发**，
 * 而这个面板的典型场景恰恰是"agent 在跑、人不一定在看"——用 rAF 的话，
 * 面板在我们盯着它之前一直是空的（DOM 与画布都停在初始状态），
 * 而这会让"自动化核验"读到一份陈旧 DOM，看起来像面板坏了。
 * 时间戳节流在隐藏标签页里也照常工作（定时器会被降频，但不会完全不触发）。
 */

import { applyEvents, pruneMessages } from './core/world-update.js'
import { dialogueEventsFromFrame } from './core/dialogue-state.js'
import { occludedBubbles, placeBubble } from './core/bubble-place.js'
import { createConnection } from './net/connection.js'
import { createScene2d } from './scene/scene2d.js'
import { createTopbar } from './ui/topbar.js'
import { createRoster } from './ui/roster.js'
import { createTasks } from './ui/tasks.js'
import { createLegend } from './ui/legend.js'
import { createDrawer } from './ui/drawer.js'
import { createBoard } from './ui/board.js'
import { createDialogueUi } from './ui/dialogue-ui.js'

const COMMAND_API = './api/command'
/** 发话端点（回复走 SSE 的 `dialogue` 帧，见 `src/protocol/dialogue.ts`）。 */
const SAY_API = './api/say'
/** 渲染节流：约 60fps。 */
const RENDER_MIN_GAP_MS = 16
/** "他在想…"最多挂多少步（宿主挂了的话 `failed` 永远不会来，面板要有自己的兜底）。 */
const DIALOGUE_SILENT_TICKS = 300
/** 点角色时的容差（像素）：点在小人旁边一点也算点到他了。 */
const PICK_SLOP_PX = 16

const $ = (id) => document.getElementById(id)
const canvas = $('town')
const canvas3d = $('town3d')
const $bubbles = $('bubbles')
const $hint = $('view-hint')

/** 本地世界（快照起家，之后靠增量维护）。 */
let world = null
/** 快照里的静态部分（场景描述、内容概况、主题、时钟参数、调色板）。 */
let meta = null
/** 当前视图：`top`（2D 俯视）或 `3d`。 */
let mode = 'top'
/** 3D 渲染器；没启用或加载失败时是 null。 */
let scene3d = null
/** 3D 加载失败的原因（显示给用户，别再让用户猜）。 */
let scene3dError = null
/** 上一次真正渲染的时刻（节流用）。 */
let lastRenderMs = -1
/** 头顶气泡的 DOM 节点（按 agentId 复用，只改位置与文本，不每帧重建）。 */
const bubbleNodes = new Map()
/** 看板里选中的任务（用来高亮抽屉里对应的那一行）。 */
let boardSelection = null
/** 对话面板（状态机在 core/dialogue-state.js，DOM 在 ui/dialogue-ui.js）。 */
let dialogue = null
/**
 * 浮层占掉的边距与矩形（R39）。**唯一来源**：`syncSceneInsets()` 量一次，
 * 3D 取景与气泡避让都读它（两份测量会漂移）。
 */
const stageInsets = { right: 0, drawer: null }

/**
 * 看板的矩形——**只在展开时**返回（收起时返回 null）。
 *
 * 两个理由：
 * 1. 收起时它就是底下一条 46px 的摘要条，为它把气泡顶上去是白顶；
 * 2. 收起是**高度过渡**（220ms），而**隐藏标签页里过渡根本不推进**——那一刻
 *    `getBoundingClientRect()` 会一直读到过渡起点那个 450px 的旧值。用**类名**当闸门就不受
 *    过渡状态影响：类名是"意图"（用户点了收起），矩形是"此刻的像素"。
 *    （我第一版就是被这个骗了：量到 450px 的"收起态"，于是所有气泡被无意义地顶高。）
 *
 * 展开时现读（不缓存）：过渡进行中每一帧的矩形都不同，缓存只会拿到中间值。
 */
function boardRectNow() {
  const el = $('board')
  if (el === null || el.classList.contains('is-collapsed')) return null
  const rect = el.getBoundingClientRect()
  if (rect.width <= 0 || rect.height <= 0) return null
  return { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom }
}
/** 角色色（内容里的职业色，来自 ScenePlan）——花名册的色点用。 */
let colorById = new Map()

// ── UI 模块 ───────────────────────────────────────────────────────────────────

const topbar = createTopbar({
  root: $('topbar'),
  onMode: (next) => void setMode(next),
  onCommand: (kind) => void sendCommand(kind),
  onToggleDrawer: () => drawer.toggle(),
})

/**
 * 把"抽屉占了多少"告诉 3D 场景，让世界居中在**看得见的那块**（R32）。
 *
 * 宽度是**量出来的**（`getBoundingClientRect`），不是写死 320：抽屉在窄视口会变宽、
 * 收起时会变成一条窄栏，任何一个常数都会在其中一种情况下算错。
 * 场景那边只认一个像素数，不知道抽屉长什么样——面板换布局不需要改场景。
 */
/**
 * 抽屉现在开着吗——读 **DOM 的类**，不读 `drawer` 对象。
 *
 * 这里踩过一次：`createDrawer()` 在构造末尾 `paint()` → 触发 `onToggle` → 触发
 * `syncSceneInsets()`，而那一刻 `const drawer = createDrawer(...)` 还在 TDZ。
 * 症状是 `ReferenceError: Cannot access 'drawer' before initialization` 让**整个 main.js
 * 不执行**：页面永远停在顶栏那句"连接中…"、花名册一片空白。
 * 类名本来就是抽屉自己在 `paint()` 里先设、再回调的，所以读它是同一份事实，而且没有顺序依赖。
 */
function drawerIsOpen() {
  const el = $('drawer')
  return el !== null && el.classList.contains('is-open')
}

function syncSceneInsets() {
  const el = $('drawer')
  const rect = el?.getBoundingClientRect?.()
  const open = drawerIsOpen() && rect !== undefined && rect.width > 0
  // 右侧留 12px 呼吸，别让小镇紧贴抽屉边缘。
  // **只量这一处**：3D 取景与气泡避让都读 `stageInsets.right`——各量一份迟早会漂移，
  // 而漂移的症状是"某一边看起来差一点"，很难归因。
  stageInsets.right = open ? rect.width + 12 : 0
  stageInsets.drawer = open ? { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom } : null
  // 看板矩形**故意不在这里量**：看板高度有 220ms 过渡（展开/收起），事件驱动地量只会量到
  // 动画中间值（我第一版就是这样：启动时量到 450px 的展开态，于气泡被无意义地顶高）。
  // 它改成每帧现读（见 `boardRectNow()`），代价格外小：那一帧本来就要读 `$bubbles` 的尺寸。
  // 场景那边只认一个像素数，不知道抽屉长什么样——面板换布局不需要改场景。
  scene3d?.setViewInsets({ right: stageInsets.right })
}

const drawer = createDrawer({
  root: $('drawer'),
  onToggle: (open) => {
    topbar.setDrawerOpen(open)
    syncSceneInsets()
  },
})

const roster = createRoster({ root: $('roster'), onPick: (agentId) => openDialogueFor(agentId) })

const tasks = createTasks({
  root: $('tasks'),
  // 点抽屉里的一张单 = 在看板里选中它（同一件事的两处入口，选中状态只有一份）。
  onPick: (taskId) => {
    board.select(taskId)
  },
})

const legend = createLegend({ root: $('legend') })

const scene2d = createScene2d(canvas, { pickSlopPx: PICK_SLOP_PX })

/**
 * 执行看板（M7-1）。**由数据事件驱动**（`board.update(world)`），
 * 不挂进 `render()` 那条 60fps 的路——看板不进 3D 渲染循环，这是"场景不被拖慢"的前提。
 * 默认**收起成一条摘要**（DESIGN 第三节）。
 */
const board = createBoard({
  root: $('board'),
  palette: {},
  // 展开看板时把抽屉收起来：两者都需要横向空间，叠着会互相遮住——而**被遮住的图
  // 等于变相被裁**（M7-9 那条纪律）。收起是可见的、一键能恢复的动作，比让用户
  // 以为"图只有一半"要好。
  onCollapsed: (collapsed) => {
    // 展开看板会把抽屉收起来（两者都需要横向空间），所以边距要重量。
    if (collapsed === false) drawer.toggle(false)
    syncSceneInsets()
  },
  onSelect: (taskId) => {
    boardSelection = taskId
    // 只在抽屉已经在"工单"页时才重画它：点看板不该把抽屉跳来跳去。
    if (drawer.page() === 'tasks') tasks.update({ world, selectedTaskId: taskId })
  },
})

dialogue = createDialogueUi({
  send: sayToAgent,
  onChanged: () => {
    drawer.setDialogueOpen(dialogue.isOpen())
    render(true)
  },
  maxAgeTicks: DIALOGUE_SILENT_TICKS,
})
dialogue.setTickSource(() => currentTick())

// ── 时钟 ──────────────────────────────────────────────────────────────────────

/**
 * 当前的 tick = 权威 tick + 本地滑走的那部分。
 * 没有变更事件的那些步不会产生任何事件，所以本地要自己往前走（见 connection.slippedTicks）。
 */
function currentTick() {
  if (world === null) return 0
  return world.tick + connection.slippedTicks(meta?.tickMs ?? 100)
}

/** 显示一行提示（3D 的问题、读不到世界都在这里说）。 */
function showHint(text) {
  if ($hint === null) return
  $hint.textContent = text ?? ''
  $hint.hidden = text === '' || text === null || text === undefined
}

// ── 视图切换 ──────────────────────────────────────────────────────────────────

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
    const module = await import('./scene/scene3d.js')
    scene3d = module.createScene3d(canvas3d, {
      onError: (error) => {
        scene3dError = String(error)
        showHint(`3D 渲染出错：${scene3dError}`)
      },
      // 内容引用了渲染器没有的构建器时**必须说出来**：那种情况下画面会多出
      // 几个品红方块，而"为什么是品红"完全看不出来。
      onMissing: ({ models, builders, registered, assets }) => {
        const parts = []
        if (builders.length > 0) parts.push(`缺构建器 ${builders.join(' / ')}（已实现：${registered.join(' / ')}）`)
        if (models.length > 0) parts.push(`缺模型 ${models.join(' / ')}`)
        // 资源加载失败**单独一类**：它不是"内容写错了"，而是"文件没发出去 / 路径不对"。
        if (assets !== undefined && assets.length > 0) parts.push(`模型文件加载失败 ${assets.join('；')}`)
        showHint(`内容引用了渲染器给不出的模型：${parts.join('；')}。这些位置画的是品红占位块。`)
      },
    })
    // 建好之后立刻把当前抽屉占位告诉它：否则第一帧会按"全画布居中"取景，
    // 于是开局的第一个画面正是"小镇被抽屉盖住"的那一版（R32 前的老问题）。
    syncSceneInsets()
    return true
  } catch (error) {
    // 原因要显示出来：只写"3D 不可用"的话，用户没法判断是少了文件还是浏览器不支持。
    scene3dError = error instanceof Error ? error.message : String(error)
    showHint(`3D 不可用：${scene3dError}（俯视图不受影响）`)
    return false
  }
}

/** 切换视图。 */
async function setMode(next) {
  if (next === '3d' && !(await enable3d())) next = 'top' // 起不来就留在俯视图，不装作切过去了
  mode = next

  canvas.hidden = next !== 'top'
  canvas3d.hidden = next !== '3d'
  topbar.setMode(next)

  if (next === '3d' && scene3d !== null) {
    if (meta !== null) scene3d.setPlan(meta.scene)
    scene3d.resize()
  } else if (next === 'top') {
    scene2d.resize()
  }
  render(true)
}

// ── 气泡 ──────────────────────────────────────────────────────────────────────

/**
 * 头顶气泡（M6-5）。
 *
 * 位置每帧算：3D 走 `scene3d.projectToScreen`（投影 + 角色实测头顶高度），
 * 俯视走 `scene2d.anchorOf()`——**两个渲染器各自给出画布相对像素**，
 * 所以这里不需要知道任何换算公式。节点按 agentId 复用。
 */
function updateBubbles() {
  if ($bubbles === null || meta === null) return
  const list = dialogue === null ? [] : dialogue.bubblesFor(performance.now())
  const seen = new Set()
  const view = { width: $bubbles.clientWidth, height: $bubbles.clientHeight }
  // 抽屉占位复用 `syncSceneInsets()` 量到的那份（**同一份测量**，见那里的注释）；
  // 看板矩形现读（它带过渡动画，缓存会拿到动画中间值）。
  const insetRight = stageInsets.right
  const boardRect = boardRectNow()

  for (const bubble of list) {
    const agent = world?.agents.find((a) => a.id === bubble.agentId)
    if (agent === undefined) continue

    let anchor = null
    if (mode === '3d' && scene3d !== null && canvas3d.hidden === false) {
      const p = scene3d.projectToScreen(agent.position.x, scene3d.topYOf(agent.id), -agent.position.z)
      if (p.behind === false && p.width > 0) anchor = { x: p.x, y: p.y - 4 }
    } else if (mode === 'top' && canvas.hidden === false) {
      anchor = scene2d.anchorOf({ world, scene: meta.scene, agentId: agent.id })
    }
    if (anchor === null) continue

    seen.add(agent.id)
    let entry = bubbleNodes.get(agent.id)
    if (entry === undefined) {
      const node = document.createElement('div')
      const name = document.createElement('b')
      const text = document.createElement('span')
      node.append(name, text)
      $bubbles.append(node)
      entry = { node, name, text, sig: null, size: null, placed: null }
      bubbleNodes.set(agent.id, entry)
    }
    const sig = `${bubble.phase}\u0001${bubble.text}`
    if (entry.sig !== sig) {
      // 名字来自世界数据；文本用 textContent（回复正文是模型产出的内容，不是标记）。
      entry.node.className = `bubble bubble-${bubble.phase}`
      entry.name.textContent = agent.name
      entry.text.textContent = bubble.text
      entry.sig = sig
      entry.size = null // 文本变了 → 尺寸重量一次（避让要用真实宽度，不然贴边会算错）
    }
    if (entry.size === null) {
      // 只在文本变化时量：`offsetWidth` 会触发布局，而这个循环每帧都在跑（气泡只有几个）。
      entry.size = { width: entry.node.offsetWidth || 200, height: entry.node.offsetHeight || 28 }
    }

    const placed = placeBubble({ anchor, size: entry.size, view, insetRight, board: boardRect })
    entry.placed = placed
    // 可见区放不下（极窄视口下抽屉是整幅宽浮层）：**不画**，而不是画一半在抽屉底下。
    if (!placed.visible) {
      entry.node.hidden = true
      continue
    }
    entry.node.hidden = false
    entry.node.classList.toggle('is-clamped', placed.clamped)
    entry.node.classList.toggle('is-pinned', placed.pinnedRight)
    // `--tail` 让箭头指向**真实的**头顶（贴边之后它不一定在气泡正中）。
    entry.node.style.setProperty('--tail', `${Math.round(placed.tailPercent)}%`)
    entry.node.style.left = `${Math.round(placed.left)}px`
    entry.node.style.top = `${Math.round(placed.top)}px`
  }

  // 淡出/离场的气泡要**真的摘掉**，否则 DOM 会随着"聊过多少人"一直涨。
  for (const [agentId, entry] of bubbleNodes) {
    if (seen.has(agentId)) continue
    entry.node.remove()
    bubbleNodes.delete(agentId)
  }
}

// ── 渲染 ──────────────────────────────────────────────────────────────────────

function render(force = false) {
  if (world === null || meta === null) return
  const now = performance.now()
  if (!force && now - lastRenderMs < RENDER_MIN_GAP_MS) return
  lastRenderMs = now
  const tick = currentTick()

  if (mode === '3d' && scene3d !== null) {
    scene3d.render(world)
  } else {
    scene2d.render({ world, scene: meta.scene, tick, messageDeliveryTicks: meta.messageDeliveryTicks })
  }

  // 侧栏与顶栏都是文本，与场景无关：两个视图共用。
  const thinkingIds = new Set((dialogue?.thinkingTurns() ?? []).map((t) => t.agentId))
  roster.update({ world, thinkingIds, activeId: dialogue?.agentId() ?? null, colorById })
  tasks.update({ world, meta, selectedTaskId: boardSelection })

  // 3D 模式下把渲染器的真实计数显示出来——"不卡"要能被看见，否则只是承诺。
  let perf = ''
  if (mode === '3d' && scene3d !== null) {
    const st = scene3d.stats()
    perf = `${st.fps} fps · 绘制 ${st.drawCalls} · 三角 ${(st.triangles / 1000).toFixed(1)}k · 纹理 ${st.textures} · 重建 ${st.planRebuilds}`
  }
  topbar.render({
    world,
    meta,
    tick,
    mode,
    perf,
    connected: connection.status().connected,
    nextSeq: connection.status().nextSeq,
    silentForMs: connection.silentForMs(),
    waiting: dialogue?.thinkingTurns().length ?? 0,
  })

  updateBubbles()
  // 面板只重画签名变了的东西；"他在想…（12s）"里的秒数靠这次调用更新。
  dialogue?.render(now)
}

// ── 发话（M6-5 的发送侧）──────────────────────────────────────────────────────

/**
 * 发一次话。**宿主拥有端点，面板只负责把失败翻成能下手的人话**
 *（`explainSayFailure` 在 `core/dialogue-state.js`）。
 *
 * 刻意**不重试**：契约说这条请求是同步收话，失败就是失败；
 * 静默重试只会让同一句话在宿主那边出现两遍，而用户完全不知道。
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
    // 响应体可能是 HTML（404 页面、反向代理），所以解析失败也要能过去。
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
  if (agentId === null || agentId === undefined) return
  dialogue.toggle(agentId)
  // 对话是"同一个抽屉的另一页"——它会（在收起状态下）把抽屉打开，所以边距要重量。
  syncSceneInsets()
  render(true)
}

// ── 画布上的点击（点角色说话）──────────────────────────────────────────────────

/**
 * 画布上的点击：**按下与抬起在同一点、且时间不太长，才算点击**。
 *
 * 3D 的 `OrbitControls` 一直在监听拖拽——不判位移的话，"转个视角"会顺手弹出对话面板，
 * 而那时用户根本不知道自己点到谁了。
 */
function bindPick(element, pick) {
  let downX = 0
  let downY = 0
  let downAt = 0
  element.addEventListener('pointerdown', (event) => {
    downX = event.clientX
    downY = event.clientY
    downAt = event.timeStamp
  })
  element.addEventListener('pointerup', (event) => {
    if (Math.abs(event.clientX - downX) > 5 || Math.abs(event.clientY - downY) > 5) return
    if (event.timeStamp - downAt > 700) return
    const agentId = pick(event.clientX, event.clientY)
    if (agentId !== null && agentId !== undefined) openDialogueFor(agentId)
  })
}

bindPick(canvas, (clientX, clientY) => scene2d.pick({ world, scene: meta?.scene, clientX, clientY }))
bindPick(canvas3d, (clientX, clientY) => (scene3d === null ? null : scene3d.pickActor(clientX, clientY)))

// ── 世界命令（暂停/继续）──────────────────────────────────────────────────────

async function sendCommand(kind) {
  try {
    const res = await fetch(COMMAND_API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ command: { kind } }),
    })
    const body = await res.json().catch(() => ({}))
    if (!res.ok) showHint(`命令被拒（${res.status}）：${body.error ?? '宿主没说原因'}`)
    // 成功的话世界状态会经事件流回来（`world.paused` 事件），不需要手动刷新。
  } catch (error) {
    showHint(`命令没发出去：${error instanceof Error ? error.message : String(error)}`)
  }
}

// ── 连接 ──────────────────────────────────────────────────────────────────────

const connection = createConnection({
  onSnapshot: (snap) => {
    world = snap.world
    meta = {
      scene: snap.scene,
      libraries: snap.content.libraries,
      packs: snap.content.packs,
      theme: snap.scene?.theme ?? null,
      // 看板的颜色 token → 色值。**配色是内容**：面板只从快照里拿这份表。
      palette: snap.palette ?? {},
      tickMs: snap.runtime.tickMs,
      messageDeliveryTicks: snap.runtime.messageDeliveryTicks,
      persistErrors: snap.runtime.diagnostics.persistErrors,
    }
    colorById = new Map((snap.scene?.actors ?? []).map((a) => [a.id, a.color]))
    // 角色的名字只从世界数据来（D37：人设是内容，代码里没有角色名）。
    dialogue.setAgents(world.agents)
    board.setPalette(meta.palette)
    board.update(world)
    legend.update({ scene: meta.scene })
    // 3D 用**快照里的** ScenePlan 重建静态部分；位姿由 `world` 每帧提供。
    if (mode === '3d' && scene3d !== null) {
      scene3d.setPlan(snap.scene)
      scene3d.resize()
    }
    render(true) // 首屏**强制**画一次：节流不该让"打开面板"这一步被跳过
  },
  onEvents: (events) => {
    applyEvents(world, events)
    pruneMessages(world)
    board.update(world)
    render()
  },
  onSync: () => {
    // 心跳顺带查一遍"有没有哪句话等太久了"：宿主挂了的话 `failed` 永远不会来。
    dialogue?.expire(currentTick(), performance.now())
    render()
  },
  onMessage: (message) => {
    // 对话帧（M6-5）。帧的确切形状**不在冻结的契约里**，所以形状由
    // `dialogueEventsFromFrame` 认（独立帧、夹在世界事件批里、事件本体都认）；
    // 认不出就当没这条——**一条未知的帧不能把事件流带停**。
    const dialogueEvents = dialogueEventsFromFrame(message)
    if (dialogueEvents.length > 0) dialogue?.ingest(dialogueEvents, performance.now())
  },
  onError: (failure) => {
    if (failure.kind === 'snapshot-http') {
      showHint(`读不到世界（HTTP ${failure.status}）：${failure.body?.error ?? '宿主没说原因'}`)
    } else if (failure.kind === 'snapshot-failed') {
      showHint(`读不到世界：${failure.error instanceof Error ? failure.error.message : String(failure.error)}`)
    }
  },
  onState: () => render(),
})

// ── 生命周期 ──────────────────────────────────────────────────────────────────

window.addEventListener('resize', () => {
  scene2d.resize()
  // 先更新占位再 resize：窄视口下抽屉宽度本身会变（CSS 媒体查询），
  // 顺序反了就会用上一档的宽度取景，表现是"缩完窗口小镇偏一下、下次再正"。
  syncSceneInsets()
  if (scene3d !== null) scene3d.resize()
  render(true)
})

// 看板默认收起成一条摘要（DESIGN 第三节：场景是主角）。
board.setCollapsed(true)

// 本地时钟的可见部分：每 250ms 重画一次，让"没事件但时间在走"看得见，
// 也让纸条与气泡在两次事件之间平滑移动。**看板不在这条路上**（它由数据事件驱动）。
setInterval(render, 250)

// `?debug=1` 时才把核验入口挂出去（跟 `__agentWorldScene3d` 同一个口径）。
if (new URLSearchParams(globalThis.location?.search ?? '').has('debug')) {
  globalThis.__agentWorldDialogue = {
    state: dialogue.state,
    ingest: (events) => dialogue.ingest(events, performance.now()),
    // `push(帧)`：**推一整条 SSE 帧**（`{type:'dialogue', events:[…]}` / 事件本体都行）。
    // 存在的理由：临时服务器没有 DSH 会话服务，真模型帧拿不到，而"帧到了面板之后的表现"
    // 必须能被验（M6-13 的 acting / 动作行就是这么验的，见 PROGRESS R35）。
    push: (frame) => {
      const events = dialogueEventsFromFrame(frame)
      dialogue.ingest(events, performance.now())
      return events.length
    },
    expire: (nowTick) => dialogue.expire(nowTick, performance.now()),
    bubbles: () => dialogue.bubblesFor(performance.now()),
    say: sayToAgent,
  }
  /**
   * 气泡的核验入口（R39）：`occluded()` 必须为空数组。
   *
   * 现读 DOM（这是诊断入口，不是每帧路径）：拿每个气泡的 `getBoundingClientRect()`
   * 与**抽屉的矩形**求交——贴边之后两者应当完全不相交。
   */
  globalThis.__agentWorldBubbles = {
    occluded: () => {
      const drawerEl = $('drawer')
      const rect = drawerIsOpen() && drawerEl !== null ? drawerEl.getBoundingClientRect() : null
      // 隐藏的（没有地方放）不算"被遮"——它压根没画。`hidden()` 单独报数量。
      const bubbles = [...$bubbles.children].filter((node) => !node.hidden).map((node, index) => ({
        id: node.querySelector('b')?.textContent ?? `#${index}`,
        rect: node.getBoundingClientRect(),
      }))
      return occludedBubbles(bubbles, rect === null ? null : { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom })
    },
    /** 有几个气泡因为"可见区放不下"没画（极窄视口）。 */
    hidden: () => [...$bubbles.children].filter((node) => node.hidden).length,
    /** 每个气泡被放在哪、以及为什么（`occluded` = 人本身在抽屉底下）。 */
    placed: () =>
      [...bubbleNodes.entries()].map(([agentId, entry]) => ({ agentId, ...(entry.placed ?? {}) })),
    insets: () => ({ ...stageInsets, board: boardRectNow() }),
    /** 纯函数本体，方便在控制台里试着复算（如 `place(anchor, size)`）。 */
    place: placeBubble,
  }
  globalThis.__agentWorldBoard = {
    stats: () => board.stats(),
    refresh: () => board.update(world),
    select: (taskId) => board.select(taskId),
    model: () => board.model(),
    layout: () => board.layout(),
    geometry: () => board.geometry(),
    // `clipped()` 由 board.js 自己在同一个宏任务里挂（它先于 app 的门面创建）。
    expand: () => board.setCollapsed(false),
  }
}

scene2d.resize()
void connection.reload()
connection.start()
