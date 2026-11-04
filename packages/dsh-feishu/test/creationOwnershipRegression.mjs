import assert from 'node:assert/strict'
import { AsyncLocalStorage } from 'node:async_hooks'
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import vm from 'node:vm'
import { createBackendScope } from '../backendScope.js'
import { createCreationLedger } from '../creationLedger.js'
const source = await readFile(new URL('../index.js', import.meta.url), 'utf8')
const extract = name => { const m = source.match(new RegExp('  (?:async )?function ' + name + '\\([^]*?\\n  }')); assert.ok(m, name); return m[0] }
const store = new AsyncLocalStorage(), calls = []
const h = { backendContext: store, activeCreationKeys: new Set(), createHash, settings: { cliBackend: 'A', cliPath: 'fake', managedTasklist: { enabled: true, guid: 'list' }, comments: {}, contextInjection: false }, state: { tasks: [], taskCreationReceipts: {}, relations: [], relationSync: {}, workspaceLinks: {}, workspaceWrites: {}, suspensions: {} }, lifecycleDisposed: false, asString: v => v == null ? '' : String(v), nowMs: Date.now, updateRelations: () => ({ ok: true, edges: [] }), service: () => undefined, ctx: {}, ensureManagedTasklist: async () => ({ ok: true, guid: 'list' }), defaultsFromState: () => ({ assignee: 'self', tasklistGuid: 'list' }), extractDocLinks: () => [], persistState: async () => {}, taskNo: () => 1, decorateTitle: x => x, syncTasks: async () => ({ ok: true }), relationView: () => ({}), sessionExists: async () => true, renameSession: async () => ({ ok: true }), writeStartToFeishu: async () => ({ ok: true }), fillWorkspaceFields: async () => {}, log: () => {} }
const impl = { createTask: async () => { calls.push('create'); return { ok: true, guid: 'created', tasklistGuid: 'list' } }, actions: async (_settings, actions) => { calls.push(actions[0].op); return { ok: true, actions: actions.map(a => ({ op: a.op, ok: true, task: { guid: a.task } })) } }, complete: async () => { calls.push('complete'); return { ok: true } }, updateTask: async () => { calls.push('update'); return { ok: true } }, comment: async () => { calls.push('comment'); return { ok: true } } }
const newScope = () => createBackendScope({ getSettings: () => h.settings, getGeneration: () => 0, isDisposed: () => h.lifecycleDisposed, resolveBackend: () => impl, beforeActions: actions => h.pendingCreationWriteBlocked(actions) })
h.captureBackendScope = () => store.getStore() || newScope()
let finishes = 0
const loadLedger = () => {
  h.taskCreationLedger = createCreationLedger({ load: async () => structuredClone(h.state.taskCreationReceipts), save: async rows => { h.state.taskCreationReceipts = structuredClone(rows) } })
  const finish = h.taskCreationLedger.finish
  h.taskCreationLedger.finish = (...args) => { finishes++; return finish(...args) }
}
loadLedger(); vm.createContext(h)
vm.runInContext(['creationPending','pendingCreationWriteBlocked','linkTask','createTaskFromSession'].map(extract).join('\n'), h)
h.writeTaskRelations = async () => {
  // The row is created and active, but only its actual owner context is allowed
  // to proceed. Another request must not inherit the global active-key exemption.
  assert.equal(h.creationPending('created'), false)
  const external = newScope()
  await store.run(external, async () => {
    assert.equal(h.creationPending('created'), true)
    for (const invoke of [() => external.complete('created'), () => external.updateTask('created', { summary: 'wrong' }), () => external.comment('created', 'wrong'), () => external.actions([{ op: 'task_reopen', task: 'created' }])]) assert.equal((await invoke()).ok, false)
  })
  return { ok: true }
}
const owner = newScope()
const result = await store.run(owner, () => h.createTaskFromSession('session', { summary: 'normal', requestId: 'one' }))
assert.equal(result.ok, true); assert.equal(result.bound, true)
assert.equal(finishes, 1, 'real linkTask cannot prematurely finish the active creation')
assert.deepEqual(calls, ['create'], 'owned binding needs no recovery RPC and external mutations dispatch nothing')
assert.equal(Object.values(h.state.taskCreationReceipts)[0].status, 'done')
assert.equal(h.state.tasks[0].boundOnly, true); assert.equal(owner.creationKey, undefined)
// An external operation is allowed normally after the receipt is committed.
assert.equal((await store.run(newScope(), () => h.captureBackendScope().complete('created'))).ok, true)
assert.deepEqual(calls, ['create','complete'])
// A genuine stopped partial receipt still goes through explicit authoritative
// manual binding recovery, not the active-owner fast path.
const receipt = Object.values(h.state.taskCreationReceipts)[0]
receipt.status = 'partial'; loadLedger()
assert.equal(h.creationPending('created'), true)
const recovered = await store.run(newScope(), () => h.linkTask('created', 'session', 'manual'))
assert.equal(recovered.ok, true)
assert.equal(Object.values(h.state.taskCreationReceipts)[0].status, 'done')
assert.deepEqual(calls, ['create','complete','task_get'])
console.log('CREATION_OWNERSHIP_OK: actual create+link finish once, active owner exemption never leaks, all typed mutations guarded, manual recovery retained')
