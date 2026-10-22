/*
 * TeamGraph：把 DSH 的 session 树 + agentTeam projection 规范化成一份
 * 与渲染无关的节点/边模型。
 *
 * 数据来源（client 注入）：
 *   - byId：会话 summary（parentId/title/displayTitle/running）
 *   - catalogs：projectionsBySession[*].values.subagentCatalog（entries）
 *   - team：official agentTeam projection（members/tasks）
 *
 * 纯函数，便于单测；没有 session 数据时由调用方 fallback 到 world.agents。
 */

function asArray(value) {
  return Array.isArray(value) ? value : []
}

function stateOf(summary, member) {
  if (summary?.running === true) return 'running'
  if (member?.status === 'failed' || member?.status === 'error') return 'error'
  if (member?.status === 'done' || member?.status === 'completed') return 'done'
  if (summary?.running === false) return 'idle'
  return member?.status === 'idle' || summary === undefined ? 'idle' : 'idle'
}

/**
 * @param {object} input
 * @param {string} input.rootId
 * @param {Record<string, object>} [input.byId]
 * @param {Record<string, {entries?: object[]}|object[]>} [input.catalogs]
 * @param {object|null} [input.team]
 * @returns {{rootId: string, nodes: object[], edges: {from: string, to: string}[]}}
 */
export function buildTeamGraph(input = {}) {
  const rootId = typeof input.rootId === 'string' ? input.rootId : ''
  const byId = input.byId !== null && typeof input.byId === 'object' ? input.byId : {}
  const catalogs = input.catalogs !== null && typeof input.catalogs === 'object' ? input.catalogs : {}
  const team = input.team ?? null
  const members = asArray(team?.members)
  const tasks = asArray(team?.tasks)
  const memberById = new Map(members.filter((m) => m && typeof m.id === 'string').map((m) => [m.id, m]))
  const memberByName = new Map(members.filter((m) => m && typeof m.name === 'string').map((m) => [m.name, m]))

  const nodes = []
  const edges = []
  const seen = new Set()

  const childIdsOf = (parentId) => {
    const catalog = catalogs[parentId]
    const entries = Array.isArray(catalog) ? catalog : asArray(catalog?.entries)
    const ids = []
    for (const entry of entries) {
      if (entry && typeof entry.id === 'string' && entry.id !== '') ids.push(entry.id)
    }
    // 没有 catalog 时用 summary.parentId 兜底（只补一层，足够画出真实父子）。
    if (ids.length === 0) {
      for (const [id, summary] of Object.entries(byId)) {
        if (summary && summary.parentId === parentId && id !== parentId) ids.push(id)
      }
    }
    return ids
  }

  const append = (id, parentId, depth) => {
    if (typeof id !== 'string' || id === '' || seen.has(id)) return
    seen.add(id)
    const summary = byId[id] ?? {}
    const member = memberById.get(id) ?? memberByName.get(summary.displayTitle)
    const ownTasks = tasks.filter((task) => task && task.ownerName === (member?.name ?? summary.displayTitle))
    const kind = member?.role === 'lead' ? 'lead' : member?.role === 'teammate' ? 'member' : parentId === null ? 'lead' : 'subagent'
    const label = member?.name ?? summary.displayTitle ?? summary.title ?? id
    const node = {
      id,
      parentId,
      depth,
      kind,
      label,
      title: summary.displayTitle ?? summary.title ?? label,
      mode: typeof summary.mode === 'string' ? summary.mode : null,
      state: stateOf(summary, member),
      tasks: ownTasks.map((task) => ({ id: task.id, subject: task.subject ?? '', status: task.status ?? 'pending' })),
      hasChildren: false,
    }
    nodes.push(node)
    if (parentId !== null) edges.push({ from: parentId, to: id })
    const children = childIdsOf(id)
    node.hasChildren = children.length > 0
    for (const child of children) append(child, id, depth + 1)
  }

  if (rootId !== '') append(rootId, null, 0)
  return { rootId, nodes, edges }
}
