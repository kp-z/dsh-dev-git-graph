/**
 * **端到端（E2E）测试：从真实 HTTP 请求到真实面板模块图**。
 *
 * ## 这份测试与既有测试的分工
 * - `http.test.js`：测**路由层**（req/res 怎么变成响应），用真 HTTP 但只打少量端点；
 * - `acceptance-m6.test.js`：测**协议契约**（会话服务随便换）；
 * - 本文件：测**"整站在真实 HTTP 上是否真的能用"**——
 *   页面 → 它引用的每个 CSS/JS → 每个 JS 再 import 的模块 → 静态资源 → API。
 *
 * ## 为什么必须有这一层（两条真实事故）
 * 1. **M10-14**：`main.js` import 了一个没进 profile 的新文件 → 模块图整条断掉，
 *    页面"看起来加载完了"（`readyState=complete`、canvas 都在），
 *    但 `__agentWorld*` 全局**一个都没有**。单测全绿，因为单测直接 import `lib/`。
 * 2. **R100**：改了 `web/` 但没跑 `copy-web` → 宿主服务的还是 `lib/web/` 的旧版，
 *    页面上看不出改动。单测也全绿，因为单测读的是源文件。
 *
 * ⇒ 这两类故障**只有"从 HTTP 取一遍真文件"才能发现**。本文件就是干这个的。
 *
 * ## 规矩
 * 本文件只用**已发布的 `lib/`**（和宿主一致），不 import `web/` 的源码——
 * 否则又变成"测的是源文件、不是宿主吐出来的东西"，正好绕开要防的事故。
 */
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { dirname, join, normalize, posix } from 'node:path'
import { fileURLToPath } from 'node:url'

import { test } from 'node:test'

import { resolveConfig } from '../lib/config.js'
import { createPluginState } from '../lib/state.js'
import { createEventHub, createRuntime } from '../lib/runtime/index.js'
import { createHandler } from '../lib/routes/index.js'

const PREFIX = '/agent-world'
const LIB_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'lib')
const WEB_DIR = join(LIB_DIR, 'web')

/** 起一个真服务器（端口 0 = 系统分配），跑完必关。 */
async function withServer(handler, fn) {
  const server = createServer(handler)
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address()
  try {
    return await fn(`http://127.0.0.1:${port}`, port)
  } finally {
    await new Promise((resolve) => server.close(resolve))
  }
}

/** 一套可用的依赖（真世界 + 真运行时 + 真路由）。 */
function makeDeps() {
  const service = createPluginState(
    resolveConfig({ autoStart: false, scene: 'scene.default-town' }),
  )
  service.ensureWorld()
  const runtime = createRuntime({ service, tickMs: 100 })
  const hub = createEventHub()
  const handler = createHandler(PREFIX, { service, runtime, source: hub, tickMs: 100 })
  return { service, runtime, hub, handler }
}

/** GET 一个站内路径，返回 `{ status, type, body }`。 */
async function get(base, path) {
  const res = await fetch(base + path)
  const body = await res.text()
  return { status: res.status, type: res.headers.get('content-type') ?? '', body }
}

/**
 * 从 `web/` 里找出 `entry` 出发**可达的全部本地模块**（递归跟 `import`/`export ... from`）。
 *
 * 读的是 `lib/web`（宿主真正会吐的那份），不是 `web/` 源码——见文件头"规矩"。
 */
async function collectModuleGraph(entry) {
  const seen = new Set()
  const missing = []
  const queue = [entry]
  while (queue.length > 0) {
    const rel = normalize(queue.shift()).replaceAll('\\', '/')
    if (seen.has(rel)) continue
    seen.add(rel)
    let src
    try {
      src = await readFile(join(WEB_DIR, rel), 'utf8')
    } catch {
      missing.push(rel)
      continue
    }
    // 静态 import / export-from / 动态 import() 都算
    const re = /(?:from|import)\s*\(?\s*['"](\.[^'"]+)['"]/g
    for (const m of src.matchAll(re)) {
      const next = posix.normalize(posix.join(posix.dirname(rel), m[1]))
      if (!seen.has(next)) queue.push(next)
    }
  }
  return { seen: [...seen].sort(), missing }
}

test('E2E：首页可达且是 HTML', async () => {
  const { handler } = makeDeps()
  await withServer(handler, async (base) => {
    const res = await get(base, `${PREFIX}/`)
    assert.equal(res.status, 200)
    assert.match(res.type, /text\/html/)
    assert.match(res.body, /Agent World|agent-world/i)
  })
})

test('E2E：首页引用的每个本地资源都返回 200（防"新文件没进包"）', async () => {
  const { handler } = makeDeps()
  await withServer(handler, async (base) => {
    const page = await get(base, `${PREFIX}/`)
    assert.equal(page.status, 200)
    const refs = [...page.body.matchAll(/(?:src|href)="([^"]+)"/g)]
      .map((m) => m[1])
      .filter((p) => !/^https?:|^#|^data:/.test(p))
    assert.ok(refs.length > 0, '首页至少要引用一个本地资源')
    for (const ref of refs) {
      const url = ref.startsWith('/') ? ref : `${PREFIX}/${ref.replace(/^\.\//, '')}`
      const res = await get(base, url)
      assert.equal(res.status, 200, `首页引用的资源取不到：${ref} → ${url}`)
    }
  })
})

test('E2E：整条 ES 模块图在真实 HTTP 上都能加载（防"import 404 导致整页死"）', async () => {
  const { handler } = makeDeps()
  const graph = await collectModuleGraph('main.js')
  assert.deepEqual(graph.missing, [], '模块图里引用了不存在的文件')
  assert.ok(graph.seen.length > 5, `模块图太小（${graph.seen.length}），可能没跟到 import`)
  await withServer(handler, async (base) => {
    const bad = []
    for (const rel of graph.seen) {
      const res = await get(base, `${PREFIX}/${rel}`)
      if (res.status !== 200) bad.push(`${rel} → ${res.status}`)
    }
    assert.deepEqual(bad, [], '以下模块在真实 HTTP 上取不到')
  })
})

test('E2E：快照端点给出可用的世界（agents / tasks / tick）', async () => {
  const { handler } = makeDeps()
  await withServer(handler, async (base) => {
    const res = await get(base, `${PREFIX}/api/world`)
    assert.equal(res.status, 200)
    assert.match(res.type, /application\/json/)
    const world = JSON.parse(res.body).world
    assert.ok(Number.isInteger(world.tick), 'tick 应该是整数')
    assert.ok(Array.isArray(world.agents) && world.agents.length > 0, '至少有一个 agent')
    assert.ok(Array.isArray(world.tasks), 'tasks 应该是数组')
  })
})

test('E2E：派单真的改变世界，且新单带 blockedBy（M7-8 回归守卫）', async () => {
  const { handler, runtime } = makeDeps()
  await withServer(handler, async (base) => {
    const before = JSON.parse((await get(base, `${PREFIX}/api/world`)).body).world
    const beforeCount = before.tasks.length

    const res = await fetch(`${base}${PREFIX}/api/command`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ command: { kind: 'dispatch', taskSet: 'task.quick-fix' } }),
    })
    assert.equal(res.status, 200)
    const ack = await res.json()
    assert.equal(ack.accepted, true, '派单应被接受')

    // ⚠️ `POST /api/command` 是**入队**、不是立刻执行（确定性要求，见 http.test.js 同名用例）。
    //    `/api/world` 读的是落盘世界，所以**必须推进 tick** 才看得到效果。
    //    （第一版就是漏了这一步，得到 0 → 0，看着像"派单没生效"的真 bug。）
    runtime.advance(1)

    const after = JSON.parse((await get(base, `${PREFIX}/api/world`)).body).world
    assert.ok(
      after.tasks.length > beforeCount,
      `推进 tick 后任务数应增加（${beforeCount} → ${after.tasks.length}）`,
    )

    // ⚠️ M7-8 的真身：节点都在、状态也对，**只是没有 blockedBy** → 依赖图少画线却不报错。
    //    这里钉的是"新派进来的单必须带前置关系"，而不是某个具体 id。
    const withDeps = after.tasks.filter((t) => Array.isArray(t.blockedBy) && t.blockedBy.length > 0)
    assert.ok(
      withDeps.length > 0,
      '派单后应当有带 blockedBy 的单（否则依赖图无连线，且不会报错）',
    )
    for (const t of withDeps) {
      for (const dep of t.blockedBy) {
        assert.ok(
          after.tasks.some((x) => x.id === dep),
          `${t.id} 的 blockedBy 指向了不存在的单 ${dep}`,
        )
      }
    }
  })
})

test('E2E：事件流端点可建立（SSE）且首帧是 hello/带 seq', async () => {
  const { handler } = makeDeps()
  // ⚠️ SSE 是**长连接**：必须在 `withServer` 里显式关掉读端，
  //    否则 `server.close()` 会一直等这个连接，整个测试文件挂住（第一版就挂在这里）。
  //    所以这里不用 `withServer` 的自动关闭，而是自己起自己收。
  const server = createServer(handler)
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address()
  const ctrl = new AbortController()
  try {
    const res = await fetch(`http://127.0.0.1:${port}${PREFIX}/api/events`, {
      signal: ctrl.signal,
    })
    assert.equal(res.status, 200)
    assert.match(res.headers.get('content-type') ?? '', /text\/event-stream/)
    const reader = res.body.getReader()
    // ⚠️ 第一块**不一定是 hello**：SSE 常先发一行注释（`: agent-world v1`）做 keep-alive。
    //    这本身是好事（说明连接立刻活了），所以断言要"**读到 hello 为止**"，
    //    而不是"第一块必须是 hello"——第一版就错在这里。
    let buf = ''
    const deadline = Date.now() + 4000
    while (!buf.includes('hello') && Date.now() < deadline) {
      const { value, done } = await reader.read()
      if (done) break
      buf += new TextDecoder().decode(value ?? new Uint8Array())
    }
    assert.match(buf, /hello/, `首帧里应当出现 hello，实际读到：${JSON.stringify(buf.slice(0, 120))}`)
    assert.match(buf, /"seq"/, 'hello 应带 seq')
    await reader.cancel()
  } finally {
    // 先掐断请求，再关服务器；顺序反了 `close()` 会等连接。
    ctrl.abort()
    await new Promise((resolve) => {
      server.closeAllConnections?.()
      server.close(resolve)
    })
  }
})

test('E2E：静态资源不存在时给 404（不能把首页当成兜底）', async () => {
  const { handler } = makeDeps()
  await withServer(handler, async (base) => {
    const res = await get(base, `${PREFIX}/no-such-file-xyz.js`)
    assert.equal(res.status, 404)
  })
})
