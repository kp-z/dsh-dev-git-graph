import assert from 'node:assert/strict'
import { updateRelations, projectRelations, relationStats } from '../relations.js'

let checks = 0
function test(name, run) {
  run()
  checks += 1
  console.log(`✓ ${name}`)
}
const tasks = [
  { id: 'a', title: 'A', done: false },
  { id: 'b', title: 'B', done: false },
  { id: 'c', title: 'C', done: true },
  { id: 'd', title: 'D', done: false },
]
const base = { taskId: 'b', mode: 'merge', source: 'manual' }
const edge = (from, to, kind = 'depends_on', extra = {}) => ({ from, to, kind, source: 'ai', reason: 'original', createdAt: 10, sessionId: 'old-session', ...extra })
const update = (edges, input, options = { now: 100 }) => updateRelations(edges, tasks, { ...base, ...input }, options)
const ids = (summaries) => summaries.map((item) => item.id)

test('merge builds all directions and preserves source/reason/session/time', () => {
  const result = update([], { predecessorIds: ['a', 'a'], successorIds: ['d'], sourceTaskIds: ['c'], source: 'creation', reason: 'created from C', sessionId: 'new-session' })
  assert.equal(result.ok, true)
  assert.deepEqual(result.edges, [
    edge('a', 'b', 'depends_on', { source: 'creation', reason: 'created from C', createdAt: 100, sessionId: 'new-session' }),
    edge('b', 'd', 'depends_on', { source: 'creation', reason: 'created from C', createdAt: 100, sessionId: 'new-session' }),
    edge('c', 'b', 'derived_from', { source: 'creation', reason: 'created from C', createdAt: 100, sessionId: 'new-session' }),
  ])
})

test('duplicates are idempotent in merge and replace, retaining original object metadata', () => {
  const original = Object.freeze(edge('a', 'b'))
  for (const mode of ['merge', 'replace']) {
    const result = update(Object.freeze([original]), { mode, predecessorIds: ['a', 'a'], source: 'manual', reason: 'changed', sessionId: 'changed' })
    assert.equal(result.ok, true)
    assert.deepEqual(result.edges, [original])
    assert.equal(result.edges[0], original)
  }
})

test('omitted classes are unchanged; empty merge is a no-op', () => {
  const original = [edge('a', 'b'), edge('b', 'd'), edge('c', 'b', 'derived_from'), edge('b', 'a', 'derived_from')]
  assert.deepEqual(update(original, { mode: 'replace' }).edges, original)
  assert.deepEqual(update(original, { predecessorIds: [] }).edges, original)
})

test('replace clears only the specified current incident direction', () => {
  const original = [edge('a', 'b'), edge('b', 'd'), edge('a', 'd'), edge('c', 'b', 'derived_from'), edge('b', 'a', 'derived_from')]
  assert.deepEqual(update(original, { mode: 'replace', predecessorIds: [] }).edges, original.slice(1))
  assert.deepEqual(update(original, { mode: 'replace', successorIds: [] }).edges, [original[0], ...original.slice(2)])
  assert.deepEqual(update(original, { mode: 'replace', sourceTaskIds: [] }).edges, [original[0], original[1], original[2], original[4]])
})

test('replace applies all removals before validating candidate graph', () => {
  const result = update([edge('a', 'b')], { mode: 'replace', predecessorIds: [], successorIds: ['a'] })
  assert.equal(result.ok, true)
  assert.deepEqual(result.edges.map(({ from, to }) => [from, to]), [['b', 'a']])
})

test('invalid IDs, arrays, modes, metadata, unknown tasks and self links fail atomically', () => {
  const original = Object.freeze([Object.freeze(edge('a', 'd'))])
  const cases = [
    { taskId: 'unknown' }, { taskId: 12 }, { taskId: '' },
    { mode: 'bad' }, { source: 'bad' }, { reason: 12 }, { sessionId: false },
    ...['predecessorIds', 'successorIds', 'sourceTaskIds'].flatMap((field) => [
      { [field]: 'a' }, { [field]: null }, { [field]: [1] }, { [field]: [''] },
      { [field]: ['  '] }, { [field]: ['missing'] }, { [field]: ['b'] }, { [field]: new Array(2) },
    ]),
  ]
  for (const input of cases) {
    const result = update(original, { predecessorIds: ['c'], ...input })
    assert.equal(result.ok, false, JSON.stringify(input))
    assert.equal(result.edges, original)
    assert.equal(typeof result.error, 'string')
  }
  for (const input of [null, [], 'bad']) assert.equal(updateRelations(original, tasks, input).ok, false)
})

test('dependency and provenance cycles are rejected independently across the entire graph', () => {
  for (const kind of ['depends_on', 'derived_from']) {
    const original = [edge('a', 'c', kind), edge('c', 'b', kind)]
    const input = kind === 'depends_on' ? { successorIds: ['a'] } : { taskId: 'a', sourceTaskIds: ['b'] }
    const result = update(original, input)
    assert.equal(result.ok, false)
    assert.equal(result.edges, original)
    const disconnected = [edge('a', 'c', kind), edge('c', 'a', kind)]
    assert.equal(update(disconnected, { successorIds: ['d'] }).ok, false)
  }
})

test('opposite edges in different kinds do not form a shared cycle', () => {
  const result = update([edge('a', 'b')], { taskId: 'a', sourceTaskIds: ['b'] })
  assert.equal(result.ok, true)
  assert.deepEqual(ids(projectRelations(result.edges, tasks, 'b').derivedTasks), ['a'])
})

test('projection provides reverse directions, deduplication and completion/missing blocking', () => {
  const edges = [edge('a', 'b'), edge('a', 'b'), edge('c', 'b'), edge('gone', 'b'), edge('b', 'd'), edge('c', 'b', 'derived_from'), edge('b', 'a', 'derived_from')]
  const result = projectRelations(edges, tasks, 'b')
  assert.deepEqual(result.predecessors, [
    { id: 'a', title: 'A', done: false, missing: false },
    { id: 'c', title: 'C', done: true, missing: false },
    { id: 'gone', title: 'gone', done: false, missing: true },
  ])
  assert.deepEqual(ids(result.successors), ['d'])
  assert.deepEqual(ids(result.sourceTasks), ['c'])
  assert.deepEqual(ids(result.derivedTasks), ['a'])
  assert.deepEqual(ids(result.blockedBy), ['a', 'gone'])
  assert.equal(result.ready, false)
  assert.deepEqual(ids(projectRelations(edges, tasks, 'a').successors), ['b'])
  assert.deepEqual(ids(projectRelations(edges, tasks, 'c').derivedTasks), ['b'])
})

test('completed predecessor does not block; provenance alone does not block', () => {
  assert.equal(projectRelations([edge('c', 'b')], tasks, 'b').ready, true)
  assert.equal(projectRelations([edge('a', 'b', 'derived_from')], tasks, 'b').ready, true)
  assert.equal(projectRelations([], tasks, 'b').ready, true)
})

test('legacy malformed/unknown/duplicate data is tolerated without metadata loss', () => {
  const dirty = [null, 42, {}, { from: 'a', to: 'b', kind: 'unknown' }, { from: 'a', kind: 'depends_on' }, edge('gone', 'b'), edge('gone', 'b')]
  const result = update(dirty, { sourceTaskIds: ['c'] })
  assert.equal(result.ok, true)
  assert.deepEqual(result.edges.slice(0, dirty.length), dirty)
  assert.deepEqual(ids(projectRelations(dirty, tasks, 'b').blockedBy), ['gone'])
  assert.deepEqual(relationStats(dirty, tasks), { dependencyEdges: 1, provenanceEdges: 0, blockedTasks: 1, readyTasks: 2 })
  assert.deepEqual(relationStats(null, null), { dependencyEdges: 0, provenanceEdges: 0, blockedTasks: 0, readyTasks: 0 })
  assert.equal(projectRelations(null, null, 'b').ready, true)
})

test('stats count only known unfinished tasks but retain unique dangling edge counts', () => {
  const edges = [edge('a', 'b'), edge('a', 'b'), edge('c', 'd'), edge('a', 'c'), edge('gone', 'd'), edge('a', 'unknown'), edge('b', 'a', 'derived_from')]
  assert.deepEqual(relationStats(edges, [...tasks, tasks[0]]), { dependencyEdges: 5, provenanceEdges: 1, blockedTasks: 2, readyTasks: 1 })
})

test('deep graphs validate without recursive stack overflow', () => {
  const largeTasks = Array.from({ length: 15000 }, (_, index) => ({ id: String(index), done: false }))
  const edges = largeTasks.slice(1).map((task, index) => edge(String(index), task.id))
  assert.equal(updateRelations(edges, largeTasks, { taskId: '0', mode: 'merge', source: 'manual' }).ok, true)
  const result = updateRelations(edges, largeTasks, { taskId: '0', predecessorIds: ['14999'], mode: 'merge', source: 'manual' })
  assert.equal(result.ok, false)
  assert.equal(result.edges, edges)
})

console.log(`\n${checks} relation test groups passed`)
