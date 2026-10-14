/**
 * SSE 事件流测试（BACKLOG M3-4）。
 *
 * 这一层最容易错的三处，测试就盯这三处：
 * 1. **断线续传**（`Last-Event-ID`）：补得了就补、补不了就说补不了——
 *    假装能补的后果是客户端**静默**丢一段历史。
 * 2. **订阅泄漏**：连接断开必须摘订阅，否则热重载后每改一次代码就多一个订阅者。
 * 3. **慢客户端**：不能靠缓冲养着它，否则内存随一个卡住的浏览器无限增长。
 */
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { createServer } from 'node:http'
import { test } from 'node:test'

import { createEventHub, createRuntime } from '../lib/runtime/index.js'
import { createHandler } from '../lib/routes/index.js'
import { createPluginState } from '../lib/state.js'
import { resolveConfig } from '../lib/config.js'
import { eventsRoutes, sseComment, sseFrame } from '../lib/routes/events.js'
import { emitEvent } from '../lib/sim/journal.js'

const PREFIX = '/agent-world'

async function withServer(handler, fn) {
  const server = createServer(handler)
  await new Promise((r) => server.listen(0, '127.0.0.1', r))
  const { port } = server.address()
  try {
    return await fn(`http://127.0.0.1:${port}`)
  } finally {
    await new Promise((r) => server.close(r))
  }
}

function makeDeps() {
  const service = createPluginState(resolveConfig({ autoStart: false, persistEveryTicks: 0 }))
  service.ensureWorld()
  service.dispatch('task.quick-fix')
  const hub = createEventHub()
  const runtime = createRuntime({ service, tickMs: 100, sink: hub })
  const handler = createHandler(PREFIX, { service, runtime, source: hub, tickMs: 100 })
  return { service, runtime, hub, handler }
}

/**
 * 打开一条 SSE 连接，按帧解析。
 *
 * 返回 `frames`（已解析）与 `waitFor(n)`（等到至少 n 帧）。测试结束前要 `close()`，
 * 否则服务器 `close()` 会一直等这条长连接——那会让测试挂住。
 */
async function openSse(base, { lastEventId } = {}) {
  const controller = new AbortController()
  const res = await fetch(`${base}${PREFIX}/api/events`, {
    signal: controller.signal,
    headers: lastEventId === undefined ? {} : { 'Last-Event-ID': String(lastEventId) },
  })
  assert.equal(res.status, 200)
  assert.match(res.headers.get('content-type'), /text\/event-stream/)
  assert.match(res.headers.get('cache-control'), /no-cache/)

  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  const frames = []
  let buffer = ''

  const pump = (async () => {
    for (;;) {
      const { value, done } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      // SSE 以空行分隔帧；注释帧（`: ...`）也要收集，因为它说明心跳还在走。
      let cut = buffer.indexOf('\n\n')
      while (cut !== -1) {
        const raw = buffer.slice(0, cut)
        buffer = buffer.slice(cut + 2)
        frames.push(parseFrame(raw))
        cut = buffer.indexOf('\n\n')
      }
    }
  })().catch(() => {})

  return {
    frames,
    async waitFor(n, timeoutMs = 3000) {
      const deadline = Date.now() + timeoutMs
      while (frames.length < n && Date.now() < deadline) await new Promise((r) => setTimeout(r, 10))
      assert.ok(frames.length >= n, `等第 ${n} 帧超时，当前 ${frames.length} 帧：${JSON.stringify(frames)}`)
      return frames
    },
    close() {
      controller.abort()
      return pump
    },
  }
}

/**
 * 解析一帧。
 *
 * 三种帧都要认得：注释（`: ping`）、`retry:` 控制行、以及带 `data:` 的消息。
 * **第一版只认注释与 data**，于是 `retry: 3000` 被解析成一个空帧混进 `frames[0]`，
 * 让几条断言对着错的东西发火——测试也要按帧类型挑，不能数帧数。
 */
function parseFrame(raw) {
  if (raw.startsWith(':')) return { comment: raw.slice(1).trim() }
  const out = { data: null, id: null, retry: null }
  for (const line of raw.split('\n')) {
    if (line.startsWith('id: ')) out.id = Number.parseInt(line.slice(4), 10)
    else if (line.startsWith('retry: ')) out.retry = Number.parseInt(line.slice(7), 10)
    else if (line.startsWith('data: ')) out.data = JSON.parse(line.slice(6))
  }
  return out
}

/** 等到出现某一类消息帧（按 `data.type` 挑，不数帧数）。 */
async function waitForType(sse, type, timeoutMs = 3000) {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    const hit = sse.frames.find((f) => f.data?.type === type)
    if (hit) return hit
    assert.ok(Date.now() < deadline, `等 ${type} 帧超时，已有：${JSON.stringify(sse.frames)}`)
    await new Promise((r) => setTimeout(r, 10))
  }
}

/** 等到出现含某段文字的注释帧（心跳）。 */
async function waitForComment(sse, needle, timeoutMs = 3000) {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    const hit = sse.frames.find((f) => typeof f.comment === 'string' && f.comment.includes(needle))
    if (hit) return hit
    assert.ok(Date.now() < deadline, `等注释 "${needle}" 超时，已有：${JSON.stringify(sse.frames)}`)
    await new Promise((r) => setTimeout(r, 10))
  }
}

// ── 帧格式 ──────────────────────────────────────────────────────────────────

test('SSE 帧格式：id 带 seq、data 是 compact JSON、以空行结束', () => {
  assert.equal(sseFrame({ a: 1 }, 7), 'id: 7\ndata: {"a":1}\n\n')
  assert.equal(sseFrame({ a: 1 }), 'data: {"a":1}\n\n', '没有 id 时不该凭空造一个')
  assert.equal(sseComment('ping'), ': ping\n\n', '注释帧以冒号开头——它不会被解析成消息')
})

// ── 基本推送 ────────────────────────────────────────────────────────────────

test('SSE：连上先发 hello（带当前 seq），之后推的事件带 id=批内最后一条 seq', async () => {
  const { handler, runtime, hub } = makeDeps()
  await withServer(handler, async (base) => {
    const sse = await openSse(base)
    try {
      const hello = await waitForType(sse, 'hello')
      assert.equal(typeof hello.data.seq, 'number')

      // 世界推进 → 事件经 hub 推下来。
      runtime.advance(30)
      const batch = await waitForType(sse, 'events')
      assert.ok(Array.isArray(batch.data.events) && batch.data.events.length > 0)
      assert.equal(batch.id, batch.data.events[batch.data.events.length - 1].seq, 'id 必须是批内最后一条的 seq')
    } finally {
      await sse.close()
    }
    // 服务端处理断开是**异步**的：这里不能断言完就走（那是测试太急，不是实现没摘）。
    const deadline = Date.now() + 2000
    while (hub.subscriberCount !== 0 && Date.now() < deadline) await new Promise((r) => setTimeout(r, 10))
    assert.equal(hub.subscriberCount, 0, '连接关掉之后订阅必须摘干净')
  })
})

test('SSE：断开连接会摘掉订阅（否则热重载每改一次代码多一个订阅者）', async () => {
  const { handler, hub } = makeDeps()
  await withServer(handler, async (base) => {
    const sse = await openSse(base)
    await waitForType(sse, 'hello')
    assert.equal(hub.subscriberCount, 1)
    await sse.close()

    // 服务端收到 close 事件是异步的，轮询等一下。
    const deadline = Date.now() + 2000
    while (hub.subscriberCount !== 0 && Date.now() < deadline) await new Promise((r) => setTimeout(r, 10))
    assert.equal(hub.subscriberCount, 0)
  })
})

test('SSE：心跳在没事件时也会发（世界暂停时连接不能被中间层掐掉）', async () => {
  const service = createPluginState(resolveConfig({ autoStart: false, persistEveryTicks: 0 }))
  service.ensureWorld()
  const hub = createEventHub()
  // 心跳间隔调成 40ms：真实默认 15 秒，测试里等不起。
  // 世界**不推进**，所以除了握手之外不会有任何事件——正是要验的场景。
  const handler = createHandler(PREFIX, {
    service,
    runtime: createRuntime({ service, tickMs: 100, sink: hub }),
    source: hub,
    heartbeatMs: 40,
    tickMs: 100,
  })

  await withServer(handler, async (base) => {
    const sse = await openSse(base)
    try {
      await waitForType(sse, 'hello', 2000)
      await waitForComment(sse, 'ping', 2000)
    } finally {
      await sse.close()
    }
  })
})

// ── 断线续传：gap 自愈的服务端一半 ──────────────────────────────────────────

test('SSE 续传：Last-Event-ID 还在环形缓冲里 → 补发缺的那些', async () => {
  const { handler, service } = makeDeps()
  const world = service.currentWorld()

  // 造一段历史：seq 从 1 递增。
  const made = []
  for (let i = 0; i < 6; i++) made.push(emitEvent(world, 'world.paused', { i }).seq)

  await withServer(handler, async (base) => {
    // 客户端说"我收到 seq 3 为止"。
    const sse = await openSse(base, { lastEventId: made[2] })
    try {
      await sse.waitFor(2)
      const replay = sse.frames.find((f) => f.data?.type === 'events')
      assert.ok(replay, '应当补发缺的事件')
      assert.deepEqual(
        replay.data.events.map((e) => e.seq),
        [made[3], made[4], made[5]],
        '补发的必须正好是缺的那几条，不多不少——多补会重复应用，少补会静默丢历史',
      )
      assert.equal(replay.id, made[5])
    } finally {
      await sse.close()
    }
  })
})

test('SSE 续传：Last-Event-ID 太旧（已滚出缓冲）→ 发 reset 让客户端重拉快照', async () => {
  const { handler, service } = makeDeps()
  const world = service.currentWorld()
  // 把环形缓冲灌满并溢出，让最旧的一批滚出去。
  for (let i = 0; i < 600; i++) emitEvent(world, 'world.paused', { i })
  const oldest = world.events[0].seq

  await withServer(handler, async (base) => {
    const sse = await openSse(base, { lastEventId: 1 }) // 远早于最旧的一条
    try {
      await sse.waitFor(2)
      const reset = sse.frames.find((f) => f.data?.type === 'reset')
      assert.ok(reset, '补不齐就必须明说，不能让客户端以为自己是连续的')
      assert.match(reset.data.reason, /补不齐|重新拉/)
      assert.match(reset.data.reason, new RegExp(String(oldest)), '要说出缓冲里最旧的是多少')
      assert.ok(!sse.frames.some((f) => f.data?.type === 'events'), '不该假装补得齐')
    } finally {
      await sse.close()
    }
  })
})

test('SSE 续传：Last-Event-ID 比服务端还新（重放/乱序）→ 什么都不补，也不报错', async () => {
  const { handler, service } = makeDeps()
  const world = service.currentWorld()

  await withServer(handler, async (base) => {
    const sse = await openSse(base, { lastEventId: world.seq + 1000 })
    try {
      const hello = await waitForType(sse, 'hello')
      assert.equal(typeof hello.data.seq, 'number')
      assert.ok(!sse.frames.some((f) => f.data?.type === 'events'), '不该把已经有的事件再推一遍')
      assert.ok(!sse.frames.some((f) => f.data?.type === 'reset'), '客户端比我们新不是错误')
    } finally {
      await sse.close()
    }
  })
})

test('SSE：Last-Event-ID 不是数字时按"没有"处理，不崩', async () => {
  const { handler } = makeDeps()
  await withServer(handler, async (base) => {
    // 用 ASCII 的垃圾值：HTTP header 只允许 ISO-8859-1，塞中文会被 undici 直接拒掉
    // （第一版就是这么写的，红在 fetch 而不是在实现上）。
    const res = await fetch(`${base}${PREFIX}/api/events`, { headers: { 'Last-Event-ID': 'not-a-number' } })
    assert.equal(res.status, 200)
    // 一次 read 拿到的不一定包含全部握手（注释帧与 hello 可能分块到达），
    // 所以读到出现 hello 为止，别假设"第一块就是全部"。
    const reader = res.body.getReader()
    const decoder = new TextDecoder()
    let text = ''
    for (let i = 0; i < 5 && !text.includes('hello'); i++) {
      const { value, done } = await reader.read()
      if (done) break
      text += decoder.decode(value, { stream: true })
    }
    assert.match(text, /hello/)
    await reader.cancel()
  })
})

test('SSE：没有世界时给 503，而不是一条永远沉默的连接', async () => {
  const service = createPluginState(resolveConfig({ autoStart: false, persistEveryTicks: 0 }))
  const hub = createEventHub()
  const handler = createHandler(PREFIX, {
    service,
    runtime: createRuntime({ service, tickMs: 100 }),
    source: hub,
    tickMs: 100,
  })

  await withServer(handler, async (base) => {
    const res = await fetch(`${base}${PREFIX}/api/events`)
    assert.equal(res.status, 503)
    assert.match((await res.json()).error, /世界还没建出来/)
  })
})

// ── 慢客户端：不能靠缓冲养着 ────────────────────────────────────────────────

test('SSE 慢客户端：res.write 返回 false 就断开（用假 res 打这个分支）', async () => {
  const { service, hub } = makeDeps()
  const world = service.currentWorld()

  // 真实 socket 的缓冲要灌爆才会返回 false，测起来又慢又不稳；
  // 这里用一个"第二次写就返回 false"的假 res，把**分支**打准。
  // （已知缺口：真实 socket 上的背压路径没有端到端测试，见 PROGRESS 的风险一节。）
  const written = []
  let writeCount = 0
  const res = {
    headersSent: false,
    writeHead() {},
    write(chunk) {
      written.push(String(chunk))
      writeCount += 1
      return writeCount <= 3 // 握手 3 次之后开始"满"
    },
    end() {
      written.push('__END__')
    },
    on() {},
  }
  const req = Object.assign(new EventEmitter(), { headers: {} })

  const entry = eventsRoutes({ source: hub, service })[0]
  await entry.handler({ method: 'GET', pathname: '/api/events', query: new URLSearchParams(), body: undefined, req, res })

  assert.equal(hub.subscriberCount, 1, '订阅应当先挂上')

  // 推一批事件，触发一次 write；此时 write 返回 false，服务端应当断开。
  emitEvent(world, 'world.paused', { paused: true })
  hub.publish(world.events.slice(-1))

  assert.equal(hub.subscriberCount, 0, '断开时必须摘订阅')
  assert.ok(
    written.some((c) => c.includes('读得太慢')),
    `要说明为什么断——静默断开会让客户端以为是自己网络的问题：${JSON.stringify(written)}`,
  )
  assert.ok(written.includes('__END__'), '要真的把响应结束掉')
})

// ── hub 本身 ────────────────────────────────────────────────────────────────

test('hub：一个订阅者抛异常不影响其他订阅者，也**不影响模拟循环**', () => {
  const hub = createEventHub()
  const got = []
  hub.subscribe(() => {
    throw new Error('这个订阅者坏了')
  })
  hub.subscribe((events) => got.push(events.length))

  hub.publish([{ seq: 1, tick: 0, type: 'world.paused', payload: {} }])

  assert.deepEqual(got, [1], '坏订阅者不该让别人收不到事件')
  assert.equal(hub.listenerErrors, 1, '刻意吞掉但**不假装没发生**')
})

test('hub：取消订阅是幂等的（close 与 error 可能都触发）', () => {
  const hub = createEventHub()
  const off = hub.subscribe(() => {})
  assert.equal(hub.subscriberCount, 1)
  off()
  off() // 第二次不该抛，也不该把别人摘掉
  off()
  assert.equal(hub.subscriberCount, 0)

  const other = hub.subscribe(() => {})
  off() // 再调一次不该影响新订阅者
  assert.equal(hub.subscriberCount, 1)
  other()
})

test('hub：订阅者在回调里取消自己，不会打乱这一轮的遍历', () => {
  const hub = createEventHub()
  const seen = []
  const off = hub.subscribe(() => {
    seen.push('a')
    off()
  })
  hub.subscribe(() => seen.push('b'))

  hub.publish([{ seq: 1, tick: 0, type: 'world.paused', payload: {} }])
  hub.publish([{ seq: 2, tick: 0, type: 'world.paused', payload: {} }])

  assert.deepEqual(seen, ['a', 'b', 'b'], '同一批里已挂上的订阅者都该收到；下一批起 a 就不在了')
  assert.equal(hub.subscriberCount, 1)
})
