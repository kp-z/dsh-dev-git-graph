/* Pure comment collaboration coordinator. No IO outside injected adapters.
 *
 * Adapters (all may be async):
 * load() -> null | snapshot; save(snapshot) -> void (atomic, isolated JSON file).
 * listComments(taskId) -> {ok, complete, items}: ALL pages; partial scans never commit.
 * getTask(taskId), resolveTask(taskId) -> {id,sessionId,done,paused,members} | null.
 *   Both must confirm the current binding; resolveTask is the final authoritative check.
 * isSessionBusy(sessionId) -> boolean.
 * deliver({requestId,taskId,commentId,sessionId,text,authorId,mode,maxPermission})
 *   -> {ok:true}; requestId is stable, NOT presumed idempotent.
 * writeComment(taskId,text,{key,replyTo,mentionIds}) -> {ok:true,commentId}
 *   | {ok:false,definitive:true,error}. Anything else/throw is UNKNOWN, not retryable.
 * now() -> timestamp. Successful saves precede every external effect. A failed save
 * poisons this instance: recreate it from the last durable snapshot, never continue.
 *
 * Public methods are serialized, including reads. sync(tasks, config) scans then
 * drains. drain(config) resumes pending work. complete(commentId,sessionId,text,
 * {taskId?}) is explicit correlation, never inferred from arbitrary turn completion.
 * retry(taskId,commentId,{confirmedNotDelivered:true}) manually reconciles delivery;
 * ignore(taskId,commentId) abandons inbox work (NOT an unresolved outbound send).
 * reconcileOutbound(taskId,key,{commentId}|{notSent:true}) resolves uncertain sends.
 * A caller must obtain remote evidence before either manual reconciliation action.
 * writeOutbound options.requireActive defaults false for legacy manual/progress
 * comments; explicit replies always require the immutable active session binding.
 * deliver must not await coordinator calls (single-flight lock); use a synchronous
 * bridge map and enqueue markRunning after acknowledging delivery.
 */
const clone = (value) => JSON.parse(JSON.stringify(value))
const str = (value) => value == null ? '' : String(value)
const identity = (taskId, commentId) => JSON.stringify([str(taskId), str(commentId)])
const active = (task) => Boolean(task?.id && task?.sessionId && !task.done && !task.paused && !task.suspended && !task.suspension?.active && !(task.completed_at && str(task.completed_at) !== '0'))
const inboxStates = new Set(['pending', 'delivering', 'delivered', 'running', 'reply_pending', 'replied', 'ignored', 'unknown'])
const outboundStates = new Set(['sending', 'sent', 'failed', 'unknown'])
const object = (value) => value && typeof value === 'object' && !Array.isArray(value)
function validSnapshot(value) {
  if (!object(value) || value.version !== 1 || !object(value.tasks) || !Array.isArray(value.inbox) || !object(value.outbound) || !Number.isSafeInteger(value.nextSeq) || value.nextSeq < 1) return false
  const keys = new Set(), seqs = new Set()
  for (const entry of value.inbox) {
    if (!object(entry) || !entry.taskId || !entry.commentId || !entry.sessionId || entry.key !== identity(entry.taskId, entry.commentId) || !inboxStates.has(entry.status) || !Number.isSafeInteger(entry.seq) || entry.seq < 1 || entry.seq >= value.nextSeq || keys.has(entry.key) || seqs.has(entry.seq) || typeof entry.requestId !== 'string' || typeof entry.owner !== 'boolean' || !['execute', 'reply', 'off'].includes(entry.mode)) return false
    keys.add(entry.key); seqs.add(entry.seq)
  }
  return Object.values(value.tasks).every((row) => object(row) && typeof row.baseline === 'boolean' && object(row.seen)) && Object.entries(value.outbound).every(([key, row]) => object(row) && row.taskId && row.key && key === identity(row.taskId, row.key) && outboundStates.has(row.status) && object(row.payload) && typeof row.payload.text === 'string' && Array.isArray(row.payload.mentionIds) && (row.status !== 'sent' || Boolean(str(row.commentId))))
}
const configOf = (config = {}) => ({ enabled: config.enabled === true, ownerMode: config.ownerMode === 'execute' ? 'execute' : 'off', otherMode: config.otherMode === 'reply' ? 'reply' : 'off', mentionMode: config.mentionMode === 'task-v1' ? 'task-v1' : 'native', maxPerSync: Number.isInteger(config.maxPerSync) && config.maxPerSync >= 0 ? config.maxPerSync : 5 })

export function normalizeComment(raw = {}) {
  const creator = raw.creator ?? raw.author ?? {}
  const user = creator.user ?? {}
  return { id: str(raw.id ?? raw.comment_id), text: str(raw.content ?? raw.text ?? raw.body), authorId: str(creator.id ?? creator.user_id ?? user.id ?? user.user_id), authorType: str(creator.type ?? user.type ?? ''), createdAt: Number(raw.created_at ?? raw.create_time ?? raw.createdAt) || 0 }
}
export function isCommentOwner(task, comment) {
  return comment.authorType === 'user' && Boolean(comment.authorId) && (task?.members ?? []).some((member) => member.role === 'assignee' && str(member.id ?? member.user_id) === comment.authorId && (!member.type || member.type === 'user'))
}

export function createCommentCoordinator(deps) {
  for (const name of ['load', 'save', 'listComments', 'getTask', 'resolveTask', 'deliver', 'isSessionBusy', 'writeComment', 'now']) {
    if (typeof deps?.[name] !== 'function') throw new TypeError(`Missing comment adapter: ${name}`)
  }
  let state, tail = Promise.resolve(), poisoned = false, closed = false, config = configOf()
  async function persist() {
    try { await deps.save(clone(state)) } catch (error) { poisoned = true; throw error }
  }
  async function init() {
    if (poisoned) throw new Error('Comment persistence failed; recreate coordinator before further work')
    if (state) return
    const saved = await deps.load()
    state = saved == null ? { version: 1, nextSeq: 1, tasks: {}, inbox: [], outbound: {} } : clone(saved)
    if (!validSnapshot(state)) {
      poisoned = true
      throw new Error('Invalid comment snapshot; manual migration required')
    }
    let changed = false
    for (const entry of state.inbox) {
      if (['delivering', 'delivered'].includes(entry.status)) { entry.status = 'unknown'; entry.error = 'Delivery interrupted; reconcile manually'; changed = true }
    }
    for (const row of Object.values(state.outbound)) {
      if (row.status === 'sending') { row.status = 'unknown'; row.error = 'Send interrupted; reconcile manually'; changed = true }
    }
    if (changed) await persist()
  }
  function serial(fn) {
    if (closed) return Promise.reject(new Error('Comment coordinator is disposed'))
    const result = tail.then(async () => { await init(); return fn() })
    tail = result.catch(() => {})
    return result
  }
  function taskState(taskId) {
    return state.tasks[identity(taskId, '')] ??= { baseline: false, seen: {} }
  }
  function blocked(taskId) {
    return Object.values(state.outbound).some((row) => row.taskId === taskId && ['sending', 'unknown'].includes(row.status))
  }
  async function current(taskId, sessionId) {
    const local = await deps.getTask(taskId)
    if (!active(local) || (sessionId && local.sessionId !== sessionId)) return null
    const remote = await deps.resolveTask(taskId)
    if (!active(remote) || str(remote.id) !== taskId || remote.sessionId !== local.sessionId || (sessionId && remote.sessionId !== sessionId)) return null
    return remote
  }
  function findEntry(taskId, commentId) { return state.inbox.find((entry) => entry.key === identity(taskId, commentId)) }
  async function scan(tasks) {
    const scanned = new Set()
    for (const candidate of tasks ?? []) {
      const taskId = str(candidate?.id)
      if (!active(candidate) || scanned.has(taskId) || blocked(taskId)) continue
      scanned.add(taskId)
      const task = await current(taskId, candidate.sessionId)
      if (!task) continue
      let result
      try { result = await deps.listComments(taskId) } catch { continue }
      if (result?.ok !== true || result.complete !== true || !Array.isArray(result.items)) continue
      const items = result.items.map(normalizeComment)
      // An unidentifiable comment makes a purportedly complete scan unsafe.
      if (items.some((comment) => !comment.id)) continue
      const row = taskState(taskId)
      for (const comment of items.sort((a, b) => a.createdAt - b.createdAt)) {
        const key = identity(taskId, comment.id)
        if (row.seen[key]) continue
        row.seen[key] = true
        if (!row.baseline) continue
        const own = Object.values(state.outbound).some((out) => out.taskId === taskId && out.commentId === comment.id && out.status === 'sent')
        const owner = isCommentOwner(task, comment)
        const mode = owner ? config.ownerMode : config.otherMode
        const ignored = own || !comment.authorId || comment.authorType !== 'user' || mode === 'off'
        state.inbox.push({ key, seq: state.nextSeq++, taskId, commentId: comment.id, sessionId: task.sessionId, text: comment.text, authorId: comment.authorId, authorType: comment.authorType, owner, mode, requestId: `feishu-comment:${key}`, status: ignored ? 'ignored' : 'pending', createdAt: deps.now(), ...(ignored ? { reason: own ? 'outbound-ledger' : 'disabled-or-unidentified' } : {}) })
      }
      row.baseline = true
      await persist()
    }
  }
  async function outbound(taskId, text, options = {}) {
    taskId = str(taskId)
    if (!str(options.key)) throw new TypeError('writeOutbound requires a stable key')
    const key = identity(taskId, options.key)
    let row = state.outbound[key]
    const payload = { text: str(text), replyTo: str(options.replyTo), mentionIds: [...new Set((options.mentionIds ?? []).map(str).filter(Boolean))] }
    if (row && JSON.stringify(row.payload) !== JSON.stringify(payload)) return { ok: false, error: 'Stable outbound key cannot change payload' }
    if (row?.status === 'sent') return { ok: true, commentId: row.commentId, reused: true, warning: row.warning || '', mentionSupported: row.mentionSupported === true }
    if (blocked(taskId)) return { ok: false, unknown: true, error: 'Task outbound ledger requires reconciliation' }
    const eligible = options.requireActive === true ? await current(taskId, options.sessionId) : await deps.getTask(taskId)
    if (!eligible || str(eligible.id) !== taskId) return { ok: false, blocked: true, error: 'Task missing, or active reply task paused, done, unbound or rebound' }
    row ??= state.outbound[key] = { taskId, key: str(options.key), payload, mentionMode: config.mentionMode, createdAt: deps.now() }
    row.status = 'sending'
    await persist()
    let result
    try { result = await deps.writeComment(taskId, row.payload.text, { key: row.key, replyTo: row.payload.replyTo, mentionIds: row.payload.mentionIds, mentionMode: row.mentionMode || 'native' }) } catch (error) { result = { error: str(error?.message ?? error) } }
    if (result?.ok === true && str(result.commentId)) {
      row.status = 'sent'; row.commentId = str(result.commentId); row.warning = str(result.warning); row.mentionSupported = result.mentionSupported === true; delete row.error
    } else {
      row.status = result?.ok === false && result.definitive === true ? 'failed' : 'unknown'
      row.error = str(result?.error || 'Unknown comment send outcome')
    }
    await persist()
    return row.status === 'sent' ? { ok: true, commentId: row.commentId, warning: row.warning || '', mentionSupported: row.mentionSupported === true } : { ok: false, unknown: row.status === 'unknown', error: row.error }
  }
  async function reply(entry) {
    const result = await outbound(entry.taskId, entry.replyText, { key: `reply:${entry.key}`, replyTo: entry.commentId, mentionIds: [entry.authorId], sessionId: entry.sessionId, requireActive: true })
    if (result.ok) { entry.status = 'replied'; entry.outboundCommentId = result.commentId; entry.warning = result.warning || ''; entry.mentionSupported = result.mentionSupported === true; delete entry.error; await persist() }
    else { entry.error = result.error; await persist() }
    return result
  }
  async function drainInternal() {
    if (!config.enabled) return { ok: true, delivered: 0 }
    let delivered = 0
    const occupied = new Set()
    for (const entry of [...state.inbox].sort((a, b) => a.seq - b.seq)) {
      if (entry.status === 'ignored' || (entry.status === 'replied' && entry.turnEnded)) continue
      if (occupied.has(entry.sessionId)) continue
      occupied.add(entry.sessionId)
      if (blocked(entry.taskId)) continue
      const task = await current(entry.taskId, entry.sessionId)
      if (!task) {
        // Never reset an uncertain execution to pending, even if binding changes.
        if (entry.status !== 'unknown') { entry.status = 'ignored'; entry.reason = 'task-inactive-or-binding-changed'; await persist() }
        continue
      }
      if (entry.status === 'reply_pending') { await reply(entry); continue }
      if (entry.status !== 'pending') continue
      const ownerNow = entry.owner && isCommentOwner(task, entry)
      const mode = ownerNow ? config.ownerMode : config.otherMode
      if (mode === 'off') { entry.status = 'ignored'; entry.reason = 'mode-off'; await persist(); continue }
      if (delivered >= config.maxPerSync || await deps.isSessionBusy(entry.sessionId)) continue
      // An owner who lost ownership can only be downgraded. A non-owner never upgrades.
      entry.mode = entry.mode === 'reply' ? 'reply' : mode
      entry.maxPermission = ownerNow && entry.mode === 'execute' ? 'owner' : 'reply'
      const finalTask = await current(entry.taskId, entry.sessionId)
      if (!finalTask) continue
      if (entry.maxPermission === 'owner' && !isCommentOwner(finalTask, entry)) {
        if (config.otherMode !== 'reply') continue
        entry.mode = 'reply'; entry.maxPermission = 'reply'
      }
      entry.deliveryText = `[飞书评论协作 ${entry.key}]\n权限上限：${entry.maxPermission === 'owner' ? '任务负责人；请在已绑定会话内判断意图' : '仅当前任务问答；不得执行修改或读取其他会话/代码'}。\n处理后显式调用 feishu_comment_reply，传 taskId=${entry.taskId}、commentId=${entry.commentId}；🤖:只作展示。\n留言作者：${entry.authorId}\n${entry.text}`
      entry.status = 'delivering'
      await persist()
      let result
      try { result = await deps.deliver({ requestId: entry.requestId, taskId: entry.taskId, commentId: entry.commentId, sessionId: entry.sessionId, text: entry.deliveryText, authorId: entry.authorId, mode: entry.mode, maxPermission: entry.maxPermission }) } catch (error) { result = { error: str(error?.message ?? error) } }
      entry.status = result?.ok === true ? 'delivered' : 'unknown'
      if (entry.status === 'unknown') entry.error = str(result?.error || 'Unknown delivery outcome')
      await persist()
      if (entry.status === 'delivered') delivered++
    }
    return { ok: true, delivered }
  }
  return {
    dispose: async () => { closed = true; await tail },
    sync: (tasks, nextConfig) => serial(async () => { config = configOf(nextConfig); if (config.enabled) await scan(tasks); return drainInternal() }),
    drain: (nextConfig) => serial(async () => { if (nextConfig) config = configOf(nextConfig); return drainInternal() }),
    writeOutbound: (taskId, text, options) => serial(() => outbound(taskId, text, options)),
    complete: (commentId, sessionId, text, options = {}) => serial(async () => {
      const matches = state.inbox.filter((entry) => entry.commentId === str(commentId) && entry.sessionId === str(sessionId) && (!options.taskId || entry.taskId === str(options.taskId)))
      if (matches.length !== 1) return { ok: false, error: 'Comment/session entry is missing or ambiguous' }
      const entry = matches[0]
      if (entry.status === 'replied') return { ok: true, commentId: entry.outboundCommentId, reused: true }
      if (!['delivered', 'running', 'reply_pending'].includes(entry.status)) return { ok: false, error: `Cannot complete entry in ${entry.status}` }
      if (!config.enabled || !(await current(entry.taskId, entry.sessionId))) return { ok: false, blocked: true, error: 'Comment collaboration disabled or task inactive' }
      if (entry.status !== 'reply_pending') {
        if (!str(text).trim()) return { ok: false, error: 'Reply text is required' }
        entry.replyText = `🤖: ${str(text).trim()}`; entry.status = 'reply_pending'; await persist()
      }
      return reply(entry)
    }),
    matchDelivery: (sessionId, messages) => serial(() => {
      const texts = (messages ?? []).flatMap((message) => typeof message === 'string' ? [message] : typeof message?.content === 'string' ? [message.content] : Array.isArray(message?.content) ? message.content.map((part) => part?.text).filter(Boolean) : [])
      const matches = state.inbox.filter((entry) => entry.sessionId === sessionId && !entry.turnEnded && ['delivered', 'running', 'reply_pending', 'replied'].includes(entry.status) && entry.deliveryText && texts.includes(entry.deliveryText))
      return matches.length === 1 ? clone(matches[0]) : null
    }),
    markRunning: (taskId, commentId, sessionId, turn) => serial(async () => {
      const entry = findEntry(taskId, commentId)
      if (!entry || entry.sessionId !== sessionId || entry.turnEnded || !['delivered', 'running'].includes(entry.status)) return { ok: false, error: 'No matching delivered entry' }
      if (entry.turn != null && entry.turn !== turn) return { ok: false, error: 'Comment already belongs to another turn' }
      entry.status = 'running'; entry.turn = turn; await persist(); return { ok: true }
    }),
    endTurn: (taskId, commentId, sessionId, turn) => serial(async () => {
      const entry = findEntry(taskId, commentId)
      if (!entry || entry.sessionId !== sessionId || entry.turn !== turn) return { ok: false, error: 'Turn does not match comment entry' }
      entry.turnEnded = true
      if (['running', 'delivered'].includes(entry.status)) { entry.status = 'unknown'; entry.error = 'Turn ended without explicit completion; manual handling required' }
      await persist(); return { ok: true }
    }),
    list: (filter = {}) => serial(() => clone(state.inbox.filter((entry) => (!filter.taskId || entry.taskId === filter.taskId) && (!filter.status || entry.status === filter.status)))),
    status: () => serial(() => clone({ ...state, blockedTasks: [...new Set(Object.values(state.outbound).filter((row) => ['sending', 'unknown'].includes(row.status)).map((row) => row.taskId))] })),
    retry: (taskId, commentId, options = {}) => serial(async () => {
      const entry = findEntry(taskId, commentId)
      if (!entry) return { ok: false, error: 'Entry not found' }
      if (entry.status === 'reply_pending') return config.enabled ? reply(entry) : { ok: false, blocked: true }
      if (entry.status !== 'unknown' || options.confirmedNotDelivered !== true || blocked(entry.taskId)) return { ok: false, error: 'Manual confirmation of non-delivery required; outbound reconciliation is separate' }
      if (!(await current(entry.taskId, entry.sessionId))) return { ok: false, blocked: true }
      entry.status = 'pending'; delete entry.error; delete entry.turn; delete entry.turnEnded; await persist(); return { ok: true }
    }),
    ignore: (taskId, commentId) => serial(async () => {
      const entry = findEntry(taskId, commentId)
      if (!entry || entry.status === 'replied') return { ok: false, error: 'Entry missing or already replied' }
      entry.status = 'ignored'; entry.reason = 'manual'; await persist(); return { ok: true }
    }),
    reconcileOutbound: (taskId, key, evidence = {}) => serial(async () => {
      const row = state.outbound[identity(taskId, key)]
      if (!row || row.status !== 'unknown') return { ok: false, error: 'No unknown outbound operation' }
      if (str(evidence.commentId) && evidence.notSent !== true) { row.status = 'sent'; row.commentId = str(evidence.commentId) }
      else if (evidence.notSent === true && !evidence.commentId) row.status = 'failed'
      else return { ok: false, error: 'Provide exactly commentId or confirmed notSent' }
      delete row.error; await persist(); return { ok: true }
    }),
  }
}
