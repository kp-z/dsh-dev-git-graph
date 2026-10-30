#!/usr/bin/env node
/** Offline Host latency/singleflight and revision-safe workspace write regression.
 * Run: node packages/dsh-feishu/test/performanceBridge.mjs
 */
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { chmod, mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const HOME = await mkdtemp(join(tmpdir(), 'dsh-feishu-performance-'))
process.env.DSH_HOME = HOME
const DATA = join(HOME, 'dsh-feishu')
await mkdir(DATA, { recursive: true })
const CLI = join(HOME, 'offline-feishu-sync-cli')
await writeFile(CLI, `#!${process.execPath}\nif (process.argv[2] === 'version') console.log('feishu-sync 0.0.0-offline');\nelse { console.error('offline fixture refuses credentials and remote calls'); process.exitCode = 1; }\n`)
await chmod(CLI, 0o700)
await writeFile(join(DATA, 'settings.json'), JSON.stringify({ autoSync: false, cliPath: CLI }))
await writeFile(join(DATA, 'state.json'), JSON.stringify({ tasks: [{ id: 'bound', title: 'Offline bound task', sessionId: 'session-performance', done: false, started: false, members: [], customFields: [], meta: {} }], schedules: {}, workspaceLinks: {}, workspaceWrites: {} }))
const clone = (value) => structuredClone(value)
function deferred() {
  let resolve, reject
  const promise = new Promise((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}
async function until(predicate, message, timeout = 2000) {
  const deadline = Date.now() + timeout
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error(message)
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
}
let checks = 0
async function test(name, run) {
  let timer
  try {
    await Promise.race([run(), new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`Scenario timed out: ${name}`)), 4000) })])
    checks += 1
    console.log(`✓ ${name}`)
  } finally { clearTimeout(timer) }
}

const { apply } = await import('../index.js')
const catalogGate = deferred()
let catalogCalls = 0
const routes = []
const tools = new Map()
const effects = []
const listeners = new Map()
const errors = []
const fakeSchedule = {
  async catalog() { catalogCalls += 1; return catalogGate.promise },
  async list() { return [] },
}
const services = { schedule: fakeSchedule, workspaceRegistry: { list() { return [] } } }
const ctx = {
  logger: () => ({ info() {}, warn() {}, error(message) { errors.push(message) } }),
  get: (name) => services[name],
  effect(fn) { const dispose = fn(); if (typeof dispose === 'function') effects.push(dispose); return () => {} },
  on(name, fn) { listeners.set(name, fn); return () => listeners.delete(name) },
  inject(dependencies, fn) { if (dependencies.every((name) => services[name])) fn({ ...ctx, ...services }) },
  tools: { register(tool) { tools.set(tool.name, tool); return () => tools.delete(tool.name) } },
  webServer: { register(route) { routes.push(route); return () => {} } },
}
apply(ctx, {})
await until(() => routes.length && tools.has('feishu_tasks'), `Host did not mount: ${errors.join('; ')}`, 5000)
const server = createServer((req, res) => routes[0].handler(req, res))
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
const base = `http://127.0.0.1:${server.address().port}/dsh-feishu/api`
async function snapshot() {
  const response = await fetch(`${base}/state`, { signal: AbortSignal.timeout(1200) })
  assert.equal(response.status, 200)
  const body = await response.json()
  assert.equal(body.ok, true)
  return body
}
try {
  await test('state snapshots return immediately while initial catalog remains unresolved', async () => {
    const started = performance.now()
    const body = await snapshot()
    assert.equal(body.state.tasks[0].id, 'bound')
    assert.ok(performance.now() - started < 1000, 'state response must not await slow catalog')
    assert.equal(catalogCalls, 1)
  })
  await test('concurrent state reads and forced schedule events share one catalog refresh', async () => {
    const bodies = await Promise.all(Array.from({ length: 12 }, () => snapshot()))
    assert.equal(bodies.length, 12)
    for (let i = 0; i < 5; i += 1) listeners.get('schedule/changed')?.()
    assert.equal(catalogCalls, 1, 'forced/event refresh joins the pending flight too')
    catalogGate.resolve([{ id: 'schedule-performance', sessionId: 'session-performance', status: 'active', kind: 'daily', title: 'Offline reminder', prompt: 'Continue offline', time: '09:00:00', timeZone: 'Asia/Shanghai', scheduledAt: new Date(Date.now() + 86_400_000).toISOString() }])
    let body
    const deadline = Date.now() + 2000
    do {
      body = await snapshot()
      if (body.state.tasks[0].schedule?.recordId === 'schedule-performance') break
      if (Date.now() > deadline) throw new Error('resolved catalog never reached snapshot cache')
      await new Promise((resolve) => setTimeout(resolve, 10))
    } while (true)
    assert.equal(catalogCalls, 1, 'warm TTL cache avoids another catalog read')
  })
} finally {
  catalogGate.resolve([])
  effects.reverse().forEach((dispose) => dispose())
  server.closeAllConnections()
  await new Promise((resolve) => server.close(resolve))
}

// Private workspace worker runs against controlled bridge Promises. The exact
// production declarations are compiled here, not reimplemented in the fixture.
// No production Python process, real CLI or credential file can be reached.
const source = await readFile(new URL('../index.js', import.meta.url), 'utf8')
function workspaceFixture() {
  const start = source.indexOf('  /** 把任务上的「工作区」字段写到飞书')
  const end = source.indexOf('  /** 把改名后的工作区标题写回飞书', start)
  assert.ok(start >= 0 && end > start, 'workspace worker declaration bounds found')
  const declarations = source.slice(start, end)
  const task = { id: 'task', tasklistGuid: 'list', title: 'Offline task', meta: { workspace: '' }, customFields: [] }
  const state = { tasks: [task], workspaceLinks: {}, workspaceWrites: {} }
  const bridges = []
  const persisted = []
  let clock = Date.now()
  const dependencies = {
    state,
    settings: { cliPath: CLI, taskFields: { workspace: '工作区' } },
    asString: (value) => typeof value === 'string' ? value : '',
    nowMs: () => clock,
    defaultsFromState: () => ({ tasklistGuid: 'list' }),
    resolvePython: () => 'offline-mock-python',
    resolveCli: () => CLI,
    runBridge: async (python, request) => {
      assert.equal(python, 'offline-mock-python')
      const gate = deferred()
      bridges.push({ request: clone(request), gate })
      return gate.promise
    },
    persistState: async () => { persisted.push(clone(state)) },
    workspaceList: () => [{ id: 'one', title: 'Workspace One', path: '/offline/one' }, { id: 'two', title: 'Workspace Two', path: '/offline/two' }],
    ctx: {}, log() {},
  }
  // Worker/retry declaration names are selected only from production source.
  const names = [...declarations.matchAll(/(?:async )?function ([A-Za-z_$][\w$]*)\(/g)].map((match) => match[1])
  const api = new Function(...Object.keys(dependencies), `${declarations}\nreturn {${names.join(',')}}`)(...Object.values(dependencies))
  return { api, state, task, bridges, persisted, advance(milliseconds) { clock += milliseconds } }
}
function bridgeResult(ok, error = '') { return { ok, actions: [{ ok, error }], errors: error ? [error] : [] } }
const fixture = workspaceFixture()
await test('workspace bind returns local success with pending write while bridge remains blocked', async () => {
  const started = performance.now()
  const result = await fixture.api.bindWorkspace('task', 'one')
  assert.equal(result.ok, true)
  assert.equal(result.workspace.id, 'one')
  assert.equal(result.writeBack.pending, true)
  assert.ok(performance.now() - started < 1000)
  assert.equal(fixture.state.workspaceLinks.task.id, 'one')
  assert.equal(fixture.state.workspaceWrites.task.title, 'Workspace One')
  assert.equal(fixture.state.workspaceWrites.task.pending, true)
  assert.ok(fixture.persisted.some((state) => state.workspaceWrites.task?.pending), 'pending write is persisted before return')
  await until(() => fixture.bridges.length === 1, 'first worker did not start')
})
await test('rapid rebind serializes remote writes and old completion cannot replace latest metadata', async () => {
  const revision = fixture.state.workspaceWrites.task.revision
  const second = await fixture.api.bindWorkspace('task', 'two')
  assert.equal(second.writeBack.pending, true)
  assert.equal(fixture.state.workspaceLinks.task.id, 'two')
  assert.equal(fixture.task.meta.workspace, 'Workspace Two')
  assert.ok(fixture.state.workspaceWrites.task.revision > revision)
  assert.equal(fixture.bridges.length, 1, 'same task cannot run two remote writes concurrently')
  fixture.bridges[0].gate.resolve(bridgeResult(true))
  await until(() => fixture.bridges.length === 2, 'latest revision did not run after first completion')
  assert.equal(fixture.task.meta.workspace, 'Workspace Two')
  assert.notEqual(fixture.task.customFields.find((field) => field.name === '工作区')?.value, 'Workspace One', 'stale worker must not project obsolete field value')
  assert.equal(fixture.state.workspaceWrites.task.title, 'Workspace Two')
  assert.equal(fixture.state.workspaceWrites.task.pending, true)
  assert.equal(fixture.bridges[1].request.actions[0].value, 'Workspace Two')
  fixture.bridges[1].gate.resolve(bridgeResult(true))
  await until(() => fixture.state.workspaceWrites.task.pending === false, 'latest write never settled')
  assert.equal(fixture.task.customFields.find((field) => field.name === '工作区')?.value, 'Workspace Two')
})
await test('background failure preserves pending state and retry writes only the newest value', async () => {
  const retryName = Object.keys(fixture.api).find((name) => /retry.*Workspace|retryWorkspace/i.test(name))
  assert.ok(retryName, 'bounded workspace retry function exists')
  await fixture.api.bindWorkspace('task', 'one')
  await until(() => fixture.bridges.length === 3, 'failure worker did not start')
  fixture.bridges[2].gate.resolve(bridgeResult(false, 'mock write denied'))
  await until(() => Boolean(fixture.state.workspaceWrites.task.error), 'failure was not recorded')
  assert.equal(fixture.state.workspaceWrites.task.pending, true)
  assert.equal(fixture.state.workspaceWrites.task.title, 'Workspace One')
  assert.ok(fixture.persisted.some((state) => state.workspaceWrites.task?.pending && state.workspaceWrites.task.error), 'failure persists for sync/restart retry')
  await fixture.api[retryName]()
  assert.equal(fixture.bridges.length, 3, 'recent failure respects retry backoff')
  fixture.advance(31_000)
  const retry = fixture.api[retryName]()
  await until(() => fixture.bridges.length === 4, 'bounded retry did not restart worker')
  fixture.bridges[3].gate.resolve(bridgeResult(true))
  await retry
  await until(() => !fixture.state.workspaceWrites.task.pending, 'successful retry remains pending')
  assert.equal(fixture.task.meta.workspace, 'Workspace One')
  assert.equal(fixture.task.customFields.find((field) => field.name === '工作区')?.value, 'Workspace One')
})
await test('clear binds an empty latest value asynchronously and invalid IDs do not enqueue writes', async () => {
  const cleared = await fixture.api.bindWorkspace('task', '')
  assert.equal(cleared.ok, true)
  assert.equal(cleared.writeBack.pending, true)
  assert.equal(fixture.state.workspaceLinks.task, undefined)
  assert.equal(fixture.task.meta.workspace, '')
  await until(() => fixture.bridges.length === 5, 'clear write did not start')
  assert.equal(fixture.bridges[4].request.actions[0].value, '')
  fixture.bridges[4].gate.resolve(bridgeResult(true))
  await until(() => !fixture.state.workspaceWrites.task.pending, 'clear write remains pending')
  assert.ok(!fixture.task.customFields.some((field) => field.name === '工作区'))
  for (const [task, id] of [['missing', 'one'], ['task', 'missing']]) assert.equal((await fixture.api.bindWorkspace(task, id)).ok, false)
  assert.equal(fixture.bridges.length, 5)
})
await test('a failed obsolete write cannot poison or overwrite a newer binding', async () => {
  const stale = workspaceFixture()
  await stale.api.bindWorkspace('task', 'one')
  await until(() => stale.bridges.length === 1, 'obsolete worker did not start')
  await stale.api.bindWorkspace('task', 'two')
  stale.bridges[0].gate.resolve(bridgeResult(false, 'obsolete failure'))
  await until(() => stale.bridges.length === 2, 'new revision did not replace failed obsolete write')
  assert.equal(stale.state.workspaceWrites.task.title, 'Workspace Two')
  assert.ok(!stale.state.workspaceWrites.task.error, 'obsolete error must not be assigned to new revision')
  assert.equal(stale.task.meta.workspace, 'Workspace Two')
  stale.bridges[1].gate.resolve(bridgeResult(true))
  await until(() => !stale.state.workspaceWrites.task.pending, 'new revision did not settle')
})
await test('persisted failed writes remain retryable after constructing a fresh worker', async () => {
  const original = workspaceFixture()
  await original.api.bindWorkspace('task', 'one')
  await until(() => original.bridges.length === 1, 'restart fixture did not start')
  original.bridges[0].gate.resolve(bridgeResult(false, 'persisted failure'))
  await until(() => original.persisted.some((state) => state.workspaceWrites.task?.error), 'failure not persisted before restart')
  const saved = original.persisted.at(-1)
  const restarted = workspaceFixture()
  Object.assign(restarted.state, clone(saved))
  restarted.advance(31_000)
  const retryName = Object.keys(restarted.api).find((name) => /retry.*Workspace|retryWorkspace/i.test(name))
  await restarted.api[retryName]()
  await until(() => restarted.bridges.length === 1, 'fresh worker did not retry persisted pending item')
  assert.equal(restarted.bridges[0].request.actions[0].value, 'Workspace One')
  restarted.bridges[0].gate.resolve(bridgeResult(true))
  await until(() => !restarted.state.workspaceWrites.task.pending, 'restart retry did not settle')
  assert.equal(restarted.state.tasks[0].customFields.find((field) => field.name === '工作区')?.value, 'Workspace One')
})
await test('sync retries are bounded to five task workers per pass', async () => {
  const many = workspaceFixture()
  const retryName = Object.keys(many.api).find((name) => /retry.*Workspace|retryWorkspace/i.test(name))
  many.state.tasks = Array.from({ length: 8 }, (_, index) => ({ id: `retry-${index}`, tasklistGuid: 'list', meta: {}, customFields: [] }))
  many.state.workspaceWrites = Object.fromEntries(many.state.tasks.map((task) => [task.id, { title: 'Workspace One', revision: 1, pending: true, error: 'old failure', at: 0 }]))
  await many.api[retryName]()
  await until(() => many.bridges.length >= 5, 'retry pass did not launch eligible workers')
  assert.equal(many.bridges.length, 5, 'a sync pass must not fan out unbounded writes')
  for (const bridge of many.bridges) bridge.gate.resolve(bridgeResult(true))
  await until(() => Object.values(many.state.workspaceWrites).filter((item) => !item.pending).length === 5, 'bounded retry batch did not settle')
  assert.equal(Object.values(many.state.workspaceWrites).filter((item) => item.pending).length, 3)
})
console.log(`\n${checks} performance bridge scenarios passed`)
