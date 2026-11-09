/**
 * overview.html 的纯函数布局层测试。
 *
 * 抽取风格照 test/filterPanel.mjs：把 <script> 全部拼起来做 vm.Script 语法检查，
 * 再按 OVERVIEW_LAYOUT:START/END 标记截出纯函数块，丢进 vm 上下文单跑。
 * 覆盖：分组、节点/边数量、缺失前驱 ghost、长标题截断、空输入不抛、筛选。
 */
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import vm from 'node:vm'

const html = await readFile(new URL('../overview.html', import.meta.url), 'utf8')

/* ---------- 1. 内联脚本语法检查 ---------- */
const blocks = [...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)].map((m) => m[1])
assert.ok(blocks.length >= 3, `期望至少 3 个内联脚本块（主题引导/布局/UI），实际 ${blocks.length}`)
const script = blocks.join('\n')
new vm.Script(script)

/* ---------- 2. 页面卫生：自包含、只读、不用官方私有类名 ---------- */
assert.match(html, /var OVERVIEW_LAYOUT = \(function \(\) \{/) // 硬要求：暴露形式
assert.doesNotMatch(html, /<iframe\b/i, '不得用 iframe')
assert.doesNotMatch(html, /(?:src|href)\s*=\s*["']https?:/i, '不得引外链资源/CDN')
assert.doesNotMatch(script, /\.dsw-[a-z0-9-]+\s*[{,]/i, '不得拿官方私有 class 名做选择器')
assert.doesNotMatch(script, /querySelector(?:All)?\([^)]*dsw-/i, '不得用官方私有 class 名查询')
assert.match(script, /var STATE_URL = '\/dsh-feishu\/api\/state'/)
assert.doesNotMatch(script, /method:\s*['"]POST/i, '本页只读，不得有写操作')
assert.doesNotMatch(script, /\/dsh-feishu\/api\/(?!state)/, '除 /api/state 外不得请求别的接口')
assert.match(script, /title: node\.fullTitle/, '卡片 title 属性要保留全文')
assert.match(script, /data\.type === 'dsh-feishu:theme'/, '要响应宿主 postMessage 主题切换')
assert.match(script, /\[\?&\]theme=/, '要支持 ?theme=dark|light')

/* ---------- 3. 抽出纯函数块 ---------- */
const START = '/* OVERVIEW_LAYOUT:START'
const END = '/* OVERVIEW_LAYOUT:END */'
const from = script.indexOf(START)
const to = script.indexOf(END)
assert.ok(from >= 0 && to > from, '找不到 OVERVIEW_LAYOUT 标记')
const plain = (x) => JSON.parse(JSON.stringify(x)) // vm 里的数组/对象跨 realm，深比较前先降级
const context = vm.createContext({})
vm.runInContext(script.slice(from, to), context)
const L = context.OVERVIEW_LAYOUT
assert.ok(L && typeof L === 'object', 'OVERVIEW_LAYOUT 未暴露')

for (const fn of ['truncateTitle', 'measure', 'workspaceOf', 'blockedOf', 'stateOf',
  'normalizeEdges', 'groupTasks', 'nodeOf', 'ghostNode', 'titleHints', 'layout', 'statsOf',
  'filterTasks', 'indexNodes', 'taskNo', 'taskLabel']) {
  assert.equal(typeof L[fn], 'function', `缺导出函数 ${fn}`)
}

/* ---------- 4. 固件 ---------- */
const it = (id, title) => ({ id, title, done: false })
const tasks = [
  {
    id: 't1', no: 1, title: '搭好插件骨架并跑通同步', done: true,
    workspaceId: 'w1', workspaceTitle: 'DSH 插件开发', workspacePath: '/Users/kp/DEV/dsh-plugins',
    relations: { predecessors: [], successors: [it('t2', '写关系图视图')], sourceTasks: [], derivedTasks: [], blockedBy: [], ready: true },
  },
  {
    id: 't2', no: 2, title: '写关系图视图：节点=任务 边=关系 缺前驱画 ghost', done: false,
    workspaceId: 'w1', workspaceTitle: 'DSH 插件开发',
    relations: { predecessors: [it('t1', '骨架')], successors: [it('t3', '集成')], sourceTasks: [], derivedTasks: [], blockedBy: [], ready: true },
  },
  {
    id: 't3', no: 3, title: '集成到左侧栏 tab', done: false,
    workspaceId: 'w1', workspaceTitle: 'DSH 插件开发',
    relations: {
      predecessors: [it('t2', '写关系图视图'), it('d1', '文档')],
      successors: [{ id: 't9', title: '外部清单的排期任务', done: false }],
      sourceTasks: [it('t1', '骨架')], derivedTasks: [],
      blockedBy: [it('t2', '写关系图视图')], ready: false,
    },
  },
  {
    id: 'd1', no: 4, title: '写文档', done: false,
    workspaceId: 'w2', workspaceTitle: '文档站', workspacePath: '/Users/kp/DEV/docs',
    relations: { predecessors: [], successors: [it('t3', '集成')], sourceTasks: [], derivedTasks: [], blockedBy: [], ready: true },
  },
  // 无 workspace、无 title：必须落到「未归属项目」且不抛
  { id: 'u1', no: 0, title: undefined, meta: { workspace: '' }, relations: { ready: true } },
]
const relations = [
  { from: 't1', to: 't2', kind: 'depends_on', source: 'manual' },
  { from: 't2', to: 't3', kind: 'depends_on', source: 'ai' },
  { from: 't1', to: 't3', kind: 'derived_from', source: 'creation' },
  { from: 'd1', to: 't3', kind: 'depends_on', source: 'manual' },   // 跨项目
  { from: 't3', to: 't9', kind: 'depends_on', source: 'manual' },   // 指向不存在的任务
  { from: 't1', to: 't2', kind: 'depends_on', source: 'manual' },   // 重复
  { from: 't2', to: 't2', kind: 'depends_on' },                     // 自环
  { from: 't1', to: 't2', kind: 'whatever' },                        // 非法 kind
  { kind: 'depends_on' },                                            // 缺端点
  null, 'nope',
]

/* ---------- 5. 边规整 ---------- */
const edges = L.normalizeEdges(relations)
assert.equal(edges.length, 5, '重复/自环/非法边要丢掉')
assert.deepEqual(plain(edges.map((e) => `${e.from}>${e.to}:${e.kind}`)), [
  't1>t2:depends_on', 't2>t3:depends_on', 't1>t3:derived_from', 'd1>t3:depends_on', 't3>t9:depends_on',
])

/* ---------- 6. 分组 ---------- */
const groups = L.groupTasks(tasks)
assert.deepEqual(plain(groups.map((g) => g.label)), ['DSH 插件开发', '文档站', '未归属项目'], '未归属项目沉底')
assert.deepEqual(plain(groups.map((g) => g.total)), [3, 1, 1])
assert.equal(groups[0].open, 2)
assert.equal(groups[0].done, 1)
assert.equal(groups[0].blocked, 1)
assert.equal(L.workspaceOf(tasks[4]).label, L.constants.UNGROUPED_LABEL)
assert.equal(L.workspaceOf({ workspacePath: '/a/b/c/' }).label, 'c', '没名字时用目录名兜底')

/* ---------- 7. 长标题截断 ---------- */
const short = L.truncateTitle('写文档')
assert.deepEqual(plain(short), { text: '写文档', full: '写文档', truncated: false })
const long = L.truncateTitle('写关系图视图：节点=任务 边=关系 缺前驱画 ghost', L.constants.TITLE_WIDTH)
assert.equal(long.truncated, true)
assert.ok(long.text.endsWith(L.constants.ELLIPSIS))
assert.equal(long.full, '写关系图视图：节点=任务 边=关系 缺前驱画 ghost', 'fullTitle 必须保留全文')
assert.ok(L.measure(long.text) <= L.constants.TITLE_WIDTH + 1e-9, '截断后视觉宽度不得超过预算')
assert.equal(L.truncateTitle(' 很多   空白 ').text, '很多 空白', '空白要折叠')

/* ---------- 8. 节点形状 ---------- */
const node = L.nodeOf(tasks[2])
for (const key of ['id', 'label', 'no', 'done', 'workspace', 'x', 'y', 'w', 'h', 'refs']) {
  assert.ok(key in node, `node 缺字段 ${key}`)
}
assert.equal(node.id, 't3')
assert.equal(node.workspace, 'w1')
assert.equal(node.state, 'blocked')
assert.equal(node.blocked, true)
assert.equal(node.ready, false)
assert.equal(node.truncated, false, '短标题不截断')
assert.equal(node.label, '集成到左侧栏 tab')
const longNode = L.nodeOf(tasks[1])
assert.equal(longNode.truncated, true, '长标题节点必须被截断')
assert.equal(longNode.fullTitle, '写关系图视图：节点=任务 边=关系 缺前驱画 ghost', 'node.fullTitle 保留全文')
assert.match(String(longNode.label), /…$/)
assert.equal(node.w, L.constants.NODE_W)
assert.equal(node.refs.blockedBy.length, 1)
assert.equal(L.nodeOf({ id: 'x' }).state, 'open')
assert.equal(L.nodeOf({ id: 'x', done: true }).state, 'done')
assert.equal(L.nodeOf({ id: 'x', suspension: { active: true } }).state, 'suspended')
assert.equal(L.taskLabel({ id: 'abcdefghij' }), 'abcdefgh', '没有编号时用 id 前缀')

/* ---------- 9. 布局：分组 + 节点/边数量 ---------- */
const model = L.layout(tasks, relations)
assert.equal(model.groups.length, 3)
const byKey = Object.fromEntries(model.groups.map((g) => [g.key, g]))

// w1：3 个任务节点 + 2 个 ghost（d1 跨项目前驱、t9 缺失后置）
assert.equal(byKey.w1.taskNodes.length, 3)
assert.equal(byKey.w1.ghosts.length, 2)
assert.equal(byKey.w1.nodes.length, 5)
assert.equal(byKey.w1.edges.length, 5, 'w1 里 5 条边都该画出来')
// w2：1 个任务 + 1 个跨项目 ghost（t3）
assert.equal(byKey.w2.taskNodes.length, 1)
assert.equal(byKey.w2.nodes.length, 2)
assert.equal(byKey.w2.edges.length, 1)
// 未归属：单节点无边
assert.equal(byKey[L.constants.UNGROUPED_KEY].nodes.length, 1)
assert.equal(byKey[L.constants.UNGROUPED_KEY].edges.length, 0)

// 全量统计
assert.equal(model.nodes.length, 8)
assert.equal(model.edges.length, 6)
assert.equal(model.stats.tasks, 5)
assert.equal(model.stats.done, 1)
assert.equal(model.stats.open, 4)
assert.equal(model.stats.blocked, 1)
assert.equal(model.stats.ready, 3)
assert.equal(model.stats.dependencyEdges, 4)
assert.equal(model.stats.provenanceEdges, 1)
assert.equal(model.stats.crossProject, 1)
assert.equal(model.stats.groups, 3)
assert.equal(model.stats.ghosts, 3)
assert.equal(model.stats.missingGhosts, 1)

/* ---------- 10. ghost 节点 ---------- */
const missing = model.nodes.find((n) => n.id === 't9')
assert.ok(missing, '指向不存在任务的边要画成 ghost')
assert.equal(missing.ghost, true)
assert.equal(missing.missing, true, '任务表里没有 → missing')
assert.equal(missing.role, 'successor')
assert.equal(missing.workspace, 'w1', 'ghost 归属它所在的分组')
assert.equal(missing.label, '外部清单的排期任务', '缺失任务只在关系摘要里留了标题，也要捡回来用')
assert.equal(L.titleHints(tasks).get('t9'), '外部清单的排期任务')
assert.equal(L.ghostNode('nobody', 'lane', new Map(), 'predecessor').label, 'nobody', '没有任何线索时退回 id')
assert.equal(Object.keys(plain(L.titleHints(null))).length, 0)
const crossGhost = byKey.w1.nodes.find((n) => n.id === 'd1')
assert.equal(crossGhost.ghost, true)
assert.equal(crossGhost.missing, false, '任务存在、只是属于别的项目 → 不算缺失')
assert.equal(crossGhost.fullTitle, '写文档')
const w2Ghost = byKey.w2.nodes.find((n) => n.id === 't3')
assert.equal(w2Ghost.ghost, true)
assert.equal(w2Ghost.missing, false)
// ghost 键在同一分组内不冲突，且与真实节点键区分
assert.equal(new Set(model.nodes.map((n) => n.key)).size, model.nodes.length, 'node.key 全局唯一')

/* ---------- 11. 分层几何 ---------- */
const PAD = L.constants.PAD
const pitchX = L.constants.NODE_W + L.constants.GAP_X
for (const laneKey of Object.keys(byKey)) {
  const lane = byKey[laneKey]
  // 列号必须从 0 连续排到底：ghost 撑出来的空洞不能在画布上留白
  const columns = [...new Set(lane.nodes.map((n) => n.column))].sort((a, b) => a - b)
  assert.deepEqual(plain(columns), columns.map((_, i) => i), `${laneKey} 列号要连续`)
  for (const n of lane.nodes) {
    assert.equal(n.x, PAD + n.column * pitchX, `${laneKey} ${n.id} 的 x 应只由列号决定`)
    assert.ok(n.x >= 0 && n.y >= 0)
    assert.ok(n.x + n.w <= lane.width, '节点不能超出画布宽')
    assert.ok(n.y + n.h <= lane.height, '节点不能超出画布高')
  }
  // 同列不重叠
  const byDepth = new Map()
  for (const n of lane.nodes) {
    if (!byDepth.has(n.column)) byDepth.set(n.column, [])
    byDepth.get(n.column).push(n)
  }
  for (const column of byDepth.values()) {
    const sorted = column.slice().sort((a, b) => a.y - b.y)
    for (let i = 1; i < sorted.length; i += 1) {
      assert.ok(sorted[i].y >= sorted[i - 1].y + sorted[i - 1].h, '同列节点不得重叠')
    }
  }
  for (const e of lane.edges) {
    assert.match(e.path, /^M-?\d+ -?\d+ H-?\d+ V-?\d+ H-?\d+$/, '边必须是正交路径')
    assert.ok(lane.nodes.some((n) => n.key === e.fromKey), '边起点必须是本组节点')
    assert.ok(lane.nodes.some((n) => n.key === e.toKey), '边终点必须是本组节点')
  }
  assert.ok(lane.width > 0 && lane.height > 0)
}

// 前置必须排在后置左边
const t1 = byKey.w1.taskNodes.find((n) => n.id === 't1')
const t2 = byKey.w1.taskNodes.find((n) => n.id === 't2')
const t3 = byKey.w1.taskNodes.find((n) => n.id === 't3')
assert.ok(t1.x < t2.x && t2.x < t3.x, '依赖链要从左到右铺开')
assert.ok(byKey.w1.nodes.find((n) => n.id === 'd1').x < t3.x, 'ghost 前驱要在目标左侧')
assert.ok(byKey.w1.nodes.find((n) => n.id === 't9').x > t3.x, 'ghost 后置要在目标右侧')

/* ---------- 12. 空输入 / 坏输入不抛 ---------- */
for (const bad of [undefined, null, [], {}, 'nope', 0, [null, undefined, 42, {}], [tasks[0], null]]) {
  const out = L.layout(bad, bad)
  assert.ok(out && Array.isArray(out.groups) && Array.isArray(out.nodes) && Array.isArray(out.edges))
  assert.equal(typeof out.stats.tasks, 'number')
}
assert.deepEqual(plain(L.layout(undefined, undefined).stats), {
  tasks: 0, open: 0, done: 0, blocked: 0, ready: 0,
  dependencyEdges: 0, provenanceEdges: 0,
  ghosts: 0, missingGhosts: 0, crossProject: 0, groups: 0,
})
assert.deepEqual(plain(L.groupTasks(null)), [])
assert.deepEqual(plain(L.normalizeEdges('nope')), [])
assert.deepEqual(plain(L.filterTasks(null)), [])
assert.deepEqual(plain(L.truncateTitle(undefined)), { text: '', full: '', truncated: false })
assert.equal(L.nodeOf(null).id, '')
assert.equal(L.ghostNode('zz', 'lane', new Map(), 'predecessor').missing, true)
assert.equal(L.ghostNode('zz', 'lane', new Map(), 'predecessor').label, 'zz')
assert.equal(L.statsOf(null, null).tasks, 0)
// 只算两端都可见的边：筛选到单项目时数字要跟着动
const w2only = L.statsOf(tasks.filter((t) => t.workspaceId === 'w2'), relations, { onlyVisible: true })
assert.equal(w2only.tasks, 1)
assert.equal(w2only.dependencyEdges, 0, 'w2 里没有两端都可见的依赖边')
assert.equal(L.statsOf(tasks, relations).dependencyEdges, 4, '默认口径：数所有有效边（含指向缺失任务的）')
assert.equal(L.statsOf(tasks, relations, { onlyVisible: true }).dependencyEdges, 3, 'onlyVisible：t3→t9 的端点不可见，不算')
const w1only = L.statsOf(tasks.filter((t) => t.workspaceId === 'w1'), relations, { onlyVisible: true })
assert.equal(w1only.tasks, 3)
assert.equal(w1only.dependencyEdges, 2, 'w1 内部：t1→t2、t2→t3')
assert.equal(w1only.missingGhosts, 0, 'onlyVisible 下缺失端点不算进来')
assert.equal(w1only.blocked, 1)
assert.equal(w1only.ready, 1)
assert.equal(L.blockedOf({ relations: null }), false, 'relations 缺失时按不阻塞处理')
assert.equal(L.blockedOf({ done: true, relations: { ready: false } }), false, '完成的任务不算阻塞')

// 环 + 自我依赖不能死循环，也不能抛
const cyc = [
  { id: 'a', no: 1, title: 'a', workspaceId: 'w', workspaceTitle: 'W', relations: { ready: false } },
  { id: 'b', no: 2, title: 'b', workspaceId: 'w', workspaceTitle: 'W', relations: { ready: false } },
]
const cycModel = L.layout(cyc, [
  { from: 'a', to: 'b', kind: 'depends_on' },
  { from: 'b', to: 'a', kind: 'depends_on' },
])
assert.equal(cycModel.nodes.length, 2)
assert.equal(cycModel.stats.dependencyEdges, 2)
for (const n of cycModel.nodes) assert.ok(Number.isFinite(n.x) && Number.isFinite(n.y))

// 重复任务 id 只保留一个任务节点
const dup = L.layout([{ id: 'a', no: 1, title: 'a' }, { id: 'a', no: 1, title: 'a' }], [])
assert.equal(dup.stats.tasks, 2)
assert.equal(dup.groups[0].taskNodes.length, 2, '分组保留原始行数（由 host 去重）')

/* ---------- 13. 筛选 ---------- */
const ids = (list) => list.map((t) => t.id).join(',')
assert.equal(ids(L.filterTasks(tasks, {})), 't1,t2,t3,d1,u1')
assert.equal(ids(L.filterTasks(tasks, { workspaces: ['w1'] })), 't1,t2,t3')
assert.equal(ids(L.filterTasks(tasks, { workspaces: ['文档站'] })), 'd1', 'chip 也可以用名字匹配')
assert.equal(ids(L.filterTasks(tasks, { workspaces: [L.constants.UNGROUPED_KEY] })), 'u1')
assert.equal(ids(L.filterTasks(tasks, { workspaces: ['w1', 'w2'] })), 't1,t2,t3,d1')
assert.equal(ids(L.filterTasks(tasks, { status: 'all' })), 't1,t2,t3,d1,u1')
assert.equal(ids(L.filterTasks(tasks, { status: 'open' })), 't2,t3,d1,u1')
assert.equal(ids(L.filterTasks(tasks, { status: 'done' })), 't1')
assert.equal(ids(L.filterTasks(tasks, { status: 'blocked' })), 't3')
assert.equal(ids(L.filterTasks(tasks, { status: 'ready' })), 't2,d1,u1')
assert.equal(ids(L.filterTasks(tasks, { keyword: 't2' })), 't2')
assert.equal(ids(L.filterTasks(tasks, { keyword: '#2' })), 't2')
assert.equal(ids(L.filterTasks(tasks, { keyword: '写文档' })), 'd1')
assert.equal(ids(L.filterTasks(tasks, { keyword: '  GHOST  ' })), 't2', '关键字要 trim + 忽略大小写')
assert.equal(ids(L.filterTasks(tasks, { workspaces: ['w1'], status: 'blocked', keyword: '集成' })), 't3')
assert.equal(ids(L.filterTasks(tasks, { workspaces: ['nope'] })), '')
assert.equal(ids(L.filterTasks(tasks, { status: '不存在' })), 't1,t2,t3,d1,u1', '未知状态＝不过滤')

/* ---------- 14. id → 节点索引 ---------- */
const index = L.indexNodes(model)
assert.equal(index.t1.ghost, false)
assert.equal(index.d1.key, 'task:d1', '真实节点优先于 ghost')
assert.equal(index.t9.ghost, true)
assert.equal(Object.keys(L.indexNodes(null)).length, 0)

console.log('ok overview.html：布局纯函数 ' + Object.keys(L).length + ' 项导出，'
  + model.nodes.length + ' 节点 / ' + model.edges.length + ' 边 / '
  + model.groups.length + ' 分组全部通过断言')
