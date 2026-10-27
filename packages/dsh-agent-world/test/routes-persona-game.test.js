/**
 * 游戏模式开关与 Persona 档案的 HTTP 路由测试（R350 / R351）。
 *
 * ## 为什么不起真端口
 *
 * 这两组端点只做「校验请求体 → 调端口 → 序列化响应」，没有任何传输层之外的东西。
 * 这里用 `createHttpHandler` + 手写的 req/res 直接走**同一个处理器**：
 * 状态码、JSON 形状、异常翻译都是真实路径，代价却小得多。
 * `http.test.js` 用真服务器测的是「Node 请求对象进、响应对象出」那一层，
 * 两边的侧重点不同，不用互相替代。
 *
 * ## 端口用真的
 *
 * Persona 用真的 `createPersonaStore`（临时目录），因为它本身就是持久化层；
 * 假一个内存对象会把「写盘后重新读」这条真实语义换掉。
 * 游戏模式则用一个可观察的布尔端口——路由的职责是「读它 / 写它」，没有更多。
 */
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { resolveConfig } from '../lib/config.js'
import { createPluginState } from '../lib/state.js'
import { createEventHub } from '../lib/runtime/index.js'
import { apiRoutes } from '../lib/routes/api.js'
import { buildRoutes, createHandler } from '../lib/routes/index.js'
import { createHttpHandler } from '../lib/routes/router.js'
import { createPersonaStore } from '../lib/persona/store.js'

const PREFIX = '/agent-world'

// ── 假的 req / res：形状够处理器与 readJsonBody 用即可 ──────────────────────

function makeRes() {
  const res = {
    status: 0,
    headers: null,
    body: '',
    headersSent: false,
    writeHead(status, headers) {
      res.status = status
      res.headers = headers ?? null
      res.headersSent = true
    },
    end(chunk) {
      if (chunk !== undefined && chunk !== null) res.body += String(chunk)
    },
  }
  return res
}

function makeReq(method, pathname, bodyText) {
  return {
    method,
    url: `${PREFIX}${pathname}`,
    async *[Symbol.asyncIterator]() {
      if (bodyText !== undefined) yield Buffer.from(bodyText)
    },
  }
}

/** 发一条请求：返回真实状态码与解析后的 JSON 体。 */
async function call(handler, method, pathname, bodyText) {
  const res = makeRes()
  await handler(makeReq(method, pathname, bodyText), res)
  return { status: res.status, headers: res.headers, body: res.body === '' ? undefined : JSON.parse(res.body) }
}

function postJson(handler, pathname, value) {
  return call(handler, 'POST', pathname, JSON.stringify(value))
}

/** 一个只有游戏模式端点在意的端口：读/写都能从外面观察。 */
function gameModePort(initial = false) {
  const state = { enabled: initial, writes: [] }
  return {
    state,
    port: {
      get: () => state.enabled,
      set: (enabled) => {
        state.enabled = enabled
        state.writes.push(enabled)
      },
    },
  }
}

/**
 * 造一条只含 API 路由的处理器。
 *
 * `service` / `runtime` 对这两组端点来说是**不会用到的**依赖，所以给空壳；
 * 传进去只是为了满足 `ApiDeps` 的形状，而不是在测试里假装有个世界。
 */
function handlerFor({ gameMode, personas } = {}) {
  const deps = { service: {}, runtime: {}, tickMs: 100 }
  if (gameMode !== undefined) deps.gameMode = gameMode
  if (personas !== undefined) deps.personas = personas
  return createHttpHandler(PREFIX, apiRoutes(deps))
}

/** 临时目录里的真 Persona 库，跑完删掉。 */
async function withPersonaStore(fn) {
  const dir = mkdtempSync(join(tmpdir(), 'aw-routes-persona-'))
  try {
    return await fn(createPersonaStore(join(dir, 'personas.json')), dir)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

// ── 注册：这两个端点必须真的在完整路由表里 ──────────────────────────────────

test('buildRoutes：game-mode 与 personas 端点都在完整路由表里，且 game-mode 默认 false', async () => {
  const service = createPluginState(resolveConfig({ autoStart: false, scene: 'scene.default-town' }))
  const stubs = { service, runtime: {}, tickMs: 100, source: createEventHub() }

  // 路由表本身就能看出端点是否被挂上——比等一条请求打空更能定位"忘了接线"。
  const patterns = buildRoutes(stubs).map((route) => `${route.method} ${route.pattern}`)
  for (const endpoint of ['GET /api/game-mode', 'POST /api/game-mode', 'GET /api/personas', 'POST /api/personas']) {
    assert.ok(patterns.includes(endpoint), `完整路由表里必须有 ${endpoint}`)
  }

  // 没有注入 gameMode 时只能是 false：传输层不许编造一个"开着"的状态。
  const handler = createHandler(PREFIX, stubs)
  const res = await call(handler, 'GET', '/api/game-mode')
  assert.equal(res.status, 200)
  assert.deepEqual(res.body, { enabled: false })
  assert.match(res.headers['Content-Type'], /application\/json/)
})

// ── 游戏模式 ────────────────────────────────────────────────────────────────

test('GET/POST /api/game-mode：默认 false，打开后 GET 为 true，关掉再回到 false', async () => {
  const { state, port } = gameModePort()
  const handler = handlerFor({ gameMode: port })

  const before = await call(handler, 'GET', '/api/game-mode')
  assert.equal(before.status, 200)
  assert.deepEqual(before.body, { enabled: false })
  assert.deepEqual(state.writes, [], '读状态不该有写入')

  const on = await postJson(handler, '/api/game-mode', { enabled: true })
  assert.equal(on.status, 200)
  assert.deepEqual(on.body, { ok: true, enabled: true })
  assert.equal(state.enabled, true)
  assert.deepEqual(state.writes, [true])

  const after = await call(handler, 'GET', '/api/game-mode')
  assert.deepEqual(after.body, { enabled: true })

  const off = await postJson(handler, '/api/game-mode', { enabled: false })
  assert.equal(off.status, 200)
  assert.deepEqual(off.body, { ok: true, enabled: false })
  assert.deepEqual(state.writes, [true, false], '每次 POST 只写一次')
})

test('POST /api/game-mode：enabled 必须是布尔值，其余一律 400 且不写入', async () => {
  const { state, port } = gameModePort()
  const handler = handlerFor({ gameMode: port })

  for (const body of [{}, { enabled: 'true' }, { enabled: 1 }, { enabled: 0 }, { enabled: null }, { enabled: 'false' }]) {
    const res = await postJson(handler, '/api/game-mode', body)
    assert.equal(res.status, 400, `${JSON.stringify(body)} 应当被拒`)
    assert.match(res.body.error, /enabled/, '报错要指出缺的是 enabled 字段')
  }

  // 空体与坏 JSON 走的是路由层，同样是 400（而不是 500）。
  const empty = await call(handler, 'POST', '/api/game-mode')
  assert.equal(empty.status, 400)

  const broken = await call(handler, 'POST', '/api/game-mode', '{ enabled: true')
  assert.equal(broken.status, 400)
  assert.match(broken.body.error, /JSON/)

  assert.equal(state.enabled, false, '一条坏请求都不该改动开关')
  assert.deepEqual(state.writes, [], '一条坏请求都不该调用 set')
})

// ── Persona 列表 ────────────────────────────────────────────────────────────

test('GET /api/personas：没有存储时给空列表，而不是 500', async () => {
  const handler = handlerFor()
  const res = await call(handler, 'GET', '/api/personas')
  assert.equal(res.status, 200)
  assert.deepEqual(res.body, { personas: [] })
})

test('GET /api/personas：空库是有数据的空数组，upsert 之后能列出来', async () => {
  await withPersonaStore(async (store) => {
    const handler = handlerFor({ personas: store })

    const empty = await call(handler, 'GET', '/api/personas')
    assert.equal(empty.status, 200)
    assert.deepEqual(empty.body, { personas: [] })

    const created = await postJson(handler, '/api/personas', { id: 'sa-1', name: '小铁' })
    assert.equal(created.status, 200)

    const listed = await call(handler, 'GET', '/api/personas')
    assert.equal(listed.status, 200)
    assert.equal(listed.body.personas.length, 1)
    assert.equal(listed.body.personas[0].id, 'sa-1')
    assert.equal(listed.body.personas[0].name, '小铁')
  })
})

// ── Persona upsert ──────────────────────────────────────────────────────────

test('POST /api/personas：upsert 新建档案并原样回给调用方', async () => {
  await withPersonaStore(async (store) => {
    const handler = handlerFor({ personas: store })

    const res = await postJson(handler, '/api/personas', {
      id: 'sa-1',
      name: '小铁',
      role: 'engineer',
      skills: ['code', 'review', 'code'],
      prompt: '你是小铁。',
    })
    assert.equal(res.status, 200)
    assert.equal(res.body.ok, true)
    const persona = res.body.persona
    assert.equal(persona.id, 'sa-1')
    assert.equal(persona.name, '小铁')
    assert.equal(persona.role, 'engineer')
    assert.deepEqual(persona.skills, ['code', 'review'], '技能要去重')
    assert.equal(persona.prompt, '你是小铁。')
    assert.equal(persona.xp, 0)
    assert.equal(persona.level, 1)

    // 再 upsert 一次是**更新**，不是新增一条。
    const updated = await postJson(handler, '/api/personas', { id: 'sa-1', role: 'lead', xp: 300 })
    assert.equal(updated.status, 200)
    assert.equal(updated.body.persona.name, '小铁', '没给的字段要沿用旧值')
    assert.equal(updated.body.persona.role, 'lead')
    assert.equal(updated.body.persona.level, 3)

    const listed = await call(handler, 'GET', '/api/personas')
    assert.equal(listed.body.personas.length, 1, 'upsert 同一个 id 不该长出第二条')
  })
})

// ── Persona addXp ───────────────────────────────────────────────────────────

test('POST /api/personas：addXp 加经验并重新算等级，GET 能看到累积值', async () => {
  await withPersonaStore(async (store) => {
    const handler = handlerFor({ personas: store })
    await postJson(handler, '/api/personas', { id: 'sa-1', name: '小铁' })

    const first = await postJson(handler, '/api/personas', { id: 'sa-1', action: 'addXp', amount: 300 })
    assert.equal(first.status, 200)
    assert.equal(first.body.ok, true)
    assert.equal(first.body.persona.xp, 300)
    assert.equal(first.body.persona.level, 3)

    const second = await postJson(handler, '/api/personas', { id: 'sa-1', action: 'addXp', amount: 10 })
    assert.equal(second.body.persona.xp, 310, '经验要累加')

    const listed = await call(handler, 'GET', '/api/personas')
    assert.equal(listed.body.personas[0].xp, 310)
  })
})

// ── Persona linkTask ────────────────────────────────────────────────────────

test('POST /api/personas：linkTask 关联任务，重复关联不重复记', async () => {
  await withPersonaStore(async (store) => {
    const handler = handlerFor({ personas: store })
    await postJson(handler, '/api/personas', { id: 'sa-1', name: '小铁' })

    const first = await postJson(handler, '/api/personas', { id: 'sa-1', action: 'linkTask', taskId: 'task-1' })
    assert.equal(first.status, 200)
    assert.deepEqual(first.body.persona.taskIds, ['task-1'])

    const again = await postJson(handler, '/api/personas', { id: 'sa-1', action: 'linkTask', taskId: 'task-1' })
    assert.equal(again.status, 200)
    assert.deepEqual(again.body.persona.taskIds, ['task-1'], '同一张单关联两次仍是那一条')

    const second = await postJson(handler, '/api/personas', { id: 'sa-1', action: 'linkTask', taskId: 'task-2' })
    assert.deepEqual(second.body.persona.taskIds, ['task-1', 'task-2'])

    const listed = await call(handler, 'GET', '/api/personas')
    assert.deepEqual(listed.body.personas[0].taskIds, ['task-1', 'task-2'])
  })
})

// ── Persona 非法参数 ────────────────────────────────────────────────────────

test('POST /api/personas：缺 id / 空 id / 非法 amount / 缺 taskId 都给 400', async () => {
  await withPersonaStore(async (store) => {
    const handler = handlerFor({ personas: store })

    for (const body of [{}, { name: '没有 id' }, { id: '' }, { id: '   ' }, { id: 42 }]) {
      const res = await postJson(handler, '/api/personas', body)
      assert.equal(res.status, 400, `${JSON.stringify(body)} 应当被拒`)
      assert.match(res.body.error, /id/, '报错要指出缺的是 id')
    }

    await postJson(handler, '/api/personas', { id: 'sa-1' })

    // 注意：`amount` 缺省 / null 会被当成 0（`?? 0`），那条路径不是错误而是"不加经验"，
    // 所以这里只钉真正非法的负数与非数字。
    for (const amount of [-1, 'abc']) {
      const res = await postJson(handler, '/api/personas', { id: 'sa-1', action: 'addXp', amount })
      assert.equal(res.status, 400, `amount=${JSON.stringify(amount)} 应当被拒`)
      assert.match(res.body.error, /amount/)
    }

    const missingTask = await postJson(handler, '/api/personas', { id: 'sa-1', action: 'linkTask' })
    assert.equal(missingTask.status, 400)
    assert.match(missingTask.body.error, /taskId/)

    const broken = await call(handler, 'POST', '/api/personas', '{ 不是 json')
    assert.equal(broken.status, 400)
    assert.match(broken.body.error, /JSON/)

    // 坏请求不该留下档案，也不该悄悄加经验。
    assert.equal(store.list().length, 1)
    assert.equal(store.get('sa-1').xp, 0)
  })
})

// ── Persona 未知 id ─────────────────────────────────────────────────────────

test('POST /api/personas：未知 id 的 addXp / linkTask 给 404，且不改库', async () => {
  await withPersonaStore(async (store) => {
    const handler = handlerFor({ personas: store })
    await postJson(handler, '/api/personas', { id: 'sa-1', name: '小铁' })

    const xp = await postJson(handler, '/api/personas', { id: 'sa-unknown', action: 'addXp', amount: 100 })
    assert.equal(xp.status, 404)
    assert.match(xp.body.error, /没有 persona/)

    const link = await postJson(handler, '/api/personas', { id: 'sa-unknown', action: 'linkTask', taskId: 'task-1' })
    assert.equal(link.status, 404)
    assert.match(link.body.error, /没有 persona/)

    assert.deepEqual(store.list().map((p) => p.id), ['sa-1'], '未知 id 不该被顺手建出来')
  })
})

// ── Persona 未启用存储 ──────────────────────────────────────────────────────

test('POST /api/personas：没有 Persona 存储时 upsert 给 503（而不是假装成功）', async () => {
  const handler = handlerFor()
  const res = await postJson(handler, '/api/personas', { id: 'sa-1', name: '小铁' })
  assert.equal(res.status, 503)
  assert.match(res.body.error, /Persona/)
})
