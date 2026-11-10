import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import vm from 'node:vm'
import { createHash } from 'node:crypto'
import { AsyncLocalStorage } from 'node:async_hooks'
import { createTaskMentionResolver } from '../taskMentions.js'
import { createCommentCoordinator } from '../comments.js'
const source = await readFile(new URL('../index.js', import.meta.url), 'utf8')
const begin = source.indexOf('  const taskMentionResolver ='), end = source.indexOf('  async function writeTaskComment(', begin)
assert.ok(begin > 0 && end > begin)
let partialNames = false
let remoteMembers = [{ id: 'ou_zhang', type: 'user', role: 'follower' }], name = '张三', self = 'ou_self', generation = 0, reads = 0, sends = [], removeAt = 0, fail = false
const state = { tasks: [{ id: 'task', sessionId: 's', done: false, startedAt: 1, linkSource: 'manual' }] }, turns = new Map()
const settings = { cliBackend: 'test', cliPath: '/fake' }
const deps = {
  load: async () => null, save: async () => {}, now: Date.now,
  getTask: () => state.tasks[0], resolveTask: () => state.tasks[0],
  listComments: async () => ({ ok: true, complete: true, items: [] }), deliver: async () => ({ ok: true }), isSessionBusy: () => false,
  writeComment: async (task, text, options) => { assert.equal(backendContext.getStore().valid(), true); const final = await backendContext.getStore().mentionBeforePost(); if (!final.ok) return { ok: false, definitive: true, error: final.error }; sends.push({ task, text, options }); return fail ? { ok: false, error: 'timeout' } : { ok: true, commentId: '456', mentionSupported: true } },
}
const comments = createCommentCoordinator(deps)
const backendContext = new AsyncLocalStorage()
const context = vm.createContext({ backendContext, createTaskMentionResolver, nowMs: Date.now, state, settings, activeCommentTurns: turns, isSuspended: () => false, creationPending: () => false, asString: x => x == null ? '' : String(x), createHash, sanitizeTaskDescription: x => x, comments,
  captureBackendScope: () => { if (backendContext.getStore()) return backendContext.getStore(); const captured = generation; return { settings, generation: captured, valid: () => generation === captured } },
  backend: () => ({ enrich: async (_, payload) => payload.self ? { self: { openId: self } } : { users: { ou_zhang: { name } }, errors: partialNames ? ['missing second same-name user'] : [] }, actions: async () => { reads++; if (removeAt && reads >= removeAt) remoteMembers = []; return { actions: [{ ok: true, task: { guid: 'task', completed_at: '0', members: remoteMembers } }] } } }),
})
vm.runInContext(source.slice(begin, end) + '\nglobalThis.host = {resolveTaskMentions,writeMentionComment};', context)
const h = context.host
const resolve = async () => { const r = await h.resolveTaskMentions('', 's', ['张三']); assert.equal(r.ok, true); return r.targets[0].candidates[0].mentionRef }
const send = (ref, requestId = 'r1', extra = {}) => h.writeMentionComment('', 's', '请确认', { mentionRefs: [ref], requestId, ...extra })
partialNames = true
assert.equal((await h.resolveTaskMentions('', 's', ['张三'])).ok, false, 'partial directory cannot hide ambiguity')
partialNames = false
let ref = await resolve()
assert.equal((await send(ref)).ok, true)
assert.equal(sends.length, 1); assert.equal(sends[0].options.mentionMode, 'task-v1'); assert.deepEqual(sends[0].options.mentionIds, ['ou_zhang']); assert.equal(sends[0].options.replyTo, '')
assert.equal((await send(ref)).ok, true); assert.equal(sends.length, 1, 'request retry reuses confirmed receipt')
assert.equal((await h.writeMentionComment('', 's', 'changed', { mentionRefs: [ref], requestId: 'r1' })).ok, false)
self = 'ou_other'; assert.equal((await send(ref, 'r2')).ok, false)
const otherRef = await resolve(); assert.equal((await send(otherRef, 'r1')).ok, false, 'confirmed request cannot be rebound to another identity'); assert.equal(sends.length, 1)
self = 'ou_self'
generation++; assert.equal((await send(ref, 'r2')).ok, false)
ref = await resolve(); assert.equal((await send(ref, 'r1')).ok, true); assert.equal(sends.length, 1, 'same request remains idempotent after generation change and re-resolution'); state.tasks[0].sessionId = 'other'; assert.equal((await send(ref, 'r2')).ok, false); state.tasks[0].sessionId = 's'
ref = await resolve(); name = '新名字'; assert.equal((await send(ref, 'r2')).ok, false); name = '张三'
turns.set('s', {}); assert.equal((await h.resolveTaskMentions('', 's', ['张三'])).ok, false); assert.equal((await send(ref, 'r2')).ok, false); turns.clear()
assert.equal((await send(ref, 'r2', { replyToCommentId: 'invalid' })).ok, false)
ref = await resolve(); removeAt = reads + 2; assert.equal((await send(ref, 'removed')).ok, false); assert.equal(sends.length, 1, 'last pre-send recheck blocks removed member')
removeAt = 0; remoteMembers = [{ id: 'ou_zhang', type: 'user', role: 'follower' }]
ref = await resolve(); fail = true; assert.equal((await send(ref, 'uncertain')).ok, false); fail = false
assert.equal((await send(ref, 'uncertain')).ok, false); assert.equal(sends.length, 2, 'uncertain send never automatically reposts')
await comments.dispose()
assert.match(source, /'feishu_task_mentions'/); assert.match(source, /resolveTaskMentions: \(\.\.\.args\) => runEngineOperation/)
assert.match(source, /writeMentionComment: \(\.\.\.args\) => runEngineOperation/)
assert.match(source, /type: asString\(member\?\.type\)/)
assert.match(source, /mentionBindingEpoch\+\+/)
console.log('TASK_MENTIONS_HOST_OK: production Host extraction + real coordinator; scope, identity, recheck, explicit transport, stable request and unknown delivery')
