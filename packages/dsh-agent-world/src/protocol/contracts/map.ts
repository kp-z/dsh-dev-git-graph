/**
 * map 域契约（1 条）。
 *
 * 地图与导航：可行走网格。
 *
 * 表格里的承诺、稳定性、验收与应用侧 `docs/CONTRACTS.md` 逐字一致；
 * `test/contracts.test.js` 会双向比对，改一边不改另一边会直接红。
 */
import type { ContractMeta } from './types.js'

export const MAP_CONTRACTS: readonly ContractMeta[] = [
  {
    id: "map.nav.grid",
    version: 1,
    stability: "standard",
    kind: "behavior",
    owner: "map",
    summary: "可行走性由 `nav.blocked` 一格一判；派生量，随内容重算",
    verify: "test/sim.test.js",
  },
]
