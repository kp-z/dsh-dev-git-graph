import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import vm from 'node:vm'

// Production UI functions only, no boot IIFE, preview, server or real interfaces.
const html = await readFile(new URL('../panel.html', import.meta.url), 'utf8')
const script = [...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)].map(m => m[1]).join('\n')
new vm.Script(script)
function fn(name) {
  const match = script.match(new RegExp('  function ' + name + '\\([^]*?\\n  }'))
  assert.ok(match, `missing production function ${name}`)
  return match[0]
}
class Node {
  constructor(tag = 'div', attrs = {}) {
    this.tag = tag; this.attrs = {}; this.children = []; this.listeners = {}; this.dataset = {}
    this.value = ''; this.hidden = false; this.style = {}; this.textContent = ''
    for (const [k, v] of Object.entries(attrs)) k === 'text' ? this.textContent = v : this.setAttribute(k, v)
  }
  get className() { return this.attrs.class || '' }
  set className(v) { this.attrs.class = v }
  get classList() {
    return {
      contains: c => this.className.split(/\s+/).includes(c),
      toggle: (c, on) => { const classes = this.className.split(/\s+/).filter(x => x && x !== c); if (on) classes.push(c); this.className = classes.join(' ') },
      add: c => this.classList.toggle(c, true), remove: c => this.classList.toggle(c, false),
    }
  }
  setAttribute(k, v) { this.attrs[k] = String(v) }
  getAttribute(k) { return this.attrs[k] ?? null }
  removeAttribute(k) { delete this.attrs[k] }
  appendChild(n) { this.children.push(n); return n }
  addEventListener(k, f) { (this.listeners[k] ||= []).push(f) }
  fire(k, event = {}) { for (const f of this.listeners[k] || []) f.call(this, event) }
  focus() { ctx.document.activeElement = this }
  scrollIntoView() {}
}
const nodes = new Map([...html.matchAll(/\bid="([^"]+)"/g)].map(m => [m[1], new Node()]))
const n = id => nodes.get(id)
const document = new Node(), window = new Node()
document.hidden = false; document.activeElement = null; document.body = new Node()
const timers = new Map(), calls = [], pending = [], toasts = []
let timerId = 0, rendered = 0, observed = 0, disconnected = 0
let stateReply
const ctx = {
  app: { settings: { cliBackend: 'lark-cli', larkCliPath: '/saved/lark', cliPath: '/saved/internal', cliIndexUrl: 'https://saved/simple', larkAccountMode: 'enterprise' }, snap: { cli: { backend: 'lark-cli', found: true }, auth: { ok: false, stage: 'login' }, apiVersion: 6 }, busy: {}, serverFeatures: [], workspaces: [], currentSessionId: 'offline-session' },
  document, window, MIN_API_VERSION: 6, PRIMARY_CLI: {}, INTERNAL_CLI: {},
  $: id => n(id), el: (tag, attrs) => new Node(tag, attrs), clear: node => { node.children = []; node.textContent = '' },
  makeButton: (label, cls, busyLabel, busy, action) => { const b = new Node('button', { text: label, class: cls }); b.addEventListener('click', action); return b },
  authLinkBox: () => null, appIdRow: () => new Node(), larkScopeGuide: () => new Node(),
  renderStatus() {}, renderManagedTasklistStatus() {}, renderStaleHost() {}, toast: t => toasts.push(t),
  afterAuthOk() {}, renderSetupChips() {}, hostOutdated: () => false,
  api: (path, body, opts) => {
    calls.push({ path, body, opts })
    if (path === 'state') return Promise.resolve(structuredClone(stateReply))
    assert.ok(['settings', 'auth/check'].includes(path), `unexpected API double path ${path}`)
    return new Promise((resolve, reject) => pending.push({ path, body, resolve, reject }))
  },
  fetch() { throw new Error('network forbidden') }, onInstallCli() { throw new Error('installation forbidden') },
  setTimeout: (f, delay) => { const id = ++timerId; timers.set(id, { f, delay }); return id }, clearTimeout: id => timers.delete(id),
  connectActivityStream() {}, stopActivityStream() {}, deferAuxiliaryLoads() {},
  activityState: () => ctx.app.activity || (ctx.app.activity = {}),
  taskRenderObserver: { observe() { observed++ }, disconnect() { disconnected++ } },
  renderAll() { rendered++; ctx.renderSetup(); ctx.renderAuth(); ctx.scheduleAuthWatch() },
  maybeAutoInsight() {}, pollCardComments() {}, updateTaskActivityNodes() {},
}
vm.createContext(ctx)
for (const name of ['backendOf', 'backendLabel', 'setupState', 'setupCliDraft', 'wireSetupCliSettings', 'renderSetupCli', 'renderCliChoice', 'onSaveSetupSettings', 'onSwitchLarkMode', 'authStepCard', 'appendFeishuAuthSteps', 'appendLarkAuthSteps', 'deriveNext', 'nextActionRow', 'renderAuth', 'stopAuthWatch', 'scheduleAuthWatch', 'disposeActivityPanel', 'load', 'stablePanelSignature', 'stateSignature', 'schedulePoll']) vm.runInContext(fn(name), ctx)
const configStart = script.indexOf('  var CONFIGURATION_KEYS =')
const configEnd = script.indexOf('  /* ---------------- 渲染：设置', configStart)
vm.runInContext(script.slice(configStart, configEnd), ctx)
ctx.renderSetup = () => ctx.renderSetupCli(ctx.setupState())
ctx.wireConfiguration(); ctx.wireSetupCliSettings(); ctx.wireSetupCliSettings()
assert.equal(n('cliPathInput').listeners.input.length, 1, 'draft listeners do not duplicate')
assert.match(fn('wire'), /wireSetupCliSettings\(\)/, 'production wire binds draft tracking')
const tick = async () => { for (let i = 0; i < 12; i++) await Promise.resolve() }
const edit = (id, value) => { n(id).focus(); n(id).value = value; n(id).fire('input') }
const switchBackend = backend => { ctx.app.settings.cliBackend = backend; ctx.app.snap.cli.backend = backend; ctx.renderSetup() }
const refresh = () => { ctx.renderSetup(); ctx.renderAuth() }
const resolveSettings = (extra = {}) => {
  const request = pending.find(p => p.path === 'settings'); assert.ok(request)
  pending.splice(pending.indexOf(request), 1)
  const settings = { ...ctx.app.settings, ...request.body, ...extra }
  stateReply = { state: structuredClone(ctx.app.snap), settings }
  request.resolve({ settings })
}

// Both fields survive blur, switching focus, every config tab and full UI refresh.
refresh()
edit('cliPathInput', ' /draft/lark ')
edit('cliIndexUrl', ' https://draft/simple ')
refresh()
assert.equal(n('cliPathInput').value, ' /draft/lark ')
for (const tab of ['settings', 'auth', 'docs', 'syncHistory', 'docPrompt']) {
  n(`configTab-${tab}`).fire('click'); document.activeElement = n(`configTab-${tab}`)
  refresh()
  assert.equal(n('cliPathInput').value, ' /draft/lark ')
  assert.equal(n('cliIndexUrl').value, ' https://draft/simple ')
}
ctx.closeConfiguration(); document.activeElement = null; refresh()
assert.equal(n('cliIndexUrl').value, ' https://draft/simple ')

// Backend switch replaces even a focused input, and restores only its own draft.
n('cliPathInput').focus(); switchBackend('feishu-sync')
assert.equal(n('cliPathInput').value, '/saved/internal')
assert.equal(n('cliIndexUrl').value, 'https://saved/simple')
edit('cliPathInput', '/draft/internal'); edit('cliIndexUrl', 'https://internal/simple')
switchBackend('lark-cli')
assert.equal(n('cliPathInput').value, ' /draft/lark ')
assert.equal(n('cliIndexUrl').value, ' https://draft/simple ')
// A switch snapshot before any render must not save old DOM into the new backend.
ctx.app.settings.cliBackend = 'feishu-sync'; ctx.app.snap.cli.backend = 'feishu-sync'
let saved = ctx.onSaveSetupSettings()
assert.equal(calls.at(-1).body.cliPath, '/draft/internal')
assert.equal(calls.at(-1).body.cliIndexUrl, 'https://internal/simple')
assert.equal(calls.at(-1).body.larkCliPath, undefined)
pending.shift().reject(new Error('offline save failure')); await saved
assert.equal(ctx.setupCliDraft('feishu-sync').dirty.cliPathInput, true)
refresh(); assert.equal(n('cliPathInput').value, '/draft/internal')
// An incomplete success envelope is not a successful save.
saved = ctx.onSaveSetupSettings(); pending.shift().resolve({}); await saved
assert.equal(ctx.setupCliDraft('feishu-sync').dirty.cliIndexUrl, true)
// A successful save clears just that backend and refreshes normalized settings.
saved = ctx.onSaveSetupSettings(); resolveSettings(); await saved
assert.deepEqual(Object.keys(ctx.setupCliDraft('feishu-sync').dirty), [])
assert.equal(ctx.setupCliDraft('lark-cli').dirty.cliPathInput, true)
switchBackend('lark-cli'); saved = ctx.onSaveSetupSettings()
assert.equal(calls.at(-1).body.larkCliPath, '/draft/lark')
edit('cliPathInput', '/newer/lark'); edit('cliIndexUrl', 'https://newer/simple')
resolveSettings(); await saved; document.activeElement = null; refresh()
assert.equal(n('cliPathInput').value, '/newer/lark', 'edits made during save survive its receipt')
assert.equal(n('cliIndexUrl').value, 'https://newer/simple')
saved = ctx.onSaveSetupSettings(); resolveSettings(); await saved
assert.deepEqual(Object.keys(ctx.setupCliDraft('lark-cli').dirty), [])

// Actual mode-switch action and actual auth subtree rendering on each round trip.
const descendants = node => node.children.flatMap(child => [child, ...descendants(child)])
const selectedMode = () => descendants(n('authBody')).filter(x => x.tag === 'button' && x.classList.contains('active')).map(x => x.textContent)
refresh(); assert.deepEqual(selectedMode(), ['企业应用'])
for (const [mode, label] of [['individual', '个人账号'], ['enterprise', '企业应用'], ['individual', '个人账号'], ['enterprise', '企业应用']]) {
  ctx.onSwitchLarkMode(mode); resolveSettings(); await tick()
  assert.equal(ctx.app.settings.larkAccountMode, mode)
  assert.deepEqual(selectedMode(), [label])
}
const sameAuthChildren = [...n('authBody').children]; ctx.renderAuth()
assert.deepEqual(n('authBody').children, sameAuthChildren, 'unchanged auth avoids subtree rebuild')

// Execute the production lifecycle listener block, not hand-built event behavior.
const lifecycleStart = script.indexOf("    document.addEventListener('visibilitychange'")
const lifecycleEnd = script.indexOf('\n  }', lifecycleStart)
vm.runInContext(script.slice(lifecycleStart, lifecycleEnd), ctx)
const authTimers = () => [...timers.entries()].filter(([, t]) => t.delay === 4000)
const fireTimer = ([id, timer]) => { timers.delete(id); timer.f() }
const setVisible = visible => { document.hidden = !visible; document.fire('visibilitychange') }
edit('cliPathInput', '/watcher/draft'); edit('cliIndexUrl', 'https://watcher/simple'); document.activeElement = null
ctx.scheduleAuthWatch(); assert.equal(authTimers().length, 1)
const staleTimer = authTimers()[0]
setVisible(false)
assert.equal(authTimers().length, 0, 'hide cancels watcher')
staleTimer[1].f()
assert.equal(pending.length, 0, 'queued old timer never checks auth while hidden')
// Identical load signature returns early, but visible must explicitly re-arm.
stateReply = { state: structuredClone(ctx.app.snap), settings: structuredClone(ctx.app.settings) }
ctx.app.loadedOnce = true; ctx.app.lastSig = ctx.stateSignature(stateReply.state)
const rendersBefore = rendered
setVisible(true); await tick()
assert.equal(rendered, rendersBefore, 'unchanged state load deliberately does not render')
assert.equal(authTimers().length, 1, 'visible explicitly rearms unchanged snapshot')
staleTimer[1].f()
assert.equal(pending.length, 0, 'obsolete timer stays invalid after visible rearm')
setVisible(true); setVisible(true); await tick(); assert.equal(authTimers().length, 1)
fireTimer(authTimers()[0]); assert.equal(pending.at(-1).path, 'auth/check')
pending.shift().resolve({ auth: { ok: false, stage: 'login', detail: 'fresh auth check' } }); await tick()
assert.equal(n('cliPathInput').value, '/watcher/draft')
assert.equal(n('cliIndexUrl').value, 'https://watcher/simple', 'real watcher render preserves blurred drafts')
assert.equal(authTimers().length, 1)
// Hide during an in-flight check: completion is allowed, no follow-up timer/check.
fireTimer(authTimers()[0]); setVisible(false)
pending.shift().resolve({ auth: { ok: false, stage: 'login' } }); await tick()
assert.equal(authTimers().length, 0)
const checksWhileHidden = calls.filter(c => c.path === 'auth/check').length
ctx.scheduleAuthWatch(); assert.equal(authTimers().length, 0)
assert.equal(calls.filter(c => c.path === 'auth/check').length, checksWhileHidden)
setVisible(true); await tick(); assert.equal(authTimers().length, 1)
// BFCache cleanup and restore, including already queued and in-flight callbacks.
const beforeHide = authTimers()[0]
window.fire('pagehide'); window.fire('pagehide')
assert.equal(authTimers().length, 0); assert.equal(ctx.app.authTimer, null)
beforeHide[1].f(); assert.equal(pending.length, 0)
ctx.renderAll(); assert.equal(authTimers().length, 0, 'disposed panel cannot rearm through render')
window.fire('pageshow', { persisted: false }); assert.equal(authTimers().length, 0)
window.fire('pageshow', { persisted: true }); window.fire('pageshow', { persisted: true }); await tick()
assert.equal(authTimers().length, 1); assert.equal(ctx.app.activity.disposed, false)
assert.equal(disconnected, 2); assert.equal(observed, 2)
fireTimer(authTimers()[0]); window.fire('pagehide')
pending.shift().resolve({ auth: { ok: false, stage: 'login' } }); await tick()
assert.equal(authTimers().length, 0, 'late completion after pagehide cannot restart watcher')
window.fire('pageshow', { persisted: true }); await tick(); assert.equal(authTimers().length, 1)
ctx.app.snap.auth = { ok: true }; ctx.scheduleAuthWatch(); assert.equal(authTimers().length, 0)
ctx.app.snap.auth = { ok: false, stage: 'config' }; ctx.scheduleAuthWatch(); assert.equal(authTimers().length, 1)
ctx.app.snap.cli.found = false; ctx.scheduleAuthWatch(); assert.equal(authTimers().length, 0)
assert.equal(pending.length, 0)
console.log('SETUP_PANEL_REGRESSION_OK: offline production UI VM/fakeDOM drafts + blur/tabs/auth refresh, backend-isolated save/retry/concurrent edits, enterprise/individual round trips, hidden/visible unchanged load + queued/in-flight timers + BFCache cleanup/restore')
