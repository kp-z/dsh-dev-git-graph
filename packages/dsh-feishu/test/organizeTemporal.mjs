/**
 * 「一键整理」的时间兜底（temporal）**接口级**测试：真实 apply + 没有可用模型。
 *
 * 钉住五件事：
 *  1. 模型不可用时，整理仍能出**确定性**的时间先后建议（不是一条错误）；
 *  2. 待办看预期完成时间、已完成看实际完成时间，两种时间**分开串**，不交叉；
 *  3. 同一时刻并列不连边；没有时间的任务不参与；跨项目不连；
 *  4. 接受/撤销只落本地：**不 refresh 远端、不写飞书原生依赖**；
 *  5. 时间边**不阻塞开工**：blocked=false、ready=true、blockedBy 不含它。
 *
 * 跑法：node test/organizeTemporal.mjs
 */
import { createServer } from 'node:http'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { isolatedHome } from './isolatedHome.mjs'

const HOME = await isolatedHome('dsh-feishu-temporal-')
const { apply } = await import('../index.js')

const NOW = 1_700_000_000_000
const at = (hours) => NOW + hours * 3_600_000
const TASKS = [
  { id: 't1', no: 'T1', title: '写接口', description: '没有写依赖', done: false, expectedAt: at(1), workspaceId: 'w1', workspaceTitle: 'qviz' },
  { id: 't2', no: 'T2', title: '接入解析', description: '没有写依赖', done: false, expectedAt: at(2), workspaceId: 'w1', workspaceTitle: 'qviz' },
  /* t3 与 t2 预期同一时刻：并列，两者之间不该有边。 */
  { id: 't3', no: 'T3', title: '补探针', description: '没有写依赖', done: false, expectedAt: at(2), workspaceId: 'w1', workspaceTitle: 'qviz' },
  { id: 't4', no: 'T4', title: '写文档', description: '没有写依赖', done: false, expectedAt: at(3), workspaceId: 'w1', workspaceTitle: 'qviz' },
  /* 没有预期时间：不参与时间链。 */
  { id: 't5', no: 'T5', title: '待定', description: '还没排期', done: false, expectedAt: 0, workspaceId: 'w1', workspaceTitle: 'qviz' },
  /* 已完成：按实际完成时间，与待办分开串；只有一条，所以不产生边。 */
  { id: 'd1', no: 'T6', title: '已完成的活', description: '', done: true, completedAt: at(-5), workspaceId: 'w1', workspaceTitle: 'qviz' },
  /* 另一个项目：不该和 qviz 串成一条时间线。 */
  { id: 'x1', no: 'T7', title: '别的项目', description: '', done: false, expectedAt: at(1.5), workspaceId: 'w2', workspaceTitle: 'other' },
]

await mkdir(join(HOME, 'dsh-feishu'), { recursive: true })
await writeFile(join(HOME, 'dsh-feishu', 'settings.json'), JSON.stringify({ autoSync: false, cliPath: '/nonexistent/feishu-sync-cli', managedTasklist: { enabled: false } }))
await writeFile(join(HOME, 'dsh-feishu', 'state.json'), JSON.stringify({ tasks: TASKS, relations: [], relationSync: {}, settings: { autoSync: false } }))

const routes = []
/* 故意不注册 llm / agentDefaultModel：模拟「没有可用模型」。 */
const ctx = {
  logger: () => ({ info: () => {}, error: () => {} }),
  effect(fn) { fn(); return () => {} },
  get: () => undefined,
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
const temporal = (edges) => edges.filter((edge) => edge.kind === 'temporal')

/* ── 1. 没有模型也能整理出时间建议 ─────────────────────────────────── */
const made = await post('/api/overview/organize', { scope: { kind: 'all' } })
check('模型不可用时整理仍然成功（不是 400）', made.status === 200 && made.data?.ok === true, JSON.stringify(made.data).slice(0, 240))
const items = made.data?.batch?.items || []
const pendingItems = items.filter((item) => item.status === 'pending')
check('建议单里带 temporal 条目', pendingItems.length === 2 && pendingItems.every((item) => item.kind === 'temporal'), JSON.stringify(pendingItems).slice(0, 300))
check('时间链：t1 → t2、t3 → t4', pendingItems.some((item) => item.from === 't1' && item.to === 't2')
  && pendingItems.some((item) => item.from === 't3' && item.to === 't4'), JSON.stringify(pendingItems.map((item) => `${item.from}>${item.to}`)))
check('同一时刻并列：t2 与 t3 之间不连边', !pendingItems.some((item) => (item.from === 't2' && item.to === 't3') || (item.from === 't3' && item.to === 't2')))
check('没有时间的任务不参与时间链', !pendingItems.some((item) => item.from === 't5' || item.to === 't5'))
check('跨项目不连：x1 不出现', !pendingItems.some((item) => item.from === 'x1' || item.to === 'x1'))
check('已完成单独一串：d1 不参与待办时间链', !pendingItems.some((item) => item.from === 'd1' || item.to === 'd1'))
check('证据写清两个时间点，并声明不代表必须等待', pendingItems.every((item) => /\d{4}-\d{2}-\d{2}/.test(item.evidence) && /不代表必须等待/.test(item.evidence)), JSON.stringify(pendingItems.map((item) => item.evidence)))
check('影响预览：时间先后不产生阻塞', pendingItems.every((item) => item.impact?.blockedCount === 0 && /不阻塞/.test(item.impact?.note || '')), JSON.stringify(pendingItems.map((item) => item.impact)))
const batchId = made.data?.batch?.batchId

/* ── 2. 生成阶段零副作用 ────────────────────────────────────────── */
const beforeAccept = await json('/api/overview')
check('生成阶段没有写关系', temporal(beforeAccept.data?.relations || []).length === 0, JSON.stringify(beforeAccept.data?.relations))

/* ── 3. 接受：只落本地，不阻塞开工 ──────────────────────────────── */
const accepted = await post('/api/overview/organize/accept', { batchId, itemIds: pendingItems.map((item) => item.id) })
check('接受逐条成功（没有可用 CLI 也不该失败：时间边不走远端）', accepted.data?.ok === true
  && accepted.data.results?.length === 2 && accepted.data.results.every((row) => row.ok === true), JSON.stringify(accepted.data).slice(0, 300))

const afterAccept = await json('/api/overview')
const edges = temporal(afterAccept.data?.relations || [])
check('接受后关系里有两条 temporal', edges.length === 2
  && edges.some((edge) => edge.from === 't1' && edge.to === 't2')
  && edges.some((edge) => edge.from === 't3' && edge.to === 't4'), JSON.stringify(edges))
const byId = new Map((afterAccept.data?.tasks || []).map((task) => [task.id, task]))
const t2 = byId.get('t2') || {}
const t1 = byId.get('t1') || {}
check('任务上能读到时间先后（t2.earlierTasks 含 t1、t1.laterTasks 含 t2）',
  (t2.earlierTasks || []).some((row) => row.id === 't1') && (t1.laterTasks || []).some((row) => row.id === 't2'),
  JSON.stringify({ earlier: t2.earlierTasks, later: t1.laterTasks }))
check('时间边不阻塞：t2 blocked=false / ready=true / blockedBy 为空',
  t2.blocked === false && t2.ready === true && (t2.blockedBy || []).length === 0, JSON.stringify({ blocked: t2.blocked, ready: t2.ready, blockedBy: t2.blockedBy }))
check('时间边不进依赖统计（dependencyEdges=0，temporalEdges=2）',
  afterAccept.data?.stats?.dependencyEdges === 0 && afterAccept.data?.stats?.temporalEdges === 2, JSON.stringify(afterAccept.data?.stats))
check('时间边没有把任务标成 relationSync pending（不动远端同步状态）',
  !Boolean(byId.get('t2')?.relationSync?.pending), JSON.stringify(byId.get('t2')?.relationSync))

const onDisk = JSON.parse(await readFile(join(HOME, 'dsh-feishu', 'state.json'), 'utf8'))
const diskEdges = temporal(onDisk.relations || [])
check('时间边落了 state.json，source 标成 time', diskEdges.length === 2 && diskEdges.every((edge) => edge.source === 'time'), JSON.stringify(diskEdges))

/* ── 4. 撤销：只删那一条，其它时间边原样保留 ────────────────────── */
const firstItem = pendingItems.find((item) => item.from === 't1')
const undone = await post('/api/overview/organize/undo', { batchId, itemIds: [firstItem.id] })
check('撤销单条返回成功', undone.data?.ok === true && undone.data.results?.length === 1 && undone.data.results[0].ok === true, JSON.stringify(undone.data).slice(0, 240))
const afterUndo = await json('/api/overview')
const undoEdges = temporal(afterUndo.data?.relations || [])
check('撤销后只少了 t1 → t2，t3 → t4 还在', undoEdges.length === 1 && undoEdges[0].from === 't3' && undoEdges[0].to === 't4', JSON.stringify(undoEdges))

/* ── 5. 范围里没有足够任务时仍是明确的错误 ──────────────────────── */
const badScope = await post('/api/overview/organize', { scope: { kind: 'project', id: 'nope' } })
check('空范围返回 400 且说明原因', badScope.status === 400 && /没有足够/.test(badScope.data?.error || ''), JSON.stringify(badScope.data).slice(0, 120))

console.log(failed ? `\n${failed} 项失败` : '\nORGANIZE_TEMPORAL_OK')
if (failed) process.exit(1)
server.close()
