import assert from 'node:assert/strict'
import test from 'node:test'
import { pairwiseOcclusionAnomalies } from '../web/core/scene-layout.js'

test('成对遮挡：底边更靠下的应在前面', () => {
  const out = pairwiseOcclusionAnomalies([
    { key: 'desk', bottom: 100, depth: 100 },
    { key: 'actor', bottom: 120, depth: 120 },
  ])
  assert.equal(out.checked, 1)
  assert.equal(out.anomalies.length, 0)
})

test('成对遮挡：后面反而 depth 更大 → 报具体 pair', () => {
  const out = pairwiseOcclusionAnomalies([
    { key: 'desk', bottom: 100, depth: 200 },
    { key: 'actor', bottom: 120, depth: 120 },
  ])
  assert.equal(out.anomalies.length, 1)
  assert.equal(out.anomalies[0].back, 'desk')
  assert.equal(out.anomalies[0].front, 'actor')
})

test('成对遮挡：flat 层不参与；同底边不算错序', () => {
  const out = pairwiseOcclusionAnomalies([
    { key: 'map:layer0', bottom: 100, depth: -1, flat: true },
    { key: 'a', bottom: 100, depth: 10 },
    { key: 'b', bottom: 100, depth: 11 },
  ])
  assert.equal(out.total, 2)
  assert.equal(out.checked, 0)
  assert.equal(out.anomalies.length, 0)
})
