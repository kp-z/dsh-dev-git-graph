/*
 * R208：三卡 dock 布局（场景 / 任务 / 团队）。
 *
 * - 默认：场景 62% 在左；右侧上下分任务/团队。
 * - 拖任意卡片的 ⠿ 到另一张卡的左/右/上/下：替换成新的 split，两张卡成为兄弟。
 * - split 之间的手柄可拖动改比例；布局树持久化。
 * - 不新建卡片，只重排已有 DOM。
 */

const STORAGE_KEY = 'agentWorld.dockTree'

function isLeaf(node) {
  return node !== null && typeof node === 'object' && node.type === 'leaf'
}

function leaf(id) {
  return { type: 'leaf', id }
}

const DEFAULT_TREE = {
  type: 'split', dir: 'row', ratio: 0.62,
  a: leaf('stage'),
  b: { type: 'split', dir: 'col', ratio: 0.56, a: leaf('task'), b: leaf('team') },
}

function readTree() {
  try {
    const value = JSON.parse(globalThis.localStorage?.getItem(STORAGE_KEY) ?? 'null')
    const ids = []
    const walk = (node) => {
      if (node === null || typeof node !== 'object') return false
      if (node.type === 'leaf') { ids.push(node.id); return true }
      if (node.type !== 'split' || (node.dir !== 'row' && node.dir !== 'col')) return false
      if (typeof node.ratio !== 'number') return false
      return walk(node.a) && walk(node.b)
    }
    if (!walk(value)) return DEFAULT_TREE
    const unique = new Set(ids)
    if (unique.size !== 3 || !['stage', 'task', 'team'].every((id) => unique.has(id))) return DEFAULT_TREE
    return value
  } catch (e) {
    return DEFAULT_TREE
  }
}

function writeTree(tree) {
  try { globalThis.localStorage?.setItem(STORAGE_KEY, JSON.stringify(tree)) } catch (e) { /* 便利 */ }
}

function findLeaf(node, id) {
  if (node === null || typeof node !== 'object') return null
  if (isLeaf(node)) return node.id === id ? node : null
  return findLeaf(node.a, id) ?? findLeaf(node.b, id)
}

function removeLeaf(node, id) {
  if (isLeaf(node)) return node.id === id ? null : node
  const a = removeLeaf(node.a, id)
  const b = removeLeaf(node.b, id)
  if (a === null) return b
  if (b === null) return a
  return { ...node, a, b }
}

function replaceLeaf(node, target, replacement) {
  if (isLeaf(node)) return node.id === target ? replacement : node
  return { ...node, a: replaceLeaf(node.a, target, replacement), b: replaceLeaf(node.b, target, replacement) }
}

/**
 * @param {object} options
 * @param {HTMLElement} options.root - 游戏根（document 或 element）。
 * @param {HTMLElement} options.stage - `.stage`。
 * @param {Record<string, HTMLElement>} options.panels - `{task, team}`。
 */
export function mountDock(options = {}) {
  const doc = options.root?.ownerDocument ?? globalThis.document
  const root = options.root
  const stage = options.stage
  const panels = options.panels ?? {}
  const app = root?.querySelector?.('.app')
  if (doc === null || doc === undefined || root === null || root === undefined || app === null) return null

  const elements = {
    stage,
    task: panels.task ?? root.querySelector?.('#sidebar-panel-graph'),
    team: panels.team ?? root.querySelector?.('#sidebar-panel-agents'),
  }
  if (!elements.stage || !elements.task || !elements.team) return null

  let tree = readTree()
  let dragId = null

  const workspace = doc.createElement('div')
  workspace.className = 'workspace'
  app.append(workspace)
  app.classList.add('has-dock')
  // 原来的 sidebar shell 只负责创建两块面板；面板搬进 dock 后 shell 隐藏。
  const sidebarRoot = root.querySelector?.('#sidebar')
  if (sidebarRoot !== null) sidebarRoot.style.display = 'none'
  // 旧的 stage/sidebar 拖拽手柄全部退场，改由三张卡自己的 dock handle 接管。
  stage.querySelector?.('.stage-drag')?.remove()
  for (const panel of [elements.task, elements.team]) {
    panel.querySelectorAll?.('.aw-drag-handle').forEach((node) => node.remove())
  }

  function bindHandle(element, id) {
    const handle = doc.createElement('button')
    handle.type = 'button'
    handle.className = 'aw-dock-handle'
    handle.textContent = '⠿'
    handle.draggable = true
    handle.title = '拖动到其他卡片的左/右/上/下'
    handle.setAttribute('aria-label', '拖动卡片重新排列')
    handle.addEventListener('dragstart', (event) => {
      dragId = id
      if (event.dataTransfer !== null && event.dataTransfer !== undefined) {
        event.dataTransfer.effectAllowed = 'move'
        try { event.dataTransfer.setData('text/plain', id) } catch (e) { /* 老浏览器 */ }
      }
      app.classList.add('is-dock-dragging')
    })
    handle.addEventListener('dragend', () => {
      dragId = null
      app.classList.remove('is-dock-dragging')
      for (const pane of workspace.querySelectorAll('.dock-pane')) pane.classList.remove('is-drop-left', 'is-drop-right', 'is-drop-top', 'is-drop-bottom')
    })
    element.append(handle)
  }

  bindHandle(stage, 'stage')
  for (const [id, panel] of [['task', elements.task], ['team', elements.team]]) {
    const head = panel.querySelector('.sidebar-region-head')
    if (head !== null) head.prepend((() => {
      const handle = doc.createElement('button')
      handle.type = 'button'
      handle.className = 'aw-dock-handle'
      handle.textContent = '⠿'
      handle.draggable = true
      handle.title = '拖动到其他卡片的左/右/上/下'
      handle.setAttribute('aria-label', '拖动卡片重新排列')
      handle.addEventListener('dragstart', (event) => {
        dragId = id
        if (event.dataTransfer !== null && event.dataTransfer !== undefined) {
          event.dataTransfer.effectAllowed = 'move'
          try { event.dataTransfer.setData('text/plain', id) } catch (e) { /* 老浏览器 */ }
        }
        app.classList.add('is-dock-dragging')
      })
      handle.addEventListener('dragend', () => {
        dragId = null
        app.classList.remove('is-dock-dragging')
        for (const pane of workspace.querySelectorAll('.dock-pane')) pane.classList.remove('is-drop-left', 'is-drop-right', 'is-drop-top', 'is-drop-bottom')
      })
      return handle
    })())
  }

  function bindDrop(pane, id) {
    pane.addEventListener('dragover', (event) => {
      if (dragId === null || dragId === id) return
      event.preventDefault()
      const rect = pane.getBoundingClientRect()
      const dx = event.clientX - (rect.left + rect.width / 2)
      const dy = event.clientY - (rect.top + rect.height / 2)
      pane.classList.remove('is-drop-left', 'is-drop-right', 'is-drop-top', 'is-drop-bottom')
      if (Math.abs(dx) > Math.abs(dy)) pane.classList.add(dx < 0 ? 'is-drop-left' : 'is-drop-right')
      else pane.classList.add(dy < 0 ? 'is-drop-top' : 'is-drop-bottom')
    })
    pane.addEventListener('dragleave', () => pane.classList.remove('is-drop-left', 'is-drop-right', 'is-drop-top', 'is-drop-bottom'))
    pane.addEventListener('drop', (event) => {
      if (dragId === null || dragId === id) return
      event.preventDefault()
      const rect = pane.getBoundingClientRect()
      const dx = event.clientX - (rect.left + rect.width / 2)
      const dy = event.clientY - (rect.top + rect.height / 2)
      const horizontal = Math.abs(dx) > Math.abs(dy)
      const before = horizontal ? dx < 0 : dy < 0
      const source = dragId
      dragId = null
      app.classList.remove('is-dock-dragging')
      const next = removeLeaf(tree, source)
      if (next === null || findLeaf(next, id) === null) return
      const target = findLeaf(next, id)
      const replacement = {
        type: 'split',
        dir: horizontal ? 'row' : 'col',
        ratio: 0.5,
        a: before ? leaf(source) : target,
        b: before ? target : leaf(source),
      }
      tree = replaceLeaf(next, id, replacement)
      writeTree(tree)
      render()
    })
  }

  function bindResizer(resizer, node, a, b) {
    resizer.addEventListener('pointerdown', (event) => {
      event.preventDefault()
      const split = resizer.parentElement
      const rect = split.getBoundingClientRect()
      const row = node.dir === 'row'
      const move = (moveEvent) => {
        const ratio = row
          ? (moveEvent.clientX - rect.left) / rect.width
          : (moveEvent.clientY - rect.top) / rect.height
        node.ratio = Math.min(0.82, Math.max(0.18, ratio))
        a.style.flex = `${node.ratio} 1 0%`
        b.style.flex = `${1 - node.ratio} 1 0%`
        globalThis.dispatchEvent?.(new CustomEvent('agentworld:layout-change'))
      }
      const up = () => {
        doc.removeEventListener('pointermove', move)
        doc.removeEventListener('pointerup', up)
        writeTree(tree)
        globalThis.dispatchEvent?.(new CustomEvent('agentworld:layout-change'))
      }
      doc.addEventListener('pointermove', move)
      doc.addEventListener('pointerup', up)
    })
  }

  function renderNode(node) {
    if (isLeaf(node)) {
      const pane = doc.createElement('div')
      pane.className = 'dock-pane'
      pane.dataset.pane = node.id
      pane.append(elements[node.id])
      bindDrop(pane, node.id)
      return pane
    }
    const split = doc.createElement('div')
    split.className = `dock-split dock-split-${node.dir}`
    const a = renderNode(node.a)
    const b = renderNode(node.b)
    a.style.flex = `${node.ratio} 1 0%`
    b.style.flex = `${1 - node.ratio} 1 0%`
    const resizer = doc.createElement('div')
    resizer.className = `dock-resizer dock-resizer-${node.dir}`
    resizer.title = '拖动调整宽度'
    resizer.setAttribute('role', 'separator')
    resizer.setAttribute('aria-orientation', node.dir === 'row' ? 'vertical' : 'horizontal')
    bindResizer(resizer, node, a, b)
    split.append(a, resizer, b)
    return split
  }

  function render() {
    workspace.replaceChildren(renderNode(tree))
    globalThis.dispatchEvent?.(new CustomEvent('agentworld:layout-change'))
  }

  render()
  return { layout: () => tree, render }
}
