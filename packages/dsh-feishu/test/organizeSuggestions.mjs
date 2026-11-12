/**
 * 一键整理（AI 关系建议）纯函数层测试：取材 / 解析 / 校验 / 影响预览 / 批次视图。
 *
 * 跑法：node test/organizeSuggestions.mjs
 *
 * 这些断言对应 docs/DESIGN-task-organize-suggestions.md 的硬口径：
 *  - 生成建议零副作用（本文件根本不碰 state / 网络）；
 *  - precision 优先：depends_on 门槛 0.75、必须给可核对证据、成环与自环一律丢；
 *  - 坏建议只丢那一条，不整批失败。
 */
import assert from 'node:assert/strict'

import {
  MAX_ITEMS,
  MIN_CONFIDENCE,
  ORGANIZE_SYSTEM,
  buildEvidencePack,
  buildTemporalSuggestions,
  describeImpact,
  makeOrganizeBatch,
  organizeBatchId,
  parseOrganizeResponse,
  projectOrganize,
  scopeKeyOf,
  validateOrganizeItems,
} from '../organizeSuggestions.js'

let passed = 0
const failures = []
function check(name, fn) {
  try {
    fn()
    passed += 1
    console.log(`  ok  ${name}`)
  } catch (error) {
    failures.push(name)
    console.log(`  FAIL ${name}`)
    console.log(String((error && error.message) || error).split('\n').slice(0, 4).map((line) => `       ${line}`).join('\n'))
  }
}

const T = (id, extra = {}) => ({
  id,
  no: extra.no || id,
  title: extra.title || `任务 ${id}`,
  description: extra.description || '',
  done: extra.done === true,
  meta: { workspace: extra.workspace || 'w1' },
  predecessors: extra.predecessors || [],
  successors: extra.successors || [],
  sourceTasks: extra.sourceTasks || [],
  createdAt: extra.createdAt || 1000,
})

/* ---- 1. 范围与批次 id ---- */
check('scopeKeyOf：all / group / project 三类稳定 key', () => {
  assert.equal(scopeKeyOf({ kind: 'all' }), 'all')
  assert.equal(scopeKeyOf({ kind: 'group', id: 'g1' }), 'group:g1')
  assert.equal(scopeKeyOf({ kind: 'project', id: 'w9' }), 'project:w9')
  assert.equal(scopeKeyOf({ kind: 'group', id: 'g1' }), scopeKeyOf({ kind: 'group', id: 'g1' }))
})

check('批次的幂等键只用「范围 + 小时窗」：同窗同 id、跨窗不同 id（设计稿 §7）', () => {
  const a = organizeBatchId({ kind: 'group', id: 'g1' }, 1_000_000)
  const b = organizeBatchId({ kind: 'group', id: 'g1' }, 1_000_000 + 60_000)
  const c = organizeBatchId({ kind: 'group', id: 'g1' }, 1_000_000 + 3_600_000)
  assert.equal(a, b)
  assert.notEqual(a, c)
})

/* ---- 2. 取材 ---- */
check('取材：给出范围内任务、带已有关系摘要，完整时不标截断', () => {
  const tasks = [T('a', { title: 'A', predecessors: ['b'] }), T('b', { title: 'B' })]
  const pack = buildEvidencePack({ tasks, relations: [{ from: 'b', to: 'a', kind: 'depends_on' }], budget: 99999 })
  assert.equal(pack.items.length, 2)
  assert.equal(pack.complete, true)
  assert.equal(pack.truncated, 0)
  assert.deepEqual(pack.items[0].predecessors, ['b'])
  assert.ok(pack.text.includes('"tasks"'))
})

check('取材：超预算时截断并显式声明不完整，而不是静默丢', () => {
  const tasks = Array.from({ length: 60 }, (_, i) => T(`t${i}`, { description: 'x'.repeat(200), createdAt: i }))
  const pack = buildEvidencePack({ tasks, budget: 2000 })
  assert.ok(pack.items.length > 0 && pack.items.length < 60)
  assert.equal(pack.complete, false)
  assert.ok(pack.truncated > 0)
  assert.ok(pack.text.includes('"truncated":true'))
})

check('取材：预算内优先保留有关联的任务', () => {
  const tasks = [T('plain1'), T('plain2'), T('linked'), T('plain3')]
  const relations = [{ from: 'linked', to: 'plain1', kind: 'depends_on' }]
  const pack = buildEvidencePack({ tasks, relations, budget: 200 })
  const ids = pack.items.map((item) => item.id)
  assert.ok(ids.includes('linked'), `有关联的任务应优先保留，实际=${ids}`)
})

/* ---- 3. 解析 ---- */
check('解析：围栏 JSON / 前后带解释 / 纯 JSON 都能取到 items', () => {
  assert.equal(parseOrganizeResponse('{"items":[{"from":"a","to":"b"}],"notes":"n"}').items.length, 1)
  assert.equal(parseOrganizeResponse('好的，结果如下：\n```json\n{"items":[{"from":"a","to":"b"}]}\n```\n以上').items.length, 1)
  assert.equal(parseOrganizeResponse('说明文字 {"items":[]} 结尾').items.length, 0)
})

check('解析：空内容与坏 JSON 返回 error，不抛异常', () => {
  assert.ok(parseOrganizeResponse('').error)
  assert.ok(parseOrganizeResponse('模型说了一堆但没有 JSON').error)
})

/* ---- 4. 校验（precision 优先） ---- */
const TASKS = [T('a', { title: 'A' }), T('b', { title: 'B', done: true }), T('c', { title: 'C' })]
const GOOD = { kind: 'depends_on', from: 'a', to: 'c', confidence: 0.9, evidence: '描述里写着「等 A 合并后再做」' }

check('校验：好建议保留为 pending', () => {
  const out = validateOrganizeItems({ items: [GOOD], tasks: TASKS, relations: [], now: 1 })
  assert.equal(out.items[0].status, 'pending')
  assert.equal(out.kept, 1)
  assert.equal(out.dropped, 0)
})

check(`校验：depends_on 门槛 ${MIN_CONFIDENCE.depends_on}、derived_from 门槛 ${MIN_CONFIDENCE.derived_from}`, () => {
  const low = validateOrganizeItems({ items: [{ ...GOOD, confidence: 0.7 }], tasks: TASKS, relations: [], now: 1 })
  assert.equal(low.items[0].status, 'dropped')
  assert.match(low.items[0].reason, /置信度/)
  const derived = validateOrganizeItems({
    items: [{ kind: 'derived_from', from: 'a', to: 'c', confidence: 0.65, evidence: '标题写着「拆分自 A」' }],
    tasks: TASKS, relations: [], now: 1,
  })
  assert.equal(derived.items[0].status, 'pending')
})

check('校验：证据太短 / 缺证据一律丢（同主题不得连边的落地手段）', () => {
  const out = validateOrganizeItems({ items: [{ ...GOOD, evidence: '相关' }, { ...GOOD, to: 'b', evidence: '' }], tasks: TASKS, relations: [], now: 1 })
  assert.equal(out.kept, 0)
  assert.match(out.items[0].reason, /证据/)
})

check('校验：自环 / 未知 id / 未知 kind 都丢，且只丢那一条', () => {
  const out = validateOrganizeItems({
    items: [GOOD, { ...GOOD, from: 'a', to: 'a' }, { ...GOOD, to: 'zzz' }, { ...GOOD, kind: 'blocks' }],
    tasks: TASKS, relations: [], now: 1,
  })
  assert.equal(out.kept, 1)
  assert.equal(out.items.filter((item) => item.status === 'dropped').length, 3)
  assert.match(out.items[1].reason, /自环/)
  assert.match(out.items[2].reason, /范围外/)
  assert.match(out.items[3].reason, /类型/)
})

check('校验：已存在的关系、同批次重复都不重复落', () => {
  const existing = [{ from: 'a', to: 'c', kind: 'depends_on' }]
  const out = validateOrganizeItems({ items: [GOOD, { ...GOOD, to: 'b', evidence: '描述里写着「先做 A 再做 B」' }, { ...GOOD, to: 'b', evidence: '描述里写着「先做 A 再做 B」' }], tasks: TASKS, relations: existing, now: 1 })
  assert.equal(out.items[0].reason, '这条关系已经存在')
  assert.equal(out.items[1].status, 'pending')
  assert.equal(out.items[2].reason, '同一批次内重复')
})

check('校验：成环的建议被丢（复用 updateRelations 的严格校验）', () => {
  const existing = [{ from: 'c', to: 'a', kind: 'depends_on' }]
  const out = validateOrganizeItems({ items: [{ ...GOOD, from: 'a', to: 'c' }], tasks: TASKS, relations: existing, now: 1 })
  assert.equal(out.items[0].status, 'dropped')
  assert.match(out.items[0].reason, /环/)
})

check('校验：同批次内的链条按顺序累积验环（A→C 通过后，C→A 必须被拒）', () => {
  const items = [
    { kind: 'depends_on', from: 'a', to: 'c', confidence: 0.9, evidence: '等 A 完成后做 C' },
    { kind: 'depends_on', from: 'c', to: 'a', confidence: 0.9, evidence: '等 C 完成后做 A' },
  ]
  const out = validateOrganizeItems({ items, tasks: TASKS, relations: [], now: 1 })
  assert.equal(out.items[0].status, 'pending')
  assert.equal(out.items[1].status, 'dropped')
})

check(`校验：一次最多处理 ${MAX_ITEMS} 条量级（超量输入被截），不会无限膨胀`, () => {
  const many = Array.from({ length: MAX_ITEMS * 6 }, () => GOOD)
  const out = validateOrganizeItems({ items: many, tasks: TASKS, relations: [], now: 1 })
  assert.ok(out.items.length <= MAX_ITEMS * 4)
})

/* ---- 5. 影响预览 ---- */
check('影响预览：前置未完成 → 明确说出会让谁阻塞', () => {
  const impact = describeImpact({ kind: 'depends_on', from: 'a', to: 'c' }, TASKS)
  assert.equal(impact.blockedCount, 1)
  assert.deepEqual(impact.blocked, ['C'])
})

check('影响预览：前置已完成 → 不阻塞；derived_from → 不阻塞', () => {
  assert.equal(describeImpact({ kind: 'depends_on', from: 'b', to: 'c' }, TASKS).blockedCount, 0)
  assert.equal(describeImpact({ kind: 'derived_from', from: 'a', to: 'c' }, TASKS).blockedCount, 0)
})

/* ---- 6. 批次与视图 ---- */
check('makeOrganizeBatch：补稳定 id、缺 batchId 时按范围+时间窗生成', () => {
  const batch = makeOrganizeBatch({ scope: { kind: 'group', id: 'g1' }, at: 5000, items: [{ ...GOOD }] })
  assert.equal(batch.items[0].id, 'it-1')
  assert.equal(batch.items[0].status, 'pending')
  assert.equal(batch.batchId, organizeBatchId({ kind: 'group', id: 'g1' }, 5000))
})

check('projectOrganize：补标题、统计四种状态、带影响', () => {
  const batch = makeOrganizeBatch({
    batchId: 'sg:x:1', scope: { kind: 'group', id: 'g1' }, at: 1, notes: '整体判断',
    items: [GOOD, { ...GOOD, to: 'b', status: 'accepted' }, { ...GOOD, to: 'a', status: 'rejected' }],
  })
  const view = projectOrganize(batch, TASKS)
  assert.equal(view.items[0].fromTitle, 'A')
  assert.equal(view.items[0].toTitle, 'C')
  assert.equal(view.pending, 1)
  assert.equal(view.accepted, 1)
  assert.equal(view.rejected, 1)
  assert.equal(view.notes, '整体判断')
  assert.equal(view.items[0].impact.blockedCount, 1)
})

check('系统提示词钉住了硬规则：证据、不猜顺序、宁少勿错', () => {
  assert.ok(ORGANIZE_SYSTEM.includes('evidence'))
  assert.ok(ORGANIZE_SYSTEM.includes('不猜任务顺序'))
  assert.ok(ORGANIZE_SYSTEM.includes('数据'))
})

/* ---- 7. 时间兜底（temporal）：确定性、不猜、不跨项目 ---- */
const TX = (id, extra = {}) => ({
  id,
  title: id,
  description: '',
  done: false,
  expectedAt: 0,
  completedAt: 0,
  workspaceKey: 'w1',
  ...extra,
})
const fmt = (at) => `T${at}`

check('时间建议：待办按预期完成时间串成相邻链', () => {
  const { items } = buildTemporalSuggestions({
    tasks: [TX('a', { expectedAt: 10 }), TX('b', { expectedAt: 20 }), TX('c', { expectedAt: 30 })],
    relations: [],
    format: fmt,
  })
  assert.deepEqual(items.map((item) => `${item.from}>${item.to}`), ['a>b', 'b>c'])
  assert.ok(items.every((item) => item.kind === 'temporal' && item.confidence === 1 && item.status === 'pending'))
  assert.match(items[0].evidence, /T10 早于 T20/)
})

check('时间建议：同一时刻并列不连，没有时间的任务不参与', () => {
  const { items } = buildTemporalSuggestions({
    tasks: [TX('a', { expectedAt: 10 }), TX('b', { expectedAt: 10 }), TX('c', { expectedAt: 0 }), TX('d', { expectedAt: 5 })],
    relations: [],
    format: fmt,
  })
  const pairs = items.map((item) => `${item.from}>${item.to}`)
  assert.equal(pairs.includes('a>b'), false)
  assert.equal(pairs.includes('b>a'), false)
  assert.equal(pairs.some((pair) => pair.includes('c')), false)
  /* 同刻的两条只保留一条通往更晚任务：d>a、a>b 恰是 5 < 10，10 与 10 不连。 */
  assert.deepEqual(pairs, ['d>a'])
})

check('时间建议：待办与已完成分开串、跨项目不连', () => {
  const { items } = buildTemporalSuggestions({
    tasks: [
      TX('open1', { expectedAt: 100 }),
      TX('open2', { expectedAt: 200 }),
      TX('done1', { done: true, completedAt: 50 }),
      TX('done2', { done: true, completedAt: 60 }),
      TX('other1', { expectedAt: 100, workspaceKey: 'w2' }),
      TX('other2', { expectedAt: 300, workspaceKey: 'w2' }),
    ],
    relations: [],
    format: fmt,
  })
  const pairs = items.map((item) => `${item.from}>${item.to}`)
  assert.deepEqual(pairs.sort(), ['done1>done2', 'open1>open2', 'other1>other2'].sort())
  assert.equal(pairs.some((pair) => pair.includes('open') && pair.includes('done')), false)
})

check('时间建议：已存在的时间边不重复提，且受上限约束', () => {
  const tasks = Array.from({ length: 30 }, (_, index) => TX(`t${index}`, { expectedAt: index + 1 }))
  const existing = [{ kind: 'temporal', from: 't0', to: 't1' }]
  const result = buildTemporalSuggestions({ tasks, relations: existing, max: 5, format: fmt })
  assert.equal(result.items.length, 5)
  assert.equal(result.truncated > 0, true)
  assert.equal(result.items.some((item) => item.from === 't0' && item.to === 't1'), false)
})

check('校验：temporal 走时间方向，不阻塞也不被当成依赖', () => {
  const tasks = [TX('a', { expectedAt: 1 }), TX('b', { expectedAt: 2 })]
  const temporal = { kind: 'temporal', from: 'a', to: 'b', confidence: 1, evidence: 'T1 早于 T2（按时间先后排序，不代表必须等待）' }
  const checked = validateOrganizeItems({ items: [temporal], tasks, relations: [], now: 1 })
  assert.equal(checked.items[0].status, 'pending')
  const impact = describeImpact(checked.items[0], tasks)
  assert.equal(impact.blockedCount, 0)
  assert.match(impact.note, /不阻塞/)
})

check('校验：模型给的时间建议置信度不够也丢（门槛 0.9）', () => {
  const tasks = [TX('a', { expectedAt: 1 }), TX('b', { expectedAt: 2 })]
  const checked = validateOrganizeItems({
    items: [{ kind: 'temporal', from: 'a', to: 'b', confidence: 0.5, evidence: 'T1 早于 T2（按时间先后排序）' }],
    tasks,
    relations: [],
    now: 1,
  })
  assert.equal(checked.items[0].status, 'dropped')
  assert.match(checked.items[0].reason, /置信度/)
})

console.log(`\norganizeSuggestions.js: ${passed} passed, ${failures.length} failed`)
if (failures.length) process.exit(1)
console.log('ORGANIZE_SUGGESTIONS_OK')
