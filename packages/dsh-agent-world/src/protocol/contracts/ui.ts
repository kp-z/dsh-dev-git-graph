/**
 * ui 域契约（3 条）。
 *
 * 界面：dock 布局、本地偏好、无障碍。
 *
 * 表格里的承诺、稳定性、验收与应用侧 `docs/CONTRACTS.md` 逐字一致；
 * `test/contracts.test.js` 会双向比对，改一边不改另一边会直接红。
 */
import type { ContractMeta } from './types.js'

export const UI_CONTRACTS: readonly ContractMeta[] = [
  {
    id: "ui.dock.layout",
    version: 1,
    stability: "extension",
    kind: "behavior",
    owner: "ui",
    summary: "三卡 dock 的叶 id 固定 `stage/task/team`；布局树可持久化、坏树回默认",
    verify: "planned:P1",
  },
  {
    id: "ui.persist",
    version: 1,
    stability: "extension",
    kind: "behavior",
    owner: "ui",
    summary: "用户偏好键前缀 `agentWorld.`；读坏值回默认，不抛",
    verify: "planned:P1",
  },
  {
    id: "ui.a11y",
    version: 1,
    stability: "extension",
    kind: "behavior",
    owner: "ui",
    summary: "角色/卡片/面板可键盘到达；`aria-*` 如实",
    verify: "planned:P1",
  },
]
