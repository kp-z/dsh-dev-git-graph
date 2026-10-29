import assert from 'node:assert/strict'
import test from 'node:test'
import { ContentRegistry, builtinPacks } from '../lib/content/index.js'
import { createWorld } from '../lib/world/create.js'
import { step } from '../lib/sim/step.js'

function makeWorld() {
  const content = new ContentRegistry()
  content.loadAll(builtinPacks())
  return createWorld({ content, scene: 'scene.default-town', createdAt: '2026-01-01T00:00:00.000Z', taskSets: [] })
}

test('R471：没有 target 时，运行时不允许待命的人自己移动', () => {
  const world = makeWorld()
  const before = world.agents.map((agent) => ({ id: agent.id, x: agent.position.x, z: agent.position.z }))
  for (let i = 0; i < 120; i += 1) step(world, [], { idleBehaviors: [], idleAmbient: false })
  const after = world.agents.map((agent) => ({ id: agent.id, x: agent.position.x, z: agent.position.z }))
  assert.deepEqual(after, before)
  assert.ok(world.agents.every((agent) => agent.targetStation === null))
})
