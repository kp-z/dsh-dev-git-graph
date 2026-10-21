/**
 * store 域契约（3 条）。
 *
 * 存储：存档外壳、事件历史、迁移。
 *
 * 表格里的承诺、稳定性、验收与应用侧 `docs/CONTRACTS.md` 逐字一致；
 * `test/contracts.test.js` 会双向比对，改一边不改另一边会直接红。
 */
import type { ContractMeta } from './types.js'

export const STORE_CONTRACTS: readonly ContractMeta[] = [
  {
    id: "store.envelope",
    version: 1,
    stability: "frozen",
    kind: "data",
    owner: "store",
    summary: "`fileVersion` + 原子写（tmp → fsync → rename）；**内容版本只是注释，不参与兼容判定**",
    verify: "test/reconcile.test.js",
  },
  {
    id: "store.events",
    version: 1,
    stability: "standard",
    kind: "behavior",
    owner: "store",
    summary: "`events.jsonl` 只增；坏行跳过、好行保留",
    verify: "test/reconcile.test.js",
  },
  {
    id: "store.migrate",
    version: 1,
    stability: "experimental",
    kind: "behavior",
    owner: "store",
    summary: "逐版本迁移函数链；不认识的版本**拒绝读**，不猜（当前只有\"拒绝\"，迁移链待补）",
    verify: "test/reconcile.test.js",
  },
]
