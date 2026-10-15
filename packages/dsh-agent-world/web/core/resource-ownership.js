/*
 * 资源所有权与纹理账面（R47 / M4-12 的**纯逻辑**一半）。
 *
 * ══ 为什么这段逻辑值得单独一个纯模块 ══════════════════════════════════════════
 *
 * "该不该 dispose 这块显存"是个**判断**，而判断写在大段的 `traverse` 里就没法测：
 * 只能靠"跑一遍看纹理数涨不涨"来验，而那既慢又只在浏览器里成立。
 * 这里把它抽成两个纯函数——`planDisposal`（该释放谁）与 `accountTextures`（账面对不对）——
 * 于是"借用的不能释放""同一个骨架只释放一次""账面差额怎么算"这些**都能在 node 里穷举**。
 *
 * 浏览器里量到的数字是另一层证据（见 `web/scene/scene3d.js` 的 `textureReport()`）：
 * 纯逻辑证明**规则对**，浏览器证明**规则真的接上了**。两者缺一不可。
 *
 * ══ 所有权模型（这是 R47 的核心决定）══════════════════════════════════════════
 *
 * 一个 GLB 会被很多角色共用（默认小镇里 8 个角色用同一个角色 GLB）。于是有两位候选：
 *
 *   A. **共享**：一份资源，大家共用一个引用；
 *   B. **引用计数**：每个实例加一，减到 0 才 dispose。
 *
 * 本仓库选 **A（单一所有者 + 借用）**，理由：
 *
 * 1. **所有者是静态可知的**，不需要运行时记账。`models` 缓存是 GLTF 源资源
 *    （几何 + 纹理）的**唯一**所有者；实例只是**借用**。既然源在实例活着的时候
 *    一定不会被回收，"引用计数"就永远减不到 0——那是在为一个不存在的情况维护状态。
 * 2. **引用计数会在实例数上做乘法**：24 个角色就是 24 次加/减与一份计数表。而共享是 O(1)。
 * 3. **它决定了将来大规模渲染怎么做**：`InstancedMesh` 要的正是"一份几何 + 一份材质
 *    被 N 个实例共享"。所有权模型选 A 时，`InstancedMesh` 是**同一套规则的自然延伸**
 *    ——每个实例自己拥有的东西变成"空集"，于是没有东西需要按实例释放。
 *    选 B 则要额外维护"每个实例一组引用"，而 `InstancedMesh` 根本没有"实例对象"可挂它。
 *
 * **代价（写清楚，免得以后踩）**：借用的资源必须由所有者**显式**释放
 * （`createModelCache().dispose()`），否则会变成"谁都以为别人会收"的泄漏。
 * 所以本模块把 `ownership` 做成**必填**，逼调用点表态。
 */

/** 资源归自己所有：离开场景时要真的 `dispose()`。 */
export const OWNED = 'owned'

/** 资源是**借用**的（真正的所有者是缓存/其它长生命周期对象）：离开场景时**不许**释放。 */
export const BORROWED = 'borrowed'

/**
 * 算出"离开场景时该释放哪些资源"。
 *
 * 规则只有三条，但每条都踩过或差点踩到：
 * 1. `ownership === OWNED` 才 `dispose`；`BORROWED` 一律跳过
 *    （释放借来的，症状是"下一次重建时那张贴图/几何变成黑的或重新上传"）；
 * 2. **按 `id` 去重**：两个 `SkinnedMesh` 可能共用同一个骨架
 *    （`dispose()` 调两次通常无害，但"一次"是清楚的，两次会让人以为还有别人在用）；
 * 3. **输出顺序稳定**（按输入顺序）：否则两次运行的差异会看起来像 bug。
 *
 * @param {readonly {id: string, kind: string, ownership: string}[]} refs - 资源引用清单。
 * @returns {{dispose: string[], kept: string[], disposeByKind: Record<string, number>, keptByKind: Record<string, number>}}
 *   `dispose` = 要释放的 id（稳定顺序）；`kept` = 借来的、必须留给所有者的 id。
 */
export function planDisposal(refs) {
  const dispose = []
  const kept = []
  const disposeByKind = {}
  const keptByKind = {}
  const seen = new Set()

  for (const ref of refs) {
    if (ref === null || ref === undefined) continue
    const { id, kind, ownership } = ref
    if (typeof id !== 'string' || id === '') continue
    if (seen.has(id)) continue
    seen.add(id)

    if (ownership === BORROWED) {
      kept.push(id)
      keptByKind[kind] = (keptByKind[kind] ?? 0) + 1
      continue
    }
    // 认不出来的 ownership 一律**按自己的释放**：漏释放是泄漏（会一直涨），
    // 误释放最多让资源重新上传一次。**不确定时选不会累积的那一边。**
    dispose.push(id)
    disposeByKind[kind] = (disposeByKind[kind] ?? 0) + 1
  }

  return { dispose, kept, disposeByKind, keptByKind }
}

/**
 * 纹理账面核对：把 `renderer.info.memory.textures` 拆成"讲得清去哪了"与"讲不清"。
 *
 * `unaccounted > 0` 就是**泄漏量的下界**：这些纹理既不在场景图的材质上、
 * 也不属于活着的骨架、也不是阴影视图——GPU 上却还占着。
 *
 * 去重是这里的要点：一张纹理**可能同时**被材质和骨架引用
 * （自定义着色器把 boneTexture 当 `map` 用，是常见写法），
 * 直接相加会把同一张算两次，于是"泄漏"看起来比实际小。
 *
 * @param {object} input
 * @param {number} input.gpuTextures - `renderer.info.memory.textures`。
 * @param {readonly string[]} [input.materialTextureIds] - 场景图材质引用到的纹理 id。
 * @param {readonly string[]} [input.skeletonTextureIds] - 活着骨架的 boneTexture id。
 * @param {number} [input.shadowMapTextures] - 阴影视图的纹理数。
 * @returns {{accounted: number, unaccounted: number, leaks: boolean, bySource: {materials: number, skeletons: number, shadowMaps: number, shared: number}}}
 */
export function accountTextures(input) {
  const gpuTextures = Number.isFinite(input?.gpuTextures) ? input.gpuTextures : 0
  const materialIds = Array.isArray(input?.materialTextureIds) ? input.materialTextureIds : []
  const skeletonIds = Array.isArray(input?.skeletonTextureIds) ? input.skeletonTextureIds : []
  const shadowMapTextures = Number.isFinite(input?.shadowMapTextures) ? input.shadowMapTextures : 0

  const materialSet = new Set(materialIds)
  const skeletonSet = new Set(skeletonIds)
  // 同时出现在两边的：只算一次。
  let shared = 0
  for (const id of materialSet) if (skeletonSet.has(id)) shared += 1

  const union = new Set([...materialSet, ...skeletonSet])
  const accounted = union.size + shadowMapTextures
  const unaccounted = gpuTextures - accounted

  return {
    accounted,
    unaccounted,
    leaks: unaccounted > 0,
    bySource: {
      materials: materialSet.size,
      skeletons: skeletonSet.size,
      shadowMaps: shadowMapTextures,
      shared,
    },
  }
}

/**
 * 验收判据本身做成纯函数：**连续重建若干次后，纹理不再增长**。
 *
 * 判据写成代码而不是靠眼睛，是因为"涨了 1 个算不算漏"这种问题必须有个确定答案：
 * 这里给的是"从第一次重建之后，任何一次都不得超过 `tolerance`"。
 *
 * @param {readonly number[]} series - 每次重建后的 `textures`（`series[0]` 是重建前）。
 * @param {object} [options]
 * @param {number} [options.tolerance] - 允许的抖动（默认 0：一个都不许涨）。
 * @param {number} [options.rebuilds] - 至少要观察几次重建（默认 3）。
 * @returns {{ok: boolean, growth: number, first: number, last: number, sequence: number[], reason: string}}
 */
export function assessRebuildSeries(series, options = {}) {
  const tolerance = Number.isFinite(options.tolerance) ? options.tolerance : 0
  const rebuilds = Number.isFinite(options.rebuilds) ? options.rebuilds : 3
  const clean = Array.isArray(series) ? series.filter((n) => Number.isFinite(n)) : []

  if (clean.length < rebuilds + 1) {
    return {
      ok: false,
      growth: 0,
      first: clean[0] ?? 0,
      last: clean[clean.length - 1] ?? 0,
      sequence: clean,
      reason: `需要重建前 1 次 + 重建 ${rebuilds} 次共 ${rebuilds + 1} 个采样，实际只有 ${clean.length} 个`,
    }
  }

  const first = clean[0]
  const after = clean.slice(1)
  const worst = Math.max(...after)
  // 判据只说"不再增长"：允许中间回落（说明释放生效了），但不允许超过起点 + 容差。
  const growth = worst - first

  return {
    ok: growth <= tolerance,
    growth,
    first,
    last: clean[clean.length - 1],
    sequence: clean,
    reason:
      growth <= tolerance
        ? `重建 ${after.length} 次后纹理未增长（起点 ${first}，最大 ${worst}）`
        : `重建后纹理增长 ${growth}（起点 ${first}，最大 ${worst}）——超过容差 ${tolerance}`,
  }
}
