/**
 * 对话通道（`POST /api/say`）的测试 —— M6-3 宿主侧。
 *
 * ## 为什么这些用例不在 `acceptance-m6.test.js` 里
 *
 * 验证者那份验收测试跑在**没有 Agent 服务的环境**里（`makeDeps` 只给
 * `{service, runtime, source, tickMs}`）。那条路径只能覆盖"登记对话 + 立刻回响应"，
 * 覆盖不到**真的接上一个对话端口之后**会发生什么：
 *
 * - `replied`：模型回话了 → 必须把 agent→god 的 `replied` 事件推出去；
 * - `failed`：端口拒绝（模型没配置 / 会话建不出来）→ 必须把**那个原因**原样推出去；
 * - 端口自己抛异常 → 也必须有 `failed`，绝不能让面板永远停在"他在想"。
 *
 * 这三种正是"失败要退化，不要卡住"（红线第 6 条）在传输层的落点，
 * 所以本文件用**假端口**把它们钉住：一次模型调用都不会发生。
 *
 * SSE 的接线（`type:'dialogue'` 帧真的进了 `/api/events` 那条流）由验证者的
 * `acceptance-m6.test.js` 覆盖，这里不重复造一份（重复的验收测试只会互相漂移）。
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'

import { createDialogueChannel } from '../lib/routes/dialogue.js'

// ── 假对象 ────────────────────────────────────────────────────────────────────

/** 假世界服务：只需要 `currentWorld()` 与 `config.maxLiveSessions`。 */
function fakeService({ tick = 7, agents = ['agent-1', 'agent-2'], maxLiveSessions, noWorld = false } = {}) {
  const world = { tick, seq: 100, paused: false, agents: agents.map((id) => ({ id })) }
  return {
    tickMs: 100,
    config: maxLiveSessions === undefined ? {} : { maxLiveSessions },
    currentWorld: () => (noWorld ? null : world),
  }
}

/** 假对话端口。`sayFails` / `replyFails` / `throws` 用来演三条失败路径。 */
function fakePort(script = {}) {
  const says = []
  const waits = []
  return {
    says,
    waits,
    async say(characterId, text) {
      says.push({ characterId, text })
      if (script.throws === 'say') throw new Error('端口炸了')
      if (script.sayFails !== undefined) return { ok: false, reason: script.sayFails }
      return { ok: true }
    },
    async waitForReply(characterId, timeoutMs, onProgress) {
      waits.push({ characterId, timeoutMs })
      if (script.throws === 'wait') throw new Error('等回复时炸了')
      if (script.replyFails !== undefined) return { ok: false, reason: script.replyFails }
      for (const actions of script.progress ?? []) onProgress?.(actions)
      return { ok: true, text: script.reply ?? '我这就去看看', actions: script.actions ?? [] }
    },
    liveCount: () => says.length,
  }
}

/** 收集通道上推出来的事件。 */
function collect(channel) {
  const events = []
  const off = channel.subscribe((event) => events.push(event))
  return { events, off }
}

/** 让 fire-and-forget 的那一轮跑完（假端口全是立即 resolve 的 promise）。 */
function settle() {
  return new Promise((resolve) => setTimeout(resolve, 0))
}

/** 取某个阶段的事件。 */
function ofPhase(events, phase) {
  return events.filter((event) => event.phase === phase)
}

// ── 1. 登记（同步部分） ──────────────────────────────────────────────────────

test('say：合法搭话同步返回 turnId，并立刻推一条 thinking', () => {
  const channel = createDialogueChannel({ service: fakeService(), port: fakePort() })
  const { events } = collect(channel)

  const response = channel.parseSay({ agentId: 'agent-1', text: '你去把登录 bug 修一下' })

  assert.equal(response.accepted, true)
  assert.equal(typeof response.turnId, 'string')
  assert.ok(response.turnId.length > 0)

  // "发送是同步的"（契约第 17–28 行）：返回值不能是 Promise，否则 HTTP 层就得等它。
  assert.equal(typeof response.then, 'undefined', 'parseSay 必须是同步的')

  const thinking = ofPhase(events, 'thinking')
  assert.equal(thinking.length, 1, '登记时必须立刻推一条 thinking，面板才知道"他在想"')
  const event = thinking[0]
  assert.equal(event.turnId, response.turnId, 'thinking 的 turnId 必须与响应一致')
  assert.equal(event.tick, 7, 'tick 必须取**世界 tick**（D38），不是墙上时间')
  assert.deepEqual(event.from, { kind: 'god' })
  assert.deepEqual(event.to, { kind: 'agent', id: 'agent-1' })
  assert.equal(event.text, '你去把登录 bug 修一下', 'thinking 要带提问者原话（同一条流上的第二个面板也要看得到）')
})

test('say：两次搭话拿到不同的 turnId', () => {
  const channel = createDialogueChannel({ service: fakeService(), port: fakePort() })

  const first = channel.parseSay({ agentId: 'agent-1', text: '第一句' })
  const second = channel.parseSay({ agentId: 'agent-1', text: '第二句' })

  assert.notEqual(first.turnId, second.turnId)
})

test('say：三类拒绝各自给出可下手的原因，且都不建会话', () => {
  const port = fakePort()
  const channel = createDialogueChannel({ service: fakeService(), port })

  const ghost = channel.parseSay({ agentId: 'agent-9999', text: '在吗' })
  assert.equal(ghost.accepted, false)
  assert.match(ghost.reason, /不存在/)
  assert.ok(ghost.reason.includes('agent-9999'), '要说清被拒的是哪个 id')
  assert.ok(ghost.reason.includes('agent-1'), '也要给出可用取值，否则用户没法照做')

  const blank = channel.parseSay({ agentId: 'agent-1', text: '   ' })
  assert.equal(blank.accepted, false)
  assert.match(blank.reason, /空/)

  const malformed = channel.parseSay(null)
  assert.equal(malformed.accepted, false)
  assert.match(malformed.reason, /请求体/)

  assert.equal(port.says.length, 0, '被拒的搭话一条都不该投出去')
})

// ── 1b. `SayRequest` 契约校验（结构 vs 语义必须分开报） ──────────────────────

test('契约：请求体必须先是 SayRequest 那个形状，字段类型不对要说清是哪个字段', () => {
  const port = fakePort()
  const channel = createDialogueChannel({ service: fakeService(), port })

  const cases = [
    { body: undefined, pattern: /请求体/, what: '没有请求体' },
    { body: 'agent-1', pattern: /请求体/, what: '发了个字符串' },
    { body: ['agent-1', '你好'], pattern: /数组/, what: '发了个数组' },
    { body: {}, pattern: /agentId/, what: '缺 agentId' },
    { body: { agentId: 42, text: '你好' }, pattern: /agentId/, what: 'agentId 是数字' },
    { body: { agentId: '  ', text: '你好' }, pattern: /agentId/, what: 'agentId 是空白' },
    { body: { agentId: 'agent-1' }, pattern: /text/, what: '缺 text' },
    { body: { agentId: 'agent-1', text: 42 }, pattern: /text/, what: 'text 是数字' },
  ]

  for (const { body, pattern, what } of cases) {
    const response = channel.parseSay(body)
    assert.equal(response.accepted, false, `${what} 必须被拒`)
    assert.match(response.reason, pattern, `${what} 的 reason 要指出是哪个字段：${response.reason}`)
    assert.ok(response.reason.trim().length > 0)
  }

  // 可下手：缺/错 agentId 时要告诉用户去哪儿找合法取值。
  assert.match(channel.parseSay({}).reason, /world\.agents|api\/world/, '要指出去哪拿可用取值')

  assert.equal(port.says.length, 0, '结构不对的请求一条都不该投出去')
})

test('契约：结构错误与语义错误是两条不同的原因（不能混成一句"参数错误"）', () => {
  const channel = createDialogueChannel({ service: fakeService(), port: fakePort() })

  // 全空白文本是**结构合法**的（text 是字符串），所以必须报"文本为空"这条语义原因，
  // 而不是被结构校验吞掉。分开报，用户才知道自己该改什么。
  const blank = channel.parseSay({ agentId: 'agent-1', text: '   ' })
  assert.equal(blank.accepted, false)
  assert.match(blank.reason, /空/)
  assert.doesNotMatch(blank.reason, /请求体|要是字符串/, '语义问题不该报成结构问题')

  const ghost = channel.parseSay({ agentId: 'agent-404', text: '在吗' })
  assert.equal(ghost.accepted, false)
  assert.match(ghost.reason, /不存在/)
})

test('契约：多余字段被容忍（只要求契约字段齐全且类型对）', () => {
  const channel = createDialogueChannel({ service: fakeService(), port: fakePort() })

  const response = channel.parseSay({ agentId: 'agent-1', text: '你好', extra: 1 })

  assert.equal(response.accepted, true, '多一个字段不该把请求拒掉——契约没禁止，拒了只会让面板更难改')
})

test('say：世界没建出来时给出原因，而不是抛', () => {
  const channel = createDialogueChannel({ service: fakeService({ noWorld: true }), port: fakePort() })

  const response = channel.parseSay({ agentId: 'agent-1', text: '你好' })

  assert.equal(response.accepted, false)
  assert.match(response.reason, /世界/)
})

// ── 2. 上限（D36）────────────────────────────────────────────────────────────

test('上限：从 service.config.maxLiveSessions 读，超了给阈值', () => {
  const channel = createDialogueChannel({ service: fakeService({ maxLiveSessions: 1 }), port: fakePort() })

  assert.equal(channel.parseSay({ agentId: 'agent-1', text: '你先去工位' }).accepted, true)

  const second = channel.parseSay({ agentId: 'agent-2', text: '你也去' })
  assert.equal(second.accepted, false)
  assert.match(second.reason, /\d/, 'reason 里要有阈值数字')
  assert.match(second.reason, /上限|唤醒|maxLiveSessions/i)
  assert.equal(channel.awakeCount(), 1)
})

test('上限：同一角色说十句话只占一个名额', () => {
  const channel = createDialogueChannel({ service: fakeService({ maxLiveSessions: 1 }), port: fakePort() })

  for (let i = 0; i < 10; i++) {
    assert.equal(
      channel.parseSay({ agentId: 'agent-1', text: `第 ${i} 句` }).accepted,
      true,
      '同一个角色已经醒着，不再占新名额',
    )
  }
  assert.equal(channel.awakeCount(), 1)
  // 另一个角色才撞上限
  assert.equal(channel.parseSay({ agentId: 'agent-2', text: '在吗' }).accepted, false)
})

test('上限：显式覆盖优先于 service.config，缺配置时退回默认 4', () => {
  const overridden = createDialogueChannel({
    service: fakeService({ maxLiveSessions: 99 }),
    port: fakePort(),
    maxLiveSessions: 1,
  })
  assert.equal(overridden.parseSay({ agentId: 'agent-1', text: 'a' }).accepted, true)
  assert.equal(overridden.parseSay({ agentId: 'agent-2', text: 'b' }).accepted, false, '覆盖值必须是 1')

  const fallback = createDialogueChannel({
    service: fakeService({ agents: ['agent-1', 'agent-2', 'agent-3', 'agent-4', 'agent-5'] }),
    port: fakePort(),
  })
  for (const id of ['agent-1', 'agent-2', 'agent-3', 'agent-4']) {
    assert.equal(fallback.parseSay({ agentId: id, text: 'x' }).accepted, true, `${id} 应当在默认上限 4 之内`)
  }
  assert.equal(fallback.parseSay({ agentId: 'agent-5', text: 'x' }).accepted, false, '第 5 个应当撞默认上限')
})

test('reset：世界重开时清空登记，名额与 turnId 都从头开始', () => {
  const channel = createDialogueChannel({ service: fakeService({ maxLiveSessions: 1 }), port: fakePort() })

  const first = channel.parseSay({ agentId: 'agent-1', text: 'a' })
  assert.equal(channel.parseSay({ agentId: 'agent-2', text: 'b' }).accepted, false)

  channel.reset()
  assert.equal(channel.awakeCount(), 0)

  const afterReset = channel.parseSay({ agentId: 'agent-2', text: 'b' })
  assert.equal(afterReset.accepted, true, 'reset 之后名额要还回来')
  assert.equal(afterReset.turnId, first.turnId, 'turnId 计数也重置（同一局内不会撞，新一局从头算）')
})

// ── 3. 回复与失败（异步部分）─────────────────────────────────────────────────

test('replied：模型回话后推一条 agent→god 的 replied，正文原样带出', async () => {
  const port = fakePort({ reply: '登录那个我修好了' })
  const channel = createDialogueChannel({ service: fakeService(), port })
  const { events } = collect(channel)

  const response = channel.parseSay({ agentId: 'agent-1', text: '你去把登录 bug 修一下' })
  await settle()

  assert.deepEqual(port.says, [{ characterId: 'agent-1', text: '你去把登录 bug 修一下' }])

  const replied = ofPhase(events, 'replied')
  assert.equal(replied.length, 1)
  assert.equal(replied[0].turnId, response.turnId)
  assert.equal(replied[0].text, '登录那个我修好了')
  assert.deepEqual(replied[0].from, { kind: 'agent', id: 'agent-1' })
  assert.deepEqual(replied[0].to, { kind: 'god' })

  assert.deepEqual(
    events.map((event) => event.phase),
    ['thinking', 'replied'],
    '顺序必须是 thinking 在前（面板先显示"他在想"）',
  )
})

test('failed：端口拒绝投递时，把那句原因原样推出去（模型没配置就走这条）', async () => {
  const channel = createDialogueChannel({
    service: fakeService(),
    port: fakePort({ sayFails: '模型没配置：当前没有一个可路由的模型，角色说不出话。' }),
  })
  const { events } = collect(channel)

  channel.parseSay({ agentId: 'agent-1', text: '你好' })
  await settle()

  const failed = ofPhase(events, 'failed')
  assert.equal(failed.length, 1)
  assert.match(failed[0].reason, /模型没配置/, '端口给的原因必须原样到达面板，不能被换成"失败了"')
  assert.equal(failed[0].text, '', 'failed 时正文为空')
  assert.equal(ofPhase(events, 'replied').length, 0)
})

test('failed：等回复失败（超时/会话被释放）也走同一条路', async () => {
  const channel = createDialogueChannel({
    service: fakeService(),
    port: fakePort({ replyFails: '等了 60000ms 还没等到回复：模型可能很慢或没有响应。' }),
  })
  const { events } = collect(channel)

  channel.parseSay({ agentId: 'agent-1', text: '你好' })
  await settle()

  assert.equal(ofPhase(events, 'replied').length, 0)
  const failed = ofPhase(events, 'failed')
  assert.equal(failed.length, 1)
  assert.match(failed[0].reason, /还没等到回复/)
})

test('failed：没有对话端口时也必须收场（headless profile 的真实路径）', async () => {
  const channel = createDialogueChannel({ service: fakeService() })
  const { events } = collect(channel)

  const response = channel.parseSay({ agentId: 'agent-1', text: '你好' })
  await settle()

  assert.equal(response.accepted, true, '登记仍然要成功：话收到了就是收到了')
  const failed = ofPhase(events, 'failed')
  assert.equal(failed.length, 1)
  assert.match(failed[0].reason, /会话服务|对话通道/, '要说清是"没有会话服务"，不是含糊的失败')
})

test('failed：端口自己抛异常时也要收场，绝不能让面板永远停在"他在想"', async () => {
  const channel = createDialogueChannel({ service: fakeService(), port: fakePort({ throws: 'say' }) })
  const { events } = collect(channel)

  channel.parseSay({ agentId: 'agent-1', text: '你好' })
  await settle()

  const failed = ofPhase(events, 'failed')
  assert.equal(failed.length, 1)
  assert.match(failed[0].reason, /端口炸了/)
})

test('等待超时会原样透传给端口（测试/面板可调短，生产 60s）', async () => {
  const port = fakePort()
  const channel = createDialogueChannel({ service: fakeService(), port, replyTimeoutMs: 1234 })

  channel.parseSay({ agentId: 'agent-1', text: '你好' })
  await settle()

  assert.equal(port.waits.length, 1)
  assert.equal(port.waits[0].timeoutMs, 1234)
})

// ── 4. 订阅与投递隔离 ───────────────────────────────────────────────────────

test('订阅：取消之后不再收到事件；一个坏监听器不影响别人', () => {
  const errors = []
  const channel = createDialogueChannel({
    service: fakeService(),
    port: fakePort(),
    onError: (reason) => errors.push(reason),
  })

  const good = []
  const offBad = channel.subscribe(() => {
    throw new Error('面板的监听器炸了')
  })
  channel.subscribe((event) => good.push(event.phase))

  channel.parseSay({ agentId: 'agent-1', text: '你好' })
  assert.deepEqual(good, ['thinking'])
  assert.equal(errors.length, 1)
  assert.match(errors[0], /监听器/)

  offBad()
  channel.parseSay({ agentId: 'agent-1', text: '再来一句' })
  assert.deepEqual(good, ['thinking', 'thinking'], '取消订阅之后不该再有回调')
})

test('多面板：两个订阅者都收到同一段对话（D38：不是私有旁路）', () => {
  const channel = createDialogueChannel({ service: fakeService(), port: fakePort() })
  const a = collect(channel)
  const b = collect(channel)

  const response = channel.parseSay({ agentId: 'agent-1', text: '你好' })

  for (const view of [a, b]) {
    assert.equal(view.events.length, 1)
    assert.equal(view.events[0].turnId, response.turnId)
  }
})
