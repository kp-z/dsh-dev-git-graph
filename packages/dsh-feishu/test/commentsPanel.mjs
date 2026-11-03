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
assert.ok(!nodes.has('commentsInbox'), 'settings no longer renders a comment inbox')
assert.ok(!nodes.has('commentsList'), 'settings no longer renders comment entries')
for (const id of ['commentEnabled', 'commentOwnerMode', 'commentOtherMode', 'commentMaxPerSync']) {
  assert.ok(within(nodes.get(id), 'commentsGroup'))
  assert.equal(nodes.get(id).attrs['data-setting'], '1')
  assert.ok(Object.hasOwn(nodes.get(id).attrs, 'disabled'), `${id} disabled before capability probe`)
}
assert.equal(nodes.get('commentEnabled').attrs.type, 'checkbox')
assert.equal(nodes.get('commentMaxPerSync').attrs.min, '1')
assert.equal(nodes.get('commentMaxPerSync').attrs.max, '20')
assert.equal(nodes.get('commentMaxPerSync').attrs.value, '5')
assert.match(html, /原生回复关联作者，但不保证 @ 通知/)
for (const id of ['commentEnabled', 'commentOwnerMode', 'commentOtherMode', 'commentMaxPerSync']) assert.ok(extract('wire').includes(`'${id}'`))
assert.match(extract('load'), /app\.hostStale = false;\s*updateSettingDependencies\(\);\s*renderTasks\(\)/, 'late capability arrival updates controls without overwriting dirty values')

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
const context = {
  app: { settings: {}, settingsDirty: false, workspaces: [], serverFeatures: null, snap: { tasks: [{ id: 't', title: '任务标题' }] }, busy: {} },
  document: { activeElement: null, createElement: (tag) => new Control(tag) },
  $: n,
  api: (path, body, opts) => { requests.push({ path, body, opts }); return Promise.resolve(response) },
  load: () => {}, showSaved: () => {}, pad2: (v) => String(v).padStart(2, '0'),
  readScheduleSettings: () => ({}),
}
vm.createContext(context)
vm.runInContext(['clear', 'el', 'makeButton', 'toInt', 'commentsSupported', 'updateSettingDependencies', 'isEditingSetting', 'renderWorkspaceHint', 'renderSettings', 'scheduleDefaults', 'normHm', 'renderScheduleSettings', 'onSave'].map(extract).join('\n'), context)
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
assert.equal(n('commentMentionMode').value, 'task-v1')
context.onSave()
assert.deepEqual(JSON.parse(JSON.stringify(requests.at(-1).body.comments)), { enabled: true, ownerMode: 'execute', otherMode: 'off', mentionMode: 'task-v1', maxPerSync: 20 })
await new Promise(setImmediate)
n('commentEnabled').checked = false
context.updateSettingDependencies()
assert.equal(n('commentOwnerMode').disabled, true)
assert.equal(n('commentOwnerMode').value, 'off')

for (const id of ['commentsInbox', 'commentsInboxStatus', 'commentsList', 'commentsRefresh']) {
  assert.ok(!html.includes(`id="${id}"`), `${id} removed from settings`)
}
assert.ok(!/api\('comments',/.test(script), 'settings never reads the Host comment ledger')
assert.ok(!/评论收件箱/.test(html), 'comment inbox copy removed')
console.log('COMMENTS_PANEL_OK: comment settings remain, late capability/draft guards, defaults/clamped save, and no comment ledger UI or reads in settings')
