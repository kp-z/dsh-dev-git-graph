import assert from 'node:assert/strict'
import { createCommentCoordinator } from '../comments.js'
let snapshot = null
const task = { id: 't', sessionId: 's', members: [{ id: 'owner', type: 'user', role: 'assignee' }] }
let items = []
const config = { enabled: true, ownerMode: 'execute', otherMode: 'reply' }
const deps = {
  load: async () => snapshot,
  save: async (next) => { snapshot = structuredClone(next) },
  getTask: () => task, resolveTask: async () => task,
  listComments: async () => ({ ok: true, complete: true, items }),
  isSessionBusy: () => false, deliver: async () => ({ ok: true }), now: () => 1,
  writeComment: async () => ({ ok: true, commentId: '99', mentionSupported: false, warning: '原生关联回复，不保证 @ 通知' }),
}
const coordinator = createCommentCoordinator(deps)
await coordinator.sync([task], config)
items = [{ id: '1', content: '问题', creator: { id: 'author', type: 'user' } }]
await coordinator.sync([task], config)
await coordinator.markRunning('t', '1', 's', 1)
const result = await coordinator.complete('1', 's', '回答', { taskId: 't' })
assert.equal(result.mentionSupported, false)
assert.match(result.warning, /不保证/)
assert.equal((await coordinator.list())[0].warning, result.warning)
assert.equal(Object.values(snapshot.outbound)[0].warning, result.warning)
await coordinator.dispose()
const restored = createCommentCoordinator(deps)
const receipt = await restored.writeOutbound('t', '🤖: 回答', { key: 'reply:' + JSON.stringify(['t', '1']), replyTo: '1', mentionIds: ['author'] })
assert.equal(receipt.reused, true)
assert.equal(receipt.warning, result.warning)
assert.equal(receipt.mentionSupported, false)
await restored.dispose()
console.log('COMMENTS_WARNING_OK: fallback warning preserved in receipt, inbox and restart ledger; no fake mention claim')
