/* Task comment transport shared by lark-cli actions. No credentials, IO or Python
 * dependency here: api is the selected CLI's authenticated raw OpenAPI adapter. */
const str = value => value == null ? '' : String(value)
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value)
const fail = (op, error, unknownDelivery = false, extra = {}) => ({ op, ok: false, commentId: null, comment: null, mentionSupported: false, user_id_type: 'open_id', error: str(error), unknownDelivery, ...extra })
const validTask = task => typeof task === 'string' && Boolean(task.trim()) && task.length <= 100
// Python normalizes integer resource IDs/timestamps to strings. JS must reject
// already-rounded numbers instead of certifying an ID which lost precision.
function commentResource(row) {
  if (!object(row)) throw new Error('评论资源不是对象')
  const out = { ...row }
  for (const key of ['id', 'reply_to_comment_id', 'created_at', 'updated_at']) {
    const value = out[key]
    if (value == null) continue
    if (typeof value !== 'string' && !(typeof value === 'number' && Number.isSafeInteger(value))) throw new Error(`评论 ${key} 类型无效`)
    out[key] = String(value)
  }
  if (!/^\d{1,20}$/.test(out.id ?? '')) throw new Error('评论资源缺少有效稳定 ID')
  return out
}
const validComment = (row, task, reply = '') => object(row) && row.resource_type === 'task' && row.resource_id === task && (!reply || row.reply_to_comment_id === reply)
const escape = text => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
function definitiveRejection(result) {
  // A timeout, lost/malformed receipt, 5xx or arbitrary CLI error is NOT proof of
  // non-delivery. Only structured authorization/validation/explicit client errors.
  const code = Number(result.error?.code ?? result.parsed?.code)
  return result.beforeRequest === true || result.error?.type === 'authorization' || result.error?.type === 'validation' || (code >= 400 && code < 500) || (code >= 1470400 && code < 1470500)
}
export async function listLarkComments(api, action = {}, endpoint = '/open-apis/task/v2/comments') {
  const op = action?.op, items = [], cursors = new Set(), ids = new Set()
  const result = { op, ok: false, items, incomplete: true, page_token: action?.page_token ?? '', has_more: true, pages: 0, user_id_type: 'open_id', error: null }
  // Retain the camelCase output for existing CLI callers; page_token is the
  // canonical Python-compatible continuation consumed by task detail/history.
  const finish = () => ({ ...result, pageToken: result.page_token })
  try {
    if (!object(action) || !validTask(action.task)) throw new Error('task 必须为非空任务 GUID（最多100字符）')
    const maxPages = action.max_pages === undefined ? 20 : action.max_pages
    if (!Number.isInteger(maxPages) || maxPages < 1 || maxPages > 100) throw new Error('max_pages 必须为 1–100 的整数')
    const direction = action.direction === undefined ? 'asc' : action.direction
    if (!['asc', 'desc'].includes(direction)) throw new Error('direction 必须为 asc/desc')
    if (typeof result.page_token !== 'string' || (result.page_token && !result.page_token.trim())) throw new Error('page_token 必须为有效字符串')
    const comments = op === 'task_comments', pageSize = comments ? 50 : 100
    for (let page = 0; page < maxPages; page++) {
      const token = result.page_token
      cursors.add(token)
      const response = await api('GET', endpoint, { params: { resource_type: 'task', resource_id: action.task, page_size: pageSize, ...(comments ? { user_id_type: 'open_id', direction } : {}), ...(token ? { page_token: token } : {}) }, timeoutMs: 60000 })
      if (!response?.ok) throw new Error(response?.detail || response?.error?.message || '读取失败')
      const data = response.data
      if (!object(data) || !Array.isArray(data.items) || data.items.length > pageSize || typeof data.has_more !== 'boolean') throw new Error('评论分页结构或资源回执无效')
      const batch = data.items.map(item => {
        if (!comments) { if (!object(item)) throw new Error('附件资源不是对象'); return item }
        const row = commentResource(item)
        // Listing follows main: omitted resource metadata is permitted, but an
        // explicit foreign resource is never accepted. POST/GET receipts are strict.
        if ((row.resource_type != null && row.resource_type !== 'task') || (row.resource_id != null && row.resource_id !== action.task)) throw new Error('评论资源不属于当前任务')
        return row
      })
      for (const item of batch) {
        if (!comments || !ids.has(item.id)) { items.push(item); if (comments) ids.add(item.id) }
      }
      result.pages++
      result.has_more = data.has_more
      const next = data.page_token ?? ''
      if (typeof next !== 'string' || (next && !next.trim())) throw new Error('评论分页 page_token 无效')
      result.page_token = next
      if (!result.has_more) { result.ok = true; result.incomplete = false; return finish() }
      if (!next || cursors.has(next)) throw new Error('分页游标缺失或循环')
    }
    throw new Error('评论分页达到 max_pages 上限，数据不完整')
  } catch (error) {
    result.error = str(error?.message || error).slice(0, 200)
    return finish()
  }
}
export async function createLarkComment(api, action = {}) {
  const op = 'task_comment'
  if (!object(action)) return fail(op, 'action 必须为对象')
  const task = action.task, text = action.text ?? action.content
  const reply = action.reply_to_comment_id ?? action.replyToCommentId ?? ''
  // Validate every supplied alias, then merge. An empty mentionIds must not mask
  // a populated mentions alias and turn an explicitly requested real @ into no @.
  const aliases = [action.mentionIds, action.mention_ids, action.mentions].filter(value => value != null)
  if (aliases.some(value => !Array.isArray(value) || value.length > 5 || value.some(id => typeof id !== 'string' || !/^ou_[A-Za-z0-9]+$/.test(id)))) return fail(op, '任务提及只接受最多5个有效 open_id')
  const mentions = [...new Set(aliases.flat())]
  if (mentions.length > 5) return fail(op, '任务提及只接受最多5个有效 open_id')
  if (!validTask(task) || typeof text !== 'string' || !text.trim() || Array.from(text).length > 3000 || /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(text)) return fail(op, 'task/text 无效或超过评论上限')
  if (typeof reply !== 'string' || (reply && !/^\d{1,20}$/.test(reply))) return fail(op, '被回复评论 ID 无效')
  if (action.uid) return fail(op, '任务评论创建协议没有 uid 幂等参数', false, { unsupported: 'uid' })
  const legacy = action.mentionMode === 'task-v1' && mentions.length > 0
  if (mentions.length && !legacy && (action.allowMentionFallback !== true || !reply)) return fail(op, '原生回复没有真实 @ 协议；不能静默发送不带 @ 的回复', false, { unsupported: 'mentions' })
  let posted = false
  try {
    if (reply) {
      const original = await api('GET', '/open-apis/task/v2/comments/' + encodeURIComponent(reply), { params: { user_id_type: 'open_id' }, timeoutMs: 60000 })
      if (!original?.ok) return fail(op, original?.detail || '无法核验被回复评论')
      const target = commentResource(original.data?.comment)
      if (!validComment(target, task) || target.id !== reply) return fail(op, '被回复评论不属于当前任务')
    }
    let path = '/open-apis/task/v2/comments', data = { content: text, resource_type: 'task', resource_id: task, ...(reply ? { reply_to_comment_id: reply } : {}) }
    if (legacy) {
      const rich = mentions.map(id => '<at id=' + id + '></at>').join(' ')
      const safe = escape(text), envelope = safe.match(/^(\[🤖AI 回复\]\n[-━─═]{5,}\n)/)
      const richContent = envelope ? envelope[1] + '▌ ' + rich + '\n' + safe.slice(envelope[1].length) : rich + '\n' + safe
      path = '/open-apis/task/v1/tasks/' + encodeURIComponent(task) + '/comments'
      data = { content: text, rich_content: richContent, parent_id: reply || '0' }
    }
    posted = true
    const response = await api('POST', path, { params: { user_id_type: 'open_id' }, data, timeoutMs: 60000 })
    if (!response?.ok) return fail(op, response?.detail || '评论写回失败', !response || !definitiveRejection(response))
    let comment = commentResource(response.data?.comment)
    if (legacy) {
      if (str(comment.parent_id ?? '0') !== (reply || '0')) return fail(op, '旧版评论回执缺失或回复关联不符', true)
      const createdId = comment.id
      const checked = await api('GET', '/open-apis/task/v2/comments/' + encodeURIComponent(createdId), { params: { user_id_type: 'open_id' }, timeoutMs: 60000 })
      if (!checked?.ok) return fail(op, '旧版评论已提交，但 v2 回执核验失败', true)
      comment = commentResource(checked.data?.comment)
      if (comment.id !== createdId) return fail(op, '旧版评论 v2 回执 ID 不匹配', true)
    }
    if (!validComment(comment, task, reply)) return fail(op, '评论回执 ID、资源或回复关联无效', true)
    return { op, ok: true, commentId: comment.id, comment, unknownDelivery: false, user_id_type: 'open_id', error: null, mentionSupported: legacy, ...(legacy ? { mentionTransport: 'task-v1', notificationVerified: false } : {}), warning: mentions.length && !legacy ? '原生回复不保证 @ 通知' : '' }
  } catch (error) { return fail(op, error?.message || error, posted) }
}
