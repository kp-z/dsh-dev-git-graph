/**
 * team 域契约（3 条）。
 *
 * 团队投影：成员、队长。
 *
 * 表格里的承诺、稳定性、验收与应用侧 `docs/CONTRACTS.md` 逐字一致；
 * `test/contracts.test.js` 会双向比对，改一边不改另一边会直接红。
 */
import type { ContractMeta } from './types.js'

export const TEAM_CONTRACTS: readonly ContractMeta[] = [
  {
    id: "team.projection",
    version: 1,
    stability: "standard",
    kind: "behavior",
    owner: "team",
    summary: "成员/任务来自官方 `agentTeam` projection，不轮询、不解析 tool call",
    verify: "test/client-plugin.test.js",
  },
  {
    id: "team.member",
    version: 1,
    stability: "standard",
    kind: "behavior",
    owner: "team",
    summary: "一个 subagent ↔ 一个角色，靠 `boundAgentId` 映射；名字取投影名",
    verify: "test/bridge.test.js",
  },
  {
    id: "team.captain",
    version: 1,
    stability: "standard",
    kind: "behavior",
    owner: "team",
    summary: "队长 = 当前会话自己的 live agent（无则回退配置）",
    verify: "test/captain-session-config.test.js",
  },
]
