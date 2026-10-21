/**
 * 契约登记表的**聚合出口**。
 *
 * ## 为什么按域拆文件
 *
 * 68 条契约塞在一个 700+ 行的文件里，review 时要在无关的域之间翻；
 * 改一条 `stage.*` 也会让整份 diff 变得看不出重点。所以：
 *
 * - 一个域一个文件（`world.ts` / `stage.ts` / ...），**review 只看相关的那个**；
 * - 新增契约：找到域的文件的末尾加一条，再同步 `docs/CONTRACTS.md`；
 * - 跨域查询、格式自检在这里（`CONTRACTS` / `contractById` / `contractsByDomain`）。
 *
 * 格式规则与字段含义见 `types.ts`；自检逻辑见 `lint.ts`。
 */
import { AGENT_CONTRACTS } from './agent.js'
import { BRIDGE_CONTRACTS } from './bridge.js'
import { COMMS_CONTRACTS } from './comms.js'
import { COMPAT_CONTRACTS } from './compat.js'
import { CONTENT_CONTRACTS } from './content.js'
import { DIALOGUE_CONTRACTS } from './dialogue.js'
import { HUD_CONTRACTS } from './hud.js'
import { KNOWLEDGE_CONTRACTS } from './knowledge.js'
import { MAP_CONTRACTS } from './map.js'
import { MOVE_CONTRACTS } from './move.js'
import { OBS_CONTRACTS } from './obs.js'
import { STAGE_CONTRACTS } from './stage.js'
import { STATION_CONTRACTS } from './station.js'
import { STORE_CONTRACTS } from './store.js'
import { TASK_CONTRACTS } from './task.js'
import { TASKSET_CONTRACTS } from './taskset.js'
import { TEAM_CONTRACTS } from './team.js'
import { UI_CONTRACTS } from './ui.js'
import { WIRE_CONTRACTS } from './wire.js'
import { WORLD_CONTRACTS } from './world.js'

import type { ContractDomain, ContractMeta } from './types.js'

/** 全部契约（按域文件顺序拼接，`CONTRACT_DOMAINS` 与之一致）。 */
export const CONTRACTS: readonly ContractMeta[] = [
  ...AGENT_CONTRACTS,
  ...BRIDGE_CONTRACTS,
  ...COMMS_CONTRACTS,
  ...COMPAT_CONTRACTS,
  ...CONTENT_CONTRACTS,
  ...DIALOGUE_CONTRACTS,
  ...HUD_CONTRACTS,
  ...KNOWLEDGE_CONTRACTS,
  ...MAP_CONTRACTS,
  ...MOVE_CONTRACTS,
  ...OBS_CONTRACTS,
  ...STAGE_CONTRACTS,
  ...STATION_CONTRACTS,
  ...STORE_CONTRACTS,
  ...TASK_CONTRACTS,
  ...TASKSET_CONTRACTS,
  ...TEAM_CONTRACTS,
  ...UI_CONTRACTS,
  ...WIRE_CONTRACTS,
  ...WORLD_CONTRACTS,
]

export type {
  ContractDomain,
  ContractKind,
  ContractMeta,
  ContractStability,
} from './types.js'
export { CONTRACT_DOMAINS, CONTRACT_STABILITIES } from './types.js'
export { isContractVerify } from './lint.js'
import { lintContracts as lintEntries } from './lint.js'

/** 格式自检（默认检查全部登记项）。 */
export function lintContracts(entries: readonly ContractMeta[] = CONTRACTS): string[] {
  return lintEntries(entries)
}

/** 按 id 查一条契约。找不到返回 null（调用方决定这是不是错误）。 */
export function contractById(id: string): ContractMeta | null {
  return CONTRACTS.find((item) => item.id === id) ?? null
}

/** 按领域列契约（保持登记顺序）。 */
export function contractsByDomain(domain: ContractDomain): readonly ContractMeta[] {
  return CONTRACTS.filter((item) => item.owner === domain)
}
