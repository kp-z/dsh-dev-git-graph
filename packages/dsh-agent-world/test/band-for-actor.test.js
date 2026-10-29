import assert from 'node:assert/strict'
import test from 'node:test'
import { bandForActor } from '../web/core/scene-layout.js'

const actions = [{ state: 'working', band: 'sit', weight: 1 }]
test('到会议桌/工位/休息区 working 都播坐姿', () => {
  assert.equal(bandForActor(actions, { state: 'working', stationKind: 'meeting' }), 'sit')
  assert.equal(bandForActor(actions, { state: 'working', stationKind: 'desk' }), 'sit')
  assert.equal(bandForActor(actions, { state: 'working', stationKind: 'breakroom' }), 'sit')
  assert.equal(bandForActor(actions, { state: 'walking', stationKind: 'desk' }), 'walk')
})
