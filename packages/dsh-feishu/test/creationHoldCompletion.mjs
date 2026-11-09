#!/usr/bin/env node
/** 挂着未核对创建回执的任务：显式「完成」走 task_get 核验后放行；核验不过照旧拦住。
 * Run: node packages/dsh-feishu/test/creationHoldCompletion.mjs
 */
import assert from 'node:assert/strict'
import { AsyncLocalStorage } from 'node:async_hooks'
import { readFile } from 'node:fs/promises'
import vm from 'node:vm'
import { createBackendScope } from '../backendScope.js'
import { createCreationLedger } from '../creationLedger.js'

const source = await readFile(new URL('../index.js', import.meta.url), 'utf8')
const extract = (name) => { const m = source.match(new RegExp('  (?:async )?function ' + name + '\\([^]*?\\n  }')); assert.ok(m, name); return m[0] }
const store = new AsyncLocalStorage()
let calls = []
let remoteGuid = (id) => id
const remoteCompleted = new Set()
const failComplete = new Set()
const impl = {
  actions: async (_s, actions) => {
    calls.push(actions[0].op)
    return {
      ok: true,
      actions: actions.map((a) => ({
        op: a.op,
        ok: true,
        task: { guid: remoteGuid(a.task), ...(remoteCompleted.has(a.task) ? { completed_at: '1794152551000' } : { completed_at: '0' }) },
      })),
    }
  },
  complete: async (_s, id) => { calls.push('complete'); return failComplete.has(id) ? { ok: false, detail: 'code 1470400: already completed' } : { ok: true } },
  comment: async () => { calls.push('comment'); return { ok: true } },
}
const receipt = (key, taskId, status) => ({ key, sessionId: 'session-' + key, backend: 'A', summary: '', tasklistGuid: null, followUp: false, status, taskId, createdAt: 1, updatedAt: 1 })
const task = (id) => ({ id, title: `T-${id}`, done: false, sessionId: null, members: [], customFields: [], meta: {} })
const h = {
  backendContext: store, activeCreationKeys: new Set(), lifecycleDisposed: false,
  settings: { cliBackend: 'A' }, ctx: {},
  state: {
    tasks: ['ok', 'mismatch', 'busy', 'other-backend', 'report', 'remote-done'].map(task),
    taskCreationReceipts: {
      ok: receipt('ok', 'ok', 'partial'),
      mismatch: receipt('mismatch', 'mismatch', 'created'),
      busy: receipt('busy', 'busy', 'created'),
      'other-backend': { ...receipt('other-backend', 'other-backend', 'partial'), backend: 'B' },
      report: receipt('report', 'report', 'partial'),
      'remote-done': receipt('remote-done', 'remote-done', 'partial'),
    },
  },
  asString: (v) => (v == null ? '' : String(v)), nowMs: Date.now, log: () => {},
  persistState: async () => {}, writeEndToFeishu: async () => ({ ok: true }), archiveSessionForTask: async () => ({ ok: true }),
  sanitizeTaskDescription: (t) => String(t || '').trim(),
}
const newScope = () => createBackendScope({ getSettings: () => h.settings, getGeneration: () => 0, isDisposed: () => false, resolveBackend: () => impl, beforeActions: (actions) => h.pendingCreationWriteBlocked(actions) })
h.captureBackendScope = () => store.getStore() || newScope()
h.backend = () => impl
h.writeTaskComment = async (id, body) => { const r = await h.captureBackendScope().comment(id, body); return r }
h.taskCreationLedger = createCreationLedger({ load: async () => structuredClone(h.state.taskCreationReceipts), save: async (rows) => { h.state.taskCreationReceipts = structuredClone(rows) } })
h.activeCreationKeys.add('busy')
vm.createContext(h)
vm.runInContext(['creationPending', 'pendingCreationWriteBlocked', 'releaseCreationHoldForCompletion', 'remoteTaskCompleted', 'applyTaskCompletion', 'applyTaskReport'].map(extract).join('\n'), h)
const get = (id) => h.state.tasks.find((t) => t.id === id)

/* 0. 前提：回执未核对时，盲写完成会被闸门拦下。 */
assert.equal((await newScope().complete('ok')).ok, false)
calls = []

/* 1. 显式完成：task_get 核验通过 → 关回执 → 置完成。 */
let r = await h.applyTaskCompletion('ok')
assert.equal(r.ok, true, r.error)
assert.deepEqual(calls, ['task_get', 'complete'])
assert.equal(get('ok').done, true)
assert.equal(h.state.taskCreationReceipts.ok.status, 'done')
assert.equal(h.state.taskCreationReceipts.ok.result.completed, true)
console.log('✓ explicit completion verifies via task_get, closes the receipt, then completes')

/* 2. 原后端查回来的 GUID 对不上 → 不放行、不写完成。 */
calls = []; remoteGuid = () => 'someone-else'
r = await h.applyTaskCompletion('mismatch')
assert.equal(r.ok, false); assert.match(r.error, /未通过核验/)
assert.deepEqual(calls, ['task_get'])
assert.equal(get('mismatch').done, false)
assert.equal(h.state.taskCreationReceipts.mismatch.status, 'created')
remoteGuid = (id) => id
console.log('✓ failed verification keeps the hold and writes nothing')

/* 3. 创建仍在发送中 / 换了后端 → 拒绝，且不发任何远端调用。 */
calls = []
assert.match((await h.applyTaskCompletion('busy')).error, /创建仍在进行/)
assert.match((await h.applyTaskCompletion('other-backend')).error, /切回创建/)
assert.deepEqual(calls, [])
console.log('✓ in-flight creation and cross-backend completion stay blocked')

/* 3.5 飞书里已经完成过的任务（App / CLI 标的）：complete 报 1470400，但目标状态已成立 → 算成功并补齐本地。 */
calls = []; remoteCompleted.add('remote-done'); failComplete.add('remote-done')
r = await h.applyTaskCompletion('remote-done')
assert.equal(r.ok, true, r.error)
assert.deepEqual(calls, ['task_get', 'complete', 'task_get'])
assert.equal(get('remote-done').done, true)
assert.equal(h.state.taskCreationReceipts['remote-done'].status, 'done')
/* 远端确实没完成、complete 也失败 → 仍然如实报失败。 */
calls = []
h.state.tasks.push(task('really-failed'))
h.state.taskCreationReceipts['really-failed'] = receipt('really-failed', 'really-failed', 'partial')
failComplete.add('really-failed')
r = await h.applyTaskCompletion('really-failed')
assert.equal(r.ok, false); assert.match(r.error, /标记完成失败/)
assert.equal(get('really-failed').done, false)
console.log('✓ already-completed remotely counts as success; a real failure still fails')

/* 4. 模型工具 report(complete) 同样走核验，评论与完成都能写。 */
calls = []
r = await h.applyTaskReport('report', { text: '做完了', complete: true })
assert.equal(r.ok, true, r.error)
assert.deepEqual(calls, ['task_get', 'comment', 'complete'])
assert.equal(get('report').done, true)
/* 只写评论不置完成：回执保护不变（这里已核验过，所以换一条新任务验证）。 */
h.state.tasks.push(task('comment-only'))
h.state.taskCreationReceipts['comment-only'] = receipt('comment-only', 'comment-only', 'partial')
r = await h.applyTaskReport('comment-only', { text: '进展' })
assert.equal(r.ok, false)
console.log('✓ report(complete) verifies first; comment-only writes stay guarded')
