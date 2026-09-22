/**
 * 咒语书 —— 内容解析器
 *
 * 全站唯一的解析器。构建脚本用它，未来的 DSH 插件也用它，
 * 所以它不依赖任何第三方库，也不依赖任何构建工具。
 *
 * 内容格式（受限方言，故意不是完整 YAML）：
 *
 *   ---
 *   title: 液态玻璃面板
 *   tags: [玻璃, 模糊]
 *   params:
 *     - { name: blur, label: 模糊, type: range, min: 0, max: 40, default: 18 }
 *   ---
 *
 *   ## 描述     散文；==被标出的短语== 是迁移中必须保留的机制
 *   ## 代码     ```html / ```css / ```js 围栏；机制行带 @mechanism 注释
 *   ## 边界     - 这条什么时候会失效（可选，但强烈建议写）
 *   ## 备注     - 其它零碎
 *
 * 设计取舍：frontmatter 支持流式 YAML 的一个子集（数组、对象、字符串、数字、布尔、
 * null），裸标识符自动当字符串处理，所以 `tags: [玻璃, 模糊]` 这种写法可以直接写。
 * 块级嵌套只支持「键 + 缩进短横线列表」一种，params 用的就是它。
 */

export class ParseError extends Error {
  constructor(file, reason) {
    super(`${file}: ${reason}`)
    this.name = 'ParseError'
    this.file = file
    this.reason = reason
  }
}

const REQUIRED_SECTIONS = ['描述', '代码']

/* ------------------------------------------------------------------ *
 * frontmatter
 * ------------------------------------------------------------------ */

/** 括号是否已经配对（忽略字符串内部），用来判断值是否还需要往下读行。 */
function bracketsBalanced(text) {
  let depth = 0
  let quote = null
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (quote) {
      if (ch === '\\') i++
      else if (ch === quote) quote = null
      continue
    }
    if (ch === '"' || ch === "'") quote = ch
    else if (ch === '[' || ch === '{') depth++
    else if (ch === ']' || ch === '}') depth--
  }
  return depth <= 0 && quote === null
}

function scalar(raw) {
  const v = raw.trim()
  if (v === '') return ''
  if (v === 'true') return true
  if (v === 'false') return false
  if (v === 'null' || v === '~') return null
  if (/^-?\d+(?:\.\d+)?$/.test(v)) return Number(v)
  return v
}

/** 流式 YAML 子集：数组、对象、引号字符串、裸标量。 */
function parseFlow(src, file) {
  let i = 0
  const skipWs = () => {
    while (i < src.length && /\s/.test(src[i])) i++
  }

  function readString(quote) {
    i++
    let out = ''
    while (i < src.length) {
      const ch = src[i]
      if (ch === '\\') {
        out += src[i + 1] ?? ''
        i += 2
        continue
      }
      if (ch === quote) {
        i++
        return out
      }
      out += ch
      i++
    }
    throw new ParseError(file, '字符串有没闭合的引号')
  }

  function readArray() {
    i++
    const out = []
    skipWs()
    if (src[i] === ']') {
      i++
      return out
    }
    for (;;) {
      out.push(readValue())
      skipWs()
      if (src[i] === ',') {
        i++
        continue
      }
      if (src[i] === ']') {
        i++
        return out
      }
      throw new ParseError(file, `数组第 ${out.length} 项之后既不是 , 也不是 ]`)
    }
  }

  function readObject() {
    i++
    const out = {}
    skipWs()
    if (src[i] === '}') {
      i++
      return out
    }
    for (;;) {
      skipWs()
      let key
      if (src[i] === '"' || src[i] === "'") {
        key = readString(src[i])
      } else {
        const start = i
        while (i < src.length && !/[:,\]}]/.test(src[i])) i++
        key = src.slice(start, i).trim()
      }
      if (!key) throw new ParseError(file, '对象里出现空键')
      skipWs()
      if (src[i] !== ':') throw new ParseError(file, `键 ${key} 后面缺少 :`)
      i++
      out[key] = readValue()
      skipWs()
      if (src[i] === ',') {
        i++
        continue
      }
      if (src[i] === '}') {
        i++
        return out
      }
      throw new ParseError(file, `键 ${key} 之后既不是 , 也不是 }`)
    }
  }

  function readValue() {
    skipWs()
    const ch = src[i]
    if (ch === '[') return readArray()
    if (ch === '{') return readObject()
    if (ch === '"' || ch === "'") return readString(ch)
    const start = i
    while (i < src.length && !/[,\]}]/.test(src[i])) i++
    return scalar(src.slice(start, i))
  }

  const value = readValue()
  skipWs()
  if (i < src.length) {
    throw new ParseError(file, `值解析完还有多余内容：${src.slice(i, i + 24)}`)
  }
  return value
}

function looksLikeFlow(text) {
  const t = text.trim()
  return t.startsWith('[') || t.startsWith('{')
}

/** 拆出 frontmatter 行与正文。 */
function splitFrontmatter(source, file) {
  const text = source.replace(/^\uFEFF/, '')
  const lines = text.split(/\r?\n/)
  if (lines[0]?.trim() !== '---') {
    throw new ParseError(file, '文件开头缺少 frontmatter 的 --- 分隔线')
  }
  let end = -1
  for (let i = 1; i < lines.length; i++) {
    if (lines[i].trim() === '---') {
      end = i
      break
    }
  }
  if (end === -1) throw new ParseError(file, 'frontmatter 缺少闭合的 --- 分隔线')
  return { fmLines: lines.slice(1, end), bodyLines: lines.slice(end + 1) }
}

function parseFrontmatter(fmLines, file) {
  const meta = {}
  let i = 0

  while (i < fmLines.length) {
    const line = fmLines[i]
    if (!line.trim() || line.trimStart().startsWith('#')) {
      i++
      continue
    }

    const m = /^([A-Za-z0-9_-]+):(.*)$/.exec(line)
    if (!m) throw new ParseError(file, `frontmatter 第 ${i + 2} 行无法解析：${line.trim()}`)

    const key = m[1]
    let rest = m[2].trim()

    // 键后面啥都没有：可能是缩进短横线列表
    if (rest === '') {
      const items = []
      let j = i + 1
      while (j < fmLines.length) {
        const next = fmLines[j]
        if (!next.trim()) break
        if (!/^\s+-/.test(next)) break
        if (!/^\s+/.test(next)) break
        items.push(next.replace(/^\s+-\s*/, '').trim())
        j++
      }
      if (items.length) {
        meta[key] = items.map((item) =>
          looksLikeFlow(item) ? parseFlow(item, file) : scalar(item),
        )
        i = j
        continue
      }
      meta[key] = ''
      i++
      continue
    }

    // 括号没配平：把后续行接上
    if (!bracketsBalanced(rest)) {
      const parts = [rest]
      let j = i + 1
      while (j < fmLines.length && !bracketsBalanced(parts.join('\n'))) {
        parts.push(fmLines[j])
        j++
      }
      if (!bracketsBalanced(parts.join('\n'))) {
        throw new ParseError(file, `${key} 的值括号没有闭合`)
      }
      rest = parts.join('\n')
      i = j
    } else {
      i++
    }

    // 值形如 key: [..]，也可能是数组里内联对象的多行形式
    if (looksLikeFlow(rest)) {
      const flowStart = rest.search(/[[{]/)
      const prefix = rest.slice(0, flowStart).trim()
      const flow = parseFlow(rest.slice(flowStart), file)
      if (prefix === '') {
        meta[key] = flow
      } else if (Array.isArray(flow) && prefix === '-') {
        meta[key] = flow
      } else {
        throw new ParseError(file, `${key} 的值前面有多余内容：${prefix}`)
      }
      continue
    }

    meta[key] = scalar(rest)
  }

  return meta
}

/* ------------------------------------------------------------------ *
 * 正文分节
 * ------------------------------------------------------------------ */

function splitSections(bodyLines, file) {
  const sections = new Map()
  let current = null
  let buf = []
  let fence = null

  const flush = () => {
    if (current !== null) sections.set(current, buf.join('\n').trim())
  }

  for (const line of bodyLines) {
    const fenceLine = /^[ \t]*(`{3,}|~{3,})[ \t]*[A-Za-z0-9_+#-]*[ \t]*$/.exec(line)

    if (fence) {
      buf.push(line)
      if (fenceLine && fenceLine[1][0] === fence[0] && fenceLine[1].length >= fence.length) {
        fence = null
      }
      continue
    }
    if (fenceLine) {
      fence = fenceLine[1]
      buf.push(line)
      continue
    }

    const heading = /^##[ \t]+(.+?)[ \t]*$/.exec(line)
    if (heading) {
      flush()
      current = heading[1]
      buf = []
      continue
    }

    if (current !== null) buf.push(line)
  }
  flush()

  for (const name of REQUIRED_SECTIONS) {
    if (!sections.has(name)) {
      throw new ParseError(file, `缺少 ## ${name} 小节`)
    }
  }
  return sections
}

/* ------------------------------------------------------------------ *
 * 代码围栏
 * ------------------------------------------------------------------ */

/** 从围栏文本里抽出代码块，并标出带 @mechanism 的行。 */
function extractCodeBlocks(text, file) {
  const lines = text.split(/\r?\n/)
  const blocks = []
  let i = 0

  while (i < lines.length) {
    const open = /^[ \t]*(`{3,}|~{3,})[ \t]*([A-Za-z0-9_+#-]*)[ \t]*$/.exec(lines[i])
    if (!open) {
      i++
      continue
    }
    const marker = open[1]
    const lang = open[2] || 'text'
    const body = []
    i++
    let closed = false
    while (i < lines.length) {
      const close = /^[ \t]*(`{3,}|~{3,})[ \t]*$/.exec(lines[i])
      if (close && close[1][0] === marker[0] && close[1].length >= marker.length) {
        closed = true
        i++
        break
      }
      body.push(lines[i])
      i++
    }
    if (!closed) throw new ParseError(file, `代码块 ${lang} 没有闭合的围栏`)

    const mechanismLines = []
    const clean = body.map((line, index) => {
      if (/@mechanism\b/.test(line)) mechanismLines.push(index)
      return line
    })

    blocks.push({ lang, lines: clean, mechanismLines })
  }

  if (blocks.length === 0) {
    throw new ParseError(file, '## 代码 小节里没有任何代码围栏')
  }
  return blocks
}

/* ------------------------------------------------------------------ *
 * 描述：==机制短语==
 * ------------------------------------------------------------------ */

function extractMechanisms(text, file) {
  const phrases = []
  let depth = 0
  let start = -1
  for (let i = 0; i < text.length; i++) {
    if (text[i] === '=' && text[i + 1] === '=') {
      if (depth === 0) {
        start = i + 2
        depth = 1
      } else {
        phrases.push(text.slice(start, i).trim())
        depth = 0
      }
      i++
      continue
    }
  }
  if (depth !== 0) throw new ParseError(file, '描述里的 ==机制== 标记没有成对')
  if (phrases.length === 0) {
    throw new ParseError(file, '描述里至少要标出一处 ==机制==')
  }
  if (phrases.some((p) => p === '')) {
    throw new ParseError(file, '描述里有空的 ==机制== 标记')
  }
  return phrases
}

function extractNotes(text) {
  if (!text) return []
  return text
    .split(/\r?\n/)
    .map((line) => line.replace(/^\s*[-*]\s+/, '').trim())
    .filter(Boolean)
}

/* ------------------------------------------------------------------ *
 * 入口
 * ------------------------------------------------------------------ */

export function parse(source, file = '<unknown>') {
  const { fmLines, bodyLines } = splitFrontmatter(source, file)
  const meta = parseFrontmatter(fmLines, file)
  const sections = splitSections(bodyLines, file)

  const description = sections.get('描述') ?? ''
  const blocks = extractCodeBlocks(sections.get('代码') ?? '', file)
  const mechanisms = extractMechanisms(description, file)

  const codeMechanismCount = blocks.reduce((n, b) => n + b.mechanismLines.length, 0)
  if (codeMechanismCount === 0) {
    throw new ParseError(file, '代码里没有任何 @mechanism 标记，无法与描述里的机制对应')
  }

  return {
    meta,
    description,
    code: blocks,
    notes: extractNotes(sections.get('备注') ?? ''),
    // 「什么会失效」是与「靠什么成立」同等重要的一域：机制是迁移的承重墙，
    // 边界是用户真正会踩的坑。所以它单独成段、单独入库，提议时能跟效果一起端出去，
    // 而不是埋在自由文本里每次重读全文。可选段——不是每条咒语都想得清边界。
    caveats: extractNotes(sections.get('边界') ?? ''),
    mechanisms,
  }
}

export { parseFlow, bracketsBalanced, extractMechanisms, extractCodeBlocks }
