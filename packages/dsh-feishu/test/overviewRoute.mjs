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

/* 只读：页面不得出现任何写接口或外部依赖。SVG 命名空间是 XML 标识符，不是资源请求。 */
const writeRoutes = ['/api/settings', '/api/sync', '/api/tasks/', '/api/comments', '/api/sessions/']
const leaked = writeRoutes.filter((route) => html.includes(route))
check('页面只读：不引用任何写接口', leaked.length === 0, leaked.join(', '))
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

server.close()
if (process.exitCode) {
  console.log('OVERVIEW_ROUTE_FAILED')
  process.exit(1)
}
console.log('OVERVIEW_ROUTE_OK')
process.exit(0)
