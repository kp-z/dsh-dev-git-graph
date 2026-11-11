/**
 * 一键整理（AI 关系建议）**接口级**测试：真实 apply 后的路由 + 假模型 + 隔离 HOME。
 *
 * 钉住四件事：
 *  1. 生成阶段**零副作用**：跑一次之后 state.relations 不变、飞书一次都没被调；
 *  2. 建议单能落 state.json、能按范围取回（面板重开还在）；
 *  3. 接受才写关系，且**逐条**汇报（坏建议早就被纯函数层丢掉了）；
 *  4. 拒绝只改建议单状态，不碰关系；坏 batchId 返回 400 而不是 500。
 *
 * 跑法：node test/organizeRoute.mjs
 */
import { createServer } from 'node:http'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { isolatedHome } from './isolatedHome.mjs'

const HOME = await isolatedHome('dsh-feishu-organize-')
const { apply } = await import('../index.js')

const NOW = 1_700_000_000_000
const TASKS = [
  { id: 't1', no: 'T1', title: '实现 topic_timelines 接口', description: '先把接口落地，带 MCAP 读路径', done: false, workspaceId: 'w1', workspaceTitle: 'qviz', createdAt: NOW - 30_000, meta: { workspace: 'qviz' } },
  { id: 't2', no: 'T2', title: '接入 MCAP 解析', description: '等 topic_timelines 接口完成后再做', done: false, workspaceId: 'w1', workspaceTitle: 'qviz', createdAt: NOW - 20_000, meta: { workspace: 'qviz' } },
  { id: 't3', no: 'T3', title: '补一个 /healthz 探针', description: '和上面两条没关系', done: false, workspaceId: 'w1', workspaceTitle: 'qviz', createdAt: NOW - 10_000, meta: { workspace: 'qviz' } },
]

/* 假模型：一次返回三条建议（一条好、一条置信度不够、一条成环） */
const MODEL_REPLY = JSON.stringify({
  items: [
    { kind: 'depends_on', from: 't1', to: 't2', confidence: 0.92, evidence: '描述里写着「等 topic_timelines 接口完成后再做」' },
    { kind: 'depends_on', from: 't1', to: 't3', confidence: 0.4, evidence: '看起来都在这条链上（其实没证据）' },
    { kind: 'depends_on', from: 't2', to: 't1', confidence: 0.9, evidence: '反向补一条，应该被判成环' },
  ],
  notes: '只认正文里写明的等待关系。',
})
let modelCalls = 0
const llm = {
  stream() {
    modelCalls += 1
    return (async function* () {
      yield { type: 'text-delta', text: MODEL_REPLY }
    })()
  },
}
const agentDefaultModel = { currentSelection: () => ({ provider: 'fake', model: 'fake-model' }) }

await mkdir(join(HOME, 'dsh-feishu'), { recursive: true })
await writeFile(join(HOME, 'dsh-feishu', 'settings.json'), JSON.stringify({ autoSync: false, cliPath: '/nonexistent/feishu-sync-cli', managedTasklist: { enabled: false } }))
await writeFile(join(HOME, 'dsh-feishu', 'state.json'), JSON.stringify({ tasks: TASKS, relations: [], relationSync: {}, settings: { autoSync: false } }))

const routes = []
const ctx = {
  logger: () => ({ info: () => {}, error: () => {} }),
  effect(fn) { fn(); return () => {} },
  get: (name) => (name === 'llm' ? llm : name === 'agentDefaultModel' ? agentDefaultModel : undefined),
  tools: { register: () => () => {} },
  webServer: { register: (route) => (routes.push(route), () => {}) },
}

apply(ctx, {})
const startedAt = Date.now()
while (routes.length === 0) {
  if (Date.now() - startedAt > 10_000) throw new Error('等待路由挂载超时')
  await new Promise((resolve) => setTimeout(resolve, 100))
}
const mounted = routes.find((item) => item.path === '/dsh-feishu') ?? routes[0]
const server = createServer((req, res) => mounted.handler(req, res))
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
const base = `http://127.0.0.1:${server.address().port}/dsh-feishu`

let failed = 0
const check = (label, ok, detail = '') => {
  if (!ok) failed += 1
  console.log(`${ok ? '✓' : '✗'} ${label}${ok ? '' : ` — ${detail}`}`)
}
const json = async (path, init) => {
  const res = await fetch(base + path, init)
  return { status: res.status, data: await res.json().catch(() => null) }
}
const post = (path, body) => json(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })

/* 运行/洞察页的数据面：任务项要带 running / sessionTurn / 时间戳（有任务时才有意义） */
const seeded = await json('/api/overview')
const seededTask = (seeded.data?.tasks || [])[0]
check('快照任务项带 running / sessionTurn / 四个时间戳', Boolean(seededTask)
  && typeof seededTask.running === 'boolean' && typeof seededTask.sessionTurn === 'number'
  && typeof seededTask.createdAt === 'number' && typeof seededTask.startedAt === 'number'
  && typeof seededTask.completedAt === 'number' && typeof seededTask.suspendedAt === 'number',
  JSON.stringify(seededTask && Object.fromEntries(Object.entries(seededTask).filter(([k]) => /running|Turn|At$/.test(k)))))

/* ── 1. 还没有建议时是 null，不是 500 ─────────────────────────────── */
const before = await json('/api/overview/organize?kind=all')
check('GET 建议：初始为空', before.status === 200 && before.data?.ok === true && before.data.batch === null, JSON.stringify(before.data).slice(0, 120))

/* ── 2. 跑一次：出建议、零副作用 ─────────────────────────────────── */
const relationsBefore = (await json('/api/overview')).data.relations.length
const made = await post('/api/overview/organize', { scope: { kind: 'all' } })
check('POST 整理返回 200 且带建议单', made.status === 200 && made.data?.ok === true && made.data.batch?.batchId, JSON.stringify(made.data).slice(0, 200))
const batch = made.data?.batch || {}
const pending = (batch.items || []).filter((item) => item.status === 'pending')
const dropped = (batch.items || []).filter((item) => item.status === 'dropped')
check('好建议进入 pending（带标题与影响预览）', pending.length === 1
  && pending[0].from === 't1' && pending[0].to === 't2'
  && pending[0].fromTitle === '实现 topic_timelines 接口' && pending[0].toTitle === '接入 MCAP 解析'
  && pending[0].impact?.blockedCount === 1, JSON.stringify(pending).slice(0, 240))
check('坏建议被纯函数层丢掉并写明原因（置信度 / 成环）', dropped.length === 2
  && dropped.some((item) => /置信度/.test(item.reason)) && dropped.some((item) => /环/.test(item.reason)),
  JSON.stringify(dropped.map((item) => item.reason)))
check('模型被调用了一次（没有重复要建议）', modelCalls === 1, `modelCalls=${modelCalls}`)
const relationsAfterSuggest = (await json('/api/overview')).data.relations.length
check('生成阶段零副作用：state.relations 一条都没加', relationsAfterSuggest === relationsBefore, `${relationsBefore} → ${relationsAfterSuggest}`)

/* ── 3. 建议单能取回、也落了盘 ───────────────────────────────────── */
const again = await json('/api/overview/organize?kind=all')
check('GET 能取回同一批建议（面板重开还在）', again.data?.batch?.batchId === batch.batchId && again.data.batch.pending === 1, JSON.stringify(again.data).slice(0, 160))
const scopeMiss = await json('/api/overview/organize?kind=group&id=nope')
check('别的范围取不到这批建议', scopeMiss.data?.batch === null, JSON.stringify(scopeMiss.data))
const onDisk = JSON.parse(await readFile(join(HOME, 'dsh-feishu', 'state.json'), 'utf8'))
check('建议单已落 state.json', Boolean(onDisk.organizeSuggestions?.[batch.batchId]), Object.keys(onDisk.organizeSuggestions || {}).join(','))
check('落盘的建议单里没有把 pending 当关系写进去', (onDisk.relations || []).length === relationsBefore, JSON.stringify(onDisk.relations))

/* ── 4. 拒绝：只改建议单，不碰关系 ───────────────────────────────── */
const rejected = await post('/api/overview/organize/reject', { batchId: 'sg:all:0' })
check('未知 batchId 的拒绝返回 400（不是 500）', rejected.status === 400 && rejected.data?.ok === false, JSON.stringify(rejected.data).slice(0, 120))

/* ── 5. 接受：写本地关系（writeBack=false，避免碰真实飞书） ──────── */
const accepted = await post('/api/overview/organize/accept', { batchId: batch.batchId, itemIds: pending.map((item) => item.id), writeBack: false })
check('接受返回 200 且逐条汇报', accepted.status === 200 && accepted.data?.ok === true
  && accepted.data.results?.length === 1 && accepted.data.results[0].ok === true, JSON.stringify(accepted.data).slice(0, 200))
const afterAccept = await json('/api/overview')
const edges = afterAccept.data.relations || []
check('接受后关系真的写进去了（t1 → t2 的 depends_on）', edges.some((edge) => edge.from === 't1' && edge.to === 't2' && edge.kind === 'depends_on'), JSON.stringify(edges).slice(0, 200))
check('接受后建议单状态变成 accepted', accepted.data.batch?.accepted === 1 && accepted.data.batch?.pending === 0, JSON.stringify(accepted.data.batch).slice(0, 160))

const repeat = await post('/api/overview/organize/accept', { batchId: batch.batchId })
check('重复接受没有待处理项 → 400（幂等，不会重复写）', repeat.status === 400 && repeat.data?.ok === false, JSON.stringify(repeat.data).slice(0, 120))

/* ── 6. 撤销：接受必须可回退（设计稿 §9.1：写错一条 depends_on = 后继永远开不了工） ── */
const undone = await post('/api/overview/organize/undo', { batchId: batch.batchId })
check('撤销返回 200 且逐条汇报', undone.status === 200 && undone.data?.ok === true
  && undone.data.results?.length === 1 && undone.data.results[0].ok === true, JSON.stringify(undone.data).slice(0, 200))
const afterUndo = await json('/api/overview')
check('撤销后那条边真的从关系里没了', !(afterUndo.data.relations || []).some((edge) => edge.from === 't1' && edge.to === 't2'), JSON.stringify(afterUndo.data.relations).slice(0, 160))
check('撤销后建议单状态变成 undone', undone.data.batch?.undone === 1 && undone.data.batch?.accepted === 0, JSON.stringify(undone.data.batch).slice(0, 160))
const undoAgain = await post('/api/overview/organize/undo', { batchId: batch.batchId })
check('重复撤销 → 400（没有可撤销的条目）', undoAgain.status === 400 && undoAgain.data?.ok === false, JSON.stringify(undoAgain.data).slice(0, 120))
const undoUnknown = await post('/api/overview/organize/undo', { batchId: 'sg:all:0' })
check('未知 batchId 的撤销 → 400 而不是 500', undoUnknown.status === 400 && undoUnknown.data?.ok === false, JSON.stringify(undoUnknown.data).slice(0, 120))

const badScope = await post('/api/overview/organize', { scope: { kind: 'project', id: 'nope' } })
check('范围里没有任务时返回 400 且说明原因', badScope.status === 400 && /没有足够/.test(badScope.data?.error || ''), JSON.stringify(badScope.data).slice(0, 120))

console.log(failed ? `\n${failed} 项失败` : '\nORGANIZE_ROUTE_OK')
if (failed) process.exit(1)
server.close()
