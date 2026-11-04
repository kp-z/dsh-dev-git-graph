import assert from 'node:assert/strict'
import { createCreationLedger } from '../creationLedger.js'

const clone = value => JSON.parse(JSON.stringify(value))
const request = (key = 'key-a', sessionId = 'session-a', extra = {}) => ({
  key, sessionId, backend: 'lark', summary: 'Create fixture', tasklistGuid: 'list-guid', followUp: false, ...extra,
})
function store(seed = {}) {
  let saved = clone(seed)
  let clock = 1000
  let writes = 0
  let broken = false
  let loadBroken = false
  return {
    adapters: {
      load: async () => { if (loadBroken) throw new Error('load unavailable'); return clone(saved) },
      save: async rows => { writes++; if (broken) throw new Error('disk unavailable'); saved = clone(rows) },
      now: () => ++clock,
    },
    snapshot: () => clone(saved),
    writes: () => writes,
    breakSave: () => { broken = true },
    healSave: () => { broken = false },
    breakLoad: () => { loadBroken = true },
    open() { return createCreationLedger(this.adapters) },
  }
}
const success = result => { assert.equal(result.ok, true, result.error); return result.receipt }
const blocked = result => { assert.equal(result.ok, false); assert.equal(result.blocked, true); assert.equal(typeof result.error, 'string'); return result.receipt }

// Persist BEFORE authorizing work, deep clone adapters and public receipts.
{
  const db = store()
  const ledger = db.open()
  const begun = success(await ledger.begin(request()))
  assert.equal(begun.status, 'prepared')
  assert.equal(db.snapshot()['key-a'].status, 'prepared')
  begun.status = 'done'
  const read = await ledger.get('key-a')
  assert.equal(read.status, 'prepared')
  read.summary = 'mutated'
  const list = await ledger.list({ sessionId: 'session-a', status: 'prepared' })
  list[0].status = 'failed'
  assert.equal((await ledger.get('key-a')).summary, 'Create fixture')
  assert.equal(db.snapshot()['key-a'].status, 'prepared')
  assert.equal(await ledger.get('missing'), null)
  assert.deepEqual(await ledger.list({ sessionId: 'missing' }), [])
  blocked(await ledger.begin(request())) // same prepared key cannot authorize twice
  blocked(await ledger.begin(request('key-b')))
  blocked(await ledger.begin(request('key-c', 'session-a', { followUp: true })))
  assert.equal(success(await ledger.begin(request('other', 'session-other'))).status, 'prepared')
  assert.equal(db.writes(), 2)
}

// Queue protects concurrent same-session calls, including separate keys/followUp.
{
  const db = store()
  let entered = 0
  let release
  const latch = new Promise(resolve => { release = resolve })
  const originalSave = db.adapters.save
  db.adapters.save = async rows => { entered++; await latch; await originalSave(rows) }
  const ledger = db.open()
  const first = ledger.begin(request())
  const second = ledger.begin(request('follow-up', 'session-a', { followUp: true }))
  await Promise.resolve(); await Promise.resolve(); await Promise.resolve()
  assert.equal(entered, 1)
  release()
  success(await first)
  blocked(await second)
  const sending = await Promise.all([ledger.sending('key-a'), ledger.sending('key-a')])
  assert.equal(sending.filter(row => row.ok).length, 1)
}

// Full lifecycle records real GUID/results, isolates references, reuses done key.
{
  const db = store()
  const ledger = db.open()
  success(await ledger.begin(request()))
  blocked(await ledger.created('key-a', { taskId: 'task-guid' }))
  success(await ledger.sending('key-a'))
  blocked(await ledger.created('key-a', {}))
  blocked(await ledger.created('key-a', { taskId: ' ' }))
  blocked(await ledger.finish('key-a', {}))
  blocked(await ledger.begin(request('follow-up', 'session-a', { followUp: true })))
  const metadata = { taskId: 'task-guid', fields: { title: 'remote title' } }
  const created = success(await ledger.created('key-a', metadata))
  assert.equal(created.taskId, 'task-guid')
  assert.equal(db.snapshot()['key-a'].taskId, 'task-guid')
  metadata.fields.title = 'mutated'
  assert.equal((await ledger.get('key-a')).creation.fields.title, 'remote title')
  blocked(await ledger.cancel('key-a', { provenNotSent: true }))
  blocked(await ledger.begin(request('follow-up', 'session-a', { followUp: true })))
  const partial = success(await ledger.markPartial('key-a', new Error('bind failed')))
  assert.equal(partial.status, 'partial')
  assert.equal(partial.error, 'bind failed')
  blocked(await ledger.begin(request('follow-up', 'session-a', { followUp: true })))
  const result = { taskId: 'task-guid', binding: { sessionId: 'session-a' } }
  success(await ledger.finish('key-a', result))
  result.binding.sessionId = 'mutated'
  assert.equal(db.snapshot()['key-a'].result.binding.sessionId, 'session-a')
  const writes = db.writes()
  const reused = await ledger.begin(request())
  assert.equal(reused.reused, true)
  assert.equal(reused.receipt.taskId, 'task-guid')
  assert.equal(db.writes(), writes)
  blocked(await ledger.begin(request('key-a', 'different-session')))
  blocked(await ledger.finish('key-a', {}))
  success(await ledger.begin(request('follow-up', 'session-a', { followUp: true })))
}

// Prepared recovery is safe to retry; sending recovery is conservatively unknown.
{
  const db = store()
  const first = db.open()
  success(await first.begin(request('prepared', 'prepared-session')))
  success(await first.begin(request('sent', 'sent-session')))
  success(await first.sending('sent'))
  const recovered = db.open()
  const all = await recovered.list()
  assert.equal(all.find(row => row.key === 'prepared').status, 'failed')
  assert.equal(all.find(row => row.key === 'sent').status, 'unknown')
  assert.equal(db.snapshot().prepared.status, 'failed')
  assert.equal(db.snapshot().sent.status, 'unknown')
  success(await recovered.begin(request('prepared', 'prepared-session')))
  blocked(await recovered.begin(request('sent', 'sent-session')))
  blocked(await recovered.begin(request('sent-new', 'sent-session', { followUp: true })))
  blocked(await recovered.sending('sent'))
  blocked(await recovered.cancel('sent', { provenNotSent: true }))
  blocked(await recovered.fail('sent', { definitive: true }))
}

// Unknown POST survives restart/tasks clearing; cannot reconcile without evidence.
{
  const db = store()
  let tasks = [{ id: 'unrelated-task' }]
  const ledger = db.open()
  success(await ledger.begin(request()))
  success(await ledger.sending('key-a'))
  assert.equal(success(await ledger.fail('key-a', { error: new Error('POST timed out') })).status, 'unknown')
  tasks = []
  assert.equal(tasks.length, 0)
  const restarted = db.open()
  blocked(await restarted.begin(request()))
  blocked(await restarted.begin(request('another', 'session-a', { followUp: true })))
  blocked(await restarted.finish('key-a', { taskId: 'guessed-guid' }))
  blocked(await restarted.reconcile('key-a', { taskId: 'task-guid' }))
  blocked(await restarted.reconcile('key-a', { evidence: 'verified remote response' }))
  assert.equal(success(await restarted.reconcile('key-a', { taskId: 'task-guid', evidence: 'verified remote response' })).status, 'created')
  blocked(await restarted.reconcile('key-a', { taskId: 'other-guid', evidence: 'replacement' }))
  success(await restarted.finish('key-a', { taskId: 'task-guid' }))
  assert.equal((await db.open().begin(request())).reused, true)
}

// Known created/partial/done receipts survive restart independently of tasks.
for (const state of ['created', 'partial', 'done']) {
  const db = store()
  const ledger = db.open()
  success(await ledger.begin(request()))
  success(await ledger.sending('key-a'))
  success(await ledger.created('key-a', { taskId: 'task-guid', partial: state === 'partial' }))
  if (state === 'done') success(await ledger.finish('key-a', { bound: true }))
  const restarted = db.open()
  assert.equal((await restarted.get('key-a')).status, state)
  assert.equal((await restarted.get('key-a')).taskId, 'task-guid')
  if (state === 'done') assert.equal((await restarted.begin(request())).reused, true)
  else blocked(await restarted.begin(request('new-key', 'session-a', { followUp: true })))
}

// Caller must prove IO never began; ambiguous sending must become unknown.
for (const state of ['prepared', 'sending']) {
  const db = store()
  const ledger = db.open()
  success(await ledger.begin(request()))
  if (state === 'sending') success(await ledger.sending('key-a'))
  blocked(await ledger.cancel('key-a'))
  blocked(await ledger.cancel('key-a', { provenNotSent: false }))
  assert.equal((await ledger.get('key-a')).status, state)
  assert.equal(success(await ledger.cancel('key-a', { provenNotSent: true })).status, 'failed')
  assert.equal(success(await ledger.begin(request())).status, 'prepared')
}
{
  const db = store()
  const ledger = db.open()
  success(await ledger.begin(request()))
  success(await ledger.sending('key-a'))
  assert.equal(success(await ledger.fail('key-a', { definitive: true, error: 'Explicit POST rejection' })).status, 'failed')
  success(await ledger.begin(request()))
}

// Every persistence boundary fails closed, permanently, before more remote work.
for (const stage of ['begin', 'sending', 'created', 'markPartial', 'finish', 'cancel', 'fail', 'reconcile', 'recovery']) {
  const db = store()
  let ledger = db.open()
  if (stage !== 'begin') success(await ledger.begin(request()))
  if (['created', 'markPartial', 'finish', 'fail', 'reconcile'].includes(stage)) success(await ledger.sending('key-a'))
  if (['markPartial', 'finish'].includes(stage)) success(await ledger.created('key-a', { taskId: 'task-guid' }))
  if (stage === 'reconcile') success(await ledger.fail('key-a', { error: 'timeout' }))
  if (stage === 'recovery') ledger = db.open()
  db.breakSave()
  let remote = 0
  const operations = {
    begin: () => ledger.begin(request()), sending: () => ledger.sending('key-a'),
    created: () => ledger.created('key-a', { taskId: 'task-guid' }),
    markPartial: () => ledger.markPartial('key-a', 'binding failed'),
    finish: () => ledger.finish('key-a', { bound: true }),
    cancel: () => ledger.cancel('key-a', { provenNotSent: true }),
    fail: () => ledger.fail('key-a', { error: 'timeout' }),
    reconcile: () => ledger.reconcile('key-a', { taskId: 'task-guid', evidence: 'remote response' }),
    recovery: () => ledger.begin(request('new-key')),
  }
  const failed = await operations[stage]()
  if (failed.ok) remote++
  blocked(failed)
  const writes = db.writes()
  db.healSave()
  const retry = await ledger.begin(request('retry', 'another-session'))
  if (retry.ok) remote++
  blocked(retry)
  blocked(await ledger.sending('key-a'))
  await assert.rejects(ledger.get('key-a'), /persistence failed/)
  await assert.rejects(ledger.list(), /persistence failed/)
  assert.equal(db.writes(), writes)
  assert.equal(remote, 0, stage)
}

// Load errors, malformed stores, and explicit negative save acknowledgements.
{
  const db = store()
  db.breakLoad()
  const ledger = db.open()
  blocked(await ledger.begin(request()))
  blocked(await ledger.begin(request('next', 'next-session')))
  assert.equal(db.writes(), 0)
}
for (const malformed of [[], { x: {} }, { x: { key: 'x', sessionId: 's', status: 'created' } }, { x: { key: 'x', sessionId: 's', status: 'garbage' } }]) {
  const ledger = createCreationLedger({ load: () => malformed, save: () => assert.fail('invalid store must not save') })
  blocked(await ledger.begin(request()))
}
for (const rejection of [false, { ok: false }]) {
  const ledger = createCreationLedger({ load: () => ({}), save: () => rejection })
  blocked(await ledger.begin(request()))
  blocked(await ledger.begin(request('next', 'next-session')))
}
console.log('CREATION_LEDGER_OK: serialized durable guard, restart recovery, followUp protection, unknown POST reconciliation, reused completion, cancellation proof and poisoned persistence')
