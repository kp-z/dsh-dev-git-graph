/**
 * 运行层观测：把一次真实的工具调用，对到它声明过的契约上。
 *
 * 挂点是 `tools/result` ——它是**只读观测**事件：回调拿到冻结的 `exec`（含 `name`/`callId`/
 * `agent`/`arguments`）与不可变的最终结果，改不了任何东西，也不参与拦截决策。这正是监控
 * 该待的位置：一个"看"的功能不该有能力改变被看的东西。
 *
 * 覆盖面：凡是走 `ctx.tools` 的调用都经过这条管道，包括所有 MCP 服务器注册进来的工具。
 * 也就是说这一条链路**零埋点**地覆盖了宿主与所有外部工具边界。
 *
 * 找不到对应声明时不编造判定：仍记一条观测，但 `contractId` 为空、`ok` 为真，并在语义上
 * 当作"观测到了但不在纳管范围内"。观测的价值在于"记下来过"，不在于凑出结论。
 */
import { bytesOf, conforms, sampleOf } from './conform.js'
import { shapeHash, shapeOf } from './shape.js'
import { observationKey } from './store.js'
import type { ButlerStore } from './store.js'
import type { ContractRecord, ObservationRecord } from './types.js'

/** 观测来源标识（写进记录，便于以后接入别的来源时区分）。 */
export const SOURCE_TOOLS = 'tools/result'

/** 观测选项。 */
export interface ObserverOptions {
  store: ButlerStore
  /** 载荷样本的上限字节数。 */
  payloadMaxBytes: number
  /** 需要打码的键名。 */
  redactKeys: string[]
  /** 是否采集载荷样本；默认关。 */
  capturePayloads: boolean
  /** 单个项目保留的观测条数上限。 */
  ringSize: number
}

/** 一次调用的原始观测输入。 */
export interface ObservationInput {
  /** 工具名（边界标识的主体）。 */
  subject: string
  /** 调用参数（`exec.arguments`）。 */
  args: unknown
  /** 结果值。 */
  value: unknown
  /** 工具是否以失败告终；失败的调用不参与"不符"判定。 */
  failed: boolean
}

/** 契约索引里的一条。 */
interface IndexEntry {
  contract: ContractRecord
  projectId: string
}

/**
 * 观测器：持有契约索引与实时环形缓冲。
 *
 * 索引按边界（`tool:<name>`）建，因为观测天然是从"哪个工具"出发找契约的，而不是反过来。
 * 命名冲突（两个项目都声明了同名工具）时取先遇到的那个，并把它记在观测里——宁可归错也要
 * 归得**可追溯**。
 */
export class Observer {
  private readonly index = new Map<string, IndexEntry>()
  private dirty = true
  private seq = 0
  /** 上一次用过的时刻；见 {@link observe} 里对 `at` 的说明。 */
  private lastAt = 0
  private readonly ring = new Map<string, ObservationRecord[]>()

  constructor(
    private readonly store: ButlerStore,
    private readonly options: ObserverOptions,
  ) {}

  /** 契约集合变化后调用，下次观测时重建索引。 */
  invalidate(): void {
    this.dirty = true
  }

  /** 最近的观测（环形缓冲，新的在前）。 */
  recent(projectId: string, limit = 50): ObservationRecord[] {
    const list = this.ring.get(projectId) ?? []
    return list.slice(0, Math.max(0, limit))
  }

  /**
   * 记一条观测。
   * @param input - 调用信息。
   * @returns 写入的记录。
   */
  async observe(input: ObservationInput): Promise<ObservationRecord> {
    this.rebuildIfDirty()
    const entry = this.index.get(`tool:${input.subject}`)
    // 时刻严格单调：同一毫秒里连着来两次调用是常事，若两条记录共用同一个 `at`，"最近的调用"
    // 就没了确定次序——而观测列表正是靠时间序说话的。所以撞上同一毫秒就往后挪一格。
    const now = Date.now()
    const at = now > this.lastAt ? now : this.lastAt + 1
    this.lastAt = at
    this.seq += 1

    const reasons: string[] = []
    let ok = true
    if (!input.failed && entry !== undefined) {
      // 失败的调用不判"不符"：工具报错时的返回载荷本来就不受声明约束。
      reasons.push(...conforms(entry.contract.input, input.args, { path: '参数' }))
      reasons.push(...conforms(entry.contract.output, input.value, { path: '返回' }))
      ok = reasons.length === 0
    }

    const projectId = entry?.projectId ?? ''
    const record: ObservationRecord = {
      id: observationKey(at, this.seq),
      projectId,
      contractId: entry === null || entry === undefined ? '' : entry.contract.id,
      at,
      source: SOURCE_TOOLS,
      subject: input.subject,
      ok,
      reasons,
      shapeHash: `${shapeHash(shapeOf(input.args))}>${shapeHash(shapeOf(input.value))}`,
      sample: this.options.capturePayloads
        ? sampleOf({ args: input.args, value: input.value }, this.options.redactKeys, this.options.payloadMaxBytes)
        : '',
      bytes: bytesOf(input.args) + bytesOf(input.value),
    }

    if (projectId !== '') {
      await this.store.observations().put(record.id, record)
      const list = this.ring.get(projectId) ?? []
      list.unshift(record)
      const overflow = list.splice(this.options.ringSize)
      this.ring.set(projectId, list)
      for (const stale of overflow) {
        // 环形缓冲之外的就从存储里清掉：观测是"最近发生了什么"，不是审计日志。
        await this.store.observations().delete(stale.id)
      }
    }
    return record
  }

  /** 索引脏了才重建：每次工具调用都全表扫一遍存储是没必要且会退化的。 */
  private rebuildIfDirty(): void {
    if (!this.dirty) return
    this.index.clear()
    for (const [, project] of this.store.projects().entries()) {
      for (const contract of this.store.contractsOf(project.id)) {
        if (contract.boundaryKind !== 'tool') continue
        if (!this.index.has(contract.boundary)) {
          this.index.set(contract.boundary, { contract, projectId: project.id })
        }
      }
    }
    this.dirty = false
  }
}
