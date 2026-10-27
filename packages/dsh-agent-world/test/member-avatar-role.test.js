import assert from 'node:assert/strict'
import test from 'node:test'
import { resolveMemberSprite } from '../web/core/member-avatar.js'

const scene = {
  actors: [{ id: 'a', modelId: 'm1', role: 'engineer' }],
  models: [{ id: 'm1', url: 'chars.png', sheet: { cellW: 32, cellH: 64, animations: { 'idle.down': { col: 0, row: 0 } } } }],
}

test('成员不在 actors 时按角色复用贴图', () => {
  const sprite = resolveMemberSprite(scene, 'new-member', './vendor/', 'engineer')
  assert.equal(sprite.url, './vendor/chars.png')
})

test('没有同角色仍返回 null', () => {
  assert.equal(resolveMemberSprite(scene, 'new-member', './vendor/', 'designer'), null)
})
