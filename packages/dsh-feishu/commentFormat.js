/** Identity envelope only: leave reply prose untouched; format before durable outbound save. */
export const AI_COMMENT_HEADER = '[🤖AI 回复]'
/* Feishu task comments render only a Markdown subset (@ and links), so a real table
 * or "---" horizontal rule is not reliable. Use a plain-text card: a heavy rule plus
 * a left rail on every line keeps the same frame in every client. */
export const AI_COMMENT_RULE = '━━━━━━━━━━━━━━━━━━'
export const AI_COMMENT_RAIL = '▌'
const RULE_RE = /^[-━─═]{5,}\s*$/
const HEADER_RE = /^(?:\[\s*🤖\s*AI\s*回复\s*\]|\[AI\s*回复(?:\s*[·|]\s*DSH)?\]|🤖\s*(?:[:：]\s*)?(?:AI\s*回复(?:\s*[·|]\s*DSH)?\s*)?)/i

function stripEnvelope(value) {
  let body = String(value ?? '').replace(/\r\n/g, '\n').trim()
  if (!body) return ''
  const lines = body.split('\n')
  let start = 0
  while (start < lines.length) {
    let line = lines[start].trim()
    if (!line) { start++; continue }
    if (HEADER_RE.test(line)) {
      line = line.replace(HEADER_RE, '').trim()
      if (line) { lines[start] = line; continue }
      start++; continue
    }
    if (RULE_RE.test(line) || line === AI_COMMENT_RAIL) { start++; continue }
    break
  }
  const stripped = lines.slice(start).map((line) => line.replace(/^▌\s?/, ''))
  let end = stripped.length
  while (end > 0) {
    const line = stripped[end - 1].trim()
    if (!line || RULE_RE.test(line) || line === AI_COMMENT_RAIL) { end--; continue }
    break
  }
  return stripped.slice(0, end).join('\n').trim()
}

function rail(body) {
  return body.split('\n').map((line) => line ? AI_COMMENT_RAIL + ' ' + line : AI_COMMENT_RAIL).join('\n')
}

export function formatAIComment(text, limit = 3000) {
  const body = stripEnvelope(text)
  if (!body) return ''
  const head = AI_COMMENT_HEADER + '\n' + AI_COMMENT_RULE + '\n'
  const tail = '\n' + AI_COMMENT_RULE
  /* One line of rail costs two characters. Reserve for one line, then trim again
   * below if a multi-line body still exceeds the hard limit. */
  const budget = Math.max(0, limit - Array.from(head + tail).length - 2)
  const points = Array.from(body)
  let normalized = body
  if (points.length > budget) normalized = points.slice(0, Math.max(0, budget - 1)).join('') + '…'
  let result = head + rail(normalized) + tail
  if (Array.from(result).length > limit) {
    const overflow = Array.from(result).length - limit
    const bodyPoints = Array.from(normalized)
    normalized = bodyPoints.slice(0, Math.max(0, bodyPoints.length - overflow - 1)).join('') + '…'
    result = head + rail(normalized) + tail
  }
  return result
}
