import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import vm from 'node:vm'
const html = await readFile(new URL('../panel.html', import.meta.url), 'utf8')
const script = [...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)].map((m) => m[1]).join('\n')
new vm.Script(script)
const registry = new Map()
class Node {
  constructor(tag) { this.tag = tag; this.children = []; this.attrs = {}; this.listeners = {}; this.value = ''; this.classList = { toggle() {} } }
  appendChild(n) { n.parent = this; this.children.push(n); return n }
  removeChild(n) { this.children.splice(this.children.indexOf(n), 1) }
  remove() { this.parent?.removeChild(this) }
  get firstChild() { return this.children[0] }
  setAttribute(k, v) { this.attrs[k] = String(v); if (k === 'id') registry.set(v, this) }
  getAttribute(k) { return this.attrs[k] }
  addEventListener(k, fn) { this.listeners[k] = fn }
  focus() { context.document.activeElement = this }
  fire(k) { this.listeners[k]?.call(this) }
}
for (const id of ['filterFacets', 'filterPresets', 'filterSummary', 'filterResult', 'filterKeyword', 'taskFilterBar', 'filterToggle']) { const n = new Node('div'); n.setAttribute('id', id) }
const store = new Map()
const messages = []
const context = {
  toast: (text) => messages.push(text),
  app: { filter: null, filterOpen: false },
  window: { localStorage: {} }, localStorage: { getItem: (k) => store.get(k), setItem: (k, v) => store.set(k, v) },
  document: { activeElement: null },
  $: (id) => registry.get(id),
  clear(n) { while (n.firstChild) n.removeChild(n.firstChild) },
  el(tag, attrs = {}) { const n = new Node(tag); Object.entries(attrs).forEach(([k, v]) => k === 'text' ? n.textContent = v : n.setAttribute(k, v)); return n },
  makeButton(text, cls, busy, disabled, fn) { const n = new Node('button'); n.textContent = text; n.addEventListener('click', fn); return n },
}
vm.createContext(context)
const start = script.indexOf("  var FILTER_STORE =")
const end = script.indexOf('  /* 宿主旧代码', start)
vm.runInContext(script.slice(start, end), context)
const plain = (x) => JSON.parse(JSON.stringify(x))
const tasks = [
  { id: 'a', done: false, title: 'Build', workspaceId: 'one', workspaceTitle: 'Shared', workspacePath: '/one', priority: 'P0', relations: { ready: true } },
  { id: 'b', done: false, title: 'Review', started: true, workspaceId: 'two', workspaceTitle: 'Shared', workspacePath: '/two', priority: 'P1', relations: { ready: false } },
  { id: 'c', done: true, sessionId: 'bound', suspension: { active: true }, priority: 'strange', relations: null },
  { id: 'd', done: false, boundOnly: true, suspension: { active: true }, relations: {} },
  { id: 'e', done: 'false', started: 'false', suspension: { active: 'false' }, priority: '', relations: { ready: 'true' } },
]
context.renderTasks = () => context.renderFilterOptions(tasks)
const ids = () => context.filterTasksForPanel(tasks).map((t) => t.id).join(',')
const set = (id, mode, values) => { context.app.filter.facets[id] = { mode, values } }
context.loadFilter()
assert.equal(ids(), 'a,b,e')
assert.equal(context.app.filter.facets.completion.mode, 'exclude')
context.app.filter = context.createFilter('all')
assert.equal(ids(), 'a,b,c,d,e')
set('priority', 'include', ['P0', 'P1'])
assert.equal(ids(), 'a,b')
set('dependency', 'include', ['blocked'])
assert.equal(ids(), 'b')
set('priority', 'exclude', ['P1'])
assert.equal(ids(), '')
context.app.filter = context.createFilter('all')
set('dependency', 'include', ['unknown'])
assert.equal(ids(), 'c,d,e')
set('dependency', 'include', [])
assert.equal(ids(), '')
set('dependency', 'exclude', [])
assert.equal(ids(), 'a,b,c,d,e')
set('progress', 'include', ['bound'])
assert.equal(ids(), 'c,d')
set('progress', 'include', ['started'])
assert.equal(ids(), 'b')
context.app.filter = context.createFilter('all')
set('workspace', 'include', ['id:one'])
assert.equal(ids(), 'a')
tasks[0].workspaceTitle = 'Renamed'
assert.equal(ids(), 'a')
set('workspace', 'include', ['legacy:Shared'])
assert.equal(ids(), 'b')
set('workspace', 'include', ['none'])
assert.equal(ids(), 'c,d,e')
set('workspace', 'include', ['id:missing'])
assert.equal(ids(), '')
assert.ok(context.facetOptions(context.FACET_DEFS.find((d) => d.id === 'workspace'), tasks).some((row) => row.value === 'id:missing'))
tasks[0].workspaceTitle = 'Shared'
const ws = context.workspaceOptions(tasks, [])
assert.equal(ws.filter((row) => row.label.startsWith('Shared ·')).length, 2)

const old = context.normalizeFilter({ status: 'suspended', showSuspended: false, workspace: 'Missing', keyword: 'k' })
assert.deepEqual(plain(old.facets.completion), { mode: 'all', values: [] })
assert.deepEqual(plain(old.facets.handling), { mode: 'include', values: ['suspended'] })
assert.deepEqual(plain(old.facets.workspace), { mode: 'include', values: ['legacy:Missing'] })
assert.equal(context.normalizeFilter({ status: 'all', showSuspended: true }).facets.handling.mode, 'all')
for (const bad of [null, [], { version: 9 }, { version: 2, facets: { completion: { mode: 'bad', values: [] } } }]) assert.equal(context.normalizeFilter(bad).facets.completion.mode, 'exclude')
for (const values of [null, ['done', 7], new Array(2)]) {
  assert.equal(context.normalizeFilter({ version: 2, facets: { completion: { mode: 'include', values } } }).facets.completion.mode, 'exclude')
}
const valid = context.createFilter('all')
valid.facets.priority = { mode: 'include', values: ['future', 'future'] }
assert.deepEqual(plain(context.normalizeFilter(valid).facets.priority.values), ['future'])
context.app.filter = context.normalizeFilter(valid)
context.app.filterOpen = true
context.saveFilter()
assert.equal(JSON.parse(store.get('dsh-feishu:filter')).version, 2)
context.app.filter = null
context.loadFilter()
assert.equal(context.app.filterOpen, false)
assert.equal(JSON.parse(store.get('dsh-feishu:filter')).open, undefined)
assert.deepEqual(plain(context.app.filter.facets.priority.values), ['future'])
store.set('dsh-feishu:filter', '{bad')
context.loadFilter()
assert.equal(context.app.filter.facets.handling.mode, 'exclude')

context.renderFilterOptions(tasks)
assert.equal(registry.get('filterFacets').children.length, 6)
assert.equal(registry.get('filterPresets').children.length, 4)
assert.deepEqual(registry.get('filterPresets').children.map((n) => n.textContent), ['日常', '全部', '项目', '＋ 新模板'])
assert.equal(registry.get('filterSummary').hidden, true)
assert.equal(registry.get('filterSummary').children.length, 2) // defaults are real visible conditions
const mode = registry.get('filterMode-completion')
assert.deepEqual(mode.children.map((n) => n.textContent), ['不限', '只看所选', '排除所选'])
mode.focus()
mode.value = 'include'
mode.fire('change')
assert.equal(context.document.activeElement, mode)
assert.equal(registry.get('filterMode-completion'), mode)
const valueRoot = registry.get('filterValues-completion')
const done = valueRoot.children.find((n) => n.getAttribute('data-value') === 'done').children[0]
done.checked = false
done.focus()
done.fire('change')
assert.equal(context.document.activeElement, done)
assert.equal(valueRoot.children.find((n) => n.getAttribute('data-value') === 'done').children[0], done)
assert.equal(registry.get('filterNote-completion').textContent, '未选值，暂无匹配')
assert.equal(ids(), '')
registry.get('filterSummary').children[0].fire('click')
assert.equal(context.app.filter.facets.completion.mode, 'all')
assert.equal(context.app.filter.facets.handling.mode, 'exclude')
context.applyFilterPreset('suspended')
assert.equal(ids(), 'c,d') // done included by this explicit preset
assert.equal(context.app.filter.facets.completion.mode, 'all')
context.applyFilterPreset('all')
assert.equal(ids(), 'a,b,c,d,e')
assert.match(registry.get('filterSummary').children[0].textContent, /无筛选/)
context.applyFilterPreset('daily')
assert.equal(ids(), 'a,b,e')
set('handling', 'exclude', [])
context.renderFilterOptions(tasks)
assert.equal(registry.get('filterNote-handling').textContent, '未排除任何值')
assert.match(html, /清空全部条件/)
assert.match(html, /恢复默认/)
assert.match(html, /\.filter-value[^}]*max-width: 100%/)
assert.match(html, /\.filter-summary button[^}]*overflow-wrap: anywhere/)
assert.match(html, /\.filter-facet[^}]*min-width: 0/)
assert.doesNotMatch(script, /app\.filter\.status|\$\('filterWorkspace'\)/)
context.app.snap = { tasks }
context.app.filter = context.createFilter('all')
set('handling', 'include', ['suspended'])
assert.equal(context.saveFilterView('挂起任务', false), true)
const savedId = context.app.activeViewId
assert.equal(context.app.filterViews.length, 1)
assert.equal(context.saveFilterView('挂起任务', false), false)
assert.match(messages.at(-1), /名称已存在/)
context.app.filter.keyword = 'edited'
assert.equal(context.app.filterViews[0].filter.keyword, '') // independent clone
context.renderSavedFilterViews()
assert.equal(context.saveFilterView('', true), true)
assert.equal(context.app.filterViews[0].filter.keyword, 'edited')
context.applyFilterPreset('all')
context.app.filterOpen = true
context.selectFilterView(savedId)
assert.equal(context.app.filterOpen, false)
assert.equal(context.app.filter.keyword, 'edited')
const rulesBeforeDelete = JSON.stringify(context.app.filter)
assert.equal(context.deleteFilterView(false), false)
assert.equal(context.app.filterDeleteConfirm, true)
assert.equal(context.deleteFilterView(true), true)
assert.equal(context.app.filterViews.length, 0)
assert.equal(JSON.stringify(context.app.filter), rulesBeforeDelete)
assert.equal(context.app.activeViewId, '')
assert.equal(registry.get('filterPresets').children.length, 4)
assert.equal(context.saveFilterView('x'.repeat(25), false), false)
assert.equal(context.saveFilterView('日常', false), false)
assert.equal(context.saveFilterView('', true), false)
context.app.filterViews = Array.from({ length: 20 }, (_, i) => ({ id: String(i), name: String(i), filter: context.createFilter('all') }))
assert.equal(context.saveFilterView('overflow', false), false)
assert.match(messages.at(-1), /20/)
context.app.filterViews = []
const originalSet = context.localStorage.setItem
context.localStorage.setItem = () => { throw new Error('quota') }
assert.equal(context.saveFilterView('Failed', false), false)
assert.equal(context.app.filterViews.length, 0)
assert.match(messages.at(-1), /保存失败.*quota/)
context.localStorage.setItem = originalSet
store.set('dsh-feishu:filter-views', JSON.stringify([null, {}, { id: 'bad', name: 'Bad', filter: {} }]))
context.loadFilterViews()
assert.equal(context.app.filterViews.length, 0)
context.app.filter = context.createFilter('all')
assert.equal(context.saveFilterView('All clone', false), true)
context.app.filter.facets.completion.values = ['done'] // ignored all.values
assert.equal(context.filterRuleSignature(context.app.filter), context.filterRuleSignature(context.app.filterViews[0].filter))
context.saveFilter()
context.app.filterOpen = true
context.loadFilter()
assert.equal(context.app.filterOpen, false)
assert.equal(context.app.activeViewId, context.app.filterViews[0].id)
assert.deepEqual(plain(context.FILTER_PRESETS), [['daily', '日常'], ['all', '全部'], ['project', '项目']])
context.app.snap = { tasks }
context.app.currentWorkspace = { id: 'one', path: '/two' }
context.app.filter = context.createFilter('project')
assert.equal(ids(), 'a', 'project id wins over path and same title')
context.app.currentWorkspace = { id: 'two' }
assert.equal(ids(), 'b', 'project follows changed context')
context.app.currentWorkspace = { path: '/one' }
context.app.workspaces = [{ id: 'one', path: '/one' }]
assert.equal(ids(), 'a', 'path resolves registered id')
context.app.currentWorkspace = {}
context.app.currentSessionId = ''
assert.equal(ids(), '', 'unknown project must not mean all')
context.app.currentSessionId = 'project-session'
tasks[0].sessionId = 'project-session'
assert.equal(ids(), 'a', 'bound task supplies legacy context')
context.saveFilter()
context.app.filter = null
context.loadFilter()
assert.equal(context.app.filter.project, true)
assert.equal(ids(), 'a')
assert.equal(context.saveFilterView('Project snapshot', false), true)
assert.equal(context.app.filterViews.at(-1).filter.project, undefined)
assert.deepEqual(plain(context.app.filterViews.at(-1).filter.facets.workspace.values), ['id:one'])
for (const id of ['daily', 'all', 'project']) {
  context.applyFilterPreset(id)
  context.app.filter.facets.priority = { mode: 'include', values: ['P0'] }
  assert.equal(context.saveFilterView('', true), true)
  assert.deepEqual(plain(context.builtinFilter(id).facets.priority.values), ['P0'])
  assert.equal(context.restoreBuiltinFilter(true), true)
  assert.equal(context.builtinFilter(id).facets.priority.mode, 'all')
}
context.applyFilterPreset('all')
context.app.filter.facets.completion = { mode: 'include', values: ['done'] }
assert.equal(context.saveFilterView('', true), true)
assert.equal(context.builtinFilter('all').facets.completion.mode, 'include')
assert.equal(context.createFilter('all').facets.completion.mode, 'all')
context.loadFilterDefaults()
assert.equal(context.builtinFilter('all').facets.completion.mode, 'include')
context.newFilterTemplate()
assert.equal(context.app.filterOpen, true)
assert.equal(context.app.activeViewId, '')
context.app.activeViewId = 'all'
assert.equal(context.deleteFilterView(true), false)
context.restoreBuiltinFilter(true)
context.app.workspaces = [{ id: 'one', title: 'Unique', path: '/one' }]
context.app.currentWorkspace = { id: 'one' }
const newTask = { id: 'new-task', done: false, meta: { workspace: 'Unique' } }
const doneTask = { id: 'done-task', done: true, workspacePath: '/one/' }
context.app.snap.tasks = [newTask, doneTask]
context.applyFilterPreset('project')
assert.equal(context.filterTasksForPanel(context.app.snap.tasks).length, 2, 'new title-only and path-only project tasks included')
context.app.filter.facets.completion = { mode: 'include', values: ['open'] }
assert.equal(context.saveFilterView('', true), true)
context.applyFilterPreset('all')
context.applyFilterPreset('project')
assert.deepEqual(plain(context.filterTasksForPanel(context.app.snap.tasks).map(t => t.id)), ['new-task'])
context.loadFilterDefaults()
context.app.filter = context.builtinFilter('project')
assert.deepEqual(plain(context.filterTasksForPanel(context.app.snap.tasks).map(t => t.id)), ['new-task'])
context.app.workspaces.push({ id: 'two', title: 'Unique', path: '/two' })
assert.equal(context.workspaceKey(newTask), 'legacy:Unique', 'ambiguous titles do not guess')
const changedProject = context.createFilter('project')
changedProject.facets.completion = { mode: 'include', values: ['done'] }
store.set('dsh-feishu:filter-defaults', JSON.stringify({ project: changedProject }))
context.app.filterDefaults = {}
context.applyFilterPreset('project')
assert.deepEqual(plain(context.app.filter.facets.completion.values), ['done'], 'template selection reloads overrides saved by another panel')
const filterMarkup = html.slice(html.indexOf('<div class="task-filter-card">'), html.indexOf('<div id="taskList"'))
assert.ok(filterMarkup.includes('id="filterToggle"') && filterMarkup.includes('id="taskFilterBar"'))
assert.ok(filterMarkup.indexOf('id="filterViewName"') < filterMarkup.indexOf('id="filterFacets"'))
assert.ok(filterMarkup.indexOf('id="filterViewUpdate"') < filterMarkup.indexOf('id="filterKeyword"'))
assert.match(filterMarkup, /task-filter-divider/)
assert.equal((html.match(/id="filterViewName"/g) || []).length, 1)
console.log('FILTER_PANEL_OK: facets OR/AND/empty/unknown, stable workspace, schema/migration/storage, DOM modes/chips/removal/presets/focus and narrow-width guards')
