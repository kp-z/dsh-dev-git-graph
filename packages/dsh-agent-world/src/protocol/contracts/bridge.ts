/**
 * bridge 域契约（3 条）。
 *
 * 桥接：DSH 最小契约、工具策略、会话投影。
 *
 * 表格里的承诺、稳定性、验收与应用侧 `docs/CONTRACTS.md` 逐字一致；
 * `test/contracts.test.js` 会双向比对，改一边不改另一边会直接红。
 */
import type { ContractMeta } from './types.js'

export const BRIDGE_CONTRACTS: readonly ContractMeta[] = [
  {
    id: "bridge.minimal.shape",
    version: 1,
    stability: "frozen",
    kind: "behavior",
    owner: "bridge",
    summary: "只声明真正用到的 DSH 字段；与 Inspect 契约逐字对齐",
    verify: "test/bridge.test.js",
  },
  {
    id: "bridge.tool.policy",
    version: 1,
    stability: "frozen",
    kind: "behavior",
    owner: "bridge",
    summary: "工具授权由 DSH 决定；世界只投影，不扩权",
    verify: "test/acceptance-m6.test.js",
  },
  {
    id: "bridge.session.projection",
    version: 1,
    stability: "standard",
    kind: "behavior",
    owner: "bridge",
    summary: "团队成员状态来自会话 projection，不解析模型输出",
    verify: "test/bridge.test.js",
  },
]
