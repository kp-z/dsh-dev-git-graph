/**
 * Pure task relation graph. No persistence or remote API calls.
 *
 * 三种边：
 *  - `depends_on`  前置 → 后置，**会阻塞开工**（写回飞书原生依赖）；
 *  - `derived_from` 来源 → 派生，不阻塞（纯本地标注）；
 *  - `temporal`    时间上更早 → 更晚，**只是先后顺序，绝不阻塞**。
 *
 * `temporal` 是「一键整理」的时间兜底：正文里没有依赖证据时，按完成时间把任务串起来，
 * 让画布至少能表达「谁在前谁在后」。它不参与 blockedBy/ready 判定，也不写飞书——
 * 否则两条本来可以并行的任务会因为时间不同而被误判成阻塞。
 */
const KINDS = new Set(['depends_on', 'derived_from', 'temporal'])
const SOURCES = new Set(['manual', 'ai', 'creation', 'time'])
const idValid = (id) => typeof id === 'string' && id.trim().length > 0
const edgeValid = (edge) => edge && idValid(edge.from) && idValid(edge.to) && KINDS.has(edge.kind)
const edgeKey = (edge) => JSON.stringify([edge.kind, edge.from, edge.to])
const taskMap = (tasks) => new Map((Array.isArray(tasks) ? tasks : []).filter((task) => task && idValid(task.id)).map((task) => [task.id, task]))

// Iterative topological traversal also handles disconnected graphs and deep chains.
function hasCycle(edges, kind) {
  const outgoing = new Map()
  const indegree = new Map()
  const seen = new Set()
  for (const edge of edges) {
    if (!edgeValid(edge) || edge.kind !== kind || seen.has(edgeKey(edge))) continue
    seen.add(edgeKey(edge))
    if (!outgoing.has(edge.from)) outgoing.set(edge.from, [])
    outgoing.get(edge.from).push(edge.to)
    if (!indegree.has(edge.from)) indegree.set(edge.from, 0)
    indegree.set(edge.to, (indegree.get(edge.to) || 0) + 1)
  }
  const queue = [...indegree.keys()].filter((id) => indegree.get(id) === 0)
  for (let cursor = 0; cursor < queue.length; cursor += 1) {
    for (const to of outgoing.get(queue[cursor]) || []) {
      indegree.set(to, indegree.get(to) - 1)
      if (indegree.get(to) === 0) queue.push(to)
    }
  }
  return queue.length !== indegree.size
}

/**
 * Transactionally merge/replace only supplied incident directions. Duplicate
 * edges keep their original metadata, including during replacement. Old malformed
 * entries are retained but ignored by projections/cycle checks; new writes are strict.
 * @returns {{ok:boolean, edges:Array, error?:string}}
 */
export function updateRelations(edges, tasks, input, { now = Date.now() } = {}) {
  const original = Array.isArray(edges) ? edges : []
  const fail = (error) => ({ ok: false, edges: original, error })
  if (!input || typeof input !== 'object' || Array.isArray(input)) return fail('关系输入必须是对象')
  const known = taskMap(tasks)
  const { taskId, mode, source, reason, sessionId } = input
  if (!idValid(taskId) || !known.has(taskId)) return fail('当前任务不存在')
  if (mode !== 'merge' && mode !== 'replace') return fail('mode 必须是 merge 或 replace')
  if (!SOURCES.has(source)) return fail('source 必须是 manual、ai 或 creation')
  if (reason !== undefined && typeof reason !== 'string') return fail('reason 必须是字符串')
  if (sessionId !== undefined && typeof sessionId !== 'string') return fail('sessionId 必须是字符串')
  const directions = [
    { field: 'predecessorIds', kind: 'depends_on', incoming: true },
    { field: 'successorIds', kind: 'depends_on', incoming: false },
    { field: 'sourceTaskIds', kind: 'derived_from', incoming: true },
    { field: 'earlierIds', kind: 'temporal', incoming: true },
    { field: 'laterIds', kind: 'temporal', incoming: false },
  ]
  const supplied = []
  for (const direction of directions) {
    const ids = input[direction.field]
    if (ids === undefined) continue
    if (!Array.isArray(ids) || !Array.from(ids).every(idValid)) return fail(`${direction.field} 必须是非空字符串 ID 数组`)
    if (ids.some((id) => !known.has(id))) return fail(`${direction.field} 包含不存在的任务`)
    if (ids.includes(taskId)) return fail('任务不能关联自身')
    supplied.push({ ...direction, ids: new Set(ids) })
  }
  const next = original.filter((edge) => {
    if (mode !== 'replace' || !edgeValid(edge)) return true
    return !supplied.some(({ kind, incoming, ids }) => edge.kind === kind
      && (incoming ? edge.to : edge.from) === taskId
      && !ids.has(incoming ? edge.from : edge.to))
  })
  const existing = new Set(next.filter(edgeValid).map(edgeKey))
  for (const { kind, incoming, ids } of supplied) {
    for (const id of ids) {
      const edge = {
        from: incoming ? id : taskId,
        to: incoming ? taskId : id,
        kind,
        source,
        reason: reason ?? '',
        createdAt: now,
        sessionId: sessionId ?? '',
      }
      const key = edgeKey(edge)
      if (!existing.has(key)) {
        existing.add(key)
        next.push(edge)
      }
    }
  }
  if (hasCycle(next, 'depends_on')) return fail('任务依赖不能成环')
  if (hasCycle(next, 'derived_from')) return fail('任务来源不能成环')
  if (hasCycle(next, 'temporal')) return fail('任务时间先后不能成环')
  return { ok: true, edges: next }
}

/** Summaries include missing endpoints; a missing predecessor must block work. */
export function projectRelations(edges, tasks, taskId) {
  const known = taskMap(tasks)
  const summary = (id) => {
    const task = known.get(id)
    return { id, title: typeof task?.title === 'string' ? task.title : id, done: Boolean(task?.done), missing: !task }
  }
  const groups = { predecessors: new Set(), successors: new Set(), sourceTasks: new Set(), derivedTasks: new Set(), earlierTasks: new Set(), laterTasks: new Set() }
  for (const edge of Array.isArray(edges) ? edges : []) {
    if (!edgeValid(edge)) continue
    if (edge.kind === 'depends_on') {
      if (edge.to === taskId) groups.predecessors.add(edge.from)
      if (edge.from === taskId) groups.successors.add(edge.to)
    } else if (edge.kind === 'temporal') {
      if (edge.to === taskId) groups.earlierTasks.add(edge.from)
      if (edge.from === taskId) groups.laterTasks.add(edge.to)
    } else {
      if (edge.to === taskId) groups.sourceTasks.add(edge.from)
      if (edge.from === taskId) groups.derivedTasks.add(edge.to)
    }
  }
  const result = Object.fromEntries(Object.entries(groups).map(([key, ids]) => [key, [...ids].map(summary)]))
  result.blockedBy = result.predecessors.filter((task) => !task.done)
  result.ready = result.blockedBy.length === 0
  return result
}

/** Edge counts are unique valid triples; task counts only include known unfinished tasks. */
export function relationStats(edges, tasks) {
  const unique = new Map((Array.isArray(edges) ? edges : []).filter(edgeValid).map((edge) => [edgeKey(edge), edge]))
  const counts = { dependencyEdges: 0, provenanceEdges: 0, temporalEdges: 0, blockedTasks: 0, readyTasks: 0 }
  const blocked = new Set()
  const known = taskMap(tasks)
  for (const edge of unique.values()) {
    if (edge.kind === 'depends_on') {
      counts.dependencyEdges += 1
      if (!known.get(edge.from)?.done) blocked.add(edge.to)
    } else if (edge.kind === 'temporal') counts.temporalEdges += 1
    else counts.provenanceEdges += 1
  }
  for (const task of known.values()) {
    if (task.done) continue
    if (blocked.has(task.id)) counts.blockedTasks += 1
    else counts.readyTasks += 1
  }
  return counts
}
