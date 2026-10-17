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

import { MEMBERS_TOGGLE_LABEL, VIEW_FILTERS_ORDER, VIEW_FILTER_LABEL, agentStateLabel, groupViewLabel, roleLabel, stallReasonLabel, taskStatusLabel } from './labels.js'
import { summarizeTaskOutput } from '../core/task-output.js'
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
  layoutDependencyGraph,
  missingBoardTokens,
  resolveBoardColor,
  shortTaskId,
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
 * @param {(agentId: string) => void} [options.onMemberPick] - 点成员卡上的"对话"按钮（R76：花名册删掉后的对话入口）。
 * @param {(agentId: string) => void} [options.onMemberSelect] - 点成员行本身 = **选中/聚焦**（R3：与上一条语义不同，别合并）。
 * @param {Document} [options.document]
 */
export function createBoard(options = {}) {
  const doc = options.document ?? globalThis.document
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
  /** 成员看板开着吗（窄视口默认收起，见 `applyNarrowDefault`）。 */
  let membersOpen = true
  /** 用户手动开合过成员栏吗（手动过之后，窗口跨断点就不再替他改）。 */
  let membersUserSet = false
  // R65：默认**收起**。收起 = 一行摘要（标题 + 进度条 + 计数 + "正在跑什么"），
  // 展开才是完整工单列表——用户点「展开」是他的选择，但**默认状态不许占掉场景**。
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
  /** 卡片的 DOM 引用（就地更新用）：taskId → {node, ...}。 */
  const cardNodes = new Map()
  const chipNodes = new Map()
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
    const membersHead = el(doc, 'h3', undefined, '成员看板')
    const membersToggle = el(doc, 'button', 'board-members-toggle ghost')
    membersToggle.type = 'button'
    membersToggle.addEventListener('click', () => {
      membersUserSet = true
      setMembersOpen(!membersOpen)
    })
    membersHead.append(membersToggle)
    members.append(membersHead, membersList)

    const graph = el(doc, 'section', 'board-graph')
    const graphHead = el(doc, 'h3', undefined, '任务依赖图')
    graphHead.append(el(doc, 'span', 'dim', '左 → 右：前置解锁后续'))
    // 缩放到可读下限（0.4）**还**装不下时，画布是可滚动的——这件事要说出来，
    // 不能让用户以为"图就画了这么多"。文字在 `renderGraph` 里按实际算出的溢出量填。
    const graphHint = el(doc, 'span', 'board-graph-hint warn')
    graphHint.hidden = true
    graphHead.append(graphHint)
    const canvas = el(doc, 'div', 'board-canvas')
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
    canvas.append(fit)
    graph.append(graphHead, canvas)
    body.append(members, graph)

    const detail = el(doc, 'footer', 'board-detail')
    // R76：把「展开才看得见」的部分（视图条 + 成员/依赖图 + 详情）包进一个 `.board-panel`。
    // 这样展开浮层是**独立节点**，`#board` 本身（含 `board-head` 摘要条）永远留在顶栏 flex 流内，
    // 展开/收起不再把右侧命令按钮拽移位（此前是整块 `#board` 变 `position:absolute`）。
    const panel = el(doc, 'div', 'board-panel')
    panel.append(missing, viewBar, body, detail)
    if (mounted === true) {
      /*
       * 挂载模式（R3）：同一批节点**分挂**到侧边栏的两档里，`#board` 那份摘要条不建。
       *
       *   成员档 ← `members`（成员行 + 每人在手的单）
       *   任务图档 ← `missing`（缺 token 的告警）+ `viewBar`（分组/筛选）+ `graph`（依赖图）+ `detail`（选中详情）
       *
       * 为什么 `board-body` 不挂：它是"成员 | 图"左右分栏的容器，而两档是**互斥视图**，
       * 同时挂上去就成了两份并排（正是要消灭的"做两份"）。
       */
      mounts.members?.append(members)
      mounts.graph?.append(missing, viewBar, graph, detail)
    } else {
      root?.append(head, panel)
    }
    parts = {
      counts, bar, active, missing, viewBar, groupChips, filterChips,
      members, membersList, membersToggle, body, edges, canvas, fit, content, cards, detail, collapse, graphHint, panel,
    }
    setPalette(palette)
    // 初始状态也要**真的应用**：只改 `collapsed` 的初值、不 paint 的话，
    // 展开/收起的类名与隐藏属性都还停在"展开"上（R65 实测到：看板默认占 306px）。
    setCollapsed(collapsed)
    setMembersOpen(membersOpen)
    // 挂载模式下没有"上下分空间"这回事（两档互斥），窄视口收起成员栏的默认也就不适用。
    if (mounted !== true) applyNarrowDefault()
    observeSize()
  }

  /**
   * 窄视口默认**收起成员看板**（R46）。
   *
   * 为什么：窄档是"成员在上、图在下"的上下分空间，而真机 28 张单时成员区要 206px——
   * 图只剩 88px，缩放撞到 0.4 下限就把节点切在画布下面（R45 报的那 11 个节点就是它）。
   * 收起之后图拿回整块高度，**默认视图（全部）才装得下**。
   * 用户想看成员就点「展开」，那是他自己的选择（那时图会变小甚至可滚动，图头会说）。
   *
   * JS 里再写一遍断点是因为"默认值"没法用 CSS 表达（CSS 只能改样式，不能改 JS 的初始状态）。
   */
  function applyNarrowDefault() {
    if (!ready || membersUserSet) return
    const narrow = globalThis.matchMedia?.('(max-width: 1200px)')?.matches ?? false
    setMembersOpen(!narrow)
    globalThis.matchMedia?.('(max-width: 1200px)')?.addEventListener?.('change', (event) => {
      if (membersUserSet) return
      setMembersOpen(!event.matches)
    })
  }

  /** 成员看板开合（收起时列表 `display: none`，`clipped()` 会跳过没显示的行）。 */
  function setMembersOpen(open) {
    membersOpen = open === true
    if (!ready) return
    parts.members.classList.toggle('is-collapsed', !membersOpen)
    parts.membersToggle.textContent = membersOpen ? MEMBERS_TOGGLE_LABEL.open : MEMBERS_TOGGLE_LABEL.closed
    parts.membersToggle.setAttribute('aria-expanded', String(membersOpen))
    // 开合会改"图能分到多少空间"：ResizeObserver 盯着画布与成员栏，会自己重量重挑档位。
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
    chipNodes.clear()
    memberStateNodes.clear()
    memberRowNodes.clear()

    const rows = model.members.map((member) => ({ kind: 'member', member, tasks: member.tasks }))
    // 未分配的单也要有地方挂，否则"没人领的单"在左栏看不见（而它正是要处理的那种）。
    if (model.unowned.length > 0) rows.push({ kind: 'unowned', member: { id: null, name: '未分配', role: null, state: null }, tasks: model.unowned })

    for (const row of rows) {
      const item = el(doc, 'li', 'board-member')
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
      } else {
        item.setAttribute('aria-disabled', 'true')
      }
      const head = el(doc, 'div', 'board-member-head')
      head.append(el(doc, 'b', undefined, memberName))
      // R3：角色/状态**翻成中文**。看板原先直接印 `lead` / `idle`（原始状态码），
      // 而 R2 的侧边栏印的是「负责人 · 待命」。共用一份渲染之后只能有一份措辞——
      // 选中文：状态码是给程序看的，界面上印 `idle` 等于没给用户任何信息。
      const roleText = roleLabel(row.member.role)
      if (roleText !== '') head.append(el(doc, 'span', 'dim', roleText))
      // 状态是会变的那一半：留下来给 `refreshState()` 就地改文字，不必重建整块列表。
      const stateSpan = el(
        doc,
        'span',
        'dim',
        row.member.state === null || row.member.state === undefined ? '' : `· ${agentStateLabel(row.member.state)}`,
      )
      head.append(stateSpan)
      memberStateNodes.set(row.member.id ?? '__unowned__', stateSpan)
      // `aria-label` 要在名字/角色/状态都齐了之后拼：只报名字的话，读屏用户听不出
      // "这个人在干什么"，而那恰恰是这块列表的全部信息量。
      if (row.member.id !== null) {
        const parts = [memberName]
        if (roleText !== '') parts.push(roleText)
        const stateText = agentStateLabel(row.member.state)
        if (stateText !== '') parts.push(stateText)
        item.setAttribute('aria-label', parts.join(' · '))
      }
      // R76：花名册删掉之后，「点成员对话」的入口移到看板成员卡上——一个独立的小按钮，
      // 与「点成员选中看任务」分开，避免点谁就弹对话。
      if (row.member.id !== null && typeof options.onMemberPick === 'function') {
        const talk = el(doc, 'button', 'board-talk ghost')
        talk.type = 'button'
        talk.textContent = '💬'
        talk.title = `跟 ${row.member.name ?? row.member.id} 说句话`
        talk.setAttribute('aria-label', talk.title)
        talk.addEventListener('click', (event) => {
          event.stopPropagation()
          options.onMemberPick(row.member.id)
        })
        head.append(talk)
      }
      // 行既是"可点的"就该是"可敲的"：给了 `role="button"` + `tabindex` 却不响应
      // 回车/空格，等于对键盘用户撒谎（他 Tab 上来、按下去，什么也不发生）。
      const activate = () => {
        select({ kind: 'member', id: row.member.id })
        // R3：点成员行 → **也**通知外面（侧边栏里点谁就该聚焦谁）。
        //
        // ⚠️ 与 `onMemberPick` 是两件事，别合并：`onMemberPick` 是那个 💬 按钮，
        // 语义是"跟他说话"（开会话面板）；这里是"选中/聚焦"。
        // 这条分工是**用户拍板过的**（`docs/PLAN-game-agent.md` (d) 节）：
        // 列表=定位，点人=定位+开面板，回车=在已选中基础上开对话。别"顺手统一"。
        // 「未分配」那一行 `id === null`（它没有场景实体），不可聚焦。
        if (row.member.id !== null) options.onMemberSelect?.(row.member.id)
      }
      head.addEventListener('click', activate)
      if (row.member.id !== null) {
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
      item.append(head)

      const chips = el(doc, 'div', 'board-chips')
      for (const taskId of row.tasks) {
        const task = model.byId.get(taskId)
        if (task === undefined) continue
        const chip = el(doc, 'button', 'board-chip')
        if (selected !== null && selected.kind === 'task' && selected.id === task.id) chip.classList.add('is-selected')
        chip.type = 'button'
        // 状态用**色点**（与看板其它地方同一套语言），id 用短形式，完整信息在 `title`/`aria-label`
        // 与详情区里。28 张单的世界里，这一条决定了左栏要不要滚（见 `shortTaskId` 的注释）。
        chip.title = `${task.id} · ${task.title} · ${taskStatusLabel(task.displayStatus ?? task.status)}`
        chip.setAttribute('aria-label', chip.title)
        const chipDot = el(doc, 'i', 'board-dot')
        applyNodeColors(chipDot, task.displayStatus ?? task.status)
        chip.append(chipDot, el(doc, 'span', 'board-chip-id', shortTaskId(task.id)))
        // **已完成的单只留一个短标记**（R46）：真机 28 张里 22 张是 done，每个成员手上 5~7 张，
        // 全都画成"色点 + 号"会让左栏在 1227×804 这种尺寸下差 45px 装不下（clipped 报 2 行）。
        // 压小而不是隐藏：这些单仍然可点（点开照样能读产出），只是不再抢左栏的宽度。
        chip.classList.toggle('is-done', task.status === 'done')
        chip.addEventListener('click', (event) => {
          event.stopPropagation()
          select({ kind: 'task', id: task.id })
        })
        chips.append(chip)
        chipNodes.set(task.id, chip)
      }
      if (row.tasks.length === 0) chips.append(el(doc, 'span', 'dim', '（没有在手的单）'))
      item.append(chips)
      list.append(item)
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
    const fitted = fitGraphGeometry(layout, available, undefined, 'auto')
    geometry = fitted
    // 档位 + 缩放之后**还**装不下吗？（缩放有 0.4 的可读下限，真机 28 张单在 800px 宽下会触到）
    // 这种时候画布是可滚动的（有滚动条），但"可滚动"这件事要**说出来**，不能靠用户自己发现。
    const overflow = {
      x: Math.round(fitted.width * fitted.scale - available.width),
      y: Math.round(fitted.height * fitted.scale - available.height),
    }
    // 阈值 4px：1~2px 属于子像素取整/滚动条宽度，为它亮一条警告会让提示变成噪音。
    const overflowing = overflow.x > 4 || overflow.y > 4
    fitInfo = {
      preset: fitted.preset,
      scale: fitted.scale,
      orientation: fitted.orientation ?? 'horizontal',
      available,
      content: { width: fitted.width, height: fitted.height },
      overflow,
      overflowing,
    }
    lastFitSize = available
    if (parts.graphHint !== null) {
      parts.graphHint.hidden = !overflowing
      if (overflowing) {
        parts.graphHint.textContent = `（比可见区大 ${Math.max(0, overflow.x)}×${Math.max(0, overflow.y)}px，图内可滚动）`
      }
    }

    cards.textContent = ''
    cardNodes.clear()
    edgeLayer.textContent = ''
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
      path.setAttribute('class', statusOf.get(edge.from) === 'done' ? 'board-edge done' : 'board-edge')
      edgeLayer.append(path)
    }

    for (const node of layout.nodes) {
      const task = model.byId.get(node.id)
      const pos = fitted.nodes[node.id]
      if (task === undefined || pos === undefined) continue
      const card = el(doc, 'button', 'board-node')
      card.type = 'button'
      card.style.left = `${pos.x}px`
      card.style.top = `${pos.y}px`
      card.style.width = `${pos.w}px`
      card.style.height = `${pos.h}px`
      card.dataset.task = task.id
      const top = el(doc, 'div', 'board-node-top')
      top.append(el(doc, 'span', 'board-node-id', task.id))
      top.append(el(doc, 'span', 'board-node-owner dim', task.ownerName ?? '未分配'))
      const title = el(doc, 'div', 'board-node-title', task.title)
      const bar = el(doc, 'div', 'board-node-progress')
      const fill = el(doc, 'i', 'board-node-progress-fill')
      bar.append(fill)
      card.append(top, title, bar)
      if (task.requires.includes('review')) card.classList.add('needs-review')
      card.addEventListener('click', () => select({ kind: 'task', id: task.id }))
      cards.append(card)
      cardNodes.set(task.id, { card, fill })
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
    // 左栏成员行上的状态文字也要跟着走（成员**结构**没变时不重建列表）。
    for (const member of model.members) {
      const node = memberStateNodes.get(member.id)
      if (node !== undefined) node.textContent = member.state === null ? '' : `· ${agentStateLabel(member.state)}`
    }
    for (const task of model.tasks) {
      const entry = cardNodes.get(task.id)
      const chip = chipNodes.get(task.id)
      if (entry !== undefined) {
        const { card, fill } = entry
        card.dataset.status = task.displayStatus ?? task.status
        applyNodeColors(card, task.displayStatus ?? task.status)
        card.classList.toggle('is-done', task.status === 'done')
        card.classList.toggle('is-failed', task.status === 'failed')
        card.classList.toggle('is-selected', selected !== null && selected.kind === 'task' && selected.id === task.id)
        fill.style.width = `${Math.round(Math.min(1, Math.max(0, task.progress)) * 100)}%`
        card.title = `${task.id} · ${task.title} · ${taskStatusLabel(task.displayStatus ?? task.status)}`
      }
      if (chip !== undefined) {
        chip.dataset.status = task.displayStatus ?? task.status
        applyNodeColors(chip, task.displayStatus ?? task.status)
        // chip 上是"色点 + 短 id"，状态文字不在这里；完整描述挂在 `title`/`aria-label` 上。
        chip.title = `${task.id} · ${task.title} · ${taskStatusLabel(task.displayStatus ?? task.status)}`
        chip.setAttribute('aria-label', chip.title)
        chip.classList.toggle('is-done', task.status === 'done')
        // M7-3 双向高亮：点图里的方框 → 左栏成员那边同一张单也亮起来。
        chip.classList.toggle('is-selected', selected !== null && selected.kind === 'task' && selected.id === task.id)
      }
    }
  }

  // ── 三段：顶部计数 + 摘要进度条 + 底部详情 ─────────────────────────────────
  function renderCounts() {
    parts.counts.textContent = ''
    // 正在跑的单子：最多两条 + "还有 N 条"
    if (parts.active !== undefined && parts.active !== null) {
      parts.active.textContent = ''
      const running = (world?.tasks ?? []).filter((t) => t.status === 'in_progress')
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
  }

  function renderDetail() {
    const detail = parts.detail
    detail.textContent = ''
    if (selected === null) {
      detail.append(el(doc, 'span', 'dim', '点图里的方框（或左边的成员）看详情。连线的绿实线 = 前置已完成；橙色虚线框 = 这张单需要 review 能力。'))
      return
    }
    if (selected.kind === 'member') {
      const member = model.members.find((m) => m.id === selected.id)
      const label = member ?? { name: '未分配', role: null, state: null, tasks: model.unowned }
      detail.append(el(doc, 'b', undefined, label.name))
      if (label.role !== null && label.role !== undefined) detail.append(el(doc, 'span', 'dim', `· ${roleLabel(label.role)}`))
      if (label.state !== null && label.state !== undefined) detail.append(el(doc, 'span', 'dim', `· ${agentStateLabel(label.state)}`))
      detail.append(el(doc, 'span', undefined, `在手的单：${label.tasks.length === 0 ? '（没有）' : label.tasks.join('、')}`))
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
    detail.append(dot, el(doc, 'b', 'board-detail-id', task.id), el(doc, 'span', undefined, task.title))
    detail.append(el(doc, 'span', 'dim', `状态 ${taskStatusLabel(task.displayStatus ?? task.status)}`))
    detail.append(el(doc, 'span', 'dim', `执行者 ${task.ownerName ?? '未分配'}`))
    if (task.requires.length > 0) detail.append(el(doc, 'span', 'dim', `需要 ${task.requires.join('/')}`))
    // 参考图里那句 "Unlocks t2,t3"：**从 blockedBy 反向索引来**，不用新数据。
    detail.append(
      el(
        doc,
        'span',
        task.unlocks.length > 0 ? 'board-unlocks' : 'dim',
        task.unlocks.length > 0 ? `解锁了 ${task.unlocks.map((u) => u.id).join('、')}` : '没有解锁任何任务（它后面没有依赖它的单）',
      ),
    )
    if (task.blockedByTasks.length > 0) {
      detail.append(el(doc, 'span', 'dim', `被 ${task.blockedByTasks.map((b) => b.id).join('、')} 挡着`))
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
    if (!ready) return
    const total = allGroups.reduce((sum, g) => sum + g.total, 0)
    const unfinished = allGroups.reduce((sum, g) => sum + g.unfinished, 0)
    const groups = [{ id: 'all', name: '', total, unfinished }, ...allGroups]

    parts.groupChips.textContent = ''
    for (const group of groups) {
      const chip = el(doc, 'button', 'board-view-chip')
      chip.type = 'button'
      chip.textContent = groupViewLabel(group)
      const active = group.id === viewGroup
      chip.classList.toggle('is-active', active)
      chip.setAttribute('aria-pressed', String(active))
      chip.title = active ? '当前分组' : `只看 ${groupViewLabel(group)}`
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
    const stateKey = boardSignature(world, { group: viewGroup, filter: viewFilter })
    if (stateKey === lastState) {
      counters.skipped += 1
      return false
    }

    // 第二道闸门：折出数据（纯函数），比**结构**签名决定"重建"还是"就地改"。
    // 分组统计用**全量**（分组签上的数量与筛选无关），模型用**过滤后**的任务。
    allGroups = groupTasks(world.tasks, taskSetNames)
    const viewTasks = applyView(world.tasks, { group: viewGroup, filter: viewFilter })
    model = buildBoardModel({ ...world, tasks: viewTasks })
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
      model.unowned.join(',')

    if (structureKey === lastStructure) {
      lastState = stateKey
      counters.stateRefreshes += 1
      renderCounts()
      renderView()
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
    setMembersOpen,
    update,
    setPalette,
    setTaskSets,
    setCollapsed,
    /** R3：切到任务图档之后重挑几何（挂载模式下它常常是"数据变了但这档藏着"）。 */
    refreshGraph,
    select: (taskId) => select(taskId === null || taskId === undefined ? null : { kind: 'task', id: taskId }),
    selected: () => (selected === null ? null : selected.id ?? null),
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
      // 视图（R46）：当前分组/筛选、成员栏开合、一共几条流水线。
      view: { group: viewGroup, filter: viewFilter },
      viewSignature: viewSignature({ group: viewGroup, filter: viewFilter }),
      membersOpen,
      groups: allGroups.map((g) => ({ id: g.id, name: g.name, total: g.total, unfinished: g.unfinished })),
      visibleTasks: model?.tasks.length ?? 0,
    }),
    /** 只给测试/诊断：看板的模型与布局（DOM 层不导出别的）。 */
    model: () => model,
    layout: () => layout,
    geometry: () => geometry,
    unlocksIndex,
  }
}
