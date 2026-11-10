/**
 * 自定义目录（工作区分组）的纯函数测试。
 *
 * 这一层错了不会报错，只会「悄悄丢成员」或「把两个目录合并错」——
 * 所以逐条钉住：重名、单归属、坏行、已经消失的成员。
 *
 * 跑法：node test/workspaceGroups.mjs
 */
import assert from 'node:assert/strict'
import { normalizeGroups, applyGroupAction, projectGroups } from '../workspaceGroups.js'

let count = 0
function ok(label, fn) {
  fn()
  count += 1
  console.log(`✓ ${label}`)
}

const now = 1_800_000_000_000
let seq = 0
const makeId = () => `wg-test-${(seq += 1)}`
const act = (groups, input) => applyGroupAction(groups, input, { now, makeId })

ok('normalizeGroups：坏行丢掉，成员去重，labels 只留在场成员', () => {
  const rows = normalizeGroups([
    null,
    'nope',
    { id: '', name: '空 id' },
    { id: 'a', name: '  QV  ', members: ['k1', 'k1', '', 'k2'], labels: { k1: 'msim-qviz', k2: '', k9: '幽灵' }, createdAt: 5 },
    { id: 'a', name: '重号' },
  ])
  assert.equal(rows.length, 1)
  assert.equal(rows[0].name, 'QV')
  assert.deepEqual(rows[0].members, ['k1', 'k2'])
  assert.deepEqual(rows[0].labels, { k1: 'msim-qviz' })
  assert.equal(rows[0].createdAt, 5)
})

ok('normalizeGroups：非数组输入不抛，返回空数组', () => {
  assert.deepEqual(normalizeGroups(null), [])
  assert.deepEqual(normalizeGroups({ id: 'x' }), [])
  assert.deepEqual(normalizeGroups(undefined), [])
})

ok('create：需要名字，且重名被拒（大小写与空白无关）', () => {
  const bad = act([], { action: 'create', name: '   ' })
  assert.equal(bad.ok, false)
  assert.match(bad.error, /目录名/)
  const first = act([], { action: 'create', name: 'QV', members: ['k1'] })
  assert.equal(first.ok, true)
  assert.equal(first.groups.length, 1)
  assert.equal(first.group.id, 'wg-test-1')
  const dup = act(first.groups, { action: 'create', name: ' qv ' })
  assert.equal(dup.ok, false)
  assert.match(dup.error, /qv/i)
})

ok('单归属：把 k1 加进新目录时，会从旧目录里摘掉', () => {
  const a = act([], { action: 'create', name: 'A', members: ['k1', 'k2'] })
  const moved = act(a.groups, { action: 'create', name: 'B', members: ['k2'] })
  assert.equal(moved.ok, true)
  assert.deepEqual(moved.groups.find((g) => g.name === 'A').members, ['k1'])
  assert.deepEqual(moved.groups.find((g) => g.name === 'B').members, ['k2'])
  assert.equal(moved.groups.find((g) => g.name === 'A').labels.k2, undefined)
  /* add 也走同一条单归属规则 */
  const added = act(moved.groups, { action: 'add', id: moved.groups.find((g) => g.name === 'A').id, member: { key: 'k2', label: '前端' } })
  assert.equal(added.ok, true)
  assert.deepEqual(added.groups.find((g) => g.name === 'A').members, ['k1', 'k2'])
  assert.deepEqual(added.groups.find((g) => g.name === 'B').members, [])
  assert.equal(added.groups.find((g) => g.name === 'A').labels.k2, '前端')
})

ok('add：重复添加是幂等的，不产生重复成员', () => {
  const { groups } = act([], { action: 'create', name: 'A', members: ['k1'] })
  const twice = act(groups, { action: 'add', id: groups[0].id, member: 'k1' })
  assert.equal(twice.ok, true)
  assert.deepEqual(twice.groups[0].members, ['k1'])
})

ok('remove：不在目录里要报错，在的话摘掉并清 labels', () => {
  const { groups } = act([], { action: 'create', name: 'A', members: ['k1'], labels: { k1: 'qviz' } })
  const miss = act(groups, { action: 'remove', id: groups[0].id, key: 'k9' })
  assert.equal(miss.ok, false)
  const hit = act(groups, { action: 'remove', id: groups[0].id, key: 'k1' })
  assert.equal(hit.ok, true)
  assert.deepEqual(hit.groups[0].members, [])
  assert.deepEqual(hit.groups[0].labels, {})
})

ok('update：可以整体替换成员 + 改名；空名字与重名被拒', () => {
  let groups = act([], { action: 'create', name: 'A', members: ['k1'] }).groups
  groups = act(groups, { action: 'create', name: 'B', members: ['k2'] }).groups
  const a = groups.find((g) => g.name === 'A')
  const b = groups.find((g) => g.name === 'B')
  const renamed = act(groups, { action: 'update', id: a.id, name: 'QV 后端', members: ['k1', 'k3'], labels: { k3: 'scenepack' } })
  assert.equal(renamed.ok, true)
  const qv = renamed.groups.find((g) => g.id === a.id)
  assert.equal(qv.name, 'QV 后端')
  assert.deepEqual(qv.members, ['k1', 'k3'])
  assert.equal(qv.labels.k3, 'scenepack')
  assert.equal(act(renamed.groups, { action: 'update', id: a.id, name: '' }).ok, false)
  assert.equal(act(renamed.groups, { action: 'update', id: b.id, name: 'QV 后端' }).ok, false)
  assert.equal(act(renamed.groups, { action: 'update', id: 'nope', name: 'x' }).ok, false)
})

ok('update：成员替换也会维护单归属（把别人的成员拿走）', () => {
  let groups = act([], { action: 'create', name: 'A', members: ['k1', 'k2'] }).groups
  groups = act(groups, { action: 'create', name: 'B', members: ['k3'] }).groups
  const b = groups.find((g) => g.name === 'B')
  const out = act(groups, { action: 'update', id: b.id, members: ['k3', 'k2'] })
  assert.equal(out.ok, true)
  assert.deepEqual(out.groups.find((g) => g.name === 'A').members, ['k1'])
  assert.deepEqual(out.groups.find((g) => g.name === 'B').members, ['k3', 'k2'])
})

ok('delete：目录消失，成员回到未分组（不出现在任何目录里）', () => {
  const { groups } = act([], { action: 'create', name: 'A', members: ['k1'] })
  const gone = act(groups, { action: 'delete', id: groups[0].id })
  assert.equal(gone.ok, true)
  assert.deepEqual(gone.groups, [])
  assert.equal(gone.group.members.length, 1)
  assert.equal(act([], { action: 'delete', id: 'nope' }).ok, false)
})

ok('未知 action 与坏输入都返回错误而不是抛', () => {
  assert.equal(act([], { action: 'frobnicate' }).ok, false)
  assert.equal(applyGroupAction([], null, { now }).ok, false)
  assert.equal(applyGroupAction([], [], { now }).ok, false)
  assert.equal(act([], { action: 'create', name: 'A', members: 'k1' }).groups[0].members.length, 0)
})

ok('create 的 id 可显式指定；重复 id 被拒', () => {
  const { groups } = act([], { action: 'create', id: 'custom-1', name: 'A' })
  assert.equal(groups[0].id, 'custom-1')
  assert.equal(act(groups, { action: 'create', id: 'custom-1', name: 'B' }).ok, false)
})

ok('输入不被改写（纯函数）', () => {
  const input = [{ id: 'a', name: 'QV', members: ['k1'] }]
  const snapshot = JSON.stringify(input)
  act(input, { action: 'add', id: 'a', member: 'k2' })
  assert.equal(JSON.stringify(input), snapshot)
})

ok('projectGroups：统计在场成员数，按总览页同一套 workspace key', () => {
  const groups = [{ id: 'a', name: 'QV', members: ['/p/qviz', 'id-2', 'name:前端', 'gone'], labels: { '/p/qviz': 'qviz' } }]
  const tasks = [
    { id: 't1', workspacePath: '/p/qviz' },
    { id: 't2', workspaceId: 'id-2' },
    { id: 't3', workspaceTitle: '前端' },
    { id: 't4' },
  ]
  const rows = projectGroups(groups, tasks)
  assert.equal(rows.length, 1)
  assert.equal(rows[0].presentMembers, 3)
  assert.deepEqual(rows[0].members, ['/p/qviz', 'id-2', 'name:前端', 'gone'])
  assert.deepEqual(projectGroups(null, tasks), [])
  assert.deepEqual(projectGroups(groups, null)[0].presentMembers, 0)
})

console.log(`\nWORKSPACE_GROUPS_OK：${count} 组断言通过`)
