/*
 * 侧边栏骨架（R2 / PLAN §二(a)）—— **页面内的 `<aside>`，不是 DSH 右侧栏 tab**。
 *
 * ## 为什么是这个形态（决定别改）
 *
 * 1. **必须同文档**：列表点击要驱动的是 Phaser 相机（`scene2d.selectAgent`）。
 *    挂 DSH tab 会让"点列表 → 动相机"变成跨文档消息——收益为负（见 `docs/RESEARCH-reuse.md` §1）。
 * 2. **复用看板的渲染语言，不重写**：`.board-member*` 的 CSS（`components.css:918-975`）
 *    与 `renderMembers()` 的行结构（`board.js:363`）已经是"名字 · 角色 · 状态 · 工单"这一套。
 *    本轮（R2）先按同一套结构**只读地**画出来；R3 再把看板的 `renderMembers()` 搬进来，
 *    那时**删掉这里的 `renderAgentRow`**，改成"容器由外部给"，而不是留两份。
 *    （这条写在代码里，因为"两份渲染"是最容易悄悄发生的违约。）
 * 3. **两档 = 同一份数据的两种投影**，不是两个功能（`DESIGN-interaction.md` §4.2）。
 *    所以两档共用**同一张卡片构造函数**与**同一个点击回调**。
 *
 * ## 本轮的范围（先只读）
 *
 * - 不做聚焦（R4 才接 `focusAgent`）——但点击回调**已经按最终形态**签名（`onSelect(agentId)`），
 *   R4 只需在 `main.js` 里把参数接进 `scene2d.selectAgent`，本文件一行不改。
 * - 不搬看板、不改 header、不碰 `main.js` 的渲染路径（那三处另一个 Agent 正在改）。
 */

import { agentStateLabel, roleLabel, taskStatusLabel } from './labels.js'

/** 元素工厂（与 `board.js` 同一个形状；各处各一份三行函数，比跨模块导出更有内聚性）。 */
function el(doc, tag, className, text) {
  const node = doc.createElement(tag)
  if (className !== undefined) node.className = className
  if (text !== undefined) node.textContent = text
  return node
}

/** 两个视图的标识（也是 `role="tab"` 的 id 后缀）。 */
const VIEWS = [
  { id: 'agents', title: 'Agent 列表' },
  { id: 'graph', title: '任务流程图' },
]

/**
 * 建侧边栏。
 *
 * @param {object} options
 * @param {HTMLElement} options.root - `<aside id="sidebar">`
 * @param {(agentId: string) => void} [options.onSelect] - 点一行 Agent（R4 接 `focusAgent`）
 * @param {string} [options.initialView] - 初始视图（`agents` | `graph`）
 */
export function createSidebar(options = {}) {
  const doc = options.root?.ownerDocument ?? globalThis.document
  const root = options.root
  if (root === null || root === undefined || doc === null || doc === undefined) {
    // 没有容器就什么也不做（可选依赖的标准写法：静默无 UI，不做回退面板）。
    return createNullSidebar()
  }

  let view = VIEWS.some((v) => v.id === options.initialView) ? options.initialView : VIEWS[0].id
  /** 上一次渲染的结构签名：结构没变就不重建 DOM（世界每秒推十几次事件）。 */
  let lastKey = null
  let lastWorld = null
  /** agentId → 行节点上的状态文字（就地改，不重建）。 */
  const stateNodes = new Map()
  const rowNodes = new Map()

  // ── 骨架（只建一次）─────────────────────────────────────────────────────────
  root.textContent = ''
  const head = el(doc, 'div', 'sidebar-head')
  const tabs = el(doc, 'div', 'sidebar-tabs')
  tabs.setAttribute('role', 'tablist')
  tabs.setAttribute('aria-label', '侧边栏视图')
  head.append(tabs)
  const body = el(doc, 'div', 'sidebar-body')
  const agentsPanel = el(doc, 'div', 'sidebar-panel')
  agentsPanel.id = 'sidebar-panel-agents'
  agentsPanel.setAttribute('role', 'tabpanel')
  const graphPanel = el(doc, 'div', 'sidebar-panel')
  graphPanel.id = 'sidebar-panel-graph'
  graphPanel.setAttribute('role', 'tabpanel')
  graphPanel.hidden = true
  const agentList = el(doc, 'ul', 'board-member-list sidebar-agents')
  agentsPanel.append(agentList)
  const graphList = el(doc, 'div', 'sidebar-graph')
  graphPanel.append(graphList)
  body.append(agentsPanel, graphPanel)
  root.append(head, body)

  const tabNodes = new Map()
  for (const entry of VIEWS) {
    const tab = el(doc, 'button', 'sidebar-tab', entry.title)
    tab.type = 'button'
    tab.id = `sidebar-tab-${entry.id}`
    tab.setAttribute('role', 'tab')
    tab.setAttribute('aria-controls', `sidebar-panel-${entry.id}`)
    tab.addEventListener('click', () => setView(entry.id))
    tabs.append(tab)
    tabNodes.set(entry.id, tab)
  }

  /** 切档：只改可见性与 `aria-selected`，数据不动（同一份数据两种投影）。 */
  function setView(next) {
    if (next !== 'agents' && next !== 'graph') return view
    view = next
    for (const entry of VIEWS) {
      const tab = tabNodes.get(entry.id)
      const active = entry.id === view
      tab.classList.toggle('is-active', active)
      tab.setAttribute('aria-selected', active === true ? 'true' : 'false')
      const panel = entry.id === 'agents' ? agentsPanel : graphPanel
      panel.hidden = active !== true
    }
    // 切到任务图时可能还没有内容（本轮只读，数据来自同一次 `update`）。
    if (lastWorld !== null) render(lastWorld.world, lastWorld.meta, true)
    return view
  }
  setView(view)

  /**
   * 一行 Agent：**名字 · 角色 · 状态 · 当前工单**。
   *
   * 结构与 `board.js:374-405` 的成员卡一致（`.board-member` / `.board-member-head`），
   * 这样 R3 搬过来时**外观不用改**，只把这份实现删掉换成共享的那份。
   * ⚠️ **卡内不放任何按钮**：动作属于检视面板，列表只承载"选中/聚焦"（DESIGN §4.1 / A4）。
   */
  function renderAgentRow(agent) {
    const item = el(doc, 'li', 'board-member sidebar-agent')
    item.dataset.agentId = agent.id
    const head = el(doc, 'div', 'board-member-head')
    head.append(el(doc, 'b', undefined, agent.name ?? agent.id))
    const role = roleLabel(agent.role)
    if (role !== '') head.append(el(doc, 'span', 'dim', role))
    const stateSpan = el(doc, 'span', 'dim', agentStateLabel(agent.state))
    head.append(stateSpan)
    stateNodes.set(agent.id, stateSpan)
    item.append(head)
    // 当前工单：没有就留空（`null` 时整块不出现，不留"（无）"这种噪声）。
    const task = currentTaskOf(agent)
    if (task !== null) {
      const line = el(doc, 'div', 'sidebar-agent-task')
      line.title = `${task.id} · ${task.title ?? ''}`
      line.append(el(doc, 'span', 'sidebar-agent-task-id', shortTaskId(task.id)), el(doc, 'span', 'dim', task.title ?? ''))
      item.append(line)
    }
    item.addEventListener('click', () => options.onSelect?.(agent.id))
    // 整卡可点；键盘可达（列表项不是原生按钮，所以要自己给 tab 语义）。
    item.tabIndex = 0
    item.setAttribute('role', 'button')
    item.setAttribute('aria-label', `${agent.name ?? agent.id} · ${role} · ${agentStateLabel(agent.state)}`)
    item.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter' && event.key !== ' ') return
      event.preventDefault()
      options.onSelect?.(agent.id)
    })
    return item
  }

  /** 一个 agent 当前在手的单（`task.owner === agent.id` 且未完成）。 */
  function currentTaskOf(agent) {
    const tasks = lastWorld?.world?.tasks
    if (Array.isArray(tasks) !== true) return null
    return tasks.find((task) => task.owner === agent.id && task.status !== 'done' && task.status !== 'failed') ?? null
  }

  /** 任务图（本轮**只读摘要**；真正的依赖图由 R3 从看板搬进来，不在这里重画一份）。 */
  function renderGraph(world) {
    graphList.textContent = ''
    const tasks = Array.isArray(world?.tasks) ? world.tasks : []
    if (tasks.length === 0) {
      graphList.append(el(doc, 'p', 'sidebar-empty', '这个世界还没有工单'))
      return
    }
    const byStatus = new Map()
    for (const task of tasks) {
      const status = task.status ?? 'pending'
      const bucket = byStatus.get(status) ?? []
      bucket.push(task)
      byStatus.set(status, bucket)
    }
    for (const [status, bucket] of byStatus) {
      const group = el(doc, 'section', 'sidebar-graph-group')
      const title = el(doc, 'h3', undefined, `${taskStatusLabel(status)} · ${bucket.length}`)
      group.append(title)
      const list = el(doc, 'ul', 'board-member-list')
      for (const task of bucket) {
        const row = el(doc, 'li', 'board-member sidebar-task')
        const head = el(doc, 'div', 'board-member-head')
        const owner = world?.agents?.find((a) => a.id === task.owner) ?? null
        head.append(
          el(doc, 'b', undefined, task.title ?? task.id),
          el(doc, 'span', 'dim', owner === null ? '未分配' : owner.name ?? owner.id),
        )
        row.append(head)
        list.append(row)
      }
      group.append(list)
      graphList.append(group)
    }
  }

  /**
   * 结构签名：agent/task 的**结构**没变就不重建行，只就地改状态文字。
   *
   * 任务图的行上印着 `title` 与 owner 的名字，所以这两样也进签名——
   * 少了它们，"改名/换人"这类改动会被当成"结构没变"而不重画。
   */
  function signatureOf(world) {
    const agents = Array.isArray(world?.agents) ? world.agents : []
    const tasks = Array.isArray(world?.tasks) ? world.tasks : []
    const agentPart = agents.map((a) => `${a.id}:${a.name}:${a.role}`).join(',')
    const taskPart = tasks.map((t) => `${t.id}:${t.owner ?? ''}:${t.status}:${t.title ?? ''}`).join(',')
    return `${agents.length}|${agentPart}|${taskPart}`
  }

  /**
   * 收一份世界，画出来。**签名没变就直接返回**（世界每秒推十几次事件，
   * 而"没人换状态"的那种帧是多数——`board.js` 的 `update()` 是同一条纪律）。
   *
   * ⚠️ 任务图**也在这条签名后面**：它原来在签名判断之前就重画，等于每个数据事件
   * 都重建一遍任务 DOM——列表节流了、图没节流，那种"一半做了节流"的实现比全不做更糟
   *（你以为省下来的开销还在花，只是没人量到它）。
   */
  function render(world, meta, force = false) {
    lastWorld = { world, meta }
    if (world === null || world === undefined) return
    const key = signatureOf(world)
    if (force !== true && key === lastKey) {
      // 结构没变：状态文字仍要跟上（状态变不进签名，它是最常变的那一半）。
      for (const agent of world.agents ?? []) {
        const node = stateNodes.get(agent.id)
        const next = agentStateLabel(agent.state)
        if (node !== undefined && node.textContent !== next) node.textContent = next
      }
      return
    }
    lastKey = key
    renderGraph(world)
    agentList.textContent = ''
    stateNodes.clear()
    rowNodes.clear()
    for (const agent of Array.isArray(world.agents) ? world.agents : []) {
      const row = renderAgentRow(agent)
      rowNodes.set(agent.id, row)
      agentList.append(row)
    }
    if (rowNodes.size === 0) agentList.append(el(doc, 'li', 'sidebar-empty', '还没有 agent'))
    // 侧边栏把舞台挤窄 → 引擎的 `Scale.RESIZE` 自己跟（**不要**手调 `game.scale.resize()`）。
    return undefined
  }

  /**
   * 溢出判据（M7-9）：每个元素的盒子必须落在「容器 ∩ 视口」里。
   *
   * 只判**横向**：纵向超出是滚动区自己的事（`.sidebar-body` 就是为此存在的），
   * 把纵向也算成溢出会让这个判据永远红。横向溢出才是真的"被裁掉看不见"。
   *
   * @param {string} [selector] - 要量的元素（默认一行 Agent）
   * @returns {{total: number, clipped: Array<{text: string, overBy: number}>, viewport: {w: number, h: number}}}
   */
  function overflow(selector = '.sidebar-agent') {
    const nodes = [...root.querySelectorAll(selector)]
    const box = body.getBoundingClientRect()
    const view = doc.defaultView ?? globalThis
    const vw = view.innerWidth ?? 0
    const clipped = []
    for (const node of nodes) {
      const rect = node.getBoundingClientRect()
      // 右边界取「滚动容器」与「视口」的较窄者；左边界同理。
      const right = Math.min(box.right, vw)
      const left = Math.max(box.left, 0)
      const overBy = Math.round(Math.max(rect.right - right, left - rect.left))
      if (overBy > 1) clipped.push({ text: (node.textContent ?? '').slice(0, 24), overBy })
    }
    return { total: nodes.length, clipped, viewport: { w: vw, h: view.innerHeight ?? 0 } }
  }

  return {
    /** 外壳每帧/每个数据事件调一次；内部按签名自节流。 */
    update: (world, meta) => render(world, meta),
    view: () => view,
    setView,
    overflow,
    /** 诊断门面用：当前渲染了几行、有没有被裁掉。 */
    stats: () => ({
      view,
      agents: rowNodes.size,
      rows: agentList.childElementCount,
      visible: root.offsetParent !== null,
    }),
    root,
  }
}

/** 没有容器时的空实现：接口同形，一律无操作（避免调用点到处判空）。 */
function createNullSidebar() {
  return {
    update: () => undefined,
    view: () => null,
    setView: () => null,
    overflow: () => ({ total: 0, clipped: [], viewport: { w: 0, h: 0 } }),
    stats: () => ({ view: null, agents: 0, rows: 0, visible: false }),
    root: null,
  }
}

/** 任务 id 的短形式（`task-12` → `#12`；取不到数字就原样）。 */
function shortTaskId(taskId) {
  const match = /(\d+)$/.exec(String(taskId ?? ''))
  return match === null ? String(taskId ?? '') : `#${match[1]}`
}
