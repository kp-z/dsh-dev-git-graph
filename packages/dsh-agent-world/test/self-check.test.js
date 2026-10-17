/**
 * 渲染自检（R7 / S1+S2）—— `web/core/self-check.js` 的纯逻辑测试。
 *
 * 为什么这些值得钉死：三个计数器是**判据本身**。判据错了比没有判据更坏——
 * 一个会误报的计数器会教人忽略它（R85 之前六轮就是"看着在跳但说不出数"）。
 * 所以这里逐条把"什么算故障、什么**不算**"钉成用例：
 *
 * - 帧重置：只有**动画在播**时才比（没在播时钉第一帧是 `drawActors` 的有意行为）；
 * - 动画互抢：A→B→A 算，A→B→C 的前进**不算**（一天会换几十次键，那不是故障）；
 * - 状态漂移：**连续两次抽样**看到同一个不一致值才算（单向的推送时差不该被算成漂移）。
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

test('状态漂移：一次不一致不算，连续两次同一个不一致才算', async () => {
  const { check } = makeCheck({
    spriteList: [],
    actorList: [{ id: 'agent-1', facing: 3.0 }],
    snapshot: { world: { agents: [{ id: 'agent-1', facing: -3.0 }] } },
  })
  check.sample()
  await flush() // 快照到了：服务端 -3.0，本地 3.0
  check.sample() // 第一次看到不一致：只记进 pending
  assert.equal(check.report().counts.facingDrift, 0)
  check.sample() // 第二次同一个不一致：算一次漂移
  assert.equal(check.report().counts.facingDrift, 1)
  assert.equal(check.report().verdict, 'degraded')
})

test('状态漂移：服务端把自己纠正回来之后不再涨', async () => {
  const { check, setActors } = makeCheck({
    spriteList: [],
    actorList: [{ id: 'agent-1', facing: 3.0 }],
    snapshot: { world: { agents: [{ id: 'agent-1', facing: -3.0 }] } },
  })
  check.sample()
  await flush()
  check.sample()
  check.sample()
  const before = check.report().counts.facingDrift
  assert.equal(before, 1)
  // 客户端追上了服务端（增量到了）→ pending 清空，计数不再涨。
  setActors([{ id: 'agent-1', facing: -3.0 }])
  for (let i = 0; i < 5; i += 1) check.sample()
  assert.equal(check.report().counts.facingDrift, before)
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
