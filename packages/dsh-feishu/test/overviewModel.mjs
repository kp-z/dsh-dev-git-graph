/**
 * 总览页纯函数层（model.js）的单元测试。
 *
 * 为什么单独测这一层：视图组件只在浏览器里跑，而「树的三层结构 / 折叠后 byKey 是否还留着 /
 * scope 三态 / 右键菜单结构」这些最容易回归的逻辑全在这里，而且是 node 能直接跑的部分。
 *
 * 跑法：node test/overviewModel.mjs
 */
import assert from 'node:assert/strict'
import {
  DECO_SLOTS,
  GROUP_PREFIX,
  REF_FIELDS,
  SCOPES,
  UNGROUPED_KEY,
  UNGROUPED_LABEL,
  blockedOf,
  buildTree,
  collapse,
  groupByCustom,
  groupTasks,
  lanesForScope,
  measure,
  normScope,
  normalizeEdges,
  normalizeGroups,
  projectKeysOf,
  readyOf,
  refsOf,
  rowMenu,
  scopeKey,
  scopeLabel,
  scopeTasks,
  stateOf,
  stateLabel,
  statsOf,
  truncateTitle,
  workspaceOf,
} from '../src/overview/model.js'

/* ---------------- 迷你 runner ---------------- */

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
    console.log(String(error && error.stack ? error.stack : error).split('\n').slice(0, 6).map((line) => `       ${line}`).join('\n'))
  }
}

/* ---------------- 夹具 ---------------- */

const TASKS = [
  {
    id: 'a1', no: 101, title: 'Alpha 依赖项', done: false,
    workspaceKey: 'wA', workspaceTitle: '项目A', workspacePath: '/Users/kp/DEV/alpha',
    blocked: true, ready: false, started: false, suspended: false, sessionId: 's-a1',
    predecessors: [{ id: 'b1', title: 'Beta 前置' }], successors: [], sourceTasks: [], derivedTasks: [],
    blockedBy: [{ id: 'b1', title: 'Beta 前置' }],
  },
  {
    id: 'a2', no: 102, title: 'Alpha 已完成', done: true,
    workspaceKey: 'wA', workspaceTitle: '项目A', workspacePath: '/Users/kp/DEV/alpha',
    blocked: false, ready: false, started: false, suspended: false, sessionId: '',
    predecessors: [], successors: [], sourceTasks: [], derivedTasks: [], blockedBy: [],
  },
  {
    id: 'b1', no: 103, title: 'Beta 前置', done: false,
    workspaceKey: 'wB', workspaceTitle: '项目B', workspacePath: '/Users/kp/DEV/beta',
    blocked: false, ready: true, started: true, suspended: false, sessionId: 's-b1',
    predecessors: [], successors: [{ id: 'a1', title: 'Alpha 依赖项' }], sourceTasks: [], derivedTasks: [], blockedBy: [],
  },
  {
    id: 'c1', no: 104, title: '未归属任务', done: false,
    workspaceKey: '', workspaceTitle: '', workspacePath: '',
    blocked: false, ready: true, started: false, suspended: false, sessionId: '',
    predecessors: [], successors: [], sourceTasks: [{ id: 'a1', title: 'Alpha 依赖项' }], derivedTasks: [], blockedBy: [],
  },
  {
    id: 'halt1', no: 105, title: '挂起中的任务', done: false,
    workspaceKey: 'wB', workspaceTitle: '项目B', workspacePath: '/Users/kp/DEV/beta',
    blocked: false, ready: false, started: false, suspended: true, sessionId: '',
    predecessors: [], successors: [], sourceTasks: [], derivedTasks: [], blockedBy: [],
  },
]

const RELATIONS = [
  { from: 'b1', to: 'a1', kind: 'depends_on' },
  { from: 'a2', to: 'a1', kind: 'derived_from' },
  { from: 'ghost-x', to: 'a1', kind: 'depends_on' },
  { from: 'b1', to: 'a1', kind: 'depends_on' }, // 重复边：必须被去掉
  { from: 'a1', to: 'a1', kind: 'depends_on' }, // 自环：必须被丢掉
  { from: 'a1', to: 'c1', kind: 'not-a-kind' }, // 未知 kind：必须被丢掉
  { from: '', to: 'a1', kind: 'depends_on' }, // 空端点：必须被丢掉
]

const GROUPS = [
  { id: 'g1', name: 'QVIZ', members: ['wA', 'w-missing'], labels: { 'w-missing': '已删除的项目' } },
]

const WORKSPACES = [
  { key: 'wA', id: 'wA', path: '/Users/kp/DEV/alpha', title: '项目A' },
  { key: 'wB', id: 'wB', path: '/Users/kp/DEV/beta', title: '项目B' },
  { key: 'wF', id: 'wF', path: '/Users/kp/DEV/empty', title: '空项目' },
]

console.log('overview/model.js')

/* ---------------- 基础规整 ---------------- */

test('normScope：三态 + 坏输入兜底', () => {
  assert.deepEqual(normScope({ kind: 'group', id: 'g1', members: ['wA', 'wA', ''] }), { kind: 'group', id: 'g1', members: ['wA'] })
  assert.deepEqual(normScope({ kind: 'project', id: 'wA' }), { kind: 'project', id: 'wA', members: [] })
  assert.deepEqual(normScope({ kind: 'all' }), { kind: 'all', id: '', members: [] })
  // 坏输入一律等于「全部任务」
  assert.deepEqual(normScope(null), { kind: 'all', id: '', members: [] })
  assert.deepEqual(normScope('group:g1'), { kind: 'all', id: '', members: [] })
  assert.deepEqual(normScope({ kind: 'group' }), { kind: 'all', id: '', members: [] })
  assert.deepEqual(normScope({ kind: 'project', id: '   ' }), { kind: 'all', id: '', members: [] })
  assert.equal(SCOPES.all, true)
  assert.equal(scopeKey({ kind: 'project', id: 'wA' }), 'project:wA')
  assert.equal(scopeKey(null), 'all')
})

test('workspaceOf：key 优先级与未归属兜底', () => {
  assert.equal(workspaceOf(TASKS[0]).key, 'wA')
  assert.equal(workspaceOf(TASKS[0]).label, '项目A')
  assert.equal(workspaceOf(TASKS[3]).key, UNGROUPED_KEY)
  assert.equal(workspaceOf(TASKS[3]).label, UNGROUPED_LABEL)
  assert.equal(workspaceOf(null).ungrouped, true)
  // 兼容旧字段
  assert.equal(workspaceOf({ workspaceId: 'id-1', workspacePath: '/a/b' }).key, 'id-1')
  assert.equal(workspaceOf({ workspacePath: '/a/b' }).key, '/a/b')
  assert.equal(workspaceOf({ workspaceTitle: '只有名字' }).key, 'name:只有名字')
})

test('stateOf / readyOf / blockedOf：四态口径', () => {
  assert.equal(stateOf(TASKS[0]), 'blocked')
  assert.equal(stateOf(TASKS[1]), 'done')
  assert.equal(stateOf(TASKS[2]), 'open')
  assert.equal(stateOf(TASKS[4]), 'suspended')
  assert.equal(stateOf(null), 'open')
  assert.equal(blockedOf(TASKS[1]), false)
  assert.equal(readyOf(TASKS[2]), true)
  assert.equal(readyOf(TASKS[4]), false)
  assert.equal(stateLabel('blocked'), '阻塞')
  assert.equal(stateLabel('nope'), '就绪')
  // 没有 blocked 布尔时回落到关系口径（旧快照）
  assert.equal(blockedOf({ ready: false }), true)
  assert.equal(blockedOf({ blockedBy: ['x'] }), true)
  assert.equal(blockedOf({ ready: true }), false)
})

test('normalizeEdges：去重 / 丢自环 / 认 kind', () => {
  const edges = normalizeEdges(RELATIONS)
  assert.equal(edges.length, 3)
  assert.deepEqual(edges.map((edge) => `${edge.kind}:${edge.from}>${edge.to}`).sort(), [
    'depends_on:b1>a1',
    'depends_on:ghost-x>a1',
    'derived_from:a2>a1',
  ])
  assert.deepEqual(normalizeEdges(null), [])
  assert.deepEqual(normalizeEdges([null, 1, 'x', {}]), [])
})

test('truncateTitle / measure：CJK 记 1、截断加省略号', () => {
  assert.equal(measure('中文'), 2)
  assert.ok(Math.abs(measure('abcd') - 2.24) < 1e-6)
  const short = truncateTitle('短标题', 16)
  assert.equal(short.truncated, false)
  assert.equal(short.text, '短标题')
  const long = truncateTitle('这是一个非常非常非常非常长的任务标题需要被截断', 8)
  assert.equal(long.truncated, true)
  assert.ok(long.text.endsWith('…'))
  assert.equal(long.full, '这是一个非常非常非常非常长的任务标题需要被截断')
  assert.ok(measure(long.text) <= 8)
  assert.equal(truncateTitle(null, 0).text, '')
  assert.equal(collapse('  a   b  '), 'a b')
})

test('refsOf：五个关系字段都能从扁平契约取到', () => {
  const refs = refsOf(TASKS[0])
  assert.deepEqual(Object.keys(refs).sort(), [...REF_FIELDS].sort())
  assert.deepEqual(refs.predecessors, [{ id: 'b1', title: 'Beta 前置' }])
  assert.deepEqual(refs.blockedBy, [{ id: 'b1', title: 'Beta 前置' }])
  assert.deepEqual(refsOf({ predecessors: ['x', { id: 'y' }, null] }).predecessors, [{ id: 'x', title: '' }, { id: 'y', title: '' }])
  assert.deepEqual(refsOf(null).successors, [])
})

/* ---------------- 分组 ---------------- */

test('groupTasks：按项目分组、补空项目、组间排序', () => {
  const projects = groupTasks(TASKS, WORKSPACES)
  const byKey = new Map(projects.map((project) => [project.key, project]))
  assert.equal(projects.length, 4) // wA / wB / wF(空) / 未归属
  assert.equal(byKey.get('wA').total, 2)
  assert.equal(byKey.get('wA').done, 1)
  assert.equal(byKey.get('wA').blocked, 1)
  assert.equal(byKey.get('wA').ready, 0)
  assert.equal(byKey.get('wB').suspended, 1)
  assert.equal(byKey.get('wF').total, 0)
  assert.equal(byKey.get('wF').label, '空项目')
  assert.equal(byKey.get(UNGROUPED_KEY).total, 1)
  // 未归属沉底
  assert.equal(projects[projects.length - 1].key, UNGROUPED_KEY)
  // 不改入参
  assert.equal(TASKS.length, 5)
  assert.equal(arr(projects[0].tasks).length > 0, true)
})

function arr(value) { return Array.isArray(value) ? value : [] }

test('normalizeGroups：坏行丢掉、成员去重', () => {
  const groups = normalizeGroups([null, 'x', {}, { id: '', name: 'n' }, { id: 'g1', name: '  A   B ' , members: ['x', 'x', '', 1] }])
  assert.equal(groups.length, 1)
  assert.equal(groups[0].name, 'A B')
  assert.deepEqual(groups[0].members, ['x', '1'])
  assert.deepEqual(normalizeGroups('nope'), [])
})

test('groupByCustom：目录认领成员、缺失成员只提示、剩余落未分组桶', () => {
  const lanes = groupByCustom(GROUPS, TASKS, WORKSPACES)
  assert.equal(lanes.length, 2)
  const lane = lanes[0]
  assert.equal(lane.id, 'g1')
  assert.equal(lane.key, `${GROUP_PREFIX}g1`)
  assert.deepEqual(lane.projects.map((project) => project.key), ['wA'])
  assert.deepEqual(lane.missingMembers, [{ key: 'w-missing', label: '已删除的项目' }])
  assert.equal(lane.total, 2)
  assert.equal(lane.taskCount, 2)
  assert.equal(lane.projectCount, 1)
  assert.equal(lane.colorOf.wA, 0)
  const bucket = lanes[1]
  assert.equal(bucket.ungrouped, true)
  assert.equal(bucket.key, UNGROUPED_KEY)
  assert.deepEqual(bucket.projects.map((project) => project.key).sort(), ['wB', 'wF', UNGROUPED_KEY].sort())
  assert.ok(DECO_SLOTS >= 1)
})

test('groupByCustom：一个 workspace 只属于一个目录（先到先得）', () => {
  const lanes = groupByCustom([{ id: 'g1', name: 'A', members: ['wB'] }, { id: 'g2', name: 'B', members: ['wB'] }], TASKS, WORKSPACES)
  const g1 = lanes.find((lane) => lane.id === 'g1')
  const g2 = lanes.find((lane) => lane.id === 'g2')
  assert.deepEqual(g1.projects.map((project) => project.key), ['wB'])
  assert.deepEqual(g2.projects, [])
  // wB 被 g1 认领，所以未分组桶里不能再有它
  const bucket = lanes.find((lane) => lane.ungrouped === true)
  assert.equal(bucket.projects.some((project) => project.key === 'wB'), false)
})

/* ---------------- scope ---------------- */

test('scopeTasks：三态各自只给该给的任务', () => {
  assert.equal(scopeTasks(TASKS, { kind: 'all' }).length, 5)
  assert.deepEqual(scopeTasks(TASKS, { kind: 'project', id: 'wA' }).map((task) => task.id), ['a1', 'a2'])
  assert.deepEqual(scopeTasks(TASKS, { kind: 'project', id: 'nope' }), [])
  // 目录 scope：靠 groups 现算成员
  assert.deepEqual(scopeTasks(TASKS, { kind: 'group', id: 'g1' }, GROUPS).map((task) => task.id), ['a1', 'a2'])
  // 目录的成员信息也可以直接带在 scope 上（组件从树行拿）
  assert.deepEqual(scopeTasks(TASKS, { kind: 'group', id: 'g1', members: ['wA'] }).map((task) => task.id), ['a1', 'a2'])
  // 未分组桶
  assert.deepEqual(scopeTasks(TASKS, { kind: 'group', id: UNGROUPED_KEY }, GROUPS).map((task) => task.id).sort(), ['b1', 'c1', 'halt1'].sort())
})

test('lanesForScope：all 多张 / 目录恰好一张 / 项目恰好一张', () => {
  const all = lanesForScope(GROUPS, TASKS, { kind: 'all' }, WORKSPACES)
  assert.equal(all.length, 2)
  const one = lanesForScope(GROUPS, TASKS, { kind: 'group', id: 'g1' }, WORKSPACES)
  assert.equal(one.length, 1)
  assert.equal(one[0].id, 'g1')
  const project = lanesForScope(GROUPS, TASKS, { kind: 'project', id: 'wA' }, WORKSPACES)
  assert.equal(project.length, 1)
  assert.equal(project[0].singleProject, true)
  assert.deepEqual(project[0].projects.map((row) => row.key), ['wA'])
  assert.deepEqual(project[0].tasks.map((task) => task.id), ['a1', 'a2'])
  const bucket = lanesForScope(GROUPS, TASKS, { kind: 'group', id: UNGROUPED_KEY }, WORKSPACES)
  assert.equal(bucket.length, 1)
  assert.equal(bucket[0].ungrouped, true)
  // 目录被删了：没有对应的图，但不抛
  assert.deepEqual(lanesForScope(GROUPS, TASKS, { kind: 'group', id: 'gone' }, WORKSPACES), [])
})

test('scopeLabel：人话名字', () => {
  assert.equal(scopeLabel({ kind: 'all' }, GROUPS), '全部任务')
  assert.equal(scopeLabel({ kind: 'group', id: 'g1' }, GROUPS), 'QVIZ')
  assert.equal(scopeLabel({ kind: 'group', id: UNGROUPED_KEY }, GROUPS), UNGROUPED_LABEL)
  assert.equal(scopeLabel({ kind: 'project', id: 'wA' }, GROUPS), 'wA')
  assert.equal(scopeLabel({ kind: 'group', id: 'gone' }, null), 'gone')
})

/* ---------------- 树 ---------------- */

test('buildTree：三层结构（全部任务 / 目录 / 项目）', () => {
  const tree = buildTree(GROUPS, TASKS, { workspaces: WORKSPACES })
  const all = tree.byKey.all
  assert.equal(all.kind, 'all')
  assert.equal(all.depth, 0)
  assert.equal(all.count, 5)
  assert.equal(all.done, 1)
  assert.equal(all.blocked, 1)
  assert.equal(all.suspended, 1)
  assert.equal(all.open, 4)

  const group = tree.byKey[`${GROUP_PREFIX}g1`]
  assert.equal(group.kind, 'group')
  assert.equal(group.depth, 1)
  assert.equal(group.label, 'QVIZ')
  assert.equal(group.count, 1)
  assert.deepEqual(group.members, ['wA', 'w-missing'])
  assert.equal(group.missing, 1)

  const project = tree.byKey['project:wA']
  assert.equal(project.kind, 'project')
  assert.equal(project.depth, 2)
  assert.equal(project.groupId, 'g1')
  assert.equal(project.groupLabel, 'QVIZ')
  assert.equal(project.count, 2)
  assert.equal(project.path, '/Users/kp/DEV/alpha')

  const bucket = tree.byKey[`${GROUP_PREFIX}${UNGROUPED_KEY}`]
  assert.equal(bucket.ungrouped, true)
  assert.equal(tree.byKey['project:wB'].groupId, UNGROUPED_KEY)
  assert.equal(tree.byKey['project:wF'].count, 0)

  // rows 是可见扁平行，顺序 = 深度优先
  assert.deepEqual(tree.rows.map((row) => row.key), [
    'all',
    `${GROUP_PREFIX}g1`,
    'project:wA',
    `${GROUP_PREFIX}${UNGROUPED_KEY}`,
    ...tree.rows.slice(4).map((row) => row.key),
  ])
  assert.equal(tree.rows.length, tree.rows.filter((row) => row.depth <= 2).length)
  assert.equal(tree.scope.kind, 'all')
  assert.equal(tree.selected.key, 'all')
})

test('buildTree：折叠不进 rows，但 byKey 与选中项都还在', () => {
  const collapsed = { [GROUP_PREFIX + 'g1']: true }
  const tree = buildTree(GROUPS, TASKS, {
    collapsed,
    selection: { kind: 'project', id: 'wA' },
    workspaces: WORKSPACES,
  })
  assert.equal(tree.rows.some((row) => row.key === 'project:wA'), false)
  assert.ok(tree.byKey['project:wA'], 'byKey 必须保留折叠掉的子行')
  assert.ok(tree.selected, '选中项被折叠也不能丢')
  assert.equal(tree.selected.key, 'project:wA')
  assert.equal(tree.selected.selected, true)
  assert.equal(tree.byKey[GROUP_PREFIX + 'g1'].collapsed, true)
  assert.equal(tree.byKey[GROUP_PREFIX + 'g1'].selected, false)

  // 全部任务折叠 → 只剩 root 行
  const hidden = buildTree(GROUPS, TASKS, { collapsed: { all: true }, workspaces: WORKSPACES })
  assert.deepEqual(hidden.rows.map((row) => row.key), ['all'])
  assert.equal(Object.keys(hidden.byKey).length > 3, true)
  assert.equal(hidden.byKey['project:wA'].selected, false)
})

test('buildTree：scope 选中态落在对应行上', () => {
  const group = buildTree(GROUPS, TASKS, { selection: { kind: 'group', id: 'g1' }, workspaces: WORKSPACES })
  assert.equal(group.selected.key, `${GROUP_PREFIX}g1`)
  assert.equal(group.byKey[`${GROUP_PREFIX}g1`].selected, true)
  const bucket = buildTree(GROUPS, TASKS, { selection: { kind: 'group', id: UNGROUPED_KEY }, workspaces: WORKSPACES })
  assert.equal(bucket.selected.key, `${GROUP_PREFIX}${UNGROUPED_KEY}`)
  const project = buildTree(GROUPS, TASKS, { selection: { kind: 'project', id: 'wB' }, workspaces: WORKSPACES })
  assert.equal(project.selected.key, 'project:wB')
  assert.equal(project.byKey['project:wB'].selected, true)
})

test('buildTree：空输入 / 坏输入不抛', () => {
  const empty = buildTree(null, null, undefined)
  assert.deepEqual(empty.rows.map((row) => row.key), ['all'])
  assert.equal(empty.byKey.all.count, 0)
  assert.equal(empty.selected.key, 'all')
  const broken = buildTree([{ id: '' }, { id: 1 }, null], [null, 42, { id: 'x' }, { id: 'y', workspaceKey: 7 }], { collapsed: null, selection: 'nope', workspaces: 'nope' })
  assert.ok(broken.rows.some((row) => row.key === `project:${UNGROUPED_KEY}`), '没写 workspace 的任务落未归属项目')
  assert.ok(broken.rows.some((row) => row.key === 'project:7'), 'workspaceKey 是数字也要能当 key')
  assert.equal(broken.scope.kind, 'all')
  assert.equal(buildTree(GROUPS, TASKS, { collapsed: 'x', selection: { kind: 'group', id: 'g1' } }).selected.key, `${GROUP_PREFIX}g1`)
})

/* ---------------- 右键菜单 ---------------- */

test('rowMenu：全部任务行只有刷新', () => {
  assert.deepEqual(rowMenu({ kind: 'all' }, GROUPS, { kind: 'all' }), [{ id: 'refresh', label: '刷新', kind: 'item' }])
})

test('rowMenu：目录行 = 重命名 / 删除 / 分隔线 / 新建目录', () => {
  const items = rowMenu({ kind: 'group', id: 'g1' }, GROUPS, { kind: 'group', id: 'g1' })
  assert.deepEqual(items.map((item) => item.kind), ['item', 'item', 'separator', 'item'])
  assert.deepEqual(items.filter((item) => item.kind === 'item').map((item) => item.id), ['rename', 'delete', 'new-group'])
  assert.equal(items[1].danger, true)
  assert.equal(items[1].groupId, 'g1')
  assert.deepEqual(rowMenu({ kind: 'group', id: UNGROUPED_KEY, ungrouped: true }, GROUPS, { kind: 'all' }), [
    { id: 'new-group', label: '新建目录', kind: 'item' },
  ])
})

test('rowMenu：项目行 = 移入目录 ▸ / 移出目录 / 只看这个项目', () => {
  const items = rowMenu({ kind: 'project', id: 'wA' }, GROUPS, { kind: 'all' })
  assert.deepEqual(items.map((item) => item.kind), ['item', 'item', 'separator', 'item'])
  assert.deepEqual(items.filter((item) => item.kind === 'item').map((item) => item.id), ['move', 'remove', 'focus'])
  const move = items[0]
  assert.ok(Array.isArray(move.submenu))
  const submenuItems = move.submenu.filter((item) => item.kind === 'item')
  assert.deepEqual(submenuItems.map((item) => item.id), ['move:g1', 'move-new'])
  assert.equal(submenuItems[0].checked, true, '已在 g1 里的项目必须打勾')
  assert.equal(submenuItems[0].disabled, true)
  assert.equal(move.submenu[1].kind, 'separator')
  assert.equal(items[1].disabled, false)
  assert.equal(items[3].checked, false)

  // 不在任何目录里：移出目录禁用
  const loose = rowMenu({ kind: 'project', id: 'wB' }, GROUPS, { kind: 'project', id: 'wB' })
  assert.equal(loose[1].disabled, true)
  assert.equal(loose[0].submenu[0].checked, false)
  assert.equal(loose[3].checked, true, 'scope 已经是这个项目 → 菜单打勾')

  // 没有目录时：submenu 只剩「新建目录并移入…」
  const none = rowMenu({ kind: 'project', id: 'wA' }, [], { kind: 'all' })
  assert.deepEqual(none[0].submenu.filter((item) => item.kind === 'item').map((item) => item.id), ['move-new'])
})

test('rowMenu：坏输入不抛', () => {
  assert.deepEqual(rowMenu(null, null, null), [])
  assert.deepEqual(rowMenu({ kind: 'nope' }, 'x', 1), [])
  assert.deepEqual(rowMenu({ kind: 'group', id: 'g1' }, [{ id: '' }], { kind: 'group', id: 'g1' }).length, 4)
})

/* ---------------- 统计 ---------------- */

test('statsOf：计数口径与坏输入', () => {
  const stats = statsOf(TASKS, RELATIONS)
  assert.equal(stats.tasks, 5)
  assert.equal(stats.done, 1)
  assert.equal(stats.open, 4)
  assert.equal(stats.blocked, 1)
  assert.equal(stats.suspended, 1)
  assert.equal(stats.ready, 2)
  assert.equal(stats.dependencyEdges, 2)
  assert.equal(stats.provenanceEdges, 1)
  assert.equal(stats.externalEdges, 1)
  assert.equal(stats.missingGhosts, 1)
  assert.equal(stats.crossProject, 1)
  assert.equal(stats.projects, 3)
  assert.equal(stats.groups, 3)
  // 两端都不在这批任务里的边跟这批任务无关，不能计进来（否则目录的边数会比图上多）
  const scoped = statsOf(TASKS, [...RELATIONS, { from: 'x1', to: 'x2', kind: 'depends_on' }, { from: 'x1', to: 'a1', kind: 'depends_on' }])
  assert.equal(scoped.dependencyEdges, 3)
  assert.equal(scoped.externalEdges, 2)
  assert.equal(scoped.missingGhosts, 2)
  assert.equal(statsOf(TASKS.slice(0, 2), RELATIONS).dependencyEdges, 2)
  const empty = statsOf(undefined, 'nope')
  assert.equal(empty.tasks, 0)
  assert.equal(empty.groups, 0)
  assert.equal(statsOf([null, 1, {}], []).tasks, 0)
})

test('projectKeysOf：去重保序', () => {
  assert.deepEqual(projectKeysOf(TASKS), ['wA', 'wB', UNGROUPED_KEY])
  assert.deepEqual(projectKeysOf(null), [])
})

/* ---------------- 汇总 ---------------- */

console.log(`\noverview/model.js: ${passed} passed, ${failures.length} failed`)
if (failures.length) {
  for (const failure of failures) console.error(`- ${failure.name}`)
  process.exit(1)
}
