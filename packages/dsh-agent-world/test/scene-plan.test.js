/**
 * 场景描述层测试（BACKLOG M4-0）。
 *
 * 这一层是纯函数、不碰 three.js、不碰 IO，所以能在 `node --test` 里直接验——
 * **断网也能做完，且验得动**。这也正是它值得先做的原因之一。
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'

import { ContentRegistry, builtinPacks } from '../lib/content/index.js'
import { contentPortOf } from '../lib/content/port.js'
import { createWorld } from '../lib/world/create.js'
import { buildScenePlan } from '../lib/scene/plan.js'
import { resolveColor } from '../lib/protocol/index.js'

function makeWorld() {
  const content = new ContentRegistry()
  content.loadAll(builtinPacks())
  return createWorld({
    content,
    scene: 'scene.default-town',
    createdAt: '2026-01-01T00:00:00.000Z',
  })
}

function portOf(content) {
  return contentPortOf(content, [], null)
}

// ── 颜色解析 ────────────────────────────────────────────────────────────────

test('resolveColor：token 查表、字面量原样、查不到用洋红（醒目而不是静默灰）', () => {
  const palette = { 'ground.engineering': '#6F7D5A' }

  assert.equal(resolveColor('skin.ground.engineering', palette), '#6F7D5A')
  assert.equal(resolveColor('ground.engineering', palette), '#6F7D5A', '不带 skin. 前缀也要认')
  assert.equal(resolveColor('#FFD9A0', palette), '#FFD9A0', '字面色值原样用')
  assert.equal(resolveColor('skin.根本没有', palette), '#FF00FF', '查不到必须是洋红')
  assert.equal(resolveColor(null, palette), '#FF00FF')
  assert.equal(resolveColor('', palette), '#FF00FF')
  assert.equal(resolveColor('skin.根本没有', palette, '#123456'), '#123456', '可以指定兜底色')
})

// ── 场景描述 ────────────────────────────────────────────────────────────────

test('ScenePlan：地块、站点、角色三类都在，且**颜色已经解析完**（没有 token 泄漏）', () => {
  const content = new ContentRegistry()
  content.loadAll(builtinPacks())
  const world = makeWorld()
  const port = portOf(content)
  const plan = buildScenePlan(world, port.colors(), port.themeFor(world.origin.scene))

  assert.equal(plan.ground.length, 4)
  assert.equal(plan.props.length, 10)
  assert.equal(plan.actors.length, 8)
  assert.equal(plan.extent.half, 8)

  // 关键：渲染层拿到的得是色值。任何一个 `skin.` 泄漏出去都说明漏解析了一处。
  const allColors = [...plan.ground.map((g) => g.color), ...plan.props.map((p) => p.color), ...plan.actors.map((a) => a.color)]
  for (const c of allColors) {
    assert.match(c, /^#[0-9A-Fa-f]{6}$/, `颜色没解析干净：${c}`)
  }
  assert.ok(!allColors.includes('#FF00FF'), '不该有解析失败的洋红')
})

test('ScenePlan：地块几何来自内容（中心与尺寸算对，且改了内容就跟着变）', () => {
  const content = new ContentRegistry()
  content.loadAll(builtinPacks())
  const port = portOf(content)
  const plan = buildScenePlan(makeWorld(), port.colors(), null)

  const eng = plan.ground.find((g) => g.id === 'district.engineering')
  assert.ok(eng)
  // 内置包的地块是 [-8,0] × [-8,0] → 中心 (-4,-4)、边长 8。
  assert.equal(eng.x, -4)
  assert.equal(eng.z, -4)
  assert.equal(eng.width, 8)
  assert.equal(eng.depth, 8)
  assert.equal(eng.name, '工程区')
})

test('ScenePlan：station 的外观走 modelId，**代码里不写"桌子长什么样"**（决策 D10）', () => {
  const content = new ContentRegistry()
  content.loadAll(builtinPacks())
  const port = portOf(content)
  const plan = buildScenePlan(makeWorld(), port.colors(), null)

  const desk = plan.props.find((p) => p.kind === 'desk')
  assert.ok(desk)
  assert.ok(desk.parts.length > 0, '站点至少有一个部件')
  assert.match(desk.parts[0].modelId, /^model\.station\.desk$/, '渲染器靠它去模型库里取，所以约定要稳')
  assert.ok(plan.props.find((p) => p.kind === 'lab')?.parts[0]?.modelId?.includes('station.lab'))
})

test('ScenePlan：occupied 包含"正在过去的人"，不含纯粹路过的人', () => {
  const content = new ContentRegistry()
  content.loadAll(builtinPacks())
  const world = makeWorld()
  const port = portOf(content)

  // 造一个"正在赶来"的人：目标站点已定，但人还没到。
  const agent = world.agents[0]
  agent.state = 'walking'
  agent.targetStation = world.stations[0].id

  const plan = buildScenePlan(world, port.colors(), null)
  const target = plan.props.find((p) => p.id === world.stations[0].id)
  assert.equal(target.occupied, true, '正在过去的站点该算"有人"——否则渲染层不会高亮，看起来像没人要它')

  const other = plan.props.find((p) => p.id !== world.stations[0].id)
  assert.equal(other.occupied, false)
})

test('ScenePlan：不修改世界（纯函数），且同一输入两次结果一致', () => {
  const content = new ContentRegistry()
  content.loadAll(builtinPacks())
  const world = makeWorld()
  const port = portOf(content)
  const before = JSON.stringify(world)

  const a = buildScenePlan(world, port.colors(), null)
  const b = buildScenePlan(world, port.colors(), null)

  assert.equal(JSON.stringify(world), before, '场景描述不该改世界')
  assert.deepEqual(a, b, '同输入同输出——它是纯函数，所以这一层可复现')
})

test('ScenePlan：extent 会跟着角色位置扩大（走出地块也不至于被裁掉）', () => {
  const content = new ContentRegistry()
  content.loadAll(builtinPacks())
  const world = makeWorld()
  const port = portOf(content)

  assert.equal(buildScenePlan(world, port.colors(), null).extent.half, 8)

  world.agents[0].position = { x: 30, z: -25 }
  const widened = buildScenePlan(world, port.colors(), null)
  assert.equal(widened.extent.half, 30, '半径要能容下跑到外面去的角色')
})

test('ScenePlan：纸条配色来自 skins 库（代码里不许写字面色值）', () => {
  const content = new ContentRegistry()
  content.loadAll(builtinPacks())
  const port = portOf(content)
  const plan = buildScenePlan(makeWorld(), port.colors(), null)

  // 五种 kind 全都要有：少一个就会在渲染层退化成兜底色，
  // 而"某类纸条颜色不对"很难归因。
  for (const kind of ['handoff', 'report', 'question', 'answer', 'dispatch']) {
    assert.match(plan.noteColors[kind] ?? '', /^#[0-9A-Fa-f]{6}$/, `${kind} 的纸条配色没解析出来`)
  }
  // 纸条会和角色圆点同时出现在画面上，撞色会让人以为"那个角色在发光"。
  const roleColors = [plan.actors[0].color, ...plan.actors.map((a) => a.color)]
  for (const [kind, color] of Object.entries(plan.noteColors)) {
    assert.ok(
      !roleColors.some((c) => c.toUpperCase() === color.toUpperCase()),
      `纸条色 ${color}（${kind}）与某个角色色撞了`,
    )
  }
})

test('内容校验：皮肤库缺 message.* token 时给 warning，且列出缺了哪些', () => {
  const content = new ContentRegistry()
  // `load`/`loadAll` 是**返回**问题清单的，不是挂在属性上。
  content.loadAll(builtinPacks())
  // **跨条目的引用校验是 `validate()` 这个单独方法**，`load` 只做单包校验。
  // 一开始我在 `load()` 的返回值里找，结果什么都找不到——这不是 bug，
  // 是"单包校验"与"跨包引用校验"本来就该分开（前者在装载时就要拦，后者要等全部装完）。
  assert.deepEqual(
    content.validate().filter((i) => i.where === 'skins/message'),
    [],
    '内置包应当把五种纸条配色都带上',
  )

  // 造一个只提供「只有 role.token、没有 message.*」的皮肤包，顶掉默认皮肤。
  content.load({
    manifest: {
      id: 'pack.bare-skin',
      name: '缺纸条配色的皮肤',
      version: '1.0.0',
      schemaVersion: 1,
      requires: [],
      provides: ['skins'],
      // 覆盖别人的条目必须显式声明，格式是 `kind/id` 字符串（不是对象）。
      overrides: ['skins/skin.default'],
    },
    entries: { skins: [{ id: 'skin.default', name: '裸皮肤', colors: { 'role.lead': '#F0B429' } }] },
  })

  const warn = content.validate().filter((i) => i.where === 'skins/message')
  assert.equal(warn.length, 1)
  assert.equal(warn[0].level, 'warning', '缺纸条颜色不该让世界建不出来')
  assert.match(warn[0].message, /message\.handoff/, '要列出缺了哪些 token')
  assert.match(warn[0].message, /洋红/, '要说清后果')
})

// ── 主题 ────────────────────────────────────────────────────────────────────

test('themeFor：把内容里的主题映射成渲染就绪的形状（色值解析完、缺省补齐）', () => {
  const content = new ContentRegistry()
  content.loadAll(builtinPacks())
  const theme = portOf(content).themeFor('scene.default-town')

  assert.ok(theme)
  assert.equal(theme.id, 'theme.cozy-isometric')
  // 名字与色值都是**内容**，这里不钉死（R32 换过一次皮肤，钉死的断言只会让"换内容"变成"改测试"）。
  // 该守的是：名字非空、色值都被解析成了合法的 #RRGGBB。
  assert.equal(typeof theme.name, 'string')
  assert.notEqual(theme.name, '')

  // 相机
  assert.equal(theme.camera.projection, 'orthographic')
  assert.equal(theme.camera.yawDeg, 45)
  assert.equal(theme.camera.pitchDeg, 35.264)

  // 光照里的 token 要解析成色值：`skin.paper` / `skin.ground`。
  assert.match(theme.lighting.hemisphere.sky, /^#[0-9A-Fa-f]{6}$/)
  assert.match(theme.lighting.hemisphere.ground, /^#[0-9A-Fa-f]{6}$/)
  // 字面色值也要解析成颜色（具体是哪个色由主题内容决定，不在这里钉死）。
  assert.match(theme.lighting.directional.color, /^#[0-9A-Fa-f]{6}$/, '字面色值原样保留')
  assert.equal(typeof theme.lighting.directional.position.y, 'number')

  // 雾也是 token：`skin.fog`
  assert.match(theme.fog.color, /^#[0-9A-Fa-f]{6}$/)
  assert.notEqual(theme.fog.color, '#FF00FF')

  assert.equal(theme.post.toneMapping, 'ACESFilmic')
  assert.equal(theme.post.bloom.enabled, false)
})

test('themeFor：场景或主题缺失时返回 null（渲染层退回缺省，而不是黑屏）', () => {
  const content = new ContentRegistry()
  content.loadAll(builtinPacks())
  const port = portOf(content)

  assert.equal(port.themeFor('scene.根本没有'), null)
})

test('themeFor：自由的 lighting/post 结构要**一边读一边窄化**，缺字段用缺省而不是崩', () => {
  const content = new ContentRegistry()
  content.loadAll(builtinPacks())
  const port = portOf(content)

  // 内置主题只写了部分字段（`lighting` / `post` 在内容类型里是刻意的自由结构），
  // 所以能直接验到"缺字段被补齐"这条路径——不必另外造一个残主题。
  // 映射层扛不住的话，一个内容小失误就会让整块面板白屏。
  const theme = port.themeFor('scene.default-town')
  assert.ok(theme)
  assert.equal(typeof theme.post.exposure, 'number')
  assert.equal(typeof theme.post.bloom.threshold, 'number')
  assert.equal(typeof theme.lighting.ambient.intensity, 'number')
})

// ── 模型表（R16：模型选择是内容，不是代码拼接）────────────────────────────────

test('模型表：计划里带上了**本场景用到的**模型，且构建器名解析出来了', () => {
  const content = new ContentRegistry()
  content.loadAll(builtinPacks())
  const world = createWorld({ content, scene: 'scene.default-town', createdAt: '2026-01-01T00:00:00.000Z' })
  const port = portOf(content)

  const plan = buildScenePlan(world, port.colors(), port.themeFor(world.origin.scene), (id) => port.modelOf(id))

  assert.ok(plan.models.length > 0, '模型表不能是空的')
  // 10 个站点只用到 6 种模型 + 1 个角色模型 = 7（不是整本库搬过来）。
  // M4-11 R48: 工位加了椅子/显示器/键盘/台灯/盆栽等小件，模型数从 7 升到 15。
  // 核心不变：只带本场景用到的（不是整本模型库）。
  assert.ok(plan.models.length >= 7, `至少要有基础那 7 个，实际 ${plan.models.length}`)
  assert.ok(plan.models.length < 50, `不应该把整本库搬过来（实际 ${plan.models.length}）`)
  for (const model of plan.models) {
    // 每个模型**恰好**是两种来源之一：程序化（有 builder）或外部文件（有 url）。
    // 两个都有或都没有都是协议错——渲染器会不知道该走哪条路。
    assert.equal(
      (model.builder === null) !== (model.url === null),
      true,
      `${model.id} 应当恰好有 builder 或 url 之一：${JSON.stringify(model)}`,
    )
    assert.equal(typeof model.scale, 'number')
  }

  // 角色模型来自 `pack.kenney-mini`（它 `overrides` 掉了基础包的程序化 `avatar`）。
  // 这就是"换资产只改内容"：模拟内核与渲染器都没有为此改一行。
  const avatar = plan.models.find((m) => m.id === 'model.agent.base')
  assert.ok(avatar, '角色模型要在表里')
  assert.equal(avatar.builder, null, '角色现在是 GLB，不是程序化几何')
  assert.equal(avatar.url, 'kenney-mini-characters/character-male-a.glb')
  assert.ok(avatar.scale > 1, 'Kenney 的角色自然高度是 0.671，要放大到与镇上家具成比例')

  // 每个 prop/actor 的 modelId 都能在表里查到——查不到就是内容对不上，
  // 而渲染器的表现是"一个品红方块"。
  const ids = new Set(plan.models.map((m) => m.id))
  for (const prop of plan.props) {
    for (const part of prop.parts) {
      assert.ok(ids.has(part.modelId), `站点 ${prop.id} 的部件模型 ${part.modelId} 不在表里`)
    }
  }
  for (const actor of plan.actors) assert.ok(ids.has(actor.modelId), `角色 ${actor.id} 的模型不在表里`)
})

test('模型 id 来自内容声明，**不是代码拼接出来的**（换一个模型，计划跟着变）', () => {
  // 造一个外部包：只把 `station.desk-a` 换成一个**完全不同命名**的模型。
  // 如果代码还在拼 `model.station.${kind}`，这条就会红——那正是 R16 修掉的毛病。
  const content = new ContentRegistry()
  content.loadAll(builtinPacks())
  content.load(
    {
      manifest: {
        id: 'pack.swap-model',
        name: '换模型包',
        version: '1.0.0',
        schemaVersion: 1,
        requires: [],
        provides: ['stations', 'models'],
        overrides: ['stations/station.desk-a'],
      },
      entries: {
        models: [
          { id: 'model.custom.pod', name: '自定义舱', source: { kind: 'procedural', builder: 'server' }, scale: 1.5, rotationY: 0, anchorY: 0 },
        ],
        stations: [
          {
            id: 'station.desk-a',
            name: '工位 A',
            kind: 'desk',
            district: 'district.engineering',
            relativeTo: 'district.engineering',
            anchor: { x: -1, z: -1 },
            capacity: 1,
            capabilities: ['code'],
            model: 'model.custom.pod',
          },
        ],
      },
    },
    { allowImplicitOverride: true },
  )

  const world = createWorld({ content, scene: 'scene.default-town', createdAt: '2026-01-01T00:00:00.000Z' })
  const port = portOf(content)
  const plan = buildScenePlan(world, port.colors(), port.themeFor(world.origin.scene), (id) => port.modelOf(id))

  const swapped = plan.props.find((p) => p.id === 'station.desk-a')
  assert.ok(swapped.parts.some((pt) => pt.modelId === 'model.custom.pod'), '站点用的是内容声明的模型，不是拼接出来的 model.station.desk')

  const model = plan.models.find((m) => m.id === 'model.custom.pod')
  assert.ok(model, '换进去的模型要出现在模型表里')
  assert.equal(model.builder, 'server', '构建器名要解析出来')
  assert.equal(model.scale, 1.5, '缩放也是内容说了算')
})

test('模型表：宿主没装模型库时（拿不到解析器）也不炸，只是表为空', () => {
  const world = makeWorld()
  const plan = buildScenePlan(world, {}, null)
  assert.deepEqual(plan.models, [], '没给解析器时表为空——渲染器会把缺的模型报出来，而不是静默画方块')
})

test('R48：从旧存档接回的世界（站点没有 parts 字段）**不许 500**，退回单件 model', () => {
  const content = new ContentRegistry()
  content.loadAll(builtinPacks())
  const port = portOf(content)
  const world = makeWorld()
  // 模拟 R47 之前存下来的世界：站点有 model、没有 parts。
  for (const st of world.stations) {
    assert.ok(Array.isArray(st.parts), '新建的世界应该有 parts')
    delete st.parts
  }
  const plan = buildScenePlan(world, port.colors(), null)
  assert.equal(plan.props.length, world.stations.length, '每个站点仍要出现在计划里')
  for (const prop of plan.props) {
    assert.equal(prop.parts.length, 1, '退回单件')
    assert.ok(prop.parts[0].modelId.length > 0)
  }
})
