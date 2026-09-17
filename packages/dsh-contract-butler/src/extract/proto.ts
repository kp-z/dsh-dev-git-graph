import type { BoundaryKind, Candidate, ShapeNode } from '../types.js'
import {
  evidenceAt,
  makeCandidate,
  type Extractor,
  type ExtractorContext,
} from './registry.js'

/** 深度上限，防止互相引用的 message 把递归撑爆。 */
const MAX_DEPTH = 12

/** 标量 proto 类型到形状的映射表，避免一长串 if 分支。 */
const SCALAR_STRING = new Set(['string', 'bytes'])
const SCALAR_NUMBER = new Set([
  'int32',
  'int64',
  'uint32',
  'uint64',
  'sint32',
  'sint64',
  'fixed32',
  'fixed64',
  'sfixed32',
  'sfixed64',
  'double',
  'float',
])
const SCALAR_BOOL = new Set(['bool'])

interface ProtoField {
  name: string
  /** 原始类型文本，如 `repeated string`、`map<string, Foo>` 已拆好。 */
  rawType: string
  repeated: boolean
  isMap: boolean
  mapValueType: string | null
  optional: boolean
  /** 显式写了 optional 关键字（proto2 用得多）。 */
  optionalKw: boolean
  /** 声明在 oneof 块内。 */
  oneof: boolean
  line: number
}

interface ProtoMessage {
  name: string
  fields: ProtoField[]
  line: number
}

interface ProtoEnum {
  name: string
  values: string[]
  line: number
}

interface ProtoRpc {
  service: string
  method: string
  input: string
  output: string
  line: number
}

interface ParsedFile {
  syntax: string
  pkg: string
  messages: ProtoMessage[]
  enums: ProtoEnum[]
  rpcs: ProtoRpc[]
}

/** 把注释替换成等长空白并保留换行，保证后面所有行号仍然准确。 */
function blankComments(text: string): string {
  let out = ''
  let i = 0
  const n = text.length
  while (i < n) {
    const ch = text[i]
    const next = i + 1 < n ? text[i + 1] : ''
    if (ch === '/' && next === '/') {
      while (i < n && text[i] !== '\n') {
        out += ' '
        i += 1
      }
      continue
    }
    if (ch === '/' && next === '*') {
      out += '  '
      i += 2
      while (i < n && !(text[i] === '*' && text[i + 1] === '/')) {
        // 换行必须原样保留，否则后面所有行号都会偏移。
        out += text[i] === '\n' ? '\n' : ' '
        i += 1
      }
      if (i < n) {
        out += '  '
        i += 2
      }
      continue
    }
    out += ch
    i += 1
  }
  return out
}

/** 找出从 open 位置配对的括号结束下标（含），找不到返回 -1。 */
function matchBracket(text: string, open: number, o: string, c: string): number {
  let depth = 0
  for (let i = open; i < text.length; i += 1) {
    const ch = text[i]
    if (ch === o) depth += 1
    else if (ch === c) {
      depth -= 1
      if (depth === 0) return i
    }
  }
  return -1
}

function lineOf(text: string, index: number): number {
  let line = 1
  for (let i = 0; i < index && i < text.length; i += 1) {
    if (text[i] === '\n') line += 1
  }
  return line
}

/** 按顶层逗号切分，用于 `map<K, V>` 里的类型参数。 */
function splitTopLevel(text: string): string[] {
  const parts: string[] = []
  let depth = 0
  let cur = ''
  for (const ch of text) {
    if (ch === '<' || ch === '(' || ch === '[') depth += 1
    else if (ch === '>' || ch === ')' || ch === ']') depth -= 1
    if (ch === ',' && depth === 0) {
      parts.push(cur)
      cur = ''
      continue
    }
    cur += ch
  }
  parts.push(cur)
  return parts
}

/**
 * 解析一条字段声明；不认识的写法返回 null 而不是抛错。
 * 同时返回该声明消耗到的下标，便于块内游标推进。
 */
function parseField(
  body: string,
  start: number,
  baseLine: number,
  inOneof: boolean,
): { field: ProtoField; end: number } | null {
  const semi = body.indexOf(';', start)
  const stmt = (semi === -1 ? body.slice(start) : body.slice(start, semi)).trim()
  const end = semi === -1 ? body.length : semi + 1
  if (stmt.length === 0) return null
  if (/^option\b/.test(stmt) || /^reserved\b/.test(stmt)) return null

  const tokens = stmt.replace(/\s+/g, ' ').split(' ')
  if (tokens.length < 2) return null

  // 去掉重复出现的关键字，剩下「类型 + 名字」。
  let idx = 0
  let repeated = false
  let optionalKw = false
  while (idx < tokens.length) {
    const t = tokens[idx]
    if (t === 'repeated') {
      repeated = true
      idx += 1
      continue
    }
    if (t === 'optional') {
      optionalKw = true
      idx += 1
      continue
    }
    if (t === 'required') {
      idx += 1
      continue
    }
    break
  }
  const rest = tokens.slice(idx).join(' ')
  const fieldMatch = /^(.+?)\s+([A-Za-z_][A-Za-z0-9_]*)\s*=/.exec(rest)
  if (!fieldMatch) return null
  const rawType = fieldMatch[1]
  const name = fieldMatch[2]
  if (rawType === undefined || name === undefined) return null

  let isMap = false
  let mapValueType: string | null = null
  if (/^map\s*</.test(rawType)) {
    const lt = rawType.indexOf('<')
    const gt = rawType.lastIndexOf('>')
    if (lt !== -1 && gt > lt) {
      const args = splitTopLevel(rawType.slice(lt + 1, gt))
      isMap = true
      mapValueType = (args[1] ?? 'string').trim()
    }
  }

  return {
    field: {
      name,
      rawType,
      repeated,
      isMap,
      mapValueType,
      // repeated/map 不作为「可选」处理，只有 optional 关键字与 oneof 内部字段算可选。
      optional: optionalKw,
      optionalKw,
      oneof: inOneof,
      line: baseLine,
    },
    end,
  }
}

/** 在块体里逐条抽字段，跳过 oneof 包装但保留其内部字段。 */
function collectFields(body: string, baseLine: number, inOneof: boolean): ProtoField[] {
  const fields: ProtoField[] = []
  let i = 0
  while (i < body.length) {
    const ch = body[i]
    if (ch !== undefined && /\s/.test(ch)) {
      i += 1
      continue
    }
    if (ch === ';') {
      i += 1
      continue
    }
    // 嵌套 message / enum 跳过，避免把内部字段算到当前 message。
    const nested = /^(message|enum)\s+[A-Za-z_][A-Za-z0-9_]*\s*\{/.exec(body.slice(i))
    if (nested) {
      const brace = body.indexOf('{', i)
      const close = brace === -1 ? -1 : matchBracket(body, brace, '{', '}')
      if (close === -1) return fields
      i = close + 1
      continue
    }
    const oneof = /^oneof\s+[A-Za-z_][A-Za-z0-9_]*\s*\{/.exec(body.slice(i))
    if (oneof) {
      const brace = body.indexOf('{', i)
      const close = brace === -1 ? -1 : matchBracket(body, brace, '{', '}')
      if (close === -1) return fields
      const inner = body.slice(brace + 1, close)
      const innerLine = lineOf(body, i) + baseLine - 1
      fields.push(...collectFields(inner, innerLine, true))
      i = close + 1
      continue
    }
    const parsed = parseField(body, i, lineOf(body, i) + baseLine - 1, inOneof)
    if (!parsed) {
      // 无法识别的语句直接跳到分号之后，绝不抛错。
      const semi = body.indexOf(';', i)
      if (semi === -1) return fields
      i = semi + 1
      continue
    }
    if (inOneof) parsed.field.optional = true
    fields.push(parsed.field)
    i = parsed.end
  }
  return fields
}

/** 单遍扫描，把所有顶层声明收集出来（嵌套 message 递归展开）。 */
function parseFile(text: string): ParsedFile {
  const result: ParsedFile = {
    syntax: 'proto2',
    pkg: '',
    messages: [],
    enums: [],
    rpcs: [],
  }
  const clean = blankComments(text)

  const syntaxMatch = /^\s*syntax\s*=\s*"([^"]+)"/m.exec(clean)
  if (syntaxMatch && syntaxMatch[1] !== undefined) result.syntax = syntaxMatch[1]
  const pkgMatch = /^\s*package\s+([A-Za-z_][A-Za-z0-9_.]*)\s*;/m.exec(clean)
  if (pkgMatch && pkgMatch[1] !== undefined) result.pkg = pkgMatch[1]

  const declRe = /\b(message|enum|service)\s+([A-Za-z_][A-Za-z0-9_]*)\s*\{/g
  let m = declRe.exec(clean)
  while (m !== null) {
    const kind = m[1]
    const name = m[2]
    const braceIdx = m.index + m[0].length - 1
    const close = matchBracket(clean, braceIdx, '{', '}')
    if (kind === undefined || name === undefined || close === -1) {
      m = declRe.exec(clean)
      continue
    }
    const body = clean.slice(braceIdx + 1, close)
    const baseLine = lineOf(clean, m.index)

    if (kind === 'message') {
      result.messages.push({
        name,
        fields: collectFields(body, baseLine, false),
        line: baseLine,
      })
    } else if (kind === 'enum') {
      const values: string[] = []
      // 按 `;` 切而不是按行切：`enum E { A = 0; B = 1; }` 写成一行是完全合法的 proto，
      // 而按行切只会认出第一个取值——那会让契约少报枚举范围，属于"静悄悄地少了一个约束"。
      for (const segment of body.split(';')) {
        const text = segment.trim()
        if (text.length === 0) continue
        if (text.startsWith('option') || text.startsWith('reserved')) continue
        const v = /(?:^|\s)([A-Za-z_][A-Za-z0-9_]*)\s*=/.exec(text)
        if (v && v[1] !== undefined) values.push(v[1])
      }
      result.enums.push({ name, values, line: baseLine })
    } else {
      for (const rpc of parseRpcs(body, name, baseLine)) result.rpcs.push(rpc)
    }
    // 嵌套声明由正则的全局扫描继续命中（正则不会跳过嵌套块内部）。
    m = declRe.exec(clean)
  }

  // proto3 的普通单数字段天然可以为缺省，统一标成可选；repeated/map/oneof 除外。
  if (/^proto3$/i.test(result.syntax)) {
    for (const msg of result.messages) {
      for (const f of msg.fields) {
        if (!f.repeated && !f.isMap && !f.optionalKw && !f.oneof) f.optional = true
      }
    }
  }
  return result
}

/** service 体里抽 rpc，允许跨行与 `stream` 前缀，允许尾随 `{}`。 */
function parseRpcs(body: string, service: string, baseLine: number): ProtoRpc[] {
  const out: ProtoRpc[] = []
  const re = /\brpc\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(([^)]*)\)\s*returns\s*\(([^)]*)\)/g
  let m = re.exec(body)
  while (m !== null) {
    const method = m[1]
    const input = normalizeTypeName(m[2] ?? '')
    const output = normalizeTypeName(m[3] ?? '')
    if (method !== undefined && input.length > 0 && output.length > 0) {
      out.push({
        service,
        method,
        input,
        output,
        line: lineOf(body, m.index) + baseLine - 1,
      })
    }
    m = re.exec(body)
  }
  return out
}

/** 去掉 `stream` 前缀与泛型空格，取类型名。 */
function normalizeTypeName(raw: string): string {
  let t = raw.replace(/\s+/g, ' ').trim()
  t = t.replace(/^stream\s+/i, '')
  return t.trim()
}

/** 取 `A.B.C` 的最后一段，供本地 message/enum 查表。 */
function lastName(type: string): string {
  const parts = type.split('.')
  const last = parts[parts.length - 1]
  return (last ?? type).trim()
}

export const protoExtractor: Extractor = {
  id: 'proto',
  match(file: string): boolean {
    return /\.proto$/i.test(file)
  },
  extract(file: string, text: string, ctx: ExtractorContext): Candidate[] {
    try {
      const parsed = parseFile(text)
      const pkgPrefix = parsed.pkg.length > 0 ? `${parsed.pkg}.` : ''
      const messageByName = new Map<string, ProtoMessage>()
      for (const msg of parsed.messages) messageByName.set(msg.name, msg)
      const enumByName = new Map<string, ProtoEnum>()
      for (const en of parsed.enums) enumByName.set(en.name, en)

      const messages: Candidate[] = []
      for (const msg of parsed.messages) {
        const shape = messageShape(msg, messageByName, enumByName, new Set(), 0)
        messages.push(
          makeCandidate({
            file,
            boundary: `proto:${pkgPrefix}${msg.name}`,
            boundaryKind: 'proto' as BoundaryKind,
            source: 'proto',
            title: msg.name,
            symbol: msg.name,
            inputShape: null,
            outputShape: shape,
            evidence: evidenceAt(text, msg.line),
            confidence: 0.85,
            note: `${parsed.syntax} · message ${msg.name}（${msg.fields.length} 个字段）`,
          }),
        )
      }

      const enums: Candidate[] = []
      for (const en of parsed.enums) {
        enums.push(
          makeCandidate({
            file,
            boundary: `proto:${pkgPrefix}${en.name}`,
            boundaryKind: 'proto' as BoundaryKind,
            source: 'proto',
            title: en.name,
            symbol: en.name,
            inputShape: null,
            outputShape: { kind: 'string', enumValues: [...en.values] },
            evidence: evidenceAt(text, en.line),
            confidence: 0.9,
            note: `${parsed.syntax} · enum ${en.name}（${en.values.length} 个取值）`,
          }),
        )
      }

      const rpcs: Candidate[] = []
      for (const rpc of parsed.rpcs) {
        const symbol = `${rpc.service}.${rpc.method}`
        rpcs.push(
          makeCandidate({
            file,
            boundary: `rpc:${pkgPrefix}${symbol}`,
            boundaryKind: 'proto' as BoundaryKind,
            source: 'proto',
            title: symbol,
            symbol,
            inputShape: typeShape(rpc.input, messageByName, enumByName, new Set(), 0),
            outputShape: typeShape(rpc.output, messageByName, enumByName, new Set(), 0),
            evidence: evidenceAt(text, rpc.line),
            confidence: 0.85,
            note: `${parsed.syntax} · rpc ${symbol}`,
          }),
        )
      }

      return [...messages, ...enums, ...rpcs]
    } catch {
      // 解析器宁可静默失败，也不许把异常抛给上层扫描流程。
      return []
    }
  },
}

/** message 形状；visiting 阻断互相引用的无限递归。 */
function messageShape(
  msg: ProtoMessage,
  messages: Map<string, ProtoMessage>,
  enums: Map<string, ProtoEnum>,
  visiting: Set<string>,
  depth: number,
): ShapeNode {
  if (depth > MAX_DEPTH || visiting.has(msg.name)) return { kind: 'unknown' }
  const next = new Set(visiting)
  next.add(msg.name)
  const fields: Record<string, ShapeNode> = {}
  for (const f of msg.fields) {
    let node: ShapeNode
    const raw = f.rawType.trim()
    if (f.isMap) {
      node = { kind: 'object' }
    } else {
      const inner = typeShape(raw, messages, enums, next, depth + 1)
      node = f.repeated ? { kind: 'array', of: inner } : inner
    }
    if (f.optional) node = { ...node, optional: true }
    fields[f.name] = node
  }
  return { kind: 'object', fields }
}

/** 把类型文本映射成形状；未知标识符退回 unknown。 */
function typeShape(
  rawType: string,
  messages: Map<string, ProtoMessage>,
  enums: Map<string, ProtoEnum>,
  visiting: Set<string>,
  depth: number,
): ShapeNode {
  const t = rawType.trim()
  if (t.length === 0) return { kind: 'unknown' }
  if (SCALAR_STRING.has(t)) return { kind: 'string' }
  if (SCALAR_NUMBER.has(t)) return { kind: 'number' }
  if (SCALAR_BOOL.has(t)) return { kind: 'boolean' }
  if (/^map\s*</.test(t)) return { kind: 'object' }
  const short = lastName(t)
  const en = enums.get(short)
  if (en) return { kind: 'string', enumValues: [...en.values] }
  const msg = messages.get(short)
  if (msg) return messageShape(msg, messages, enums, visiting, depth + 1)
  return { kind: 'unknown' }
}
