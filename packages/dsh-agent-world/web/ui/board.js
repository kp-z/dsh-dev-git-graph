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

import { MEMBERS_TOGGLE_LABEL, VIEW_FILTERS_ORDER, VIEW_FILTER_LABEL, groupViewLabel, taskStatusLabel } from './labels.js'
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
 * @param {object} options
 * @param {HTMLElement} options.root - 容器（`#board`）。
 * @param {Record<string, string>} [options.palette] - 快照里的 token → 色值。
 * @param {(taskId: string|null) => void} [options.onSelect] - 选中变化（**M7-3 的双向高亮会挂这里**，本轮不接）。
 * @param {Document} [options.document]
 */
export function createBoard(options = {}) {
  const doc = options.document ?? globalThis.document
  const root = options.root
  /** 没有容器就退化成空实现：看板没了不该把面板带崩（俯视图还要看模拟）。 */
  const ready = root !== null && root !== undefined
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
    root.classList.add('board')
    const head = el(doc, 'header', 'board-head')
    const title = el(doc, 'h2', undefined, '执行看板')
    const counts = el(doc, 'div', 'board-counts')
    // R65：收起时不能只是"一条空进度条 + 几个数字"——把**正在跑的单子标题**摆出来，
    // 一眼看得出这个世界此刻在干什么（用户对看板的原话就是"一整条只有进度条和数字"）。
    const active = el(doc, 'div', 'board-active')
    // 收起时的"摘要条"：一条按状态分段的进度条（DESIGN 第三节：默认收起成计数 + 进度条）。
    // 它只在**收起**时看得见——展开时上半部分已经有完整的计数与依赖图。
    const bar = el(doc, 'div', 'board-bar')
    const collapse = el(doc, 'button', 'ghost', '展开')
    collapse.type = 'button'
    collapse.title = '展开/收起看板（看板不参与 3D 渲染，收起只是为了腾地方）'
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
    root.append(head, missing, viewBar, body, detail)
    parts = {
      counts, bar, active, missing, viewBar, groupChips, filterChips,
      members, membersList, membersToggle, body, edges, canvas, fit, content, cards, detail, collapse, graphHint,
    }
    setPalette(palette)
    // 初始状态也要**真的应用**：只改 `collapsed` 的初值、不 paint 的话，
    // 展开/收起的类名与隐藏属性都还停在"展开"上（R65 实测到：看板默认占 306px）。
    setCollapsed(collapsed)
    setMembersOpen(membersOpen)
    applyNarrowDefault()
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
      if (value === null) root.style.removeProperty(varName)
      else root.style.setProperty(varName, value)
    }
    for (const status of TASK_STATUSES) {
      const value = resolveBoardColor(palette, STATUS_TOKEN[status])
      const varName = `--board-status-${status}`
      if (value === null) root.style.removeProperty(varName)
      else root.style.setProperty(varName, value)
    }
    const missing = missingBoardTokens(palette)
    root.classList.toggle('board-missing-tokens', missing.length > 0)
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
    root.classList.toggle('is-collapsed', collapsed)
    parts.body.hidden = collapsed
    parts.detail.hidden = collapsed
    parts.collapse.textContent = collapsed ? '展开' : '收起'
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
      const head = el(doc, 'div', 'board-member-head')
      head.append(el(doc, 'b', undefined, row.member.name ?? row.member.id ?? '未分配'))
      if (row.member.role !== null && row.member.role !== undefined) head.append(el(doc, 'span', 'dim', row.member.role))
      // 状态是会变的那一半：留下来给 `refreshState()` 就地改文字，不必重建整块列表。
      const stateSpan = el(
        doc,
        'span',
        'dim',
        row.member.state === null || row.member.state === undefined ? '' : `· ${row.member.state}`,
      )
      head.append(stateSpan)
      memberStateNodes.set(row.member.id ?? '__unowned__', stateSpan)
      head.addEventListener('click', () => select({ kind: 'member', id: row.member.id }))
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
        chip.title = `${task.id} · ${task.title} · ${taskStatusLabel(task.status)}`
        chip.setAttribute('aria-label', chip.title)
        const chipDot = el(doc, 'i', 'board-dot')
        applyNodeColors(chipDot, task.status)
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
    // 按**可用空间**挑档位（四档几何，最后手段才是缩放）。纯函数，单测里算过。
    const fitted = fitGraphGeometry(layout, available)
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
  }

  /** 只有状态/进度/选中变了：就地改，不重建 DOM。 */
  function refreshState() {
    // 左栏成员行上的状态文字也要跟着走（成员**结构**没变时不重建列表）。
    for (const member of model.members) {
      const node = memberStateNodes.get(member.id)
      if (node !== undefined) node.textContent = member.state === null ? '' : `· ${member.state}`
    }
    for (const task of model.tasks) {
      const entry = cardNodes.get(task.id)
      const chip = chipNodes.get(task.id)
      if (entry !== undefined) {
        const { card, fill } = entry
        card.dataset.status = task.status
        applyNodeColors(card, task.status)
        card.classList.toggle('is-done', task.status === 'done')
        card.classList.toggle('is-failed', task.status === 'failed')
        card.classList.toggle('is-selected', selected !== null && selected.kind === 'task' && selected.id === task.id)
        fill.style.width = `${Math.round(Math.min(1, Math.max(0, task.progress)) * 100)}%`
        card.title = `${task.id} · ${task.title} · ${taskStatusLabel(task.status)}`
      }
      if (chip !== undefined) {
        chip.dataset.status = task.status
        applyNodeColors(chip, task.status)
        // chip 上是"色点 + 短 id"，状态文字不在这里；完整描述挂在 `title`/`aria-label` 上。
        chip.title = `${task.id} · ${task.title} · ${taskStatusLabel(task.status)}`
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
    }
    // 摘要条：一条按状态分段的横条（段宽 = 该状态的占比）。收起时它就是"离目标还有多远"。
    parts.bar.textContent = ''
    const total = Math.max(1, model.counts.total)
    for (const status of TASK_STATUSES) {
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
      if (label.role !== null && label.role !== undefined) detail.append(el(doc, 'span', 'dim', `· ${label.role}`))
      if (label.state !== null && label.state !== undefined) detail.append(el(doc, 'span', 'dim', `· ${label.state}`))
      detail.append(el(doc, 'span', undefined, `在手的单：${label.tasks.length === 0 ? '（没有）' : label.tasks.join('、')}`))
      return
    }

    const task = describeTask(model, selected.id)
    if (task === null) {
      detail.append(el(doc, 'span', 'dim', '这张单已经不在世界上了（世界重开过？）。'))
      return
    }
    const dot = el(doc, 'i', 'board-dot')
    applyNodeColors(dot, task.status)
    dot.classList.add('board-count-dot')
    detail.append(dot, el(doc, 'b', 'board-detail-id', task.id), el(doc, 'span', undefined, task.title))
    detail.append(el(doc, 'span', 'dim', `状态 ${taskStatusLabel(task.status)}`))
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
    detail.append(renderReadPanel(summarizeTaskOutput(task)))
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
  function renderReadPanel(summary) {
    const box = el(doc, 'div', outputExpanded ? 'board-read is-expanded' : 'board-read')
    if (!summary.hasContent) {
      // 没有产出也要有话说：空白会让人以为面板坏了（真机上很多早期单确实没有 output）。
      box.append(el(doc, 'span', 'dim board-read-empty', summary.note ?? '这张单没有产出。'))
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
      if (model === null || collapsed) return
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
  function update(nextWorld) {
    counters.updates += 1
    world = nextWorld
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
