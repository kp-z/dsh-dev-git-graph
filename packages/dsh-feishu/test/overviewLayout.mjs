/**
 * 总览页几何层（layout.js）的单元测试。
 *
 * 坐标口径（很重要，别按单图直觉读）：
 * - task-13 起：**一个目录 = 一张画布，不再按项目分泳道**（bands 恒为 []），项目身份靠
 *   节点分色（colorRef）+ 图头图例（graph.legend）；列 = 依赖深度，列太长会折成多根物理列。
 *
 * - 每张图的 `nodes[].y` 都在**同一个画布坐标系**里，`graphs[i].top/height` 是本图在这个画布里的
 *   纵向切片；渲染时用 `viewBox="0 {top} {width} {height}"` 取自己那一窗。
 * - 因此「几何不重叠 / 不越界」既按图成立（x 用本图宽度），也按整块画布成立（y 用全局高度）。
 *
 * 跑法：node test/overviewLayout.mjs
 */
import assert from 'node:assert/strict'
import { UNGROUPED_KEY } from '../src/overview/model.js'
import {
  CARD,
  GEOMETRY,
  cardGeometry,
  describeNodeCard,
  layoutScope,
  snapToGrid,
  statusLabel,
} from '../src/overview/layout.js'

let passed = 0
const failures = []
function test(name, fn) {
  try {
    fn()
    passed += 1
    console.log(`  ok  ${name}`)
  } catch (error) {
    failures.push({ name, error })
    console.log(`  FAIL ${name}`)
    console.log(String(error && error.stack ? error.stack : error).split('\n').slice(0, 8).map((line) => `       ${line}`).join('\n'))
  }
}

/* ---------------- 夹具 ----------------
 * wA + wB 同属目录 g1（跨项目依赖要在同一张图里直连）；
 * wC/wD/wE 谁都不属于 → 未分组桶；wF 有项目没任务（不能画节点）。
 */
function task(id, no, workspaceKey, extra) {
  return Object.assign({
    id,
    no,
    title: `任务 ${id}`,
    done: false,
    workspaceKey,
    workspaceTitle: workspaceKey,
    workspacePath: `/Users/kp/DEV/${workspaceKey}`,
    blocked: false,
    ready: true,
    started: false,
    suspended: false,
    sessionId: `s-${id}`,
    predecessors: [],
    successors: [],
    sourceTasks: [],
    derivedTasks: [],
    blockedBy: [],
  }, extra || {})
}

const TASKS = [
  task('a1', 1, 'wA', { blocked: true, ready: false, blockedBy: [{ id: 'b1', title: '任务 b1' }], predecessors: [{ id: 'b1', title: '任务 b1' }] }),
  task('a2', 2, 'wA', { done: true, ready: false }),
  task('b1', 3, 'wB', { successors: [{ id: 'a1', title: '任务 a1' }] }),
  task('c1', 4, 'wC', { sourceTasks: [{ id: 'a1', title: '任务 a1' }] }),
  task('d1', 5, 'wD'),
  task('e1', 6, 'wE', { blocked: true, ready: false, blockedBy: [{ id: 'zz-missing', title: '早就删掉的任务' }] }),
]

const RELATIONS = [
  { from: 'b1', to: 'a1', kind: 'depends_on' },        // 跨项目、同目录 → 必须直连
  { from: 'a1', to: 'c1', kind: 'derived_from' },      // 跨目录 → 目标在图外 → ghost
  { from: 'zz-missing', to: 'e1', kind: 'depends_on' }, // 端点任务表里没有 → missing ghost
  { from: 'a1', to: 'zz-missing', kind: 'depends_on' }, // 同上，方向反过来
]

const GROUPS = [{ id: 'g1', name: 'QVIZ', members: ['wA', 'wB'] }]
const WORKSPACES = ['wA', 'wB', 'wC', 'wD', 'wE', 'wF'].map((key) => ({ key, id: key, path: `/Users/kp/DEV/${key}`, title: key }))

const ALL = layoutScope({ tasks: TASKS, relations: RELATIONS, groups: GROUPS, workspaces: WORKSPACES, scope: { kind: 'all' } })
const GROUP = layoutScope({ tasks: TASKS, relations: RELATIONS, groups: GROUPS, workspaces: WORKSPACES, scope: { kind: 'group', id: 'g1' } })
const PROJECT = layoutScope({ tasks: TASKS, relations: RELATIONS, groups: GROUPS, workspaces: WORKSPACES, scope: { kind: 'project', id: 'wA' } })

const graphOf = (layout, key) => layout.graphs.find((graph) => graph.key === key)
const nodesOf = (graph, kind) => graph.nodes.filter((node) => node.kind === kind)
const overlaps = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h

console.log('overview/layout.js')

/* ---------------- scope 三态 ---------------- */

test('scope=all：按目录返回多张图（每个目录一张 + 未分组桶一张）', () => {
  assert.equal(ALL.scope.kind, 'all')
  assert.equal(ALL.graphs.length, 2)
  assert.deepEqual(ALL.graphs.map((graph) => graph.key), ['group:g1', UNGROUPED_KEY])
  assert.equal(graphOf(ALL, 'group:g1').kind, 'group')
  assert.equal(graphOf(ALL, UNGROUPED_KEY).kind, 'ungrouped')
  // 多张图 = 同一画布上的纵向切片：top 依次累加
  assert.equal(ALL.graphs[0].top, 0)
  assert.equal(ALL.graphs[1].top, ALL.graphs[0].height)
  assert.equal(ALL.height, ALL.graphs[0].height + ALL.graphs[1].height)
  assert.equal(ALL.width, Math.max(...ALL.graphs.map((graph) => graph.width)))
  // 顶层 nodes 是各图的拼接
  assert.equal(ALL.nodes.length, ALL.graphs.reduce((sum, graph) => sum + graph.nodes.length, 0))
  assert.equal(ALL.edges.length, ALL.graphs.reduce((sum, graph) => sum + graph.edges.length, 0))
  assert.equal(ALL.stats.tasks, 6)
  assert.equal(ALL.stats.groups, 2)
})

test('scope=目录：恰好一张图，且返回的就是这张图对象', () => {
  assert.equal(GROUP.graphs.length, 1)
  assert.equal(GROUP.graphs[0].key, 'group:g1')
  assert.equal(GROUP.scope.kind, 'group')
  assert.equal(GROUP.scope.id, 'g1')
  // 单图 scope：顶层字段就是这张图
  assert.equal(GROUP.nodes.length, GROUP.graphs[0].nodes.length)
  assert.equal(GROUP.edges.length, GROUP.graphs[0].edges.length)
  assert.equal(GROUP.height, GROUP.graphs[0].height)
  assert.equal(GROUP.width, GROUP.graphs[0].width)
  assert.equal(GROUP.bands.length, GROUP.graphs[0].bands.length)
  assert.equal(GROUP.top, 0)
})

test('scope=项目：只有该项目任务，普通任务节点没有外人', () => {
  assert.equal(PROJECT.graphs.length, 1)
  const taskNodes = nodesOf(PROJECT.graphs[0], 'task')
  assert.deepEqual(taskNodes.map((node) => node.id).sort(), ['a1', 'a2'])
  assert.deepEqual([...new Set(taskNodes.map((node) => node.workspaceKey))], ['wA'])
  // 不再有泳道：项目 scope 也是一张无泳道画布，项目身份由图例承担
  assert.equal(PROJECT.graphs[0].bands.length, 0)
  assert.deepEqual(PROJECT.graphs[0].legend.map((row) => row.key), ['wA'])
  assert.equal(PROJECT.graphs[0].legend[0].count, 2)
  // 不存在的项目 → 空图，但不抛
  const gone = layoutScope({ tasks: TASKS, relations: RELATIONS, groups: GROUPS, scope: { kind: 'project', id: 'nope' } })
  assert.equal(gone.graphs.length, 1)
  assert.equal(gone.graphs[0].kind, 'empty')
  assert.deepEqual(gone.nodes, [])
})

/* ---------------- ghost / 直连 ---------------- */

test('跨项目边在同一张图内直连（不是 ghost、不是两张图）', () => {
  const graph = graphOf(ALL, 'group:g1')
  const direct = graph.edges.filter((edge) => edge.from === 'b1' && edge.to === 'a1')
  assert.equal(direct.length, 1)
  assert.equal(direct[0].kind, 'depends_on')
  assert.equal(direct[0].fromGhost, false)
  assert.equal(direct[0].toGhost, false)
  assert.equal(direct[0].crossProject, true)
  assert.ok(direct[0].path.startsWith('M'), '边必须有可画的 path')
  assert.ok(direct[0].path.includes('H'))
  // 两个项目各有节点，且在同一套坐标系里（b1 在 wA 左边）
  const b1 = graph.nodes.find((node) => node.id === 'b1')
  const a1 = graph.nodes.find((node) => node.id === 'a1')
  assert.ok(b1.x < a1.x, '依赖方向必须从左到右')
  // 项目身份：节点分色 + 图头图例（没有泳道了）
  assert.equal(b1.colorRef, 1)
  assert.equal(a1.colorRef, 0)
  assert.deepEqual(graph.legend.map((row) => [row.key, row.colorRef, row.count]), [['wA', 0, 2], ['wB', 1, 1]])
  assert.deepEqual(graph.bands, [], '泳道已废：一张画布装一个目录的全部任务')
})

test('缺失端点 / 组外端点都变 ghost，且 missing 能区分', () => {
  const graph = graphOf(ALL, 'group:g1')
  const ghosts = nodesOf(graph, 'ghost')
  assert.deepEqual(ghosts.map((node) => node.id).sort(), ['c1', 'zz-missing'])
  const c1 = ghosts.find((node) => node.id === 'c1')
  const zz = ghosts.find((node) => node.id === 'zz-missing')
  assert.equal(zz.missing, true, '任务表里没有 → missing')
  assert.equal(c1.missing, false, '任务存在、只是不在本图 → 组外锚点')
  assert.equal(c1.role, 'successor')
  assert.equal(c1.workspaceKey, 'wC')
  assert.equal(zz.role, 'successor')
  assert.equal(c1.graphKey, 'group:g1')
  // ghost 也要有边连上（否则依赖方向会断链）
  assert.equal(graph.edges.some((edge) => edge.to === 'c1' && edge.toGhost), true)
  assert.equal(graph.edges.some((edge) => edge.to === 'zz-missing' && edge.toGhost), true)
  // 项目 scope：前置 ghost 的归属是另一个项目
  const proj = nodesOf(PROJECT.graphs[0], 'ghost')
  assert.deepEqual(proj.map((node) => node.id).sort(), ['b1', 'c1', 'zz-missing'])
  const b1 = proj.find((node) => node.id === 'b1')
  assert.equal(b1.role, 'predecessor')
  assert.equal(b1.missing, false)
  assert.equal(b1.workspaceKey, 'wB')
  // 未分组桶：wA 的 a1 成了桶外的前置 ghost
  const bucket = graphOf(ALL, UNGROUPED_KEY)
  const bucketGhosts = nodesOf(bucket, 'ghost')
  assert.deepEqual(bucketGhosts.map((node) => node.id).sort(), ['a1', 'zz-missing'])
  assert.equal(bucketGhosts.find((node) => node.id === 'a1').role, 'predecessor')
})

test('derived_from 保持自己的 kind（虚线口径），且不参与分层', () => {
  const graph = graphOf(ALL, UNGROUPED_KEY)
  const derived = graph.edges.filter((edge) => edge.kind === 'derived_from')
  assert.equal(derived.length, 1)
  assert.equal(derived[0].from, 'a1')
  assert.equal(derived[0].to, 'c1')
  // derived_from 不拉层：c1 与 d1 的依赖深度都是 0（物理列可能因折列而不同）
  const c1 = graph.nodes.find((node) => node.id === 'c1')
  const d1 = graph.nodes.find((node) => node.id === 'd1')
  assert.equal(c1.depth, 0)
  assert.equal(d1.depth, 0)
  assert.equal(c1.depth, d1.depth)
})

/* ---------------- 几何 ---------------- */

test('几何：每张图里节点两两不重叠', () => {
  ALL.graphs.forEach((graph) => {
    const nodes = graph.nodes
    for (let i = 0; i < nodes.length; i += 1) {
      for (let j = i + 1; j < nodes.length; j += 1) {
        assert.equal(overlaps(nodes[i], nodes[j]), false, `${graph.key}: ${nodes[i].id} 与 ${nodes[j].id} 重叠`)
      }
    }
  })
})

test('几何：节点与泳道都不越界（图内 + 全局画布）', () => {
  ALL.graphs.forEach((graph) => {
    graph.nodes.forEach((node) => {
      assert.ok(node.w === GEOMETRY.NODE_W && node.h === GEOMETRY.NODE_H, '节点尺寸用统一口径')
      assert.ok(node.x >= 0 && node.x + node.w <= graph.width, `${node.id} 横向越界`)
      assert.ok(node.y >= graph.top && node.y + node.h <= graph.top + graph.height, `${node.id} 纵向越界`)
      assert.ok(node.y >= 0 && node.y + node.h <= ALL.height, `${node.id} 超出整块画布`)
    })
    graph.bands.forEach((band) => {
      assert.ok(band.x >= 0 && band.x + band.w <= graph.width + 1e-9, `${band.key} 泳道横向越界`)
      assert.ok(band.y >= graph.top && band.y + band.h <= graph.top + graph.height, `${band.key} 泳道纵向越界`)
      assert.ok(band.w > 0 && band.h > 0)
    })
  })
  // 全局两两不重叠（含跨图的节点）
  const nodes = ALL.nodes
  for (let i = 0; i < nodes.length; i += 1) {
    for (let j = i + 1; j < nodes.length; j += 1) {
      assert.equal(overlaps(nodes[i], nodes[j]), false, `全局重叠：${nodes[i].id} / ${nodes[j].id}`)
    }
  }
})

test('几何：同一根物理列里行号互不相同（没有泳道后靠这个保证不重叠）', () => {
  ALL.graphs.forEach((graph) => {
    const byColumn = new Map()
    graph.nodes.forEach((node) => {
      assert.ok(Number.isInteger(node.column) && node.column >= 0, `${node.id} 缺少物理列号`)
      if (!byColumn.has(node.column)) byColumn.set(node.column, [])
      byColumn.get(node.column).push(node)
      // x 由物理列唯一决定；y 由行号唯一决定
      assert.equal(node.x, GEOMETRY.PAD + node.column * (GEOMETRY.NODE_W + GEOMETRY.GAP_X))
      // y 是**全局**坐标：本图切片从 graph.top 起算
      assert.equal(node.y, graph.top + GEOMETRY.PAD + node.row * (GEOMETRY.NODE_H + GEOMETRY.GAP_Y))
    })
    byColumn.forEach((column, index) => {
      assert.equal(new Set(column.map((node) => node.row)).size, column.length, `列 ${index} 里有重复行号`)
    })
  })
})

test('几何：列太长会折成多根物理列（40 个互不依赖的任务不会变成一条细长条）', () => {
  const tasks = Array.from({ length: 40 }, (_, i) => task(`t${i}`, i + 1, 'wSolo'))
  const layout = layoutScope({ tasks, relations: [], scope: { kind: 'all' } })
  const graph = layout.graphs[0]
  const columns = new Set(graph.nodes.map((node) => node.column)).size
  assert.ok(columns > 1, `物理列只有 ${columns} 根`)
  assert.ok(graph.nodes.every((node) => node.depth === 0), '没有依赖时所有节点都在第 0 层')
  const ratio = graph.width / graph.height
  assert.ok(ratio > 0.6 && ratio < 4.5, `长宽比 ${ratio.toFixed(2)} 太极端`)
})

/* ---------------- 字段形状 ---------------- */

test('节点 / 边字段形状满足组件契约', () => {
  const graph = graphOf(ALL, 'group:g1')
  assert.deepEqual(Object.keys(graph).filter((key) => ['nodes', 'edges', 'bands', 'width', 'height', 'top'].includes(key)).sort(),
    ['bands', 'edges', 'height', 'nodes', 'top', 'width'].sort())
  assert.equal(typeof graph.width, 'number')
  assert.equal(typeof graph.height, 'number')
  graph.nodes.forEach((node) => {
    for (const field of ['id', 'kind', 'x', 'y', 'w', 'h', 'label', 'no', 'done', 'blocked', 'state', 'workspaceKey', 'refs']) {
      assert.ok(node[field] !== undefined, `node 缺字段 ${field}`)
    }
    assert.ok(node.kind === 'task' || node.kind === 'ghost')
    assert.ok(['done', 'blocked', 'suspended', 'open', 'ghost'].includes(node.state))
    assert.ok(node.refs && Array.isArray(node.refs.predecessors) && Array.isArray(node.refs.blockedBy))
    assert.equal(typeof node.selected, 'undefined')
  })
  graph.edges.forEach((edge) => {
    for (const field of ['from', 'to', 'kind', 'path']) assert.ok(edge[field] !== undefined, `edge 缺字段 ${field}`)
    assert.ok(['depends_on', 'derived_from'].includes(edge.kind))
  })
  assert.deepEqual(graph.bands, [], 'bands 恒为空（泳道已废）')
  graph.legend.forEach((row) => {
    for (const field of ['key', 'label', 'colorRef', 'count']) assert.ok(row[field] !== undefined, `legend 缺字段 ${field}`)
  })
  assert.ok(graph.nodes.every((node) => node.colorRef === null || Number.isInteger(node.colorRef)), '节点分色要么是整数要么是 null')
  // 节点在图上点得动：真实任务有编号、状态、会话
  const a1 = graph.nodes.find((node) => node.id === 'a1')
  assert.equal(a1.no, 1)
  assert.equal(a1.state, 'blocked')
  assert.equal(a1.done, false)
  assert.equal(a1.sessionId, 's-a1')
  assert.equal(a1.refs.blockedBy.length, 1)
  assert.equal(a1.ghost, false)
  // 空项目只出现在 projects 列表里，不画节点
  const bucket = graphOf(ALL, UNGROUPED_KEY)
  assert.equal(bucket.projects.some((project) => project.key === 'wF'), true)
  assert.equal(bucket.nodes.some((node) => node.workspaceKey === 'wF'), false)
  assert.equal(bucket.legend.some((row) => row.key === 'wF'), false, '0 任务的项目不进图例')
})

test('节点 key 在整块画布里唯一（ghost 键带图与角色）', () => {
  const keys = ALL.nodes.map((node) => node.key)
  assert.equal(new Set(keys).size, keys.length)
  ALL.nodes.filter((node) => node.ghost).forEach((node) => {
    assert.ok(node.key.startsWith('ghost:'), 'ghost 键要带前缀')
    assert.ok(node.key.includes(node.graphKey), 'ghost 键要带图 key，避免跨图撞键')
  })
})

/* ---------------- 空输入 / 坏输入 ---------------- */

test('同目录多项目 = 一张画布：全部任务在同一 nodes，跨项目边照旧连', () => {
  const graph = GROUP.graphs[0]
  assert.equal(GROUP.graphs.length, 1, '目录 scope 仍然只有一张图')
  const taskNodes = graph.nodes.filter((node) => node.ghost !== true)
  assert.deepEqual(taskNodes.map((node) => node.id).sort(), ['a1', 'a2', 'b1'])
  assert.equal(new Set(taskNodes.map((node) => node.workspaceKey)).size, 2, '两个项目的任务在同一张画布的 nodes 里')
  assert.deepEqual(graph.legend.map((row) => row.key), ['wA', 'wB'])
  const cross = graph.edges.filter((edge) => {
    const from = graph.nodes.find((node) => node.id === edge.from)
    const to = graph.nodes.find((node) => node.id === edge.to)
    return from && to && from.workspaceKey !== to.workspaceKey
  })
  assert.ok(cross.length >= 1, '跨项目依赖边必须还在同一坐标系里连起来')
  assert.ok(cross.some((edge) => edge.crossProject === true))
})

test('每个目录一张画布：scope=all 时图数 = 目录数（不合并目录）', () => {
  assert.equal(ALL.graphs.length, 2)
  const g1 = graphOf(ALL, 'group:g1')
  const bucket = graphOf(ALL, UNGROUPED_KEY)
  assert.deepEqual(g1.nodes.filter((n) => n.ghost !== true).map((n) => n.id).sort(), ['a1', 'a2', 'b1'])
  assert.deepEqual(bucket.nodes.filter((n) => n.ghost !== true).map((n) => n.id).sort(), ['c1', 'd1', 'e1'])
  assert.ok(ALL.graphs.every((graph) => Array.isArray(graph.bands) && graph.bands.length === 0))
})

test('空输入 / 坏输入不抛', () => {
  const nothing = layoutScope(null)
  assert.equal(nothing.scope.kind, 'all')
  assert.deepEqual(nothing.graphs, [])
  assert.deepEqual(nothing.nodes, [])
  assert.deepEqual(nothing.edges, [])
  assert.deepEqual(nothing.bands, [])
  assert.equal(nothing.height, 0)

  const garbage = layoutScope({
    tasks: [null, 42, {}, { id: 'x', title: 5, workspaceKey: null }, { id: 'x', workspaceKey: 'wA' }],
    relations: [null, { from: 'x' }, { from: 'a', to: 'b', kind: 'nope' }, { from: 'x', to: 'zz', kind: 'depends_on' }],
    groups: 'nope',
    workspaces: 7,
    scope: 'project',
  })
  assert.equal(garbage.scope.kind, 'all')
  assert.ok(Array.isArray(garbage.graphs))
  assert.equal(garbage.stats.tasks, 2)
  assert.equal(garbage.nodes.filter((node) => node.ghost).length >= 1, true)

  const noGraphs = layoutScope({ scope: { kind: 'group', id: 'g1' } })
  assert.equal(noGraphs.graphs.length, 1)
  assert.equal(noGraphs.graphs[0].kind, 'empty')
  assert.deepEqual(noGraphs.nodes, [])
  assert.equal(noGraphs.width, GEOMETRY.PAD * 2)
})

test('workspaces 给了 0 任务的项目也不炸', () => {
  const onlyEmpty = layoutScope({ tasks: [], relations: [], groups: [{ id: 'g1', name: '空目录', members: ['wF'] }], workspaces: [{ key: 'wF', title: '空项目', path: '/x' }], scope: { kind: 'group', id: 'g1' } })
  assert.equal(onlyEmpty.graphs.length, 1)
  assert.equal(onlyEmpty.graphs[0].kind, 'group')
  assert.deepEqual(onlyEmpty.nodes, [])
  assert.deepEqual(onlyEmpty.graphs[0].bands, [])
  assert.equal(onlyEmpty.graphs[0].projects.length, 1)
})

test('真实快照规模下也不越界（48+ 任务的回归底线）', () => {
  /* 造一个宽而深的图形：链式依赖 30 层 + 每层 3 个任务 */
  const tasks = []
  const relations = []
  for (let depth = 0; depth < 30; depth += 1) {
    for (let i = 0; i < 3; i += 1) {
      tasks.push(task(`n${depth}-${i}`, depth * 10 + i, `w${i}`))
      if (depth > 0) relations.push({ from: `n${depth - 1}-${i}`, to: `n${depth}-${i}`, kind: 'depends_on' })
    }
  }
  const layout = layoutScope({ tasks, relations, groups: [{ id: 'g1', name: 'wide', members: ['w0', 'w1', 'w2'] }], scope: { kind: 'all' } })
  const graph = layout.graphs[0]
  assert.equal(graph.nodes.length, 90)
  assert.deepEqual(graph.bands, [])
  assert.equal(graph.legend.length, 3, '三个项目 → 三条图例')
  assert.equal(graph.stats.dependencyEdges, 87)
  const nodes = layout.nodes
  for (let i = 0; i < nodes.length; i += 1) {
    assert.ok(nodes[i].x + nodes[i].w <= graph.width)
    assert.ok(nodes[i].y + nodes[i].h <= graph.height)
    for (let j = i + 1; j < nodes.length; j += 1) {
      assert.equal(overlaps(nodes[i], nodes[j]), false, `${nodes[i].id}/${nodes[j].id} 重叠`)
    }
  }
})

/* ---------------- task-15：workflow 式节点卡片的几何 ---------------- */

test('卡片口径：节点 264×88、圆角 12、边框 2、吸附网格 40', () => {
  assert.equal(GEOMETRY.NODE_W, 264)
  assert.equal(GEOMETRY.NODE_H, 88)
  assert.equal(GEOMETRY.GRID, 40)
  assert.equal(CARD.RADIUS, 12)
  assert.equal(CARD.BORDER, 2)
  /* 三段刚好放得下：左动作列 + 中间文字 + 右状态胶囊 + 三段间距 + 两侧内边距 = 卡片宽 */
  const used = CARD.PAD + CARD.ACTION_W + CARD.COL_GAP + CARD.STATUS_W + CARD.PAD + CARD.COL_GAP
  assert.ok(used < GEOMETRY.NODE_W, `三段占宽 ${used} 应该留得出文字列`)
  assert.ok(GEOMETRY.NODE_W - used >= 120, `中间文字列只剩 ${GEOMETRY.NODE_W - used}px`)
  /* 两个动作按钮竖排 + 居中：不超出卡片高 */
  const actionH = CARD.ACTION_SIZE * 2 + CARD.ACTION_GAP
  assert.ok(actionH <= GEOMETRY.NODE_H - CARD.PAD * 2, '动作列放得下')
})

test('snapToGrid：吸附到 40px 网格（与参考站 GRID_SIZE 一致）', () => {
  assert.equal(snapToGrid(0), 0)
  assert.equal(snapToGrid(19), 0)
  assert.equal(snapToGrid(20), 40)
  assert.equal(snapToGrid(46), 40)
  assert.equal(snapToGrid(118), 120)
  assert.equal(snapToGrid(348.4), 360)
  assert.equal(snapToGrid(-3), -0)
  /* 坏输入不抛，回 0 */
  assert.equal(snapToGrid('nope'), 0)
  assert.equal(snapToGrid(undefined), 0)
})

test('cardGeometry：三段互不重叠、都在卡片内、动作列留够', () => {
  const card = cardGeometry({ x: 100, y: 50, w: GEOMETRY.NODE_W, h: GEOMETRY.NODE_H, ghost: false })
  assert.equal(card.x, 100)
  assert.equal(card.y, 50)
  assert.equal(card.radius, CARD.RADIUS)
  assert.equal(card.border, CARD.BORDER)
  /* 动作列 2 个按钮，竖排、间距 6、尺寸 22 */
  assert.equal(card.action.buttons.length, 2)
  assert.deepEqual(card.action.buttons.map((box) => box.key), ['open', 'focus'])
  const [open, focus] = card.action.buttons
  assert.equal(open.x, 100 + CARD.PAD)
  assert.equal(open.w, CARD.ACTION_SIZE)
  assert.equal(open.h, CARD.ACTION_SIZE)
  assert.equal(open.radius, CARD.ACTION_RADIUS)
  assert.equal(focus.y - open.y, CARD.ACTION_SIZE + CARD.ACTION_GAP)
  /* 中间文字从动作列右边起，右边留出状态胶囊 */
  assert.equal(card.text.x, open.x + CARD.ACTION_W + CARD.COL_GAP)
  assert.ok(card.text.x > open.x + open.w, '文字不能在动作按钮上')
  assert.ok(card.text.x + card.text.w <= card.status.x, '文字不能压到状态胶囊')
  /* 状态胶囊在卡片右侧、垂直居中 */
  assert.equal(card.status.x + card.status.w, 100 + GEOMETRY.NODE_W - CARD.PAD)
  assert.equal(card.status.y, 50 + Math.round((GEOMETRY.NODE_H - CARD.STATUS_H) / 2))
  /* 三行基线的顺序：eyebrow → title → meta，且都在卡片里 */
  assert.ok(card.text.eyebrow < card.text.title && card.text.title < card.text.meta)
  assert.ok(card.text.eyebrow > 50 && card.text.meta < 50 + GEOMETRY.NODE_H)
  /* 动作列垂直居中 */
  assert.equal(card.action.y, 50 + Math.round((GEOMETRY.NODE_H - card.action.h) / 2))
  assert.ok(card.action.y >= 50 + CARD.PAD && card.action.y + card.action.h <= 50 + GEOMETRY.NODE_H - CARD.PAD)
})

test('cardGeometry：ghost 没有动作列，文字铺满卡片', () => {
  const card = cardGeometry({ x: 0, y: 0, w: GEOMETRY.NODE_W, h: GEOMETRY.NODE_H, ghost: true })
  assert.equal(card.ghost, true)
  assert.deepEqual(card.action.buttons, [])
  assert.equal(card.text.x, CARD.PAD)
  assert.ok(card.text.w > GEOMETRY.NODE_W / 2, 'ghost 的文字列更宽')
  assert.equal(card.status.w, CARD.STATUS_W, 'ghost 也有状态胶囊（缺失/组外）')
})

test('layoutScope：每个节点都带 card，且三段不越出节点自己的框', () => {
  ALL.graphs.forEach((graph) => {
    graph.nodes.forEach((node) => {
      assert.ok(node.card, `${node.id} 缺 card`)
      assert.equal(node.card.x, node.x)
      assert.equal(node.card.y, node.y)
      assert.equal(node.card.w, node.w)
      assert.equal(node.card.h, node.h)
      assert.equal(node.card.radius, CARD.RADIUS)
      assert.ok(node.card.action.buttons.length === (node.ghost ? 0 : 2))
      node.card.action.buttons.forEach((box) => {
        assert.ok(box.x >= node.x && box.x + box.w <= node.x + node.w, `${node.id} 动作按钮横向越界`)
        assert.ok(box.y >= node.y && box.y + box.h <= node.y + node.h, `${node.id} 动作按钮纵向越界`)
      })
      assert.ok(node.card.status.x >= node.x && node.card.status.x + node.card.status.w <= node.x + node.w)
      assert.ok(node.card.text.w > 0)
    })
  })
})

test('describeNodeCard：一行里说清 前置/后置/阻塞计数 + 项目名', () => {
  const graph = graphOf(ALL, 'group:g1')
  const a1 = graph.nodes.find((node) => node.id === 'a1')
  const a2 = graph.nodes.find((node) => node.id === 'a2')
  const b1 = graph.nodes.find((node) => node.id === 'b1')
  assert.ok(describeNodeCard(a1).includes('前置1'), describeNodeCard(a1))
  assert.ok(describeNodeCard(a1).includes('阻塞1'))
  assert.ok(describeNodeCard(a1).includes('wA'), '项目名要出现（归属）')
  assert.ok(describeNodeCard(b1).includes('后置1'), describeNodeCard(b1))
  assert.ok(describeNodeCard(a2).includes('已完成'), describeNodeCard(a2))
  const ghost = graph.nodes.find((node) => node.ghost === true)
  assert.ok(describeNodeCard(ghost).length > 0)
  /* 长 meta 会被截断（卡片中间列只有 ~162px），但绝不返回空 */
  assert.ok(describeNodeCard({ state: 'open', workspaceLabel: '一个特别特别特别长的项目名', refs: { predecessors: [1, 2, 3], successors: [1, 2, 3] } }).length > 0)
})

test('statusLabel：状态 → 状态胶囊里那两三个字', () => {
  assert.equal(statusLabel({ state: 'open' }), '就绪')
  assert.equal(statusLabel({ state: 'blocked' }), '阻塞')
  assert.equal(statusLabel({ state: 'done' }), '完成')
  assert.equal(statusLabel({ state: 'suspended' }), '挂起')
  assert.equal(statusLabel({ state: 'ghost', missing: true }), '缺失')
  assert.equal(statusLabel({ state: 'ghost', missing: false }), '组外')
})

console.log(`\noverview/layout.js: ${passed} passed, ${failures.length} failed`)
if (failures.length) {
  for (const failure of failures) console.error(`- ${failure.name}`)
  process.exit(1)
}
