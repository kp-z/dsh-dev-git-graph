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
  buildPersonaSeed,
  buildSystemPromptSeed,
  SEED_STEP,
  SEED_SEQ,
  SEED_TURN,
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

/**
 * 发一条 assistant/message **再结束这一轮**（R35）。
 *
 * 结算点已从"第一条带文字的消息"移到"这一轮结束"：一轮做完才算回答完。
 * 所以任何"等回复"的用例都必须把轮次关上——否则它等的是一个永远不会到的结算点。
 */
function speak(transport, sessionId, text, options) {
  transport.emit(sessionId, assistantEvent(text, options))
  transport.emit(sessionId, turnEndEvent({ kind: 'completed' }, { turn: options?.turn ?? 1 }))
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
    // **死会话检测默认关掉**（R36）：它会在 `say` 里等最多 8 秒来确认"这条会话有没有反应"，
    // 而这里的假传输不产生任何事件，于是每条用例都要白等 8 秒。真实行为由三条专用用例
    // 打开 `deadSessionMs` 来验（它们才是这个机制的守卫）。生产默认仍是 8000。
    deadSessionMs: 0,
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

// ── 3. 人设：从内容进，挂在 agent 自己的 system prompt section 上（R33）────────────

/**
 * 跑一次 `setup`，把它注册的 section 记下来（模拟 agent 作用域里的 systemPrompt）。
 * 这是"人设真正生效的地方"——R33 之前我们把它塞进 seed，被 agent 每轮重新组装的
 * system prompt 覆盖，角色于是说成了别人的预设人格。
 */
function runSetup(createOptions) {
  const sections = []
  const agentCtx = {
    systemPrompt: {
      section(input) {
        sections.push(input)
        return () => {}
      },
      getSectionOrder: (name) => (name === 'DEPLOYMENT_PERSONA_PREFIX' ? 0 : undefined),
    },
  }
  createOptions.setup?.(agentCtx, { id: createOptions.sessionId })
  return sections
}

test('bridge：人设挂在 agent 自己的 section 上，文本正是 systemPromptFor 给的（不再走 seed）', async () => {
  const { bridge, factory } = makeBridge()

  await bridge.wake('c1')

  assert.equal(factory.calls.length, 1)
  const options = factory.calls[0]
  // **不再传 seed**：seed 里的 system 消息会被 agent 每轮重新组装的 prompt 覆盖（R33 真机）。
  assert.equal(options.seed, undefined, '人设不能再走 seed——那条路在真机上被覆盖了')
  assert.equal(typeof options.setup, 'function', '人设必须经 setup 挂到 agent 自己的作用域')

  const sections = runSetup(options)
  assert.equal(sections.length, 1, '只挂一个人设 section，不能出现两套人格')
  const [persona] = sections
  // 同名覆盖：必须与第三方预设人格同名，否则只是"再多一套人格"而不是"换掉它"。
  assert.equal(persona.name, 'deployment:persona')
  assert.equal(persona.order, 0)
  // 人设是内容：bridge 只是把调用方给的文本原样挂上，没有自己加任何一句。
  assert.equal(persona.text, '你是角色 c1。')
})

test('bridge：接回已有会话时**也**要重挂人设（section 是进程内注册，不随会话持久化）', async () => {
  const calls = []
  const factory = {
    calls,
    async createAgent() {
      throw new Error('session "x" already exists')
    },
    async resumeAgent(options) {
      calls.push(options)
      return { agent: { id: options.resumeSessionId }, async dispose() {} }
    },
  }
  // 用现成的 makeBridge（它带假传输通道；不给通道时 wake 会以 service-unavailable 失败）。
  const { bridge } = makeBridge({ factory })
  const result = await bridge.wake('c1')
  assert.equal(result.ok, true, `应当接回成功：${result.reason ?? ''}`)
  assert.equal(result.created, false)
  const sections = runSetup({ sessionId: calls[0].resumeSessionId, setup: calls[0].setup })
  assert.equal(sections.length, 1, '接回的会话没有人设 section，角色就会说成预设人格')
  assert.equal(sections[0].text, '你是角色 c1。')
})

test('bridge：会话没有 systemPrompt 服务时**不静默**——人设挂不上要让上层看见', async () => {
  const errors = []
  const { bridge, factory } = makeBridge({ options: { onError: (reason) => errors.push(reason) } })
  await bridge.wake('c1')
  factory.calls[0].setup({}, { id: 'x' })
  assert.equal(errors.length, 1)
  assert.match(errors[0], /人设挂不上/)
})

test('seed 构造：形状正确，空人设直接抛（内容错误要响）', () => {
  const seed = buildSystemPromptSeed('某段人设', { time: 7, messageId: 'm1' })
  assert.equal(seed.type, 'system/message')
  assert.equal(seed.seq, SEED_SEQ)
  assert.equal(seed.time, 7)
  assert.equal(seed.data.turn, SEED_TURN)
  assert.equal(seed.data.step, SEED_STEP)
  assert.ok(SEED_TURN > 0, '真宿主拒绝 turn=0')
  assert.equal(seed.data.message.id, 'm1')

  assert.throws(() => buildSystemPromptSeed('   ', { messageId: 'm1' }), /人设文本是空的/)
  assert.throws(() => buildSystemPromptSeed('', { messageId: 'm1' }), /人设文本是空的/)
})

test('buildPersonaSeed：框是闭合的，且人设那一条在框里', () => {
  const seed = buildPersonaSeed('某段人设', { messageId: 'm1' })
  assert.deepEqual(seed.map((e) => e.type), ['turn/start', 'step/start', 'system/message', 'step/end', 'turn/end'])
  // 框内的 turn/step 必须一致，否则 requireOpenStep 会拒
  for (const e of seed) {
    if (e.type === 'system/message') continue
    assert.equal(e.data.turn, SEED_TURN)
  }
  const msg = seed.find((e) => e.type === 'system/message')
  assert.equal(msg.data.turn, SEED_TURN)
  assert.equal(msg.data.step, SEED_STEP)
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
  speak(transport, 'agent-world:c1', '我这就去看看')

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
  // 一步里既有文字又有调用：工具调用不能被当成话混进正文。
  transport.emit(
    'agent-world:c1',
    assistantEvent('', {
      blocks: [
        { type: 'text', text: '第一段' },
        { type: 'tool-call', id: 't1', name: 'agent_world_dispatch', arguments: '{"taskSet":"task.quick-fix"}' },
        { type: 'text', text: '第二段' },
      ],
    }),
  )
  transport.emit('agent-world:c1', turnEndEvent({ kind: 'completed' }))

  const result = await pending
  assert.equal(result.ok, true)
  assert.equal(result.reply.text, '第一段\n\n第二段', '工具调用不能被当成话混进正文')
  assert.deepEqual(
    result.reply.actions,
    [{ name: 'agent_world_dispatch', detail: 'task.quick-fix', ok: true }],
    '同一条消息里的工具调用要进动作列表',
  )
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
  // R33：人设走 setup → section，不再走 seed。
  assert.equal(recorded[0].seed, undefined)
  assert.deepEqual(runSetup(recorded[0]).map((x) => x.text), ['你是角色 c1。'])

  // 只碰该碰的服务：没有任何"模型"服务被**直接调用**（角色只会通过 DSH 的会话走模型）。
  // `agentDefaultModel` 是 R30 加的**读**依赖：真宿主上不把模型写进 agent，
  // 组 system prompt 时 `{{model}}` 没有值，整轮报 "prompt variable "{{model}}" has no value"。
  assert.deepEqual([...new Set(ctx.asked)].sort(), ['agentDefaultModel', 'agentLoop', 'sessionController'])

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


// ── R30：模型选择必须真的传进 createAgent ─────────────────────────────────────

/** 一个最小的、会记录 createAgent 参数的 DSH 假环境（用现成的 createFakeCtx）。 */
function modelProbeCtx(agentDefaultModel) {
  const recorded = []
  const sessionController = {
    async modelCatalog() {
      // 目录要列出**实际会被选中的** provider：R31 起的就绪检查会核对这两者是否一致，
      // 而以前这个 fixture 是"选 p-1、只说 p 可用"——那种不自洽现在会被拦下（正确的行为）。
      return {
        default: { provider: 'p-1', model: 'm' },
        routableProviders: ['p', 'p-1'],
        groups: [{ id: 'p' }],
        failures: [],
      }
    },
    async prompt() {
      return { accepted: true }
    },
  }
  const agentLoop = {
    async createAgent(ownerCtx, options) {
      recorded.push(options)
      return { agent: { id: options.sessionId }, async dispose() {} }
    },
  }
  return { ctx: createFakeCtx({ agentLoop, sessionController, agentDefaultModel }), recorded }
}

test('adapter：把用户选的默认模型透传给 createAgent（少了它真宿主会拒）', async () => {
  const { ctx, recorded } = modelProbeCtx({
    currentSelection: () => ({ provider: 'p-1', model: 'm-1', reasoningEffort: 'high' }),
  })
  const result = createDshCharacterBridge(ctx, { systemPromptFor: () => '人设' })
  assert.equal(result.ok, true)
  await result.bridge.say('c1', '你好')
  assert.deepEqual(recorded[0].agentOptions, { provider: 'p-1', model: 'm-1', reasoningEffort: 'high' })
})

test('adapter：模型选择是**每次唤醒时**读的 —— 用户改了默认模型，下一个角色就用新的', async () => {
  let selection = { provider: 'p-1', model: 'old-model' }
  const { ctx, recorded } = modelProbeCtx({ currentSelection: () => selection })
  const result = createDshCharacterBridge(ctx, { systemPromptFor: () => '人设' })
  await result.bridge.say('c1', '你好')

  selection = { provider: 'p-1', model: 'new-model' }
  await result.bridge.say('c2', '你好')

  assert.equal(recorded[0].agentOptions.model, 'old-model')
  assert.equal(recorded[1].agentOptions.model, 'new-model', '不能把旧选择缓存住')
})

test('adapter：读不到默认模型时不崩 —— 不传 agentOptions，让宿主自己决定', async () => {
  const { ctx, recorded } = modelProbeCtx(undefined)
  const result = createDshCharacterBridge(ctx, { systemPromptFor: () => '人设' })
  await result.bridge.say('c1', '你好')
  assert.equal(recorded.length, 1)
  assert.equal(recorded[0].agentOptions, undefined)
})

// ── R30：会话已存在 → 接回，而不是失败或换新 id ─────────────────────────────

test('adapter：会话已存在时**接回**它（真宿主上持久化后会撞上 already exists）', async () => {
  const resumed = []
  const sessionController = {
    async modelCatalog() {
      return { default: { provider: 'p', model: 'm' }, routableProviders: ['p'], groups: [{ id: 'p' }], failures: [] }
    },
    async prompt() {
      return { accepted: true }
    },
  }
  const agentLoop = {
    async createAgent(ownerCtx, options) {
      throw new Error(`session "${options.sessionId}" already exists`)
    },
    async resume(ownerCtx, options) {
      resumed.push(options)
      return { agent: { id: options.resumeSessionId }, async dispose() {} }
    },
  }
  const ctx = createFakeCtx({ agentLoop, sessionController })
  const wired = createDshCharacterBridge(ctx, { systemPromptFor: () => '人设' })
  const result = await wired.bridge.wake('c1')

  assert.equal(result.ok, true, `应当接回成功：${result.reason ?? ''}`)
  assert.equal(result.created, false, 'created:false 表示这是接回的（角色记得上次说过的话）')
  assert.equal(resumed.length, 1)
  assert.equal(resumed[0].resumeSessionId, result.sessionId, '必须接回**同一个** id，不能换新的')
  assert.equal(wired.bridge.liveCount(), 1)
})

test('adapter：建与接回都失败时，两个原因**都**要出现在报错里', async () => {
  const sessionController = {
    async modelCatalog() {
      return { default: { provider: 'p', model: 'm' }, routableProviders: ['p'], groups: [{ id: 'p' }], failures: [] }
    },
    async prompt() {
      return { accepted: true }
    },
  }
  const agentLoop = {
    async createAgent() {
      throw new Error('建不起来-A')
    },
    async resume() {
      throw new Error('接不回来-B')
    },
  }
  const wired = createDshCharacterBridge(createFakeCtx({ agentLoop, sessionController }), { systemPromptFor: () => '人设' })
  const result = await wired.bridge.wake('c1')
  assert.equal(result.ok, false)
  assert.match(result.reason, /建不起来-A/)
  assert.match(result.reason, /接不回来-B/)
})

test('adapter：宿主没有 resume（无持久化后端）时，照常报原始原因', async () => {
  const sessionController = {
    async modelCatalog() {
      return { default: { provider: 'p', model: 'm' }, routableProviders: ['p'], groups: [{ id: 'p' }], failures: [] }
    },
    async prompt() {
      return { accepted: true }
    },
  }
  const agentLoop = {
    async createAgent() {
      throw new Error('建不起来-A')
    },
  }
  const wired = createDshCharacterBridge(createFakeCtx({ agentLoop, sessionController }), { systemPromptFor: () => '人设' })
  const result = await wired.bridge.wake('c1')
  assert.equal(result.ok, false)
  assert.match(result.reason, /建不起来-A/)
  assert.doesNotMatch(result.reason, /接回/)
})

// ── R30：会话工作目录（真宿主上 {{cwd}} 必须有值）─────────────────────────────

test('adapter：cwd 放进 createAgent 的 options.meta，且只带绝对路径', async () => {
  const seen = []
  const sessionController = {
    async modelCatalog() {
      return { default: { provider: 'p', model: 'm' }, routableProviders: ['p'], groups: [{ id: 'p' }], failures: [] }
    },
    async prompt() {
      return { accepted: true }
    },
  }
  const agentLoop = {
    async createAgent(ownerCtx, options) {
      seen.push(options)
      return { agent: { id: options.sessionId }, async dispose() {} }
    },
  }
  const wired = createDshCharacterBridge(createFakeCtx({ agentLoop, sessionController }), {
    systemPromptFor: () => '人设',
    cwdFor: () => '/tmp/some-workspace',
  })
  await wired.bridge.say('c1', '你好')
  assert.deepEqual(seen[0].meta, { cwd: '/tmp/some-workspace' }, 'cwd 必须放进 options.meta')
  assert.equal(seen[0].cwd, undefined, 'cwd 不该作为顶层字段传下去')
})

test('adapter：拿到相对路径就**不传** —— 宿主会拒绝非绝对路径，宁可让它报缺 {{cwd}}', async () => {
  const seen = []
  const sessionController = {
    async modelCatalog() {
      return { default: { provider: 'p', model: 'm' }, routableProviders: ['p'], groups: [{ id: 'p' }], failures: [] }
    },
    async prompt() {
      return { accepted: true }
    },
  }
  const agentLoop = {
    async createAgent(ownerCtx, options) {
      seen.push(options)
      return { agent: { id: options.sessionId }, async dispose() {} }
    },
  }
  const wired = createDshCharacterBridge(createFakeCtx({ agentLoop, sessionController }), {
    systemPromptFor: () => '人设',
    cwdFor: () => '.agent-world',
  })
  await wired.bridge.say('c1', '你好')
  assert.equal(seen[0].meta, undefined, '相对路径不该被当成工作目录传下去')
})

// ── R31：就绪检查要校验"选中的那个"provider，而不是"任何一个"──────────────────

test('checkModelReadiness：选中的 provider 不在可路由列表里 → 搭话前就拦下，并列出可用的', async () => {
  const ctx = createFakeCtx({
    sessionController: {
      async modelCatalog() {
        return { routableProviders: ['deepseek-official', 'mmt'], groups: [{ id: 'x' }], failures: [] }
      },
    },
  })
  const r = await checkModelReadiness(ctx, { provider: 'mmt-vision' })
  assert.equal(r.ok, false)
  assert.equal(r.code, 'no-model')
  assert.match(r.reason, /mmt-vision/, '要说出选的是谁')
  assert.match(r.reason, /deepseek-official、mmt/, '要列出可用的')
})

test('checkModelReadiness：选中的 provider 可路由 → 放行', async () => {
  const ctx = createFakeCtx({
    sessionController: {
      async modelCatalog() {
        return { routableProviders: ['mmt'], groups: [{ id: 'x' }], failures: [] }
      },
    },
  })
  assert.equal((await checkModelReadiness(ctx, { provider: 'mmt' })).ok, true)
})

test('checkModelReadiness：不知道选了谁时，退回旧判据（不因缺信息而误拦）', async () => {
  const ctx = createFakeCtx({
    sessionController: {
      async modelCatalog() {
        return { routableProviders: ['mmt'], groups: [{ id: 'x' }], failures: [] }
      },
    },
  })
  assert.equal((await checkModelReadiness(ctx)).ok, true)
  assert.equal((await checkModelReadiness(ctx, {})).ok, true)
})

// ── R34（G4）：角色只许用世界工具 —— D35 由工具注册表强制，而不是靠提示词 ──────────

function runSetupWithTools(createOptions, visible) {
  const restricted = []
  const agentCtx = {
    systemPrompt: { section: () => () => {}, getSectionOrder: () => 0 },
    tools: {
      restrict: (filter) => (restricted.push(filter), () => {}),
      get: (name) => (visible.includes(name) ? { name } : undefined),
    },
  }
  createOptions.setup?.(agentCtx, { id: createOptions.sessionId })
  return restricted
}

test('G4：角色 agent 在自己的作用域里被限制为只用世界工具（拿不到 bash/写文件）', async () => {
  const { bridge, factory } = makeBridge({
    options: { characterTools: ['agent_world_status', 'agent_world_content', 'agent_world_dispatch'] },
  })
  await bridge.wake('c1')
  const restricted = runSetupWithTools(factory.calls[0], ['agent_world_status', 'agent_world_content', 'agent_world_dispatch', 'bash'])
  assert.equal(restricted.length, 1, '必须恰好限制一次')
  assert.deepEqual(restricted[0].allow, ['agent_world_status', 'agent_world_content', 'agent_world_dispatch'])
  assert.ok(!restricted[0].allow.includes('bash'))
})

test('G4：allow 先按可见性过滤 —— restrict 遇到未知名字会抛，没注册的工具不能让角色建不起来', async () => {
  const { bridge, factory } = makeBridge({ options: { characterTools: ['agent_world_status', 'agent_world_dispatch'] } })
  await bridge.wake('c1')
  const restricted = runSetupWithTools(factory.calls[0], ['agent_world_status'])
  assert.deepEqual(restricted[0].allow, ['agent_world_status'])
})

test('G4：一个世界工具都看不见、或没有 tools 服务时**不静默**', async () => {
  const errors = []
  const { bridge, factory } = makeBridge({
    options: { characterTools: ['agent_world_dispatch'], onError: (r) => errors.push(r) },
  })
  await bridge.wake('c1')
  assert.deepEqual(runSetupWithTools(factory.calls[0], []), [], '空 allow 不能传（契约：空过滤器会抛）')
  factory.calls[0].setup({ systemPrompt: { section: () => () => {} } }, { id: 'x' })
  assert.equal(errors.length, 2)
  assert.match(errors[0], /一个都没注册/)
  assert.match(errors[1], /没能限制/)
})

test('G4：不配 characterTools 时保持旧行为（不限制）', async () => {
  const { bridge, factory } = makeBridge()
  await bridge.wake('c1')
  assert.deepEqual(runSetupWithTools(factory.calls[0], ['bash']), [])
})

// ── R36（M6-14）：死会话自愈 ─────────────────────────────────────────────────
//
// 真机：resume 回来的旧 seed 会话，宿主照样回 accepted:true，但**一条事件都不落**，
// 于是用户干等 60 秒超时。健康会话发话后 4ms 就落第一条事件。

/** 一个"已存在、只能 resume"的工厂：第一次 createAgent 一律报 already exists。 */
function resumeOnlyFactory() {
  const created = []
  const resumed = []
  return {
    calls: created,
    resumed,
    async createAgent(options) {
      // 原 id 已存在（落在磁盘上的旧会话）；换了代次的新 id 能建。
      if (!options.sessionId.includes('~')) throw new Error(`session "${options.sessionId}" already exists`)
      created.push(options)
      return { agent: { id: options.sessionId }, async dispose() {} }
    },
    async resumeAgent(options) {
      resumed.push(options)
      return { agent: { id: options.resumeSessionId }, async dispose() {} }
    },
  }
}

test('M6-14：接回的会话发话后没有任何事件 → 判死、换新 id 重建、重发（旧会话不动）', async () => {
  const errors = []
  const factory = resumeOnlyFactory()
  const { bridge, transport } = makeBridge({ factory, options: { deadSessionMs: 60, onError: (r) => errors.push(r) } })

  const result = await bridge.say('c1', '在吗')

  assert.equal(result.ok, true, `应当自愈成功：${result.reason ?? ''}`)
  assert.equal(factory.resumed.length, 1, '先接回旧会话')
  assert.equal(factory.calls.length, 1, '判死后建了一条新的')
  assert.equal(result.sessionId, 'agent-world:c1~2', '新会话必须换 id，否则会撞回那条死的')
  assert.equal(transport.prompts.length, 2, '两次投递：死会话一次、新会话一次')
  assert.equal(transport.prompts[1].request.sessionId, 'agent-world:c1~2')
  assert.match(errors.join('\n'), /不起新轮/, '自愈要说出来，不能静默')
})

test('M6-14：接回的会话**有**事件 → 不判死、不重建（健康角色行为不变）', async () => {
  const factory = resumeOnlyFactory()
  const { bridge, transport } = makeBridge({ factory, options: { deadSessionMs: 500 } })
  // 投递一发生就回一条事件——模拟健康会话 4ms 落 inbox/spliced。
  const prompt = transport.prompt.bind(transport)
  transport.prompt = async (request, signal) => {
    const r = await prompt(request, signal)
    setTimeout(() => transport.emit(request.sessionId, { type: 'agent/inbox/spliced', seq: 1, time: 0, data: {} }), 5)
    return r
  }

  const started = Date.now()
  const result = await bridge.say('c1', '在吗')
  assert.equal(result.ok, true)
  assert.equal(result.sessionId, 'agent-world:c1', '健康会话不换 id')
  assert.equal(factory.calls.length, 0, '不重建')
  assert.equal(transport.prompts.length, 1, '只投递一次')
  assert.ok(Date.now() - started < 400, '有事件就立刻放行，不等满检测窗口')
})

test('M6-14：新建的会话不做死会话检查（新会话不可能是"旧状态卡死"）', async () => {
  const { bridge, transport } = makeBridge({ options: { deadSessionMs: 5000 } })
  const started = Date.now()
  const result = await bridge.say('c1', '在吗')
  assert.equal(result.ok, true)
  assert.equal(result.created, true)
  assert.equal(transport.prompts.length, 1)
  assert.ok(Date.now() - started < 1000, '新会话不应该等那 5 秒')
})

test('M6-14：本进程里早就活着的会话**不做**死会话检查（第二句话不应多等）', async () => {
  const factory = resumeOnlyFactory()
  const { bridge, transport } = makeBridge({ factory, options: { deadSessionMs: 3000 } })
  // 第一句：接回 → 有事件 → 健康
  const prompt = transport.prompt.bind(transport)
  transport.prompt = async (request, signal) => {
    const r = await prompt(request, signal)
    if (transport.prompts.length === 1) {
      setTimeout(() => transport.emit(request.sessionId, { type: 'agent/inbox/spliced', seq: 1, time: 0, data: {} }), 5)
    }
    return r
  }
  await bridge.say('c1', '第一句')
  // 第二句：会话已经活着；这次**不发任何事件**，若还在检查就会等满 3 秒
  const started = Date.now()
  const second = await bridge.say('c1', '第二句')
  assert.equal(second.ok, true)
  assert.equal(second.sessionId, 'agent-world:c1', '复用同一条会话，不换 id')
  assert.ok(Date.now() - started < 1000, `复用中的会话不该再等检测窗口（用了 ${Date.now() - started}ms）`)
})
