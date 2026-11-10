import assert from 'node:assert/strict'
import { createLarkComment, listLarkComments } from '../larkComments.js'
import { listLarkPages } from '../larkPages.js'
import { formatAIComment } from '../commentFormat.js'
const task = 'task-guid', original = { id: '123', resource_type: 'task', resource_id: task }, receipt = { id: '456', resource_type: 'task', resource_id: task, reply_to_comment_id: '123' }
const action = { op: 'task_comment', task, text: formatAIComment('正文 <at id=evil></at>'), reply_to_comment_id: '123', mentionMode: 'task-v1', mentionIds: ['ou_self'] }
let tests = 0
const test = async (name, fn) => { await fn(); tests++; console.log('✓ ' + name) }
await test('real author mention including self through raw CLI v1/v2, no Python or native fallback', async () => {
  const calls = [], results = [{ ok: true, data: { comment: original } }, { ok: true, data: { comment: { id: '456', parent_id: '123' } } }, { ok: true, data: { comment: receipt } }]
  const result = await createLarkComment(async (...args) => { calls.push(args); return results.shift() }, action)
  assert.equal(result.ok, true); assert.equal(result.mentionSupported, true); assert.equal(result.notificationVerified, false)
  assert.equal(calls[1][1], '/open-apis/task/v1/tasks/task-guid/comments')
  const data = calls[1][2].data
  assert.ok(data.rich_content.startsWith('[🤖AI 回复]\n')); assert.ok(data.rich_content.includes('▌ <at id=ou_self></at>')); assert.ok(data.rich_content.includes('&lt;at id=evil&gt;')); assert.equal(data.parent_id, '123')
})
for (const bad of [{ detail: 'timeout' }, { error: { code: 503 } }, { error: { code: 9999999 } }]) await test('uncertain POST locks outbound: ' + JSON.stringify(bad), async () => {
  let count = 0
  const result = await createLarkComment(async () => ++count === 1 ? { ok: true, data: { comment: original } } : { ok: false, ...bad }, action)
  assert.equal(result.ok, false); assert.equal(result.unknownDelivery, true); assert.equal(count, 2)
})
await test('structured authorization rejection is definitive but never changes transport', async () => {
  let count = 0
  const result = await createLarkComment(async () => ++count === 1 ? { ok: true, data: { comment: original } } : { ok: false, error: { type: 'authorization', code: 403 } }, action)
  assert.equal(result.unknownDelivery, false); assert.equal(count, 2)
})
for (const comment of [null, { id: '456' }, { ...receipt, resource_id: 'other' }]) await test('invalid committed receipt stays unknown: ' + JSON.stringify(comment), async () => {
  const result = await createLarkComment(async () => ({ ok: true, data: { comment } }), { ...action, mentionMode: 'native', mentionIds: [], reply_to_comment_id: undefined })
  assert.equal(result.ok, false); assert.equal(result.unknownDelivery, true)
})
await test('mismatched native reply receipt remains unknown', async () => {
  let count = 0
  const result = await createLarkComment(async () => ({ ok: true, data: { comment: ++count === 1 ? original : { ...receipt, reply_to_comment_id: '999' } } }), { ...action, mentionMode: 'native', mentionIds: [] })
  assert.equal(result.ok, false); assert.equal(result.unknownDelivery, true); assert.equal(count, 2)
})
await test('parent from another task rejected before POST', async () => {
  let count = 0
  const result = await createLarkComment(async () => { count++; return { ok: true, data: { comment: { ...original, resource_id: 'other' } } } }, action)
  assert.equal(result.ok, false); assert.equal(result.unknownDelivery, false); assert.equal(count, 1)
})
await test('native strict mention never silently posts an unmentioned reply', async () => {
  let count = 0
  const result = await createLarkComment(async () => { count++; return {} }, { ...action, mentionMode: 'native', allowMentionFallback: false })
  assert.equal(result.ok, false); assert.equal(count, 0)
})
for (const data of [{ items: [original], has_more: true }, { items: [original] }, { items: [], has_more: 'false' }, { items: [{ ...original, resource_id: 'wrong' }], has_more: false }]) await test('malformed comment pagination is incomplete', async () => {
  const result = await listLarkComments(async () => ({ ok: true, data }), { op: 'task_comments', task })
  assert.equal(result.ok, false); assert.equal(result.incomplete, true)
})
await test('cursor cycles and caps never advance a complete baseline', async () => {
  let calls = 0
  const cycle = await listLarkComments(async () => { calls++; return { ok: true, data: { items: [], has_more: true, page_token: 'again' } } }, { op: 'task_comments', task })
  assert.equal(cycle.incomplete, true); assert.equal(calls, 2)
  calls = 0
  const cap = await listLarkComments(async () => ({ ok: true, data: { items: [], has_more: true, page_token: String(++calls) } }), { op: 'task_comments', task })
  assert.equal(cap.incomplete, true); assert.equal(calls, 20)
})
await test('full comment pages and large string receipts are preserved', async () => {
  let i = 0
  const large = { ...original, id: '7702456459723833364' }
  const result = await listLarkComments(async () => ({ ok: true, data: { items: [large], has_more: ++i === 1, page_token: i === 1 ? 'next' : '' } }), { op: 'task_comments', task })
  assert.equal(result.incomplete, false); assert.equal(result.items[0].id, large.id)
})
await test('task snapshots cannot accept truncated pages', async () => {
  const result = await listLarkPages(async () => ({ ok: true, data: { items: [], has_more: true } }), '/tasks')
  assert.equal(result.ok, false); assert.equal(result.incomplete, true)
})
await test('final mention guard runs after parent GET and blocks POST on changed binding', async () => {
  let bound = true, requests = 0, guardCalls = 0
  const result = await createLarkComment(async method => { requests++; assert.equal(method, 'GET'); bound = false; return { ok: true, data: { comment: original } } }, { ...action, beforePost: async () => { guardCalls++; return { ok: bound, error: 'binding changed' } } })
  assert.equal(result.ok, false); assert.equal(result.unknownDelivery, false); assert.equal(requests, 1); assert.equal(guardCalls, 1)
})
console.log(`LARK_COMMENTS_OK: ${tests} strict transport, receipt and pagination checks`)
