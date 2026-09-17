import type { BoundaryKind, Candidate, ShapeNode } from '../types.js'
import {
  evidenceAt,
  makeCandidate,
  type Extractor,
  type ExtractorContext,
} from './registry.js'

/** 递归深度上限，内联对象套内联对象时不至于撑爆。 */
const MAX_DEPTH = 10

/** 顶层 export 允许的最大缩进，避免把函数体里的局部声明也算进来。 */
const TOP_LEVEL_INDENT = 2

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

/** 去掉字符串字面量与注释，防止括号/冒号出现在字符串里带偏配对。 */
function sanitize(text: string): string {
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
        out += text[i] === '\n' ? '\n' : ' '
        i += 1
      }
      if (i < n) {
        out += '  '
        i += 2
      }
      continue
    }
    if (ch === '"' || ch === "'" || ch === '`') {
      const quote = ch
      out += quote
      i += 1
      while (i < n && text[i] !== quote) {
        const sc = text[i]
        if (sc === undefined) break
        if (sc === '\\') {
          // 转义序列整体原样保留，否则 `\'` 会被当成字符串结束。
          out += sc
          i += 1
          const esc = text[i]
          if (esc !== undefined) out += esc === '\n' ? '\n' : esc
          i += 1
          continue
        }
        // 字面量内容必须保留（枚举值、DSL 类型、工具名都靠它），
        // 但花括号与斜杠一旦留在串里会带偏括号配对和注释扫描，故只屏蔽这三类字符。
        out += sc === '{' || sc === '}' || sc === '/' || sc === '\n' ? (sc === '\n' ? '\n' : ' ') : sc
        i += 1
      }
      if (i < n) {
        out += quote
        i += 1
      }
      continue
    }
    out += ch
    i += 1
  }
  return out
}

/** 按顶层逗号切分泛型参数，如 `Record<string, number>`。 */
function splitTopLevel(text: string): string[] {
  const parts: string[] = []
  let depth = 0
  let cur = ''
  for (const ch of text) {
    if (ch === '<' || ch === '(' || ch === '[' || ch === '{') depth += 1
    else if (ch === '>' || ch === ')' || ch === ']' || ch === '}') depth -= 1
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

/** 提取 `'a' | 'b'` 里的字面量，混合非字面量时返回空数组。 */
function literalUnion(type: string): { literals: string[]; hasNull: boolean; hasUndefined: boolean } {
  const parts = type
    .split('|')
    .map((p) => p.trim())
    .filter((p) => p.length > 0)
  const literals: string[] = []
  let hasNull = false
  let hasUndefined = false
  for (const p of parts) {
    if (p === 'null') {
      hasNull = true
      continue
    }
    if (p === 'undefined') {
      hasUndefined = true
      continue
    }
    const lit = /^'([^']*)'$/.exec(p) ?? /^"([^"]*)"$/.exec(p)
    if (lit && lit[1] !== undefined) {
      literals.push(lit[1])
      continue
    }
    return { literals: [], hasNull, hasUndefined }
  }
  return { literals, hasNull, hasUndefined }
}

/** TS 类型文本 -> 形状。识别不了的统一 unknown，不猜。 */
function tsTypeToShape(
  rawType: string,
  text: string,
  braceIdx: number,
  depth: number,
): ShapeNode {
  const t = rawType.trim()
  if (t.length === 0) return { kind: 'unknown' }
  if (depth > MAX_DEPTH) return { kind: 'unknown' }

  const union = literalUnion(t)
  let node: ShapeNode | null = null
  if (union.literals.length > 0) {
    node = { kind: 'string', enumValues: union.literals }
  }
  if (!node) {
    // 标量必须先判掉，否则会掉进下面的联合分支自我递归到深度上限。
    node = isPrimitive(t)
  }

  if (!node) {
    const arrayMatch = /^Array\s*</.exec(t)
    if (arrayMatch) {
      const lt = t.indexOf('<')
      const gt = t.lastIndexOf('>')
      const inner = gt > lt ? t.slice(lt + 1, gt) : ''
      node = { kind: 'array', of: tsTypeToShape(inner, text, braceIdx, depth + 1) }
    } else if (/^Record\s*</.test(t)) {
      node = { kind: 'object' }
    } else if (/\[\s*\]\s*$/.test(t)) {
      node = { kind: 'array', of: tsTypeToShape(t.replace(/\[\s*\]\s*$/, ''), text, braceIdx, depth + 1) }
    } else if (t.startsWith('{')) {
      const close = matchBracket(t, 0, '{', '}')
      const body = close === -1 ? t.slice(1) : t.slice(1, close)
      node = objectShape(body, text, braceIdx + 1, depth + 1)
    } else {
      const parts = t
        .split('|')
        .map((p) => p.trim())
        .filter((p) => p.length > 0)
      const concrete = parts.filter((p) => p !== 'null' && p !== 'undefined')
      if (concrete.length === 1) {
        node = tsTypeToShape(concrete[0] ?? '', text, braceIdx, depth + 1)
      } else if (concrete.length === 0) {
        node = { kind: 'unknown' }
      } else {
        node = { kind: 'unknown' }
      }
    }
  }

  const parts = t.split('|').map((p) => p.trim())
  const result: ShapeNode = { ...node }
  if (parts.includes('null')) result.nullable = true
  return result
}

function isPrimitive(t: string): ShapeNode | null {
  switch (t) {
    case 'string':
      return { kind: 'string' }
    case 'number':
      return { kind: 'number' }
    case 'boolean':
      return { kind: 'boolean' }
    case 'null':
      return { kind: 'null' }
    case 'unknown':
    case 'any':
    case 'never':
      return { kind: 'unknown' }
    default:
      return null
  }
}

/** 解析 `{ a: string; b?: number }` 形式的字段表。 */
function objectShape(
  body: string,
  text: string,
  baseIdx: number,
  depth: number,
): ShapeNode {
  const fields: Record<string, ShapeNode> = {}
  if (depth > MAX_DEPTH) return { kind: 'object', fields }
  let i = 0
  while (i < body.length) {
    const ch = body[i]
    if (ch === undefined || /\s/.test(ch) || ch === ';' || ch === ',') {
      i += 1
      continue
    }
    if (ch === '/' || ch === '{' || ch === '}') {
      i += 1
      continue
    }
    const rest = body.slice(i)
    const m = /^(?:readonly\s+)?(?:\[[^\]]*\]\s*:)?([A-Za-z_$][A-Za-z0-9_$]*)\s*(\??)\s*:/.exec(rest)
    if (!m) {
      i += 1
      continue
    }
    const name = m[1]
    const opt = m[2] === '?'
    if (name === undefined) {
      i += m[0].length
      continue
    }
    const colonAt = i + m[0].length - 1
    // 取到该字段类型结束：顶层 , 或 ; 或换行处的收尾。
    let j = colonAt + 1
    let d = 0
    while (j < body.length) {
      const cj = body[j]
      if (cj === '{' || cj === '(' || cj === '<' || cj === '[') d += 1
      else if (cj === '}' || cj === ')' || cj === '>' || cj === ']') {
        if (d === 0) break
        d -= 1
      } else if (d === 0 && (cj === ',' || cj === ';')) break
      else if (d === 0 && cj === '\n') break
      j += 1
    }
    const typeText = body.slice(colonAt + 1, j)
    const shape = tsTypeToShape(typeText, text, baseIdx + colonAt + 1, depth + 1)
    const withOpt: ShapeNode = opt ? { ...shape, optional: true } : shape
    if (typeText.includes('undefined')) withOpt.optional = true
    fields[name] = withOpt
    i = j
  }
  return { kind: 'object', fields }
}

/** 收集顶层导出的 interface / type 声明。 */
function collectTypeDecls(text: string): Candidateish[] {
  const out: Candidateish[] = []
  const re = /^([ \t]*)(export\s+)?(?:declare\s+)?(interface|type)\s+([A-Za-z_$][A-Za-z0-9_$]*)[^\n]*/gm
  let m = re.exec(text)
  while (m !== null) {
    const indent = (m[1] ?? '').replace(/\t/g, '  ').length
    const isExport = (m[2] ?? '').length > 0
    const kind = m[3]
    const name = m[4]
    if (!isExport || name === undefined || indent > TOP_LEVEL_INDENT) {
      m = re.exec(text)
      continue
    }
    const lineStart = m.index + (m[1]?.length ?? 0)
    const line = lineOf(text, lineStart)

    if (kind === 'interface') {
      const braceIdx = text.indexOf('{', m.index)
      if (braceIdx === -1 || braceIdx > m.index + m[0].length + 400) {
        m = re.exec(text)
        continue
      }
      // extends 部分忽略，直接从花括号体取字段。
      const close = matchBracket(text, braceIdx, '{', '}')
      if (close === -1) {
        m = re.exec(text)
        continue
      }
      const body = text.slice(braceIdx + 1, close)
      out.push({
        name,
        line,
        kind: 'interface',
        shape: objectShape(body, text, braceIdx + 1, 0),
      })
    } else {
      const eq = text.indexOf('=', m.index)
      if (eq === -1 || eq - m.index > 600) {
        m = re.exec(text)
        continue
      }
      let start = eq + 1
      while (start < text.length && /\s/.test(text[start] ?? '')) start += 1
      let shape: ShapeNode
      if (text[start] === '{') {
        const close = matchBracket(text, start, '{', '}')
        if (close === -1) {
          m = re.exec(text)
          continue
        }
        shape = objectShape(text.slice(start + 1, close), text, start + 1, 0)
      } else {
        // 非对象别名：取到行尾当类型文本。
        let end = start
        while (end < text.length && text[end] !== '\n' && text[end] !== ';') end += 1
        shape = tsTypeToShape(text.slice(start, end), text, start, 0)
      }
      out.push({ name, line, kind: 'type', shape })
    }
    m = re.exec(text)
  }
  return out
}

interface Candidateish {
  name: string
  line: number
  kind: 'interface' | 'type'
  shape: ShapeNode
}

/** 只在块的最外层（深度 0）找 `key:` 的位置，嵌套对象里的同名键不算。 */
function topLevelKeyIndex(block: string, key: string): number {
  let depth = 0
  let i = 0
  while (i < block.length) {
    const ch = block[i]
    if (ch === undefined) break
    if (ch === '{' || ch === '(' || ch === '[') {
      depth += 1
      i += 1
      continue
    }
    if (ch === '}' || ch === ')' || ch === ']') {
      depth -= 1
      i += 1
      continue
    }
    if (depth === 0) {
      const m = /^([A-Za-z_$][A-Za-z0-9_$]*)\s*:/.exec(block.slice(i))
      if (m) {
        if (m[1] === key) return i
        i += m[0].length
        continue
      }
    }
    i += 1
  }
  return -1
}

/** 单个字段描述块 -> 形状：有 properties 就是嵌套对象，否则看 type。 */
function descriptorShape(body: string, text: string, baseIdx: number): ShapeNode {
  if (topLevelKeyIndex(body, 'properties') !== -1) {
    return parametersShape(body, text, baseIdx)
  }
  const typeMatch = /\btype\s*:\s*['"]([^'"]+)['"]/.exec(body)
  return dslTypeToShape(typeMatch?.[1] ?? '')
}

/** `key: { ... }` 形式的一层字段；跳过嵌套深度内的键，避免把子对象字段平铺上来。 */
function dslFields(block: string, text: string, baseIdx: number): Record<string, ShapeNode> {
  const fields: Record<string, ShapeNode> = {}
  const re = /([A-Za-z_$][A-Za-z0-9_$]*)\s*:\s*\{/g
  let m = re.exec(block)
  while (m !== null) {
    const key = m[1]
    const braceIdx = m.index + m[0].length - 1
    const close = matchBracket(block, braceIdx, '{', '}')
    if (key === undefined || close === -1) break
    // 游标直接跳过整个块，否则子对象里的键会被当成同级字段。
    re.lastIndex = close + 1
    if (key === 'properties' || key === 'schema') {
      m = re.exec(block)
      continue
    }
    const body = block.slice(braceIdx + 1, close)
    const node = descriptorShape(body, text, baseIdx + braceIdx + 1)
    const required = /\brequired\s*:\s*true\b/.test(body)
    fields[key] = required ? node : { ...node, optional: true }
    m = re.exec(block)
  }
  return fields
}

/** defineTool 里 parameters DSL / JSON Schema 两种写法的字段解析。 */
function parametersShape(block: string, text: string, baseIdx: number): ShapeNode {
  const trimmed = block.trim()
  const propsIdx = topLevelKeyIndex(trimmed, 'properties')
  if (propsIdx !== -1) {
    const braceIdx = trimmed.indexOf('{', propsIdx)
    const close = braceIdx === -1 ? -1 : matchBracket(trimmed, braceIdx, '{', '}')
    if (braceIdx !== -1 && close !== -1) {
      const inner = dslFields(trimmed.slice(braceIdx + 1, close), text, baseIdx + braceIdx + 1)
      const required: string[] = []
      const reqIdx = topLevelKeyIndex(trimmed, 'required')
      if (reqIdx !== -1) {
        const rb = trimmed.indexOf('[', reqIdx)
        const rc = rb === -1 ? -1 : matchBracket(trimmed, rb, '[', ']')
        if (rc !== -1) {
          const listBody = trimmed.slice(rb + 1, rc)
          const re = /['"]([^'"]+)['"]/g
          let rm = re.exec(listBody)
          while (rm !== null) {
            if (rm[1] !== undefined) required.push(rm[1])
            rm = re.exec(listBody)
          }
        }
      }
      const fields: Record<string, ShapeNode> = {}
      for (const [key, value] of Object.entries(inner)) {
        const node: ShapeNode = { ...value }
        // JSON Schema 的 required 数组才是权威，覆盖字段块里的默认 optional。
        if (required.includes(key)) delete node.optional
        else node.optional = true
        fields[key] = node
      }
      return { kind: 'object', fields }
    }
  }
  // DSH DSL：{ path: { type: 'string', required: true }, limit: { type: 'number' } }
  return { kind: 'object', fields: dslFields(trimmed, text, baseIdx) }
}

function dslTypeToShape(rawType: string): ShapeNode {
  switch (rawType) {
    case 'string':
      return { kind: 'string' }
    case 'number':
    case 'integer':
      return { kind: 'number' }
    case 'boolean':
      return { kind: 'boolean' }
    case 'null':
      return { kind: 'null' }
    case 'array':
      return { kind: 'array' }
    case 'object':
      return { kind: 'object' }
    default:
      return { kind: 'unknown' }
  }
}

/** 从 defineTool( 的实参区间抽 name / parameters / output.schema。 */
function extractDefineTools(file: string, text: string, clean: string): Candidate[] {
  const out: Candidate[] = []
  const callRe = /\bdefineTool\s*\(/g
  let m = callRe.exec(clean)
  while (m !== null) {
    const openParen = m.index + m[0].length - 1
    const closeParen = matchBracket(clean, openParen, '(', ')')
    if (closeParen === -1) break
    const body = clean.slice(openParen + 1, closeParen)
    const bodyBase = openParen + 1

    const nameMatch = /\bname\s*:\s*['"]([^'"]+)['"]/.exec(body)
    const toolName = nameMatch?.[1]
    if (toolName === undefined || toolName.length === 0) {
      // 拿不到工具名就没有稳定的 boundary，直接跳过这条。
      m = callRe.exec(clean)
      continue
    }

    let inputShape: ShapeNode | null = null
    const paramMatch = /\bparameters\s*:/.exec(body)
    if (paramMatch) {
      const braceIdx = body.indexOf('{', paramMatch.index)
      if (braceIdx !== -1) {
        const close = matchBracket(body, braceIdx, '{', '}')
        if (close !== -1) {
          inputShape = parametersShape(
            body.slice(braceIdx + 1, close),
            text,
            bodyBase + braceIdx + 1,
          )
        }
      }
    }

    let outputShape: ShapeNode | null = null
    const schemaMatch = /\bschema\s*:/.exec(body)
    if (schemaMatch) {
      const braceIdx = body.indexOf('{', schemaMatch.index)
      if (braceIdx !== -1) {
        const close = matchBracket(body, braceIdx, '{', '}')
        if (close !== -1) {
          outputShape = parametersShape(
            body.slice(braceIdx + 1, close),
            text,
            bodyBase + braceIdx + 1,
          )
        }
      }
    }

    out.push(
      makeCandidate({
        file,
        boundary: `tool:${toolName}`,
        boundaryKind: 'tool' as BoundaryKind,
        source: 'ts-pattern',
        title: toolName,
        symbol: toolName,
        inputShape,
        outputShape,
        evidence: evidenceAt(text, lineOf(clean, m.index)),
        confidence: 0.8,
        note: '模式匹配 · defineTool 调用',
      }),
    )
    m = callRe.exec(clean)
  }
  return out
}

export const tsPatternExtractor: Extractor = {
  id: 'ts-pattern',
  match(file: string): boolean {
    return /\.(ts|tsx|mts|cts|js|jsx|mjs|cjs)$/i.test(file) && !/\.d\.ts$/i.test(file)
  },
  extract(file: string, text: string, ctx: ExtractorContext): Candidate[] {
    try {
      const clean = sanitize(text)
      const candidates: Candidate[] = []

      for (const decl of collectTypeDecls(clean)) {
        candidates.push(
          makeCandidate({
            file,
            boundary: `type:${decl.name}`,
            boundaryKind: 'schema' as BoundaryKind,
            source: 'ts-pattern',
            title: decl.name,
            symbol: decl.name,
            inputShape: null,
            outputShape: decl.shape,
            evidence: evidenceAt(text, decl.line),
            confidence: 0.7,
            note:
              decl.kind === 'interface'
                ? '模式匹配 · export interface'
                : '模式匹配 · export type',
          }),
        )
      }

      candidates.push(...extractDefineTools(file, text, clean))
      return candidates
    } catch {
      // 模式匹配是启发式的，任何异常都不该打断整轮扫描。
      return []
    }
  },
}
