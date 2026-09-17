/**
 * 协议管家的核心数据模型。
 *
 * 三层时间尺度各自对应一类记录：
 * - 定义层：`ContractRecord`——契约现在长什么样，以及它归属哪个文件、哪条边界。
 * - 演化层：`ChangeRecord`——哪个提交把它改成了什么样，是不是破坏性。
 * - 运行层：`ObservationRecord`——实际跑起来的数据与声明对不对得上。
 *
 * 两个正交事实（沿用 demo 已定的语义，二者可同时成立）：
 * - 变过：在选中的版本区间里改过（由落在区间内的 `ChangeRecord` 决定）。
 * - 不符：观测到的载荷与声明不符（`ObservationRecord.ok === false`）。
 *
 * 一条硬约定：契约是代码的投影，任何记录都由抽取器写、由人确认，**不存在手写契约**。
 */

/** 形状节点的类型。只描述结构，不描述值。 */
export type ShapeKind =
  | 'string'
  | 'number'
  | 'boolean'
  | 'null'
  | 'array'
  | 'object'
  | 'unknown'

/**
 * 形状节点：键路径 + 类型 + 可空性，**不含任何值**。
 *
 * 运行层观测只用它作为指纹——这样既能判断"对不对得上"，又天然不落敏感数据。
 */
export interface ShapeNode {
  kind: ShapeKind
  /** 处在对象字段里时，该字段是否可缺省。 */
  optional?: boolean
  /** 该位置是否出现过 null。 */
  nullable?: boolean
  /** 数组元素的合并形状。 */
  of?: ShapeNode
  /** 对象字段（序列化前按 key 升序）。 */
  fields?: Record<string, ShapeNode>
  /** 出现过的字面量取值（枚举），用于判断"取值被删掉"。 */
  enumValues?: string[]
}

/** 边界种类。契约挂在边界上，而不是挂在"文件"上。 */
export type BoundaryKind =
  | 'tool'
  | 'http'
  | 'event'
  | 'proto'
  | 'schema'
  | 'db'
  | 'unknown'

/** 版本控制形态。无 git 时基线降级为内容哈希。 */
export type VcsKind = 'git' | 'none'

/** 证据：命中位置与片段哈希，用来判断"当时的证据是否还在原处"。 */
export interface Evidence {
  /** 1 起的行号。 */
  line: number
  /** 命中片段的稳定哈希。 */
  hash: string
}

/** 扫描范围配置。 */
export interface ScanConfig {
  /** 目录名排除表（按名字匹配，任何层级生效）。 */
  excludeDirs: string[]
  /** 单次扫描的文件数上限，超出则截断并明确告知。 */
  maxFiles: number
}

/** 一个纳管进来的项目。 */
export interface ProjectRecord {
  id: string
  /** 绝对路径。 */
  root: string
  title: string
  vcs: VcsKind
  /** git 基线提交；无 git 时为 null。 */
  baselineSha: string | null
  /** 无 git 时的基线内容哈希；有 git 时为 null。 */
  baselineHash: string | null
  createdAt: number
  scannedAt: number
  scan: ScanConfig
  /** 纳管进来的契约 id。不在其中的候选属于"已知但未纳管"。 */
  include: string[]
}

/** 一条契约：某条边界上的一组数据结构。 */
export interface ContractRecord {
  id: string
  projectId: string
  /** 相对项目根的路径。 */
  file: string
  /** 边界标识，如 `tool:example_echo` 或 `POST /x/y`。 */
  boundary: string
  boundaryKind: BoundaryKind
  /** 抽取器 id，如 `openapi` / `proto` / `ts-pattern` / `tools-runtime`。 */
  source: string
  /** 展示用标题。 */
  title: string
  /** 代码里的符号名或路由名。 */
  symbol: string
  /** 输入形状；没有则 null。 */
  input: ShapeNode | null
  /** 输出形状；没有则 null。 */
  output: ShapeNode | null
  /** 同形的其他契约 id（同一实体的多份表示）。 */
  twins: string[]
  evidence: Evidence
  /** 0..1，抽取器自评的把握程度。模式匹配低于语法解析，UI 要如实显示。 */
  confidence: number
  createdAt: number
  updatedAt: number
}

/** 一条演化：某个提交把某条契约改成了什么样。 */
export interface ChangeRecord {
  id: string
  projectId: string
  contractId: string
  /** 引入这次变化的提交；无 git 时为 `local-<hash>`。 */
  sha: string
  /** 提交时间（取自 git，不自己算）。 */
  at: number
  /** 提交说明。 */
  subject: string
  /** `breaking` 或 `compatible`。 */
  kind: 'breaking' | 'compatible'
  /** 逐条原因，供 UI 直接展示"为什么算破坏"。 */
  reasons: string[]
  beforeHash: string
  afterHash: string
  createdAt: number
}

/** 一条决策：人能做的全部写入都落在这里。 */
export interface DecisionRecord {
  id: string
  projectId: string
  /** 决策对象。 */
  targetKind: 'change' | 'observation' | 'contract'
  targetId: string
  /** `ack` 已知 / `accept-baseline` 接受为新基线 / `silence` 静默 / `scope` 调整纳管范围。 */
  action: 'ack' | 'accept-baseline' | 'silence' | 'scope'
  /** 谁定的（当前是操作者标识或 `local`）。 */
  by: string
  at: number
  note: string
}

/** 一条运行层观测。默认只记形状与判定，不记完整载荷。 */
export interface ObservationRecord {
  id: string
  projectId: string
  /** 对应契约；认不出来时为 null（观测到了但不知道属于谁）。 */
  contractId: string | null
  at: number
  /** 观测来源，如 `tools/result`。 */
  source: string
  /** 观测对象，如工具名。 */
  subject: string
  /** 与声明是否相符。 */
  ok: boolean
  /** 不符的原因。 */
  reasons: string[]
  /** 实际形状指纹。 */
  shapeHash: string
  /** 截断 + 打码后的样本；`capturePayloads` 关闭时为空串。 */
  sample: string
  /** 载荷字节数（截断前）。 */
  bytes: number
}

/** 一个候选：扫描阶段提出、尚未被人确认的东西。 */
export interface Candidate {
  /** 稳定 id，由 文件+边界+符号 哈希得到。 */
  id: string
  file: string
  boundary: string
  boundaryKind: BoundaryKind
  source: string
  title: string
  symbol: string
  input: ShapeNode | null
  output: ShapeNode | null
  /** 同形的其他候选 id。 */
  twins: string[]
  evidence: Evidence
  confidence: number
  /** 人可读的抽取依据，例如 "openapi 3.0.3 · components.schemas.User"。 */
  note: string
}

/** 一次扫描的结果。 */
export interface ScanResult {
  candidates: Candidate[]
  /** 见过的文件数（受 maxFiles 截断）。 */
  filesSeen: number
  /** 被截断时为 true。 */
  truncated: boolean
  /** 逐个文件的失败，不阻塞整体。 */
  errors: { file: string; message: string }[]
  /** 扫描耗时（ms）。 */
  durationMs: number
}

/**
 * 领域规格的最小可见形状。
 *
 * 对外导出领域句柄时用它标注，而不是直接用 `defineDomain` 的推导类型——后者会引用
 * `@deepseek-ai/dsh-storage-domain` 的声明，把本包的产物 d.ts 绑上对端包的类型可用性。
 */
export interface DomainSpecLike {
  name: string
  version: number
  layout?: 'single' | 'per-record'
  compatibleVersions?: number[]
  invalidRecords?: 'backup-and-skip'
  tables: Record<string, unknown>
}

/** 形状差异的一条。 */
export interface ShapeDiff {
  /** 点分路径，如 `payload.items[].id`。 */
  path: string
  /** 人可读的原因。 */
  detail: string
}
