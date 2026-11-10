import assert from 'node:assert/strict'
import { createTaskMentionResolver } from '../taskMentions.js'

const follower = (id, name, extra = {}) => ({ id, name, type: 'user', role: 'follower', ...extra })
const baseMembers = [follower('ou_Alice', '张三'), follower('ou_Bob', '李四')]
function harness(members = baseMembers, options = {}) {
  let time = 1000, count = 0
  const resolver = createTaskMentionResolver({ now: () => time, randomId: () => `opaque${++count}`, ttlMs: 100, ...options })
  const context = { taskId: 'task-1', sessionId: 'session-1', scope: 'host-account-generation-1', members }
  return { resolver, context, setTime(value) { time = value },
    resolve(names, extra = {}) { return resolver.resolve({ ...context, names, ...extra }) },
    validate(mentionRefs, extra = {}) { return resolver.validate({ ...context, mentionRefs, ...extra }) } }
}
const refsOf = result => result.targets.flatMap(target => target.candidates.map(candidate => candidate.mentionRef))
function rejected(result, status) {
  assert.equal(result.ok, false)
  assert.deepEqual(result.mentionIds, [], 'failure never exposes partially validated IDs')
  if (status) assert.equal(result.status, status)
}

// Exact names, explicit same-account self mention, stable output and caller-selected refs.
{
  const h = harness(), result = h.resolve(['张三', '李四'])
  assert.equal(result.ok, true); assert.equal(result.status, 'matched'); assert.equal(result.taskId, 'task-1')
  assert.deepEqual(result.targets.map(t => [t.query, t.status]), [['张三', 'matched'], ['李四', 'matched']])
  assert.deepEqual(result.targets[0].candidates[0].name, '张三')
  assert.equal(result.targets[0].candidates[0].role, 'follower')
  assert.deepEqual(h.validate(refsOf(result)), { ok: true, mentionIds: ['ou_Alice', 'ou_Bob'] })
  const self = h.resolve(['张三'], { members: [follower('ou_Alice', '张三', { isSelf: true })] })
  assert.equal(self.ok, true, 'self is not excluded if an explicit user follower')
  assert.deepEqual(h.validate(refsOf(self)), { ok: true, mentionIds: ['ou_Alice'] })
  rejected(h.validate(['ou_Alice']), 'invalid_reference')
}
// Normalization is matching only, with no fuzzy or substring selection.
{
  const h = harness([follower('ou_A', ' Ａlice\tSmith '), follower('ou_B', 'é')])
  assert.equal(h.resolve(['  ＠Ａlice\u3000 Smith ']).ok, true)
  assert.equal(h.resolve(['e\u0301']).ok, true)
  for (const name of ['Alice', 'alice Smith', 'Smith', '@Alice Smith extra']) {
    assert.equal(h.resolve([name]).status, 'missing')
  }
  for (const names of [[], [' '], ['@'], ['@@Alice Smith'], ['＠＠Alice Smith'], [42], null, '张三', Array(1), Array(6).fill('张三')]) {
    assert.equal(h.resolve(names).status, 'invalid_input')
  }
}
// Ambiguous and missing targets must remain explicit, even alongside a unique match.
{
  const h = harness([follower('ou_A', '同名'), follower('ou_B', '同名'), follower('ou_C', '唯一')])
  const result = h.resolve(['同名', '不存在', '唯一'])
  assert.equal(result.ok, false); assert.equal(result.status, 'mixed')
  assert.deepEqual(result.targets.map(t => t.status), ['ambiguous', 'missing', 'matched'])
  assert.equal(result.targets[0].candidates.length, 2)
  const explicit = result.targets[0].candidates[1].mentionRef
  assert.deepEqual(h.validate([explicit]), { ok: true, mentionIds: ['ou_B'] }, 'explicit ambiguous candidate can be selected')
}
// Nameless members list safely; omission, null and blank name are never name matches.
{
  const h = harness([follower('ou_A'), follower('ou_B', null), follower('ou_C', '  ')])
  const result = h.resolve()
  assert.equal(result.ok, true); assert.equal(result.status, 'candidates')
  assert.deepEqual(result.candidates, result.targets[0].candidates)
  assert.deepEqual(result.candidates.map(c => c.name), [null, null, '  '])
  assert.equal(h.resolve(['undefined']).status, 'missing')
  assert.equal(h.resolve(['null']).status, 'missing')
  assert.deepEqual(h.validate(refsOf(result)), { ok: true, mentionIds: ['ou_A', 'ou_B', 'ou_C'] })
  assert.deepEqual(h.resolve(undefined, { members: [] }).candidates, [])
}
// Explicit type and role plus strict open_id are mandatory; duplicates cannot smuggle conflicts.
{
  const bad = [
    follower('on_A', 'bad'), follower('ou_', 'bad'), follower('ou_A-B', 'bad'), follower('ou_A\n', 'bad'),
    follower(' ou_A', 'bad'), follower('ou_中', 'bad'), follower(123, 'bad'),
    follower('ou_App', 'bad', { type: 'app' }), follower('ou_U', 'bad', { type: undefined }),
    follower('ou_Assignee', 'bad', { role: 'assignee' }), follower('ou_R', 'bad', { role: undefined }),
    follower('ou_NameType', 123), null,
  ]
  const h = harness(bad)
  assert.deepEqual(h.resolve().candidates, [])
  for (const conflict of [
    { type: 'app' }, { type: undefined }, { role: 'assignee' }, { role: undefined }, { name: 'other' }, { name: undefined },
  ]) {
    for (const reversed of [false, true]) {
      const members = [follower('ou_A', 'safe'), follower('ou_A', 'safe', conflict)]
      if (reversed) members.reverse()
      assert.deepEqual(h.resolve(undefined, { members }).candidates, [], 'conflicting ID rejected independent of row order')
    }
  }
  const duplicates = harness([follower('ou_A', 'safe'), follower('ou_A', 'safe')])
  const result = duplicates.resolve(['safe', 'safe'])
  assert.equal(duplicates.resolve().candidates.length, 1)
  assert.equal(new Set(refsOf(result)).size, 1)
  assert.deepEqual(duplicates.validate(refsOf(result)), { ok: true, mentionIds: ['ou_A'] })
}
// Context fencing and strict expiry, clock rollback, malformed clock and restart invalidation.
{
  const h = harness(), ref = refsOf(h.resolve(['张三']))[0]
  for (const extra of [{ taskId: 'task-2' }, { sessionId: 'session-2' }, { scope: 'host-account-generation-2' }]) {
    rejected(h.validate([ref], extra), 'scope_mismatch')
  }
  h.setTime(1099); assert.equal(h.validate([ref]).ok, true)
  h.setTime(1100); rejected(h.validate([ref]), 'invalid_reference')
  const fresh = refsOf(h.resolve(['张三']))[0]
  h.setTime(1099); rejected(h.validate([fresh]), 'invalid_reference')
  const broken = harness(baseMembers, { now: () => NaN })
  assert.equal(broken.resolve(['张三']).status, 'invalid_clock')
  rejected(broken.validate([ref]), 'invalid_clock')
  const restarted = harness()
  rejected(restarted.validate([ref]), 'invalid_reference')
  assert.notEqual(refsOf(restarted.resolve(['张三']))[0], ref)
}
// Fresh remote membership is authoritative; exact rename invalidates even if normalized equivalent.
{
  const h = harness(), refs = refsOf(h.resolve(['张三', '李四']))
  for (const members of [
    [baseMembers[0]],
    [baseMembers[0], follower('ou_Bob', 'new')],
    [baseMembers[0], follower('ou_Bob', ' 李四 ')],
    [baseMembers[0], follower('ou_Bob', '李四', { role: 'assignee' })],
    [baseMembers[0], follower('ou_Bob', '李四', { type: 'app' })],
    [...baseMembers, follower('ou_Bob', '李四', { type: 'app' })],
  ]) {
    rejected(h.validate(refs, { members }), 'member_changed')
    rejected(h.validate([...refs].reverse(), { members }), 'member_changed')
  }
  assert.deepEqual(h.validate(refs, { members: [...baseMembers].reverse() }), { ok: true, mentionIds: ['ou_Alice', 'ou_Bob'] })
  rejected(h.validate([refs[0], 'forged']), 'invalid_reference')
  const nameless = harness([follower('ou_A')]), namelessRef = refsOf(nameless.resolve())[0]
  rejected(nameless.validate([namelessRef], { members: [follower('ou_A', 'new')] }), 'member_changed')
}
// Five targets are allowed and output mutation cannot rewrite a stored recipient.
{
  const members = Array.from({ length: 5 }, (_, i) => follower(`ou_Five${i}`, `name ${i}`))
  const h = harness(members), before = structuredClone(members)
  const result = h.resolve(members.map(member => member.name)), refs = refsOf(result)
  assert.equal(result.ok, true)
  result.targets[0].candidates[0].openId = 'ou_Forged'
  result.targets[0].candidates[0].name = 'forged'
  assert.deepEqual(h.validate(refs), { ok: true, mentionIds: members.map(member => member.id) })
  assert.deepEqual(members, before, 'resolution never mutates remote members')
}
// Invalid inputs and sparse arrays fail closed, without accidental String coercion.
{
  const h = harness(), ref = refsOf(h.resolve(['张三']))[0]
  for (const extra of [{ taskId: '' }, { sessionId: ' ' }, { scope: 1 }, { members: null }, { members: {} }]) {
    assert.equal(h.resolve(['张三'], extra).status, 'invalid_input')
    rejected(h.validate([ref], extra), 'invalid_input')
  }
  for (const mentionRefs of [[], Array(1), [null], [42], [''], Array(6).fill(ref), ref, null]) {
    rejected(h.validate(mentionRefs), 'invalid_input')
  }
  assert.equal(h.resolver.resolve(null).ok, false)
  rejected(h.resolver.validate(null), 'invalid_input')
  for (const ttlMs of [0, -1, Infinity, NaN, '100']) {
    assert.throws(() => createTaskMentionResolver({ ttlMs }), TypeError)
  }
}
// References remain unique with a broken repeating injected RNG and never include identity fields.
{
  const h = harness(baseMembers, { randomId: () => 'repeat' })
  const first = refsOf(h.resolve(['张三']))[0], second = refsOf(h.resolve(['张三']))[0]
  assert.notEqual(first, second)
  assert.ok(!first.includes('ou_Alice')); assert.ok(!first.includes('task-1')); assert.ok(!first.includes('session-1'))
  for (const randomId of [() => '', () => 123, () => { throw Error('rng') }]) {
    const broken = harness(baseMembers, { randomId })
    assert.equal(broken.resolve(['张三']).status, 'reference_error')
  }
}
// FIFO hard bound, expiry pruning and oversized candidate lists never return dead refs.
{
  const h = harness(), first = refsOf(h.resolve(['张三']))[0]
  for (let i = 0; i < 1023; i++) h.resolve(['张三'])
  assert.equal(h.validate([first]).ok, true)
  const newest = refsOf(h.resolve(['张三']))[0]
  rejected(h.validate([first]), 'invalid_reference')
  assert.equal(h.validate([newest]).ok, true)
  const many = Array.from({ length: 1025 }, (_, i) => follower(`ou_User${i}`, `user ${i}`))
  assert.equal(h.resolve(undefined, { members: many }).status, 'capacity')
  const targeted = h.resolve(['user 1024'], { members: many })
  assert.equal(targeted.ok, true)
  assert.deepEqual(h.validate(refsOf(targeted), { members: many }), { ok: true, mentionIds: ['ou_User1024'] })
  h.setTime(1100); rejected(h.validate([newest]), 'invalid_reference')
  assert.equal(h.resolve(['张三']).ok, true)
}
console.log('TASK_MENTIONS_OK: exact/normalized names, ambiguity, nameless/self, strict identity, scoped TTL refs, fresh members, atomic validation and bounded cache')
