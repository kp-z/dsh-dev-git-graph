/**
 * 抽取器注册表与共用工具。
 *
 * 抽取器是插件式的：每种"契约来源"实现一个 `Extractor`，扫描器只负责遍历文件、按
 * `match()` 分派。新增一种来源（比如 SQL DDL）不需要动扫描器。
 *
 * 候选 id 是 `文件 + 边界 + 符号` 的稳定哈希——**故意不含行号**：一行代码上移不应该让
 * 契约看起来换了一条，否则演化历史会被无意义的 diff 冲垮。
 */
import { textHash } from '../shape.js'
import type { Candidate, BoundaryKind, Evidence, ShapeNode } from '../types.js'

/** 抽取器运行时可用的上下文。 */
export interface ExtractorContext {
  /** 项目根（绝对路径）。 */
  root: string
  /** 读取同项目内的其它文件（用于 `$ref` 之类的跨文件解析）。 */
  read(relativePath: string): Promise<string | null>
}

/** 一种契约来源。 */
export interface Extractor {
  /** 稳定 id，写进契约记录的 `source` 字段。 */
  id: string
  /** 该抽取器是否关心这个相对路径。 */
  match(file: string): boolean
  /**
   * 从文件内容里抽候选。
   * @param file - 相对项目根的路径。
   * @param text - 文件全文。
   * @param ctx - 上下文（可读同项目其它文件）。
   * @returns 候选数组；解析不动就返回空数组，不要抛错（单个文件失败不该拖垮整次扫描）。
   */
  extract(file: string, text: string, ctx: ExtractorContext): Candidate[] | Promise<Candidate[]>
}

/** 契约 id：文件 + 边界 + 符号 的稳定哈希。 */
export function candidateId(file: string, boundary: string, symbol: string): string {
  return `c_${textHash(`${file}\u0000${boundary}\u0000${symbol}`).slice(0, 12)}`
}

/** 证据：命中行与片段哈希。 */
export function evidenceAt(text: string, line: number): Evidence {
  const lines = text.split('\n')
  const index = Math.max(0, Math.min(lines.length - 1, line - 1))
  return { line: Math.max(1, line), hash: textHash(lines[index] ?? '') }
}

/** 组装一个候选，顺手补齐 id 与默认值。 */
export function makeCandidate(input: {
  file: string
  boundary: string
  boundaryKind: BoundaryKind
  source: string
  title: string
  symbol: string
  inputShape?: ShapeNode | null
  outputShape?: ShapeNode | null
  evidence: Evidence
  confidence: number
  note: string
}): Candidate {
  return {
    id: candidateId(input.file, input.boundary, input.symbol),
    file: input.file,
    boundary: input.boundary,
    boundaryKind: input.boundaryKind,
    source: input.source,
    title: input.title,
    symbol: input.symbol,
    input: input.inputShape ?? null,
    output: input.outputShape ?? null,
    twins: [],
    evidence: input.evidence,
    confidence: input.confidence,
    note: input.note,
  }
}

/**
 * 给候选标注"同形"关系：输入输出指纹一致的不同候选互为多份表示。
 *
 * 这正是 demo 里「几份表示对不对得上」的数据来源——同一条数据在 proto、TS 类型、OpenAPI
 * 里各写了一遍，对不上就是隐患。
 * @param candidates - 待标注的候选（原地修改 `twins`）。
 * @returns 同一个数组，便于链式调用。
 */
export function linkTwins(candidates: Candidate[]): Candidate[] {
  const groups = new Map<string, Candidate[]>()
  for (const candidate of candidates) {
    const inputHash = hashOf(candidate.input)
    const outputHash = hashOf(candidate.output)
    if (inputHash === '' && outputHash === '') continue
    const key = `${inputHash}|${outputHash}`
    const bucket = groups.get(key)
    if (bucket === undefined) groups.set(key, [candidate])
    else bucket.push(candidate)
  }
  for (const bucket of groups.values()) {
    if (bucket.length < 2) continue
    for (const candidate of bucket) {
      candidate.twins = bucket.filter((other) => other.id !== candidate.id).map((other) => other.id)
    }
  }
  return candidates
}

/** 取形状指纹；空形状得到空串。 */
function hashOf(node: ShapeNode | null): string {
  if (node === null) return ''
  return textHash(JSON.stringify(node))
}
