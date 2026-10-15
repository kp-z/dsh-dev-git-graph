/**
 * M0-3 / M1 冒烟测试：确认这个包**能被宿主加载**（导出契约正确），且世界模型可用。
 *
 * 为什么必须有它：本仓库最贵的一类事故是「插件树加载失败 ⇒ dsh 整体不启动」
 * （见 docs/DEVELOPMENT.md §7）。一个检查 `name/inject/apply` 三件套的冒烟测试
 * 是最便宜的护栏——它比"启动 dsh 再看"快两个数量级。
 *
 * 运行：`pnpm test`（会先 tsc 出 lib/，再 node --test test/）
 */
import assert from 'node:assert/strict'
import { after, test } from 'node:test'

import { apply, inject, name } from '../lib/index.js'
import { createRng, seedFromString, summarize } from '../lib/domain/index.js'
import { ContentRegistry, builtinPacks } from '../lib/content/index.js'
import { createWorld } from '../lib/world/create.js'

/**
 * 清理函数的收集器。
 *
 * 假 ctx 的 `effect` 必须**像真的一样收集、而不是立刻执行**：
 * `apply` 是"先挂清理、再启动运行时"（顺序刻意的，见 index.ts），
 * 如果假 effect 立刻 dispose，清理就会跑在 start 之前——定时器随后启动、再没人停它，
 * 测试进程直接不退出。这个坑踩过一次，写在这里。
 */
const collectedDisposers = []
after(() => {
  for (const dispose of collectedDisposers.splice(0)) dispose()
})

/**
 * 造一个假 ctx。
 *
 * **假 ctx 必须镜像真实 cordis 的 API 面**（tools / logger / effect / inject）：
 * 少一个方法，`apply` 就在那一步 TypeError，而报错看起来像"插件写错了"——
 * 这类假故障已经踩过两次（先是 `effect`，再是 `inject`）。
 *
 * @param services - 要提供给 `inject` 的服务（例如 `{ webServer }`）。不提供时
 *   `inject` 的回调**永不执行**，这正是"软依赖缺席"的真实行为。
 */
function fakeCtx(services = {}) {
  const registered = []
  const logs = { info: [], warn: [], error: [] }
  const ctx = {
    tools: { register: (tool) => registered.push(tool) },
    logger: () => ({
      info: (m) => logs.info.push(m),
      warn: (m) => logs.warn.push(m),
      error: (m) => logs.error.push(m),
    }),
    effect: (fn) => {
      const dispose = fn()
      if (typeof dispose === 'function') collectedDisposers.push(dispose)
    },
    // 真实 cordis 的 `inject`：依赖可用时才回调；不可用就**永不回调**——
    // 这正是"软依赖"的语义（没有 webServer 时世界照跑，只是没有界面）。
    // 假 ctx 少这个方法会让 apply 直接 TypeError，而这个错误看起来像"插件写错了"。
    inject: (names, cb) => {
      const host = { ...services, effect: ctx.effect }
      if (names.every((n) => host[n] !== undefined)) cb(host)
    },
  }
  return { ctx, registered, logs }
}

test('插件导出契约：name / inject / apply 三件套齐全', () => {
  assert.equal(typeof name, 'string')
  assert.equal(name, 'agent-world', 'entry id 必须与 cordis.patch.yml 里的 id 一致')
  assert.ok(Array.isArray(inject), 'inject 必须是数组')
  assert.ok(inject.includes('tools'), 'tools 是硬依赖，漏了会导致工具注册不上')
  assert.equal(typeof apply, 'function')
})

test('apply 能被调用，缺配置时不会因 config 为 undefined 崩掉', () => {
  const { ctx, registered } = fakeCtx()

  // 关键：不传 config。Loader 在 patch 没写 config 时就是给 undefined，
  // 而 schema 的 default 不会被自动填充——这正是最容易崩的一条路径。
  apply(ctx, { persistEveryTicks: 0 })
  assert.equal(registered.length, 4, '应注册 status / open / content / dispatch 四个工具')

  const names = registered.map((t) => t.name).sort()
  assert.deepEqual(names, [
    'agent_world_content',
    'agent_world_dispatch',
    'agent_world_open',
    'agent_world_status',
  ])
})

test('apply 传空对象也不崩，且工具可用', async () => {
  const { ctx, registered, logs } = fakeCtx()
  apply(ctx, { persistEveryTicks: 0 })

  const status = registered.find((t) => t.name === 'agent_world_status')
  assert.ok(status, '找不到 agent_world_status')

  // autoStart 默认 true ⇒ 世界已建好，status 应能读到内容而不是"尚未创建"。
  const text = await status.execute({})
  assert.match(text, /世界「/, `status 输出不像世界摘要：${text.slice(0, 160)}`)
  assert.match(text, /花名册：/)
  assert.match(text, /工单板：/)
  assert.match(text, /内容来源：/, 'status 应当报出内容来源，否则内容出问题时无从下手')

  assert.equal(logs.error.length, 0, `不该有错误日志：${logs.error.join(' | ')}`)
  assert.equal(logs.warn.length, 0, `不该有警告日志：${logs.warn.join(' | ')}`)
})

test('agent_world_content：概览、提供方链、非法库名三种路径', async () => {
  const { ctx, registered } = fakeCtx()
  apply(ctx, { persistEveryTicks: 0 })

  const content = registered.find((t) => t.name === 'agent_world_content')
  assert.ok(content, '找不到 agent_world_content')

  // 1) 概览：要能回答"装了哪些包、每个库多少条、外部目录是哪个"
  const overview = await content.execute({})
  assert.match(overview, /已装载 \d+ 个内容包/)
  assert.match(overview, /pack\.default/)
  assert.match(overview, /外部内容目录：/, '要报出外部目录，否则"配了没生效"无从下手')
  assert.match(overview, /stations（站点库·语义库）：10 条/)
  assert.match(overview, /内容层没有任何问题/)

  // 2) 提供方链：内置内容每个 id 只有一个提供方
  const chain = await content.execute({ kind: 'stations', id: 'station.desk-a' })
  assert.match(chain, /提供方链/)
  assert.match(chain, /pack\.default/)
  assert.match(chain, /只有一个提供方/)

  // 3) 不存在的 id：要说清"这个库有多少条"，而不是只说找不到
  const missing = await content.execute({ kind: 'stations', id: 'station.没有这个' })
  assert.match(missing, /没有/)
  assert.match(missing, /10 个条目/)

  // 4) 非法库名：给可用取值
  await assert.rejects(() => content.execute({ kind: '不存在的库', id: 'x' }), /可用库名/)
  // 5) 只给 id 不给 kind：明确报错，而不是猜
  await assert.rejects(() => content.execute({ id: 'station.desk-a' }), /同时给 kind 与 id/)
})

test('内置内容包：零 error、零 warning', () => {
  const content = new ContentRegistry()
  const issues = content.loadAll(builtinPacks())
  const bad = issues.filter((i) => i.level !== 'info')
  assert.deepEqual(bad, [], `内置内容不该有任何问题：\n${bad.map((i) => `[${i.level}][${i.where}] ${i.message}`).join('\n')}`)

  // 跨包引用校验也要干净。
  const cross = content.validate()
  assert.deepEqual(cross, [], `跨包引用校验不该有问题：\n${cross.map((i) => `[${i.level}][${i.where}] ${i.message}`).join('\n')}`)

  // 各库都真的有东西，且没有空库（provides 声明了 9 个库）。
  for (const kind of ['districts', 'stations', 'scenes', 'rosters', 'tasks', 'models', 'actions', 'skins', 'themes']) {
    assert.ok(content.size(kind) > 0, `${kind} 库应当是空的`)
  }
})

test('createWorld：同一 seed 得到同一个世界（确定性第一道闸）', () => {
  const content = new ContentRegistry()
  content.loadAll(builtinPacks())
  const base = { content, scene: 'scene.default-town', createdAt: '2026-01-01T00:00:00.000Z' }

  const a = createWorld({ ...base, name: '测试小镇' })
  const b = createWorld({ ...base, name: '测试小镇' })
  assert.deepEqual(a, b, '同 seed 同选项的世界必须逐字段一致')
})

test('createWorld：不同 seed 会分叉（否则"确定性"是假的）', () => {
  const content = new ContentRegistry()
  content.loadAll(builtinPacks())
  const base = { content, scene: 'scene.default-town', createdAt: '2026-01-01T00:00:00.000Z' }

  const a = createWorld({ ...base, name: '小镇甲' })
  const b = createWorld({ ...base, name: '小镇乙' })
  assert.notEqual(a.seed, b.seed)
  assert.notEqual(
    a.agents.map((x) => x.facing).join(','),
    b.agents.map((x) => x.facing).join(','),
    '不同 seed 应得到不同的初始朝向',
  )
})

test('createWorld：默认小镇结构完整（4 地块 / 10 站点 / 8 角色）', () => {
  const content = new ContentRegistry()
  content.loadAll(builtinPacks())
  const w = createWorld({ content, scene: 'scene.default-town', createdAt: '2026-01-01T00:00:00.000Z' })

  assert.equal(w.districts.length, 4)
  assert.equal(w.stations.length, 10)
  assert.equal(w.agents.length, 8)
  assert.equal(w.agents[0].role, 'lead', '第一个角色必须是 lead')
  assert.equal(w.tick, 0)
  assert.equal(w.paused, false)
  assert.deepEqual(w.origin.packs, ['pack.default', 'pack.kenney-mini', 'pack.kenney-furniture'])
  assert.equal(w.origin.scene, 'scene.default-town')
  assert.deepEqual(w.origin.taskSets, [])
  assert.deepEqual(w.tasks, [], '开局工单板应当是空的，等 lead 派单')

  for (const s of w.stations) {
    assert.ok(
      w.districts.some((d) => d.id === s.district),
      `站点 ${s.id} 的地块 ${s.district} 不存在`,
    )
    assert.ok(s.slots.length > 0, `站点 ${s.id} 没有 slot`)
    assert.equal(s.slots.length, s.capacity)
  }
})

test('createWorld：relativeTo 的坐标解析正确（相对地块中心）', () => {
  const content = new ContentRegistry()
  content.loadAll(builtinPacks())
  const w = createWorld({ content, scene: 'scene.default-town', createdAt: '2026-01-01T00:00:00.000Z' })

  // 工程区 bounds 是 [-8,-8]..[0,0]，中心 (-4,-4)；工位 A 偏移 (-1,-1) ⇒ (-5,-5)。
  const deskA = w.stations.find((s) => s.id === 'station.desk-a')
  assert.ok(deskA)
  assert.deepEqual(deskA.anchor, { x: -5, z: -5 })

  // 机房 bounds 是 [0,-8]..[8,0]，中心 (4,-4)；机柜偏移 (-2,-1) ⇒ (2,-5)。
  const rack = w.stations.find((s) => s.id === 'station.server-rack')
  assert.ok(rack)
  assert.deepEqual(rack.anchor, { x: 2, z: -5 })

  // 所有站点都该落在小镇范围内（±8）。坐标解析错了最典型的症状就是跑到地图外面。
  for (const s of w.stations) {
    assert.ok(Math.abs(s.anchor.x) <= 8 && Math.abs(s.anchor.z) <= 8, `站点 ${s.id} 跑到小镇外面了：${JSON.stringify(s.anchor)}`)
  }
})

test('createWorld：maxAgents 是硬上限（性能预算不能被配置绕过）', () => {
  const content = new ContentRegistry()
  content.loadAll(builtinPacks())
  const w = createWorld({ content, scene: 'scene.default-town', createdAt: '2026-01-01T00:00:00.000Z', maxAgents: 3 })
  assert.equal(w.agents.length, 3)
})

test('createWorld：派任务集会正确建立 key → 实例 id 的映射', () => {
  const content = new ContentRegistry()
  content.loadAll(builtinPacks())
  const w = createWorld({
    content,
    scene: 'scene.default-town',
    createdAt: '2026-01-01T00:00:00.000Z',
    taskSets: ['task.quick-fix'],
  })

  assert.equal(w.tasks.length, 3)
  const triage = w.tasks.find((t) => t.key === 'triage')
  const patch = w.tasks.find((t) => t.key === 'patch')
  const verify = w.tasks.find((t) => t.key === 'verify')
  assert.ok(triage && patch && verify)

  assert.deepEqual(triage.blockedBy, [], 'triage 没有前置')
  assert.deepEqual(patch.blockedBy, [triage.id], 'patch 依赖 triage 的**实例 id**，不是 key')
  assert.deepEqual(verify.blockedBy, [patch.id])
  assert.equal(triage.set, 'task.quick-fix')
  assert.ok(
    w.tasks.every((t) => t.status === 'pending'),
    '建世界时一律 pending——只有 sim/ready.ts 能派生 ready',
  )
  // id 必须全局唯一（跨集合也不能撞）。
  assert.equal(new Set(w.tasks.map((t) => t.id)).size, w.tasks.length)
})

test('createWorld：连派两个任务集，id 不撞且依赖不串', () => {
  const content = new ContentRegistry()
  content.loadAll(builtinPacks())
  const w = createWorld({
    content,
    scene: 'scene.default-town',
    createdAt: '2026-01-01T00:00:00.000Z',
    taskSets: ['task.quick-fix', 'task.software-feature'],
  })
  assert.equal(w.tasks.length, 10, '3 + 7')
  assert.equal(new Set(w.tasks.map((t) => t.id)).size, 10, '跨集合 id 不能撞')

  // 后一个集合的依赖只能指向它自己内部，不能指向前一个集合。
  const feature = w.tasks.filter((t) => t.set === 'task.software-feature')
  const featureIds = new Set(feature.map((t) => t.id))
  for (const t of feature) {
    for (const dep of t.blockedBy) {
      assert.ok(featureIds.has(dep), `工单 ${t.id} 的依赖 ${dep} 跨了任务集`)
    }
  }
})

test('summarize：口径与数组真实内容一致', () => {
  const content = new ContentRegistry()
  content.loadAll(builtinPacks())
  const w = createWorld({ content, scene: 'scene.default-town', createdAt: '2026-01-01T00:00:00.000Z' })
  const s = summarize(w)
  assert.equal(s.agents.total, w.agents.length)
  assert.equal(s.tasks.total, w.tasks.length)
  assert.equal(s.stations.total, w.stations.length)
  assert.equal(s.agents.byState.idle, w.agents.length, '刚建好时所有角色都应 idle')
  assert.equal(s.stations.occupied, 0, '刚建好时没人占站点')
})

test('rng：同 seed 同序列，且序列确实在动', () => {
  const a = createRng(12345)
  const b = createRng(12345)
  const seqA = Array.from({ length: 20 }, () => a.next())
  const seqB = Array.from({ length: 20 }, () => b.next())
  assert.deepEqual(seqA, seqB)
  assert.equal(new Set(seqA).size, seqA.length, '20 次抽样不该出现重复（否则不是好随机源）')
  for (const v of seqA) assert.ok(v >= 0 && v < 1, `越界：${v}`)
  assert.notEqual(createRng(1).next(), createRng(2).next())
})

test('seedFromString：稳定且能区分不同名字', () => {
  assert.equal(seedFromString('Agent World'), seedFromString('Agent World'))
  assert.notEqual(seedFromString('Agent World'), seedFromString('AgentWorld'))
  for (const s of ['', 'a', '很长的一个中文世界名字']) {
    const v = seedFromString(s)
    assert.ok(Number.isInteger(v) && v >= 0, `seed 必须是非负整数，得到 ${v}`)
  }
})
