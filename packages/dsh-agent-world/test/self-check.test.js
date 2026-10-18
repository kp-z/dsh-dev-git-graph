/**
 * 渲染自检（R7 / S1+S2）—— `web/core/self-check.js` 的纯逻辑测试。
 *
 * 为什么这些值得钉死：三个计数器是**判据本身**。判据错了比没有判据更坏——
 * 一个会误报的计数器会教人忽略它（R85 之前六轮就是"看着在跳但说不出数"）。
 * 所以这里逐条把"什么算故障、什么**不算**"钉成用例：
 *
 * - 帧重置：只有**动画在播**时才比（没在播时钉第一帧是 `drawActors` 的有意行为）；
 * - 动画互抢：A→B→A 算，A→B→C 的前进**不算**（一天会换几十次键，那不是故障）；
 * - 状态漂移：**跨两个快照代次**都看到同一个不一致值才算（单向的推送时差不该被算成漂移）。
 *   ⚠️ R110 修：原先写的是"连续两次抽样"，**没区分那两次是不是同一个基线**——
 *   而 `serverFacing` 每 3s 才刷新、两次之间是冻结的，于是"同一个基线采两次"被当成了
 *   "两次独立观测"，`D` 开始误报（实测它报 drift:1 时独立比对 8/8 一致）。
 *   本文件里那两条断言旧判据的用例，就是**这个 bug 能活下来的原因**——判据错了，测试还替它背书。
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'

import { createSelfCheck, facingMapOf } from '../web/core/self-check.js'

/** 造一只可见精灵：`frame` 是它实际显示的帧，`anim` 是动画认为该显示的帧。 */
function makeSprite({ actorId = 'agent-1', frame = 0, animFrame = 0, playing = true, animKey = 'a' } = {}) {
  return {
    type: 'Sprite',
    visible: true,
    frame: { name: String(frame) },
    anims: {
      isPlaying: playing,
      currentAnim: { key: animKey },
      currentFrame: playing === true || animFrame !== null ? { textureFrame: animFrame } : null,
    },
    getData: (key) => (key === 'actorId' ? actorId : null),
  }
}

/** 一个自增的假时钟：每次调用 +1000ms，保证每次都过得了节流。 */
function clock() {
  let at = 0
  return () => {
    at += 1000
    return at
  }
}

/** 造一个不会真发请求的自检器（`fetchWorld` 返回固定的假快照）。 */
function makeCheck({ spriteList, actorList = [], snapshot = null, now = clock() }) {
  let spritesRef = spriteList
  let actorsRef = actorList
  return {
    check: createSelfCheck({
      sprites: () => spritesRef,
      actors: () => actorsRef,
      fetchWorld: () => Promise.resolve(snapshot ?? { world: { agents: [] } }),
      // 一次抽样之后要等微任务把快照填进去，所以下面每个用例都 `await flush()`。
      hidden: () => false,
      now,
    }),
    setSprites: (next) => {
      spritesRef = next
    },
    setActors: (next) => {
      actorsRef = next
    },
  }
}

/** 让 `fetchWorld` 的 Promise 落地。 */
const flush = () => new Promise((resolve) => setImmediate(resolve))

test('稳定状态：帧一致、朝向一致 → 三个计数恒为 0', async () => {
  const { check } = makeCheck({
    spriteList: [makeSprite({ frame: 69, animFrame: 69 })],
    actorList: [{ id: 'agent-1', facing: 1.5 }],
    snapshot: { world: { agents: [{ id: 'agent-1', facing: 1.5 }] } },
  })
  for (let i = 0; i < 20; i += 1) {
    check.sample()
    await flush()
  }
  const report = check.report()
  assert.equal(report.counts.frameResets, 0)
  assert.equal(report.counts.animFlips, 0)
  assert.equal(report.counts.facingDrift, 0)
  assert.equal(report.verdict, 'ok')
})

test('帧重置：实际帧被掰回第 0 帧 → 每次抽样都记一次', async () => {
  // R85 的真实现场：动画说 69，精灵显示 0。
  const { check } = makeCheck({ spriteList: [makeSprite({ frame: 0, animFrame: 69 })] })
  check.sample()
  check.sample()
  check.sample()
  assert.equal(check.report().counts.frameResets, 3)
  assert.equal(check.report().verdict, 'degraded')
})

test('帧重置：动画没在播时**不**误报（钉第一帧是有意行为）', async () => {
  const { check } = makeCheck({ spriteList: [makeSprite({ frame: 0, animFrame: 69, playing: false })] })
  for (let i = 0; i < 5; i += 1) check.sample()
  const report = check.report()
  assert.equal(report.counts.frameResets, 0)
  // 没在播的精灵也不进"比较过几只"——否则 `compared` 会给人"比过但一致"的错觉。
  assert.equal(report.last.compared, 0)
})

test('动画互抢：A→B→A 记一次，A→B→C 的前进不记', async () => {
  const { check, setSprites } = makeCheck({ spriteList: [makeSprite({ animKey: 'idle-left' })] })
  check.sample() // A
  setSprites([makeSprite({ animKey: 'walk-right' })])
  check.sample() // A→B：换向，不算抖
  setSprites([makeSprite({ animKey: 'idle-left' })])
  check.sample() // B→A：**这才是抖动**
  assert.equal(check.report().counts.animFlips, 1)
  assert.equal(check.report().counts.frameResets, 0)
})

/**
 * 造一个**不真发请求**的自检器：基线用 `setServerFacing` 直接给（它等价于"来了一份新快照"，
 * 并且会 +1 代次），于是"代次"这件事可以被精确控制。
 */
function makeGenerationCheck({ actorList = [], clock: now = clock() } = {}) {
  let actorsRef = actorList
  const check = createSelfCheck({
    sprites: () => [],
    actors: () => actorsRef,
    fetchWorld: () => new Promise(() => {}), // 永不落地：代次只由 setServerFacing 推进
    hidden: () => true,
    now,
  })
  return { check, setActors: (next) => { actorsRef = next } }
}

test('状态漂移：**同一个快照代次内采多少次都不算**（那不是两次观测，是同一个基线看了两眼）', () => {
  const { check } = makeGenerationCheck({ actorList: [{ id: 'agent-1', facing: 3.0 }] })
  check.setServerFacing({ 'agent-1': -3.0 }) // 第 1 代基线：本地 3.0 vs 服务端 -3.0
  for (let i = 0; i < 8; i += 1) check.sample()
  assert.equal(check.report().counts.facingDrift, 0, '同一代次内采 8 次也不该累积——这正是 R110 的误报来源')
  assert.equal(check.report().last.drift, 0)
})

test('状态漂移：**跨两个代次**看到同一个不一致值 → 记一次（真漂移仍抓得住）', () => {
  const { check } = makeGenerationCheck({ actorList: [{ id: 'agent-1', facing: 3.0 }] })
  check.setServerFacing({ 'agent-1': -3.0 }) // 第 1 代
  check.sample()
  assert.equal(check.report().counts.facingDrift, 0, '只看到一代，还不能下结论')
  check.setServerFacing({ 'agent-1': -3.0 }) // 第 2 代（基线换了，值没变）
  check.sample()
  assert.equal(check.report().counts.facingDrift, 1, '跨代次仍是同一个不一致 → 这是真的没同步')
  assert.equal(check.report().verdict, 'degraded')
})

test('反证②：本地**短暂落后又回到原值** → D 必须仍为 0（旧判据在这里会误报）', () => {
  const { check, setActors } = makeGenerationCheck({ actorList: [{ id: 'agent-1', facing: 1.0 }] })
  check.setServerFacing({ 'agent-1': 1.0 }) // 第 1 代：一致
  check.sample()
  assert.equal(check.report().counts.facingDrift, 0)

  // 本地"落后"（增量还没到）——**同一个代次内**连续采两次看到同一个不一致值。
  setActors([{ id: 'agent-1', facing: 2.0 }])
  check.sample()
  check.sample()
  assert.equal(
    check.report().counts.facingDrift,
    0,
    '同一代次内的重复采样不是独立观测；旧判据（"连续两次同签名"）会在这里记 1 —— R108 真机上的误报就是它',
  )

  // 本地追上了 → pending 清空
  setActors([{ id: 'agent-1', facing: 1.0 }])
  check.sample()
  assert.equal(check.report().counts.facingDrift, 0)
})

test('反证③：**持续漂移**（跨两个以上代次）→ D 必须 > 0（别修成"永远不报警"）', () => {
  const { check } = makeGenerationCheck({ actorList: [{ id: 'agent-1', facing: 3.0 }] })
  // 基线换 4 代，本地始终卡在 3.0 —— 服务端一直说 -3.0。
  for (let gen = 0; gen < 4; gen += 1) {
    check.setServerFacing({ 'agent-1': -3.0 })
    check.sample()
  }
  const drift = check.report().counts.facingDrift
  assert.ok(drift > 0, `持续漂移必须被记到，实际 ${drift}`)
  assert.equal(check.report().verdict, 'degraded')
})

// ── R112：`D` 拆成 now（当前）与 total（历史）─────────────────────────────────
//
// 为什么这条关系值得钉：原先一个累计 `D` 同时表达"现在一致吗"和"历史上错过几次"，
// 于是「已经修好了」与「还坏着」在仪表上**长得一模一样**（R111 实锤）。
// 这里钉的不是某个数值，而是两条**关系**：
//   ① `verdict` 只看 now；② `total` 只增不减、且不被 verdict 影响。

test('R112：**verdict 只看 now** —— 持续漂移时 now>0 且 degraded', () => {
  const { check } = makeGenerationCheck({ actorList: [{ id: 'agent-1', facing: 3.0 }] })
  for (let gen = 0; gen < 3; gen += 1) {
    check.setServerFacing({ 'agent-1': -3.0 })
    check.sample()
  }
  const r = check.report()
  assert.ok(r.last.nowDrift > 0, `此刻确实对不上，nowDrift 应 > 0，实际 ${r.last.nowDrift}`)
  assert.equal(r.verdict, 'degraded')
})

test('R112：**停止漂移后 now 回 0、verdict 回 ok，而 total 仍保留**（两个同时成立才算对）', () => {
  const { check, setActors } = makeGenerationCheck({ actorList: [{ id: 'agent-1', facing: 3.0 }] })
  // 注入持续漂移：基线换 3 代，本地一直 3.0
  for (let gen = 0; gen < 3; gen += 1) {
    check.setServerFacing({ 'agent-1': -3.0 })
    check.sample()
  }
  const totalAfterInjection = check.report().counts.facingDrift
  assert.ok(totalAfterInjection > 0, '注入期间必须记到漂移')

  // 停止注入（本地追上服务端）——**不重建实例、不刷新**，模拟"世界自己好了"
  setActors([{ id: 'agent-1', facing: -3.0 }])
  check.setServerFacing({ 'agent-1': -3.0 })
  check.sample()

  const after = check.report()
  assert.equal(after.last.nowDrift, 0, '此刻已经一致 → now 必须回 0')
  assert.equal(after.verdict, 'ok', 'verdict 只看 now → 必须回 ok')
  assert.equal(
    after.counts.facingDrift,
    totalAfterInjection,
    '**历史不能被抹掉**：total 要保留刚才的次数（把历史抹掉 = 把仪表变成"只会说好话"）',
  )
})

test('R112：total 只增不减，且**正常回流不让它增长**', () => {
  const { check, setActors } = makeGenerationCheck({ actorList: [{ id: 'agent-1', facing: 1.0 }] })
  // 正常：一致，来回换几代
  for (let gen = 0; gen < 4; gen += 1) {
    check.setServerFacing({ 'agent-1': 1.0 })
    check.sample()
  }
  assert.equal(check.report().counts.facingDrift, 0, '正常回流不该累积 total')
  assert.equal(check.report().verdict, 'ok')

  // 注入一次漂移 → total 涨
  setActors([{ id: 'agent-1', facing: 9.9 }])
  check.setServerFacing({ 'agent-1': 1.0 })
  check.sample()
  check.setServerFacing({ 'agent-1': 1.0 })
  check.sample()
  const t1 = check.report().counts.facingDrift
  assert.ok(t1 > 0)

  // 再正常几代 → total 不降（只增不减）
  setActors([{ id: 'agent-1', facing: 1.0 }])
  for (let gen = 0; gen < 4; gen += 1) {
    check.setServerFacing({ 'agent-1': 1.0 })
    check.sample()
  }
  const r = check.report()
  assert.equal(r.counts.facingDrift, t1, 'total 不该因为恢复正常而减少')
  assert.equal(r.last.nowDrift, 0)
  assert.equal(r.verdict, 'ok', 'verdict 只看 now')
})

test('R112：文本里**当前与历史都看得见**（D 是 now，历史另行标注）', () => {
  const { check, setActors } = makeGenerationCheck({ actorList: [{ id: 'agent-1', facing: 3.0 }] })
  check.setServerFacing({ 'agent-1': -3.0 })
  check.sample()
  check.setServerFacing({ 'agent-1': -3.0 })
  check.sample()
  const degraded = check.report()
  assert.ok(degraded.text.includes('D1'), `此刻 D 应是 1（当前），实际文本：${degraded.text}`)

  setActors([{ id: 'agent-1', facing: -3.0 }])
  check.setServerFacing({ 'agent-1': -3.0 })
  check.sample()
  const recovered = check.report()
  assert.ok(recovered.text.startsWith('R0 F0 D0'), `恢复后当前应是 D0，实际：${recovered.text}`)
  assert.ok(
    /历史[1-9]/.test(recovered.text),
    `恢复后**历史必须仍然可见**（不然就是"只会说好话"），实际：${recovered.text}`,
  )
})

test('状态漂移：客户端追上之后计数不再涨（代次照换）', () => {
  const { check, setActors } = makeGenerationCheck({ actorList: [{ id: 'agent-1', facing: 3.0 }] })
  check.setServerFacing({ 'agent-1': -3.0 })
  check.sample()
  check.setServerFacing({ 'agent-1': -3.0 })
  check.sample()
  const before = check.report().counts.facingDrift
  assert.equal(before, 1)
  // 客户端追上了服务端（增量到了）→ 不一致消失，之后换多少代都不再涨。
  setActors([{ id: 'agent-1', facing: -3.0 }])
  for (let i = 0; i < 3; i += 1) {
    check.setServerFacing({ 'agent-1': -3.0 })
    check.sample()
  }
  assert.equal(check.report().counts.facingDrift, before)
})

test('真快照落地也会 +1 代次（不能只在 setServerFacing 里加）', async () => {
  // 用**真 fetch 路径**验一遍：忘了在 fetch 里 +1 的后果是 D 永远为 0（比误报更危险）。
  const { check } = makeCheck({
    spriteList: [],
    actorList: [{ id: 'agent-1', facing: 3.0 }],
    snapshot: { world: { agents: [{ id: 'agent-1', facing: -3.0 }] } },
  })
  check.sample()
  await flush()
  const gen1 = check.report().world.generation
  assert.equal(gen1, 1, '快照落地后应该有第 1 代')
  // 再等一个快照周期（假时钟每次 +1000ms，worldFetchMs 默认 3000）
  for (let i = 0; i < 3; i += 1) check.sample()
  await flush()
  assert.ok(check.report().world.generation >= 2, '第二个快照落地后代次必须继续涨')
})

test('report() 是可读结构：带一行摘要、明细与取快照状态', async () => {
  const { check } = makeCheck({ spriteList: [makeSprite({ frame: 0, animFrame: 69 })] })
  check.sample()
  await flush()
  const report = check.report()
  assert.equal(typeof report.text, 'string')
  assert.match(report.text, /^R\d+ F\d+ D(\d+|\?)$/)
  assert.equal(typeof report.counts.frameResets, 'number')
  assert.equal(typeof report.last.sprites, 'number')
  assert.ok(['idle', 'pending', 'ok', 'empty', 'failed'].includes(report.world.fetchState))
})

test('快照还没到手时：摘要写 `D?`、verdict 是 unverified —— **没测不许读成通过**', async () => {
  // 后台标签页按设计不拉快照，于是"漂移"一项一次都没比过。
  // 如果这时报 `ok`，页面会把"完全没检查"显示成"检查过没问题"——那正是要消灭的静默形态。
  const check = createSelfCheck({
    sprites: () => [],
    actors: () => [],
    fetchWorld: () => new Promise(() => {}), // 永远不落地
    hidden: () => true,
    now: clock(),
  })
  check.sample()
  const report = check.report()
  assert.equal(report.text, 'R0 F0 D?')
  assert.equal(report.verdict, 'unverified')
  assert.equal(report.counts.facingDrift, 0)
})

test('取快照失败时不计漂移（区分"没漂移"和"没取到"）', async () => {
  const check = createSelfCheck({
    sprites: () => [],
    actors: () => [{ id: 'agent-1', facing: 99 }],
    fetchWorld: () => Promise.reject(new Error('boom')),
    hidden: () => false,
    now: clock(),
  })
  check.sample()
  await flush()
  check.sample()
  check.sample()
  const report = check.report()
  assert.equal(report.counts.facingDrift, 0)
  assert.equal(report.world.fetchState, 'failed')
})

test('facingMapOf：认 `{world}` 也认裸 world，跳过没有 facing 的人', () => {
  const wrapped = facingMapOf({ world: { agents: [{ id: 'a', facing: 1 }, { id: 'b' }] } })
  assert.deepEqual([...wrapped], [['a', 1]])
  const bare = facingMapOf({ agents: [{ id: 'c', facing: -2 }] })
  assert.deepEqual([...bare], [['c', -2]])
})
