import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import vm from 'node:vm'
import { schemaSignature, tasklistFields, TASKLIST_SCHEMA_VERSION } from '../tasklistSchema.js'
import { listLarkPages } from '../larkPages.js'
const source = await readFile(new URL('../index.js', import.meta.url), 'utf8')
assert.match(source, /name: settings\.taskFields\.doc \|\| '文档',\s*expected_type: 'text'/)
assert.match(source, /name, expected_type: 'datetime', value/)
assert.match(source, /name: '处理状态', expected_type: 'single_select'/)
// Task creation cannot resume on another authenticated backend after POST.
const create = source.match(/  async function createTaskFromSession\([^]*?\n  }/)?.[0]
assert.ok(create)
let releaseCreate, enterCreate
const enteredCreate = new Promise(resolve => { enterCreate = resolve })
const calls = []
const captured = { createTask: async () => { calls.push('create:lark-cli'); enterCreate(); return new Promise(resolve => { releaseCreate = resolve }) }, updateTask: async () => { calls.push('rename'); return { ok: true } } }
const ctx = { settings: { cliBackend: 'lark-cli', managedTasklist: { enabled: true, guid: 'list' } }, lifecycleDisposed: false, state: { tasks: [], relations: [], workspaceLinks: {}, workspaceWrites: {}, relationSync: {} }, asString: v => v == null ? '' : String(v), nowMs: Date.now, updateRelations: () => ({ ok: true, edges: [] }), service: () => undefined, ctx: {}, ensureManagedTasklist: async () => ({ ok: true, guid: 'list' }), defaultsFromState: () => ({ assignee: 'ou_self', tasklistGuid: 'list' }), backendFor: () => captured, extractDocLinks: () => [], persistState: async () => {}, taskNo: () => 1, decorateTitle: () => 'renamed' }
vm.createContext(ctx); vm.runInContext(create, ctx)
const pending = ctx.createTaskFromSession('s', { summary: 'Create' })
await enteredCreate
ctx.settings = { ...ctx.settings, cliBackend: 'feishu-sync' }
releaseCreate({ ok: true, guid: 'created', tasklistGuid: 'list' })
const result = await pending
assert.equal(result.partial, true); assert.equal(result.taskId, 'created'); assert.deepEqual(calls, ['create:lark-cli']); assert.equal(ctx.state.tasks[0].creationBackend, 'lark-cli')
assert.equal((await ctx.createTaskFromSession('s', { summary: 'Retry' })).ok, false, 'saved receipt binding blocks accidental repeat')
// Uncertain field creates survive a settings change before readiness publication.
const start = source.indexOf('  let tasklistFlight = null'), end = source.indexOf('  const settingsHooks = []', start)
let releaseFields, enterFields, fieldCalls = 0
const enteredFields = new Promise(resolve => { enterFields = resolve })
const bridge = async (_python, payload) => {
  if (payload.fields) return { ok: true, fields: { list: [] } }
  if (payload.actions[0].op === 'ensure_tasklist') return { ok: true, actions: [{ ok: true, guid: 'list', name: 'DSH 任务清单' }] }
  fieldCalls++; enterFields()
  return new Promise(resolve => { releaseFields = () => resolve({ ok: true, actions: payload.actions.map(a => ({ op: a.op, name: a.name, ok: false, unknownDelivery: true, error: 'lost create receipt' })) }) })
}
const managed = { settings: { cliBackend: 'feishu-sync', managedTasklist: { enabled: true, name: 'DSH 任务清单', guid: '' }, taskFields: {} }, state: { tasks: [], managedTasklist: {}, feishuFields: {} }, lifecycleDisposed: false, schemaSignature, tasklistFields, TASKLIST_SCHEMA_VERSION, randomUUID: () => 'stable-token', nowMs: Date.now, resolvePython: () => 'fake-python', resolveCli: () => 'fake-cli', workspaces: () => [], persistState: async () => {}, writeJson: async () => {}, SETTINGS_FILE: 'none', safeSyncDetail: String, remoteCache: { fields: new Map() }, runBridgeRaw: bridge }
vm.createContext(managed); vm.runInContext(source.slice(start, end), managed)
const flight = managed.ensureManagedTasklist()
await enteredFields
managed.settings.priorityOptions = ['P0', 'P1']
releaseFields()
assert.equal((await flight).ok, false)
assert.equal(managed.state.managedTasklist.pendingFieldChecks.names.length, 12)
assert.equal(managed.state.managedTasklist.unknownFields.length, 12)
assert.equal((await managed.ensureManagedTasklist({ force: true })).ok, false)
assert.equal(fieldCalls, 1, 'stale uncertain field batch is never blindly recreated')
// Drive lists have files, not items: all pages still precede any create decision.
let page = 0
const folders = await listLarkPages(async () => ({ ok: true, data: ++page === 1 ? { files: [], has_more: true, page_token: 'second' } : { files: [{ token: 'existing', name: 'DSH', type: 'folder' }], has_more: false } }), '/drive/files', {}, () => true, 100, 'files')
assert.equal(folders.items[0].token, 'existing'); assert.equal(page, 2)
const failed = await listLarkPages(async () => ({ ok: false, detail: 'network' }), '/drive/files', {}, () => true, 100, 'files')
assert.equal(failed.ok, false)
assert.match(source, /if \(!listed\.ok\) \{ fail\(listed\.detail \|\| '文件夹列表不完整，拒绝重复创建'\); continue \}/)
console.log('PR3_COMPATIBILITY_OK: main field types, no cross-backend create, durable uncertain fields, strict complete folder discovery')
