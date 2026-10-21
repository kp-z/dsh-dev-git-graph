/**
 * 契约登记表的**类型与域表**。
 *
 * 一个域一个文件（同目录下的 `world.ts` / `stage.ts` / ...），review 时只看相关的那一个；
 * 聚合与查询在 `index.ts`，格式自检在 `lint.ts`。
 */

/** 契约稳定性。含义与改动代价见 `docs/CONTRACTS.md` §二。 */
export type ContractStability = 'frozen' | 'standard' | 'extension' | 'experimental'

/** 契约类型：数据契约要四件套，行为契约要"不变量 + 验收 + 可观测"。 */
export type ContractKind = 'data' | 'behavior'

/** 领域。id 的第一段必须在这里。 */
export const CONTRACT_DOMAINS = [
  'agent',
  'bridge',
  'comms',
  'compat',
  'content',
  'dialogue',
  'hud',
  'knowledge',
  'map',
  'move',
  'obs',
  'stage',
  'station',
  'store',
  'task',
  'taskset',
  'team',
  'ui',
  'wire',
  'world',
] as const

/** 领域名。 */
export type ContractDomain = (typeof CONTRACT_DOMAINS)[number]

/** 稳定性取值（顺序稳定，遍历与展示都用它）。 */
export const CONTRACT_STABILITIES: readonly ContractStability[] = [
  'frozen',
  'standard',
  'extension',
  'experimental',
] as const

/** 一条契约的登记项。 */
export interface ContractMeta {
  /** `域.对象[.侧面]`，小写，**frozen 后永不复用、永不改名**。 */
  readonly id: string
  /** 版本，破坏性改动 +1；只加可选字段不 bump。 */
  readonly version: number
  readonly stability: ContractStability
  readonly kind: ContractKind
  readonly owner: ContractDomain
  /** 一句话承诺（与 `docs/CONTRACTS.md` 同义）。 */
  readonly summary: string
  /**
   * 验收入口，三种合法形态：
   * - `test/xxx.test.js`：文件必须存在；
   * - `__agentWorldXxx()`：页内调试门面；
   * - `planned:P0..P4`：欠账，写在明面上。
   */
  readonly verify: string
}
