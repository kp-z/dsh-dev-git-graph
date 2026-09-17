/**
 * 运行时合规判定：拿**实际载荷的形状**去对**声明的形状**。
 *
 * 为什么不复用 `diffShape`：那个函数比较的是两份**声明**，语义是"契约演化"，方向是对称的。
 * 而这里比较的是"声明 vs 一次真实观测"，判定是不对称的——
 * - 声明里可选的字段这次没出现，**完全正常**（不是"字段被删除"）；
 * - 实际多出声明外的字段，**是违规**（产出方在偷偷加东西，这正是要抓的）。
 * 把这两件事混进一个函数，就会一边漏报一边误报。
 *
 * 另一条刻意的克制：**只做结构判定，不落值**。枚举命中与否在内存里算完，只把"哪个字段的
 * 取值越界"写进结论，不把那个取值本身写进存储。
 */
import { shapeOf } from './shape.js'
import type { ShapeNode } from './types.js'

/** 判定选项。 */
export interface ConformOptions {
  /** 路径前缀，用于结论里定位。 */
  path?: string
  /** 收集到的违规结论（原地追加）。 */
  out?: string[]
  /** 递归深度上限。 */
  depth?: number
}

/** 单个值位置的对账深度上限，防止超深结构把判定拖垮。 */
const MAX_DEPTH = 10

/**
 * 对一个值做合规判定。
 *
 * 只关心"结构对不对"，不关心值本身——所以可以直接喂真实载荷，不必先脱敏。
 * @param declared - 声明的形状；null 表示这条契约没有声明，不做判定。
 * @param value - 实际值（任意 JSON）。
 * @param options - 路径与结论收集。
 * @returns 违规结论列表；空数组表示对得上。
 */
export function conforms(declared: ShapeNode | null, value: unknown, options: ConformOptions = {}): string[] {
  const out = options.out ?? []
  if (declared === null) return out
  // 观测侧**要**收集短字符串当枚举，否则"声明了枚举、实际传了别的值"就永远查不出来。
  // 代价是这个取值会在内存里过一下——但结论只写"越界 N 个"，取值本身不落存储。
  walk(declared, shapeOf(value, { enums: true }), options.path ?? '$', out, options.depth ?? 0)
  return out
}

/** 递归判定。`observed` 由实际值取出的形状。 */
function walk(declared: ShapeNode, observed: ShapeNode, path: string, out: string[], depth: number): void {
  if (depth > MAX_DEPTH) return
  if (declared.kind === 'unknown') return

  if (observed.kind === 'null') {
    if (declared.nullable !== true) out.push(`${path}：声明不接受 null，实际是 null`)
    return
  }

  if (declared.nullable === true && observed.nullable === true) {
    // 合并形状里出现过 null，可能是数组里有的元素是 null；不因此判违规。
  }

  if (declared.kind !== observed.kind) {
    out.push(`${path}：类型不符，声明 ${declared.kind}，实际 ${observed.kind}`)
    return
  }

  if (declared.kind === 'object') {
    const declaredFields = declared.fields ?? {}
    const observedFields = observed.fields ?? {}
    for (const key of Object.keys(declaredFields).sort()) {
      const child = declaredFields[key]
      if (child === undefined) continue
      const actual = observedFields[key]
      if (actual === undefined) {
        if (child.optional !== true) out.push(`${path}.${key}：缺少声明的必填字段`)
        continue
      }
      walk(child, actual, `${path}.${key}`, out, depth + 1)
    }
    for (const key of Object.keys(observedFields).sort()) {
      if (declaredFields[key] === undefined) out.push(`${path}.${key}：多出未声明的字段`)
    }
    return
  }

  if (declared.kind === 'array') {
    const element = declared.of
    if (element !== undefined && observed.of !== undefined) {
      walk(element, observed.of, `${path}[]`, out, depth + 1)
    }
    return
  }

  const allowed = declared.enumValues ?? []
  const actual = observed.enumValues ?? []
  if (allowed.length > 0 && actual.length > 0) {
    const off = actual.filter((item) => !allowed.includes(item))
    // 只说"有个取值越界"，不把取值写进结论——结论是要落存储的。
    if (off.length > 0) out.push(`${path}：取值不在声明的枚举范围内（越界 ${off.length} 个）`)
  }
}

/**
 * 脱敏 + 截断，得到一份可以落盘的载荷样本。
 *
 * 默认**不采集样本**（`capturePayloads` 关闭），所以这个函数只在显式打开时才被调用。
 * @param value - 原始载荷。
 * @param redactKeys - 需要打码的键名（不区分大小写，任意层级生效）。
 * @param maxBytes - 截断上限（字节，按 UTF-8 计）。
 * @returns 样本字符串；无法序列化时返回空串。
 */
export function sampleOf(value: unknown, redactKeys: string[], maxBytes: number): string {
  const redacted = redact(value, new Set(redactKeys.map((key) => key.toLowerCase())), 0)
  let text: string
  try {
    text = JSON.stringify(redacted) ?? ''
  } catch {
    return ''
  }
  if (Buffer.byteLength(text, 'utf8') <= maxBytes) return text
  // 按字符逐步截断到字节上限以内，并明确标注被截了。
  const suffix = '…（已截断）'
  const budget = Math.max(0, maxBytes - Buffer.byteLength(suffix, 'utf8'))
  let cut = text
  while (cut.length > 0 && Buffer.byteLength(cut, 'utf8') > budget) {
    cut = cut.slice(0, Math.floor(cut.length * 0.9))
  }
  return cut + suffix
}

/** 递归把敏感键的值替换成 `***`。 */
function redact(value: unknown, keys: Set<string>, depth: number): unknown {
  if (depth > 12) return '…'
  if (Array.isArray(value)) return value.map((item) => redact(item, keys, depth + 1))
  if (value === null || typeof value !== 'object') return value
  const out: Record<string, unknown> = {}
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    out[key] = keys.has(key.toLowerCase()) ? '***' : redact(item, keys, depth + 1)
  }
  return out
}

/** 载荷的字节数（截断前的真实大小）。 */
export function bytesOf(value: unknown): number {
  try {
    return Buffer.byteLength(JSON.stringify(value) ?? '', 'utf8')
  } catch {
    return 0
  }
}
