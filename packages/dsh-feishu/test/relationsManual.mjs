/**
 * 手动连边 / 断开的接口测试：真实 apply + 隔离 HOME + 没有 CLI（远端必失败）。
 * 钉住：add 落本地并回 warning；remove 真的删掉；temporal 永不写飞书；坏输入 400。
 */
import { createServer } from 'node:http'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { isolatedHome } from './isolatedHome.mjs'

const HOME = await isolatedHome('dsh-feishu-rel-manual-')
const { apply } = await import('../index.js')
const NOW = 1_700_000_000_000
const TASKS = [
  { id: 't1', no: 'T1', title: '写接口', done: false, workspaceId: 'w1', workspaceTitle: 'qviz' },
  { id: 't2', no: 'T2', title: '接入解析', done: false, workspaceId: 'w1', workspaceTitle: 'qviz' },
]
await mkdir(join(HOME, 'dsh-feishu'), { recursive: true })
await writeFile(join(HOME, 'dsh-feishu', 'settings.json'), JSON.stringify({ autoSync: false, cliPath: '/nonexistent/feishu-sync-cli', managedTasklist: { enabled: false } }))
await writeFile(join(HOME, 'dsh-feishu', 'state.json'), JSON.stringify({ tasks: TASKS, relations: [], relationSync: {}, settings: { autoSync: false } }))

const routes = []
const ctx = {
  logger: () => ({ info: () => {}, error: () => {} }),
  effect(fn) { fn(); return () => {} },
  get: () => undefined,
  tools: { register: () => () => {} },
  webServer: { register: (route) => (routes.push(route), () => {}) },
}
apply(ctx, {})
const t0 = Date.now()
while (!routes.length) { if (Date.now() - t0 > 10000) throw new Error('路由挂载超时'); await new Promise((r) => setTimeout(r, 100)) }
const mounted = routes.find((r) => r.path === '/dsh-feishu') || routes[0]
const server = createServer((req, res) => mounted.handler(req, res))
await new Promise((r) => server.listen(0, '127.0.0.1', r))
const base = `http://127.0.0.1:${server.address().port}/dsh-feishu`
let failed = 0
const check = (label, ok, detail = '') => { if (!ok) failed += 1; console.log(`${ok ? '✓' : '✗'} ${label}${ok ? '' : ` — ${detail}`}`) }
const post = async (path, body) => {
  const res = await fetch(base + path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
  return { status: res.status, data: await res.json().catch(() => null) }
}
const relations = async () => ((await (await fetch(base + '/api/overview')).json()).relations) || []

const added = await post('/api/overview/relations', { taskId: 't2', otherId: 't1', kind: 'depends_on', action: 'add' })
check('远端不可用时手动加边仍成功（先落本地）', added.status === 200 && added.data?.ok === true, JSON.stringify(added.data).slice(0, 200))
check('逐条说明「已存本机」', /本机/.test(added.data?.warning || ''), String(added.data?.warning))
let edges = await relations()
check('关系真的进了画布数据（t1 → t2）', edges.some((e) => e.from === 't1' && e.to === 't2' && e.kind === 'depends_on'), JSON.stringify(edges))
const dup = await post('/api/overview/relations', { taskId: 't2', otherId: 't1', kind: 'depends_on', action: 'add' })
check('重复添加是幂等的（unchanged）', dup.status === 200 && dup.data?.unchanged === true, JSON.stringify(dup.data))

const temporal = await post('/api/overview/relations', { taskId: 't2', otherId: 't1', kind: 'temporal', action: 'add' })
check('时间先后也能手动加，且不报「本机」警告（本来就不写飞书）', temporal.status === 200 && temporal.data?.ok === true && !temporal.data?.warning, JSON.stringify(temporal.data))
edges = await relations()
check('时间边进了数据', edges.some((e) => e.kind === 'temporal' && e.from === 't1' && e.to === 't2'))

const removed = await post('/api/overview/relations', { taskId: 't2', otherId: 't1', kind: 'depends_on', action: 'remove' })
check('断开前置关系成功', removed.status === 200 && removed.data?.ok === true, JSON.stringify(removed.data))
edges = await relations()
check('断开后 depends_on 没了，temporal 还在', !edges.some((e) => e.kind === 'depends_on' && e.from === 't1' && e.to === 't2')
  && edges.some((e) => e.kind === 'temporal'), JSON.stringify(edges))

for (const [label, body] of [
  ['缺 otherId', { taskId: 't2', kind: 'depends_on', action: 'add' }],
  ['自环', { taskId: 't2', otherId: 't2', kind: 'depends_on', action: 'add' }],
  ['未知 kind', { taskId: 't2', otherId: 't1', kind: 'xxx', action: 'add' }],
  ['未知 action', { taskId: 't2', otherId: 't1', kind: 'depends_on', action: 'zap' }],
]) {
  const res = await post('/api/overview/relations', body)
  check(`坏输入（${label}）→ 400 且带原因`, res.status === 400 && res.data?.ok === false && /缺少|不能|不支持|只能/.test(res.data?.error || ''), JSON.stringify(res.data))
}

console.log(failed ? `\n${failed} 项失败` : '\nRELATIONS_MANUAL_OK')
if (failed) process.exit(1)
server.close()
