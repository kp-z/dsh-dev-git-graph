import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createLarkTasklistActions } from '../larkTasklist.js'

const ROOT = '/open-apis/task/v2'
const ok = data => ({ ok: true, data })
const page = (items = [], has_more = false, page_token) => ok({ items, has_more, ...(page_token !== undefined ? { page_token } : {}) })
const field = (extra = {}) => ({ guid: 'field-1', name: 'Priority', type: 'single_select', single_select_setting: { options: [{ guid: 'p0', name: 'P0' }] }, ...extra })
const ensure = extra => ({ op: 'ensure_custom_field', tasklist: 'list-1', name: 'Priority', type: 'single_select', options: ['P0'], ...extra })
const set = extra => ({ op: 'set_custom_field', tasklist: 'list-1', task: 'task/1', name: 'Priority', value: 'P0', ...extra })
function fake(responses) {
  const calls = []
  const run = createLarkTasklistActions(async (method, path, options) => {
    calls.push({ method, path, ...structuredClone(options) })
    assert.ok(path.startsWith('/open-apis/'))
    assert.equal(options.timeoutMs, 60_000)
    assert.ok(responses.length, `Unexpected request ${method} ${path}`)
    const reply = responses.shift()
    if (reply instanceof Error) throw reply
    return typeof reply === 'function' ? reply(calls.at(-1)) : structuredClone(reply)
  })
  return { run, calls, remaining: responses }
}
const writes = calls => calls.filter(call => call.method !== 'GET')

// No missing/partial page can ever be interpreted as an empty authoritative list.
for (const [label, data] of [
  ['missing has_more', { items: [] }], ['string has_more', { items: [], has_more: 'false' }],
  ['missing items', { has_more: false }], ['null items', { items: null, has_more: false }],
  ['invalid item', { items: [{ guid: 'x' }], has_more: false }],
  ['missing cursor', { items: [], has_more: true }], ['blank cursor', { items: [], has_more: true, page_token: ' ' }],
]) {
  test(`tasklist fails closed: ${label}`, async () => {
    const { run, calls } = fake([ok(data)])
    const result = await run({ op: 'ensure_tasklist', name: 'Managed' })
    assert.equal(result.ok, false)
    assert.equal(result.unknownDelivery, false)
    assert.equal(writes(calls).length, 0)
  })
  test(`field ensure/set fail closed: ${label}`, async () => {
    for (const action of [ensure(), set()]) {
      const { run, calls } = fake([ok(data)])
      assert.equal((await run(action)).ok, false)
      assert.equal(writes(calls).length, 0)
    }
  })
}

test('complete paginated tasklist lookup, never stop at first name', async () => {
  const { run, calls } = fake([page([{ guid: 'a', name: 'Other' }], true, 'next /'), page([{ guid: 'b', name: 'Managed' }])])
  const result = await run({ op: 'ensure_tasklist', name: 'Managed' })
  assert.equal(result.ok, true)
  assert.equal(result.guid, 'b')
  assert.equal(result.created, false)
  assert.deepEqual(calls[0].params, { user_id_type: 'open_id', page_size: 100 })
  assert.equal(calls[1].params.page_token, 'next /')
  assert.equal(writes(calls).length, 0)
})
test('duplicate tasklist name on later page rejects without create', async () => {
  const { run, calls } = fake([page([{ guid: 'a', name: 'Managed' }], true, 'next'), page([{ guid: 'b', name: 'Managed' }])])
  assert.equal((await run({ op: 'ensure_tasklist', name: 'Managed' })).ok, false)
  assert.equal(writes(calls).length, 0)
})
test('matched first page does not hide malformed second page', async () => {
  const { run, calls } = fake([page([{ guid: 'a', name: 'Managed' }], true, 'next'), ok({ items: [] })])
  assert.equal((await run({ op: 'ensure_tasklist', name: 'Managed' })).ok, false)
  assert.equal(writes(calls).length, 0)
})
test('repeated cursor fails closed', async () => {
  const { run, calls } = fake([page([], true, 'same'), page([], true, 'same')])
  assert.match((await run({ op: 'ensure_tasklist', name: 'Managed' })).error, /repeated cursor/)
  assert.equal(calls.length, 2)
})
test('pagination has a hard upper bound', async () => {
  let count = 0
  const run = createLarkTasklistActions(async method => {
    assert.equal(method, 'GET')
    return page([], true, String(++count))
  })
  assert.match((await run({ op: 'ensure_tasklist', name: 'Managed' })).error, /limit exceeded/)
  assert.equal(count, 1000)
})
test('provided tasklist GUID uses exact GET receipt, not a name fallback', async () => {
  for (const receipt of [{ guid: 'different', name: 'Managed' }, undefined]) {
    const { run, calls } = fake([ok({ tasklist: receipt })])
    const result = await run({ op: 'ensure_tasklist', guid: 'list/1', name: 'Managed' })
    assert.equal(result.ok, false)
    assert.equal(calls.length, 1)
    assert.equal(calls[0].path, `${ROOT}/tasklists/list%2F1`)
  }
  const { run } = fake([ok({ tasklist: { guid: 'list-1', name: 'Renamed' } })])
  assert.equal((await run({ op: 'ensure_tasklist', guid: 'list-1', name: 'Old' })).name, 'Renamed')
})
test('tasklist GET rejection has no create/name fallback', async () => {
  const { run, calls } = fake([{ ok: false, error: { code: 404, message: 'missing' } }])
  assert.equal((await run({ op: 'ensure_tasklist', guid: 'missing', name: 'Managed' })).ok, false)
  assert.equal(calls.length, 1)
})
test('create sends stable client_token, not create_token', async () => {
  const tokens = []
  for (let i = 0; i < 2; i++) {
    const { run, calls } = fake([page(), ok({ tasklist: { guid: 'created', name: 'Managed' } })])
    const result = await run({ op: 'ensure_tasklist', name: 'Managed', create_token: 'stable-token' })
    assert.equal(result.ok, true)
    assert.equal(result.created, true)
    assert.deepEqual(calls[1].data, { name: 'Managed', client_token: 'stable-token' })
    assert.deepEqual(calls[1].params, { user_id_type: 'open_id' })
    tokens.push(calls[1].data.client_token)
  }
  assert.equal(tokens[0], tokens[1])
})
test('fallback create token is stable across factories', async () => {
  const tokens = []
  for (let i = 0; i < 2; i++) {
    const { run, calls } = fake([page(), ok({ tasklist: { guid: 'created', name: 'Managed' } })])
    await run({ op: 'ensure_tasklist', name: 'Managed' })
    tokens.push(calls[1].data.client_token)
  }
  assert.ok(tokens[0])
  assert.equal(tokens[0], tokens[1])
})
for (const [label, receipt, unknown] of [
  ['empty success', ok({}), true], ['wrong name', ok({ tasklist: { guid: 'x', name: 'Other' } }), true],
  ['transport exception', new Error('timed out'), true], ['unstructured error', { ok: false, detail: 'CLI interrupted' }, true],
  ['server error', { ok: false, error: { code: 503, message: 'server error' } }, true],
  ['known rejection', { ok: false, error: { code: 403, message: 'forbidden' } }, false],
]) {
  test(`tasklist uncertain delivery: ${label}`, async () => {
    const { run, calls } = fake([page(), receipt])
    const result = await run({ op: 'ensure_tasklist', name: 'Managed', create_token: 'stable' })
    assert.equal(result.ok, false)
    assert.equal(result.created, false)
    assert.equal(result.unknownDelivery, unknown)
    assert.equal(writes(calls).length, 1)
  })
}
test('uncertain create is reconciled by full reads, never blindly posted again', async () => {
  const { run, calls } = fake([page(), ok({}), page(), page([{ guid: 'found', name: 'Managed' }])])
  const action = { op: 'ensure_tasklist', name: 'Managed', create_token: 'stable' }
  assert.equal((await run(action)).unknownDelivery, true)
  assert.equal((await run(action)).unknownDelivery, true)
  assert.equal((await run(action)).guid, 'found')
  assert.equal(writes(calls).length, 1)
})
test('known create rejection allows another authoritative lookup and same token', async () => {
  const { run, calls } = fake([page(), { ok: false, error: { code: 403 } }, page(), ok({ tasklist: { guid: 'x', name: 'Managed' } })])
  const action = { op: 'ensure_tasklist', name: 'Managed', create_token: 'stable' }
  assert.equal((await run(action)).unknownDelivery, false)
  assert.equal((await run(action)).ok, true)
  assert.equal(calls[1].data.client_token, calls[3].data.client_token)
})

test('duplicate custom field names across pages reject ensure and set', async () => {
  for (const action of [ensure(), set()]) {
    const { run, calls } = fake([page([field()], true, 'next'), page([field({ guid: 'field-2' })])])
    assert.equal((await run(action)).ok, false)
    assert.equal(writes(calls).length, 0)
  }
})
test('field type mismatch never mutates', async () => {
  for (const action of [ensure(), set({ expected_type: 'single_select' })]) {
    const { run, calls } = fake([page([field({ type: 'text' })])])
    assert.equal((await run(action)).ok, false)
    assert.equal(writes(calls).length, 0)
  }
})
test('accepted_types reuses legacy text without coercion or option mutation', async () => {
  const { run, calls } = fake([page([field({ type: 'text' })])])
  const result = await run(ensure({ accepted_types: ['text', 'single_select', 'multi_select'] }))
  assert.equal(result.ok, true)
  assert.equal(result.type, 'text')
  assert.equal(result.guid, 'field-1')
  assert.equal(writes(calls).length, 0)
})
test('invalid accepted_types reject before reads', async () => {
  for (const accepted_types of ['text', [], ['number']]) {
    const { run, calls } = fake([])
    assert.equal((await run(ensure({ accepted_types }))).ok, false)
    assert.equal(calls.length, 0)
  }
})
test('legacy multi-select accepted type appends using actual type', async () => {
  const before = field({ type: 'multi_select', multi_select_setting: { options: [{ guid: 'p0', name: 'P0' }] } })
  const after = { ...before, multi_select_setting: { options: [...before.multi_select_setting.options, { guid: 'p1', name: 'P1' }] } }
  const { run, calls } = fake([page([before]), ok({ custom_field: after })])
  assert.equal((await run(ensure({ options: ['P1'], accepted_types: ['multi_select'] }))).ok, true)
  assert.deepEqual(calls[1].data.update_fields, ['multi_select_setting'])
})
test('select completion preserves GUIDs, hidden legacy entries and setting metadata', async () => {
  const options = [{ guid: 'p0', name: 'P0', color_index: 4 }, { guid: 'old', name: 'Old', is_hidden: true, color_index: 2 }, { guid: 'blank', name: '', is_hidden: true }]
  const before = field({ single_select_setting: { options, unrelated_setting: 'preserved' } })
  const after = field({ single_select_setting: { options: [...options, { guid: 'p1', name: 'P1' }] } })
  const { run, calls } = fake([page([before]), ok({ custom_field: after })])
  const result = await run(ensure({ options: ['P0', 'P1', 'Old'] }))
  assert.equal(result.ok, true)
  assert.deepEqual(result.added, ['P1'])
  assert.equal(result.warnings.length, 1)
  assert.deepEqual(calls[1].data.custom_field.single_select_setting, { options: [...options, { name: 'P1' }], unrelated_setting: 'preserved' })
})
test('ensure warns on duplicate/hidden legacy option names without silently recreating them', async () => {
  const before = field({ single_select_setting: { options: [{ guid: 'a', name: 'P0' }, { guid: 'b', name: 'P0' }, { guid: 'c', name: 'Old', is_hidden: true }] } })
  const { run, calls } = fake([page([before])])
  const result = await run(ensure({ options: ['P0', 'Old'] }))
  assert.equal(result.ok, true)
  assert.equal(result.warnings.length, 2)
  assert.equal(writes(calls).length, 0)
})
for (const [label, options] of [
  ['duplicate visible', [{ guid: 'a', name: 'P0' }, { guid: 'b', name: 'P0' }]],
  ['hidden only', [{ guid: 'a', name: 'P0', is_hidden: true }]],
  ['hidden plus visible', [{ guid: 'a', name: 'P0' }, { guid: 'b', name: 'P0', is_hidden: true }]],
  ['duplicate GUID', [{ guid: 'a', name: 'P0' }, { guid: 'a', name: 'Other' }]],
  ['missing GUID', [{ name: 'P0' }]],
]) {
  test(`set rejects ${label} options with no mutation`, async () => {
    const { run, calls } = fake([page([field({ single_select_setting: { options } })])])
    assert.equal((await run(set())).ok, false)
    assert.equal(writes(calls).length, 0)
  })
}
test('multi-select resolves all values before any option completion', async () => {
  const before = field({ type: 'multi_select', multi_select_setting: { options: [{ guid: 'a', name: 'Old', is_hidden: true }] } })
  const { run, calls } = fake([page([before])])
  assert.equal((await run(set({ value: ['New', 'Old'] }))).ok, false)
  assert.equal(writes(calls).length, 0)
})
test('field GUID targeting is exact and name/type must agree', async () => {
  for (const extra of [{ field_guid: 'missing' }, { field_guid: 'field-1', name: 'Other' }, { field_guid: 'field-1', expected_type: 'text' }]) {
    const { run, calls } = fake([page([field()])])
    assert.equal((await run(set(extra))).ok, false)
    assert.equal(writes(calls).length, 0)
  }
})
test('set lookup reads complete pages and sends documented task PATCH', async () => {
  const { run, calls } = fake([page([], true, 'next'), page([field()]), ok({})])
  const result = await run(set({ field_guid: 'field-1', expected_type: 'single_select' }))
  assert.equal(result.ok, true)
  assert.equal(result.guid, 'field-1')
  assert.equal(result.type, 'single_select')
  assert.equal(calls[2].path, `${ROOT}/tasks/task%2F1`)
  assert.deepEqual(calls[2].params, { user_id_type: 'open_id' })
  assert.deepEqual(calls[2].data, { task: { custom_fields: [{ guid: 'field-1', type: 'single_select', single_select_value: 'p0' }] }, update_fields: ['custom_fields'] })
})
test('set missing option appends safely, then resolves only verified GUID', async () => {
  const after = field({ single_select_setting: { options: [{ guid: 'p0', name: 'P0' }, { guid: 'p1', name: 'P1' }] } })
  const { run, calls } = fake([page([field()]), ok({ custom_field: after }), ok({})])
  assert.equal((await run(set({ value: 'P1' }))).ok, true)
  assert.equal(calls[2].data.task.custom_fields[0].single_select_value, 'p1')
})
test('unverified option PATCH never falls back to raw names or task write', async () => {
  for (const receipt of [ok({}), ok({ custom_field: field() }), ok({ custom_field: field({ guid: 'wrong' }) })]) {
    const { run, calls } = fake([page([field()]), receipt])
    const result = await run(set({ value: 'P1' }))
    assert.equal(result.ok, false)
    assert.equal(result.unknownDelivery, true)
    assert.equal(writes(calls).length, 1)
    assert.equal(calls[1].path, `${ROOT}/custom_fields/field-1`)
  }
})
test('option PATCH receipt must preserve hidden entries and original GUIDs', async () => {
  const before = field({ single_select_setting: { options: [{ guid: 'p0', name: 'P0' }, { guid: 'old', name: 'Old', is_hidden: true }] } })
  const after = field({ single_select_setting: { options: [{ guid: 'p0', name: 'P0' }, { guid: 'p1', name: 'P1' }] } })
  const { run } = fake([page([before]), ok({ custom_field: after })])
  const result = await run(ensure({ options: ['P1'] }))
  assert.equal(result.ok, false)
  assert.equal(result.unknownDelivery, true)
})
test('field creates require matching name/type and unique visible option receipt', async () => {
  for (const receipt of [ok({}), ok({ custom_field: field({ name: 'Other' }) }), ok({ custom_field: field({ type: 'text' }) }), ok({ custom_field: field({ single_select_setting: { options: [{ guid: 'a', name: 'P0', is_hidden: true }] } }) })]) {
    const { run, calls } = fake([page(), receipt])
    const result = await run(ensure())
    assert.equal(result.ok, false)
    assert.equal(result.created, false)
    assert.equal(result.unknownDelivery, true)
    assert.equal(writes(calls).length, 1)
  }
})
test('field create uses Python request settings for supported types', async () => {
  for (const type of ['text', 'datetime', 'single_select', 'multi_select']) {
    const target = field({ type, ...(type === 'multi_select' ? { multi_select_setting: { options: [{ guid: 'p0', name: 'P0' }] } } : {}) })
    const { run, calls } = fake([page(), ok({ custom_field: target })])
    const result = await run(ensure({ type }))
    assert.equal(result.ok, true)
    assert.equal(result.created, true)
    assert.deepEqual(calls[1].data, { resource_type: 'tasklist', resource_id: 'list-1', name: 'Priority', type,
      [`${type}_setting`]: type === 'text' ? {} : type === 'datetime' ? { format: 'yyyy-mm-dd' } : { options: [{ name: 'P0' }] } })
  }
})
test('uncertain field create cannot be blindly repeated', async () => {
  const { run, calls } = fake([page(), ok({}), page(), page([field()])])
  assert.equal((await run(ensure())).unknownDelivery, true)
  assert.equal((await run(ensure())).unknownDelivery, true)
  assert.equal((await run(ensure())).ok, true)
  assert.equal(writes(calls).length, 1)
})
test('failed ensure gates subsequent set in the same factory', async () => {
  const { run, calls } = fake([page([field({ type: 'text' })]), page([field({ type: 'text' })])])
  assert.equal((await run(ensure())).ok, false)
  const result = await run(set())
  assert.equal(result.ok, false)
  assert.equal(result.skipped, 'ensure_failed')
  assert.equal(writes(calls).length, 0)
})
test('datetime accepts exact valid UTC dates, not prefixes or rollover dates', async () => {
  for (const value of ['2026-02-29', '2026-02-30', '2026-13-01', '2026-01-01T12:00:00Z', '2026-01-01 extra', ' 2026-01-01', '0000-01-01', 1700000000000, null]) {
    const { run, calls } = fake([page([field({ type: 'datetime' })])])
    assert.equal((await run(set({ value }))).ok, false, String(value))
    assert.equal(writes(calls).length, 0)
  }
  const { run, calls } = fake([page([field({ type: 'datetime' })]), ok({})])
  assert.equal((await run(set({ value: '2024-02-29' }))).ok, true)
  assert.equal(calls[1].data.task.custom_fields[0].datetime_value, String(Date.parse('2024-02-29T00:00:00Z')))
})
test('text scalars preserve Python boolean/null semantics and reject objects/nonfinite numbers', async () => {
  for (const [value, expected] of [[true, 'True'], [false, 'False'], [null, ''], [12, '12']]) {
    const { run, calls } = fake([page([field({ type: 'text' })]), ok({})])
    assert.equal((await run(set({ value }))).ok, true)
    assert.equal(calls[1].data.task.custom_fields[0].text_value, expected)
  }
  for (const value of [{}, [], Infinity, NaN]) {
    const { run, calls } = fake([page([field({ type: 'text' })])])
    assert.equal((await run(set({ value }))).ok, false)
    assert.equal(writes(calls).length, 0)
  }
})
test('task PATCH transport failures remain unknown; structured rejection is known', async () => {
  for (const [receipt, unknown] of [[new Error('timeout'), true], [{ ok: false, error: { code: 403 } }, false]]) {
    const { run, calls } = fake([page([field()]), receipt])
    const result = await run(set())
    assert.equal(result.ok, false)
    assert.equal(result.unknownDelivery, unknown)
    assert.equal(writes(calls).length, 1)
  }
})
test('duplicate resource GUIDs across pages reject every writer', async () => {
  for (const action of [ensure(), set(), { op: 'ensure_tasklist', name: 'Managed' }]) {
    const isList = action.op === 'ensure_tasklist'
    const first = isList ? { guid: 'same', name: 'Managed' } : field()
    const second = { ...first, name: 'Other' }
    const { run, calls } = fake([page([first], true, 'next'), page([second])])
    assert.equal((await run(action)).ok, false)
    assert.equal(writes(calls).length, 0)
  }
})
test('oversized pages violate bounded reads and never reach writers', async () => {
  const rows = Array.from({ length: 101 }, (_, n) => ({ guid: `list-${n}`, name: 'Other' }))
  const { run, calls } = fake([page(rows)])
  assert.equal((await run({ op: 'ensure_tasklist', name: 'Managed' })).ok, false)
  assert.equal(writes(calls).length, 0)
})
test('changing token after uncertain create does not bypass reconciliation', async () => {
  const { run, calls } = fake([page(), ok({}), page()])
  assert.equal((await run({ op: 'ensure_tasklist', name: 'Managed', create_token: 'first' })).unknownDelivery, true)
  assert.equal((await run({ op: 'ensure_tasklist', name: 'Managed', create_token: 'different' })).unknownDelivery, true)
  assert.equal(writes(calls).length, 1)
})
test('unsupported operation is a structured failure with no I/O', async () => {
  const { run, calls } = fake([])
  const result = await run({ op: 'number_field' })
  assert.equal(result.ok, false)
  assert.equal(result.unknownDelivery, false)
  assert.equal(calls.length, 0)
})
