/**
 * 资源所有权与纹理账面的纯逻辑测试（R47 / M4-12 的**规则**那一半）。
 *
 * ## 为什么这一半必须单独测
 *
 * "该不该 dispose 这块显存"是这次缺陷的**判断核心**，而它在浏览器里只能靠
 * "跑几遍看数字涨不涨"来间接验。把判断抽到 `web/core/resource-ownership.js` 之后，
 * 下面这些**都能穷举**：
 *
 * - 借来的东西**不许**释放（释放它 = 下一次重建贴图变黑或白重传）；
 * - 同一个骨架/几何被两个 mesh 共用时**只释放一次**；
 * - 账面去重：一张纹理同时被材质和骨架引用时**只算一次**
 *   （算两次会让"泄漏"看起来比实际小——那正是最危险的方向）；
 * - 验收判据本身（"重建 3 次后不再增长"）是一个可测的谓词，而不是一句口头标准。
 *
 * 浏览器里量到的数字是**另一层**证据（`scene3d.textureReport()` + 真宿主实测）。
 * 纯逻辑证明规则对，浏览器证明规则真的接上了。
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  accountTextures,
  assessRebuildSeries,
  BORROWED,
  OWNED,
  planDisposal,
} from '../web/core/resource-ownership.js'

// ── planDisposal：该释放谁 ───────────────────────────────────────────────────

test('planDisposal：借来的不释放，自己的才释放', () => {
  const plan = planDisposal([
    { id: 'geometry:glb-1', kind: 'geometry', ownership: BORROWED },
    { id: 'material:clone-1', kind: 'material', ownership: OWNED },
    { id: 'skeleton:skel-1', kind: 'skeleton', ownership: OWNED },
    { id: 'geometry:builder-1', kind: 'geometry', ownership: OWNED },
  ])

  assert.deepEqual(plan.dispose, ['material:clone-1', 'skeleton:skel-1', 'geometry:builder-1'])
  assert.deepEqual(plan.kept, ['geometry:glb-1'])
  assert.equal(plan.disposeByKind.material, 1)
  assert.equal(plan.disposeByKind.skeleton, 1)
  assert.equal(plan.disposeByKind.geometry, 1, '借来的那份几何不能算进 dispose')
  assert.equal(plan.keptByKind.geometry, 1)
})

test('planDisposal：同一个骨架被两个 SkinnedMesh 共用时只释放一次', () => {
  const plan = planDisposal([
    { id: 'skeleton:shared', kind: 'skeleton', ownership: OWNED },
    { id: 'skeleton:shared', kind: 'skeleton', ownership: OWNED },
  ])

  assert.deepEqual(plan.dispose, ['skeleton:shared'], '去重后只出现一次')
  assert.equal(plan.disposeByKind.skeleton, 1)
})

test('planDisposal：认不出的 ownership 按"自己的"释放（宁可多重传一次，也不要泄漏）', () => {
  const plan = planDisposal([
    { id: 'geometry:unknown', kind: 'geometry', ownership: 'whatever' },
    { id: 'geometry:missing', kind: 'geometry' },
  ])

  assert.deepEqual(plan.dispose, ['geometry:unknown', 'geometry:missing'])
})

test('planDisposal：输入脏数据不炸，且跳过没有 id 的项', () => {
  const plan = planDisposal([
    null,
    undefined,
    { kind: 'geometry', ownership: OWNED },
    { id: '', kind: 'geometry', ownership: OWNED },
    { id: 'material:ok', kind: 'material', ownership: OWNED },
  ])

  assert.deepEqual(plan.dispose, ['material:ok'])
  assert.deepEqual(plan.kept, [])
})

test('planDisposal：输出顺序与输入一致（两次运行要能逐字比对）', () => {
  const refs = [
    { id: 'c', kind: 'material', ownership: OWNED },
    { id: 'a', kind: 'material', ownership: OWNED },
    { id: 'b', kind: 'material', ownership: OWNED },
  ]

  assert.deepEqual(planDisposal(refs).dispose, ['c', 'a', 'b'])
  assert.deepEqual(planDisposal(refs).dispose, planDisposal(refs).dispose)
})

// ── accountTextures：账面 ───────────────────────────────────────────────────

test('accountTextures：没有泄漏时 unaccounted 为 0（R47 修复后的目标状态）', () => {
  const account = accountTextures({
    gpuTextures: 18,
    materialTextureIds: ['colormap'],
    skeletonTextureIds: Array.from({ length: 16 }, (_, i) => `bone-${i}`),
    shadowMapTextures: 1,
  })

  assert.equal(account.accounted, 18)
  assert.equal(account.unaccounted, 0)
  assert.equal(account.leaks, false)
  assert.deepEqual(account.bySource, { materials: 1, skeletons: 16, shadowMaps: 1, shared: 0 })
})

test('accountTextures：R47 的实测形状——泄漏正好是那 16 张旧骨架纹理', () => {
  // 修之前：重建一次后 34 张 GPU 纹理，但场景只解释得了 18 张。
  const account = accountTextures({
    gpuTextures: 34,
    materialTextureIds: ['colormap'],
    skeletonTextureIds: Array.from({ length: 16 }, (_, i) => `bone-${i}`),
    shadowMapTextures: 1,
  })

  assert.equal(account.unaccounted, 16, '16 = 8 角色 × 2 个 SkinnedMesh 的旧 boneTexture')
  assert.equal(account.leaks, true)
})

test('accountTextures：一张纹理被材质与骨架同时引用时只算一次', () => {
  const account = accountTextures({
    gpuTextures: 3,
    materialTextureIds: ['colormap', 'bone-0'],
    skeletonTextureIds: ['bone-0'],
    shadowMapTextures: 1,
  })

  assert.equal(account.bySource.materials, 2)
  assert.equal(account.bySource.skeletons, 1)
  assert.equal(account.bySource.shared, 1, '重叠的那一张要被标出来')
  assert.equal(account.accounted, 3, '去重后是 2 张纹理 + 1 张阴影视图')
  assert.equal(account.unaccounted, 0)
})

test('accountTextures：参数缺失时按 0 处理，不抛', () => {
  assert.deepEqual(accountTextures({ gpuTextures: 1 }).bySource, {
    materials: 0,
    skeletons: 0,
    shadowMaps: 0,
    shared: 0,
  })
  assert.equal(accountTextures({}).unaccounted, 0)
  // 完全不传（诊断函数被手滑调用）时也要给一个能读的结论，而不是抛在面板线程里。
  assert.equal(accountTextures(undefined).unaccounted, 0)
  assert.equal(accountTextures(undefined).leaks, false)
})

// ── assessRebuildSeries：验收判据 ────────────────────────────────────────────

test('验收判据：重建 3 次不再增长 → ok', () => {
  const verdict = assessRebuildSeries([18, 18, 18, 18])
  assert.equal(verdict.ok, true)
  assert.equal(verdict.growth, 0)
  assert.match(verdict.reason, /未增长/)
})

test('验收判据：R47 修复前的序列必须判为不 ok', () => {
  const verdict = assessRebuildSeries([18, 34, 50, 66])
  assert.equal(verdict.ok, false)
  assert.equal(verdict.growth, 48)
  assert.match(verdict.reason, /增长 48/)
})

test('验收判据：中间回落也算通过（说明释放生效了），但不许超过起点', () => {
  assert.equal(assessRebuildSeries([18, 20, 18, 18]).ok, false, '涨到 20 就超过容差 0')
  assert.equal(assessRebuildSeries([18, 20, 18, 18], { tolerance: 2 }).ok, true)
  assert.equal(assessRebuildSeries([18, 18, 18, 17]).ok, true, '回落不算增长')
})

test('验收判据：采样不够时明确说"不够"，而不是当成通过', () => {
  const verdict = assessRebuildSeries([18, 18])
  assert.equal(verdict.ok, false)
  assert.match(verdict.reason, /采样/)
})

test('验收判据：非数字混进来时被过滤掉，不会让 Math.max 变成 NaN', () => {
  const verdict = assessRebuildSeries([18, Number.NaN, 18, 18, 18])
  assert.equal(verdict.sequence.length, 4)
  assert.equal(verdict.ok, true)
})
