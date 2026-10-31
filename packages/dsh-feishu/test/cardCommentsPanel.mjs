import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import vm from 'node:vm'

// No browser, boot, real Host calls or real mutations: source + VM contracts.
const html = await readFile(new URL('../panel.html', import.meta.url), 'utf8')
const script = [...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)].map(m => m[1]).join('\n')
new vm.Script(script)
function extract(name) {
  const match = script.match(new RegExp('  function ' + name + '\\([^]*?\\n  }'))
  assert.ok(match, `missing ${name}`)
  return match[0]
}
class Node {
  constructor(tag = 'div', attrs = {}) { this.tag = tag; this.attrs = attrs; this.children = []; this.listeners = {}; this._text = ''; this.hidden = false; this.isConnected = true; this.style = { setProperty() {} } }
  set textContent(v) { this._text = String(v); this.children = [] }
  get textContent() { return this._text }
  get firstChild() { return this.children[0] }
  setAttribute(k, v) { this.attrs[k] = String(v); if (k === 'id') this.id = String(v) }
  appendChild(n) { this.children.push(n); return n }
  insertBefore(n, next) { const i = next ? this.children.indexOf(next) : this.children.length; this.children.splice(i, 0, n); return n }
  removeChild(n) { this.children.splice(this.children.indexOf(n), 1) }
  addEventListener(k, fn) { (this.listeners[k] ||= []).push(fn) }
  fire(k) { return Promise.all((this.listeners[k] || []).map(fn => fn({}))) }
}
const text = n => [n.textContent, ...n.children.map(text)].join('\n')
const all = n => [n, ...n.children.flatMap(all)]
const buttons = n => all(n).filter(n => n.tag === 'button')
let requests = [], response, fail, hold, openCalls = []
let clock = 100000
const task = { id: 'task/1', title: 'Review', sessionId: 'original-session', members: [{ id: 'owner', name: '负责人甲', role: 'assignee', avatar: 'https://example.test/avatar' }] }
const context = {
  app: { serverFeatures: ['tasks.comment-history'], snap: { tasks: [task] }, sessions: {}, cardComments: Object.create(null), cardCommentsOpen: Object.create(null), taskCache: {} },
  document: { hidden: false, createElement: tag => new Node(tag), createElementNS: (_ns, tag) => new Node(tag) },
  nowMs: () => clock, fmtAbs: t => String(t || ''), fmtRel: t => t ? '刚刚' : '—',
  api: (path, body, opts) => { requests.push({ path, body, opts }); return hold ? new Promise(resolve => { hold.resolve = resolve }) : fail ? Promise.reject(new Error(fail)) : Promise.resolve(response) },
  onOpenSession: (...args) => openCalls.push(args),
}
vm.createContext(context)
for (const name of ['clear', 'el', 'makeButton', 'cardCommentsState', 'cardCommentHistorySupported', 'cardCommentsTask', 'cardCommentEntry', 'cardCommentStatus', 'cardCommentIsOwn', 'cardCommentSubmitReason', 'cardCommentIcon', 'cardCommentsControl', 'updateCardComments', 'measureCardCommentOverflow', 'loadCardComments', 'pollCardComments', 'submitCardComment']) vm.runInContext(extract(name), context)
function mount() {
  const controls = context.cardCommentsControl(task)
  context.app.taskCache[task.id] = { task, node: { _cardComments: controls, isConnected: true } }
  context.updateCardComments(task)
  return controls
}
let controls = mount()
assert.equal(controls.button.attrs['aria-expanded'], 'false')
assert.equal(controls.button.attrs['aria-label'], '评论')
assert.ok(!text(controls.button).includes('0'))
assert.equal(controls.section.hidden, true)
assert.equal(requests.length, 0)
assert.match(controls.button.title, /只读取/)
assert.equal(controls.button.children[0].tag, 'svg')
const history = [
  { id: 'reply', content: '原生回复', author: 'AI', authorType: 'app', createdAt: 6, replyToCommentId: 'parent' },
  { id: 'parent', content: '<script>literal</script>\n一\n二\n三\n四\n五', authorId: 'owner', author: '负责人甲', createdAt: 5 },
  { id: 'self', content: 'own ledger response', author: '机器人', authorType: 'user', createdAt: 7 },
  { id: 'seen', content: '历史非AI已见', authorId: 'user', author: '访客', authorType: 'user', createdAt: 8 },
  { id: 'pending', content: '待处理留言', author: '访客', createdAt: 9 },
  { id: 'delivered', content: '已投递留言', author: '访客', createdAt: 10 },
]
response = { ok: true, comments: { ok: true, complete: true, items: history, errors: [] }, entries: [{ commentId: 'self', status: 'ignored', reason: 'outbound-ledger' }, { commentId: 'pending', status: 'pending', reason: '等候原会话' }, { commentId: 'delivered', status: 'delivered', reason: '已投入原会话' }], enabled: true, sessionId: task.sessionId, diagnostic: { lastScanAt: 2, readCount: 6, newCount: 1, reason: '本次已扫描' } }
await controls.button.fire('click')
await new Promise(setImmediate)
assert.equal(requests[0].path, 'tasks/comments?taskId=task%2F1&refresh=true')
assert.equal(requests[0].body, undefined, 'view is GET, never sync/drain/submit')
assert.equal(requests.length, 1)
assert.equal(controls.button.attrs['aria-expanded'], 'true')
assert.equal(controls.section.hidden, false)
assert.match(text(controls.section), /负责人甲/)
assert.match(text(controls.section), /负责人/)
assert.match(text(controls.section), /<script>literal<\/script>/, 'untrusted content rendered as plain text')
assert.match(text(controls.section), /本次已扫描/)
assert.match(text(controls.section), /读 6/)
assert.match(text(controls.section), /新 1/)
const commentNodes = all(controls.section).filter(n => String(n.className || '').split(' ').includes('card-comment'))
assert.match(text(commentNodes[0]), /literal/)
assert.match(text(commentNodes[1]), /原生回复/)
assert.match(commentNodes[1].className, /is-reply/)
assert.equal(buttons(commentNodes[2]).filter(n => n.textContent === '处理').length, 0, 'own outbound-ledger user comment not resubmittable')
assert.equal(buttons(commentNodes[3]).filter(n => n.textContent === '处理' && !n.disabled).length, 1, 'seen non-AI history remains manually actionable')
assert.equal(buttons(commentNodes[5]).filter(n => n.textContent === '处理').length, 0, 'delivered cannot be redelivered')
const expand = buttons(commentNodes[0]).find(n => n.textContent === '展开')
await expand.fire('click')
assert.equal(context.cardCommentsState(task.id).expanded.parent, true)
await buttons(controls.section).find(n => n.textContent === '对话').fire('click')
assert.deepEqual(openCalls, [[task.sessionId, task.title]])
await controls.button.fire('click')
assert.equal(controls.section.hidden, true)
controls = mount()
assert.equal(controls.button.attrs['aria-expanded'], 'false', 'card reconstruction retains collapsed state')
assert.equal(context.cardCommentsState(task.id).items, history)
context.app.cardCommentsOpen[task.id] = true
context.updateCardComments(task)
assert.equal(buttons(controls.section).find(n => n.textContent === '收起').attrs['aria-expanded'], 'true', 'full text expanded state survives card reconstruction')

const state = context.cardCommentsState(task.id)
const human = history[3]
for (const [status, label] of Object.entries({ pending: '待处理', delivered: '已投递', running: '处理中', replied: '已回复', ignored: '忽略', failed: '失败', unknown: '待核对', reply_pending: '待回复' })) assert.equal(context.cardCommentStatus({ status }), label)
assert.equal(context.cardCommentStatus(), '历史')
const reason = () => context.cardCommentSubmitReason(task, state, human)
assert.equal(reason(), '')
assert.match(context.cardCommentSubmitReason(task, state, history[0]), /自己的/)
assert.match(context.cardCommentSubmitReason(task, state, history[2], response.entries[0]), /自己的/)
const pendingButton = buttons(commentNodes[4]).find(n => n.textContent === '处理')
assert.ok(pendingButton.disabled, 'already queued pending comment must not be submitted again')
assert.match(pendingButton.title, /已有处理记录/)
const beforePending = requests.length
await context.submitCardComment(task, 'pending')
assert.equal(requests.length, beforePending, 'pending click/handler performs no POST')
for (const entry of [{ status: 'pending' }, { status: 'unknown' }, { status: 'reply_pending' }, { status: 'ignored', deliveryText: 'previously dispatched' }, { status: 'ignored', turn: 0 }]) {
  assert.match(context.cardCommentSubmitReason(task, state, human, entry), /已有处理记录/)
  state.entries.push({ commentId: human.id, ...entry })
  const before = requests.length
  await context.submitCardComment(task, human.id)
  assert.equal(requests.length, before, `no repeat submission for ${JSON.stringify(entry)}`)
  state.entries.pop()
}
assert.equal(context.cardCommentSubmitReason(task, state, human, { status: 'ignored', reason: '历史已见' }), '', 'undispatched non-AI ignored history may be explicitly handled')
for (const [key, value, expected] of [['done', true, /已完成/], ['suspension', { active: true }, /已挂起/], ['sessionId', '', /先绑定/]]) {
  const old = task[key]; task[key] = value
  assert.match(reason(), expected)
  const before = requests.length; await context.submitCardComment(task, human.id); assert.equal(requests.length, before)
  task[key] = old
}
state.enabled = false; assert.match(reason(), /未开启/); state.enabled = true
state.complete = false; assert.match(reason(), /不完整/); state.complete = true
context.app.serverFeatures = []
context.updateCardComments(task)
assert.match(text(controls.section), /重启后可用/)
assert.match(reason(), /重启后可用/)
await context.loadCardComments(task, { refresh: true })
assert.equal(requests.at(-1).body, undefined, 'old Host still GETs and displays route errors')
fail = '404: unknown route'
await context.loadCardComments(task, { refresh: true })
assert.match(text(controls.section), /404/)
assert.equal(state.items, history, 'failed GET retains actual last history')
fail = null; context.app.serverFeatures = ['tasks.comment-history']
response = { ...response, comments: { ok: false, complete: false, items: history.slice(0, 2), errors: ['分页读取失败'] } }
await context.loadCardComments(task, { refresh: true })
assert.equal(state.items.length, 2, 'partial items still shown')
assert.match(text(controls.section), /分页读取失败/)
response = { ...response, comments: { ok: true, complete: true, items: history, errors: [] } }
await context.loadCardComments(task, { refresh: true })

requests = []; hold = {}
const first = context.loadCardComments(task, { refresh: true }), second = context.loadCardComments(task, { refresh: true })
assert.equal(first, second, 'per-task single-flight')
await context.submitCardComment(task, human.id)
assert.equal(requests.length, 1, 'submission cannot race history GET')
hold.resolve(response); hold = null; await first
requests = []
context.pollCardComments(); assert.equal(requests.length, 0, '20-second throttle')
clock += 20000
context.pollCardComments(); await new Promise(setImmediate)
assert.equal(requests.length, 1)
assert.match(requests[0].path, /refresh=true/)
context.app.taskCache[task.id].node.isConnected = false
clock += 20000; context.pollCardComments(); assert.equal(requests.length, 1, 'filtered/detached panel not polled')
context.app.taskCache[task.id].node.isConnected = true
context.document.hidden = true; context.pollCardComments(); assert.equal(requests.length, 1)
context.document.hidden = false
requests = []
response = { ok: true }
await context.submitCardComment(task, human.id)
assert.equal(requests[0].path, 'comments/action')
assert.deepEqual(JSON.parse(JSON.stringify(requests[0].body)), { taskId: task.id, commentId: human.id, action: 'submit' })
assert.equal(requests[1].body, undefined, 'submit rereads Host, no optimistic delivery states')
assert.equal(state.entries.find(e => e.commentId === 'pending').status, 'pending')
assert.equal(openCalls.length, 1, 'submission does not open/create/switch session')
response = { ok: false, reason: '原会话正在处理' }
state.error = ''; state.complete = true
await context.submitCardComment(task, human.id)
assert.match(text(controls.section), /原会话正在处理/)
assert.equal(state.submitting, '')

const taskSource = extract('taskNode')
assert.ok(taskSource.indexOf("makeButton('同步'") < taskSource.indexOf('cardCommentsControl(t)'))
assert.match(taskSource, /body\.appendChild\(actions\);\s*if \(commentControls\.section\) body\.appendChild\(commentControls\.section\)/)
assert.doesNotMatch(extract('taskCardSignature'), /cardComments/)
assert.match(extract('renderTasks'), /entry\.node\._cardComments.*updateCardComments/)
assert.match(extract('load'), /if \(app\.cardCommentsOpen\) pollCardComments\(\)/)
for (const name of ['cardCommentsControl', 'loadCardComments', 'pollCardComments', 'updateCardComments']) assert.doesNotMatch(extract(name), /setInterval|setTimeout|tasks\/sync|comments\/action/)
assert.match(extract('submitCardComment'), /已绑定|真实账本/)
assert.match(html, /-webkit-line-clamp: 4/)
assert.match(html, /\.task-card-comments\[hidden\]/)
assert.match(extract('updateCardComments'), /可能唤醒/)
console.log('CARD_COMMENTS_PANEL_OK: lazy GET, original-session submit, capability/lifecycle/self guards, partial/errors, thread/status/text, redraw persistence, dynamic cache isolation, single-flight and shared quiet polling')
