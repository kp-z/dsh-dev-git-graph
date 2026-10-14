/**
 * 确定性随机（BACKLOG M1-3）。
 *
 * 为什么非要自己写一个：模拟内核的**第一条硬性质是确定性**——
 * 同样的 `seed + 命令序列` 必须得到逐字段相同的世界，否则"回放一个 bug"就无从谈起，
 * 测试也没法断言 1000 tick 之后的状态。
 * 而 `Math.random()` 既不可播种，也不可复现，所以模拟层**禁止**使用它。
 *
 * 算法用 mulberry32：32 位状态、无外部依赖、分布对可视化用途完全够，
 * 而且实现短到可以一眼看完——这对一个要长期维护的仓库比"统计质量更好"重要。
 */

/** 可播种的随机源。 */
export interface Rng {
  /** 下一个 [0, 1) 的浮点数。 */
  next(): number
  /** [min, max) 的浮点数。 */
  range(min: number, max: number): number
  /** [0, max) 的整数。 */
  int(max: number): number
  /** 等概率取数组里一个元素。空数组返回 undefined（不抛，调用方自己决定）。 */
  pick<T>(items: readonly T[]): T | undefined
  /** 按权重取一个下标；权重和 <= 0 时返回 0。 */
  weighted(weights: readonly number[]): number
  /** 原地 Fisher–Yates 洗牌（返回新数组，不改入参）。 */
  shuffle<T>(items: readonly T[]): T[]
  /** 当前内部状态。用于快照/恢复，保证世界落盘再读回来仍能续上同一条随机流。 */
  state(): number
}

/**
 * 从 seed 建一个随机源。
 *
 * @param seed - 世界种子。同一个 seed 一定得到同一个序列。
 */
export function createRng(seed: number): Rng {
  // `>>> 0` 保证是无符号 32 位；seed 为负数或小数时也能得到一个稳定初始状态。
  let s = (seed >>> 0) || 0x9e3779b9

  const next = (): number => {
    s = (s + 0x6d2b79f5) >>> 0
    let t = s
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }

  const range = (min: number, max: number): number => min + next() * (max - min)

  return {
    next,
    range,
    int: (max: number): number => Math.floor(next() * max),
    pick<T>(items: readonly T[]): T | undefined {
      if (items.length === 0) return undefined
      return items[Math.floor(next() * items.length)]
    },
    weighted(weights: readonly number[]): number {
      let total = 0
      for (const w of weights) total += w > 0 ? w : 0
      if (total <= 0) return 0
      let roll = next() * total
      for (let i = 0; i < weights.length; i++) {
        roll -= weights[i] !== undefined && weights[i]! > 0 ? weights[i]! : 0
        if (roll < 0) return i
      }
      return weights.length - 1
    },
    shuffle<T>(items: readonly T[]): T[] {
      const out = [...items]
      for (let i = out.length - 1; i > 0; i--) {
        const j = Math.floor(next() * (i + 1))
        const a = out[i]
        const b = out[j]
        // noUncheckedIndexedAccess 下 a/b 是 T | undefined；i/j 都在界内，用 in 判断而不是 ! 断言。
        if (a !== undefined && b !== undefined) {
          out[i] = b
          out[j] = a
        }
      }
      return out
    },
    state: () => s,
  }
}

/** 从字符串派生一个稳定的数字种子（"小镇名" → seed）。 */
export function seedFromString(text: string): number {
  let h = 2166136261
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}
