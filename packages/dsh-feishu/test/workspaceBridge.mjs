/**
 * 工作区绑定（id 为主键）的接线测试。
 *
 * 验四件事：
 *   1. 首次绑定：飞书文本 ↔ registry 精确命中后，快照里带上 workspaceId；
 *   2. 已绑定：飞书字段还是旧名字，也能按 id 认出（改名不断链）；
 *   3. 不再猜：包含匹配失效，显式报「没找到」；
 *   4. 未登记的绝对路径：可登记（面板按钮）→ 登记后自动绑定。
 *
 * 跑法：node test/workspaceBridge.mjs
 */
import { createServer } from 'node:http'
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

let checks = 0
let failures = 0
function check(name, actual, expected) {
  checks += 1
  const a = JSON.stringify(actual)
  const e = JSON.stringify(expected)
  if (a !== e) {
    failures += 1
    console.error(`✗ ${name}\n  期望 ${e}\n  实际 ${a}`)
  } else {
    console.log(`✓ ${name}`)
  }
}

const HOME = await mkdtemp(join(tmpdir(), 'dsh-feishu-ws-'))
process.env.DSH_HOME = HOME
const DATA = join(HOME, 'dsh-feishu')
await mkdir(DATA, { recursive: true })
const NEW_DIR = join(HOME, 'new-project')
await mkdir(NEW_DIR, { recursive: true })

/* ── 假的工作区登记表 ── */
const workspaces = [
  { id: 'ws-a', title: '[DSH] 插件开发', path: '/Users/kp/DEV/dsh-plugins' },
  { id: 'ws-b', title: 'MSIM', path: '/Users/kp/DEV/msim-qviz-service' },
]
const calls = { create: [] }
const fakeRegistry = {
  list: () => workspaces.map((w) => ({ ...w, sessionIds: [] })),
  create: async (path, title) => {
    calls.create.push({ path, title })
    const entity = { id: `ws-${workspaces.length + 1}`, title: title || path.split('/').pop(), path, sessionIds: [] }
    workspaces.push(entity)
    return entity
  },
}
const fakeServices = {
  workspaceRegistry: fakeRegistry,
  workingDirectory: { defaultDirectory: '/tmp' },
}

const routes = []
const ctx = {
  logger: () => ({ info() {}, error() {}, warn() {} }),
  effect: (fn) => {
    try {
      fn()
    } catch {
      /* ignore */
    }
    return () => {}
  },
  get: (name) => fakeServices[name],
  tools: { register: () => () => {} },
  webServer: {
    register(route) {
      routes.push(route)
      return () => {}
    },
  },
}

/* task-b 已经绑过（模拟老数据：字段还是旧名字）；task-c 是「插件」这种模糊词；task-d 是未登记路径 */
await writeFile(
  join(DATA, 'state.json'),
  JSON.stringify({
    tasks: [
      { id: 'task-a', title: 'A', done: false, meta: { workspace: '[DSH] 插件开发', source: 'field' }, customFields: [], members: [] },
      { id: 'task-b', title: 'B', done: false, meta: { workspace: '旧名字', source: 'field' }, customFields: [], members: [] },
      { id: 'task-c', title: 'C', done: false, meta: { workspace: '插件', source: 'field' }, customFields: [], members: [] },
      { id: 'task-d', title: 'D', done: false, meta: { workspace: NEW_DIR, source: 'field' }, customFields: [], members: [] },
    ],
    workspaceLinks: {
      'task-b': { id: 'ws-a', path: '/Users/kp/DEV/dsh-plugins', title: '旧名字', boundAt: 1, titleSyncedAt: 0, stale: false },
    },
    schedules: {},
  }),
)
await writeFile(join(DATA, 'settings.json'), JSON.stringify({ autoSync: false, cliPath: '/nonexistent/feishu-sync-cli' }))

const { apply } = await import('../index.js')
apply(ctx, {})
for (let i = 0; i < 100 && routes.length === 0; i += 1) await new Promise((r) => setTimeout(r, 50))
if (routes.length === 0) throw new Error('路由没挂上')

const server = createServer((req, res) => routes[0].handler(req, res))
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
const { port } = server.address()
const base = `http://127.0.0.1:${port}/dsh-feishu`
const state = async () => (await (await fetch(`${base}/api/state`)).json()).state
const taskOf = async (id) => (await state()).tasks.find((t) => t.id === id)
const post = async (path, body) => {
  const res = await fetch(`${base}${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
  return { status: res.status, body: await res.json() }
}

/* 1. 首次绑定：文本精确命中 */
const a = await taskOf('task-a')
check('首次绑定：认出了工作区 id', a?.workspaceId, 'ws-a')
check('首次绑定：标题用 registry 的规范名', a?.workspaceTitle, '[DSH] 插件开发')
check('首次绑定：没有报错', a?.workspaceError ?? null, null)

/* 2. 已绑定：字段是旧名字，仍按 id 认出来 */
const b = await taskOf('task-b')
check('改名不断链：旧名字 + 已绑定 id → 仍是同一个工作区', b?.workspaceTitle, '[DSH] 插件开发')
check('改名不断链：没有报错', b?.workspaceError ?? null, null)

/* 3. 不再猜：包含匹配被删了 */
const c = await taskOf('task-c')
check('包含匹配不再命中', /没找到工作区/.test(String(c?.workspaceError)), true)

/* 4. 未登记路径：可登记 */
const d = await taskOf('task-d')
check('未登记绝对路径：给出可登记标记', d?.workspaceCanRegister, true)
const registered = await post('/api/workspaces/register', { taskId: 'task-d', path: NEW_DIR })
check('登记：成功', registered.body.ok, true)
check('登记：真的调了 registry.create', calls.create.length, 1)
const d2 = await taskOf('task-d')
check('登记后：已绑定 id', Boolean(d2?.workspaceId), true)
check('登记后：不再提示可登记', d2?.workspaceCanRegister, false)

/* 5. 改名：registry 改了标题 → 对账后按 id 显示新名字 */
workspaces[0].title = 'DSH 插件开发（新）'
const reconciled = await post('/api/workspaces/reconcile', {})
check('对账：请求成功', reconciled.body.ok, true)
const a2 = await taskOf('task-a')
check('改名后：卡片标题跟着变', a2?.workspaceTitle, 'DSH 插件开发（新）')
check('改名后：仍然是同一个 id', a2?.workspaceId, 'ws-a')
const b2 = await taskOf('task-b')
check('改名后：老绑定也不断（按 id）', b2?.workspaceTitle, 'DSH 插件开发（新）')

/* 6. 面板换绑：点工作区标签 → 选另一个（id 是主键） */
const rebound = await post('/api/workspaces/bind', { taskId: 'task-a', workspaceId: 'ws-b' })
check('换绑：成功', rebound.body.ok, true)
check('换绑：返回新工作区', rebound.body.workspace?.title, 'MSIM')
const a3 = await taskOf('task-a')
check('换绑后卡片显示新工作区', a3?.workspaceTitle, 'MSIM')
check('换绑后绑定的是新 id', a3?.workspaceId, 'ws-b')
check('换绑后本地立即成功，飞书写回进入后台', rebound.body.writeBack?.pending, true)

/* 7. 清除工作区 */
const clearedWs = await post('/api/workspaces/bind', { taskId: 'task-a', workspaceId: '' })
check('清除：成功', clearedWs.body.ok, true)
const a4 = await taskOf('task-a')
check('清除后卡片没有工作区', a4?.workspaceTitle ?? '', '')
check('清除后本地绑定也删了', a4?.workspaceId ?? '', '')

server.close()
if (failures > 0) {
  console.error(`\n${failures} / ${checks} 项失败`)
  process.exitCode = 1
} else {
  console.log(`\n${checks} 项全部通过`)
}
console.log('\nWORKSPACE_BRIDGE_OK')
