import assert from 'node:assert/strict'
import test from 'node:test'
import { heartbeatDue, runHeartbeats } from '../lib/sim/heartbeat.js'

function world() {
  return {
    tick: 0, seed: 7, gameMode: true, nav: null, messages: [], messageSeq: 0, tasks: [],
    agents: [{ id: 'a', role: 'engineer', state: 'idle', carrying: null, station: null, targetStation: null, position: { x: 0, z: 0 }, path: [] }],
    stations: [
      { id: 'meeting', kind: 'meeting', capacity: 4, capabilities: ['converse'], anchor: { x: 2, z: 2 }, slots: [{ x: 0, z: 0 }] },
      { id: 'break', kind: 'breakroom', capacity: 1, capabilities: ['rest'], anchor: { x: 4, z: 4 }, slots: [{ x: 0, z: 0 }] },
    ],
  }
}

test('gameMode：heartbeat 会把 idle agent 派去开会/休息并标记 activity', () => {
  const w = world()
  let assigned = false
  for (let i = 0; i < 80 && !assigned; i += 1) {
    w.tick = i
    if (!heartbeatDue(w, w.agents[0])) continue
    runHeartbeats(w, [])
    const a = w.agents[0]
    if (a.state === 'walking') {
      assigned = true
      assert.ok(a.activityKind === 'meet' || a.activityKind === 'rest')
      assert.ok(a.activityUntil > w.tick)
      assert.ok(a.targetStation === 'meeting' || a.targetStation === 'break')
    }
  }
  assert.equal(assigned, true)
})

test('gameMode 关闭：heartbeat 不改变位置/站点', () => {
  const w = world()
  w.gameMode = false
  for (let i = 0; i < 80; i += 1) { w.tick = i; runHeartbeats(w, []) }
  assert.equal(w.agents[0].state, 'idle')
  assert.equal(w.agents[0].targetStation, null)
})
