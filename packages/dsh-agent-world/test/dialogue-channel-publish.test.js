import assert from 'node:assert/strict'
import test from 'node:test'
import { createDialogueChannel } from '../lib/routes/dialogue.js'

test('R340：外部主会话事件可以推进同一 dialogue 通道', () => {
  const channel = createDialogueChannel({ service: { currentWorld: () => ({ tick: 7 }) }, port: undefined })
  const got = []
  const off = channel.subscribe((event) => got.push(event))
  channel.publish({ turnId: 'main-1', tick: 7, phase: 'thinking', from: { kind: 'god' }, to: { kind: 'agent', id: 'agent-1' }, text: '你好' })
  channel.publish({ turnId: 'main-1', tick: 7, phase: 'replied', from: { kind: 'agent', id: 'agent-1' }, to: { kind: 'god' }, text: '在' })
  off()
  assert.deepEqual(got.map((event) => event.phase), ['thinking', 'replied'])
  assert.equal(got[0].text, '你好')
})
