/*
 * 装配根（R32）—— `main.js` **只做装配**，不写业务。
 *
 * 它把四块东西接起来：
 *   1) `net/connection.js`：一次快照 + 一条 SSE 增量流；
 *   2) `scene/*`：渲染器（R66 起只有 Phaser 这一条：俯视格子）；
 *   3) `ui/*`：顶栏、抽屉（花名册/工单/对话）、图例、底部看板；
 *   4) `core/*`：纯逻辑（增量应用、对话状态机、看板布局）。
 *
 * 装配处唯一该有的东西是**接线与节流**：谁在什么时候调谁。
 * 任何"算"的逻辑都该在 `core/` 或对应模块里——那才测得动。
 *
 * ── 一帧里发生什么（渲染循环）────────────────────────────────────────────────
 *
 *   setInterval(250ms) ──► render()  ──► 画场景（Phaser）
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
import { createSelfCheck } from './core/self-check.js'
import { dialogueEventsFromFrame } from './core/dialogue-state.js'
import { buildTeamGraph } from './core/team-graph.js'
import { resolveMemberSprite, spriteAvatarStyle } from './core/member-avatar.js'
import { createConnection } from './net/connection.js'
// R58：2D 渲染器 = **Phaser**（唯一实现）。`?renderer=canvas` 映射到 `type: Phaser.CANVAS`；
// 缺省 `Phaser.AUTO` = WebGL 优先、**canvas 自动回退**（我们自己写的那套回退已删）。
// 接口与以前逐个同名同参，所以下面一行都不用改。
import { createScenePhaser, requestedRenderer } from './scene/scene-phaser.js'
import { createTopbar } from './ui/topbar.js'
import { createLegend } from './ui/legend.js'
import { createSidebar } from './ui/sidebar.js'
import { createBoard } from './ui/board.js'
import { mountDock } from './ui/dock.js'
import { createDialogueUi } from './ui/dialogue-ui.js'

/**
 * 把应用挂到**任意容器**里（R161）——DSH 的 `main` 面板与独立页面共用这一份装配。
 *
 * `root` 可以是 `document`（独立页）或一个 DOM 元素（DSH 主面板）。
 * 所有按钮/面板都从 `root` 里查，避免与宿主页面的同名 id 抢元素。
 *
 * @param {object} [options]
 * @param {Document|HTMLElement} [options.root] - 挂载根；缺省 `document`。
 * @param {Document} [options.document] - 文档（默认 `globalThis.document`）。
 * @param {string} [options.baseUrl] - 路由前缀。独立页 `.`；DSH 里 `/agent-world`。
 * @param {boolean} [options.embedded] - 嵌入模式：不建自己的顶栏（宿主已有）。
 * @returns {{dispose: () => void}}
 */
let spriteAssetBase = './vendor/'
let currentSessionId = null

export function mountAgentWorld(options = {}) {
  const doc = options.document ?? globalThis.document
  const root = options.root ?? doc
  const embedded = options.embedded === true
  /** R175：会话 id，用来读只读 team plan。 */
  const sessionId = typeof options.sessionId === 'string' && options.sessionId !== '' ? options.sessionId : null
  currentSessionId = sessionId
  const rawBase = typeof options.baseUrl === 'string' && options.baseUrl !== '' ? options.baseUrl : '.'
  const baseUrl = rawBase === '.' ? '.' : rawBase.replace(/\/$/, '')
  const apiUrl = (path) => `${baseUrl}/${path}`
  const assetBase = `${baseUrl}/vendor/`
  spriteAssetBase = assetBase
  const $ = (id) => root.querySelector(`#${id}`)
  const standaloneButton = root.querySelector?.('#topbar-standalone')
  standaloneButton?.addEventListener('click', () => {
    try {
      const url = new URL(`${baseUrl === '.' ? '' : baseUrl}/`, globalThis.location.origin)
      const token = new URLSearchParams(globalThis.location.search).get('token')
      if (token !== null) url.searchParams.set('token', token)
      if (typeof sessionId === 'string' && sessionId !== '') url.searchParams.set('session', sessionId)
      globalThis.open?.(url.href, '_blank', 'noopener')
    } catch (e) { /* 独立打开失败不影响面板 */ }
  })
  const scopedDoc = root === doc ? doc : createScopedDocument(root, doc)
  /** 键盘监听的落点：嵌入时挂在容器上，事件不会跑出主面板。 */
  // R211：对话框快捷键绑文档层，团队卡片/工具条点完后焦点不在舞台里也能收到。
  const keyTarget = doc

const COMMAND_API = apiUrl('api/command')
/** 发话端点（回复走 SSE 的 `dialogue` 帧，见 `src/protocol/dialogue.ts`）。 */
const SAY_API = apiUrl('api/say')
/** 渲染节流：约 60fps。 */
const RENDER_MIN_GAP_MS = 16
/** "他在想…"最多挂多少步（宿主挂了的话 `failed` 永远不会来，面板要有自己的兜底）。 */
const DIALOGUE_SILENT_TICKS = 300

/**
 * 构建标记（R84）。**故意显示在性能条里**：它回答一个反复困扰我们的问题——
 * "你看的这页到底是不是我刚改的代码"。改完 `web/` 就把它 +1。
 */
const BUILD = 'build r152'

/** 上一帧各精灵的动画键（`trackAnimFlips` 用）。 */
let lastAnimKeys = null
/** 累计"某只精灵的动画键变了"的次数——朝向抖动会把它快速推高，稳定时它不动。 */
let animFlipCount = 0

/**
 * 统计"动画键发生变化的次数"（R84 诊断用）。
 *
 * 为什么放在外壳而不是渲染层：`scene-phaser.js` 正被另一个 Agent 频繁改写，
 * 每次改都会被并发冲突挡住；而这件事实质上只是**读一帧的显示列表**，属于外壳的事。
 *
 * @returns {number} 到目前为止累计的切换次数
 */
function trackAnimFlips() {
  const scene = globalThis.__agentWorldPhaser?.scene?.()
  const list = scene?.layers?.entities?.list
  if (Array.isArray(list) !== true) return animFlipCount
  const keys = []
  for (const object of list) {
    if (object?.type === 'Sprite' && object.visible !== false) keys.push(object.anims?.currentAnim?.key ?? '')
  }
  if (lastAnimKeys !== null && lastAnimKeys.length === keys.length) {
    for (let i = 0; i < keys.length; i += 1) {
      if (keys[i] !== lastAnimKeys[i]) animFlipCount += 1
    }
  }
  lastAnimKeys = keys
  return animFlipCount
}

const canvas = $('town')
const $hint = $('view-hint')
/** R162：header 里的“世界对应会话名”。 */
const $brandSession = $('brand-session')
let worldSession = null
/**
 * 客户端（DSH 侧）显式指定的会话名。
 *
 * - `undefined`：客户端没给，页面自己走 `/api/session`（独立页/队长会话兜底）；
 * - `null`：客户端明确说“当前没有选中工作区会话”，**不要**再拿团队名补上；
 * - 对象：左侧工作区当前会话的 `{ id, title }`。
 */
let workspaceSessionOverride = undefined

/** 本地世界（快照起家，之后靠增量维护）。 */
let world = null
/** 快照里的静态部分（场景描述、内容概况、主题、时钟参数、调色板）。 */
let meta = null
/** 上一次真正渲染的时刻（节流用）。 */
let lastRenderMs = -1
/** 看板里选中的任务（用来高亮抽屉里对应的那一行）。 */
let boardSelection = null
/** R180：官方 projection 已渲染时，禁止 host fallback 把它清空。 */
let officialTeamRendered = false
/** R183：任务面板视图：graph（工作流图）| tree（依赖树）。 */
let taskView = (() => {
  try {
    const saved = globalThis.localStorage?.getItem('agentWorld.taskView')
    return saved === 'tree' || saved === 'board' ? saved : 'graph'
  } catch (e) { return 'graph' }
})()
let lastOfficialTasks = []
/** 官方团队任务 → actor 状态覆盖（owner 有进行中任务 = working）。 */
let teamActivity = new Map()

function applyTeamActivity(source) {
  if (source === null) return source
  const talkId = dialogue !== null && dialogue.isOpen() === true && dialogue.mode() === 'chat'
    ? dialogue.agentId()
    : null
  const talking = talkId !== null && (dialogue?.thinkingTurns?.().length ?? 0) > 0
  if (teamActivity.size === 0 && !talking) return source
  return {
    ...source,
    agents: source.agents.map((agent) => {
      if (talking && agent.id === talkId) return { ...agent, state: 'talking' }
      return teamActivity.has(agent.id) ? { ...agent, state: 'working' } : agent
    }),
  }
}
/**
 * 调度器诊断（R67 / M13-5）：`runtime.diagnostics`。
 *
 * 看板用它显示"调度器这一轮为什么不派某张单"（没人 / 没工位）。它是**快照字段**，
 * 只在 `onSnapshot` 里更新——事件流不带它。所以它是"最近一次调度"的读数，
 * 而不是累积历史（这一点要和看板里"前置失败=永远等不到"的结论区分开）。
 */
let diagnostics = null
/** 对话面板（状态机在 core/dialogue-state.js，DOM 在 ui/dialogue-ui.js）。 */
let dialogue = null
// ── UI 模块 ───────────────────────────────────────────────────────────────────

const topbarRoot = embedded ? null : $('topbar')
const topbar = topbarRoot === null ? null : createTopbar({
  root: topbarRoot,
  worldName: 'Agent World',
  onCommand: (kind) => void sendCommand(kind),
})

// R76：右侧抽屉（花名册/工单）已删——agent/任务列表只剩顶栏看板一份；气泡进引擎后也不再需要给抽屉让位。

const legend = createLegend({ root: $('legend') })

/**
 * 渲染自检（R7 / 计划 S1+S2）：**帧被重置 / 动画互抢 / 与服务端漂移**三个计数器。
 *
 * 逻辑全在 `core/self-check.js`（纯函数，node 里测过）；这里只做接线——
 * 因为它要读的两处读数（Phaser 的 `entities` 层、`scene2d.liveActors()`）
 * 都在这个装配层拿得到，而渲染层正被另一个 Agent 频繁改写。
 *
 * 为什么要它：R85 的真凶（每帧 `setTexture` 把帧打回第 0 帧）**不报错**，
 * 只表现为"看起来在跳"，前六轮全靠猜机制。有了这三个数，"在跳"就变成一个数字。
 */
const selfCheck = createSelfCheck({
  actors: () => (typeof scene2d.liveActors === 'function' ? scene2d.liveActors(world, meta?.scene ?? null) : []),
})

const scene2d = createScenePhaser(canvas, {
  assetBaseUrl: assetBase,
  renderer: requestedRenderer(),
  // **点击角色的真路径**（R66）：Phaser 的 `setInteractive` + `pointerup` 冒泡上来，
  // "忽略拖拽/长按"由引擎的 Pointer API（`getDistance`/`getDuration`）判断，
  // 我们不再自己记 downX/downY/downAt（那段手写 `bindPick` 已删）。
  // R58 修过的死角在这里同样成立：命中区就是精灵几何，点身体任意位置都算。
  // ① 场景点人：聚焦（选中 + 镜头）**已经由渲染层的 `selectAgent` 做过了**
  //（`scene-phaser.js` 的 `pointerup` 里先 `selectAgent` 再回调这里）——
  // `focusAgent` 对"已选中的同一个"是空操作，所以这里只管开面板。
  onActorPick: (agentId) => {
    focusAgent(agentId, 'scene')
    openDialogueFor(agentId)
  },
  // P4：玩家用键盘走完一段 → 把落点写回世界（否则服务端还停在旧坐标，解锁会瞬移回去）。
  onAgentMoveSettled: (agentId, x, z) => void sendCommand({ kind: 'moveAgent', agentId, x, z }),
})

// R201：卡片布局/侧边栏拖拽会改变 stage 尺寸；Phaser 的 RESIZE 在嵌入组合里可能不跟，
// 真机看到 camera.worldView = 0×0，点角色坐标全废。用 ResizeObserver 兜底。
let lastSyncedStage = null
function syncSceneCamera() {
  try {
    const canvas = document.querySelector('#town')
    const stage = document.querySelector('.stage')
    if (canvas === null || stage === null) return
    const rect = stage.getBoundingClientRect()
    const width = Math.max(1, Math.round(rect.width - 2))
    const height = Math.max(1, Math.round(rect.height - 2))
    // 关键：只有容器尺寸真的变了才 resize。700ms 轮询以前会无条件 applyCamera，
    // 相机每 700ms 重新取景一次，观感就是场景一直在抖。
    if (lastSyncedStage !== null && Math.abs(width - lastSyncedStage.width) <= 1 && Math.abs(height - lastSyncedStage.height) <= 1) return
    const scene = globalThis.__agentWorldPhaser?.scene?.()
    const camera = scene?.cameras?.main
    if (camera === undefined || camera === null) return
    lastSyncedStage = { width, height }
    // Phaser 在嵌入布局里会停在旧缓冲区；容器是唯一尺寸源。
    const game = scene?.game
    if (game?.scale && (Math.abs(game.scale.width - width) > 1 || Math.abs(game.scale.height - height) > 1)) {
      game.scale.setGameSize(width, height)
    }
    camera.setSize(width, height)
    camera.preRender?.()
    scene2d.resize()
  } catch (e) { /* 场景还没 ready */ }
}
if (typeof ResizeObserver === 'function') {
  const stage = document.querySelector('.stage')
  if (stage !== null) {
    const observer = new ResizeObserver(() => syncSceneCamera())
    observer.observe(stage)
  }
}
globalThis.requestAnimationFrame?.(syncSceneCamera)
globalThis.addEventListener?.('resize', () => syncSceneCamera())
globalThis.addEventListener?.('agentworld:layout-change', () => syncSceneCamera())
globalThis.visualViewport?.addEventListener?.('resize', () => syncSceneCamera())
for (const delay of [300, 1000, 2500]) globalThis.setTimeout(syncSceneCamera, delay)
// 兜底轮询：dock 的 flex 尺寸变化在部分嵌入宿主里不触发 ResizeObserver；
// 舞台尺寸是唯一尺寸源，发现不一致就同步，避免窗口调整后画面被压扁/留黑。
globalThis.setInterval?.(syncSceneCamera, 700)

/**
 * 看板的引用（R3）。为什么不是直接读 `board`：`createSidebar()` 在装配阶段就会**同步**回调
 * 一次（R99 起是初始化折叠态，更早是初始化页签），而那时下面 `const board = createBoard(...)`
 * 那一行**还没跑**。
 *
 * ⚠️ 这里**不能**用 `typeof board === 'undefined'` 兜：`typeof` 只对"从未声明"的标识符安全，
 * 对处在暂时性死区（TDZ）里的 `const` 一样抛 ReferenceError。第一版就是这么写的，
 * 结果整个 `main.js` 在装配阶段被中断——顶栏与侧边栏都在，场景与所有门面全没建，
 * 而控制台只有一条和看板毫无关系的 ReferenceError（真机踩到，R91）。
 * 所以用一只**先声明好的**可变引用承接。
 */
let boardRef = null

/**
 * 侧边栏（R2 建 / R3 收口 / R99 去 tab + 可折叠 / R116 开关搬进 header）。
 *
 * 这里**只建外壳**（两块常驻容器）。内容全部来自看板——同一份
 * `renderMembers` / `renderGraph` 的产物挂进去，所以不存在"侧边栏版"和"看板版"两套渲染。
 *
 * ⚠️ **R99：两个视图不再互斥**（用户：「这两个 tab 应该可以同时看到才对」），
 * 所以原先的 `onViewChange → refreshGraph()` 换成 `onExpand`：折叠期间两块容器是 0×0，
 * 依赖图必须在**展开并且布局落定之后**重挑几何。`onExpand` 已经在下一次 rAF 里，
 * 这里不用再延迟。
 *
 * ⚠️ **R116：开关按钮在 header 里，不归这个模块管**。侧边栏只持有"折叠态"这一个真相，
 * 按钮只是它的一个消费者——所以状态变化走 `onCollapseChange` 广播出去，
 * 而不是让侧边栏自己去改一个不在它 DOM 里的按钮（那会把"谁是真相"搞乱）。
 *
 * ⚠️⚠️ **下面这两样必须声明在 `createSidebar()` 之前**：
 * `createSidebar()` 在构造期间就会同步广播一次折叠态（读 `localStorage` 的结果），
 * 于是 `onCollapseChange` 立刻回调。如果按钮引用写成 `const` 放在后面，
 * 回调读它时它还在**暂时性死区**里 → ReferenceError → **整个 `main.js` 装配中断**
 *（真机表现：顶栏、侧边栏都在，但场景与所有 `__agentWorld*` 门面全没建）。
 * 这个坑 R91 踩过一次（当时是 `typeof` 兜不住 TDZ），R116 又踩了一次——
 * **规律是：任何"构造期间会同步回调"的 options，它的依赖都必须在调用点之前声明。**
 */
const sidebar = createSidebar({
  root: $('sidebar'),
  onExpand: () => {
    boardRef?.refreshGraph()
  },
  // R181：单块折叠/展开也要重挑依赖图几何（折叠期间容器是 0×0，量出来的是废图）。
  onPanelExpand: () => {
    boardRef?.refreshGraph()
  },
})

/**
 * 执行看板（M7-1 → R3：从顶栏搬进侧边栏）。
 *
 * **挂载模式**：不建顶栏摘要条，把成员档与任务图档分别挂到侧边栏的两块容器里。
 * `palette` 变量也挂在侧边栏上（`styleRoot`），两档都能继承到 `--board-*`。
 *
 * 数据仍是**事件驱动**（`board.update(world)`），不进 `render()` 那条 250ms 的路——
 * 这是"看板不拖慢场景"的前提。
 */
/**
 * R181：挂载位取一次，`main.js` 里多个 renderer（jobs / header ＋）共用同一批容器。
 */
const sidebarMounts = sidebar.mounts()
const board = createBoard({
  mounts: sidebarMounts,
  styleRoot: $('sidebar'),
  assetBase,
  palette: {},
  // R181：任务图节点上的 ✓/↺ 与成员行上的 → 都在这里落到团队写入（CAS 用 revision）。
  onTaskAction: (event) => {
    void runTeamTaskAction(event)
  },
  onAssign: (taskId, member, revision) => {
    void assignTeamTask(taskId, member, revision)
  },
  // R97：**💬 按钮连同它那条回调一起删了**（用户拍板：与「点人 + 回车」重复）。
  // 现在只剩两条路：场景点人（聚焦 + 开面板）、成员行（只聚焦）。
  // 对话的另外两条入口都在 `main.js` 顶层：点场景里的人、选中后按回车。
  // ③ 成员**行**：只聚焦，**不开**面板。侧边栏里点谁，镜头就跟谁。
  onMemberSelect: (agentId) => { focusAgent(agentId, 'member'); openDialogueFor(agentId) },
})
boardRef = board

// R208：三张卡（场景/任务/团队）进入同一个 dock，可互相拖到左/右/上/下，split 手柄可调宽。
const dock = mountDock({
  root,
  stage: document.querySelector('.stage'),
  panels: {
    task: document.querySelector('#sidebar-panel-graph'),
    team: document.querySelector('#sidebar-panel-agents'),
  },
})

// R307：header 面板开关——只控制 task/team 两张卡是否显示，不改布局树。
const panelVisibility = (() => {
  try {
    const saved = JSON.parse(globalThis.localStorage?.getItem('agentWorld.panelVisibility') ?? 'null')
    return { team: saved?.team !== false, task: saved?.task !== false }
  } catch (e) { return { team: true, task: true } }
})()
const panelSwitchButton = root.querySelector?.('#cmd-panels')
const panelSwitchMenu = root.querySelector?.('#panel-switch-menu')
const panelChecks = [...(root.querySelectorAll?.('[data-panel]') ?? [])]
function writePanelVisibility() {
  try { globalThis.localStorage?.setItem('agentWorld.panelVisibility', JSON.stringify(panelVisibility)) } catch (e) { /* 便利 */ }
  for (const input of panelChecks) input.checked = panelVisibility[input.dataset.panel] === true
  dock.setPanelVisible('team', panelVisibility.team)
  dock.setPanelVisible('task', panelVisibility.task)
  if (panelSwitchButton !== null && panelSwitchButton !== undefined) {
    const visibleCount = Number(panelVisibility.team) + Number(panelVisibility.task)
    panelSwitchButton.title = visibleCount === 0 ? '显示面板（当前全部隐藏）' : `显示面板（${visibleCount}/2）`
    panelSwitchButton.setAttribute('aria-label', panelSwitchButton.title)
  }
}
function setPanelMenu(open) {
  if (panelSwitchMenu === null || panelSwitchMenu === undefined) return
  panelSwitchMenu.hidden = open !== true
  panelSwitchButton?.setAttribute('aria-expanded', String(open === true))
}
panelSwitchButton?.addEventListener('click', (event) => {
  event.stopPropagation()
  setPanelMenu(panelSwitchMenu?.hidden === true)
})
for (const input of panelChecks) {
  input.addEventListener('change', () => {
    const id = input.dataset.panel
    if (id !== 'task' && id !== 'team') return
    panelVisibility[id] = input.checked
    writePanelVisibility()
  })
}
doc.addEventListener?.('click', (event) => {
  if (panelSwitchMenu === null || panelSwitchMenu === undefined || panelSwitchMenu.hidden) return
  if (event.target instanceof Node && (panelSwitchMenu.contains(event.target) || panelSwitchButton?.contains(event.target))) return
  setPanelMenu(false)
})
doc.addEventListener?.('keydown', (event) => {
  if (event.key !== 'Escape') return
  setPanelMenu(false)
  if (panelSwitchMenu?.hidden === true) panelSwitchButton?.focus()
})
writePanelVisibility()

// 恢复上次任务视图；dock/面板已就绪，树/看板可以安全渲染。
if (taskView !== 'graph') setTaskView(taskView)

dialogue = createDialogueUi({
  document: scopedDoc,
  send: sayToAgent,
  onChanged: () => {
    render(true)
  },
  // P2：点「取消锁定」→ 解锁镜头（不关对话，只解除选中/跟随）。
  onUnlock: () => {
    if (typeof scene2d.clearSelection === 'function') scene2d.clearSelection()
  },
  // P3 地基：超控模式切换 → 开/关引擎的键盘操控（互斥：打字时不动，移动时不打字）。
  onModeChange: (mode) => {
    if (typeof scene2d.setMovementEnabled === 'function') scene2d.setMovementEnabled(mode === 'move')
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
/**
 * 读这个世界对应的 DSH 会话名（R162）。
 *
 * 队长会话的标题在 session 日志里（异步），由宿主的 `/api/session` 端点解析；
 * 拿不到标题时退回 teamName / captainSessionId，**不编一个看起来像标题的字符串**。
 * 端点是同源小请求，只在快照到达后取一次；重连（新快照）会再取。
 */
function renderWorldSession(info) {
  if ($brandSession === null) return
  if (info === null || info === undefined) {
    $brandSession.hidden = true
    $brandSession.textContent = ''
    return
  }
  const label = typeof info.title === 'string' && info.title !== ''
    ? info.title
    : typeof info.teamName === 'string' && info.teamName !== ''
      ? info.teamName
      : typeof info.id === 'string' && info.id !== '' ? '未命名' : ''
  if (label === '') {
    $brandSession.hidden = true
    return
  }
  $brandSession.textContent = `会话 · ${label}`
  $brandSession.title = [info.title, info.teamName, info.id].filter((part) => typeof part === 'string' && part !== '').join(' · ')
  $brandSession.hidden = false
}

/**
 * DSH Client 调这个：传入**左侧工作区当前选中会话**的 `{ id, title }`（null = 没有选中）。
 *
 * 它比 `/api/session`（队长会话）优先：header 要显示的是用户眼前的那个会话名，
 * 不是 Agent World 自己的团队会话。
 */
/**
 * 官方 agentTeam projection 的入口。embed 的 handle 会调用它；
 * 必须在这里显式定义，否则会报 "setTeamProjection is not defined"。
 */
function setTeamProjection(team) {
  renderOfficialTeam(team)
}

/** DSH session 树（R273）：团队拓扑的真实父子来源。 */
function setSessionGraph(graph) {
  sessionGraph = graph
  if (workflowPollTimer !== null) { globalThis.clearTimeout(workflowPollTimer); workflowPollTimer = null }
  if (teamView === 'workflow') renderTeamTopology(lastTeam)
}

function setWorldSession(info) {
  workspaceSessionOverride = info ?? null
  worldSession = workspaceSessionOverride
  renderWorldSession(workspaceSessionOverride)
}

async function postTeamTask(action, extra) {
  try {
    const response = await fetch(apiUrl('api/team/task'), {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ rootSessionId: sessionId, action, ...extra }),
    })
    const data = await response.json().catch(() => ({}))
    if (data?.ok !== true) return { ok: false, error: data?.error ?? `任务写入失败（HTTP ${response.status}）` }
    return { ok: true, task: data.task }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) }
  }
}

/**
 * R181：任务面板**只放一行通知**（错误 / fallback / 只读计划）。
 *
 * 任务本身是图里的节点（`.board-node`），不再是一列"状态 · 标题 → 人 [按钮]".
 * 这条通知行替代原来的错误块与标题两行——出错时才出现。
 */
function setTasksNotice(text, kind = 'notice') {
  const card = root.querySelector('#sidebar-official-tasks')
  if (card === null) return
  card.textContent = ''
  if (typeof text !== 'string' || text === '') return
  const line = doc.createElement('div')
  line.className = kind === 'error' ? 'aw-error' : 'aw-notice'
  line.textContent = text
  card.append(line)
}

/** 把毫秒折成 `3m12s` / `42s`（后台任务条只给人一个"跑了多久"的量级）。 */
function formatDuration(ms) {
  if (!Number.isFinite(ms) || ms < 0) return ''
  const seconds = Math.floor(ms / 1000)
  if (seconds < 60) return `${seconds}s`
  return `${Math.floor(seconds / 60)}m${String(seconds % 60).padStart(2, '0')}s`
}

/**
 * R181：后台任务条（`.aw-jobs`）。
 *
 * 只有 projection 里真有 `team.jobs` 才渲染——没有就整行 `hidden`，
 * 不占高度、也不写"暂无后台任务"这种占位话（任务图才是主角）。
 */
function renderTeamJobs(team) {
  const host = sidebarMounts.jobs
  if (host === null || host === undefined) return
  host.textContent = ''
  const explicit = Array.isArray(team?.jobs) ? team.jobs : []
  // project 没有独立 jobs 时，把 in_progress 的团队任务作为后台任务条展示；
  // 这是官方任务数据，不另建数据源。
  const derived = explicit.length > 0
    ? []
    : (Array.isArray(team?.tasks) ? team.tasks : [])
        .filter((task) => task && task.status === 'in_progress')
        .map((task) => ({ id: task.id, label: `${task.subject ?? ''}${task.ownerName ? ` → ${task.ownerName}` : ''}` }))
  const jobs = explicit.length > 0 ? explicit : derived
  host.hidden = jobs.length === 0
  if (jobs.length === 0) return
  const now = Date.now()
  for (const job of jobs.slice(0, 3)) {
    if (job === null || typeof job !== 'object') continue
    const row = doc.createElement('div')
    row.className = 'aw-job'
    const dot = doc.createElement('i')
    dot.className = 'aw-job-dot'
    const label = doc.createElement('span')
    label.className = 'aw-job-label'
    label.textContent = typeof job.label === 'string' && job.label !== '' ? job.label : (typeof job.id === 'string' ? job.id : '后台任务')
    const time = doc.createElement('b')
    time.className = 'aw-job-time'
    time.textContent = typeof job.startedAt === 'number' ? formatDuration(now - job.startedAt) : '运行中'
    row.append(dot, label, time)
    host.append(row)
  }
}

/**
 * R181：官方 projection → **任务图 + 状态带**。
 *
 * 原来那一段文字任务行 + 一排文字按钮 + 浏览器弹窗已删：
 * 操作收进图节点的 ✓/↺ 与成员行的 →，新建改成 Agent 面板里的内联输入框。
 */
function renderOfficialTasks(team) {
  if (team === null || team === undefined) return
  const tasks = Array.isArray(team.tasks) ? team.tasks : []
  lastOfficialTasks = tasks
  const byName = new Map((world?.agents ?? []).map((agent) => [agent.name, agent.id]))
  teamActivity = new Map()
  for (const task of tasks) {
    const status = String(task.status ?? '')
    if (status !== 'in_progress' && status !== 'running' && status !== 'active') continue
    const id = byName.get(task.ownerName)
    if (typeof id === 'string') teamActivity.set(id, task.id)
  }
  const emptyHost = root.querySelector('#sidebar-official-tasks')
  if (emptyHost !== null) {
    emptyHost.textContent = ''
    emptyHost.classList.toggle('is-empty', tasks.length === 0)
    if (tasks.length === 0) {
      const box = doc.createElement('div')
      box.className = 'aw-task-empty'
      const text = doc.createElement('span')
      text.textContent = '还没有任务。'
      const create = doc.createElement('button')
      create.type = 'button'
      create.className = 'aw-task-empty-create'
      create.textContent = '＋ 新建任务'
      create.addEventListener('click', () => setComposerOpen(true))
      box.append(text, create)
      emptyHost.append(box)
    }
  }
  const done = tasks.filter((task) => task.status === 'completed' || task.status === 'done').length
  const meta = root.querySelector('#sidebar-region-meta-graph')
  if (meta !== null) meta.textContent = tasks.length === 0 ? '' : `✓ ${done}/${tasks.length} 完成`
  setTasksNotice('')
  // 任务交给看板：它负责节点/边/状态带/图标可用性（图与状态带是同一份数据）。
  board.setTeamTasks(tasks)
  if (world !== null) board.update(applyTeamActivity(world), { diagnostics, scene: meta?.scene })
  const graphHost = root.querySelector('#sidebar-task-graph')
  if (graphHost !== null) graphHost.hidden = tasks.length === 0 || taskView !== 'graph'
  if (tasks.length > 0 && taskView === 'graph') board.refreshGraph?.()
  renderTeamJobs(team)
  if (taskView === 'tree') renderTaskTree(tasks)
  else if (taskView === 'board') renderTaskBoard(tasks)
}

/*
 * R181：Agent 面板的内联「新建任务」。
 *
 * 只建一次、之后复用：projection 每次刷新都会走 renderAgentActions，
 * 重建输入框会把用户正在打的字清掉（那是"看起来能用、实际不能用"的一类 bug）。
 * Enter 创建 / Esc 收起；负责人 = 看板里当前选中的成员行（没选就未指派）。
 */
let composerBox = null
let composerInput = null
let composerSubmit = null
let composerError = null

async function submitComposer() {
  if (composerInput === null || composerSubmit === null) return
  const subject = composerInput.value.trim()
  if (subject === '') {
    composerInput.focus()
    return
  }
  const owner = board.selectedMember()?.name ?? ''
  composerSubmit.disabled = true
  const result = await postTeamTask('create', { subject, ...(owner === '' ? {} : { owner }) })
  composerSubmit.disabled = false
  if (result.ok !== true) {
    if (composerError !== null) {
      composerError.textContent = result.error ?? '任务创建失败'
      composerError.hidden = false
    }
    return
  }
  setComposerOpen(false)
  await loadTeamPlan()
}

function setComposerOpen(open) {
  if (composerBox === null) return
  composerBox.hidden = open !== true
  if (open === true) {
    if (composerError !== null) composerError.hidden = true
    const owner = board.selectedMember()?.name ?? ''
    composerInput.placeholder = owner === '' ? '新任务标题（Enter 创建）' : `新任务标题（指派给 ${owner}）`
    composerInput.focus()
    return
  }
  composerInput.value = ''
  if (composerError !== null) composerError.hidden = true
}

function ensureAgentComposer(card) {
  if (composerBox !== null) {
    // projection 刷新会重写任务面板内容；composer 必须重新挂回，否则按钮在、输入框丢。
    if (!composerBox.isConnected) {
      card.prepend(composerError)
      card.prepend(composerBox)
    }
    return
  }
  composerBox = doc.createElement('div')
  composerBox.className = 'aw-composer'
  composerBox.hidden = true
  composerInput = doc.createElement('input')
  composerInput.className = 'aw-composer-input'
  composerInput.type = 'text'
  composerInput.placeholder = '新任务标题（Enter 创建）'
  composerInput.setAttribute('aria-label', '新任务标题')
  composerSubmit = doc.createElement('button')
  composerSubmit.type = 'button'
  composerSubmit.className = 'aw-icon'
  composerSubmit.textContent = '↵'
  composerSubmit.title = '创建任务'
  composerSubmit.setAttribute('aria-label', '创建任务')
  composerSubmit.addEventListener('click', () => void submitComposer())
  composerBox.append(composerInput, composerSubmit)
  composerError = doc.createElement('div')
  composerError.className = 'aw-error'
  composerError.hidden = true
  card.prepend(composerError)
  card.prepend(composerBox)

  composerInput.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault()
      // main.js 有个文档级 Enter = "开始对话"；输入框里回车只能用来提交。
      event.stopPropagation()
      void submitComposer()
      return
    }
    if (event.key === 'Escape') {
      event.preventDefault()
      event.stopPropagation()
      setComposerOpen(false)
    }
  })
}

/**
 * R182：新建任务属于任务面板；Agent 面板只保留团队信息与成员动作。
 * composer 挂在任务面板内容顶部，＋ 挂在任务面板 header 的 graphActions。
 */
/** R183：阻塞依赖树。用 DOM 行 + 缩进，不另开面板；deleted 不画。 */
function renderTaskTree(tasks) {
  const graph = root.querySelector('#sidebar-task-graph')
  if (graph === null) return
  let tree = root.querySelector('#sidebar-task-tree')
  if (tree === null) {
    tree = doc.createElement('div')
    tree.id = 'sidebar-task-tree'
    tree.className = 'aw-tree'
    graph.parentElement?.insertBefore(tree, graph)
  }
  graph.hidden = true
  tree.hidden = false
  tree.textContent = ''
  const alive = tasks.filter((t) => t.status !== 'deleted')
  const byId = new Map(alive.map((t) => [t.id, t]))
  const depthOf = (task, seen = new Set()) => {
    if (!Array.isArray(task.blockedBy) || task.blockedBy.length === 0) return 0
    if (seen.has(task.id)) return 0
    seen.add(task.id)
    let depth = 0
    for (const id of task.blockedBy) {
      const parent = byId.get(id)
      if (parent) depth = Math.max(depth, depthOf(parent, seen) + 1)
    }
    return depth
  }
  const ordered = [...alive].sort((a, b) => depthOf(a) - depthOf(b) || String(a.id).localeCompare(String(b.id)))
  for (const task of ordered) {
    const row = doc.createElement('div')
    row.className = 'aw-tree-row'
    row.tabIndex = 0
    row.setAttribute('role', 'button')
    row.setAttribute('aria-label', `${task.id ?? ''} ${task.subject ?? ''}`)
    row.style.setProperty('--depth', String(depthOf(task)))
    row.addEventListener('click', () => board.select(task.id))
    row.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault()
        board.select(task.id)
      }
    })
    const dot = doc.createElement('i')
    dot.className = 'aw-tree-dot'
    dot.dataset.status = task.status ?? 'pending'
    const label = doc.createElement('span')
    label.className = 'aw-tree-label'
    label.textContent = `${task.id ?? ''} ${task.subject ?? ''}`
    const owner = doc.createElement('b')
    owner.className = 'aw-tree-owner'
    owner.textContent = task.ownerName ?? '未分配'
    row.append(dot, label, owner)
    tree.append(row)
  }
  if (alive.length === 0) {
    const empty = doc.createElement('div')
    empty.className = 'aw-empty'
    empty.textContent = '还没有任务'
    tree.append(empty)
  }
}

function taskViewIcon(kind) {
  if (kind === 'board') {
    return '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" aria-hidden="true"><rect x="2" y="3" width="3.2" height="10" rx="0.6"/><rect x="6.4" y="3" width="3.2" height="7" rx="0.6"/><rect x="10.8" y="3" width="3.2" height="5" rx="0.6"/></svg>'
  }
  if (kind === 'tree') {
    return '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" aria-hidden="true"><path d="M8 3v9M8 6H4v3M8 9h4v3"/><circle cx="8" cy="3" r="1.2"/><rect x="2.6" y="9" width="3" height="3" rx="0.6"/><rect x="10.4" y="9" width="3" height="3" rx="0.6"/></svg>'
  }
  return '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" aria-hidden="true"><path d="M4 4l4 4 4-4M4 12l4-4 4 4M8 8v5"/><circle cx="4" cy="4" r="1.4"/><circle cx="12" cy="4" r="1.4"/><circle cx="4" cy="12" r="1.4"/><circle cx="12" cy="12" r="1.4"/><circle cx="8" cy="8" r="1.4"/></svg>'
}

function renderTaskBoard(tasks) {
  const card = root.querySelector('.sidebar-panel-graph .sidebar-region-content')
  if (card === null) return
  let mount = root.querySelector('#sidebar-task-board')
  if (mount === null) {
    mount = doc.createElement('div')
    mount.id = 'sidebar-task-board'
    mount.className = 'sidebar-task-board'
    mount.hidden = true
    root.querySelector('#sidebar-task-graph')?.after(mount)
  }
  mount.hidden = taskView !== 'board'
  const columns = [
    ['pending', '待办'],
    ['in_progress', '进行中'],
    ['completed', '完成'],
    ['failed', '失败'],
  ]
  const statusOf = (task) => {
    const value = String(task?.status ?? 'pending')
    if (value === 'done') return 'completed'
    if (value === 'running' || value === 'active') return 'in_progress'
    return columns.some(([key]) => key === value) ? value : 'pending'
  }
  mount.textContent = ''
  const list = Array.isArray(tasks) ? tasks : []
  for (const [key, label] of columns) {
    const column = doc.createElement('section')
    column.className = 'aw-kanban-column'
    column.dataset.status = key
    const items = list.filter((task) => statusOf(task) === key)
    const head = doc.createElement('div')
    head.className = 'aw-kanban-head'
    const marker = doc.createElement('i')
    marker.className = 'aw-kanban-dot'
    marker.dataset.status = key
    head.append(marker, doc.createTextNode(label), Object.assign(doc.createElement('b'), { textContent: String(items.length) }))
    const body = doc.createElement('div')
    body.className = 'aw-kanban-body'
    if (items.length === 0) body.append(Object.assign(doc.createElement('div'), { className: 'aw-empty', textContent: '没有任务' }))
    for (const task of items) {
      const item = doc.createElement('div')
      item.className = 'aw-kanban-card'
      item.tabIndex = 0
      item.setAttribute('role', 'button')
      item.dataset.task = task.id
      item.dataset.status = statusOf(task)
      const descHint = typeof task.description === 'string' && task.description.trim() !== ''
        ? ` · ${task.description.trim().slice(0, 120)}`
        : ''
      item.title = `${task.id} · ${task.subject ?? ''} · ${columns.find(([key]) => key === statusOf(task))?.[1] ?? ''}${descHint}`
      item.setAttribute('aria-label', item.title)
      const top = doc.createElement('div')
      top.className = 'aw-kanban-top'
      const dot = doc.createElement('i')
      dot.className = 'board-dot board-task-dot'
      dot.dataset.status = statusOf(task)
      top.append(dot, Object.assign(doc.createElement('b'), { textContent: task.id ?? '' }))
      top.append(Object.assign(doc.createElement('span'), { className: 'aw-kanban-owner', textContent: task.ownerName ?? '未分配' }))
      const title = doc.createElement('div')
      title.className = 'aw-kanban-title'
      title.textContent = task.subject ?? ''
      title.title = title.textContent
      const desc = doc.createElement('div')
      desc.className = 'aw-kanban-desc'
      desc.textContent = task.description ?? ''
      desc.title = desc.textContent
      item.append(top, title, desc)
      const activate = () => board.select(task.id)
      item.addEventListener('click', (event) => {
        if (event.target?.closest?.('.aw-kanban-actions') !== null) return
        activate()
      })
      item.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); activate() }
      })
      const actions = doc.createElement('div')
      actions.className = 'aw-kanban-actions'
      if (statusOf(task) === 'completed') {
        const reopen = doc.createElement('button')
        reopen.type = 'button'
        reopen.className = 'aw-icon'
        reopen.textContent = '↺'
        reopen.title = `重开 ${task.id}`
        reopen.setAttribute('aria-label', reopen.title)
        reopen.addEventListener('click', (event) => {
          event.stopPropagation()
          reopen.disabled = true
          void postTeamTask('update', { taskId: task.id, expectedRevision: task.revision, updateAction: 'reopen' }).then((result) => { if (result.ok !== true) { setTasksNotice(result.error ?? '重开失败', 'error'); return } void loadTeamPlan() })
        })
        actions.append(reopen)
      } else {
        const complete = doc.createElement('button')
        complete.type = 'button'
        complete.className = 'aw-icon'
        complete.textContent = '✓'
        complete.title = `完成 ${task.id}`
        complete.setAttribute('aria-label', complete.title)
        complete.addEventListener('click', (event) => {
          event.stopPropagation()
          complete.disabled = true
          void postTeamTask('update', { taskId: task.id, expectedRevision: task.revision, updateAction: 'complete' }).then((result) => { if (result.ok !== true) { setTasksNotice(result.error ?? '完成失败', 'error'); return } void loadTeamPlan() })
        })
        actions.append(complete)
      }
      item.append(actions)
      body.append(item)
    }
    column.append(head, body)
    mount.append(column)
  }
}

function setTaskView(next) {
  taskView = next === 'board' ? 'board' : next === 'tree' ? 'tree' : 'graph'
  const graph = root.querySelector('#sidebar-task-graph')
  const tree = root.querySelector('#sidebar-task-tree')
  const kanban = root.querySelector('#sidebar-task-board')
  if (graph !== null) graph.hidden = taskView !== 'graph'
  if (tree !== null) tree.hidden = taskView !== 'tree'
  if (kanban !== null) kanban.hidden = taskView !== 'board'
  if (taskView === 'tree') renderTaskTree(lastOfficialTasks)
  else if (taskView === 'board') renderTaskBoard(lastOfficialTasks)
  else board.refreshGraph?.()
  try { globalThis.localStorage?.setItem('agentWorld.taskView', taskView) } catch (e) { /* 便利 */ }
  const button = root.querySelector('.aw-view-button')
  if (button !== null) {
    button.innerHTML = taskViewIcon(taskView)
    button.dataset.view = taskView
    button.setAttribute('aria-expanded', 'false')
    button.title = taskView === 'tree' ? '当前：树' : taskView === 'board' ? '当前：看板' : '当前：图'
  }
  for (const option of root.querySelectorAll('.aw-view-option')) {
    option.classList.toggle('is-active', option.dataset.view === taskView)
    option.setAttribute('aria-selected', String(option.dataset.view === taskView))
  }
}

function renderTaskActions(team) {
  const card = root.querySelector('.sidebar-panel-graph .sidebar-region-content')
  if (card === null) return
  ensureAgentComposer(card)
  const host = sidebarMounts.graphActions
  if (host === null || host === undefined) return
  if (host.querySelector('.aw-icon') !== null) return
  const create = doc.createElement('button')
  create.type = 'button'
  create.className = 'aw-icon aw-task-add'
  create.textContent = '＋ 任务'
  create.title = '新建任务'
  create.setAttribute('aria-label', '新建任务')
  create.addEventListener('click', () => setComposerOpen(composerBox.hidden))
  host.append(create)
  if (host.querySelector('.aw-view-wrap') === null) {
    const wrap = doc.createElement('div')
    wrap.className = 'aw-view-wrap'
    const button = doc.createElement('button')
    button.type = 'button'
    button.className = 'aw-view-select aw-view-button'
    button.innerHTML = taskViewIcon(taskView)
    button.dataset.view = taskView
    button.title = '切换任务视图'
    button.setAttribute('aria-label', '切换任务视图：图、树或看板')
    button.setAttribute('aria-haspopup', 'listbox')
    button.setAttribute('aria-expanded', 'false')
    const menu = doc.createElement('div')
    menu.className = 'aw-view-menu'
    menu.setAttribute('role', 'listbox')
    menu.hidden = true
    for (const [value, label] of [['graph', '图'], ['tree', '树'], ['board', '看板']]) {
      const option = doc.createElement('button')
      option.type = 'button'
      option.className = 'aw-view-option'
      option.dataset.view = value
      option.title = label
      option.setAttribute('role', 'option')
      option.setAttribute('aria-label', label)
      option.setAttribute('aria-selected', String(value === taskView))
      option.classList.toggle('is-active', value === taskView)
      option.innerHTML = taskViewIcon(value)
      option.addEventListener('click', () => {
        setTaskView(value)
        menu.hidden = true
        button.setAttribute('aria-expanded', 'false')
        button.focus()
      })
      menu.append(option)
    }
    const closeMenu = () => {
      menu.hidden = true
      button.setAttribute('aria-expanded', 'false')
    }
    button.addEventListener('click', (event) => {
      event.stopPropagation()
      menu.hidden = !menu.hidden
      button.setAttribute('aria-expanded', String(!menu.hidden))
      if (!menu.hidden) menu.querySelector('.aw-view-option')?.focus()
    })
    button.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') { event.preventDefault(); closeMenu(); button.focus() }
      if (event.key === 'ArrowDown' && menu.hidden) {
        event.preventDefault()
        menu.hidden = false
        button.setAttribute('aria-expanded', 'true')
        menu.querySelector('.aw-view-option')?.focus()
      }
    })
    menu.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') { event.preventDefault(); closeMenu(); button.focus() }
    })
    doc.addEventListener('click', (event) => {
      if (menu.hidden) return
      if (event.target instanceof Node && wrap.contains(event.target)) return
      closeMenu()
    })
    wrap.append(button, menu)
    host.append(wrap)
  }
}

let teamView = (() => {
  try {
    const saved = globalThis.localStorage?.getItem('agentWorld.teamView')
    return saved === 'workflow' || saved === 'topology' ? 'workflow' : 'tree'
  } catch (e) { return 'tree' }
})()
let lastTeam = null
let sessionGraph = null
let workflowLoadToken = 0
const heartbeatIntents = new Map()
let workflowLoading = false
let workflowPollTimer = null

function agentStateText(state) {
  return ({ working: '干活', talking: '对话中', walking: '走动', idle: '待命', sleeping: '休息', blocked: '阻塞', celebrating: '完成' })[state] ?? state ?? '待命'
}

/** R314：把 agent 的工位能力翻译成动作词；没有 world/station 时退回状态词。 */
function agentActivityText(actor, state) {
  if (actor === null || actor === undefined) return agentStateText(state)
  const stationId = actor.station ?? actor.targetStation
  const station = (world?.stations ?? []).find((candidate) => candidate.id === stationId)
  const kind = station?.kind
  if (state === 'working') {
    return ({ desk: '写代码', meeting: '开会', breakroom: '休息', lab: '研究', server: '算力', mailroom: '收发' })[kind] ?? '干活'
  }
  if (state === 'walking') {
    return ({ desk: '去工位', meeting: '去开会', breakroom: '去休息', lab: '去实验台', server: '去机柜', mailroom: '去收发室' })[kind] ?? '走动'
  }
  return agentStateText(state)
}

function ensureTeamTopology() {
  let mount = root.querySelector('#sidebar-team-topology')
  if (mount !== null) return mount
  const content = root.querySelector('.sidebar-panel-agents .sidebar-region-content')
  if (content === null) return null
  mount = doc.createElement('div')
  mount.id = 'sidebar-team-topology'
  mount.className = 'aw-topology'
  mount.hidden = true
  content.append(mount)
  return mount
}

function teamDetailHost() {
  let host = root.querySelector('#sidebar-team-detail')
  if (host !== null) return host
  const content = root.querySelector('.sidebar-panel-agents .sidebar-region-content')
  if (content === null) return null
  host = doc.createElement('div')
  host.id = 'sidebar-team-detail'
  host.className = 'aw-team-detail'
  host.hidden = true
  content.append(host)
  return host
}

function showTeamDetail(name, role, state, id, tasks) {
  const host = teamDetailHost()
  if (host === null) return
  host.textContent = ''
  host.hidden = false
  const head = doc.createElement('div')
  head.className = 'aw-team-detail-head'
  const title = doc.createElement('b')
  title.textContent = name
  const stateTag = doc.createElement('span')
  const roleLabel = role === 'lead' ? '负责人' : role === 'teammate' || role === 'member' ? '成员' : role === 'subagent' ? '子代理' : (role ?? '')
  const detailActor = (world?.agents ?? []).find((candidate) => candidate.id === id)
  stateTag.textContent = `${roleLabel} · ${agentActivityText(detailActor, state)}`
  const close = doc.createElement('button')
  close.type = 'button'
  close.className = 'aw-icon'
  close.textContent = '×'
  close.title = '关闭详情'
  close.setAttribute('aria-label', '关闭详情')
  close.addEventListener('click', () => { host.hidden = true })
  head.append(title, stateTag, close)
  host.append(head)
  const list = doc.createElement('div')
  list.className = 'aw-team-detail-tasks'
  if (tasks.length === 0) list.append(Object.assign(doc.createElement('div'), { className: 'dim', textContent: '这个 agent 还没有任务。' }))
  for (const task of tasks) {
    const line = doc.createElement('div')
    line.className = 'aw-team-detail-task'
    const dot = doc.createElement('i')
    dot.className = 'aw-topology-dot'
    dot.dataset.state = task.status === 'completed' || task.status === 'done' ? 'idle' : task.status === 'in_progress' ? 'working' : 'idle'
    const label = doc.createElement('span')
    label.textContent = `${task.id ?? ''} ${task.subject ?? ''}`
    label.title = label.textContent
    const status = doc.createElement('em')
    status.className = 'aw-team-detail-status'
    status.textContent = task.status === 'completed' || task.status === 'done' ? '完成' : task.status === 'in_progress' ? '进行中' : '待办'
    line.append(dot, label, status)
    line.tabIndex = 0
    line.setAttribute('role', 'button')
    line.title = `${label.textContent} · 点击在任务面板中选中`
    line.addEventListener('click', () => { board.select(task.id) })
    line.addEventListener('keydown', (event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); board.select(task.id) } })
    list.append(line)
  }
  host.append(list)
  const intent = typeof id === 'string' ? heartbeatIntents.get(id) : null
  if (intent !== null && intent !== undefined) {
    const box = doc.createElement('div')
    box.className = 'aw-heartbeat'
    const title = doc.createElement('b')
    title.textContent = `heartbeat · ${intent.decision ?? 'idle'}`
    const needs = doc.createElement('span')
    needs.textContent = `needs ${Array.isArray(intent.needs) && intent.needs.length > 0 ? intent.needs.join(', ') : '—'}`
    const wants = doc.createElement('span')
    wants.textContent = `wants ${Array.isArray(intent.wants) && intent.wants.length > 0 ? intent.wants.join(', ') : '—'}`
    box.append(title, needs, wants)
    host.append(box)
  }
  if (typeof id === 'string') {
    const talk = doc.createElement('button')
    talk.type = 'button'
    talk.className = 'btn btn-primary aw-team-detail-talk'
    talk.textContent = '对话'
    talk.addEventListener('click', () => { focusAgent(id, 'member'); openDialogueFor(id) })
    host.append(talk)
  }
}

function setTeamView(next) {
  teamView = next === 'workflow' ? 'workflow' : 'tree'
  if (workflowPollTimer !== null) { globalThis.clearTimeout(workflowPollTimer); workflowPollTimer = null }
  try { globalThis.localStorage?.setItem('agentWorld.teamView', teamView) } catch (e) { /* 便利 */ }
  const mount = ensureTeamTopology()
  const members = sidebarMounts.agentsMount ?? root.querySelector('.sidebar-members')
  if (members !== null && members !== undefined) members.hidden = teamView === 'workflow'
  if (mount !== null) mount.hidden = teamView !== 'workflow'
  const selector = root.querySelector('.aw-team-select')
  if (selector !== null) { selector.value = teamView; selector.title = teamView === 'workflow' ? '当前：流程' : '当前：树' }
  if (teamView === 'workflow') renderTeamTopology(lastTeam)
}

function workflowStatusText(status) {
  return ({ running: '运行中', completed: '已完成', cancelled: '已取消', failed: '失败' })[status] ?? status
}

function workflowMemberRow(member) {
  const row = doc.createElement('button')
  row.type = 'button'
  row.className = 'aw-workflow-member'
  const dot = doc.createElement('i')
  dot.className = 'aw-workflow-dot'
  dot.dataset.state = member.outcome === undefined ? 'running' : member.outcome === 'completed' ? 'done' : member.outcome === 'failed' ? 'error' : 'idle'
  const label = doc.createElement('span')
  label.className = 'aw-workflow-label'
  label.textContent = member.label || member.childId
  label.title = label.textContent
  const state = doc.createElement('em')
  state.textContent = ({ completed: '完成', failed: '失败', cancelled: '取消' })[member.outcome] ?? '运行中'
  row.append(dot, label, state)
  row.setAttribute('aria-label', `${member.label || member.childId} · ${(member.outcome ?? 'running')}`)
  row.addEventListener('click', () => {
    const actor = (world?.agents ?? []).find((candidate) => candidate.boundAgentId === member.childId)
      ?? (world?.agents ?? []).find((candidate) => candidate.name === member.label)
    if (actor !== undefined) {
      focusAgent(actor.id, 'member')
      showTeamDetail(actor.name, 'member', actor.state, actor.id, [])
    }
  })
  return row
}

function formatWorkflowDuration(run) {
  const start = Number(run.startedAt)
  const end = Number.isFinite(run.finishedAt) ? Number(run.finishedAt) : Date.now()
  if (!Number.isFinite(start)) return ''
  const ms = Math.max(0, end - start)
  return ms >= 60000 ? `${Math.floor(ms / 60000)}m${Math.round((ms % 60000) / 1000)}s` : `${Math.round(ms / 1000)}s`
}

function renderWorkflowRuns(runs, error) {
  const mount = ensureTeamTopology()
  if (mount === null) return
  mount.textContent = ''
  const emptyWithRetry = (message) => {
    const box = doc.createElement('div')
    box.className = 'aw-team-empty'
    const text = doc.createElement('div')
    text.textContent = message
    const retry = doc.createElement('button')
    retry.type = 'button'
    retry.className = 'aw-workflow-retry'
    retry.textContent = '重新加载'
    retry.addEventListener('click', () => { void loadWorkflowRuns() })
    box.append(text, retry)
    mount.append(box)
  }
  if (error !== null) { emptyWithRetry(`workflow 数据不可用：${error}`); return }
  if (!Array.isArray(runs) || runs.length === 0) { emptyWithRetry('还没有 workflow 运行。workflow 启动后会按 run 显示在这里。'); return }
  for (const run of runs) {
    const card = doc.createElement('div')
    card.className = 'aw-workflow-run'
    card.title = `${run.runId} · ${run.status}`
    const head = doc.createElement('div')
    head.className = 'aw-workflow-head'
    const name = doc.createElement('b')
    name.textContent = run.name || run.runId
    const status = doc.createElement('span')
    status.className = 'aw-workflow-status'
    status.dataset.status = run.status
    status.textContent = workflowStatusText(run.status)
    const meta = doc.createElement('span')
    meta.className = 'aw-workflow-meta'
    const memberCount = run.phases.reduce((sum, phase) => sum + phase.members.length, 0)
    meta.textContent = `${memberCount} 成员 · ${formatWorkflowDuration(run)}`
    head.append(name, status, meta)
    card.append(head)
    for (const phase of run.phases ?? []) {
      const phaseBox = doc.createElement('div')
      phaseBox.className = 'aw-workflow-phase'
      if (phase.title !== undefined) phaseBox.append(Object.assign(doc.createElement('div'), { className: 'aw-workflow-phase-title', textContent: phase.title }))
      for (const member of phase.members ?? []) phaseBox.append(workflowMemberRow(member))
      card.append(phaseBox)
    }
    mount.append(card)
  }
}

async function loadWorkflowRuns() {
  const mount = ensureTeamTopology()
  if (mount === null) return
  if (mount.textContent === '') mount.append(Object.assign(doc.createElement('div'), { className: 'aw-team-empty', textContent: '正在加载 workflow…' }))
  const rootId = sessionGraph?.rootId ?? currentSessionId
  if (typeof rootId !== 'string' || rootId === '') { renderWorkflowRuns([], '没有当前会话'); return }
  if (workflowLoading) return
  workflowLoading = true
  const token = ++workflowLoadToken
  try {
    const response = await fetch('/sidebar/api/workflows.list', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sessionId: currentSessionId ?? rootId, rootSessionId: rootId }),
    })
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    const envelope = await response.json()
    if (token !== workflowLoadToken) return
    if (envelope?.ok !== true) throw new Error(envelope?.error?.message ?? '返回格式错误')
    renderWorkflowRuns(envelope.value?.runs ?? [], null)
  } catch (error) {
    if (token !== workflowLoadToken) return
    renderWorkflowRuns([], error instanceof Error ? error.message : String(error))
  } finally {
    workflowLoading = false
    if (workflowPollTimer !== null) globalThis.clearTimeout(workflowPollTimer)
    if (teamView === 'workflow') workflowPollTimer = globalThis.setTimeout(() => { workflowPollTimer = null; void loadWorkflowRuns() }, 5000)
  }
}

function renderTeamTopology(team) {
  const mount = ensureTeamTopology()
  if (mount === null) return
  mount.hidden = teamView !== 'workflow'
  if (teamView !== 'workflow') return
  void loadWorkflowRuns()
  return

}

/** Agent 面板：列表 / agent 拓扑两种查看方式。 */
function renderAgentActions(team) {
  // 团队摘要属于 header 的 meta，不占内容区；否则和左侧 AGENT 列表标题错一行。
  const meta = root.querySelector('#sidebar-region-meta-agents')
  if (meta !== null) {
    const members = Array.isArray(team?.members) ? team.members : []
    const lead = members.find((m) => m && m.role === 'lead') ?? members[0]
    const taskCount = Array.isArray(lastOfficialTasks) ? lastOfficialTasks.length : 0
    meta.textContent = `${lead?.name ?? 'lead'} · ${members.length} 人 · ${taskCount} 任务`
  }
  lastTeam = team
  const card = root.querySelector('#sidebar-official-agents')
  if (card !== null) card.textContent = ''
  const host = sidebarMounts.agentsActions
  if (host !== null && host !== undefined && host.querySelector('.aw-team-select') === null) {
    const select = doc.createElement('select')
    select.className = 'aw-view-select aw-team-select'
    select.title = '团队显示模式'
    select.setAttribute('aria-label', '切换团队显示模式：树或流程')
    for (const [value, icon, label] of [['tree', '☰', '树'], ['workflow', '⑂', '流程']]) {
      const option = doc.createElement('option')
      option.value = value
      option.textContent = `${icon} ${label}`
      option.title = label
      select.append(option)
    }
    select.value = teamView
    select.addEventListener('change', () => setTeamView(select.value))
    const refresh = doc.createElement('button')
    refresh.type = 'button'
    refresh.className = 'aw-icon aw-team-refresh'
    refresh.textContent = '↻'
    refresh.title = '刷新团队'
    refresh.setAttribute('aria-label', '刷新团队')
    refresh.addEventListener('click', () => {
      if (teamView === 'workflow') void loadWorkflowRuns()
      else board.refresh()
    })
    host.append(select, refresh)
  }
  const membersMount = sidebarMounts.agentsMount ?? root.querySelector('.sidebar-members')
  if (membersMount !== null && membersMount !== undefined) membersMount.hidden = teamView === 'workflow'
  ensureTeamTopology()
  if (teamView === 'workflow') renderTeamTopology(team)
  else {
    const mount = root.querySelector('#sidebar-team-topology')
    if (mount !== null) mount.hidden = true
  }
  setTeamView(teamView)
}

/** R181：图节点上的 ✓/↺ → 团队 CAS 更新（失败只写通知行，不弹窗）。 */
async function runTeamTaskAction(event) {
  if (event === null || typeof event !== 'object') return
  const taskId = typeof event.taskId === 'string' ? event.taskId : ''
  if (taskId === '') return
  const updateAction = event.action === 'reopen' ? 'reopen' : 'complete'
  const result = await postTeamTask('update', { taskId, expectedRevision: event.revision, updateAction })
  if (result.ok !== true) {
    setTasksNotice(result.error ?? '任务更新失败', 'error')
    return
  }
  setTasksNotice('')
  await loadTeamPlan()
}

/** R181：成员行上的 → → 指派（owner 用名字，与官方 projection 的 ownerName 同口径）。 */
async function assignTeamTask(taskId, member, revision) {
  const owner = typeof member?.name === 'string' ? member.name : ''
  if (typeof taskId !== 'string' || taskId === '' || owner === '') return
  const result = await postTeamTask('update', { taskId, expectedRevision: revision, updateAction: 'reassign', owner })
  if (result.ok !== true) {
    setTasksNotice(result.error ?? '指派失败', 'error')
    return
  }
  setTasksNotice('')
  await loadTeamPlan()
}

function renderOfficialTeam(team) {
  if (team === null || team === undefined) return false
  renderOfficialTasks(team)
  renderTaskActions(team)
  renderAgentActions(team)
  officialTeamRendered = true
  return true
}

/**
 * R181：读官方团队（projection 之外的 HTTP 兜底）。
 *
 * 面板首屏与每 10s 轮询都走它：`api/team` 有 projection 就用它；
 * 没有就退回只读的 staged plan（只写一行通知）。
 */
async function loadTeamPlan() {
  if (sessionId === null) return
  try {
    const response = await fetch(apiUrl(`api/team?session=${encodeURIComponent(sessionId)}`), { credentials: 'same-origin' })
    if (response.ok === true) {
      const data = await response.json()
      if (data?.team?.available === true) {
        renderOfficialTasks(data.team)
        renderTaskActions(data.team)
        renderAgentActions(data.team)
        return
      }
    }
  } catch { /* 继续尝试 plan */ }
  try {
    const response = await fetch(apiUrl(`api/team/plan?session=${encodeURIComponent(sessionId)}`), { credentials: 'same-origin' })
    if (response.ok !== true) return
    const data = await response.json()
    renderTeamPlan(data?.plan ?? null)
  } catch { /* 读不到就不显示 */ }
}

/**
 * R181：旧 agent-teams fallback（staged plan）**只写一行只读通知**。
 *
 * 不再列成员/任务，也不摆一排文字——计划审批在对话的 Pre-run plan review 里，
 * 面板重复一份既占高度又会过期。
 */
function renderTeamPlan(plan) {
  renderTeamJobs(null)
  if (plan === null || plan === undefined) {
    board.setTeamTasks(null)
    setTasksNotice('')
    return
  }
  // 没有官方任务可画：退回世界自己的工单，图仍然可用。
  board.setTeamTasks(null)
  const members = Array.isArray(plan.members) ? plan.members : []
  const tasks = Array.isArray(plan.tasks) ? plan.tasks : []
  const name = typeof plan.name === 'string' && plan.name !== '' ? plan.name : '待批准'
  setTasksNotice(`团队计划「${name}」· ${members.length} 成员 / ${tasks.length} 任务 · 只读（审批在对话的 Pre-run plan review 里）`)
}

async function loadWorldSession() {
  // 客户端已经给了工作区会话（或明确“没有”）时，别用队长/团队名覆盖它。
  if (workspaceSessionOverride !== undefined) return
  if ($brandSession === null) return
  try {
    const response = await fetch(apiUrl('api/session'), { credentials: 'same-origin' })
    if (response.ok !== true) return
    const info = await response.json()
    // 等响应期间 DSH Client 可能已经送来了“左侧工作区当前会话”；它优先。
    if (workspaceSessionOverride !== undefined) return
    worldSession = info ?? null
    renderWorldSession(worldSession)
  } catch {
    /* 端点不在（headless / 旧宿主）就不显示；这不是错误。 */
  }
}

function showHint(text) {
  if ($hint === null) return
  $hint.textContent = text ?? ''
  $hint.hidden = text === '' || text === null || text === undefined
}

// ── 气泡 ──────────────────────────────────────────────────────────────────────

/**
 * 头顶气泡（M6-5 → R76 进引擎 → R77 用本地 9-slice 美术面板）。
 *
 * 气泡现在是 **Phaser 对象**（NineSlice 面板 + Text + 状态点，世界坐标，随相机缩放平移），
 * 主循环只做一件事：从对话状态机拿 `[{agentId, phase, text}]` 交给场景画。
 * 名字**不进气泡**（气泡 vs 名字二选一：有气泡就藏头顶名字，气泡消失再露出来）。
 * 屏幕边缘避让/尾巴指向这些"贴边"逻辑随 DOM 层一起删掉了——世界坐标里气泡跟着人走，
 * 人走到画面边缘气泡自然跟着出画面，这是游戏该有的样子，不需要额外夹取。
 */
function updateBubbles() {
  if (meta === null) return
  const list = dialogue === null ? [] : dialogue.bubblesFor(performance.now())
  const enriched = []
  for (const bubble of list) {
    const agent = world?.agents.find((a) => a.id === bubble.agentId)
    if (agent === undefined) continue
    enriched.push({ agentId: bubble.agentId, phase: bubble.phase, text: bubble.text })
  }
  scene2d.renderBubbles(enriched)
}

// ── 渲染 ──────────────────────────────────────────────────────────────────────

function render(force = false) {
  if (world === null || meta === null) return
  const now = performance.now()
  if (!force && now - lastRenderMs < RENDER_MIN_GAP_MS) return
  lastRenderMs = now
  const tick = currentTick()

  scene2d.render({ world: applyTeamActivity(world), scene: meta.scene, tick, messageDeliveryTicks: meta.messageDeliveryTicks })

  // 把渲染器的**真实计数**显示出来——"不卡"要能被看见，否则只是承诺（R57）。
  // 报 Phaser 用哪个渲染器、这一帧提交了几次 GL 绘制、画了多少个对象。
  // （绘制次数挂在 Phaser 的 prerender/postrender 钩子上数，不是我们多渲染一遍。）
  const sceneStats = scene2d.stats()
  const backendName = sceneStats.backend === 'canvas' ? 'Phaser(canvas)' : 'Phaser(WebGL)'
  // R84：**构建标记 + 朝向抖动计数**。
  // 为什么要它：这两个指标让"页面到底是不是新代码""朝向到底有没有在抖"变成**界面上能读的数**，
  // 不用再靠猜。之前两轮就是在"不知道用户跑的是哪份代码"的情况下改的，白改。
  const flips = trackAnimFlips()
  // R86：**自检读数**（帧重置 / 动画互抢 / 与世界漂移）。
  // 三个数正常时**恒为 0**——所以"不是 0"本身就是结论，不需要再去猜是哪一类。
  // 抽样自节流（800ms 一次），这条路是 250ms 一跳，加它不会让渲染变慢。
  selfCheck.sample()
  const perf = `${backendName} · 绘制 ${sceneStats.drawCalls}${sceneStats.batched === true ? '（合批）' : ''} · 精灵 ${sceneStats.sprites ?? '-'} · 切换 ${flips} · ${selfCheck.report().text} · ${BUILD}`
  topbar?.render({
    world,
    meta,
    tick,
    perf,
    connected: connection.status().connected,
    nextSeq: connection.status().nextSeq,
    silentForMs: connection.silentForMs(),
    // R108：阈值**按服务端的实际心跳节奏算**（`connection.staleAfterMs()`），
    // 不再用写死的 8s——那个值比心跳（15s）还短，于是健康连接每 15 秒里也有约 7 秒被判成"过期"。
    staleAfterMs: connection.staleAfterMs(),
    waiting: dialogue?.thinkingTurns().length ?? 0,
  })

  updateBubbles()
  // 面板只重画签名变了的东西；"他在想…（12s）"里的秒数靠这次调用更新。
  dialogue?.render(now)
  // 视野按钮的禁用态/倍数跟着渲染层走（接口没就位时显示 —，并全部禁用）
  syncViewControls()
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

/**
 * 点到人之后：确保面板**开在这个人身上**（`docs/PLAN-game-agent.md` (d)4，用户 R97 拍板）。
 *
 * ## 为什么不再是 `toggle`
 *
 * 用户原话：「已经选中 A、面板开着时，再点一次 A → **不关面板，只是重新聚焦**」。
 * 旧行为是 `toggle`：再点同一个人会**关掉面板**——于是"想再确认下这个人"的顺手动作，
 * 反而把面板收走了。
 *
 * ## 为什么也**不能**直接 `dialogue.open(agentId)`
 *
 * `open()` 会把面板**重置回移动档**，并在对话档时重新聚焦输入框。于是：
 *   · 正在对话档打字的人，再点一下自己就会**被踢出输入框**（比关掉面板更烦）；
 *   · 已经切到对话档的人，会被悄悄降回移动档。
 * 那等于用"重置"来实现"重新聚焦"，副作用比原问题更大。
 *
 * ## 正确的三态（也别写成"同一个人就什么都不做"——面板关着时必须开）
 *
 * | 当前 | 做什么 |
 * |---|---|
 * | 面板关着 | `open(agentId)` → 默认移动档 |
 * | 开着、同一个人 | **no-op**（保持档位与焦点，不重置） |
 * | 开着、换人 | `open(新 id)` |
 */
async function loadAgentHistory(agentId) {
  try {
    const response = await fetch(apiUrl(`api/history?agent=${encodeURIComponent(agentId)}`), { credentials: 'same-origin' })
    if (!response.ok) return
    const data = await response.json()
    if (dialogue.agentId() !== agentId) return
    dialogue.setHistory?.(agentId, Array.isArray(data?.messages) ? data.messages : [])
  } catch (error) { /* 历史读不到不影响对话 */ }
}

function openDialogueFor(agentId) {
  if (agentId === null || agentId === undefined) return
  const sameAgentOpen = dialogue.isOpen() === true && dialogue.agentId() === agentId
  if (!sameAgentOpen) dialogue.open(agentId)
  void loadAgentHistory(agentId)
  render(true)
}

/**
 * 上一次聚焦是从哪条路来的（只给 `__agentWorld` 门面读，**不参与分支**）。
 *
 * ⚠️ 必须**声明在 `focusAgent` 之前**：`createScenePhaser()` 的装配是同步的，
 * 它会立刻注册回调；而这里一旦有同步调用路径（R91 已经踩过一次 TDZ），
 * 声明在后就是 `ReferenceError`，且症状和本轮改动毫无关系、极难归因。
 */
let lastFocusSource = null

/**
 * **聚焦的唯一入口**（R4 / DESIGN §6）：选中 + 镜头跟随。
 *
 * 三个入口（场景点人 / 成员行 / 💬）都走这里，`source` **只用于埋点**——
 * 写进 `__agentWorld.lastFocusSource`，验收时据此核对"三条路真的汇到了一处"。
 * ⚠️ **任何按 `source` 分叉行为都算违规**：那样它就不是唯一入口，只是三个入口的别名。
 *
 * ## 为什么"要不要开对话面板"**不**统一（不是遗漏，是拍板过的）
 *
 * 三处的可观察行为确实不同，而且**是有意的**（`docs/PLAN-game-agent.md` (d) 节，
 * 用户 R94 明确拍板）：
 *
 *   列表 = 定位（选中 + 镜头） · 点人 = 定位 + 开面板 · 回车 = 在已选中的基础上开对话
 *
 * ⚠️ **实现时不许"顺手统一"**：三处行为不同是设计的一部分。
 * ⚠️ 尤其注意：设计文档（task-2）里「点人只聚焦、对话走 Enter」那条**被用户否掉了**——
 * 下一个读到那份文档的人很容易照着它"纠正"这里的实现，所以这句话必须留在代码里。
 *
 * 本轮（R4）只把"选中 + 镜头"这段共同部分收进来，开面板由各调用点自己决定。
 *
 * ## 为什么"已经选中同一个就不再调 selectAgent"
 *
 * 这不是优化，是**为了行为不变**：`selectAgent` 每次都会重开一段 420ms 的镜头平移
 *（`startFollowSelection`）。而场景点人的路径上，`scene-phaser.js` 的 `pointerup`
 * **已经**调过 `selectAgent` 了——这里再调一次就会把刚开始的平移重新起一遍，
 * 用户看到的是"镜头顿一下再走"。聚焦一个已经聚焦的对象本来就该是空操作。
 *
 * @param {string} agentId
 * @param {'scene'|'member'} source - 仅埋点。第三种来源（💬 按钮那条）已在 R6 随按钮一并删除，别再把它加回来
 * @returns {boolean} 是否已是聚焦态
 */
function focusAgent(agentId, source) {
  if (typeof agentId !== 'string' || agentId === '') return false
  lastFocusSource = source
  if (typeof scene2d.selectAgent !== 'function') return false
  if (scene2d.selectedAgent?.() === agentId) return true
  return scene2d.selectAgent(agentId) === true
}




// ── 视野控制（R65）────────────────────────────────────────────────────────────
//
// 缩放/适配/复位由**渲染层**提供（R65 的视口改造）。这里只做三件事：
// ① 把按钮接上去；② 每帧按 `viewState()` 刷新"能不能再放大/缩小"的禁用态与倍数显示；
// ③ 接口还没就位时**明确禁用**——静默失效最难查（按钮在、点了没反应，看起来像渲染坏了）。
const viewControls = {
  zoomIn: root.querySelector('#cmd-zoom-in'),
  zoomOut: root.querySelector('#cmd-zoom-out'),
  fit: root.querySelector('#cmd-fit'),
  reset: root.querySelector('#cmd-reset'),
  zoomLabel: root.querySelector('#view-zoom'),
}

function viewStateOf() {
  if (typeof scene2d.viewState !== 'function') return null
  try {
    return scene2d.viewState()
  } catch {
    return null
  }
}

function syncViewControls() {
  const state = viewStateOf()
  const supports = state !== null
  const { zoomIn, zoomOut, fit, reset, zoomLabel } = viewControls
  if (zoomIn !== null) zoomIn.disabled = !supports || state.canZoomIn === false
  if (zoomOut !== null) zoomOut.disabled = !supports || state.canZoomOut === false
  if (fit !== null) fit.disabled = !supports || state.fitted === true
  if (reset !== null) reset.disabled = !supports
  if (zoomLabel !== null) zoomLabel.textContent = supports ? `${state.zoom}×` : '—'
}

for (const [id, method] of [['zoomIn', 'zoomIn'], ['zoomOut', 'zoomOut'], ['fit', 'fitView'], ['reset', 'resetView']]) {
  const button = viewControls[id]
  if (button === null) continue
  button.addEventListener('click', () => {
    if (typeof scene2d[method] !== 'function') return
    scene2d[method]()
    syncViewControls()
  })
}
syncViewControls()

// ── 世界命令（暂停/继续）──────────────────────────────────────────────────────

async function sendCommand(command) {
  // `command` 可以是 kind 字符串（暂停/继续），也可以是完整对象（如 moveAgent 要带坐标）。
  const payload = typeof command === 'string' ? { kind: command } : command
  try {
    const res = await fetch(COMMAND_API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ command: payload }),
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
  snapshotApi: apiUrl('api/world'),
  eventsApi: apiUrl('api/events'),
  onSnapshot: (snap) => {
    // 快照成功拿到 → 之前那句"读不到世界"（通常是启动瞬间宿主的瞬态错误）可以收起来了。
    showHint('')
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
    diagnostics = snap.runtime.diagnostics ?? null
    // 标题跟世界名走（R74）：世界叫什么，顶栏就显示什么——除非用户自己改过。
    topbar?.setWorldName(world.name)
    // 角色的名字只从世界数据来（D37：人设是内容，代码里没有角色名）。
    dialogue.setAgents(world.agents)
    board.setPalette(meta.palette)
    // 流水线目录（id → 中文名）也由服务端下发：前端不许自己翻译内容（R46）。
    // ⚠️ 读 `snap.taskSets` 而**不是** `meta.taskSets`：`meta` 是一个显式挑字段的对象，
    // 没有的字段就是 `undefined`——第一版写成 meta.taskSets，于是每次都把目录清空成 {}，
    // 分组签一直显示英文短 id（真机上抓到的）。
    board.setTaskSets?.(snap.taskSets)
    board.update(applyTeamActivity(world), { diagnostics, scene: meta?.scene })
    legend.update({ scene: meta.scene })
    void loadWorldSession()
    void loadTeamPlan()
    globalThis.setTimeout(() => { void loadTeamPlan() }, 1500)
    render(true) // 首屏**强制**画一次：节流不该让"打开面板"这一步被跳过
  },
  onEvents: (events) => {
    // R166：角色花名册由真实 subagent 投影；Host 用 world.reset 通知“重新拉快照”。
    if (events.some((event) => event.type === 'world.reset')) {
      void connection.reload()
      return
    }
    for (const event of events) {
      if (event?.type === 'agent.intent' && event.payload && typeof event.payload.agentId === 'string') {
        heartbeatIntents.set(event.payload.agentId, event.payload)
      }
    }
    applyEvents(world, events)
    pruneMessages(world)
    // R3：侧边栏**没有自己的数据路径**了——看板那一份渲染直接挂进了它的两档。
    board.update(applyTeamActivity(world), { diagnostics, scene: meta?.scene })
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

// ── R200：点角色的 canvas 兜底 ────────────────────────────────────────────────
// Phaser 的 sprite pointerup 在嵌入/缩放组合下会漏命中（真机：dialogue 根本不打开）。
// 这里直接用相机把点击换算成世界坐标，再按精灵 bounds 命中，最后走同一条
// focusAgent/openDialogueFor；不改变拖地图/拖场景的逻辑。
const stageCanvas = document.querySelector('#town')
if (stageCanvas !== null) {
  stageCanvas.addEventListener('click', (event) => {
    const scene = globalThis.__agentWorldPhaser?.scene?.()
    const camera = scene?.cameras?.main
    if (scene === undefined || scene === null || camera === undefined || camera === null) return
    const rect = stageCanvas.getBoundingClientRect()
    // R201：这个 Phaser 版本里 camera.worldView 常为 0×0，不能拿它做逆变换。
    // 用引擎的 hitTestPointer：它走相机矩阵，且只返回真正 setInteractive 的精灵。
    const pointer = scene.input?.activePointer
    if (pointer === undefined || pointer === null) return
    pointer.x = event.clientX - rect.left
    pointer.y = event.clientY - rect.top
    const hits = typeof scene.input.hitTestPointer === 'function' ? scene.input.hitTestPointer(pointer) : []
    let hit = null
    for (const object of hits ?? []) {
      const id = object?.getData?.('actorId')
      if (typeof id === 'string') { hit = id; break }
    }
    if (hit === null) {
      // 退路：直接按精灵屏幕 bounds 判（相机 zoom/scroll 由 Phaser 的 getBounds 已折好）。
      for (const object of scene.layers?.entities?.list ?? []) {
        const id = object.getData?.('actorId')
        if (typeof id !== 'string') continue
        const b = object.getBounds?.()
        if (b && event.clientX >= rect.left && event.clientX <= rect.right && event.clientY >= rect.top && event.clientY <= rect.bottom) {
          // 没有 camera 世界坐标时，用精灵自身在画布上的渲染矩阵做屏幕命中。
          const m = object.getWorldTransformMatrix?.()
          if (m) {
            const sx = rect.left + (m.tx - object.displayOriginX) * (rect.width / (scene.scale?.width || rect.width))
            const sy = rect.top + (m.ty - object.displayOriginY) * (rect.height / (scene.scale?.height || rect.height))
            if (Math.abs(event.clientX - sx) < 40 && Math.abs(event.clientY - sy) < 60) { hit = id; break }
          }
        }
      }
    }
    if (hit !== null) {
      focusAgent(hit, 'scene')
      openDialogueFor(hit)
    }
  })
}

// ── 生命周期 ──────────────────────────────────────────────────────────────────

const onResize = () => {
  scene2d.resize()
  render(true)
}
window.addEventListener('resize', onResize)
const planTimer = globalThis.setInterval(() => { void loadTeamPlan() }, 10000)

// R3：看板从顶栏搬进侧边栏之后**没有"收起"这回事**了——它常驻在侧边栏里，
// 两档由页签切换（`setCollapsed` 在挂载模式下是空操作，这里不再调它）。

// 本地时钟的可见部分：每 250ms 重画一次，让"没事件但时间在走"看得见，
// 也让纸条与气泡在两次事件之间平滑移动。**看板不在这条路上**（它由数据事件驱动）。
const renderTimer = globalThis.setInterval(render, 250)

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
    // 超控双模式：核验「对话 ↔ 移动」切换是否真的把焦点/引擎开关一起搬了。
    mode: () => dialogue.mode(),
    setMode: (mode) => dialogue.setMode(mode),
    isOpen: () => dialogue.isOpen(),
    open: (agentId, mode) => dialogue.open(agentId, mode),
    close: () => dialogue.close(),
  }
  /**
   * 2D 渲染的核验入口（R51）：缩放倍数、图集加载状态、某个图集的调色板。
   *
   * 为什么值得挂出来：像素画的错法（缩放取小数、图集没加载、切图切错）**都不会报错**，
   * 只会"看起来怪"。有这三个读数，问题能当场定位到"是没加载、还是切错了、还是缩放不对"。
   */
  globalThis.__agentWorldScene2d = {
    // R57：渲染后端的实际读数（Pixi 合批数 / canvas2D 提交次数）+ 降级原因。
    stats: () => scene2d.stats(),
    backend: () => scene2d.backend(),
    calls: () => scene2d.calls(),
    /** 与 3D 的 `projectToScreen` 同义：给"点选行为有没有变"做对照。 */
    pickAt: (clientX, clientY) => scene2d.pick({ world, scene: meta?.scene, clientX, clientY }),
    anchorAt: (agentId) => scene2d.anchorOf({ world, scene: meta?.scene, agentId }),
    metrics: () => scene2d.metrics(meta?.scene ?? null),
    loader: () => scene2d.loader.status(),
    palette: (url) => scene2d.loader.palette(url),
    recolored: (url, color, variant = 0) => scene2d.loader.recoloredImage(url, color, variant),
    liveActors: () => scene2d.liveActors(world, meta?.scene ?? null),
    /**
     * R86：**渲染自检读数**（一帧里比对出来的一致性）。
     *
     * 返回 `{text, counts, last, world, verdict}`：
     * - `counts.frameResets` 精灵实际帧 ≠ 动画当前帧（有人重置了帧，R85 就是这类）；
     * - `counts.animFlips` 动画键 A→B→A 来回翻（互抢；单向前进不算）；
     * - **`last.nowDrift`（当前）** 此刻有几个 actor 的 `facing` 与服务端快照对不上；
     * - **`counts.facingDrift`（历史）** 跨快照代次**确认过**多少次漂移，**只增不减**。
     *
     * ⚠️ R112：`verdict` **只看 `nowDrift`**（当前状态），不看历史累计——
     * 原先只有一个累计数，于是"已经修好了"和"还坏着"在页面上长得一模一样。
     * 性能条里的 `D0` 是**当前**，历史另外标成 `D0(历史20)`。
     * **正常时 `nowDrift` 恒为 0**；不是 0 就说明此刻真的对不上。
     */
    selfCheck: () => selfCheck.report(),
    // R77：把气泡绘制也挂出来，页内就能验 9-slice 面板 / 文字 / 状态点 / 名字二选一。
    renderBubbles: (bubbles) => scene2d.renderBubbles(bubbles ?? []),
    // R65 视图控制：暴露出来**是为了能在页内直接验**（缩放/平移是交互，靠点按钮猜很难归因）。
    viewState: () => (typeof scene2d.viewState === 'function' ? scene2d.viewState() : null),
    zoomIn: () => scene2d.zoomIn?.(),
    zoomOut: () => scene2d.zoomOut?.(),
    fitView: () => scene2d.fitView?.(),
    resetView: () => scene2d.resetView?.(),
    camera: () => {
      const scene = window.__agentWorldPhaser?.scene?.()
      const cam = scene?.cameras?.main
      if (cam === undefined || cam === null) return null
      return {
        zoom: cam.zoom,
        scrollX: Math.round(cam.scrollX),
        scrollY: Math.round(cam.scrollY),
        bounds: cam._bounds ? { x: Math.round(cam._bounds.x), y: Math.round(cam._bounds.y), w: Math.round(cam._bounds.width), h: Math.round(cam._bounds.height) } : null,
      }
    },
    // P1 选中 / P2 锁定：页内直接验「点人 / 看板定位 → 高亮圈 + 镜头跟随」。
    selectAgent: (agentId) => (typeof scene2d.selectAgent === 'function' ? scene2d.selectAgent(agentId) : false),
    clearSelection: () => scene2d.clearSelection?.(),
    selectedAgent: () => (typeof scene2d.selectedAgent === 'function' ? scene2d.selectedAgent() : null),
    following: () => (typeof scene2d.following === 'function' ? scene2d.following() : null),
    movementEnabled: () => (typeof scene2d.movementEnabled === 'function' ? scene2d.movementEnabled() : null),
    manualState: () => (typeof scene2d.manualState === 'function' ? scene2d.manualState() : null),
    setMovementEnabled: (on) => (typeof scene2d.setMovementEnabled === 'function' ? scene2d.setMovementEnabled(on) : null),
  }

  /**
   * 气泡的核验入口（R39 → R76）。
   *
   * R76 起气泡是**引擎内 Phaser 对象**（不再有 DOM 层、也没有屏幕边缘夹取/遮挡那套）。
   * 这里只报**数据侧**（对话状态机给什么）；绘制在 Phaser 场景里，核对走 `__agentWorldScene2d`。
   */
  globalThis.__agentWorldBubbles = {
    list: () => {
      const list = dialogue === null ? [] : dialogue.bubblesFor(performance.now())
      return list.map((b) => {
        const agent = world?.agents.find((a) => a.id === b.agentId)
        return { agentId: b.agentId, name: agent?.name ?? null, phase: b.phase, text: b.text }
      })
    },
  }
  globalThis.__agentWorldBoard = {
    stats: () => board.stats(),
    refresh: () => board.update(applyTeamActivity(world), { diagnostics, scene: meta?.scene }),
    select: (taskId) => board.select(taskId),
    // R181：官方任务投影的入口（验收时可直接喂一份 mock，不必等真团队）。
    setTeamTasks: (tasks) => board.setTeamTasks(tasks),
    model: () => board.model(),
    layout: () => board.layout(),
    geometry: () => board.geometry(),
    /** 当前选中的任务 id（R3：`select()` 是写入口，读入口一直在 board 上没暴露）。 */
    selected: () => board.selected(),
    /**
     * 重挑依赖图几何（R99）。核验"折叠→展开之后图还有几何"时直接调它，
     * 不必依赖 rAF/定时器的时序——那条时序本身就是最容易被环境坑住的地方。
     */
    refreshGraph: () => board.refreshGraph(),
    // `clipped()` 由 board.js 自己在同一个宏任务里挂（它先于 app 的门面创建）。
    // R99：`showGraph()` 已删——两块现在**同时可见**，不存在"切到某一档"这个动作。
    // 留一个已经不存在的动作，验收脚本会以为还能用它。
    // R46：分组/状态过滤（= 界面上那两排 chip 的同一条路径，核验用）。
    setView: (next) => board.setView(next),
    // R152：`setMembersOpen` 已删——成员看板没有开合这回事了（用户拍板）。
    // 留一个已经不存在的动作，验收脚本会以为还能用它。
  }
  /**
   * 聚焦入口的核验面（R4）。
   *
   * `lastFocusSource` 是**验收的判据**：点过三个入口之后它分别是 `scene` / `member` / `talk`，
   * 说明三条路真的汇到了同一个 `focusAgent`。它**只用于埋点**——
   * 若哪天有人写了 `if (source === 'member') …`，这个字段就会成为唯一的证据。
   */
  globalThis.__agentWorld = {
    lastFocusSource: () => lastFocusSource,
    selectedAgent: () => (typeof scene2d.selectedAgent === 'function' ? scene2d.selectedAgent() : null),
    focus: (agentId, source) => focusAgent(agentId, source ?? 'debug'),
    /**
     * 三个入口各自**现在**的可观察行为（`selectedAgent / following / dialogueOpen`）。
     *
     * 存在的理由：本轮是"行为不变的重构"，而"没变"这件事必须能被**逐条读出来**，
     * 否则下一轮谁都说不清改之前是什么样。这张表就是 DESIGN §6 那张表的运行时版本。
     */
    focusMatrix: () => [
      { source: 'scene', 选中: true, 开面板: true, 说明: '场景点人：渲染层先 selectAgent，回调再开面板（(d)1）' },
      { source: 'member', 选中: true, 开面板: false, 说明: '成员行：只聚焦（(d)3）' },
      // R97：`talk`（💬）那条**已删**——按钮与回调一起清掉了，这里也就不该再有它。
      // 留着一条已不存在入口的"行为表"比没有表更坏：验收会照着它去找一个不存在的按钮。
    ],
  }
  /**
   * 图例的核验入口（R151）——位置这件事必须**量**得出来。
   *
   * 判据（与 R150 派单给 designer 的三条一致）：展开态必须**完整落在舞台内**
   *（`insideStage: true`、`overflowStage` 全 0），与视图控制簇的相交面积必须是 0，
   * 与侧边栏/对话面板的相交面积也必须是 0（对话打开时图例整枚让位）。
   * 收起态没有列表盒子（`items: null`），只量那枚胶囊。
   */
  globalThis.__agentWorldSession = () => worldSession
  globalThis.__agentWorldLegend = {
    collapsed: () => legend.isCollapsed(),
    toggle: () => legend.setCollapsed(!legend.isCollapsed()),
    setCollapsed: (next) => legend.setCollapsed(next),
    measure: () => {
      const rectOf = (el) => {
        const r = el === null || el === undefined ? null : el.getBoundingClientRect()
        return r === null ? null : { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height), right: Math.round(r.right), bottom: Math.round(r.bottom) }
      }
      const overlap = (a, b) => (a === null || b === null ? 0 : Math.max(0, Math.min(a.right, b.right) - Math.max(a.x, b.x)) * Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.y, b.y)))
      const collapsed = legend.isCollapsed()
      const legendBox = rectOf(root.querySelector('#legend'))
      const itemsBox = collapsed ? null : rectOf(root.querySelector('.legend-items'))
      const stage = rectOf(root.querySelector('#stage'))
      const cluster = rectOf(root.querySelector('#view-controls'))
      const sidebar = rectOf(root.querySelector('#sidebar'))
      const dialogueEl = root.querySelector('#dialogue')
      const dialogueBox = dialogueEl === null || dialogueEl.hidden ? null : rectOf(dialogueEl)
      const shown = collapsed ? legendBox : itemsBox
      return {
        collapsed,
        legend: legendBox,
        items: itemsBox,
        stage,
        cluster,
        itemCount: root.querySelectorAll('.legend-item').length,
        insideStage: shown === null || stage === null ? null : shown.x >= stage.x && shown.right <= stage.right && shown.y >= stage.y && shown.bottom <= stage.bottom,
        overflowStage: shown === null || stage === null ? null : { right: Math.max(0, shown.right - stage.right), bottom: Math.max(0, shown.bottom - stage.bottom) },
        overlapCluster: overlap(itemsBox, cluster),
        overlapSidebar: overlap(shown, sidebar),
        overlapDialogue: overlap(shown, dialogueBox),
      }
    },
  }
  /**
   * 侧边栏的核验入口（R2）：两档切换与行数——以及**溢出判据**（M7-9：
   * 元素的盒子必须落在「容器 ∩ 视口」里）。溢出是那种"看起来正常"的错：
   * 它不报错，只是内容被裁掉，所以必须能被量出来。
   */
  globalThis.__agentWorldSidebar = {
    stats: () => sidebar.stats(),
    /** 折叠态与开关（R99：两块同时可见，所以没有"切档"，只有"折叠/展开"）。 */
    collapsed: () => sidebar.collapsed(),
    toggle: () => sidebar.toggle(),
    setCollapsed: (next) => sidebar.setCollapsed(next),
    /** 溢出判据（M7-9）：元素盒子必须落在「最近的可滚祖先 ∩ 视口」里。 */
    overflow: (selector) => sidebar.overflow(selector),
  }
  /**
   * 连接层的核验入口（R108）。
   *
   * 为什么需要它：这一轮的两条判据**互为反证**——
   *   ① 连接正常、世界安静 → 底栏**不得**报警；
   *   ② 连接真的断了 → 警告**必须**回来。
   * 只验①（或只验②）等于没验，而这正是 M17-2 那个"空数组验过、非空没验过"的教训。
   *
   * `stop()` 走的是**真路径**：它关掉 EventSource 并把 `connected` 置 false，
   * 与网络真的掉线是同一条代码路径（不是给 UI 塞一个假的布尔值）。
   * 于是"断开"这一半可以在真机上按需复现，不必去拔网线。
   */
  globalThis.__agentWorldConnection = {
    status: () => connection.status(),
    silentForMs: () => connection.silentForMs(),
    /** 判"事件流卡住"的阈值（按心跳节奏算）——验收要能说清判据从哪来。 */
    staleAfterMs: () => connection.staleAfterMs(),
    /** 心跳节奏的来源与实测值（hint 来自服务端 `hello`，observed 是实测兜底）。 */
    heartbeat: () => connection.heartbeat(),
    /** **真的**断掉事件流（真路径，可用来验"警告必须回来"）。 */
    stop: () => connection.stop(),
    // ⚠️ 这里**故意没有 `start()`**：`connection.stop()` 是**闭锁**（`stopped = true`），
    // 之后 `start()` 直接返回 null、什么也不做。挂一个"看起来能重连、其实是空操作"的
    // 接口，正是这个项目一路在防的静默失效——断线演练之后**刷新页面**即可恢复。
  }

  /**
   * R227：**给 AI 与人的调试总入口**。
   *
   * ## 为什么需要它
   * 这个项目的门面已经有十几个（`__agentWorldPhaser` / `...Board` / `...Scene2d` …），
   * 但"用户说了一句话 → 我该看哪个门面的哪个字段"这一步，每次都靠人记。
   * 所以这里做两件事：
   * 1. `help()`：**症状 → 探针**的固定对照表（数据，不是散文）；
   * 2. `snapshot()` / `audit()` / `explain(id)`：把最常用的三条路收成一次调用。
   *
   * 判据：任何人（或 AI）拿到一句模糊反馈，能在**一次** `help()` 里定位到该跑哪条探针。
   */
  const DEBUG_HELP = [
    {
      symptom: '角色能走上墙 / 上桌子',
      probe: '__agentWorldDebug.audit().airWall',
      look: 'uncoveredCells 是 nav 与美术几何的差异量（只报不补）；slotsBlocked 必须为 0',
    },
    {
      symptom: '遮挡关系不对（谁压谁）',
      probe: '__agentWorldPhaser.occlusionAudit() + overlayAudit()',
      look: 'occlusion.anomalyCount 应为 0；overlay 三层必须 ordered:true',
    },
    {
      symptom: '某个站点 / 角色位置怪',
      probe: '__agentWorldDebug.explain("<station.id 或 agent.id>")',
      look: 'footprint 是否落在 blocked 格、base 是否等于底边、slot 是否可走',
    },
    {
      symptom: '场景比例一直跳 / 镜头不对',
      probe: '__agentWorldScene2d.camera() + viewState()',
      look: 'zoom 是否是整数档；scroll 是否稳定；resize 是否在反复触发',
    },
    {
      symptom: '世界不动 / 数据不更新',
      probe: '__agentWorldDebug.snapshot()',
      look: 'world.tick 是否推进、paused、diagnostics.errors、connection',
    },
    {
      symptom: '页面白屏 / 门面全空',
      probe: '__agentWorldDebug.snapshot().facades',
      look: '长度为 0 基本是模块图断了：跑 node scripts/sync-profile.mjs',
    },
    {
      symptom: '看板数据不对',
      probe: '__agentWorldBoard.stats()',
      look: '计数口径只有一处；与 world.tasks 对照',
    },
  ]

  const spaceOf = () => meta?.scene?.space ?? null
  const navOf = () => spaceOf()?.nav ?? world?.nav ?? null

  /** 世界坐标是否落在 blocked 格（调试用；与 sim 的判据同义）。 */
  const blockedAt = (x, z) => {
    const nav = navOf()
    if (nav === null || nav === undefined) return null
    const col = Math.round((x - nav.originX) / nav.unitsPerCell - 0.5)
    const row = Math.round((z - nav.originZ) / nav.unitsPerCell - 0.5)
    if (col < 0 || col >= nav.width || row < 0 || row >= nav.height) return true
    return nav.blocked[row * nav.width + col] === true
  }

  globalThis.__agentWorldDebug = {
    help: () => DEBUG_HELP,
    snapshot: () => ({
      build: typeof BUILD === 'string' ? BUILD : null,
      world: world === null ? null : {
        id: world.id,
        tick: world.tick,
        paused: world.paused,
        mode: world.mode,
        agents: (world.agents ?? []).map((a) => ({ id: a.id, name: a.name, state: a.state, position: a.position })),
        tasks: (world.tasks ?? []).length,
      },
      scene: meta?.scene === undefined || meta?.scene === null ? null : {
        props: (meta.scene.props ?? []).length,
        actors: (meta.scene.actors ?? []).length,
        space: spaceOf()?.audit ?? null,
      },
      runtime: diagnostics,
      connection: connection.status(),
      facades: Object.keys(globalThis).filter((key) => key.startsWith('__agentWorld')),
    }),
    audit: () => ({
      space: spaceOf()?.audit ?? null,
      airWall: globalThis.__agentWorldPhaser?.airWallAudit?.() ?? null,
      occlusion: globalThis.__agentWorldPhaser?.occlusionAudit?.() ?? null,
      overlay: globalThis.__agentWorldPhaser?.overlayAudit?.() ?? null,
    }),
    explain: (id) => {
      const space = spaceOf()
      const entity = space?.entities?.find((item) => item.id === id) ?? null
      const agent = (world?.agents ?? []).find((item) => item.id === id) ?? null
      if (entity === null && agent === null) return null
      return {
        id,
        kind: entity !== null ? 'station' : 'agent',
        entity,
        agent,
        footprintBlocked: entity === null ? null : blockedAt(entity.footprint.x + entity.footprint.w / 2, entity.footprint.z + entity.footprint.h / 2),
        slotsBlocked: entity === null ? null : entity.slots.filter((slot) => blockedAt(slot.x, slot.z) === true),
      }
    },
  }
}

// ── 键盘：Esc 退出锁定 / Enter 开始对话 ─────────────────────────────────────
//
// 焦点在输入框里时**不拦**：Enter 要能正常发送、Esc 由输入框自己处理（它会 close + 解锁）。
// 只有焦点不在文字输入上，这两个键才是"超控面板"的快捷键。
keyTarget.addEventListener('keydown', (event) => {
  const tag = String(doc.activeElement?.tagName ?? '').toUpperCase()
  if (tag === 'TEXTAREA' || tag === 'INPUT') return
  if (dialogue === null) return

  if (event.key === 'Escape') {
    event.preventDefault()
    // 退出锁定 = 解锁镜头 + 收起面板（面板是"操控这个人"的上下文，人不锁了就收起）。
    dialogue.close()
    if (typeof scene2d.clearSelection === 'function') scene2d.clearSelection()
    return
  }

  if (event.key === 'Enter') {
    const agentId = typeof scene2d.selectedAgent === 'function' ? scene2d.selectedAgent() : null
    if (agentId === null || agentId === undefined) return
    event.preventDefault()
    // 回车开始对话：面板没开就**以对话档**打开（open 默认是移动档，这里必须显式要 chat）。
    if (dialogue.isOpen() !== true) dialogue.open(agentId, 'chat')
    else dialogue.setMode('chat')
  }
})

const dispose = () => {
  try { connection.stop() } catch { /* 已经断了 */ }
  globalThis.clearInterval(renderTimer)
  globalThis.clearInterval(planTimer)
  globalThis.removeEventListener('resize', onResize)
  try { scene2d.game?.()?.destroy?.(true) } catch { /* 已经销毁 */ }
}
scene2d.resize()
void connection.reload()
connection.start()
return { dispose, setWorldSession, setTeamProjection, setSessionGraph }

}

if (typeof globalThis.document !== 'undefined' && globalThis.__AGENT_WORLD_EMBEDDED__ !== true && globalThis.document.getElementById('town') !== null) {
  const params = new URLSearchParams(globalThis.location.search)
  const standaloneSession = params.get('session')
  const boot = async () => {
    if (standaloneSession !== null && standaloneSession !== '') {
      try {
        const response = await fetch(`./api/activate`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ sessionId: standaloneSession }),
        })
        if (!response.ok) {
          const status = document.querySelector('#status')
          if (status !== null) status.textContent = `激活会话失败（HTTP ${response.status}）`
        }
      } catch (error) {
        const status = document.querySelector('#status')
        if (status !== null) status.textContent = `激活会话失败：${error instanceof Error ? error.message : String(error)}`
      }
    }
    mountAgentWorld({ root: globalThis.document, baseUrl: '.', embedded: false, ...(standaloneSession === null || standaloneSession === '' ? {} : { sessionId: standaloneSession }) })
  }
  void boot()
}

/** 一个只在本容器内查找元素的 document 视图（给 `createDialogueUi` 这类吃 `document` 的模块）。 */
function createScopedDocument(root, doc) {
  const delegate = (name) => (...args) => doc[name](...args)
  return {
    getElementById: (id) => root.querySelector(`#${id}`),
    querySelector: (selector) => root.querySelector(selector),
    querySelectorAll: (selector) => root.querySelectorAll(selector),
    createElement: delegate('createElement'),
    createElementNS: delegate('createElementNS'),
    createTextNode: delegate('createTextNode'),
    createDocumentFragment: delegate('createDocumentFragment'),
    addEventListener: (...args) => root.addEventListener(...args),
    removeEventListener: (...args) => root.removeEventListener(...args),
    get activeElement() { return doc.activeElement },
    get defaultView() { return doc.defaultView },
    get body() { return doc.body },
  }
}

// R233：`?edit=1` 才加载手改碰撞体编辑器（不影响正常页面体积）。
if (new URLSearchParams(globalThis.location?.search ?? '').has('edit')) {
  void import('./editor.js')
}
