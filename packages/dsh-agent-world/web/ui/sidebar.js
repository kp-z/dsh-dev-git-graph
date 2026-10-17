/*
 * 侧边栏骨架（R2 建 → R3 收口）—— **页面内的 `<aside>`，不是 DSH 右侧栏 tab**。
 *
 * ## 为什么是这个形态（决定别改）
 *
 * 1. **必须同文档**：列表点击要驱动的是 Phaser 相机（`scene2d.selectAgent`）。
 *    挂 DSH tab 会让"点列表 → 动相机"变成跨文档消息——收益为负（见 `docs/RESEARCH-reuse.md` §1）。
 * 2. **两档 = 同一份数据的两种投影**，不是两个功能（`DESIGN-interaction.md` §4.2）。
 *
 * ## R3 收口：这里**不再有任何渲染逻辑**
 *
 * 本文件只负责"两块容器 + 一个页签条"。内容全部由 `board.js` 挂进来：
 *
 *   `createBoard({ mounts: sidebar.mounts() })` →  `renderMembers()` 落进 Agent 档，
 *                                                 `renderGraph()` 落进任务图档。
 *
 * 上一轮那份 `renderAgentRow` / `renderGraph`（按状态分组的摘要）**已经删掉**。
 * 删的理由就是用户点名的「避免同样的功能做两份」——留着它，同一批任务会有两套渲染，
 * 一处改了另一处不改，界面上就是两种真相。**别再加回来。**
 */

/** 元素工厂（三行函数，比跨模块导出一个更好的内聚边界）。 */
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
 * 建侧边栏外壳。
 *
 * @param {object} options
 * @param {HTMLElement} options.root - `<aside id="sidebar">`
 * @param {string} [options.initialView] - 初始视图（`agents` | `graph`）
 * @param {(view: string) => void} [options.onViewChange] - 切档后通知（看板据此重量依赖图：
 *   档隐藏时它的画布宽高是 0，画出来的几何是废的，必须在**可见之后**重挑档位）
 */
export function createSidebar(options = {}) {
  const doc = options.root?.ownerDocument ?? globalThis.document
  const root = options.root
  if (root === null || root === undefined || doc === null || doc === undefined) {
    // 没有容器就什么也不做（可选依赖的标准写法：静默无 UI，不做回退面板）。
    return createNullSidebar()
  }

  let view = VIEWS.some((v) => v.id === options.initialView) ? options.initialView : VIEWS[0].id

  // ── 骨架（只建一次）─────────────────────────────────────────────────────────
  root.textContent = ''
  const head = el(doc, 'div', 'sidebar-head')
  const tabs = el(doc, 'div', 'sidebar-tabs')
  tabs.setAttribute('role', 'tablist')
  tabs.setAttribute('aria-label', '侧边栏视图')
  head.append(tabs)
  const body = el(doc, 'div', 'sidebar-body')
  const agentsPanel = el(doc, 'div', 'sidebar-panel sidebar-panel-agents')
  agentsPanel.id = 'sidebar-panel-agents'
  agentsPanel.setAttribute('role', 'tabpanel')
  const graphPanel = el(doc, 'div', 'sidebar-panel sidebar-panel-graph')
  graphPanel.id = 'sidebar-panel-graph'
  graphPanel.setAttribute('role', 'tabpanel')
  graphPanel.hidden = true
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

  /** 切档：只改可见性与 `aria-selected`（数据由看板那边一份渲染，这里不动）。 */
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
    // 藏在 `hidden` 里的容器量出来是 0×0 —— 依赖图的几何必须**在可见之后**重挑。
    options.onViewChange?.(view)
    return view
  }
  setView(view)

  /**
   * 溢出判据（M7-9）：盒子必须落在「容器 ∩ 视口」里。
   *
   * 只判**横向**：纵向超出是滚动区自己的事（`.sidebar-body` 就是为此存在的），
   * 把纵向也算成溢出会让这个判据永远红。横向溢出才是真的"被裁掉看不见"。
   */
  function overflow(selector = '.board-member') {
    const nodes = [...root.querySelectorAll(selector)]
    const box = body.getBoundingClientRect()
    const view2 = doc.defaultView ?? globalThis
    const vw = view2.innerWidth ?? 0
    const clipped = []
    for (const node of nodes) {
      const rect = node.getBoundingClientRect()
      const right = Math.min(box.right, vw)
      const left = Math.max(box.left, 0)
      const overBy = Math.round(Math.max(rect.right - right, left - rect.left))
      if (overBy > 1) clipped.push({ text: (node.textContent ?? '').slice(0, 24), overBy })
    }
    return { total: nodes.length, clipped, viewport: { w: vw, h: view2.innerHeight ?? 0 } }
  }

  return {
    /** 给 `createBoard({ mounts })` 的两个容器。 */
    mounts: () => ({ members: agentsPanel, graph: graphPanel }),
    view: () => view,
    setView,
    overflow,
    /** 诊断门面用：当前档位、两档里各有多少内容。 */
    stats: () => ({
      view,
      agents: agentsPanel.querySelectorAll('.board-member').length,
      taskNodes: graphPanel.querySelectorAll('.board-node').length,
      edges: graphPanel.querySelectorAll('.board-edge').length,
      visible: root.offsetParent !== null,
    }),
    root,
  }
}

/** 没有容器时的空实现：接口同形，一律无操作（避免调用点到处判空）。 */
function createNullSidebar() {
  return {
    mounts: () => ({ members: null, graph: null }),
    view: () => null,
    setView: () => null,
    overflow: () => ({ total: 0, clipped: [], viewport: { w: 0, h: 0 } }),
    stats: () => ({ view: null, agents: 0, taskNodes: 0, edges: 0, visible: false }),
    root: null,
  }
}
