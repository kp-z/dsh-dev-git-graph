import { parse, MermaidParseError } from '@mermaid-js/parser'
import { HEURISTIC_TYPES, STRICT_VALIDATED_TYPES, type DiagramType } from './config.ts'

/** 校验结果。 */
export interface ValidationResult {
  ok: boolean
  errors: string[]
  mode: 'strict' | 'heuristic' | 'unknown'
  warnings: string[]
}

/** 归一化图类型：去空格、去大小写敏感的前缀别名。 */
export function normalizeDiagramType(type: string): string {
  const t = type.trim()
  const lower = t.toLowerCase()
  // 常见别名归一化
  const aliases: Record<string, string> = {
    'sequence': 'sequenceDiagram',
    'seq': 'sequenceDiagram',
    'class': 'classDiagram',
    'state': 'stateDiagram-v2',
    'statediagram': 'stateDiagram-v2',
    'flow': 'flowchart',
    'graph': 'flowchart',
    'er': 'erDiagram',
    'gantt': 'gantt',
    'git': 'gitGraph',
    'gitgraph': 'gitGraph',
    'pie': 'pie',
    'journey': 'journey',
    'timeline': 'timeline',
  }
  return aliases[lower] ?? lower
}

/** 用 @mermaid-js/parser 严格校验（新类型，node 端可靠）。 */
export async function validateStrict(type: string, code: string): Promise<ValidationResult> {
  try {
    await parse(type as never, code)
    return { ok: true, errors: [], mode: 'strict', warnings: [] }
  } catch (e) {
    const message = e instanceof MermaidParseError
      ? e.message
      : e instanceof Error ? e.message : String(e)
    return {
      ok: false,
      errors: [message],
      mode: 'strict',
      warnings: [],
    }
  }
}

/** 基础启发式预检（旧类型，无法 100% 保证语法）。 */
export function validateHeuristic(type: string, code: string): ValidationResult {
  const errors: string[] = []
  const warnings: string[] = []
  const lines = code.split('\n')

  // 1. 空图
  const body = lines.filter((l) => l.trim() !== '' && !l.trim().startsWith('%%'))
  if (body.length === 0) {
    return { ok: false, errors: ['图内容为空'], mode: 'heuristic', warnings }
  }

  // 2. 首行必须是类型声明（flowchart/sequenceDiagram/...）
  const firstLine = lines.find((l) => l.trim() !== '')
  if (firstLine) {
    const firstToken = firstLine.trim().split(/\s+/)[0]?.toLowerCase()
    const expected = normalizeDiagramType(type)
    const normalizedFirst = normalizeDiagramType(firstToken ?? '')
    // 允许 flowchart TD / flowchart LR / graph TD / sequenceDiagram / classDiagram 等
    if (normalizedFirst !== expected) {
      errors.push(`首行应声明图类型（${expected}），实际是 "${firstToken}"`)
    }
  }

  // 3. flowchart 常见错误：箭头后缺目标 / 箭头后非法字符
  if (type === 'flowchart' || type === 'flow') {
    for (const [i, line] of lines.entries()) {
      if (line.trim().startsWith('%%')) continue
      const t = line.trim()
      // 跳过纯声明/样式行
      if (/^(flowchart|graph|subgraph|end|style|classDef|linkStyle|click)/i.test(t)) continue
      // 箭头后必须有节点（字母/数字/_/括号/引号）；允许 |...| 边标签后再跟节点
      const arrowMatch = /(-->|--x|--o|---|==>|==)/.exec(t)
      if (arrowMatch) {
        let after = t.slice(arrowMatch.index + arrowMatch[0].length)
        // 跳过 |...| 边标签
        const labelMatch = /^\s*\|[^|]*\|/.exec(after)
        if (labelMatch) after = after.slice(labelMatch[0].length)
        if (after.trim() === '' || /^[^\w"'([]/.test(after.trim())) {
          errors.push(`第 ${i + 1} 行：箭头 "${arrowMatch[0]}" 后缺有效目标（"${t.slice(0, 40)}"）`)
        }
      } else if (/\?/.test(t)) {
        errors.push(`第 ${i + 1} 行：含非法字符 "?"（"${t.slice(0, 40)}"）`)
      }
    }
  }

  // 4. sequenceDiagram 常见错误：参与者/消息行格式
  if (type === 'sequenceDiagram' || type === 'sequence') {
    for (const [i, line] of lines.entries()) {
      const t = line.trim()
      if (t.startsWith('%%')) continue
      if (t === '') continue
      // 声明行需有名字
      if (/^(participant|actor|title|rect|end|note\s+over|alt|else|opt|loop|par)\b/.test(t)) {
        if (/^(participant|actor)\s+$/.test(t)) {
          errors.push(`第 ${i + 1} 行：${t.split(/\s+/)[0]} 后缺名字`)
        }
        continue
      }
      // 消息行需含 -> 箭头
      if (!/->/.test(t) && !/^[A-Za-z]/.test(t) && !/^\s*$/.test(t)) {
        // 跳过无箭头但以字母开头的（可能是参与者名简写等，粗检）
      }
      if (/[?#]/.test(t.replace(/#[^:]*:/, ''))) {
        errors.push(`第 ${i + 1} 行：含非法字符（"${t.slice(0, 40)}"）`)
      }
    }
  }

  // 5. classDiagram 常见错误：类名后的非法字符
  if (type === 'classDiagram' || type === 'class') {
    // 粗检
  }

  // 6. 括号/引号配对粗检
  const pairs: Record<string, string> = { '{': '}', '[': ']', '(': ')' }
  const stack: string[] = []
  for (const ch of code) {
    if (ch === '{' || ch === '[' || ch === '(') stack.push(ch)
    else if (ch === '}' || ch === ']' || ch === ')') {
      const open = stack.pop()
      if (!open || pairs[open] !== ch) {
        errors.push(`括号不匹配：多余 "${ch}"`)
        break
      }
    }
  }
  if (stack.length > 0) errors.push(`括号未闭合：${stack.map((c) => pairs[c]).join('')}`)

  // 启发式总是附一条提醒
  warnings.push('启发式预检不能 100% 保证语法正确，建议渲染后人工确认')

  return { ok: errors.length === 0, errors, mode: 'heuristic', warnings }
}

/** 综合校验入口：严格优先，否则启发式。 */
export async function validateMermaid(type: string, code: string): Promise<ValidationResult> {
  const normalized = normalizeDiagramType(type)
  if (STRICT_VALIDATED_TYPES.includes(normalized)) {
    return validateStrict(normalized, code)
  }
  if (HEURISTIC_TYPES.includes(normalized)) {
    return validateHeuristic(normalized, code)
  }
  // 未知类型：尝试严格校验，失败则启发式
  const strict = await validateStrict(normalized, code)
  if (strict.ok) return strict
  const heuristic = validateHeuristic(normalized, code)
  return {
    ...heuristic,
    warnings: [`未知图类型 "${type}"，已按启发式预检`, ...heuristic.warnings],
  }
}

export type { DiagramType }
