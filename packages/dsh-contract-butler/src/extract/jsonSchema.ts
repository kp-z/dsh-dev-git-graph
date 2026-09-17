/**
 * JSON Schema → 形状。
 *
 * 一个转换器同时服务三种来源：独立 JSON Schema 文件、OpenAPI 的 components、以及 DSH
 * 工具注册表里的参数 DSL（它是 JSON-Schema 风格，只是把 `required` 写在每个属性上而不是
 * 父级的数组里）。三种都走这里，形状语义就只有一个出处。
 */
import { mergeShape } from '../shape.js'
import type { ShapeNode } from '../types.js'

/** `$ref` 解析器。自己解析不到时返回 null，绝不抛错。 */
export interface RefResolver {
  resolve(ref: string): unknown
}

/** 深度上限，防止互相引用的 schema 把转换撑爆。 */
const MAX_DEPTH = 12

/**
 * 把 JSON Schema（或其方言）转成形状节点。
 *
 * 支持的写法：`type`（含数组形式如 `['string','null']`）、`properties`、父级 `required`
 * 数组、属性上的内联 `required: true`、`items`、`enum`、`$ref`、`oneOf`/`anyOf`/`allOf`
 * （合并成一个形状）。
 * @param schema - schema 片段。
 * @param resolver - `$ref` 解析器；不给则引用位置记作 unknown。
 * @param depth - 当前深度（内部用）。
 * @returns 形状；完全无法理解时返回 null。
 */
export function shapeFromJsonSchema(
  schema: unknown,
  resolver?: RefResolver,
  depth = 0,
): ShapeNode | null {
  if (schema === null || schema === undefined || typeof schema !== 'object') return null
  if (depth > MAX_DEPTH) return { kind: 'unknown' }

  const node = schema as Record<string, unknown>

  if (typeof node.$ref === 'string') {
    const target = resolver?.resolve(node.$ref)
    if (target === null || target === undefined) return { kind: 'unknown' }
    return shapeFromJsonSchema(target, resolver, depth + 1)
  }

  for (const key of ['oneOf', 'anyOf', 'allOf'] as const) {
    const list = node[key]
    if (!Array.isArray(list) || list.length === 0) continue
    let merged: ShapeNode | null = null
    for (const item of list) merged = mergeShape(merged, shapeFromJsonSchema(item, resolver, depth + 1))
    if (merged !== null) return merged
  }

  if (Array.isArray(node.enum)) {
    const values = node.enum.filter((value): value is string => typeof value === 'string')
    if (values.length > 0) return { kind: 'string', enumValues: values }
  }

  const declared = node.type
  let kind: string | undefined
  let nullable = false
  if (typeof declared === 'string') {
    kind = declared
  } else if (Array.isArray(declared)) {
    const types = declared.filter((value): value is string => typeof value === 'string')
    nullable = types.includes('null')
    kind = types.find((value) => value !== 'null')
  }

  if (kind === undefined) {
    if (node.properties !== undefined || node.additionalProperties !== undefined) kind = 'object'
    else if (node.items !== undefined) kind = 'array'
    else return { kind: 'unknown' }
  }

  if (kind === 'object') {
    const properties = (node.properties ?? {}) as Record<string, unknown>
    const requiredList = Array.isArray(node.required)
      ? node.required.filter((value): value is string => typeof value === 'string')
      : []
    const fields: Record<string, ShapeNode> = {}
    for (const key of Object.keys(properties).sort()) {
      const child = shapeFromJsonSchema(properties[key], resolver, depth + 1)
      if (child === null) continue
      const inlineRequired = (properties[key] as Record<string, unknown> | null)?.required
      const isRequired =
        requiredList.length > 0
          ? requiredList.includes(key)
          : inlineRequired === true
      fields[key] = isRequired ? child : { ...child, optional: true }
    }
    const result: ShapeNode = { kind: 'object', fields }
    if (nullable) result.nullable = true
    return result
  }

  if (kind === 'array') {
    const element = shapeFromJsonSchema(node.items, resolver, depth + 1)
    const result: ShapeNode = { kind: 'array' }
    if (element !== null) result.of = element
    if (nullable) result.nullable = true
    return result
  }

  if (kind === 'integer') {
    const result: ShapeNode = { kind: 'number' }
    if (nullable) result.nullable = true
    return result
  }

  if (kind === 'string' || kind === 'number' || kind === 'boolean' || kind === 'null') {
    const result: ShapeNode = { kind }
    if (nullable) result.nullable = true
    return result
  }

  return { kind: 'unknown' }
}

/**
 * 建一个 `$ref` 解析器。
 * @param documents - `#/...` 形式的文档内引用所针对的根文档。
 * @returns 解析器；解析不到时返回 null。
 */
export function localRefResolver(document: unknown): RefResolver {
  return {
    resolve(ref: string): unknown {
      if (!ref.startsWith('#')) return null
      const segments = ref
        .slice(1)
        .split('/')
        .filter((segment) => segment !== '')
        .map((segment) => segment.replace(/~1/g, '/').replace(/~0/g, '~'))
      let current: unknown = document
      for (const segment of segments) {
        if (current === null || typeof current !== 'object') return null
        current = (current as Record<string, unknown>)[segment]
        if (current === undefined) return null
      }
      return current
    },
  }
}
