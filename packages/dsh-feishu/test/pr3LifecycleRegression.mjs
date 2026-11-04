import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import vm from 'node:vm'
import { createHash } from 'node:crypto'
import { createCreationLedger } from '../creationLedger.js'
import { createBackendScope } from '../backendScope.js'
import { schemaSignature, tasklistFields, TASKLIST_SCHEMA_VERSION } from '../tasklistSchema.js'

// Every operation below runs actual production functions with pure mock adapters.
// No index import, credentials, real CLI, API, server, installation or disk state IO.
const source = await readFile(new URL('../index.js', import.meta.url), 'utf8')
const clone = value => JSON.parse(JSON.stringify(value))
function extract(startText, endText) {
  const start = source.indexOf(startText), end = source.indexOf(endText, start)
  assert.ok(start >= 0 && end > start, `production extraction: ${startText}`)
  return source.slice(start, end)
}
const managedSource = extract('  let tasklistFlight = null', '  const settingsHooks = []')
const createSource = extract('  async function createTaskFromSession(', '\n  /**\n   * 从会话记录派生任务草稿')
const syncSource = extract('  async function applyTaskSync()', '\n  async function syncDocs()')
const creationPendingSource = extract('  function creationPending(', '  function pendingCreationWriteBlocked(')
const filterSource = extract('  function filterTasks(', '  function syncTasks(')
const settings = () => ({ cliBackend: 'feishu-sync', cliPath: '/mock/sync', larkCliPath: '/mock/lark', larkAccountMode: 'user', managedTasklist: { enabled: true, guid: 'list', name: 'DSH' }, taskFields: {}, priorityOptions: ['P0','P1'], tasks: { includeCompleted: false }, titlesMigrated: true })
function managedHarness({ phase, mutate, existing = false, unknown = false, initial = {} } = {}) {
  let changed = false, readDefinitions = false
  const calls = [], persisted = []
  const h = { settings: settings(), backendGeneration: 0, lifecycleDisposed: false, state: { tasks: [], managedTasklist: initial, feishuFields: {} },
    schemaSignature, tasklistFields, TASKLIST_SCHEMA_VERSION, randomUUID: () => 'mock-token', nowMs: Date.now,
    resolvePython: () => '/mock/python', resolveCli: () => '/mock/cli', workspaces: () => [],
    writeJson: async () => {}, SETTINGS_FILE: 'mock', safeSyncDetail: String, remoteCache: { fields: new Map() },
    persistState: async () => {
      persisted.push(clone(h.state.managedTasklist))
      const intent = h.state.managedTasklist.pendingFieldChecks
      if (!changed && ((phase && intent?.phase === phase) || (phase === 'empty' && readDefinitions && !intent))) {
        changed = true; mutate(h)
      }
    },
  }
  const bridge = async (_python, payload) => {
    if (payload.fields) {
      readDefinitions = true; calls.push({ backend: h.settings.cliBackend, kind: 'read' })
      return { ok: true, fields: { list: existing ? tasklistFields(h.settings, []).map(row => ({ name: row.name, type: row.type })) : [] } }
    }
    const actions = payload.actions
    if (actions[0].op === 'ensure_tasklist') { calls.push({ backend: h.settings.cliBackend, kind: 'list' }); return { ok: true, actions: [{ ok: true, guid: 'list', name: 'DSH' }] } }
    calls.push({ backend: h.settings.cliBackend, kind: 'fields', names: actions.map(a => a.name) })
    if (unknown) { if (mutate && !changed) { changed = true; mutate(h) }; return { ok: false, actions: actions.map(a => ({ ...a, ok: false, unknownDelivery: true, error: 'mock POST receipt lost' })) } }
    return { ok: true, actions: actions.map(a => ({ ...a, ok: true, guid: 'field:' + a.name })) }
  }
  h.runBridgeRaw = bridge
  h.backendFor = () => ({ actions: (_captured, actions) => bridge(null, { actions }), enrich: (_captured, payload) => bridge(null, payload) })
  vm.createContext(h); vm.runInContext(managedSource, h)
  return { h, calls, persisted }
}
const mutations = {
  field: h => { h.settings.taskFields.doc = '文档-new'; h.backendGeneration++ },
  options: h => { h.settings.priorityOptions.push('P2'); h.backendGeneration++ },
  backend: h => { h.settings.cliBackend = 'lark-cli'; h.backendGeneration++ },
}
// Regression: durable prepared/sending intents are not evidence of actual field IO.
for (const phase of ['prepared', 'sending']) for (const [kind, mutate] of Object.entries(mutations)) {
  const { h, calls } = managedHarness({ phase, mutate })
  const first = await h.ensureManagedTasklist()
  assert.equal(first.ok, false, `${phase}/${kind}: first flight cancels`)
  assert.equal(calls.filter(c => c.kind === 'fields').length, 0, `${phase}/${kind}: no field IO before cancellation`)
  assert.equal(h.state.managedTasklist.pendingFieldChecks, null)
  assert.equal(h.state.managedTasklist.unknownFields.length, 0)
  assert.equal(Object.keys(h.state.managedTasklist.fieldCreationIntents).length, 0)
  const retry = await h.ensureManagedTasklist({ force: true })
  assert.equal(retry.ok, true, `${phase}/${kind}: new configuration is retryable`)
  assert.equal(h.state.managedTasklist.status, 'ready')
  assert.equal(calls.filter(c => c.kind === 'fields').length, 1)
  if (kind === 'field') assert.ok(calls.at(-1).names.includes('文档-new'))
}
// Empty legacy names and a schema consisting entirely of existing fields must not lock another backend.
{
  const initial = { guid: 'list', pendingFieldChecks: { backend: 'feishu-sync', guid: 'list', names: [], phase: 'unknown' } }
  const { h, calls } = managedHarness({ phase: 'empty', mutate: mutations.backend, existing: true, initial })
  assert.equal((await h.ensureManagedTasklist()).ok, false)
  assert.equal(calls.filter(c => c.kind === 'fields').length, 0)
  assert.equal((await h.ensureManagedTasklist({ force: true })).ok, true)
  assert.equal(h.state.managedTasklist.status, 'ready')
  assert.equal(h.state.managedTasklist.pendingFieldChecks, null)
}
// Actual dispatch followed by a lost receipt remains unknown, even after schema changes.
{
  const { h, calls } = managedHarness({ unknown: true, mutate: mutations.options })
  assert.equal((await h.ensureManagedTasklist()).ok, false)
  assert.equal(h.state.managedTasklist.pendingFieldChecks.phase, 'unknown')
  const names = [...h.state.managedTasklist.pendingFieldChecks.names]
  assert.ok(names.length > 0)
  assert.equal((await h.ensureManagedTasklist({ force: true })).ok, false)
  assert.equal(calls.filter(c => c.kind === 'fields').length, 1, 'uncertain POST is never repeated')
  assert.deepEqual([...h.state.managedTasklist.unknownFields], names)
  // Another backend's authoritative reads must not clear A's unresolved intent.
  h.settings.cliBackend = 'lark-cli'; h.backendGeneration++
  assert.equal((await h.ensureManagedTasklist({ force: true })).ok, false)
  assert.equal(calls.filter(c => c.kind === 'fields').length, 2, 'B owns a separate field creation scope')
  h.settings.cliBackend = 'feishu-sync'; h.backendGeneration++
  assert.equal((await h.ensureManagedTasklist({ force: true })).ok, false)
  assert.equal(calls.filter(c => c.kind === 'fields').length, 2, 'returning to A cannot recreate its unknown POST')
}

function creationHarness({ remote, failSaveAt = 0, loaded = {} } = {}) {
  let durable = clone(loaded), saves = 0
  const calls = []
  const h = { settings: settings(), backendGeneration: 0, lifecycleDisposed: false,
    state: { tasks: [], taskCreationReceipts: clone(loaded), relations: [], relationSync: {}, workspaceLinks: {}, workspaceWrites: {} },
    backendContext: { getStore: () => null }, activeCreationKeys: new Set(), createHash, asString: v => v == null ? '' : String(v), nowMs: Date.now,
    updateRelations: () => ({ ok: true, edges: [] }), service: () => undefined, ctx: {},
    ensureManagedTasklist: async () => ({ ok: true, guid: 'list' }), defaultsFromState: () => ({ assignee: 'ou_mock', tasklistGuid: 'list' }),
    extractDocLinks: () => [], persistState: async () => {}, taskNo: () => 1, decorateTitle: title => title,
    writeTaskRelations: async () => ({ ok: true }), syncTasks: async () => ({ ok: true }), linkTask: async () => ({ ok: true }), relationView: () => ({ edges: [] }),
  }
  const impl = {
    createTask: async (captured, input) => { calls.push({ backend: captured.cliBackend, op: 'create', input }); return remote ? remote(h) : { ok: true, guid: 'created', tasklistGuid: 'list' } },
    updateTask: async () => { calls.push({ op: 'rename' }); return { ok: true } },
    actions: async () => { calls.push({ op: 'actions' }); return { ok: true, actions: [] } },
  }
  h.captureBackendScope = () => createBackendScope({ getSettings: () => h.settings, getGeneration: () => h.backendGeneration, isDisposed: () => h.lifecycleDisposed, resolveBackend: () => impl })
  const reload = () => { h.taskCreationLedger = createCreationLedger({ load: async () => clone(durable), save: async rows => {
    saves++; if (saves === failSaveAt) throw new Error('mock durable save failure')
    durable = clone(rows); h.state.taskCreationReceipts = clone(rows)
  }, now: Date.now }) }
  reload(); vm.createContext(h); vm.runInContext(createSource + '\n' + creationPendingSource, h)
  return { h, calls, reload, durable: () => clone(durable) }
}
async function blockedRetries(h, calls, taskId = 'created') {
  for (const input of [{ summary: 'different key' }, { summary: 'follow-up different key', followUp: true, requestId: 'another' }]) {
    const result = await h.createTaskFromSession('session', input)
    assert.equal(result.ok, false); assert.equal(result.taskId, taskId)
  }
  assert.equal(calls.filter(c => c.op === 'create').length, 1)
}
// A creates a GUID, switching to B during create stops everything after POST.
{
  const { h, calls, reload, durable } = creationHarness({ remote: async h => {
    h.settings.cliBackend = 'lark-cli'; h.backendGeneration++
    return { ok: true, guid: 'created', tasklistGuid: 'list' }
  } })
  const result = await h.createTaskFromSession('session', { summary: 'original', requestId: 'original' })
  assert.equal(result.ok, false); assert.equal(result.partial, true); assert.equal(result.taskId, 'created')
  assert.deepEqual(calls.map(c => c.op), ['create'])
  assert.equal(h.state.tasks[0].creationBackend, 'feishu-sync')
  assert.equal(Object.values(durable())[0].status, 'partial')
  assert.equal(Object.values(durable())[0].taskId, 'created')
  await blockedRetries(h, calls)
  // Production applyTaskSync must retain the partial task even when both the
  // remote result and filter exclude it, without relying on a binding or done flag.
  Object.assign(h, {
    backendInfo: () => ({ label: 'mock' }), backend: () => ({ listTasks: async () => ({ ok: true, list: [{ id: 'created', title: 'filtered remote task', done: false }] }) }),
    enrichRemote: async () => {}, normalizeTask: raw => raw, enrichWorkspace: x => x,
    auditBindings: () => false, renumberTasks: () => {},
  })
  for (const name of ['backfillDocTitles','ensureWorkspaceOptions','recordDailyMetrics','fillWorkspaceFields','pushTaskChanges','repairSessionWorkspaces']) h[name] = async () => {}
  h.settings.tasks.keyword = 'does-not-match-any-task'
  h.settings.tasks.dueWithinDays = 0
  vm.runInContext(filterSource + '\n' + syncSource, h)
  assert.equal(h.filterTasks([{ id: 'created', title: 'filtered remote task', done: false }]).length, 0)
  const synced = await h.applyTaskSync()
  assert.equal(synced.ok, true); assert.equal(h.state.tasks.length, 1); assert.equal(h.state.tasks[0].id, 'created')
  assert.equal(h.state.tasks[0].done, false); assert.equal(h.state.bindings, undefined)
  await blockedRetries(h, calls)
  h.state.tasks = []
  await blockedRetries(h, calls)
  reload(); await blockedRetries(h, calls)
  assert.equal(Object.values(await h.taskCreationLedger.list())[0].status, 'partial')
  // A genuinely fresh VM/ledger loaded only from durable receipts still blocks.
  const fresh = creationHarness({ loaded: durable() })
  for (const input of [{ summary: 'new' }, { summary: 'follow-up', followUp: true }]) assert.equal((await fresh.h.createTaskFromSession('session', input)).taskId, 'created')
  assert.equal(fresh.calls.length, 0)
}
// Successful completion is reused by requestId even with changed title/followUp and no tasks snapshot.
{
  const { h, calls, reload } = creationHarness()
  const first = await h.createTaskFromSession('session', { summary: 'done', requestId: 'stable' })
  assert.equal(first.ok, true)
  assert.equal((await h.taskCreationLedger.list())[0].status, 'done')
  h.state.tasks = []; reload()
  const reused = await h.createTaskFromSession('session', { summary: 'changed', requestId: 'stable', followUp: true })
  assert.equal(reused.ok, true); assert.equal(reused.reused, true); assert.equal(reused.taskId, first.taskId)
  assert.equal(calls.length, 1)
}
// Both preparation and sending persistence must succeed before create IO.
for (const failSaveAt of [1, 2]) {
  const { h, calls } = creationHarness({ failSaveAt })
  assert.equal((await h.createTaskFromSession('session', { summary: 'save failure' })).ok, false)
  assert.equal(calls.length, 0, `save ${failSaveAt} must fail closed before IO`)
}
// Definitive failed delivery is retryable; uncertain actual dispatch is not.
for (const unknownDelivery of [false, true]) {
  const { h, calls } = creationHarness({ remote: async () => ({ ok: false, beforeRequest: false, unknownDelivery, detail: 'mock delivery failure' }) })
  assert.equal((await h.createTaskFromSession('session', { summary: 'failed' })).ok, false)
  assert.equal((await h.taskCreationLedger.list())[0].status, unknownDelivery ? 'unknown' : 'failed')
  await h.createTaskFromSession('session', { summary: 'second', followUp: true })
  assert.equal(calls.length, unknownDelivery ? 1 : 2)
}
console.log('PR3_LIFECYCLE_REGRESSION_OK: unsent intent cancellation, actual uncertain POST, persistent partial create, sync retention, reload, reuse and fail-closed saves')
