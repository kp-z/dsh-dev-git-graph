/**
 * 飞书任务集 · 纯函数层（树 / scope / 统计 / 右键菜单）
 *
 * 约束（照 task-8 的规格）：
 * - **纯 ESM、零 import、零副作用**：node 可以直接 `import('./model.js')` 跑断言，
 *   也能被打包器原样吃进浏览器半体。
 * - 任何输入都不抛：字段缺、类型错、数组里混进 null，一律就地规整或丢弃。
 * - 不改入参：所有返回都是新对象/新数组。
 *
 * 数据由宿主瘦接口给（`{groups, workspaces, tasks, relations, stats}`），本文件只做
 * 「任务 → 项目 → 自定义目录」的三层规整，不碰 IO、不碰视图状态。
 *
 * 三层树：
 *   0 全部任务（root）
 *   1 自定义目录（用户自己拖出来的分组，未进任何目录的落「未分组」桶）
 *   2 项目（= workspace，key 为 workspaceKey || workspaceId || workspacePath || 'name:'+标题）
 */

/** 未进任何自定义目录的桶。 */
export const UNGROUPED_KEY = '__ungrouped__'
export const UNGROUPED_LABEL = '未分组'
/** 图里的「组外 / 缺失」泳道：依赖指向了本图之外的任务。 */
export const EXTERNAL_KEY = '__external__'
export const EXTERNAL_LABEL = '组外 · 缺失'
/** 树行 key 的前缀（目录行）。项目行用 'project:'。 */
export const GROUP_PREFIX = 'group:'
/** 项目分色槽位数（真正的颜色由 client/styles.js 的 --fo-deco-N 给，这里只发索引）。 */
export const DECO_SLOTS = 8
/** 关系摘要里带标题的字段：缺失任务的标题只能从这儿捡回来。 */
export const REF_FIELDS = ['predecessors', 'successors', 'sourceTasks', 'derivedTasks', 'earlierTasks', 'laterTasks', 'blockedBy']
export const SCOPES = { all: true, group: true, project: true }

/* 画布上认的三种边：依赖（实线）、来源（虚线）、时间先后（点线）。 */
const KINDS = { depends_on: true, derived_from: true, temporal: true }
const ELLIPSIS = '…'

export function isObj(value) { return !!value && typeof value === 'object' && !Array.isArray(value) }
export function arr(value) { return Array.isArray(value) ? value : [] }

export function str(value) {
  if (typeof value === 'string') return value
  if (typeof value === 'number' && isFinite(value)) return String(value)
  return ''
}

export function num(value, fallback) {
  const n = typeof value === 'number' ? value : Number(value)
  return isFinite(n) ? n : fallback
}

export function collapse(value) { return str(value).replace(/\s+/g, ' ').trim() }

/** 视觉宽度估算：CJK 记 1，其余记 0.56。用于按「节点里放得下几个字」截断标题。 */
export function measure(value) {
  const s = str(value)
  let w = 0
  for (let i = 0; i < s.length; i += 1) w += s.charCodeAt(i) > 0x2e80 ? 1 : 0.56
  return w
}

/** 长标题截断：返回 `{text, full, truncated}`，full 永远是压过空白的全文。 */
export function truncateTitle(value, budget) {
  const full = collapse(value)
  let max = num(budget, 0)
  if (!(max > 1.5)) max = 16
  if (measure(full) <= max) return { text: full, full, truncated: false }
  let out = ''
  let used = 0
  for (let i = 0; i < full.length; i += 1) {
    const ch = full.charAt(i)
    const cost = measure(ch)
    if (used + cost > max - measure(ELLIPSIS)) break
    out += ch
    used += cost
  }
  out = out.replace(/\s+$/, '')
  return { text: (out || full.slice(0, 1)) + ELLIPSIS, full, truncated: true }
}

export function taskNo(task) {
  const n = Math.floor(num(isObj(task) ? task.no : 0, 0))
  return n > 0 ? n : 0
}

export function taskLabel(task) {
  const no = taskNo(task)
  if (no > 0) return `T${no}`
  return str(isObj(task) ? task.id : '').slice(0, 8) || '任务'
}

/** 排序用：有编号的按编号，没有的沉到最后。 */
export function rank(task) {
  const no = taskNo(task)
  return no > 0 ? no : 1e9
}

/**
 * 项目归属：workspaceKey > workspaceId > workspacePath > 名字。
 * 兼容旧字段（workspaceId / workspaceName / meta.workspace），都没有就是「未归属」。
 */
export function workspaceOf(task) {
  const t = isObj(task) ? task : {}
  const key0 = str(t.workspaceKey).trim()
  const id = str(t.workspaceId).trim()
  const path = str(t.workspacePath).trim()
  let label = collapse(t.workspaceTitle) || collapse(t.workspaceName) || collapse(isObj(t.meta) ? t.meta.workspace : '')
  if (!label && path) label = path.replace(/\/+$/, '').split('/').pop() || path
  if (!label && id) label = id
  const key = key0 || id || path || (label ? `name:${label}` : '')
  if (!key) return { key: UNGROUPED_KEY, label: UNGROUPED_LABEL, id: '', path: '', ungrouped: true }
  return { key, label: label || key, id, path, ungrouped: false }
}

/** 路径 → 上一级目录。 */
export function dirOf(path) {
  const p = str(path).replace(/\\/g, '/').trim().replace(/\/+$/, '')
  if (!p) return ''
  const at = p.lastIndexOf('/')
  if (at < 0) return ''
  if (at === 0) return '/'
  return p.slice(0, at)
}

/** 目录缩写：/Users/<user>/… 与 /home/<user>/… 缩成 ~/…。 */
export function shortenPath(value) {
  const raw = str(value).trim()
  if (!raw) return ''
  const hit = /^\/(?:Users|home)\/([^/]+)(\/.*)?$/.exec(raw)
  if (!hit) return raw
  return `~${hit[2] || ''}`
}

/** 关系项（字符串 id 或 {id,title}）→ id。 */
export function refId(item) {
  if (typeof item === 'string') return item.trim()
  if (typeof item === 'number' && isFinite(item)) return String(item)
  return str(isObj(item) ? item.id : '').trim()
}

export function refTitle(item) {
  return collapse(isObj(item) ? item.title : '')
}

/** 任意关系列表 → [{id,title}]（丢掉没有 id 的坏行）。 */
export function refList(list) {
  const out = []
  for (const item of arr(list)) {
    const id = refId(item)
    if (!id) continue
    out.push({ id, title: refTitle(item) })
  }
  return out
}

/** 扁平契约的五个关系字段 → 规整后的 `{field: [{id,title}]}`；兼容旧的嵌套 relations。 */
export function refsOf(task) {
  const t = isObj(task) ? task : {}
  const rel = isObj(t.relations) ? t.relations : null
  const pick = (field) => refList(t[field] !== undefined ? t[field] : (rel ? rel[field] : undefined))
  const out = {}
  for (const field of REF_FIELDS) out[field] = pick(field)
  return out
}

export function suspendedOf(task) {
  const t = isObj(task) ? task : {}
  if (t.suspended === true) return true
  return isObj(t.suspension) && t.suspension.active === true
}

/**
 * 是否被阻塞：优先信契约给的 blocked 布尔；没有就按旧口径从关系推。
 * 完成后一律不算阻塞。
 */
export function blockedOf(task) {
  const t = isObj(task) ? task : {}
  if (t.done === true) return false
  if (typeof t.blocked === 'boolean') return t.blocked
  const rel = isObj(t.relations) ? t.relations : null
  if (rel) {
    if (rel.ready === true) return false
    if (arr(rel.blockedBy).length > 0) return true
    if (rel.ready === false) return true
  }
  if (t.ready === true) return false
  if (arr(t.blockedBy).length > 0) return true
  return t.ready === false
}

export function readyOf(task) {
  const t = isObj(task) ? task : {}
  if (t.done === true) return false
  if (suspendedOf(t)) return false
  if (blockedOf(t)) return false
  return t.ready !== false
}

/** 四态：done / suspended / blocked / open（open = 可以做）。 */
export function stateOf(task) {
  const t = isObj(task) ? task : {}
  if (t.done === true) return 'done'
  if (suspendedOf(t)) return 'suspended'
  if (blockedOf(t)) return 'blocked'
  return 'open'
}

export function stateLabel(state) {
  if (state === 'done') return '已完成'
  if (state === 'blocked') return '阻塞'
  if (state === 'suspended') return '已挂起'
  if (state === 'ghost') return '组外 / 缺失'
  return '就绪'
}

/** 关系去重：只认 depends_on / derived_from / temporal，自环丢弃；坏行静默跳过。 */
export function normalizeEdges(relations) {
  const seen = new Set()
  const out = []
  for (const edge of arr(relations)) {
    if (!isObj(edge)) continue
    const from = str(edge.from).trim()
    const to = str(edge.to).trim()
    const kind = KINDS[str(edge.kind)] ? str(edge.kind) : ''
    if (!from || !to || !kind || from === to) continue
    const key = `${kind}|${from}|${to}`
    if (seen.has(key)) continue
    seen.add(key)
    out.push({ from, to, kind, source: str(edge.source) })
  }
  return out
}

function emptyProject(key, label, path, ungrouped) {
  return { key, label, id: '', path: path || '', ungrouped: ungrouped === true, tasks: [], total: 0, open: 0, done: 0, blocked: 0, ready: 0, suspended: 0, colorIndex: 0 }
}

function fillProject(project) {
  let open = 0
  let done = 0
  let blocked = 0
  let ready = 0
  let suspended = 0
  for (const task of project.tasks) {
    const state = stateOf(task)
    if (state === 'done') { done += 1; continue }
    open += 1
    if (state === 'blocked') blocked += 1
    else if (state === 'suspended') suspended += 1
    else ready += 1
  }
  project.total = project.tasks.length
  project.open = open
  project.done = done
  project.blocked = blocked
  project.ready = ready
  project.suspended = suspended
  if (!project.path) {
    for (const task of project.tasks) {
      const p = str(task.workspacePath).trim()
      if (p) { project.path = p; break }
    }
  }
  return project
}

/**
 * 按项目（workspace）分组：组内按编号排序；组间「有阻塞的在前」，未归属沉底。
 * `workspaces` 是宿主给的完整项目表（含 0 任务的项目），传了就会补出空项目行 ——
 * 否则「没有任务的项目」在树上连入口都没有，用户没法把它拖进目录。
 */
export function groupTasks(tasks, workspaces) {
  const map = new Map()
  const order = []
  for (const task of arr(tasks)) {
    if (!isObj(task) || !str(task.id)) continue
    const ws = workspaceOf(task)
    let project = map.get(ws.key)
    if (!project) {
      project = emptyProject(ws.key, ws.label, ws.path, ws.ungrouped)
      map.set(ws.key, project)
      order.push(project)
    }
    if (ws.path && !project.path) project.path = ws.path
    project.tasks.push(task)
  }
  for (const row of arr(workspaces)) {
    if (!isObj(row)) continue
    const path = str(row.path).trim()
    const title = collapse(row.title) || collapse(row.id) || path
    const key = str(row.key).trim() || str(row.id).trim() || path || (title ? `name:${title}` : '')
    if (!key) continue
    const hit = map.get(key)
    if (hit) {
      if (!hit.path && path) hit.path = path
      /* 项目图标/颜色：纯展示配置，跟着 workspace 行走（气泡、树行、详情都用它） */
      hit.logo = str(row.logo)
      hit.logoColor = str(row.logoColor)
      continue
    }
    const project = emptyProject(key, title || key, path, false)
    project.logo = str(row.logo)
    project.logoColor = str(row.logoColor)
    map.set(key, project)
    order.push(project)
  }
  order.forEach((project) => {
    project.tasks.sort((a, b) => rank(a) - rank(b)
      || collapse(a.title).localeCompare(collapse(b.title))
      || str(a.id).localeCompare(str(b.id)))
    fillProject(project)
  })
  order.sort((a, b) => {
    if (a.ungrouped !== b.ungrouped) return a.ungrouped ? 1 : -1
    return b.blocked - a.blocked || b.open - a.open || a.label.localeCompare(b.label)
  })
  return order
}

/** 宿主快照里的自定义目录 → 纯数据；坏行丢掉，成员去重保序。 */
export function normalizeGroups(raw) {
  const seen = new Set()
  const out = []
  for (const row of arr(raw)) {
    if (!isObj(row)) continue
    const id = str(row.id).trim()
    const name = collapse(row.name)
    if (!id || !name || seen.has(id)) continue
    seen.add(id)
    const members = []
    const memberSeen = new Set()
    for (const value of arr(row.members)) {
      const key = str(value).trim()
      if (!key || memberSeen.has(key)) continue
      memberSeen.add(key)
      members.push(key)
    }
    out.push({
      id,
      name,
      members,
      labels: isObj(row.labels) ? { ...row.labels } : {},
      createdAt: num(row.createdAt, 0),
      updatedAt: num(row.updatedAt, 0),
    })
  }
  return out
}

function fillLane(lane, groupId) {
  lane.tasks = []
  lane.total = 0
  lane.open = 0
  lane.done = 0
  lane.blocked = 0
  lane.ready = 0
  lane.suspended = 0
  lane.colorOf = {}
  lane.projects.forEach((project, index) => {
    project.colorIndex = index % DECO_SLOTS
    project.groupId = groupId
    lane.colorOf[project.key] = project.colorIndex
    lane.tasks.push(...project.tasks)
    lane.total += project.total
    lane.open += project.open
    lane.done += project.done
    lane.blocked += project.blocked
    lane.ready += project.ready
    lane.suspended += project.suspended
  })
  lane.taskCount = lane.total
  lane.projectCount = lane.projects.length
  return lane
}

/**
 * 按自定义目录分组：用户把若干 workspace 拖成一组并起名（比如「QV」），
 * 这一组就是「一个项目」——它的全部任务画在**同一张图、同一套坐标**里。
 * 一个 workspace 只属于一个目录（先到先得）；没进任何目录的落「未分组」桶。
 */
export function groupByCustom(groups, tasks, workspaces) {
  const projects = groupTasks(tasks, workspaces)
  const byKey = new Map(projects.map((project) => [project.key, project]))
  const claimed = new Set()
  const out = []

  for (const def of normalizeGroups(groups)) {
    const lane = {
      key: GROUP_PREFIX + def.id,
      id: def.id,
      name: def.name,
      label: def.name,
      custom: true,
      ungrouped: false,
      members: [...def.members],
      labels: { ...def.labels },
      missingMembers: [],
      projects: [],
      tasks: [],
    }
    for (const key of def.members) {
      const project = byKey.get(key)
      if (!project) {
        /* 工作区被删/改名了：成员还在，但当前任务集里没有它 —— 只提示，不画。 */
        lane.missingMembers.push({ key, label: collapse(def.labels[key]) || key })
        continue
      }
      if (claimed.has(key)) continue
      claimed.add(key)
      lane.projects.push(project)
    }
    out.push(fillLane(lane, def.id))
  }

  const rest = projects.filter((project) => !claimed.has(project.key))
  if (rest.length) {
    const bucket = {
      key: UNGROUPED_KEY,
      id: '',
      name: UNGROUPED_LABEL,
      label: UNGROUPED_LABEL,
      custom: true,
      ungrouped: true,
      members: [],
      labels: {},
      missingMembers: [],
      projects: rest,
      tasks: [],
    }
    out.push(fillLane(bucket, ''))
  }
  return out
}

/** scope 规整成 `{kind:'all'|'group'|'project', id, members}`；坏输入 = 全部任务。 */
export function normScope(scope) {
  const s = isObj(scope) ? scope : {}
  const kind = str(s.kind).trim()
  const id = str(s.id).trim()
  const members = []
  const seen = new Set()
  for (const value of arr(s.members)) {
    const key = str(value).trim()
    if (!key || seen.has(key)) continue
    seen.add(key)
    members.push(key)
  }
  if (kind === 'group' && id) return { kind: 'group', id, members }
  if (kind === 'project' && id) return { kind: 'project', id, members }
  return { kind: 'all', id: '', members }
}

export function scopeKey(scope) {
  const s = normScope(scope)
  return s.kind === 'all' ? 'all' : `${s.kind}:${s.id}`
}

/** 这条泳道是不是 scope 指的那个目录（未分组桶用 UNGROUPED_KEY 指代）。 */
export function laneInScope(lane, scope) {
  const s = normScope(scope)
  if (s.kind === 'all') return true
  if (s.kind !== 'group') return false
  return lane.ungrouped ? s.id === UNGROUPED_KEY : lane.id === s.id
}

function singleProjectLane(project) {
  const lane = {
    key: `${GROUP_PREFIX}project:${project.key}`,
    id: project.key,
    name: project.label,
    label: project.label,
    custom: true,
    ungrouped: false,
    singleProject: true,
    members: [project.key],
    labels: {},
    missingMembers: [],
    projects: [project],
    tasks: [],
  }
  return fillLane(lane, '')
}

/**
 * scope → 这次要画哪几张图。
 * - all：每个自定义目录一张（未分组桶也算一张）
 * - group：恰好一张（该目录的全部项目共用一个坐标系）
 * - project：恰好一张（只有这个项目）
 */
export function lanesForScope(groups, tasks, scope, workspaces) {
  const all = groupByCustom(groups, tasks, workspaces)
  const s = normScope(scope)
  if (s.kind === 'all') return all
  if (s.kind === 'group') return all.filter((lane) => laneInScope(lane, s))
  const out = []
  all.forEach((lane) => {
    lane.projects.forEach((project) => {
      if (project.key !== s.id) return
      out.push(singleProjectLane(project))
    })
  })
  return out
}

/**
 * scope → 该 scope 覆盖的任务。
 * 目录 scope 需要 owner→成员的映射：优先用 scope.members，其次拿 `groups` 现算。
 */
export function scopeTasks(tasks, scope, groups) {
  const list = arr(tasks).filter((task) => isObj(task) && str(task.id))
  const s = normScope(scope)
  if (s.kind === 'all') return list
  if (s.kind === 'project') return list.filter((task) => workspaceOf(task).key === s.id)
  let members = s.members.length ? s.members : null
  if (!members) {
    const lanes = groupByCustom(groups || [], list)
    const lane = s.id === UNGROUPED_KEY
      ? lanes.find((row) => row.ungrouped === true)
      : lanes.find((row) => row.id === s.id)
    members = lane ? lane.projects.map((project) => project.key) : []
  }
  const set = new Set(members)
  return list.filter((task) => set.has(workspaceOf(task).key))
}

/** scope 的人话名字（面包屑/图头用）。 */
export function scopeLabel(scope, groups) {
  const s = normScope(scope)
  if (s.kind === 'all') return '全部任务'
  if (s.kind === 'project') return s.id
  if (s.id === UNGROUPED_KEY) return UNGROUPED_LABEL
  const def = normalizeGroups(groups).find((row) => row.id === s.id)
  return def ? def.name : s.id
}

/**
 * 左栏那棵树的纯构造：三层 —— 全部任务 / 自定义目录 / 项目。
 *
 * 返回 `{rows, byKey, lanes, scope, selected, collapsed}`：
 * - `rows` 是**可见**的扁平行（折叠掉的子行不进 rows）；
 * - `byKey` 装下**全部**行，折叠的也在 —— 否则「选中项被折叠」会被误判成
 *   「选中项没了」，把用户的选择重置掉。
 * 任何输入都不抛。
 */
export function buildTree(groups, tasks, options) {
  const o = isObj(options) ? options : {}
  const collapsed = isObj(o.collapsed) ? o.collapsed : {}
  const scope = normScope(o.selection)
  const lanes = groupByCustom(groups, tasks, o.workspaces)
  const list = arr(tasks).filter((task) => isObj(task) && str(task.id))
  const rows = []
  const byKey = {}
  let selected = null

  function push(row, visible) {
    row.selected = scope.kind === row.kind && scope.id === str(row.id)
    if (row.selected) selected = row
    byKey[row.key] = row
    if (visible !== false) rows.push(row)
    return row
  }

  const allRow = push({
    key: 'all',
    kind: 'all',
    id: '',
    label: '全部任务',
    depth: 0,
    count: list.length,
    tasks: list.length,
    open: 0,
    done: 0,
    blocked: 0,
    ready: 0,
    suspended: 0,
    collapsed: collapsed.all === true,
  })
  list.forEach((task) => {
    const state = stateOf(task)
    if (state === 'done') { allRow.done += 1; return }
    allRow.open += 1
    if (state === 'blocked') allRow.blocked += 1
    else if (state === 'suspended') allRow.suspended += 1
    else allRow.ready += 1
  })

  const rootVisible = allRow.collapsed !== true
  lanes.forEach((lane) => {
    const bucket = lane.ungrouped === true
    const id = bucket ? UNGROUPED_KEY : lane.id
    const key = GROUP_PREFIX + id
    const groupRow = push({
      key,
      kind: 'group',
      id,
      label: lane.label,
      depth: 1,
      count: lane.projectCount,
      tasks: lane.total,
      open: lane.open,
      done: lane.done,
      blocked: lane.blocked,
      ready: lane.ready,
      suspended: lane.suspended,
      ungrouped: bucket,
      members: lane.members.slice(),
      labels: { ...lane.labels },
      missing: lane.missingMembers.length,
      colorOf: { ...lane.colorOf },
      collapsed: collapsed[key] === true,
    }, rootVisible)
    const groupVisible = rootVisible && groupRow.collapsed !== true
    lane.projects.forEach((project) => {
      push({
        key: `project:${project.key}`,
        kind: 'project',
        id: project.key,
        label: project.label,
        logo: project.logo || '',
        logoColor: project.logoColor || '',
        depth: 2,
        count: project.total,
        tasks: project.total,
        open: project.open,
        done: project.done,
        blocked: project.blocked,
        ready: project.ready,
        suspended: project.suspended,
        groupId: id,
        groupLabel: lane.label,
        ungrouped: bucket,
        path: project.path,
        colorIndex: project.colorIndex,
      }, groupVisible)
    })
  })

  return { rows, byKey, lanes, scope, selected, collapsed }
}

/**
 * 行的右键菜单：纯构造，不碰 DOM、不写存储。
 * 返回菜单项数组（可带 submenu）：
 * - 全部任务：刷新
 * - 目录：重命名 / 删除 / 分隔线 / 新建目录（未分组桶只有新建目录）
 * - 项目：移入目录 ▸（各目录 + 分隔线 +「新建目录并移入…」）/ 移出目录 / 只看这个项目
 * 每项 `{id, label, kind:'item'|'separator', disabled?, checked?, danger?, submenu?}`。
 */
export function rowMenu(row, groups, scope) {
  const r = isObj(row) ? row : {}
  const defs = normalizeGroups(groups)
  const s = normScope(scope)
  const kind = str(r.kind)
  const key = str(r.id)

  if (kind === 'all') return [{ id: 'refresh', label: '刷新', kind: 'item' }]

  if (kind === 'group') {
    if (r.ungrouped === true) return [{ id: 'new-group', label: '新建目录', kind: 'item' }]
    return [
      { id: 'rename', label: '重命名', kind: 'item', groupId: key },
      { id: 'delete', label: '删除', kind: 'item', groupId: key, danger: true },
      { kind: 'separator' },
      { id: 'new-group', label: '新建目录', kind: 'item' },
    ]
  }

  if (kind === 'project') {
    /* 项目图标（纯本地展示）：放在最前面，和「移入目录」分开 */
    const logoItem = { id: 'logo', label: '设置图标…', kind: 'item', projectKey: key }
    let current = ''
    defs.forEach((def) => { if (def.members.includes(key)) current = def.id })
    const submenu = defs.map((def) => ({
      id: `move:${def.id}`,
      label: def.name,
      kind: 'item',
      groupId: def.id,
      projectKey: key,
      disabled: def.id === current,
      checked: def.id === current,
    }))
    submenu.push({ kind: 'separator' })
    submenu.push({ id: 'move-new', label: '新建目录并移入…', kind: 'item', projectKey: key })
    return [
      logoItem,
      { id: 'move', label: '移入目录', kind: 'item', submenu, projectKey: key },
      { id: 'remove', label: '移出目录', kind: 'item', projectKey: key, disabled: !current },
      { kind: 'separator' },
      { id: 'focus', label: '只看这个项目', kind: 'item', projectKey: key, checked: s.kind === 'project' && s.id === key },
    ]
  }
  return []
}

/**
 * 统计（**相对传入的任务集**，所以 scope 局部统计也成立）。
 *
 * 口径：
 * - `open` = 未完成（含阻塞/挂起），`ready` = 可开工，`done` = 已完成。
 * - 边只数「至少一端在这批任务里」的：两端都在外面的边跟这批任务无关，
 *   数进来会让「目录的边」看起来比图上画的多。
 * - `externalEdges` = 只有一端在里面的边（图上会以 ghost 端点呈现）；
 *   `missingGhosts` = 这些端点在任务集里根本不存在的个数。
 */
export function statsOf(tasks, relations) {
  const list = arr(tasks).filter((task) => isObj(task) && str(task.id))
  const edges = normalizeEdges(relations)
  const stats = {
    tasks: list.length,
    open: 0,
    done: 0,
    blocked: 0,
    ready: 0,
    suspended: 0,
    dependencyEdges: 0,
    provenanceEdges: 0,
    temporalEdges: 0,
    externalEdges: 0,
    missingGhosts: 0,
    crossProject: 0,
    projects: 0,
    groups: 0,
    ghosts: 0,
  }
  const known = new Map(list.map((task) => [str(task.id), task]))
  list.forEach((task) => {
    const state = stateOf(task)
    if (state === 'done') { stats.done += 1; return }
    stats.open += 1
    if (state === 'blocked') stats.blocked += 1
    else if (state === 'suspended') stats.suspended += 1
    else stats.ready += 1
  })
  const missing = new Set()
  const cross = new Set()
  edges.forEach((edge) => {
    const a = known.get(edge.from)
    const b = known.get(edge.to)
    if (!a && !b) return
    if (edge.kind === 'depends_on') stats.dependencyEdges += 1
    else if (edge.kind === 'temporal') stats.temporalEdges += 1
    else stats.provenanceEdges += 1
    if (!a || !b) stats.externalEdges += 1
    if (!a) missing.add(edge.from)
    if (!b) missing.add(edge.to)
    if (a && b) {
      const ka = workspaceOf(a).key
      const kb = workspaceOf(b).key
      if (ka !== kb) cross.add(`${ka}>${kb}`)
    }
  })
  stats.missingGhosts = missing.size
  stats.crossProject = cross.size
  const projects = new Set(list.map((task) => workspaceOf(task).key))
  stats.projects = projects.size
  /* 契约里的 stats.groups：这里指「这批任务横跨几个项目」，与宿主的口径同名同义。 */
  stats.groups = projects.size
  return stats
}

/** 关系摘要里留着的 {id,title} —— 缺失任务的标题只能从这儿捡回来。 */
export function titleHints(tasks) {
  const hints = new Map()
  arr(tasks).forEach((task) => {
    if (!isObj(task)) return
    const refs = refsOf(task)
    for (const field of REF_FIELDS) {
      for (const ref of refs[field]) {
        if (ref.title && !hints.has(ref.id)) hints.set(ref.id, ref.title)
      }
    }
  })
  return hints
}

/** 任务 id → 画布上的节点（优先真实节点，其次 ghost）。 */
export function indexNodes(model) {
  const index = {}
  arr(isObj(model) ? model.nodes : null).forEach((node) => {
    if (!isObj(node) || !node.id) return
    const current = index[node.id]
    if (!current || (current.ghost === true && node.ghost !== true)) index[node.id] = node
  })
  return index
}

/** 便捷：任务数组 → 行菜单用它时需要的项目 key 集合。 */
export function projectKeysOf(tasks) {
  const out = []
  const seen = new Set()
  for (const task of arr(tasks)) {
    if (!isObj(task) || !str(task.id)) continue
    const key = workspaceOf(task).key
    if (seen.has(key)) continue
    seen.add(key)
    out.push(key)
  }
  return out
}
