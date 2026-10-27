/**
 * 游戏模式（R363）与主动活动（activityUntil）的边缘用例。
 *
 * 覆盖三件事，且都在**最小世界**上直接断言，不依赖内容库：
 *  1. `gameMode` 关闭时，heartbeat 只产出 intent，不许移动任何人（含 tick=180）；
 *  2. `gameMode` 开启且 `tick % 180 === 0` 时，多人被叫进**同一个会场**、拿到**同一个**
 *     `activityUntil`，并且会议容量是硬上限；
 *  3. `activityUntil` 到点后由 `advanceIdle` 收回：回 idle、释放站点、清掉活动标记。
 *
 * 第 3 条走的是 `idle.ts` 里那个"到点散会"的分支——它只在 talking / sleeping /
 * working(activityKind=work) 三种状态下生效，所以三种都各钉一条。
 */
import assert from 'node:assert/strict'
import test from 'node:test'

import { runHeartbeats } from '../lib/sim/heartbeat.js'
import { advanceIdle } from '../lib/sim/idle.js'

/** 一个能跑 heartbeat 的最小世界（nav=null → 直线可达，不依赖地图）。 */
function makeWorld({ agents = 2, meetingCapacity = 4 } = {}) {
  const slots = Array.from({ length: meetingCapacity }, (_, i) => ({ x: i, z: 0 }))
  const people = Array.from({ length: agents }, (_, i) => ({
    id: `agent-${i}`,
    name: `Agent ${i}`,
    role: 'engineer',
    state: 'idle',
    carrying: null,
    station: null,
    targetStation: null,
    position: { x: i, z: 0 },
    facing: 0,
    path: [],
    hangout: { x: 10, z: 10 },
    boundAgentId: null,
  }))
  return {
    tick: 0,
    seed: 7,
    gameMode: true,
    nav: null,
    messages: [],
    messageSeq: 0,
    tasks: [],
    agents: people,
    stations: [
      {
        id: 'meeting',
        kind: 'meeting',
        capacity: meetingCapacity,
        capabilities: ['converse'],
        anchor: { x: 5, z: 5 },
        slots,
      },
      {
        id: 'break',
        kind: 'breakroom',
        capacity: 1,
        capabilities: ['rest'],
        anchor: { x: 8, z: 8 },
        slots: [{ x: 0, z: 0 }],
      },
    ],
  }
}

test('gameMode=false：heartbeat 不移动任何人（覆盖 tick=180 的召集点）', () => {
  const world = makeWorld({ agents: 3 })
  world.gameMode = false
  const before = structuredClone(world.agents)

  for (let tick = 0; tick <= 200; tick += 1) {
    world.tick = tick
    runHeartbeats(world, [])
    assert.deepEqual(world.agents, before, `tick=${tick} 时 gameMode 关闭却改动了角色`)
  }

  // 同一份世界、只把开关打开：tick=180 必须真的动起来——
  // 否则上一条可能只是"世界本来就不会动"，什么也没证明。
  world.tick = 180
  world.gameMode = true
  runHeartbeats(world, [])
  assert.ok(
    world.agents.some((agent) => agent.state === 'walking'),
    '对照组：gameMode=true 且 tick=180 时应该有角色被派去开会',
  )
})

test('tick=180：多人被召集到同一会场，且拿到同一个 activityUntil', () => {
  const world = makeWorld({ agents: 3, meetingCapacity: 4 })
  world.tick = 180

  runHeartbeats(world, [])

  assert.equal(world.agents.length, 3)
  for (const agent of world.agents) {
    assert.equal(agent.state, 'walking')
    assert.equal(agent.targetStation, 'meeting')
    assert.equal(agent.activityKind, 'meet')
    assert.ok(agent.path.length > 0)
  }
  const untils = new Set(world.agents.map((agent) => agent.activityUntil))
  assert.equal(untils.size, 1, `同一场会议必须同一结束 tick，实际是 ${[...untils].join(',')}`)
  assert.equal([...untils][0], 180 + 60)

  // 同一 tick 再心跳一次：已经在路上的人不能被重新派活/改结束 tick。
  runHeartbeats(world, [])
  for (const agent of world.agents) {
    assert.equal(agent.state, 'walking')
    assert.equal(agent.activityUntil, 240)
  }
})

test('tick=180：周期会议受站点容量约束，超出的人留在原地', () => {
  const world = makeWorld({ agents: 5, meetingCapacity: 2 })
  world.tick = 180

  runHeartbeats(world, [])

  const walking = world.agents.filter((agent) => agent.state === 'walking')
  assert.equal(walking.length, 2, '会议容量是 2，只该派 2 个人')
  assert.ok(walking.every((agent) => agent.targetStation === 'meeting'))
  assert.equal(new Set(walking.map((agent) => agent.activityUntil)).size, 1)

  const idle = world.agents.filter((agent) => agent.state === 'idle')
  assert.equal(idle.length, 3)
  assert.ok(idle.every((agent) => agent.targetStation === null && agent.activityUntil === undefined))
})

/** 只保留 `advanceIdle` 到点散会分支会读到的字段。 */
function makeActivityWorld(state, activityKind, station, activityUntil, tick) {
  return {
    tick,
    seed: 1,
    nav: null,
    tasks: [],
    agents: [
      {
        id: 'a',
        state,
        station,
        targetStation: null,
        position: { x: 0, z: 0 },
        facing: 0,
        path: [],
        carrying: null,
        hangout: null,
        activityKind,
        activityUntil,
      },
    ],
  }
}

test('activityUntil 未到点：活动状态与站点保持不变', () => {
  const world = makeActivityWorld('talking', 'meet', 'meeting', 120, 119)
  const out = advanceIdle(world, [])
  assert.equal(world.agents[0].state, 'talking')
  assert.equal(world.agents[0].station, 'meeting')
  assert.equal(world.agents[0].activityUntil, 120)
  assert.deepEqual(out.stateChanged, [])
  assert.deepEqual(out.advanced, [])
})

for (const { label, state, kind, station } of [
  { label: 'meet/talking', state: 'talking', kind: 'meet', station: 'meeting' },
  { label: 'rest/sleeping', state: 'sleeping', kind: 'rest', station: 'break' },
  { label: 'work/working', state: 'working', kind: 'work', station: 'desk' },
]) {
  test(`activityUntil 到点：${label} → idle、释放站点、清掉活动标记`, () => {
    const world = makeActivityWorld(state, kind, station, 120, 120)
    // 让"释放站点"可被验证：先确认它确实挂在站点上。
    assert.equal(world.agents[0].station, station)

    const out = advanceIdle(world, [])

    const agent = world.agents[0]
    assert.equal(agent.state, 'idle')
    assert.equal(agent.station, null)
    assert.equal(agent.targetStation, null)
    assert.deepEqual(agent.path, [])
    assert.equal(agent.activityKind, undefined)
    assert.equal(agent.activityUntil, undefined)
    assert.deepEqual(out.stateChanged, ['a'])
  })
}
