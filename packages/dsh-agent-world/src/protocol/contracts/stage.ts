/**
 * stage 域契约（7 条）。
 *
 * 舞台：动作目录、反应规则、通道、降级、输入、相机、性能。
 *
 * 表格里的承诺、稳定性、验收与应用侧 `docs/CONTRACTS.md` 逐字一致；
 * `test/contracts.test.js` 会双向比对，改一边不改另一边会直接红。
 */
import type { ContractMeta } from './types.js'

export const STAGE_CONTRACTS: readonly ContractMeta[] = [
  {
    id: "stage.action.catalog",
    version: 1,
    stability: "standard",
    kind: "data",
    owner: "stage",
    summary: "**14 条动作**的触发/通道/优先级/时长/降级；新增只能加、不能改语义",
    verify: "planned:P1",
  },
  {
    id: "stage.reaction.rules",
    version: 1,
    stability: "standard",
    kind: "behavior",
    owner: "stage",
    summary: "反应走 overlay 子槽、不与主动动作抢主槽；不反应自己；群体预算；不改世界",
    verify: "planned:P1",
  },
  {
    id: "stage.channel",
    version: 1,
    stability: "standard",
    kind: "behavior",
    owner: "stage",
    summary: "六通道各有**主子槽 + overlay 子槽**；抢占只在同子槽内比较优先级",
    verify: "__agentWorldStage.channels()",
  },
  {
    id: "stage.asset.fallback",
    version: 1,
    stability: "standard",
    kind: "behavior",
    owner: "stage",
    summary: "素材缺失必须降级到状态基线，不许\"什么都不做\"",
    verify: "__agentWorldStage.history()",
  },
  {
    id: "stage.input",
    version: 1,
    stability: "standard",
    kind: "behavior",
    owner: "stage",
    summary: "点选/键盘/对话三模式互斥；键盘移动期间动画不粘",
    verify: "test/move-agent.test.js",
  },
  {
    id: "stage.camera",
    version: 1,
    stability: "standard",
    kind: "behavior",
    owner: "stage",
    summary: "缩放只走整数档，不吸附/不自动跟随；复位是\"缩放+居中\"",
    verify: "__agentWorldScene2d.camera()",
  },
  {
    id: "stage.perf",
    version: 1,
    stability: "standard",
    kind: "behavior",
    owner: "stage",
    summary: "60fps 预算；**2D** benchmark 不劣于基线",
    verify: "planned:P1",
  },
]
