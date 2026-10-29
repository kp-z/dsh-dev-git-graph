/**
 * 「定时 = DSH 自动化任务」的接线测试。
 *
 * 用假的 schedule 服务把插件跑起来，验的是这条链路真的走通：
 *   1. 会话里已有 DSH 自动化 → 卡片上的「定时」显示它（source='dsh'）；
 *   2. 在面板里改时间 → 写进 DSH（create / update），不再落本地 state.schedules；
 *   3. 清除 → 删 DSH 的那一条；
 *   4. 本地调度器不再对它有 fire 判定（否则 DSH 投一次、本地再开一次）。
 *
 * 跑法：node test/dshBridge.mjs
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

/* ── 假的 DSH schedule 服务 ── */
const SESSION = 'session-bridge'
const records = []
const calls = { create: [], update: [], delete: [] }
let seq = 0
const HOUR = 3_600_000
const at = (ms) => new Date(Date.now() + ms).toISOString()
/* 面板上的 nextText 是本地墙钟（formatStamp），不是 UTC */
const localStamp = (iso) => {
  const d = new Date(iso)
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}

function selectorOf(request) {
  if (request.at) return { kind: 'at', at: request.at }
  if (request.every_seconds) return { kind: 'every', everySeconds: request.every_seconds }
  if (request.daily) return { kind: 'daily', time: request.daily.time }
  if (request.weekly) return { kind: 'weekly', time: request.weekly.time, weekdays: request.weekly.weekdays }
  return { kind: 'cron', expression: request.cron.expression }
}

function recordFrom(request, scheduledAt) {
  const sel = selectorOf(request)
  const rec = { id: `sched-${++seq}`, kind: sel.kind, title: request.title, prompt: request.prompt, scheduledAt }
  if (sel.time) rec.time = sel.time
  if (sel.weekdays) rec.weekdays = sel.weekdays
  if (sel.everySeconds) rec.everySeconds = sel.everySeconds
  if (sel.expression) rec.expression = sel.expression
  return rec
}

const fakeSchedule = {
  async catalog() {
    return records.map((row) => ({ ...row }))
  },
  async list(request) {
    return records.filter((row) => row.sessionId === request.sessionId && row.status === 'active').map(({ sessionId, status, ...rec }) => rec)
  },
  async create(sessionId, request) {
    calls.create.push({ sessionId, request })
    const rec = recordFrom(request, at(HOUR))
    records.push({ ...rec, sessionId, status: 'active' })
    return rec
  },
  async update(request) {
    calls.update.push(request)
    const index = records.findIndex((row) => row.id === request.id && row.sessionId === request.sessionId)
    if (index < 0) return { code: 'schedule_not_found', message: 'gone' }
    const next = { ...records[index] }
    if (request.title) next.title = request.title
    if (request.prompt) next.prompt = request.prompt
    if (request.change) {
      const base = recordFrom(
        {
          title: next.title,
          prompt: next.prompt,
          ...(request.change.daily ? { daily: request.change.daily } : {}),
          ...(request.change.weekly ? { weekly: request.change.weekly } : {}),
          ...(request.change.cron ? { cron: request.change.cron } : {}),
          ...(request.change.at ? { at: request.change.at } : {}),
          ...(request.change.every_seconds ? { every_seconds: request.change.every_seconds } : {}),
        },
        at(2 * HOUR),
      )
      next.kind = base.kind
      delete next.time
      delete next.weekdays
      delete next.everySeconds
      delete next.expression
      for (const key of ['time', 'weekdays', 'everySeconds', 'expression']) {
        if (base[key] !== undefined) next[key] = base[key]
      }
      next.scheduledAt = base.scheduledAt
    }
    records[index] = next
    return { record: next }
  },
  async delete(request) {
    calls.delete.push(request)
    const index = records.findIndex((row) => row.id === request.id && row.sessionId === request.sessionId)
    if (index < 0) return { code: 'schedule_not_found', message: 'gone' }
    records.splice(index, 1)
    return { id: request.id, deleted: true }
  },
}

/* ── 假宿主 ── */
const HOME = await mkdtemp(join(tmpdir(), 'dsh-feishu-bridge-'))
process.env.DSH_HOME = HOME
const DATA = join(HOME, 'dsh-feishu')
await mkdir(DATA, { recursive: true })
await writeFile(join(DATA, 'settings.json'), JSON.stringify({ autoSync: false, cliPath: '/nonexistent/feishu-sync-cli' }))
await writeFile(
  join(DATA, 'state.json'),
  JSON.stringify({
    tasks: [
      {
        id: 'task-1',
        title: 'T0 桥接测试',
        sessionId: SESSION,
        done: false,
        started: true,
        endTs: 0,
        customFields: [],
        members: [],
      },
      {
        id: 'task-2',
        title: 'T9 没绑定会话',
        done: false,
        started: false,
        endTs: 0,
        customFields: [],
        members: [],
      },
    ],
    schedules: {},
  }),
)

const routes = []
const scheduleScope = {
  schedule: fakeSchedule,
  on: () => () => {},
  effect: (fn) => {
    try {
      fn()
    } catch {
      /* ignore */
    }
    return () => {}
  },
}
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
  get: () => undefined,
  inject(deps, cb) {
    if (Array.isArray(deps) && deps.includes('schedule')) cb(scheduleScope)
  },
  tools: { register: () => () => {} },
  webServer: {
    register(route) {
      routes.push(route)
      return () => {}
    },
  },
}

/* 0. 先有 DSH 侧记录（模拟用户在 DSH 里建过） */
records.push({
  id: 'sched-seed',
  kind: 'daily',
  title: 'T0 桥接测试',
  prompt: '继续这条任务：先制定计划，然后按计划开始执行。',
  time: '09:00:00',
  timeZone: 'Asia/Shanghai',
  scheduledAt: at(3 * HOUR),
  sessionId: SESSION,
  status: 'active',
})

const { apply } = await import('../index.js')
apply(ctx, {})
for (let i = 0; i < 100 && routes.length === 0; i += 1) await new Promise((r) => setTimeout(r, 50))
if (routes.length === 0) throw new Error('路由没挂上')

const server = createServer((req, res) => routes[0].handler(req, res))
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
const { port } = server.address()
const base = `http://127.0.0.1:${port}/dsh-feishu`
const getState = async () => (await (await fetch(`${base}/api/state`)).json()).state
const scheduleOf = async () => (await getState()).tasks.find((task) => task.id === 'task-1')?.schedule
const post = async (body) => {
  const response = await fetch(`${base}/api/tasks/schedule`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
  return { status: response.status, body: await response.json() }
}

const initial = await scheduleOf()
check('会话里已有的 DSH 自动化能被显示', initial?.source, 'dsh')
check('显示的是 DSH 的规则', initial?.summary, '每天 09:00')
check('本地不再 fire（避免双投递）', initial?.fire, false)
check('下次时间来自 DSH 记录', initial?.nextText, localStamp(records[0].scheduledAt))

/* 1. 改时间 → 走 DSH update（不新建） */
const updated = await post({ taskId: 'task-1', action: 'set', when: '每周一 10:00', writeBack: false })
check('改时间：请求成功', updated.body.ok, true)
check('改时间：落点是 dsh', updated.body.target, 'dsh')
check('改时间：调了 update 而不是 create', [calls.update.length, calls.create.length], [1, 0])
check('改时间：update 带 weekly 变更', calls.update[0].change.kind, 'weekly')
const afterUpdate = await scheduleOf()
check('改时间：卡片跟着变成每周一', afterUpdate?.summary, '每周一 10:00')
check('改时间：仍然只有一个来源（dsh）', afterUpdate?.source, 'dsh')

/* 2. 清除 → 删 DSH 那一条 */
const cleared = await post({ taskId: 'task-1', action: 'clear' })
check('清除：请求成功', cleared.body.ok, true)
check('清除：调了 delete', calls.delete.length, 1)
check('清除：DSH 侧已空', records.length, 0)
check('清除：卡片没有排期了', await scheduleOf(), null)

/* 3. 重新设 → create（不是 update） */
const created = await post({ taskId: 'task-1', action: 'set', when: '每隔一小时', writeBack: false })
check('新建：落点 dsh', created.body.target, 'dsh')
check('新建：调了 create', [calls.create.length, calls.update.length], [1, 1])
check('新建：selector 是 every_seconds=3600', calls.create[0].request.every_seconds, 3600)
check('新建：提示词是「接着干」那句话', calls.create[0].request.prompt, '继续这条任务：先制定计划，然后按计划开始执行。')
const afterCreate = await scheduleOf()
check('新建后卡片显示每 1 小时', afterCreate?.summary, '每 1 小时')
check('新建后卡片仍是 dsh 来源', afterCreate?.source, 'dsh')

/* 4. 本地排期表始终没被写 */
check('本地 state.schedules 保持空（唯一真相源在 DSH）', Object.keys((await getState()).schedules ?? {}).length, 0)

/* 5. 没绑定会话的任务：不能排期，也没有 chip 数据 */
const unboundState = await getState()
check('没绑定会话 → 卡片没有定时', unboundState.tasks.find((t) => t.id === 'task-2')?.schedule ?? null, null)
const unboundSet = await post({ taskId: 'task-2', action: 'set', when: '每天 9:00', writeBack: false })
check('没绑定会话 → 设置被拒（400）', unboundSet.status, 400)
check('没绑定会话 → 报错说得清原因', /绑定会话/.test(String(unboundSet.body.error)), true)
const unboundPreview = await post({ taskId: 'task-2', action: 'preview', when: '每天 9:00' })
check('没绑定会话 → 预览也拒', unboundPreview.status, 400)
const unboundClear = await post({ taskId: 'task-2', action: 'clear' })
check('没绑定会话 → 清除也拒', unboundClear.status, 400)

/* 6. 一个会话只允许一条：老数据多条时，保存一次收敛成一条 */
records.push({
  id: 'sched-legacy',
  kind: 'daily',
  title: '老任务',
  prompt: '老提示词',
  time: '18:00:00',
  timeZone: 'Asia/Shanghai',
  scheduledAt: at(5 * HOUR),
  sessionId: SESSION,
  status: 'active',
})
check('（准备）会话里现在有两条', records.length, 2)
const consolidated = await post({ taskId: 'task-1', action: 'set', when: '每天 8:00', writeBack: false })
check('多条时保存成功', consolidated.body.ok, true)
check('多条时保存后只剩一条', records.length, 1)
check('留下的是刚保存的那条', calls.update.at(-1)?.change?.kind, 'daily')

/* 5. 预览会说清楚要落到哪 */
const preview = await post({ taskId: 'task-1', action: 'preview', when: '每天 9:00' })
check('预览：落点 dsh', preview.body.target, 'dsh')
check('预览：有下次时间', Boolean(preview.body.preview?.nextText), true)

server.close()
if (failures > 0) {
  console.error(`\n${failures} / ${checks} 项失败`)
  process.exitCode = 1
} else {
  console.log(`\n${checks} 项全部通过`)
}
console.log('\nDSH_BRIDGE_OK')
