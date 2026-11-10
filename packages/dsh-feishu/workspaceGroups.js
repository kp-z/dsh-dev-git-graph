/**
 * 自定义目录（工作区分组）：纯函数，不做 IO、不碰远端。
 *
 * 用户要的不是文件系统目录，也不是任务标题里的 tag，而是**自己拖出来的目录**：
 * 把已经列出来的若干 workspace 拉进一组、给它取个名字（比如「QV」），
 * 于是「多个项目 = 一个项目」——这一组在总览里共用一张关系图。
 *
 * 约定：
 * - `members` 存的是总览页里的 workspace key（`workspaceId || workspacePath || 'name:'+label`），
 *   宿主只当它是**不透明字符串**，不解析路径、不校验存在性（工作区可能被删/改名）。
 * - `labels` 是 key → 名字的快照，只用于「成员已经不在了」时还能显示人话。
 * - 一个 workspace 只能属于一个自定义目录：任何一次分配都会把它从别的目录里摘掉。
 */

const MAX_NAME = 40
const MAX_GROUPS = 50
const MAX_MEMBERS = 200

const str = (value) => (typeof value === 'string' ? value : (typeof value === 'number' && isFinite(value) ? String(value) : ''))
const idValid = (value) => str(value).trim().length > 0
const cleanName = (value) => str(value).replace(/\s+/g, ' ').trim().slice(0, MAX_NAME)
const fail = (error) => ({ ok: false, groups: [], error })

/** 成员去重、保序、限量；labels 只保留仍然在场的 key。 */
function cleanMembers(members, labels) {
  const out = []
  const seen = new Set()
  for (const raw of Array.isArray(members) ? members : []) {
    const key = str(raw).trim()
    if (!key || seen.has(key)) continue
    seen.add(key)
    out.push(key)
    if (out.length >= MAX_MEMBERS) break
  }
  const source = labels && typeof labels === 'object' && !Array.isArray(labels) ? labels : {}
  const kept = {}
  for (const key of out) {
    const label = cleanName(source[key])
    if (label) kept[key] = label
  }
  return { members: out, labels: kept }
}

/** 读盘/快照都会经过这里：坏行丢掉，不抛。 */
export function normalizeGroups(raw) {
  const list = Array.isArray(raw) ? raw : []
  const seen = new Set()
  const out = []
  for (const row of list) {
    if (!row || typeof row !== 'object' || Array.isArray(row)) continue
    const id = str(row.id).trim()
    const name = cleanName(row.name)
    if (!idValid(id) || !name || seen.has(id)) continue
    seen.add(id)
    const { members, labels } = cleanMembers(row.members, row.labels)
    out.push({
      id,
      name,
      members,
      labels,
      createdAt: Number(row.createdAt) || 0,
      updatedAt: Number(row.updatedAt) || 0,
    })
    if (out.length >= MAX_GROUPS) break
  }
  return out
}

/** 把若干 key 从**其它**目录里摘掉（含 labels），返回新的数组。exceptId 是被分配的那个目录。 */
function detach(groups, keys, exceptId = '') {
  const drop = new Set(keys)
  if (!drop.size) return groups
  return groups.map((group) => {
    if (group.id === exceptId) return group
    if (!group.members.some((key) => drop.has(key))) return group
    const members = group.members.filter((key) => !drop.has(key))
    const labels = { ...group.labels }
    for (const key of drop) delete labels[key]
    return { ...group, members, labels }
  })
}

/** 目录名唯一（大小写与空白无关）：重名会让「拖到哪个目录」变得没法说清。 */
function nameTaken(groups, name, exceptId) {
  const needle = name.toLowerCase()
  return groups.some((group) => group.id !== exceptId && group.name.toLowerCase() === needle)
}

/**
 * 执行一次分组操作。返回新数组，不改入参。
 *
 * action：
 * - `create`：`{name, members?, labels?}`
 * - `update`：`{id, name?, members?, labels?}`（成员给了就整体替换）
 * - `add`：`{id, member: key | {key,label}}`（拖进来）
 * - `remove`：`{id, key}`（拖出去）
 * - `delete`：`{id}`
 */
export function applyGroupAction(groups, input, { now = Date.now(), makeId } = {}) {
  const current = normalizeGroups(groups)
  if (!input || typeof input !== 'object' || Array.isArray(input)) return fail('分组输入必须是对象')
  const action = str(input.action || 'create').trim()
  const nextId = typeof makeId === 'function' ? makeId : () => `wg-${now.toString(36)}-${Math.random().toString(36).slice(2, 8)}`
  const find = (id) => current.find((group) => group.id === id)

  if (action === 'create') {
    if (current.length >= MAX_GROUPS) return fail(`最多 ${MAX_GROUPS} 个自定义目录`)
    const name = cleanName(input.name)
    if (!name) return fail('目录名不能为空')
    if (nameTaken(current, name, '')) return fail(`已经有一个叫「${name}」的目录了`)
    const { members, labels } = cleanMembers(input.members, input.labels)
    const id = str(input.id).trim() || nextId()
    if (find(id)) return fail('目录 id 已存在')
    const group = { id, name, members, labels, createdAt: now, updatedAt: now }
    const detached = detach(current, members)
    return { ok: true, groups: [...detached, group], group }
  }

  if (action === 'delete') {
    const id = str(input.id).trim()
    const group = find(id)
    if (!group) return fail('没找到这个目录')
    return { ok: true, groups: current.filter((row) => row.id !== id), group: { ...group } }
  }

  const id = str(input.id).trim()
  const group = find(id)
  if (!group) return fail('没找到这个目录')

  if (action === 'rename' || action === 'update') {
    const name = input.name === undefined ? group.name : cleanName(input.name)
    if (!name) return fail('目录名不能为空')
    if (nameTaken(current, name, id)) return fail(`已经有一个叫「${name}」的目录了`)
    const patched = { ...group, name, updatedAt: now }
    if (input.members !== undefined) {
      const { members, labels } = cleanMembers(input.members, input.labels === undefined ? group.labels : input.labels)
      patched.members = members
      patched.labels = labels
    } else if (input.labels !== undefined) {
      const { labels } = cleanMembers(patched.members, input.labels)
      patched.labels = labels
    }
    let next = current.map((row) => (row.id === id ? patched : row))
    next = detach(next, patched.members.filter((key) => !group.members.includes(key)), id)
    return { ok: true, groups: next, group: patched }
  }

  if (action === 'add') {
    const raw = input.member !== undefined ? input.member : input.key
    const key = str(typeof raw === 'object' && raw ? raw.key : raw).trim()
    if (!idValid(key)) return fail('member.key 不能为空')
    const label = cleanName(typeof raw === 'object' && raw ? raw.label : input.label)
    const members = group.members.includes(key) ? group.members : [...group.members, key]
    const labels = { ...group.labels }
    if (label) labels[key] = label
    const patched = { ...group, members, labels, updatedAt: now }
    let next = current.map((row) => (row.id === id ? patched : row))
    if (!group.members.includes(key)) next = detach(next, [key], id)
    return { ok: true, groups: next, group: patched }
  }

  if (action === 'remove') {
    const key = str(input.key !== undefined ? input.key : (typeof input.member === 'object' && input.member ? input.member.key : input.member)).trim()
    if (!idValid(key)) return fail('key 不能为空')
    const members = group.members.filter((row) => row !== key)
    if (members.length === group.members.length) return fail('这个 workspace 不在该目录里')
    const labels = { ...group.labels }
    delete labels[key]
    const patched = { ...group, members, labels, updatedAt: now }
    return { ok: true, groups: current.map((row) => (row.id === id ? patched : row)), group: patched }
  }

  return fail('action 必须是 create、update、rename、add、remove 或 delete')
}

/** 快照用：目录 + 统计（成员数、命中当前任务集的成员数），不改数据。 */
export function projectGroups(groups, tasks) {
  const list = normalizeGroups(groups)
  const keys = new Set()
  for (const task of Array.isArray(tasks) ? tasks : []) keys.add(workspaceKeyOf(task))
  return list.map((group) => ({
    id: group.id,
    name: group.name,
    members: [...group.members],
    labels: { ...group.labels },
    presentMembers: group.members.filter((key) => keys.has(key)).length,
    createdAt: group.createdAt,
    updatedAt: group.updatedAt,
  }))
}

/**
 * 一个任务的 workspace 身份 —— **全插件只有这一处定义**。
 *
 * 总览页的分组、/api/overview 的 `workspaceKey`、以及自定义目录的 `members`
 * 必须用同一个 key，否则会出现「面板按 UUID 分组、宿主按路径统计」这种两边各说各话。
 * 优先级：工作区 id（最稳）→ 路径 → 名字兜底（只带名字的历史数据）。
 */
export function workspaceKeyOf(task) {
  const t = task && typeof task === 'object' ? task : {}
  const id = str(t.workspaceId).trim()
  if (id) return id
  const path = str(t.workspacePath).trim()
  if (path) return path
  const label = str(t.workspaceTitle || t.workspaceName || t.meta?.workspace).trim()
  return label ? `name:${label}` : ''
}
