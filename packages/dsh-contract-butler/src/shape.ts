/**
 * 形状指纹与破坏性判定。
 *
 * 设计取舍：
 * - **指纹里不含值。** 形状只描述"哪些键、什么类型、能不能缺、能不能 null"。运行层观测因此
 *   天然不落敏感数据，同时照样能回答"数据与声明对不对得上"。
 * - **可缺省性来自多次观测的合并，而不是单次样本。** 单次样本里没出现的字段，只说明这次没有，
 *   不能说明它可选；只有和其它样本合并时"出现过又缺过"才判为可选。
 * - **枚举取值只从声明里来。** 观测到的自由文本不当枚举，否则一个 uuid 字段会攒出无穷取值。
 * - **破坏性判定是一张显式规则表**，不是启发式：逐条可测、可在 UI 上说明原因。
 */
import { createHash } from 'node:crypto'
import type { ShapeDiff, ShapeKind, ShapeNode } from './types.js'

/** 观测/解析时的深度上限，避免超深结构把指纹撑爆。 */
const MAX_DEPTH = 8
/** 每个对象的字段数上限。 */
const MAX_FIELDS = 200
/** 每层枚举取值的保留上限。 */
const MAX_ENUM = 50
/** 形状指纹的十六进制长度。 */
const HASH_LEN = 16

/** 取一个值的形状类别。 */
function kindOf(value: unknown): ShapeKind {
  if (value === null) return 'null'
  if (Array.isArray(value)) return 'array'
  switch (typeof value) {
    case 'string':
      return 'string'
    case 'number':
      return 'number'
    case 'boolean':
      return 'boolean'
    case 'object':
      return 'object'
    default:
      return 'unknown'
  }
}

/** `shapeOf` 的选项。 */
export interface ShapeOfOptions {
  /** 起始深度。 */
  depth?: number
  /** 是否收集短字符串字面量当枚举。仅声明侧开启，观测侧默认关闭。 */
  enums?: boolean
}

/**
 * 从一个真实 JSON 值取形状。
 * @param value - 任意 JSON 值（非 JSON 值一律记作 unknown，不抛错）。
 * @param options - 深度与枚举开关。
 * @returns 该值的形状节点。
 */
export function shapeOf(value: unknown, options: ShapeOfOptions = {}): ShapeNode {
  const depth = options.depth ?? 0
  const kind = kindOf(value)

  if (kind === 'array') {
    let element: ShapeNode | null = null
    for (const item of value as unknown[]) {
      element = mergeShape(element, shapeOf(item, { ...options, depth: depth + 1 }))
    }
    const node: ShapeNode = { kind: 'array' }
    if (element !== null) node.of = element
    return node
  }

  if (kind === 'object') {
    if (depth >= MAX_DEPTH) return { kind: 'unknown' }
    const source = value as Record<string, unknown>
    const fields: Record<string, ShapeNode> = {}
    let count = 0
    for (const key of Object.keys(source).sort()) {
      if (count >= MAX_FIELDS) break
      count += 1
      fields[key] = shapeOf(source[key], { ...options, depth: depth + 1 })
    }
    return { kind: 'object', fields }
  }

  if (kind === 'string' && options.enums === true) {
    const text = value as string
    if (text.length <= 32) return { kind: 'string', enumValues: [text] }
    return { kind: 'string' }
  }

  return { kind }
}

/**
 * 合并两个形状。同一位置的多次观测、同一实体的多份表示都走这里。
 *
 * 不一致的类型合并成 `unknown`（记作"说不准"而不是偏向任何一边）；`null` 与别的类型合并
 * 只把 `nullable` 打开；对象字段只在一侧出现则判为可缺省。
 * @param a - 左形状。
 * @param b - 右形状。
 * @returns 合并结果；两侧都为空时返回 null。
 */
export function mergeShape(a: ShapeNode | null, b: ShapeNode | null): ShapeNode | null {
  if (a === null) return b
  if (b === null) return a

  const nullable = a.nullable === true || b.nullable === true

  if (a.kind === 'null' && b.kind === 'null') return { kind: 'null', nullable: true }
  if (a.kind === 'null') return withNullable(b, true)
  if (b.kind === 'null') return withNullable(a, true)
  // 类型冲突塌成"说不准"。这里刻意不带 `nullable: false`：所有形状生产者都遵守"标记只在为
  // 真时出现"的约定，掺进假标记会让同一种结构在不同路径下算出不同的形状（哈希虽稳，比较会错）。
  if (a.kind !== b.kind) return nullable ? { kind: 'unknown', nullable: true } : { kind: 'unknown' }

  if (a.kind === 'object') {
    const left = a.fields ?? {}
    const right = b.fields ?? {}
    const fields: Record<string, ShapeNode> = {}
    for (const key of [...new Set([...Object.keys(left), ...Object.keys(right)])].sort()) {
      const l = left[key]
      const r = right[key]
      if (l !== undefined && r !== undefined) {
        const merged = mergeShape(l, r)
        if (merged !== null) fields[key] = merged
      } else if (l !== undefined) {
        fields[key] = withOptional(l, true)
      } else if (r !== undefined) {
        fields[key] = withOptional(r, true)
      }
    }
    const node: ShapeNode = { kind: 'object', fields }
    if (nullable) node.nullable = true
    return node
  }

  if (a.kind === 'array') {
    const node: ShapeNode = { kind: 'array' }
    const element = mergeShape(a.of ?? null, b.of ?? null)
    if (element !== null) node.of = element
    if (nullable) node.nullable = true
    return node
  }

  const values = [...new Set([...(a.enumValues ?? []), ...(b.enumValues ?? [])])].slice(0, MAX_ENUM)
  const node: ShapeNode = { kind: a.kind }
  if (values.length > 0) node.enumValues = values
  if (nullable) node.nullable = true
  return node
}

function withNullable(node: ShapeNode, nullable: boolean): ShapeNode {
  const out: ShapeNode = { ...node }
  if (nullable) out.nullable = true
  else delete out.nullable
  return out
}

/**
 * 打开/关闭可选标记。
 *
 * 只在为真时带上标记，且**抹掉为假时已有的标记位**——形状是拿来比较的，多一个
 * `optional: false` 就会让"同一个结构"在两条路径下长得不一样。
 */
function withOptional(node: ShapeNode, optional: boolean): ShapeNode {
  const out: ShapeNode = { ...node }
  if (optional) out.optional = true
  else delete out.optional
  return out
}

/**
 * 规范化形状：字段按 key 升序、去掉空值，保证"同样的结构"必然得到同样的字符串。
 * @param node - 待规范化的形状。
 * @returns 规范化后的新对象。
 */
export function canonicalize(node: ShapeNode): ShapeNode {
  const out: ShapeNode = { kind: node.kind }
  if (node.nullable === true) out.nullable = true
  if (node.optional === true) out.optional = true
  if (node.enumValues !== undefined && node.enumValues.length > 0) {
    out.enumValues = [...node.enumValues].sort()
  }
  if (node.kind === 'array' && node.of !== undefined) out.of = canonicalize(node.of)
  if (node.kind === 'object') {
    const fields: Record<string, ShapeNode> = {}
    for (const key of Object.keys(node.fields ?? {}).sort()) {
      const child = (node.fields ?? {})[key]
      if (child === undefined) continue
      fields[key] = canonicalize(child)
    }
    out.fields = fields
  }
  return out
}

/**
 * 稳定形状指纹。
 * @param node - 形状；null 表示"没有形状"。
 * @returns 十六进制指纹，null 得到空串。
 */
export function shapeHash(node: ShapeNode | null): string {
  if (node === null) return ''
  const text = JSON.stringify(canonicalize(node))
  return createHash('sha256').update(text).digest('hex').slice(0, HASH_LEN)
}

/** 内容哈希，用于无 git 项目与证据片段。 */
export function textHash(text: string): string {
  return createHash('sha256').update(text).digest('hex').slice(0, HASH_LEN)
}

/** 合法的形状类别集合，用于解析落盘形状时的校验。 */
const KINDS: ReadonlySet<string> = new Set<ShapeKind>([
  'string',
  'number',
  'boolean',
  'null',
  'array',
  'object',
  'unknown',
])

/**
 * 解析一份落盘（或来自外部）的形状，校验并规范化。
 *
 * 这是形状子树**唯一的把关点**：域 schema 里 `input`/`output` 是 `z.any()`（递归结构没法
 * 用 schemastery 表达），所以读出时走这里。认不出来就返回 null——调用方把"形状丢了"和
 * "形状为空"当同一件事处理，而不是让一条脏数据把整个项目读不出来。
 * @param value - 待解析的值。
 * @returns 规范化后的形状；不合法时返回 null。
 */
export function parseShape(value: unknown): ShapeNode | null {
  if (value === null || value === undefined) return null
  if (typeof value !== 'object' || Array.isArray(value)) return null
  const record = value as Record<string, unknown>
  const kind = record.kind
  if (typeof kind !== 'string' || !KINDS.has(kind)) return null

  const node: ShapeNode = { kind: kind as ShapeKind }
  if (record.nullable === true) node.nullable = true
  if (record.optional === true) node.optional = true
  if (Array.isArray(record.enumValues)) {
    const values = record.enumValues.filter((item): item is string => typeof item === 'string')
    if (values.length > 0) node.enumValues = values
  }
  if (kind === 'array') {
    const element = parseShape(record.of)
    if (element !== null) node.of = element
  }
  if (kind === 'object') {
    const fields: Record<string, ShapeNode> = {}
    const raw = record.fields
    if (raw !== null && typeof raw === 'object' && !Array.isArray(raw)) {
      const table = raw as Record<string, unknown>
      for (const key of Object.keys(table).sort()) {
        const child = parseShape(table[key])
        if (child !== null) fields[key] = child
      }
    }
    node.fields = fields
  }
  return node
}

/**
 * 比较两个形状，按显式规则表分出破坏性与非破坏性差异。
 *
 * 破坏：字段删除、类型改变、可选变必填、枚举取值被删、不再接受 null、形状消失（边界没了）。
 * 非破坏：新增可选字段、必填变可选、类型放宽为 unknown、新增枚举取值、开始接受 null。
 * 新增必填字段算破坏——老的产出方不会带这个字段。
 * @param before - 变化前的形状。
 * @param after - 变化后的形状。
 * @returns 破坏性差异与非破坏性差异。
 */
export function diffShape(
  before: ShapeNode | null,
  after: ShapeNode | null,
): { breaking: ShapeDiff[]; compatible: ShapeDiff[] } {
  const breaking: ShapeDiff[] = []
  const compatible: ShapeDiff[] = []

  if (before === null && after === null) return { breaking, compatible }
  if (before === null) {
    compatible.push({ path: '$', detail: '新增了一个契约' })
    return { breaking, compatible }
  }
  if (after === null) {
    breaking.push({ path: '$', detail: '契约消失了，这条边界不再声明数据结构' })
    return { breaking, compatible }
  }

  walk('$', before, after, breaking, compatible)
  return { breaking, compatible }
}

function walk(
  path: string,
  before: ShapeNode,
  after: ShapeNode,
  breaking: ShapeDiff[],
  compatible: ShapeDiff[],
): void {
  if (before.kind !== after.kind) {
    if (after.kind === 'unknown') {
      compatible.push({ path, detail: `类型放宽为说不准（${before.kind} 变 unknown）` })
    } else if (before.kind === 'unknown') {
      breaking.push({ path, detail: `原本说不准，现在收紧为 ${after.kind}` })
    } else {
      breaking.push({ path, detail: `类型改变：${before.kind} 变为 ${after.kind}` })
    }
    return
  }

  if (before.nullable === true && after.nullable !== true) {
    breaking.push({ path, detail: '不再接受 null' })
  } else if (before.nullable !== true && after.nullable === true) {
    compatible.push({ path, detail: '开始接受 null' })
  }

  if (before.kind === 'object') {
    const left = before.fields ?? {}
    const right = after.fields ?? {}
    for (const key of Object.keys(left).sort()) {
      const l = left[key]
      const r = right[key]
      if (l === undefined) continue
      if (r === undefined) {
        breaking.push({ path: `${path}.${key}`, detail: '字段被删除' })
        continue
      }
      walk(`${path}.${key}`, l, r, breaking, compatible)
    }
    for (const key of Object.keys(right).sort()) {
      const r = right[key]
      if (r === undefined || left[key] !== undefined) continue
      if (r.optional === true) {
        compatible.push({ path: `${path}.${key}`, detail: '新增可选字段' })
      } else {
        breaking.push({ path: `${path}.${key}`, detail: '新增必填字段，老的产出方不会带它' })
      }
    }
    return
  }

  if (before.kind === 'array') {
    const l = before.of ?? null
    const r = after.of ?? null
    if (l === null && r !== null) {
      compatible.push({ path: `${path}[]`, detail: '开始声明元素形状' })
    } else if (l !== null && r === null) {
      breaking.push({ path: `${path}[]`, detail: '不再声明元素形状' })
    } else if (l !== null && r !== null) {
      walk(`${path}[]`, l, r, breaking, compatible)
    }
    return
  }

  const leftValues = before.enumValues ?? []
  const rightValues = after.enumValues ?? []
  if (leftValues.length > 0) {
    for (const value of leftValues) {
      if (!rightValues.includes(value)) {
        breaking.push({ path, detail: `取值 ${value} 被删掉` })
      }
    }
  }
  for (const value of rightValues) {
    if (!leftValues.includes(value)) {
      compatible.push({ path, detail: `新增取值 ${value}` })
    }
  }
}
