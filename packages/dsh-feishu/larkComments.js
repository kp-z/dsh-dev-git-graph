/* Task comment transport shared by lark-cli actions. No credentials, IO or Python
 * dependency here: api is the selected CLI's authenticated raw OpenAPI adapter. */
const str = value => value == null ? '' : String(value)
const fail = (op, error, unknownDelivery = false) => ({ op, ok: false, error: str(error), unknownDelivery })
const validComment = (row, task, reply = '') => row && (typeof row.id !== 'number' || Number.isSafeInteger(row.id)) && /^\d{1,20}$/.test(str(row.id)) && row.resource_type === 'task' && str(row.resource_id) === task && (!reply || str(row.reply_to_comment_id) === reply)
const escape = text => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
function definitiveRejection(result) {
  // A timeout, lost/malformed receipt, 5xx or arbitrary CLI error is NOT proof of
  // non-delivery. Only structured authorization/validation/explicit client errors.
  const code = Number(result.error?.code ?? result.parsed?.code)
  return result.error?.type === 'authorization' || result.error?.type === 'validation' || (code >= 400 && code < 500) || (code >= 1470400 && code < 1470500)
}
export async function listLarkComments(api, action, endpoint = '/open-apis/task/v2/comments') {
  const op = action.op, items = [], cursors = new Set()
  let token = '', error = ''
  for (let page = 0; page < 20; page++) {
    const result = await api('GET', endpoint, { params: { resource_type: 'task', resource_id: action.task, page_size: 100, ...(op === 'task_comments' ? { user_id_type: 'open_id', direction: 'asc' } : {}), ...(token ? { page_token: token } : {}) }, timeoutMs: 60000 })
    if (!result.ok) { error = result.detail || '读取失败'; break }
    const data = result.data
    if (!data || !Array.isArray(data.items) || typeof data.has_more !== 'boolean' || (op === 'task_comments' && data.items.some(item => !validComment(item, str(action.task))))) { error = '评论分页结构或资源回执无效'; break }
    items.push(...data.items)
    if (!data.has_more) return { op, ok: true, items, incomplete: false, pageToken: '', has_more: false }
    const next = str(data.page_token)
    if (!next || cursors.has(next)) { error = '分页游标缺失或循环'; break }
    cursors.add(next); token = next
  }
  return { op, ok: false, items, incomplete: true, pageToken: token, has_more: true, error: error || '超过完整分页保护上限' }
}
export async function createLarkComment(api, action) {
  const op = 'task_comment', task = str(action.task), text = action.text ?? action.content
  const reply = str(action.reply_to_comment_id ?? action.replyToCommentId)
  const mentions = action.mentionIds ?? action.mention_ids ?? []
  if (!task || task.length > 100 || typeof text !== 'string' || !text.trim() || Array.from(text).length > 3000) return fail(op, 'task/text 无效或超过评论上限')
  if (!Array.isArray(mentions) || mentions.length > 5 || mentions.some(id => typeof id !== 'string' || !/^ou_[A-Za-z0-9]+$/.test(id))) return fail(op, '任务提及只接受最多5个有效 open_id')
  if (reply && !/^\d{1,20}$/.test(reply)) return fail(op, '被回复评论 ID 无效')
  if (action.uid) return fail(op, '任务评论创建协议没有 uid 幂等参数')
  const legacy = action.mentionMode === 'task-v1' && mentions.length > 0
  if (mentions.length && !legacy && (action.allowMentionFallback !== true || !reply)) return fail(op, '原生回复没有真实 @ 协议；不能静默发送不带 @ 的回复')
  let posted = false
  try {
    if (reply) {
      const original = await api('GET', '/open-apis/task/v2/comments/' + encodeURIComponent(reply), { params: { user_id_type: 'open_id' }, timeoutMs: 60000 })
      if (!original.ok || !validComment(original.data?.comment, task) || str(original.data.comment.id) !== reply) return fail(op, original.detail || '被回复评论不属于当前任务')
    }
    let path = '/open-apis/task/v2/comments', data = { content: text, resource_type: 'task', resource_id: task, ...(reply ? { reply_to_comment_id: reply } : {}) }
    if (legacy) {
      const rich = [...new Set(mentions)].map(id => '<at id=' + id + '></at>').join(' ')
      const safe = escape(text), envelope = safe.match(/^(\[🤖AI 回复\]\n[-━─═]{5,}\n)/)
      const richContent = envelope ? envelope[1] + '▌ ' + rich + '\n' + safe.slice(envelope[1].length) : rich + '\n' + safe
      path = '/open-apis/task/v1/tasks/' + encodeURIComponent(task) + '/comments'
      data = { content: text, rich_content: richContent, parent_id: reply || '0' }
    }
    posted = true
    const result = await api('POST', path, { params: { user_id_type: 'open_id' }, data, timeoutMs: 60000 })
    if (!result.ok) return fail(op, result.detail || '评论写回失败', !definitiveRejection(result))
    let comment = result.data?.comment
    if (legacy) {
      if (!comment || !/^\d{1,20}$/.test(str(comment.id)) || str(comment.parent_id) !== (reply || '0')) return fail(op, '旧版评论回执缺失或回复关联不符', true)
      const checked = await api('GET', '/open-apis/task/v2/comments/' + encodeURIComponent(str(comment.id)), { params: { user_id_type: 'open_id' }, timeoutMs: 60000 })
      if (!checked.ok) return fail(op, '旧版评论已提交，但 v2 回执核验失败', true)
      comment = checked.data?.comment
    }
    if (!validComment(comment, task, reply)) return fail(op, '评论回执 ID、资源或回复关联无效', true)
    return { op, ok: true, commentId: str(comment.id), comment, unknownDelivery: false, mentionSupported: legacy, ...(legacy ? { mentionTransport: 'task-v1', notificationVerified: false } : {}), warning: mentions.length && !legacy ? '原生回复不保证 @ 通知' : '' }
  } catch (error) { return fail(op, error?.message || error, posted) }
}
