/**
 * HTTP 传输层测试（BACKLOG M3-3 / M3-5）。
 *
 * 用**真 HTTP 服务器**（端口 0 = 系统分配）而不是假的 req/res：
 * 这一层的活儿就是"把 Node 的请求对象变成响应"，用假的就等于把要测的东西替换掉了。
 */
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { test } from 'node:test'

import { resolveConfig } from '../lib/config.js'
import { createPluginState } from '../lib/state.js'
import { createEventHub, createRuntime } from '../lib/runtime/index.js'
import { createHandler } from '../lib/routes/index.js'
import { HttpError, createHttpHandler, matchPath, readJsonBody } from '../lib/routes/router.js'
import { resolveStaticPath } from '../lib/routes/panel.js'
import { buildSnapshot, applyCommand } from '../lib/routes/api.js'

const PREFIX = '/agent-world'

/** 起一个真服务器，跑完关掉。 */
async function withServer(handler, fn) {
  const server = createServer(handler)
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address()
  const base = `http://127.0.0.1:${port}`
  try {
    return await fn(base)
  } finally {
    await new Promise((resolve) => server.close(resolve))
  }
}

/** 一套可用的依赖（真世界 + 真运行时 + 真路由）。 */
function makeDeps() {
  const service = createPluginState(resolveConfig({ autoStart: false }))
  service.ensureWorld()
  service.dispatch('task.quick-fix')
  const runtime = createRuntime({ service, tickMs: 100 })
  const hub = createEventHub()
  const handler = createHandler(PREFIX, { service, runtime, source: hub, tickMs: 100 })
  return { service, runtime, hub, handler }
}

// ── 路径匹配 ────────────────────────────────────────────────────────────────

test('matchPath：精确段、命名段、以及不匹配', () => {
  assert.deepEqual(matchPath('/api/world', '/api/world'), {})
  assert.deepEqual(matchPath('/api/:id', '/api/abc'), { id: 'abc' })
  assert.deepEqual(matchPath('/:file', '/app.js'), { file: 'app.js' })
  assert.equal(matchPath('/api/world', '/api/other'), null, '段内容不同就不该匹配')
  assert.equal(matchPath('/api/world', '/api/world/extra'), null, '段数不同就不该匹配')
  assert.equal(matchPath('/:file', '/'), null, '空段不该被命名段吃掉')
  assert.deepEqual(matchPath('/api/:id', '/api/%E4%B8%AD%E6%96%87'), { id: '中文' }, '命名段要解码')
})

// ── 静态路径安全 ────────────────────────────────────────────────────────────

test('resolveStaticPath：路径穿越必须被挡住（这是最容易写漏的一条）', () => {
  const root = '/srv/panel'
  assert.equal(resolveStaticPath(root, '/app.js'), '/srv/panel/app.js')
  assert.equal(resolveStaticPath(root, '/sub/x.css'), '/srv/panel/sub/x.css')

  for (const bad of [
    '/../secret.txt',
    '/../../etc/passwd',
    '/sub/../../secret.txt',
    // 编码过的穿越：只用 `includes('..')` 的实现在这里会漏。
    '/%2e%2e/secret.txt',
    '/%2e%2e%2fsecret.txt',
  ]) {
    assert.throws(() => resolveStaticPath(root, bad), /越界|文件类型/, `${bad} 必须被拒`)
  }

  assert.throws(() => resolveStaticPath(root, '/x\0.js'), /空字节/)
  assert.throws(() => resolveStaticPath(root, '/a%ZZ'), /URL 编码/)
})

test('resolveStaticPath：只服务白名单里的类型，其余一律 404', () => {
  const root = '/srv/panel'
  for (const good of ['/index.html', '/app.js', '/style.css', '/logo.svg']) {
    assert.ok(resolveStaticPath(root, good).startsWith(root))
  }
  for (const bad of ['/secret.env', '/db.sqlite', '/no-extension', '/archive.tar.gz']) {
    assert.throws(() => resolveStaticPath(root, bad), (e) => e instanceof HttpError && e.status === 404, `${bad} 不该被服务`)
  }
  // json 在白名单里（API 快照就是它），所以这条**不该**抛。
  assert.equal(resolveStaticPath(root, '/data.json'), '/srv/panel/data.json')
})

test('resolveStaticPath：白名单报错要列出允许的类型（否则用户不知道能放什么）', () => {
  try {
    resolveStaticPath('/srv/panel', '/x.env')
    assert.fail('应当抛')
  } catch (error) {
    assert.match(error.message, /\.html/)
    assert.match(error.message, /\.js/)
  }
})

// ── 前缀边界 ────────────────────────────────────────────────────────────────

test('前缀要按整段匹配：/agent-world-x 不该被本插件吞掉', async () => {
  const { handler } = makeDeps()
  await withServer(handler, async (base) => {
    const res = await fetch(`${base}/agent-world-x/api/world`)
    assert.equal(res.status, 404, '相邻插件的路径被我们吞掉会极难查')

    const ok = await fetch(`${base}${PREFIX}/api/world`)
    assert.equal(ok.status, 200)
  })
})

test('未知路由的 404 要列出已注册的路由（可下手）', async () => {
  const { handler } = makeDeps()
  await withServer(handler, async (base) => {
    const res = await fetch(`${base}${PREFIX}/api/根本没有`)
    assert.equal(res.status, 404)
    const body = await res.json()
    assert.match(body.error, /没有匹配的路由/)
    assert.match(body.error, /\/api\/world/, '要列出已注册的路由')
  })
})

// ── 快照 ────────────────────────────────────────────────────────────────────

test('GET /api/world：快照里没有事件环形缓冲，但有调色板与运行时诊断', async () => {
  const { handler, runtime } = makeDeps()
  runtime.advance(12)

  await withServer(handler, async (base) => {
    const res = await fetch(`${base}${PREFIX}/api/world`)
    assert.equal(res.status, 200)
    assert.match(res.headers.get('content-type'), /application\/json/)
    assert.equal(res.headers.get('cache-control'), 'no-store', '缓存会让面板看起来像卡住了')

    const snap = await res.json()
    assert.equal(snap.type, 'snapshot')
    assert.equal(snap.v, 1)
    assert.equal(snap.world.tick, 12)
    assert.equal(snap.world.events, undefined, '快照刻意不带事件历史——面板要轮询它')

    // 面板读不到内容库，所以配色必须随快照发出。
    assert.equal(typeof snap.palette, 'object')
    assert.equal(snap.palette['ground.engineering'], '#6F7D5A')
    assert.equal(snap.palette['role.lead'], '#F0B429')

    assert.equal(snap.runtime.running, false)
    assert.equal(snap.runtime.tickMs, 100)
    assert.equal(snap.runtime.diagnostics.ticks, 12)
    // 渲染层靠它算"纸条飞到哪了"。不发给它，面板就得自己抄一遍这个数字，
    // 改一处就会让纸条落点与"已送达"对不上。
    assert.equal(snap.runtime.messageDeliveryTicks, 10)

    assert.deepEqual(snap.content.packs.map((p) => p.id), ['pack.default'])
    assert.ok(snap.content.libraries.some((l) => l.kind === 'stations' && l.count === 10))
  })
})

test('world.districts 的 ground 是 token（面板负责查表，服务端负责给表）', async () => {
  const { handler } = makeDeps()
  await withServer(handler, async (base) => {
    const snap = await (await fetch(`${base}${PREFIX}/api/world`)).json()
    const engineering = snap.world.districts.find((d) => d.id === 'district.engineering')
    assert.equal(engineering.ground, 'skin.ground.engineering')
    // 面板要剥掉 `skin.` 前缀再查表——两边的约定在这里钉住。
    assert.equal(snap.palette[engineering.ground.slice('skin.'.length)], '#6F7D5A')
  })
})

// ── 命令 ────────────────────────────────────────────────────────────────────

test('POST /api/command：入队而不是立刻执行（确定性要求）', async () => {
  const { handler, service, runtime } = makeDeps()
  const tickBefore = service.currentWorld().tick

  await withServer(handler, async (base) => {
    const res = await fetch(`${base}${PREFIX}/api/command`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ command: { kind: 'pause' } }),
    })
    assert.equal(res.status, 200)
    const body = await res.json()
    assert.equal(body.accepted, true)
    assert.equal(body.command, '暂停世界')
    assert.equal(body.pending, 1)
  })

  // 关键：世界**没动**——命令要等下一步的 ingest 段。
  assert.equal(service.currentWorld().paused, false, '命令不该在 HTTP 请求里立刻生效')
  assert.equal(service.currentWorld().tick, tickBefore)

  runtime.advance(1)
  assert.equal(service.currentWorld().paused, true, '推进一步之后才该生效')
  assert.equal(runtime.pending, 0)
})

test('POST /api/command：坏命令给 400 并列出可用 kind', async () => {
  const { handler, service } = makeDeps()
  await withServer(handler, async (base) => {
    const post = (body) =>
      fetch(`${base}${PREFIX}/api/command`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })

    let res = await post({ command: { kind: '飞起来' } })
    assert.equal(res.status, 400)
    let body = await res.json()
    assert.match(body.error, /pause/)
    assert.match(body.error, /resume/)

    res = await post({})
    assert.equal(res.status, 400)
    body = await res.json()
    assert.match(body.error, /command/)

    res = await post({ command: null })
    assert.equal(res.status, 400)

    // 坏 JSON 也要给 400 而不是 500。
    res = await fetch(`${base}${PREFIX}/api/command`, { method: 'POST', body: '{ 不是 json' })
    assert.equal(res.status, 400)
    assert.match((await res.json()).error, /JSON/)
  })
  assert.equal(service.currentWorld().paused, false, '一条坏命令都不该生效')
})

test('POST /api/command：超大的请求体被拒（不用读进内存）', async () => {
  const { handler } = makeDeps()
  await withServer(handler, async (base) => {
    const res = await fetch(`${base}${PREFIX}/api/command`, {
      method: 'POST',
      body: JSON.stringify({ command: { kind: 'pause' }, padding: 'x'.repeat(70 * 1024) }),
    })
    assert.equal(res.status, 413)
  })
})

// ── 静态面板 ────────────────────────────────────────────────────────────────

test('GET /agent-world/ 吐出面板 HTML，且引用的资源都取得到（M3-5 的验收）', async () => {
  const { handler } = makeDeps()
  await withServer(handler, async (base) => {
    const res = await fetch(`${base}${PREFIX}/`)
    assert.equal(res.status, 200)
    assert.match(res.headers.get('content-type'), /text\/html/)
    const html = await res.text()
    assert.match(html, /<canvas id="town">/, '面板的核心是那张俯视图')

    // HTML 里引用的每个本地资源都要真的能取到——否则用户看到一个白屏。
    const refs = [...html.matchAll(/(?:href|src)="\.\/([^"]+)"/g)].map((m) => m[1])
    assert.ok(refs.length >= 2, `应当引用了 css 与 js，实际 ${refs.length} 个`)
    for (const ref of refs) {
      const asset = await fetch(`${base}${PREFIX}/${ref}`)
      assert.equal(asset.status, 200, `面板引用的 ${ref} 取不到`)
    }
  })
})

test('GET /agent-world/app.js 的正确 MIME 与 no-store', async () => {
  const { handler } = makeDeps()
  await withServer(handler, async (base) => {
    const res = await fetch(`${base}${PREFIX}/app.js`)
    assert.equal(res.status, 200)
    assert.match(res.headers.get('content-type'), /javascript/)
    assert.equal(res.headers.get('cache-control'), 'no-store')
  })
})

test('静态服务：穿越与非白名单类型在真实服务器上也要被拒', async () => {
  const { handler } = makeDeps()
  await withServer(handler, async (base) => {
    for (const bad of [`${PREFIX}/../package.json`, `${PREFIX}/%2e%2e/package.json`]) {
      const res = await fetch(`${base}${bad}`)
      assert.ok(res.status === 403 || res.status === 404, `${bad} 得到 ${res.status}`)
    }
    // GET /:file 只匹配单段，所以多段的路径是"没有匹配的路由"（404）。
    const deep = await fetch(`${base}${PREFIX}/a/b/c.txt`)
    assert.equal(deep.status, 404)
  })
})

// ── 装配：apply 真的把面板挂上去了吗 ────────────────────────────────────────

test('apply：有 webServer 时注册**一个**前缀路由，且清理可调用（热重载不泄漏）', async () => {
  const { apply } = await import('../lib/index.js')

  const registered = []
  const disposers = []
  const logs = { info: [], warn: [], error: [] }
  let disposerCalled = 0

  const webServer = {
    register: (route) => {
      registered.push(route)
      return () => {
        disposerCalled += 1
      }
    },
  }

  const effect = (fn) => {
    const dispose = fn()
    if (typeof dispose === 'function') disposers.push(dispose)
  }
  const ctx = {
    tools: { register: () => {} },
    logger: () => ({
      info: (m) => logs.info.push(m),
      warn: (m) => logs.warn.push(m),
      error: (m) => logs.error.push(m),
    }),
    effect,
    inject: (names, cb) => {
      const host = { webServer, effect }
      if (names.every((n) => host[n] !== undefined)) cb(host)
    },
  }

  apply(ctx, { autoStart: false, persistEveryTicks: 0 })

  assert.equal(registered.length, 1, '整个插件只该占一个路由座位——多占就有撞车的风险')
  assert.equal(registered[0].kind, 'prefix')
  assert.equal(registered[0].path, '/agent-world')
  assert.equal(typeof registered[0].handler, 'function')
  assert.ok(
    logs.info.some((m) => m.includes('/agent-world/')),
    `日志里要给出面板地址，否则用户不知道该开哪个页面：${logs.info.join(' | ')}`,
  )

  // 清理链要能真的走到路由的 disposer。
  // 有两个：一个是运行时的定时器，一个是这条路由——都属于"热重载必须摘干净"的东西。
  assert.equal(disposers.length, 2, `应当挂两个清理（运行时 + 路由），实际 ${disposers.length}`)
  for (const dispose of disposers) dispose()
  assert.equal(disposerCalled, 1, '清理必须把路由摘掉')
})

test('apply：没有 webServer 时**不注册也不报错**（软依赖的真实语义）', async () => {
  const { apply } = await import('../lib/index.js')
  const logs = { info: [], warn: [], error: [] }
  const ctx = {
    tools: { register: () => {} },
    logger: () => ({
      info: (m) => logs.info.push(m),
      warn: (m) => logs.warn.push(m),
      error: (m) => logs.error.push(m),
    }),
    effect: () => {},
    inject: () => {}, // 依赖缺席 ⇒ 永不回调
  }

  apply(ctx, { autoStart: false, persistEveryTicks: 0 })

  assert.deepEqual(logs.error, [], 'headless 环境下没有 webServer 是正常的，不该报错')
  assert.ok(
    !logs.info.some((m) => m.includes('面板与 API')),
    '没挂上面板就不该说挂了',
  )
  assert.ok(logs.info.some((m) => m.includes('已就绪')), '世界本身应当照常就绪')
})

test('端到端：apply 注册的处理器挂到真服务器上，页面与 API 都能取到', async () => {
  const { apply } = await import('../lib/index.js')

  let route = null
  const effect = (fn) => fn()
  const ctx = {
    tools: { register: () => {} },
    logger: () => ({ info: () => {}, warn: () => {}, error: () => {} }),
    effect,
    inject: (names, cb) => {
      const host = { webServer: { register: (r) => { route = r; return () => {} } }, effect }
      if (names.every((n) => host[n] !== undefined)) cb(host)
    },
  }

  apply(ctx, { autoStart: false, persistEveryTicks: 0 })
  assert.ok(route)

  await withServer(route.handler, async (base) => {
    const page = await fetch(`${base}/agent-world/`)
    assert.equal(page.status, 200)
    assert.match(await page.text(), /<canvas id="town">/)

    const snap = await (await fetch(`${base}/agent-world/api/world`)).json()
    assert.equal(snap.type, 'snapshot')
    assert.ok(snap.world.stations.length === 10)
  })
})

// ── 处理器自身的鲁棒性 ──────────────────────────────────────────────────────

test('处理器把异常翻成状态码，而不是把栈吐给调用方', async () => {
  const handler = createHttpHandler(
    PREFIX,
    [
      {
        method: 'GET',
        pattern: '/boom',
        handler: () => {
          throw new HttpError(418, '我是茶壶')
        },
      },
      {
        method: 'GET',
        pattern: '/crash',
        handler: () => {
          throw new Error('内部细节：秘密路径 /etc/shadow')
        },
      },
    ],
    () => {},
  )

  await withServer(handler, async (base) => {
    const teapot = await fetch(`${base}${PREFIX}/boom`)
    assert.equal(teapot.status, 418)
    assert.match((await teapot.json()).error, /茶壶/)

    const crash = await fetch(`${base}${PREFIX}/crash`)
    assert.equal(crash.status, 500)
    // 能诊断就行，但不该是原始栈。
    assert.ok(!/at .*router\.ts/.test(await crash.text()))
  })
})

test('readJsonBody：空体返回 undefined，坏 JSON 抛 400', async () => {
  const fakeReq = (chunks) =>
    ({
      async *[Symbol.asyncIterator]() {
        for (const c of chunks) yield Buffer.from(c)
      },
    })

  assert.equal(await readJsonBody(fakeReq([])), undefined)
  assert.deepEqual(await readJsonBody(fakeReq(['{"a":1}'])), { a: 1 })
  await assert.rejects(() => readJsonBody(fakeReq(['{bad'])), (e) => e.status === 400)
  await assert.rejects(() => readJsonBody(fakeReq(['x'.repeat(70 * 1024)])), (e) => e.status === 413)
})

test('applyCommand / buildSnapshot：没有世界时给 503 而不是崩', () => {
  const service = createPluginState(resolveConfig({ autoStart: false }))
  const runtime = createRuntime({ service, tickMs: 100 })
  const deps = { service, runtime, tickMs: 100 }

  assert.throws(() => buildSnapshot(deps), (e) => e.status === 503)
  assert.throws(() => applyCommand(deps, { command: { kind: 'pause' } }), (e) => e.status === 503)
})
