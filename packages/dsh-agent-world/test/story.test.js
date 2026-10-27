import assert from 'node:assert/strict'
import test from 'node:test'
import { buildStory } from '../web/core/story.js'

test('story：空世界是序章', () => {
  assert.equal(buildStory({ tasks: [] }).id, 'prologue')
})

test('story：ready → 集结，in_progress → 执行，全完成 → 终章', () => {
  assert.equal(buildStory({ tasks: [{ status: 'ready' }] }).id, 'act-1')
  assert.equal(buildStory({ tasks: [{ status: 'in_progress' }] }).id, 'act-2')
  assert.equal(buildStory({ tasks: [{ status: 'done' }, { status: 'done' }] }).id, 'epilogue')
})

test('story：有失败时终章是失败态', () => {
  const story = buildStory({ tasks: [{ status: 'done' }, { status: 'failed' }] })
  assert.equal(story.id, 'epilogue-fail')
  assert.equal(story.tone, 'danger')
})
