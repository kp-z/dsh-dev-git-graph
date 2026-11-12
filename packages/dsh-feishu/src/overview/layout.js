/**
 * 飞书任务集 · 关系图几何层（纯函数）
 *
 * 输入 `{tasks, relations, groups, workspaces, scope}` → 输出可以直接喂给 SVG 的
 * `{graphs[], nodes, edges, bands, width, height}`。
 *
 * 关键设计（task-13 起）：
 * - **一个自定义目录 = 恰好一张画布、一套坐标系，且不再按项目分块**：目录内的全部任务
 *   一次性布局（列＝依赖深度，同列内按项目色→编号排行）。跨项目的边因此天然直连。
 *   项目身份由**节点分色**（`colorRef` → --fo-deco-N）与**图头图例**（`legend`）承担。
 * - 泳道（bands）已废弃：返回值里保留 `bands: []` 只是为了让形状稳定，组件不再画泳道。
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
  /** 节点卡片宽：左侧动作列 + 中间信息列 + 右侧状态胶囊刚好放得下（见 CARD）。 */
  NODE_W: 264,
  NODE_H: 88,
  GAP_X: 64,
  GAP_Y: 16,
  PAD: 20,
  /** 标题预算（measure 口径：一个汉字 1、一个 ASCII 0.56）。中间信息列 162px / 12px 字号 ≈ 13.5 */
  TITLE_WIDTH: 13,
  /** 拖动吸附网格：与参考站 WorkflowEditor 的 GRID_SIZE 一致，也是画布格线间距（--fo-grid-size）。 */
  GRID: 40,
}

/**
 * 节点卡片内部口径（task-15：参考项目 workflow 式的「左动作列 | 中信息 | 右状态」三段结构）。
 *
 * 坐标系是**节点局部**的：`cardGeometry(node)` 把 node.x/node.y 也算进去，返回各处可直接喂给
 * SVG 的绝对坐标。这样纯函数层就能断言「三段不重叠 / 动作列留够 / 都在卡片内」，
 * 组件只负责把 svg rect / text / path 摆到这些坐标上（拖动时用新位置重算一次即可）。
 */
export const CARD = {
  RADIUS: 12,
  BORDER: 2,
  /** 卡片内边距：元素离卡片边缘的距离。 */
  PAD: 10,
  /** 左侧动作列：两个 22×22 的动作按钮竖排（图标 14px），列宽 22、间距 6。 */
  ACTION_W: 22,
  ACTION_SIZE: 22,
  ACTION_GAP: 6,
  ACTION_RADIUS: 6,
  /** 右侧状态胶囊：44×24，居中。 */
  STATUS_W: 44,
  STATUS_H: 24,
  STATUS_RADIUS: 8,
  /** 三段之间的水平间距。 */
  COL_GAP: 8,
  /** 中间信息列三行文字的基线（相对节点左上角）：编号 eyebrow / 标题 / meta。 */
  ROW_EYEBROW: 24,
  ROW_TITLE: 46,
  ROW_META: 66,
  /** meta 行的截断预算（measure 口径）。 */
  META_WIDTH: 20,
}

/** 吸附到网格（参考站 `Math.round(v / GRID_SIZE) * GRID_SIZE`；GRID=40）。 */
export function snapToGrid(value, grid) {
  const step = num(grid, GEOMETRY.GRID) > 0 ? num(grid, GEOMETRY.GRID) : GEOMETRY.GRID
  return Math.round(num(value, 0) / step) * step
}

/**
 * 节点卡片几何：卡片外框 + 左侧动作列（含两个按钮的矩形）+ 中间三行文字 + 右侧状态胶囊。
 * ghost 节点没有动作列（不可操作），文字直接铺满卡片，右侧仍是状态胶囊（缺失/组外）。
 */
export function cardGeometry(node) {
  const n = isObj(node) ? node : {}
  const x = num(n.x, 0)
  const y = num(n.y, 0)
  const w = num(n.w, GEOMETRY.NODE_W)
  const h = num(n.h, GEOMETRY.NODE_H)
  const ghost = n.ghost === true
  const actionX = x + CARD.PAD
  const actionY = y + Math.round((h - (CARD.ACTION_SIZE * 2 + CARD.ACTION_GAP)) / 2)
  const statusX = x + w - CARD.PAD - CARD.STATUS_W
  const statusY = y + Math.round((h - CARD.STATUS_H) / 2)
  const textX = ghost ? x + CARD.PAD : actionX + CARD.ACTION_W + CARD.COL_GAP
  const textRight = ghost ? x + w - CARD.PAD : statusX - CARD.COL_GAP
  const buttons = ghost ? [] : [
    { key: 'open', x: actionX, y: actionY, w: CARD.ACTION_SIZE, h: CARD.ACTION_SIZE, radius: CARD.ACTION_RADIUS },
    { key: 'focus', x: actionX, y: actionY + CARD.ACTION_SIZE + CARD.ACTION_GAP, w: CARD.ACTION_SIZE, h: CARD.ACTION_SIZE, radius: CARD.ACTION_RADIUS },
  ]
  return {
    x, y, w, h, ghost,
    radius: CARD.RADIUS,
    border: CARD.BORDER,
    action: {
      x: actionX, y: actionY, w: CARD.ACTION_W,
      h: CARD.ACTION_SIZE * 2 + CARD.ACTION_GAP,
      size: CARD.ACTION_SIZE, gap: CARD.ACTION_GAP, radius: CARD.ACTION_RADIUS,
      buttons,
    },
    text: {
      x: textX,
      right: textRight,
      w: Math.max(24, textRight - textX),
      eyebrow: y + CARD.ROW_EYEBROW,
      title: y + CARD.ROW_TITLE,
      meta: y + CARD.ROW_META,
    },
    status: { x: statusX, y: statusY, w: CARD.STATUS_W, h: CARD.STATUS_H, radius: CARD.STATUS_RADIUS },
  }
}

/** 状态胶囊里那两三个字（大写口径，与参考站右栏的 RUN/OK/WAIT 同量级）。 */
export function statusLabel(node) {
  const n = isObj(node) ? node : {}
  if (n.ghost === true || n.state === 'ghost') return n.missing === true ? '缺失' : '组外'
  if (n.state === 'done') return '完成'
  if (n.state === 'blocked') return '阻塞'
  if (n.state === 'suspended') return '挂起'
  return '就绪'
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
    subColumn: 0,
    row: 0,
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
    subColumn: 0,
    row: 0,
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
    legend: [],
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

  /* 节点分色：项目身份现在只靠颜色 + 图头图例（没有泳道了）。
     颜色索引来自 lane.colorOf（由 model.groupByCustom 按目录内项目顺序分配）。 */
  const colorOf = isObj(lane.colorOf) ? lane.colorOf : {}
  all.forEach((node) => {
    const hit = colorOf[node.workspaceKey]
    node.colorRef = hit == null || !isFinite(Number(hit)) ? null : Number(hit)
  })

  /* 合并布局：整张画布 = 该目录的全部任务 + ghost 一次性铺开，不再按项目切块。
     列 = 依赖深度（左→右就是依赖方向），行 = 列内序号；**列太长就折成多根物理列**，
     否则「40 个互不依赖的任务」会变成一条 40 行的细长条，铺满画布缩放后小到看不清。
     不重叠的理由：同一根物理列里行号各不相同；不同列 x 区间互不相交。 */
  const rowsPerColumn = Math.max(3, Math.min(14, Math.ceil(Math.sqrt(2 * Math.max(1, all.length)))))
  const columnNodes = new Map(depthKeys.map((depth) => [depth, []]))
  all.forEach((node) => { columnNodes.get(node.depth).push(node) })
  let physicalColumns = 0
  let maxRows = 0
  depthKeys.forEach((depth) => {
    const column = columnNodes.get(depth)
    column.sort((a, b) => {
      const ca = a.colorRef == null ? Infinity : a.colorRef
      const cb = b.colorRef == null ? Infinity : b.colorRef
      return (ca - cb)
        || (a.ghost === b.ghost ? 0 : (a.ghost ? 1 : -1))
        || (rank(a) - rank(b))
        || str(a.label).localeCompare(str(b.label))
        || str(a.id).localeCompare(str(b.id))
    })
    for (let offset = 0; offset < column.length; offset += rowsPerColumn) {
      const chunk = column.slice(offset, offset + rowsPerColumn)
      const physical = physicalColumns
      physicalColumns += 1
      if (chunk.length > maxRows) maxRows = chunk.length
      chunk.forEach((node, row) => {
        node.column = physical
        node.subColumn = Math.floor(offset / rowsPerColumn)
        node.row = row
        node.x = g.PAD + physical * (g.NODE_W + g.GAP_X)
        node.y = originY + g.PAD + row * (g.NODE_H + g.GAP_Y)
      })
    }
  })
  /* 卡片三段几何：位置由上面的摆位阶段定，这里按最终 x/y 算一次，组件直接用（拖动时重算）。 */
  all.forEach((node) => { node.card = cardGeometry(node) })

  const width = Math.max(
    g.PAD * 2 + g.NODE_W,
    physicalColumns ? g.PAD * 2 + physicalColumns * g.NODE_W + (physicalColumns - 1) * g.GAP_X : g.PAD * 2,
  )
  const height = maxRows
    ? g.PAD * 2 + maxRows * g.NODE_H + (maxRows - 1) * g.GAP_Y
    : g.PAD * 2 + g.NODE_H

  /* 图头图例：没有泳道后，这是「哪个颜色 = 哪个项目」的唯一标识。 */
  const legend = arr(lane.projects)
    .filter((project) => arr(project.tasks).length > 0)
    .map((project, i) => ({
      key: project.key,
      label: project.label,
      colorRef: num(project.colorIndex, i),
      count: arr(project.tasks).length,
    }))

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
    /* 泳道已废（task-13）：一张画布装一个目录的全部任务；空数组是为了形状稳定。 */
    legend,
    tasks: tasks.map((task) => str(task.id)),
    taskCount: tasks.length,
    nodes: all,
    edges: drawn,
    bands: [],
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
 * `viewBox="0 {graph.top} {graph.width} {graph.height}"` 取本图那一窗即可
 * （task-13 起 SVG 铺满画布，preserveAspectRatio="xMidYMid meet" 自适应缩放）。
 *
 * `bands` 恒为 `[]`：泳道已废，一张画布装一个目录的全部任务，项目身份走颜色 + 图例。
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

/**
 * 卡片中间信息列的 meta 行：**离这个节点最近的一份事实** —— 前置/后置/阻塞计数 + 项目名。
 * 与 describeNodeMeta 分开：那个是无障碍读屏用的完整句子，这个是画在 162px 里的一行小字。
 */
export function describeNodeCard(node) {
  const n = isObj(node) ? node : {}
  const refs = isObj(n.refs) ? n.refs : {}
  const bits = []
  const pre = arr(refs.predecessors).length
  const post = arr(refs.successors).length
  /* 时间先后单独计数：它不是依赖，不能并进「前置/后置」，
     但接受时间建议后卡片必须看得出变化（否则用户会以为没生效）。 */
  const time = arr(refs.earlierTasks).length + arr(refs.laterTasks).length
  if (pre) bits.push(`前置${pre}`)
  if (post) bits.push(`后置${post}`)
  if (time) bits.push(`时间${time}`)
  if (n.state === 'blocked') bits.push(`阻塞${arr(refs.blockedBy).length}`)
  if (n.ghost === true) {
    /* ghost：编号 eyebrow 走 id（右边状态胶囊已经说了「缺失/组外」，别再重复三遍）。 */
    bits.push(n.missing === true ? '任务不存在' : (n.workspaceLabel || '其它分组'))
    return truncateTitle(bits.join(' · '), CARD.META_WIDTH).text
  }
  if (!pre && !post) bits.push(n.state === 'done' ? '已完成' : (n.state === 'suspended' ? '已挂起' : '就绪'))
  bits.push(n.workspaceLabel || '未归属')
  return truncateTitle(bits.join(' · '), CARD.META_WIDTH).text
}

/** 便捷：节点标题在节点宽度内是否还需要 tooltip。 */
export function needsTooltip(node) {
  const n = isObj(node) ? node : {}
  return n.truncated === true || measure(n.fullTitle) > measure(n.label)
}

/* truncateTitle / stateOf / workspaceOf / measure 也在 model 里导出，这里再导出一次方便图上直接用。 */
export { truncateTitle, stateOf, workspaceOf, measure }
