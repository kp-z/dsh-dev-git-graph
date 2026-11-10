import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { basename } from 'node:path'
import vm from 'node:vm'
import { createCreationLedger } from '../creationLedger.js'
/* 用生产实现而不是复制一份算法：load() 现在也要归一化自定义目录。 */
import { normalizeGroups } from '../workspaceGroups.js'

// Run the actual production load/normalization/retry functions in an isolated VM.
// Only reading production source/modules is real IO. State/settings reads and
// writes, old-port discovery, model calls and every remote effect are fake.
// No plugin import, server, CLI, credentials or filesystem state is involved.
const source = await readFile(new URL('../index.js', import.meta.url), 'utf8')
const extract = name => {
  const match = source.match(new RegExp('  (?:async )?function ' + name + '\\([^]*?\\n  }'))
  assert.ok(match, `production function ${name} must exist`)
  return match[0]
}
const defaults = source.match(/const DEFAULT_STATE = \{[^]*?\n}/)
assert.ok(defaults, 'production DEFAULT_STATE must exist')
const plain = value => JSON.parse(JSON.stringify(value))
const OLD = 'https://tenant.feishu.cn/docx/OLD'
const NEW = 'https://tenant.feishu.cn/docx/NEW'
const legacy = {
  tasks: [{ id: 'task', title: 'Legacy bound task', sessionId: 'legacy-session', started: true, docs: [{ url: OLD, source: '生成' }], pendingDocReceipt: { backend: 'lark-cli', document: 'OLD', url: OLD, at: 1 } }],
  bindings: { task: { sessionId: 'legacy-session', started: true } },
  pendingDocReceipts: { task: { backend: 'lark-cli', document: 'OLD', url: OLD, at: 1 } },
  managedTasklist: { guid: 'legacy-list', status: 'ready' },
  syncHistory: [{ id: 'legacy-sync', status: 'done' }],
}
const newReceipt = { backend: 'lark-cli', document: 'NEW', url: NEW, at: 2 }
const fieldScope = JSON.stringify(['lark-cli', 'current-list'])
const fieldIntent = { backend: 'lark-cli', guid: 'current-list', names: ['文档'], phase: 'unknown' }
const makeTaskReceipt = (status, taskId = 'created-task') => ({
  key: 'current-create', status, sessionId: 'current-session', backend: 'lark-cli',
  summary: 'Current uncertain task', ...(taskId ? { taskId } : {}),
  creation: { tasklistGuid: 'current-list' }, updatedAt: 2,
})

function harness(current, old = legacy) {
  const reads = [], writes = [], adoptionCalls = [], effects = [], logs = []
  const unexpected = name => async (...args) => {
    effects.push({ name, args })
    throw new Error(`unexpected effect after recovery: ${name}`)
  }
  const h = {
    state: { sessionSeen: { 'early-session': 7 } }, settings: {},
    SETTINGS_FILE: 'FAKE_SETTINGS', stateFile: 'FAKE_CURRENT_STATE',
    DEFAULT_SETTINGS: { cliBackend: 'lark-cli', taskFields: {}, autoStartPrompt: 'current-default' },
    LEGACY_AUTO_START_PROMPTS: [],
    sanitizeSettings: (_saved, defaults) => plain(defaults),
    readJson: async (file, fallback) => {
      reads.push(file)
      if (file === h.SETTINGS_FILE) return {}
      assert.equal(file, h.stateFile, 'load must only read fake current state/settings')
      return plain(current ?? fallback)
    },
    writeJson: async (file, value) => { writes.push({ file, value: plain(value) }) },
    adoptPreviousState: async file => {
      adoptionCalls.push(file)
      return old ? { file: 'FAKE_OLD_PORT_STATE', data: plain(old) } : null
    },
    basename, log: (_ctx, level, message) => { logs.push({ level, message }) }, ctx: {},
    lifecycleDisposed: false, stateLoaded: false, cli: {}, earlyReopenTurns: new Map(),
    recoverSyncHistory: rows => Array.isArray(rows) ? plain(rows) : [],
    normalizeGroups,
    rememberSelfUser: () => {}, applySelfNames: () => {},
    reopenSessionTasks: unexpected('reopen'),
    asString: value => value == null ? '' : String(value), nowMs: () => 12345,
    // Peripheral task metadata is deterministic; receipt/binding precedence is
    // controlled by the actual normalizeTask function, not a copied algorithm.
    selectTaskList: () => ({ guid: '' }), cached: () => undefined,
    remoteCache: { tasklists: new Map(), fields: new Map(), users: new Map() },
    REMOTE_TTL: { tasklists: 1, fields: 1, users: 1 },
    customFieldValue: () => '', readFieldConfig: () => ({}), parseTaskMeta: () => ({}),
    ETA_FIELD_DEFAULT: '预期完成', formatDay: () => '', formatStamp: () => '', extractDocLinks: () => [],
    backendContext: { getStore: () => null }, activeCreationKeys: new Set(), createHash,
    captureBackendScope: () => ({ backend: 'lark-cli', valid: () => true,
      actions: unexpected('remote actions'), createTask: unexpected('task create') }),
    askModelLong: unexpected('model'), pushDocField: unexpected('doc field write'),
    ensureManagedTasklist: unexpected('managed tasklist initialization'),
    service: () => { throw new Error('recovery must stop before Cordis service lookup') },
    activityFeed: { changed: () => {} },
  }
  h.taskCreationLedger = createCreationLedger({
    load: async () => h.state.taskCreationReceipts || {},
    save: async rows => { h.state.taskCreationReceipts = rows; await h.persistState() },
    now: h.nowMs,
  })
  vm.createContext(h)
  h.feishuTaskNo = () => 0
  vm.runInContext(defaults[0] + '\n' + ['load', 'persistState', 'creationPending', 'normalizeTask', 'createTaskDoc', 'createTaskFromSession'].map(extract).join('\n'), h)
  return { h, reads, writes, adoptionCalls, effects, logs }
}

async function assertCurrent(current) {
  const t = harness(current)
  await t.h.load()
  assert.equal(t.h.stateLoaded, true)
  for (const key of ['pendingDocReceipts', 'taskCreationReceipts', 'managedTasklist']) {
    if (current[key]) assert.deepEqual(plain(t.h.state[key]), current[key], `${key}: load must preserve current authority, not replace it with legacy state`)
  }
  assert.deepEqual(t.adoptionCalls, [], 'empty tasks with current authority must not consult/adopt an older port')
  assert.equal(t.h.state.tasks.some(task => task.sessionId === 'legacy-session'), false, 'must not resurrect an old binding/task')
  assert.deepEqual(t.reads, ['FAKE_SETTINGS', 'FAKE_CURRENT_STATE'])
  assert.deepEqual(t.writes, [], 'ordinary load must not write state/settings')
  assert.deepEqual(t.effects, [])
  assert.equal(t.h.state.sessionSeen['early-session'], 7, 'early session observations survive load')
  return t
}

const cases = []
const test = (name, run) => cases.push({ name, run })
test('empty filtered tasks retain NEW independent document Map and block normalized/Map-only retry', async () => {
  const current = { tasks: [], pendingDocReceipts: { task: newReceipt } }
  const t = await assertCurrent(current)
  assert.deepEqual(plain(t.h.state.pendingDocReceipts), current.pendingDocReceipts)
  const raw = { guid: 'task', summary: 'Returned filtered task', completed_at: '0', tasklists: [], custom_fields: [] }
  const normalized = t.h.normalizeTask(raw, new Map())
  assert.deepEqual(plain(normalized.pendingDocReceipt), newReceipt)
  assert.notEqual(normalized.pendingDocReceipt, t.h.state.pendingDocReceipts.task, 'normalization copies receipt')
  assert.equal(normalized.sessionId, null, 'older port binding must not return')
  t.h.state.tasks = [normalized]
  for (const mapOnly of [false, true]) {
    if (mapOnly) delete normalized.pendingDocReceipt
    const result = await t.h.createTaskDoc('task')
    assert.equal(result.ok, false); assert.equal(result.partial, true)
    assert.equal(result.url, NEW, 'retry retains NEW, never rolls back to OLD')
    assert.deepEqual(plain(normalized.pendingDocReceipt), newReceipt)
  }
  assert.deepEqual(t.effects, [], 'recovered receipt blocks every model/remote/field effect')
  assert.deepEqual(t.writes, [], 'blocked retry does not persist')
})

for (const [status, taskId] of [['partial', 'created-task'], ['unknown', 'created-task'], ['unknown', null]]) {
  test(`empty tasks retain ${status} creation receipt${taskId ? ' with GUID' : ' without GUID'} and reject duplicate create`, async () => {
    const receipt = makeTaskReceipt(status, taskId)
    const current = { tasks: [], taskCreationReceipts: { [receipt.key]: receipt } }
    const t = await assertCurrent(current)
    assert.deepEqual(plain(t.h.state.taskCreationReceipts), current.taskCreationReceipts)
    if (taskId) {
      const recovered = t.h.state.tasks.find(task => task.id === taskId)
      assert.ok(recovered, 'load recovers locally known partial task')
      assert.equal(recovered.creationPending, true)
      assert.equal(recovered.creationReceiptKey, receipt.key)
    } else assert.equal(t.h.state.tasks.length, 0, 'unknown receipt without GUID cannot invent a task')
    for (const input of [{ summary: 'changed request' }, { summary: 'follow-up retry', followUp: true, requestId: 'new-key' }]) {
      const result = await t.h.createTaskFromSession(receipt.sessionId, input)
      assert.equal(result.ok, false)
      assert.equal(result.partial, Boolean(taskId))
      assert.equal(result.taskId, taskId || undefined)
      assert.match(result.error, /未核对.*创建回执/)
    }
    assert.deepEqual(t.effects, [], 'unresolved receipt blocks create and managed setup')
    assert.deepEqual(t.writes, [], 'partial/unknown retry never rewrites state')
  })
}

for (const [label, managedTasklist] of [
  ['scoped fieldCreationIntents', { guid: 'current-list', status: 'unknown', fieldCreationIntents: { [fieldScope]: fieldIntent } }],
  ['legacy pendingFieldChecks', { guid: 'current-list', status: 'unknown', pendingFieldChecks: fieldIntent }],
  ['unknown list creation token', { guid: '', status: 'unknown', createToken: 'current-create-token' }],
]) test(`empty tasks preserve ${label} independently`, async () => {
  const t = await assertCurrent({ tasks: [], managedTasklist })
  assert.deepEqual(plain(t.h.state.managedTasklist), managedTasklist)
  assert.equal(t.h.state.tasks.length, 0)
})

test('truly fresh empty object still adopts legacy task/session/document state', async () => {
  const t = harness({})
  await t.h.load()
  assert.deepEqual(t.adoptionCalls, ['FAKE_CURRENT_STATE'])
  assert.deepEqual(plain(t.h.state.tasks), legacy.tasks)
  assert.deepEqual(plain(t.h.state.bindings), legacy.bindings)
  assert.deepEqual(plain(t.h.state.pendingDocReceipts), legacy.pendingDocReceipts)
  assert.deepEqual(plain(t.h.state.syncHistory), legacy.syncHistory)
  assert.equal(t.h.state.sessionSeen['early-session'], 7)
  assert.deepEqual(t.writes, []); assert.deepEqual(t.effects, [])
})

test('ordinary nonempty current task never adopts legacy state', async () => {
  const tasks = [{ id: 'current-task', title: 'Current normal task', sessionId: 'current-session', docs: [] }]
  const t = await assertCurrent({ tasks })
  assert.deepEqual(plain(t.h.state.tasks), tasks)
})

test('transactional empty snapshot keeps current sync history, not legacy history', async () => {
  const syncHistory = [{ id: 'current-sync', status: 'done' }]
  const current = { tasks: [], syncHistory, pendingDocReceipts: { task: newReceipt },
    taskCreationReceipts: { 'current-create': makeTaskReceipt('partial') },
    managedTasklist: { guid: 'current-list', fieldCreationIntents: { [fieldScope]: fieldIntent } } }
  const t = await assertCurrent(current)
  for (const key of ['syncHistory', 'pendingDocReceipts', 'taskCreationReceipts', 'managedTasklist']) {
    assert.deepEqual(plain(t.h.state[key]), current[key], `${key} must remain current authority`)
  }
})

test('real legacy selector prefers newest receipt-only snapshot over older bound tasks', async () => {
  const fn = source.match(/export async function adoptPreviousState\([^]*?\n}/)?.[0]
  assert.ok(fn)
  const data = {
    '/mock/state-old.json': { tasks: [{ id: 'task', sessionId: 'old-session', docs: [{ url: OLD, source: '生成' }] }] },
    '/mock/state-new.json': { tasks: [], pendingDocReceipts: { task: newReceipt } },
  }
  const h = { dirname: () => '/mock', join: (...parts) => parts.join('/'), readdir: async () => ['state-old.json','state-new.json'], readJson: async file => plain(data[file]), stat: async file => ({ mtimeMs: file.includes('-new') ? 2 : 1 }) }
  vm.createContext(h); vm.runInContext(fn.replace('export ', ''), h)
  const chosen = await h.adoptPreviousState('/mock/state.json')
  assert.equal(chosen.file, '/mock/state-new.json')
  assert.deepEqual(plain(chosen.data.pendingDocReceipts), { task: newReceipt })
  // Without any receipt or binding the newest blank file remains ineligible,
  // preserving main's original fallback to the latest bound legacy snapshot.
  data['/mock/state-new.json'] = { tasks: [] }
  assert.equal((await h.adoptPreviousState('/mock/state.json')).file, '/mock/state-old.json')
})

const failures = []
for (const { name, run } of cases) {
  try { await run(); console.log(`PASS: ${name}`) }
  catch (error) { console.error(`FAIL: ${name}: ${error.message}`); failures.push(error) }
}
if (failures.length) throw new AggregateError(failures, `${failures.length}/${cases.length} state adoption regressions failed`)
console.log(`STATE_ADOPTION_REGRESSION_OK: ${cases.length} production-load cases, all state/remote/model IO fake`)
