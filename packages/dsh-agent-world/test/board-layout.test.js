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
  GEOMETRY_PRESETS,
  STATUS_TOKEN,
  TASK_STATUSES,
  boardSignature,
  buildBoardModel,
  countStatuses,
  countDisplayStatuses,
  deadBlockersOf,
  displayStatusOf,
  describeTask,
  fitGraphGeometry,
  graphGeometry,
  MIN_SCALE,
  NODE_TITLE_PX,
  READABLE_MIN_PX,
  layoutDependencyGraph,
  missingBoardTokens,
  UNGROUPED,
  VIEW_FILTERS,
  applyView,
  filterTasks,
  groupOf,
  groupTasks,
  resolveBoardColor,
  selectGroup,
  shortGroupName,
  shortTaskId,
  unlocksIndex,
  viewSignature,
} from '../web/core/board-layout.js'

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
  // `dead` 是新的一栏（R67 / M13-5）：卡死的单从「待办」里摘出来单独数。
  assert.deepEqual(model.counts, { total: 4, dead: 0, in_progress: 1, ready: 1, blocked: 0, pending: 0, done: 1, failed: 1 })
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

test('未知状态不炸：当成 pending，并且计数里不凭空多出状态', () => {
  const model = buildBoardModel({ agents: [], tasks: [task('t1', 1, [], { status: '莫名其妙' })] })
  assert.equal(model.tasks[0].status, 'pending')
  // R67 之前这里是"不许出现第七种状态"。现在有且只有一个新增栏 `dead`——它不是世界的状态，
  // 而是**我们从 `blockedBy` 算出来的结论**（前置失败）。除它以外仍然一个都不许多。
  assert.deepEqual(Object.keys(model.counts).sort(), ['total', ...TASK_STATUSES, 'dead'].sort())
  assert.equal(model.counts.dead, 0, '没有前置失败的单时，这一栏就是 0')
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

// ── 响应式：按可用空间挑档位 / 缩放（M7-9）────────────────────────────────────

/** 一份"真实形状"的图：两条流水线、5 列、最长列 3 行（和内置内容一致）。 */
function realisticLayout() {
  return layoutDependencyGraph([
    task('t1', 1),
    task('t2', 2, ['t1']),
    task('t3', 3, ['t1']),
    task('t4', 4, ['t2']),
    task('t5', 5, ['t3', 't4']),
    task('t6', 6, ['t2']),
    task('t7', 7, ['t5', 't6']),
    task('t8', 8),
    task('t9', 9, ['t8']),
    task('t10', 10, ['t9']),
  ])
}

test('空间够就用最舒服的那档（不缩放）', () => {
  const layout = realisticLayout()
  const fit = fitGraphGeometry(layout, { width: 1400, height: 400 })
  assert.equal(fit.preset, GEOMETRY_PRESETS[0].name)
  assert.equal(fit.scale, 1)
  assert.deepEqual(graphGeometry(layout, DEFAULT_GEOMETRY).nodes, fit.nodes, '档位只是叠在 graphGeometry 上的两个字段，几何本身不变')
  assert.equal(graphGeometry(layout, DEFAULT_GEOMETRY).width, fit.width)
  assert.ok(fit.width <= 1400 && fit.height <= 400)
})

test('三个验收宽度下都放得下（1280 / 1024 / 800 的可用盒）', () => {
  const layout = realisticLayout()
  // 可用盒 = 视口宽 - 边框/内边距 - （宽屏时）左侧 300px 成员栏
  const cases = [
    { viewport: 1280, available: { width: 940, height: 300 } },
    { viewport: 1024, available: { width: 970, height: 240 } },
    { viewport: 800, available: { width: 745, height: 240 } },
  ]
  for (const { viewport, available } of cases) {
    const fit = fitGraphGeometry(layout, available)
    const shownW = fit.width * fit.scale
    const shownH = fit.height * fit.scale
    // R120：**"装不下"不再是失败**——缩到可读下限之后就该让它滚。
    // 这里只要求"要么装下，要么已经缩到下限"（后者真机上由画布滚动兜住）。
    const fits = shownW <= available.width + 1 && shownH <= available.height + 1
    assert.ok(
      fits || fit.scale === MIN_SCALE,
      `${viewport}px：既没装下（${shownW}x${shownH} > ${available.width}x${available.height}）又没到可读下限（scale=${fit.scale}）`,
    )
    assert.ok(fit.scale >= MIN_SCALE, '缩放不许低于可读下限')
  }
})

test('宽度不够就降档；降到底才缩放（先小卡片，后缩放）', () => {
  const layout = realisticLayout()
  const wide = fitGraphGeometry(layout, { width: 1400, height: 400 })
  const narrow = fitGraphGeometry(layout, { width: 800, height: 400 })
  assert.notEqual(narrow.preset, wide.preset, '窄了要换更紧的档位')
  assert.equal(narrow.scale, 1, '还有档位可用时不该缩放（文字不能变小）')
  assert.ok(narrow.width < wide.width)

  const tiny = fitGraphGeometry(layout, { width: 300, height: 120 })
  assert.equal(tiny.preset, GEOMETRY_PRESETS[GEOMETRY_PRESETS.length - 1].name, '放不下就退到最紧那一档')
  assert.ok(tiny.scale < 1)
  // R120：这里**不再断言"装得下"**——300×120 装不下 0.8 的图，那就该滚（真机上画布能滚）。
  // 断言改成"没有缩过头"：这正是旧判据（只看装不装得下）会放过去的那一类错。
  assert.equal(tiny.scale, MIN_SCALE, '缩到可读下限就停，不再往下缩')
  assert.ok(tiny.width * tiny.scale > 300, '这个尺寸下本来就装不下 —— 装不下是对的，让它滚')
})

test('只有高度受限时也降档（宽得离谱但很矮）', () => {
  const layout = realisticLayout()
  const fit = fitGraphGeometry(layout, { width: 4000, height: 150 })
  assert.ok(fit.height * fit.scale <= 150 + 1)
})

test('可用空间为 0 / 缺失时不炸（量不到尺寸时的兜底）', () => {
  const layout = realisticLayout()
  for (const available of [{ width: 0, height: 0 }, {}, undefined, null]) {
    const fit = fitGraphGeometry(layout, available)
    assert.equal(fit.preset, GEOMETRY_PRESETS[GEOMETRY_PRESETS.length - 1].name)
    assert.ok(fit.scale >= 0.4 && fit.scale <= 1, '给一个可用的下界，而不是 0 或 NaN')
    assert.ok(fit.nodes.t1 !== undefined, '节点一个都不能丢')
  }
})

// ── R3 / task-6：竖向排布（侧边栏只有 ~290px 宽，横向排布必然缩到读不了）─────────────
test('竖向排布：前置在上、后续在下，连线接上下边缘', () => {
  const layout = layoutDependencyGraph([task('a', 1), task('b', 2, ['a'])])
  const geo = graphGeometry(layout, {}, 'vertical')
  const a = geo.nodes.a
  const b = geo.nodes.b
  // 竖向 = 列号走 y，行号走 x。层 0 在上，层 1 在下。
  assert.equal(a.y, DEFAULT_GEOMETRY.padY)
  assert.equal(b.y, DEFAULT_GEOMETRY.padY + DEFAULT_GEOMETRY.cellH)
  assert.equal(a.x, DEFAULT_GEOMETRY.padX)
  assert.equal(b.x, DEFAULT_GEOMETRY.padX)

  const edge = geo.edges[0]
  assert.equal(edge.y1, a.y + a.h, '起点在前置卡片的下边缘')
  assert.equal(edge.x1, a.cx)
  assert.equal(edge.y2, b.y, '终点在后置卡片的上边缘')
  assert.equal(edge.x2, b.cx)
  assert.match(edge.path, /^M \d+ \d+ C /)

  // 同样的层数，竖向比横向**窄**（这正是侧边栏需要的）。
  const horizontal = graphGeometry(layout)
  assert.ok(geo.width < horizontal.width, '竖向排布要显著更窄')
  assert.ok(geo.height > horizontal.height, '代价是更高——侧边栏高度够')
})

test('竖向排布：默认仍是横向（不改老行为）', () => {
  const layout = layoutDependencyGraph([task('a', 1), task('b', 2, ['a'])])
  assert.deepEqual(graphGeometry(layout), graphGeometry(layout, {}, 'horizontal'))
  assert.deepEqual(fitGraphGeometry(layout, { width: 800, height: 400 }), fitGraphGeometry(layout, { width: 800, height: 400 }, undefined, 'horizontal'))
})

test('侧边栏宽度下：竖向 1:1 装下，横向只能缩到读不了（R3 的真实世界 = 3 节点链）', () => {
  // 这是真机快照里的形状：task-1 → task-2 → task-3 一条链。
  const layout = layoutDependencyGraph([task('task-1', 1), task('task-2', 2, ['task-1']), task('task-3', 3, ['task-2'])])
  const sidebar = { width: 290, height: 612 }
  const vertical = fitGraphGeometry(layout, sidebar, undefined, 'vertical')
  const horizontal = fitGraphGeometry(layout, sidebar)
  // 判据不是"装得下"，而是"**不用缩放**就装得下"——缩到 0.65 的 8px 标题等于没显示。
  assert.equal(vertical.scale, 1, `竖向应 1:1 装下，实际 ${vertical.scale}（${vertical.preset}）`)
  assert.ok(vertical.width <= sidebar.width && vertical.height <= sidebar.height)
  assert.ok(horizontal.scale < vertical.scale, '横向在同样宽度下必然要缩')
})

test("'auto'：窄栏里挑竖向；宽屏下仍挑横向（不因为改实现而无故换边）", () => {
  const chain = layoutDependencyGraph([task('task-1', 1), task('task-2', 2, ['task-1']), task('task-3', 3, ['task-2'])])
  const narrow = fitGraphGeometry(chain, { width: 290, height: 612 }, undefined, 'auto')
  assert.equal(narrow.orientation, 'vertical')
  assert.equal(narrow.scale, 1)

  const wide = fitGraphGeometry(realisticLayout(), { width: 1400, height: 500 }, undefined, 'auto')
  assert.equal(wide.orientation, 'horizontal', '宽而矮的空间里横向才是对的')
  assert.equal(wide.scale, 1)
})

test('挑档位是确定性的：同一份输入同一个结果', () => {
  const layout = realisticLayout()
  const available = { width: 812, height: 233 }
  assert.deepEqual(fitGraphGeometry(layout, available), fitGraphGeometry(layout, available))
  // 与输入任务的到达顺序无关（`layout.signature` 已经保证了这一点，这里再钉一次）
  assert.equal(fitGraphGeometry(layout, available).width, fitGraphGeometry({ ...layout, nodes: [...layout.nodes].reverse() }, available).width)
})

// ── R45 / M10-9：产出与失败原因要**跟着模型走到界面**（否则详情区永远看不到）────────────

test('模型带出 output / failureReason（空串归一成 null，UI 只剩一个"没有产出"分支）', () => {
  const world = {
    tasks: [
      task('task-14', 1, [], { status: 'done', output: '结论：这条流水线没缺陷。' }),
      task('task-18', 2, ['task-14'], { status: 'failed', output: null, failureReason: '这一轮没做成：零行改动。' }),
      task('task-1', 3, [], { status: 'done', output: '' }), // 真机上早期单做完也没有产出
      task('task-2', 4, [], { status: 'in_progress' }), // 字段都不在
    ],
    agents: [],
  }
  const model = buildBoardModel(world)
  assert.equal(model.byId.get('task-14').output, '结论：这条流水线没缺陷。')
  assert.equal(model.byId.get('task-18').output, null)
  assert.equal(model.byId.get('task-18').failureReason, '这一轮没做成：零行改动。')
  assert.equal(model.byId.get('task-1').output, null, '空串要归一成 null')
  assert.equal(model.byId.get('task-2').output, null)
  assert.equal(model.byId.get('task-2').failureReason, null)

  // describeTask 要把它带给详情区（它 spread 了模型里的那张单）
  const detail = describeTask(model, 'task-18')
  assert.equal(detail.failureReason, '这一轮没做成：零行改动。')
  assert.equal(detail.statusToken, STATUS_TOKEN.failed)
})

test('产出开始/变化会让签名变（详情区不会停在"还没有产出"）', () => {
  const before = boardSignature({ tasks: [task('task-28', 1, [], { status: 'done' })] })
  const sameAgain = boardSignature({ tasks: [task('task-28', 1, [], { status: 'done' })] })
  const withOutput = boardSignature({ tasks: [task('task-28', 1, [], { status: 'done', output: '写完了。' })] })
  const longer = boardSignature({ tasks: [task('task-28', 1, [], { status: 'done', output: '写完了，而且更详细一点。' })] })
  const failedNow = boardSignature({ tasks: [task('task-28', 1, [], { status: 'done', failureReason: '环境起不来' })] })

  assert.equal(before, sameAgain, '同一份输入仍然给同一个签名')
  assert.notEqual(before, withOutput, '产出落地必须让签名变')
  assert.notEqual(withOutput, longer, '产出变长也要能看出来（长度进签名）')
  assert.notEqual(before, failedNow, '失败原因的有无也要进签名')
})

test('左栏短 id：只对 `task-<数字>` 去前缀，别的形状原样（不猜）', () => {
  assert.equal(shortTaskId('task-28'), '28')
  assert.equal(shortTaskId('task-1'), '1')
  assert.equal(shortTaskId('hotfix-3'), 'hotfix-3', '别的形状不该被改（改了就成了假信息）')
  assert.equal(shortTaskId('task-abc'), 'task-abc')
  assert.equal(shortTaskId('t4'), 't4')
  assert.equal(shortTaskId(null), '')
  assert.equal(shortTaskId(undefined), '')
})

// ── R46 / M10-11：按流水线分组 + 状态过滤 ─────────────────────────────────────

/**
 * 真机形状的三条流水线（28 张）。
 *
 * 形状是照 3080 上真实快照抄的：quick-fix 是 **6 条并行的三连链**（列少行多——撑爆的是宽高两头），
 * software-feature 是**菱形**（4 列、最多 2 行），town-inspection 是一条直链。
 * 用它算出来的档位与真机一致，才能把"分组之后 scale 是不是 1"变成**能算的断言**。
 */
function realShapedWorld() {
  const tasks = []
  const push = (id, ordinal, set, key, status, deps = []) =>
    tasks.push({
      id, key, ordinal, set, title: `${key} ${id}`, status, owner: null, station: null,
      requires: [], blockedBy: deps, progress: 0, acceptance: '',
    })
  // quick-fix：6 条 triage → patch → verify（真机 id 是 1/2/3、11~25）
  const chains = [[1, 2, 3], [11, 12, 13], [14, 15, 16], [17, 18, 19], [20, 21, 22], [23, 24, 25]]
  const chainStatus = [['done', 'done', 'done'], ['done', 'done', 'done'], ['done', 'done', 'done'], ['done', 'failed', 'pending'], ['done', 'failed', 'pending'], ['done', 'failed', 'pending']]
  chains.forEach((ids, index) => {
    push(`task-${ids[0]}`, ids[0], 'task.quick-fix', 'triage', chainStatus[index][0], [])
    push(`task-${ids[1]}`, ids[1], 'task.quick-fix', 'patch', chainStatus[index][1], [`task-${ids[0]}`])
    push(`task-${ids[2]}`, ids[2], 'task.quick-fix', 'verify', chainStatus[index][2], [`task-${ids[1]}`])
  })
  // software-feature：菱形（真机 4~10）
  push('task-4', 4, 'task.software-feature', 'design', 'done', [])
  push('task-5', 5, 'task.software-feature', 'impl-core', 'done', ['task-4'])
  push('task-6', 6, 'task.software-feature', 'impl-api', 'done', ['task-4'])
  push('task-7', 7, 'task.software-feature', 'test', 'done', ['task-5'])
  push('task-8', 8, 'task.software-feature', 'review', 'done', ['task-6', 'task-7'])
  push('task-9', 9, 'task.software-feature', 'docs', 'done', ['task-5'])
  push('task-10', 10, 'task.software-feature', 'ship', 'done', ['task-8', 'task-9'])
  // town-inspection：一条直链（真机 26~28）
  push('task-26', 26, 'task.town-inspection', 'survey', 'done', [])
  push('task-27', 27, 'task.town-inspection', 'check', 'done', ['task-26'])
  push('task-28', 28, 'task.town-inspection', 'report', 'done', ['task-27'])
  return { tasks, agents: [] }
}

/**
 * 三档验收视口下"图能拿到的画布尺寸"。
 *
 * 这几个数是**在浏览器里量出来的**（1280×900 宽档成员栏在图左侧；1024/800 窄档成员栏可收起、
 * 收起后图拿到整块高度；视图条与图头各占一行）。测试用它是为了把"装得下装不下"变成算术，
 * 而不是每次开浏览器目测。
 */
const CANVAS_SIZES = {
  // 真机 28 张单时在浏览器里**量出来的**画布尺寸（`__agentWorldBoard.stats().available`）：
  // 1280 是宽档（成员栏在图左侧）；1024/800 是窄档（成员栏默认收起，图拿整块高度）。
  '1280x900': { width: 909, height: 311 },
  '1024x800': { width: 953, height: 312 },
  '800x700': { width: 729, height: 221 },
}

/** 某个视图在某档下算出来的档位/缩放，以及"缩放后是否真的落在可用区里"。 */
function fitFor(world, view, viewport) {
  const size = CANVAS_SIZES[viewport]
  const tasks = applyView(world.tasks, view)
  const model = buildBoardModel({ ...world, tasks })
  const layout = layoutDependencyGraph(model.tasks)
  const fitted = fitGraphGeometry(layout, size)
  return {
    tasks: tasks.length,
    fitted,
    size,
    /** 缩放后仍然超出可用区 → 真机上就是画布要滚动（= `clipped()` 会报东西）。 */
    fitsInView: fitted.width * fitted.scale <= size.width + 1 && fitted.height * fitted.scale <= size.height + 1,
  }
}

test('groupTasks：按 set 分组，数量/未完成数/顺序都确定', () => {
  const groups = groupTasks(realShapedWorld().tasks)
  assert.deepEqual(groups.map((g) => g.id), ['task.quick-fix', 'task.software-feature', 'task.town-inspection'])
  const quick = groups[0]
  assert.equal(quick.name, 'quick-fix', '名字只去 task. 前缀（中文名是内容，前端不许猜）')
  assert.equal(quick.total, 18)
  assert.equal(quick.done, 12)
  assert.equal(quick.failed, 3)
  assert.equal(quick.unfinished, 6, '未完成 = 非 done（失败也算没干完）')
  assert.equal(groups[1].total, 7)
  assert.equal(groups[1].unfinished, 0)
  assert.equal(groups[2].total, 3)

  // 没有 set 的单归到 UNGROUPED，且**排在最后**
  const withStray = groupTasks([...realShapedWorld().tasks, task('task-99', 99, [], { set: undefined })])
  assert.equal(withStray[withStray.length - 1].id, UNGROUPED)
  assert.equal(withStray[withStray.length - 1].name, '', '没有名字可显示（界面用"未分组"这个 UI 文案）')
  // 同一份输入 → 同一份输出
  assert.deepEqual(groupTasks(realShapedWorld().tasks), groups)
})

test('shortGroupName / groupOf：只认 `task.` 前缀，别的形状不猜', () => {
  assert.equal(shortGroupName('task.quick-fix'), 'quick-fix')
  assert.equal(shortGroupName('hotfix-batch'), 'hotfix-batch')
  assert.equal(shortGroupName(''), '')
  assert.equal(shortGroupName(null), '')
  assert.equal(groupOf({ set: 'task.a' }), 'task.a')
  assert.equal(groupOf({ set: '' }), UNGROUPED)
  assert.equal(groupOf({}), UNGROUPED)
})

test('filterTasks：四档都按状态算；**认不出的 filter 不隐藏**（危险的那一侧）', () => {
  const tasks = realShapedWorld().tasks
  assert.equal(filterTasks(tasks, 'all').length, 28)
  assert.equal(filterTasks(tasks, 'unfinished').length, 6)
  assert.equal(filterTasks(tasks, 'failed').length, 3)
  assert.equal(filterTasks(tasks, 'done').length, 22)
  assert.equal(filterTasks(tasks, '某个不认识的筛选').length, 28, '认不出就不隐藏')
  assert.equal(filterTasks(tasks, undefined).length, 28)
  assert.deepEqual(VIEW_FILTERS, ['all', 'unfinished', 'failed', 'done'])
  // 不改原数组
  const before = tasks.length
  filterTasks(tasks, 'failed')
  assert.equal(tasks.length, before)
})

test('applyView：分组与筛选**可叠加**', () => {
  const world = realShapedWorld()
  assert.equal(applyView(world.tasks, {}).length, 28)
  assert.equal(applyView(world.tasks, { group: 'task.quick-fix' }).length, 18)
  assert.equal(applyView(world.tasks, { group: 'task.quick-fix', filter: 'unfinished' }).length, 6)
  assert.equal(applyView(world.tasks, { group: 'task.software-feature', filter: 'unfinished' }).length, 0)
  assert.equal(applyView(world.tasks, { filter: 'failed' }).length, 3)
  assert.equal(selectGroup(world.tasks, 'all').length, 28)
})

test('签名：视图状态必须进签名（不然用户换了分组，下一帧又把图留成旧的）', () => {
  const world = realShapedWorld()
  assert.equal(viewSignature({ group: 'all', filter: 'all' }), 'g:all|f:all')
  assert.notEqual(viewSignature({ group: 'task.quick-fix' }), viewSignature({}))
  assert.notEqual(boardSignature(world, { filter: 'done' }), boardSignature(world, { filter: 'all' }))
  assert.notEqual(boardSignature(world, { group: 'task.quick-fix' }), boardSignature(world, {}))
  assert.equal(boardSignature(world, { group: 'all', filter: 'all' }), boardSignature(world), '缺省视图 = 老行为')
})

test('★ 分组之后，**单条流水线的图回到 scale = 1**（本轮的目标，能算）', () => {
  const world = realShapedWorld()
  for (const group of groupTasks(world.tasks)) {
    for (const viewport of ['1280x900', '1024x800']) {
      const result = fitFor(world, { group: group.id }, viewport)
      assert.equal(result.fitted.scale, 1, `${group.name} 在 ${viewport} 没有回到 scale 1（现在 ${result.fitted.scale}）`)
      assert.ok(result.fitsInView, `${group.name} @ ${viewport} 缩放后仍超出可用区`)
    }
    // ⚠️ R120：这条"装下"的断言**保留**——它是"分组之后图不再拥挤"这个目标的算术版，
    // 而这些视图**确实**装得下。真正改掉的是**下面那些装不下的**：它们不再算失败。
  }

  // 800×700 这一档只给图 729×221，三条流水线里：
  //  · town-inspection（3 张，直链）仍然 scale 1；
  //  · software-feature（7 张，菱形）差 1px（tight 档宽 730 > 画布 729）→ 0.99；
  //  · quick-fix（18 张 = 6 条并行链，行多）→ 0.72（tight 档高 304 > 221）。
  // 三张都**装得下**（这就是 clipped() 归零的算术保证）；要 1 得给看板更高或加更小的档位，
  // 而那两条我都不要：看板更高会盖掉场景，更小的档位字会小到读不了。
  assert.equal(fitFor(world, { group: 'task.town-inspection' }, '800x700').fitted.scale, 1)
  const swSmall = fitFor(world, { group: 'task.software-feature' }, '800x700')
  assert.ok(swSmall.fitted.scale >= 0.99, `software-feature @800 掉太多了：${swSmall.fitted.scale}`)
  assert.ok(swSmall.fitsInView)
  const quickSmall = fitFor(world, { group: 'task.quick-fix' }, '800x700')
  assert.ok(quickSmall.fitted.scale >= 0.7, `quick-fix @800 掉到 ${quickSmall.fitted.scale}`)
  assert.ok(quickSmall.fitted.scale >= MIN_SCALE, `quick-fix @800 触到可读下限了：${quickSmall.fitted.scale}`)
  // R120：这里原来是 `assert.ok(fitsInView)` + `assert.equal(scale, 0.72)`。
  // 0.72 是**旧下限(0.4)时代**的真机值。抬到 0.8 之后：raw ≈ 0.37 → **夹到下限 0.8**，
  // 于是 304×592 缩成 243×474，**纵向溢出 474 > 221** → 真机上就是画布纵向滚动。
  // 那正是本轮要的行为（"缩到能读，装不下就滚"），所以断言改成**可读**而不是装下。
  assert.equal(quickSmall.fitted.scale, MIN_SCALE, '缩到可读下限就停（不再往 0.72/0.4 缩）')
  assert.ok(!quickSmall.fitsInView, '这一档本来就装不下 —— 现在允许它溢出并滚动，不再算失败')
  assert.ok(
    NODE_TITLE_PX * quickSmall.fitted.scale >= READABLE_MIN_PX,
    `标题实际像素高 ${NODE_TITLE_PX * quickSmall.fitted.scale} 低于可读下限 ${READABLE_MIN_PX}`,
  )

  // 而"全部 28 张"在窄档下**装不下是可接受的**（R120）——只要没缩到读不出。
  for (const viewport of Object.keys(CANVAS_SIZES)) {
    const all = fitFor(world, {}, viewport)
    assert.ok(all.fitted.scale >= MIN_SCALE, `全部 @${viewport} 缩过头了：${all.fitted.scale}`)
    const shownW = all.fitted.width * all.fitted.scale
    const shownH = all.fitted.height * all.fitted.scale
    assert.ok(
      all.fitsInView || all.fitted.scale === MIN_SCALE,
      `全部 @${viewport}：既装不下又没到下限（${Math.round(shownW)}x${Math.round(shownH)} vs ${all.size.width}x${all.size.height}，scale=${all.fitted.scale}）`,
    )
  }
})

// ── R120：**可读性**判据（"装下了" ≠ "能读"）─────────────────────────────────
//
// 同一个判据错误我们犯过两次：R12 缩到 0.65、R120 缩到 0.4，两次都是
// **拿"几何有没有溢出"当"能不能读"**。所以这里钉的不是某个数值，而是两条**关系**：
//   ① 缩放**永远不低于**可读下限（无论可用区多小）；
//   ② 下限与"标题像素高"是**同一个判据的两种说法**。

test('R120：缩放**永远不低于可读下限**（可用区小到 1px 也不许缩过头）', () => {
  const layout = realisticLayout()
  const cases = [{ width: 1, height: 1 }, { width: 50, height: 40 }, { width: 120, height: 90 }, { width: 0, height: 0 }]
  for (const available of cases) {
    const fit = fitGraphGeometry(layout, available)
    assert.ok(
      fit.scale >= MIN_SCALE,
      `可用区 ${available.width}x${available.height} 把图缩到 ${fit.scale}（低于下限 ${MIN_SCALE}）——这正是 R120 的 bug`,
    )
    assert.ok(fit.width * fit.scale > 0 && fit.height * fit.scale > 0, '几何不能退化成 0')
  }
})

test('R120：下限与"标题像素高"是**同一个判据的两种说法**', () => {
  const implied = READABLE_MIN_PX / NODE_TITLE_PX
  assert.ok(
    MIN_SCALE >= implied,
    `MIN_SCALE(${MIN_SCALE}) 低于由字号反推的下限(${implied.toFixed(3)})——那会出现"过了 scale 判据、字却读不出"`,
  )
  assert.ok(MIN_SCALE <= implied + 0.1, `MIN_SCALE(${MIN_SCALE}) 比反推值高太多，会白白浪费空间`)
  assert.ok(
    NODE_TITLE_PX * MIN_SCALE >= READABLE_MIN_PX,
    `下限 ${MIN_SCALE} 处标题只有 ${NODE_TITLE_PX * MIN_SCALE}px，低于可读阈值 ${READABLE_MIN_PX}px`,
  )
})

test('★ 最坏组合（全部 + 完成 / 全部 + 全部）也要装得下——这是 clipped() 归零的算术版', () => {
  const world = realShapedWorld()
  const worst = [
    { group: 'all', filter: 'done' }, // 22 张
    { group: 'all', filter: 'all' }, // 28 张
    { group: 'all', filter: 'unfinished' }, // 6 张
  ]
  for (const view of worst) {
    for (const viewport of Object.keys(CANVAS_SIZES)) {
      const result = fitFor(world, view, viewport)
      // R120：判据从"装得下"改成"**没缩到读不出**"。
      // 装不下时真机上是画布滚动——那比一张 0.4 的废图有用得多。
      assert.ok(
        result.fitted.scale >= MIN_SCALE,
        `${view.group}/${view.filter}（${result.tasks} 张）@${viewport}：缩到 ${result.fitted.scale}，低于可读下限 ${MIN_SCALE}`,
      )
      const shownW = result.fitted.width * result.fitted.scale
      const shownH = result.fitted.height * result.fitted.scale
      assert.ok(
        result.fitsInView || result.fitted.scale === MIN_SCALE,
        `${view.group}/${view.filter}（${result.tasks} 张）@${viewport}：既装不下（${Math.round(shownW)}x${Math.round(shownH)} > ${result.size.width}x${result.size.height}）又没到下限`,
      )
    }
  }
})

// ── R46：分组名来自服务端下发的内容，前端不翻译 ──────────────────────────────

test('R46：分组名优先用内容里的中文名；拿不到就退回短 id（**不许前端自己翻译**）', () => {
  const tasks = [
    { id: 'task-1', set: 'task.quick-fix', status: 'done', ordinal: 1 },
    { id: 'task-2', set: 'task.town-inspection', status: 'pending', ordinal: 2 },
  ]
  // 服务端下发了目录：用内容里的名字。
  const named = groupTasks(tasks, { 'task.quick-fix': '快速修一个 bug' })
  assert.equal(named.find((g) => g.id === 'task.quick-fix').name, '快速修一个 bug')
  // 没下发：退回短 id，**不是**一个猜出来的中文名。
  const bare = groupTasks(tasks)
  assert.equal(bare.find((g) => g.id === 'task.quick-fix').name, 'quick-fix')
  assert.equal(bare.find((g) => g.id === 'task.town-inspection').name, 'town-inspection')
})

test('R46：main.js 必须把 **snapshot 的** taskSets 喂给看板（真机上抓到的错源）', async () => {
  // 这条守的是一个**只在真机上暴露**的错法：`meta` 是显式挑字段的对象，
  // `meta.taskSets` 恒为 undefined——写错源头不会报错，只是分组签一直显示英文短 id。
  const source = await import('node:fs/promises').then((fs) =>
    fs.readFile(new URL('../web/main.js', import.meta.url), 'utf8'),
  )
  assert.match(source, /board\.setTaskSets\?\.\(snap\.taskSets\)/, 'main.js 应从 snap.taskSets 取流水线目录')
  assert.doesNotMatch(source, /setTaskSets\?\.\(meta\.taskSets\)/, 'meta 里没有 taskSets 字段，取它就是 undefined')
})

// ── R67 / M13-5：卡死的单（前置失败 → 永远等不到）─────────────────────────────
//
// 真机上的形状：`task-19 ← task-18(failed)`、`task-22 ← task-21(failed)`、`task-25 ← task-24(failed)`。
// 这些单的状态机永远停在 pending，而界面以前只说「待办」——用户看不出这是个死结。

test('前置失败 → 判为卡死；前置只是没做完 → 照旧等着', () => {
  const tasks = [
    task('task-18', 18, [], { status: 'failed', failureReason: '我手上没有能改代码的工具' }),
    task('task-19', 19, ['task-18'], { status: 'pending' }),
    task('task-20', 20, ['task-17'], { status: 'pending' }),
    task('task-17', 17, [], { status: 'in_progress' }),
  ]
  const byId = new Map(tasks.map((t) => [t.id, t]))

  assert.deepEqual(deadBlockersOf(tasks[1], byId).map((t) => t.id), ['task-18'])
  assert.deepEqual(deadBlockersOf(tasks[2], byId).map((t) => t.id), [], '前置只是还在跑，不是卡死')
  assert.equal(displayStatusOf(tasks[1], byId), 'dead')
  assert.equal(displayStatusOf(tasks[2], byId), 'pending', '正常等待不许被涂成卡死')
})

test('卡死判定：空前置 / 表外前置 / 前置是 done 都不算卡死', () => {
  const byId = new Map([['task-1', task('task-1', 1, [], { status: 'done' })]])
  assert.deepEqual(deadBlockersOf(task('a', 1), byId), [], '没有前置')
  assert.deepEqual(deadBlockersOf(task('b', 2, ['task.不在表里']), byId), [], '表外的前置判不了失败')
  assert.deepEqual(deadBlockersOf(task('c', 3, ['task-1']), byId), [], 'done 的前置不挡路')
  assert.equal(displayStatusOf(task('c', 3, ['task-1']), byId), 'pending')
})

test('卡死是"显示状态"，不许覆盖世界的 status（统计/筛选仍按真实状态走）', () => {
  const model = buildBoardModel({
    agents: [],
    tasks: [
      task('task-24', 24, [], { status: 'failed' }),
      task('task-25', 25, ['task-24'], { status: 'pending' }),
    ],
  })
  const dead = model.byId.get('task-25')
  assert.equal(dead.status, 'pending', '世界说它是 pending——这一点不能被我们改写')
  assert.equal(dead.displayStatus, 'dead')
  assert.deepEqual(dead.deadBlockers.map((b) => b.id), ['task-24'])
  assert.deepEqual(model.dead, { ids: ['task-25'], count: 1 })
  // 计数按显示状态：卡死的单不再混进「待办」，否则同一张单被数两次
  assert.equal(model.counts.dead, 1)
  assert.equal(model.counts.pending, 0)
  assert.equal(model.counts.total, 2)
})

test('countDisplayStatuses：六态 + dead，总数守恒', () => {
  const counts = countDisplayStatuses([
    task('a', 1, [], { status: 'done' }),
    task('b', 2, [], { status: 'failed' }),
    task('c', 3, [], { status: 'in_progress' }),
    task('d', 4, [], { status: 'nonsense' }),
  ])
  assert.equal(counts.total, 4)
  assert.equal(counts.done, 1)
  assert.equal(counts.failed, 1)
  assert.equal(counts.in_progress, 1)
  assert.equal(counts.pending, 1, '认不出的状态按 pending 计')
  assert.equal(counts.dead, 0, '这一批里没有"前置失败"的单')
  const sum = TASK_STATUSES.reduce((acc, s) => acc + counts[s], 0) + counts.dead
  assert.equal(sum, counts.total)
})

test('已交付/正在跑的单，即使前置失败也不涂成卡死（它没有"等不到"这件事）', () => {
  const byId = new Map([['task-1', task('task-1', 1, [], { status: 'failed' })]])
  assert.equal(displayStatusOf(task('d1', 2, ['task-1'], { status: 'done' }), byId), 'done')
  assert.equal(displayStatusOf(task('d2', 3, ['task-1'], { status: 'in_progress' }), byId), 'in_progress')
  // 但事实照记：详情里仍然看得到"它有个前置失败了"
  assert.deepEqual(deadBlockersOf(task('d1', 2, ['task-1'], { status: 'done' }), byId).map((t) => t.id), ['task-1'])
})
