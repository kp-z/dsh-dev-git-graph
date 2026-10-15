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
  describeTask,
  fitGraphGeometry,
  graphGeometry,
  layoutDependencyGraph,
  missingBoardTokens,
  resolveBoardColor,
  shortTaskId,
  unlocksIndex,
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
    assert.ok(shownW <= available.width + 1, `${viewport}px：横向放不下（${shownW} > ${available.width}，档位 ${fit.preset}）`)
    assert.ok(shownH <= available.height + 1, `${viewport}px：纵向放不下（${shownH} > ${available.height}）`)
    assert.equal(fit.scale >= 0.4, true, '缩放有个下限，免得缩到读不了')
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
  assert.ok(tiny.width * tiny.scale <= 300 + 1)
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
