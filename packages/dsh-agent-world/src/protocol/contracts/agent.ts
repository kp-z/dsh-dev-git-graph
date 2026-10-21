/**
 * agent 域契约（7 条）。
 *
 * Agent：身份、档案、档案写入、经验账本、等级派生、能力、生命周期。
 *
 * 表格里的承诺、稳定性、验收与应用侧 `docs/CONTRACTS.md` 逐字一致；
 * `test/contracts.test.js` 会双向比对，改一边不改另一边会直接红。
 */
import type { ContractMeta } from './types.js'

export const AGENT_CONTRACTS: readonly ContractMeta[] = [
  {
    id: "agent.identity",
    version: 1,
    stability: "standard",
    kind: "behavior",
    owner: "agent",
    summary: "人（personId）不可变、不复用；**座位可复用**；角色 id 一次性铸造（不得由数组长度派生）；重名必须诊断",
    verify: "planned:P2",
  },
  {
    id: "agent.profile.shape",
    version: 1,
    stability: "standard",
    kind: "data",
    owner: "agent",
    summary: "档案形状 + schema 版本；名字是投影的**镜像**（不独立写回）",
    verify: "planned:P2",
  },
  {
    id: "agent.profile.write",
    version: 1,
    stability: "standard",
    kind: "behavior",
    owner: "agent",
    summary: "模型工具面**没有**改档案/发 XP/加能力的入口；只能提交提案走审批",
    verify: "planned:P2",
  },
  {
    id: "agent.level.ledger",
    version: 1,
    stability: "experimental",
    kind: "behavior",
    owner: "agent",
    summary: "经验**账本** append-only；等级是派生量，永不双写",
    verify: "planned:P2",
  },
  {
    id: "agent.level.derive",
    version: 1,
    stability: "experimental",
    kind: "behavior",
    owner: "agent",
    summary: "等级 = f(xp, curveVersion)，单调、可重算",
    verify: "planned:P2",
  },
  {
    id: "agent.capability",
    version: 1,
    stability: "standard",
    kind: "behavior",
    owner: "agent",
    summary: "能力是**声明**，只用于匹配与表现，从不授权",
    verify: "test/sim.test.js",
  },
  {
    id: "agent.lifecycle",
    version: 1,
    stability: "standard",
    kind: "behavior",
    owner: "agent",
    summary: "招募 / 换身体 / 退役；退役保留档案，不删历史",
    verify: "planned:P2",
  },
]
