/**
 * 执行看板的布局测试（M7-2）。
 *
 * ## 为什么这份测试值钱
 *
 * "这张单排在第几列"是**图的语义**（列号 = 最长前置链），不是画图细节：
 * 算错了不报错，只会得到一张"顺序看着有点怪"的图，肉眼几乎不可能发现。
 * 所以这里断言的是**结构**（列号/行号/端点），而不是"能画出来"。
 *
 * 另外两条是红线级的：
 * · **同一份输入必须给同一份输出**（改一次输入顺序、或只动 `tick`，图不许变）；
 * · **成环不许死循环**（本文件里那几个用例如果实现退化成 O(∞)，测试会挂住——
 *   这正是它存在的意义：宁可测试挂住，也不要在浏览器里冻结整个页面）。
 *
 * 还有一条容易做错的：**看板不许重算 `ready`**。`ready` 是派生状态，只在
 * `src/sim/ready.ts` 算一处（M1-5）；这里断言"给什么状态就显示什么状态"。
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  BOARD_TOKENS,
  DEFAULT_GEOMETRY,
  STATUS_TOKEN,
  TASK_STATUSES,
  boardSignature,
  buildBoardModel,
  countStatuses,
  describeTask,
  graphGeometry,
  layoutDependencyGraph,
  missingBoardTokens,
  resolveBoardColor,
  unlocksIndex,
} from '../web/board-layout.js'

/** 造一个任务：`deps` 是 `blockedBy`。 */
const task = (id, ordinal, deps = [], extra = {}) => ({
  id,
  key: id,
  ordinal,
  title: `标题 ${id}`,
  status: 'pending',
  owner: null,
  station: null,
  requires: [],
  blockedBy: deps,
  progress: 0,
  acceptance: '',
  ...extra,
})

/** 列号速查：`{ id: {column, row} }`。 */
function shape(layout) {
  const out = {}
  for (const node of layout.nodes) out[node.id] = { column: node.column, row: node.row }
  return out
}

test('线性链：a→b→c 必须是三列，列号 = 最长前置链', () => {
  const layout = layoutDependencyGraph([task('a', 1), task('b', 2, ['a']), task('c', 3, ['b'])])

  assert.deepEqual(shape(layout), { a: { column: 0, row: 0 }, b: { column: 1, row: 0 }, c: { column: 2, row: 0 } })
  assert.equal(layout.maxColumn, 2)
  assert.deepEqual(
    layout.edges.map((e) => `${e.from}>${e.to}@${e.fromColumn}->${e.toColumn}`),
    ['a>b@0->1', 'b>c@1->2'],
  )
  assert.equal(layout.hasCycle, false)
  assert.deepEqual(layout.unresolved, [])
})

test('菱形：a | b,c | d —— 菱形右侧那条腿不许把 d 推到第三列之前', () => {
  const layout = layoutDependencyGraph([
    task('a', 1),
    task('b', 2, ['a']),
    task('c', 3, ['a']),
    task('d', 4, ['b', 'c']),
  ])

  assert.deepEqual(shape(layout), {
    a: { column: 0, row: 0 },
    b: { column: 1, row: 0 },
    c: { column: 1, row: 1 },
    d: { column: 2, row: 0 },
  })
  assert.equal(layout.edgeCount, 4)
  assert.equal(layout.hasCycle, false)
})

test('菱形左腿更深时，d 取**最长**前置链（不是最短）', () => {
  // a → b → c → d 且 a → d：d 必须落在第 3 列（最长链），不是第 1 列。
  const layout = layoutDependencyGraph([
    task('a', 1),
    task('b', 2, ['a']),
    task('c', 3, ['b']),
    task('d', 4, ['c', 'a']),
  ])
  assert.equal(shape(layout).d.column, 3)
})

test('成环：不许死循环，降级到最后一列并报出来（不是抛错）', () => {
  const layout = layoutDependencyGraph([
    task('a', 1, ['b']),
    task('b', 2, ['a']),
    task('c', 3, ['b']), // 被环挡住的下游
    task('solo', 4),
  ])

  assert.equal(layout.hasCycle, true)
  assert.deepEqual(layout.unresolved, ['a', 'b', 'c'], '环上与被环挡住的都报出来（区分它们要 SCC，不值）')
  assert.equal(layout.nodeCount, 4, '所有节点都必须还在图上——降级不等于丢数据')
  assert.equal(shape(layout).solo.column, 0, '环外的节点照常排在最前')
  assert.equal(shape(layout).a.column, 1, '降级的节点摆在已解析的最后一列之后')
  assert.equal(shape(layout).b.column, 1)
  assert.equal(shape(layout).c.column, 1)
  // 环内的边不画（自环/回边没有"两端"）；a>c 这类回边会被画出来，属于降级的可见代价。
  assert.ok(layout.edges.every((e) => e.from !== e.to), '不该出现自环边')
})

test('自环（blockedBy 指向自己）也不会死循环', () => {
  const layout = layoutDependencyGraph([task('a', 1, ['a']), task('b', 2)])
  assert.equal(layout.hasCycle, true)
  assert.deepEqual(layout.unresolved, ['a'])
  assert.equal(shape(layout).a.column, 1)
  assert.equal(shape(layout).b.column, 0)
  assert.equal(layout.edgeCount, 0)
})

test('孤立节点：全在第 0 列，按 (ordinal, id) 排行', () => {
  const layout = layoutDependencyGraph([task('z', 3), task('y', 1), task('x', 2)])
  assert.deepEqual(shape(layout), { y: { column: 0, row: 0 }, x: { column: 0, row: 1 }, z: { column: 0, row: 2 } })
  assert.deepEqual(layout.columns, [{ index: 0, nodeIds: ['y', 'x', 'z'] }])
})

test('列内排序用 ordinal 而不是 id 字符串序（task-10 不能排在 task-2 前面）', () => {
  const layout = layoutDependencyGraph([task('task-10', 10), task('task-2', 2)])
  assert.deepEqual(layout.columns[0].nodeIds, ['task-2', 'task-10'])
})

test('同一份输入 → 同一份输出：打乱输入顺序、改 tick 都不影响', () => {
  const tasks = [
    task('design', 1),
    task('impl', 2, ['design']),
    task('test', 3, ['impl']),
    task('docs', 4, ['impl']),
    task('ship', 5, ['test', 'docs']),
    task('iso', 6),
  ]
  const a = layoutDependencyGraph(tasks)
  const b = layoutDependencyGraph([...tasks].reverse())
  const c = layoutDependencyGraph(tasks.map((t) => ({ ...t, progress: 0.9 })))

  assert.equal(a.signature, b.signature, '输入顺序不该改变图（快照与增量的到达顺序不一样）')
  assert.equal(a.signature, c.signature, '进度/tick 变化不该改变图')

  // 同一个任务表算两次，逐字段一致（不是"看着差不多"）。
  assert.deepEqual(layoutDependencyGraph(tasks), layoutDependencyGraph(tasks))
})

test('表外的前置：不参与布局，但详情里要保留（否则"卡在哪张单上"看不见）', () => {
  const layout = layoutDependencyGraph([task('a', 1, ['task.某个不在表里的前置']), task('b', 2, ['a'])])
  assert.deepEqual(shape(layout), { a: { column: 0, row: 0 }, b: { column: 1, row: 0 } })
  assert.equal(layout.edgeCount, 1)

  const model = buildBoardModel({ agents: [], tasks: [task('a', 1, ['task.不存在'])] })
  const detail = describeTask(model, 'a')
  assert.deepEqual(detail.blockedBy, ['task.不存在'])
  assert.deepEqual(detail.blockedByTasks, [{ id: 'task.不存在', title: null, status: null }])
})

test('重复前置只算一条边', () => {
  const layout = layoutDependencyGraph([task('a', 1), task('b', 2, ['a', 'a'])])
  assert.equal(layout.edgeCount, 1)
  assert.equal(shape(layout).b.column, 1)
})

test('geometry：坐标由列号/行号算出来，连线接在卡片边上', () => {
  const layout = layoutDependencyGraph([task('a', 1), task('b', 2, ['a'])])
  const geo = graphGeometry(layout)

  const a = geo.nodes.a
  const b = geo.nodes.b
  assert.equal(a.column, 0)
  assert.equal(a.row, 0)
  assert.equal(b.column, 1)
  assert.equal(a.x, DEFAULT_GEOMETRY.padX)
  assert.equal(a.y, DEFAULT_GEOMETRY.padY)
  assert.equal(b.x, DEFAULT_GEOMETRY.padX + DEFAULT_GEOMETRY.cellW)
  assert.equal(a.w, DEFAULT_GEOMETRY.nodeW)
  assert.equal(a.h, DEFAULT_GEOMETRY.nodeH)

  const edge = geo.edges[0]
  assert.equal(edge.x1, a.x + a.w, '起点在前置卡片的右边缘')
  assert.equal(edge.y1, a.cy)
  assert.equal(edge.x2, b.x, '终点在后置卡片的左边缘')
  assert.equal(edge.y2, b.cy)
  assert.match(edge.path, /^M \d+ \d+ C /)

  assert.ok(geo.width > b.x, '画布宽度要罩得住最右一列')
  assert.ok(geo.height >= a.y + a.h)

  // 同一份布局 → 同一份几何（像素也是确定性的）。
  assert.deepEqual(graphGeometry(layout), geo)
})

test('geometry：列宽/行高可覆盖，且空布局不炸', () => {
  const layout = layoutDependencyGraph([task('a', 1), task('b', 2), task('c', 3, ['a'])])
  const geo = graphGeometry(layout, { cellW: 100, cellH: 50, nodeW: 80, nodeH: 40 })
  assert.equal(geo.nodes.b.y, DEFAULT_GEOMETRY.padY + 50)
  assert.equal(geo.nodes.c.x, DEFAULT_GEOMETRY.padX + 100)

  const empty = graphGeometry(layoutDependencyGraph([]))
  assert.deepEqual(empty.nodes, {})
  assert.deepEqual(empty.edges, [])
  assert.equal(empty.width, DEFAULT_GEOMETRY.padX * 2, '空图给一个零列的尺寸，而不是 NaN')
})

test('unlocksIndex：blockedBy 的反向索引，按 ordinal 排、去重、忽略表外', () => {
  const index = unlocksIndex([
    task('design', 1),
    task('impl-b', 3, ['design']),
    task('impl-a', 2, ['design', 'design']),
    task('ship', 4, ['impl-a', 'task.不在表里']),
  ])

  assert.deepEqual(index.design, ['impl-a', 'impl-b'])
  assert.deepEqual(index['impl-a'], ['ship'])
  assert.equal(index.ship, undefined)
  assert.equal(index['task.不在表里'], undefined)
})

test('buildBoardModel：成员、他们的任务、未分配的单、六态计数', () => {
  const world = {
    agents: [
      { id: 'agent-2', name: '乙', role: 'engineer', state: 'working', carrying: 't2' },
      { id: 'agent-1', name: '甲', role: 'lead', state: 'idle', carrying: null },
    ],
    tasks: [
      task('t2', 2, ['t1'], { status: 'in_progress', owner: 'agent-2', progress: 0.4, title: '实现' }),
      task('t1', 1, [], { status: 'done', owner: 'agent-1', title: '调研' }),
      task('t3', 3, [], { status: 'ready', owner: null, title: '没人领的单' }),
      task('t4', 4, [], { status: 'failed' }),
    ],
  }
  const model = buildBoardModel(world)

  assert.deepEqual(
    model.members.map((m) => m.id),
    ['agent-1', 'agent-2'],
    '成员顺序只由 id 决定（不依赖输入顺序）',
  )
  assert.deepEqual(model.members[0].tasks, ['t1'])
  assert.deepEqual(model.members[1].tasks, ['t2'])
  assert.equal(model.members[1].carrying, 't2')
  assert.deepEqual(model.unowned, ['t3', 't4'])
  assert.deepEqual(model.counts, { total: 4, in_progress: 1, ready: 1, blocked: 0, pending: 0, done: 1, failed: 1 })
  assert.deepEqual(
    model.tasks.map((t) => t.id),
    ['t1', 't2', 't3', 't4'],
    '任务表按 ordinal 排',
  )
  assert.equal(model.tasks[1].ownerName, '乙')
  assert.equal(model.tasks[2].ownerName, null)
})

test('**看板不重算 ready**：状态是消费来的，给什么显示什么', () => {
  // t2 的前置还没做完，但世界说它是 ready —— 看板必须照显示 ready。
  const model = buildBoardModel({
    agents: [],
    tasks: [task('t1', 1, [], { status: 'in_progress' }), task('t2', 2, ['t1'], { status: 'ready' })],
  })
  const detail = describeTask(model, 't2')
  assert.equal(detail.status, 'ready')
  assert.equal(detail.statusToken, STATUS_TOKEN.ready)

  // 反过来：前置全 done 但世界说它 pending —— 看板也不许"纠正"成 ready。
  const model2 = buildBoardModel({
    agents: [],
    tasks: [task('t1', 1, [], { status: 'done' }), task('t2', 2, ['t1'], { status: 'pending' })],
  })
  assert.equal(describeTask(model2, 't2').status, 'pending')
})

test('describeTask：标题/状态/执行者/解锁了谁，以及"验证"是能力不是角色', () => {
  const model = buildBoardModel({
    agents: [{ id: 'agent-1', name: '甲', role: 'reviewer', state: 'idle', carrying: null }],
    tasks: [
      task('t1', 1, [], { status: 'done', owner: 'agent-1', requires: ['review'], acceptance: '逐条看' }),
      task('t2', 2, ['t1'], { status: 'in_progress' }),
      task('t3', 3, ['t1'], { status: 'pending' }),
    ],
  })
  const detail = describeTask(model, 't1')

  assert.equal(detail.title, '标题 t1')
  assert.equal(detail.ownerName, '甲')
  assert.equal(detail.acceptance, '逐条看')
  assert.equal(detail.needsReview, true, '需要 review 能力的任务在图上画橙色虚线框')
  assert.deepEqual(
    detail.unlocks.map((u) => u.id),
    ['t2', 't3'],
  )
  assert.equal(detail.unlocks[0].status, 'in_progress', '解锁列表要带状态，否则详情栏看不出进展')
  assert.deepEqual(detail.blockedByTasks, [])
  assert.equal(describeTask(model, '不存在'), null)
})

test('未知状态不炸：当成 pending，并且计数里不出现第七种状态', () => {
  const model = buildBoardModel({ agents: [], tasks: [task('t1', 1, [], { status: '莫名其妙' })] })
  assert.equal(model.tasks[0].status, 'pending')
  assert.deepEqual(Object.keys(model.counts).sort(), ['total', ...TASK_STATUSES].sort())
  assert.deepEqual(countStatuses([{ id: 'x' }]), { total: 1, in_progress: 0, ready: 0, blocked: 0, pending: 1, done: 0, failed: 0 })
})

test('配色只走 token：有值就用，缺了退哨兵色，再缺就返回 null（调用方不许静默变灰）', () => {
  const palette = { 'board.bg': '#121212', 'board.status.done': '#22C55E', 'board.missing': '#FF00FF' }
  assert.equal(resolveBoardColor(palette, BOARD_TOKENS.bg), '#121212')
  assert.equal(resolveBoardColor(palette, STATUS_TOKEN.done), '#22C55E')
  assert.equal(resolveBoardColor(palette, 'board.不存在'), '#FF00FF', '缺 token 用哨兵色，一眼看得出来')
  assert.equal(resolveBoardColor({}, 'board.bg'), null)
  assert.equal(resolveBoardColor(undefined, 'board.bg'), null)

  assert.deepEqual(
    missingBoardTokens({ 'board.bg': '#121212' }).includes(BOARD_TOKENS.bg),
    false,
  )
  assert.ok(missingBoardTokens({}).length >= Object.values(BOARD_TOKENS).length)
  assert.deepEqual(missingBoardTokens({ ...palette }), [
    ...Object.values(BOARD_TOKENS),
    ...Object.values(STATUS_TOKEN),
  ].filter((t) => !(t in palette)))
})

test('boardSignature 不含 tick：只有 tick 前进时看板不该重画', () => {
  const base = { agents: [{ id: 'a', name: '甲', state: 'idle', carrying: null }], tasks: [task('t1', 1)] }
  assert.equal(boardSignature({ ...base, tick: 10 }), boardSignature({ ...base, tick: 9999 }))
  const changed = { ...base, tasks: [task('t1', 1, [], { status: 'done' })] , tick: 10 }
  assert.notEqual(boardSignature(base), boardSignature(changed))
})
