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
 *   store.get(key, fallback) / store.set(key, value)，本组件只写 'selection' / 'collapsed' / 'keyword' /
 *   'feature' / 'scope' / 'rail' / 'nodePos'（最后一个是画布上拖动过的节点位置）
 *   宿主能力位 deps.host：canOpenSession() → {ok,reason}、openSession(id, title) → Promise<{ok,reason}>
 *
 * props（都可选）：api、store、host、pollMs、title、subtitle、api 覆写
 */

import * as modelModule from '../overview/model.js'
import * as layoutModule from '../overview/layout.js'
import { createDetailPanel } from './DetailPanel.js'
import { createFeatures, featureById } from './features.js'
import { createOrganizeDrawer } from './OrganizeDrawer.js'

const MIN_POLL_MS = 15000
const DEFAULT_POLL_MS = 30000

const asArray = (value) => (Array.isArray(value) ? value : [])

function adaptApi(raw) {
  const source = raw && typeof raw === 'object' ? raw : {}
  const fn = (name) => (typeof source[name] === 'function' ? (...args) => source[name](...args) : null)
  return {
    overview: typeof source.overview === 'function'
      ? () => source.overview()
      : (typeof source.loadOverview === 'function' ? () => source.loadOverview() : null),
    revision: typeof source.revision === 'function' ? () => source.revision() : null,
    groupAction: typeof source.groupAction === 'function'
      ? (body) => source.groupAction(body)
      : (typeof source.saveGroups === 'function' ? (body) => source.saveGroups(body) : null),
    /* 一键整理（task-16）：旧宿主没有这四个方法时是 null —— 按钮不渲染，而不是点了报错。 */
    organize: fn('organize'),
    organizeView: fn('organizeView'),
    organizeAccept: fn('organizeAccept'),
    organizeReject: fn('organizeReject'),
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

/**
 * 宿主能力位：`host.canOpenSession() → {ok, reason}`（lead 在 client.js 注入）。
 * 可能整个缺失、返回形状不对、或直接抛 —— 一律折成 `{ok:false, reason}`，
 * 绝不让 undefined 漏到节点上（那样按钮会「看着能点、点了没反应」）。
 */
function hostCapability(host) {
  const fallback = { ok: false, reason: '当前宿主不支持打开会话' }
  if (!host || typeof host.canOpenSession !== 'function') return fallback
  try {
    const res = host.canOpenSession()
    if (!res || typeof res !== 'object') return fallback
    const ok = res.ok === true
    return { ok, reason: String(res.reason || (ok ? '' : '当前宿主不支持打开会话')) }
  } catch (error) {
    return { ok: false, reason: String((error && error.message) || fallback.reason) }
  }
}

/** 本地拖动位置（store 键 nodePos）：形状坏掉就整块丢掉，别让坏数据把画布画歪。 */
function readNodePos(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  const out = {}
  Object.keys(value).forEach((graphKey) => {
    const bag = value[graphKey]
    if (!bag || typeof bag !== 'object' || Array.isArray(bag)) return
    const clean = {}
    Object.keys(bag).forEach((id) => {
      const pos = bag[id]
      if (!pos || typeof pos !== 'object') return
      const x = Number(pos.x)
      const y = Number(pos.y)
      if (!isFinite(x) || !isFinite(y)) return
      clean[id] = { x, y }
    })
    if (Object.keys(clean).length) out[graphKey] = clean
  })
  return out
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
  /* 宿主能力位（openSession / canOpenSession）：由 lead 在 client.js 注入，本组件只依赖接口本身。 */
  const host = (deps && deps.host) || null
  const pollMs = Math.max(MIN_POLL_MS, Number(deps && deps.pollMs) || DEFAULT_POLL_MS)

  const DetailPanel = createDetailPanel({ React, h, model })
  const OrganizeDrawer = createOrganizeDrawer({ React, h, model })
  /* 功能注册表：rail 导航项、正文渲染、activeFeature 全从它派生。
     `features` 允许注入（测试用它加一个假功能验证「注册表驱动」与切换）。 */
  const features = Array.isArray(deps && deps.features) && deps.features.length
    ? deps.features
    : createFeatures({ React, h, model, layout, api, store })

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
    const [activeFeatureId, setActiveFeatureId] = useState(() => {
      const hit = featureById(features, model.str(readStore(store, 'feature')))
      return hit ? hit.id : ''
    })
    /* rail 两级菜单：一级项（功能）的展开态，落 store 键 nav（如 { graph: true }），默认展开。 */
    const [navOpen, setNavOpen] = useState(() => {
      const saved = readStore(store, 'nav')
      return model.isObj(saved) ? saved : {}
    })
    const [railOpen, setRailOpen] = useState(() => readStore(store, 'rail') !== false)
    const [collapsed, setCollapsed] = useState(() => {
      const value = readStore(store, 'collapsed')
      return model.isObj(value) ? value : {}
    })
    const [detailId, setDetailId] = useState('')
    /* 画布聚焦：点节点/按 F 都会落到这里；点空白或 Esc 取消。纯前端瞬态，不进 store。 */
    const [focusedId, setFocusedId] = useState('')
    /* 本地拖动位置：{ 图 key: { 任务 id: {x,y} } }，落 store（键 nodePos），「复位布局」清图。 */
    const [nodePos, setNodePos] = useState(() => readNodePos(readStore(store, 'nodePos')))
    /* 宿主动作（打开会话）失败时的可读提示：role=status，绝不静默。 */
    const [hostNote, setHostNote] = useState('')
    /* 一键整理（task-16）：抽屉开关 + 最近一批建议 + 逐条失败原因。整块状态放一个对象里，
       因为「跑」是异步的，分开的 setState 会出现抽屉和 batch 短暂对不上的中间态。 */
    const [org, setOrg] = useState(() => {
      const saved = readStore(store, 'organize')
      return {
        open: model.isObj(saved) ? saved.open === true : false,
        batchId: model.isObj(saved) ? model.str(saved.batchId) : '',
        batch: null,
        status: 'idle',
        error: '',
        failed: {},
        droppedOpen: false,
      }
    })
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
    useEffect(() => { writeStore(store, 'feature', activeFeatureId) }, [activeFeatureId])
    useEffect(() => { writeStore(store, 'nav', navOpen) }, [navOpen])
    useEffect(() => { writeStore(store, 'rail', railOpen) }, [railOpen])
    useEffect(() => { writeStore(store, 'nodePos', nodePos) }, [nodePos])
    useEffect(() => { writeStore(store, 'organize', { open: org.open, batchId: org.batchId }) }, [org.open, org.batchId])

    useEffect(() => {
      if (!detailId || typeof document === 'undefined' || !document.addEventListener) return undefined
      const onKey = (event) => { if (event.key === 'Escape') { setDetailId(''); setFocusedId('') } }
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

    const openTask = useCallback((id) => {
      const key = model.str(id)
      if (!key) return
      setDetailId(key)
      /* 点节点 = 选中 + 聚焦（task-15）：其余节点随之降透明度。 */
      setFocusedId(key)
    }, [])

    const focusTask = useCallback((id) => {
      const key = model.str(id)
      if (key) setFocusedId(key)
    }, [])

    /** 点画布空白 / Esc：取消聚焦（详情也一起收起来，两个状态本来就是一回事的两面）。 */
    const blurCanvas = useCallback(() => {
      setFocusedId('')
      setDetailId('')
    }, [])

    /* 拖动落位：松手时 GraphView 已经吸附过网格，这里只负责按「图 key + 任务 id」存下来。 */
    const moveNode = useCallback((graphKey, id, pos) => {
      const gk = model.str(graphKey)
      const key = model.str(id)
      if (!gk || !key || !pos) return
      const x = Number(pos.x)
      const y = Number(pos.y)
      if (!isFinite(x) || !isFinite(y)) return
      setNodePos((prev) => ({ ...prev, [gk]: { ...(prev[gk] || {}), [key]: { x, y } } }))
    }, [])

    /* 复位布局：只清这张图的本地位置，回到 layout 给的坐标。 */
    const resetLayout = useCallback((graphKey) => {
      const gk = model.str(graphKey)
      setNodePos((prev) => {
        if (!gk) return {}
        if (!prev[gk]) return prev
        const next = { ...prev }
        delete next[gk]
        return next
      })
    }, [])

    /**
     * 打开会话：host.openSession 是「尽力而为 + 读回核对」的异步动作，
     * 失败（含返回 false / 抛错）一律给一条 role=status 的可读提示，不静默。
     */
    const openSession = useCallback((sessionId, expectedTitle) => {
      const key = model.str(sessionId)
      if (!key) { setHostNote('这个任务没有绑定会话'); return Promise.resolve(false) }
      if (!host || typeof host.openSession !== 'function') {
        setHostNote(hostCapability(host).reason)
        return Promise.resolve(false)
      }
      return Promise.resolve()
        .then(() => host.openSession(key, model.str(expectedTitle)))
        .then((res) => {
          if (res && res.ok === true) { setHostNote(''); return true }
          const reason = (res && model.str(res.reason)) || '宿主没能打开这条会话'
          if (alive.current) setHostNote(reason)
          return false
        })
        .catch((error) => {
          const reason = model.str((error && error.message) || error) || '宿主没能打开这条会话'
          if (alive.current) setHostNote(reason)
          return false
        })
    }, [host])

    /* ---------------- 一键整理（task-16）：只出建议、人点了才落库 ---------------- */

    /* 换范围或首次挂载：把这个范围最近一批建议取回来（没有就是 null），抽屉内容跟着走。 */
    useEffect(() => {
      const fn = apiRef.current.organizeView
      if (!fn) return undefined
      let stale = false
      Promise.resolve()
        .then(() => fn(scope))
        .then((batch) => {
          if (stale || !alive.current || !batch) return
          setOrg((prev) => ({
            ...prev,
            batch,
            batchId: model.str(batch.batchId) || prev.batchId,
            status: 'ready',
          }))
        })
        .catch(() => { /* 恢复失败不打扰用户：画布照用，按钮还在 */ })
      return () => { stale = true }
    }, [scope])

    const toggleOrganize = useCallback(() => {
      setOrg((prev) => ({ ...prev, open: prev.open !== true }))
    }, [])

    const closeOrganize = useCallback(() => {
      setOrg((prev) => ({ ...prev, open: false }))
    }, [])

    const toggleDropped = useCallback(() => {
      setOrg((prev) => ({ ...prev, droppedOpen: prev.droppedOpen !== true }))
    }, [])

    /** 跑一次整理：零副作用，只出建议；失败给 role=alert 的错误条（重试按钮再跑一次）。 */
    const runOrganize = useCallback(() => {
      const fn = apiRef.current.organize
      if (!fn) return Promise.resolve(null)
      setOrg((prev) => ({ ...prev, status: 'running', error: '', failed: {} }))
      return Promise.resolve()
        .then(() => fn(scope))
        .then((res) => {
          if (!alive.current) return null
          const batch = res && res.batch ? res.batch : null
          setOrg((prev) => ({
            ...prev,
            open: true,
            batch,
            batchId: model.str(batch && batch.batchId) || prev.batchId,
            status: 'ready',
            error: '',
            failed: {},
          }))
          return batch
        })
        .catch((error) => {
          const message = model.str((error && error.message) || error) || '一键整理失败'
          if (alive.current) setOrg((prev) => ({ ...prev, status: 'error', error: message }))
          return null
        })
    }, [scope])

    /** 接受若干条（空数组 = 全部待处理）：用返回的 batch 就地更新抽屉，并重拉快照让新边立刻上画布。 */
    const acceptOrganize = useCallback((itemIds) => {
      const fn = apiRef.current.organizeAccept
      const batchId = org.batchId
      if (!fn || !batchId) return Promise.resolve(null)
      setOrg((prev) => ({ ...prev, status: 'running' }))
      return Promise.resolve()
        .then(() => fn(batchId, itemIds || []))
        .then((res) => {
          const batch = res && res.batch ? res.batch : null
          const failed = {}
          asArray(res && res.results).forEach((row) => {
            if (!row || row.ok === true) return
            failed[model.str(row.id)] = model.str(row.error) || '写入失败'
          })
          if (alive.current) {
            setOrg((prev) => ({
              ...prev,
              batch: batch || prev.batch,
              batchId: model.str(batch && batch.batchId) || prev.batchId,
              status: 'ready',
              failed,
            }))
            /* 接受过的关系要立刻出现在画布上：拉一次权威快照。 */
            load(true)
          }
          return res
        })
        .catch((error) => {
          const message = model.str((error && error.message) || error) || '接受建议失败'
          if (alive.current) setOrg((prev) => ({ ...prev, status: 'error', error: message }))
          return null
        })
    }, [load, org.batchId])

    const rejectOrganize = useCallback((itemIds) => {
      const fn = apiRef.current.organizeReject
      const batchId = org.batchId
      if (!fn || !batchId) return Promise.resolve(null)
      setOrg((prev) => ({ ...prev, status: 'running' }))
      return Promise.resolve()
        .then(() => fn(batchId, itemIds || []))
        .then((res) => {
          const batch = res && res.batch ? res.batch : null
          if (alive.current) {
            setOrg((prev) => ({
              ...prev,
              batch: batch || prev.batch,
              batchId: model.str(batch && batch.batchId) || prev.batchId,
              status: 'ready',
            }))
          }
          return res
        })
        .catch((error) => {
          const message = model.str((error && error.message) || error) || '拒绝建议失败'
          if (alive.current) setOrg((prev) => ({ ...prev, status: 'error', error: message }))
          return null
        })
    }, [org.batchId])

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

    /* task-15 冗余审计：正文头部只留「当前范围（面包屑）+ 搜索框 + 必要动作」。
       - 功能名删掉：它已经在 rail 品牌区、功能项、以及这里的第三次出现 —— 三处只留功能项。
       - `.fo-stats` 计数胶囊整串删掉：图数/节点数/阻塞数在树上、图头、节点 meta 上各有一份，
         同一份信息只该出现在离它描述的对象最近的那一处。
       - 副标题不再重复范围名；只留这份视图独有的上下文（revision / 快照时钟）。 */
    const scopeName = model.scopeLabel(scope, groups)

    const subtitle = []
    if (revision.current != null) subtitle.push(`revision ${model.str(revision.current).slice(0, 8)}`)
    const clock = clockOf(data && data.now)
    if (clock) subtitle.push(clock)

    /* 骨架只负责「数据层面还没法渲染功能页」的几种状态；有数据时正文交给功能注册表。 */
    let shellNode = null
    if (state.status === 'loading' && !data) {
      shellNode = h('div', { className: 'fo-skeleton', 'aria-hidden': 'true' }, [0, 1, 2].map((i) => h('div', { key: i, className: 'fo-skeleton-row' })))
    } else if (!data) {
      shellNode = h('div', { className: 'fo-placeholder', role: 'status' },
        h('div', { className: 'fo-placeholder-title' }, '读不到飞书任务数据'),
        h('div', { className: 'fo-placeholder-body' }, state.error || '宿主接口没有返回快照。'),
        h('button', { type: 'button', className: 'fo-btn', 'data-variant': 'primary', onClick: () => load(false) }, '重试'),
      )
    } else if (!tasks.length) {
      shellNode = h('div', { className: 'fo-placeholder', role: 'status' },
        h('div', { className: 'fo-placeholder-title' }, '还没有任何任务'),
        h('div', { className: 'fo-placeholder-body' }, '插件同步到飞书任务后，这里会按「自定义目录」把多个项目合在一张关系图里画。'),
      )
    } else if (keywordNeedle && !visibleTasks.length) {
      shellNode = h('div', { className: 'fo-placeholder', role: 'status' },
        h('div', { className: 'fo-placeholder-title' }, '没有匹配的任务'),
        h('div', { className: 'fo-placeholder-body' }, `没有标题 / 编号 / 项目名包含「${model.collapse(keyword)}」的任务。`),
        h('button', { type: 'button', className: 'fo-btn', 'data-variant': 'primary', onClick: () => setKeyword('') }, '清除搜索'),
      )
    }

    const activeFeature = featureById(features, activeFeatureId)
    const featureComponent = activeFeature && typeof activeFeature.Component === 'function' ? activeFeature.Component : null
    const featureHint = activeFeature ? model.str(activeFeature.hint) : ''
    const hostCan = hostCapability(host)

    /* 功能页的 ctx：数据 + 交互全在这里，功能组件自己不取数据、不碰 store。 */
    const featureCtx = {
      featureHint,
      graphs,
      selectedId: detailTask ? detailId : '',
      focusedId,
      nodePos,
      hostReady: hostCan.ok,
      hostReason: hostCan.reason,
      onOpenTask: (id) => openTask(id),
      onFocusTask: focusTask,
      onNodeMove: moveNode,
      onResetLayout: resetLayout,
      onBlur: blurCanvas,
      onOpenSession: openSession,
      organize: {
        available: typeof apiRef.current.organize === 'function',
        running: org.status === 'running',
        open: org.open,
        pending: Number(org.batch && org.batch.pending) || 0,
        onRun: runOrganize,
        onToggle: toggleOrganize,
      },
      /* 仪表盘页（洞察 / 运行）看的是**全局**，不受当前范围与搜索影响：
         它们要的是整份快照 + 现在时刻，自己做统计。 */
      tasks: visibleTasks,
      relations,
      groups,
      workspaces,
      stats: model.isObj(data && data.stats) ? data.stats : {},
      now: Number(data && data.now) || Date.now(),
      treeProps: {
        tree,
        renamingId,
        creating,
        creatingFor,
        dragKey,
        dropKey,
        busy,
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
      },
    }

    return h('div', {
      className: 'fo-root',
      'data-detail': detailTask || detailNode ? '1' : '0',
      'data-busy': busy ? '1' : '0',
      'data-scope': scope.kind,
      'data-rail': railOpen ? '1' : '0',
      'data-feature': activeFeatureId,
      'data-organize': org.open ? '1' : '0',
    },
      /* 侧栏三段：品牌 / 功能导航 / 底部固定区（折叠按钮在这里，折起来 rail 变 56px 图标条） */
      h('aside', { className: 'fo-rail', 'aria-label': '功能导航' },
        h('div', { className: 'fo-brand' },
          h('span', { className: 'fo-brand-logo', 'aria-hidden': 'true' },
            h('svg', { width: 20, height: 20, viewBox: '0 0 20 20', fill: 'none', stroke: 'currentColor', strokeWidth: 1.6, strokeLinecap: 'round', strokeLinejoin: 'round' },
              h('path', { d: 'M3 5.5h9M3 10h14M3 14.5h7' }),
              h('circle', { cx: 15.5, cy: 5.5, r: 1.4 }),
              h('circle', { cx: 13, cy: 14.5, r: 1.4 }),
            ),
          ),
          h('span', { className: 'fo-brand-text' },
            h('span', { className: 'fo-brand-title' }, model.str(options.title) || '飞书任务集'),
            h('span', { className: 'fo-brand-sub' }, model.str(options.subtitle) || 'DeepSeek Harness'),
          ),
        ),
        /* 功能导航 = 两级菜单：一级项是功能（数量 = 注册表长度），可展开的项下面是它的二级菜单
           （「关系」下面是范围树）。展开态落 store 键 nav，默认展开；点当前已展开的一级项 = 收起。 */
        h('nav', { className: 'fo-featnav', 'aria-label': '功能' },
          features.map((feature) => {
            const active = feature.id === activeFeatureId
            const expandable = typeof feature.SubNav === 'function'
            const open = expandable && active && navOpen[feature.id] !== false
            return h('div', { key: feature.id, className: 'fo-featnav-group' },
              h('button', {
                type: 'button',
                className: 'fo-featnav-item',
                'data-active': active ? '1' : '0',
                'data-expandable': expandable ? '1' : '0',
                'data-expanded': open ? '1' : '0',
                'aria-current': active ? 'page' : undefined,
                'aria-expanded': expandable ? (open ? 'true' : 'false') : undefined,
                title: model.str(feature.hint) || model.str(feature.label),
                onClick: () => {
                  if (active && expandable) {
                    setNavOpen((prev) => ({ ...prev, [feature.id]: prev[feature.id] === false }))
                    return
                  }
                  setActiveFeatureId(feature.id)
                },
              },
                typeof feature.icon === 'function' ? feature.icon(h) : null,
                h('span', { className: 'fo-nav-label' }, model.str(feature.label) || feature.id),
                expandable ? h('span', { className: 'fo-nav-caret', 'data-open': open ? '1' : '0', 'aria-hidden': 'true' }, '▾') : null,
              ),
              open ? h(feature.SubNav, { key: 'sub', ...featureCtx }) : null,
            )
          }),
        ),
        h('div', { className: 'fo-rail-foot' },
          h('button', {
            type: 'button',
            className: 'fo-btn',
            'data-size': 'sm',
            'data-variant': 'ghost',
            disabled: state.status === 'loading' || busy,
            onClick: () => load(false),
          }, state.status === 'loading' ? '刷新中…' : '刷新'),
          h('button', {
            type: 'button',
            className: 'fo-btn',
            'data-size': 'sm',
            'data-variant': 'ghost',
            'aria-expanded': railOpen ? 'true' : 'false',
            title: railOpen ? '收起侧栏' : '展开侧栏',
            onClick: () => setRailOpen((prev) => prev !== true),
          }, railOpen ? '«' : '»'),
        ),
      ),
      h('div', { className: 'fo-body' },
        h('div', { className: 'fo-main' },
          /* 内容头部：面包屑/标题 + 搜索框（42px / 圆角 14 / 左侧 40px 图标位）+ 动作 */
          h('header', { className: 'fo-main-head' },
            h('div', { className: 'fo-crumb' },
              h('span', { className: 'fo-crumb-title' }, scopeName),
              h('span', { className: 'fo-crumb-sub' }, subtitle.join(' · ')),
            ),
            h('div', { className: 'fo-search-wrap' },
              h('span', { className: 'fo-search-icon', 'aria-hidden': 'true' },
                h('svg', { width: 16, height: 16, viewBox: '0 0 20 20', fill: 'none', stroke: 'currentColor', strokeWidth: 1.6, strokeLinecap: 'round' },
                  h('circle', { cx: 8.5, cy: 8.5, r: 5 }),
                  h('path', { d: 'M12.3 12.3 16.5 16.5' }),
                ),
              ),
              h('input', {
                className: 'fo-search',
                type: 'text',
                value: keyword,
                placeholder: '搜索任务 / 编号 / 项目…',
                'aria-label': '搜索任务',
                onChange: (event) => setKeyword(event.currentTarget.value),
                onKeyDown: (event) => { if (event.key === 'Escape') setKeyword('') },
              }),
              keyword ? h('span', { className: 'fo-search-hint' }, `匹配 ${scopedTasks.length} 条`) : null,
            ),
            h('div', { className: 'fo-head-actions' },
              scope.kind !== 'all'
                ? h('button', { type: 'button', className: 'fo-btn', 'data-size': 'sm', onClick: () => setScope({ kind: 'all', id: '' }) }, '全部任务')
                : null,
            ),
          ),
          /* 宿主动作失败的提示（role=status）：打开会话没成功时给一句人话，别静默。 */
          hostNote
            ? h('div', { className: 'fo-note', role: 'status' },
              h('span', null, hostNote),
              h('button', { type: 'button', className: 'fo-btn', 'data-size': 'sm', 'data-variant': 'ghost', onClick: () => setHostNote('') }, '知道了'),
            )
            : null,
          state.error
            ? h('div', { className: 'fo-banner', role: 'alert' },
              h('span', null, state.error),
              h('button', { type: 'button', className: 'fo-btn', 'data-size': 'sm', onClick: () => load(false) }, '重试'),
              h('button', { type: 'button', className: 'fo-btn', 'data-size': 'sm', 'data-variant': 'ghost', onClick: () => setState((prev) => ({ ...prev, error: '' })) }, '知道了'),
            )
            : null,
          /* 一键整理失败：同一套错误条口径（role=alert + 重试），不静默。 */
          org.error
            ? h('div', { className: 'fo-banner', role: 'alert' },
              h('span', null, org.error),
              h('button', { type: 'button', className: 'fo-btn', 'data-size': 'sm', onClick: () => runOrganize() }, '重试'),
              h('button', { type: 'button', className: 'fo-btn', 'data-size': 'sm', 'data-variant': 'ghost', onClick: () => setOrg((prev) => ({ ...prev, error: '' })) }, '知道了'),
            )
            : null,
          /* 正文 = 当前功能页；功能从注册表来，骨架不认识任何具体功能 */
          h('div', { className: 'fo-feature-host', 'data-feature': activeFeatureId },
            shellNode || (featureComponent ? h(featureComponent, featureCtx) : null),
          ),
        ),
        (detailTask || detailNode)
          ? h(DetailPanel, {
            task: detailTask,
            node: detailNode,
            tasksById,
            colorOf,
            hostReady: hostCan.ok,
            hostReason: hostCan.reason,
            onOpenSession: openSession,
            onClose: () => { setDetailId(''); setFocusedId('') },
            onSelectTask: jumpToTask,
            onFocusProject: (key) => setScope({ kind: 'project', id: key }),
          })
          : null,
        org.open
          ? h(OrganizeDrawer, {
            open: true,
            batch: org.batch,
            status: org.status,
            failed: org.failed,
            droppedOpen: org.droppedOpen,
            onAccept: acceptOrganize,
            onReject: rejectOrganize,
            onClose: closeOrganize,
            onToggleDropped: toggleDropped,
          })
          : null,
      ),
      menu ? h(Menu, { React, h, menu, onRun: runMenu, onClose: () => setMenu(null) }) : null,
    )
  }
}

export default createOverviewPanel
