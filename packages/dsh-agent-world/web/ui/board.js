/*
 * 执行看板（M7-1）—— **纯 DOM/SVG，不进 3D 渲染循环**。
 *
 * ── 三段式（照 ROADMAP §3.3 的参考图）─────────────────────────────────────────
 *
 *     ┌ 顶部：进度计数（goal 是 M7-6，本轮不做）──────────────────────┐
 *     ├ 左：成员看板（每人名下挂他的任务）┬ 右：任务依赖图（左→右）────┤
 *     └ 底部：详情（标题 · 状态 · 执行者 · **解锁了哪些任务**）────────┘
 *
 * ── 与 3D 的关系：**没有任何关系** ────────────────────────────────────────────
 *
 * 布局与数据折叠全在 `board-layout.js`（纯函数）；这个文件只把结果写成 DOM 与
 * 一条 `<path>`。所以：
 * · 它**不订阅**场景的每帧渲染（那条 60fps 的路），由数据事件驱动（`update(world)`）；
 * · `update()` 先比签名：**结构没变就不重建 DOM**，只有状态/进度变了就**就地改**几个
 *   class 与文本。这样"看板在，场景不卡"是可解释的，而不是碰巧。
 *
 * ── 配色 ────────────────────────────────────────────────────────────────────
 *
 * 这里**没有一个十六进制色值**：token 由 `board-layout.js` 解析成色值后，写成
 * 根节点上的 CSS 自定义属性（`--board-*`），CSS 只管引用。缺 token 时**不设**该属性、
 * 并挂 `board-missing` / `board-missing-tokens`：一眼看出来（沿用"品红=缺东西"的口径），
 * 而不是静默退回一个看起来"设计就这样"的灰。
 */

import { VIEW_FILTERS_ORDER, VIEW_FILTER_LABEL, agentStateLabel, agentStateTone, groupDisplayName, groupViewLabel, memberInitial, roleLabel, stallReasonLabel, taskStatusLabel } from './labels.js'
import { summarizeTaskOutput } from '../core/task-output.js'
import { resolveMemberSprite, spriteAvatarStyle } from '../core/member-avatar.js'
import {
  applyView,
  groupTasks,
  viewSignature,
} from '../core/board-layout.js'
import {
  BOARD_TOKENS,
  STATUS_TOKEN,
  TASK_STATUSES,
  boardSignature,
  buildBoardModel,
  describeTask,
  fitGraphGeometry,
  GEOMETRY_PRESETS,
  layoutDependencyGraph,
  MIN_SCALE,
  READABLE_MIN_PX,
  missingBoardTokens,
  resolveBoardColor,
  unlocksIndex,
} from '../core/board-layout.js'

/** token → CSS 自定义属性名（CSS 里只引用变量，不写色值）。 */
const CSS_VARS = {
  bg: '--board-bg',
  card: '--board-card',
  fg: '--board-fg',
  dim: '--board-dim',
  line: '--board-line',
  cardLine: '--board-card-line',
  doneLine: '--board-done-line',
  verify: '--board-verify',
  failBg: '--board-fail-bg',
  select: '--board-select',
  missing: '--board-missing',
}

function el(doc, tag, className, text) {
  const node = doc.createElement(tag)
  if (className !== undefined) node.className = className
  if (text !== undefined) node.textContent = text
  return node
}

/**
 * role → **部门色 token 名**（R106）。
 *
 * 映射由 Lead 裁定、写在 `docs/DESIGN-ui-theme.md` §十一，这里**只做查表**：
 * 按职能族归到内容库既有的 4 个 accent（不新造颜色）。
 *
 * ⚠️ 值必须是 **token 名**，不是色值：D31「配色是内容」——JS 里写字面十六进制是红线，
 *    色值只能经 `resolveBoardColor(palette, token)` 从内容库取。
 * ⚠️ 未知 role **不猜**（返回 `null`，竖条保持透明）：宁可不画，也不要给一个错色。
 */
const ROLE_ACCENT = {
  engineer: 'accent.engineering',
  ops: 'accent.infra',
  reviewer: 'accent.meeting',
  researcher: 'accent.meeting',
  lead: 'accent.commons',
  docs: 'accent.commons',
}

function svgEl(doc, tag) {
  return doc.createElementNS('http://www.w3.org/2000/svg', tag)
}

/**
 * 建一块看板。
 *
 * ## 两个挂载模式（R3 / task-6）
 *
 * - **独立模式**（`options.root`）：看板自己就是顶栏里那条摘要 + 展开浮层。R70–R90 的形态。
 * - **挂载模式**（`options.mounts`）：把**同一份**渲染产物分挂到外面给的两个容器里
 *   （侧边栏的两档视图）。此时不建摘要条、没有"收起"这回事。
 *
 * 为什么是参数而不是复制一份渲染代码：`renderMembers` / `renderGraph` 是这块面板最贵的
 * 两段逻辑（成员分组、依赖分列、几何挑档、就地更新签名）。复制一份就等于"同一份数据两套
 * 实现"，两边迟早漂移——这正是用户点名的「避免同样的功能做两份」。
 *
 * @param {object} options
 * @param {HTMLElement} [options.root] - 独立模式的容器（原 `#board`）
 * @param {{members?: HTMLElement, graph?: HTMLElement}} [options.mounts] - 挂载模式的容器
 * @param {HTMLElement} [options.styleRoot] - 把 `--board-*` 变量写到哪（挂载模式下是侧边栏）
 * @param {Record<string, string>} [options.palette] - 快照里的 token → 色值。
 * @param {(taskId: string|null) => void} [options.onSelect] - 选中变化（**M7-3 的双向高亮会挂这里**，本轮不接）。
 * @param {(agentId: string) => void} [options.onMemberSelect] - 点成员行本身 = **选中/聚焦**（对话由「点场景里的人」或「选中后回车」负责）。
 * @param {Document} [options.document]
 */
export function createBoard(options = {}) {
  const doc = options.document ?? globalThis.document
  const assetBase = typeof options.assetBase === 'string' && options.assetBase !== '' ? options.assetBase : './vendor/'
  const root = options.root ?? null
  /** 挂载模式：产物分挂到外部容器（侧边栏两档）。 */
  const mounts = options.mounts ?? null
  const mounted = mounts !== null && (mounts.members != null || mounts.graph != null)
  /**
   * 样式与类名的落点。挂载模式下**不是** `root`（它可能根本不存在），
   * 而是外部给的祖先（侧边栏）——`--board-*` 变量挂在那里，两档都能继承到。
   */
  const styleRoot = options.styleRoot ?? root ?? mounts?.members ?? mounts?.graph ?? null
  /** 没有容器就退化成空实现：看板没了不该把面板带崩（俯视图还要看模拟）。 */
  const ready = styleRoot !== null && styleRoot !== undefined
  let palette = options.palette ?? {}
  /**
   * 流水线目录：`set` id → 内容里的中文名（`snapshot.taskSets`，R46）。
   *
   * 由服务端下发而不是前端写死：流水线叫什么名字是**内容**（红线）。
   * 拿不到时分组签退回短 id（`quick-fix`），那是"暂时没有名字"，不是"猜了个名字"。
   */
  let taskSetNames = {}
  let model = null
  let layout = null
  let geometry = null
  let world = null
  /**
   * 场景计划（R157）：成员头像要用的**角色贴图**在 `scene.models` 里。
   * 由 `update(world, { scene })` 从快照带进来；事件流不带它，所以拿到之后就留着。
   */
  let scene = null
  /** 选中的东西：`{kind:'task'|'member', id}`。 */
  let selected = null
  /**
   * 产出面板是不是展开的（R45）。
   *
   * **每次换单都收回折叠态**：展开是"我要读这一篇"的动作，换一张单还沿用上一篇的展开状态，
   * 会让人以为新单也已经是展开的（而它可能只有两行）。
   */
  let outputExpanded = false
  /**
   * 视图状态（R46）：分组 + 状态过滤。**默认都是「全部」**——
   * 不隐藏任何东西是默认的安全选择（用户看得见"世界一共长什么样"），
   * 需要读得清楚时再点分组签或"未完成"。
   */
  let viewGroup = 'all'
  let viewFilter = 'all'
  /** 全部流水线的分组统计（**不带过滤**：分组签上的数量是这条流水线一共多少张）。 */
  let allGroups = []
  // R152：成员栏**不再有开合**——用户拍板「成员看板不需要收起按钮」。
  // 所以这里没有 `membersOpen` / `membersUserSet`，也没有"窄视口默认收起"那条分支：
  // 只有一种状态，永远展开。窄视口靠布局解决（≤1080 两栏改上下），不靠藏东西。
  // R65：默认**收起**。收起 = 一行摘要（标题 + 进度条 + 计数 + "正在跑什么"），
  // 展开才是完整工单列表——用户点「展开」是他的选择，但**默认状态不许占掉场景**。
  // （这条只属于独立模式/顶栏里的执行看板；侧边栏挂载模式没有这回事。）
  let collapsed = true
  /** 重画统计（诊断用：能说清"看板到底重画了几次"）。 */
  const counters = { updates: 0, structureRebuilds: 0, stateRefreshes: 0, skipped: 0 }
  let lastStructure = null
  let lastState = null
  /**
   * 调度器这一轮"为什么不派某张单"（R67 / M13-5）：`taskId → { reason, detail }`。
   *
   * ⚠️ 它**只解释"调度器现在不派"**（没人 / 没工位），是**瞬时快照**（每次调度覆盖一次）。
   * "前置失败导致永远等不到"是任务表自身的性质，走 `model` 里算出来的 `deadBlockers`——
   * 两件事分开显示，因为用户要做的事不同：一个是等，一个是这张单已经死了。
   */
  let stallById = new Map()
  /**
   * R181：官方 agent-teams 的任务投影（可选）。
   *
   * 有它时，任务图与状态带显示**真实团队任务**（id/subject/status/ownerName/revision）；
   * 没有它（headless / e2e / 没装 agent-teams 的 profile）时退回世界自己的工单，
   * 图与成员列表照常能用。两者共用同一套渲染——不做第二份"官方任务看板"。
   */
  let teamTasks = null
  /** taskId → `{ revision, ownerName, status }`：图标操作用 revision 做 CAS。 */
  const teamMeta = new Map()
  /** 上一次官方任务的指纹：main.js 每 10s 轮询一次，内容没变就不要再重画。 */
  let lastTeamKey = null
  /** 卡片上的 DOM 引用（就地更新用）：taskId → {node, ...}。 */
  const cardNodes = new Map()
  /** 状态带段：taskId → `i`（选中/悬停时高亮）。 */
  const ribbonSegs = new Map()
  /** 成员行里"状态文字"那个节点的引用：agentId → span。 */
  const memberStateNodes = new Map()
  /** 成员整行的引用（`clipped()` 要拿它比可见容器）：agentId → li。 */
  const memberRowNodes = new Map()
  /** 上一次按可用空间挑中的档位/缩放（响应式重排用，也是诊断字段）。 */
  let fitInfo = null
  let lastFitSize = null

  // ── 骨架（只建一次）────────────────────────────────────────────────────────
  let parts = null
  if (ready) {
    styleRoot.classList.add('board')
    const head = el(doc, 'header', 'board-head')
    // R70：把标题拆成"图标 + 文字"两段——紧凑行里由 CSS 只显示图标（用户要"图标化、简约"），
    // 展开时两段都在，读起来仍然是一个完整的标题。
    const title = el(doc, 'h2', 'board-title')
    const titleIcon = el(doc, 'span', 'board-title-icon', '▦')
    titleIcon.setAttribute('aria-hidden', 'true')
    title.append(titleIcon, el(doc, 'span', 'board-title-text', '执行看板'))
    const counts = el(doc, 'div', 'board-counts')
    // R65：收起时不能只是"一条空进度条 + 几个数字"——把**正在跑的单子标题**摆出来，
    // 一眼看得出这个世界此刻在干什么（用户对看板的原话就是"一整条只有进度条和数字"）。
    const active = el(doc, 'div', 'board-active')
    // 收起时的"摘要条"：一条按状态分段的进度条（DESIGN 第三节：默认收起成计数 + 进度条）。
    // 它只在**收起**时看得见——展开时上半部分已经有完整的计数与依赖图。
    const bar = el(doc, 'div', 'board-bar')
    // R70：图标化。文字搬进 `title` 与 `aria-label`——视觉上是一个箭头，读屏仍然读得懂。
    const collapse = el(doc, 'button', 'ghost board-collapse', '▾')
    collapse.type = 'button'
    collapse.title = '展开执行看板'
    collapse.setAttribute('aria-label', '展开执行看板')
    collapse.addEventListener('click', () => setCollapsed(!collapsed))
    head.append(title, bar, counts, active, collapse)
    counts.setAttribute('role', 'status')

    const missing = el(doc, 'div', 'board-missing-note')
    missing.hidden = true

    // ── 视图条（R46）：分组签 + 状态过滤，两者可叠加 ─────────────────────────
    const viewBar = el(doc, 'div', 'board-view')
    const groupChips = el(doc, 'div', 'board-view-chips')
    const filterChips = el(doc, 'div', 'board-view-chips')
    viewBar.append(groupChips, filterChips)

    const body = el(doc, 'div', 'board-body')
    const members = el(doc, 'section', 'board-members')
    const membersList = el(doc, 'ul', 'board-member-list')
    // R152：这里**不再有** `h3`「成员看板」与开合按钮。侧边栏已经在 header 上写了
    // 「团队」+ 计数；再写一层标题就是同一个意思两遍，开合按钮则是用户点名要去掉的。
    members.append(membersList)

    const graph = el(doc, 'section', 'board-graph')
    // R152：删掉 `h3`「任务依赖图」与那行「（比可见区大 297×0px，图内可滚动）」。
    // 后者是调试读数，不是给用户看的话；可滚动这件事交给画布自己（滚动条 + 点阵底）。
    const canvas = el(doc, 'div', 'board-canvas')
    /*
     * R152：画布可以**拖**（图比栏宽时，拖着看比找滚动条自然），也可以聚焦后用方向键滚。
     * 这替代了原来那行「（比可见区大 …，图内可滚动）」的说明——可滚动应该是一种手感，
     * 不是一句调试读数。
     */
    canvas.tabIndex = 0
    canvas.setAttribute('aria-label', '任务依赖图：可拖动或滚动查看')
    let pan = null
    canvas.addEventListener('pointerdown', (event) => {
      if (event.button !== 0 || event.target?.closest?.('.board-node') !== null) return
      pan = { id: event.pointerId, x: event.clientX, y: event.clientY, left: canvas.scrollLeft, top: canvas.scrollTop, moved: false }
      try {
        canvas.setPointerCapture(event.pointerId)
      } catch {
        /* 合成事件/不支持时忽略：拖动仍可用，只是不捕获指针。 */
      }
    })
    canvas.addEventListener('pointermove', (event) => {
      if (pan === null || event.pointerId !== pan.id) return
      const dx = event.clientX - pan.x
      const dy = event.clientY - pan.y
      if (!pan.moved && Math.abs(dx) <= 3 && Math.abs(dy) <= 3) return
      pan.moved = true
      canvas.scrollLeft = pan.left - dx
      canvas.scrollTop = pan.top - dy
      canvas.classList.add('is-panning')
    })
    let suppressCanvasClick = false
    const endPan = (event) => {
      if (pan === null) return
      if (pan.moved === true) suppressCanvasClick = true
      pan = null
      canvas.classList.remove('is-panning')
      try {
        canvas.releasePointerCapture(event.pointerId)
      } catch {
        /* 同上。 */
      }
    }
    canvas.addEventListener('pointerup', endPan)
    canvas.addEventListener('pointercancel', endPan)
    // R243：点图内空白 = 取消选中；拖动过画布则不触发，避免拖图顺手清掉检查器。
    canvas.addEventListener('click', (event) => {
      if (suppressCanvasClick) { suppressCanvasClick = false; return }
      if (event.target?.closest?.('.board-node') !== null) return
      select(null)
    })
    // 三层，各有各的职责（M7-9 修的就是这里）：
    //   canvas  —— **可滚动**的可见容器。**它的尺寸由 flex 决定，绝不由内容决定**。
    //              之前把 canvas 自己撑成内容宽度，于是它溢出了父容器、被父容器裁掉，
    //              而"看不出被裁"的原因正是**它自己不滚动**（overflow 在错的元素上）。
    //   fit     —— 尺寸 = 几何 × scale（缩放后的可见盒；不裁剪）。
    //   content —— 尺寸 = 几何；缩放挂在这里（transform 不影响布局，所以要 fit 来占位）。
    const fit = el(doc, 'div', 'board-fit')
    const content = el(doc, 'div', 'board-content')
    const edges = svgEl(doc, 'svg')
    edges.setAttribute('class', 'board-edges')
    const cards = el(doc, 'div', 'board-cards')
    content.append(edges, cards)
    fit.append(content)
    // 没有任务时不要留一块"看起来加载失败"的空画布——给一句能照做的空状态。
    const empty = el(doc, 'div', 'board-empty-board', '还没有任务。派一张单，这里会长出第一枚卡片。')
    empty.hidden = true
    canvas.append(fit, empty)
    graph.append(canvas)
    body.append(members, graph)

    // R181：挂载模式下这条 footer 是**单行检查器**（`.aw-inspector`），独立模式仍是多行详情。
    const detail = el(doc, 'footer', mounted === true ? 'board-detail aw-inspector' : 'board-detail')
    // R76：把「展开才看得见」的部分（视图条 + 成员/依赖图 + 详情）包进一个 `.board-panel`。
    // 这样展开浮层是**独立节点**，`#board` 本身（含 `board-head` 摘要条）永远留在顶栏 flex 流内，
    // 展开/收起不再把右侧命令按钮拽移位（此前是整块 `#board` 变 `position:absolute`）。
    const panel = el(doc, 'div', 'board-panel')
    panel.append(missing, viewBar, body, detail)
    if (mounted === true) {
      /*
       * 挂载模式（R3 / R181）：同一批节点**分挂**到侧边栏两块里，`#board` 那份摘要条不建。
       *
       *   成员档 ← `members`（成员行；任务不再重复挂在成员名下）
       *   任务档 ← `missing`（缺 token 的告警）+ `graph`（任务图/卡片）+ `detail`（单行检查器）
       *
       * R181：`viewBar`（分组/筛选 chip）**不进侧边栏**：任务真实数量有限，
       * 一行 chip 会吃掉图的高度，而筛选在"任务图"这种小规模数据上没有收益。
       * 状态带（ribbon）由外部挂载位提供（`mounts.ribbon`）。
       */
      mounts.members?.append(members)
      mounts.graph?.append(missing, graph, detail)
    } else {
      root?.append(head, panel)
    }
    parts = {
      counts, bar, active, missing, viewBar, groupChips, filterChips,
      members, membersList, body, edges, canvas, fit, content, cards, detail, collapse, empty, panel,
      // R152：计数位由侧边栏的 region header 提供（挂载模式下非空）。
      agentsMeta: mounts?.agentsMeta ?? null,
      graphMeta: mounts?.graphMeta ?? null,
      // R181：状态带由侧边栏给挂载位（独立模式没有）。
      ribbon: mounts?.ribbon ?? null,
    }
    setPalette(palette)
    // 初始状态也要**真的应用**：只改 `collapsed` 的初值、不 paint 的话，
    // 展开/收起的类名与隐藏属性都还停在"展开"上（R65 实测到：看板默认占 306px）。
    setCollapsed(collapsed)
    observeSize()
  }

  /**
   * 区域计数（R152）：写进侧边栏 header 的那个位置。
   *
   * 为什么计数不写在看板自己身上：标题属于外壳、读数属于看板——外壳给出位置，
   * 看板把「9 人 · 3 忙碌」写进去。这样标题只有一层，计数也永远不会和内容对不上
   * （它和 `renderMembers` 读的是同一份 `model`）。
   */
  function renderRegionMeta() {
    if (!ready || model === null) return
    const busy = model.members.filter((m) => m.state !== 'idle' && m.state !== 'sleeping').length
    const done = model.counts?.done ?? 0
    const total = model.counts?.total ?? model.tasks.length
    if (parts.agentsMeta !== null) parts.agentsMeta.textContent = `${model.members.length} 人 · ${busy} 忙碌`
    if (parts.graphMeta !== null) parts.graphMeta.textContent = `${total} 张 · ${done} 完成`
  }

  /** 把 token 写进 CSS 自定义属性（缺的不设，交给 `board-missing*` 看得见）。 */
  /** 更新流水线目录（随快照来）。 */
  function setTaskSets(next) {
    const map = {}
    for (const entry of Array.isArray(next) ? next : []) {
      if (entry === null || typeof entry !== 'object') continue
      if (typeof entry.id !== 'string' || entry.id === '') continue
      if (typeof entry.name === 'string' && entry.name !== '') map[entry.id] = entry.name
    }
    taskSetNames = map
  }

  function setPalette(next) {
    palette = next ?? {}
    if (!ready) return
    for (const [key, token] of Object.entries(BOARD_TOKENS)) {
      const varName = CSS_VARS[key]
      const value = resolveBoardColor(palette, token)
      if (varName === undefined) continue
      if (value === null) styleRoot.style.removeProperty(varName)
      else styleRoot.style.setProperty(varName, value)
    }
    for (const status of TASK_STATUSES) {
      const value = resolveBoardColor(palette, STATUS_TOKEN[status])
      const varName = `--board-status-${status}`
      if (value === null) styleRoot.style.removeProperty(varName)
      else styleRoot.style.setProperty(varName, value)
    }
    const missing = missingBoardTokens(palette)
    styleRoot.classList.toggle('board-missing-tokens', missing.length > 0)
    if (parts.missing !== null) {
      parts.missing.textContent =
        missing.length === 0
          ? ''
          : `缺 ${missing.length} 个看板颜色 token（${missing.slice(0, 6).join(' / ')}${missing.length > 6 ? ' …' : ''}）——缺的位置画的是哨兵色。配色是内容：补齐 src/content/packs/default.ts 的 skins 库即可。`
      parts.missing.hidden = missing.length === 0
    }
    // 调色板换了：状态色要重上一次（节点上是按 token 现算的）。
    lastState = null
    lastStructure = null
  }

  /** 状态 → 色值（每次都现算：调色板可能在 `setPalette` 里换过）。 */
  function statusColor(status) {
    return resolveBoardColor(palette, STATUS_TOKEN[status] ?? STATUS_TOKEN.pending)
  }

  function applyNodeColors(node, status) {
    // 「卡死」是**我们算出来的派生状态**，不在内容库调色板的 status token 里。
    // 硬查调色板会落到 `missing` 哨兵（品红），所以它走**设计 token**（`--st-dead`，见 tokens.css）——
    // 颜色由 CSS 定，这个文件里一个十六进制都不写。
    node.classList.toggle('is-dead', status === 'dead')
    if (status === 'dead') {
      node.style.removeProperty('--st')
      node.classList.remove('board-missing')
      return
    }
    const color = statusColor(status)
    if (color === null) {
      node.style.removeProperty('--st')
      node.classList.add('board-missing')
    } else {
      node.style.setProperty('--st', color)
      node.classList.remove('board-missing')
    }
  }

  /**
   * 把"agent 状态"写成一个实心状态块（R106）。
   *
   * 文字、`data-status`、`--st` 一次写齐——CSS 那边只认这三样，
   * 而 `.board-status-block` 是**与任务块共用**的那一套（不另写成员专用样式）。
   *
   * 色值仍走内容库：`agentStateTone(state)` 给出与任务状态同名的色调，
   * 再用 `STATUS_TOKEN` 换成内容库 token。所以**这里没有字面色值**。
   *
   * @param {HTMLElement} node - 状态块元素
   * @param {string|null|undefined} state - `AgentState`
   */
  function applyStateBlock(node, state) {
    const tone = state === null || state === undefined ? null : agentStateTone(state)
    if (tone === null) {
      node.textContent = ''
      node.hidden = true
      return
    }
    node.hidden = false
    node.textContent = agentStateLabel(state)
    node.dataset.status = tone
    const color = resolveBoardColor(palette, STATUS_TOKEN[tone] ?? STATUS_TOKEN.pending)
    // 缺 token 时**不设** `--st`：CSS 的纸色 fallback 会兜住（可读），
    // 同时 `board-missing` 那套机制照旧报缺（别静默退回一个"看起来设计就这样"的色）。
    if (color === null) node.style.removeProperty('--st')
    else node.style.setProperty('--st', color)
  }

  /**
   * 收起 / 展开。
   *
   * 收起时**整块 body 一起隐藏**（不只是里面的图与列表）——否则会留下一个空的
   * "任务依赖图"标题栏，看起来像加载失败。`.is-collapsed` 这个类由这里统一挂，
   * 高度与过渡都写在 `styles/layout.css` 里（DOM 只表达状态，外观归 CSS）。
   */
  function setCollapsed(next) {
    collapsed = next
    if (!ready) return false
    // 挂载模式没有"收起"这回事：两档是否可见由侧边栏的页签决定。
    // 这里仍然接受调用（外壳可能还调着），但**不许**去隐藏 `body/detail`——
    // 那会让侧边栏里空掉两块，而且看不出是谁干的。
    if (mounted === true) return collapsed
    styleRoot.classList.toggle('is-collapsed', collapsed)
    parts.body.hidden = collapsed
    parts.detail.hidden = collapsed
    parts.collapse.textContent = collapsed ? '▾' : '▴'
    parts.collapse.title = collapsed ? '展开执行看板' : '收起执行看板'
    parts.collapse.setAttribute('aria-label', parts.collapse.title)
    // 通知装配处："看板现在是对开的了"。它据此让开地方（见 main.js 的 onCollapsed）。
    options.onCollapsed?.(collapsed)
    return collapsed
  }

  // ── 三段：成员看板 ──────────────────────────────────────────────────────────
  function renderMembers() {
    const list = parts.membersList
    list.textContent = ''
    memberStateNodes.clear()
    memberRowNodes.clear()

    const rows = model.members.map((member) => ({ kind: 'member', member, tasks: member.tasks }))
    // 未分配的单也要有地方挂，否则"没人领的单"在左栏看不见（而它正是要处理的那种）。
    if (model.unowned.length > 0) rows.push({ kind: 'unowned', member: { id: null, name: '未分配', role: null, state: null }, tasks: model.unowned })

    // 空状态也是界面：不写的话这里就是一块空白，看起来像"成员加载失败"。
    if (rows.length === 0) {
      list.append(el(doc, 'li', 'board-empty', '还没有成员。世界启动后，这里会列出每个人。'))
      return
    }

    for (const row of rows) {
      const item = el(doc, 'li', 'board-member')
      if (row.kind === 'unowned') item.classList.add('is-unowned')
      if (selected !== null && selected.kind === 'member' && selected.id === row.member.id) item.classList.add('active')
      memberRowNodes.set(row.member.id ?? '__unowned__', item)
      /**
       * R4：把行的**可访问性/可测性**属性补回来。
       *
       * 为什么必须补（这不是"锦上添花"）：R3 把侧边栏那份 `renderAgentRow` 删掉、改用这里的
       * `renderMembers` 之后，行上丢了 `data-agent-id` / `role` / `tabindex` / `aria-label`。后果三条：
       *   ① 键盘 Tab 走不到行上 —— 只能鼠标点，键盘用户用不了；
       *   ② 屏幕阅读器读不出"这是一个人、他叫什么、在干什么"；
       *   ③ **自动化验收静默失效** —— `li[data-agent-id="…"]` 选不中，于是"点成员行没生效"
       *      这种误判会反着报（R93 验收真的被绊住过一次）。
       * 第 ③ 条最危险：判据自己坏了，人却以为是被测的东西坏了。
       *
       * 「未分配」那一行 `id === null`（它没有场景实体，点了也没处聚焦），所以**不给**按钮语义，
       * 只标 `aria-disabled`——这是唯一允许分叉的条件，判据是 `id === null`。
       */
      const memberName = row.member.name ?? row.member.id ?? '未分配'
      if (row.member.id !== null) {
        item.dataset.agentId = row.member.id
        item.setAttribute('role', 'button')
        item.tabIndex = 0
      } else if (model.unowned.length > 0) {
        // R181：「未分配」这一行现在是**指派入口**（点它选中第一张未指派任务），
        // 所以它也是可点的；只有真的没有未指派任务时才降级成 aria-disabled。
        item.setAttribute('role', 'button')
        item.tabIndex = 0
      } else {
        item.setAttribute('aria-disabled', 'true')
      }
      /**
       * R106/R152：两个**纯展示**钩子，让 CSS 能上色（`board.js` 仍然一个色值都不写）。
       *
       * 1. `data-state` —— 成员卡自己的状态块按它取色调（走 `agentStateTone()`，
       *    与任务块同一套：working→in_progress / walking,talking→ready / blocked→blocked /
       *    celebrating→done / idle,sleeping→pending）。
       * 2. `--rail` —— 成员所属那一族的颜色。**颜色只从内容库取**（`palette[token]`）；
       *    未知 role **不设**（CSS 的 `var(--rail, var(--edge))` 兜住 → 中性色，不猜色）。
       *
       * R152：它不再画成左边一条 3px 竖条，而是**头像块**的底色——同一个信息用更小的
       * 面积说清楚，也避开"卡片左侧彩色竖条"这个到处都是的默认写法。
       */
      if (row.member.state !== null && row.member.state !== undefined) item.dataset.state = row.member.state
      const railColor = ROLE_ACCENT[row.member.role] === undefined ? null : resolveBoardColor(palette, ROLE_ACCENT[row.member.role])
      if (railColor !== null) item.style.setProperty('--rail', railColor)
      /*
       * R157：头像优先用**角色贴图**（scene.models 的 idle.down 首帧）。
       * 找不到（程序化模型 / 场景还没到 / 未分配那一行）才退回 R152 的字母头像——
       * 这样"贴图没加载出来"不会变成一块空白。
       */
      const sprite = row.member.id === null ? null : resolveMemberSprite(scene, row.member.id, assetBase)
      const avatar = el(doc, 'span', sprite === null ? 'board-member-avatar' : 'board-member-avatar is-sprite', sprite === null ? memberInitial(memberName) : '')
      avatar.setAttribute('aria-hidden', 'true')
      if (sprite !== null) {
        const style = spriteAvatarStyle(sprite)
        avatar.style.backgroundImage = style.backgroundImage
        avatar.style.backgroundSize = style.backgroundSize
        avatar.style.backgroundPosition = style.backgroundPosition
        // 资源 404 / 加载失败时退回字母头像，绝不把成员卡留成空白。
        const probe = globalThis.Image === undefined ? null : new globalThis.Image()
        if (probe !== null) {
          probe.addEventListener('error', () => {
            avatar.classList.remove('is-sprite')
            avatar.style.backgroundImage = ''
            avatar.textContent = memberInitial(memberName)
          })
          probe.src = style.backgroundImage.slice(5, -2)
        }
      }
      const head = el(doc, 'div', 'board-member-head')
      const nameNode = el(doc, 'b', 'board-member-name', memberName)
      nameNode.title = memberName
      head.append(nameNode)
      // R3：角色/状态**翻成中文**。看板原先直接印 `lead` / `idle`（原始状态码），
      // 而 R2 的侧边栏印的是「负责人 · 待命」。共用一份渲染之后只能有一份措辞——
      // 选中文：状态码是给程序看的，界面上印 `idle` 等于没给用户任何信息。
      const roleText = roleLabel(row.member.role)
      if (roleText !== '') head.append(el(doc, 'span', 'board-member-role', roleText))
      // 状态是会变的那一半：留下来给 `refreshState()` 就地改文字，不必重建整块列表。
      //
      // R106：它现在是**实心状态块**（与任务块共用 `.board-status-block`），
      // 不再是"灰色小字"——灰色小字既不表达状态、又在纸面上很弱。
      // 色值与状态一起由下面的 `applyStateBlock()` 写（结构没变时由 `refreshState()` 续上）。
      const stateSpan = el(doc, 'span', 'board-status-block board-member-state')
      applyStateBlock(stateSpan, row.member.state)
      head.append(stateSpan)
      memberStateNodes.set(row.member.id ?? '__unowned__', stateSpan)
      // R181：「未分配」行用一枚计数角标说明"还有几张没人领"，替代原来那一排 chip。
      if (row.member.id === null) head.append(el(doc, 'b', 'aw-badge', String(row.tasks.length)))
      const memberTasks = (row.tasks ?? [])
        .map((id) => model.tasks.find((task) => task.id === id))
        .filter((task) => task !== undefined)
      if (memberTasks.length > 0) {
        const doneCount = memberTasks.filter((task) => task.status === 'completed' || task.status === 'done').length
        const load = el(doc, 'div', 'board-member-load')
        const track = el(doc, 'i', 'board-member-load-track')
        const fill = el(doc, 'b', 'board-member-load-fill')
        fill.style.width = `${Math.round((doneCount / memberTasks.length) * 100)}%`
        track.append(fill)
        load.append(track, el(doc, 'span', undefined, `${doneCount}/${memberTasks.length} 完成`))
        head.append(load)
        const taskBox = el(doc, 'div', 'board-member-tasks')
        for (const task of memberTasks.slice(0, 4)) {
          const line = el(doc, 'div', 'board-member-task')
          const dot = el(doc, 'i', 'board-dot board-task-dot')
          applyNodeColors(dot, task.displayStatus ?? task.status)
          line.append(dot, el(doc, 'span', undefined, `${task.id} ${task.title}`))
          line.title = `${task.id} · ${task.title} · ${taskStatusLabel(task.displayStatus ?? task.status)}`
          line.tabIndex = 0
          line.setAttribute('role', 'button')
          line.setAttribute('aria-label', `选中 ${task.id} ${task.title}`)
          const activateTask = () => select({ kind: 'task', id: task.id })
          line.addEventListener('click', (event) => { event.stopPropagation(); activateTask() })
          line.addEventListener('keydown', (event) => {
            if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); activateTask() }
          })
          taskBox.append(line)
        }
        head.append(taskBox)
      }
      // `aria-label` 要在名字/角色/状态都齐了之后拼：只报名字的话，读屏用户听不出
      // "这个人在干什么"，而那恰恰是这块列表的全部信息量。
      if (row.member.id !== null) {
        const parts = [memberName]
        if (roleText !== '') parts.push(roleText)
        const stateText = agentStateLabel(row.member.state)
        if (stateText !== '') parts.push(stateText)
        if (Array.isArray(row.tasks) && row.tasks.length > 0) parts.push(`${row.tasks.length} 张任务`)
        item.setAttribute('aria-label', parts.join(' · '))
      } else if (model.unowned.length > 0) {
        item.setAttribute('aria-label', `未分配 · ${model.unowned.length} 张任务`)
      }
      // R97：**💬 按钮已删**（用户拍板：它与「点人 + 回车」重复）。
      // 对话入口现在是两条：点场景里的人（定位 + 开面板）、选中后按回车（开对话档）。
      // 别再把它加回来——同一个动作有三条路径正是用户要收掉的东西。
      // 行既是"可点的"就该是"可敲的"：给了 `role="button"` + `tabindex` 却不响应
      // 回车/空格，等于对键盘用户撒谎（他 Tab 上来、按下去，什么也不发生）。
      const activate = () => {
        if (row.member.id === null) {
          /*
           * R181：未分配行不是一个人。点它的语义是"开始指派"——选中第一张没人领的任务，
           * 于是任务检查器出现、每个人的行尾出现 → 指派入口。任务本身只在图里出现一次。
           */
          if (model.unowned.length > 0) select({ kind: 'task', id: model.unowned[0] })
          return
        }
        select({ kind: 'member', id: row.member.id })
        // R3：点成员行 → **也**通知外面（侧边栏里点谁就该聚焦谁）。
        // 这条分工是**用户拍板过的**（`docs/PLAN-game-agent.md` (d) 节）：
        // 列表=定位，点人=定位+开面板，回车=在已选中基础上开对话。别"顺手统一"。
        options.onMemberSelect?.(row.member.id)
      }
      // R152：整行（含头像）都可点——头像不是装饰，它和名字是同一个目标。
      item.addEventListener('click', activate)
      if (item.getAttribute('role') === 'button') {
        // ⚠️ 监听挂在 `item` 上、不是 `head` 上：`tabindex` 在 `item`，
        // 所以键盘焦点落在 `item`——挂错地方的话 Tab 过来按回车什么也不会发生，
        // 而"属性都在、行为没有"是最难看出来的一种 a11y 假实现。
        item.addEventListener('keydown', (event) => {
          // 空格键在按钮语义里也算"按下"（原生 button 就是这样）。
          if (event.key !== 'Enter' && event.key !== ' ') return
          event.preventDefault()
          // ⚠️ 必须截断冒泡：`main.js` 有个文档级 keydown 把 **Enter** 当"开始对话"，
          // 而它的守卫只排 `INPUT/TEXTAREA`——焦点在行上时照样会触发。
          // 不拦的话"在行上按回车"会**既是选中又开面板**，等于偷偷改了行为
          // （本轮是行为不变的重构，一格都不许变）。
          event.stopPropagation()
          activate()
        })
      }
      /*
       * R181：成员行右端只在**选中一张任务**时出现「→ 指派」。
       *
       * 为什么不是常驻：一列 5~10 行都挂一个箭头会让列表变成按钮墙；
       * 而"指派"需要先有指派对象（选中的任务），没有对象时它没有意义。
       * 真值来自官方 projection（`teamMeta`）——世界自己的模拟工单不归团队管，
       * 不给它们造一个假的指派入口。
       */
      const actions = el(doc, 'div', 'aw-member-actions')
      const pickedTaskId = selected !== null && selected.kind === 'task' ? selected.id : null
      if (pickedTaskId !== null && teamMeta.has(pickedTaskId) && row.member.id !== null) {
        const assign = el(doc, 'button', 'aw-icon', '→')
        assign.type = 'button'
        assign.title = `把 ${pickedTaskId} 指派给 ${memberName}`
        assign.setAttribute('aria-label', assign.title)
        assign.addEventListener('click', (event) => {
          event.stopPropagation()
          options.onAssign?.(pickedTaskId, { id: row.member.id, name: memberName })
        })
        actions.append(assign)
      } else if (row.member.id !== null && model.unowned.length > 0) {
        // R248：没有选中任务时也给一个常驻入口，指派第一张未分配任务。
        const taskId = model.unowned[0]
        const assign = el(doc, 'button', 'aw-icon', '⇥')
        assign.type = 'button'
        assign.title = `把 ${taskId} 指派给 ${memberName}`
        assign.setAttribute('aria-label', assign.title)
        assign.addEventListener('click', (event) => {
          event.stopPropagation()
          options.onAssign?.(taskId, { id: row.member.id, name: memberName })
        })
        actions.append(assign)
      }
      item.append(avatar, head, actions)
      list.append(item)
    }
  }

  /**
   * R181：任务面板标题下的**状态带**（`.aw-ribbon`，A 的设计稿的签名元素）。
   *
   * 每张任务一段、按依赖深度排（布局列 → 行），底色 = 该任务的状态色。
   * 它是"这班还剩多少"的一句话，同时是选中态的双向指示器：
   *   点段 → 选中对应卡片；选中卡片 → 对应段描边。
   * `aria-hidden`：键盘用户走卡片/检查器，不靠一条 6px 的色带（不做假 a11y）。
   */
  function renderRibbon() {
    const host = parts.ribbon
    if (host === null || host === undefined) return
    ribbonSegs.clear()
    host.textContent = ''
    const tasks = []
    for (const node of layout?.nodes ?? []) {
      const task = model?.byId.get(node.id)
      if (task !== undefined) tasks.push(task)
    }
    // 布局里没有的（理论上不会）也补上，保证"段数 == 任务数"这条验收判据成立。
    for (const task of model?.tasks ?? []) if (!tasks.includes(task)) tasks.push(task)
    host.hidden = tasks.length === 0
    for (const task of tasks) {
      const segment = el(doc, 'i', 'aw-ribbon-seg')
      segment.dataset.task = task.id
      segment.dataset.status = task.displayStatus ?? task.status
      const active = selected !== null && selected.kind === 'task' && selected.id === task.id
      if (active) segment.classList.add('is-active')
      segment.title = `${task.id} · ${task.title} · ${taskStatusLabel(task.displayStatus ?? task.status)}`
      segment.addEventListener('click', () => select({ kind: 'task', id: task.id }))
      // 悬停段 ↔ 高亮卡片（双向指示器的另一半）；不改变选中态。
      segment.addEventListener('pointerenter', () => cardNodes.get(task.id)?.card.classList.add('is-hover'))
      segment.addEventListener('pointerleave', () => cardNodes.get(task.id)?.card.classList.remove('is-hover'))
      host.append(segment)
      ribbonSegs.set(task.id, segment)
    }
  }

  // ── 三段：依赖图 ────────────────────────────────────────────────────────────

  /**
   * 可见容器的内容盒尺寸（CSS px）。
   *
   * **量的是容器、不是内容**：容器尺寸由 flex 与视口决定，所以"按它来挑档位"是稳定的；
   * 早先那版把容器的 width/height 设成内容尺寸，等于自己把容器撑爆、
   * 再被父容器裁掉——节点被切一半而页面看起来"正常"。
   */
  function measureCanvas() {
    return {
      width: Math.max(0, parts.canvas.clientWidth),
      height: Math.max(0, parts.canvas.clientHeight),
    }
  }

  /** 建一枚图标按钮（32×32 基座；图节点上由 CSS 收到 24×22）。 */
  function actionIcon(glyph, label, onClick) {
    const button = el(doc, 'button', 'aw-icon', glyph)
    button.type = 'button'
    button.title = label
    button.setAttribute('aria-label', label)
    button.addEventListener('click', (event) => {
      event.stopPropagation()
      onClick()
    })
    return button
  }

  /** 图标点击 → 业务回调。**这里不发 HTTP**：写入团队是 main.js 的事。 */
  function emitTaskAction(taskId, action) {
    const meta = teamMeta.get(taskId)
    if (meta === undefined) return
    options.onTaskAction?.({ taskId, action, revision: meta.revision })
  }

  /** 方向键在卡片间移动焦点（DOM 顺序 = 布局列 → 行）。 */
  function focusSiblingCard(card, delta) {
    const list = [...parts.cards.children]
    const index = list.indexOf(card)
    if (index < 0) return
    const next = list[Math.min(list.length - 1, Math.max(0, index + delta))]
    if (next !== undefined && typeof next.focus === 'function') next.focus()
  }

  /**
   * 官方 agent-teams 状态 → 看板六态。
   * `deleted` / `cancelled` 返回 null：它们不该出现在图上（不是"待办"，是历史）。
   */
  function boardStatusOfTeamTask(task) {
    const status = typeof task?.status === 'string' ? task.status : ''
    if (status === 'completed' || status === 'done') return 'done'
    if (status === 'failed') return 'failed'
    if (status === 'in_progress' || status === 'active') return 'in_progress'
    if (status === 'blocked') return 'blocked'
    if (status === 'deleted' || status === 'cancelled') return null
    return task?.ready === true ? 'ready' : 'pending'
  }

  /**
   * 把官方 projection 的任务折成看板认识的形状（只映射字段，不改语义）。
   *
   * 依赖仍来自 `blockedBy`；官方没下发就当作无依赖——图退化成单列，
   * 这是设计稿 §7 明确允许的形态（"有任务但无依赖时不画空图"）。
   */
  function normalizeTeamTasks(tasks) {
    const list = Array.isArray(tasks) ? tasks : []
    const known = new Set(list.map((t) => t?.id).filter((id) => typeof id === 'string' && id !== ''))
    const out = []
    teamMeta.clear()
    for (const raw of list) {
      if (raw === null || typeof raw !== 'object') continue
      const id = typeof raw.id === 'string' ? raw.id : ''
      if (id === '') continue
      const status = boardStatusOfTeamTask(raw)
      if (status === null) continue
      const deps = Array.isArray(raw.blockedBy)
        ? raw.blockedBy
        : Array.isArray(raw.dependencies) ? raw.dependencies : []
      out.push({
        id,
        key: id,
        title: typeof raw.subject === 'string' && raw.subject !== '' ? raw.subject : id,
        ...(typeof raw.description === 'string' && raw.description.trim() !== '' ? { description: raw.description.trim() } : {}),
        status,
        owner: null,
        blockedBy: deps.filter((d) => typeof d === 'string' && known.has(d) && d !== id),
        ...(Number.isFinite(raw.ordinal) ? { ordinal: raw.ordinal } : {}),
        requires: [],
        progress: status === 'done' ? 1 : 0,
      })
      teamMeta.set(id, {
        revision: Number.isFinite(raw.revision) ? raw.revision : undefined,
        ownerName: typeof raw.ownerName === 'string' ? raw.ownerName : '',
        status,
      })
    }
    return out
  }

  function renderGraph() {
    const { edges: edgeLayer, cards, canvas, fit: fitBox, content } = parts
    const available = measureCanvas()
    // 0×0 = 这一档被 `hidden` 藏着（侧边栏停在 Agent 档）。这时**不画**：
    // 按 0 宽挑出来的几何必然缩到 0.4 下限、节点全挤成一列，切过来看到的就是一张废图。
    // 等它可见时由 `refreshGraph()` 重画（页签切换会调；ResizeObserver 也会补一脚）。
    if (available.width < 1 || available.height < 1) return false
    // 按**可用空间**挑档位（四档几何，最后手段才是缩放）。纯函数，单测里算过。
    //
    // R3：方向交给 `'auto'` —— 侧边栏是"窄而高"（~290×600），横向排布在那里只能缩到 0.65，
    // 标题变 8px（看得见、读不了，`clipped()` 还报不出来）。竖向通常赢，但某条流水线并行
    // 很多时横向可能更省，所以让算术决定，而不是我们预先猜一个方向。
    // R205：任务卡片要承载状态/依赖/描述，不能为了塞下而退到 tight（38px 装不下）。
    // 允许图比画布大，画布自己滚；可读性优先。
    const richPresets = [
      { ...GEOMETRY_PRESETS[0], nodeW: 244, cellW: 286, nodeH: 104, cellH: 126 },
      { ...GEOMETRY_PRESETS[1], nodeW: 232, cellW: 272, nodeH: 96, cellH: 118 },
    ]
    const fitted = fitGraphGeometry(layout, available, richPresets, 'auto')
    geometry = fitted
    /*
     * 溢出量仍然算——它是 `stats().overflow` 里的**诊断读数**（验收/排查用），
     * 但 R152 起**不再铺成一行文字**。用户原话：去掉「（比可见区大 297×0px，图内可滚动）」
     * 这种描述。可滚动是画布自己的事（滚动条 + 点阵底），不该由一行调试说明来交代。
     */
    const overflow = {
      x: Math.round(fitted.width * fitted.scale - available.width),
      y: Math.round(fitted.height * fitted.scale - available.height),
    }
    fitInfo = {
      preset: fitted.preset,
      scale: fitted.scale,
      orientation: fitted.orientation ?? 'horizontal',
      available,
      content: { width: fitted.width, height: fitted.height },
      overflow,
      overflowing: overflow.x > 4 || overflow.y > 4,
    }
    lastFitSize = available
    // 空图也要有话说（不是"图画不出来"）：派第一张单之后这里会长出卡片。
    if (parts.empty !== null) parts.empty.hidden = layout.nodes.length > 0

    cards.textContent = ''
    cardNodes.clear()
    edgeLayer.textContent = ''
    /*
     * R152：方向提示从**标题里的一行字**改成**线上的箭头**。
     * 「左 → 右：前置解锁后续」占了图头 38px（窄栏里折成两行），而方向本来就是图的内在属性。
     * 两个 marker（普通/前置已完成）用 token 上色，和线是同一套颜色。
     */
    const defs = svgEl(doc, 'defs')
    for (const [id, cls] of [['board-arrow', 'board-arrow'], ['board-arrow-done', 'board-arrow done']]) {
      const marker = svgEl(doc, 'marker')
      marker.setAttribute('id', id)
      marker.setAttribute('viewBox', '0 0 6 6')
      marker.setAttribute('refX', '5.4')
      marker.setAttribute('refY', '3')
      marker.setAttribute('markerWidth', '6')
      marker.setAttribute('markerHeight', '6')
      marker.setAttribute('markerUnits', 'strokeWidth')
      marker.setAttribute('orient', 'auto')
      const head = svgEl(doc, 'path')
      head.setAttribute('d', 'M 0 0 L 6 3 L 0 6 Z')
      head.setAttribute('class', cls)
      marker.append(head)
      defs.append(marker)
    }
    edgeLayer.append(defs)
    edgeLayer.setAttribute('width', String(fitted.width))
    edgeLayer.setAttribute('height', String(fitted.height))
    edgeLayer.setAttribute('viewBox', `0 0 ${fitted.width} ${fitted.height}`)
    // 容器**不被内容撑开**（它自己滚动或放着不动）；被撑开的是内层。
    canvas.style.width = ''
    canvas.style.height = ''
    fitBox.style.width = `${Math.round(fitted.width * fitted.scale)}px`
    fitBox.style.height = `${Math.round(fitted.height * fitted.scale)}px`
    content.style.width = `${fitted.width}px`
    content.style.height = `${fitted.height}px`
    content.style.transform = fitted.scale === 1 ? '' : `scale(${fitted.scale})`
    cards.style.width = `${fitted.width}px`
    cards.style.height = `${fitted.height}px`

    const statusOf = new Map(model.tasks.map((t) => [t.id, t.status]))
    for (const edge of fitted.edges) {
      const path = svgEl(doc, 'path')
      path.setAttribute('d', edge.path)
      path.setAttribute('fill', 'none')
      // 前置完成的边用"深绿实线"，其余用淡色（ROADMAP §3.5 的边框语义）。
      // 颜色仍然是 token：class 决定用哪个变量，色值在 CSS 里引用 `--board-*`。
      const done = statusOf.get(edge.from) === 'done'
      path.setAttribute('class', done ? 'board-edge done' : 'board-edge')
      path.setAttribute('marker-end', done ? 'url(#board-arrow-done)' : 'url(#board-arrow)')
      edgeLayer.append(path)
    }

    for (const node of layout.nodes) {
      const task = model.byId.get(node.id)
      const pos = fitted.nodes[node.id]
      if (task === undefined || pos === undefined) continue
      /*
       * R181：节点从 `<button>` 改成 `div[role=button]`。
       *
       * 原因是硬约束：卡片里要放「✓ 完成 / ↺ 重开」两个真按钮，而 HTML 不允许
       * `<button>` 里再嵌套按钮（浏览器会把内层按钮踢出去，点击行为也无法预测）。
       * 键盘语义由 role + tabIndex + Enter/Space 补齐（与成员行同一套做法）。
       */
      const card = el(doc, 'div', 'board-node')
      card.setAttribute('role', 'button')
      card.tabIndex = 0
      card.dataset.task = task.id
      card.dataset.status = task.displayStatus ?? task.status
      card.style.left = `${pos.x}px`
      card.style.top = `${pos.y}px`
      card.style.width = `${pos.w}px`
      card.style.height = `${pos.h}px`
      card.dataset.task = task.id
      // R152：卡片按**档位**换内容密度。tight 档只有 116×38（还得缩到 0.8 → 屏幕上 93×30），
      // 原来那三行（编号/执行者 + 标题 + 进度条）在 30px 里放不下，被 `overflow: hidden`
      // 切掉了 6px——真机实测 `scrollHeight 36 > clientHeight 30`。现在 tight 只显示
      // 「状态点 + 编号 + 标题」，进度条与执行者让位；舒适档才三样都显示。
      card.dataset.fit = fitted.preset
      card.title = `${task.id} · ${task.title} · ${taskStatusLabel(task.displayStatus ?? task.status)}`
      // 卡片内容由三行碎片组成，读屏拼起来是「task-1小青定位问题边界」；用 aria-label 给整句。
      card.setAttribute('aria-label', card.title)
      const top = el(doc, 'div', 'board-node-top')
      // 状态色不再用 3px 左边条（那是"卡片左侧彩条"这个到处都是的默认写法），
      // 改成编号前的一枚 6px 状态点：面积更小，信息相同。
      const dot = el(doc, 'i', 'board-dot board-node-dot')
      applyNodeColors(dot, task.displayStatus ?? task.status)
      top.append(dot, el(doc, 'span', 'board-node-id', task.id))
      top.append(el(doc, 'span', 'board-node-owner dim', `◉ ${task.ownerName ?? '未分配'}`))
      if (fitted.preset !== 'tight') top.append(el(doc, 'span', 'board-node-status', `◷ ${taskStatusLabel(task.displayStatus ?? task.status)}`))
      if ((task.blockedBy?.length ?? 0) > 0) top.append(el(doc, 'span', 'board-node-status', `⇠ ${task.blockedBy.length}`))
      const ownerMember = model.members.find((member) => member.name === task.ownerName)
      const ownerRole = ownerMember === undefined ? '' : roleLabel(ownerMember.role)
      if (ownerRole !== '') top.append(el(doc, 'span', 'board-node-role', ownerRole))
      const title = el(doc, 'div', 'board-node-title', task.title)
      title.title = task.title
      const bar = el(doc, 'div', 'board-node-progress')
      const fill = el(doc, 'i', 'board-node-progress-fill')
      bar.append(fill)
      const desc = task.description !== undefined && fitted.preset !== 'tight'
        ? el(doc, 'div', 'board-node-desc', task.description)
        : null
      if (desc !== null) desc.title = task.description
      card.append(top, title, ...(desc === null ? [] : [desc]), bar)
      if (task.requires.includes('review')) card.classList.add('needs-review')
      /*
       * R181：操作只走图标（32×32 的样式基座，节点上收到 24×22，因为卡片只有 44–58 高）。
       * 只有**官方团队任务**才有这两个动作——模拟工单的完成/重开由世界调度器负责，
       * 从面板直接改会把"面板"变成第二个世界写入方。
       */
      const actionBox = el(doc, 'div', 'aw-node-actions')
      const entry = { card, fill, complete: null, reopen: null }
      if (teamMeta.has(task.id)) {
        const complete = actionIcon('✓', `把 ${task.id} 标记完成`, () => emitTaskAction(task.id, 'complete'))
        const reopen = actionIcon('↺', `重开 ${task.id}`, () => emitTaskAction(task.id, 'reopen'))
        complete.hidden = true
        reopen.hidden = true
        entry.complete = complete
        entry.reopen = reopen
        actionBox.append(complete, reopen)
      }
      if (entry.complete !== null || entry.reopen !== null) card.append(actionBox)
      const activate = () => select({ kind: 'task', id: task.id })
      card.addEventListener('click', (event) => {
        // 图标按钮自己 stopPropagation；这里再兜一层，避免点到动作区域时重复选中。
        if (event.target?.closest?.('.aw-node-actions') !== null) return
        activate()
      })
      card.addEventListener('keydown', (event) => {
        if (event.key === 'Escape' && selected !== null) {
          event.preventDefault()
          event.stopPropagation()
          select(null)
          card.focus()
          return
        }
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault()
          event.stopPropagation()
          activate()
          return
        }
        // 方向键在卡片间移动焦点（DOM 顺序 = 布局列 → 行），不改变选中。
        if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp' && event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
        event.preventDefault()
        event.stopPropagation()
        focusSiblingCard(card, event.key === 'ArrowDown' || event.key === 'ArrowRight' ? 1 : -1)
      })
      cards.append(card)
      cardNodes.set(task.id, entry)
    }
    return true
  }

  /**
   * 重挑几何重画依赖图（R3）。
   *
   * 为什么需要它：任务图住在侧边栏的第二档，而**藏在 `hidden` 里的容器量出来是 0×0**。
   * 世界数据变化时那一档通常是隐藏的，`renderGraph()` 会（正确地）跳过；
   * 等用户切过来，几何还是上一档的，或者根本没画过。所以切档之后必须显式补一次。
   *
   * 判据：调用后 `stats().nodes/edges` 与 `stats().preset` 都是当前这一档的真实值。
   */
  function refreshGraph() {
    if (!ready || model === null) return false
    return renderGraph()
  }

  /** 只有状态/进度/选中变了：就地改，不重建 DOM。 */
  function refreshState() {
    // 左栏成员行上的状态块也要跟着走（成员**结构**没变时不重建列表）。
    // ⚠️ 文字、`data-status`、`--st` **三样一起**更新：只改文字的话，人从 idle 变成 working
    // 时字变了而块色没变——那种"半更新"比完全不更新更难发现（颜色看着还挺合理）。
    for (const member of model.members) {
      const node = memberStateNodes.get(member.id)
      if (node !== undefined) applyStateBlock(node, member.state)
    }
    for (const task of model.tasks) {
      const entry = cardNodes.get(task.id)
      if (entry !== undefined) {
        const { card, fill, complete, reopen } = entry
        card.dataset.status = task.displayStatus ?? task.status
        applyNodeColors(card, task.displayStatus ?? task.status)
        card.classList.toggle('is-done', task.status === 'done')
        card.classList.toggle('is-failed', task.status === 'failed')
        card.classList.toggle('is-selected', selected !== null && selected.kind === 'task' && selected.id === task.id)
        fill.style.width = `${Math.round(Math.min(1, Math.max(0, task.progress)) * 100)}%`
        card.title = `${task.id} · ${task.title} · ${taskStatusLabel(task.displayStatus ?? task.status)}`
        card.setAttribute('aria-label', card.title)
        // R181：图标动作的可用性跟着状态走（完成的只剩「重开」，进行中的只剩「完成」）。
        const meta = teamMeta.get(task.id)
        if (complete !== null) complete.hidden = meta === undefined || meta.status === 'done' || meta.status === 'failed'
        if (reopen !== null) reopen.hidden = meta === undefined || meta.status !== 'done'
      }
    }
    // 状态带：选中/状态都跟着刷新（它和卡片是同一份数据的两面）。
    for (const [taskId, segment] of ribbonSegs) {
      const task = model.byId.get(taskId)
      if (task === undefined) continue
      segment.dataset.status = task.displayStatus ?? task.status
      segment.classList.toggle('is-active', selected !== null && selected.kind === 'task' && selected.id === taskId)
    }
    // 成员行上的「→ 指派」只在选中任务时存在，所以选中变化要重画成员列表（select() 会做）。
  }

  // ── 三段：顶部计数 + 摘要进度条 + 底部详情 ─────────────────────────────────
  function renderCounts() {
    parts.counts.textContent = ''
    // 正在跑的单子：最多两条 + "还有 N 条"
    if (parts.active !== undefined && parts.active !== null) {
      parts.active.textContent = ''
      // R181：用**当前图的数据源**（官方任务 / 世界工单），不是永远读世界。
      const running = (model?.tasks ?? []).filter((t) => t.status === 'in_progress')
      for (const task of running.slice(0, 2)) {
        const item = el(doc, 'span', 'board-active-item', `▶ ${task.title}`)
        item.title = task.title
        parts.active.append(item)
      }
      if (running.length > 2) parts.active.append(el(doc, 'span', 'board-active-more', `还有 ${running.length - 2} 条在跑`))
      if (running.length === 0) parts.active.append(el(doc, 'span', 'board-active-more', '当前没有在跑的单子'))
      if ((model?.counts?.dead ?? 0) > 0) {
        const dead = el(doc, 'span', 'board-active-dead', `⛔ ${model.counts.dead} 张卡死（前置失败）`)
        dead.title = '这些单永远等不到，需要重派或取消'
        parts.active.append(dead)
      }
    }
    // 摘要条：一条按状态分段的横条（段宽 = 该状态的占比）。收起时它就是"离目标还有多远"。
    parts.bar.textContent = ''
    const total = Math.max(1, model.counts.total)
    const barStatuses = (model.counts.dead ?? 0) > 0 ? [...TASK_STATUSES, 'dead'] : TASK_STATUSES
    for (const status of barStatuses) {
      const count = model.counts[status] ?? 0
      if (count === 0) continue
      const segment = el(doc, 'i')
      applyNodeColors(segment, status)
      segment.style.width = `${(count / total) * 100}%`
      segment.title = `${taskStatusLabel(status)} ${count} / ${model.counts.total}`
      parts.bar.append(segment)
    }
    for (const status of TASK_STATUSES) {
      const count = model.counts[status] ?? 0
      if (count === 0 && status !== 'done') continue
      const chip = el(doc, 'span', 'board-count')
      const dot = el(doc, 'i', 'board-dot')
      applyNodeColors(dot, status)
      dot.classList.add('board-count-dot')
      chip.append(dot, el(doc, 'b', undefined, String(count)), el(doc, 'span', 'dim', taskStatusLabel(status)))
      parts.counts.append(chip)
    }
    // 「卡死」单独一枚，而且**带标题**：它和「待办」的区别必须一眼看得出来——
    // 用户看到"单挂着不动"时的第一个问题就是"为什么"。
    if ((model.counts.dead ?? 0) > 0) {
      const deadChip = el(doc, 'span', 'board-count is-dead')
      deadChip.title = `${model.counts.dead} 张单的前置单已经失败——它们永远等不到，需要重派或取消`
      const deadDot = el(doc, 'i', 'board-dot board-count-dot is-dead')
      deadChip.append(deadDot, el(doc, 'b', undefined, String(model.counts.dead)), el(doc, 'span', undefined, taskStatusLabel('dead')))
      parts.counts.append(deadChip)
    }
    // "共 N 张"在收起状态没有信息量（段数与计数已经说完了），所以给它一个类名让 CSS 收起时隐藏。
    parts.counts.append(el(doc, 'span', 'board-count dim board-total', `共 ${model.counts.total} 张`))
    if (layout.hasCycle) {
      // 成环降级了就必须说出来（见 board-layout.js 里"为什么降级不抛错"）。
      parts.counts.append(el(doc, 'b', 'warn', `依赖里有环：${layout.unresolved.length} 张单排在最后一列`))
    }
    // R152：侧边栏两块 header 上的计数（「9 人 · 3 忙碌」/「10 张 · 8 完成」）。
    renderRegionMeta()
  }

  function renderDetail() {
    // R181：侧边栏里没有多行"产出/解锁"详情的位置——选中后只给一行检查器。
    // 独立模式（#board 浮层）仍用原来的多行详情，那段逻辑保留不动。
    if (mounted === true) return renderInspector()
    const detail = parts.detail
    detail.textContent = ''
    if (selected === null) {
      /*
       * R152：默认提示从两行长句压成一句。
       * 原来那句「点图里的方框（或左边的成员）看详情。连线的绿实线 = …；橙色虚线框 = …」
       * 用 71px 高度讲了三件互不相关的事，而用户此刻只想点一样东西看详情。
       * 图示说明搬进 `title`：需要的人悬停能看到，不需要的人不会被它占地方。
       */
      detail.title = '绿实线 = 前置已完成 · 橙色虚线框 = 这张单需要 review 能力'
      detail.append(el(doc, 'span', 'board-detail-hint', '点一张单或一个人，看详情'))
      return
    }
    detail.removeAttribute?.('title')
    if (selected.kind === 'member') {
      const member = model.members.find((m) => m.id === selected.id)
      const label = member ?? { name: '未分配', role: null, state: null, tasks: model.unowned }
      detail.append(el(doc, 'b', 'board-detail-title', label.name))
      if (label.role !== null && label.role !== undefined) detail.append(el(doc, 'span', 'dim', roleLabel(label.role)))
      if (label.state !== null && label.state !== undefined) detail.append(el(doc, 'span', 'dim', agentStateLabel(label.state)))
      detail.append(el(doc, 'span', 'board-detail-field', `在手 ${label.tasks.length === 0 ? '—' : `${label.tasks.length} 张`}`))
      return
    }

    const task = describeTask(model, selected.id)
    if (task === null) {
      detail.append(el(doc, 'span', 'dim', '这张单已经不在世界上了（世界重开过？）。'))
      return
    }
    const dot = el(doc, 'i', 'board-dot')
    applyNodeColors(dot, task.displayStatus ?? task.status)
    dot.classList.add('board-count-dot')
    detail.append(dot, el(doc, 'b', 'board-detail-id', task.id), el(doc, 'span', 'board-detail-title', task.title))
    detail.append(el(doc, 'span', 'board-detail-field', `状态 ${taskStatusLabel(task.displayStatus ?? task.status)}`))
    detail.append(el(doc, 'span', 'board-detail-field', `执行者 ${task.ownerName ?? '未分配'}`))
    if (task.requires.length > 0) detail.append(el(doc, 'span', 'board-detail-field', `需要 ${task.requires.join('/')}`))
    // 参考图里那句 "Unlocks t2,t3"：**从 blockedBy 反向索引来**，不用新数据。
    detail.append(
      el(
        doc,
        'span',
        task.unlocks.length > 0 ? 'board-unlocks' : 'board-detail-field',
        task.unlocks.length > 0 ? `解锁 ${task.unlocks.map((u) => u.id).join('、')}` : '没有后续',
      ),
    )
    if (task.blockedByTasks.length > 0) {
      detail.append(el(doc, 'span', 'board-detail-field', `被 ${task.blockedByTasks.map((b) => b.id).join('、')} 挡着`))
    }
    // ① 这张单**已经死了**（前置失败，永远等不到）——先说结论，再说细节
    // ② 调度器**这一轮**为什么不派它（没人 / 没工位）——与 ① 分开写
    //
    // 两块都放进**浮在详情条上方**的那个盒子（`.board-read`）：详情条只有一行高，
    // 几十上百字的失败原因塞进去必然被裁（M7-9 的纪律：被裁就是没显示）。
    const notes = []
    if (Array.isArray(task.deadBlockers) && task.deadBlockers.length > 0) notes.push(renderDeadNote(task.deadBlockers))
    const stall = stallById.get(task.id)
    if (stall !== undefined) notes.push(renderStallNote(stall))
    detail.append(renderReadPanel(summarizeTaskOutput(task), notes))
  }

  /**
   * R181：单行检查器（侧边栏挂载模式）。
   *
   * 选中任务 → `id · 标题 · 负责人 · 状态`，行尾是 ✓/↺ 图标；
   * 选中成员 → 名字 · 角色 · 在手 N 张。没选中就整条 hidden——
   * "没有可说的东西时不要占一行"比一句占位提示更重要（它下面就是任务图）。
   */
  function renderInspector() {
    const detail = parts.detail
    detail.textContent = ''
    detail.hidden = selected === null
    if (selected === null) return
    if (selected.kind === 'member') {
      const member = model.members.find((m) => m.id === selected.id)
      const label = member ?? { name: '未分配', role: null, state: null, tasks: model.unowned }
      detail.append(el(doc, 'b', 'board-detail-id', label.name))
      const role = roleLabel(label.role)
      if (role !== '') detail.append(el(doc, 'span', 'aw-inspector-meta', role))
      detail.append(el(doc, 'span', 'aw-inspector-meta', `在手 ${label.tasks.length} 张`))
      return
    }
    const task = describeTask(model, selected.id)
    if (task === null) {
      detail.append(el(doc, 'span', 'aw-inspector-meta', '这张单已经不在世界上了（世界重开过？）。'))
      return
    }
    const dot = el(doc, 'i', 'board-dot')
    applyNodeColors(dot, task.displayStatus ?? task.status)
    dot.classList.add('board-count-dot')
    detail.append(dot, el(doc, 'b', 'board-detail-id', task.id), el(doc, 'span', 'aw-inspector-title', task.title))
    detail.append(el(doc, 'span', 'aw-inspector-meta', task.ownerName ?? '未分配'))
    detail.append(el(doc, 'span', 'aw-inspector-meta', taskStatusLabel(task.displayStatus ?? task.status)))
    const meta = teamMeta.get(task.id)
    if (meta !== undefined) {
      const actions = el(doc, 'div', 'aw-inspector-actions')
      if (meta.status !== 'done' && meta.status !== 'failed') {
        actions.append(actionIcon('✓', `把 ${task.id} 标记完成`, () => emitTaskAction(task.id, 'complete')))
      }
      if (meta.status === 'done') {
        actions.append(actionIcon('↺', `重开 ${task.id}`, () => emitTaskAction(task.id, 'reopen')))
      }
      if (actions.children.length > 0) detail.append(actions)
    }
  }

  /**
   * "这张单已经死了"（R67 / M13-5）：前置单失败 → 后续单永远停在 `pending`。
   *
   * 真机上就有三张（`task-19 ← task-18(failed)` 等）。以前界面只说「待办」，
   * 用户看到的是"人不动、单挂着"，**看不出这是个死结**。这里把"哪张前置失败了"
   * 和"它当时的失败原因"一起摆出来——失败原因往往长到几百字，所以截断 + `title` 全文。
   */
  function renderDeadNote(failed) {
    const box = el(doc, 'div', 'board-dead-note')
    box.append(el(doc, 'div', 'board-dead-head', '⛔ 永远等不到：它的前置单已经失败了'))
    for (const dep of failed) {
      const line = el(doc, 'div', 'board-dead-line')
      line.append(el(doc, 'b', 'board-dead-id', dep.id))
      line.append(el(doc, 'span', undefined, `《${dep.title ?? '（无标题）'}》`))
      box.append(line)
      const reason = typeof dep.failureReason === 'string' ? dep.failureReason.trim() : ''
      if (reason !== '') {
        const text = reason.length > 200 ? `${reason.slice(0, 200)}…` : reason
        const para = el(doc, 'p', 'board-dead-reason', text)
        para.title = reason
        box.append(para)
      } else {
        box.append(el(doc, 'p', 'board-dead-reason dim', '（这张前置单没有写下失败原因）'))
      }
    }
    box.append(el(doc, 'div', 'board-dead-exit', '出路：把这张单重派给别人、或直接取消它——它不会再自己动起来。'))
    return box
  }

  /**
   * "调度器这一轮为什么不派它"（R67 / M13-5）。
   *
   * 与 `renderDeadNote` 分开：那一类是**死结**（要重派/取消），这一类是**在等**
   * （要补人 / 补能承载这个能力的工位）。`detail` 是模拟侧写好的中文，直接显示。
   */
  function renderStallNote(stall) {
    const box = el(doc, 'div', 'board-stall-note')
    box.append(el(doc, 'div', 'board-stall-head', '⏳ 调度器现在不派它（还在等）'))
    box.append(el(doc, 'div', 'board-stall-reason', stallReasonLabel(stall.reason)))
    if (typeof stall.detail === 'string' && stall.detail.trim() !== '') {
      box.append(el(doc, 'div', 'board-stall-detail', stall.detail))
    }
    return box
  }

  /**
   * 产出面板（R45 / M10-9）——"他干出了什么"。
   *
   * ## 为什么是**浮在详情条上方**，而不是把看板撑高
   *
   * 一张单的产出真机上有 1091 ~ 2246 字（≈ 40~60 行）。看板的高度是**固定的**（M7-9 的纪律：
   * 任何一边超出可见容器就是"被切了"，而外面没有滚动条能救它）。所以只有三条路：
   *   · 把看板撑高 → 违反固定高度，超出部分被裁（等于把结论吃了）；
   *   · 挤进 `.board-body` → 依赖图被压小（缩放变小 = 另一种"读不了"，而且图是这一屏的主角）；
   *   · **浮起来**：贴详情条上方展开，`max-height` + 内部滚动，按「收起」就回到图上。
   * 选了第三条。默认只显示前 5 行 + 渐隐遮罩（一眼看得到结论开头），`展开全文` 才铺开；
   * 字数写在标题旁边，用户点之前就知道这篇有多长。
   *
   * ## 为什么用 `textContent` 而不是富文本
   *
   * 产出是**模型写的文本**。Markdown/HTML 渲染 = 自己开一个注入面。这里连 `<br>` 都不拼：
   * 换行交给 CSS 的 `white-space: pre-wrap`，段落结构原样保留。
   */
  function renderReadPanel(summary, notes = []) {
    const box = el(doc, 'div', outputExpanded ? 'board-read is-expanded' : 'board-read')
    // 先说"为什么它不动"（如果它确实不动），再说"它干出了什么"。
    for (const note of notes) box.append(note)
    if (!summary.hasContent) {
      // 没有产出也要有话说：空白会让人以为面板坏了（真机上很多早期单确实没有 output）。
      // 但**有 note 的时候不再补这句**——那时上面已经把事情说清楚了，"没有产出"只会造成噪音。
      if (notes.length === 0) box.append(el(doc, 'span', 'dim board-read-empty', summary.note ?? '这张单没有产出。'))
      return box
    }

    const head = el(doc, 'div', 'board-read-head')
    head.append(el(doc, 'span', 'board-read-title', summary.sections[0].label))
    head.append(
      el(doc, 'span', 'dim board-read-chars', outputExpanded ? `共 ${summary.chars} 字` : `${summary.chars} 字 · 前 ${summary.sections[0].previewLines} 行`),
    )
    const toggle = el(doc, 'button', 'board-read-toggle')
    toggle.type = 'button'
    toggle.textContent = outputExpanded ? '收起' : '展开全文'
    toggle.addEventListener('click', (event) => {
      event.stopPropagation()
      outputExpanded = !outputExpanded
      renderDetail()
    })
    head.append(toggle)
    box.append(head)

    // 正文放在**单独的滚动容器**里：展开时头部（含"收起"按钮与字数）留在原地，
    // 只有正文滚——不然读到最后想收起还得先滚回顶部。
    const body = el(doc, 'div', 'board-read-body')
    for (const section of summary.sections) {
      const part = el(doc, 'div', `board-section board-section-${section.kind}`)
      if (summary.sections.length > 1) part.append(el(doc, 'span', 'board-section-label', section.label))
      part.append(el(doc, 'pre', 'board-section-text', outputExpanded ? section.text : section.preview))
      body.append(part)
    }
    box.append(body)
    return box
  }

  /**
   * 被切掉的元素（M7-9 的可复用核验入口，`?debug=1` 下挂到 `__agentWorldBoard.clipped()`）。
   *
   * ## 为什么不能拿 `scrollHeight == clientHeight` 来验"没被切"
   *
   * 那个等式证明的是"**不需要滚动条**"。而 `overflow: hidden` 造成的裁剪**同样满足它**——
   * 于是最右边的节点被切掉一半、左下角成员行被切掉一半，检查还是绿的。
   * 正确判据只有一条：**元素矩形 vs 可见容器的矩形**，任何一边超出就是被切了。
   * 而且容器矩形要**与视口矩形取交集**——在自己容器里合法 ≠ 看得见：
   * 整个看板被推到视口下面时，成员行在容器里完全合法，而屏幕上根本没有它。
   *（上一轮被切掉的最后一行就属于这一类：不是列表裁的，是"外边"裁的。）
   *
   * @param {{tolerance?: number}} [options] - 容差（默认 1px，抗子像素取整）。
   * @returns {ReadonlyArray<{kind: string, id: string, edges: string[], overflow: object}>}
   */
  /**
   * **可读性判据**（R120）：把"能不能读"变成两个可判的数字。
   *
   * ## 为什么它必须存在
   *
   * 同一个判据错误我们犯过**两次**：
   *   · R12：横向排布缩到 **0.65**，`clipped()` 报 **0**（几何没溢出），但标题 ~8px 读不出；
   *   · R120：两栏之后图区 ~250–300px，32 张单缩到 `MIN_SCALE = 0.4`，
   *     内容"装下了"所以**连滚动条都没有**，字小到没法读。
   *
   * 两次的根子都是 `clipped()` 那种**"几何有没有溢出"**——它只能发现"被切掉"，
   * 发现不了"缩得刚好装下但缩过头"。**装下了 ≠ 能读。**
   *
   * ## 数字怎么来
   *
   * `titlePx` 用真机 `getComputedStyle` 读（**不写死**）：
   * `transform: scale()` 会把文字一起缩，而 `fontSize` 返回的是**指定值**、不含缩放，
   * 所以屏幕上的真实大小是 `titlePx × scale` —— 这一步最容易看漏。
   *
   * @returns {object|null} 拿不到画布/标题时返回 null（别编一个看起来正常的读数）
   */
  function readability() {
    if (!ready || fitInfo === null) return null
    const title = parts.canvas?.querySelector?.('.board-node-title')
    const view = doc.defaultView ?? globalThis
    const titlePx = title === null || title === undefined ? null : Number.parseFloat(view.getComputedStyle(title).fontSize)
    const scale = fitInfo.scale
    const effectivePx = Number.isFinite(titlePx) ? Math.round(titlePx * scale * 10) / 10 : null
    const canvas = parts.canvas
    return {
      scale,
      titlePx: Number.isFinite(titlePx) ? titlePx : null,
      effectivePx,
      minScale: MIN_SCALE,
      minPx: READABLE_MIN_PX,
      /**
       * 两个条件**都要**满足。用真机字号那一路（`effectivePx`）是主判据——
       * 它不依赖模块里的 `NODE_TITLE_PX`，所以 CSS 字号改了也抓得出来。
       */
      readable: scale >= MIN_SCALE && (effectivePx === null || effectivePx >= READABLE_MIN_PX),
      /** 滚动读数：图比容器大时真机上应当能滚到内容边缘（横向也要能滚）。 */
      scroll: canvas === null || canvas === undefined
        ? null
        : {
            clientW: canvas.clientWidth,
            clientH: canvas.clientHeight,
            scrollW: canvas.scrollWidth,
            scrollH: canvas.scrollHeight,
            canScrollX: canvas.scrollWidth > canvas.clientWidth + 1,
            canScrollY: canvas.scrollHeight > canvas.clientHeight + 1,
          },
    }
  }

  function clipped(options = {}) {
    if (!ready) return []
    const tolerance = Number.isFinite(options.tolerance) ? options.tolerance : 1
    const out = []
    const beyond = (rect, box) => {
      const edges = []
      if (rect.right > box.right + tolerance) edges.push('right')
      if (rect.left < box.left - tolerance) edges.push('left')
      if (rect.bottom > box.bottom + tolerance) edges.push('bottom')
      if (rect.top < box.top - tolerance) edges.push('top')
      if (edges.length === 0) return null
      return {
        edges,
        overflow: {
          right: Math.round(rect.right - box.right),
          left: Math.round(box.left - rect.left),
          bottom: Math.round(rect.bottom - box.bottom),
          top: Math.round(box.top - rect.top),
        },
      }
    }
    const canvasBox = intersectWithViewport(parts.canvas.getBoundingClientRect())
    for (const [id, entry] of cardNodes) {
      const hit = beyond(entry.card.getBoundingClientRect(), canvasBox)
      if (hit !== null) out.push({ kind: 'node', id, ...hit })
    }
    const membersBox = intersectWithViewport(parts.members.getBoundingClientRect())
    for (const [id, node] of memberRowNodes) {
      // 成员栏收起时列表是 `display: none`，这些行的矩形全是 0——会被误判成"被切到左边去了"。
      // **没显示出来的东西谈不上被切**（而且收起是用户点出来的，不是我们偷偷裁的）。
      if (node.offsetParent === null) continue
      const hit = beyond(node.getBoundingClientRect(), membersBox)
      if (hit !== null) out.push({ kind: 'member', id, ...hit })
    }
    return out
  }

  /**
   * 容器矩形 ∩ 视口矩形。
   *
   * 两层都要比：**在自己容器里**不等于**看得见**——整个看板被推到视口下面时，
   * 成员行在容器里完全合法，而屏幕上根本没有它（上一轮被切掉的最后一行就是这一类）。
   */
  function intersectWithViewport(rect) {
    const viewport = doc.documentElement
    const left = 0
    const top = 0
    const right = viewport.clientWidth
    const bottom = viewport.clientHeight
    return {
      left: Math.max(rect.left, left),
      top: Math.max(rect.top, top),
      right: Math.min(rect.right, right),
      bottom: Math.min(rect.bottom, bottom),
    }
  }

  /**
   * 尺寸变了就重新挑档位（窗口缩放、成员栏换行、看板收起/展开…）。
   *
   * 监听的是**可见容器**：`ResizeObserver` 只在元素自己的盒子变化时触发，
   * 而内容已经不会撑大它了，所以不存在"重排 → 再触发"的自激；
   * 再加一道"尺寸没变就不动"的闸门，双保险。
   */
  function observeSize() {
    if (typeof globalThis.ResizeObserver !== 'function') return null
    const observer = new globalThis.ResizeObserver(() => {
      // ⚠️ 挂载模式下**不能**看 `collapsed`（它恒为初始值 true，而侧边栏根本没有"收起"）。
      // 这里的真理是"画布量出来有多大"：0×0 说明这一档被 `hidden` 藏着，等它可见了再画。
      if (model === null || (mounted !== true && collapsed)) return
      const size = measureCanvas()
      if (lastFitSize !== null && size.width === lastFitSize.width && size.height === lastFitSize.height) return
      renderGraph()
    })
    observer.observe(parts.canvas)
    observer.observe(parts.members)
    return observer
  }

  /**
   * 画视图条（R46）：一行分组签 + 一行状态过滤，**可叠加**。
   *
   * 数量用的是**全量**统计（不是过滤后的）：用户要看到"这条流水线一共 18 张、其中 6 张没干完"，
   * 而不是"在当前筛选下还剩几张"——后者会让分组签随筛选一起变，自己把自己绕进去。
   */
  function renderView() {
    // R181：侧边栏挂载模式不再挂视图条（分组/筛选 chip 吃掉图的高度）；
    // 独立模式仍然有，行为不变。
    if (!ready || mounted === true) return
    const total = allGroups.reduce((sum, g) => sum + g.total, 0)
    const unfinished = allGroups.reduce((sum, g) => sum + g.unfinished, 0)
    const groups = [{ id: 'all', name: '', total, unfinished }, ...allGroups]

    parts.groupChips.textContent = ''
    for (const group of groups) {
      const chip = el(doc, 'button', 'board-view-chip board-view-group')
      chip.type = 'button'
      /*
       * R152：`名字 + 数字徽章`，而不是 `快速修一个 bug · 3 张（3 未完成）`。
       * 后者一枚就 205px，四枚在图区顶上折成 4 行、吃掉 113px——那是图的高度。
       * 名字可以截断、数字仍然对齐；完整读数留在 `title`/`aria-label` 里。
       */
      chip.append(el(doc, 'span', 'board-view-name', groupDisplayName(group)))
      chip.append(el(doc, 'span', 'board-view-count', String(group.total)))
      const active = group.id === viewGroup
      chip.classList.toggle('is-active', active)
      chip.setAttribute('aria-pressed', String(active))
      chip.title = active ? `当前分组：${groupViewLabel(group)}` : `只看 ${groupViewLabel(group)}`
      chip.setAttribute('aria-label', chip.title)
      chip.addEventListener('click', () => setView({ group: group.id }))
      parts.groupChips.append(chip)
    }

    parts.filterChips.textContent = ''
    for (const filter of VIEW_FILTERS_ORDER) {
      const chip = el(doc, 'button', 'board-view-chip board-view-filter')
      chip.type = 'button'
      chip.textContent = VIEW_FILTER_LABEL[filter] ?? filter
      const active = filter === viewFilter
      chip.classList.toggle('is-active', active)
      chip.setAttribute('aria-pressed', String(active))
      chip.addEventListener('click', () => setView({ filter }))
      parts.filterChips.append(chip)
    }
  }

  /**
   * 换视图（分组 / 筛选）。
   *
   * 两道签名一起清掉：`lastState` 里带了视图状态（`boardSignature(world, view)`），
   * 而"结构"也必须重建（过滤之后模型本身变了）。清完再走一遍 `update`，
   * 于是**同一份世界数据**会按新视图重新折一次模型——不需要等下一次推送。
   */
  function setView(next) {
    const group = next?.group ?? viewGroup
    const filter = next?.filter ?? viewFilter
    if (group === viewGroup && filter === viewFilter) return false
    viewGroup = group
    viewFilter = filter
    lastState = null
    lastStructure = null
    if (world !== null && world !== undefined) update(world)
    return true
  }

  function select(next) {
    selected = next
    outputExpanded = false
    lastState = null
    renderDetail()
    refreshState()
    // 左栏的 active 行要跟着变（成员选中）。
    if (model !== null) renderMembers()
    options.onSelect?.(next === null || next.kind !== 'task' ? null : next.id)
  }

  /**
   * R181：官方任务里的 owner 是**名字**（ownerName），看板的成员归属/未分配统计按 **agent id**。
   *
   * 这一步把名字对回世界里的角色——世界角色本身就是真实 subagent 的投影
   *（`src/index.ts` R166 的 `syncRoster`）。对不上就保持"未指派"：**不猜**。
   */
  function applyTeamOwners() {
    if (teamTasks === null || model === null) return
    const idByName = new Map()
    for (const agent of Array.isArray(world?.agents) ? world.agents : []) {
      const name = typeof agent?.name === 'string' ? agent.name : ''
      if (name !== '' && typeof agent.id === 'string') idByName.set(name, agent.id)
    }
    for (const task of model.tasks) {
      const name = teamMeta.get(task.id)?.ownerName ?? ''
      task.owner = name === '' ? null : idByName.get(name) ?? null
      task.ownerName = name === '' ? null : name
    }
    // buildBoardModel 是在 owner 对上之前算的成员归属，这里重算一遍。
    for (const member of model.members) {
      member.tasks = model.tasks.filter((t) => t.owner === member.id).map((t) => t.id)
    }
    model.unowned = model.tasks.filter((t) => t.owner === null).map((t) => t.id)
  }

  /**
   * R181：把官方 projection 的任务交给看板（`null` = 退回世界自己的工单）。
   *
   * 数据流向只有一条：Client → `setTeamProjection` → main.js → 这里；
   * 看板不做 HTTP、也不订阅团队服务，所以它仍然是纯渲染层。
   *
   * @param {ReadonlyArray<object>|null} tasks
   */
  function setTeamTasks(tasks) {
    const next = tasks === null || tasks === undefined ? null : normalizeTeamTasks(tasks)
    // 指纹没变就不重画：轮询每 10s 一次，而任务内容多数时候是同一份。
    const key = next === null
      ? 'null'
      : next.map((t) => `${t.id}|${t.title}|${t.status}|${teamMeta.get(t.id)?.ownerName ?? ''}|${teamMeta.get(t.id)?.revision ?? ''}`).join('||')
    if (key === lastTeamKey) return false
    lastTeamKey = key
    teamTasks = next
    lastState = null
    lastStructure = null
    if (!ready) return false
    // 快照还没到：先记住，等 `update(world)` 时和世界一起画。
    if (world === null || world === undefined) return false
    return update(world)
  }

  /**
   * 用一份世界数据刷新看板。
   *
   * **签名没变就直接返回**：结构没变不重建 DOM（`structureKey`），只有状态/进度变了
   * 就 `refreshState()` 就地改。这就是"看板不会拖慢场景"的可解释版本。
   *
   * @param {object} nextWorld - 本地世界（快照 + 增量维护）。
   */
  function update(nextWorld, extra = undefined) {
    counters.updates += 1
    world = nextWorld
    // R157：场景计划只随快照来（事件流不带）。没有就沿用上一次的。
    if (extra !== undefined && extra !== null && extra.scene !== undefined) scene = extra.scene ?? null
    // 诊断是**显示用**的：先收下（它不进结构签名，也不该被下面的早退闸门吃掉）。
    if (extra !== undefined && extra !== null && extra.diagnostics !== undefined) {
      const stalled = Array.isArray(extra.diagnostics.stalled) ? extra.diagnostics.stalled : []
      const next = new Map()
      for (const item of stalled) {
        if (item === null || item === undefined) continue
        if (typeof item.taskId !== 'string' || item.taskId === '') continue
        next.set(item.taskId, item)
      }
      const changed = next.size !== stallById.size || [...next.keys()].some((id) => !stallById.has(id))
      stallById = next
      if (changed && selected !== null && selected.kind === 'task') renderDetail()
    }
    if (!ready) return false
    if (world === null || world === undefined) return false

    // 第一道闸门：**指纹没变就什么都不做**（连模型都不折）。
    // 世界每秒推十几次事件，而"没人改变任务/成员状态"的那种帧是多数——
    // 这一行让那种帧的代价只剩一次字符串拼装。
    // 视图状态进签名：不然用户点了分组/筛选之后，世界下一帧会因为"签名没变"而把图留成旧的。
    // R181：官方任务的 status/revision 不在 `world` 里，必须单独进指纹，
    // 否则"团队里完成了一张单"会被早退闸门吞掉（界面不动，看起来像没生效）。
    const teamKey = teamTasks === null
      ? ''
      : teamTasks.map((t) => `${t.id}:${t.status}:${teamMeta.get(t.id)?.ownerName ?? ''}:${teamMeta.get(t.id)?.revision ?? ''}`).join('|')
    const stateKey = boardSignature(world, { group: viewGroup, filter: viewFilter }) + '#' + teamKey
    if (stateKey === lastState) {
      counters.skipped += 1
      return false
    }

    // 第二道闸门：折出数据（纯函数），比**结构**签名决定"重建"还是"就地改"。
    // 分组统计用**全量**（分组签上的数量与筛选无关），模型用**过滤后**的任务。
    //
    // R181：官方 projection 已经给了任务时，**任务面板显示真实任务**；
    // 没有（headless/e2e/没装 agent-teams）就退回世界自己的工单——同一套渲染，不做第二份。
    const native = teamTasks !== null
    const sourceTasks = native ? teamTasks : world.tasks
    allGroups = groupTasks(sourceTasks, taskSetNames)
    const viewTasks = native ? sourceTasks : applyView(sourceTasks, { group: viewGroup, filter: viewFilter })
    model = buildBoardModel({ ...world, tasks: viewTasks })
    if (native) applyTeamOwners()
    layout = layoutDependencyGraph(model.tasks)
    // 几何不在这里算：它要按**可见容器的实测尺寸**挑档位，所以由 `renderGraph()` 负责
    //（只有真重画时才需要，跳过/就地改的路径一次都不用量）。

    const structureKey =
      layout.signature +
      '#' +
      model.tasks.map((t) => `${t.id}:${t.title}:${t.ownerName ?? ''}:${t.requires.join(',')}`).join('|') +
      '#' +
      model.members.map((m) => `${m.id}:${m.name}:${m.role ?? ''}:${m.tasks.join(',')}`).join('|') +
      '#' +
      model.unowned.join(',') +
      '#' +
      // 场景晚到（快照前先有一次 update）时也要重建成员列表：头像从字母换成贴图。
      (scene === null ? '' : (scene.actors ?? []).map((a) => `${a.id}:${a.modelId}`).join('|'))

    if (structureKey === lastStructure) {
      lastState = stateKey
      counters.stateRefreshes += 1
      renderCounts()
      renderView()
      renderRibbon()
      refreshState()
      renderDetail()
      return true
    }

    lastStructure = structureKey
    lastState = stateKey
    counters.structureRebuilds += 1
    renderCounts()
    renderView()
    renderMembers()
    renderGraph()
    renderRibbon()
    refreshState()
    renderDetail()
    return true
  }

  // ── 可复用的核验入口（M7-9）──────────────────────────────────────────────────
  //
  // `?debug=1` 时把 `clipped()` 挂到 `main.js` 那个 `__agentWorldBoard` 门面上，
  // 于是以后每轮验收都是一行：`window.__agentWorldBoard.clipped()`。
  //
  // 为什么要延一个宏任务：那个门面是 **main.js** 在 `createBoard()` 之后建的，
  // 此刻还不存在。先等一轮再挂——门面不在就自己建一个（别的宿主也能用）。
  if (ready && typeof globalThis.location !== 'undefined') {
    let debug = false
    try {
      debug = new URLSearchParams(globalThis.location.search ?? '').has('debug')
    } catch {
      debug = false
    }
    if (debug) {
      setTimeout(() => {
        const facade = globalThis.__agentWorldBoard
        if (facade !== null && facade !== undefined && typeof facade === 'object') facade.clipped = clipped
        else globalThis.__agentWorldBoardCheck = { clipped }
      }, 0)
    }
  }

  return {
    ready,
    /** 换视图（分组/筛选）——给核验用，也是图里那两个 chip 走的同一条路。 */
    setView,
    update,
    setPalette,
    setTaskSets,
    setCollapsed,
    /** R3：切到任务图档之后重挑几何（挂载模式下它常常是"数据变了但这档藏着"）。 */
    refreshGraph,
    select: (taskId) => select(taskId === null || taskId === undefined ? null : { kind: 'task', id: taskId }),
    selected: () => (selected === null ? null : selected.id ?? null),
    /** R181：新建任务时"负责人 = 当前聚焦的成员行"（没选中人就未指派）。 */
    selectedMember: () => {
      if (selected === null || selected.kind !== 'member') return null
      const member = model?.members.find((m) => m.id === selected.id)
      return member === undefined ? null : { id: member.id, name: member.name }
    },
    /** R181：官方任务（`null` = 退回世界工单）。 */
    setTeamTasks,
    /** 被切掉的元素（空数组 = 没有东西被裁）。每轮验收的第一行就用它。 */
    clipped,
    /** 诊断用：`updates` 一直在涨而 `structureRebuilds` 不涨，说明就地更新在做它的事。 */
    stats: () => ({
      ...counters,
      nodes: layout?.nodeCount ?? 0,
      edges: layout?.edgeCount ?? 0,
      columns: layout?.columns.length ?? 0,
      hasCycle: layout?.hasCycle ?? false,
      unowned: model?.unowned.length ?? 0,
      missingTokens: missingBoardTokens(palette),
      collapsed,
      // 响应式：这一帧用的是哪档几何、缩没缩放、容器允许多大。
      preset: fitInfo?.preset ?? null,
      orientation: fitInfo?.orientation ?? null,
      scale: fitInfo?.scale ?? null,
      available: fitInfo?.available ?? null,
      content: fitInfo?.content ?? null,
      overflow: fitInfo?.overflow ?? null,
      clipped: clipped().length,
      /**
       * **可读性判据**（R120）——"装下了" ≠ "能读"。
       *
       * 同一个判据错误我们犯过两次（R12 缩到 0.65、R120 缩到 0.4），两次都是
       * **拿"几何有没有溢出"当"能不能读"**。所以这里给一个**可判**的读数：
       *   · `scale` —— 实际缩放；
       *   · `titlePx` —— 节点标题的**CSS 计算字号**（真机 `getComputedStyle` 读，不写死）；
       *   · `effectivePx` —— `titlePx × scale`，**这才是屏幕上真正的大小**
       *     （`transform: scale()` 会把文字一起缩，而 `getComputedStyle().fontSize`
       *      返回的是**指定值**、不含缩放——这一点最容易看漏）；
       *   · `readable` —— `scale ≥ MIN_SCALE` **且** `effectivePx ≥ READABLE_MIN_PX`。
       *
       * ⚠️ 这两个判据是同一件事的两种说法（`MIN_SCALE = READABLE_MIN_PX / NODE_TITLE_PX`），
       * 都留着是因为：一个用模块常量判（纯逻辑、可单测），一个用**真机字号**判
       * （CSS 改了也能抓出来——真机那一路不依赖模块里的常量）。
       */
      readability: readability(),
      // 视图（R46）：当前分组/筛选、一共几条流水线。
      view: { group: viewGroup, filter: viewFilter },
      viewSignature: viewSignature({ group: viewGroup, filter: viewFilter }),
      groups: allGroups.map((g) => ({ id: g.id, name: g.name, total: g.total, unfinished: g.unfinished })),
      visibleTasks: model?.tasks.length ?? 0,
      ribbonSegments: ribbonSegs.size,
      teamTasks: teamTasks === null ? null : teamTasks.length,
    }),
    /** 只给测试/诊断：看板的模型与布局（DOM 层不导出别的）。 */
    model: () => model,
    layout: () => layout,
    geometry: () => geometry,
    unlocksIndex,
  }
}
