/** 升到下一级所需的总经验：100, 300, 600, 1000…（二次增长，前期快后期慢）。 */
export function xpForLevel(level: number): number {
  const n = Math.max(1, Math.floor(level))
  return 100 * n * (n - 1) / 2
}

export function levelForXp(xp: number): number {
  const value = Number.isFinite(xp) ? Math.max(0, xp) : 0
  let level = 1
  while (level < 99 && value >= xpForLevel(level + 1)) level += 1
  return level
}

export function normalizeXp(xp: number): number {
  return Number.isFinite(xp) ? Math.max(0, Math.floor(xp)) : 0
}
