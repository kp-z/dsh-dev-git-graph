/**
 * taskset 域契约（3 条）。
 *
 * 任务集：定义、派单、结算。
 *
 * 表格里的承诺、稳定性、验收与应用侧 `docs/CONTRACTS.md` 逐字一致；
 * `test/contracts.test.js` 会双向比对，改一边不改另一边会直接红。
 */
import type { ContractMeta } from './types.js'

export const TASKSET_CONTRACTS: readonly ContractMeta[] = [
  {
    id: "taskset.definition",
    version: 1,
    stability: "standard",
    kind: "behavior",
    owner: "taskset",
    summary: "任务模板 + 集合元数据；版本化、可覆盖、可组合",
    verify: "test/content.test.js",
  },
  {
    id: "taskset.dispatch",
    version: 1,
    stability: "standard",
    kind: "behavior",
    owner: "taskset",
    summary: "能力硬匹配 → 负载 → 公平防饿死；**等级不进调度**（v1）",
    verify: "test/sim.test.js",
  },
  {
    id: "taskset.reward",
    version: 1,
    stability: "experimental",
    kind: "behavior",
    owner: "taskset",
    summary: "完成 → XP 结算幂等（`taskId:attemptId`），失败不扣",
    verify: "planned:P4",
  },
]
