import assert from 'node:assert/strict'
import test from 'node:test'
import { claimTasks } from '../lib/sim/scheduler.js'

function world() {
  return {
    tick: 0, seed: 1, gameMode: true, nav: null,
    agents: [
      { id: 'a', state: 'idle', carrying: null, station: null, targetStation: null, path: [], position: { x: 0, z: 0 }, activityKind: null },
      { id: 'b', state: 'idle', carrying: null, station: null, targetStation: null, path: [], position: { x: 1, z: 0 }, activityKind: null },
    ],
    tasks: [{ id: 't1', status: 'ready', createdAtTick: 3, ordinal: 1, requires: ['code'], externalId: null, owner: null, attemptId: null, suggestedRole: null, blockedBy: [] }],
    stations: [
      { id: 'meeting', kind: 'meeting', capacity: 4, capabilities: ['converse'], anchor: { x: 5, z: 5 }, slots: [{ x: 0, z: 0 }, { x: 1, z: 0 }, { x: 2, z: 0 }] },
      { id: 'desk', kind: 'desk', capacity: 2, capabilities: ['code'], anchor: { x: 1, z: 1 }, slots: [{ x: 0, z: 0 }, { x: 1, z: 0 }] },
    ],
  }
}

test('gameMode：新任务开工前全体先去会议室，不直接派工位', () => {
  const w = world()
  const out = claimTasks(w)
  assert.equal(out.claims.length, 0)
  assert.ok(w.agents.every((agent) => agent.state === 'walking' && agent.targetStation === 'meeting'))
  assert.equal(w.briefingForTick, 3)
  assert.equal(w.briefingUntil, 40)
})

test('会议进行中不派工；对新一批任务只开一次会', () => {
  const w = world()
  claimTasks(w)
  w.tick = 20
  const during = claimTasks(w)
  assert.equal(during.claims.length, 0)
  w.tick = 41
  // 会议结束后 idle 段会把参会者收回 idle；这里直接模拟收尾。
  for (const agent of w.agents) { agent.state = 'idle'; agent.targetStation = null; agent.path = []; agent.activityKind = undefined }
  const after = claimTasks(w)
  assert.equal(w.briefingForTick, 3)
  // 会议结束且同一批任务：开始正常派工。
  assert.equal(after.claims.length, 1)
})
