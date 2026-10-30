import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import vm from 'node:vm'

const html = await readFile(new URL('../panel.html', import.meta.url), 'utf8')
const script = [...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)].map((match) => match[1]).join('\n')
new vm.Script(script) // Full production inline script syntax, no browser/network.
function fn(name) {
  const start = script.indexOf(`  function ${name}(`)
  assert.ok(start >= 0, name)
  const end = script.indexOf('\n  function ', start + 3)
  return script.slice(start, end < 0 ? script.length : end)
}
class Node {
  constructor(tag) { this.tag = tag; this.children = []; this.listeners = {}; this.hidden = false; this.disabled = false; this.value = ''; this.attrs = {}; this.classList = { add() {} } }
  appendChild(node) { this.children.push(node); return node }
  setAttribute(key, value) { this.attrs[key] = value; if (key === 'hidden') this.hidden = true }
  addEventListener(type, handler) { this.listeners[type] = handler }
  focus() { this.focused = true }
  async click() { if (!this.disabled && this.listeners.click) return this.listeners.click() }
}
const storage = new Map()
const posts = []
const toasts = []
let response = { ok: true }
let renders = 0
let mountedEditor
const sandbox = {
  mountTaskMenu(editor) { mountedEditor = editor; return () => { editor.hidden = true } },
  app: { filter: { status: 'open', showSuspended: false }, snap: { tasks: [] }, busyTask: {}, serverFeatures: ['tasks.suspension'] },
  FILTER_STORE: 'dsh-feishu:filter',
  window: { localStorage: {} },
  localStorage: { getItem: (key) => storage.get(key), setItem: (key, value) => storage.set(key, value) },
  el(tag, attrs = {}) { const node = new Node(tag); for (const [key, value] of Object.entries(attrs)) { if (key === 'text') node.textContent = value; else node.setAttribute(key, value) } return node },
  makeButton(label, cls, busyLabel, disabled, handler) { const node = new Node('button'); node.textContent = label; node.disabled = disabled; node.addEventListener('click', handler); return node },
  async api(path, body) { posts.push({ path, body }); return response },
  toast: (message) => toasts.push(message),
  load: async () => {},
  renderTasks: () => { renders++ },
}
vm.createContext(sandbox)
for (const name of ['suspensionWarningText', 'suspensionControlNode']) vm.runInContext(fn(name), sandbox)
const plain = (value) => JSON.parse(JSON.stringify(value))
// Filter combinations/storage moved to filterPanel.mjs; keep every suspension action regression.

sandbox.app.serverFeatures = []
assert.equal(sandbox.suspensionControlNode({ id: 'old' }), null)
sandbox.app.serverFeatures = ['tasks.suspension']
assert.equal(sandbox.suspensionControlNode({ id: 'done', done: true }), null)
const task = { id: 'running', sessionId: 'session', running: true }
sandbox.app.snap.tasks = [task]
const control = sandbox.suspensionControlNode(task)
const [toggle] = control.children
assert.equal(toggle.textContent, '挂起')
assert.match(toggle.title, /停止正在运行/)
assert.equal(control.children.length, 1)
await toggle.click()
const editor = mountedEditor
assert.equal(editor.hidden, false)
const [, input, message, confirm, cancel] = editor.children
assert.match(editor.children[0].textContent, /归档关联会话/)
input.value = '  wait for data  '
response = { ok: false, error: 'mock failure' }
await confirm.click()
await new Promise((resolve) => setImmediate(resolve))
assert.equal(message.textContent, 'mock failure')
assert.equal(input.value, '  wait for data  ')
assert.equal(editor.hidden, false)
response = { ok: true, suspension: { active: true, reason: 'wait for data' }, warnings: ['archive unavailable'] }
await confirm.click()
await new Promise((resolve) => setImmediate(resolve))
assert.deepEqual(plain(posts.at(-1)), { path: 'tasks/suspension', body: { taskId: 'running', action: 'suspend', reason: 'wait for data' } })
assert.equal(task.suspension.active, true)
assert.match(toasts.at(-1), /任务已挂起.*archive unavailable/)
assert.equal(editor.hidden, true)
assert.ok(renders)
const resumed = sandbox.suspensionControlNode(task)
response = { ok: true, suspension: { active: false }, warnings: [{ error: 'reactivate pending' }] }
await resumed.children[0].click()
await new Promise((resolve) => setImmediate(resolve))
assert.deepEqual(plain(posts.at(-1).body), { taskId: 'running', action: 'resume' })
assert.equal(task.suspension.active, false)
assert.match(toasts.at(-1), /任务已恢复.*reactivate pending/)
response = { ok: false, error: 'resume denied' }
await sandbox.suspensionControlNode({ id: 'fail-resume', suspension: { active: true } }).children[0].click()
await new Promise((resolve) => setImmediate(resolve))
assert.equal(toasts.at(-1), 'resume denied')
sandbox.load = async () => { throw new Error('refresh offline') }
response = { ok: true, suspension: { active: false } }
await sandbox.suspensionControlNode({ id: 'saved-resume', suspension: { active: true } }).children[0].click()
await new Promise((resolve) => setImmediate(resolve))
assert.match(toasts.at(-1), /任务状态已保存，但刷新失败：refresh offline/)
assert.match(script, /text: '已挂起'/)
assert.match(script, /挂起原因（可选）/)
assert.doesNotMatch(fn('suspensionControlNode'), /window\.prompt|window\.confirm/)
console.log('SUSPENSION_PANEL_OK: filtering, storage, capability, running-session warning, suspend/resume API, partial failure, and full inline syntax')
