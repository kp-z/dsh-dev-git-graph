/**
 * wire 域契约（1 条）。
 *
 * 线协议：事件覆盖。
 *
 * 表格里的承诺、稳定性、验收与应用侧 `docs/CONTRACTS.md` 逐字一致；
 * `test/contracts.test.js` 会双向比对，改一边不改另一边会直接红。
 */
import type { ContractMeta } from './types.js'

export const WIRE_CONTRACTS: readonly ContractMeta[] = [
  {
    id: "wire.event.coverage",
    version: 1,
    stability: "standard",
    kind: "behavior",
    owner: "wire",
    summary: "10 种世界事件客户端**每种都有明确处理**；未知事件不许静默 `default:return`，必须诊断或重拉快照",
    verify: "planned:P0",
  },
]
