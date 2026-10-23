import assert from 'node:assert/strict'
import test from 'node:test'
import { advanceWork } from '../lib/sim/interaction.js'

function world(agents, tasks = []) {
  return { tick: 10, agents, tasks }
}
function agent(overrides = {}) {
  return { id: 'a', state: 'working', station: 'station.desk-a', targetStation: null, path: [], carrying: null, ...overrides }
}

test('working 但没任务：释放工位并记 repaired', () => {
  const w = world([agent()])
  const out = advanceWork(w)
  assert.equal(w.agents[0].state, 'idle')
  assert.equal(w.agents[0].station, null)
  assert.deepEqual(out.repaired, [{ agentId: 'a', reason: 'no-task' }])
})

test('working 但任务已失效：释放工位并清 carrying', () => {
  const w = world([agent({ carrying: 'task-1' })], [{ id: 'task-1', status: 'done', owner: 'a', progress: 1 }])
  const out = advanceWork(w)
  assert.equal(w.agents[0].state, 'idle')
  assert.equal(w.agents[0].carrying, null)
  assert.equal(w.agents[0].station, null)
  assert.deepEqual(out.repaired, [{ agentId: 'a', reason: 'stale-task' }])
})
