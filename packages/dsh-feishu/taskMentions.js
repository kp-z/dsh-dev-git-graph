import { randomUUID } from 'node:crypto'

const OPEN_ID = /^ou_[A-Za-z0-9]+$/
const MAX_REFS = 1024
const DEFAULT_TTL_MS = 5 * 60 * 1000
const normalizeName = name => name.normalize('NFKC').trim().replace(/\s+/gu, ' ')
const failure = (taskId, status, error) => ({ ok: false, taskId, status, targets: [], error })

// Only explicit user followers are eligible. Any conflicting row poisons its ID,
// including a row claiming the same ID belongs to a different type or role.
function followers(members) {
  const byId = new Map(), blocked = new Set()
  for (const member of members) {
    if (!member || typeof member.id !== 'string' || !OPEN_ID.test(member.id)) continue
    const id = member.id
    if (member.type !== 'user' || member.role !== 'follower' ||
        (member.name != null && typeof member.name !== 'string')) {
      blocked.add(id)
      continue
    }
    const name = member.name ?? null
    const previous = byId.get(id)
    if (previous && previous.name !== name) blocked.add(id)
    else byId.set(id, { openId: id, name, normalizedName: name == null ? '' : normalizeName(name) })
  }
  for (const id of blocked) byId.delete(id)
  return byId
}

function validContext(input) {
  return input && ['taskId', 'sessionId', 'scope'].every(key =>
    typeof input[key] === 'string' && input[key].trim().length > 0) && Array.isArray(input.members)
}

/**
 * No network, files, persistence or Host services. The Host must supply freshly
 * fetched members to validate immediately before sending a comment, and must
 * fence backend/config/session changes across that fetch and the actual write.
 *
 * resolve(): omitted names lists candidates (also at the top level). Otherwise
 * names must contain 1–5 complete names. Each target is matched/ambiguous/missing;
 * ambiguous candidates have refs but are never automatically selected. ok means
 * every requested name matched uniquely, NOT authorization to send a comment.
 *
 * validate(): 1–5 opaque refs; all must pass before any IDs are returned. Failure
 * always returns mentionIds: []; refs are reusable until TTL or FIFO eviction.
 * Cache holds at most 1024 refs. Restart requires resolving again, even with an
 * injected deterministic randomId. Name matching is normalized, but validation
 * binds the exact supplied name so even a normalization-equivalent rename fails.
 */
export function createTaskMentionResolver({ now = Date.now, randomId = randomUUID, ttlMs = DEFAULT_TTL_MS } = {}) {
  if (typeof now !== 'function' || typeof randomId !== 'function' ||
      !Number.isFinite(ttlMs) || ttlMs <= 0) throw new TypeError('提及解析器配置无效')
  const refs = new Map(), instance = randomUUID()
  let sequence = 0
  function clock() {
    try {
      const time = now()
      return Number.isFinite(time) && Number.isFinite(time + ttlMs) ? time : null
    } catch { return null }
  }
  function prune(time) {
    for (const [ref, entry] of refs) {
      if (time < entry.createdAt || time >= entry.expiresAt) refs.delete(ref)
    }
  }
  function resolve(input = {}) {
    const { taskId, sessionId, scope, members, names } = input ?? {}
    if (!validContext(input)) return failure(taskId, 'invalid_input', '必须提供任务、会话、授权作用域和成员列表')
    let queries = null
    if (names !== undefined) {
      if (!Array.isArray(names) || names.length < 1 || names.length > 5 ||
          Array.from(names).some(name => typeof name !== 'string')) {
        return failure(taskId, 'invalid_input', '姓名列表必须包含1–5个完整姓名')
      }
      queries = names.map(name => normalizeName(name).replace(/^@/, '').trim())
      if (queries.some(name => !name || name.startsWith('@'))) {
        return failure(taskId, 'invalid_input', '每项必须是完整姓名，且最多只能带一个前导 @')
      }
    }
    const time = clock()
    if (time === null) return failure(taskId, 'invalid_clock', '无法确定提及引用的有效期，请稍后重新解析')
    prune(time)
    const eligible = [...followers(members).values()]
    const selections = queries === null ? [eligible] : queries.map(query =>
      eligible.filter(member => member.normalizedName && member.normalizedName === query))
    const selected = new Map(selections.flat().map(member => [member.openId, member]))
    // Never return refs already evicted by the same resolve call.
    if (selected.size > MAX_REFS) return failure(taskId, 'capacity', '关注人候选过多，请按完整姓名缩小解析范围')
    const pending = new Map(), candidates = new Map()
    try {
      for (const member of selected.values()) {
        const token = randomId()
        if (typeof token !== 'string' || !token || token.length > 256) throw new TypeError('随机引用标识无效')
        const mentionRef = `tm_${instance}_${++sequence}_${token}`
        pending.set(mentionRef, { taskId, sessionId, scope, openId: member.openId,
          name: member.name, createdAt: time, expiresAt: time + ttlMs })
        candidates.set(member.openId, { name: member.name, openId: member.openId, role: 'follower', mentionRef })
      }
    } catch { return failure(taskId, 'reference_error', '无法生成安全的提及引用，请重新解析') }
    while (refs.size + pending.size > MAX_REFS) refs.delete(refs.keys().next().value)
    for (const [ref, entry] of pending) refs.set(ref, entry)
    const targets = selections.map((selection, index) => ({
      query: queries === null ? null : queries[index],
      status: queries === null ? 'candidates' : selection.length === 0 ? 'missing' : selection.length === 1 ? 'matched' : 'ambiguous',
      candidates: selection.map(member => candidates.get(member.openId)),
    }))
    const statuses = new Set(targets.map(target => target.status))
    return { ok: queries === null || targets.every(target => target.status === 'matched'), taskId,
      status: statuses.size === 1 ? targets[0].status : 'mixed', targets,
      ...(queries === null ? { candidates: targets[0].candidates } : {}) }
  }
  function validate(input = {}) {
    const { taskId, sessionId, scope, members, mentionRefs } = input ?? {}
    const reject = (status, error) => ({ ok: false, mentionIds: [], status, error })
    if (!validContext(input) || !Array.isArray(mentionRefs) || mentionRefs.length < 1 || mentionRefs.length > 5 ||
        Array.from(mentionRefs).some(ref => typeof ref !== 'string' || !ref)) {
      return reject('invalid_input', '必须提供任务、会话、授权作用域、成员列表和1–5个提及引用')
    }
    const time = clock()
    if (time === null) return reject('invalid_clock', '无法确定提及引用的有效期，请稍后重新解析')
    prune(time)
    const current = followers(members), mentionIds = new Set()
    for (const ref of mentionRefs) {
      const entry = refs.get(ref)
      if (!entry) return reject('invalid_reference', '提及引用已过期或不存在，请重新解析收件人')
      if (entry.taskId !== taskId || entry.sessionId !== sessionId || entry.scope !== scope) {
        return reject('scope_mismatch', '提及引用不属于当前任务、会话或授权作用域，请重新解析')
      }
      const member = current.get(entry.openId)
      if (!member || member.name !== entry.name) {
        return reject('member_changed', '收件人已移除、改名，或用户类型及关注人角色无法唯一确认，请重新解析')
      }
      mentionIds.add(entry.openId)
    }
    return { ok: true, mentionIds: [...mentionIds] }
  }
  return { resolve, validate }
}
