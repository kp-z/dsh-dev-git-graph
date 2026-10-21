/**
 * hud 域契约（2 条）。
 *
 * HUD：计数口径、状态色。
 *
 * 表格里的承诺、稳定性、验收与应用侧 `docs/CONTRACTS.md` 逐字一致；
 * `test/contracts.test.js` 会双向比对，改一边不改另一边会直接红。
 */
import type { ContractMeta } from './types.js'

export const HUD_CONTRACTS: readonly ContractMeta[] = [
  {
    id: "hud.counts",
    version: 1,
    stability: "standard",
    kind: "behavior",
    owner: "hud",
    summary: "计数口径只有一处（侧边栏 region header），看板不重复算",
    verify: "test/sidebar-redesign.test.js",
  },
  {
    id: "hud.status.color",
    version: 1,
    stability: "standard",
    kind: "behavior",
    owner: "hud",
    summary: "状态色与 `TaskStatus` 一一对应，不新造",
    verify: "test/board-layout.test.js",
  },
]
