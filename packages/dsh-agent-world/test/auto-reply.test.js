import assert from 'node:assert/strict'
import test from 'node:test'
import { queueAutoReplies } from '../lib/sim/auto-reply.js'

function world() {
  return {
    tick: 10,
    seed: 1,
    messages: [
      { id: 'msg-1', from: 'a', to: 'b', kind: 'handoff', body: '前置 → 后续', atTick: 1, deliveredAtTick: 3 },
      { id: 'msg-2', from: 'a', to: 'b', kind: 'report', body: '完成', atTick: 1, deliveredAtTick: 3 },
    ],
    messageSeq: 2,
    agents: [{ id: 'a' }, { id: 'b' }],
  }
}

test('tick 自动回复：handoff 生成 answer，report 不回复', () => {
  const w = world()
  const sent = queueAutoReplies(w, [
    { messageId: 'msg-1', from: 'a', to: 'b' },
    { messageId: 'msg-2', from: 'a', to: 'b' },
  ])
  assert.equal(sent.length, 1)
  const reply = w.messages.find((message) => message.kind === 'answer')
  assert.equal(reply.from, 'b')
  assert.equal(reply.to, 'a')
  assert.match(reply.body, /收到/)
  assert.equal(reply.deliveredAtTick, null)
})

test('tick 自动回复：自己发给自己不回复', () => {
  const w = world()
  w.messages[0].to = 'a'
  const sent = queueAutoReplies(w, [{ messageId: 'msg-1', from: 'a', to: 'a' }])
  assert.equal(sent.length, 0)
})
