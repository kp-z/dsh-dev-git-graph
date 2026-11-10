/**
 * 总览页的数据面测试：瘦快照 / revision / 自定义目录写接口，以及「旧整页路由已经不存在」。
 *
 * 为什么单独测这条：总览从「宿主直出整页 HTML + iframe」改成了「宿主页面里的 React 组件」，
 * 最容易犯的错是**接口换了但页面当天的口径没换**——旧路由还在、或者又悄悄把整份 state（含
 * settings/排期/会话水位）塞回响应里。这里把它钉住。
 *
 * 跑法：node test/overviewRoute.mjs
 */
import { createServer } from 'node:http'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { isolatedHome } from './isolatedHome.mjs'

const HOME = await isolatedHome('dsh-feishu-overview-route-')
const { apply } = await import('../index.js')

const routes = []
const ctx = {
  logger: () => ({ info: () => {}, error: () => {} }),
  effect(fn) { fn(); return () => {} },
  get: () => undefined,
  tools: { register: () => () => {} },
  webServer: { register: (route) => (routes.push(route), () => {}) },
}

await mkdir(join(HOME, 'dsh-feishu'), { recursive: true })
await writeFile(join(HOME, 'dsh-feishu', 'settings.json'), JSON.stringify({ autoSync: false, cliPath: '/nonexistent/feishu-sync-cli', managedTasklist: { enabled: false } }))
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
  return { status: res.status, data: await res.json().catch(() => null), headers: res.headers }
}

/* ── 瘦快照 ─────────────────────────────────────────────────────────── */
const overview = await json('/api/overview')
check('GET /api/overview 返回 200', overview.status === 200 && overview.data?.ok === true, JSON.stringify(overview.data).slice(0, 120))
const view = overview.data || {}
check('带 revision / tasks / relations / groups / workspaces / stats', ['revision', 'tasks', 'relations', 'groups', 'workspaces', 'stats'].every((key) => key in view), Object.keys(view).join(','))
check('不再下发整份 state（没有 settings / 排期 / 会话水位）', !('settings' in view) && !('sessionSeen' in view) && !('schedules' in view) && !('taskCreationReceipts' in view))
/* 运行 tab 的数据面：任务项必须带 running / sessionTurn（宿主内存态；重启后为 false/0）。 */
const sampleTask = (view.tasks || [])[0]
if (sampleTask) {
  check('任务项带 running / sessionTurn / 时间戳字段', typeof sampleTask.running === 'boolean' && typeof sampleTask.sessionTurn === 'number'
    && typeof sampleTask.createdAt === 'number' && typeof sampleTask.startedAt === 'number'
    && typeof sampleTask.completedAt === 'number' && typeof sampleTask.suspendedAt === 'number',
    JSON.stringify({ running: sampleTask.running, sessionTurn: sampleTask.sessionTurn, createdAt: sampleTask.createdAt, startedAt: sampleTask.startedAt, completedAt: sampleTask.completedAt, suspendedAt: sampleTask.suspendedAt }))
} else {
  check('任务项带 running/sessionTurn（无任务时跳过形状检查）', true)
}
check('stats 口径齐全', ['tasks', 'groups', 'dependencyEdges', 'provenanceEdges', 'blocked', 'ready'].every((key) => typeof view.stats?.[key] === 'number'), JSON.stringify(view.stats))

const revision = await json('/api/overview/revision')
check('GET /api/overview/revision 与快照同源', revision.status === 200 && revision.data?.revision === view.revision, JSON.stringify(revision.data))
check('revision 是非空短串', typeof view.revision === 'string' && view.revision.length >= 8)

/* ── 旧整页路由已经拆掉 ─────────────────────────────────────────────── */
const legacy = await json('/overview')
check('旧的 GET /overview 整页路由已移除（404）', legacy.status === 404, `status=${legacy.status}`)
const panel = await fetch(base + '/panel')
check('右侧栏面板仍然 200（旧入口没被挤掉）', panel.status === 200, `status=${panel.status}`)

/* ── 自定义目录：总览页唯一写接口 ───────────────────────────────────── */
const post = (body) => json('/api/workspace-groups', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(body),
})

const created = await post({ action: 'create', name: 'QV', members: ['/p/qviz-service', '/p/qviz-scenepack'], labels: { '/p/qviz-service': 'msim-qviz-service' } })
check('POST create 返回 200 且带目录', created.status === 200 && created.data?.ok === true && created.data.group?.name === 'QV', JSON.stringify(created.data).slice(0, 160))
/* 「变了才刷」的前提：写操作必须让 revision 变，否则页面永远不重拉。 */
const revisionAfterWrite = (await json('/api/overview')).data.revision
check('目录写操作后 revision 变化', revisionAfterWrite !== view.revision, `${view.revision} → ${revisionAfterWrite}`)
const groupId = created.data?.group?.id || ''
const groupsOf = async () => (await json('/api/overview')).data.groups || []
check('成员被登记，且 labels 跟着走', JSON.stringify(await groupsOf()).includes('msim-qviz-service'))

const renamed = await post({ action: 'rename', id: groupId, name: 'QV 后端' })
check('rename 生效', renamed.status === 200 && renamed.data.group?.name === 'QV 后端')
const added = await post({ action: 'add', id: groupId, member: { key: '/p/node-api', label: 'node-api' } })
check('add 拖入一个工作区', added.status === 200 && added.data.group?.members.length === 3)
const removed = await post({ action: 'remove', id: groupId, key: '/p/node-api' })
check('remove 拖出后成员回到 2 个', removed.status === 200 && removed.data.group?.members.length === 2)

const bad = await post({ action: 'frobnicate', id: groupId })
check('坏 action 返回 400 而不是 500', bad.status === 400 && bad.data?.ok === false, JSON.stringify(bad.data).slice(0, 120))
const dupName = await post({ action: 'create', name: 'QV 后端' })
check('重名目录被拒', dupName.status === 400 && /QV/.test(dupName.data?.error || ''))

const stateFile = join(HOME, 'dsh-feishu', 'state.json')
const persisted = JSON.parse(await readFile(stateFile, 'utf8'))
check('分组落盘（state.json 里有 workspaceGroups）', Array.isArray(persisted.workspaceGroups) && persisted.workspaceGroups.length === 1)
check('落盘内容与接口一致', persisted.workspaceGroups[0].members.length === 2)

const dropped = await post({ action: 'delete', id: groupId })
check('delete 之后目录清空', dropped.status === 200 && dropped.data.groups.length === 0)

server.close()
if (failed) {
  console.log(`\nOVERVIEW_API_FAILED：${failed} 项未通过`)
  process.exit(1)
}
console.log('\nOVERVIEW_API_OK')
process.exit(0)
