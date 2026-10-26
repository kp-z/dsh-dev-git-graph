import assert from 'node:assert/strict'
import test from 'node:test'
import { buildQuestState } from '../web/core/quests.js'

test('目标从世界事实计算，不靠 UI', () => {
  const world = {
    tasks: [{ status: 'done' }, { status: 'ready' }],
    agents: [{ state: 'working', station: 'meeting-1' }, { state: 'idle', station: null }],
    messages: [{ kind: 'report', deliveredAtTick: 3 }, { kind: 'report', deliveredAtTick: null }],
  }
  const state = buildQuestState(world, [{ id: 'meeting-1', kind: 'meeting' }])
  assert.equal(state.completed, 3)
  assert.equal(state.total, 4)
  assert.equal(state.quests[0].progress, 0.5)
  assert.equal(state.quests[1].done, true)
  assert.equal(state.quests[2].detail, '1 份')
  assert.equal(state.score, 100 + 20 + 15 + 10)
})

test('空世界不崩，全部目标未完成', () => {
  const state = buildQuestState(null, [])
  assert.equal(state.completed, 0)
  assert.equal(state.quests[3].progress, 0)
})
