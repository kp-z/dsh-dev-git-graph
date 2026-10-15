// 惰性对话端口（R30）：复现真宿主上那个 bug，并钉住修复。
//
// 真宿主上的症状：插件加载那一刻 `sessionController` 还没挂上，原来的代码在那一刻
// **同步**建桥并把结果定死 → 端口永久是 undefined → `/api/say` 每条都回
// "对话通道没启用（DSH 会话服务不可用）"。配置里会话服务明明排在插件前面，
// 所以这不是配置问题，而是"用加载时刻去判断一个后来才存在的服务"。
import test from 'node:test'
import assert from 'node:assert/strict'

import { toLazyDialoguePort } from '../lib/bridge/index.js'

/** 一个最小的假桥：只记录被调用了什么。 */
function fakeBridge(reply = '你好') {
  const calls = []
  return {
    calls,
    bridge: {
      async say(characterId, text) {
        calls.push(['say', characterId, text])
        return { ok: true, characterId, sessionId: 's-1', requestId: 'r-1', created: true }
      },
      async waitForReply(characterId) {
        calls.push(['wait', characterId])
        return { ok: true, reply: { text: reply } }
      },
      liveCount: () => 1,
      async disposeAll() {},
    },
  }
}

test('惰性端口：服务一开始不在、后来出现 —— 出现之后就能说话（这正是真宿主上坏掉的路径）', async () => {
  let serviceMounted = false
  let attempts = 0
  const { bridge, calls } = fakeBridge('我是工头阿金')
  const port = toLazyDialoguePort(() => {
    attempts++
    return serviceMounted ? { ok: true, bridge } : { ok: false, reason: '会话服务还没挂上' }
  })

  // 加载那一刻：服务不在。原实现会在这里把端口定死。
  const early = await port.say('agent-1', '你好')
  assert.equal(early.ok, false)
  assert.match(early.reason, /会话服务还没挂上/, '失败原因必须是当次尝试给出的那句，不是被吞掉')
  assert.equal(port.liveCount(), 0, '没建起来时诊断接口返回 0，而不是抛')

  // 服务后来挂上了。
  serviceMounted = true
  const later = await port.say('agent-1', '你好')
  assert.equal(later.ok, true, '服务出现之后必须能说话 —— 原实现在这里仍然失败')
  const reply = await port.waitForReply('agent-1', 1000)
  assert.deepEqual(reply, { ok: true, text: '我是工头阿金' })
  assert.deepEqual(calls.map((c) => c[0]), ['say', 'wait'])
  assert.equal(attempts, 2, '成功一次之后就记住，不再重复建桥')
})

test('惰性端口：成功之后**只建一次桥**（否则每句话都会新建一套会话，成本悄悄爬高）', async () => {
  let built = 0
  const { bridge } = fakeBridge()
  const port = toLazyDialoguePort(() => {
    built++
    return { ok: true, bridge }
  })
  for (let i = 0; i < 5; i++) {
    assert.equal((await port.say('agent-1', `第 ${i} 句`)).ok, true)
  }
  assert.equal(built, 1)
  assert.equal(port.liveCount(), 1)
})

test('惰性端口：失败不会被缓存 —— 每次给出**当次**的原因', async () => {
  const reasons = ['服务没挂上', '服务挂了又掉了']
  let i = 0
  const port = toLazyDialoguePort(() => ({ ok: false, reason: reasons[i++ % reasons.length] }))
  assert.equal((await port.say('agent-1', 'a')).reason, '服务没挂上')
  assert.equal((await port.waitForReply('agent-1', 10)).reason, '服务挂了又掉了')
})
