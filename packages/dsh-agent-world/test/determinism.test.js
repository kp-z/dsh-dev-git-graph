/**
 * 确定性验收（BACKLOG M2-8）。
 *
 * ## 这是整条架构链上最该被钉死的一条
 *
 * 从 R1 起，架构里就写着"`tick` 必须是纯函数 + seeded PRNG，模拟层禁止
 * `Math.random()` 与 `Date.now()`"。这条性质**必须被验证**，否则它只是一句
 * 写在文档里的愿望——而违反它的代价是：一个偶发 bug 永远无法复现，
 * 只能靠盯着画面猜。
 *
 * 判据：同 seed + 同命令序列 ⇒ **逐字节相同**的世界。用 `JSON.stringify` 比对，
 * 因为它同时覆盖"字段值不同"和"字段顺序不同"两种情况。
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'

import { ContentRegistry, builtinPacks } from '../lib/content/index.js'
import { createWorld } from '../lib/world/create.js'
import { EVENT_RING_SIZE } from '../lib/domain/constants.js'
import { step } from '../lib/sim/step.js'

/** 建一个装了工作流的世界。 */
function makeWorld(seedName, { taskSets = ['task.quick-fix', 'task.software-feature'] } = {}) {
  const content = new ContentRegistry()
  content.loadAll(builtinPacks())
  return createWorld({
    content,
    scene: 'scene.default-town',
    name: seedName,
    createdAt: '2026-01-01T00:00:00.000Z',
    taskSets,
  })
}

/** 跑 N 步。 */
function run(world, ticks) {
  for (let i = 0; i < ticks; i++) step(world)
  return world
}

// ── 核心验收 ────────────────────────────────────────────────────────────────

test('确定性：同 seed 跑 1000 tick，两个世界逐字节一致', () => {
  const a = run(makeWorld('确定性小镇'), 1000)
  const b = run(makeWorld('确定性小镇'), 1000)

  const jsonA = JSON.stringify(a)
  const jsonB = JSON.stringify(b)
  assert.equal(jsonA.length, jsonB.length, '长度不同说明在某个字段上分叉了')
  assert.equal(jsonA, jsonB, '同 seed 同命令序列必须得到逐字节相同的世界')
})

test('确定性：1000 tick 之后世界确实在动（不是"因为都没变化所以相等"）', () => {
  const world = run(makeWorld('确定性小镇'), 1000)

  // 如果世界是死的，上面那条测试会因为"两边都是初始状态"而假通过。
  assert.equal(world.tick, 1000)
  assert.ok(world.agents.some((a) => a.station !== null || a.carrying !== null), '应当有角色在工作')
  assert.ok(
    world.tasks.some((t) => t.status === 'done'),
    `1000 tick 内应当有工单完工，状态分布：${JSON.stringify(
      world.tasks.reduce((acc, t) => ({ ...acc, [t.status]: (acc[t.status] ?? 0) + 1 }), {}),
    )}`,
  )
  assert.ok(world.seq > 0, '应当产生过事件')
})

test('确定性：不同 seed 会分叉（否则"确定性"是假的）', () => {
  const a = run(makeWorld('小镇甲'), 500)
  const b = run(makeWorld('小镇乙'), 500)
  assert.notEqual(JSON.stringify(a), JSON.stringify(b))
})

test('确定性：中途插入命令也要可复现（含派单与暂停）', () => {
  const script = (world) => {
    for (let i = 0; i < 200; i++) {
      if (i === 30) step(world, [{ kind: 'pause' }])
      else if (i === 40) step(world, [{ kind: 'resume' }])
      else if (i === 80) step(world, [{ kind: 'dispatch', taskSet: 'task.quick-fix' }])
      else step(world)
    }
    return world
  }

  const a = script(makeWorld('带命令的小镇'))
  const b = script(makeWorld('带命令的小镇'))
  assert.equal(JSON.stringify(a), JSON.stringify(b))
})

// ── 不确定性的来源要被挡住 ──────────────────────────────────────────────────

test('确定性：模拟内核里没有 Math.random / Date.now（静态检查）', async () => {
  const { readFileSync, readdirSync } = await import('node:fs')
  const { join } = await import('node:path')
  const { fileURLToPath } = await import('node:url')

  const simDir = fileURLToPath(new URL('../src/sim', import.meta.url))
  const files = readdirSync(simDir).filter((f) => f.endsWith('.ts'))
  assert.ok(files.length >= 6, `sim/ 下只扫到 ${files.length} 个文件，扫描大概出错了`)

  const offenders = []
  for (const file of files) {
    const source = readFileSync(join(simDir, file), 'utf8')
    // 去掉注释再查：注释里正当地提到"禁止 Math.random"不该被判成违规。
    const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')
    if (/\bMath\.random\b/.test(code)) offenders.push(`${file}: Math.random`)
    if (/\bDate\.now\b/.test(code)) offenders.push(`${file}: Date.now`)
    if (/\bnew Date\b/.test(code)) offenders.push(`${file}: new Date`)
  }

  assert.deepEqual(
    offenders,
    [],
    `模拟内核里出现了非确定性来源，这会毁掉"偶发 bug 可复现"这个前提：\n${offenders.join('\n')}`,
  )
})

// ── 长跑不炸 ────────────────────────────────────────────────────────────────

test('长跑：3000 tick 不抛异常，事件缓冲有界，状态机不混乱', () => {
  const world = makeWorld('长跑小镇')
  const states = new Set(['idle', 'walking', 'working', 'talking', 'blocked', 'celebrating', 'sleeping'])
  const taskStatuses = new Set(['pending', 'ready', 'in_progress', 'blocked', 'done', 'failed'])

  for (let i = 0; i < 3000; i++) {
    step(world)
    assert.ok(world.events.length <= EVENT_RING_SIZE, `事件缓冲越界：${world.events.length}`)
  }

  for (const agent of world.agents) {
    assert.ok(states.has(agent.state), `非法角色状态 ${agent.state}`)
    // 不许有角色卡在走路却没目标——那是静默卡死。
    if (agent.state === 'walking') {
      assert.ok(agent.targetStation !== null, `角色 ${agent.id} 自称在走路却没有目标`)
    }
  }
  for (const task of world.tasks) {
    assert.ok(taskStatuses.has(task.status), `非法工单状态 ${task.status}`)
    assert.ok(task.progress >= 0 && task.progress <= 1, `进度越界 ${task.progress}`)
    if (task.status === 'in_progress') {
      assert.ok(task.owner !== null, `进行中的 ${task.id} 没有负责人`)
      assert.ok(task.station !== null, `进行中的 ${task.id} 没落位到站点`)
    }
  }
})

test('长跑：一条完整的流水线能自己走完（不是只有第一张单会动）', () => {
  const world = makeWorld('流水线小镇', { taskSets: ['task.quick-fix'] })
  // 把预估缩短，让 3 步的流水线在几千 tick 内跑完。
  for (const task of world.tasks) task.estimateTicks = 60

  run(world, 3000)

  const done = world.tasks.filter((t) => t.status === 'done').length
  assert.equal(done, world.tasks.length, `quick-fix 的 3 张单都该完成，实际完成 ${done}/${world.tasks.length}`)

  // 完工的人必须离开工位，否则高峰期会死锁。
  const stillAtStation = world.agents.filter((a) => a.station !== null)
  assert.equal(stillAtStation.length, 0, '全部完工后不该有人还占着工位')
})
