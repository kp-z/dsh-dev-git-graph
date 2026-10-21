/**
 * `moveAgent` 命令（P4）：玩家键盘操控的落点要**真写进世界**。
 *
 * 为什么单独立一个文件：这条命令横跨协议与模拟两步，而且有一条硬约束——
 * **坏坐标必须拒**。NaN 一旦写进 `position`，寻路、渲染、快照会一起坏掉，
 * 而且这种坏是"看起来人不见了"那种最难查的形态。
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'

import { ContentRegistry, builtinPacks } from '../lib/content/index.js'
import { createWorld } from '../lib/world/create.js'
import { step } from '../lib/sim/step.js'
import { isWorldCommand, describeCommand } from '../lib/protocol/index.js'

function makeWorld() {
  const content = new ContentRegistry()
  content.loadAll(builtinPacks())
  return createWorld({
    content,
    scene: 'scene.default-town',
    createdAt: '2026-01-01T00:00:00.000Z',
    taskSets: ['task.quick-fix'],
  })
}

test('moveAgent：是合法命令，且描述是可读中文', () => {
  const command = { kind: 'moveAgent', agentId: 'agent-1', x: 1.5, z: -2.25 }
  assert.equal(isWorldCommand(command), true)
  const text = describeCommand(command)
  assert.ok(text.length > 0)
  assert.ok(!/undefined|null|NaN/.test(text), `描述里不该漏出空值：${text}`)
})

test('moveAgent：位置写进世界，并清掉在途状态（否则会被旧路径拽走）', () => {
  const world = makeWorld()
  const agent = world.agents[0]
  assert.ok(agent, '这个世界里应当至少有一个角色')

  // 先造出"在途"残留：路径、目标工位、在站标记都挂上。
  agent.path = [{ x: 3, z: 3 }]
  agent.targetStation = 'station.whatever'
  agent.station = 'station.whatever'
  agent.state = 'walking'

  const result = step(world, [{ kind: 'moveAgent', agentId: agent.id, x: 2.5, z: -1.5 }])

  assert.deepEqual(agent.position, { x: 2.5, z: -1.5 })
  assert.deepEqual(agent.path, [], '在途路径必须清掉，否则下一 tick 会沿旧路走回去')
  assert.equal(agent.targetStation, null)
  assert.equal(agent.station, null)
  assert.equal(agent.state, 'idle')

  const moved = result.events.filter((event) => event.type === 'agent.moved')
  assert.equal(moved.length, 1, '应当产出一条 agent.moved 事件（回放与诊断都靠它）')
  assert.equal(moved[0].payload.id, agent.id)
  assert.deepEqual(
    { x: moved[0].payload.x, z: moved[0].payload.z },
    { x: 2.5, z: -1.5 },
  )
})

test('moveAgent：待命锚点跟着走，否则待命逻辑会把人拽回旧歇脚点', () => {
  const world = makeWorld()
  const agent = world.agents[0]
  const before = agent.hangout
  assert.ok(before !== null, '默认世界里角色应当有歇脚点')

  step(world, [{ kind: 'moveAgent', agentId: agent.id, x: 5, z: 6 }])

  assert.deepEqual(agent.hangout, { x: 5, z: 6 })
  assert.notDeepEqual(agent.hangout, before)
})

test('moveAgent：坏坐标/不存在的角色一律拒（不许把 NaN 写进位置）', () => {
  const world = makeWorld()
  const agent = world.agents[0]
  const before = { ...agent.position }

  const bad = [
    { kind: 'moveAgent', agentId: agent.id, x: Number.NaN, z: 0 },
    { kind: 'moveAgent', agentId: agent.id, x: 0, z: Number.POSITIVE_INFINITY },
    { kind: 'moveAgent', agentId: 'agent.不存在', x: 1, z: 1 },
  ]
  for (const command of bad) {
    const result = step(world, [command])
    assert.equal(
      result.events.filter((event) => event.type === 'agent.moved').length,
      0,
      `${JSON.stringify(command)} 不该产生移动事件`,
    )
  }

  assert.deepEqual(agent.position, before, '被拒的命令不许改动位置')
  assert.ok(Number.isFinite(agent.position.x) && Number.isFinite(agent.position.z))
})

test('moveAgent：服务端不再按 nav 格夹回（R229：物理由精细几何负责）', () => {
  const world = makeWorld()
  const agent = world.agents[0]
  assert.ok(agent, '这个世界里应当至少有一个角色')

  // nav 说中间格不可走，但服务端**不再**用粗网格改写客户端落点：
  // 按格夹回会在视觉是地板的位置把人拽回来，那正是"空气墙错位"。
  world.nav = {
    width: 3,
    height: 1,
    unitsPerCell: 1,
    originX: -1.5,
    originZ: -0.5,
    blocked: [false, true, false],
  }

  const result = step(world, [{ kind: 'moveAgent', agentId: agent.id, x: 0, z: 0 }])
  assert.deepEqual(agent.position, { x: 0, z: 0 }, '落点要原样写进世界')
  const moved = result.events.find((event) => event.type === 'agent.moved')
  assert.equal(moved.payload.source, 'manual')
})

test('moveAgent：落点可走时保持原坐标（不误伤正常操控）', () => {
  const world = makeWorld()
  const agent = world.agents[0]
  world.nav = {
    width: 3,
    height: 1,
    unitsPerCell: 1,
    originX: -1.5,
    originZ: -0.5,
    blocked: [false, true, false],
  }

  const result = step(world, [{ kind: 'moveAgent', agentId: agent.id, x: 1, z: 0 }])
  assert.deepEqual(agent.position, { x: 1, z: 0 })
  const moved = result.events.find((event) => event.type === 'agent.moved')
  assert.equal(moved.payload.source, 'manual')
})
