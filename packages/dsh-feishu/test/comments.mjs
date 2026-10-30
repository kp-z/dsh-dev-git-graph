import assert from 'node:assert/strict'
import { createCommentCoordinator, normalizeComment, isCommentOwner } from '../comments.js'

const copy = (x) => structuredClone(x)
const cfg = { enabled: true, ownerMode: 'execute', otherMode: 'reply', maxPerSync: 10 }
const comment = (id, author = 'owner', text = 'please work', at = 1) => ({ id, creator: { id: author, type: 'user' }, content: text, created_at: at })
function fixture(initial = null) {
  let saved = copy(initial), time = 100, scanResult = { ok: true, complete: true, items: [] }
  const tasks = [{ id: 't', sessionId: 's', done: false, paused: false, members: [{ id: 'owner', role: 'assignee' }] }]
  const calls = { saves: [], scans: [], deliveries: [], writes: [] }
  const controls = { busy: false, saveFail: false, delivery: { ok: true }, write: { ok: true, commentId: 'out-1' }, resolve: null }
  const deps = {
    load: async () => copy(saved),
    save: async (next) => { if (controls.saveFail) throw new Error('disk failed'); saved = copy(next); calls.saves.push(copy(next)) },
    listComments: async (id) => { calls.scans.push(id); return copy(scanResult) },
    getTask: async (id) => copy(tasks.find((task) => task.id === id) ?? null),
    resolveTask: async (id) => controls.resolve ? controls.resolve(id) : copy(tasks.find((task) => task.id === id) ?? null),
    isSessionBusy: async () => controls.busy,
    deliver: async (request) => { assert.equal(saved.inbox.find((entry) => entry.requestId === request.requestId).status, 'delivering'); calls.deliveries.push(copy(request)); if (controls.delivery instanceof Error) throw controls.delivery; return copy(controls.delivery) },
    writeComment: async (id, text, options) => { assert.equal(Object.values(saved.outbound).find((row) => row.key === options.key).status, 'sending'); calls.writes.push({ id, text, options: copy(options) }); if (controls.write instanceof Error) throw controls.write; return copy(controls.write) },
    now: () => time++,
  }
  let coordinator = createCommentCoordinator(deps)
  return { tasks, calls, controls, deps, get c() { return coordinator }, get saved() { return copy(saved) }, result: (value) => { scanResult = value }, comments: (...items) => { scanResult = { ok: true, complete: true, items } }, restart: () => { coordinator = createCommentCoordinator(deps) } }
}
let checks = 0
async function test(name, run) { await run(); checks++; console.log(`✓ ${name}`) }
async function baseline(f) { await f.c.sync(f.tasks, cfg) }
async function start(f, item = comment('c')) { await baseline(f); f.comments(item); await f.c.sync(f.tasks, cfg) }

await test('complete baseline only: historical comments never execute', async () => {
  const f = fixture(); f.comments(comment('history')); await baseline(f)
  assert.deepEqual(await f.c.list(), []); assert.equal(f.calls.deliveries.length, 0)
  f.comments(comment('history', 'owner', 'edited'), comment('new', 'owner', '🤖: human text'))
  await f.c.sync(f.tasks, cfg)
  assert.equal(f.calls.deliveries.length, 1); assert.equal(f.calls.deliveries[0].commentId, 'new')
})
await test('failed, incomplete and malformed scan never advances baseline or seen', async () => {
  for (const result of [{ ok: false, complete: true, items: [comment('old')] }, { ok: true, complete: false, items: [comment('old')] }, { ok: true, complete: true, items: [{}] }]) {
    const f = fixture(); f.result(result); await baseline(f); assert.deepEqual(f.saved, null)
    f.comments(comment('old')); await baseline(f); assert.deepEqual(await f.c.list(), [])
    f.result({ ok: true, complete: false, items: [comment('new')] }); await baseline(f)
    f.comments(comment('old'), comment('new')); await baseline(f); assert.equal(f.calls.deliveries.length, 1)
  }
})
await test('normalizes creator type/user ids; only assignee is owner', async () => {
  assert.equal(normalizeComment({ comment_id: 'x', creator: { type: 'user', user: { user_id: 'u' } } }).authorId, 'u')
  const task = { members: [{ id: 'u', role: 'assignee' }, { id: 'f', role: 'follower' }] }
  assert.equal(isCommentOwner(task, normalizeComment(comment('x', 'u'))), true)
  assert.equal(isCommentOwner(task, normalizeComment(comment('x', 'f'))), false)
  assert.equal(isCommentOwner(task, normalizeComment({ ...comment('x', 'u'), creator: { id: 'u', type: 'app' } })), false)
})
await test('owner all text goes to intent judgment; same token user and prefix are not ignored', async () => {
  const f = fixture(); await start(f, comment('c', 'owner', '🤖: a plain question'))
  assert.equal(f.calls.deliveries[0].mode, 'execute'); assert.equal(f.calls.deliveries[0].maxPermission, 'owner')
  assert.match(f.calls.deliveries[0].text, /a plain question/)
  const other = fixture(); await start(other, comment('c', 'someone'))
  assert.equal(other.calls.deliveries[0].mode, 'reply'); assert.equal(other.calls.deliveries[0].maxPermission, 'reply')
})
await test('off switches, unknown author and non-user fail closed', async () => {
  const f = fixture(); await baseline(f)
  f.comments(comment('owner'), comment('other', 'other'), { ...comment('bot'), creator: { id: 'owner', type: 'app' } }, { id: 'none', content: 'x' })
  await f.c.sync(f.tasks, { ...cfg, ownerMode: 'off', otherMode: 'off' })
  assert.equal(f.calls.deliveries.length, 0); assert.equal((await f.c.list()).every((entry) => entry.status === 'ignored'), true)
  const disabled = fixture(); await disabled.c.sync(disabled.tasks, { ...cfg, enabled: false }); assert.equal(disabled.calls.scans.length, 0)
})
await test('stable task+comment dedup survives edits, restart, duplicate pages and colliding IDs', async () => {
  const f = fixture(); await start(f); f.comments(comment('c', 'other', 'edit'), comment('c'))
  await baseline(f); assert.equal((await f.c.list()).length, 1); f.restart(); await baseline(f); assert.equal(f.calls.deliveries.length, 1)
  f.tasks.push({ ...copy(f.tasks[0]), id: 't2', sessionId: 's2' }); await baseline(f)
  f.comments(comment('d')); await baseline(f)
  assert.equal((await f.c.list()).filter((e) => e.commentId === 'd').length, 2)
})
await test('only active bound candidates scan; pending snapshot never follows rebind', async () => {
  for (const change of [{ paused: true }, { done: true }, { sessionId: null }, { suspended: true }]) {
    const f = fixture(); Object.assign(f.tasks[0], change); await baseline(f); assert.equal(f.calls.scans.length, 0)
  }
  const f = fixture(); f.controls.busy = true; await start(f); f.tasks[0].sessionId = 'new'
  await f.c.drain(cfg); assert.equal(f.calls.deliveries.length, 0); assert.equal((await f.c.list())[0].sessionId, 's'); assert.equal((await f.c.list())[0].status, 'ignored')
})
await test('busy first, FIFO and global max; delivered/running/replied occupy sid until turn end', async () => {
  const f = fixture(); f.controls.busy = true; await baseline(f); f.comments(comment('second', 'owner', 'b', 2), comment('first', 'owner', 'a', 1)); await baseline(f)
  assert.equal(f.calls.deliveries.length, 0); f.controls.busy = false; await f.c.drain(cfg)
  assert.equal(f.calls.deliveries[0].commentId, 'first'); await f.c.drain(cfg); assert.equal(f.calls.deliveries.length, 1)
  await f.c.markRunning('t', 'first', 's', 4); await f.c.complete('first', 's', 'done'); await f.c.drain(cfg); assert.equal(f.calls.deliveries.length, 1)
  await f.c.endTurn('t', 'first', 's', 4); await f.c.drain(cfg); assert.equal(f.calls.deliveries[1].commentId, 'second')
  const capped = fixture(); capped.tasks.push({ ...copy(capped.tasks[0]), id: 't2', sessionId: 's2' }); await baseline(capped); capped.comments(comment('new')); await capped.c.sync(capped.tasks, { ...cfg, maxPerSync: 1 }); assert.equal(capped.calls.deliveries.length, 1)
})
await test('complete explicitly matches session, task and entry; mentions original author; no implicit end', async () => {
  const f = fixture(); await start(f); const entry = (await f.c.list())[0]
  assert.equal((await f.c.matchDelivery('s', [{ content: entry.deliveryText }])).commentId, 'c')
  assert.equal(await f.c.matchDelivery('s', [{ content: 'prefix' + entry.deliveryText }]), null)
  assert.equal((await f.c.markRunning('t', 'c', 's', 1)).ok, true)
  assert.equal((await f.c.markRunning('t', 'c', 's', 2)).ok, false)
  assert.equal((await f.c.complete('c', 'wrong', 'done')).ok, false)
  assert.equal((await f.c.complete('c', 's', 'done', { taskId: 'wrong' })).ok, false)
  assert.equal((await f.c.complete('c', 's', ' done ')).ok, true)
  assert.deepEqual(f.calls.writes[0].options.mentionIds, ['owner']); assert.equal(f.calls.writes[0].text, '🤖: done'); assert.equal(f.calls.writes[0].options.replyTo, 'c')
  await f.c.complete('c', 's', 'other'); assert.equal(f.calls.writes.length, 1)
  assert.equal((await f.c.endTurn('t', 'c', 's', 2)).ok, false)
})
await test('paused, done and rebind block completion and outbound before effects', async () => {
  for (const change of [{ paused: true }, { done: true }, { sessionId: null }, { sessionId: 'new' }]) {
    const f = fixture(); await start(f); Object.assign(f.tasks[0], change)
    assert.equal((await f.c.complete('c', 's', 'done')).ok, false); assert.equal(f.calls.writes.length, 0)
  }
})
await test('crash delivering/delivered become unknown and never auto-redeliver', async () => {
  for (const status of ['delivering', 'delivered']) {
    const f = fixture(); await start(f); const snapshot = f.saved; snapshot.inbox[0].status = status
    const recovered = fixture(snapshot); await recovered.c.drain(cfg)
    assert.equal((await recovered.c.list())[0].status, 'unknown'); assert.equal(recovered.calls.deliveries.length, 0)
    assert.equal((await recovered.c.retry('t', 'c')).ok, false)
    assert.equal((await recovered.c.retry('t', 'c', { confirmedNotDelivered: true })).ok, true)
    await recovered.c.drain(cfg); assert.equal(recovered.calls.deliveries[0].requestId, snapshot.inbox[0].requestId)
  }
})
await test('delivery uncertainty and turn with no completion require manual handling', async () => {
  const f = fixture(); f.controls.delivery = new Error('timeout'); await start(f); await f.c.drain(cfg)
  assert.equal(f.calls.deliveries.length, 1); assert.equal((await f.c.list())[0].status, 'unknown')
  assert.equal((await f.c.ignore('t', 'c')).ok, true)
  const g = fixture(); await start(g); await g.c.markRunning('t', 'c', 's', 3); await g.c.endTurn('t', 'c', 's', 3)
  assert.equal((await g.c.list())[0].status, 'unknown')
})
await test('reply definitive failure retries only writer, never execution', async () => {
  const f = fixture(); await start(f); f.controls.write = { ok: false, definitive: true, error: 'rejected' }
  assert.equal((await f.c.complete('c', 's', 'done')).ok, false); assert.equal((await f.c.list())[0].status, 'reply_pending')
  f.controls.write = { ok: true, commentId: 'reply' }; await f.c.drain(cfg)
  assert.equal(f.calls.deliveries.length, 1); assert.equal(f.calls.writes.length, 2); assert.equal((await f.c.list())[0].status, 'replied')
  assert.equal(f.calls.writes[0].options.key, f.calls.writes[1].options.key)
})
await test('uncertain outbound freezes task scans/sends until explicit remote reconciliation', async () => {
  const f = fixture(); await start(f); f.controls.write = new Error('timeout')
  await f.c.complete('c', 's', 'done'); const scanCount = f.calls.scans.length
  f.comments(comment('new')); await baseline(f); assert.equal(f.calls.scans.length, scanCount)
  assert.equal((await f.c.writeOutbound('t', 'progress', { key: 'progress' })).unknown, true); assert.equal(f.calls.writes.length, 1)
  assert.deepEqual((await f.c.status()).blockedTasks, ['t']); f.restart(); await f.c.drain(cfg); assert.equal(f.calls.writes.length, 1)
  const key = Object.values(f.saved.outbound)[0].key
  assert.equal((await f.c.reconcileOutbound('t', key, { commentId: 'remote-reply' })).ok, true)
  await f.c.drain(cfg); assert.equal((await f.c.list())[0].status, 'replied'); assert.equal(f.calls.writes.length, 1)
})
await test('sending crash locks and proven non-send permits retry with same key/payload', async () => {
  const f = fixture(); await baseline(f); await f.c.writeOutbound('t', 'body', { key: 'k' }); const snapshot = f.saved
  Object.values(snapshot.outbound)[0].status = 'sending'; delete Object.values(snapshot.outbound)[0].commentId
  const recovered = fixture(snapshot); await recovered.c.status(); assert.deepEqual((await recovered.c.status()).blockedTasks, ['t'])
  await recovered.c.reconcileOutbound('t', 'k', { notSent: true })
  assert.equal((await recovered.c.writeOutbound('t', 'changed', { key: 'k' })).ok, false)
  assert.equal((await recovered.c.writeOutbound('t', 'body', { key: 'k' })).ok, true); assert.equal(recovered.calls.writes.length, 1)
})
await test('only stable outbound commentId ignores own echo, not same body or author', async () => {
  const f = fixture(); await baseline(f); await f.c.writeOutbound('t', '🤖: body', { key: 'k' })
  f.comments(comment('out-1', 'owner', 'edited own echo'), comment('human', 'owner', '🤖: body')); await baseline(f)
  assert.equal((await f.c.list())[0].reason, 'outbound-ledger'); assert.equal(f.calls.deliveries[0].commentId, 'human')
})
await test('single-flight serialization prevents overlapping scans/delivery/writer effects', async () => {
  const f = fixture(); await baseline(f); f.comments(comment('c'))
  await Promise.all([f.c.sync(f.tasks, cfg), f.c.sync(f.tasks, cfg), f.c.drain(cfg)])
  assert.equal(f.calls.deliveries.length, 1)
  await Promise.all([f.c.writeOutbound('t', 'one', { key: 'k' }), f.c.writeOutbound('t', 'one', { key: 'k' })])
  assert.equal(f.calls.writes.length, 1)
})
await test('snapshot save failure poisons coordinator before any external effect', async () => {
  const f = fixture(); await baseline(f); f.controls.busy = true; f.comments(comment('c')); await baseline(f)
  f.controls.busy = false; f.controls.saveFail = true
  await assert.rejects(f.c.drain(cfg), /disk failed/); assert.equal(f.calls.deliveries.length, 0)
  f.controls.saveFail = false; await assert.rejects(f.c.drain(cfg), /recreate coordinator/)
  f.restart(); await f.c.drain(cfg); assert.equal(f.calls.deliveries.length, 1)
})
await test('authoritative task recheck blocks scan and owner downgrade cannot upgrade', async () => {
  const f = fixture(); f.controls.resolve = () => ({ ...f.tasks[0], paused: true }); await baseline(f); assert.equal(f.calls.scans.length, 0)
  const g = fixture(); g.controls.busy = true; await start(g); g.tasks[0].members = []; g.controls.busy = false; await g.c.drain(cfg)
  assert.equal(g.calls.deliveries[0].maxPermission, 'reply')
  const h = fixture(); h.controls.busy = true; await start(h, comment('c', 'other')); h.tasks[0].members.push({ id: 'other', role: 'assignee' }); h.controls.busy = false; await h.c.drain(cfg)
  assert.equal(h.calls.deliveries[0].maxPermission, 'reply')
})
await test('ordinary writer supports unbound/paused manual comments but reply requires active', async () => {
  const f = fixture(); f.tasks[0].sessionId = null; f.tasks[0].paused = true
  assert.equal((await f.c.writeOutbound('t', 'manual', { key: 'manual' })).ok, true)
  assert.equal((await f.c.writeOutbound('t', 'reply', { key: 'reply', requireActive: true })).ok, false)
  assert.equal((await f.c.writeOutbound('t', 'changed', { key: 'manual' })).ok, false)
})
await test('missing creator type never becomes owner or executable user', async () => {
  const f = fixture(); await baseline(f); f.comments({ id: 'unknown', creator: { id: 'owner' }, content: 'execute' }); await baseline(f)
  assert.equal(normalizeComment({ creator: { id: 'owner' } }).authorType, '')
  assert.equal(f.calls.deliveries.length, 0); assert.equal((await f.c.list())[0].status, 'ignored')
})
await test('invalid persistent snapshots fail closed without scanning/writing', async () => {
  for (const snapshot of [{}, { version: 1, nextSeq: 1, tasks: {}, inbox: [{ status: 'pending' }], outbound: {} }, { version: 1, nextSeq: 1, tasks: {}, inbox: [], outbound: { bad: { status: 'sent' } } }]) {
    const f = fixture(snapshot); await assert.rejects(f.c.sync(f.tasks, cfg), /Invalid comment snapshot/)
    assert.equal(f.calls.scans.length, 0); assert.equal(f.calls.writes.length, 0)
  }
})
await test('final ownership recheck can only downgrade permission', async () => {
  const f = fixture(); f.controls.busy = true; await start(f); f.controls.busy = false
  let checks = 0
  f.controls.resolve = () => ({ ...f.tasks[0], members: ++checks === 1 ? f.tasks[0].members : [] })
  await f.c.drain(cfg); assert.equal(f.calls.deliveries[0].maxPermission, 'reply')
})
await test('dispose waits accepted writer work to settle, blocks new operations and is idempotent', async () => {
  const f = fixture(); await baseline(f)
  let release, entered, disposed = false
  const started = new Promise((resolve) => { entered = resolve })
  const waiting = new Promise((resolve) => { release = resolve })
  const originalWrite = f.deps.writeComment
  f.deps.writeComment = async (...args) => { entered(); await waiting; return originalWrite(...args) }
  const write = f.c.writeOutbound('t', 'accepted', { key: 'dispose-write' })
  await started
  const dispose = f.c.dispose().then(() => { disposed = true })
  await Promise.resolve(); assert.equal(disposed, false)
  await assert.rejects(f.c.status(), /disposed/)
  await assert.rejects(f.c.writeOutbound('t', 'new', { key: 'late' }), /disposed/)
  release(); assert.equal((await write).ok, true); await dispose
  assert.equal(disposed, true); assert.equal(Object.values(f.saved.outbound)[0].status, 'sent')
  await f.c.dispose(); assert.equal(f.calls.writes.length, 1)
})
await test('dispose drains previously accepted serial calls and handles earlier failed work', async () => {
  const f = fixture(); await baseline(f)
  const accepted = f.c.writeOutbound('t', 'one', { key: 'accepted' })
  const queued = f.c.list()
  const disposed = f.c.dispose()
  assert.equal((await accepted).ok, true); assert.deepEqual(await queued, []); await disposed
  await assert.rejects(f.c.drain(cfg), /disposed/)
  const g = fixture(); g.controls.saveFail = true
  const failed = g.c.sync(g.tasks, cfg)
  const end = g.c.dispose()
  await assert.rejects(failed, /disk failed/); await end
  await assert.rejects(g.c.sync(g.tasks, cfg), /disposed/)
})
console.log(`\n${checks} comment coordinator checks passed (fake adapters, no network/filesystem state).`)
