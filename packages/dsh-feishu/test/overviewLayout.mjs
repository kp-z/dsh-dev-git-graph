/**
 * 总览页几何层（layout.js）的单元测试。
 *
 * 坐标口径（很重要，别按单图直觉读）：
 * - 每张图的 `nodes[].y` 都在**同一个画布坐标系**里，`graphs[i].top/height` 是本图在这个画布里的
 *   纵向切片；渲染时用 `viewBox="0 {top} {width} {height}"` 取自己那一窗。
 * - 因此「几何不重叠 / 不越界」既按图成立（x 用本图宽度），也按整块画布成立（y 用全局高度）。
 *
 * 跑法：node test/overviewLayout.mjs
 */
import assert from 'node:assert/strict'
import { UNGROUPED_KEY } from '../src/overview/model.js'
import { GEOMETRY, layoutScope } from '../src/overview/layout.js'

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
  // 项目 scope 只有一条泳道：ghost 也落在这条里，不另开「组外」带
  assert.equal(PROJECT.graphs[0].bands.length, 1)
  assert.equal(PROJECT.graphs[0].bands[0].key, 'wA')
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
  assert.equal(b1.bandKey, 'wB')
  assert.equal(a1.bandKey, 'wA')
  // 项目泳道 + 一个「组外 · 缺失」带（c1 与 zz-missing 都不属于 g1）
  assert.deepEqual(graph.bands.map((band) => band.key), ['wA', 'wB', '__external__'])
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
  // derived_from 不拉层：c1 与 d1 都在第 0 列
  const c1 = graph.nodes.find((node) => node.id === 'c1')
  const d1 = graph.nodes.find((node) => node.id === 'd1')
  assert.equal(c1.column, 0)
  assert.equal(d1.column, 0)
  assert.equal(c1.x, d1.x)
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

test('几何：节点落在自己的泳道里，同带行不重叠', () => {
  ALL.graphs.forEach((graph) => {
    graph.nodes.forEach((node) => {
      const band = graph.bands.find((row) => row.key === node.bandKey)
      assert.ok(band, `${node.id} 没有归属的泳道`)
      assert.ok(node.y >= band.y, `${node.id} 跑到泳道上方`)
      assert.ok(node.y + node.h <= band.y + band.h, `${node.id} 跑出泳道`)
      assert.ok(node.x >= band.x && node.x + node.w <= band.x + band.w)
    })
  })
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
  graph.bands.forEach((band) => {
    for (const field of ['key', 'label', 'x', 'y', 'w', 'h', 'colorRef']) assert.ok(band[field] !== undefined, `band 缺字段 ${field}`)
  })
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
  assert.equal(bucket.bands.some((band) => band.key === 'wF'), false)
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
  assert.equal(graph.bands.length, 3)
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

console.log(`\noverview/layout.js: ${passed} passed, ${failures.length} failed`)
if (failures.length) {
  for (const failure of failures) console.error(`- ${failure.name}`)
  process.exit(1)
}
