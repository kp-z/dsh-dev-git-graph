/**
 * station 域契约（1 条）。
 *
 * 站点：容量与占用。
 *
 * 表格里的承诺、稳定性、验收与应用侧 `docs/CONTRACTS.md` 逐字一致；
 * `test/contracts.test.js` 会双向比对，改一边不改另一边会直接红。
 */
import type { ContractMeta } from './types.js'

export const STATION_CONTRACTS: readonly ContractMeta[] = [
  {
    id: "station.capacity",
    version: 1,
    stability: "standard",
    kind: "behavior",
    owner: "station",
    summary: "同站占用 ≤ `capacity`；超了就换站，不重叠",
    verify: "test/sim.test.js",
  },
]
