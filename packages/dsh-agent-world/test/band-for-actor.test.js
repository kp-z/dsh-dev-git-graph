import assert from 'node:assert/strict'
import test from 'node:test'
import { bandForActor } from '../web/core/scene-layout.js'

const actions = [{ state: 'working', band: 'sit', weight: 1 }]
test('到会议桌 working 播站立带，到工位播坐姿，休息区坐姿', () => {
  assert.equal(bandForActor(actions, { state: 'working', stationKind: 'meeting' }), 'idle')
  assert.equal(bandForActor(actions, { state: 'working', stationKind: 'desk' }), 'sit')
  assert.equal(bandForActor(actions, { state: 'working', stationKind: 'breakroom' }), 'sit')
  assert.equal(bandForActor(actions, { state: 'walking', stationKind: 'desk' }), 'walk')
})
