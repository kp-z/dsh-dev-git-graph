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

/** 两块区域的标识（也是 DOM id 后缀）。 */
const REGIONS = [
  { id: 'agents', title: '团队' },
  { id: 'graph', title: '任务图' },
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

  // ── 骨架（只建一次）─────────────────────────────────────────────────────────
  root.textContent = ''
  const head = el(doc, 'div', 'sidebar-head')
  const toggle = el(doc, 'button', 'sidebar-toggle', '团队与任务')
  toggle.type = 'button'
  toggle.id = 'sidebar-toggle'
  head.append(toggle)
  const body = el(doc, 'div', 'sidebar-body')
  body.id = 'sidebar-body'

  /** 两块常驻区域：`<section role="region">` + 自己的标题（不再是 tabpanel）。 */
  const panels = {}
  const titleIds = {}
  for (const region of REGIONS) {
    const panel = el(doc, 'section', `sidebar-panel sidebar-panel-${region.id}`)
    panel.id = `sidebar-panel-${region.id}`
    // `region`（而不是 `tabpanel`）：这两块**同时可见**，没有"选中的是哪一个"这回事。
    panel.setAttribute('role', 'region')
    const titleId = `sidebar-region-${region.id}`
    titleIds[region.id] = titleId
    const title = el(doc, 'h2', 'sidebar-region-title', region.title)
    title.id = titleId
    panel.setAttribute('aria-labelledby', titleId)
    panel.append(title)
    body.append(panel)
    panels[region.id] = panel
  }
  root.append(head, body)

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
    toggle.setAttribute('aria-expanded', String(collapsed !== true))
    toggle.setAttribute('aria-controls', 'sidebar-body')
    toggle.title = collapsed ? '展开侧边栏' : '折叠侧边栏'
    toggle.setAttribute('aria-label', toggle.title)
    toggle.textContent = collapsed ? '‹' : '›'
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

  toggle.addEventListener('click', () => setCollapsed(!collapsed))

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
    mounts: () => ({ members: panels.agents, graph: panels.graph }),
    collapsed: () => collapsed,
    setCollapsed,
    toggle: () => setCollapsed(!collapsed),
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
      tablists: root.querySelectorAll('[role="tablist"]').length,
      visible: root.offsetParent !== null,
    }),
    root,
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
    mounts: () => ({ members: null, graph: null }),
    collapsed: () => false,
    setCollapsed: () => false,
    toggle: () => false,
    overflow: () => ({ total: 0, clipped: [], viewport: { w: 0, h: 0 } }),
    stats: () => ({
      collapsed: false, agentsHeight: 0, graphHeight: 0,
      agents: 0, taskNodes: 0, edges: 0, tablists: 0, visible: false,
    }),
    root: null,
  }
}
