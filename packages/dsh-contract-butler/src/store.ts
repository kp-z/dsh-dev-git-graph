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

/** 六张表的表名。 */
export const TABLES = {
  projects: 'projects',
  contracts: 'contracts',
  snapshots: 'snapshots',
  changes: 'changes',
  observations: 'observations',
  decisions: 'decisions',
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
