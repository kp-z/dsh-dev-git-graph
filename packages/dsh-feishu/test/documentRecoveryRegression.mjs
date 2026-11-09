import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import vm from 'node:vm'
import { createBackendScope } from '../backendScope.js'

// Execute the current production functions, not copied recovery algorithms.
// Only source reads are real IO. All model, document, folder, field and state
// effects below are in-memory fakes; no CLI, server or remote API is started.
const source = await readFile(new URL('../index.js', import.meta.url), 'utf8')
const extract = name => {
  const match = source.match(new RegExp('  (?:async )?function ' + name + '\\([^]*?\\n  }'))
  assert.ok(match, `production function ${name} must exist`)
  return match[0]
}
const adapterStart = source.indexOf('  async actions(settings, actions) {', source.indexOf('const larkBackend ='))
const adapterEnd = source.indexOf('\n  },', adapterStart) + 5
assert.ok(adapterStart >= 0 && adapterEnd > adapterStart, 'production document adapter must exist')
const docxMatch = source.match(/export function docxIdOf\([^]*?\n}/)
assert.ok(docxMatch, 'production docx URL parser must exist')
const plain = value => JSON.parse(JSON.stringify(value))
const OLD = 'https://tenant.feishu.cn/docx/OLD'
const NEW = 'https://tenant.feishu.cn/docx/NEW'
const OTHER = 'https://tenant.feishu.cn/docx/OTHER'
const remoteSuccess = (document, url) => ({ ok: true, stdout: JSON.stringify({ ok: true, data: { document: { document_id: document, url } } }), stderr: '' })
const remoteNotFound = { ok: true, stdout: JSON.stringify({ ok: false, error: { code: 404, type: 'validation', subtype: 'not_found', message: 'deleted' } }), stderr: '' }
const rawTask = { guid: 'task', summary: 'Recovery task', description: 'material', completed_at: '0', tasklists: [], custom_fields: [] }

function harness() {
  const calls = [], rawCalls = [], infoCalls = [], fieldWrites = [], saved = [], modelCalls = []
  const replies = []
  const h = {
    state: { tasks: [{ id: 'task', title: 'Recovery task', description: 'material', docs: [{ url: OLD, title: 'Old generated', source: '生成' }, { url: 'https://tenant.feishu.cn/wiki/external', source: '手动' }] }], pendingDocReceipts: {}, workspaceWrites: {}, docTitles: {}, bindings: {} },
    settings: { cliBackend: 'lark-cli', cliPath: 'fake', larkCliPath: 'fake', larkAccountMode: 'user', docPrompt: 'prompt', taskFields: { doc: '文档' } },
    asString: value => value == null ? '' : String(value),
    creationPending: () => false,
    nowMs: () => 12345,
    stripTaskNo: value => value,
    askModelLong: async (...args) => { modelCalls.push(args); return { text: 'generated body' } },
    pushDocField: async task => { fieldWrites.push(plain(task.docs)); return { ok: true } },
    persistState: async () => { saved.push(plain(h.state)) },
    ctx: {}, log: () => {},
    // Peripheral task normalization is deterministic; the real normalizeTask
    // controls receipt/previous/Map precedence and builds the returned task.
    selectTaskList: () => ({ guid: '' }),
    cached: () => undefined,
    remoteCache: { tasklists: new Map(), fields: new Map(), users: new Map() },
    REMOTE_TTL: { tasklists: 1, fields: 1, users: 1 },
    customFieldValue: () => '', readFieldConfig: () => ({}), parseTaskMeta: () => ({}),
    ETA_FIELD_DEFAULT: '预期完成', formatDay: () => '', formatStamp: () => '', extractDocLinks: () => [],
  }
  const adapterContext = {
    asString: h.asString,
    // A real production adapter consumes these raw responses. Temporary
    // markdown creation/removal and CLI execution are fakes, not real IO.
    createLarkTasklistActions: () => async () => { throw new Error('unexpected tasklist action') },
    writeTempMarkdown: async text => ({ file: 'FAKE_MARKDOWN', dir: 'FAKE_DIRECTORY', text }),
    rm: async () => {},
    parseJson: text => { try { return JSON.parse(text) } catch { return undefined } },
    runLarkCmd: async (settings, args) => {
      rawCalls.push({ backend: settings.cliBackend, args: [...args] })
      assert.ok(replies.length, `unexpected raw document command: ${args.join(' ')}`)
      const reply = replies.shift()
      return typeof reply === 'function' ? reply({ settings, args }) : reply
    },
  }
  vm.createContext(adapterContext)
  vm.runInContext(docxMatch[0].replace('export ', ''), adapterContext)
  const adapter = vm.runInContext('({' + source.slice(adapterStart, adapterEnd) + '})', adapterContext)
  const impls = Object.fromEntries(['lark-cli', 'feishu-sync'].map(name => [name, {
    actions: async (settings, actions) => {
      calls.push({ backend: name, actions: plain(actions) })
      assert.equal(settings.cliBackend, name, 'scope must keep its original backend settings')
      if (actions[0].op === 'ensure_folder') return { ok: true, actions: [{ op: 'ensure_folder', ok: true, folder: 'FOLDER', url: 'https://tenant.feishu.cn/drive/folder/FOLDER' }] }
      assert.equal(name, 'lark-cli', 'no document write may leak to the newly selected backend')
      return adapter.actions(settings, actions)
    },
    docInfo: async (settings, url) => {
      infoCalls.push({ backend: name, url })
      assert.equal(settings.cliBackend, name)
      return { ok: url === NEW, meta: { title: 'Verified generated document' } }
    },
  }]))
  const newScope = () => createBackendScope({ getSettings: () => h.settings, getGeneration: () => 0, isDisposed: () => false, resolveBackend: name => impls[name] })
  h.captureBackendScope = newScope
  h.backend = () => {
    const scope = newScope()
    return { docInfo: (_settings, url) => scope.docInfo(url) }
  }
  /* 编号来自飞书任务号；这些用例不关心编号，给个固定替身。 */
  h.feishuTaskNo = () => 0
  vm.createContext(h)
  vm.runInContext(docxMatch[0].replace('export ', '') + '\n' + ['normalizeTask', 'createTaskDoc', 'bindTaskDoc'].map(extract).join('\n'), h)
  return { h, calls, rawCalls, infoCalls, fieldWrites, saved, replies, modelCalls, adapter }
}

function assertPending(t, document, url) {
  const task = t.h.state.tasks[0]
  assert.equal(task.pendingDocReceipt?.backend, 'lark-cli')
  assert.equal(task.pendingDocReceipt?.document, document)
  assert.equal(task.pendingDocReceipt?.url, url)
  assert.deepEqual(plain(t.h.state.pendingDocReceipts.task), plain(task.pendingDocReceipt))
}

async function assertBlockedRetry(t, document, url) {
  const before = [t.calls.length, t.rawCalls.length, t.fieldWrites.length, t.modelCalls.length, t.saved.length]
  const result = await t.h.createTaskDoc('task')
  assert.equal(result.ok, false)
  assert.equal(result.partial, true)
  assert.equal(result.url, url)
  assertPending(t, document, url)
  assert.deepEqual([t.calls.length, t.rawCalls.length, t.fieldWrites.length, t.modelCalls.length, t.saved.length], before, 'pending retry must do zero model/API/field/persist work')
}

async function fallbackWhileSwitching() {
  const t = harness()
  t.replies.push(remoteNotFound, () => {
    // The old backend already accepted NEW before selection switches to B.
    t.h.settings.cliBackend = 'feishu-sync'
    return remoteSuccess('NEW', NEW)
  })
  const beforeDocs = plain(t.h.state.tasks[0].docs)
  const result = await t.h.createTaskDoc('task')
  assert.equal(result.ok, false)
  assert.equal(result.partial, true)
  assert.equal(result.url, NEW, 'fallback receipt must retain NEW, never OLD')
  assert.deepEqual(plain(t.h.state.tasks[0].docs), beforeDocs, 'stale fallback must preserve the original binding')
  assertPending(t, 'NEW', NEW)
  assert.deepEqual(t.calls.map(call => call.actions[0].op), ['ensure_folder', 'ensure_folder', 'update_docx', 'create_docx'])
  assert.ok(t.calls.every(call => call.backend === 'lark-cli'))
  assert.equal(t.rawCalls[0].args[t.rawCalls[0].args.indexOf('--doc') + 1], 'OLD')
  assert.equal(t.rawCalls[1].args[1], '+create')
  assert.equal(t.fieldWrites.length, 0)
  assertPending({ h: { state: t.saved.at(-1) } }, 'NEW', NEW)
  await assertBlockedRetry(t, 'NEW', NEW)
  return t
}

// 1. Previous task normalization preserves protection, and the independent
// receipt Map survives disappearance from the filtered task snapshot.
{
  const t = harness()
  t.replies.push({ ok: false, stdout: '', stderr: '', detail: 'lost update receipt' })
  const result = await t.h.createTaskDoc('task')
  assert.equal(result.ok, false); assert.equal(result.partial, true)
  assertPending(t, 'OLD', OLD)
  const previousTask = t.h.state.tasks[0]
  const mapReceipt = t.h.state.pendingDocReceipts.task
  t.h.state.pendingDocReceipts = {}
  const normalized = t.h.normalizeTask(rawTask, new Map([['task', previousTask]]))
  assert.deepEqual(plain(normalized.pendingDocReceipt), plain(previousTask.pendingDocReceipt))
  assert.notEqual(normalized.pendingDocReceipt, previousTask.pendingDocReceipt, 'normalized receipt must not alias previous object')
  t.h.state.tasks = [normalized]
  t.h.state.pendingDocReceipts = { task: mapReceipt }
  await assertBlockedRetry(t, 'OLD', OLD)
  // A filter removed the task; a later snapshot has no previousTask at all.
  t.h.state.tasks = []
  const returned = t.h.normalizeTask(rawTask, new Map())
  assert.deepEqual(plain(returned.pendingDocReceipt), plain(mapReceipt))
  assert.notEqual(returned.pendingDocReceipt, mapReceipt, 'Map recovery must copy the receipt')
  t.h.state.tasks = [returned]
  await assertBlockedRetry(t, 'OLD', OLD)
  // The production create function itself also repairs a missing task-local
  // receipt from the Map before any write, independently of normalizeTask.
  delete returned.pendingDocReceipt
  await assertBlockedRetry(t, 'OLD', OLD)
  console.log('PASS 1: previous/filtered-task/Map-only recovery blocks all retry writes')
}

// 2. Real adapter + real scope stale wrapper + real create fallback preserve
// the successful NEW receipt even though its old update returned notFound.
const recovered = await fallbackWhileSwitching()
console.log('PASS 2: notFound fallback followed by backend switch retains NEW ID/URL')

// 4. Neither a wrong type/malformed URL nor another docx ID can unlock NEW.
{
  const t = recovered
  const beforeDocs = plain(t.h.state.tasks[0].docs)
  let result = await t.h.bindTaskDoc('task', NEW)
  assert.equal(result.ok, false, 'binding on the other backend must not clear protection')
  assert.equal(t.infoCalls.length, 0)
  assertPending(t, 'NEW', NEW)
  t.h.settings.cliBackend = 'lark-cli'
  for (const badURL of ['https://tenant.feishu.cn/wiki/NEW', OTHER, 'not-a-url', 'https://tenant.feishu.cn/docx/', 'javascript:/docx/NEW']) {
    const before = [t.infoCalls.length, t.saved.length, t.fieldWrites.length]
    result = await t.h.bindTaskDoc('task', badURL)
    assert.equal(result.ok, false, `invalid binding must reject ${badURL}`)
    assertPending(t, 'NEW', NEW)
    assert.deepEqual(plain(t.h.state.tasks[0].docs), beforeDocs)
    // A syntactically wrong http(s) URL must never reach authoritative lookup.
    if (!badURL.includes('javascript:')) assert.equal(t.infoCalls.length, before[0])
    assert.equal(t.saved.length, before[1]); assert.equal(t.fieldWrites.length, before[2])
  }
  await assertBlockedRetry(t, 'NEW', NEW)
  console.log('PASS 4: other backend, wrong URL type and different ID cannot unlock recovery')
}

// 3. Manual authoritative verification is recovery, not source reassignment:
// NEW remains generated, both receipt stores clear, and next write updates NEW.
{
  const t = recovered
  const beforeInfo = t.infoCalls.length
  const result = await t.h.bindTaskDoc('task', NEW)
  assert.equal(result.ok, true)
  assert.equal(t.h.state.tasks[0].docs[0].url, NEW)
  assert.equal(t.h.state.tasks[0].docs[0].source, '生成')
  assert.equal(t.h.state.tasks[0].docs.filter(doc => doc.source === '生成').length, 1)
  assert.ok(t.h.state.tasks[0].docs.some(doc => doc.source === '手动'), 'unrelated manual document remains')
  assert.equal(t.h.state.tasks[0].pendingDocReceipt, undefined)
  assert.equal(t.h.state.pendingDocReceipts.task, undefined)
  assert.ok(t.infoCalls.length > beforeInfo && t.infoCalls.slice(beforeInfo).every(call => call.backend === 'lark-cli' && call.url === NEW))
  assert.equal(t.fieldWrites.at(-1)[0].url, NEW)
  assert.equal(t.saved.at(-1).pendingDocReceipts.task, undefined)
  const before = t.calls.length
  t.replies.push(remoteSuccess('NEW', NEW))
  const updated = await t.h.createTaskDoc('task')
  assert.equal(updated.ok, true); assert.equal(updated.updated, true); assert.equal(updated.url, NEW)
  const actions = t.calls.slice(before).flatMap(call => call.actions)
  assert.deepEqual(actions.map(action => action.op), ['ensure_folder', 'ensure_folder', 'update_docx'])
  assert.equal(actions.at(-1).document, 'NEW')
  assert.equal(actions.at(-1).url, NEW)
  assert.equal(t.rawCalls.at(-1).args[t.rawCalls.at(-1).args.indexOf('--doc') + 1], 'NEW')
  assert.equal(t.replies.length, 0)
  console.log('PASS 3: verified NEW remains generated, clears both stores and is updated, not recreated')
}

// 5. A successful process exit is not a valid mutation receipt. Other IDs,
// inconsistent URLs, empty raw objects and top-level error codes fail closed.
for (const [label, output] of [
  ['other ID and URL', remoteSuccess('OTHER', OTHER)],
  ['requested ID but other URL', remoteSuccess('OLD', OTHER)],
  ['other ID without URL', { ok: true, stdout: JSON.stringify({ ok: true, data: { document_id: 'OTHER' } }), stderr: '' }],
  ['non-docx URL', remoteSuccess('OLD', 'https://tenant.feishu.cn/wiki/OLD')],
  ['empty raw object', { ok: true, stdout: '{}', stderr: '' }],
  ['top-level code error', { ok: true, stdout: JSON.stringify({ code: 999, data: { document_id: 'OLD', url: OLD } }), stderr: '' }],
  ['ok true with top-level code error', { ok: true, stdout: JSON.stringify({ ok: true, code: 999, data: { document_id: 'OLD', url: OLD } }), stderr: '' }],
]) {
  const t = harness()
  t.replies.push(output)
  const row = (await t.adapter.actions(t.h.settings, [{ op: 'update_docx', document: 'OLD', url: OLD, text: 'body' }])).actions[0]
  assert.equal(row.ok, false, label)
  assert.equal(row.unknownDelivery, true, label)
  if (label.includes('ID') || label.includes('URL')) assert.equal(row.document, 'OLD', `${label}: adapter must retain requested ID, not contradictory response ID`)
  t.replies.push(output)
  const beforeDocs = plain(t.h.state.tasks[0].docs)
  const result = await t.h.createTaskDoc('task')
  assert.equal(result.ok, false, label); assert.equal(result.partial, true, label)
  assert.deepEqual(plain(t.h.state.tasks[0].docs), beforeDocs, label)
  assertPending(t, 'OLD', OLD)
  assert.equal(t.fieldWrites.length, 0, label)
  assert.equal(t.calls.filter(call => call.actions[0].op === 'create_docx').length, 0, label)
  await assertBlockedRetry(t, 'OLD', OLD)
}
console.log('PASS 5: contradictory/empty/error receipts remain unknown and preserve original binding')
console.log('DOCUMENT_RECOVERY_REGRESSION_OK: real production normalization/create/bind/adapter/scope, all effects fake')
