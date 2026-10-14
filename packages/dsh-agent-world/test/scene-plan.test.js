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
  assert.match(desk.modelId, /^model\.station\.desk$/, '渲染器靠它去模型库里取，所以约定要稳')
  assert.equal(plan.props.find((p) => p.kind === 'lab')?.modelId, 'model.station.lab')
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

// ── 主题 ────────────────────────────────────────────────────────────────────

test('themeFor：把内容里的主题映射成渲染就绪的形状（色值解析完、缺省补齐）', () => {
  const content = new ContentRegistry()
  content.loadAll(builtinPacks())
  const theme = portOf(content).themeFor('scene.default-town')

  assert.ok(theme)
  assert.equal(theme.id, 'theme.cozy-isometric')
  assert.equal(theme.name, '舒适等距沙盘')

  // 相机
  assert.equal(theme.camera.projection, 'orthographic')
  assert.equal(theme.camera.yawDeg, 45)
  assert.equal(theme.camera.pitchDeg, 35.264)

  // 光照里的 token 要解析成色值：`skin.paper` / `skin.ground`。
  assert.match(theme.lighting.hemisphere.sky, /^#[0-9A-Fa-f]{6}$/)
  assert.match(theme.lighting.hemisphere.ground, /^#[0-9A-Fa-f]{6}$/)
  assert.equal(theme.lighting.directional.color, '#FFD9A0', '字面色值原样保留')
  assert.equal(theme.lighting.directional.position.y, 18)

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
