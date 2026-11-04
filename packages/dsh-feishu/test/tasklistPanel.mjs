import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import vm from 'node:vm'

// Isolated source/DOM contract tests. Never execute the boot IIFE, browser,
// plugin lifecycle, real networking or sync. Only settings uses a local stub.
const html = await readFile(new URL('../panel.html', import.meta.url), 'utf8')
const script = [...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)].map((m) => m[1]).join('\n')
new vm.Script(script)
function extract(name) {
  const match = script.match(new RegExp('  function ' + name + '\\([^]*?\\n  }'))
  assert.ok(match, `missing function ${name}`)
  return match[0]
}
const nodes = new Map(), stack = []
const voidTags = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr'])
const source = html.replace(/<!--[\s\S]*?-->/g, '').replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/g, '')
for (const match of source.matchAll(/<\/?([a-z][\w-]*)\b([^>]*)>/gi)) {
  const tag = match[1].toLowerCase()
  if (match[0].startsWith('</')) {
    assert.equal(stack.at(-1)?.tag, tag, `unclosed element before ${tag}`)
    stack.pop()
    continue
  }
  const attrs = Object.fromEntries([...match[2].matchAll(/([^\s=/'"]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g)].map((m) => [m[1], m[2] ?? m[3] ?? m[4] ?? '']))
  const node = { tag, attrs, parent: stack.at(-1) }
  if (attrs.id) { assert.ok(!nodes.has(attrs.id), `duplicate ${attrs.id}`); nodes.set(attrs.id, node) }
  if (!voidTags.has(tag) && !match[0].endsWith('/>')) stack.push(node)
}
const within = (node, id) => { for (let p = node.parent; p; p = p.parent) if (p === nodes.get(id)) return true; return false }
const controls = ['managedTasklistEnabled', 'managedTasklistName', 'managedTasklistGuid']
assert.equal(nodes.get('managedTasklistGroup').tag, 'details')
assert.ok(!Object.hasOwn(nodes.get('managedTasklistGroup').attrs, 'open'))
assert.ok(within(nodes.get('managedTasklistGroup'), 'settingsCard'))
assert.ok(within(nodes.get('managedTasklistGroup'), 'configurationArea'))
for (const id of controls) {
  assert.ok(within(nodes.get(id), 'managedTasklistGroup'))
  assert.equal(nodes.get(id).attrs['data-setting'], '1')
  assert.match(source, new RegExp('<label for="' + id + '"'))
}
assert.ok(Object.hasOwn(nodes.get('managedTasklistEnabled').attrs, 'checked'))
assert.equal(nodes.get('managedTasklistStatus').attrs.role, 'status')
assert.equal(nodes.get('managedTasklistStatus').attrs['aria-live'], 'polite')
assert.ok(![...nodes.values()].some((n) => n.tag === 'button' && within(n, 'managedTasklistGroup')), 'no new API/check button')
assert.match(html, /10 分钟/)
assert.match(html, /配置改动会更新检查签名/)
assert.match(html, /类型不符时不会删除或覆盖/)
assert.match(html, /留空自动创建或复用旧配置中的单一清单/)
/* 集成后状态条改由 renderSetupChips 渲染（renderStatus 只是转发），清单状态刷新跟着它走。 */
assert.match(extract('renderSetupChips'), /renderManagedTasklistStatus\(\)/, 'status refresh is outside the settings draft guard')
assert.doesNotMatch(extract('renderManagedTasklistStatus'), /innerHTML|outerHTML|insertAdjacentHTML|\bapi\(|\bfetch\(|onSync\(/)

class Control {
  constructor(tag = 'div', attrs = {}) {
    this.tag = tag; this.attrs = attrs; this.value = attrs.value || ''; this.checked = Object.hasOwn(attrs, 'checked')
    this.disabled = false; this.hidden = Object.hasOwn(attrs, 'hidden'); this.children = []; this.listeners = {}; this.textContent = ''
  }
  appendChild(n) { this.children.push(n); return n }
  removeChild(n) { this.children.splice(this.children.indexOf(n), 1) }
  get firstChild() { return this.children[0] }
  setAttribute(k, v) { this.attrs[k] = String(v) }
  getAttribute(k) { return this.attrs[k] }
  addEventListener(k, fn) { (this.listeners[k] ||= []).push(fn) }
  fire(k) { for (const fn of this.listeners[k] || []) fn.call(this, {}) }
  set innerHTML(_) { throw new Error('unsafe DOM write') }
  set outerHTML(_) { throw new Error('unsafe DOM write') }
}
const registry = new Map([...nodes].map(([id, n]) => [id, new Control(n.tag, { ...n.attrs })]))
const n = (id) => registry.get(id)
const forbidden = () => { throw new Error('network/sync/lifecycle is forbidden') }
let pending, loadCalls = 0
const context = {
  app: { settings: {}, settingsDirty: false, busy: {}, snap: {}, workspaces: [], serverFeatures: [] },
  document: { activeElement: null, createElement: (tag) => new Control(tag) },
  $: n, fetch: forbidden, onSync: forbidden, wireConfiguration() {}, wireComments() {},
  load: () => { loadCalls++ }, showSaved() {},
  pad2: (v) => String(v).padStart(2, '0'), fmtAbs: (v) => `absolute:${v}`,
  readScheduleSettings: () => ({}),
  api: (path, payload) => {
    assert.equal(path, 'settings', 'only the existing settings endpoint is allowed')
    pending = { payload }
    return { then(resolve, reject) { pending.resolve = resolve; pending.reject = reject } }
  },
}
vm.createContext(context)
vm.runInContext(['clear', 'el', 'toInt', 'isEditingSetting', 'renderWorkspaceHint', 'renderSettings', 'updateSettingDependencies', 'scheduleDefaults', 'normHm', 'renderScheduleSettings', 'commentsSupported', 'renderManagedTasklistStatus', 'onSave', 'markDirty'].map(extract).join('\n'), context)
const text = (node) => [node.textContent, ...node.children.map(text)].join('\n')
const plain = (value) => JSON.parse(JSON.stringify(value))
context.renderSettings(true)
assert.equal(n(controls[0]).checked, true)
assert.equal(n(controls[1]).value, 'DSH 任务清单')
assert.equal(n(controls[2]).value, '')
context.app.settings.managedTasklist = { enabled: false, name: '已有清单', guid: 'list-guid' }
context.renderSettings(true)
assert.equal(n(controls[0]).checked, false)
assert.equal(n(controls[1]).value, '已有清单')
assert.equal(n(controls[2]).value, 'list-guid')
// Run the real wire prefix with unrelated view/event code excluded.
const wire = extract('wire')
const settingWire = wire.slice(0, wire.indexOf("    $('saveSettings').addEventListener")) + '\n  }\nwire();'
vm.runInContext(settingWire, context)
for (const id of controls) for (const event of ['input', 'change']) {
  context.app.settingsDirty = false
  n(id).fire(event)
  assert.equal(context.app.settingsDirty, true, `${id} ${event} marks settings dirty`)
}
n(controls[1]).value = 'draft-name'; n(controls[2]).value = 'draft-guid'; n(controls[0]).checked = true
context.renderSettings(false)
assert.equal(n(controls[1]).value, 'draft-name')
assert.equal(n(controls[2]).value, 'draft-guid')
context.app.settingsDirty = false
for (const id of controls) {
  context.document.activeElement = n(id)
  context.renderSettings(false)
  assert.equal(n(controls[1]).value, 'draft-name', `${id} focus protects all setting drafts`)
}
context.document.activeElement = null
context.app.settingsDirty = true
for (const status of ['uninitialized', 'checking', 'ready', 'failed', 'unknown', 'unexpected', '__proto__']) {
  context.app.snap.managedTasklist = { guid: 'actual-guid', name: 'actual-name', status, checkedAt: 'check-time', fields: [], errors: [] }
  context.renderManagedTasklistStatus()
  assert.match(text(n('managedTasklistStatus')), new RegExp(status === 'unexpected' || status === '__proto__' ? 'unknown' : status))
  assert.match(text(n('managedTasklistIdentity')), /actual-name.*actual-guid/)
  assert.equal(n('managedTasklistCheckedAt').textContent, '最近检查：absolute:check-time')
  assert.equal(n('managedTasklistErrors').hidden, true)
  assert.equal(n(controls[1]).value, 'draft-name', 'status does not overwrite dirty controls')
  assert.equal(n(controls[2]).value, 'draft-guid')
}
const hostile = '<img src=x onerror="boom()"><script>bad()</script>'
const fields = Array.from({ length: 35 }, (_, i) => ({ key: `key-${i}`, name: `name-${i}${hostile}`, guid: `guid-${i}`, type: i === 0 ? 0 : 'text', ok: i % 2 === 0, error: i % 2 ? `type mismatch ${hostile}` : '' }))
context.app.snap.managedTasklist = { guid: hostile, name: hostile, status: 'failed', fields, errors: [hostile, { code: 'type_mismatch', message: hostile }] }
context.renderManagedTasklistStatus()
assert.equal(n('managedTasklistFields').children.length, fields.length, 'full field list is not truncated')
assert.equal(n('managedTasklistErrors').children.length, 2)
assert.match(text(n('managedTasklistFields')), /key-34/)
assert.match(text(n('managedTasklistFields')), /guid-34/)
assert.match(text(n('managedTasklistFields')), /类型：0/)
assert.match(text(n('managedTasklistFields')), /检查通过/)
assert.match(text(n('managedTasklistFields')), /检查失败/)
assert.ok(text(n('managedTasklistFields')).includes(hostile))
assert.ok(text(n('managedTasklistErrors')).includes('type_mismatch'))
const tags = (node) => [node.tag, ...node.children.flatMap(tags)]
for (const id of ['managedTasklistStatus', 'managedTasklistFields', 'managedTasklistErrors']) assert.ok(tags(n(id)).every((tag) => ['div', 'ul', 'li', 'span'].includes(tag)), 'hostile markup is literal text')
context.app.snap = {}
context.renderManagedTasklistStatus()
assert.match(text(n('managedTasklistStatus')), /unknown/)
assert.match(text(n('managedTasklistFields')), /暂无/)
assert.equal(n('managedTasklistErrors').children.length, 0, 'stale errors cleared')
assert.equal(pending, undefined, 'all configuration/DOM operations stay offline')

n(controls[1]).value = '  saved-name  '; n(controls[2]).value = '  explicit-guid  '; n(controls[0]).checked = false
context.onSave()
assert.deepEqual(plain(pending.payload.managedTasklist), { enabled: false, name: 'saved-name', guid: 'explicit-guid' })
assert.equal(loadCalls, 0, 'settings request does not invoke sync/load before success')
assert.equal(n('saveSettings').disabled, true)
context.onSave()
const submitted = pending
pending.reject()
assert.equal(context.app.settingsDirty, true)
assert.equal(n(controls[1]).value, '  saved-name  ', 'failed save preserves draft')
assert.equal(n('saveSettings').disabled, false)
n(controls[1]).value = '   '; n(controls[2]).value = ''; n(controls[0]).checked = true
context.onSave()
assert.notEqual(pending, submitted)
assert.deepEqual(plain(pending.payload.managedTasklist), { enabled: true, name: 'DSH 任务清单', guid: '' })
pending.resolve({ settings: { managedTasklist: plain(pending.payload.managedTasklist) } })
assert.equal(context.app.settingsDirty, false)
assert.equal(n(controls[1]).value, 'DSH 任务清单')
assert.equal(n(controls[2]).value, '')
assert.equal(loadCalls, 1, 'existing quiet state reload after save remains intact, no sync')
assert.doesNotMatch(extract('onSave'), /onSync\(|api\(['"]sync/)
console.log('TASKLIST_PANEL_OK: defaults, settings patch, dirty/focus drafts, real dirty wire, full status/fields/errors, safe DOM, isolated no-sync/no-network checks')
