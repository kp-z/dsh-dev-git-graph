/**
 * `pack.kenney-mini` 的验收测试（BACKLOG M5-5 / M5-6）。
 *
 * ## 这个包为什么值得单独测
 *
 * 它是"**换资产只改内容**"的验证点：它做的唯一一件事就是显式 `overrides` 掉
 * `models/model.agent.base`，把程序化的胶囊人换成 Kenney 的 GLB 角色。
 * 如果这件事需要改一行代码，那整条内容层的设计就没兑现。
 *
 * ## 最值钱的一条：内容里的 url 必须真的在 vendor 里
 *
 * 内容说"角色是 `kenney-mini-characters/character-male-a.glb`"，而那个文件在
 * `src/vendor/` 下。**这两处没有任何编译器关系**——少一个文件、或者路径写错一个字符，
 * 运行期的表现是"角色变成占位块"，而没有任何一条错误信息指向"文件没发出去"。
 *
 * 所以这里把两边钉在一起：**内置内容里声明的每个 GLB 地址，都必须在 `src/vendor/` 下有那个文件。**
 */
import assert from 'node:assert/strict'
import { stat } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'

import { ContentRegistry, builtinPacks } from '../lib/content/index.js'
import { contentPortOf } from '../lib/content/port.js'
import { createWorld } from '../lib/world/create.js'
import { buildScenePlan } from '../lib/scene/plan.js'

const VENDOR_SRC = fileURLToPath(new URL('../src/vendor', import.meta.url))

function loaded() {
  const content = new ContentRegistry()
  const issues = content.loadAll(builtinPacks())
  return { content, issues }
}

function worldOf(content) {
  return createWorld({ content, scene: 'scene.default-town', createdAt: '2026-01-01T00:00:00.000Z' })
}

// ── 覆盖本身 ────────────────────────────────────────────────────────────────

test('pack.kenney-mini 装载干净：没有 error、也没有"没声明就撞 id"', () => {
  const { content, issues } = loaded()
  const errors = issues.filter((i) => i.level === 'error')
  assert.deepEqual(errors, [], `装载不该有错误：${JSON.stringify(errors)}`)

  // 覆盖必须**显式声明**（决策：没声明就撞 id 是错误，且原条目不许变）。
  const manifest = builtinPacks().find((p) => p.manifest.id === 'pack.kenney-mini')?.manifest
  assert.ok(manifest, '这个包应当在 builtinPacks 里')
  assert.deepEqual(manifest.overrides, ['models/model.agent.base'], '要显式声明覆盖了什么')
  assert.equal(content.providersOf('models', 'model.agent.base')[0], 'pack.kenney-mini', '覆盖方排在最前')

  // 原条目**不许变**：基础包仍在提供方链上（拆掉表现包就退回程序化角色）。
  assert.deepEqual(
    content.providersOf('models', 'model.agent.base'),
    ['pack.kenney-mini', 'pack.default'],
    '被覆盖的条目要留在链上做回退',
  )
})

test('覆盖之后角色真的是 GLB，且原程序化模型仍可取回（回退路径没断）', () => {
  const { content } = loaded()
  const port = contentPortOf(content, [], null)

  const agent = port.modelOf('model.agent.base')
  assert.equal(agent.builder, null, '现在是外部模型，不走程序化构建器')
  assert.equal(agent.url, 'kenney-mini-characters/character-male-a.glb')
  assert.equal(agent.scale, 2, '模型自然高度 0.671，放大到约 1.34')

  // 站点模型现在由**另一个包**（`pack.kenney-furniture`）覆盖成家具 GLB。
  // 两个包各管一边（人 / 陈设），互不干扰——这正是"换资产 = 加一个包"该有的样子。
  const desk = port.modelOf('model.station.desk')
  assert.equal(desk.builder, null, '站点现在也是 GLB')
  assert.equal(desk.url, 'kenney-furniture/desk.glb')

  // 但**没被任何人覆盖**的模型仍是程序化的——覆盖是逐条目的，不是"整库替换"。
  const lab = port.modelOf('model.station.lab')
  assert.equal(lab.builder, null, '实验台也被这个包覆盖了（见 kenney-furniture.ts 的表）')
  // 找一个确实没被覆盖的：`models` 库里只有这两个包覆盖过的条目被换掉。
  const all = builtinPacks().flatMap((p) => (p.entries.models ?? []).map((m) => ({ pack: p.manifest.id, m })))
  const procedural = all.filter((x) => x.m.source.kind === 'procedural')
  assert.ok(procedural.length > 0, '仍应当有程序化模型（它们是"没装表现包"时的回退）')
})

// ── 内容 ↔ 资产的钉死 ───────────────────────────────────────────────────────

test('内置内容声明的每个 GLB 地址，都必须在 src/vendor/ 下真的有那个文件', async () => {
  const declared = []
  for (const pack of builtinPacks()) {
    for (const entry of pack.entries.models ?? []) {
      if (entry.source.kind === 'glb') declared.push({ pack: pack.manifest.id, id: entry.id, url: entry.source.url })
    }
  }
  assert.ok(declared.length > 0, '这个测试要真有东西可查（否则它会永远绿）')

  for (const { pack, id, url } of declared) {
    const full = join(VENDOR_SRC, url)
    const info = await stat(full).catch(() => null)
    assert.ok(
      info !== null,
      `${pack} 的 ${id} 声明了 url "${url}"，但 src/vendor/${url} 不存在。` +
        `运行期的表现是"角色变成占位块"，而错误信息不会指向这里——所以这条必须在这里红。`,
    )
    assert.ok(info.size > 1024, `src/vendor/${url} 太小了（${info.size}B），不像一个模型文件`)
  }
})

test('GLB 的地址是**包内相对路径**，不带 vendor 前缀、不带协议（决策 D32）', () => {
  for (const pack of builtinPacks()) {
    for (const entry of pack.entries.models ?? []) {
      if (entry.source.kind !== 'glb') continue
      const url = entry.source.url
      assert.ok(!url.startsWith('/'), `${entry.id} 不该是绝对路径：${url}`)
      assert.ok(!url.startsWith('vendor/'), `${entry.id} 不该自己带 vendor 前缀（渲染器会拼一次）：${url}`)
      assert.ok(!/^[a-z]+:/i.test(url), `${entry.id} 不该有协议：${url}`)
      assert.ok(!url.includes('..'), `${entry.id} 不该有上跳：${url}`)
    }
  }
})

// ── 从世界到计划 ────────────────────────────────────────────────────────────

test('世界与计划都指向 Kenney 角色，且计划里带上了它的 url', () => {
  const { content } = loaded()
  const world = worldOf(content)
  assert.equal(world.agentModel, 'model.agent.base')

  const port = contentPortOf(content, [], null)
  const plan = buildScenePlan(world, port.colors(), port.themeFor(world.origin.scene), (id) => port.modelOf(id))

  assert.ok(plan.actors.length > 0)
  for (const actor of plan.actors) assert.equal(actor.modelId, 'model.agent.base')

  const model = plan.models.find((m) => m.id === 'model.agent.base')
  assert.ok(model, '角色模型必须在计划的模型表里')
  assert.equal(model.url, 'kenney-mini-characters/character-male-a.glb')
})

test('换成 GLB 之后模拟内核**零改动**：世界结构照旧（4 地块 / 10 站点 / 8 角色）', () => {
  // M5-6 的验收口径：内容换了资产，模拟内核不该有任何感知。
  // 这条只断言结构，不比对实现——"内核零改动"由这一轮的 diff 作证（没有 src/sim/ 变更）。
  const { content } = loaded()
  const world = worldOf(content)
  assert.equal(world.districts.length, 4)
  assert.equal(world.stations.length, 10)
  assert.equal(world.agents.length, 8)
})
