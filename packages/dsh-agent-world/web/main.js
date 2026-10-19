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
import { createConnection } from './net/connection.js'
// R58：2D 渲染器 = **Phaser**（唯一实现）。`?renderer=canvas` 映射到 `type: Phaser.CANVAS`；
// 缺省 `Phaser.AUTO` = WebGL 优先、**canvas 自动回退**（我们自己写的那套回退已删）。
// 接口与以前逐个同名同参，所以下面一行都不用改。
import { createScenePhaser, requestedRenderer } from './scene/scene-phaser.js'
import { createTopbar } from './ui/topbar.js'
import { createLegend } from './ui/legend.js'
import { createSidebar } from './ui/sidebar.js'
import { createBoard } from './ui/board.js'
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
export function mountAgentWorld(options = {}) {
  const doc = options.document ?? globalThis.document
  const root = options.root ?? doc
  const embedded = options.embedded === true
  /** R175：会话 id，用来读只读 team plan。 */
  const sessionId = typeof options.sessionId === 'string' && options.sessionId !== '' ? options.sessionId : null
  const rawBase = typeof options.baseUrl === 'string' && options.baseUrl !== '' ? options.baseUrl : '.'
  const baseUrl = rawBase === '.' ? '.' : rawBase.replace(/\/$/, '')
  const apiUrl = (path) => `${baseUrl}/${path}`
  const assetBase = `${baseUrl}/vendor/`
  const $ = (id) => root.querySelector(`#${id}`)
  const scopedDoc = root === doc ? doc : createScopedDocument(root, doc)
  /** 键盘监听的落点：嵌入时挂在容器上，事件不会跑出主面板。 */
  const keyTarget = typeof root.addEventListener === 'function' ? root : doc

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
const $sidebarToggle = $('sidebar-toggle')
function syncSidebarToggle(collapsed) {
  if ($sidebarToggle === null) return
  const open = collapsed !== true
  $sidebarToggle.setAttribute('aria-expanded', String(open))
  $sidebarToggle.title = open ? '折叠侧边栏' : '展开侧边栏'
  $sidebarToggle.setAttribute('aria-label', $sidebarToggle.title)
  $sidebarToggle.classList.toggle('is-active', open)
}

const sidebar = createSidebar({
  root: $('sidebar'),
  onExpand: () => {
    boardRef?.refreshGraph()
  },
  // R181：单块折叠/展开也要重挑依赖图几何（折叠期间容器是 0×0，量出来的是废图）。
  onPanelExpand: () => {
    boardRef?.refreshGraph()
  },
  onCollapseChange: (collapsed) => syncSidebarToggle(collapsed),
})

$sidebarToggle?.addEventListener('click', () => sidebar.toggle())
// 初始态再同步一遍兜底：构造期那次广播已经生效，这里保证"按钮与真实状态一致"
// 这件事不依赖于广播时序。
syncSidebarToggle(sidebar.collapsed())

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
  onMemberSelect: (agentId) => void focusAgent(agentId, 'member'),
})
boardRef = board

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
  const jobs = Array.isArray(team?.jobs) ? team.jobs : []
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
    time.textContent = formatDuration(now - (typeof job.startedAt === 'number' ? job.startedAt : now))
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
  setTasksNotice('')
  // 任务交给看板：它负责节点/边/状态带/图标可用性（图与状态带是同一份数据）。
  board.setTeamTasks(tasks)
  renderTeamJobs(team)
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
    if (!composerBox.isConnected) card.append(composerBox, composerError)
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
  card.append(composerBox, composerError)

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
function renderTaskActions(team) {
  const card = root.querySelector('#sidebar-panel-graph')
  if (card === null) return
  ensureAgentComposer(card)
  const host = sidebarMounts.graphActions
  if (host === null || host === undefined) return
  if (host.querySelector('.aw-icon') !== null) return
  const create = doc.createElement('button')
  create.type = 'button'
  create.className = 'aw-icon'
  create.textContent = '＋'
  create.title = '新建任务'
  create.setAttribute('aria-label', '新建任务')
  create.addEventListener('click', () => setComposerOpen(composerBox.hidden))
  host.append(create)
}

/** Agent 面板当前只承载团队信息；团队级动作后续接这里，不重复任务操作。 */
function renderAgentActions(team) {
  void team
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

  scene2d.render({ world, scene: meta.scene, tick, messageDeliveryTicks: meta.messageDeliveryTicks })

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
function openDialogueFor(agentId) {
  if (agentId === null || agentId === undefined) return
  const sameAgentOpen = dialogue.isOpen() === true && dialogue.agentId() === agentId
  if (!sameAgentOpen) dialogue.open(agentId)
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
    board.update(world, { diagnostics, scene: meta?.scene })
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
    applyEvents(world, events)
    pruneMessages(world)
    // R3：侧边栏**没有自己的数据路径**了——看板那一份渲染直接挂进了它的两档。
    board.update(world, { diagnostics, scene: meta?.scene })
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
    refresh: () => board.update(world, { diagnostics, scene: meta?.scene }),
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
return { dispose, setWorldSession, setTeamProjection }

}

if (typeof globalThis.document !== 'undefined' && globalThis.__AGENT_WORLD_EMBEDDED__ !== true && globalThis.document.getElementById('town') !== null) {
  mountAgentWorld({ root: globalThis.document, baseUrl: '.', embedded: false })
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
    addEventListener: (...args) => root.addEventListener(...args),
    removeEventListener: (...args) => root.removeEventListener(...args),
    get activeElement() { return doc.activeElement },
    get defaultView() { return doc.defaultView },
    get body() { return doc.body },
  }
}
