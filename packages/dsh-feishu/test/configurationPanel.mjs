import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import vm from 'node:vm'

// Offline source/VM regressions only: never boot the panel or call Feishu APIs.
const html = await readFile(new URL('../panel.html', import.meta.url), 'utf8')
const script = [...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)].map((m) => m[1]).join('\n')
new vm.Script(script)

// Small structural tokenizer, not a renderer. Track actual ancestry so moving a
// card outside the hidden configuration area cannot pass a regex-only check.
const nodes = []
const stack = []
const byId = new Map()
const source = html.replace(/<!--[\s\S]*?-->/g, '').replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/g, '')
const voidTags = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr'])
for (const match of source.matchAll(/<\/?([a-z][\w-]*)\b([^>]*)>/gi)) {
  const tag = match[1].toLowerCase()
  if (match[0].startsWith('</')) {
    const i = stack.findLastIndex((n) => n.tag === tag)
    assert.ok(i >= 0, `unexpected closing tag ${tag}`)
    assert.equal(i, stack.length - 1, `unclosed element before closing ${tag}`)
    stack.length = i
    continue
  }
  const attrs = Object.fromEntries([...match[2].matchAll(/([^\s=/'"]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g)].map((m) => [m[1], m[2] ?? m[3] ?? m[4] ?? '']))
  const node = { tag, attrs, parent: stack.at(-1), children: [] }
  node.parent?.children.push(node)
  nodes.push(node)
  if (attrs.id) {
    assert.ok(!byId.has(attrs.id), `duplicate id ${attrs.id}`)
    byId.set(attrs.id, node)
  }
  if (!voidTags.has(tag) && !match[0].endsWith('/>')) stack.push(node)
}
const get = (id) => { const n = byId.get(id); assert.ok(n, `missing #${id}`); return n }
const has = (n, attr) => Object.hasOwn(n.attrs, attr)
const classHas = (n, cls) => (n.attrs.class || '').split(/\s+/).includes(cls)
const within = (n, root) => { for (let p = n.parent; p; p = p.parent) if (p === root) return true; return false }
const area = get('configurationArea')
assert.ok(has(area, 'hidden'), 'configuration is hidden on first paint')
const toggle = get('configurationToggle')
assert.equal(toggle.attrs['aria-expanded'], 'false')
assert.equal(toggle.attrs['aria-controls'], 'configurationArea')
assert.ok(classHas(toggle.parent, 'panel-header'), 'configuration belongs in the panel header, not a task card')
assert.equal(toggle.parent.tag, 'header')
assert.equal(get('statusbar').parent, toggle.parent, 'configuration sits beside global status')
assert.ok(within(get('configurationClose'), area))
const panels = { settings: 'settingsCard', auth: 'authCard', docPrompt: 'docPromptCard', docs: 'docsCard', syncHistory: 'syncHistoryCard' }
const tabs = nodes.filter((n) => has(n, 'data-config-tab'))
assert.deepEqual(tabs.map((n) => n.attrs['data-config-tab']).sort(), Object.keys(panels).sort())
for (const [key, id] of Object.entries(panels)) {
  const panel = get(id)
  assert.ok(within(panel, area), `${id} must be inside the hidden configuration area`)
  assert.equal(panel.attrs.role, 'tabpanel')
  assert.equal(has(panel, 'hidden'), key !== 'settings', 'only the default settings panel is internally visible')
  const tab = tabs.find((n) => n.attrs['data-config-tab'] === key)
  assert.ok(within(tab, area))
  assert.equal(tab.attrs.role, 'tab')
  assert.equal(tab.attrs['aria-controls'], id)
  assert.equal(tab.attrs['aria-selected'], String(key === 'settings'))
  assert.equal(panel.attrs['aria-labelledby'], tab.attrs.id)
}
const settings = get('settingsCard')
const groups = nodes.filter((n) => n.tag === 'details' && classHas(n, 'setting-group'))
assert.ok(groups.length >= 3, 'advanced settings have meaningful collapsed groups')
for (const group of groups) {
  assert.ok(within(group, settings))
  assert.equal(has(group, 'open'), false, 'advanced groups must default to closed')
  assert.equal(group.children[0]?.tag, 'summary')
}
for (const id of ['autoSync', 'syncInterval', 'keyword']) {
  assert.ok(within(get(id), settings))
  assert.ok(!groups.some((group) => within(get(id), group)), `${id} remains in always-visible basics`)
}
for (const id of ['autoStartMode', 'maxAutoStart', 'schMissPolicy', 'schGrace', 'autoComment', 'autoCommentGap', 'normalizeNames', 'cleanOrphans']) {
  assert.ok(groups.some((group) => within(get(id), group)), `${id} belongs to a collapsed advanced group`)
}
assert.ok(within(get('saveSettings'), settings))
assert.ok(!groups.some((group) => within(get('saveSettings'), group)), 'save button stays outside collapsed groups')
assert.ok(/\.configuration-area\[hidden\][^{]*\{[^}]*display:\s*none/.test(html), 'configuration area has an explicit hidden display guard')
assert.ok(/\.configuration-panel\[hidden\][^{]*\{[^}]*display:\s*none/.test(html), 'configuration panels have an explicit hidden display guard')

function extract(name) {
  const match = script.match(new RegExp('  function ' + name + '\\([^]*?\\n  }'))
  assert.ok(match, `missing function ${name}`)
  new vm.Script(match[0])
  return match[0]
}

// Evaluate only configuration/settings functions, never the boot IIFE. The
// doubles preserve identity, values, listeners and focus; all API/load paths
// throw, making accidental writes visible rather than issuing real requests.
let context
const registry = new Map()
for (const [id, src] of byId) {
  registry.set(id, {
    attrs: { ...src.attrs }, hidden: has(src, 'hidden'), value: src.attrs.value || '', checked: has(src, 'checked'), disabled: has(src, 'disabled'),
    textContent: '', listeners: {},
    setAttribute(k, v) { this.attrs[k] = String(v) },
    getAttribute(k) { return this.attrs[k] },
    addEventListener(k, fn) { (this.listeners[k] ||= []).push(fn) },
    fire(k, event = {}) { for (const fn of this.listeners[k] || []) fn.call(this, event) },
    focus() { context.document.activeElement = this },
    scrollIntoView() { this.scrolled = true },
  })
}
const forbidden = () => { throw new Error('configuration switch must not call persistence, networking or render/load') }
context = {
  app: { settingsDirty: true, docPromptDirty: true, settings: {}, workspaces: [] },
  document: { activeElement: null },
  $: (id) => registry.get(id),
  api: forbidden, fetch: forbidden, load: forbidden, onSave: forbidden,
  renderDocs: forbidden, renderAuth: forbidden, renderDocPrompt: forbidden,
  localStorage: { getItem: forbidden, setItem: forbidden },
  pad2: (n) => String(n).padStart(2, '0'),
  toInt: (v, def, min, max) => { const n = parseInt(v, 10); return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : def },
}
vm.createContext(context)
const configStart = script.indexOf('  var CONFIGURATION_KEYS =')
const configEnd = script.indexOf('  /* ---------------- 渲染：设置', configStart)
assert.ok(configStart >= 0 && configEnd > configStart, 'configuration functions have a bounded offline extraction region')
vm.runInContext(script.slice(configStart, configEnd), context)
const n = (id) => registry.get(id)
const drafts = ['keyword', 'syncInterval', 'maxAutoStart', 'schGrace', 'autoCommentGap', 'docPrompt', 'docUrl']
for (const [i, id] of drafts.entries()) n(id).value = `draft-${i}`
const before = drafts.map((id) => [id, n(id), n(id).value])
function expectSelected(key) {
  assert.equal(n('configurationArea').hidden, false)
  assert.equal(n('configurationToggle').getAttribute('aria-expanded'), 'true')
  for (const [name, id] of Object.entries(panels)) {
    assert.equal(n(id).hidden, name !== key)
    assert.equal(n(`configTab-${name}`).getAttribute('aria-selected'), String(name === key))
    assert.equal(n(`configTab-${name}`).getAttribute('tabindex'), name === key ? '0' : '-1')
  }
}
for (const key of Object.keys(panels)) { context.openConfiguration(key); expectSelected(key) }
for (const bad of [undefined, null, '', 'missing', '__proto__']) { context.openConfiguration(bad); expectSelected('syncHistory') }
context.closeConfiguration()
assert.equal(n('configurationArea').hidden, true)
assert.equal(n('configurationToggle').getAttribute('aria-expanded'), 'false')
assert.equal(context.document.activeElement, n('configurationToggle'))
context.wireConfiguration()
n('configurationToggle').fire('click')
expectSelected('syncHistory')
assert.equal(context.document.activeElement, n('configTab-syncHistory'))
assert.equal(n('configurationArea').scrolled, true)
n('configurationToggle').fire('click')
assert.equal(n('configurationArea').hidden, true)
n('configurationToggle').fire('click')
for (const key of Object.keys(panels)) { n(`configTab-${key}`).fire('click'); expectSelected(key) }
for (const [from, key, to] of [['docs', 'ArrowRight', 'syncHistory'], ['syncHistory', 'ArrowRight', 'settings'], ['settings', 'ArrowLeft', 'syncHistory'], ['auth', 'Home', 'settings'], ['settings', 'End', 'syncHistory']]) {
  let prevented = false
  n(`configTab-${from}`).fire('keydown', { key, preventDefault() { prevented = true } })
  assert.equal(prevented, true)
  expectSelected(to)
  assert.equal(context.document.activeElement, n(`configTab-${to}`))
}
n('configTab-syncHistory').fire('keydown', { key: 'Tab', preventDefault: forbidden })
expectSelected('syncHistory')
n('configurationClose').fire('click')
assert.equal(n('configurationArea').hidden, true)
for (const [id, node, value] of before) { assert.equal(n(id), node); assert.equal(n(id).value, value) }
assert.equal(context.app.settingsDirty, true)
assert.equal(context.app.docPromptDirty, true)

// Check every controlling-state combination and ensure dependency changes
// disable instead of clearing the user's saved/draft dependent values.
for (const autoSync of [false, true]) for (const mode of ['off', 'tagged', 'all']) for (const policy of ['delay', 'skip', 'next']) for (const comment of [false, true]) {
  n('autoSync').checked = autoSync
  n('autoStartMode').value = mode
  n('schMissPolicy').value = policy
  n('autoComment').checked = comment
  context.updateSettingDependencies()
  assert.equal(n('syncInterval').disabled, !autoSync)
  assert.equal(n('maxAutoStart').disabled, mode === 'off')
  assert.equal(n('schGrace').disabled, policy !== 'delay')
  assert.equal(n('autoCommentGap').disabled, !comment)
  for (const [id, , value] of before) assert.equal(n(id).value, value)
}
vm.runInContext(['isEditingSetting', 'renderWorkspaceHint', 'renderSettings', 'scheduleDefaults', 'normHm', 'renderScheduleSettings', 'markDirty'].map(extract).join('\n'), context)
context.app.settings = { autoSync: false, syncIntervalMinutes: 17, autoStartMode: 'off', maxAutoStartPerRun: 3, autoComment: false, autoCommentMinSeconds: 99, tasks: { keyword: 'server' }, schedule: { missPolicy: 'skip', graceMinutes: 35 } }
context.app.settingsDirty = true
context.renderSettings(false)
assert.equal(n('keyword').value, 'draft-0', 'dirty settings survive polling while configuration is closed')
context.app.settingsDirty = false
n('keyword').focus()
context.renderSettings(false)
assert.equal(n('keyword').value, 'draft-0', 'focused settings survive polling')
context.document.activeElement = null
context.renderSettings(false)
assert.equal(n('keyword').value, 'server')
for (const id of ['syncInterval', 'maxAutoStart', 'schGrace', 'autoCommentGap']) assert.equal(n(id).disabled, true)
context.app.settings = { autoSync: true, autoStartMode: 'all', autoComment: true, schedule: { missPolicy: 'delay' } }
context.renderSettings(true)
for (const id of ['syncInterval', 'maxAutoStart', 'schGrace', 'autoCommentGap']) assert.equal(n(id).disabled, false)
context.markDirty()
assert.equal(context.app.settingsDirty, true)
assert.match(n('settingsSummary').textContent, /未保存/)
// A tab switch blurs the prompt textarea. A later background render must not
// erase either typed or reset-to-default drafts merely because focus moved.
context.DEFAULT_DOC_PROMPT = 'default-prompt'
context.app.settings.docPrompt = 'server-prompt'
context.app.docPromptDirty = true
n('docPrompt').value = 'unsaved-prompt'
context.document.activeElement = n('configTab-settings')
vm.runInContext(extract('renderDocPrompt') + '\n' + extract('wireDocPrompt'), context)
context.renderDocPrompt()
assert.equal(n('docPrompt').value, 'unsaved-prompt', 'background render must preserve a blurred prompt draft')
context.app.docPromptDirty = false
context.renderDocPrompt()
assert.equal(n('docPrompt').value, 'server-prompt')
context.wireDocPrompt()
n('docPrompt').value = 'typed-prompt'
n('docPrompt').fire('input')
assert.equal(context.app.docPromptDirty, true, 'prompt input participates in draft protection')
context.renderDocPrompt()
assert.equal(n('docPrompt').value, 'typed-prompt')
context.app.docPromptDirty = false
n('resetDocPrompt').fire('click')
assert.equal(context.app.docPromptDirty, true, 'reset-to-default is an unsaved draft too')
context.renderDocPrompt()
assert.equal(n('docPrompt').value, 'default-prompt')
// Explicit saves use a local callback-only API stub; no request ever leaves
// this process. Cover success, failure and typing again while save is pending.
let pending
context.api = (route, payload) => {
  assert.equal(route, 'settings')
  pending = { payload, resolve: null, reject: null }
  return { then(resolve, reject) { pending.resolve = resolve; pending.reject = reject } }
}
let loadCalls = 0
context.load = () => { loadCalls++ }
n('docPrompt').value = 'save-this'
n('docPrompt').fire('input')
n('saveDocPrompt').fire('click')
assert.equal(n('saveDocPrompt').disabled, true)
assert.equal(pending.payload.docPrompt, 'save-this')
pending.resolve({ settings: { docPrompt: 'save-this' } })
assert.equal(context.app.docPromptDirty, false)
assert.equal(n('saveDocPrompt').disabled, false)
assert.equal(loadCalls, 1)
n('docPrompt').value = 'first-version'
n('docPrompt').fire('input')
n('saveDocPrompt').fire('click')
n('docPrompt').value = 'newer-version'
n('docPrompt').fire('input')
pending.resolve({ settings: { docPrompt: 'first-version' } })
assert.equal(context.app.docPromptDirty, true, 'late save response must not clear a newer draft')
context.renderDocPrompt()
assert.equal(n('docPrompt').value, 'newer-version')
n('saveDocPrompt').fire('click')
pending.reject(new Error('offline failure'))
assert.equal(context.app.docPromptDirty, true)
assert.equal(n('saveDocPrompt').disabled, false)
context.renderDocPrompt()
assert.equal(n('docPrompt').value, 'newer-version')
const wire = extract('wire')
assert.match(wire, /wireConfiguration\(\)/, 'configuration event handlers are actually wired')
assert.match(wire, /addEventListener\('input', markDirty\)/)
assert.match(wire, /addEventListener\('change', markDirty\)/)

console.log('CONFIGURATION_PANEL_OK: hidden ancestry/IDs, exclusive tabs, collapsed advanced groups, draft/dirty retention, keyboard/focus/reopen, dependency combinations and render/wire integration')
