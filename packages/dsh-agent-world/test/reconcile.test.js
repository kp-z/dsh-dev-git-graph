/**
 * 读档时重算派生量（M10-12 / R49）。
 *
 * ## 这份测试盯的是"界线"，不是"函数能跑"
 *
 * 任务要修的是**同一个坑的第三次露面**：存档里存了本可以从内容重算出来的量。
 * 所以这里最要紧的断言是两条**方向相反**的：
 *
 * 1. **派生量必须跟着当前内容变**（`parts` / `slots` / 落点）——
 *    否则改内容只对新开的局生效（R47/R48 连吃两次）；
 * 2. **历史一个字节都不许动**（tick / 工单进度 / 消息 / 位置 / 状态 / 路径）——
 *    否则"读档"就变成了"偷偷改历史"。
 *
 * 下面每一组都用**旧存档形状**做输入（`legacySave()`），而不是拿当前世界直接喂进去——
 * 后者会让测试在"其实啥也没重算"的情况下也绿。
 *
 * ## 那条最需要判断力的规则，在这里被钉住
 *
 * `idle` **不等于**站在原地：`sim/idle.ts` 每 tick 把 idle 的人朝 `hangout` 推（有测试）。
 * 所以"落点变了但人不挪 = 修复看不见"只在**世界暂停**时成立。
 * 本文件把两种情况都钉住：停在旧落点上的惰性角色被一并挪过去；
 * 而**有在途意图**（走路中、正在干活、有路径）的人位置绝不动。
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'

import { ContentRegistry, builtinPacks } from '../lib/content/index.js'
import { createWorld } from '../lib/world/create.js'
import { reconcileWorld, HANGOUT_MOVE_EPSILON } from '../lib/world/reconcile.js'
import { stationClearance } from '../lib/world/hangouts.js'
import { latticeIn, distance } from '../lib/domain/geometry.js'
import { step } from '../lib/sim/step.js'

/** 当前内容装出来的世界。 */
function makeContent(extraPacks = []) {
  const content = new ContentRegistry()
  const issues = content.loadAll([...builtinPacks(), ...extraPacks])
  const errors = issues.filter((i) => i.level === 'error')
  assert.deepEqual(errors, [], `内容装载不该有 error：${JSON.stringify(errors)}`)
  return content
}

function makeWorld(content = makeContent()) {
  return createWorld({
    content,
    scene: 'scene.default-town',
    createdAt: '2026-01-01T00:00:00.000Z',
    taskSets: ['task.quick-fix'],
  })
}

/**
 * 把当前世界改造成**旧存档的形状**。
 *
 * 两件事，正好对应两次事故：
 * - `stations[*].parts` 删掉（R48 之前：站点只有单件 `model`，计划层 `.map(parts)` 会 500）；
 * - `agent.hangout` 换回**旧的栅格落点**（R47 之前：`latticeIn` 摊的 3×3，不认识家具）。
 */
function legacySave(world) {
  const snapshot = structuredClone(world)
  const commons = snapshot.districts.find((d) => d.kind === 'commons')
  assert.ok(commons, '内置场景应当有广场')
  const legacyHangouts = latticeIn(commons.bounds, snapshot.agents.length)
  snapshot.stations = snapshot.stations.map((station) => {
    const { parts: _parts, ...withoutParts } = station
    return withoutParts
  })
  snapshot.agents = snapshot.agents.map((agent, i) => ({
    ...agent,
    hangout: { ...legacyHangouts[i % legacyHangouts.length] },
    position: { ...legacyHangouts[i % legacyHangouts.length] },
  }))
  return snapshot
}

/** 一个空闲且**确实停在旧落点上**的人（应当被一并挪走）。 */
function parkOnHangout(agent) {
  return { ...agent, state: 'idle', path: [], station: null, targetStation: null, carrying: null, position: { ...agent.hangout } }
}

test('R48 形状：存档里的站点没有 parts → 读档后 parts/slots 来自当前内容', () => {
  const content = makeContent()
  const fresh = makeWorld(content)
  const legacy = legacySave(fresh)
  assert.equal(legacy.stations[0].parts, undefined, '前置条件：这份存档必须是 R48 之前的形状')

  const { world, changes } = reconcileWorld(legacy, content)
  for (const station of world.stations) {
    assert.ok(Array.isArray(station.parts) && station.parts.length > 0, `${station.id} 没有 parts`)
    assert.ok(Array.isArray(station.slots) && station.slots.length > 0, `${station.id} 没有 slots`)
  }

  // 与"新开一局"逐字段一致：派生量的定义就是"内容的函数"。
  for (const freshStation of fresh.stations) {
    const got = world.stations.find((s) => s.id === freshStation.id)
    assert.ok(got, `少了站点 ${freshStation.id}`)
    assert.deepEqual(got, freshStation, `${freshStation.id} 的派生量与新建世界不一致`)
  }

  // 工位是**组合件**（R48 的观感判据），不是单件。
  //
  // ⚠️ 不写"≥5 件"：那是某一次内容选择的数字。R54 把家具从 Kenney 的 GLB 换成
  // Microverse 的像素图之后，工位变成 3 件（整套工位 + 椅子 + 盆栽）——
  // 数量变了，但"它是一组拼出来的东西"这个**不变式**没变。
  const deskA = world.stations.find((s) => s.id === 'station.desk-a')
  assert.ok(deskA.parts.length > 1, `工位 A 应当是组合件（不止一件），实际 ${deskA.parts.length} 件`)
  assert.ok(
    changes.some((c) => c.includes('站点派生量')),
    `changes 要说清站点被重算了：${JSON.stringify(changes)}`,
  )
})

test('内容才是权威：换成另一个包（工位 2 件）后，读档按**当前**内容重算', () => {
  const twoPartDesk = {
    manifest: {
      id: 'pack.r49-two-parts',
      name: 'R49 两件工位',
      description: '把 station.desk-a 换成只有两件的组合',
      version: '1.0.0',
      schemaVersion: 1,
      requires: [],
      provides: ['stations'],
      overrides: ['stations/station.desk-a'],
    },
    entries: {
      stations: [
        {
          id: 'station.desk-a',
          name: '工位 A',
          kind: 'desk',
          district: 'district.engineering',
          anchor: { x: -5, z: -5 },
          relativeTo: null,
          capacity: 1,
          capabilities: ['code'],
          props: [
            { model: 'model.station.desk' },
            { model: 'model.part.screen', offset: { x: 0, z: -0.2 } },
          ],
        },
      ],
    },
  }

  const builtin = makeContent()
  const legacy = legacySave(makeWorld(builtin))
  const withPack = makeContent([twoPartDesk])

  const { world } = reconcileWorld(legacy, withPack)
  const deskA = world.stations.find((s) => s.id === 'station.desk-a')
  assert.equal(deskA.parts.length, 2, `读档应当按当前内容重算，实际 ${JSON.stringify(deskA.parts)}`)
  assert.equal(deskA.parts[1].dz, -0.2, '部件的偏移也应当来自当前内容')
  // 其余站点不受这个包影响，仍是内置的组合件。
  assert.ok(world.stations.find((s) => s.id === 'station.desk-b').parts.length > 1)
})

test('R47 形状 · 落点重算：全是旧的栅格点 → 全部避开家具，且与新建世界一致', () => {
  const content = makeContent()
  const fresh = makeWorld(content)
  const legacy = legacySave(fresh)

  const breakroom = fresh.stations.find((s) => s.id === 'station.breakroom')
  const legacyInside = legacy.agents.filter(
    (a) => distance(a.hangout, breakroom.anchor) < stationClearance('breakroom'),
  )
  assert.ok(legacyInside.length > 0, '前置条件：旧落点里必须有人落在沙发的占地范围里')

  const { world } = reconcileWorld(legacy, content)
  for (const agent of world.agents) {
    for (const station of world.stations) {
      assert.ok(
        distance(agent.hangout, station.anchor) >= stationClearance(station.kind) - 1e-9,
        `${agent.name} 的新落点仍然撞着 ${station.id}`,
      )
    }
    assert.deepEqual(
      agent.hangout,
      fresh.agents.find((a) => a.id === agent.id).hangout,
      `${agent.name} 的落点应当与新建世界一致（同一个 hangoutsForWorld）`,
    )
  }
})

// ── 那条"要不要挪人"的界线 ──────────────────────────────────────────────────

test('瞬移规则：停在旧落点上的惰性角色被挪走；有在途意图的人位置纹丝不动', () => {
  const content = makeContent()
  const fresh = makeWorld(content)
  const legacy = legacySave(fresh)

  // 五个各代表一种情形的角色。
  const [a1, a2, a3, a4, a5] = legacy.agents
  legacy.agents = [
    parkOnHangout(a1), // ① idle + 正停在旧落点上 → 应当被挪
    { ...a2, state: 'idle', path: [], position: { x: a2.hangout.x + 1, z: a2.hangout.z }, station: null, targetStation: null }, // ② 停在别处 → 不挪
    { ...a3, state: 'working', path: [], station: 'station.desk-a', position: { x: -5, z: -5 }, carrying: 'task-1' }, // ③ 干活中 → 不挪
    { ...a4, state: 'walking', path: [{ x: 0, z: 0 }], targetStation: 'station.desk-b', position: { x: -2.5, z: -5 } }, // ④ 走路中 → 不挪
    parkOnHangout(a5), // ⑤ 停在旧落点上，但**挂着路径** → 有在途意图，不挪
  ]
  legacy.agents[4] = { ...legacy.agents[4], path: [{ x: 1, z: 1 }] }

  const { world, changes } = reconcileWorld(legacy, content)
  const after = new Map(world.agents.map((a) => [a.id, a]))
  const moved = (id) => distance(after.get(id).position, legacy.agents.find((a) => a.id === id).position) > 1e-9

  assert.equal(moved('agent-1'), true, '① 惰性且正停在旧落点上的人应当被一并挪到新落点')
  assert.deepEqual(after.get('agent-1').position, after.get('agent-1').hangout, '① 挪到的地方就是新落点')
  assert.equal(after.get('agent-1').path.length, 0, '挪过去的人不该还挂着路径')

  assert.equal(moved('agent-2'), false, '② 没停在旧落点上的人不动')
  assert.deepEqual(after.get('agent-2').position, { x: legacy.agents[1].position.x, z: legacy.agents[1].position.z })

  assert.equal(moved('agent-3'), false, '③ 正在干活的人位置是历史，绝不能动')
  assert.equal(after.get('agent-3').state, 'working')
  assert.equal(after.get('agent-3').carrying, 'task-1')

  assert.equal(moved('agent-4'), false, '④ 走路中的人不动')
  assert.deepEqual(after.get('agent-4').path, [{ x: 0, z: 0 }], '④ 他的路径是历史')

  assert.equal(moved('agent-5'), false, '⑤ 挂着路径的人有在途意图，即使位置在旧落点上也不挪')

  // 五个人的 **hangout** 都按当前内容重算过（这才是"修复看得见"的那一半）。
  //
  // ⚠️ 这里**不能**断言"每个人的落点都变了"——那不是不变式。落点由间距常量与站点占位算出，
  // 改了常量之后**某些人的落点可能恰好落在原地**（R52：把 `DEFAULT_MIN_GAP` 从 1.8 调到 2.2 时
  // 就有一个人的落点仍是 (4,4)，于是这条断言假红）。
  // 真正的不变式是"重算过"：每个人的落点等于**新建世界**算出来的那一个。
  const recomputed = makeWorld(content)
  for (const agent of world.agents) {
    const expected = recomputed.agents.find((a) => a.id === agent.id)
    assert.deepEqual(agent.hangout, expected.hangout, `${agent.name} 的落点应当等于按当前内容重算的结果`)
  }
  // 至少要有一个人**确实**动了——否则"重算"这件事没有被这条测试覆盖到。
  const movedCount = world.agents.filter((agent) => {
    const before = legacy.agents.find((a) => a.id === agent.id)
    return before.hangout === null || distance(before.hangout, agent.hangout) > 1e-9
  }).length
  assert.ok(movedCount > 0, '至少要有一个人的落点因为重算而改变，否则这条测试什么也没验到')
  assert.ok(
    changes.some((c) => c.includes('agent-1') || c.includes('工头阿金')),
    `changes 要说清谁被挪了：${JSON.stringify(changes)}`,
  )
})

test('瞬移的容差是 0.25：贴着的算"停在旧落点"，明显在别处的不算', () => {
  const content = makeContent()
  const fresh = makeWorld(content)
  const legacy = legacySave(fresh)

  const inside = { ...legacy.agents[0], state: 'idle', path: [], station: null, targetStation: null, position: { x: legacy.agents[0].hangout.x + HANGOUT_MOVE_EPSILON / 2, z: legacy.agents[0].hangout.z } }
  const outside = { ...legacy.agents[1], state: 'idle', path: [], station: null, targetStation: null, position: { x: legacy.agents[1].hangout.x + HANGOUT_MOVE_EPSILON * 2, z: legacy.agents[1].hangout.z } }
  legacy.agents = [inside, outside, ...legacy.agents.slice(2)]

  const { world } = reconcileWorld(legacy, content)
  const after = world.agents
  assert.deepEqual(after[0].position, after[0].hangout, '容差内的应当被挪到新落点')
  assert.ok(
    distance(after[1].position, legacy.agents[1].position) < 1e-9,
    '容差外的不动（他显然在干别的事）',
  )
})

test('世界在跑时**不用瞬移也会自己走过去**：这条是"修复看不见"那个前提的反证', () => {
  const content = makeContent()
  const fresh = makeWorld(content)
  const legacy = legacySave(fresh)
  // 一个没被挪的惰性角色（人为放到容差外），reconcile 之后只换了 hangout。
  const whos = legacy.agents[0]
  legacy.agents[0] = { ...whos, position: { x: whos.hangout.x + 1, z: whos.hangout.z } }

  const { world } = reconcileWorld(legacy, content)
  assert.ok(distance(world.agents[0].position, world.agents[0].hangout) > 0, '前置条件：他不在新落点上')

  // advanceIdle 每 tick 把他朝 hangout 推（0.06/tick）——所以"不挪就永远站在旧位置"不成立。
  const running = structuredClone(world)
  for (let i = 0; i < 400 && distance(running.agents[0].position, running.agents[0].hangout) > 1e-9; i++) {
    step(running, [])
  }
  assert.ok(
    distance(running.agents[0].position, running.agents[0].hangout) < 1e-9,
    '跑几百 tick 之后他应当已经走到了新落点（sim/idle.ts 的 advanceIdle）',
  )
})

// ── 历史必须原样 ────────────────────────────────────────────────────────────

test('历史原样保留：tick / 工单 / 消息 / 位置状态路径 一个字节都不许动', () => {
  const content = makeContent()
  const fresh = makeWorld(content)
  const legacy = legacySave(fresh)

  // 造一点"历史"出来：派两单、让世界跑一段、再派个活给一个人。
  const before = structuredClone(legacy)
  legacy.tasks = before.tasks.map((t, i) => (i === 0 ? { ...t, status: 'done', progress: 100, owner: 'agent-3', finishedAtTick: 40, output: '修好了' } : t))
  legacy.messages = [
    { id: 'msg-1', from: 'agent-3', to: 'agent-1', kind: 'report', body: '登录 bug 修完了', atTick: 41, deliveredAtTick: 42 },
  ]
  legacy.messageSeq = 2
  legacy.tick = 340100
  legacy.seq = 5336
  legacy.agents[1] = { ...legacy.agents[1], state: 'idle', path: [{ x: 1, z: 2 }], targetStation: 'station.desk-c', position: { x: 1.25, z: 2.5 }, facing: 1.234, boundAgentId: 'sess-42', carrying: 'task-1' }

  const deepBefore = structuredClone(legacy)
  const { world } = reconcileWorld(legacy, content)

  // 入参没被改（顺手证明"不改入参"这条）。
  assert.deepEqual(legacy, deepBefore, 'reconcileWorld 不许修改入参')

  // 外壳与历史字段。
  for (const field of ['id', 'name', 'seed', 'tick', 'createdAt', 'paused', 'agentModel', 'mode', 'seq', 'messageSeq', 'origin']) {
    assert.deepEqual(world[field], deepBefore[field], `历史字段 ${field} 被改动了`)
  }
  assert.deepEqual(world.tasks, deepBefore.tasks, '工单（含进度/负责人/产出）是历史')
  assert.deepEqual(world.messages, deepBefore.messages, '消息是历史')

  // 每个角色的历史字段。
  for (const beforeAgent of deepBefore.agents) {
    const after = world.agents.find((a) => a.id === beforeAgent.id)
    for (const field of ['state', 'facing', 'station', 'targetStation', 'carrying', 'llm', 'boundAgentId', 'role', 'palette']) {
      assert.deepEqual(after[field], beforeAgent[field], `${beforeAgent.id}.${field} 被改动了`)
    }
    if (beforeAgent.path.length > 0) {
      assert.deepEqual(after.path, beforeAgent.path, `${beforeAgent.id}.path 被改动了（有在途路径的人不挪）`)
    }
    // 位置只在"惰性且正停在旧落点上"时才允许变。
    const changed = distance(after.position, beforeAgent.position) > 1e-9
    if (changed) {
      const inert = beforeAgent.state === 'idle' && beforeAgent.station === null && beforeAgent.targetStation === null && beforeAgent.path.length === 0
      assert.ok(inert, `${beforeAgent.id} 不该被挪（他有在途意图）`)
      assert.ok(distance(beforeAgent.position, beforeAgent.hangout) <= HANGOUT_MOVE_EPSILON, `${beforeAgent.id} 不该被挪（他不在旧落点上）`)
      assert.deepEqual(after.position, after.hangout, '被挪的人应当落在新落点上')
    }
  }
})

test('幂等：对已经重算过的世界再跑一次，什么都不改、changes 为空', () => {
  const content = makeContent()
  const legacy = legacySave(makeWorld(content))
  const first = reconcileWorld(legacy, content)
  assert.ok(first.changes.length > 0, '第一次应当有改动')

  const second = reconcileWorld(first.world, content)
  assert.deepEqual(second.changes, [], `第二次不该再改：${JSON.stringify(second.changes)}`)
  assert.deepEqual(second.world, first.world, '第二次的结果应当与输入逐字段相同')
})

test('确定性：同输入同输出（不许 Date.now()/Math.random()）', () => {
  const content = makeContent()
  const legacy = legacySave(makeWorld(content))
  assert.deepEqual(reconcileWorld(legacy, content).world, reconcileWorld(legacy, content).world)
})

// ── 降级：不能因为存档/内容对不上就让插件起不来 ──────────────────────────────

test('降级：当前内容里没有这个场景 → 原样返回 + 警告，不抛', () => {
  const content = makeContent()
  const legacy = legacySave(makeWorld(content))
  legacy.origin = { ...legacy.origin, scene: 'scene.does-not-exist' }

  const { world, changes, warnings } = reconcileWorld(legacy, content)
  assert.equal(changes.length, 0)
  assert.deepEqual(world, legacy, '场景不在就直接原样返回')
  assert.ok(
    warnings.some((w) => w.includes('scene.does-not-exist') && w.includes('可用场景')),
    `警告要能直接下手（列出可用场景）：${JSON.stringify(warnings)}`,
  )
})

test('降级：站点在当前场景里被删了 → 保留存档那份 + 警告（历史可能还引用它）', () => {
  const content = makeContent()
  const legacy = legacySave(makeWorld(content))
  // 存档里多一个"现在内容里没有的"站点（模拟内容删站）。
  legacy.stations = [...legacy.stations, { ...legacy.stations[0], id: 'station.gone', name: '已删除的站' }]
  legacy.agents[0] = { ...legacy.agents[0], station: 'station.gone' }

  const { world, warnings } = reconcileWorld(legacy, content)
  assert.ok(world.stations.some((s) => s.id === 'station.gone'), '被删的站点要保留（历史还在引用）')
  assert.equal(world.agents[0].station, 'station.gone', '引用它的角色也不该被改写')
  assert.ok(
    warnings.some((w) => w.includes('station.gone')),
    `警告要点名是哪个站点：${JSON.stringify(warnings)}`,
  )
})

test('降级：内容里的站点不自洽（relativeTo 指向不存在的地块）→ 沿用存档那份 + 警告', () => {
  const broken = {
    manifest: {
      id: 'pack.r49-broken-station',
      name: '坏站点',
      description: 'relativeTo 指向一个不存在的地块',
      version: '1.0.0',
      schemaVersion: 1,
      requires: [],
      provides: ['stations'],
      overrides: ['stations/station.desk-a'],
    },
    entries: {
      stations: [
        {
          id: 'station.desk-a',
          name: '工位 A',
          kind: 'desk',
          district: 'district.engineering',
          anchor: { x: 0, z: 0 },
          relativeTo: 'district.nowhere',
          capacity: 1,
          capabilities: ['code'],
          model: 'model.station.desk',
        },
      ],
    },
  }

  const content = makeContent([broken])
  const legacy = legacySave(makeWorld(makeContent()))
  const { world, warnings } = reconcileWorld(legacy, content)
  const deskA = world.stations.find((s) => s.id === 'station.desk-a')
  assert.equal(deskA.anchor.x, -5, '重算失败时沿用存档里的锚点')
  assert.ok(deskA.parts !== undefined, '站点仍然可用（不一定有 parts，但不能崩）')
  assert.ok(
    warnings.some((w) => w.includes('station.desk-a') && w.includes('district.nowhere')),
    `警告要说清哪个站点、为什么：${JSON.stringify(warnings)}`,
  )
})

// ── R51：角色外观也是派生量 ───────────────────────────────────────────────────

test('R51：旧存档里角色没有 modelId → 读档时按花名册重算（否则渲染层拿到 undefined）', () => {
  const content = new ContentRegistry()
  content.loadAll(builtinPacks())
  const world = createWorld({ content, scene: 'scene.default-town', createdAt: '2026-01-01T00:00:00.000Z' })

  // 模拟 R51 之前存下来的世界：角色有 palette、没有 modelId。
  const legacy = {
    ...world,
    agents: world.agents.map((a) => {
      const { modelId: _drop, ...rest } = a
      return rest
    }),
  }

  const { world: fixed, changes } = reconcileWorld(legacy, content)

  assert.equal(fixed.agents.length, legacy.agents.length, '重算不该增减角色')
  for (const a of fixed.agents) {
    assert.equal(typeof a.modelId, 'string', `${a.name} 应当拿到 modelId`)
    assert.ok(a.modelId !== '', `${a.name} 的 modelId 不能是空串`)
  }
  // 8 个席位各声明了 appearance → 8 个角色应当用 8 种模型（这正是"长得不一样"）。
  const distinct = new Set(fixed.agents.map((a) => a.modelId))
  assert.equal(distinct.size, fixed.agents.length, `每个角色应当各用一个模型，实际 ${distinct.size} 种`)
  assert.ok(changes.some((c) => c.includes('外观')), 'changes 要说清改了外观')
})

test('R51：外观重算是幂等的（第二次没有变化）', () => {
  const content = new ContentRegistry()
  content.loadAll(builtinPacks())
  const world = createWorld({ content, scene: 'scene.default-town', createdAt: '2026-01-01T00:00:00.000Z' })
  const once = reconcileWorld(world, content)
  const twice = reconcileWorld(once.world, content)
  assert.deepEqual(twice.world.agents.map((a) => a.modelId), once.world.agents.map((a) => a.modelId))
  assert.ok(!twice.changes.some((c) => c.includes('外观')), '第二次不该再报外观变化')
})
