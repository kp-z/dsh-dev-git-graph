/**
 * 逾期自动归因的接线测试（假模型，不联网）。
 *
 * 验的是「预期过了 → 模型给一个能核对的归因 → 落到任务快照上 → 进延期原因统计」这条链，
 * 以及两条边界：同一个预期不重复烧 token；预期改了要重新归因。
 *
 * 跑法：node test/attribution.mjs
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

const HOME = await mkdtemp(join(tmpdir(), 'dsh-feishu-attrib-'))
process.env.DSH_HOME = HOME
const DATA = join(HOME, 'dsh-feishu')
await mkdir(DATA, { recursive: true })

const DAY = 24 * 60 * 60_000
const now = Date.now()
const EXPECTED = now - 2 * DAY

await writeFile(
  join(DATA, 'state.json'),
  JSON.stringify({
    tasks: [
      {
        id: 'task-late',
        title: 'T7 场景包展开',
        no: 7,
        done: false,
        expectedAt: EXPECTED,
        customFields: [],
        members: [],
        meta: { workspace: '' },
        delayLog: [],
      },
      {
        id: 'task-todo',
        title: 'T8 还没到期',
        no: 8,
        done: false,
        expectedAt: now + 3 * DAY,
        customFields: [],
        members: [],
      },
    ],
  }),
)
await writeFile(join(DATA, 'settings.json'), JSON.stringify({ autoSync: false, cliPath: '/nonexistent/feishu-sync-cli' }))

/* 假模型：按调用次数换答案，验证「第二次不再问」 */
let llmCalls = 0
const fakeReply = JSON.stringify({
  bucket: 'estimate',
  reason: '原估两天，实际拆出五个子任务',
  evidence: '改期记录：原估两天（+2 天）',
  confidence: 0.8,
})
const fakeLlms = {
  llm: {
    stream() {
      llmCalls += 1
      return (async function* () {
        yield { type: 'text-delta', text: fakeReply }
      })()
    },
  },
  agentDefaultModel: { currentSelection: () => ({ provider: 'fake', model: 'fake-model' }) },
  workspaceRegistry: { list: () => [] },
  sessionController: { async inspect() { return null }, async prompt() { return {} } },
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
  get: (name) => fakeLlms[name],
  tools: { register: () => () => {} },
  webServer: {
    register(route) {
      routes.push(route)
      return () => {}
    },
  },
}

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
  const res = await fetch(`${base}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
  return { status: res.status, body: await res.json() }
}

/* 1. 强制归因：只有那条逾期的会问模型 */
const first = await post('/api/delay/attribute', { force: true })
check('归因：请求成功', first.body.ok, true)
check('归因：只处理逾期的那一条', first.body.attributed, 1)
check('归因：模型被调用一次', llmCalls, 1)

const late = await taskOf('task-late')
check('归因：落到任务快照上', late?.delayAttribution?.bucket, 'estimate')
check('归因：带中文桶名', late?.delayAttribution?.label, '估时不准')
check('归因：理由原样保留', late?.delayAttribution?.reason, '原估两天，实际拆出五个子任务')
check('归因：来源标记为 ai', late?.delayAttribution?.source, 'ai')

const todo = await taskOf('task-todo')
check('未到期的任务不归因', todo?.delayAttribution ?? null, null)

/* 2. 同一个预期不重复烧 token（不带 force 时命中退避） */
const second = await post('/api/delay/attribute', {})
check('退避：第二次不再调用模型', second.body.attributed, 0)
check('退避：模型调用数没涨', llmCalls, 1)

/* 3. 预期改了（重承诺）→ 旧归因失效，需要重新归因 */
const moved = await post('/api/tasks/eta', { taskId: 'task-late', action: 'set', when: '明天 12:00' }).catch(() => null)
if (moved && moved.body && moved.body.ok) {
  const lateAgain = await taskOf('task-late')
  check('改期后旧归因失效', lateAgain?.delayAttribution ?? null, null)
  const third = await post('/api/delay/attribute', { force: true })
  check('改期后可以重新归因', third.body.attributed >= 0, true)
} else {
  console.log('（没有可用的改期接口，跳过「改期后重新归因」）')
}

server.close()
if (failures > 0) {
  console.error(`\n${failures} / ${checks} 项失败`)
  process.exitCode = 1
} else {
  console.log(`\n${checks} 项全部通过`)
}
console.log('\nATTRIBUTION_OK')
