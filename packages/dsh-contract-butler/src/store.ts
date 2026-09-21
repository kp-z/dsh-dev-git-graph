/**
 * 存储层：把领域句柄包成一张有类型的读写面。
 *
 * 刻意**自己声明结构类型**而不是 import 对端的类型：`@deepseek-ai/dsh-storage-domain` 在
 * 本环境里不带声明文件（见 `shims.d.ts`），而且真去依赖它的类型会把本包的产物 d.ts 绑上
 * 对端的类型可用性。真正保证记录合法的是两件事：领域自己在打开时按 schema 校验落盘记录，
 * 以及本模块在读出形状子树时过一遍 `parseShape()`。
 */
import { parseShape } from './shape.js'
import { CONTRACT_BUTLER_DOMAIN } from './domain.js'
import type {
  AiRecord,
  ChangeRecord,
  ContractRecord,
  DecisionRecord,
  ObservationRecord,
  ProjectRecord,
} from './types.js'

/** 一张表的读写面（与 `dsh-storage-domain` 的 `KvTableImpl` 对齐）。 */
export interface TableLike<T> {
  get(key: string): T | undefined
  entries(): IterableIterator<[string, T]>
  keys(): IterableIterator<string>
  readonly size: number
  put(key: string, value: T): Promise<void>
  delete(key: string): Promise<boolean>
  update(key: string, fn: (record: T) => T): Promise<T>
}

/** 一个打开的领域。 */
export interface DomainLike {
  table<T>(name: string): TableLike<T>
  close(): Promise<void>
}

/** 打开领域所需的设施（`ctx.storageDomain`）。 */
export interface StorageDomainFacility {
  open(spec: unknown): Promise<DomainLike>
}

/** 七张表的表名。 */
export const TABLES = {
  projects: 'projects',
  contracts: 'contracts',
  snapshots: 'snapshots',
  changes: 'changes',
  observations: 'observations',
  decisions: 'decisions',
  /** AI 理解结果的缓存；按内容哈希判定可用性。 */
  ai: 'ai',
} as const

/** 形状快照记录（快照表用）。 */
export interface SnapshotRecord {
  projectId: string
  contractId: string
  sha: string
  at: number
  inputHash: string
  outputHash: string
  input: unknown
  output: unknown
}

/** 一次"清掉生成出来的数据"的结果：各表清掉了多少条。 */
export interface ClearedCounts {
  contracts: number
  snapshots: number
  changes: number
  observations: number
  decisions: number
  /** 清掉的 AI 结果缓存条数。 */
  ai: number
}

/**
 * 契约管家的存储门面。
 *
 * 打开时把六张表的记录读进内存（读同步），写入按领域自己的写入链排队并等持久化完成——
 * 也就是说 `await put()` 返回时数据已经落盘，这一点被"基线不可变"依赖着。
 */
export class ButlerStore {
  private constructor(private readonly domain: DomainLike) {}

  /** 打开领域。 */
  static async open(facility: StorageDomainFacility): Promise<ButlerStore> {
    const domain = await facility.open(CONTRACT_BUTLER_DOMAIN)
    return new ButlerStore(domain)
  }

  /** 关闭领域，释放句柄。 */
  close(): Promise<void> {
    return this.domain.close()
  }

  /** 项目表。 */
  projects(): TableLike<ProjectRecord> {
    return this.domain.table<ProjectRecord>(TABLES.projects)
  }

  /** 契约表。 */
  contracts(): TableLike<ContractRecord> {
    return this.domain.table<ContractRecord>(TABLES.contracts)
  }

  /** 快照表。 */
  snapshots(): TableLike<SnapshotRecord> {
    return this.domain.table<SnapshotRecord>(TABLES.snapshots)
  }

  /** 演化表。 */
  changes(): TableLike<ChangeRecord> {
    return this.domain.table<ChangeRecord>(TABLES.changes)
  }

  /** 观测表。 */
  observations(): TableLike<ObservationRecord> {
    return this.domain.table<ObservationRecord>(TABLES.observations)
  }

  /** 决策表。 */
  decisions(): TableLike<DecisionRecord> {
    return this.domain.table<DecisionRecord>(TABLES.decisions)
  }

  /**
   * AI 结果的缓存表。
   *
   * 缓存**必须跟着领域落盘**，而不是留在内存里：重启宿主的代价不该是"再问一遍所有契约"——
   * 那既慢又费钱，而且两次回答未必一致，人会以为契约变了。
   */
  ai(): TableLike<AiRecord> {
    return this.domain.table<AiRecord>(TABLES.ai)
  }

  /**
   * 读出某项目下所有契约，并把形状子树过一遍校验。
   *
   * 形状子树在域 schema 里是 `z.any()`（见 `domain.ts` 的说明），所以这里是它唯一的把关点：
   * 读不动形状的记录**保留但降级为 null**，而不是整条丢掉——宁可少显示一个形状，也要让
   * 用户还能看到这条契约存在过。
   */
  contractsOf(projectId: string): ContractRecord[] {
    const out: ContractRecord[] = []
    for (const [, record] of this.contracts().entries()) {
      if (record.projectId !== projectId) continue
      out.push({
        ...record,
        input: parseShape(record.input),
        output: parseShape(record.output),
      })
    }
    return out.sort((a, b) => a.id.localeCompare(b.id))
  }

  /** 读出某项目下所有演化记录，按提交时间倒序（新的在前）。 */
  changesOf(projectId: string): ChangeRecord[] {
    const out: ChangeRecord[] = []
    for (const [, record] of this.changes().entries()) {
      if (record.projectId === projectId) out.push(record)
    }
    return out.sort((a, b) => b.at - a.at)
  }

  /** 读出某项目下所有观测，按时间倒序。 */
  observationsOf(projectId: string): ObservationRecord[] {
    const out: ObservationRecord[] = []
    for (const [, record] of this.observations().entries()) {
      if (record.projectId === projectId) out.push(record)
    }
    return out.sort((a, b) => b.at - a.at)
  }

  /** 读出某项目下所有决策。 */
  decisionsOf(projectId: string): DecisionRecord[] {
    const out: DecisionRecord[] = []
    for (const [, record] of this.decisions().entries()) {
      if (record.projectId === projectId) out.push(record)
    }
    return out.sort((a, b) => b.at - a.at)
  }

  /** 读出某条契约的快照，按时间倒序。 */
  snapshotsOf(contractId: string): SnapshotRecord[] {
    const out: SnapshotRecord[] = []
    for (const [, record] of this.snapshots().entries()) {
      if (record.contractId === contractId) out.push(record)
    }
    return out.sort((a, b) => b.at - a.at)
  }

  /**
   * 按保留上限裁剪某个契约的快照，只留最新的若干条。
   *
   * 快照是"看一眼当时长什么样"的凭据，不是审计日志；无上限地留着只会让存储慢慢变成垃圾场。
   * @param contractId - 契约 id。
   * @param keep - 保留条数。
   * @returns 被删掉的条数。
   */
  async pruneSnapshots(contractId: string, keep: number): Promise<number> {
    const all = this.snapshotsOf(contractId)
    let removed = 0
    for (const record of all.slice(Math.max(0, keep))) {
      const key = snapshotKey(record.contractId, record.sha)
      if (await this.snapshots().delete(key)) removed += 1
    }
    return removed
  }

  /**
   * 清掉某个项目**生成出来的**数据：契约、快照、演化、观测、决策、AI 结果缓存。
   *
   * 项目记录本身不在清理范围内——它是"人的决定"（纳管范围、基线），不是扫描器的产物；
   * 把基线一起抹掉，等于替用户做了一次「接受为新基线」，那不是重建该有的副作用。
   *
   * AI 缓存也在清理范围内：重建是"按当前代码重做一遍"，留下上一轮的中文说明会让一次重建
   * 看起来只换了一半。想要省这一次调用的场景是**重新扫描**（它不清任何东西，缓存自然命中）。
   *
   * 快照按"这个项目下契约的 id"过滤，所以契约 id 必须**先收集再删**：契约记录一旦删掉，
   * 就再也问不出哪些快照属于它了。另外并上 `projectId` 兜一手，免得上一轮中途失败留下的
   * 孤儿快照永远清不掉。
   * @param projectId - 项目 id。
   * @returns 各表清掉的条数。
   */
  async clearGenerated(projectId: string): Promise<ClearedCounts> {
    const scope = this.generatedScope(projectId)
    return {
      contracts: await this.clearWhere(this.contracts(), scope.contracts),
      snapshots: await this.clearWhere(this.snapshots(), scope.snapshots),
      changes: await this.clearWhere(this.changes(), scope.changes),
      observations: await this.clearWhere(this.observations(), scope.observations),
      decisions: await this.clearWhere(this.decisions(), scope.decisions),
      ai: await this.clearWhere(this.ai(), scope.ai),
    }
  }

  /**
   * 只数不删：一次重建**会**清掉多少条。
   *
   * 面板上那句"会清掉 N 条契约、N 条快照"的预告就是它算的，用户正是照着那句话点的确认。
   * 所以它必须与 `clearGenerated` 说同一件事——两者共用 `generatedScope()` 这一套判据，
   * 判据一旦分叉，预告就成了假话（预告 143 条、实际清掉 140 条），而这正是最不该出错的地方。
   * @param projectId - 项目 id。
   * @returns 各表**将要**清掉的条数（不改任何数据）。
   */
  countGenerated(projectId: string): ClearedCounts {
    const scope = this.generatedScope(projectId)
    const count = <T>(table: TableLike<T>, match: (record: T) => boolean): number => {
      let found = 0
      for (const [, record] of table.entries()) if (match(record)) found += 1
      return found
    }
    return {
      contracts: count(this.contracts(), scope.contracts),
      snapshots: count(this.snapshots(), scope.snapshots),
      changes: count(this.changes(), scope.changes),
      observations: count(this.observations(), scope.observations),
      decisions: count(this.decisions(), scope.decisions),
      ai: count(this.ai(), scope.ai),
    }
  }

  /**
   * "生成出来的数据"的判据集合（`clearGenerated` 与 `countGenerated` 的唯一来源）。
   *
   * 快照与 AI 缓存按"这个项目下契约的 id"过滤，所以契约 id 必须**先收集再删**：契约记录一旦
   * 删掉，就再也问不出哪些快照属于它了。另外并上 `projectId` 兜一手，免得上一轮中途失败留下
   * 的孤儿记录永远清不掉。
   * @param projectId - 项目 id。
   * @returns 六张表各自的命中判据。
   */
  private generatedScope(projectId: string): {
    contracts: (record: ContractRecord) => boolean
    snapshots: (record: SnapshotRecord) => boolean
    changes: (record: ChangeRecord) => boolean
    observations: (record: ObservationRecord) => boolean
    decisions: (record: DecisionRecord) => boolean
    ai: (record: AiRecord) => boolean
  } {
    const contractIds = new Set<string>()
    for (const [key, record] of this.contracts().entries()) {
      if (record.projectId === projectId) contractIds.add(key)
    }
    return {
      contracts: (record) => record.projectId === projectId,
      snapshots: (record) => contractIds.has(record.contractId) || record.projectId === projectId,
      changes: (record) => record.projectId === projectId,
      observations: (record) => record.projectId === projectId,
      decisions: (record) => record.projectId === projectId,
      ai: (record) => contractIds.has(record.contractId) || record.projectId === projectId,
    }
  }

  /**
   * 按条件清掉一张表里匹配的记录。
   *
   * 先收集 key 再删：表实现给出的 `entries()` 是活迭代器，边遍历边删是在赌它的实现细节，
   * 而这里没有任何性能理由去赌。
   * @param table - 要清的表。
   * @param match - 命中判据。
   * @returns 清掉的条数。
   */
  private async clearWhere<T>(table: TableLike<T>, match: (record: T) => boolean): Promise<number> {
    const doomed: string[] = []
    for (const [key, record] of table.entries()) if (match(record)) doomed.push(key)
    let removed = 0
    for (const key of doomed) if (await table.delete(key)) removed += 1
    return removed
  }

  /**
   * 裁剪某个项目的观测，只留最新的若干条。
   * @param projectId - 项目 id。
   * @param keep - 保留条数。
   * @returns 被删掉的条数。
   */
  async pruneObservations(projectId: string, keep: number): Promise<number> {
    const all = this.observationsOf(projectId)
    let removed = 0
    for (const record of all.slice(Math.max(0, keep))) {
      if (await this.observations().delete(record.id)) removed += 1
    }
    return removed
  }
}

/** 快照的记录 key：契约 + 版本。key 必须匹配 `[a-zA-Z0-9_-]+`，所以 sha 短取。 */
export function snapshotKey(contractId: string, sha: string): string {
  return `sn_${contractId}_${sha.replace(/[^a-zA-Z0-9]/g, '').slice(0, 12)}`
}

/** 演化记录的 key：契约 + 提交 + 形状对，保证"同一契约同一提交同一变化"只记一条。 */
export function changeKey(contractId: string, sha: string, beforeHash: string, afterHash: string): string {
  return `ch_${contractId}_${sha.replace(/[^a-zA-Z0-9]/g, '').slice(0, 12)}_${beforeHash.slice(0, 6)}${afterHash.slice(0, 6)}`
}

/** 观测记录的 key：时间戳 + 序号，保证唯一且可按时间排序。 */
export function observationKey(at: number, seq: number): string {
  return `ob_${at.toString(36)}_${seq.toString(36)}`
}

/** AI 缓存行的 key：一条契约一行（是否可用另看 `hash`）。key 必须匹配 `[a-zA-Z0-9_-]+`。 */
export function aiKey(contractId: string): string {
  return `ai_${contractId}`
}
