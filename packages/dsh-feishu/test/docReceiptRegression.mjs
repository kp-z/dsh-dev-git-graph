import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import vm from 'node:vm'
const source = await readFile(new URL('../index.js', import.meta.url), 'utf8')
const start = source.indexOf('  async actions(settings, actions) {', source.indexOf('const larkBackend ='))
const end = source.indexOf('\n  },', start) + 5
let output = { ok: true, stdout: '{"ok":true,"data":{}}', stderr: '' }
const ctx = { asString: v => v == null ? '' : String(v), createLarkTasklistActions: () => async () => { throw new Error('not a field test') }, writeTempMarkdown: async () => ({ file: 'fake.md', dir: 'fake-dir' }), runLarkCmd: async () => output, parseJson: text => { try { return JSON.parse(text) } catch { return undefined } }, rm: async () => {} }
vm.createContext(ctx)
const backend = vm.runInContext('({' + source.slice(start, end) + '})', ctx)
const url = 'https://tenant.feishu.cn/docx/existing'
let row = (await backend.actions({}, [{ op: 'update_docx', document: 'existing', url, text: 'body' }])).actions[0]
assert.equal(row.ok, true); assert.equal(row.document, 'existing'); assert.equal(row.url, url)
for (const data of [{}, { document: { document_id: 'created-no-url' } }]) {
  output = { ok: true, stdout: JSON.stringify({ ok: true, data }), stderr: '' }
  row = (await backend.actions({}, [{ op: 'create_docx', folder: 'folder', title: 'new', text: 'body' }])).actions[0]
  assert.equal(row.ok, false); assert.equal(row.unknownDelivery, true)
}
const task = { id: 't', title: 'Doc', docs: [{ url, source: '生成', title: 'Doc' }] }
const calls = [], fieldSnapshots = []
const scope = { backend: 'lark-cli', valid: () => true, actions: async actions => {
  calls.push(actions[0].op)
  if (actions[0].op === 'ensure_folder') return { ok: true, actions: [{ ok: true, folder: 'folder', url: 'folder-url' }] }
  return backend.actions({}, actions)
} }
const docCtx = { state: { tasks: [task] }, settings: { docPrompt: 'prompt' }, captureBackendScope: () => scope, askModelLong: async () => ({ text: 'new body' }), asString: ctx.asString, stripTaskNo: v => v, nowMs: Date.now, pushDocField: async value => { fieldSnapshots.push(structuredClone(value.docs)); return { ok: true } }, persistState: async () => {}, ctx: {}, log: () => {} }
vm.createContext(docCtx); vm.runInContext(source.match(/  async function createTaskDoc\([^]*?\n  }/)[0], docCtx)
output = { ok: true, stdout: '{"ok":true,"data":{}}', stderr: '' }
for (let i = 0; i < 2; i++) {
  const result = await docCtx.createTaskDoc('t')
  assert.equal(result.ok, true); assert.equal(result.updated, true); assert.equal(result.url, url); assert.equal(task.docs[0].url, url)
}
assert.equal(calls.filter(op => op === 'create_docx').length, 0)
assert.ok(fieldSnapshots.every(docs => docs[0].url === url))
// A lost update receipt cannot turn into a second document create or erase the link.
output = { ok: false, stdout: '', stderr: '', detail: 'Command timed out' }
let result = await docCtx.createTaskDoc('t')
assert.equal(result.ok, false); assert.equal(result.partial, true); assert.equal(task.docs[0].url, url)
assert.equal(task.pendingDocReceipt.document, 'existing')
const beforeRetry = calls.length
result = await docCtx.createTaskDoc('t')
assert.equal(result.ok, false); assert.equal(calls.length, beforeRetry)
assert.equal(calls.filter(op => op === 'create_docx').length, 0)
console.log('DOC_RECEIPT_REGRESSION_OK: repeated update preserves URL/field, missing create receipt fails closed, uncertain update never recreates or drops binding')
