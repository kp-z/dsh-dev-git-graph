#!/usr/bin/env node
/** Offline suspension HTTP/tool wiring, Host lifecycle and retry regression.
 * Run: node packages/dsh-feishu/test/suspensionBridge.mjs
 * No real Feishu CLI, credentials, schedules or sessions are used.
 */
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { chmod, mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const HOME = await mkdtemp(join(tmpdir(), 'dsh-feishu-suspension-'))
process.env.DSH_HOME = HOME
const DATA = join(HOME, 'dsh-feishu')
const STATE = join(DATA, 'state.json')
await mkdir(DATA, { recursive: true })
// Existing explicit fake path prevents resolveCli probing a real installed CLI.
const CLI = join(HOME, 'nonexistent-feishu-sync-cli')
await writeFile(CLI, `#!${process.execPath}\nif (process.argv[2] === 'version') console.log('feishu-sync 0.0.0-offline');\nelse { console.error('offline fixture: no credentials'); process.exitCode = 1; }\n`)
await chmod(CLI, 0o700)
await writeFile(join(DATA, 'settings.json'), JSON.stringify({ autoSync: false, cliPath: CLI, writeBack: false }))
const clone = (value) => structuredClone(value)
const disk = async () => JSON.parse(await readFile(STATE, 'utf8'))
const future = new Date(Date.now() + 86_400_000).toISOString()
const past = new Date(Date.now() - 86_400_000).toISOString()
const tasks = [
  { id: 'running', sessionId: 'session-running', started: true },
  { id: 'prearchived', sessionId: 'session-prearchived' },
  { id: 'partial', sessionId: 'session-partial' },
  { id: 'archive-failure', sessionId: 'session-archive-failure' },
  { id: 'unarchive-failure', sessionId: 'session-unarchive-failure' },
  { id: 'baseline-failure', sessionId: 'session-baseline-failure' },
  { id: 'external', sessionId: 'session-external' },
  { id: 'deleted-record', sessionId: 'session-deleted-record' },
  { id: 'concurrent', sessionId: 'session-concurrent' },
  { id: 'unbound' },
  { id: 'done', done: true, sessionId: 'session-done' },
  { id: 'held-start', sessionId: 'session-held-start', boundOnly: true, workspacePath: '/offline/workspace' },
].map((task) => ({ title: `Fixture ${task.id}`, done: false, started: false, members: [], customFields: [], meta: {}, ...task }))
await writeFile(STATE, JSON.stringify({ tasks, schedules: {}, suspensions: {}, bindings: {} }))

const records = []
function seed(sessionId, id, kind = 'daily', extra = {}) {
  const record = { id, sessionId, kind, title: id, prompt: `Continue ${id}`, scheduledAt: future, status: 'active', ...extra }
  if (kind === 'daily') Object.assign(record, { time: '09:00:00', timeZone: 'Asia/Shanghai' })
  records.push(record)
  return record
}
seed('session-running', 'daily')
seed('session-running', 'weekly', 'weekly', { time: '10:15:00', timeZone: 'Asia/Shanghai', weekdays: [1, 5] })
seed('session-running', 'every', 'every', { everySeconds: 3600 })
seed('session-running', 'cron', 'cron', { expression: '0 9 * * 1-5', timeZone: 'Asia/Shanghai' })
seed('session-running', 'at', 'at')
seed('session-running', 'after', 'after', { afterSeconds: 600 })
seed('session-running', 'expired-at', 'at', { scheduledAt: past })
seed('session-running', 'expired-after', 'after', { afterSeconds: 10, scheduledAt: past })
seed('session-running', 'old-inactive', 'daily', { status: 'inactive', lastDelivery: { messageId: 'history-kept' } })
seed('session-prearchived', 'prearchived-inactive', 'daily', { status: 'inactive' })
seed('session-partial', 'partial-1')
seed('session-partial', 'partial-2', 'every', { everySeconds: 7200 })
seed('session-archive-failure', 'archive-retry')
seed('session-unarchive-failure', 'unarchive-retry')
seed('session-external', 'external-original')
seed('session-deleted-record', 'deleted-original')
seed('session-concurrent', 'concurrent-original')
seed('other-session', 'other-active')
const archived = new Set(['session-prearchived'])
const calls = { archive: [], unarchive: [], create: [], delete: [], update: [], follow: [], cleanup: 0, agents: [], prompt: [], attach: [] }
const faults = { archive: new Set(), unarchive: new Set(), createTitle: new Set(), baseline: false }
const gateObservations = []
const workspace = { title: 'Offline', sessionIds: [], async attachSession(id) { calls.attach.push(id); this.sessionIds.push(id) } }
const registry = {
  async resolveByPath() { return workspace },
  async archiveSession(sessionId, options) {
    calls.archive.push({ sessionId, options: clone(options) })
    const state = await disk()
    const task = tasks.find((item) => item.sessionId === sessionId)
    gateObservations.push(state.suspensions[task.id]?.active === true)
    assert.equal(options?.stopActivity, true, 'running archive explicitly stops activity')
    if (faults.archive.has(sessionId)) throw new Error('mock archive failure')
    archived.add(sessionId)
    // The real Host archives active reminders by marking them inactive, retaining history.
    for (const row of records) if (row.sessionId === sessionId && row.status === 'active') row.status = 'inactive'
    return { archivedSessionIds: [...archived] }
  },
  async unarchiveSession(sessionId) {
    calls.unarchive.push(sessionId)
    if (faults.unarchive.has(sessionId)) throw new Error('mock unarchive failure')
    archived.delete(sessionId)
    return { archivedSessionIds: [...archived] }
  },
}
const controller = {
  async *follow(signal) {
    calls.follow.push(signal)
    assert.ok(signal instanceof AbortSignal)
    try {
      if (faults.baseline) throw new Error('mock baseline unavailable')
      yield { type: 'baseline', value: { items: [], archivedSessionIds: [...archived], pinnedSessionIds: [] } }
      // A consumer must read only the baseline and then close this live stream.
      assert.fail('suspension consumed beyond the first baseline')
    } finally { calls.cleanup += 1 }
  },
}
let sequence = 0
const fakeSchedule = {
  async catalog() { return clone(records) },
  async list({ sessionId }) { return clone(records.filter((row) => row.sessionId === sessionId && row.status === 'active').map(({ sessionId, status, ...row }) => row)) },
  async create(sessionId, request) {
    calls.create.push({ sessionId, request: clone(request) })
    if (faults.createTitle.has(request.title)) throw new Error(`mock create failure: ${request.title}`)
    const selectors = ['at', 'after_seconds', 'every_seconds', 'daily', 'weekly', 'cron'].filter((key) => request[key] !== undefined)
    assert.equal(selectors.length, 1, 'restore emits exactly one Host selector')
    assert.equal(typeof request.title, 'string')
    assert.equal(typeof request.prompt, 'string')
    const selector = selectors[0]
    const kind = ({ after_seconds: 'after', every_seconds: 'every' })[selector] ?? selector
    const row = { id: `restored-${++sequence}`, kind, title: request.title, prompt: request.prompt, scheduledAt: typeof request.at === 'string' ? request.at : future }
    if (request.every_seconds) row.everySeconds = request.every_seconds
    if (request.after_seconds) row.afterSeconds = request.after_seconds
    if (request.daily || request.weekly || request.cron) {
      const rule = request.daily ?? request.weekly ?? request.cron
      Object.assign(row, { ...rule, timeZone: rule.time_zone })
      delete row.time_zone
    }
    records.push({ ...row, sessionId, status: 'active' })
    return clone(row)
  },
  async delete(request) { calls.delete.push(request); assert.fail('suspension must not delete schedule history') },
  async update(request) { calls.update.push(request); assert.fail('inactive schedules must restore by create, not update') },
}
const { apply } = await import('../index.js')
let checks = 0
async function test(name, fn) { await fn(); checks += 1; console.log(`✓ ${name}`) }
async function boot() {
  const routes = []
  const tools = new Map()
  const effects = []
  const errors = []
  const services = {
    schedule: fakeSchedule, workspaceRegistry: registry, workspaceController: controller,
    agents: { async create(request) { calls.agents.push(request); assert.fail('held task must not activate an agent') } },
    sessionController: { async prompt(request) { calls.prompt.push(request); assert.fail('held task must not prompt a session') } },
  }
  const ctx = {
    logger: () => ({ info() {}, warn() {}, error(message) { errors.push(message) } }),
    get: (name) => services[name],
    on: () => () => {},
    effect(fn) { const dispose = fn(); if (typeof dispose === 'function') effects.push(dispose); return () => {} },
    inject(dependencies, fn) { if (dependencies.every((name) => services[name])) fn({ ...ctx, ...services }) },
    tools: { register(tool) { tools.set(tool.name, tool); return () => tools.delete(tool.name) } },
    webServer: { register(route) { routes.push(route); return () => {} } },
  }
  apply(ctx, {})
  const deadline = Date.now() + 5000
  while (!routes.length || !tools.has('feishu_tasks')) {
    if (Date.now() > deadline) throw new Error(`Fixture did not mount: ${errors.join('; ')}`)
    await new Promise((resolve) => setTimeout(resolve, 20))
  }
  const server = createServer((req, res) => routes[0].handler(req, res))
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const base = `http://127.0.0.1:${server.address().port}/dsh-feishu/api`
  return {
    tools,
    async state() { return (await (await fetch(`${base}/state`, { signal: AbortSignal.timeout(5000) })).json()).state },
    async post(taskId, action, extra = {}, route = 'tasks/suspension') {
      const response = await fetch(`${base}/${route}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ taskId, action, writeBack: false, ...extra }), signal: AbortSignal.timeout(5000) })
      return { status: response.status, body: await response.json() }
    },
    async close() { effects.reverse().forEach((dispose) => dispose()); server.closeAllConnections(); await new Promise((resolve) => server.close(resolve)) },
  }
}
let app = await boot()
const suspension = async (id) => (await app.state()).tasks.find((task) => task.id === id)?.suspension
try {
  await test('suspend commits gate before Host archive and captures only prior active reminders', async () => {
    const result = await app.post('running', 'suspend', { reason: '等待外部交付' })
    assert.equal(result.status, 200)
    assert.equal(result.body.ok, true)
    const held = await suspension('running')
    assert.equal(held.active, true)
    assert.equal(held.reason, '等待外部交付')
    assert.ok(held.at)
    assert.equal(held.sessionId, 'session-running')
    assert.equal(held.archiveOwned, true)
    assert.deepEqual(held.schedules.map((row) => row.record.id).sort(), ['after', 'at', 'cron', 'daily', 'every', 'expired-after', 'expired-at', 'weekly'].sort())
    assert.ok(held.schedules.every((row) => ['captured', 'paused'].includes(row.status)))
    assert.deepEqual((await disk()).suspensions.running, held)
    assert.ok(gateObservations.every(Boolean), 'local gate persisted before Host side effects')
    assert.equal(records.find((row) => row.id === 'old-inactive').lastDelivery.messageId, 'history-kept')
    assert.equal(records.find((row) => row.id === 'other-active').status, 'active')
    assert.equal(calls.cleanup, calls.follow.length)
    assert.equal(calls.delete.length, 0)
  })
  await test('status and repeated suspend are idempotent; held start is rejected before activation', async () => {
    const before = await suspension('running')
    const count = calls.archive.length
    assert.equal((await app.post('running', 'status')).body.ok, true)
    assert.deepEqual(await suspension('running'), before)
    assert.equal((await app.post('running', 'suspend', { reason: 'duplicate' })).body.ok, true)
    assert.equal(calls.archive.length, count)
    await app.post('held-start', 'suspend')
    const result = await app.post('held-start', '', { id: 'held-start' }, 'tasks/start')
    assert.equal(result.status, 400)
    assert.match(result.body.error, /挂起|suspend|held/i)
    assert.deepEqual([calls.agents.length, calls.prompt.length], [0, 0])
  })
  await test('restart retains suspension and resumes each eligible rule once without deleting history', async () => {
    const before = await suspension('running')
    await app.close()
    app = await boot()
    assert.deepEqual(await suspension('running'), before)
    const result = await app.post('running', 'resume')
    assert.equal(result.status, 200)
    assert.equal(result.body.ok, true)
    assert.ok(result.body.warnings?.length, 'expired one-shot records report warnings')
    const resumed = await suspension('running')
    assert.equal(resumed.active, false)
    assert.ok(resumed.resumedAt)
    assert.equal(archived.has('session-running'), false)
    const created = calls.create.filter((call) => call.sessionId === 'session-running')
    assert.equal(created.length, 6)
    const request = (title) => created.find((call) => call.request.title === title)?.request
    assert.deepEqual(request('daily').daily, { time: '09:00:00', time_zone: 'Asia/Shanghai' })
    assert.deepEqual(request('weekly').weekly, { time: '10:15:00', time_zone: 'Asia/Shanghai', weekdays: [1, 5] })
    assert.equal(request('every').every_seconds, 3600)
    assert.deepEqual(request('cron').cron, { expression: '0 9 * * 1-5', time_zone: 'Asia/Shanghai' })
    assert.equal(request('at').at, future)
    assert.equal(request('after').at, future, 'relative one-shot retains committed target rather than restarting its delay')
    assert.equal(resumed.schedules.filter((row) => row.status === 'restored' && row.newId).length, 6)
    assert.equal(resumed.schedules.filter((row) => row.status === 'skipped').length, 2)
    assert.ok(records.some((row) => row.id === 'old-inactive' && row.status === 'inactive'))
    const count = calls.create.length
    await app.post('running', 'resume')
    assert.equal(calls.create.length, count)
    assert.equal(calls.unarchive.filter((id) => id === 'session-running').length, 1)
    assert.equal(calls.delete.length, 0)
  })
  await test('pre-existing archive ownership and old inactive reminders remain untouched', async () => {
    assert.equal((await app.post('prearchived', 'suspend')).body.ok, true)
    const held = await suspension('prearchived')
    assert.equal(held.archiveOwned, false)
    assert.deepEqual(held.schedules, [])
    assert.equal((await app.post('prearchived', 'resume')).body.ok, true)
    assert.equal(archived.has('session-prearchived'), true)
    assert.ok(!calls.unarchive.includes('session-prearchived'))
    assert.ok(!calls.create.some((call) => call.request.title === 'prearchived-inactive'))
  })
  await test('unbound tasks support local suspend/resume and completed/unknown tasks reject', async () => {
    const archiveCount = calls.archive.length
    assert.equal((await app.post('unbound', 'suspend')).body.ok, true)
    assert.equal((await suspension('unbound')).active, true)
    assert.equal((await app.post('unbound', 'resume')).body.ok, true)
    assert.equal((await suspension('unbound')).active, false)
    assert.equal(calls.archive.length, archiveCount)
    for (const [id, action] of [['done', 'suspend'], ['missing', 'suspend'], ['unbound', 'invalid']]) {
      const result = await app.post(id, action)
      assert.equal(result.status, 400)
      assert.equal(result.body.ok, false)
    }
    assert.ok(!(await disk()).suspensions.done?.active)
  })
  await test('resume failures are local success with warnings and retry only unresolved records', async () => {
    await app.post('partial', 'suspend')
    faults.createTitle.add('partial-2')
    const partial = await app.post('partial', 'resume')
    assert.equal(partial.body.ok, true)
    assert.ok(partial.body.warnings?.length)
    assert.equal((await suspension('partial')).active, true, 'failed restore keeps safety gate until retry succeeds')
    assert.ok((await suspension('partial')).errors.length)
    const succeeded = calls.create.filter((call) => call.request.title === 'partial-1').length
    await app.close()
    app = await boot()
    faults.createTitle.delete('partial-2')
    assert.equal((await app.post('partial', 'resume')).body.ok, true)
    assert.equal(calls.create.filter((call) => call.request.title === 'partial-1').length, succeeded)
    assert.ok((await suspension('partial')).schedules.every((row) => row.status === 'restored' && row.newId))
    assert.equal((await suspension('partial')).active, false)
  })
  await test('archive errors retain local gate and allow suspend retry without schedule loss', async () => {
    faults.archive.add('session-archive-failure')
    const partial = await app.post('archive-failure', 'suspend')
    assert.equal(partial.body.ok, true)
    assert.ok(partial.body.warnings?.length)
    assert.equal((await suspension('archive-failure')).active, true)
    faults.archive.delete('session-archive-failure')
    await app.post('archive-failure', 'suspend')
    assert.equal(archived.has('session-archive-failure'), true)
    await app.post('archive-failure', 'resume')
    assert.equal(calls.create.filter((call) => call.request.title === 'archive-retry').length, 1)
  })
  await test('unarchive errors retain the safety gate and remain retryable', async () => {
    await app.post('unarchive-failure', 'suspend')
    faults.unarchive.add('session-unarchive-failure')
    const result = await app.post('unarchive-failure', 'resume')
    assert.equal(result.body.ok, true)
    assert.ok(result.body.warnings?.length)
    assert.equal((await suspension('unarchive-failure')).active, true)
    faults.unarchive.delete('session-unarchive-failure')
    await app.post('unarchive-failure', 'resume')
    assert.equal(archived.has('session-unarchive-failure'), false)
    assert.equal(calls.create.filter((call) => call.request.title === 'unarchive-retry').length, 1)
  })
  await test('active external records are never recreated by recovery', async () => {
    await app.post('external', 'suspend')
    records.find((row) => row.id === 'external-original').status = 'active'
    seed('session-external', 'external-new')
    await app.post('external', 'resume')
    assert.equal(calls.create.filter((call) => call.sessionId === 'session-external').length, 0)
    assert.equal(records.find((row) => row.id === 'external-new').status, 'active')
  })
  await test('externally deleted reminders are not resurrected on resume', async () => {
    await app.post('deleted-record', 'suspend')
    const index = records.findIndex((row) => row.id === 'deleted-original')
    assert.ok(index >= 0)
    records.splice(index, 1) // external deletion, never the suspension service
    const result = await app.post('deleted-record', 'resume')
    assert.equal(result.body.ok, true)
    assert.ok(result.body.warnings?.length)
    assert.equal(calls.create.filter((call) => call.request.title === 'deleted-original').length, 0)
    assert.equal((await suspension('deleted-record')).schedules[0].status, 'skipped')
  })
  await test('concurrent suspend and resume serialize without duplicate side effects', async () => {
    const held = await Promise.all([app.post('concurrent', 'suspend'), app.post('concurrent', 'suspend')])
    assert.ok(held.every((result) => result.body.ok))
    assert.equal(calls.archive.filter((call) => call.sessionId === 'session-concurrent').length, 1)
    const resumed = await Promise.all([app.post('concurrent', 'resume'), app.post('concurrent', 'resume')])
    assert.ok(resumed.every((result) => result.body.ok))
    assert.equal(calls.create.filter((call) => call.request.title === 'concurrent-original').length, 1)
  })
  await test('workspace repair skips held sessions while still repairing normal sessions', async () => {
    // This private function is reached only after a successful remote sync. Execute
    // its exact production body in isolation, avoiding any credential/remote reads.
    const source = await readFile(new URL('../index.js', import.meta.url), 'utf8')
    const declaration = source.match(/  async function repairSessionWorkspaces\(\) \{[\s\S]*?\n  \}/)?.[0]
    assert.ok(declaration, 'private workspace repair implementation found')
    const repaired = []
    const localRegistry = {
      async resolveByPath() { return { title: 'Offline', sessionIds: [], async attachSession(id) { repaired.push(['attach', id]) } } },
      async unarchiveSession(id) { repaired.push(['unarchive', id]) },
    }
    const repair = new Function('state', 'ctx', 'awaitService', 'isSuspended', 'log', `${declaration}\nreturn repairSessionWorkspaces`)(
      { tasks: [{ id: 'held', sessionId: 'held-session', workspacePath: '/offline' }, { id: 'normal', sessionId: 'normal-session', workspacePath: '/offline' }] },
      {}, async () => localRegistry, (id) => id === 'held', () => {},
    )
    await repair()
    assert.deepEqual(repaired, [['attach', 'normal-session'], ['unarchive', 'normal-session']])
  })
  await test('baseline errors warn without losing the gate and always close the generator', async () => {
    faults.baseline = true
    const result = await app.post('baseline-failure', 'suspend')
    faults.baseline = false
    assert.equal(result.body.ok, true)
    assert.ok(result.body.warnings?.length)
    assert.equal((await suspension('baseline-failure')).active, true)
    assert.equal(calls.cleanup, calls.follow.length)
  })
  await test('feishu_task_suspend uses the same persisted suspend/resume/status contract', async () => {
    const tool = app.tools.get('feishu_task_suspend')
    assert.ok(tool, 'suspension tool registered')
    assert.ok(tool.parameters.properties.action.enum.includes('status'))
    const context = { agent: { id: 'session-held-start' } }
    const held = await suspension('held-start')
    const status = await tool.execute({ taskId: 'held-start', action: 'status', writeBack: false }, context)
    assert.equal(typeof status, 'string')
    assert.deepEqual(await suspension('held-start'), held)
    await tool.execute({ taskId: 'held-start', action: 'resume', writeBack: false }, context)
    assert.equal((await suspension('held-start')).active, false)
    await tool.execute({ taskId: 'unbound', action: 'suspend', reason: '工具挂起', writeBack: false }, context)
    assert.equal((await suspension('unbound')).reason, '工具挂起')
    await tool.execute({ taskId: 'unbound', action: 'resume', writeBack: false }, context)
    assert.equal((await suspension('unbound')).active, false)
    assert.equal(calls.delete.length, 0)
  })
  console.log(`\n${checks} suspension bridge scenarios passed`)
} finally { await app.close() }
