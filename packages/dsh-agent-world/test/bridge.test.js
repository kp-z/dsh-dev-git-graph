/**
 * 角色 ↔ DSH 会话绑定的测试（BACKLOG M6-1）。
 *
 * ## 这个文件要钉住的事实
 *
 * 1. **懒创建**：没人搭话时一个会话都不建。
 * 2. **同一角色两次搭话只建一次会话**（任务书的硬性验收）；并发搭话也只建一次。
 * 3. **上限 + 释放 + 卸载**：超限给能下手的原因；`disposeAll()` 真的把每个会话都 dispose 了。
 * 4. **人设从 `systemPromptFor` 进 `seed`**：代码里的人设是零字面量。
 * 5. **失败要退化**：模型没配置 / 建会话失败 / 投递失败 / 空消息，各自给出**不同的、可下手的**原因。
 *
 * ## 一次模型调用都不会发生
 *
 * `AgentFactory` 与 `SessionTransport` 都是注入的接口，本文件的实现是两个纯内存假对象：
 * 工厂只 `push` 调用记录并返回一个带 `dispose()` 的假 handle；通道只记 `prompt` 请求，
 * 事件由测试**手动投递**。真实实现（`dsh-adapter.js`）在这个文件里只被喂**假 ctx**。
 */
import assert from 'node:assert/strict'
import { after, test } from 'node:test'

import {
  buildSystemPromptSeed,
  checkModelReadiness,
  createAgentFactory,
  createCharacterBridge,
  createDshCharacterBridge,
  createSessionTransport,
  decodeBridgeEvent,
  extractAssistantReply,
  extractTurnEnd,
  normalizeSessionEvent,
} from '../lib/bridge/index.js'

// ── 假对象 ────────────────────────────────────────────────────────────────────

/** 假 Agent 工厂：只记账，不碰模型。 */
function createFakeFactory(options = {}) {
  const calls = []
  const handles = []
  return {
    calls,
    handles,
    /** 让测试模拟 `createAgent()` 抛错（"会话创建失败：<原因>"）。 */
    failWith: options.failWith,
    async createAgent(createOptions) {
      calls.push(createOptions)
      if (this.failWith !== undefined) throw this.failWith
      const handle = {
        agent: { id: createOptions.sessionId },
        disposed: false,
        disposeCalls: 0,
        async dispose() {
          this.disposeCalls += 1
          if (options.disposeFails === true && this.disposeCalls === 1) throw new Error('dispose 炸了')
          this.disposed = true
        },
      }
      handles.push(handle)
      return handle
    },
  }
}

/** 假会话通道：`prompt` 记账，事件由测试手动 `emit`。 */
function createFakeTransport(options = {}) {
  const listeners = new Set()
  const prompts = []
  return {
    prompts,
    get subscriberCount() {
      return listeners.size
    },
    async prompt(request, signal) {
      prompts.push({ request, signal })
      if (this.failWith !== undefined) throw this.failWith
      return { accepted: true }
    },
    failWith: options.failWith,
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    emit(sessionId, event) {
      for (const listener of [...listeners]) listener(sessionId, event)
    },
  }
}

/** 一条 `assistant/message` 事件（形状见 BRIDGE-RECON §2.2 / §4.2）。 */
function assistantEvent(text, { turn = 1, step = 1, seq = 10, blocks, interrupted } = {}) {
  return {
    type: 'assistant/message',
    seq,
    time: 0,
    data: {
      turn,
      step,
      ...(interrupted === true ? { interrupted: true } : {}),
      message: {
        role: 'assistant',
        source: { kind: 'model', provider: 'p', model: 'm' },
        content: blocks ?? [{ type: 'text', text }],
      },
    },
  }
}

/** 一条 `turn/end` 事件。 */
function turnEndEvent(reason, { turn = 1 } = {}) {
  return { type: 'turn/end', seq: 20, time: 0, data: { turn, reason } }
}

/** 建一个测试用 bridge。人设文本只由 id 拼出来，**测试里也没有角色名**。 */
function makeBridge(overrides = {}) {
  const factory = overrides.factory ?? createFakeFactory()
  // 注意用 `in` 而不是 `??`：`transport: undefined` 是"故意不给通道"（要验退化），
  // 而 `undefined ?? x` 会把它悄悄换成假通道，那条用例就变成假绿了。
  const transport = 'transport' in overrides ? overrides.transport : createFakeTransport()
  const bridge = createCharacterBridge({
    factory,
    transport,
    systemPromptFor: (characterId) => `你是角色 ${characterId}。`,
    now: () => 1_700_000_000_000,
    ...overrides.options,
  })
  return { bridge, factory, transport }
}

// ── 1. 懒创建 ────────────────────────────────────────────────────────────────

test('bridge：没人搭话时一个会话都不建（懒创建，D36）', () => {
  const { bridge, factory, transport } = makeBridge()

  assert.equal(factory.calls.length, 0, '构造 bridge 本身不该建会话')
  assert.equal(bridge.liveCount(), 0)
  assert.equal(bridge.sessionFor('c1'), undefined, 'sessionFor 不能顺手创建会话')
  assert.equal(transport.subscriberCount, 0, '没人搭话时不该占用事件总线监听位')
})

// ── 2. 核心验收：同一角色两次搭话只建一次会话 ──────────────────────────────────

test('bridge：同一角色两次搭话只建一次会话，第二条消息复用同一个会话', async () => {
  const { bridge, factory, transport } = makeBridge()

  const first = await bridge.say('c1', '你好')
  const second = await bridge.say('c1', '在吗')

  assert.equal(first.ok, true)
  assert.equal(second.ok, true)
  assert.equal(factory.calls.length, 1, '★ 两次搭话只能建一次会话')
  assert.equal(bridge.liveCount(), 1)
  assert.equal(first.created, true, '第一次是新建')
  assert.equal(second.created, false, '第二次是复用')

  assert.equal(transport.prompts.length, 2, '两条消息都要投递出去')
  assert.equal(transport.prompts[0].request.sessionId, transport.prompts[1].request.sessionId)
  assert.equal(transport.prompts[0].request.sessionId, 'agent-world:c1')
  assert.equal(transport.prompts[0].request.content[0].text, '你好')
  assert.equal(transport.prompts[1].request.content[0].text, '在吗')
  assert.equal(transport.prompts[0].request.mode, 'queue', '对话默认排队，不是 steer')
})

test('bridge：并发搭话也只建一次会话（共用同一个创建过程）', async () => {
  const { bridge, factory, transport } = makeBridge()

  await Promise.all([bridge.say('c1', 'a'), bridge.say('c1', 'b')])

  assert.equal(factory.calls.length, 1, '★ 并发的两次搭话也必须只建一次会话')
  assert.equal(transport.prompts.length, 2)
  assert.equal(bridge.liveCount(), 1)
})

test('bridge：不同角色各自一个会话，互不干扰', async () => {
  const { bridge, factory } = makeBridge()

  await bridge.say('c1', 'hi')
  await bridge.say('c2', 'hi')

  assert.equal(factory.calls.length, 2)
  assert.equal(factory.calls[0].sessionId, 'agent-world:c1')
  assert.equal(factory.calls[1].sessionId, 'agent-world:c2')
  assert.deepEqual(bridge.liveCharacters().sort(), ['c1', 'c2'])
})

// ── 3. seed：人设从内容进，代码里零字面量 ─────────────────────────────────────

test('bridge：seed 里是一条 system/message，文本正是 systemPromptFor 给的', async () => {
  const { bridge, factory } = makeBridge()

  await bridge.wake('c1')

  assert.equal(factory.calls.length, 1)
  const { seed } = factory.calls[0]
  assert.ok(Array.isArray(seed) && seed.length === 1, '要注入且只注入一条 seed 事件')

  const event = seed[0]
  assert.equal(event.type, 'system/message')
  assert.equal(event.surfaceOp, 'append', 'system/message 是 surface 事件，必须带 surfaceOp')
  assert.equal(event.data.message.role, 'system')
  assert.deepEqual(event.data.message.source, { kind: 'system-prompt' })
  assert.deepEqual(event.data.message.content, [{ type: 'text', text: '你是角色 c1。' }])
  assert.equal(event.time, 1_700_000_000_000, '时间戳来自注入的 now()，测试可复现')

  // 人设是内容：bridge 只是把调用方给的文本装进去，没有自己加任何一句。
  assert.equal(event.data.message.content.length, 1)
})

test('seed 构造：形状正确，空人设直接抛（内容错误要响）', () => {
  const seed = buildSystemPromptSeed('某段人设', { time: 7, messageId: 'm1' })
  assert.equal(seed.type, 'system/message')
  assert.equal(seed.seq, 0)
  assert.equal(seed.time, 7)
  assert.equal(seed.data.turn, 0)
  assert.equal(seed.data.step, 0)
  assert.equal(seed.data.message.id, 'm1')

  assert.throws(() => buildSystemPromptSeed('   '), /人设文本是空的/)
  assert.throws(() => buildSystemPromptSeed(''), /人设文本是空的/)
})

test('bridge：人设是空的 → create-failed，且不白建会话', async () => {
  const { bridge, factory } = makeBridge({ options: { systemPromptFor: () => '  ' } })

  const result = await bridge.wake('c1')

  assert.equal(result.ok, false)
  assert.equal(result.code, 'create-failed')
  assert.match(result.reason, /人设/)
  assert.equal(factory.calls.length, 0, '人设不合法就不该去建会话')
})

// ── 4. 上限 / 释放 / 卸载 ────────────────────────────────────────────────────

test('bridge：超过上限时给出能下手的原因，而不是静默失败', async () => {
  const { bridge, factory } = makeBridge({ options: { maxLiveSessions: 2 } })

  assert.equal((await bridge.wake('c1')).ok, true)
  assert.equal((await bridge.wake('c2')).ok, true)

  const third = await bridge.wake('c3')
  assert.equal(third.ok, false)
  assert.equal(third.code, 'capacity')
  assert.match(third.reason, /上限/)
  assert.match(third.reason, /release\(\)/, '原因里要写清楚怎么办')
  assert.equal(factory.calls.length, 2, '超限的角色一个字节的会话都不该建')
  assert.equal(bridge.liveCount(), 2)
})

test('bridge：release 让角色下线后，名额可以被别人用', async () => {
  const { bridge, factory } = makeBridge({ options: { maxLiveSessions: 1 } })

  await bridge.wake('c1')
  assert.equal((await bridge.wake('c2')).ok, false)

  const released = await bridge.release('c1')
  assert.equal(released.closed, true)
  assert.equal(factory.handles[0].disposed, true, 'release 必须真的 dispose 会话')
  assert.equal(bridge.liveCount(), 0)

  assert.equal((await bridge.wake('c2')).ok, true, '腾出名额后要能唤醒新角色')
  assert.equal(factory.calls.length, 2)

  assert.equal(await bridge.release('c1'), undefined, '没醒的角色 release 返回 undefined')
})

test('bridge：disposeAll 释放全部会话，之后 bridge 不再工作', async () => {
  const { bridge, factory, transport } = makeBridge()
  await bridge.wake('c1')
  await bridge.wake('c2')

  const result = await bridge.disposeAll()

  assert.equal(result.disposed, 2)
  assert.deepEqual(result.failures, [])
  assert.equal(bridge.liveCount(), 0)
  assert.equal(factory.handles.every((h) => h.disposed), true, '每个会话都要被 dispose')
  assert.equal(transport.subscriberCount, 0, '卸载时要退订事件总线，不留监听位')
  assert.equal(bridge.isDisposed(), true)

  const afterDispose = await bridge.wake('c3')
  assert.equal(afterDispose.ok, false)
  assert.equal(afterDispose.code, 'disposed')
  assert.match(afterDispose.reason, /插件已卸载|世界已重开/)

  assert.equal((await bridge.disposeAll()).disposed, 0, '重复 disposeAll 是安全的')
})

test('bridge：disposeAll 里某个 dispose 抛错时，其余会话仍被释放且原因被记下', async () => {
  const factory = createFakeFactory()
  const { bridge } = makeBridge({ factory, options: {} })
  await bridge.wake('c1')
  // 让 c1 的 dispose 第一次抛
  factory.handles[0].dispose = async () => {
    throw new Error('dispose 炸了')
  }
  await bridge.wake('c2')

  const result = await bridge.disposeAll()

  assert.equal(result.disposed, 2)
  assert.equal(result.failures.length, 1)
  assert.equal(result.failures[0].characterId, 'c1')
  assert.match(result.failures[0].error, /dispose 炸了/)
  assert.equal(factory.handles[1].disposed, true, '别人不能被一个坏 dispose 连累')
})

test('bridge：体检还没回来时插件被卸载 → 绝不建出"马上就没人管"的会话', async () => {
  // 体检是异步的（生产环境要查远端模型目录）。这中间插件可能已经被卸载。
  let openGate
  const gate = new Promise((resolve) => {
    openGate = resolve
  })
  const { bridge, factory } = makeBridge({
    options: {
      checkReady: async () => {
        await gate
        return { ok: true }
      },
    },
  })

  const pending = bridge.wake('c1')
  await bridge.disposeAll()
  openGate()

  const result = await pending

  assert.equal(result.ok, false)
  assert.equal(result.code, 'disposed')
  assert.equal(factory.calls.length, 0, '卸载之后一个会话都不该建（否则就是没人能关掉的泄漏）')
  assert.equal(bridge.liveCount(), 0)
})

// ── 5. 失败要退化，不要卡住 ──────────────────────────────────────────────────

test('bridge：模型没配置 → 明确说"模型没配置"，且不建会话', async () => {
  const { bridge, factory } = makeBridge({
    options: {
      checkReady: () => ({
        ok: false,
        code: 'no-model',
        reason: '模型没配置：当前没有一个可路由的模型，角色说不出话。去 DSH 设置里选一个模型。',
      }),
    },
  })

  const result = await bridge.say('c1', '你好')

  assert.equal(result.ok, false)
  assert.equal(result.code, 'no-model')
  assert.match(result.reason, /模型没配置/)
  assert.match(result.reason, /设置/)
  assert.equal(factory.calls.length, 0)
})

test('bridge：会话创建失败 → 带上底层原因，且下一次还会重试（不卡死）', async () => {
  const factory = createFakeFactory({ failWith: new Error('provider 崩了') })
  const { bridge } = makeBridge({ factory })

  const first = await bridge.wake('c1')
  assert.equal(first.ok, false)
  assert.equal(first.code, 'create-failed')
  assert.match(first.reason, /会话创建失败：provider 崩了/)
  assert.equal(bridge.liveCount(), 0, '失败不留半个会话')

  // "退化而不是卡住"：下一次搭话必须重新尝试，而不是永久缓存这个失败。
  factory.failWith = undefined
  const second = await bridge.wake('c1')
  assert.equal(second.ok, true)
  assert.equal(factory.calls.length, 2)
})

test('bridge：没有会话服务 → service-unavailable', async () => {
  const { bridge, factory } = makeBridge({ transport: undefined })

  const result = await bridge.wake('c1')

  assert.equal(result.ok, false)
  assert.equal(result.code, 'service-unavailable')
  assert.match(result.reason, /sessionController|cordis|会话服务/)
  assert.equal(factory.calls.length, 0)
})

test('bridge：空消息在搭话之前就被挡下（不会白唤醒一个角色）', async () => {
  const { bridge, factory, transport } = makeBridge()

  for (const text of ['', '   ', '\n\t ']) {
    const result = await bridge.say('c1', text)
    assert.equal(result.ok, false)
    assert.equal(result.code, 'empty-input')
    assert.match(result.reason, /空的/)
  }

  assert.equal(factory.calls.length, 0, '空消息不该唤醒角色')
  assert.equal(transport.prompts.length, 0)
})

test('bridge：投递失败 → 带上 RemoteError 的 code，会话不丢', async () => {
  const transport = createFakeTransport()
  const { bridge, factory } = makeBridge({ transport })
  const busy = Object.assign(new Error('prompt rejected'), { code: 'session/agent-busy' })
  transport.failWith = busy

  const result = await bridge.say('c1', '你好')

  assert.equal(result.ok, false)
  assert.equal(result.code, 'prompt-failed')
  assert.match(result.reason, /session\/agent-busy/, '要把 DSH 的错误码原样带给用户')
  assert.equal(bridge.liveCount(), 1, '投递失败不该把已经建好的会话扔掉')
  assert.equal(factory.calls.length, 1)

  // 修好之后再说话，复用同一个会话。
  transport.failWith = undefined
  const retry = await bridge.say('c1', '再说一次')
  assert.equal(retry.ok, true)
  assert.equal(factory.calls.length, 1)
})

test('bridge：requestId 可以外部给定（幂等重发用），默认则自增', async () => {
  const { bridge, transport } = makeBridge()

  await bridge.say('c1', 'a', { requestId: 'fixed-1' })
  await bridge.say('c1', 'a', { requestId: 'fixed-1' })
  await bridge.say('c1', 'b')

  assert.equal(transport.prompts[0].request.requestId, 'fixed-1')
  assert.equal(transport.prompts[1].request.requestId, 'fixed-1', '同一个 requestId 语义上就是同一句')
  assert.notEqual(transport.prompts[2].request.requestId, 'fixed-1')
  assert.match(transport.prompts[2].request.requestId, /^agent-world-say:c1:\d+$/)
})

// ── 6. 收回复 ────────────────────────────────────────────────────────────────

test('bridge：waitForReply 拿到该角色说的那句话', async () => {
  const { bridge, transport } = makeBridge()
  await bridge.wake('c1')

  const pending = bridge.waitForReply('c1', { timeoutMs: 0 })
  transport.emit('agent-world:c1', assistantEvent('我这就去看看'))

  const result = await pending

  assert.equal(result.ok, true)
  assert.equal(result.reply.text, '我这就去看看')
  assert.equal(result.reply.characterId, 'c1')
  assert.equal(result.reply.turn, 1)
  assert.equal(result.reply.step, 1)
  assert.equal(result.reply.interrupted, false)
})

test('bridge：回复只送给对应的角色，别人的会话不会串味', async () => {
  const { bridge, transport } = makeBridge()
  await bridge.wake('c1')
  await bridge.wake('c2')

  const received = []
  bridge.onReply((reply) => received.push(reply.characterId))

  transport.emit('agent-world:c2', assistantEvent('给 c2 的'))
  transport.emit('agent-world:unknown', assistantEvent('没人认领的'))
  transport.emit('agent-world:c1', assistantEvent('给 c1 的'))

  assert.deepEqual(received, ['c2', 'c1'])
})

test('bridge：多个 text 块用空行连接；只有工具调用时不算回复', async () => {
  const { bridge, transport } = makeBridge()
  await bridge.wake('c1')

  const pending = bridge.waitForReply('c1', { timeoutMs: 0 })
  transport.emit(
    'agent-world:c1',
    assistantEvent('', {
      blocks: [
        { type: 'text', text: '第一段' },
        { type: 'tool-call', id: 't1', name: 'agent_world_dispatch', arguments: '{}' },
        { type: 'text', text: '第二段' },
      ],
    }),
  )

  const result = await pending
  assert.equal(result.ok, true)
  assert.equal(result.reply.text, '第一段\n\n第二段', '工具调用不能被当成话混进正文')
})

test('bridge：一轮 error 结束 → 等回复的人立刻拿到可下手的原因，不会一直挂着', async () => {
  const { bridge, transport } = makeBridge()
  await bridge.wake('c1')

  const pending = bridge.waitForReply('c1', { timeoutMs: 0 })
  transport.emit('agent-world:c1', turnEndEvent({ kind: 'error', error: { message: '401 unauthorized', code: 'auth' } }))

  const result = await pending

  assert.equal(result.ok, false)
  assert.equal(result.code, 'prompt-failed')
  assert.match(result.reason, /401 unauthorized/)
  assert.match(result.reason, /模型配置|稍后重试/)
})

test('bridge：release 时挂着的等待者立刻收到 released，不会转圈到超时', async () => {
  const { bridge, transport } = makeBridge()
  await bridge.wake('c1')

  const pending = bridge.waitForReply('c1', { timeoutMs: 0 })
  await bridge.release('c1')

  const result = await pending
  assert.equal(result.ok, false)
  assert.equal(result.code, 'released')
})

test('bridge：等回复超时给出"角色保持原来的行为"这种退化的说法', async () => {
  const { bridge } = makeBridge()
  await bridge.wake('c1')

  const result = await bridge.waitForReply('c1', { timeoutMs: 5 })

  assert.equal(result.ok, false)
  assert.equal(result.code, 'timeout')
  assert.match(result.reason, /保持原来的行为/)
})

test('bridge：onReply 返回的取消函数真的能退订', async () => {
  const { bridge, transport } = makeBridge()
  await bridge.wake('c1')

  const received = []
  const off = bridge.onReply((reply) => received.push(reply.text))
  transport.emit('agent-world:c1', assistantEvent('第一句'))
  off()
  transport.emit('agent-world:c1', assistantEvent('第二句'))

  assert.deepEqual(received, ['第一句'])
})

test('bridge：一个坏的回复监听器不会打断其它监听器', async () => {
  const errors = []
  const { bridge, transport } = makeBridge({ options: { onError: (reason) => errors.push(reason) } })
  await bridge.wake('c1')

  const received = []
  bridge.onReply(() => {
    throw new Error('监听器炸了')
  })
  bridge.onReply((reply) => received.push(reply.text))

  transport.emit('agent-world:c1', assistantEvent('您好'))

  assert.deepEqual(received, ['您好'])
  assert.equal(errors.length, 1)
  assert.match(errors[0], /监听器/)
})

// ── 7. 解码器的健壮性（事件总线上任何人都能 append） ───────────────────────────

test('decode：不接受伪造 / 残缺的事件', () => {
  assert.equal(decodeBridgeEvent('s', { type: 'assistant/message', seq: 1, time: 0, data: null }), undefined)
  assert.equal(decodeBridgeEvent('s', { type: 'assistant/message', seq: 1, time: 0, data: {} }), undefined)
  assert.equal(
    decodeBridgeEvent('s', {
      type: 'assistant/message',
      seq: 1,
      time: 0,
      data: { message: { role: 'user', content: [{ type: 'text', text: '不是他说的' }] } },
    }),
    undefined,
    'user/message 不能被当成回复',
  )
  assert.equal(
    decodeBridgeEvent('s', {
      type: 'assistant/message',
      seq: 1,
      time: 0,
      data: { message: { role: 'assistant', content: [{ type: 'tool-call' }] } },
    }),
    undefined,
    '只有工具调用时没有"话"',
  )
  assert.equal(decodeBridgeEvent('s', { type: 'totally/custom', seq: 1, time: 0, data: {} }), undefined)
  assert.equal(decodeBridgeEvent('s', { type: 'turn/end', seq: 1, time: 0, data: {} }), undefined)
})

test('decode：extractAssistantReply / extractTurnEnd 的形状', () => {
  assert.deepEqual(extractAssistantReply({ turn: 3, step: 2, message: { role: 'assistant', content: [{ type: 'text', text: 'x' }] } }), {
    text: 'x',
    turn: 3,
    step: 2,
    interrupted: false,
  })
  assert.equal(extractAssistantReply({ turn: 3, step: 2, message: { role: 'assistant', content: [] } }), null)

  assert.deepEqual(extractTurnEnd({ turn: 4, reason: { kind: 'completed' } }), {
    turn: 4,
    kind: 'completed',
    errorMessage: undefined,
  })
  assert.deepEqual(extractTurnEnd({ turn: 4, reason: { kind: 'max-tokens' } }), {
    turn: 4,
    kind: 'max-tokens',
    errorMessage: undefined,
  })
})

// ── 8. 生产适配器（用假 ctx 验，仍然不碰模型） ─────────────────────────────────

/** 假 cordis ctx：`get` 只认白名单服务，`on` 只认 `session/event`。 */
function createFakeCtx(services = {}) {
  const asked = []
  const listeners = new Set()
  return {
    asked,
    emitSessionEvent(session, event) {
      for (const listener of [...listeners]) listener(session, event)
    },
    get(key) {
      asked.push(key)
      return services[key]
    },
    on(name, listener) {
      if (name !== 'session/event') throw new Error(`假 ctx 没实现事件 ${name}`)
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
  }
}

test('adapter：createSessionTransport 把 prompt 转发给 sessionController', async () => {
  const recorded = []
  const sessionController = {
    async prompt(request, signal) {
      recorded.push({ request, signal })
      return { accepted: true }
    },
  }
  const ctx = createFakeCtx({ sessionController })
  const transport = createSessionTransport(ctx)

  assert.notEqual(transport, undefined)
  const signal = new AbortController().signal
  await transport.prompt({ requestId: 'r1', sessionId: 's1', mode: 'queue', content: [{ type: 'text', text: 'hi' }] }, signal)

  assert.equal(recorded.length, 1)
  assert.equal(recorded[0].request.requestId, 'r1')
  assert.equal(recorded[0].signal, signal, 'signal 必须原样透传（prompt 第一件事就是 throwIfAborted）')

  const received = []
  const off = transport.subscribe((sessionId, event) => received.push([sessionId, event.type]))
  ctx.emitSessionEvent({ id: 's1' }, assistantEvent('你好'))
  ctx.emitSessionEvent({ id: 's2' }, { type: 'turn/end', seq: 1, time: 0, data: { turn: 1, reason: { kind: 'completed' } } })
  ctx.emitSessionEvent('not-a-session', assistantEvent('会被丢掉'))
  ctx.emitSessionEvent({ id: 's1' }, null)
  off()
  ctx.emitSessionEvent({ id: 's1' }, assistantEvent('退订之后不该收到'))

  assert.deepEqual(received, [
    ['s1', 'assistant/message'],
    ['s2', 'turn/end'],
  ])
})

test('adapter：createAgentFactory 把 ownerCtx 原样传给 agentLoop', async () => {
  const recorded = []
  const agentLoop = {
    async createAgent(ownerCtx, options) {
      recorded.push({ ownerCtx, options })
      return { agent: { id: options.sessionId }, async dispose() {} }
    },
  }
  const ctx = createFakeCtx({ agentLoop })
  const factory = createAgentFactory(ctx)

  const handle = await factory.createAgent({ sessionId: 's1' })
  assert.equal(handle.agent.id, 's1')
  assert.equal(recorded[0].ownerCtx, ctx, 'ownerCtx 必须是插件自己的 ctx（生命周期归属）')
  assert.equal(recorded[0].options.sessionId, 's1')
})

test('adapter：缺服务时 createAgentFactory / createSessionTransport 返回 undefined', () => {
  const empty = createFakeCtx({})
  assert.equal(createAgentFactory(empty), undefined)
  assert.equal(createSessionTransport(empty), undefined)
  assert.equal(createAgentFactory(null), undefined)
  assert.equal(createSessionTransport({}), undefined)
})

test('adapter：normalizeSessionEvent 补齐 seq/time，非对象或没有 type 时返回 undefined', () => {
  assert.deepEqual(normalizeSessionEvent({ type: 'x' }), { type: 'x', seq: 0, time: 0 })
  assert.deepEqual(normalizeSessionEvent({ type: 'x', seq: 3, time: 9, data: { a: 1 } }), {
    type: 'x',
    seq: 3,
    time: 9,
    data: { a: 1 },
  })
  assert.equal(normalizeSessionEvent(null), undefined)
  assert.equal(normalizeSessionEvent({ seq: 1 }), undefined)
  assert.equal(normalizeSessionEvent('x'), undefined)
})

test('adapter：createDshCharacterBridge 缺 agentLoop 时给出可下手的原因，不抛', () => {
  const result = createDshCharacterBridge(createFakeCtx({}), { systemPromptFor: (id) => `你是 ${id}` })

  assert.equal(result.ok, false)
  assert.match(result.reason, /agentLoop/)
})

test('adapter：createDshCharacterBridge 装好之后走完整条链路（假 ctx，不碰模型）', async () => {
  const recorded = []
  const promptCalls = []
  const sessionController = {
    async modelCatalog() {
      return { default: { provider: 'p', model: 'm' }, routableProviders: ['p'], groups: [{ id: 'p' }], failures: [] }
    },
    async prompt(request) {
      promptCalls.push(request)
      return { accepted: true }
    },
  }
  const agentLoop = {
    async createAgent(ownerCtx, options) {
      recorded.push(options)
      return { agent: { id: options.sessionId }, async dispose() {} }
    },
  }
  const ctx = createFakeCtx({ agentLoop, sessionController })
  const wired = createDshCharacterBridge(ctx, { systemPromptFor: (id) => `你是角色 ${id}。`, maxLiveSessions: 3 })

  assert.equal(wired.ok, true)
  const { bridge } = wired

  await bridge.say('c1', '你好')
  await bridge.say('c1', '还在吗')

  assert.equal(recorded.length, 1, '★ 生产装配路径上也必须只建一次会话')
  assert.equal(promptCalls.length, 2)
  assert.deepEqual(recorded[0].seed[0].data.message.content, [{ type: 'text', text: '你是角色 c1。' }])

  // 只碰该碰的服务：没有任何"模型"服务被直接调用（角色只会通过 DSH 的会话走模型）。
  assert.deepEqual([...new Set(ctx.asked)].sort(), ['agentLoop', 'sessionController'])

  await bridge.disposeAll()
  assert.equal(bridge.liveCount(), 0)
})

test('adapter：checkModelReadiness 只在"一个可路由模型都没有"时拦', async () => {
  const noModel = createFakeCtx({
    sessionController: {
      async modelCatalog() {
        return {
          default: { provider: 'p', model: 'm' },
          routableProviders: [],
          groups: [],
          failures: [{ id: 'p', name: 'prov', message: '没有 API key' }],
        }
      },
    },
  })
  const verdict = await checkModelReadiness(noModel)
  assert.equal(verdict.ok, false)
  assert.equal(verdict.code, 'no-model')
  assert.match(verdict.reason, /模型没配置/)
  assert.match(verdict.reason, /没有 API key/, '要把 provider 报的原因带上，否则用户不知道从哪下手')

  const ok = createFakeCtx({
    sessionController: { async modelCatalog() { return { routableProviders: ['p'], groups: [{ id: 'p' }], failures: [] } } },
  })
  assert.equal((await checkModelReadiness(ok)).ok, true)

  const boom = createFakeCtx({
    sessionController: { async modelCatalog() { throw new Error('目录服务挂了') } },
  })
  assert.equal((await checkModelReadiness(boom)).ok, true, '探测失败不等于没有模型，不能冒充"没配置"')

  assert.equal((await checkModelReadiness(createFakeCtx({}))).code, 'service-unavailable')
})
