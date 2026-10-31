import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import vm from 'node:vm'

const html = await readFile(new URL('../panel.html', import.meta.url), 'utf8')
const script = [...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)].map(m => m[1]).join('\n')
new vm.Script(script)
function fn(name) {
  const start = script.indexOf(`  function ${name}(`)
  assert.ok(start >= 0, name)
  const end = script.indexOf('\n  function ', start + 3)
  return script.slice(start, end)
}
// Execute the production stream/load/render functions in a VM. This deliberately
// tiny DOM models the node identity, attributes, classList and listeners touched
// by the activity path; static contracts below cover actual panel wiring.
class Node {
  constructor(tag = 'span', attrs = {}) { this.tag = tag; this.attrs = {}; this.children = []; this.listeners = {}; this.isConnected = true; this.style = { setProperty() {} }; for (const [k,v] of Object.entries(attrs)) { if (k === 'text') this.textContent = v; else this.setAttribute(k,v) } }
  get className() { return this.attrs.class || '' }
  set className(v) { this.attrs.class = v }
  get classList() { return { contains: c => this.className.split(/\s+/).includes(c), toggle: (c,on) => { const classes = this.className.split(/\s+/).filter(Boolean).filter(x => x !== c); if(on) classes.push(c); this.className = classes.join(' ') } } }
  getAttribute(k) { return this.attrs[k] ?? null }
  setAttribute(k,v) { this.attrs[k] = String(v) }
  appendChild(n) { this.children.push(n); return n }
  addEventListener(k,fn) { this.listeners[k] = fn }
  querySelector(s) { return this.querySelectorAll(s)[0] || null }
  querySelectorAll(s) { return this.children.flatMap(n => [...(s === '.lamp' ? n.classList.contains('lamp') : n.attrs['data-activity-task'] !== undefined) ? [n] : [], ...n.querySelectorAll(s)]) }
}
const priority = new Node('button', { class: 'prio', 'data-value': 'P1', 'data-activity-task': 't1' })
const chip = new Node('button', { class: 'sess-inline', 'data-session': 's1', 'data-activity-task': 't1' })
const lamp = chip.appendChild(new Node('span', { class: 'lamp lamp-idle' }))
const draft = new Node('textarea'); draft.value = '不能丢的评论草稿'; draft.selectionStart = 4
const menu = new Node('div', { class: 'prio-menu' })
const card = new Node('div'); card.children = [priority, chip, draft, menu]
const bars = new Node()
const sources = [], timers = new Map(), flights = [], apiCalls = []
let timerId = 0, renders = 0, disconnected = 0
class EventSource {
  constructor(url) { this.url = url; this.handlers = {}; this.closed = false; sources.push(this) }
  addEventListener(k,f) { this.handlers[k] = f }
  close() { this.closed = true }
  emit(revision, sessions) { this.handlers.activity({ data: JSON.stringify({ revision, sessions }) }) }
  error() { this.handlers.error() }
}
const originalTask = { id: 't1', title: '任务', sessionId: 's1', priority: 'P1', sessionAlive: true, sessionPhase: 'idle', sessionTurn: 0, sessionUnread: false }
const ctx = {
  app: { snap: { tasks: [structuredClone(originalTask)] }, taskCache: { t1: { task: structuredClone(originalTask), node: card } }, currentSessionId: 's1', seenSent: {}, settings: {}, busyTask: {}, workspaces: [], serverFeatures: [] },
  API_BASE: '/dsh-feishu/api/', location: { href: 'https://example.test/dsh-feishu/panel', origin: 'https://example.test' }, URL,
  window: { EventSource }, document: { hidden: false, activeElement: draft, querySelectorAll: () => [priority,chip], querySelector: () => menu },
  $: () => bars, el: (tag,attrs) => new Node(tag,attrs), clear: n => { n.children = [] }, filterTasksForPanel: tasks => tasks,
  setTimeout: (f,delay) => { const id = ++timerId; timers.set(id,{f,delay}); return id }, clearTimeout: id => timers.delete(id),
  api: (path,body) => { apiCalls.push({path,body}); return path === 'state' ? new Promise(resolve => flights.push(resolve)) : Promise.resolve({}) },
  renderAll: () => { renders++ }, maybeAutoInsight() {}, pollCardComments() {}, taskRenderObserver: { disconnect() { disconnected++ } },
}
vm.createContext(ctx)
for (const name of ['activityState','currentActivityTask','sessionActivityLabel','updateSessionActivityChip','updateTaskActivityNodes','mergeActivitySnapshot','stopActivityStream','connectActivityStream','disposeActivityPanel','syncCachedTask','renderTaskActivity','stablePanelSignature','taskCardSignature','stateSignature','load','schedulePoll','markCurrentSessionSeen']) vm.runInContext(fn(name),ctx)
const session = (phase = 'running', unread = false, alive = true, turn = 1) => ({ id:'s1', alive, phase, unread, turn })
const task = () => ctx.app.snap.tasks[0]
const assertDraft = () => { assert.equal(ctx.document.activeElement,draft); assert.equal(draft.value,'不能丢的评论草稿'); assert.equal(draft.selectionStart,4); assert.deepEqual(card.children,[priority,chip,draft,menu]) }
ctx.app.titleEditing = true; ctx.app.docBinding = true; ctx.app.suspensionEditing = true
ctx.connectActivityStream()
assert.equal(sources.length,1); assert.equal(sources[0].url,'https://example.test/dsh-feishu/api/sessions/activity')
const first = sources[0]
const oldSignature = ctx.taskCardSignature(task())
first.emit(10,[session()])
assert.equal(task().sessionPhase,'running'); assert.equal(ctx.app.taskCache.t1.task.sessionPhase,'running')
assert.ok(priority.classList.contains('is-running')); assert.equal(lamp.className,'lamp lamp-running'); assert.match(priority.title,/正在运行/)
assert.match(bars.attrs['aria-label'],/正在运行 1 个任务/); assert.equal(renders,0); assertDraft()
assert.equal(ctx.taskCardSignature(task()),oldSignature)
first.emit(11,[session('idle',true)])
assert.equal(lamp.className,'lamp lamp-unread'); assert.ok(priority.classList.contains('is-unread')); assert.match(chip.attrs['aria-label'],/运行结束，尚未查看/)
assert.equal(apiCalls.length,0,'receiving completion must not markSeen'); assertDraft()
first.emit(10,[session()]); assert.equal(task().sessionPhase,'idle','old revision ignored')
first.emit(11,[session()]); assert.equal(task().sessionPhase,'idle','duplicate revision ignored')
first.emit(12,[session('running',true,false)])
assert.equal(task().sessionPhase,'idle'); assert.equal(task().sessionUnread,false); assert.equal(lamp.className,'lamp lamp-dead'); assert.doesNotMatch(priority.className,/is-running|is-unread/)
first.emit(13,[]); assert.equal(task().sessionAlive,false); assert.equal(task().sessionTurn,0,'absent session cleared by authoritative full baseline')
first.emit(14,[session()])
const pending = ctx.load({quiet:true})
first.emit(15,[session('idle',true,true,2)])
first.error()
assert.ok(first.closed); assert.equal(ctx.app.activity.live,false)
flights.shift()({state:{tasks:[structuredClone(originalTask)]},settings:{}})
await pending
assert.equal(task().sessionTurn,2,'slow response cannot overwrite newer stream state even after disconnect'); assert.ok(priority.classList.contains('is-unread')); assertDraft()
assert.equal(apiCalls.filter(x => x.path === 'sessions/seen').length,0)
const retry = [...timers.values()].find(t => t.delay === 20000 && t.f.toString().includes('connectActivityStream'))
assert.ok(retry,'404/errors retry no faster than existing poll'); assert.equal(sources.length,1)
// A state request started after disconnection is authoritative fallback polling.
const fallback = ctx.load({quiet:true}); flights.shift()({state:{tasks:[{...originalTask,sessionTurn:3}]},settings:{}}); await fallback
assert.equal(task().sessionTurn,3); assert.equal(lamp.className,'lamp lamp-idle')
retry.f(); const second = sources[1]; assert.ok(second)
second.emit(0,[session('idle',true,true,4)])
assert.equal(task().sessionTurn,4,'new connection accepts lower revision baseline')
first.emit(100,[session()]); assert.equal(task().sessionTurn,4,'old generation ignored')
ctx.document.hidden = true; ctx.stopActivityStream(); assert.ok(second.closed); assert.equal(ctx.app.activity.retryTimer,null)
second.emit(1,[session()]); assert.equal(task().sessionTurn,4)
ctx.connectActivityStream(); assert.equal(sources.length,2,'hidden never opens connection')
ctx.document.hidden = false; ctx.connectActivityStream(); const third = sources[2]
third.emit(1,[session('idle',false,true,5)]); assert.equal(lamp.className,'lamp lamp-idle')
ctx.disposeActivityPanel(); assert.ok(third.closed); assert.equal(ctx.app.pollTimer,null); assert.equal(disconnected,1)
third.emit(2,[session()]); ctx.connectActivityStream(); assert.equal(sources.length,3); ctx.schedulePoll(); assert.equal(ctx.app.pollTimer,null)
// Unsupported EventSource and unexpected URL both keep existing state polling.
ctx.app.activity = undefined; ctx.window.EventSource = undefined; ctx.connectActivityStream(); assert.equal(sources.length,3)
ctx.window.EventSource = EventSource; ctx.API_BASE = 'https://foreign.test/api/'; ctx.connectActivityStream(); assert.equal(sources.length,3)
ctx.API_BASE = '/dsh-feishu/api/'; ctx.connectActivityStream(); const fourth = sources[3]
fourth.handlers.activity({data:'bad-json'}); assert.ok(fourth.closed); assert.equal(ctx.app.activity.live,false)
// Wiring contracts: no full render or read acknowledgement in stream handler,
// fresh session chip closures, immediate connection before first task load,
// visibility teardown/reconnect and pagehide teardown exist in production HTML.
assert.doesNotMatch(fn('connectActivityStream'),/renderAll|renderTasks|markCurrentSessionSeen|sessions\/seen/)
assert.match(script,/if \(currentActivityTask\(t\)\.sessionAlive !== true\)/)
assert.match(script,/showSessionTip\(sessChip, sid, sessionTipState\(\)\)/)
assert.match(script,/connectActivityStream\(\);\s*load\(\)\.then/)
assert.match(script,/document\.hidden\) \{ stopActivityStream\(\)/)
assert.match(script,/else \{ connectActivityStream\(\); load\(\{ quiet: true \}\)/)
assert.match(script,/window\.addEventListener\('pagehide', disposeActivityPanel\)/)
assert.match(script,/if \(sessionChanged\) \{\s*if \(app\.loaded\) markCurrentSessionSeen\(\)/)
assert.doesNotMatch(fn('load'),/renderAll\(\);\s*markCurrentSessionSeen/)
assert.match(fn('load'),/activityWasLive/)
console.log('LIVE_ACTIVITY_PANEL_OK: VM/DOM running/idle/unread/dead/full baseline, drafts/focus/menu preserved, slow load + disconnect fallback, revisions/generations, reconnect low baseline, hidden/visible/pagehide, same-origin/unsupported/errors/backoff, no passive markSeen')
