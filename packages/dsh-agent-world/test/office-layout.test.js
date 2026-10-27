import assert from 'node:assert/strict'
import test from 'node:test'
import { ContentRegistry, builtinPacks } from '../lib/content/index.js'
import { createWorld } from '../lib/world/create.js'
import { cellOf, isWalkable } from '../lib/sim/pathfind.js'

test('办公室所有站点 slot 都落在可走格（否则 agent 永远到不了）', () => {
  const content = new ContentRegistry()
  content.loadAll(builtinPacks())
  const world = createWorld({
    content,
    scene: 'scene.office',
    name: 'layout-audit',
    createdAt: '2026-01-01T00:00:00.000Z',
    taskSets: [],
  })
  assert.ok(world.nav !== null, '办公室必须有导航网格')
  for (const station of world.stations) {
    for (const [index, slot] of station.slots.entries()) {
      const point = { x: station.anchor.x + slot.x, z: station.anchor.z + slot.z }
      assert.equal(
        isWalkable(world.nav, cellOf(world.nav, point)),
        true,
        `${station.id} slot#${index} (${point.x},${point.z}) 不可走`,
      )
    }
  }
})
