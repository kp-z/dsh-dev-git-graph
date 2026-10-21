/**
 * compat 域契约（1 条）。
 *
 * 兼容：结构不兼容必须拒绝。
 *
 * 表格里的承诺、稳定性、验收与应用侧 `docs/CONTRACTS.md` 逐字一致；
 * `test/contracts.test.js` 会双向比对，改一边不改另一边会直接红。
 */
import type { ContractMeta } from './types.js'

export const COMPAT_CONTRACTS: readonly ContractMeta[] = [
  {
    id: "compat.structural",
    version: 1,
    stability: "frozen",
    kind: "behavior",
    owner: "compat",
    summary: "`fileVersion` / 场景 id / 形状对不上时**拒绝**，不进入半可用",
    verify: "test/reconcile.test.js",
  },
]
