/**
 * move 域契约（1 条）。
 *
 * 移动：到站吸附。
 *
 * 表格里的承诺、稳定性、验收与应用侧 `docs/CONTRACTS.md` 逐字一致；
 * `test/contracts.test.js` 会双向比对，改一边不改另一边会直接红。
 */
import type { ContractMeta } from './types.js'

export const MOVE_CONTRACTS: readonly ContractMeta[] = [
  {
    id: "move.arrive",
    version: 1,
    stability: "standard",
    kind: "behavior",
    owner: "move",
    summary: "到站当 tick 吸附到 `slot` 并转 `working`；位置与状态不许分帧",
    verify: "test/sim.test.js",
  },
]
