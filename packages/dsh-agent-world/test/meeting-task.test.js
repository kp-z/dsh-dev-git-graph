import assert from 'node:assert/strict'
import test from 'node:test'
import { ContentRegistry, builtinPacks } from '../lib/content/index.js'
import { createWorld } from '../lib/world/create.js'
import { step } from '../lib/sim/step.js'

function world() {
  const content = new ContentRegistry()
  content.loadAll(builtinPacks())
  return createWorld({ content, scene: 'scene.default-town', createdAt: '2026-01-01T00:00:00.000Z', taskSets: ['task.team-sync'] })
}

test('会议任务：converse 单会选 meeting 站点并走过去', () => {
  const w = world()
  const meet = w.tasks.find((task) => task.key === 'meet')
  assert.ok(meet)
  assert.deepEqual(meet.requires, ['converse'])
  const result = step(w)
  assert.equal(meet.status, 'in_progress')
  const claim = result.claims.find((item) => item.taskId === meet.id)
  assert.ok(claim)
  const station = w.stations.find((item) => item.id === claim.stationId)
  assert.equal(station.kind, 'meeting')
  const actor = w.agents.find((agent) => agent.id === claim.agentId)
  assert.equal(actor.state, 'walking')
  assert.equal(actor.targetStation, claim.stationId)
})
