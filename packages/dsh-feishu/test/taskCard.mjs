import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import vm from 'node:vm'
const html = await readFile(new URL('../panel.html', import.meta.url), 'utf8')
const script = [...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)].map((m) => m[1]).join('\n')
new vm.Script(script)
function fn(name) { const start = script.indexOf(`  ${name === 'saveTaskRelation' ? 'async ' : ''}function ${name}(`); assert.ok(start >= 0, name); const end = script.indexOf('\n  function ', start + 3); return script.slice(start, end) }
class Node {
  constructor(tag) { this.tag = tag; this.children = []; this.attrs = {}; this.listeners = {}; this.classList = { add() {} }; this.value = ''; this.style = { setProperty() {} } }
  appendChild(n) { this.children.push(n); return n }
  setAttribute(k, v) { this.attrs[k] = v; if (k === 'hidden') this.hidden = true }
  addEventListener(k, fn) { this.listeners[k] = fn }
  get firstChild() { return this.children[0] }
  removeChild(n) { this.children.splice(this.children.indexOf(n), 1) }
  getAttribute(k) { return this.attrs[k] }
  focus() {}
  fire() { return this.listeners.click?.({ stopPropagation() {} }) }
}
const calls = [], posts = []
const context = {
  app: { snap: { tasks: [] }, busyTask: {}, sessions: {}, serverFeatures: ['tasks.relations', 'tasks.suspension'] },
  el(tag, attrs = {}) { const n = new Node(tag); for (const [k, v] of Object.entries(attrs)) { if (k === 'text') n.textContent = v; else n.setAttribute(k, v) } return n },
  makeButton(text, cls, label, disabled, click) { const n = new Node('button'); n.setAttribute('class', cls); n.textContent = text; n.disabled = disabled; n.addEventListener('click', click); return n },
  clear(node) { while (node.firstChild) node.removeChild(node.firstChild) },
  mountTaskMenu(menu) { context.menu = menu; return () => {} }, disposeTaskMenu: null,
  docChipNode: (t, doc) => { const n = new Node('doc'); n.doc = doc; return n }, docAddNode: () => new Node('add-doc'),
  onMakeDoc: () => calls.push('document'), onDeleteSession: () => calls.push('delete'), onUnlink: () => calls.push('unlink'), onBind: () => calls.push('bind'),
  toast: (text) => calls.push(text), load: async () => {},
  api: async (path, body) => { posts.push({ path, body }); return { ok: true, remote: { ok: false, error: 'mock denied' } } },
}
vm.createContext(context)
for (const name of ['relationPreviewNode', 'enterRelatedTask', 'openRelationGraph', 'saveTaskRelation', 'openRelationEditor', 'openTaskDocumentMenu', 'openTaskMoreMenu']) vm.runInContext(fn(name), context)
const task = { id: 'self', title: 'Self', sessionId: 'session', docs: [{ url: 'offline-doc', title: 'Doc', source: '生成' }], relations: { predecessors: [{ id: 'p', title: 'Prev' }, { id: 'p2', title: 'Prev2' }], successors: [{ id: 's', title: 'Next' }], sourceTasks: [{ id: 'src', title: 'Source' }], derivedTasks: [] } }
context.app.snap.tasks = [task, { id: 'p', title: 'Prev' }]
assert.equal(context.relationPreviewNode({ relations: {} }), null)
const preview = context.relationPreviewNode(task)
assert.equal(preview.children.length, 2)
const dependency = preview.children[0]
assert.deepEqual(dependency.children.map((n) => n.textContent), ['Prev', '+1', '→', '本任务', '→', 'Next'])
assert.match(preview.children[1].attrs.class, /relation-provenance/)
dependency.children[1].fire()
assert.equal(context.menu.attrs['aria-label'], '关联任务局部图')
assert.equal(context.menu.children.length, 5)
await context.saveTaskRelation(task, 'predecessorIds', 'p', true)
assert.deepEqual(JSON.parse(JSON.stringify(posts.at(-1))), { path: 'tasks/relations', body: { taskId: 'self', action: 'set', mode: 'replace', reason: '面板手动关联', predecessorIds: ['p2'] } })
await context.saveTaskRelation(task, 'successorIds', 's2', false)
assert.deepEqual(JSON.parse(JSON.stringify(posts.at(-1).body.successorIds)), ['s2'])
assert.match(calls.at(-1), /本地已保存.*mock denied/)
context.app.snap.tasks.push({ id: 'new', title: 'Searchable task', no: 42, workspaceTitle: 'Workspace' })
const editor = context.openRelationEditor(new Node(), task)
const [head, segments, help, flow, typeInfo, candidatePanel, existing, message, footer] = editor.children
const [search, candidates] = candidatePanel.children
assert.equal(candidatePanel.attrs.hidden, true)
assert.match(flow.children[0].attrs.class, /relation-choose/)
assert.match(flow.children[2].attrs.class, /relation-current/)
flow.children[0].fire()
assert.equal(candidatePanel.hidden, false)
assert.equal(editor.attrs['aria-label'], '关联任务')
assert.equal(segments.children.length, 3)
assert.equal(candidates.children.length, 1) // exclude self and existing predecessor p
assert.equal(footer.children[1].disabled, true)
search.value = '42'
search.listeners.input()
assert.equal(candidates.children[0].attrs['data-task-id'], 'new')
candidates.children[0].fire()
assert.equal(footer.children[1].disabled, false)
assert.equal(footer.children[0].textContent, 'Searchable task')
let finishRequest
const oldApi = context.api
context.api = () => new Promise((resolve) => { finishRequest = resolve })
const pending = footer.children[1].fire()
assert.equal(search.disabled, true)
assert.ok(segments.children.every((button) => button.disabled))
const repeated = footer.children[1].fire()
finishRequest({ ok: false, error: 'inline failure' })
await pending; await repeated
assert.equal(message.textContent, 'inline failure')
assert.equal(search.value, '42')
assert.equal(footer.children[0].textContent, 'Searchable task')
context.api = async (path, body) => { posts.push({ path, body }); return { ok: true, relations: { ...task.relations, predecessors: [...task.relations.predecessors, { id: 'new', title: 'Searchable task' }] } } }
await footer.children[1].fire()
assert.equal(message.textContent, '已添加关联')
assert.equal(footer.children[1].disabled, true)
assert.equal(candidates.children[0].textContent, '没有匹配的可关联任务')
segments.children[1].fire()
assert.equal(help.textContent, '等待本任务完成的任务')
assert.equal(segments.children[1].attrs['aria-pressed'], 'true')
assert.match(flow.children[0].attrs.class, /relation-current/)
assert.match(flow.children[2].attrs.class, /relation-choose/)
assert.equal(candidates.children[0].attrs['data-task-id'], 'new')
segments.children[2].fire()
assert.match(flow.children[0].attrs.class, /relation-choose/)
assert.match(flow.className, /relation-provenance/)
assert.match(help.textContent, /不阻塞/)
assert.ok(existing.children.some((row) => row.children.some((n) => n.attrs['aria-label'] === '移除前置关联：Searchable task')))
context.api = oldApi
context.app.serverFeatures = []
const unsupported = context.openRelationEditor(new Node(), task)
assert.equal(unsupported.children[5].children[0].disabled, true)
assert.match(unsupported.children[7].textContent, /不支持关系编辑/)
const docs = context.openTaskDocumentMenu(new Node(), task)
assert.equal(docs.children[0].textContent, '添加文档')
assert.equal(docs.children.some(n => n.tag === 'input' || n.tag === 'add-doc'), false)
assert.equal(docs.children[1].textContent, 'AI 更新文档')
docs.children[1].fire(); assert.equal(calls.at(-1), 'document')
const more = context.openTaskMoreMenu(new Node(), task)
assert.match(more.children[1].textContent, /归档.*状态不变/)
more.children[1].fire(); assert.equal(calls.at(-1), 'delete')
more.children[2].fire(); assert.equal(calls.at(-1), 'unlink')
// Execute the actual whole taskNode against a minimal DOM, not only helpers.
context.toneForTask = () => 'gray'
context.normPriority = () => ''
context.priorityChip = () => new Node('priority')
context.scheduleChip = () => new Node('schedule')
context.etaChip = () => new Node('eta')
context.suspensionControlNode = () => new Node('suspend')
context.app.settings = {}
vm.runInContext(fn('taskNode'), context)
for (let attempt = 0; attempt < 30; attempt++) {
  try { context.fullCard = context.taskNode({ id: 'minimal', title: 'Task', members: [], customFields: [], docs: [], meta: {} }); break }
  catch (error) {
    const missing = /^([A-Za-z_$][\w$]*) is not defined$/.exec(error.message)
    if (!missing) throw error
    context[missing[1]] = () => new Node(missing[1])
  }
}
assert.ok(context.fullCard)
function flatten(node) { return [node, ...node.children.flatMap(flatten)] }
const fullNodes = flatten(context.fullCard)
assert.equal(fullNodes.filter((node) => node.textContent === '文档').length, 1)
fullNodes.find((node) => node.textContent === '文档').fire()
assert.equal(context.menu.attrs['aria-label'], '任务文档')
fullNodes.find((node) => node.attrs['aria-label'] === '更多任务操作').fire()
assert.equal(context.menu.attrs['aria-label'], '更多任务操作')
assert.ok(fullNodes.some((node) => node.attrs['aria-label'] === '更多任务操作'))
assert.doesNotMatch(fn('taskNode'), /任务关系 ·|relationType|relationTarget|docAddNode/)
const attachedCard = context.taskNode({ id: 'attached', title: 'Attached', members: [], customFields: [], meta: {}, docs: [{ url: 'https://example.test/doc', title: 'Visible doc' }, { url: 'https://example.test/doc', title: 'Duplicate' }] })
const attachedNodes = flatten(attachedCard)
assert.equal(attachedNodes.filter(n => n.tag === 'doc').length, 1)
assert.equal(attachedNodes.find(n => n.tag === 'doc').doc.title, 'Visible doc')
assert.equal(attachedNodes.filter(n => n.tag === 'add-doc').length, 0)
assert.match(fn('taskNode'), /openTaskDocumentMenu/)
assert.match(fn('taskNode'), /openTaskMoreMenu/)
assert.match(html, /\.relation-provenance \.relation-arrow::before[^}]*dashed/)
assert.match(html, /\.relation-node[^}]*background: var\(--p-sub\)[^}]*border-radius: 6px[^}]*font-size: 10px[^}]*font-weight: 400/)
assert.match(html, /\.task-toolbar[^}]*margin-left: auto/)
assert.match(html, /\.task-local-pop[^}]*100vw - 16px/)
assert.match(html, /\.task-body > \.task-actions[^}]*flex-wrap: wrap/)
assert.match(html, /\.task-local-pop\.relation-editor[^}]*340px[^}]*100vh - 24px/)
assert.match(html, /\.relation-candidates[^}]*overflow-y: auto/)
assert.match(html, /\.relation-candidate-title[^}]*line-clamp: 2/)
console.log('TASK_CARD_OK: empty relations, directional +N preview/graph, provenance dash, relation replace/remove, docs/more handlers, capability and syntax')
