/**
 * M0-3 冒烟测试：确认这个包**能被宿主加载**（导出契约正确），且世界模型可用。
 *
 * 为什么必须有它：本仓库最贵的一类事故是「插件树加载失败 ⇒ dsh 整体不启动」
 * （见 docs/DEVELOPMENT.md §7）。一个检查 `name/inject/apply` 三件套的冒烟测试
 * 是最便宜的护栏——它比"启动 dsh 再看"快两个数量级。
 *
 * 运行：`pnpm test`（会先 tsc 出 lib/，再 node --test test/）
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'

import { apply, inject, name } from '../lib/index.js'
import { createRng, createWorld, seedFromString, summarize } from '../lib/domain/index.js'

test('插件导出契约：name / inject / apply 三件套齐全', () => {
  assert.equal(typeof name, 'string')
  assert.equal(name, 'agent-world', 'entry id 必须与 cordis.patch.yml 里的 id 一致')
  assert.ok(Array.isArray(inject), 'inject 必须是数组')
  assert.ok(inject.includes('tools'), 'tools 是硬依赖，漏了会导致工具注册不上')
  assert.equal(typeof apply, 'function')
})

test('apply 能被调用，缺配置时不会因 config 为 undefined 崩掉', () => {
  const registered = []
  const ctx = { tools: { register: (tool) => registered.push(tool) } }

  // 关键：不传 config。Loader 在 patch 没写 config 时就是给 undefined，
  // 而 schema 的 default 不会被自动填充——这正是最容易崩的一条路径。
  apply(ctx, undefined)
  assert.equal(registered.length, 2, '应注册 agent_world_status 与 agent_world_open 两个工具')

  const names = registered.map((t) => t.name).sort()
  assert.deepEqual(names, ['agent_world_open', 'agent_world_status'])
})

test('apply 传空对象也不崩，且工具可用', async () => {
  const registered = []
  const ctx = { tools: { register: (tool) => registered.push(tool) } }
  apply(ctx, {})

  const status = registered.find((t) => t.name === 'agent_world_status')
  assert.ok(status, '找不到 agent_world_status')

  // autoStart 默认 true ⇒ 世界已建好，status 应能读到内容而不是"尚未创建"。
  const text = await status.execute({})
  assert.match(text, /世界「/, `status 输出不像世界摘要：${text.slice(0, 120)}`)
  assert.match(text, /花名册：/)
  assert.match(text, /工单板：/)
})

test('createWorld：同一 seed 得到同一个世界（确定性第一道闸）', () => {
  const opts = { name: '测试小镇', createdAt: '2026-01-01T00:00:00.000Z' }
  const a = createWorld(opts)
  const b = createWorld(opts)
  assert.deepEqual(a, b, '同 seed 同选项的世界必须逐字段一致')
})

test('createWorld：不同 seed 会分叉（否则"确定性"是假的）', () => {
  const a = createWorld({ name: '小镇甲', createdAt: '2026-01-01T00:00:00.000Z' })
  const b = createWorld({ name: '小镇乙', createdAt: '2026-01-01T00:00:00.000Z' })
  assert.notEqual(a.seed, b.seed)
  const facingA = a.agents.map((x) => x.facing).join(',')
  const facingB = b.agents.map((x) => x.facing).join(',')
  assert.notEqual(facingA, facingB, '不同 seed 应得到不同的初始朝向')
})

test('createWorld：默认小镇结构完整（4 地段 / 10 站点 / 8 角色）', () => {
  const w = createWorld({ name: '结构检查', createdAt: '2026-01-01T00:00:00.000Z' })
  assert.equal(w.districts.length, 4)
  assert.equal(w.stations.length, 10)
  assert.equal(w.agents.length, 8)
  assert.equal(w.agents[0].role, 'lead', '第一个角色必须是 lead')
  assert.equal(w.tick, 0)
  assert.equal(w.paused, false)

  // 每个站点都必须能在地段里找到、且有座位定义；站点缺 slot 会让寻路拿到 undefined。
  for (const s of w.stations) {
    assert.ok(
      w.districts.some((d) => d.id === s.district),
      `站点 ${s.id} 的地段 ${s.district} 不存在`,
    )
    assert.ok(s.slots.length > 0, `站点 ${s.id} 没有 slot`)
    assert.equal(s.slots.length, s.capacity)
  }
})

test('createWorld：maxAgents 是硬上限（性能预算不能被配置绕过）', () => {
  const w = createWorld({ name: '上限检查', createdAt: '2026-01-01T00:00:00.000Z', agents: 999, maxAgents: 12 })
  assert.equal(w.agents.length, 12)
})

test('summarize：口径与数组真实内容一致', () => {
  const w = createWorld({ name: '摘要检查', createdAt: '2026-01-01T00:00:00.000Z' })
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
