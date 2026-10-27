import assert from 'node:assert/strict'
import test from 'node:test'
import { duplicateSeatIndices } from '../web/core/scene-layout.js'

test('几乎完全重合的椅子被识别', () => {
  assert.deepEqual(duplicateSeatIndices([{ x: 10, y: 10 }, { x: 12, y: 11 }, { x: 40, y: 40 }]), [1])
})

test('正常相邻椅子不误删', () => {
  assert.deepEqual(duplicateSeatIndices([{ x: 10, y: 10 }, { x: 22, y: 10 }]), [])
})
