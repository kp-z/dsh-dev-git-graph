/**
 * 官方 lark-cli 后端的宿主侧写回回归：
 *   绑定写回开始时间（原生 start + 「开始时间」列）→ 工作区写回 → 完成写回「结束时间」列
 *   → 已完成任务在会话 turn/start 时被重开 → 进度评论走出站账本 → 回声排除。
 *
 * 全部用假 lark-cli（DSH_FEISHU_EXTRA_PATH）和假宿主服务，不联网、不碰真实飞书。
 * 跑法：node test/larkWrites.mjs
 */
import { createServer } from 'node:http'
import { chmod, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { isolatedHome } from './isolatedHome.mjs'

const HOME = await isolatedHome('dsh-feishu-larkwrites-')
const BIN = await mkdtemp(join(tmpdir(), 'dsh-feishu-larkwrites-bin-'))

const TASK = {
  guid: 'task-1',
  summary: '写回链路联调任务',
  description: '',
  completed_at: '0',
  members: [{ id: 'ou_1', role: 'assignee' }],
  tasklists: [{ tasklist_guid: 'list-1' }],
  custom_fields: [],
  dependencies: [],
  url: 'https://x.feishu.cn/task/task-1',
  updated_at: '1700000000000',
}

const FIELDS = [
  { guid: 'fld-ws', name: '工作区', type: 'text' },
  { guid: 'fld-prio', name: '优先级', type: 'text' },
  { guid: 'fld-eta', name: '预期完成', type: 'text' },
  { guid: 'fld-start', name: '开始时间', type: 'text' },
  { guid: 'fld-end', name: '结束时间', type: 'text' },
  { guid: 'fld-status', name: '处理状态', type: 'text' },
]

const FAKE = `#!/bin/sh
echo "$*" >> "$(dirname "$0")/args.log"
cmd="$1"
fakeapi() {
  method="$1"
  path="$2"
  case "$method $path" in
    "GET /open-apis/task/v2/tasks") cat <<'JSON'
{"ok":true,"identity":"user","data":{"items":[${JSON.stringify(TASK)},${JSON.stringify({...TASK,guid:"task-2",summary:"前置任务",custom_fields:[],dependencies:[]})}],"has_more":false}}
JSON
      ;;
    "GET /open-apis/task/v2/tasks/task-1") cat <<'JSON'
{"ok":true,"identity":"user","data":{"task":${JSON.stringify(TASK)}}}
JSON
      ;;
    "PATCH /open-apis/task/v2/tasks/task-1") echo '{"ok":true,"identity":"user","data":{}}' ;;
    "GET /open-apis/task/v2/tasklists/list-1") echo '{"ok":true,"data":{"tasklist":{"guid":"list-1","name":"DSH 任务"}}}' ;;
    "GET /open-apis/task/v2/tasklists") echo '{"ok":true,"data":{"items":[{"guid":"list-1","name":"DSH 任务"}],"has_more":false}}' ;;
    "GET /open-apis/task/v2/custom_fields") cat <<'JSON'
{"ok":true,"data":{"items":${JSON.stringify(FIELDS)}}}
JSON
      ;;
    "GET /open-apis/contact/v3/users/ou_1") echo '{"ok":true,"data":{"user":{"name":"张三"}}}' ;;
    "POST /open-apis/task/v2/comments")
      seq_file="$(dirname "$0")/comment-seq"
      n=$(cat "$seq_file" 2>/dev/null || echo 0)
      n=$((n + 1))
      echo "$n" > "$seq_file"
      printf '{"ok":true,"data":{"comment":{"id":"c-%s"}}}' "$((n + 2))" 
      ;;
    "GET /open-apis/task/v2/comments")
      seq_file="$(dirname "$0")/comment-seq"
      n=$(cat "$seq_file" 2>/dev/null || echo 0)
      extra=""
      if [ "$n" -ge 1 ]; then
        extra=',{"id":"c-3","content":"🤖 进度","creator":{"id":"ou_1","type":"user"},"created_at":"1700000002000"},{"id":"c-4","content":"新的留言","creator":{"id":"ou_1","type":"user"},"created_at":"1700000003000"}'
      fi
      cat <<JSON
{"ok":true,"data":{"items":[{"id":"c-1","content":"历史评论一","creator":{"id":"ou_1","type":"user"},"created_at":"1700000000000"},{"id":"c-2","content":"历史评论二","creator":{"id":"ou_1","type":"user"},"created_at":"1700000001000"}\${extra}],"has_more":false}}
JSON
      ;;
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

const argsLog = async () => readFile(join(BIN, 'args.log'), 'utf8').catch(() => '')

const checks = []
function check(label, ok) {
  checks.push({ label, ok: !!ok })
  console.log(`${ok ? '✓' : '✗'} ${label}`)
}

const routes = []
const handlers = new Map()
const prompts = []
const workspace = { id: 'ws-1', title: 'dsh-plugin', path: '/tmp' }
const services = {
  agents: {
    get: (id) => (id === 'sess-1' ? { id, phase: { kind: 'idle' } } : undefined),
    list: () => [{ id: 'sess-1', session: { title: '假会话' } }],
  },
  sessionController: {
    async prompt(request) { prompts.push(request); return {} },
    async inspect(sessionId) { return sessionId === 'sess-1' ? { id: sessionId } : undefined },
  },
  workspaceRegistry: {
    list: () => [workspace],
    async resolveByPath(path) { return path === workspace.path ? workspace : undefined },
  },
}

const ctx = {
  logger: () => ({ info: () => {}, warn: () => {}, error: () => {} }),
  get: (name) => services[name],
  effect(fn) { fn(); return () => {} },
  on(name, fn) { handlers.set(name, fn); return () => handlers.delete(name) },
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

async function json(path, init) {
  const res = await fetch(base + path, init)
  const text = await res.text()
  try {
    return { status: res.status, data: JSON.parse(text) }
  } catch {
    return { status: res.status, data: { raw: text } }
  }
}
const post = (path, body) =>
  json(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body ?? {}) })

async function waitFor(predicate, timeoutMs = 15_000) {
  const start = Date.now()
  for (;;) {
    const value = await predicate()
    if (value) return value
    if (Date.now() - start > timeoutMs) return null
    await new Promise((resolve) => setTimeout(resolve, 120))
  }
}

const stateOf = async () => (await json('/api/state')).data
const taskOf = async () => ((await stateOf()).state.tasks ?? []).find((task) => task.id === 'task-1')
const argsHas = async (pattern) => pattern.test(await argsLog())

try {
  /* 1. 探活 + 同步：确认走的是官方 lark-cli。 */
  const state = await stateOf()
  check('lark-cli 探活成功', state.state?.cli?.backend === 'lark-cli' && state.state?.cli?.found === true)
  await post('/api/sync')
  const synced = await waitFor(async () => {
    const snap = await stateOf()
    return snap.state?.syncing === false && (snap.state?.tasks?.length ?? 0) > 0 ? snap : null
  })
  check('同步拿到任务', !!synced && (await taskOf())?.title === TASK.summary)

  /* 2. 绑定会话 = 开始计时：写原生 start + 「开始时间」列。 */
  const link = await post('/api/tasks/link', { taskId: 'task-1', sessionId: 'sess-1' })
  check('绑定会话成功', link.status === 200 && link.data.ok === true)
  const startWritten = await waitFor(() => argsHas(/fld-start/))
  check('绑定写回「开始时间」列（走 lark PATCH，不再走 Python 桥）', !!startWritten)
  check('绑定同时写回原生 start 时间', await argsHas(/"start":\{"timestamp":"\d+"/))

  /* 3. 工作区写回：本地 pending 落定 + 「工作区」列。 */
  const bind = await post('/api/workspaces/bind', { taskId: 'task-1', workspaceId: 'ws-1' })
  check('工作区绑定本地成功', bind.status === 200 && bind.data.ok === true)
  const settled = await waitFor(async () => {
    const task = await taskOf()
    return task?.workspaceWrite?.pending === false ? task : null
  })
  check('工作区写回落定且无错误', !!settled && !settled.workspaceWrite?.error)
  check('工作区写回「工作区」列', await argsHas(/fld-ws/))

  /* 4. 优先级 / 预期完成 / 关系 / 挂起：都走官方接口。 */
  const prio = await post('/api/tasks/priority', { taskId: 'task-1', value: 'P1' })
  check('优先级写回', prio.data?.ok === true && (await argsHas(/fld-prio/)))
  const eta = await post('/api/tasks/eta', { taskId: 'task-1', when: '明天 18:00' })
  check('预期完成写回', eta.data?.ok === true && eta.data?.sync?.ok === true && (await argsHas(/fld-eta/)))
  const rel = await post('/api/tasks/relations', { taskId: 'task-1', action: 'set', predecessorIds: ['task-2'] })
  check('关系写回原生依赖', rel.status === 200 && rel.data?.ok === true && (await argsHas(/add_dependencies/)))
  const suspend = await post('/api/tasks/suspension', { taskId: 'task-1', action: 'suspend', reason: '自测' })
  check('挂起写回处理状态', suspend.data?.ok === true && (await argsHas(/fld-status/)))
  await post('/api/tasks/suspension', { taskId: 'task-1', action: 'resume' })

  /* 5. 完成：写 completed_at + 「结束时间」列。 */
  const done = await post('/api/tasks/complete', { taskId: 'task-1' })
  check('完成写回', done.data?.ok === true && (await argsHas(/"completed_at":"\d+"/)))
  check('完成写回「结束时间」列', await argsHas(/fld-end/))

  /* 6. 已完成任务在会话 turn/start 时被重开：PATCH completed_at=0。 */
  await new Promise((resolve) => setTimeout(resolve, 300))
  const turnStart = handlers.get('session/event')
  check('宿主事件总线已挂上 session/event', typeof turnStart === 'function')
  // 任务已完成且绑着会话：turn/start 时引擎应把远端任务重开。
  turnStart?.({ id: 'sess-1' }, { type: 'turn/start', time: Date.now() + 60_000, data: { turn: 2, sessionId: 'sess-1' } })
  const reopened = await waitFor(async () => (await argsHas(/"completed_at":"0"/)) || null, 15_000)
  check('已完成任务被会话重开（PATCH completed_at=0）', !!reopened)

  /* 7. 评论协作基线：第一次同步只记录历史，不投递。 */
  await post('/api/settings', { comments: { enabled: true, ownerMode: 'off', otherMode: 'off' } })
  await post('/api/sync')
  const baseline = await waitFor(async () => {
    const sync = (await stateOf()).state?.commentSync
    const row = (sync?.diagnostics ?? []).find((item) => item.taskId === 'task-1')
    return row?.baseline === true ? row : null
  })
  check('评论协作首次同步建立基线（不投递历史评论）', !!baseline && baseline.readCount === 2)

  /* 8. 进度评论走出站账本（AI 回复信封 + 真实评论 ID）。 */
  turnStart?.({ id: 'sess-1' }, { type: 'tool/call', time: Date.now(), data: { name: 'edit', args: { file_path: '/tmp/x.js' } } })
  turnStart?.({ id: 'sess-1' }, { type: 'assistant/message', time: Date.now(), data: { message: { content: [{ type: 'text', text: '改了 /tmp/x.js 并跑过测试。' }] } } })
  turnStart?.({ id: 'sess-1' }, { type: 'turn/end', time: Date.now(), data: { turn: 3, reason: { kind: 'done' } } })
  const commentWritten = await waitFor(async () => (await argsHas(/"content":"\[🤖AI 回复\]/)) || null, 15_000)
  check('进度评论写回（AI 回复信封）', !!commentWritten)
  const commentsFile = JSON.parse(await readFile(join(HOME, 'dsh-feishu', 'comments.json'), 'utf8').catch(() => 'null'))
  const ledger = Object.values(commentsFile?.outbound ?? {})
  if (!ledger.length) console.log('  DEBUG ledger:', JSON.stringify({ commentsFile, args: (await argsLog()).split('\n').filter((line) => line.includes('comments')).slice(-5) }))
  check('出站账本记下真实评论 ID（回声排除依据）', ledger.some((row) => row.status === 'sent' && row.commentId === 'c-3'))

  /* 9. 再同步：自己写的评论按账本排除，别人的新留言进收件箱（关闭处理时标 ignored）。 */
  await post('/api/sync')
  const entries = await waitFor(async () => {
    const rows = (await json('/api/comments')).data?.entries ?? []
    return rows.length >= 2 ? rows : null
  })
  if (!entries) console.log('  DEBUG entries:', JSON.stringify({ entries: (await json('/api/comments')).data?.entries, sync: (await stateOf()).state?.commentSync }))
  const echo = (entries ?? []).find((entry) => entry.commentId === 'c-3')
  const other = (entries ?? []).find((entry) => entry.commentId === 'c-4')
  check('自己写的评论被回声排除（reason=outbound-ledger）', echo?.reason === 'outbound-ledger')
  check('别人的新留言进入收件箱（owner/other 关闭时标 ignored）', other?.status === 'ignored')
  await post('/api/settings', { comments: { enabled: false } })
} finally {
  server.close()
}

const failed = checks.filter((item) => !item.ok)
if (failed.length > 0) {
  console.error(`\n${failed.length} 项失败：`)
  for (const item of failed) console.error(`  - ${item.label}`)
  process.exit(1)
}
console.log('\nLARK_WRITES_OK')
