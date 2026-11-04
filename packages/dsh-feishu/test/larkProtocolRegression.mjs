import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createLarkTasklistActions } from '../larkTasklist.js'
import { createLarkComment, listLarkComments } from '../larkComments.js'
import { listLarkPages } from '../larkPages.js'
import { formatAIComment } from '../commentFormat.js'

// Pure in-memory fakeAPI only: no CLI processes, installation, credentials or network.
const ROOT = '/open-apis/task/v2'
const task = 'task-1'
const ok = data => ({ ok: true, data })
const page = (items = [], has_more = false, page_token = '') => ok({ items, has_more, page_token })
const comment = (id = '123', extra = {}) => ({ id, resource_type: 'task', resource_id: task, content: '原评论内容', ...extra })
const options = [{ guid: 'a', name: 'Existing', color_index: 4 }, { guid: 'hidden', name: 'Old', is_hidden: true, color_index: 2 }, { guid: 'blank', name: '', is_hidden: true }]
const field = (type = 'single_select', extra = {}) => ({ guid: 'field/1', name: '工作区', type, [`${type}_setting`]: { options: structuredClone(options), unrelated_setting: 'preserved' }, ...extra })
const ensure = extra => ({ op: 'ensure_select_options', tasklist: 'list/1', name: '工作区', options: ['Existing', 'New', 'Old', 'New'], ...extra })
function fake(responses = []) {
  const calls = []
  const api = async (method, path, config) => {
    calls.push({ method, path, ...structuredClone(config) })
    assert.ok(responses.length, `Unexpected fakeAPI request: ${method} ${path}`)
    const value = responses.shift()
    if (value instanceof Error) throw value
    return typeof value === 'function' ? value(calls.at(-1)) : structuredClone(value)
  }
  return { api, calls, remaining: responses, run: createLarkTasklistActions(api) }
}
const writes = calls => calls.filter(call => call.method !== 'GET')

for (const type of ['single_select', 'multi_select']) test(`${type} ensure_select_options reads all pages and PATCHes actual type with GUID/hidden metadata`, async () => {
  const before = field(type)
  const after = field(type, { [`${type}_setting`]: { ...before[`${type}_setting`], options: [...options, { guid: 'new', name: 'New' }] } })
  const { run, calls, remaining } = fake([page([], true, 'next /&'), page([before]), ok({ custom_field: after })])
  const result = await run(ensure({ expected_type: type }))
  assert.equal(result.ok, true)
  assert.equal(result.guid, 'field/1')
  assert.deepEqual(result.added, ['New'])
  assert.deepEqual(result.warnings, ['选项已隐藏，写入这些值会被拒绝：Old'])
  assert.equal(result.unknownDelivery, false)
  assert.equal(calls[0].params.resource_id, 'list/1')
  assert.equal(calls[1].params.page_token, 'next /&')
  assert.equal(calls[2].method, 'PATCH')
  assert.equal(calls[2].path, `${ROOT}/custom_fields/field%2F1`)
  assert.deepEqual(calls[2].data, { custom_field: { [`${type}_setting`]: { options: [...options, { name: 'New' }], unrelated_setting: 'preserved' } }, update_fields: [`${type}_setting`] })
  assert.equal(writes(calls).length, 1)
  assert.equal(remaining.length, 0)
})
test('ensure_select_options existing values return verified no-op result without PATCH', async () => {
  const { run, calls } = fake([page([field()])])
  const result = await run(ensure({ options: ['Existing', 'Old'] }))
  assert.equal(result.ok, true)
  assert.deepEqual(result.added, [])
  assert.equal(writes(calls).length, 0)
})
test('ensure_select_options field_guid supports exact target with duplicate names', async () => {
  const { run, calls } = fake([page([field(), field('single_select', { guid: 'other' })])])
  const result = await run(ensure({ field_guid: 'field/1', options: [] }))
  assert.equal(result.ok, true)
  assert.equal(result.guid, 'field/1')
  assert.equal(writes(calls).length, 0)
})
for (const [label, action, responses] of [
  ['duplicate names across pages', ensure(), [page([field()], true, 'next'), page([field('single_select', { guid: 'other' })])]],
  ['wrong field GUID', ensure({ field_guid: 'wrong' }), [page([field()])]],
  ['GUID/name conflict', ensure({ field_guid: 'field/1', name: 'Other' }), [page([field()])]],
  ['wrong expected type', ensure({ expected_type: 'multi_select' }), [page([field()])]],
  ['non-select field', ensure(), [page([field('text')])]],
  ['missing setting', ensure(), [page([field('single_select', { single_select_setting: null })])]],
  ['malformed existing option', ensure(), [page([field('single_select', { single_select_setting: { options: [{ name: 'Old' }] } })])]],
  ['matched first page then bad cursor', ensure(), [page([field()], true, 'same'), page([], true, 'same')]],
  ['matched first page then malformed response', ensure(), [page([field()], true, 'next'), ok({ items: [] })]],
  ['field read rejection', ensure(), [{ ok: false, error: { code: 403 } }]],
  ['field read exception', ensure(), [new Error('read timeout')]],
  ['invalid option input', ensure({ options: ['New', 1] }), []],
  ['invalid field GUID', ensure({ field_guid: 12 }), []],
  ['invalid tasklist', ensure({ tasklist: ' ' }), []],
  ['invalid expected type', ensure({ expected_type: 'number' }), []],
]) test(`ensure_select_options rejects ${label} before mutation`, async () => {
  const { run, calls } = fake(responses)
  const result = await run(action)
  assert.equal(result.ok, false)
  assert.equal(result.unknownDelivery, false)
  assert.equal(writes(calls).length, 0)
})
for (const [label, receipt] of [
  ['empty success', ok({})],
  ['wrong field GUID', ok({ custom_field: field('single_select', { guid: 'wrong' }) })],
  ['missing new option', ok({ custom_field: field() })],
  ['lost hidden option', ok({ custom_field: field('single_select', { single_select_setting: { options: [{ guid: 'a', name: 'Existing' }, { guid: 'new', name: 'New' }] } }) })],
  ['changed hidden flag', ok({ custom_field: field('single_select', { single_select_setting: { options: [...options.map(item => ({ ...item, is_hidden: false })), { guid: 'new', name: 'New' }] } }) })],
  ['changed existing GUID', ok({ custom_field: field('single_select', { single_select_setting: { options: [...options.map(item => ({ ...item, guid: item.guid + '-changed' })), { guid: 'new', name: 'New' }] } }) })],
  ['duplicate newly created option', ok({ custom_field: field('single_select', { single_select_setting: { options: [...options, { guid: 'new', name: 'New' }, { guid: 'new2', name: 'New' }] } }) })],
  ['write timeout', new Error('PATCH timeout')],
]) test(`ensure_select_options ${label} remains unknown after one PATCH`, async () => {
  const { run, calls } = fake([page([field()]), receipt])
  const result = await run(ensure())
  assert.equal(result.ok, false)
  assert.equal(result.unknownDelivery, true)
  assert.equal(writes(calls).length, 1)
})
test('ensure_select_options structured rejection is known, not unknown delivery', async () => {
  const { run } = fake([page([field()]), { ok: false, error: { type: 'validation', code: 400 } }])
  assert.equal((await run(ensure())).unknownDelivery, false)
})
test('delete_custom_field sends correct POST/remove resource body', async () => {
  const { run, calls } = fake([ok({})])
  const result = await run({ op: 'delete_custom_field', tasklist: 'list/1', guid: 'field/1' })
  assert.equal(result.ok, true)
  assert.equal(result.error, null)
  assert.equal(result.unknownDelivery, false)
  assert.deepEqual(calls, [{ method: 'POST', path: `${ROOT}/custom_fields/field%2F1/remove`, data: { resource_type: 'tasklist', resource_id: 'list/1' }, timeoutMs: 60000 }])
})
for (const extra of [{ guid: '' }, { guid: 123 }, { tasklist: '' }, { tasklist: null }]) test(`delete_custom_field invalid input ${JSON.stringify(extra)} never writes`, async () => {
  const { run, calls } = fake()
  assert.equal((await run({ op: 'delete_custom_field', tasklist: 'list', guid: 'field', ...extra })).ok, false)
  assert.equal(calls.length, 0)
})
for (const [receipt, unknown] of [[new Error('timeout'), true], [ok(null), true], [{ ok: false, error: { code: 503 } }, true], [{ ok: false, error: { type: 'authorization', code: 403 } }, false]]) test(`delete_custom_field classifies delivery ${unknown} ${JSON.stringify(receipt)}`, async () => {
  const { run, calls } = fake([receipt])
  const result = await run({ op: 'delete_custom_field', tasklist: 'list', guid: 'field' })
  assert.equal(result.ok, false)
  assert.equal(result.unknownDelivery, unknown)
  assert.equal(writes(calls).length, 1)
})

for (const alias of ['mentionIds', 'mention_ids', 'mentions']) test(`comment ${alias} and content alias preserve original text and real self@ in AI card`, async () => {
  const text = formatAIComment('内容 <at id=evil></at> & 原文')
  const { api, calls } = fake([ok({ comment: comment() }), ok({ comment: { id: '456', parent_id: '123' } }), ok({ comment: comment('456', { reply_to_comment_id: '123' }) })])
  const result = await createLarkComment(api, { op: 'task_comment', task, content: text, replyToCommentId: '123', mentionMode: 'task-v1', [alias]: ['ou_self', 'ou_self'] })
  assert.equal(result.ok, true)
  assert.equal(result.mentionSupported, true)
  assert.equal(result.mentionTransport, 'task-v1')
  assert.equal(result.notificationVerified, false)
  assert.equal(calls[1].path, '/open-apis/task/v1/tasks/task-1/comments')
  assert.equal(calls[1].data.content, text)
  assert.ok(calls[1].data.rich_content.startsWith('[🤖AI 回复]\n'))
  assert.equal(calls[1].data.rich_content.split('<at id=ou_self></at>').length, 2)
  assert.ok(calls[1].data.rich_content.includes('▌ <at id=ou_self></at>'))
  assert.ok(calls[1].data.rich_content.includes('&lt;at id=evil&gt;'))
})
test('empty primary mention alias does not mask populated mentions or allow native unmentioned POST', async () => {
  const { api, calls } = fake()
  const result = await createLarkComment(api, { task, text: 'reply', mentionIds: [], mentions: ['ou_self'], reply_to_comment_id: '123', mentionMode: 'native' })
  assert.equal(result.ok, false)
  assert.equal(result.unsupported, 'mentions')
  assert.equal(calls.length, 0)
})
test('empty primary alias still sends populated mentions through v1', async () => {
  const { api, calls } = fake([ok({ comment: { id: '456', parent_id: '0' } }), ok({ comment: comment('456') })])
  const result = await createLarkComment(api, { task, text: 'hello', mentionIds: [], mentions: ['ou_self'], mentionMode: 'task-v1' })
  assert.equal(result.ok, true)
  assert.ok(calls[0].data.rich_content.includes('<at id=ou_self></at>'))
})
for (const extra of [{ task: 123 }, { task: ' ' }, { reply_to_comment_id: 123 }, { reply_to_comment_id: true }, { mentions: 'ou_self' }, { mentions: ['bad'] }, { mentionIds: ['ou_self'], mentions: ['bad'] }, { mentions: Array(6).fill('ou_self') }, { text: '\uD800' }]) test(`illegal comment input never invokes fakeAPI ${JSON.stringify(extra)}`, async () => {
  const { api, calls } = fake()
  const result = await createLarkComment(api, { task, text: 'body', mentionMode: 'task-v1', ...extra })
  assert.equal(result.ok, false)
  assert.equal(result.unknownDelivery, false)
  assert.equal(calls.length, 0)
})
test('explicit native mention fallback is visible and still preflights reply resource', async () => {
  const { api, calls } = fake([ok({ comment: comment() }), ok({ comment: comment('456', { reply_to_comment_id: '123' }) })])
  const result = await createLarkComment(api, { task, content: 'native', mentions: ['ou_self'], reply_to_comment_id: '123', allowMentionFallback: true })
  assert.equal(result.ok, true)
  assert.equal(result.mentionSupported, false)
  assert.match(result.warning, /不保证/)
  assert.equal(calls[1].path, `${ROOT}/comments`)
  assert.equal(calls[1].data.reply_to_comment_id, '123')
})
for (const wrong of [comment('124'), comment('123', { resource_id: 'foreign' }), { ...comment(), id: 7702456459723833364 }]) test(`invalid original comment blocks POST ${JSON.stringify(wrong)}`, async () => {
  const { api, calls } = fake([ok({ comment: wrong })])
  const result = await createLarkComment(api, { task, text: 'body', reply_to_comment_id: '123' })
  assert.equal(result.ok, false)
  assert.equal(result.unknownDelivery, false)
  assert.equal(writes(calls).length, 0)
})
for (const wrong of [comment('457'), comment('456', { resource_id: 'foreign' }), comment('456', { reply_to_comment_id: '999' })]) test(`invalid v2 verification after real mention stays unknown ${JSON.stringify(wrong)}`, async () => {
  const { api, calls } = fake([ok({ comment: comment() }), ok({ comment: { id: '456', parent_id: '123' } }), ok({ comment: wrong })])
  const result = await createLarkComment(api, { task, text: 'body', reply_to_comment_id: '123', mentions: ['ou_self'], mentionMode: 'task-v1' })
  assert.equal(result.ok, false)
  assert.equal(result.unknownDelivery, true)
  assert.equal(writes(calls).length, 1)
})

test('comments honor desc/starting page_token, normalize stable IDs, retain content and deduplicate full pagination', async () => {
  const large = '7702456459723833364'
  const { api, calls } = fake([page([comment(123, { created_at: 1700000000000 }), comment(large)], true, 'next /&'), page([comment('123'), comment(large), comment('456')])])
  const result = await listLarkComments(api, { op: 'task_comments', task, direction: 'desc', page_token: 'start /&', max_pages: 2 })
  assert.equal(result.ok, true)
  assert.equal(result.incomplete, false)
  assert.equal(result.has_more, false)
  assert.equal(result.page_token, '')
  assert.equal(result.pageToken, '')
  assert.equal(result.pages, 2)
  assert.deepEqual(result.items.map(item => item.id), ['123', large, '456'])
  assert.equal(result.items[0].content, '原评论内容')
  assert.equal(result.items[0].created_at, '1700000000000')
  assert.deepEqual(calls[0].params, { resource_type: 'task', resource_id: task, page_size: 50, user_id_type: 'open_id', direction: 'desc', page_token: 'start /&' })
  assert.equal(calls[1].params.page_token, 'next /&')
})
test('max_pages cap returns snake-case continuation and partial data for resume', async () => {
  const { api, calls } = fake([page([comment()], true, 'resume')])
  const result = await listLarkComments(api, { op: 'task_comments', task, max_pages: 1 })
  assert.equal(result.ok, false)
  assert.equal(result.incomplete, true)
  assert.equal(result.has_more, true)
  assert.equal(result.page_token, 'resume')
  assert.equal(result.pageToken, 'resume')
  assert.equal(result.pages, 1)
  assert.equal(result.items.length, 1)
  assert.equal(calls.length, 1)
})
for (const limit of [undefined, 100]) test(`comment page bound ${limit ?? 'default20'} is respected`, async () => {
  let calls = 0
  const result = await listLarkComments(async () => page([], true, String(++calls)), { op: 'task_comments', task, ...(limit === undefined ? {} : { max_pages: limit }) })
  assert.equal(result.ok, false)
  assert.equal(result.incomplete, true)
  assert.equal(result.page_token, String(calls))
  assert.equal(calls, limit ?? 20)
})
for (const extra of [{ max_pages: 0 }, { max_pages: 101 }, { max_pages: 1.5 }, { max_pages: true }, { max_pages: '2' }, { max_pages: null }, { direction: 'sideways' }, { direction: null }, { page_token: 1 }, { page_token: false }, { page_token: ' ' }, { task: 12 }]) test(`invalid comment list input fails without fakeAPI ${JSON.stringify(extra)}`, async () => {
  const { api, calls } = fake()
  const result = await listLarkComments(api, { op: 'task_comments', task, ...extra })
  assert.equal(result.ok, false)
  assert.equal(result.incomplete, true)
  assert.equal(calls.length, 0)
})
test('starting cursor is part of cycle detection, so it is never fetched twice', async () => {
  const { api, calls } = fake([page([comment()], true, 'start')])
  const result = await listLarkComments(api, { op: 'task_comments', task, page_token: 'start' })
  assert.equal(result.ok, false)
  assert.match(result.error, /循环/)
  assert.equal(calls.length, 1)
})
for (const response of [page([comment()], true, ' '), page([comment()], true, 1), page(Array.from({ length: 51 }, (_, i) => comment(String(i + 1)))), page([comment('123', { resource_id: 'foreign' })]), page([comment(7702456459723833364)]), page([comment('123', { updated_at: false })]), new Error('GET timeout')]) test(`bad comment page is incomplete ${JSON.stringify(response)}`, async () => {
  const { api, calls } = fake([response])
  const result = await listLarkComments(api, { op: 'task_comments', task })
  assert.equal(result.ok, false)
  assert.equal(result.incomplete, true)
  assert.equal(writes(calls).length, 0)
})
test('listing tolerates omitted resource metadata as main but normalizes IDs', async () => {
  const { api } = fake([page([{ id: 123, content: 'original' }])])
  const result = await listLarkComments(api, { op: 'task_comments', task })
  assert.equal(result.ok, true)
  assert.deepEqual(result.items, [{ id: '123', content: 'original' }])
})

test('generic list reader honors starting cursor and returns continuation on cap', async () => {
  const { api, calls } = fake([page([{ guid: 'one' }], true, 'next')])
  const result = await listLarkPages(api, '/tasks', { page_token: 'start', page_size: 1 }, row => Boolean(row.guid), 1)
  assert.equal(result.ok, false)
  assert.equal(result.incomplete, true)
  assert.equal(result.page_token, 'next')
  assert.equal(result.has_more, true)
  assert.equal(result.pages, 1)
  assert.equal(calls[0].params.page_token, 'start')
})
test('generic reader detects initial-token cycle without repeat fetch', async () => {
  const { api, calls } = fake([page([], true, 'start')])
  const result = await listLarkPages(api, '/tasks', { page_token: 'start' })
  assert.equal(result.ok, false)
  assert.equal(calls.length, 1)
})
for (const [params, maxPages] of [[null, 1], [[], 1], [{ page_token: 123 }, 1], [{ page_token: ' ' }, 1], [{ page_size: 0 }, 1], [{}, 0], [{}, true]]) test('generic reader invalid inputs make no request', async () => {
  const { api, calls } = fake()
  assert.equal((await listLarkPages(api, '/tasks', params, () => true, maxPages)).ok, false)
  assert.equal(calls.length, 0)
})
test('generic list reader returns partial receipt when later API throws', async () => {
  const { api } = fake([page([{ guid: 'one' }], true, 'next'), new Error('timeout')])
  const result = await listLarkPages(api, '/tasks')
  assert.equal(result.ok, false)
  assert.equal(result.incomplete, true)
  assert.equal(result.page_token, 'next')
  assert.equal(result.items.length, 1)
})
