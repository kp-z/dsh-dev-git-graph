import assert from 'node:assert/strict'
import test from 'node:test'
import { step } from '../lib/sim/step.js'

function world() {
  return {
    tick: 0, seed: 1, nav: null, tasks: [], messages: [], events: [], seq: 0, paused: false,
    agents: [{ id: 'a', name: 'A', role: 'engineer', state: 'idle', carrying: null, station: null, targetStation: null, path: [], position: { x: 0, z: 0 }, facing: 0, hangout: null, boundAgentId: null }],
    stations: [
      { id: 'desk', kind: 'desk', capacity: 2, capabilities: ['code'], anchor: { x: 2, z: 2 }, slots: [{ x: 0, z: 0 }, { x: 1, z: 0 }] },
      { id: 'lab', kind: 'lab', capacity: 2, capabilities: ['research'], anchor: { x: 5, z: 5 }, slots: [{ x: 0, z: 0 }] },
    ],
    agentsById: null,
  }
}

test('agentActivity work：立即寻路到能工作的站点', () => {
  const w = world()
  step(w, [{ kind: 'agentActivity', agentId: 'a', activity: 'work', ticks: 60 }])
  assert.equal(w.agents[0].state, 'walking')
  assert.equal(w.agents[0].targetStation, 'desk')
  assert.equal(w.agents[0].activityKind, 'work')
})

test('agentActivity idle：取消活动并释放站点', () => {
  const w = world()
  w.agents[0].state = 'working'
  w.agents[0].activityKind = 'work'
  w.agents[0].station = 'desk'
  step(w, [{ kind: 'agentActivity', agentId: 'a', activity: 'idle', ticks: 0 }])
  assert.equal(w.agents[0].state, 'idle')
  assert.equal(w.agents[0].station, null)
})

test('agentActivity skill=research：去实验台而不是工位', () => {
  const w = world()
  step(w, [{ kind: 'agentActivity', agentId: 'a', activity: 'work', ticks: 60, skill: 'research' }])
  assert.equal(w.agents[0].targetStation, 'lab')
})
