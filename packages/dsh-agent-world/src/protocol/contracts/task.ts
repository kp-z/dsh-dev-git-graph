/**
 * task 域契约（5 条）。
 *
 * 工单：状态机、依赖、进度、外部裁决、卡死回收。
 *
 * 表格里的承诺、稳定性、验收与应用侧 `docs/CONTRACTS.md` 逐字一致；
 * `test/contracts.test.js` 会双向比对，改一边不改另一边会直接红。
 */
import type { ContractMeta } from './types.js'

export const TASK_CONTRACTS: readonly ContractMeta[] = [
  {
    id: "task.status",
    version: 1,
    stability: "frozen",
    kind: "behavior",
    owner: "task",
    summary: "6 态；`ready` 是**派生**，只在 `sim/ready.ts` 算一处",
    verify: "test/sim.test.js",
  },
  {
    id: "task.deps",
    version: 1,
    stability: "standard",
    kind: "behavior",
    owner: "task",
    summary: "前置全 done 才 ready；前置 failed ⇒ 后继**永不 ready**，必须可诊断（不允许静默 pending）",
    verify: "test/board-layout.test.js",
  },
  {
    id: "task.progress",
    version: 1,
    stability: "standard",
    kind: "behavior",
    owner: "task",
    summary: "**同一 attempt 内**进度只在 `interaction.ts` 单调推进；外部指派可清零（换 attempt）、外部完成可置 1",
    verify: "test/sim.test.js",
  },
  {
    id: "task.external",
    version: 1,
    stability: "standard",
    kind: "behavior",
    owner: "task",
    summary: "外部裁决认 `attemptId`、幂等、指派必须连带落位；**裁决必须发与模拟路径同形状的事件**",
    verify: "test/sim.test.js",
  },
  {
    id: "task.stall",
    version: 1,
    stability: "standard",
    kind: "behavior",
    owner: "task",
    summary: "卡死判定按 `stalledSinceTick`，超阈值退回 ready；回收**必须**发 `task.changed{reason:'recovered'}`",
    verify: "test/sim.test.js",
  },
]
