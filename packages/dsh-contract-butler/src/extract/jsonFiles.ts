/**
 * 结构化格式抽取器：JSON Schema 与 OpenAPI。
 *
 * 两种都是"作者本来就想让人和机器读懂"的格式，所以保真度仅次于运行时内省，而且**零解析
 * 风险**——不猜语法，只读结构。两者共用一次解析：同一个文件不为了两份抽取器解析两遍。
 *
 * 结构型文件不提供行号，所以 `evidence.line` 为 0；改而用**子文档内容的哈希**当证据，
 * 这样"这段声明是不是被人动过"依然可判，只是没法精确指到某一行。
 */
import { parse as parseYaml } from 'yaml'
import { textHash } from '../shape.js'
import { makeCandidate } from './registry.js'
import { localRefResolver, shapeFromJsonSchema } from './jsonSchema.js'
import type { RefResolver } from './jsonSchema.js'
import type { Candidate, ShapeNode } from '../types.js'

/** 被两种抽取器共用的文件类型。 */
function isStructured(file: string): boolean {
  return /\.(json|ya?ml)$/i.test(file)
}

/** 解析 JSON 或 YAML；失败返回 null。 */
function parseStructured(file: string, text: string): unknown {
  try {
    if (/\.json$/i.test(file)) return JSON.parse(text)
    return parseYaml(text)
  } catch {
    return null
  }
}

/** 判断是不是 OpenAPI / Swagger 文档。 */
function isOpenApi(doc: unknown): boolean {
  if (doc === null || typeof doc !== 'object') return false
  const record = doc as Record<string, unknown>
  return typeof record.openapi === 'string' || typeof record.swagger === 'string'
}

/** 判断是不是一份 JSON Schema 文档。 */
function isJsonSchema(doc: unknown): boolean {
  if (doc === null || typeof doc !== 'object' || Array.isArray(doc)) return false
  const record = doc as Record<string, unknown>
  if (isOpenApi(record)) return false
  if (typeof record.$schema === 'string') return true
  // 没有 $schema 的裸 schema：认「对象 + properties」这个最小充分条件。
  return record.type === 'object' && record.properties !== null && typeof record.properties === 'object'
}

/** 取一个 schema 片段的行号占位证据。 */
function structuredEvidence(part: unknown): { line: number; hash: string } {
  return { line: 0, hash: textHash(stableText(part)) }
}

/** 稳定序列化：键排序，保证同内容得到同哈希。 */
function stableText(value: unknown): string {
  return JSON.stringify(value, (_key, item: unknown) => {
    if (item === null || typeof item !== 'object' || Array.isArray(item)) return item
    const record = item as Record<string, unknown>
    const sorted: Record<string, unknown> = {}
    for (const key of Object.keys(record).sort()) sorted[key] = record[key]
    return sorted
  })
}

/** HTTP 方法表，按固定顺序遍历以保证候选顺序稳定。 */
const METHODS = ['get', 'put', 'post', 'delete', 'patch', 'head', 'options', 'trace'] as const

/**
 * OpenAPI / Swagger 抽取器。
 *
 * 每条 operation 一个候选（输入 = 参数 + 请求体，输出 = 成功响应），另外每个
 * `components.schemas` 也各出一个候选——它们是操作引用到的实体，恰好就是"同一条数据
 * 被几处表示"最容易出问题的地方。
 */
export const openApiExtractor = {
  id: 'openapi',
  match: isStructured,
  extract(file: string, text: string): Candidate[] {
    const doc = parseStructured(file, text)
    if (!isOpenApi(doc)) return []
    const root = doc as Record<string, unknown>
    const resolver: RefResolver = localRefResolver(root)
    const version = typeof root.openapi === 'string' ? root.openapi : String(root.swagger ?? '')
    const candidates: Candidate[] = []

    const paths = root.paths
    if (paths !== null && typeof paths === 'object') {
      for (const [path, item] of Object.entries(paths as Record<string, unknown>)) {
        if (item === null || typeof item !== 'object') continue
        for (const method of METHODS) {
          const operation = (item as Record<string, unknown>)[method]
          if (operation === null || typeof operation !== 'object') continue
          const op = operation as Record<string, unknown>
          const operationId =
            typeof op.operationId === 'string' && op.operationId !== ''
              ? op.operationId
              : `${method}_${path.replace(/[^a-zA-Z0-9]+/g, '_')}`
          candidates.push(
            makeCandidate({
              file,
              boundary: `${method.toUpperCase()} ${path}`,
              boundaryKind: 'http',
              source: 'openapi',
              title: operationId,
              symbol: operationId,
              inputShape: operationInput(op, resolver),
              outputShape: operationOutput(op, resolver),
              evidence: structuredEvidence(op),
              confidence: 0.95,
              note: `OpenAPI ${version} · ${method.toUpperCase()} ${path}`,
            }),
          )
        }
      }
    }

    const schemas = componentsOf(root)
    for (const [name, schema] of Object.entries(schemas)) {
      const shape = shapeFromJsonSchema(schema, resolver)
      if (shape === null) continue
      candidates.push(
        makeCandidate({
          file,
          boundary: `schema:${name}`,
          boundaryKind: 'schema',
          source: 'openapi',
          title: name,
          symbol: name,
          inputShape: null,
          outputShape: shape,
          evidence: structuredEvidence(schema),
          confidence: 0.9,
          note: `OpenAPI ${version} · components.schemas.${name}`,
        }),
      )
    }
    return candidates
  },
}

/** 取 components.schemas（Swagger 2 用 definitions）。 */
function componentsOf(root: Record<string, unknown>): Record<string, unknown> {
  const components = root.components
  if (components !== null && typeof components === 'object') {
    const schemas = (components as Record<string, unknown>).schemas
    if (schemas !== null && typeof schemas === 'object') return schemas as Record<string, unknown>
  }
  const definitions = root.definitions
  if (definitions !== null && typeof definitions === 'object') {
    return definitions as Record<string, unknown>
  }
  return {}
}

/** 输入形状 = 参数对象 + 请求体（有请求体时以请求体为主，参数并入其字段）。 */
function operationInput(op: Record<string, unknown>, resolver: RefResolver): ShapeNode | null {
  const parts: ShapeNode[] = []

  const parameters = op.parameters
  if (Array.isArray(parameters)) {
    const fields: Record<string, ShapeNode> = {}
    for (const raw of parameters) {
      if (raw === null || typeof raw !== 'object') continue
      const parameter = raw as Record<string, unknown>
      const name = parameter.name
      if (typeof name !== 'string') continue
      const shape = shapeFromJsonSchema(parameter.schema ?? parameter, resolver)
      if (shape === null) continue
      fields[name] = parameter.required === true ? shape : { ...shape, optional: true }
    }
    if (Object.keys(fields).length > 0) parts.push({ kind: 'object', fields })
  }

  const body = jsonSchemaOf(op.requestBody, resolver)
  if (body !== null) parts.push(body)

  if (parts.length === 0) return null
  if (parts.length === 1) return parts[0] ?? null
  // 多部分合并成一个对象：请求体是对象时把参数字段并进去，否则退化为 unknown。
  const merged: Record<string, ShapeNode> = {}
  for (const part of parts) {
    if (part.kind !== 'object') return { kind: 'unknown' }
    Object.assign(merged, part.fields ?? {})
  }
  return { kind: 'object', fields: merged }
}

/** 输出形状 = 第一个成功响应（2xx，其次 default）的 JSON 内容。 */
function operationOutput(op: Record<string, unknown>, resolver: RefResolver): ShapeNode | null {
  const responses = op.responses
  if (responses === null || typeof responses !== 'object') return null
  const table = responses as Record<string, unknown>
  const keys = Object.keys(table)
  const success = keys.filter((key) => /^2\d\d$/.test(key)).sort()
  const preferred = success[0] ?? (keys.includes('default') ? 'default' : undefined)
  if (preferred === undefined) return null
  return jsonSchemaOf(table[preferred], resolver)
}

/** 从 `{ content: { 'application/json': { schema } } }` 取 schema 并转成形状。 */
function jsonSchemaOf(container: unknown, resolver: RefResolver): ShapeNode | null {
  if (container === null || typeof container !== 'object') return null
  const record = container as Record<string, unknown>
  const direct = record.schema
  if (direct !== undefined && record.content === undefined) {
    return shapeFromJsonSchema(direct, resolver)
  }
  const content = record.content
  if (content === null || typeof content !== 'object') return null
  const media = content as Record<string, unknown>
  const jsonType = Object.keys(media).find((key) => key.includes('json')) ?? Object.keys(media)[0]
  if (jsonType === undefined) return null
  const entry = media[jsonType]
  if (entry === null || typeof entry !== 'object') return null
  return shapeFromJsonSchema((entry as Record<string, unknown>).schema, resolver)
}

/** 独立 JSON Schema 文件抽取器。 */
export const jsonSchemaExtractor = {
  id: 'json-schema',
  match: isStructured,
  extract(file: string, text: string): Candidate[] {
    const doc = parseStructured(file, text)
    if (!isJsonSchema(doc)) return []
    const shape = shapeFromJsonSchema(doc, localRefResolver(doc))
    if (shape === null) return []
    const record = doc as Record<string, unknown>
    const declared = typeof record.title === 'string' && record.title !== '' ? record.title : file
    const fields = shape.kind === 'object' ? Object.keys(shape.fields ?? {}).length : 0
    return [
      makeCandidate({
        file,
        boundary: `schema:${declared}`,
        boundaryKind: 'schema',
        source: 'json-schema',
        title: declared,
        symbol: declared,
        inputShape: null,
        outputShape: shape,
        evidence: structuredEvidence(doc),
        confidence: 0.9,
        note: `JSON Schema · ${fields} 个字段`,
      }),
    ]
  },
}
