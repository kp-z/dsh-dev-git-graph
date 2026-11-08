/**
 * 会话读取的宿主兼容回归：DSH 0.2.2 起 `sessionController.inspect()` 没了。
 *
 * 背景（真实故障）：DSH 升级到 0.2.2-rc.1 后，面板「同步为飞书任务」返回
 * 「宿主暂时没有会话服务，稍后再试」——插件还在找 `sessionController.inspect`，
 * 而 0.2.2 把冷读日志放到了 `sessionQuery.readSession()/readTitle()`。
 *
 * 本测试用假 lark-cli + 假宿主服务，验证：
 *   1. 只有新接口（sessionQuery、没有 inspect）时，同步能读到会话里的助手回复并写回评论；
 *   2. 两个接口都没有时，才报「宿主暂时没有会话服务」；
 *   3. 旧接口（sessionController.inspect）仍然可用（回退分支）。
 *
 * 跑法：node test/sessionServiceCompat.mjs
 */
import { createServer } from 'node:http'
import { chmod, mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { isolatedHome } from './isolatedHome.mjs'

const HOME = await isolatedHome('dsh-feishu-session-compat-')
const BIN = await mkdtemp(join(tmpdir(), 'dsh-feishu-session-compat-bin-'))
const DATA = join(HOME, 'dsh-feishu')

const TASK = {
  guid: 'task-session',
  summary: '会话同步联调任务',
  description: '',
  completed_at: '0',
  members: [{ id: 'ou_1', role: 'assignee' }],
  tasklists: [{ tasklist_guid: 'list-1' }],
  custom_fields: [],
  dependencies: [],
  url: 'https://x.feishu.cn/task/task-session',
  updated_at: '1700000000000',
}

const FAKE = `#!/bin/sh
echo "$*" >> "$(dirname "$0")/args.log"
cmd="$1"
fakeapi() {
  method="$1"
  path="$2"
  case "$method $path" in
    "GET /open-apis/task/v2/tasks") cat <<'JSON'
{"ok":true,"identity":"user","data":{"items":[${JSON.stringify(TASK)}],"has_more":false}}
JSON
      ;;
    "GET /open-apis/task/v2/tasks/task-session") cat <<'JSON'
{"ok":true,"identity":"user","data":{"task":${JSON.stringify(TASK)}}}
JSON
      ;;
    "PATCH /open-apis/task/v2/tasks/task-session") echo '{"ok":true,"identity":"user","data":{}}' ;;
    "GET /open-apis/task/v2/tasklists/list-1") echo '{"ok":true,"data":{"tasklist":{"guid":"list-1","name":"DSH 任务"}}}' ;;
    "GET /open-apis/task/v2/tasklists") echo '{"ok":true,"data":{"items":[{"guid":"list-1","name":"DSH 任务"}],"has_more":false}}' ;;
    "GET /open-apis/task/v2/custom_fields") echo '{"ok":true,"data":{"items":[]}}' ;;
    "GET /open-apis/contact/v3/users/ou_1") echo '{"ok":false,"error":{"code":99991679,"message":"missing scope"}}' ;;
    "POST /open-apis/task/v2/comments")
      seq_file="$(dirname "$0")/comment-seq"
      n=$(cat "$seq_file" 2>/dev/null || echo 7700000000000000000)
      n=$((n + 1))
      echo "$n" > "$seq_file"
      printf '{"ok":true,"data":{"comment":{"id":"%s","resource_type":"task","resource_id":"task-session"}}}' "$n"
      ;;
    "GET /open-apis/task/v2/comments") echo '{"ok":true,"data":{"items":[],"has_more":false}}' ;;
    *) echo '{"ok":true,"data":{}}' ;;
  esac
}
case "$cmd" in
  version|--version) echo "lark-cli 1.0.98" ;;
  auth)
    if [ "$2" = "status" ]; then
      echo '{"ok":true,"identity":"user","data":{"identities":{"user":{"status":"authorized","userName":"测试用户","openId":"ou_1"}}}}'
    else
      echo '{"ok":true,"data":{}}'
    fi
    ;;
  api) fakeapi "$2" "$3" ;;
  *) echo '{"ok":true,"data":{}}' ;;
esac
`
await writeFile(join(BIN, 'lark-cli'), FAKE, 'utf8')
await chmod(join(BIN, 'lark-cli'), 0o755)
process.env.DSH_FEISHU_EXTRA_PATH = BIN

await mkdir(DATA, { recursive: true })
await writeFile(join(DATA, 'settings.json'), JSON.stringify({
  titlesMigrated: true,
  cliBackend: 'lark-cli',
  autoSync: false,
  autoComment: false,
  comments: { enabled: false },
}))
await writeFile(join(DATA, 'state.json'), JSON.stringify({
  tasks: [{
    id: 'task-session',
    title: 'T1-会话同步联调任务',
    no: 1,
    done: false,
    sessionId: 'sess-modern',
    tasklistGuid: 'list-1',
    members: [{ id: 'ou_1', role: 'assignee', name: '', avatar: '' }],
    customFields: [],
    meta: {},
    startAt: 1700000000000,
  }],
  numbers: { 'task-session': 1 },
}))

const checks = []
function check(label, ok, detail = '') {
  checks.push({ label, ok: !!ok })
  console.log(`${ok ? '✓' : '✗'} ${label}${ok || !detail ? '' : `（${String(detail).slice(0, 160)}）`}`)
}

/* 会话事件：一条助手回复，正文就是同步该写回飞书的内容。 */
const ASSISTANT_TEXT = '结论：宿主 0.2.2 的会话读取已改走 sessionQuery，头像修复不受影响。'
const sessionEvents = [
  { type: 'turn/start', seq: 1, time: 1700000000500, data: { turn: 1 } },
  {
    type: 'assistant/message',
    seq: 2,
    time: 1700000000600,
    data: { turn: 1, step: 1, message: { content: [{ type: 'text', text: ASSISTANT_TEXT }] } },
  },
]

const services = {
  agents: { list: () => [{ id: 'sess-modern', session: { title: '现代会话' } }] },
  sessionController: {
    async prompt() { return {} },
    async rename() { return { title: '' } },
  },
  workspaceRegistry: { list: () => [] },
  workingDirectory: { defaultDirectory: '/tmp' },
  llm: { stream: async function* () { yield { type: 'text-delta', text: 'ok' } } },
  agentDefaultModel: { currentSelection: () => ({ provider: 'fake', model: 'fake-model' }) },
}

const routes = []
const ctx = {
  logger: () => ({ info: () => {}, warn: () => {}, error: () => {} }),
  get: (name) => services[name],
  effect(fn) { fn(); return () => {} },
  on: () => () => {},
  tools: { register: () => () => {}, guard: () => () => {} },
  webServer: { register: (route) => (routes.push(route), () => {}) },
}

const { apply } = await import('../index.js')
apply(ctx, {})
const startedAt = Date.now()
while (routes.length === 0) {
  if (Date.now() - startedAt > 10_000) throw new Error('等待路由挂载超时')
  await new Promise((resolve) => setTimeout(resolve, 100))
}
const route = routes.find((item) => item.path === '/dsh-feishu') ?? routes[0]
const server = createServer((req, res) => route.handler(req, res))
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
const base = `http://127.0.0.1:${server.address().port}/dsh-feishu`
const post = async (path, body) => {
  const res = await fetch(base + path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body ?? {}),
  })
  const text = await res.text()
  let data
  try { data = JSON.parse(text) } catch { data = { raw: text } }
  return { status: res.status, data }
}
const argsLog = async () => readFile(join(BIN, 'args.log'), 'utf8').catch(() => '')

/* 1) 新宿主没有 inspect、也还没有 sessionQuery：只有这种时候才该报「没有会话服务」。 */
const missing = await post('/api/sessions/sync', { sessionId: 'sess-modern' })
check(
  '两个接口都没有时才报「宿主暂时没有会话服务」',
  missing.status === 400 && String(missing.data.error || '').includes('宿主暂时没有会话服务'),
  JSON.stringify(missing.data),
)

/* 2) 只有 0.2.2 的 sessionQuery：同步必须能读到助手回复并写回飞书评论。 */
services.sessionQuery = {
  async readSession(sessionId) {
    if (sessionId !== 'sess-modern') throw new Error('no such session')
    return { session: { id: sessionId, cwd: '/tmp' }, inheritedEventCount: 0, events: sessionEvents }
  },
  async readTitle(sessionId) {
    return sessionId === 'sess-modern' ? '现代会话' : undefined
  },
}
const synced = await post('/api/sessions/sync', { sessionId: 'sess-modern' })
check('新宿主 sessionQuery 路径能完成同步', synced.status === 200 && synced.data.ok === true, JSON.stringify(synced.data))
check('同步字数来自会话里的助手回复', Number(synced.data.chars) === ASSISTANT_TEXT.length, synced.data.chars)
const calls = await argsLog()
check('评论写回走了 lark-cli', /POST \/open-apis\/task\/v2\/comments/.test(calls))
check('评论内容包含会话里的助手回复', calls.includes(ASSISTANT_TEXT.slice(0, 18)), calls.slice(-400))

/* 3) 旧宿主（只有 sessionController.inspect）：回退分支仍然可用。 */
services.sessionQuery = undefined
services.sessionController.inspect = async (sessionId) => (sessionId === 'sess-modern' ? { events: sessionEvents, session: { id: sessionId, title: '旧会话' } } : undefined)
const legacy = await post('/api/sessions/sync', { sessionId: 'sess-modern' })
check('旧宿主 inspect 回退分支仍然可用', legacy.status === 200 && legacy.data.ok === true, JSON.stringify(legacy.data))

server.close()
const failed = checks.filter((item) => !item.ok)
if (failed.length) {
  console.error(`\n${failed.length} 项失败：`)
  for (const item of failed) console.error(`  - ${item.label}`)
  process.exitCode = 1
} else {
  console.log('SESSION_SERVICE_COMPAT_OK: new sessionQuery path, legacy inspect fallback and honest missing-service error')
}
