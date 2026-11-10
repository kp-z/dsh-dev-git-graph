/**
 * 总览页容器 —— 工厂组件，模块顶层不 import react。
 *
 * 职责（也是它唯一的「副作用面」）：
 * - 通过**注入的 api** 取快照（api.overview / api.revision / api.groupAction），自己不做 fetch、
 *   不碰 localStorage（走注入的 store）、不写 document.body、不做 DOM 查询；
 * - 持有纯视图状态：当前 scope、目录折叠、展开的详情、右键菜单、拖拽高亮、就地重命名/新建；
 * - 按 revision 变化轮询刷新（间隔下限 15s，宿主侧是瘦快照）；
 * - 把树 / 图 / 详情三个子组件按同一份 {React, h, model} 实例化并接线（卡片区已删：
 *   图上的节点就是任务列表，再列一遍只是重复）。
 *
 * 兼容两套注入命名（lead 早期冻结名与最终名都吃）：
 *   api.overview | api.loadOverview；api.groupAction | api.saveGroups；api.revision() → 值或 {revision}
 *   store.get(key, fallback) / store.set(key, value)，本组件只写 'selection' 与 'collapsed'
 *
 * props（都可选）：api、store、pollMs、title、api 覆写
 */

import * as modelModule from '../overview/model.js'
import * as layoutModule from '../overview/layout.js'
import { createDetailPanel } from './DetailPanel.js'
import { createGraphView } from './GraphView.js'
import { createTreeNav } from './TreeNav.js'

const MIN_POLL_MS = 15000
const DEFAULT_POLL_MS = 30000

const asArray = (value) => (Array.isArray(value) ? value : [])

function adaptApi(raw) {
  const source = raw && typeof raw === 'object' ? raw : {}
  return {
    overview: typeof source.overview === 'function'
      ? () => source.overview()
      : (typeof source.loadOverview === 'function' ? () => source.loadOverview() : null),
    revision: typeof source.revision === 'function' ? () => source.revision() : null,
    groupAction: typeof source.groupAction === 'function'
      ? (body) => source.groupAction(body)
      : (typeof source.saveGroups === 'function' ? (body) => source.saveGroups(body) : null),
  }
}

/** revision 是不透明值（宿主的 sha256 前 16 位）：只用来比「变没变」，不参与算术。 */
function revisionOf(value) {
  if (value == null) return null
  if (typeof value === 'object') return value.revision == null ? null : value.revision
  return value
}

function unwrap(payload) {
  if (!payload || typeof payload !== 'object') throw new Error('宿主没有返回总览快照')
  if (payload.ok === false) throw new Error(String(payload.error || '读取总览快照失败'))
  return payload
}

function readStore(store, key) {
  if (!store || typeof store.get !== 'function') return null
  try { return store.get(key, null) } catch (error) { return null }
}

function writeStore(store, key, value) {
  if (!store || typeof store.set !== 'function') return
  try { store.set(key, value) } catch (error) { /* 隐私模式/超限：忽略 */ }
}

function clockOf(now) {
  const value = Number(now)
  if (!isFinite(value) || value <= 0) return ''
  try { return new Date(value).toLocaleTimeString() } catch (error) { return '' }
}

/* ---------------- 右键菜单（纯展示，动作由 runMenu 决定） ----------------
 * 键盘口径与宿主菜单一致：↑↓ 在当前层移动、→ 进子菜单、← 退回主层、Enter 执行、Esc 关闭；
 * 鼠标悬停即切换当前项。两层各有自己的游标，子菜单项同样可达。
 */
function Menu(props) {
  const { React, h, menu, onRun, onClose } = props
  const { useEffect, useRef, useState } = React
  const [cursor, setCursor] = useState(-1)
  const [subCursor, setSubCursor] = useState(-1)
  const [subOpen, setSubOpen] = useState(false)
  const rootRef = useRef(null)
  const subRef = useRef(null)
  const items = asArray(menu.items)

  useEffect(() => {
    const onDown = (event) => {
      const root = rootRef.current
      const subRoot = subRef.current
      const inside = (root && typeof root.contains === 'function' && root.contains(event.target))
        || (subRoot && typeof subRoot.contains === 'function' && subRoot.contains(event.target))
      if (!inside) onClose()
    }
    const onKey = (event) => { if (event.key === 'Escape') { event.preventDefault(); onClose() } }
    const onMove = () => onClose()
    if (typeof document !== 'undefined' && document.addEventListener) {
      document.addEventListener('mousedown', onDown, true)
      document.addEventListener('keydown', onKey, true)
    }
    if (typeof window !== 'undefined' && window.addEventListener) {
      window.addEventListener('resize', onMove)
      window.addEventListener('scroll', onMove, true)
    }
    return () => {
      if (typeof document !== 'undefined' && document.removeEventListener) {
        document.removeEventListener('mousedown', onDown, true)
        document.removeEventListener('keydown', onKey, true)
      }
      if (typeof window !== 'undefined' && window.removeEventListener) {
        window.removeEventListener('resize', onMove)
        window.removeEventListener('scroll', onMove, true)
      }
    }
  }, [onClose])

  const parent = cursor >= 0 ? items[cursor] : null
  const subItems = parent && Array.isArray(parent.submenu) ? parent.submenu : []
  const level = subOpen && subItems.length ? subItems : items
  const active = subOpen && subItems.length ? subCursor : cursor
  const isRunnable = (item) => !!item && item.kind !== 'separator' && item.disabled !== true

  const setActive = (next) => { if (subOpen && subItems.length) setSubCursor(next); else setCursor(next) }
  const step = (delta) => {
    let next = active
    for (let i = 0; i < level.length; i += 1) {
      next = (next + delta + level.length) % level.length
      if (isRunnable(level[next])) break
    }
    setActive(next)
  }
  const enterSub = () => {
    if (!subItems.length) return
    let index = subItems.findIndex(isRunnable)
    if (index < 0) index = 0
    setSubCursor(index)
    setSubOpen(true)
  }

  const maxX = typeof window !== 'undefined' && window.innerWidth ? Math.max(8, window.innerWidth - 220) : menu.x
  const maxY = typeof window !== 'undefined' && window.innerHeight ? Math.max(8, window.innerHeight - 40 - items.length * 26) : menu.y
  const left = Math.min(Math.max(8, menu.x), maxX)
  const top = Math.min(Math.max(8, menu.y), Math.max(8, maxY))

  const renderItems = (list, levelIndex) => list.map((item, index) => {
    if (item.kind === 'separator') return h('div', { key: `sep:${levelIndex}:${index}`, className: 'fo-menu-sep' })
    const hasSub = Array.isArray(item.submenu) && item.submenu.length > 0
    const isActive = levelIndex === 0
      ? (!subOpen || !subItems.length) && cursor === index
      : subOpen && subCursor === index
    return h('button', {
      key: `${levelIndex}:${item.id || index}`,
      type: 'button',
      className: 'fo-menu-item',
      disabled: item.disabled === true,
      'data-id': item.id || '',
      'data-danger': item.danger === true ? '1' : '0',
      'data-open': isActive ? '1' : '0',
      onMouseEnter: () => {
        if (levelIndex === 0) { setCursor(index); setSubOpen(hasSub) } else setSubCursor(index)
      },
      onClick: () => {
        if (hasSub) { setCursor(index); enterSub(); return }
        onRun(item, menu.row)
      },
    },
      h('span', { className: 'fo-menu-check' }, item.checked === true ? '✓' : ''),
      h('span', null, item.label),
      hasSub ? h('span', { className: 'fo-menu-more' }, '▸') : null,
    )
  })

  return h('div', {
    ref: rootRef,
    className: 'fo-menu',
    role: 'menu',
    style: { left, top },
    onKeyDown: (event) => {
      if (event.key === 'ArrowDown') { event.preventDefault(); step(1) }
      else if (event.key === 'ArrowUp') { event.preventDefault(); step(-1) }
      else if (event.key === 'ArrowRight') { event.preventDefault(); enterSub() }
      else if (event.key === 'ArrowLeft') { event.preventDefault(); setSubOpen(false) }
      else if (event.key === 'Escape') { event.preventDefault(); onClose() }
      else if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault()
        const item = active >= 0 ? level[active] : null
        if (!isRunnable(item)) return
        if (Array.isArray(item.submenu) && item.submenu.length && !subOpen) { setCursor(items.indexOf(item)); enterSub(); return }
        onRun(item, menu.row)
      }
    },
  },
    renderItems(items, 0),
    subOpen && subItems.length
      ? h('div', {
        ref: subRef,
        className: 'fo-menu fo-menu-sub',
        role: 'menu',
        style: {
          left: Math.min(left + 190, typeof window !== 'undefined' && window.innerWidth ? window.innerWidth - 200 : left + 190),
          top: Math.min(Math.max(8, top + Math.max(0, cursor) * 26 + 4), typeof window !== 'undefined' && window.innerHeight ? Math.max(8, window.innerHeight - 140) : top),
        },
      }, renderItems(subItems, 1))
      : null,
  )
}

export function createOverviewPanel(deps) {
  const { React, h } = deps || {}
  const model = (deps && deps.model) || modelModule
  const layout = (deps && deps.layout) || layoutModule
  const api = adaptApi(deps && deps.api)
  const store = (deps && deps.store) || null
  const pollMs = Math.max(MIN_POLL_MS, Number(deps && deps.pollMs) || DEFAULT_POLL_MS)

  const TreeNav = createTreeNav({ React, h, model })
  const GraphView = createGraphView({ React, h, model, layout })
  const DetailPanel = createDetailPanel({ React, h, model })

  const { useCallback, useEffect, useMemo, useRef, useState } = React

  return function OverviewPanel(props) {
    const options = props || {}
    /* 只有「看起来确实像 api」的 props 覆写才生效：槽位渲染时塞进来的其它 props 不能顶掉注入的接口。 */
    const override = options.api && typeof options.api === 'object'
      && (typeof options.api.overview === 'function' || typeof options.api.loadOverview === 'function')
      ? adaptApi(options.api)
      : null
    const apiRef = useRef(override || api)
    const alive = useRef(true)

    const [state, setState] = useState({ status: 'loading', error: '', data: null })
    const [scope, setScope] = useState(() => model.normScope(readStore(store, 'selection')))
    const [collapsed, setCollapsed] = useState(() => {
      const value = readStore(store, 'collapsed')
      return model.isObj(value) ? value : {}
    })
    const [detailId, setDetailId] = useState('')
    const [keyword, setKeyword] = useState(() => model.str(readStore(store, 'keyword')))
    const [renamingId, setRenamingId] = useState('')
    const [creating, setCreating] = useState(false)
    const [creatingFor, setCreatingFor] = useState('')
    const [menu, setMenu] = useState(null)
    const [dragKey, setDragKey] = useState('')
    const [dropKey, setDropKey] = useState('')
    const [busy, setBusy] = useState(false)
    const revision = useRef(null)
    /* 单调自增的请求序号：只让**最后一次** load 的回包落地。
       没有它就会有这个竞态：目录写操作改了 revision，而「写之前发出的那次 load」在写之后才返回，
       于是旧快照盖掉本地 patch（还顺手把 revision.current 拉回旧值，要等下一轮轮询才自愈）。 */
    const requestSeq = useRef(0)

    const load = useCallback((silent) => {
      const fn = apiRef.current.overview
      if (!fn) {
        setState((prev) => ({ status: prev.data ? 'ready' : 'error', error: '宿主接口不可用（缺少 api.overview）', data: prev.data }))
        return undefined
      }
      const seq = requestSeq.current + 1
      requestSeq.current = seq
      if (!silent) setState((prev) => ({ ...prev, status: prev.data ? 'ready' : 'loading' }))
      return Promise.resolve()
        .then(() => fn())
        .then((payload) => {
          /* 过期回包：直接丢。既不改数据，也不改 revision.current。 */
          if (seq !== requestSeq.current) return null
          const data = unwrap(payload)
          revision.current = revisionOf(payload)
          if (alive.current) setState({ status: 'ready', error: '', data })
          return data
        })
        .catch((error) => {
          /* 过期的失败也别报：它描述的是已经被更新请求取代的那一次。 */
          if (seq !== requestSeq.current) return null
          const message = String((error && error.message) || error) || '读取总览快照失败'
          if (alive.current) setState((prev) => ({ status: prev.data ? 'ready' : 'error', error: message, data: prev.data }))
          return null
        })
    }, [])

    useEffect(() => {
      alive.current = true
      load(false)
      return () => { alive.current = false }
    }, [load])

    /* 变了才刷：先问轻量 revision，值不同才重拉瘦快照。 */
    useEffect(() => {
      const id = setInterval(() => {
        if (typeof document !== 'undefined' && document.hidden) return
        const ask = apiRef.current.revision
        if (!ask) { load(true); return }
        Promise.resolve()
          .then(() => ask())
          .then((value) => {
            const next = revisionOf(value)
            if (next == null) return
            /* 服务端 revision !== 本地 revision.current 才重拉；本地写成功后会由写路径立刻 load(true)
               把 revision.current 修正成写后的值，所以这里不会因为「自己刚写的」而白拉一次。 */
            if (revision.current !== next) load(true)
          })
          .catch(() => { /* 轮询失败不打扰用户，下一轮再来 */ })
      }, pollMs)
      return () => clearInterval(id)
    }, [load, pollMs])

    /* 回到前台补一次：后台期间的变更不会等下一次轮询。 */
    useEffect(() => {
      if (typeof document === 'undefined' || !document.addEventListener) return undefined
      const onVisible = () => { if (!document.hidden) load(true) }
      document.addEventListener('visibilitychange', onVisible)
      return () => document.removeEventListener('visibilitychange', onVisible)
    }, [load])

    /* 选中项与折叠状态是纯视图状态：交给注入的 store（组件不碰 localStorage）。 */
    useEffect(() => { writeStore(store, 'selection', scope) }, [scope])
    useEffect(() => { writeStore(store, 'collapsed', collapsed) }, [collapsed])
    useEffect(() => { writeStore(store, 'keyword', keyword) }, [keyword])

    useEffect(() => {
      if (!detailId || typeof document === 'undefined' || !document.addEventListener) return undefined
      const onKey = (event) => { if (event.key === 'Escape') setDetailId('') }
      document.addEventListener('keydown', onKey)
      return () => document.removeEventListener('keydown', onKey)
    }, [detailId])

    const data = state.data
    const tasks = useMemo(() => asArray(data && data.tasks).filter((task) => model.isObj(task) && model.str(task.id)), [data])
    const relations = useMemo(() => asArray(data && data.relations), [data])
    const groups = useMemo(() => asArray(data && data.groups), [data])
    const workspaces = useMemo(() => asArray(data && data.workspaces), [data])
    /* 搜索：命中标题 / id / 编号 / 项目名，收窄的范围与树、图、卡片一致。
       过滤期间不把 workspaces 交给 buildTree/layoutScope —— 否则「0 个匹配的 项目」也会出现在树上。 */
    const keywordNeedle = model.collapse(keyword).toLowerCase()
    const visibleTasks = useMemo(() => {
      if (!keywordNeedle) return tasks
      return tasks.filter((task) => {
        const no = model.taskNo(task)
        const hay = `${model.collapse(task.title)} ${model.str(task.id)} ${model.collapse(task.workspaceTitle)} ${no > 0 ? `t${no} #${no} ${no}` : ''}`.toLowerCase()
        return hay.indexOf(keywordNeedle) >= 0
      })
    }, [tasks, keywordNeedle])
    const tasksById = useMemo(() => {
      const map = {}
      tasks.forEach((task) => { map[model.str(task.id)] = task })
      return map
    }, [tasks])
    const scopeWorkspaces = keywordNeedle ? [] : workspaces
    const tree = useMemo(() => model.buildTree(groups, visibleTasks, { collapsed, selection: scope, workspaces: scopeWorkspaces }), [groups, visibleTasks, collapsed, scope, scopeWorkspaces])
    const drawing = useMemo(() => layout.layoutScope({ tasks: visibleTasks, relations, groups, workspaces: scopeWorkspaces, scope }), [visibleTasks, relations, groups, scopeWorkspaces, scope])
    /* 搜索时只留有节点的图：空目录不必在筛选态下占一屏 */
    const graphs = useMemo(() => {
      const list = asArray(drawing && drawing.graphs)
      return keywordNeedle ? list.filter((graph) => asArray(graph.nodes).length > 0) : list
    }, [drawing, keywordNeedle])
    const scopedTasks = useMemo(() => model.scopeTasks(visibleTasks, scope, groups), [visibleTasks, scope, groups])
    const stats = useMemo(() => {
      const base = model.statsOf(scopedTasks, relations)
      const nodes = asArray(drawing && drawing.nodes)
      base.ghosts = nodes.filter((node) => node.ghost === true).length
      base.missingGhosts = nodes.filter((node) => node.ghost === true && node.missing === true).length
      base.graphs = graphs.length
      return base
    }, [scopedTasks, relations, drawing, graphs.length])
    const colorOf = useMemo(() => {
      const map = {}
      asArray(tree && tree.lanes).forEach((lane) => {
        asArray(lane.projects).forEach((project) => { map[project.key] = project.colorIndex })
      })
      return map
    }, [tree])

    /* scope 指向的目录/项目已经不在快照里（被删/改名）→ 退回「全部任务」，别停在空图上。 */
    useEffect(() => {
      if (state.status !== 'ready' || !data || scope.kind === 'all' || keywordNeedle) return
      const first = graphs[0]
      if (!first || first.kind === 'empty') setScope({ kind: 'all', id: '' })
    }, [state.status, data, scope, graphs, keywordNeedle])

    const runGroup = useCallback((body) => {
      const fn = apiRef.current.groupAction
      if (!fn) { setState((prev) => ({ ...prev, error: '宿主接口不可用（缺少目录写接口）' })); return Promise.resolve(null) }
      setBusy(true)
      return Promise.resolve()
        .then(() => fn(body))
        .then((res) => {
          if (!res || res.ok !== true) throw new Error(String((res && res.error) || '目录操作失败'))
          if (alive.current) {
            /* 先用返回的 groups 立刻反映到界面上（用户不该等一次网络往返才看到自己的操作）。 */
            setState((prev) => {
              if (!prev.data) return { ...prev, error: '' }
              const next = Array.isArray(res.groups) ? res.groups : prev.data.groups
              return { ...prev, error: '', data: { ...prev.data, groups: next } }
            })
          }
          /* 写成功后立刻拉一次权威快照：既校正 revision.current（不再停留在写前值），
             也让「写之前发出的那次 load」因为请求序号更旧而被丢掉（见 load 里的 requestSeq）。 */
          if (alive.current) load(true)
          return res
        })
        .catch((error) => {
          const message = String((error && error.message) || error) || '目录操作失败'
          if (alive.current) setState((prev) => ({ ...prev, error: message }))
          return null
        })
        .then((res) => { if (alive.current) setBusy(false); return res })
    }, [load])

    const runMenu = useCallback((item, row) => {
      setMenu(null)
      if (!item || item.disabled === true || !row) return
      const id = String(item.id || '')
      if (id === 'refresh') { load(true); return }
      if (id === 'rename') { setRenamingId(row.id); return }
      if (id === 'new-group') { setCreatingFor(''); setCreating(true); return }
      if (id === 'move-new') { setCreatingFor(row.id); setCreating(true); return }
      if (id === 'focus') { setScope({ kind: 'project', id: row.id }); return }
      if (id === 'delete') {
        runGroup({ action: 'delete', id: row.id }).then((res) => {
          if (res && scope.kind === 'group' && scope.id === row.id) setScope({ kind: 'all', id: '' })
        })
        return
      }
      if (id.indexOf('move:') === 0) {
        runGroup({ action: 'add', id: item.groupId, member: { key: row.id, label: row.label } })
        return
      }
      if (id === 'remove') {
        const owner = model.normalizeGroups(groups).find((def) => def.members.indexOf(row.id) >= 0)
        if (owner) runGroup({ action: 'remove', id: owner.id, key: row.id })
      }
    }, [groups, load, runGroup, scope])

    const onSelectRow = useCallback((row) => {
      if (!row) return
      if (row.kind === 'group') setScope({ kind: 'group', id: row.id })
      else if (row.kind === 'project') setScope({ kind: 'project', id: row.id })
      else setScope({ kind: 'all', id: '' })
    }, [])

    const onToggleRow = useCallback((row) => {
      if (!row) return
      setCollapsed((prev) => ({ ...prev, [row.key]: prev[row.key] !== true }))
    }, [])

    const onMenu = useCallback((row, at) => {
      if (!row) return
      const items = model.rowMenu(row, groups, scope)
      if (!items.length) return
      setMenu({ row, items, x: at && at.x ? at.x : 40, y: at && at.y ? at.y : 40 })
    }, [groups, scope])

    const onDrop = useCallback((projectKey, targetRow) => {
      setDragKey('')
      setDropKey('')
      const key = String(projectKey || '').replace(/^project:/, '')
      if (!key) return
      if (targetRow && targetRow.kind === 'group' && targetRow.ungrouped !== true) {
        const row = tree && tree.byKey ? tree.byKey[`project:${key}`] : null
        runGroup({ action: 'add', id: targetRow.id, member: { key, label: row ? row.label : key } })
        return
      }
      const owner = model.normalizeGroups(groups).find((def) => def.members.indexOf(key) >= 0)
      if (owner) runGroup({ action: 'remove', id: owner.id, key })
    }, [groups, runGroup, tree])

    const onCreateCommit = useCallback((name) => {
      const pending = creatingFor
      setCreating(false)
      setCreatingFor('')
      const row = pending && tree && tree.byKey ? tree.byKey[`project:${pending}`] : null
      const body = { action: 'create', name }
      if (pending) {
        body.members = [pending]
        body.labels = row ? { [pending]: row.label } : {}
      }
      runGroup(body).then((res) => { if (res && res.group && res.group.id) setScope({ kind: 'group', id: res.group.id }) })
    }, [creatingFor, runGroup, tree])

    const onRenameCommit = useCallback((id, name) => {
      setRenamingId('')
      runGroup({ action: 'rename', id, name })
    }, [runGroup])

    const openTask = useCallback((id) => { setDetailId(model.str(id)) }, [])

    /** 关系里点过来的任务：能点过去就一定让它可见（不在当前 scope 里就切回全部）。 */
    const jumpToTask = useCallback((id) => {
      const key = model.str(id)
      if (!key || !tasksById[key]) return
      setDetailId(key)
      if (!scopedTasks.some((task) => model.str(task.id) === key)) setScope({ kind: 'all', id: '' })
    }, [scopedTasks, tasksById])

    const detailTask = detailId ? tasksById[detailId] || null : null
    const detailNode = useMemo(() => {
      if (!detailId) return null
      const nodes = asArray(drawing && drawing.nodes)
      return nodes.find((node) => node.id === detailId && node.ghost !== true) || nodes.find((node) => node.id === detailId) || null
    }, [detailId, drawing])

    const chips = []
    if (data) {
      chips.push(h('span', { key: 'tasks', className: 'fo-chip', 'data-tone': 'brand' }, `${stats.tasks} 任务`))
      chips.push(h('span', { key: 'open', className: 'fo-chip' }, `未完成 ${stats.open}`))
      if (stats.blocked) chips.push(h('span', { key: 'blocked', className: 'fo-chip', 'data-tone': 'danger' }, `阻塞 ${stats.blocked}`))
      chips.push(h('span', { key: 'ready', className: 'fo-chip', 'data-tone': 'ok' }, `就绪 ${stats.ready}`))
      if (stats.suspended) chips.push(h('span', { key: 'suspended', className: 'fo-chip', 'data-tone': 'warn' }, `挂起 ${stats.suspended}`))
      chips.push(h('span', { key: 'dep', className: 'fo-chip' }, `依赖 ${stats.dependencyEdges}`))
      chips.push(h('span', { key: 'prov', className: 'fo-chip' }, `来源 ${stats.provenanceEdges}`))
      if (stats.ghosts) chips.push(h('span', { key: 'ghost', className: 'fo-chip', 'data-tone': 'idle' }, `组外/缺失 ${stats.ghosts}`))
      chips.push(h('span', { key: 'graphs', className: 'fo-chip' }, `${stats.graphs} 张图`))
    }

    const subtitle = []
    subtitle.push(model.scopeLabel(scope, groups))
    if (scope.kind !== 'all') subtitle.push('已筛选')
    if (revision.current != null) subtitle.push(`revision ${model.str(revision.current).slice(0, 8)}`)
    const clock = clockOf(data && data.now)
    if (clock) subtitle.push(clock)

    let content
    if (state.status === 'loading' && !data) {
      content = h('div', { className: 'fo-skeleton', 'aria-hidden': 'true' }, [0, 1, 2].map((i) => h('div', { key: i, className: 'fo-skeleton-row' })))
    } else if (!data) {
      content = h('div', { className: 'fo-placeholder', role: 'status' },
        h('div', { className: 'fo-placeholder-title' }, '读不到飞书任务数据'),
        h('div', { className: 'fo-placeholder-body' }, state.error || '宿主接口没有返回快照。'),
        h('button', { type: 'button', className: 'fo-btn', 'data-variant': 'primary', onClick: () => load(false) }, '重试'),
      )
    } else if (!tasks.length) {
      content = h('div', { className: 'fo-placeholder', role: 'status' },
        h('div', { className: 'fo-placeholder-title' }, '还没有任何任务'),
        h('div', { className: 'fo-placeholder-body' }, '插件同步到飞书任务后，这里会按「自定义目录」把多个项目合在一张关系图里画。'),
      )
    } else if (keywordNeedle && !visibleTasks.length) {
      content = h('div', { className: 'fo-placeholder', role: 'status' },
        h('div', { className: 'fo-placeholder-title' }, '没有匹配的任务'),
        h('div', { className: 'fo-placeholder-body' }, `没有标题 / 编号 / 项目名包含「${model.collapse(keyword)}」的任务。`),
        h('button', { type: 'button', className: 'fo-btn', 'data-variant': 'primary', onClick: () => setKeyword('') }, '清除搜索'),
      )
    } else {
      /* 只有图：图上的节点就是任务列表（task-13 删掉了图下面那份重复的卡片区） */
      content = h(GraphView, {
        graphs,
        selectedId: detailTask ? detailId : '',
        onOpenTask: (id) => openTask(id),
      })
    }

    return h('div', {
      className: 'fo-root',
      'data-detail': detailTask || detailNode ? '1' : '0',
      'data-busy': busy ? '1' : '0',
      'data-scope': scope.kind,
    },
      h('header', { className: 'fo-head' },
        h('div', { className: 'fo-head-main' },
          h('span', { className: 'fo-title' }, model.str(options.title) || '飞书任务集'),
          h('span', { className: 'fo-sub' }, subtitle.join(' · ')),
        ),
        chips.length ? h('div', { className: 'fo-stats' }, chips) : null,
        scope.kind !== 'all'
          ? h('button', { type: 'button', className: 'fo-btn', 'data-size': 'sm', onClick: () => setScope({ kind: 'all', id: '' }) }, '全部任务')
          : null,
        h('button', {
          type: 'button',
          className: 'fo-btn',
          'data-size': 'sm',
          disabled: state.status === 'loading' || busy,
          onClick: () => load(false),
        }, state.status === 'loading' ? '刷新中…' : '刷新'),
      ),
      h('div', { className: 'fo-body' },
        h(TreeNav, {
          tree,
          renamingId,
          creating,
          creatingFor,
          dragKey,
          dropKey,
          busy,
          keyword,
          matchCount: scopedTasks.length,
          onKeywordChange: setKeyword,
          onClearKeyword: () => setKeyword(''),
          onSelect: onSelectRow,
          onToggle: onToggleRow,
          onMenu,
          onDragKey: setDragKey,
          onDropKey: setDropKey,
          onDrop,
          onRenameStart: (row) => setRenamingId(row.id),
          onRenameCommit,
          onRenameCancel: () => setRenamingId(''),
          onCreateStart: (projectKey) => { setCreatingFor(projectKey || ''); setCreating(true) },
          onCreateCommit,
          onCreateCancel: () => { setCreating(false); setCreatingFor('') },
        }),
        h('div', { className: 'fo-main' },
          h('div', { className: 'fo-main-scroll' },
            state.error
              ? h('div', { className: 'fo-banner', role: 'alert' },
                h('span', null, state.error),
                h('button', { type: 'button', className: 'fo-btn', 'data-size': 'sm', onClick: () => load(false) }, '重试'),
                h('button', { type: 'button', className: 'fo-btn', 'data-size': 'sm', 'data-variant': 'ghost', onClick: () => setState((prev) => ({ ...prev, error: '' })) }, '知道了'),
              )
              : null,
            content,
          ),
        ),
        (detailTask || detailNode)
          ? h(DetailPanel, {
            task: detailTask,
            node: detailNode,
            tasksById,
            colorOf,
            onClose: () => setDetailId(''),
            onSelectTask: jumpToTask,
            onFocusProject: (key) => setScope({ kind: 'project', id: key }),
          })
          : null,
      ),
      menu ? h(Menu, { React, h, menu, onRun: runMenu, onClose: () => setMenu(null) }) : null,
    )
  }
}

export default createOverviewPanel
