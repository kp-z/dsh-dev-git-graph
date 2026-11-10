/**
 * overview.html 的纯函数布局层测试。
 *
 * 抽取风格照 test/filterPanel.mjs：把 <script> 全部拼起来做 vm.Script 语法检查，
 * 再按 OVERVIEW_LAYOUT:START/END 标记截出纯函数块，丢进 vm 上下文单跑。
 * 覆盖：分组、节点/边数量、缺失前驱 ghost、长标题截断、空输入不抛、筛选、
 * 「自定义目录」分组（用户把若干 workspace 拖成一组 → 一组一张图），
 * 以及左栏那棵 VSCode 式三层树与 scope（全部任务 / 目录 / 项目）对应的画布数。
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

/* ---------- 2. 页面卫生：自包含、只写自定义目录、不用官方私有类名 ---------- */
assert.match(html, /var OVERVIEW_LAYOUT = \(function \(\) \{/) // 硬要求：暴露形式
assert.doesNotMatch(html, /<iframe\b/i, '不得用 iframe')
assert.doesNotMatch(html, /(?:src|href)\s*=\s*["']https?:/i, '不得引外链资源/CDN')
assert.doesNotMatch(script, /\.dsw-[a-z0-9-]+\s*[{,]/i, '不得拿官方私有 class 名做选择器')
assert.doesNotMatch(script, /querySelector(?:All)?\([^)]*dsw-/i, '不得用官方私有 class 名查询')
assert.match(script, /var STATE_URL = '\/dsh-feishu\/api\/state'/)
assert.match(script, /var GROUPS_URL = '\/dsh-feishu\/api\/workspace-groups'/, '自定义目录是唯一写接口')
/* 总览页只写「自定义目录」这一个接口：POST 只允许出现在 saveGroups 里一处。 */
const posts = script.match(/method:\s*['"]POST['"]/g) || []
assert.equal(posts.length, 1, '页面只允许一个写接口调用')
assert.doesNotMatch(script, /method:\s*['"](?:PUT|PATCH|DELETE)['"]/i, '不得有别的写方法')
assert.doesNotMatch(script, /\/dsh-feishu\/api\/(?!state|workspace-groups)/, '除 state 与 workspace-groups 外不得请求别的接口')
assert.match(script, /title: node\.fullTitle/, '卡片 title 属性要保留全文')
assert.match(script, /data\.type === 'dsh-feishu:theme'/, '要响应宿主 postMessage 主题切换')
assert.match(script, /\[\?&\]theme=/, '要支持 ?theme=dark|light')

/* 目录成员关系不存本地（以宿主为准），只有「选中项 / 展开 / 搜索」这类视图状态落 localStorage。 */
assert.match(script, /STORE_PREFIX = 'dsh-feishu-overview:'/, '视图状态用固定前缀键')
assert.match(script, /STORE_SELECTION/)
assert.match(script, /STORE_TREE/)
assert.match(script, /STORE_KEYWORD/)
assert.doesNotMatch(script, /localStorage\.setItem\([^)]*member/i, '成员关系不得写 localStorage')

/* 左栏只有一棵树：不许再有 chip 墙 / 分段控件 / 状态筛选 / 统计卡 / 图标例。 */
assert.doesNotMatch(html, /ov-chip/, '左栏不得再有 chip')
assert.doesNotMatch(html, /ov-status|ov-groupBy|ov-stats|ovMoveSelect|ovWorkspaceChips/, '旧的筛选标签堆必须删干净')
assert.match(html, /id="ovTree"[^>]*role="tree"/, '左栏就是一棵 role=tree 的树')
assert.match(script, /role: 'treeitem'/, '树行必须是 treeitem')
assert.match(script, /L\.normScope|normScope/, '要用纯函数的 scope 归一化')

/* 树的键盘路径 + 拖拽路径都要有（不能只做鼠标）。 */
for (const key of ['ArrowDown', 'ArrowUp', 'ArrowLeft', 'ArrowRight', 'Enter']) {
  assert.ok(script.includes("'" + key + "'"), `键盘要支持 ${key}`)
}
assert.match(script, /draggable', 'true'/, '项目行要可拖')
assert.match(script, /addEventListener\('drop'/, '目录行要能接收拖放')
assert.match(script, /role: 'alert'/, '写失败要以 role=alert 显示')

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
  'filterTasks', 'indexNodes', 'taskNo', 'taskLabel',
  'dirOf', 'shortenPath', 'normalizeCustomGroups', 'groupByCustom',
  'normScope', 'lanesForScope', 'buildTree']) {
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

/* ---------- 15. 路径显示工具（不再作为分组依据，但芯片与缺失成员还要用） ---------- */
assert.equal(L.dirOf('/Users/kp/DEV/dsh-plugins'), '/Users/kp/DEV')
assert.equal(L.dirOf('/Users/kp/DEV/dsh-plugins/'), '/Users/kp/DEV')
assert.equal(L.dirOf('/a'), '/')
assert.equal(L.dirOf('solo'), '')
assert.equal(L.dirOf(''), '')
assert.equal(L.dirOf(null), '')
assert.equal(L.shortenPath('/Users/kp/DEV'), '~/DEV')
assert.equal(L.shortenPath('/home/me/x/y'), '~/x/y')
assert.equal(L.shortenPath('/opt/data'), '/opt/data')
assert.equal(L.shortenPath(''), '')

/* ---------- 16. 自定义目录快照规整 ---------- */
assert.deepEqual(plain(L.normalizeCustomGroups(null)), [])
assert.deepEqual(plain(L.normalizeCustomGroups('nope')), [])
assert.deepEqual(plain(L.normalizeCustomGroups([null, 1, 'x', {}, { id: '' }, { id: 'a' }])), [], '没有 id / 名字的目录丢掉')
const norm = L.normalizeCustomGroups([
  { id: 'g1', name: '  QV   后端 ', members: ['wa', 'wa', '', 'wb'], labels: { wa: 'A项目' } },
  { id: 'g1', name: '重复 id' },
  { id: 'g2', name: 'MvizLite', members: null },
])
assert.deepEqual(plain(norm.map((g) => [g.id, g.name, g.members])), [
  ['g1', 'QV 后端', ['wa', 'wb']],
  ['g2', 'MvizLite', []],
], '空白折叠、成员去重保序、重复 id 只留一个')
assert.deepEqual(plain(norm[0].labels), { wa: 'A项目' })

/* ---------- 17. 按自定义目录分组：一组一张图 ---------- */
const wt = (id, title, ws, done) => ({
  id, title, done: done === true,
  workspaceId: ws.id, workspaceTitle: ws.title, workspacePath: ws.path || '',
  relations: { predecessors: [], successors: [], sourceTasks: [], derivedTasks: [], blockedBy: [], ready: true },
})
const A = { id: 'wa', title: 'A项目', path: '/Users/kp/DEV/a' }
const B = { id: 'wb', title: 'B项目', path: '/Users/kp/DEV/b' }
const C = { id: 'wc', title: 'C项目', path: '/Users/kp/DEV/c' }
const D = { id: 'wd', title: 'D项目', path: '/Users/kp/OTHER/d' }
const ctasks = [
  wt('a1', 'A 的前置', A, true),
  wt('a2', 'A 的后置', A),
  wt('b1', 'B 的任务', B),
  wt('c1', 'C 的任务', C),
  wt('d1', 'D 的任务', D),
]
const cedges = [
  { from: 'a1', to: 'a2', kind: 'depends_on' },   // 同项目
  { from: 'b1', to: 'a1', kind: 'depends_on' },   // 同目录跨项目 → 直接连，不画 ghost
  { from: 'c1', to: 'a1', kind: 'depends_on' },   // 跨目录 → ghost 锚点
  { from: 'a2', to: 'nope', kind: 'depends_on' }, // 缺失 → ghost
]
const defs = [
  { id: 'g1', name: 'QV', members: ['wa', 'wb', 'wz-gone'], labels: { 'wz-gone': '老项目' }, presentMembers: 2 },
  { id: 'g2', name: 'MvizLite', members: ['wc'], labels: {}, presentMembers: 1 },
]
const cmodel = L.layout(ctasks, cedges, { groupBy: 'custom', groups: defs })
assert.equal(cmodel.groupBy, 'custom')
assert.equal(cmodel.groups.length, 3, '2 个自定义目录 + 1 个未分组桶')
assert.deepEqual(plain(cmodel.groups.map((g) => [g.key, g.label, g.ungrouped])), [
  ['group:g1', 'QV', false],
  ['group:g2', 'MvizLite', false],
  [L.constants.UNGROUPED_KEY, '未分组', true],
])
const cByKey = Object.fromEntries(cmodel.groups.map((g) => [g.key, g]))

// QV：A、B 两个项目共用一张图
const qv = cByKey['group:g1']
assert.equal(qv.projectCount, 2, 'QV 里 2 个项目')
assert.deepEqual(plain(qv.projects.map((p) => p.label)), ['A项目', 'B项目'], '组内项目顺序＝成员顺序')
assert.deepEqual(plain(qv.projects.map((p) => p.colorIndex)), [0, 1], '组内按项目分色')
assert.equal(qv.taskNodes.length, 3, '图上节点数＝成员项目的任务和')
assert.equal(qv.missingMembers.length, 1, '成员不在场要记下来但不炸')
assert.equal(qv.missingMembers[0].key, 'wz-gone')
assert.equal(qv.missingMembers[0].label, '老项目', '成员不在场时用 labels 兜底显示人话')
assert.deepEqual(plain(qv.clusters.map((c) => c.label)), ['A项目', 'B项目', L.constants.EXTERNAL_LABEL], '项目背景带 + 组外带')
assert.equal(qv.graph.nodes, qv.nodes, 'groups[].graph 就是这一组的画布内容')
assert.equal(qv.graph.edges, qv.edges)
assert.equal(qv.graph.width, qv.width)
assert.equal(qv.graph.mode, 'custom')

// 同一目录内的跨项目边：直接连，两端都是真实节点
const cross = qv.edges.find((e) => e.from === 'b1' && e.to === 'a1')
assert.ok(cross, '同目录跨项目的边必须画在**同一张图**里')
assert.equal(cross.viaGhost, false, '同组内的跨项目边不该走 ghost')
// 跨目录 / 缺失端点：ghost 锚点，不跨组拉长线
const ghostC = qv.nodes.find((n) => n.id === 'c1')
assert.equal(ghostC.ghost, true)
assert.equal(ghostC.missing, false)
assert.equal(ghostC.workspace, 'wc', 'ghost 保留真实归属')
assert.equal(ghostC.groupLabel, 'MvizLite', 'ghost 要标注它属于哪个自定义目录')
assert.equal(ghostC.workspaceLabel, 'C项目')
assert.equal(ghostC.laneKey, L.constants.EXTERNAL_KEY, '组外端点落在「组外」泳道')
assert.equal(qv.nodes.find((n) => n.id === 'nope').missing, true)
assert.equal(qv.edges.length, 4, 'QV 里 4 条边都画出来（2 条内部 + 2 条带 ghost）')
// 配色只给本组项目
assert.equal(qv.taskNodes.find((n) => n.id === 'a1').projectColor, 0)
assert.equal(qv.taskNodes.find((n) => n.id === 'b1').projectColor, 1)
assert.equal(ghostC.projectColor, undefined, '组外 ghost 不参与项目配色')

// MvizLite：C 项目；指向 A 的边在这里是 ghost
const mv = cByKey['group:g2']
assert.equal(mv.projectCount, 1)
assert.equal(mv.taskNodes.length, 1)
assert.equal(mv.nodes.length, 2)
assert.equal(mv.edges.length, 1)
assert.equal(mv.nodes.find((n) => n.id === 'a1').ghost, true)
assert.equal(mv.nodes.find((n) => n.id === 'a1').groupLabel, 'QV')

// 未分组桶：没进任何目录的项目
const rest = cByKey[L.constants.UNGROUPED_KEY]
assert.equal(rest.ungrouped, true)
assert.deepEqual(plain(rest.taskNodes.map((n) => n.id)), ['d1'])
assert.equal(rest.edges.length, 0)
assert.equal(rest.projectCount, 1)
assert.equal(cmodel.stats.groups, 3, 'stats.groups＝这次画了几张图')
assert.equal(cmodel.nodes.length, 5 + 2 + 1, '全量节点＝各组节点之和（QV 3+2ghost、MvizLite 1+1ghost、未分组 1）')
assert.equal(cmodel.stats.tasks, 5)

// 每张图都是自己的一个坐标系：几何自洽，组间不共用节点对象
const keys = new Set()
for (const lane of cmodel.groups) {
  assert.ok(lane.width > 0 && lane.height > 0)
  for (const node of lane.nodes) {
    assert.equal(keys.has(node.key), false, `node.key 全局唯一：${node.key}`)
    keys.add(node.key)
    assert.ok(node.x >= 0 && node.y >= 0, '节点坐标非负')
    assert.ok(node.x + node.w <= lane.width, `${lane.label}：节点不超画布宽`)
    assert.ok(node.y + node.h <= lane.height, `${lane.label}：节点不超画布高`)
  }
  for (const band of lane.clusters) {
    assert.ok(band.x >= 0 && band.y >= 0 && band.x + band.width <= lane.width + 1e-9, '背景带在画布内')
    assert.ok(band.y + band.height <= lane.height + 1e-9, '背景带在画布内')
  }
  for (const edge of lane.edges) {
    assert.match(edge.path, /^M-?\d+ -?\d+ H-?\d+ V-?\d+ H-?\d+$/, '边必须是正交路径')
    assert.ok(lane.nodes.some((n) => n.key === edge.fromKey), '边起点在本组')
    assert.ok(lane.nodes.some((n) => n.key === edge.toKey), '边终点在本组')
  }
  // 同一泳道同一行不能重叠
  const rows = new Map()
  for (const node of lane.nodes) {
    const key = (node.laneKey || '') + '#' + node.order
    if (!rows.has(key)) rows.set(key, [])
    rows.get(key).push(node)
  }
  for (const row of rows.values()) {
    const sorted = row.slice().sort((a, b) => a.x - b.x)
    for (let i = 1; i < sorted.length; i += 1) {
      assert.ok(sorted[i].x >= sorted[i - 1].x + sorted[i - 1].w, '同一行不得重叠')
    }
  }
}

// 一个 workspace 只属于一个目录：前面已经认领的不再重复画
const claimed = L.groupByCustom([
  { id: 'g1', name: '一', members: ['wa'] },
  { id: 'g2', name: '二', members: ['wa', 'wb'] },
], ctasks)
assert.deepEqual(plain(claimed.map((g) => [g.label, g.projects.map((p) => p.label)])), [
  ['一', ['A项目']],
  ['二', ['B项目']],
  ['未分组', ['C项目', 'D项目']],
], '同一个 workspace 不会同时出现在两个目录里；剩下的落到未分组')

// 成员不在场 / 空 groups / 坏输入都不炸
const empty = L.groupByCustom([{ id: 'g1', name: '空目录', members: ['nobody'] }], ctasks)
assert.equal(empty.length, 2)
assert.equal(empty[0].total, 0)
assert.equal(empty[0].missingMembers.length, 1)
const emptyModel = L.layout(ctasks, cedges, { groupBy: 'custom', groups: [{ id: 'g1', name: '空目录', members: ['nobody'] }] })
assert.equal(emptyModel.groups.length, 2)
assert.equal(emptyModel.groups[0].nodes.length, 0)
assert.ok(emptyModel.groups[0].width >= 0)
const noGroups = L.layout(ctasks, cedges, { groupBy: 'custom' })
assert.equal(noGroups.groups.length, 1, '没有目录时只剩「未分组」一张图')
assert.equal(noGroups.groups[0].taskNodes.length, 5)
assert.deepEqual(plain(L.groupByCustom(null, null)), [])
assert.deepEqual(plain(L.groupByCustom('nope', 'nope')), [])
for (const bad of [undefined, null, [], {}, 'nope', 0]) {
  const out = L.layout(bad, bad, { groupBy: 'custom', groups: bad })
  assert.ok(out && Array.isArray(out.groups) && Array.isArray(out.nodes))
  assert.equal(typeof out.stats.tasks, 'number')
}

/* ---------- 18. 按项目模式与旧口径逐字段等价 ---------- */
const oldModel = L.layout(tasks, relations)
const newModel = L.layout(tasks, relations, { groupBy: 'project' })
const shape = (m) => ({
  groupBy: m.groupBy,
  groups: m.groups.map((g) => ({ key: g.key, label: g.label, nodes: g.nodes.map((n) => [n.key, n.x, n.y, n.column, n.order]) })),
  nodes: m.nodes.map((n) => n.key),
  edges: m.edges.map((e) => e.path),
  stats: m.stats,
})
assert.deepEqual(plain(shape(newModel)), plain(shape(oldModel)), '显式按项目必须与默认口径完全一致')
assert.deepEqual(plain(shape(oldModel).groups.map((g) => g.key)), ['w1', 'w2', L.constants.UNGROUPED_KEY])
assert.equal(oldModel.groups[0].custom, false, '按项目模式下不是自定义目录')
assert.equal(oldModel.groups[0].clusters.length, 0, '按项目模式不画背景带')

/* ---------- 19. 左栏那棵树（纯函数） ---------- */
assert.deepEqual(plain(L.normScope(null)), { kind: 'all', id: '' })
assert.deepEqual(plain(L.normScope({ kind: 'group', id: 'g1' })), { kind: 'group', id: 'g1' })
assert.deepEqual(plain(L.normScope({ kind: 'project', id: 'wa' })), { kind: 'project', id: 'wa' })
assert.deepEqual(plain(L.normScope({ kind: 'group' })), { kind: 'all', id: '' }, 'kind 有但 id 空 → 退回全部')
assert.deepEqual(plain(L.normScope({ kind: 'nope', id: 'x' })), { kind: 'all', id: '' })
assert.deepEqual(plain(L.normScope('nope')), { kind: 'all', id: '' })

const tree = L.buildTree(defs, ctasks, {})
assert.equal(tree.rows[0].key, 'all')
assert.equal(tree.rows[0].label, '全部任务')
assert.equal(tree.rows[0].count, 5)
/* 只有三层：depth 只允许 0/1，kind 只允许 all/group/project */
for (const row of tree.rows) {
  assert.ok(row.depth === 0 || row.depth === 1, `depth 只能是 0/1：${row.key}=${row.depth}`)
  assert.ok(['all', 'group', 'project'].includes(row.kind), `未知 kind：${row.kind}`)
  assert.ok(typeof row.label === 'string' && row.label.length > 0)
}
assert.deepEqual(plain(tree.rows.map((r) => [r.kind, r.depth, r.label, r.count])), [
  ['all', 0, '全部任务', 5],
  ['group', 0, 'QV', 2],
  ['project', 1, 'A项目', 2],
  ['project', 1, 'B项目', 1],
  ['group', 0, 'MvizLite', 1],
  ['project', 1, 'C项目', 1],
  ['group', 0, '未分组', 1],
  ['project', 1, 'D项目', 1],
], '三层结构：全部 / 目录 / 项目，未分组与目录同级')
assert.equal(tree.rows.find((r) => r.kind === 'group' && r.label === 'QV').missing, 1, '成员不在场要标记')
assert.equal(tree.byKey['project:wb'].groupId, 'g1', '项目行要记得自己在哪个目录里')
assert.equal(tree.byKey['project:wd'].groupLabel, '未分组')
assert.equal(tree.byKey['group:' + L.constants.UNGROUPED_KEY].ungrouped, true)

/* 折叠：目录行收起来就不展开子行 */
const folded = L.buildTree(defs, ctasks, { collapsed: { 'group:g1': true } })
assert.deepEqual(plain(folded.rows.map((r) => r.label)), ['全部任务', 'QV', 'MvizLite', 'C项目', '未分组', 'D项目'])
assert.equal(folded.rows.some((r) => r.key === 'project:wa'), false, '折叠后子行不上屏')
assert.ok(folded.byKey['project:wa'], '折叠的子行仍要能被查到（否则选中项会被误判成消失）')
assert.equal(folded.rows[1].collapsed, true)

/* 选中：只有一行 selected */
const picked = L.buildTree(defs, ctasks, { selection: { kind: 'project', id: 'wb' } })
assert.equal(picked.rows.filter((r) => r.selected).length, 1)
assert.equal(picked.selected.key, 'project:wb')
assert.equal(L.buildTree(defs, ctasks, { selection: { kind: 'group', id: 'g2' } }).selected.key, 'group:g2')
assert.equal(L.buildTree(defs, ctasks, { selection: { kind: 'all' } }).selected.key, 'all')

/* 空 groups / 坏输入不炸 */
const bare = L.buildTree([], ctasks, {})
assert.deepEqual(plain(bare.rows.map((r) => [r.kind, r.label, r.count])), [
  ['all', '全部任务', 5], ['group', '未分组', 4],
  ['project', 'A项目', 2], ['project', 'B项目', 1], ['project', 'C项目', 1], ['project', 'D项目', 1],
], '没有任何目录时只剩「全部任务」+「未分组」')
assert.deepEqual(plain(L.buildTree(null, null, null).rows.map((r) => r.label)), ['全部任务'])
for (const bad of [undefined, null, [], {}, 'nope', 0, [null, {}], [{ id: 'g', name: 'x', members: 'nope' }]]) {
  const out = L.buildTree(bad, bad, bad)
  assert.ok(out && Array.isArray(out.rows) && out.rows.length >= 1)
}

/* ---------- 20. scope：全部任务 / 某个目录 / 某个项目 ---------- */
assert.deepEqual(plain(L.normScope({ kind: 'all' })), { kind: 'all', id: '' })
assert.equal(L.lanesForScope(defs, ctasks, { kind: 'all' }).length, 3, '全部任务＝每个目录一张图（含未分组）')
assert.equal(L.lanesForScope(defs, ctasks, { kind: 'group', id: 'g1' }).length, 1, '选中目录＝恰好一张图')
assert.equal(L.lanesForScope(defs, ctasks, { kind: 'group', id: L.constants.UNGROUPED_KEY }).length, 1)
assert.equal(L.lanesForScope(defs, ctasks, { kind: 'group', id: 'nope' }).length, 0, '目录没了就没有图，不炸')
assert.equal(L.lanesForScope(defs, ctasks, { kind: 'project', id: 'wa' }).length, 1, '选中项目＝一张图')
assert.equal(L.lanesForScope(defs, ctasks, { kind: 'project', id: 'nobody' }).length, 0)

/* 全部任务：按目录各一张，每张自己一个坐标系 */
const allModel = L.layout(ctasks, cedges, { groupBy: 'custom', groups: defs, scope: { kind: 'all' } })
assert.equal(allModel.groups.length, 3)
assert.equal(allModel.scope.kind, 'all')
assert.equal(allModel.stats.groups, 3)
allModel.groups.forEach((lane) => {
  assert.ok(lane.graph.nodes === lane.nodes && lane.graph.edges === lane.edges, '每组一个画布')
  assert.ok(lane.width > 0 && lane.height > 0)
})

/* 选中某个目录：恰好一张图，组内所有项目的任务都在里面 */
const groupModel = L.layout(ctasks, cedges, { groupBy: 'custom', groups: defs, scope: { kind: 'group', id: 'g1' } })
assert.equal(groupModel.groups.length, 1, '选中目录只画一张图')
assert.equal(groupModel.groups[0].label, 'QV')
assert.equal(groupModel.groups[0].projectCount, 2)
assert.deepEqual(plain(groupModel.groups[0].taskNodes.map((n) => n.id).sort()), ['a1', 'a2', 'b1'])
assert.equal(groupModel.groups[0].edges.find((e) => e.from === 'b1' && e.to === 'a1').viaGhost, false, '同目录跨项目边直接连')
assert.equal(groupModel.nodes.some((n) => n.id === 'd1'), false, '别的目录的任务不在这张图里')

/* 选中某个项目：只有这个项目的任务节点；组外端点仍然是 ghost */
const projModel = L.layout(ctasks, cedges, { groupBy: 'custom', groups: defs, scope: { kind: 'project', id: 'wa' } })
assert.equal(projModel.groups.length, 1, '选中项目只画一张图')
assert.equal(projModel.groups[0].singleProject, true)
assert.deepEqual(plain(projModel.groups[0].taskNodes.map((n) => n.id).sort()), ['a1', 'a2'], '只含本项目的任务')
assert.equal(projModel.groups[0].projectCount, 1)
assert.equal(projModel.groups[0].projectColorOf.wa, 0, '项目在自己的图里仍有配色')
const projNodes = projModel.groups[0].nodes
assert.equal(projNodes.filter((n) => n.ghost === true).length, 3, 'b1 / c1 / nope 都是组外锚点')
assert.ok(projNodes.find((n) => n.id === 'b1').groupLabel === 'QV', '同目录里的别的项目也标出目录名')
for (const edge of projModel.groups[0].edges) {
  assert.ok(projNodes.some((n) => n.key === edge.fromKey) && projNodes.some((n) => n.key === edge.toKey))
}
assert.equal(projModel.groups[0].edges.length, 4)

/* 未分组的项目也一样能单画 */
const restModel = L.layout(ctasks, cedges, { groupBy: 'custom', groups: defs, scope: { kind: 'project', id: 'wd' } })
assert.deepEqual(plain(restModel.groups[0].taskNodes.map((n) => n.id)), ['d1'])
assert.equal(restModel.groups[0].edges.length, 0)

/* scope 坏了就当全部任务 */
assert.equal(L.layout(ctasks, cedges, { groupBy: 'custom', groups: defs, scope: 'nope' }).groups.length, 3)
assert.equal(L.layout(ctasks, cedges, { groupBy: 'custom', groups: defs, scope: { kind: 'project', id: 'nobody' } }).groups.length, 0)

console.log('ok overview.html：布局纯函数 ' + Object.keys(L).length + ' 项导出，'
  + model.nodes.length + ' 节点 / ' + model.edges.length + ' 边 / '
  + model.groups.length + ' 分组，自定义目录 ' + cmodel.groups.length + ' 张图（'
  + cmodel.groups.filter((g) => !g.ungrouped).length + ' 个目录 + 未分组），树 '
  + tree.rows.length + ' 行 / scope 全部/目录/项目 = '
  + allModel.groups.length + '/' + groupModel.groups.length + '/' + projModel.groups.length + ' 张图，全部通过断言')
