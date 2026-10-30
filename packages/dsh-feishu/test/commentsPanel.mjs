import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import vm from 'node:vm'

// Source/VM contract tests: no boot IIFE, real Host calls or fake UI rendering.
const html = await readFile(new URL('../panel.html', import.meta.url), 'utf8')
const script = [...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)].map((m) => m[1]).join('\n')
new vm.Script(script)
function extract(name) {
  const m = script.match(new RegExp('  function ' + name + '\\([^]*?\\n  }'))
  assert.ok(m, `missing ${name}`)
  return m[0]
}
const nodes = new Map(), stack = []
const voidTags = new Set(['input', 'meta', 'link', 'br', 'hr', 'img'])
const source = html.replace(/<!--[\s\S]*?-->/g, '').replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/g, '')
for (const m of source.matchAll(/<\/?([a-z][\w-]*)\b([^>]*)>/gi)) {
  const tag = m[1].toLowerCase()
  if (m[0].startsWith('</')) { stack.pop(); continue }
  const attrs = Object.fromEntries([...m[2].matchAll(/([^\s=/'"]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g)].map((a) => [a[1], a[2] ?? a[3] ?? a[4] ?? '']))
  const node = { tag, attrs, parent: stack.at(-1) }
  if (attrs.id) nodes.set(attrs.id, node)
  if (!voidTags.has(tag) && !m[0].endsWith('/>')) stack.push(node)
}
const within = (node, id) => { for (let p = node.parent; p; p = p.parent) if (p === nodes.get(id)) return true; return false }
assert.equal(nodes.get('commentsGroup').tag, 'details')
assert.match(nodes.get('commentsGroup').attrs.class, /setting-group/)
assert.ok(!Object.hasOwn(nodes.get('commentsGroup').attrs, 'open'))
assert.ok(within(nodes.get('commentsGroup'), 'settingsCard'))
assert.ok(within(nodes.get('commentsInbox'), 'configurationArea'))
assert.ok(Object.hasOwn(nodes.get('commentsInbox').attrs, 'hidden'))
for (const id of ['commentEnabled', 'commentOwnerMode', 'commentOtherMode', 'commentMaxPerSync']) {
  assert.ok(within(nodes.get(id), 'commentsGroup'))
  assert.equal(nodes.get(id).attrs['data-setting'], '1')
  assert.ok(Object.hasOwn(nodes.get(id).attrs, 'disabled'), `${id} disabled before capability probe`)
}
assert.equal(nodes.get('commentEnabled').attrs.type, 'checkbox')
assert.equal(nodes.get('commentMaxPerSync').attrs.min, '1')
assert.equal(nodes.get('commentMaxPerSync').attrs.max, '20')
assert.equal(nodes.get('commentMaxPerSync').attrs.value, '5')
assert.equal(nodes.get('commentsList').attrs.role, 'list')
assert.match(html, /原生回复关联作者，但不保证 @ 通知/)
assert.match(extract('wire'), /wireComments\(\)/)
for (const id of ['commentEnabled', 'commentOwnerMode', 'commentOtherMode', 'commentMaxPerSync']) assert.ok(extract('wire').includes(`'${id}'`))
assert.match(extract('load'), /app\.hostStale = false;\s*updateSettingDependencies\(\);\s*loadCommentsInbox\(\)/, 'late capability arrival updates controls without overwriting dirty values')

class Control {
  constructor(tag = 'div', attrs = {}) { this.tag = tag; this.attrs = attrs; this.hidden = Object.hasOwn(attrs, 'hidden'); this.open = false; this.value = attrs.value || ''; this.disabled = false; this.checked = false; this.children = []; this.listeners = {}; this.textContent = '' }
  appendChild(n) { this.children.push(n); return n }
  removeChild(n) { this.children.splice(this.children.indexOf(n), 1) }
  get firstChild() { return this.children[0] }
  setAttribute(k, v) { this.attrs[k] = String(v) }
  getAttribute(k) { return this.attrs[k] }
  addEventListener(k, fn) { (this.listeners[k] ||= []).push(fn) }
  fire(k, event = {}) { return Promise.all((this.listeners[k] || []).map((fn) => fn.call(this, event))) }
}
const registry = new Map([...nodes].map(([id, n]) => [id, new Control(n.tag, { ...n.attrs })]))
const n = (id) => registry.get(id)
let requests = []
let response = { ok: true, entries: [] }
let failure
const context = {
  app: { settings: {}, settingsDirty: false, workspaces: [], serverFeatures: null, snap: { tasks: [{ id: 't', title: '任务标题' }] }, busy: {} },
  document: { activeElement: null, createElement: (tag) => new Control(tag) },
  $: n,
  api: (path, body, opts) => { requests.push({ path, body, opts }); return failure ? Promise.reject(new Error(failure)) : Promise.resolve(response) },
  load: () => {}, showSaved: () => {}, pad2: (v) => String(v).padStart(2, '0'),
  readScheduleSettings: () => ({}),
}
vm.createContext(context)
vm.runInContext(['clear', 'el', 'makeButton', 'toInt', 'commentsSupported', 'commentsVisible', 'commentActions', 'renderCommentsInbox', 'loadCommentsInbox', 'onCommentAction', 'wireComments', 'updateSettingDependencies', 'isEditingSetting', 'renderWorkspaceHint', 'renderSettings', 'scheduleDefaults', 'normHm', 'renderScheduleSettings', 'onSave'].map(extract).join('\n'), context)
const text = (node) => [node.textContent, ...node.children.map(text)].join('\n')
context.renderSettings(true)
assert.equal(n('commentEnabled').checked, false)
assert.equal(n('commentOwnerMode').value, 'off')
assert.equal(n('commentOtherMode').value, 'off')
assert.equal(n('commentMaxPerSync').value, 5)
assert.equal(n('commentEnabled').disabled, true)
context.app.serverFeatures = []
n('commentEnabled').checked = true
n('commentOwnerMode').value = 'execute'
context.updateSettingDependencies()
assert.equal(n('commentEnabled').disabled, true)
assert.match(n('commentsCapabilityHint').textContent, /不支持/)
response = { settings: {} }
context.onSave()
assert.ok(!Object.hasOwn(requests.at(-1).body, 'comments'), 'old Host never receives unsupported config')
await new Promise(setImmediate)
context.app.serverFeatures = ['tasks.comments']
context.app.settings = { comments: { enabled: true, ownerMode: 'execute', otherMode: 'reply', maxPerSync: 7 } }
context.renderSettings(true)
for (const id of ['commentEnabled', 'commentOwnerMode', 'commentOtherMode', 'commentMaxPerSync']) assert.equal(n(id).disabled, false)
context.app.settingsDirty = true
n('commentOtherMode').value = 'off'
context.renderSettings(false)
assert.equal(n('commentOtherMode').value, 'off', 'polling preserves dirty comment drafts')
context.updateSettingDependencies()
assert.equal(n('commentOtherMode').value, 'off', 'capability update preserves drafts')
n('commentMaxPerSync').value = '900'
context.onSave()
assert.deepEqual(JSON.parse(JSON.stringify(requests.at(-1).body.comments)), { enabled: true, ownerMode: 'execute', otherMode: 'off', maxPerSync: 20 })
await new Promise(setImmediate)
n('commentEnabled').checked = false
context.updateSettingDependencies()
assert.equal(n('commentOwnerMode').disabled, true)
assert.equal(n('commentOwnerMode').value, 'off')

requests = []
response = { ok: true, entries: [] }
context.wireComments()
await n('commentsGroup').fire('toggle')
assert.equal(requests.length, 0, 'collapsed configuration never reads comments')
n('commentsGroup').open = true
await n('commentsGroup').fire('toggle')
assert.equal(requests.length, 0, 'open inner details in hidden configuration never reads')
n('configurationArea').hidden = false
n('settingsCard').hidden = false
context.app.serverFeatures = []
await context.loadCommentsInbox()
assert.equal(requests.length, 0, 'old Host is not probed with unsupported comments route')
context.app.serverFeatures = ['tasks.comments']
const entries = ['pending', 'delivered', 'running', 'reply_pending', 'replied', 'ignored', 'unknown', 'failed'].map((status, i) => ({ taskId: 't', commentId: `c${i}`, authorId: 'author', text: '<script>literal</script>\n留言', status, ...(status === 'failed' ? { error: 'permission denied' } : {}) }))
response = { ok: true, entries }
await n('commentsGroup').fire('toggle')
assert.equal(requests[0].path, 'comments')
assert.equal(requests[0].body, undefined, 'GET only, never starts sync/drain')
assert.equal(n('commentsInbox').hidden, false)
assert.equal(context.app.commentEntries, entries)
assert.equal(n('commentsList').children.length, entries.length)
for (const status of entries.map((e) => e.status)) assert.match(text(n('commentsList')), new RegExp(status))
assert.match(text(n('commentsList')), /作者：author/)
assert.match(text(n('commentsList')), /任务：任务标题/)
assert.match(text(n('commentsList')), /<script>literal<\/script>/, 'original text remains text, never injected HTML')
assert.match(text(n('commentsList')), /permission denied/)
assert.match(text(n('commentsList')), /必须人工对账/)
assert.match(text(n('commentsList')), /不清除出站账本/)
for (const entry of entries) {
  const expected = ['pending', 'unknown'].includes(entry.status) ? ['ignore'] : ['reply_pending', 'failed'].includes(entry.status) ? ['retry'] : []
  assert.deepEqual([...context.commentActions(entry)], expected)
}
const unknown = entries.find((e) => e.status === 'unknown')
requests = []
context.app.commentInboxLoading = true
await context.onCommentAction(unknown, 'ignore')
assert.equal(requests.length, 0, 'actions wait for the in-flight GET, avoiding stale ledger races')
context.app.commentInboxLoading = false
context.app.commentActionBusy = true
await context.loadCommentsInbox()
assert.equal(requests.length, 0, 'GET does not race an in-flight action')
context.app.commentActionBusy = false
await context.onCommentAction(unknown, 'retry')
assert.equal(requests.length, 0, 'unknown never retries without manual reconciliation')
response = { ok: true, entries }
await context.onCommentAction(unknown, 'ignore')
assert.equal(requests[0].path, 'comments/action')
assert.deepEqual(JSON.parse(JSON.stringify(requests[0].body)), { taskId: 't', commentId: unknown.commentId, action: 'ignore' })
assert.equal(requests[1].path, 'comments', 'successful action reads actual Host state')
assert.equal(unknown.status, 'unknown', 'no fake optimistic status transitions')
requests = []
await context.onCommentAction(entries.find((e) => e.status === 'reply_pending'), 'retry')
assert.equal(requests[0].body.action, 'retry')
failure = 'outbound ledger requires reconciliation'
await context.onCommentAction(entries.find((e) => e.status === 'failed'), 'retry')
assert.match(n('commentsInboxStatus').textContent, /outbound ledger requires reconciliation/)
assert.equal(entries.at(-1).status, 'failed')
assert.equal(context.app.commentActionBusy, false)
await context.loadCommentsInbox()
assert.match(n('commentsInboxStatus').textContent, /读取失败/)
assert.equal(context.app.commentEntries, entries, 'failed GET keeps last real ledger')
failure = null
response = { ok: false, reason: 'missing permission' }
await context.loadCommentsInbox()
assert.match(n('commentsInboxStatus').textContent, /missing permission/)
requests = []
n('commentsGroup').open = false
await n('commentsGroup').fire('toggle')
assert.equal(requests.length, 0)
assert.equal(n('commentsInbox').hidden, true)
console.log('COMMENTS_PANEL_OK: collapsed ancestry, late capability/draft guards, defaults/clamped save, read-only lazy inbox, raw text/status/reasons, safe ignore/retry and no optimistic ledger changes')
