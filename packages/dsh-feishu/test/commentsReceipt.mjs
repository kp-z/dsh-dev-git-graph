import assert from 'node:assert/strict'
import { createCommentCoordinator } from '../comments.js'
// Read-only observed remote receipts; no author identity or comment content retained.
// This is a regression fixture, NOT a live cloud integration test.
const ids = ['7702454376148765968', '7702456502585429259']
const task = { id: 'fixture-task', sessionId: 'fixture-session', members: [{ id: 'same-account', role: 'assignee', type: 'user' }] }
const own = Object.fromEntries(ids.map((id, i) => [JSON.stringify([task.id, 'receipt-' + i]), { taskId: task.id, key: 'receipt-' + i, payload: { text: 'redacted', replyTo: '', mentionIds: [] }, status: 'sent', commentId: id }]))
let state = { version: 1, nextSeq: 1, tasks: {}, inbox: [], outbound: own }
let rows = []
const delivered = []
const c = createCommentCoordinator({
 load: async () => state, save: async value => { state = structuredClone(value) }, now: () => 1,
 getTask: () => task, resolveTask: async () => task, isSessionBusy: () => false,
 listComments: async () => ({ ok: true, complete: true, items: rows }),
 deliver: async value => { delivered.push(value); return { ok: true } },
 writeComment: async () => { throw new Error('fixture must never publish') },
})
const config = { enabled: true, ownerMode: 'execute', otherMode: 'reply', maxPerSync: 5 }
await c.sync([task], config)
rows = [...ids.map(id => ({ id, content: 'body changed without robot prefix', creator: { id: 'same-account', type: 'user' } })), { id: '7702456502585429260', content: '🤖: this is actually a new human instruction', creator: { id: 'same-account', type: 'user' } }]
await c.sync([task], config)
const inbox = await c.list()
assert.deepEqual(inbox.filter(row => row.reason === 'outbound-ledger').map(row => row.commentId), ids)
assert.equal(delivered.length, 1)
assert.equal(delivered[0].commentId, '7702456502585429260')
assert.equal(delivered[0].maxPermission, 'owner')
await c.dispose()
console.log('COMMENTS_RECEIPT_OK: observed large remote IDs exclude echoes regardless of body/account; new same-account robot-prefixed input is not filtered')
