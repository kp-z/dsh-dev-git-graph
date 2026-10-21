/**
 * dialogue 域契约（3 条）。
 *
 * 对话：轮次、失败语义。
 *
 * 表格里的承诺、稳定性、验收与应用侧 `docs/CONTRACTS.md` 逐字一致；
 * `test/contracts.test.js` 会双向比对，改一边不改另一边会直接红。
 */
import type { ContractMeta } from './types.js'

export const DIALOGUE_CONTRACTS: readonly ContractMeta[] = [
  {
    id: "dialogue.turn",
    version: 1,
    stability: "standard",
    kind: "behavior",
    owner: "dialogue",
    summary: "`turnId` 归组；`thinking → acting* → replied/failed`，phases 不降级",
    verify: "test/dialogue-state.test.js",
  },
  {
    id: "dialogue.failure",
    version: 1,
    stability: "standard",
    kind: "behavior",
    owner: "dialogue",
    summary: "`failed` 必带原因；缺原因用兜底文案并记协议缺陷",
    verify: "test/dialogue-state.test.js",
  },
  {
    id: "dialogue.ui",
    version: 1,
    stability: "standard",
    kind: "behavior",
    owner: "dialogue",
    summary: "点选角色 → 底部面板（默认移动态）；Enter 进对话、Esc 关；历史不丢",
    verify: "test/dialogue-state.test.js",
  },
]
