/** Identity envelope only: leave reply prose untouched; format before durable outbound save. */
export const AI_COMMENT_HEADER = '[🤖AI 回复]'
export const AI_COMMENT_RULE = '--------------------'
export function formatAIComment(text, limit = 3000) {
  let body = typeof text === 'string' ? text.trim() : ''
  // Strip only leading identity envelopes, never robot symbols in the actual prose.
  const prefix = /^(?:\[\s*🤖\s*AI\s*回复\s*\]|\[AI\s*回复(?:\s*[·|]\s*DSH)?\]|🤖\s*(?:[:：]\s*)?(?:AI\s*回复(?:\s*[·|]\s*DSH)?\s*)?)/i
  let stripped = false
  for (;;) {
    const match = body.match(prefix)
    if (!match) break
    stripped = true
    body = body.slice(match[0].length).trimStart().replace(/^-{5,}\s*\n/, '').trimStart()
  }
  if (stripped) body = body.replace(/\n-{5,}\s*$/, '').trimEnd()
  if (!body) return ''
  const head = AI_COMMENT_HEADER + '\n' + AI_COMMENT_RULE + '\n'
  const tail = '\n' + AI_COMMENT_RULE
  const budget = Math.max(0, limit - Array.from(head + tail).length)
  const points = Array.from(body)
  if (points.length > budget) body = points.slice(0, Math.max(0, budget - 1)).join('') + '…'
  return head + body + tail
}
