import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import vm from 'node:vm'
const html = await readFile(new URL('../panel.html', import.meta.url), 'utf8')
const script = [...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)].map((m) => m[1]).join('\n')
new vm.Script(script)
function fn(name) { const start = script.indexOf(`  function ${name}(`); assert.ok(start >= 0, name); const end = script.indexOf('\n  function ', start + 3); return script.slice(start, end) }
class Node {
  constructor() { this.children = []; this.parent = null }
  insertBefore(n, next) { if (n.parent) n.parent.removeChild(n); const i = next ? this.children.indexOf(next) : this.children.length; this.children.splice(i, 0, n); n.parent = this }
  appendChild(n) { this.insertBefore(n, null) }
  removeChild(n) { this.children.splice(this.children.indexOf(n), 1); n.parent = null }
}
const nodes = new Map(['taskList', 'taskCount', 'taskListName', 'syncNow', 'insightCharts'].map((id) => [id, new Node()]))
let made = 0, chartClears = 0, renderAllCalls = 0, requests = 0, resolveState
let hideA = false, menu = false
const context = {
  app: { snap: { tasks: [{ id: 'a', title: 'A', docs: [] }, { id: 'b', title: 'B', docs: [] }] }, busy: {}, busyTask: {}, currentSessionId: '', settings: {}, workspaces: [], serverFeatures: [] },
  $: (id) => nodes.get(id), document: { hidden: false, body: { className: '' }, querySelector: () => menu ? {} : null },
  normPriority: () => '', PRIORITY_OPTIONS: [], renderFilterOptions() {},
  filterTasksForPanel: (tasks) => tasks.filter((t) => !hideA || t.id !== 'a'),
  taskNode(task) { made++; const node = new Node(); node.task = task; return node },
  sessionSyncNode: () => null, emptyNode: () => new Node(),
  clear(node) { if (node === nodes.get('insightCharts')) chartClears++; node.children = [] },
  el: () => new Node(), insightChartSpecs: () => [{ type: 'bar', dataset: 'x' }], chartBarCanvas: () => new Node(),
  api(path) { requests++; return new Promise((resolve) => { resolveState = resolve }) },
  renderAll: () => { renderAllCalls++ }, markCurrentSessionSeen() {}, maybeAutoInsight() {}, renderHostStaleBar() {},
  setTimeout, clearTimeout,
}
vm.createContext(context)
for (const name of ['stablePanelSignature', 'syncCachedTask', 'reconcilePanelChildren', 'taskCardSignature', 'renderTasks', 'flushPendingTaskRender', 'stateSignature', 'load', 'renderInsightCharts', 'schedulePoll']) vm.runInContext(fn(name), context)
context.renderTasks()
assert.equal(made, 2)
const oldA = nodes.get('taskList').children[0], oldB = nodes.get('taskList').children[1]
context.app.snap.tasks = [{ id: 'a', title: 'A', docs: [], seenAt: 5 }, { id: 'b', title: 'B', docs: [] }]
context.renderTasks()
assert.equal(made, 2)
assert.equal(nodes.get('taskList').children[0], oldA)
assert.equal(oldA.task.seenAt, 5) // stable closure sees fresh snapshot even without rebuild
context.app.snap.tasks[0].title = 'Changed'
context.renderTasks()
assert.equal(made, 3)
assert.equal(nodes.get('taskList').children[1], oldB)
hideA = true
context.renderTasks()
assert.equal(made, 3)
hideA = false
context.renderTasks()
assert.equal(made, 3)
assert.equal(nodes.get('taskList').children.length, 2)
menu = true
context.app.snap.tasks[1].title = 'Menu update'
context.renderTasks()
assert.equal(made, 3)
assert.equal(context.app.taskRenderPending, true)
menu = false
context.flushPendingTaskRender()
assert.equal(made, 4)

const base = { tasks: [{ id: 'a', title: 'A', docs: [{ title: 'doc', url: 'url' }] }] }
const initial = context.stateSignature(base)
for (const [key, value] of Object.entries({ suspension: { active: true }, relations: { ready: false }, sessionPhase: 'working', description: 'new', members: [{ name: 'Changed' }], schedule: { summary: 'changed' } })) {
  const changed = structuredClone(base); changed.tasks[0][key] = value
  assert.notEqual(context.stateSignature(changed), initial, key)
}
const docsChanged = structuredClone(base); docsChanged.tasks[0].docs[0].url = 'new'
assert.notEqual(context.stateSignature(docsChanged), initial)
context.app.settings = { value: 'a' }; const settingsSig = context.stateSignature(base)
context.app.settings = { value: 'b' }; assert.notEqual(context.stateSignature(base), settingsSig)
const seen = structuredClone(base); seen.tasks[0].seenAt = 9
assert.equal(context.stateSignature(seen), context.stateSignature(base))
const first = context.load(), second = context.load({ quiet: true })
assert.equal(first, second)
assert.equal(requests, 1)
resolveState({ state: base, settings: {}, workspaces: [] })
await first
assert.equal(context.app.loadPromise, null)
assert.equal(renderAllCalls, 1)
const third = context.load()
assert.equal(requests, 2)
resolveState({ state: base, settings: {}, workspaces: [] })
await third
assert.equal(renderAllCalls, 1)
context.app.insightStats = { datasets: { x: { values: [1, 2] } } }
context.renderInsightCharts(); context.renderInsightCharts()
assert.equal(chartClears, 1)
context.document.body.className = 'dark'
context.renderInsightCharts()
assert.equal(chartClears, 2)
context.app.insightStats.datasets.x.values[0] = 3
context.renderInsightCharts()
assert.equal(chartClears, 3)
context.document.hidden = true
context.schedulePoll()
assert.equal(context.app.pollTimer, null)
assert.match(script, /load\(\)\.then\(function \(\) \{ schedulePoll\(\); deferAuxiliaryLoads\(\);/)
vm.runInContext(fn('changeWorkspace'), context)
let resolveBind
context.api = () => new Promise((resolve) => { resolveBind = resolve })
let workspaceRendered = false
context.renderTasks = () => { workspaceRendered = true }
context.toast = () => {}
context.load = () => new Promise(() => {}) // state remains slow; local feedback must already be visible
const workspaceTask = context.app.snap.tasks[0]
context.changeWorkspace(workspaceTask, { id: 'new-ws', title: 'New workspace', path: '/new' })
resolveBind({ ok: true, workspace: { id: 'new-ws', title: 'New workspace', path: '/new' }, writeBack: { pending: true } })
await new Promise((resolve) => setImmediate(resolve))
assert.equal(workspaceTask.workspaceId, 'new-ws')
assert.equal(workspaceTask.meta.workspace, 'New workspace')
assert.equal(workspaceTask.workspaceWrite.pending, true)
assert.equal(workspaceRendered, true)
// A state request starts before bind success: its old response must neither
// replace the optimistic task nor settle callers until a post-mutation reread.
vm.runInContext(fn('load'), context)
const stateFlights = []
context.api = (path) => {
  if (path === 'state') return new Promise((resolve) => stateFlights.push(resolve))
  if (path === 'workspaces/bind') return new Promise((resolve) => { resolveBind = resolve })
  throw new Error(path)
}
context.app.loadedOnce = false
const stale = structuredClone(context.app.snap)
stale.tasks[0].workspaceId = 'old-ws'
const inFlight = context.load({ quiet: true })
let settled = false
inFlight.then(() => { settled = true })
context.changeWorkspace(context.app.snap.tasks[0], { id: 'latest-ws', title: 'Latest', path: '/latest' })
resolveBind({ ok: true, workspace: { id: 'latest-ws', title: 'Latest', path: '/latest' }, writeBack: { pending: true } })
await new Promise((resolve) => setImmediate(resolve))
assert.equal(context.app.snap.tasks[0].workspaceId, 'latest-ws')
stateFlights[0]({ state: stale, settings: { stale: true } })
await new Promise((resolve) => setImmediate(resolve))
assert.equal(context.app.snap.tasks[0].workspaceId, 'latest-ws')
assert.equal(context.app.settings.stale, undefined)
assert.equal(stateFlights.length, 2)
assert.equal(settled, false)
const fresh = structuredClone(context.app.snap)
stateFlights[1]({ state: fresh, settings: { fresh: true }, workspaces: [] })
await inFlight
assert.equal(context.app.snap.tasks[0].workspaceId, 'latest-ws')
assert.equal(context.app.settings.fresh, true)
assert.equal(context.app.loadPromise, null)
assert.equal(settled, true)
console.log('PERFORMANCE_PANEL_OK: keyed 0/1 rebuild, fresh closure, filter cache, pending menu, signatures, singleflight, chart reuse, hidden polling')
