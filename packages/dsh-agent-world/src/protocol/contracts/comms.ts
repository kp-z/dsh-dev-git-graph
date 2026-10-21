/**
 * comms 域契约（1 条）。
 *
 * 通信：消息投递。
 *
 * 表格里的承诺、稳定性、验收与应用侧 `docs/CONTRACTS.md` 逐字一致；
 * `test/contracts.test.js` 会双向比对，改一边不改另一边会直接红。
 */
import type { ContractMeta } from './types.js'

export const COMMS_CONTRACTS: readonly ContractMeta[] = [
  {
    id: "comms.message",
    version: 1,
    stability: "standard",
    kind: "behavior",
    owner: "comms",
    summary: "入队即发事件并带 `deliverAtTick`；送达时刻可算、不另发事件",
    verify: "test/idle-comms.test.js",
  },
]
