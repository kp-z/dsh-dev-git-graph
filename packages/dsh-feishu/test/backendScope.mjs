import assert from 'node:assert/strict'
import { AsyncLocalStorage } from 'node:async_hooks'
import { readFile } from 'node:fs/promises'
import vm from 'node:vm'
import { createBackendScope } from '../backendScope.js'

// Pure adapters only: importing the module never starts a CLI, server or API.
const clone = value => JSON.parse(JSON.stringify(value))
const base = () => ({ cliBackend: 'A', cliPath: '/mock/a', larkCliPath: '/mock/lark', larkAccountMode: 'user', taskFields: { doc: '文档' }, priorityOptions: ['P0'] })
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r }); return { promise, resolve } }
function harness(impl = {}) {
  let settings = base(), generation = 0, disposed = false
  const calls = []
  const adapters = Object.fromEntries(['A', 'B'].map(backend => [backend, Object.fromEntries(['actions','probe','check','listTasks','docInfo','docRead','createTask','updateTask','complete','comment','enrich'].map(method => [method, async (captured, ...args) => {
    calls.push({ backend, method, settings: clone(captured), args })
    return impl[method] ? impl[method](captured, ...args) : { ok: true }
  }]))]))
  return { calls, get settings() { return settings }, set settings(value) { settings = value }, bump() { generation++ }, dispose() { disposed = true }, capture(beforeActions) { return createBackendScope({ getSettings: () => settings, getGeneration: () => generation, isDisposed: () => disposed, resolveBackend: id => adapters[id], beforeActions }) } }
}

// Generation fences A -> B -> A even when the final fingerprint equals the first.
{
  const h = harness(), old = h.capture()
  h.settings = { ...h.settings, cliBackend: 'B' }; h.bump()
  const b = h.capture(); assert.equal((await b.probe()).ok, true)
  h.settings = { ...h.settings, cliBackend: 'A' }; h.bump()
  assert.equal(old.valid(), false); assert.equal(b.valid(), false)
  assert.equal((await old.createTask({ summary: 'never' })).stale, true)
  assert.equal((await b.comment('task', 'never')).stale, true)
  const current = h.capture(); assert.equal(current.generation, 2)
  assert.equal((await current.check()).ok, true)
  assert.deepEqual(h.calls.map(x => [x.backend, x.method]), [['B','probe'], ['A','check']])
}
for (const [field, value] of [['cliPath','/mock/a2'], ['larkCliPath','/mock/lark2'], ['larkAccountMode','bot']]) {
  const h = harness(), scope = h.capture()
  h.settings[field] = value
  assert.equal(scope.valid(), false, `${field} invalidates without changing backend`)
  assert.equal((await scope.updateTask('task', {})).ok, false)
  assert.equal(h.calls.length, 0)
}
{
  const h = harness(), scope = h.capture()
  h.settings.taskFields.doc = 'new'; h.settings.priorityOptions.push('P1')
  assert.equal(scope.settings.taskFields.doc, '文档')
  assert.deepEqual(scope.settings.priorityOptions, ['P0'])
  await scope.enrich({ fields: ['list'] })
  assert.equal(h.calls[0].settings.taskFields.doc, '文档', 'adapter gets captured deep settings, not live object')
  h.dispose(); assert.equal((await scope.complete('task')).stale, true)
}
// A confirmed completion already dispatched before unload remains committable;
// disposal is not a backend switch, and must not regress main's lifecycle drain.
{
  const gate = deferred(), h = harness({ complete: () => gate.promise }), scope = h.capture()
  const completing = scope.complete('task')
  h.dispose(); gate.resolve({ ok: true })
  assert.equal((await completing).ok, true)
  assert.equal((await scope.complete('task')).stale, true)
  assert.equal(h.calls.length, 1)
}
// A read already in flight can return evidence, but no write may dispatch afterward.
{
  const gate = deferred(), h = harness({ docRead: () => gate.promise }), scope = h.capture()
  const read = scope.docRead('url')
  h.settings.cliBackend = 'B'; h.bump(); gate.resolve({ ok: true, text: 'old account' })
  const result = await read
  assert.equal(result.ok, false); assert.equal(result.stale, true); assert.equal(result.receipt.text, 'old account')
  assert.equal((await scope.actions([{ op: 'set_custom_field', task: 't' }])).ok, false)
  assert.deepEqual(h.calls.map(x => x.method), ['docRead'])
}
// Stale successful writes never report ok; unknown receipts are never downgraded.
for (const row of [
  { op: 'task_comment', ok: true },
  { op: 'task_comment', ok: false, unknownDelivery: true },
  { op: 'task_comment', ok: false, beforeRequest: false, unknownDelivery: false },
  { op: 'task_get', ok: true },
]) {
  const gate = deferred(), h = harness({ actions: () => gate.promise }), scope = h.capture()
  const pending = scope.actions([{ op: row.op, task: 't' }])
  h.bump(); gate.resolve({ ok: row.ok, actions: [row] })
  const result = await pending, actual = result.actions[0]
  assert.equal(result.ok, false); assert.equal(actual.ok, false); assert.equal(actual.stale, true)
  assert.equal(actual.unknownDelivery, row.unknownDelivery === true || (row.ok && row.op !== 'task_get'))
  assert.equal(actual.receipt, row)
}
{
  const h = harness(), blocked = { ok: false, beforeRequest: false, actions: [{ op: 'task_comment', ok: false, unknownDelivery: false }] }
  const scope = h.capture(() => blocked)
  assert.equal(await scope.actions([{ op: 'task_comment' }]), blocked)
  assert.equal(h.calls.length, 0, 'policy rejection is definitive and dispatches nothing')
}

// Execute production IO preflights, not a regex approximation of their behavior.
const source = await readFile(new URL('../index.js', import.meta.url), 'utf8')
function productionFunction(name, nextName) {
  const start = source.indexOf(`function ${name}(`), end = source.indexOf(`\nfunction ${nextName}(`, start)
  assert.ok(start >= 0 && end > start, `production ${name} extraction`)
  return source.slice(start, end)
}
const context = new AsyncLocalStorage()
let spawned = 0, apiCalls = 0
const sandbox = { backendIOContext: context, process: { env: {} }, asString: String,
  execFile(_command, _args, _opts, cb) { spawned++; cb(null, 'mock', '') },
  larkJson: async () => { apiCalls++; return { ok: true } } }
vm.createContext(sandbox)
vm.runInContext(productionFunction('runCommand', 'parseJson'), sandbox)
vm.runInContext(productionFunction('larkApi', 'larkAvatarUrl'), sandbox)
const rejected = await context.run({ valid: () => false }, async () => [await sandbox.runCommand('mock', []), await sandbox.larkApi(base(), 'POST', '/mock')])
for (const result of rejected) { assert.equal(result.ok, false); assert.equal(result.beforeRequest, true) }
assert.equal(spawned, 0); assert.equal(apiCalls, 0)
await context.run({ valid: () => true }, async () => { assert.equal((await sandbox.runCommand('mock', [])).ok, true); assert.equal((await sandbox.larkApi(base(), 'GET', '/mock')).ok, true) })
assert.equal(spawned, 1); assert.equal(apiCalls, 1)
console.log('BACKEND_SCOPE_OK: generation, identity, captured settings, stale receipts and production preflight without real IO')
