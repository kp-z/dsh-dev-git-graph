/**
 * content 域契约（5 条）。
 *
 * 内容：包清单、库、校验、覆盖、版本兼容。
 *
 * 表格里的承诺、稳定性、验收与应用侧 `docs/CONTRACTS.md` 逐字一致；
 * `test/contracts.test.js` 会双向比对，改一边不改另一边会直接红。
 */
import type { ContractMeta } from './types.js'

export const CONTENT_CONTRACTS: readonly ContractMeta[] = [
  {
    id: "content.pack.manifest",
    version: 1,
    stability: "standard",
    kind: "data",
    owner: "content",
    summary: "包有 id/version/requires/overrides；依赖拓扑序装载",
    verify: "test/content.test.js",
  },
  {
    id: "content.library",
    version: 1,
    stability: "frozen",
    kind: "behavior",
    owner: "content",
    summary: "库的种类**只增不改语义**；当前 11 个；加库要同时改协议 `LIBRARY_KINDS` 与内容 `LIBRARY_SPECS`",
    verify: "test/content.test.js",
  },
  {
    id: "content.validate",
    version: 1,
    stability: "standard",
    kind: "behavior",
    owner: "content",
    summary: "校验产出 `error/warning`；有 error 的包不装载",
    verify: "test/content.test.js",
  },
  {
    id: "content.override",
    version: 1,
    stability: "standard",
    kind: "behavior",
    owner: "content",
    summary: "覆盖必须显式登记；隐式覆盖默认拒绝",
    verify: "test/external-pack.test.js",
  },
  {
    id: "content.compat",
    version: 1,
    stability: "standard",
    kind: "behavior",
    owner: "content",
    summary: "内容版本不同：采纳 + 重算派生量 + 警告 + 计数（不拒绝）",
    verify: "test/reconcile.test.js",
  },
]
