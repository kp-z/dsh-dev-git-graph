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
 * · 它**不订阅** `scene3d.render()`（那条 60fps 的路），由数据事件驱动（`update(world)`）；
 * · `update()` 先比签名：**结构没变就不重建 DOM**，只有状态/进度变了就**就地改**几个
 *   class 与文本。这样"看板在，3D 不卡"是可解释的，而不是碰巧。
 *
 * ── 配色 ────────────────────────────────────────────────────────────────────
 *
 * 这里**没有一个十六进制色值**：token 由 `board-layout.js` 解析成色值后，写成
 * 根节点上的 CSS 自定义属性（`--board-*`），CSS 只管引用。缺 token 时**不设**该属性、
 * 并挂 `board-missing` / `board-missing-tokens`：一眼看出来（沿用"品红=缺东西"的口径），
 * 而不是静默退回一个看起来"设计就这样"的灰。
 */

import {
  BOARD_TOKENS,
  STATUS_TOKEN,
  TASK_STATUSES,
  boardSignature,
  buildBoardModel,
  describeTask,
  graphGeometry,
  layoutDependencyGraph,
  missingBoardTokens,
  resolveBoardColor,
  unlocksIndex,
} from './board-layout.js'

/**
 * 六态的中文标签。
 *
 * 与 `web/app.js` 的 `TASK_LABEL` 同源——那边是既有实现（工单板已经在用）。
 * **两处并存是债**：合到一份共享模块里要动 `app.js`，而 M7-1 只允许最小接线，
 * 留给 M7-7（搬到 DSH 侧栏 tab 时顺手合并）。这里不去 import `app.js`：那是入口文件，有副作用。
 */
const STATUS_LABEL = {
  pending: '待办',
  ready: '可领取',
  in_progress: '进行中',
  blocked: '受阻',
  done: '完成',
  failed: '失败',
}

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
  let model = null
  let layout = null
  let geometry = null
  let world = null
  /** 选中的东西：`{kind:'task'|'member', id}`。 */
  let selected = null
  let collapsed = false
  /** 重画统计（诊断用：能说清"看板到底重画了几次"）。 */
  const counters = { updates: 0, structureRebuilds: 0, stateRefreshes: 0, skipped: 0 }
  let lastStructure = null
  let lastState = null
  /** 卡片的 DOM 引用（就地更新用）：taskId → {node, ...}。 */
  const cardNodes = new Map()
  const chipNodes = new Map()
  /** 成员行里"状态文字"那个节点的引用：agentId → span。 */
  const memberStateNodes = new Map()

  // ── 骨架（只建一次）────────────────────────────────────────────────────────
  let parts = null
  if (ready) {
    root.classList.add('board')
    const head = el(doc, 'header', 'board-head')
    const title = el(doc, 'h2', undefined, '执行看板')
    const counts = el(doc, 'div', 'board-counts')
    const collapse = el(doc, 'button', 'ghost', '收起')
    collapse.type = 'button'
    collapse.title = '收起/展开看板（看板不参与 3D 渲染，收起只是为了腾地方）'
    collapse.addEventListener('click', () => setCollapsed(!collapsed))
    head.append(title, counts, collapse)
    counts.setAttribute('role', 'status')

    const missing = el(doc, 'div', 'board-missing-note')
    missing.hidden = true

    const body = el(doc, 'div', 'board-body')
    const members = el(doc, 'section', 'board-members')
    const membersList = el(doc, 'ul', 'board-member-list')
    members.append(el(doc, 'h3', undefined, '成员看板'), membersList)

    const graph = el(doc, 'section', 'board-graph')
    const graphHead = el(doc, 'h3', undefined, '任务依赖图')
    graphHead.append(el(doc, 'span', 'dim', '左 → 右：前置解锁后续'))
    const canvas = el(doc, 'div', 'board-canvas')
    const edges = svgEl(doc, 'svg')
    edges.setAttribute('class', 'board-edges')
    const cards = el(doc, 'div', 'board-cards')
    canvas.append(edges, cards)
    graph.append(graphHead, canvas)
    body.append(members, graph)

    const detail = el(doc, 'footer', 'board-detail')
    root.append(head, missing, body, detail)
    parts = { counts, missing, membersList, edges, canvas, cards, detail, collapse }
    setPalette(palette)
  }

  /** 把 token 写进 CSS 自定义属性（缺的不设，交给 `board-missing*` 看得见）。 */
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

  function setCollapsed(next) {
    collapsed = next
    if (!ready) return false
    parts.canvas.hidden = collapsed
    parts.membersList.hidden = collapsed
    parts.detail.hidden = collapsed
    parts.collapse.textContent = collapsed ? '展开' : '收起'
    return collapsed
  }

  // ── 三段：成员看板 ──────────────────────────────────────────────────────────
  function renderMembers() {
    const list = parts.membersList
    list.textContent = ''
    chipNodes.clear()
    memberStateNodes.clear()

    const rows = model.members.map((member) => ({ kind: 'member', member, tasks: member.tasks }))
    // 未分配的单也要有地方挂，否则"没人领的单"在左栏看不见（而它正是要处理的那种）。
    if (model.unowned.length > 0) rows.push({ kind: 'unowned', member: { id: null, name: '未分配', role: null, state: null }, tasks: model.unowned })

    for (const row of rows) {
      const item = el(doc, 'li', 'board-member')
      if (selected !== null && selected.kind === 'member' && selected.id === row.member.id) item.classList.add('active')
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
        chip.type = 'button'
        chip.title = `${task.id} · ${task.title}`
        chip.append(el(doc, 'span', 'board-chip-id', task.id), el(doc, 'span', 'dim', STATUS_LABEL[task.status] ?? task.status))
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
  function renderGraph() {
    const { edges: edgeLayer, cards, canvas } = parts
    cards.textContent = ''
    cardNodes.clear()
    edgeLayer.textContent = ''
    edgeLayer.setAttribute('width', String(geometry.width))
    edgeLayer.setAttribute('height', String(geometry.height))
    edgeLayer.setAttribute('viewBox', `0 0 ${geometry.width} ${geometry.height}`)
    canvas.style.width = `${geometry.width}px`
    canvas.style.height = `${geometry.height}px`
    cards.style.width = `${geometry.width}px`
    cards.style.height = `${geometry.height}px`

    const statusOf = new Map(model.tasks.map((t) => [t.id, t.status]))
    for (const edge of geometry.edges) {
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
      const pos = geometry.nodes[node.id]
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
        card.title = `${task.id} · ${task.title} · ${STATUS_LABEL[task.status] ?? task.status}`
      }
      if (chip !== undefined) {
        chip.dataset.status = task.status
        applyNodeColors(chip, task.status)
        const label = chip.lastElementChild
        if (label !== null) label.textContent = STATUS_LABEL[task.status] ?? task.status
      }
    }
  }

  // ── 三段：顶部计数 + 底部详情 ───────────────────────────────────────────────
  function renderCounts() {
    parts.counts.textContent = ''
    for (const status of TASK_STATUSES) {
      const count = model.counts[status] ?? 0
      if (count === 0 && status !== 'done') continue
      const chip = el(doc, 'span', 'board-count')
      const dot = el(doc, 'i', 'board-dot')
      applyNodeColors(dot, status)
      dot.classList.add('board-count-dot')
      chip.append(dot, el(doc, 'b', undefined, String(count)), el(doc, 'span', 'dim', STATUS_LABEL[status] ?? status))
      parts.counts.append(chip)
    }
    parts.counts.append(el(doc, 'span', 'board-count dim', `共 ${model.counts.total} 张`))
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
    detail.append(el(doc, 'span', 'dim', `状态 ${STATUS_LABEL[task.status] ?? task.status}`))
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
  }

  function select(next) {
    selected = next
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
    const stateKey = boardSignature(world)
    if (stateKey === lastState) {
      counters.skipped += 1
      return false
    }

    // 第二道闸门：折出数据（纯函数），比**结构**签名决定"重建"还是"就地改"。
    model = buildBoardModel(world)
    layout = layoutDependencyGraph(model.tasks)
    geometry = graphGeometry(layout)

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
      refreshState()
      renderDetail()
      return true
    }

    lastStructure = structureKey
    lastState = stateKey
    counters.structureRebuilds += 1
    renderCounts()
    renderMembers()
    renderGraph()
    refreshState()
    renderDetail()
    return true
  }

  return {
    ready,
    update,
    setPalette,
    setCollapsed,
    select: (taskId) => select(taskId === null || taskId === undefined ? null : { kind: 'task', id: taskId }),
    selected: () => (selected === null ? null : selected.id ?? null),
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
    }),
    /** 只给测试/诊断：看板的模型与布局（DOM 层不导出别的）。 */
    model: () => model,
    layout: () => layout,
    geometry: () => geometry,
    unlocksIndex,
  }
}
