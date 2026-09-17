/**
 * 运行时内省抽取器：契约直接从工具注册表里读出来。
 *
 * 这是全链路里保真度最高、成本最低的一环——`ctx.tools` 里的定义本来就是**机器可读的
 * 权威声明**，不需要解析任何源码。而且它覆盖的不只是本仓库的工具：所有 MCP 服务器发现
 * 的工具也用 `ctx.tools.register()` 注册，因此一并落进同一张网。
 *
 * 代价是这类契约没有源码位置（`evidence.line` 为 0）——声明活在注册表里，不活在某个文件
 * 的某一行。这不影响演化判定（形状指纹照算），只影响"点进去看源码"这个体验。
 *
 * 两种声明格式都必须认，因为宿主自己就是混着用的：
 * - `parameters` 是工具参数 DSL：`{ 字段名: { type, required?, description?, enum?, items? } }`
 *   ——注意 `required` 是**每个字段上的布尔值**，不是 JSON Schema 那个 `required: []` 数组；
 * - `output.schema` 是 JSON Schema，但它同样把 `required: true` 内联在属性上。
 * 把它们当成同一种东西解析，就会得到一堆空形状或错误的可选性——而那正是这个插件要防的事。
 */
import { textHash } from '../shape.js'
import { makeCandidate } from './registry.js'
import { shapeFromJsonSchema } from './jsonSchema.js'
import type { Candidate, ShapeNode } from '../types.js'

/**
 * 工具定义的只读视图。
 *
 * 刻意用结构类型而不是 import 宿主的类型：一来避免把 `@deepseek-ai/dsh-tools` 变成硬依赖，
 * 二来单测可以直接喂普通对象，不必造一个真的注册表。
 */
export interface ToolLike {
  name: string
  description?: string
  /** 工具参数 DSL，或 JSON-Schema 风格的对象。 */
  parameters?: unknown
  /** 输出声明；注册表要求它必须存在。 */
  output?: { schema?: unknown }
}

/** 运行时内省产出的契约在 `evidence.file` 位置写这个标记，UI 据此显示"来自注册表"。 */
export const RUNTIME_FILE = '(工具注册表)'

/**
 * 把工具定义转成候选。
 * @param tools - 工具定义列表（来自 `ctx.tools.schemas()` 枚举 + `ctx.tools.get(name)` 取全量）。
 * @returns 候选数组。
 */
export function candidatesFromTools(tools: ToolLike[]): Candidate[] {
  const candidates: Candidate[] = []
  for (const tool of tools) {
    if (typeof tool.name !== 'string' || tool.name === '') continue
    const input = shapeFromToolParameters(tool.parameters)
    const output = shapeFromJsonSchema(tool.output?.schema)
    // 一条声明都没有的工具不进候选：候选取的是"能被盯住的东西"，纳管它只会往清单里塞噪声。
    if (input === null && output === null) continue
    candidates.push(
      makeCandidate({
        file: RUNTIME_FILE,
        boundary: `tool:${tool.name}`,
        boundaryKind: 'tool',
        source: 'tools-runtime',
        title: tool.name,
        symbol: tool.name,
        inputShape: input,
        outputShape: output,
        evidence: { line: 0, hash: textHash(`${tool.name}\u0000${tool.description ?? ''}`) },
        confidence: 0.95,
        note: '工具注册表内省 · 声明由 ctx.tools 直接给出',
      }),
    )
  }
  return candidates
}

/**
 * 解析工具参数声明。
 *
 * `undefined` / 非对象 → null（**没声明就不判定**）；空对象 `{}` → 空对象形状
 * （**声明了"没有参数"就严格判定**：给无参工具塞参数属于越界，这是值得报的）。
 * @param parameters - `parameters` 字段的原始值。
 * @returns 形状；无法识别时返回 null。
 */
export function shapeFromToolParameters(parameters: unknown): ShapeNode | null {
  if (!isRecord(parameters)) return null
  // JSON-Schema 风格（带 type/properties）走现成的解析器。
  if (isRecord(parameters.properties) || Array.isArray(parameters.required)) {
    return shapeFromJsonSchema(parameters)
  }
  return shapeFromDsl(parameters)
}

/** 把一层 DSL 对象（字段名 → 字段规格）转成对象形状。 */
function shapeFromDsl(spec: Record<string, unknown>): ShapeNode | null {
  const fields: Record<string, ShapeNode> = {}
  for (const key of Object.keys(spec).sort()) {
    const child = spec[key]
    if (!isRecord(child)) continue
    const shape = fieldShape(child)
    if (shape !== null) fields[key] = shape
  }
  return { kind: 'object', fields }
}

/** 单个字段规格 → 形状。 */
function fieldShape(spec: Record<string, unknown>): ShapeNode {
  // 字段自身也可能是 JSON Schema（带 properties/required 数组）。
  if (isRecord(spec.properties) || Array.isArray(spec.required)) {
    const schema = shapeFromJsonSchema(spec)
    if (schema !== null) return withFieldFlags(schema, spec)
  }
  const types = typeList(spec.type)
  const nullable = types.includes('null')
  const primary = types.find((item) => item !== 'null')

  let node: ShapeNode
  if (primary === 'array') {
    node = { kind: 'array' }
    const items = spec.items ?? spec.of
    if (isRecord(items)) node.of = fieldShape(items)
  } else if (primary === 'object') {
    // `{ type: 'object' }` 后面可能挂着嵌套 DSL，也可能是空对象。
    node = isRecord(spec.fields) ? (shapeFromDsl(spec.fields) ?? { kind: 'object' }) : { kind: 'object', fields: {} }
  } else if (primary === undefined) {
    node = { kind: 'unknown' }
  } else {
    node = { kind: kindOfTypeName(primary) }
  }

  const values = Array.isArray(spec.enum) ? spec.enum.filter((item): item is string => typeof item === 'string') : []
  if (values.length > 0) node.enumValues = values
  return withFieldFlags(node, spec, nullable)
}

/** 套上 required / nullable 这两个字段级标记。 */
function withFieldFlags(node: ShapeNode, spec: Record<string, unknown>, nullableHint = false): ShapeNode {
  const out: ShapeNode = { ...node }
  if (nullableHint || typeList(spec.type).includes('null')) out.nullable = true
  if (spec.required !== true) out.optional = true
  return out
}

/** 取 `type` 字符串或字符串数组。 */
function typeList(raw: unknown): string[] {
  if (typeof raw === 'string') return [raw]
  if (Array.isArray(raw)) return raw.filter((item): item is string => typeof item === 'string')
  return []
}

/** DSL 里的类型名 → 形状类别。 */
function kindOfTypeName(name: string): ShapeNode['kind'] {
  switch (name) {
    case 'string':
      return 'string'
    case 'integer':
    case 'number':
      return 'number'
    case 'boolean':
      return 'boolean'
    case 'null':
      return 'null'
    case 'object':
      return 'object'
    case 'array':
      return 'array'
    default:
      return 'unknown'
  }
}

/** 是不是一个普通对象（排除数组与 null）。 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}
