/**
 * 待命行为（R68）：让"没活干的人"自己找点事做。
 *
 * ## 这份测试在防什么
 *
 * 待命行为是**纯表现**的东西——它坏了不会让任何断言变红，只会让屏幕上的人站着不动。
 * 所以这里的每一条都是"把那种沉默的坏法钉成红的"：
 *
 *  1. **确定性**：同一 seed 必须长出**同一段**行为（判据是整世界逐字节相同）。
 *     这条最容易被"顺手用 Math.random 挑一下"弄坏，而坏了之后 bug 再也复现不了。
 *  2. **真的在动**：只有"两个世界一样"是不够的——都不动也满足那条。
 *     所以还要断言里面**确实发生过**朝向变化或位置变化。
 *  3. **由内容驱动**：换掉目录，行为就得跟着换（否则"行为目录是内容"只是句口号）。
 *  4. **不越界**：待命的人不许占工位、不许在有待领工单时还坐着不动。
 *
 * ⚠️ 这些测试**必须把目录传进 `step()`**（第三个参数）。不传就是"没接内容"的老路径，
 * 那几个断言会**全绿而且什么都没验**——那正是本轮最容易骗过自己的一种绿。
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'

import { ContentRegistry, builtinPacks } from '../lib/content/index.js'
import { createWorld } from '../lib/world/create.js'
import { createPluginState } from '../lib/state.js'
import { resolveConfig } from '../lib/config.js'
import { step } from '../lib/sim/step.js'
import {
  quarterFacing,
  quarterOf,
  idleSlotAt,
  lookFacing,
  paceGoal,
  slotTicks,
} from '../lib/sim/idle-behavior.js'
// 跨层对照：渲染器把朝向量化成四方向的**那一份实现**。
// `sim/` 按边界规则不许 import `web/`，所以只能各写一份，用这条测试把两份钉在一起。
import { directionOf } from '../web/core/scene-layout.js'

/** 造一个世界（与 `test/sim.test.js` 的造法一致：不经 store，不写盘）。 */
function makeWorld({ taskSets = ['task.quick-fix'], name = 'idle-seed' } = {}) {
  const content = new ContentRegistry()
  content.loadAll(builtinPacks())
  return createWorld({
    content,
    scene: 'scene.default-town',
    name,
    createdAt: '2026-01-01T00:00:00.000Z',
    taskSets,
  })
}

/** 从**内容库**里取出待命行为目录（与 runtime 注入给 `step()` 的是同一条路）。 */
function idleBehaviorsFromContent() {
  const service = createPluginState(resolveConfig({ autoStart: false, persistEveryTicks: 0 }))
  service.ensureWorld()
  return service.content().idleBehaviors()
}

/** 跑 N tick，每步都带上目录。 */
function run(world, ticks, behaviors) {
  for (let i = 0; i < ticks; i += 1) step(world, [], { idleBehaviors: behaviors })
  return world
}

/** 待命角色的"行为指纹"：位置 + 朝向。用来判断他到底动没动。 */
function idleFingerprint(world) {
  return world.agents
    .filter((agent) => agent.state === 'idle' || agent.state === 'sleeping')
    .map((agent) => `${agent.id}:${agent.position.x.toFixed(4)},${agent.position.z.toFixed(4)},${agent.facing.toFixed(4)}`)
    .sort()
}

test('待命行为：目录来自内容库（三条、覆盖 look/pace/rest）', () => {
  const behaviors = idleBehaviorsFromContent()
  const ids = behaviors.map((behavior) => behavior.id)
  assert.ok(behaviors.length >= 3, `内容里应当有待命行为，实际 ${behaviors.length} 条：${ids.join(' / ')}`)
  const kinds = new Set(behaviors.map((behavior) => behavior.kind))
  for (const kind of ['look', 'pace', 'rest']) {
    assert.ok(kinds.has(kind), `目录里缺 ${kind}：${ids.join(' / ')}`)
  }
  for (const behavior of behaviors) {
    assert.ok(behavior.ticksMin > 0, `${behavior.id}.minTicks 必须 > 0`)
    assert.ok(behavior.ticksMax >= behavior.ticksMin, `${behavior.id} 的 maxTicks 不能小于 minTicks`)
    assert.ok(behavior.radius >= 0, `${behavior.id}.radius 必须非负`)
  }
})

test('待命行为：权重最大的那条是 look（渲染器按最大权重取带，权重配错会换掉全体待命表现）', () => {
  const behaviors = idleBehaviorsFromContent()
  let top = behaviors[0]
  for (const behavior of behaviors) {
    if (behavior.weight > top.weight) top = behavior
  }
  assert.equal(
    top.kind,
    'look',
    `权重最大的是 ${top.id}（${top.kind}，${top.weight}）。渲染器的 bandOfState 取该状态下权重最大的动作` +
      '决定播哪条带，所以这里必须是 look——否则全体待命角色会一起换姿势。',
  )
})

test('确定性：同 seed + 同目录跑 800 tick，两个世界逐字节一致', () => {
  const behaviors = idleBehaviorsFromContent()
  const a = run(makeWorld({ name: 'same-seed' }), 800, behaviors)
  const b = run(makeWorld({ name: 'same-seed' }), 800, behaviors)
  assert.equal(JSON.stringify(a), JSON.stringify(b), '同 seed 的两个世界必须逐字节一致')
})

test('确定性：800 tick 里待命的人**确实在动**（不是"因为没变化所以相等"）', () => {
  const behaviors = idleBehaviorsFromContent()
  const world = makeWorld({ name: 'moving' })
  const seen = new Set()
  for (let i = 0; i < 800; i += 1) {
    step(world, [], { idleBehaviors: behaviors })
    for (const line of idleFingerprint(world)) seen.add(line)
  }
  // 每个角色 800 tick 里至少出现过两种不同的指纹（换了朝向或换了位置）。
  const perAgent = new Map()
  for (const line of seen) {
    const id = line.slice(0, line.indexOf(':'))
    perAgent.set(id, (perAgent.get(id) ?? 0) + 1)
  }
  const alive = [...perAgent.values()].filter((count) => count > 1).length
  assert.ok(
    alive >= 4,
    `800 tick 里应当有多个待命角色出现多种姿态，实际只有 ${alive} 个（样本 ${perAgent.size} 个角色）。` +
      '如果这里是 0，说明"确定性"那条是在空转。',
  )
})

test('确定性：不同 seed 会分叉（否则"确定性"是假的）', () => {
  const behaviors = idleBehaviorsFromContent()
  const a = run(makeWorld({ name: 'seed-a' }), 400, behaviors)
  const b = run(makeWorld({ name: 'seed-b' }), 400, behaviors)
  assert.notEqual(JSON.stringify(a), JSON.stringify(b), '不同 seed 必须走出不同的世界')
})

test('不传目录 = 老行为：站在歇脚点上的人不会自己动（回退路径不是废弃路径）', () => {
  // 直接摆一个"已经站在歇脚点上"的人来问，而不是"跑 200 tick 再看"——
  // 后者把断言绑在"多久能走到位"上，那是个会随内容与地图变化的时间假设。
  const world = makeWorld({ name: 'no-catalog' })
  const agent = world.agents[0]
  assert.ok(agent !== undefined && agent.hangout !== null, '第一个角色应当有歇脚点')
  agent.position = { x: agent.hangout.x, z: agent.hangout.z }
  agent.path = []
  agent.state = 'idle'
  agent.facing = 0

  const before = { position: { ...agent.position }, facing: agent.facing, state: agent.state }
  for (let i = 0; i < 300; i += 1) step(world)
  assert.deepEqual({ position: { ...agent.position }, facing: agent.facing, state: agent.state }, before,
    '没有目录时待命的人不该自己换朝向、挪位置或坐下')
})

test('待命的人真的会动：换朝向或挪位置（用同一个角色的采样，不靠"多数人"兜底）', () => {
  const behaviors = idleBehaviorsFromContent()
  const world = makeWorld({ name: 'one-agent-moving' })
  const agent = world.agents[0]
  assert.ok(agent !== undefined && agent.hangout !== null)
  agent.position = { x: agent.hangout.x, z: agent.hangout.z }
  agent.path = []

  const poses = new Set()
  for (let i = 0; i < 2000; i += 1) {
    step(world, [], { idleBehaviors: behaviors })
    poses.add(`${agent.position.x.toFixed(3)},${agent.position.z.toFixed(3)},${agent.facing.toFixed(3)}`)
  }
  assert.ok(poses.size > 1, `2000 tick 里这个待命角色只有一种姿态（${poses.size} 种）——他没在动`)
})

test('行为由内容驱动：把 pace 从目录里摘掉，就再也不会有踱步', () => {
  const behaviors = idleBehaviorsFromContent()
  const withoutPace = behaviors.filter((behavior) => behavior.kind !== 'pace')
  assert.ok(withoutPace.length > 0 && withoutPace.length < behaviors.length, '目录应当既有 pace 也有别的')

  // 直接问"要选的话会选谁"，比跑世界再看位置更直接。
  let paceSeen = 0
  for (let tick = 0; tick < 3000; tick += 7) {
    const slot = idleSlotAt(withoutPace, 12345, 'agent-1', tick)
    if (slot !== null && slot.behavior.kind === 'pace') paceSeen += 1
  }
  assert.equal(paceSeen, 0, '目录里没有 pace，却还是挑出了 pace')

  // 反过来：完整目录在同一批 tick 上必须挑得出 pace（否则上一条是空过的）。
  let paceWithCatalog = 0
  for (let tick = 0; tick < 3000; tick += 7) {
    const slot = idleSlotAt(behaviors, 12345, 'agent-1', tick)
    if (slot !== null && slot.behavior.kind === 'pace') paceWithCatalog += 1
  }
  assert.ok(paceWithCatalog > 0, '完整目录在这些 tick 上一次 pace 都没挑出来，测试是空的')
})

test('待命的人不占工位：跑 600 tick，待命角色不挂站点、也不占任何工位', () => {
  const behaviors = idleBehaviorsFromContent()
  const world = makeWorld({ name: 'no-takeover' })
  // 派一单出去，让"有人在干活"和"有人待命"同时存在。
  step(world, [{ kind: 'dispatch', taskSet: 'task.quick-fix' }], { idleBehaviors: behaviors })
  for (let i = 0; i < 600; i += 1) {
    step(world, [], { idleBehaviors: behaviors })
    for (const agent of world.agents) {
      if (agent.state !== 'idle' && agent.state !== 'sleeping') continue
      assert.equal(agent.targetStation, null, `${agent.name} 待命中却挂着目标工位`)
      assert.equal(agent.station, null, `${agent.name} 待命中却占着工位`)
    }
  }
})

test('不卡派工：有待领工单时没人还坐着（scheduler 只从 idle 里挑人）', () => {
  const behaviors = idleBehaviorsFromContent()
  const world = makeWorld({ name: 'no-stall' })
  step(world, [{ kind: 'dispatch', taskSet: 'task.quick-fix' }], { idleBehaviors: behaviors })
  for (let i = 0; i < 600; i += 1) {
    step(world, [], { idleBehaviors: behaviors })
    const ready = world.tasks.some((task) => task.status === 'ready')
    if (!ready) continue
    const asleep = world.agents.filter((agent) => agent.state === 'sleeping')
    assert.equal(
      asleep.length,
      0,
      `队列里有待领的工单时不该有人坐着歇（${asleep.map((a) => a.name).join(' / ')}）——` +
        '调度器只从 state==="idle" 里挑人，坐着的人拿不到活。',
    )
  }
})

test('跨层一致：sim 的四方向量化与渲染器的 directionOf 在同一套约定上', () => {
  for (let step = 0; step < 720; step += 1) {
    const facing = (step / 720) * Math.PI * 2 - Math.PI
    const expected = directionOf(facing)
    const actual = ['right', 'down', 'left', 'up'][quarterOf(facing)]
    assert.equal(actual, expected, `facing=${facing.toFixed(6)} 两侧算出的方向不同`)
  }
})

test('张望：相邻两槽必然换一个方向，且同一槽反复调用不漂', () => {
  for (const seed of [1, 42, 999, 123456]) {
    for (const agentId of ['agent-1', 'agent-7', 'agent-13']) {
      for (let slot = 1; slot < 60; slot += 1) {
        const now = quarterOf(lookFacing(seed, agentId, slot))
        const before = quarterOf(lookFacing(seed, agentId, slot - 1))
        assert.notEqual(
          now,
          before,
          `seed=${seed} ${agentId} 第 ${slot} 槽与上一槽同方向 —— 图集只有四向，"张望"就看不见了`,
        )
        // 幂等：这就是"一槽只写一次"赖以成立的性质（不是相对旋转）。
        assert.equal(lookFacing(seed, agentId, slot), lookFacing(seed, agentId, slot))
      }
    }
  }
})

test('踱步点：落在半径内；走得进去就用，走不进去就原地', () => {
  const home = { x: 3, z: -2 }
  for (let slot = 0; slot < 50; slot += 1) {
    const point = paceGoal(7, 'agent-3', slot, home, 0.9)
    const distance = Math.hypot(point.x - home.x, point.z - home.z)
    assert.ok(distance <= 0.9 + 1e-9, `踱步点跑出半径：${distance}`)
  }
  // 所有点都判定为不可走 → 退回歇脚点，而不是硬走进去。
  const stuck = paceGoal(7, 'agent-3', 4, home, 0.9, () => false)
  assert.deepEqual(stuck, home, '哪儿都走不进去时就该待在原地')
})

test('四方向角度与下标一一对应（quarterFacing / quarterOf 互逆）', () => {
  for (let index = 0; index < 4; index += 1) {
    assert.equal(quarterOf(quarterFacing(index)), index, `第 ${index} 个方向不互逆`)
  }
})

test('槽长取目录里最长的 maxTicks（换内容就换节奏，代码里没有魔法数）', () => {
  const behaviors = idleBehaviorsFromContent()
  const longest = Math.max(...behaviors.map((behavior) => behavior.ticksMax))
  assert.equal(slotTicks(behaviors), longest)
  assert.equal(slotTicks([]), 1, '空目录也要给一个正的槽长，不能是 0（否则除零）')
})
