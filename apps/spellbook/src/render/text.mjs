/**
 * 渲染用的文本工具：转义、行内标记、罗马数字、抄录文本。
 *
 * 两条硬规则：
 *  1. 内容里的一切先进 escapeHtml，再处理标记 —— 顺手写反了就是 XSS。
 *  2. 演示文档里的 </script> 与 </template> 必须被处理掉，否则用户的代码会把文档截断。
 */

export function escapeHtml(text) {
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

/** 塞进 <script type="text/plain"> 的 JS。 */
export function escapeScriptContent(code) {
  return String(code).replace(/<\/(script)/gi, '<\\/$1')
}

/** 塞进 <template> 的标记。 */
export function escapeTemplateContent(markup) {
  return String(markup).replace(/<\/(template)/gi, '<\\/$1')
}

/**
 * 描述正文的行内标记。先转义再替换 —— 标记字符（== ** `）不受转义影响。
 * `==…==` 是「机制」，迁移中必须保留的那部分，也是页面上唯一被强调的东西。
 */
export function renderInline(text) {
  let out = escapeHtml(text)
  out = out.replace(/==([^=]+?)==/g, (_, phrase) => `<mark class="mech" data-mech>${phrase}</mark>`)
  out = out.replace(/\*\*([^*]+?)\*\*/g, '<strong>$1</strong>')
  out = out.replace(/`([^`]+?)`/g, '<code>$1</code>')
  return out
}

export function renderParagraphs(text) {
  return String(text)
    .split(/\n{2,}/)
    .map((para) => para.trim())
    .filter(Boolean)
    .map((para) => `<p>${renderInline(para)}</p>`)
    .join('\n')
}

const ROMAN = [
  [1000, 'M'], [900, 'CM'], [500, 'D'], [400, 'CD'],
  [100, 'C'], [90, 'XC'], [50, 'L'], [40, 'XL'],
  [10, 'X'], [9, 'IX'], [5, 'V'], [4, 'IV'], [1, 'I'],
]

export function roman(number) {
  let n = Math.max(1, Math.floor(number))
  let out = ''
  for (const [value, glyph] of ROMAN) {
    while (n >= value) {
      out += glyph
      n -= value
    }
  }
  return out
}

const CN_DIGITS = ['〇', '一', '二', '三', '四', '五', '六', '七', '八', '九']

/**
 * 章节用的中文数字。条目用罗马数字（I、II），章节用中文数字（第一章）——
 * 两套记号不同，层级一眼可辨。超过 99 章就不再硬凑，老老实实写回阿拉伯数字。
 */
export function chineseNumeral(number) {
  const n = Math.floor(number)
  if (!Number.isFinite(n) || n < 1 || n > 99) return String(number)
  if (n < 10) return CN_DIGITS[n]
  const tens = Math.floor(n / 10)
  const ones = n % 10
  return (tens === 1 ? '十' : CN_DIGITS[tens] + '十') + (ones ? CN_DIGITS[ones] : '')
}

const MARKER_PATTERNS = [
  /\/\*\s*@mechanism\s*\*\//g,
  /\/\/\s*@mechanism[^\n]*/g,
  /#\s*@mechanism[^\n]*/g,
]

/**
 * 抄录用的代码文本：剔除 @mechanism 注释。
 * 只删「因为删标记才变空」的行，作者原本的空行保留。
 */
export function stripMechanismMarkers(code) {
  const out = []
  for (const line of String(code).split('\n')) {
    const hadMarker = /@mechanism/.test(line)
    let cleaned = line
    for (const pattern of MARKER_PATTERNS) cleaned = cleaned.replace(pattern, '')
    cleaned = cleaned.replace(/\s+$/, '')
    if (hadMarker && cleaned.trim() === '') continue
    out.push(cleaned)
  }
  return out.join('\n')
}
