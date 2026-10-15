/*
 * 右侧抽屉（R32）—— 花名册 / 工单两个"页"，**对话面板是同一个抽屉的另一页**。
 *
 * ── 为什么是抽屉而不是固定侧栏 ────────────────────────────────────────────────
 *
 * 固定侧栏永远占着 320px，把场景挤小——而场景才是这个产品的主角（DESIGN 第三节）。
 * 抽屉浮在场景之上（玻璃），可以整块收起；收起时场景是满幅的。
 *
 * ── 一件事只有一处实现 ──────────────────────────────────────────────────────
 *
 * "哪个页在前 / 开着还是关着"由这里唯一决定：`setPage()` / `toggle()`，
 * 别人（顶栏按钮、花名册点击）都只调这两个方法。两块代码各自 `classList.toggle` 的话，
 * 状态迟早会互相打架（表现为"点了打不开"或两个页同时露出来）。
 */

/**
 * 建抽屉。
 *
 * @param {object} options
 * @param {HTMLElement} options.root - 抽屉容器（内含 `.drawer-tabs` 与两个 `.drawer-page`）。
 * @param {(open: boolean) => void} [options.onToggle] - 状态变化（顶栏按钮要跟着亮）。
 * @param {Document} [options.document]
 */
export function createDrawer(options) {
  const doc = options.document ?? globalThis.document
  const root = options.root
  const ready = root !== null && root !== undefined
  let open = true
  let page = 'roster'

  const pages = ready ? [...root.querySelectorAll('.drawer-page')] : []
  const tabs = ready ? [...root.querySelectorAll('.drawer-tab')] : []

  function paint() {
    if (!ready) return
    root.classList.toggle('is-open', open)
    root.classList.toggle('is-closed', !open)
    for (const tab of tabs) {
      const active = tab.dataset.page === page
      tab.classList.toggle('active', active)
      tab.setAttribute('aria-selected', String(active))
    }
    for (const section of pages) section.hidden = section.dataset.page !== page
    options.onToggle?.(open)
  }

  if (ready) {
    for (const tab of tabs) {
      tab.addEventListener('click', () => setPage(tab.dataset.page))
    }
    paint()
  }

  /** 换页（不自动展开：换页与开合是两件事）。 */
  function setPage(next) {
    page = next === 'tasks' ? 'tasks' : 'roster'
    paint()
    return page
  }

  return {
    ready,
    setPage,
    page: () => page,
    /** 开/关抽屉；不传就是切换。返回切换后的状态。 */
    toggle(force) {
      open = typeof force === 'boolean' ? force : !open
      paint()
      return open
    },
    isOpen: () => open,
    /** 对话面板打开时把它抬到最前（同一抽屉的另一页）。 */
    setDialogueOpen(active) {
      if (!ready) return
      root.classList.toggle('has-dialogue', Boolean(active))
      // 对话是从抽屉里滑出来的：它打开时抽屉必须开着，否则什么都看不到。
      if (active === true && !open) {
        open = true
        paint()
      }
    },
  }
}
