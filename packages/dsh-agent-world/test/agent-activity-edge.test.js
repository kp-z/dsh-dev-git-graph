/**
 * agentActivity 命令与 Persona 结算的边缘用例。
 *
 * 覆盖两块：
 *  1. `agentActivity` 的 `skill` 路由：research / compute / review 各自落到**能力匹配**的
 *     站点上，而不是"第一个有空位的站点"；没有匹配站点时不许把人凭空挪走。
 *  2. Persona `awardTask` 的幂等性：同一张单只结算一次 XP，`taskIds` /
 *     `awardedTaskIds` 都不重复，重开 store 后这条保证仍然成立。
 */
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { createPersonaStore } from '../lib/persona/store.js'
import { step } from '../lib/sim/step.js'

function makeWorld() {
  return {
    tick: 10,
    seed: 1,
    gameMode: false,
    nav: null,
    paused: false,
    tasks: [],
    messages: [],
    messageSeq: 0,
    events: [],
    seq: 0,
    agents: [
      {
        id: 'a',
        name: 'A',
        role: 'engineer',
        state: 'idle',
        carrying: null,
        station: null,
        targetStation: null,
        path: [],
        position: { x: 0, z: 0 },
        facing: 0,
        hangout: null,
        boundAgentId: null,
      },
    ],
    stations: [
      { id: 'desk', kind: 'desk', capacity: 2, capabilities: ['code'], anchor: { x: 1, z: 1 }, slots: [{ x: 0, z: 0 }, { x: 1, z: 0 }] },
      { id: 'review-desk', kind: 'desk', capacity: 1, capabilities: ['review'], anchor: { x: 2, z: 2 }, slots: [{ x: 0, z: 0 }] },
      { id: 'lab', kind: 'lab', capacity: 1, capabilities: ['research'], anchor: { x: 3, z: 3 }, slots: [{ x: 0, z: 0 }] },
      { id: 'server', kind: 'server', capacity: 1, capabilities: ['compute'], anchor: { x: 4, z: 4 }, slots: [{ x: 0, z: 0 }] },
      { id: 'meeting', kind: 'meeting', capacity: 4, capabilities: ['converse'], anchor: { x: 5, z: 5 }, slots: [{ x: 0, z: 0 }] },
      { id: 'break', kind: 'breakroom', capacity: 1, capabilities: ['rest'], anchor: { x: 6, z: 6 }, slots: [{ x: 0, z: 0 }] },
    ],
  }
}

function runActivity(command) {
  const world = makeWorld()
  const startTick = world.tick
  step(world, [{ kind: 'agentActivity', agentId: 'a', ticks: 60, ...command }])
  // step 会把 world.tick 推进一格，活动结束 tick 要按**命令生效时**的 tick 算。
  return { world, agent: world.agents[0], startTick }
}

for (const [skill, stationId] of [
  ['research', 'lab'],
  ['compute', 'server'],
  ['review', 'review-desk'],
]) {
  test(`agentActivity skill=${skill} → 能力匹配的站点 ${stationId}`, () => {
    const { agent, startTick } = runActivity({ activity: 'work', skill })
    assert.equal(agent.state, 'walking')
    assert.equal(agent.targetStation, stationId)
    assert.equal(agent.activityKind, 'work')
    assert.equal(agent.activityUntil, startTick + 60)
    assert.ok(agent.path.length > 0)
  })
}

test('agentActivity work 不带 skill：退回 code 能力的工位', () => {
  const { agent, startTick } = runActivity({ activity: 'work' })
  assert.equal(agent.state, 'walking')
  assert.equal(agent.targetStation, 'desk')
  assert.equal(agent.activityKind, 'work')
  assert.equal(agent.activityUntil, startTick + 60)
})

test('agentActivity meet / rest：分别去会场与休息室，并带上对应 activityKind', () => {
  const meet = runActivity({ activity: 'meet' })
  assert.equal(meet.agent.targetStation, 'meeting')
  assert.equal(meet.agent.activityKind, 'meet')

  const rest = runActivity({ activity: 'rest' })
  assert.equal(rest.agent.targetStation, 'break')
  assert.equal(rest.agent.activityKind, 'rest')
})

test('agentActivity：没有能力匹配的站点时不挪人', () => {
  const world = makeWorld()
  // 只留下 code 工位：research 没有任何站点能接。
  world.stations = world.stations.filter((station) => station.id === 'desk')
  step(world, [{ kind: 'agentActivity', agentId: 'a', activity: 'work', ticks: 60, skill: 'research' }])

  const agent = world.agents[0]
  assert.equal(agent.state, 'idle')
  assert.equal(agent.targetStation, null)
  assert.equal(agent.activityKind, undefined)
  assert.equal(agent.activityUntil, undefined)
  assert.deepEqual(agent.path, [])
})

test('agentActivity：activityUntil 至少 5 tick（ticks 过小也不许立刻散会）', () => {
  const world = makeWorld()
  step(world, [{ kind: 'agentActivity', agentId: 'a', activity: 'work', ticks: 1 }])
  assert.equal(world.agents[0].activityUntil, 10 + 5)

  const another = makeWorld()
  step(another, [{ kind: 'agentActivity', agentId: 'a', activity: 'work', ticks: 0 }])
  assert.equal(another.agents[0].activityUntil, 10 + 5)
})

test('agentActivity idle：清掉活动标记与路径，不只清状态', () => {
  const world = makeWorld()
  const agent = world.agents[0]
  agent.state = 'working'
  agent.station = 'desk'
  agent.targetStation = 'desk'
  agent.path = [{ x: 1, z: 1 }]
  agent.activityKind = 'work'
  agent.activityUntil = 99

  step(world, [{ kind: 'agentActivity', agentId: 'a', activity: 'idle', ticks: 0 }])

  assert.equal(agent.state, 'idle')
  assert.equal(agent.station, null)
  assert.equal(agent.targetStation, null)
  assert.deepEqual(agent.path, [])
  assert.equal(agent.activityKind, undefined)
  assert.equal(agent.activityUntil, undefined)
})

/** 每个用例一份独立的 persona 文件，互不串味。 */
function withStore(run) {
  const dir = mkdtempSync(join(tmpdir(), 'aw-persona-edge-'))
  try {
    return run(join(dir, 'personas.json'))
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

test('Persona awardTask：首次结算写入 XP、taskIds、awardedTaskIds', () => {
  withStore((path) => {
    const store = createPersonaStore(path)
    store.upsert({ id: 'sa-1', name: '小铁' })

    const awarded = store.awardTask('sa-1', 'task-1', 40)

    assert.equal(awarded.xp, 40)
    assert.equal(awarded.level, 1)
    assert.deepEqual(awarded.taskIds, ['task-1'])
    assert.deepEqual(awarded.awardedTaskIds, ['task-1'])
    assert.equal(typeof awarded.updatedAt, 'number')
  })
})

test('Persona awardTask：同一张单重复结算不加 XP、不改记录', () => {
  withStore((path) => {
    const store = createPersonaStore(path)
    store.upsert({ id: 'sa-1', name: '小铁' })
    const first = store.awardTask('sa-1', 'task-1', 40)

    // 第二次带了完全不同的 XP：去重看的是 taskId，不是数量。
    const again = store.awardTask('sa-1', 'task-1', 999)
    assert.equal(again, first, '重复结算应原样返回已有档案（含同一引用）')

    const current = store.get('sa-1')
    assert.equal(current.xp, 40)
    assert.equal(current.level, 1)
    assert.deepEqual(current.taskIds, ['task-1'])
    assert.deepEqual(current.awardedTaskIds, ['task-1'])

    // 幂等性不依赖"重复的那次参数一样"：再来几次也只算一次。
    store.awardTask('sa-1', 'task-1', 1)
    assert.equal(store.get('sa-1').xp, 40)
  })
})

test('Persona awardTask：不同任务各自加 XP，并影响等级；重开 store 后去重仍有效', () => {
  withStore((path) => {
    const store = createPersonaStore(path)
    store.upsert({ id: 'sa-1', name: '小铁' })
    store.awardTask('sa-1', 'task-1', 40)
    const second = store.awardTask('sa-1', 'task-2', 60)

    assert.equal(second.xp, 100)
    assert.equal(second.level, 2, '100 XP 正好是 2 级门槛')
    assert.deepEqual(second.taskIds, ['task-1', 'task-2'])
    assert.deepEqual(second.awardedTaskIds, ['task-1', 'task-2'])

    const reopened = createPersonaStore(path)
    assert.equal(reopened.get('sa-1').xp, 100)
    assert.deepEqual(reopened.get('sa-1').awardedTaskIds, ['task-1', 'task-2'])

    reopened.awardTask('sa-1', 'task-1', 500)
    assert.equal(reopened.get('sa-1').xp, 100, '重开 store 后旧任务也不能重复加经验')
    assert.deepEqual(reopened.get('sa-1').taskIds, ['task-1', 'task-2'])
  })
})

test('Persona awardTask：先 linkTask 再结算，不产生重复 taskId', () => {
  withStore((path) => {
    const store = createPersonaStore(path)
    store.upsert({ id: 'sa-1', name: '小铁' })
    store.linkTask('sa-1', 'task-9')

    const awarded = store.awardTask('sa-1', 'task-9', 40)

    assert.equal(awarded.xp, 40)
    assert.deepEqual(awarded.taskIds, ['task-9'])
    assert.deepEqual(awarded.awardedTaskIds, ['task-9'])
  })
})

test('Persona awardTask：未知角色或空任务 id 返回 null，不写坏数据', () => {
  withStore((path) => {
    const store = createPersonaStore(path)
    store.upsert({ id: 'sa-1', name: '小铁' })

    assert.equal(store.awardTask('sa-missing', 'task-1', 40), null)
    assert.equal(store.awardTask('sa-1', '', 40), null)

    assert.equal(store.get('sa-1').xp, 0)
    assert.deepEqual(store.get('sa-1').awardedTaskIds, [])
  })
})
