import assert from 'node:assert/strict'
import test from 'node:test'
import { HEARTBEAT_TICKS, heartbeatFor, heartbeatDue, runHeartbeats } from '../lib/sim/heartbeat.js'

function world(tick = 0) {
  return {
    tick, seed: 1, messages: [], messageSeq: 0,
    agents: [
      { id: 'a', role: 'engineer', state: 'idle', carrying: null, station: null, targetStation: null },
      { id: 'b', role: 'engineer', state: 'idle', carrying: null, station: null, targetStation: null },
    ],
    tasks: [
      { id: 'task-1', status: 'ready', suggestedRole: 'engineer', createdAtTick: 0, ordinal: 1 },
    ],
    stations: [],
  }
}

test('heartbeat：相位稳定，每 HEARTBEAT_TICKS 醒一次', () => {
  const w = world(0)
  const a = w.agents[0]
  const dueA = []
  for (let tick = 0; tick < HEARTBEAT_TICKS * 3; tick += 1) { w.tick = tick; if (heartbeatDue(w, a)) dueA.push(tick) }
  assert.equal(dueA.length, 3)
  assert.equal(dueA[1] - dueA[0], HEARTBEAT_TICKS)
})

test('heartbeat：需要回复 + 想要回复 → 只回一条 answer；非心跳不发', () => {
  const w = world(0)
  w.messages.push({ id: 'msg-1', from: 'a', to: 'b', kind: 'question', body: '在吗', atTick: 0, deliveredAtTick: 0 })
  const delivered = [{ messageId: 'msg-1', from: 'a', to: 'b' }]
  // 找到 b 的下一次心跳
  let due = 0
  while (!heartbeatDue(w, w.agents[1])) { w.tick += 1; due += 1 }
  const out = runHeartbeats(w, delivered)
  assert.equal(out.intents.length, 1)
  assert.deepEqual(out.intents[0].needs, ['reply:msg-1'])
  assert.equal(out.intents[0].decision, 'reply')
  assert.equal(out.sent.length, 1)
  assert.equal(w.messages.filter((m) => m.kind === 'answer').length, 1)
})

test('heartbeat：没有消息时只产出 wants/needs，不自动回复', () => {
  const w = world(0)
  const intent = heartbeatFor(w, w.agents[0], [])
  assert.equal(intent.decision, 'work')
  assert.deepEqual(intent.wants.includes('reply'), false)
  assert.equal(intent.replyTo, null)
})
