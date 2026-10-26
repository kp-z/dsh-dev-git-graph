import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { levelForXp, xpForLevel } from '../lib/persona/level.js'
import { createPersonaStore } from '../lib/persona/store.js'

test('等级按经验单调增长，阈值可逆', () => {
  assert.equal(levelForXp(0), 1)
  assert.equal(levelForXp(xpForLevel(2)), 2)
  assert.equal(levelForXp(xpForLevel(3) - 1), 2)
  assert.equal(levelForXp(xpForLevel(3)), 3)
})

test('Persona 持久化、加经验、关联任务', () => {
  const dir = mkdtempSync(join(tmpdir(), 'aw-persona-'))
  try {
    const path = join(dir, 'personas.json')
    const store = createPersonaStore(path)
    store.upsert({ id: 'sa-1', name: '小铁', role: 'engineer', skills: ['code', 'review'] })
    const level = store.addXp('sa-1', 300)
    assert.equal(level.level, 3)
    const linked = store.linkTask('sa-1', 'task-1')
    assert.deepEqual(linked.taskIds, ['task-1'])
    const awarded = store.awardTask('sa-1', 'task-1', 40)
    assert.equal(awarded.taskIds.includes('task-1'), true)
    assert.equal(awarded.awardedTaskIds.includes('task-1'), true)
    assert.equal(store.awardTask('sa-1', 'task-1', 40).xp, awarded.xp)
    const reopened = createPersonaStore(path)
    assert.equal(reopened.get('sa-1').name, '小铁')
    assert.equal(reopened.get('sa-1').level, 3)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
