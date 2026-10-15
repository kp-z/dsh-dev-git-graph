/**
 * 模型加载缓存测试（BACKLOG M5-1）。
 *
 * 这是本包**第一个异步的东西**，而异步最容易出的三类问题都能在这里钉住：
 * 重复下载、失败重试风暴、"到货时世界已经换过了"。
 *
 * 不需要 WebGL——`load` 是注入的，所以这些断言跑得又快又准。
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'

import { createModelCache, resolveAssetUrl } from '../web/scene/model-loader.js'

/** 造一个记账用的假加载器。 */
function fakeLoader({ fail = [], delayMs = 0 } = {}) {
  const calls = []
  const load = async (url) => {
    calls.push(url)
    if (delayMs > 0) await new Promise((r) => setTimeout(r, delayMs))
    if (fail.some((f) => url.includes(f))) throw new Error(`404: ${url}`)
    return { scene: { name: url }, animations: new Array(32).fill(null) }
  }
  return { calls, load }
}

// ── 地址拼接（决策 D32 的唯一一处）────────────────────────────────────────

test('resolveAssetUrl：内容里的相对路径 → 页面可取的 `./vendor/…`', () => {
  assert.equal(
    resolveAssetUrl('kenney-mini-characters/character-male-a.glb'),
    './vendor/kenney-mini-characters/character-male-a.glb',
  )
  // 内容作者写成 `./x` 或 `/x` 都很自然，但不该拼出 `./vendor//x` 或 `./vendor/./x`。
  assert.equal(resolveAssetUrl('./a/x.glb'), './vendor/a/x.glb')
  assert.equal(resolveAssetUrl('/a/x.glb'), './vendor/a/x.glb')
  assert.equal(resolveAssetUrl('a.glb'), './vendor/a.glb')
})

// ── 去重 ─────────────────────────────────────────────────────────────────

test('同一个模型只会真的加载一次（24 个角色共用一个 GLB 时这是关键）', async () => {
  const loader = fakeLoader()
  const cache = createModelCache({ load: loader.load })

  const results = await Promise.all([
    cache.get('a/x.glb'),
    cache.get('a/x.glb'),
    cache.get('a/x.glb'),
  ])

  assert.equal(loader.calls.length, 1, `只该发一次请求，实际 ${loader.calls.length} 次`)
  assert.equal(loader.calls[0], './vendor/a/x.glb', '加载函数拿到的是**已经拼好**的 URL')
  for (const r of results) assert.equal(r.scene.name, './vendor/a/x.glb')
  assert.deepEqual(cache.status(), { total: 1, loading: 0, ready: 1, failed: 0 })
})

test('正在加载中的重复请求也走同一个 promise（不是"等它好了再发一次"）', async () => {
  const loader = fakeLoader({ delayMs: 20 })
  const cache = createModelCache({ load: loader.load })

  const first = cache.get('a/x.glb')
  const second = cache.get('a/x.glb')
  await Promise.all([first, second])

  assert.equal(loader.calls.length, 1)
  assert.equal(cache.status().loading, 0)
})

// ── 失败：记住，不重试风暴 ────────────────────────────────────────────────

test('失败会被记住：再次 get 不会重新发请求（否则每帧一次 = 每秒 60 次）', async () => {
  const loader = fakeLoader({ fail: ['bad'] })
  const cache = createModelCache({ load: loader.load })

  await assert.rejects(() => cache.get('bad/x.glb'))
  await assert.rejects(() => cache.get('bad/x.glb'))
  await assert.rejects(() => cache.get('bad/x.glb'))

  assert.equal(loader.calls.length, 1, '失败之后不该再发请求——面板每帧都会来问')
  assert.deepEqual(cache.failedUrls(), ['bad/x.glb'])
  assert.deepEqual(cache.status(), { total: 1, loading: 0, ready: 0, failed: 1 })
})

test('失败只报"每帧轮询"这一种，不报**人的动作**', async () => {
  // 要避免的是**每帧报一次**（`applyWorld` 每帧都会来问），所以重复 `get` 只报一次。
  // 但**显式 `retry()` 是人的动作**：它的失败必须报出来——静默失败比刷屏更糟
  // （用户点了重试、什么都没发生，这比日志多一行难查得多）。
  //
  // 这条最初被我写成"重试也不报"，是**测试的期望错了**：那条断言会把
  // "重试了但没人知道结果"变成一条测试保证的行为。
  const loader = fakeLoader({ fail: ['bad'] })
  const reported = []
  const cache = createModelCache({ load: loader.load, onError: (info) => reported.push(info.url) })

  await assert.rejects(() => cache.get('bad/x.glb'))
  await assert.rejects(() => cache.get('bad/x.glb'))
  await assert.rejects(() => cache.get('bad/x.glb'))
  assert.deepEqual(reported, ['bad/x.glb'], '每帧轮询只报一次')

  await assert.rejects(() => cache.retry('bad/x.glb'))
  assert.deepEqual(reported, ['bad/x.glb', 'bad/x.glb'], '显式重试的失败要报出来')
})

test('retry 是唯一的重试路径，而且真的重新发请求', async () => {
  let broken = true
  const calls = []
  const cache = createModelCache({
    load: async (url) => {
      calls.push(url)
      if (broken) throw new Error('暂时不可用')
      return { scene: { name: url }, animations: [] }
    },
  })

  await assert.rejects(() => cache.get('a/x.glb'))
  broken = false
  const value = await cache.retry('a/x.glb')

  assert.equal(calls.length, 2, 'retry 应当真的再发一次')
  assert.equal(value.scene.name, './vendor/a/x.glb')
  assert.deepEqual(cache.failedUrls(), [], '成功之后就不该还在失败清单里')
})

test('一个模型失败不影响另一个（别让一次 404 把整个场景拖住）', async () => {
  const loader = fakeLoader({ fail: ['bad'] })
  const cache = createModelCache({ load: loader.load })

  const [good, bad] = await Promise.allSettled([cache.get('ok/x.glb'), cache.get('bad/x.glb')])
  assert.equal(good.status, 'fulfilled')
  assert.equal(bad.status, 'rejected')
  assert.deepEqual(cache.failedUrls(), ['bad/x.glb'])
})

// ── 换场景 ────────────────────────────────────────────────────────────────

test('clear 之后会重新加载（换场景/重开一局时用）', async () => {
  const loader = fakeLoader()
  const cache = createModelCache({ load: loader.load })

  await cache.get('a/x.glb')
  cache.clear()
  assert.deepEqual(cache.status(), { total: 0, loading: 0, ready: 0, failed: 0 })
  assert.equal(cache.has('a/x.glb'), false)

  await cache.get('a/x.glb')
  assert.equal(loader.calls.length, 2, 'clear 之后应当重新加载')
})

test('缓存的对象就是加载器给的那个（不复制、不包一层）', async () => {
  const loader = fakeLoader()
  const cache = createModelCache({ load: loader.load })
  const value = await cache.get('a/x.glb')
  assert.equal(value.animations.length, 32, 'GLB 自带 32 条动画这件事要能原样传下去')
  assert.equal((await cache.get('a/x.glb')).scene, value.scene, '两次拿到的是同一个对象（克隆由调用方做）')
})
