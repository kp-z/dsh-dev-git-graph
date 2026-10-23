/*
 * 侧边栏骨架（R2 建 → R3 收口 → R99 去 tab + 可折叠）—— **页面内的 `<aside>`**。
 *
 * ## 为什么是这个形态（决定别改）
 *
 * 1. **必须同文档**：列表点击要驱动的是 Phaser 相机（`scene2d.selectAgent`）。
 *    挂 DSH 右侧栏 tab 会让"点列表 → 动相机"变成跨文档消息——收益为负（见 `docs/RESEARCH-reuse.md` §1）。
 * 2. **两块是同一份数据的两种投影**，不是两个功能（`DESIGN-interaction.md` §4.2）。
 *
 * ## 本文件**不含任何渲染逻辑**
 *
 * 内容全部由 `board.js` 挂进来：
 *
 *   `createBoard({ mounts: sidebar.mounts() })` →  `renderMembers()` 落进「团队」区，
 *                                                 `renderGraph()` 落进「任务图」区。
 *
 * 曾有过一份 `renderAgentRow` / `renderGraph`（按状态分组的摘要），**已删**。
 * 理由就是用户点名的「避免同样的功能做两份」——留着它，同一批任务会有两套渲染，
 * 一处改了另一处不改，界面上就是两种真相。**别再加回来。**
 *
 * ## R99：为什么去掉页签、改成上下堆叠
 *
 * 用户原话：「不是分成两个 tab，这两个 tab 应该可以同时看到才对」。
 * 页签的隐含前提是"两块内容互斥"，但这里它们**不互斥**——看人时也想看任务图，
 * 而且"要切回来才能看到另一块"正是页签最烦人的地方（切走之后状态就看不见了）。
 *
 * ## ⚠️ 折叠会让两块容器变成 0×0（这是本文件最需要小心的地方）
 *
 * 依赖图的几何是**按容器实测尺寸**挑的。折叠侧边栏时两块容器宽高都是 0，
 * 这时去画会得到一张缩到 0.4 下限的废图；而"展开之后不重画"就会一直停在废图上。
 * 所以：**折叠时什么都不量，展开之后由 `onExpand` 触发一次重画**。
 *（同一个坑在 R3 换过一次位置：那时是 `hidden` 的页签，现在是折起来的侧边栏。）
 */

/** 元素工厂（三行函数，比跨模块导出一个更好的内聚边界）。 */
function el(doc, tag, className, text) {
  const node = doc.createElement(tag)
  if (className !== undefined) node.className = className
  if (text !== undefined) node.textContent = text
  return node
}

/**
 * 折叠状态的记忆键。
 *
 * 为什么要记住：用户折叠侧边栏是**为了看场景**，刷新一次又弹回来，他每次都得再点一下。
 * 用 `localStorage` 而不是服务端：这是**这台机器上这个人**的界面偏好，不是世界状态。
 */
const COLLAPSED_KEY = 'agentWorld.sidebarCollapsed'
/** R191：两块面板的排列方式：rows（上下）| columns（左右）。 */
const LAYOUT_KEY = 'agentWorld.panelLayout'
const ORDER_KEY = 'agentWorld.panelOrder'
/**
 * R181：**单块面板**的折叠记忆（任务 / Agent 列表各自可折叠）。
 *
 * 与整列折叠分开记：整列折叠是"我要看场景"，单块折叠是"这块我现在不看"——
 * 两者语义不同，合用一个键会让用户点哪块都变成整列收起。
 */
const PANEL_COLLAPSED_KEY = 'agentWorld.panelCollapsed'

/** 两块区域的标识（也是 DOM id 后缀）。 */
const REGIONS = [
  // R180：任务面板在上（后台任务 + 任务依赖树），Agent 列表在下。
  // 不再有左上角浮卡；所有团队/任务操作都收进这两块常驻侧边栏。
  { id: 'graph', title: '任务', icon: '☑' },
  { id: 'agents', title: '团队', icon: '◉' },
]

/**
 * 建侧边栏外壳。
 *
 * @param {object} options
 * @param {HTMLElement} options.root - `<aside id="sidebar">`
 * @param {boolean} [options.initialCollapsed] - 初始折叠态（缺省读 `localStorage`）
 * @param {(collapsed: boolean) => void} [options.onCollapseChange] - 折叠态变化
 * @param {() => void} [options.onExpand] - **展开之后**（已在下一帧，布局已落定）。
 *   依赖图必须在这个时机重挑几何——折叠期间量到的尺寸是 0。
 */
export function createSidebar(options = {}) {
  const doc = options.root?.ownerDocument ?? globalThis.document
  const root = options.root
  if (root === null || root === undefined || doc === null || doc === undefined) {
    // 没有容器就什么也不做（可选依赖的标准写法：静默无 UI，不做回退面板）。
    return createNullSidebar()
  }

  let collapsed = typeof options.initialCollapsed === 'boolean' ? options.initialCollapsed : readCollapsed()
  let layout = readLayout()
  let order = readOrder()
  /** R327：单块面板不再折叠——两块永远展开，只保留整列侧边栏的开合。 */
  const panelCollapsed = {}

  // ── 骨架（只建一次）─────────────────────────────────────────────────────────
  //
  // R116：**这里不再有自己的头**。原先侧边栏顶部有一条 `.sidebar-head`，里面放折叠开关——
  // 用户的原话是「侧边栏不是独立的个体，打开按钮应该在 header 里而不是单独一块」。
  // 开关现在住在 `header.topbar`（`index.html`），由 `main.js` 接线；
  // 侧边栏只负责"被折叠/展开"这个状态本身。
  root.textContent = ''
  const body = el(doc, 'div', 'sidebar-body')
  body.id = 'sidebar-body'

  /** 两块常驻区域：`<section role="region">` + 自己的标题 + **一行计数位**（R152）。 */
  const panels = {}
  const metas = {}
  const titleIds = {}
  const regionTitles = {}
  for (const region of REGIONS) {
    regionTitles[region.id] = region.title
    const panel = el(doc, 'section', `sidebar-panel sidebar-panel-${region.id}`)
    panel.id = `sidebar-panel-${region.id}`
    // `region`（而不是 `tabpanel`）：这两块**同时可见**，没有"选中的是哪一个"这回事。
    panel.setAttribute('role', 'region')
    const titleId = `sidebar-region-${region.id}`
    titleIds[region.id] = titleId
    /*
     * R152：标题与计数住在同一个 header 里。
     *
     * 为什么把计数位交给侧边栏、而不是让看板自己再写一行 `h3`：
     * 原来每块有**两层标题**（侧边栏的「团队」+ 看板里的「成员看板」），
     * 同一个意思写两遍，还各自占一行纵向空间。现在外壳只给一个位置，
     * 看板往里写数据（`9 人 · 3 忙碌`），标题不重复、也不多占一行。
     */
    const head = el(doc, 'header', 'sidebar-region-head')
    const title = el(doc, 'h2', 'sidebar-region-title', region.title)
    title.id = titleId
    const meta = el(doc, 'div', 'sidebar-region-meta')
    meta.id = `sidebar-region-meta-${region.id}`
    // 不加 `aria-live`：计数随世界持续变化，polite 播报会变成噪音。
    /*
     * R181：header 右侧多了一个**操作位**（Agent 面板的 ＋）和折叠开关。
     * 操作位留给外面接线（`mounts.agentsActions`），侧边栏自己不造按钮语义——
     * "新建任务"是 main.js 的业务，不是外壳的。
     */
    const actions = el(doc, 'div', 'sidebar-region-actions')
    actions.dataset.region = region.id
    head.append(title, meta)
    const handle = el(doc, 'button', 'aw-drag-handle', '⠿')
    handle.type = 'button'
    handle.draggable = true
    handle.title = '拖动排列'
    handle.setAttribute('aria-label', `拖动 ${region.title} 面板排列`)
    handle.addEventListener('dragstart', (event) => {
      dragId = region.id
      panel.classList.add('is-dragging')
      if (event.dataTransfer !== null && event.dataTransfer !== undefined) {
        event.dataTransfer.effectAllowed = 'move'
        try { event.dataTransfer.setData('text/plain', region.id) } catch (e) { /* 老浏览器 */ }
      }
    })
    handle.addEventListener('dragend', () => {
      dragId = null
      panel.classList.remove('is-dragging')
      body.removeAttribute('data-drop')
      for (const item of Object.values(panels)) item.classList?.remove('is-drop-target')
    })
    head.prepend(handle)
    panel.setAttribute('aria-labelledby', titleId)
    panel.addEventListener('dragover', (event) => {
      if (dragId === null || dragId === region.id) return
      event.preventDefault()
      const rect = panel.getBoundingClientRect()
      const dx = Math.abs(event.clientX - (rect.left + rect.width / 2))
      const dy = Math.abs(event.clientY - (rect.top + rect.height / 2))
      body.dataset.drop = dx > dy ? 'columns' : 'rows'
      panel.classList.add('is-drop-target')
    })
    panel.addEventListener('dragleave', () => panel.classList.remove('is-drop-target'))
    panel.addEventListener('drop', (event) => {
      if (dragId === null || dragId === region.id) return
      event.preventDefault()
      const rect = panel.getBoundingClientRect()
      const dx = Math.abs(event.clientX - (rect.left + rect.width / 2))
      const dy = Math.abs(event.clientY - (rect.top + rect.height / 2))
      const nextLayout = dx > dy ? 'columns' : 'rows'
      const after = nextLayout === 'columns'
        ? event.clientX > rect.left + rect.width / 2
        : event.clientY > rect.top + rect.height / 2
      arrange(dragId, region.id, nextLayout, after)
      dragId = null
      body.removeAttribute('data-drop')
      panel.classList.remove('is-drop-target')
    })
    panel.append(head)

    // R180：每块自己的内容容器。
    // R181：任务面板多出状态带（ribbon）与后台任务条（jobs）两个挂载位；
    // Agent 面板的成员列表单独一个容器，这样"折叠"只收起内容、不收起 header。
    const content = el(doc, 'div', 'sidebar-region-content')
    if (region.id === 'graph') {
      const ribbon = el(doc, 'div', 'aw-ribbon')
      ribbon.setAttribute('aria-hidden', 'true')
      const jobs = el(doc, 'div', 'aw-jobs')
      jobs.hidden = true
      const officialTasks = el(doc, 'div', 'sidebar-official-tasks')
      officialTasks.id = 'sidebar-official-tasks'
      const graphMount = el(doc, 'div', 'sidebar-task-graph')
      graphMount.id = 'sidebar-task-graph'
      content.append(actions, ribbon, jobs, officialTasks, graphMount)
      panels.graphMount = graphMount
      panels.ribbon = ribbon
      panels.jobs = jobs
      panels.officialTasks = officialTasks
      panels.graphActions = actions
    } else {
      const officialAgents = el(doc, 'div', 'sidebar-official-agents')
      officialAgents.id = 'sidebar-official-agents'
      const membersMount = el(doc, 'div', 'sidebar-members')
      content.append(actions, officialAgents, membersMount)
      panels.officialAgents = officialAgents
      panels.agentsMount = membersMount
      panels.agentsActions = actions
    }
    panel.append(content)
    body.append(panel)
    panels[region.id] = panel
    metas[region.id] = meta
  }
  root.append(body)

  /** R191：两种排列；全局 header 控制，不放在任何一个面板里。 */
  function setLayout(next) {
    layout = next === 'columns' ? 'columns' : 'rows'
    body.dataset.layout = layout
    root.dataset.layout = layout
    try { globalThis.localStorage?.setItem(LAYOUT_KEY, layout) } catch (e) { /* 记忆是便利，不是功能 */ }
    options.onLayoutChange?.(layout)
    return layout
  }
  let dragId = null
  setLayout(layout)
  applyOrder()

  /** R195：拖拽重排。orientation 由指针相对面板中心决定；after 决定插在目标前/后。 */
  function arrange(fromId, toId, nextLayout, after) {
    if (fromId === toId) return
    order = order.filter((id) => id !== fromId)
    const index = order.indexOf(toId)
    order.splice(index < 0 ? order.length : (after ? index + 1 : index), 0, fromId)
    setLayout(nextLayout)
    applyOrder()
    writeOrder(order)
  }

  function applyOrder() {
    // 只移动真正的 panel；graphActions/ribbon 等挂载位还在 panel 内部，不能被提到 body。
    const ids = order.filter((id) => panels[id]?.classList?.contains('sidebar-panel'))
    for (const id of ['graph', 'agents']) {
      if (!ids.includes(id) && panels[id] !== undefined) ids.push(id)
    }
    for (const id of ids) body.append(panels[id])
  }

  /**
   * R181：单块折叠（任务 / Agent 列表各自）。
   *
   * 只切 `.is-collapsed`：**不隐藏 header**，所以折叠之后仍看得到面板标题、
   * 计数和展开开关——"折叠"不等于"消失"。展开时回调 `onPanelExpand`，
   * 让看板重挑一次依赖图几何（折叠期间容器是 0×0，量出来的是废图）。
   */
  /** R327：保留 API 形状，但不再支持单块折叠（历史调用一律 no-op）。 */
  function setPanelCollapsed(id, next, silent = false) {
    void id; void next; void silent
    return false
  }

  /** 折叠：只切 class，宽度由 CSS 的 `--sidebar-w` 决定（引擎的 `Scale.RESIZE` 自己带画布跟）。 */
  function setCollapsed(next) {
    collapsed = next === true
    root.classList.toggle('is-collapsed', collapsed)
    /**
     * ⚠️ 列宽是**父元素**（`.app`）的 `grid-template-columns`，子元素改不了它。
     * 两个办法：`:has()` 选择器，或者在这里给父元素补一个 class。选后者——
     * `:has()` 在旧引擎里静默不生效（"折叠了但侧边栏没变窄"这种半坏最难查）。
     * 仍然**只改宽度变量**，不碰 `game.scale.resize()`（那会把真机缩放打回 1×）。
     */
    root.closest?.('.app')?.classList.toggle('is-sidebar-collapsed', collapsed)
    // R116：开关按钮在 header 里，**不在这个模块手上**——所以这里只广播状态，
    // 由 `onCollapseChange` 的接线去更新按钮的 `aria-expanded`（一处真相，两个消费者）。
    writeCollapsed(collapsed)
    options.onCollapseChange?.(collapsed)
    // ⚠️ 展开必须**等布局落定**再通知：同一帧里量到的高度还是折叠时的 0。
    //
    // 但**不能只靠 `requestAnimationFrame`**：rAF 在**后台标签页里完全不触发**
    //（`main.js` 的文件头就记过这条——这个面板的典型场景恰恰是"agent 在跑、人不一定在看"）。
    // 只挂 rAF 的话，"在后台展开侧边栏"会让依赖图一直是空的，而人切回来时
    // **没有任何东西会再触发重画**——图就那么空着，看起来像"这批单没有依赖"。
    //
    // 所以给一条兜底：rAF 走不到就用 setTimeout 顶一格（定时器在后台会被降频，但会跑）。
    if (collapsed !== true) {
      const win = doc.defaultView ?? globalThis
      let fired = false
      const fire = () => {
        if (fired) return
        fired = true
        options.onExpand?.()
      }
      if (typeof win.requestAnimationFrame === 'function') win.requestAnimationFrame(fire)
      // 120ms > 一帧；正常情况 rAF 先到，这条就是一次空跑的 `fired` 检查。
      win.setTimeout?.(fire, 120)
    }
    return collapsed
  }
  setCollapsed(collapsed)

  /**
   * 溢出判据（M7-9）：盒子必须落在「容器 ∩ 视口」里。
   *
   * 只判**横向**：纵向超出是滚动区自己的事（`.sidebar-body` 就是为此存在的），
   * 把纵向也算成溢出会让这个判据永远红。横向溢出才是真的"被裁掉看不见"。
   */
  function overflow(selector = '.board-member') {
    const nodes = [...root.querySelectorAll(selector)]
    const box = body.getBoundingClientRect()
    const view = doc.defaultView ?? globalThis
    const vw = view.innerWidth ?? 0
    const clipped = []
    for (const node of nodes) {
      const rect = node.getBoundingClientRect()
      const right = Math.min(box.right, vw)
      const left = Math.max(box.left, 0)
      const overBy = Math.round(Math.max(rect.right - right, left - rect.left))
      if (overBy > 1) clipped.push({ text: (node.textContent ?? '').slice(0, 24), overBy })
    }
    return { total: nodes.length, clipped, viewport: { w: vw, h: view.innerHeight ?? 0 } }
  }

  return {
    /** 给 `createBoard({ mounts })` 的两个容器。 */
    /**
     * 给 `createBoard({ mounts })` 的四块位置：
     * 两块内容容器 + 两块标题旁的计数位（R152）。
     */
    mounts: () => ({
      members: panels.agentsMount ?? panels.agents,
      graph: panels.graphMount ?? panels.graph,
      agentsMeta: metas.agents,
      graphMeta: metas.graph,
      officialTasks: panels.officialTasks ?? null,
      officialAgents: panels.officialAgents ?? null,
      /** R181：状态带 / 后台任务条 / 每块 header 的操作位。 */
      ribbon: panels.ribbon ?? null,
      jobs: panels.jobs ?? null,
      graphActions: panels.graphActions ?? null,
      agentsActions: panels.agentsActions ?? null,
    }),
    collapsed: () => collapsed,
    setCollapsed,
    toggle: () => setCollapsed(!collapsed),
    /** R181：单块折叠的读/写（main.js 不直接碰 DOM class）。 */
    layout: () => layout,
    order: () => [...order],
    setLayout,
    toggleLayout: () => setLayout(layout === 'columns' ? 'rows' : 'columns'),
    panelCollapsed: (id) => (id === undefined ? { ...panelCollapsed } : panelCollapsed[id] === true),
    setPanelCollapsed: () => false,
    overflow,
    /**
     * 诊断：折叠态、两块的高度（**折叠时高度应该是 0，这是预期**）、
     * 以及两块各自有多少内容（用来判"内容还在不在"）。
     */
    stats: () => ({
      collapsed,
      agentsHeight: Math.round(panels.agents.getBoundingClientRect().height),
      graphHeight: Math.round(panels.graph.getBoundingClientRect().height),
      agents: panels.agents.querySelectorAll('.board-member').length,
      taskNodes: panels.graph.querySelectorAll('.board-node').length,
      edges: panels.graph.querySelectorAll('.board-edge').length,
      /** R181：状态带的段数应当 == 任务数（验收判据之一）。 */
      ribbonSegments: panels.ribbon?.querySelectorAll('.aw-ribbon-seg').length ?? 0,
      collapsedPanels: { graph: false, agents: false },
      tablists: root.querySelectorAll('[role="tablist"]').length,
      visible: root.offsetParent !== null,
    }),
    root,
  }
}

/** R195：面板顺序记忆（默认任务在前、Agent 列表在后）。 */
function readOrder() {
  try {
    const parsed = JSON.parse(globalThis.localStorage?.getItem(ORDER_KEY) ?? 'null')
    if (Array.isArray(parsed)) {
      const ids = parsed.filter((id) => id === 'graph' || id === 'agents')
      if (ids.length === 2) return ids
    }
  } catch (e) { /* 坏数据回默认 */ }
  return ['graph', 'agents']
}

function writeOrder(value) {
  try { globalThis.localStorage?.setItem(ORDER_KEY, JSON.stringify(value)) } catch (e) { /* 便利不是功能 */ }
}

/** 读排列记忆（默认上下；坏数据也回上下）。 */
function readLayout() {
  try {
    const raw = globalThis.localStorage?.getItem(LAYOUT_KEY)
    return raw === 'columns' ? 'columns' : 'rows'
  } catch {
    return 'rows'
  }
}

/** 读折叠记忆（读不到就当展开——**默认看得见**比默认藏起来安全）。 */
function readCollapsed() {
  try {
    return globalThis.localStorage?.getItem(COLLAPSED_KEY) === '1'
  } catch {
    // 隐私模式/被策略禁掉时 `localStorage` 会抛。**展开**是安全默认值。
    return false
  }
}

/** 写折叠记忆（写不进去不影响功能，只是下次要重新点）。 */
function writeCollapsed(collapsed) {
  try {
    globalThis.localStorage?.setItem(COLLAPSED_KEY, collapsed === true ? '1' : '0')
  } catch {
    /* 同上：记忆是便利，不是功能。 */
  }
}

/** 没有容器时的空实现：接口同形，一律无操作（避免调用点到处判空）。 */
function createNullSidebar() {
  return {
    mounts: () => ({
      members: null, graph: null, agentsMeta: null, graphMeta: null,
      officialTasks: null, officialAgents: null, ribbon: null, jobs: null,
      graphActions: null, agentsActions: null,
    }),
    collapsed: () => false,
    setCollapsed: () => false,
    toggle: () => false,
    layout: () => 'rows',
    setLayout: () => 'rows',
    toggleLayout: () => 'rows',
    panelCollapsed: () => false,
    setPanelCollapsed: () => false,
    overflow: () => ({ total: 0, clipped: [], viewport: { w: 0, h: 0 } }),
    stats: () => ({
      collapsed: false, agentsHeight: 0, graphHeight: 0,
      agents: 0, taskNodes: 0, edges: 0, tablists: 0, visible: false,
      ribbonSegments: 0, collapsedPanels: { graph: false, agents: false },
    }),
    root: null,
  }
}

/** R181：读单块折叠记忆（读不到/坏数据都当展开）。 */
