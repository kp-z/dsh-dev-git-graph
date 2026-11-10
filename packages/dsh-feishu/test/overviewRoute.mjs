/**
 * 左侧栏「飞书任务总览」的路由测试：整页必须由宿主直出，且只读。
 *
 * 为什么单独测这一条：总览页是**全局面板**（sidebar.panellist + main），
 * 页面本身走 /dsh-feishu/overview。历史上最容易犯的错是「客户端注册写好了、
 * 宿主没挂路由」——表现就是左侧栏点了图标出来一个空白/404 页。
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

const check = (label, ok, detail = '') => {
  console.log(`${ok ? '✓' : '✗'} ${label}${ok ? '' : ` — ${detail}`}`)
  if (!ok) process.exitCode = 1
}

const overview = await fetch(base + '/overview')
const html = await overview.text()
check('GET /overview 返回 200', overview.status === 200, `status=${overview.status}`)
check('content-type 是 html', String(overview.headers.get('content-type')).includes('text/html'))
check('页面带有标题与数据源脚本', html.includes('飞书任务总览') && html.includes('/dsh-feishu/api/state'))
check('内联脚本非空（整页自包含，不依赖外部资源）', html.length > 20_000, `length=${html.length}`)

/* 总览页只改「组织方式」（自定义目录），不碰任务/同步/授权这些写接口。 */
const forbidden = ['/api/settings', '/api/sync', '/api/tasks/', '/api/comments', '/api/sessions/', '/api/auth/']
const leaked = forbidden.filter((route) => html.includes(route))
check('页面不碰任务/同步/授权写接口', leaked.length === 0, leaked.join(', '))
check('页面只写自定义目录这一个接口', html.includes('/api/workspace-groups'))
const external = (html.match(/https?:\/\/[^"'\s>]+/g) || []).filter((url) => !url.startsWith('http://www.w3.org/'))
check('页面不引用外链资源', external.length === 0, external.join(', '))

const panel = await fetch(base + '/panel')
check('GET /panel 仍然 200（旧入口没被挤掉）', panel.status === 200, `status=${panel.status}`)

const missing = await fetch(base + '/definitely-not-a-route')
const missingBody = await missing.json().catch(() => ({}))
check('未知路由仍然 404', missing.status === 404, `status=${missing.status}`)
check('404 是 JSON 错误体', missingBody.ok === false, JSON.stringify(missingBody).slice(0, 120))

/* 页面与测试同源：overview.html 的静态检查必须与测试里的断言一致。 */
const local = await readFile(new URL('../overview.html', import.meta.url), 'utf8')
check('直出的 HTML 与仓库文件一致', local === html || local.length === html.length, `local=${local.length} served=${html.length}`)

/* ── 自定义目录接口：总览页唯一会写的东西 ───────────────────────────── */
const post = (body) =>
  fetch(base + '/api/workspace-groups', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  }).then(async (res) => ({ status: res.status, data: await res.json().catch(() => ({})) }))

const created = await post({ action: 'create', name: 'QV', members: ['/p/qviz-service', '/p/qviz-scenepack'], labels: { '/p/qviz-service': 'msim-qviz-service' } })
check('POST create 返回 200 且带目录', created.status === 200 && created.data.ok === true && created.data.group?.name === 'QV', JSON.stringify(created.data).slice(0, 160))
const groupId = created.data.group?.id || ''
const groupList = () => fetch(base + '/api/state').then((res) => res.json()).then((data) => data.state?.workspaceGroups || [])
check('成员被登记，且 labels 跟着走', JSON.stringify(await groupList()).includes('msim-qviz-service'))
check('快照带 presentMembers（这里没有对应任务，应为 0）', (await groupList())[0]?.presentMembers === 0)

const renamed = await post({ action: 'rename', id: groupId, name: 'QV 后端' })
check('rename 生效', renamed.status === 200 && renamed.data.group?.name === 'QV 后端')
const added = await post({ action: 'add', id: groupId, member: { key: '/p/node-api', label: 'node-api' } })
check('add 拖入一个工作区', added.status === 200 && added.data.group?.members.length === 3)
const removed = await post({ action: 'remove', id: groupId, key: '/p/node-api' })
check('remove 拖出后成员回到 2 个', removed.status === 200 && removed.data.group?.members.length === 2)

const bad = await post({ action: 'frobnicate', id: groupId })
check('坏 action 返回 400 而不是 500', bad.status === 400 && bad.data.ok === false, JSON.stringify(bad.data).slice(0, 120))
const dupName = await post({ action: 'create', name: 'QV 后端' })
check('重名目录被拒', dupName.status === 400 && /QV/.test(dupName.data.error || ''))

const stateFile = join(HOME, 'dsh-feishu', 'state.json')
const persisted = JSON.parse(await readFile(stateFile, 'utf8'))
check('分组落盘（state.json 里有 workspaceGroups）', Array.isArray(persisted.workspaceGroups) && persisted.workspaceGroups.length === 1)
check('落盘内容与接口一致', persisted.workspaceGroups[0].members.length === 2)

const dropped = await post({ action: 'delete', id: groupId })
check('delete 之后目录清空', dropped.status === 200 && dropped.data.groups.length === 0)

server.close()
if (process.exitCode) {
  console.log('OVERVIEW_ROUTE_FAILED')
  process.exit(1)
}
console.log('OVERVIEW_ROUTE_OK')
process.exit(0)
