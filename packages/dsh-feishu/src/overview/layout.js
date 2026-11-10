/**
 * 飞书任务总览 · 关系图几何层（纯函数）
 *
 * 输入 `{tasks, relations, groups, workspaces, scope}` → 输出可以直接喂给 SVG 的
 * `{graphs[], nodes, edges, bands, width, height}`。
 *
 * 关键设计（照 task-8 规格）：
 * - **一个自定义目录 = 恰好一张图、一套坐标系**。目录里的多个项目用横向「泳道」(band)
 *   分开，但共用同一组列（列＝依赖深度）——所以跨项目的边可以在同一张图里**直连**，
 *   而不是被切成两张图再靠 ghost 假装接上。
 * - scope=all：每个目录一张图（graphs[] 多张）；scope=group：恰好一张；scope=project：
 *   恰好一张且只含该项目任务。
 * - 边的端点只要有一个不在本图的可见任务里，就补一个 **ghost 节点**（kind:'ghost'）：
 *   任务表里根本没有这个 id → `missing:true`（真缺失）；任务存在但属于别的目录 → `missing:false`
 *   （组外锚点）。这样依赖方向不会断链。
 * - 几何不变量：节点两两不重叠、都在 `[0,width]×[0,height]` 内；band 也不越界。
 *   all 模式下各图的 y 是**全局累加**的（graphs[i].top/height 是本图的纵向切片），
 *   所以把所有图的节点拼起来看也不重叠。
 *
 * 纯 ESM、零副作用、任何输入都不抛。
 */

import {
  EXTERNAL_KEY,
  EXTERNAL_LABEL,
  GROUP_PREFIX,
  arr,
  collapse,
  isObj,
  lanesForScope,
  measure,
  normScope,
  normalizeEdges,
  num,
  rank,
  refsOf,
  stateOf,
  statsOf,
  str,
  suspendedOf,
  taskNo,
  titleHints,
  truncateTitle,
  workspaceOf,
} from './model.js'

/** 几何口径：间距/圆角与宿主列表页同量级，节点尺寸按「放得下 T编号 + 标题 + 一行元信息」定。 */
export const GEOMETRY = {
  NODE_W: 232,
  NODE_H: 76,
  GAP_X: 64,
  GAP_Y: 16,
  PAD: 20,
  BAND_HEAD: 28,
  BAND_GAP: 14,
  BAND_INSET: 6,
  TITLE_WIDTH: 16,
}

/** 一个任务 → 结构化节点；x/y/列/泳道由摆位阶段填。 */
export function nodeOf(task, options) {
  const o = isObj(options) ? options : {}
  const t = isObj(task) ? task : {}
  const id = str(t.id)
  const title = truncateTitle(collapse(t.title) || id, o.titleWidth ?? GEOMETRY.TITLE_WIDTH)
  const ws = workspaceOf(t)
  const state = stateOf(t)
  return {
    key: `task:${id}`,
    id,
    kind: 'task',
    ghost: false,
    missing: false,
    role: '',
    label: title.text,
    fullTitle: title.full,
    truncated: title.truncated,
    no: taskNo(t),
    done: t.done === true,
    blocked: state === 'blocked',
    ready: state === 'open',
    suspended: state === 'suspended',
    started: t.started === true,
    state,
    sessionId: str(t.sessionId),
    workspaceKey: ws.key,
    workspaceLabel: ws.label,
    workspacePath: ws.path,
    refs: refsOf(t),
    w: GEOMETRY.NODE_W,
    h: GEOMETRY.NODE_H,
    x: 0,
    y: 0,
    depth: 0,
    column: 0,
    row: 0,
    bandKey: '',
    graphKey: '',
    colorRef: null,
  }
}

/**
 * 本图之外的关系端点 → ghost 节点。
 * `missing:true` = 任务表里压根没有这个 id（真缺失依赖）；
 * `missing:false` = 任务存在、只是不在本图的分组里（跨目录锚点）。
 */
export function ghostNode(id, graphKey, known, role, hints, options) {
  const o = isObj(options) ? options : {}
  const hit = known && known.get ? known.get(id) || null : null
  const hintTitle = hints && hints.get ? hints.get(id) || '' : ''
  const title = truncateTitle(hit ? (collapse(hit.title) || id) : (hintTitle || id), o.titleWidth ?? GEOMETRY.TITLE_WIDTH)
  const ws = hit ? workspaceOf(hit) : { key: '', label: '' }
  return {
    key: `ghost:${graphKey}:${role}:${id}`,
    id,
    kind: 'ghost',
    ghost: true,
    missing: !hit,
    role,
    label: title.text,
    fullTitle: title.full,
    truncated: title.truncated,
    no: hit ? taskNo(hit) : 0,
    done: !!hit && hit.done === true,
    blocked: false,
    ready: false,
    suspended: !!hit && suspendedOf(hit),
    started: false,
    state: 'ghost',
    sessionId: hit ? str(hit.sessionId) : '',
    workspaceKey: ws.key,
    workspaceLabel: ws.label,
    workspacePath: hit ? str(hit.workspacePath) : '',
    refs: hit ? refsOf(hit) : { predecessors: [], successors: [], sourceTasks: [], derivedTasks: [], blockedBy: [] },
    w: GEOMETRY.NODE_W,
    h: GEOMETRY.NODE_H,
    x: 0,
    y: 0,
    depth: 0,
    column: 0,
    row: 0,
    bandKey: '',
    graphKey,
    colorRef: null,
  }
}

/** 组内分层：只用 depends_on 定层；有环也不抛，把环上的节点沉到最后一列。 */
export function depthOf(ids, edges) {
  const inLane = new Set(ids)
  const depth = new Map()
  const indeg = new Map()
  const out = new Map()
  ids.forEach((id) => { depth.set(id, 0); indeg.set(id, 0); out.set(id, []) })
  edges.forEach((edge) => {
    if (edge.kind !== 'depends_on') return
    if (!inLane.has(edge.from) || !inLane.has(edge.to)) return
    out.get(edge.from).push(edge.to)
    indeg.set(edge.to, indeg.get(edge.to) + 1)
  })
  const queue = ids.filter((id) => indeg.get(id) === 0)
  let settled = 0
  for (let i = 0; i < queue.length; i += 1) {
    settled += 1
    const cur = queue[i]
    out.get(cur).forEach((next) => {
      if (depth.get(next) < depth.get(cur) + 1) depth.set(next, depth.get(cur) + 1)
      indeg.set(next, indeg.get(next) - 1)
      if (indeg.get(next) === 0) queue.push(next)
    })
  }
  if (settled < ids.length) {
    let max = 0
    depth.forEach((value) => { if (value > max) max = value })
    ids.forEach((id) => { if (indeg.get(id) > 0) depth.set(id, max + 1) })
  }
  return depth
}

/** 正交折线：右缘出发 → 横向 → 纵向 → 目标左缘；同列/回折时绕右侧再折回。 */
export function edgePath(a, b) {
  const x1 = Math.round(a.x + a.w)
  const y1 = Math.round(a.y + a.h / 2)
  let x2 = Math.round(b.x)
  const y2 = Math.round(b.y + b.h / 2)
  if (x2 - x1 < 24) {
    const endX = Math.round(b.x + b.w)
    const bend = Math.max(x1, endX) + 22
    return { path: `M${x1} ${y1} H${bend} V${y2} H${endX}`, x1, y1, x2: endX, y2 }
  }
  const mid = Math.round(x1 + Math.max(20, (x2 - x1) / 2))
  return { path: `M${x1} ${y1} H${mid} V${y2} H${x2}`, x1, y1, x2, y2 }
}

function emptyGraph(key, label) {
  return {
    key,
    id: '',
    label,
    name: label,
    kind: 'empty',
    custom: true,
    ungrouped: false,
    singleProject: false,
    scopeId: '',
    index: 0,
    projects: [],
    missingMembers: [],
    tasks: [],
    taskCount: 0,
    nodes: [],
    edges: [],
    bands: [],
    width: GEOMETRY.PAD * 2,
    height: GEOMETRY.PAD * 2,
    top: 0,
    stats: statsOf([], []),
  }
}

/** 一张图（= 一个目录 / 一个项目）的全部几何。originY 让多图在同一画布里纵向累加。 */
export function buildGraph(lane, edges, known, hints, index, originY, options) {
  const o = isObj(options) ? options : {}
  const g = GEOMETRY
  const tasks = arr(lane.tasks)
  const nodes = tasks.map((task) => nodeOf(task, o))
  const ids = new Set(nodes.map((node) => node.id))
  const graphKey = lane.key

  const laneEdges = []
  const extPred = []
  const extSucc = []
  const seenPred = new Set()
  const seenSucc = new Set()
  edges.forEach((edge) => {
    const fromIn = ids.has(edge.from)
    const toIn = ids.has(edge.to)
    if (!fromIn && !toIn) return
    laneEdges.push(edge)
    if (!fromIn && !seenPred.has(edge.from)) { seenPred.add(edge.from); extPred.push(edge.from) }
    if (!toIn && !seenSucc.has(edge.to)) { seenSucc.add(edge.to); extSucc.push(edge.to) }
  })

  const ghosts = []
  const ghostByKey = new Map()
  const ghostFor = (id, role) => {
    const key = `${role}:${id}`
    let ghost = ghostByKey.get(key)
    if (!ghost) {
      ghost = ghostNode(id, graphKey, known, role, hints, o)
      ghostByKey.set(key, ghost)
      ghosts.push(ghost)
    }
    return ghost
  }
  extPred.forEach((id) => ghostFor(id, 'predecessor'))
  extSucc.forEach((id) => ghostFor(id, 'successor'))

  const all = nodes.concat(ghosts)
  const depth = depthOf(all.map((node) => node.id), laneEdges)
  all.forEach((node) => {
    node.graphKey = graphKey
    node.depth = depth.get(node.id) ?? 0
  })

  const depthKeys = Array.from(new Set(all.map((node) => node.depth))).sort((a, b) => a - b)
  const columnOf = new Map(depthKeys.map((d, i) => [d, i]))
  const columns = depthKeys.length
  const width = Math.max(
    g.PAD * 2 + g.NODE_W,
    columns ? g.PAD * 2 + columns * g.NODE_W + (columns - 1) * g.GAP_X : g.PAD * 2,
  )

  /* 泳道：目录里的每个项目一条；本组之外的 ghost 统一落「组外 · 缺失」。
     只有一条泳道时（项目 scope）ghost 直接进这条泳道，免得出现只有 ghost 的孤带。 */
  const bandDefs = arr(lane.projects)
    .filter((project) => arr(project.tasks).length > 0)
    .map((project, i) => ({
      key: project.key,
      label: project.label,
      colorRef: num(project.colorIndex, i),
      external: false,
    }))
  const bandIndex = new Set(bandDefs.map((band) => band.key))
  const loneBand = bandDefs.length === 1 ? bandDefs[0].key : ''
  const needExternal = ghosts.some((ghost) => !loneBand && !bandIndex.has(ghost.workspaceKey))
  if (needExternal) bandDefs.push({ key: EXTERNAL_KEY, label: EXTERNAL_LABEL, colorRef: -1, external: true })

  all.forEach((node) => {
    if (bandIndex.has(node.workspaceKey)) { node.bandKey = node.workspaceKey; return }
    node.bandKey = loneBand || EXTERNAL_KEY
  })

  const bands = []
  let cursor = originY + g.PAD
  bandDefs.forEach((def) => {
    const members = all.filter((node) => node.bandKey === def.key)
    if (!members.length) return
    members.sort((a, b) => (columnOf.get(a.depth) - columnOf.get(b.depth))
      || (rank(a) - rank(b))
      || str(a.label).localeCompare(str(b.label))
      || str(a.id).localeCompare(str(b.id)))
    /* 同一行里列号必须严格递增：贪心打包，尽量少占行高。 */
    const lastColumn = []
    members.forEach((node) => {
      const column = columnOf.get(node.depth) ?? 0
      node.column = column
      let row = 0
      while (row < lastColumn.length && lastColumn[row] >= column) row += 1
      if (row === lastColumn.length) lastColumn.push(column)
      else lastColumn[row] = column
      node.row = row
      node.x = g.PAD + column * (g.NODE_W + g.GAP_X)
      node.y = cursor + g.BAND_HEAD + row * (g.NODE_H + g.GAP_Y)
      node.colorRef = def.external ? null : def.colorRef
    })
    const rows = lastColumn.length
    const h = g.BAND_HEAD + rows * g.NODE_H + (rows - 1) * g.GAP_Y
    bands.push({
      key: def.key,
      label: def.label,
      colorRef: def.colorRef,
      external: def.external === true,
      x: g.BAND_INSET,
      y: cursor,
      w: Math.max(0, width - g.BAND_INSET * 2),
      h,
      rows,
      count: members.length,
    })
    cursor += h + g.BAND_GAP
  })
  const height = bands.length ? (cursor - g.BAND_GAP + g.PAD) - originY : g.PAD * 2

  const byId = new Map()
  all.forEach((node) => { byId.set(node.id, node) })
  const drawn = []
  laneEdges.forEach((edge) => {
    const a = byId.get(edge.from)
    const b = byId.get(edge.to)
    if (!a || !b) return
    const geo = edgePath(a, b)
    drawn.push({
      key: `${edge.kind}:${a.key}>${b.key}`,
      from: a.id,
      to: b.id,
      fromKey: a.key,
      toKey: b.key,
      kind: edge.kind,
      source: edge.source,
      path: geo.path,
      x1: geo.x1,
      y1: geo.y1,
      x2: geo.x2,
      y2: geo.y2,
      fromGhost: a.ghost === true,
      toGhost: b.ghost === true,
      viaGhost: a.ghost === true || b.ghost === true,
      crossProject: a.workspaceKey !== b.workspaceKey,
      graphKey,
    })
  })

  return {
    key: graphKey,
    id: str(lane.id),
    label: str(lane.label) || str(lane.name),
    name: str(lane.name) || str(lane.label),
    kind: lane.ungrouped === true ? 'ungrouped' : (lane.singleProject === true ? 'project' : 'group'),
    custom: lane.custom !== false,
    ungrouped: lane.ungrouped === true,
    singleProject: lane.singleProject === true,
    scopeId: str(lane.id),
    index,
    projects: arr(lane.projects).map((project) => ({
      key: project.key,
      label: project.label,
      path: project.path,
      colorIndex: num(project.colorIndex, 0),
      total: num(project.total, 0),
    })),
    missingMembers: arr(lane.missingMembers).map((row) => ({ key: str(row.key), label: str(row.label) || str(row.key) })),
    tasks: tasks.map((task) => str(task.id)),
    taskCount: tasks.length,
    nodes: all,
    edges: drawn,
    bands,
    width,
    height,
    top: originY,
    stats: statsOf(tasks, laneEdges),
  }
}

/**
 * 总入口。
 *
 * scope.kind === 'all' → `{scope, graphs:[...], nodes, edges, bands, width, height, stats}`
 * 其余 → **单张图对象**（自带 nodes/edges/bands/width/height），额外挂 `graphs:[该图]`、
 * `scope`、`stats`、以及拼接后的 `nodes/edges/bands`（单图时与图自身相同）。
 *
 * 各图的 `nodes[].y` 已经在**同一个画布坐标系**里（graphs[i].top/height 是本图切片），
 * 所以 `nodes` 直接拼接也是全局不重叠的；渲染时用
 * `viewBox="0 {graph.top} {graph.width} {graph.height}"` 取本图那一窗即可。
 */
export function layoutScope(input) {
  const o = isObj(input) ? input : {}
  const list = arr(o.tasks).filter((task) => isObj(task) && str(task.id))
  const relations = arr(o.relations)
  const edges = normalizeEdges(relations)
  const known = new Map(list.map((task) => [str(task.id), task]))
  const hints = titleHints(list)
  const scope = normScope(o.scope)
  const lanes = lanesForScope(o.groups, list, scope, o.workspaces)
  const options = { titleWidth: num(o.titleWidth, GEOMETRY.TITLE_WIDTH) }

  const graphs = []
  let originY = 0
  lanes.forEach((lane, index) => {
    const graph = buildGraph(lane, edges, known, hints, index, originY, options)
    graphs.push(graph)
    originY += graph.height
  })

  const nodes = []
  const edgeList = []
  const bands = []
  graphs.forEach((graph) => {
    nodes.push(...graph.nodes)
    edgeList.push(...graph.edges)
    bands.push(...graph.bands)
  })
  const width = graphs.reduce((max, graph) => Math.max(max, graph.width), GEOMETRY.PAD * 2)
  const height = graphs.length ? originY : 0
  const stats = statsOf(list, relations)
  stats.groups = graphs.length
  stats.ghosts = nodes.filter((node) => node.ghost === true).length
  stats.missingGhosts = nodes.filter((node) => node.ghost === true && node.missing === true).length

  if (scope.kind === 'all') {
    return { scope, graphs, nodes, edges: edgeList, bands, width, height, stats }
  }
  const first = graphs.length ? graphs[0] : emptyGraph(`${GROUP_PREFIX}none`, scope.id)
  return { ...first, scope, graphs: graphs.length ? graphs : [first], stats, nodes, edges: edgeList, bands, width, height }
}

/** 便捷：任务是否会被画进图里（供调用方过滤，保持与 layoutScope 同一口径）。 */
export function isRenderableTask(task) {
  return isObj(task) && !!str(task.id)
}

/** 便捷：节点可读描述（SVG 的 aria-label / HTML 的 title 用）。 */
export function describeNode(node) {
  const n = isObj(node) ? node : {}
  const meta = describeNodeMeta(n)
  if (n.ghost === true) {
    return `${n.missing === true ? '缺失任务' : '组外任务'} ${str(n.id)}：${n.fullTitle || ''}${meta ? `（${meta}）` : ''}`
  }
  return `${n.no > 0 ? `T${n.no} ` : ''}${n.fullTitle || n.id}${meta ? `，${meta}` : ''}`
}

export function describeNodeMeta(node) {
  const n = isObj(node) ? node : {}
  if (n.ghost === true) {
    if (n.missing === true) return '任务不存在 · 仅剩关系'
    const owner = n.workspaceLabel || '其他项目'
    return `属于 ${owner}`
  }
  const refs = isObj(n.refs) ? n.refs : {}
  const bits = []
  if (n.state === 'blocked') bits.push(`阻塞 ${arr(refs.blockedBy).length}`)
  else bits.push(n.state === 'open' ? '就绪' : (n.state === 'done' ? '已完成' : '已挂起'))
  const out = arr(refs.successors).length
  if (out) bits.push(`后置 ${out}`)
  return bits.join(' · ')
}

/** 便捷：节点标题在节点宽度内是否还需要 tooltip。 */
export function needsTooltip(node) {
  const n = isObj(node) ? node : {}
  return n.truncated === true || measure(n.fullTitle) > measure(n.label)
}

/* truncateTitle / stateOf / workspaceOf / measure 也在 model 里导出，这里再导出一次方便图上直接用。 */
export { truncateTitle, stateOf, workspaceOf, measure }
