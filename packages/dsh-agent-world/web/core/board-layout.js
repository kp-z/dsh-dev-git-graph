/*
 * 执行看板的**布局与数据折叠**（M7-1 / M7-2）—— **纯函数，不碰 DOM**。
 *
 * ── 为什么布局必须独立成一个纯模块 ──────────────────────────────────────────
 *
 * 看板上"这张单排在第几列"这件事看起来只是画图，但它是**图的语义**：
 * 列号 = 最长前置链长度（拓扑层号）。算错了不会报错，只会让人看到一张
 * "顺序看着有点怪"的图——而那是排查成本最高的一类问题。
 * 放进纯模块就能直接断言："a→b→c 必须是三列"、"菱形必须是 a | b,c | d"。
 *
 * 还有一条红线：**同一份输入必须给同一份输出**（ROADMAP §5.4）。
 * 所以本文件里没有 `Date.now()`、没有 `Math.random()`、不读 `world.tick`，
 * 而且所有顺序都由 `(ordinal, id)` 决定——**不依赖输入数组的顺序**
 *（快照与增量到达的顺序不一样，图不能因此抖）。
 *
 * ── 状态是**消费**的，不是重算的 ────────────────────────────────────────────
 *
 * `ready` 是派生状态（所有 `blockedBy` 都 done），只在 `sim/ready.ts` 算一处（M1-5）。
 * 这里只做两件事：把 `status` 映到**颜色 token**（`STATUS_TOKEN`），以及把它显示出来。
 * **绝对不重新判断"谁该是 ready"**——两处判断迟早会不一致，而不一致的表现是
 * "图上说可以领、世界里没人领"。
 *
 * ── 配色是内容 ──────────────────────────────────────────────────────────────
 *
 * 本文件里**没有一个十六进制色值**：只有 token 名。色值从快照的 `palette`
 *（`content.colors()`，即 `skins` 库）取。缺 token 时不静默退回灰色，
 * 而是退回 `board.missing`（内容里的哨兵色）；连它都缺就返回 `null`
 *（调用方不设内联色 + 挂 `board-missing` 类），并且 `missingBoardTokens()` 能列出缺了谁。
 * 这条沿用 `src/protocol/scene.ts resolveColor` 的口径：**缺一个 token 不该黑屏，但必须一眼看出来**。
 */

/** `TaskStatus` 六态（顺序 = 看板里的固定顺序，别用 Object.keys 的顺序）。 */
export const TASK_STATUSES = ['in_progress', 'ready', 'blocked', 'pending', 'done', 'failed']

/**
 * 状态 → 颜色 token。
 *
 * **不新造一套状态色**（ROADMAP §3.3 第 2 条）：`done` 绿 / `failed` 红 / `ready` 琥珀 /
 * `in_progress` 蓝 / `blocked` 灰 / `pending` 更暗的灰。
 */
export const STATUS_TOKEN = {
  in_progress: 'board.status.in_progress',
  ready: 'board.status.ready',
  blocked: 'board.status.blocked',
  pending: 'board.status.pending',
  done: 'board.status.done',
  failed: 'board.status.failed',
}

/** 看板自身的界面 token（背景/卡片/文字/连线…）。值全在内容库的 `skins` 里。 */
export const BOARD_TOKENS = {
  bg: 'board.bg',
  card: 'board.card',
  fg: 'board.fg',
  dim: 'board.dim',
  line: 'board.line',
  cardLine: 'board.cardLine',
  doneLine: 'board.doneLine',
  verify: 'board.verify',
  failBg: 'board.failBg',
  select: 'board.select',
  /** 缺 token 时的哨兵色（**它本身也是内容**，见文件头）。 */
  missing: 'board.missing',
}

/**
 * 解析一个 token（**唯一一处碰调色板的地方**）。
 *
 * @param {Record<string, string>} palette - 快照里的 token → 色值。
 * @param {string} token - token 名（形如 `board.status.done`）。
 * @returns {string|null} 色值；没有就退回哨兵色；哨兵色也没有才 null。
 */
export function resolveBoardColor(palette, token) {
  const map = palette ?? {}
  const hit = map[token]
  if (typeof hit === 'string' && hit !== '') return hit
  const sentinel = map[BOARD_TOKENS.missing]
  return typeof sentinel === 'string' && sentinel !== '' ? sentinel : null
}

/** 缺了哪些 token（面板要把这件事**说出来**，不能装没事）。 */
export function missingBoardTokens(palette) {
  const map = palette ?? {}
  const want = [...Object.values(BOARD_TOKENS), ...Object.values(STATUS_TOKEN)]
  return want.filter((token) => typeof map[token] !== 'string' || map[token] === '')
}

/** 稳定排序键：`(ordinal, id)`。**不用 id 字符串序**——`task-10` 会排在 `task-2` 前面。 */
function byOrdinalThenId(ordinalOf) {
  return (a, b) => {
    const oa = ordinalOf(a)
    const ob = ordinalOf(b)
    if (oa !== ob) return oa - ob
    return a < b ? -1 : a > b ? 1 : 0
  }
}

/** 把入参收成一张 id → 任务 的稳定表（丢掉没有 id 的脏数据，而不是抛）。 */
function indexTasks(tasks) {
  const list = []
  const seen = new Set()
  for (const task of Array.isArray(tasks) ? tasks : []) {
    if (task === null || typeof task !== 'object') continue
    const id = task.id
    if (typeof id !== 'string' || id === '' || seen.has(id)) continue
    seen.add(id)
    list.push(task)
  }
  return list
}

/**
 * 布局依赖图：给每个任务定**列号**（最长前置链）与**列内行号**，并给出连线端点。
 *
 * ## 算法
 *
 * 层号用 Kahn 拓扑排序：`layer(t) = max(layer(每个前置) + 1)`，没有前置就是 0。
 * 这正好等于"最长前置链长度"——**不是**最大列号，也不是被前置个数。
 * 每一批"当前就绪"的节点都先按 `(ordinal, id)` 排序再处理，所以同一列内的行号
 * 只由数据决定、与输入顺序无关。
 *
 * ## 只看结构，不看状态
 *
 * 边只来自 `blockedBy`，**与 `status` 无关**。刻意的：完成一个任务不该让整张图重排，
 * 否则用户每看一眼图，节点都在换位置。状态只影响颜色（`STATUS_TOKEN`）。
 *
 * ## 引用不到的前置：忽略
 *
 * `blockedBy` 里可能指向表外的任务（跨任务集、或这张表只筛了一部分）。
 * 这种边不能进布局（会让列号算不出来），但**要能在详情栏里看见**——
 * 所以 `describeTask()` 里的 `blockedBy` 保留原始列表。
 *
 * ## 成环：**降级，不抛错**（这是刻意的选择，理由在这里）
 *
 * Kahn 排完还有节点剩下，说明它们在一个环里、或者被环挡住了。两种做法：
 * · **抛错**：看板是个只读视图，一个成环的世界会让整块面板白屏——而**世界本身还在跑**，
 *   那时用户连"哪些单卡住了"都看不到，代价太大；
 * · **降级**（选了它）：把它们按 `(ordinal, id)` 摆在最后一列，`hasCycle=true` 报出来，
 *   详情栏会说"处在依赖环里"。于是**问题可见、页面可用**。
 *
 * `unresolved` 里既有环上的节点、也有被环挡住的后续节点：区分它们要跑 SCC
 * （Tarjan/Kosaraju），对"只读看板 + 报出来"这个目标不值这个复杂度。**要区分时再加**。
 *
 * @param {ReadonlyArray<{id: string, blockedBy?: string[], ordinal?: number}>} tasks
 * @returns {{nodes: object[], columns: object[], edges: object[], unresolved: string[], hasCycle: boolean, maxColumn: number, signature: string}}
 */
export function layoutDependencyGraph(tasks) {
  const list = indexTasks(tasks)
  const ids = list.map((t) => t.id)
  const ordinalMap = new Map(list.map((t) => [t.id, Number.isFinite(t.ordinal) ? t.ordinal : Number.MAX_SAFE_INTEGER]))
  const ordinalOf = (id) => ordinalMap.get(id) ?? Number.MAX_SAFE_INTEGER
  const compare = byOrdinalThenId(ordinalOf)
  const known = new Set(ids)

  /** id → 它在表内的前置（去重）。**自环保留**：它就是环，要被 Kahn 排出来。 */
  const deps = new Map()
  /** id → 依赖它的那些 id（表内）。 */
  const dependents = new Map()
  for (const task of list) {
    const uniq = []
    for (const dep of Array.isArray(task.blockedBy) ? task.blockedBy : []) {
      if (typeof dep !== 'string' || !known.has(dep) || uniq.includes(dep)) continue
      uniq.push(dep)
    }
    deps.set(task.id, uniq)
    for (const dep of uniq) {
      const bucket = dependents.get(dep)
      if (bucket === undefined) dependents.set(dep, [task.id])
      else bucket.push(task.id)
    }
  }

  const indegree = new Map(ids.map((id) => [id, deps.get(id).length]))
  const layer = new Map()
  const order = []
  const processed = new Set()

  const process = (id) => {
    let value = 0
    for (const dep of deps.get(id)) value = Math.max(value, (layer.get(dep) ?? 0) + 1)
    layer.set(id, value)
    processed.add(id)
    order.push(id)
    for (const dependent of dependents.get(id) ?? []) {
      indegree.set(dependent, (indegree.get(dependent) ?? 1) - 1)
    }
  }

  // 每一批 = 此刻所有"前置已处理完"的节点；先排序再处理，保证顺序只由数据决定。
  for (;;) {
    const readyNow = ids.filter((id) => !processed.has(id) && indegree.get(id) === 0).sort(compare)
    if (readyNow.length === 0) break
    for (const id of readyNow) process(id)
  }

  const unresolved = ids.filter((id) => !processed.has(id)).sort(compare)
  const maxResolvedLayer = order.length === 0 ? -1 : Math.max(...order.map((id) => layer.get(id) ?? 0))
  // 降级：剩下的全部放进最后一列（理由见文件头）。
  for (const id of unresolved) layer.set(id, maxResolvedLayer + 1)

  // 列 → 行号。行号按 (ordinal,id) 排，所以同一份数据每次都给同一张图。
  const maxLayer = Math.max(-1, ...ids.map((id) => layer.get(id) ?? 0))
  const columns = []
  const nodes = []
  for (let column = 0; column <= maxLayer; column += 1) {
    const nodeIds = ids.filter((id) => (layer.get(id) ?? 0) === column).sort(compare)
    if (nodeIds.length === 0) continue
    columns.push({ index: column, nodeIds: [...nodeIds] })
    nodeIds.forEach((id, row) => {
      nodes.push({ id, column, row, layer: column, deps: [...deps.get(id)], dependents: [...(dependents.get(id) ?? [])] })
    })
  }

  const positionOf = new Map(nodes.map((n) => [n.id, n]))
  const edges = []
  for (const id of [...ids].sort(compare)) {
    const to = positionOf.get(id)
    for (const dep of deps.get(id)) {
      const from = positionOf.get(dep)
      // 自环没有"两端"，画不出贝塞尔；它已经由 `unresolved` 报出来了。
      if (from === undefined || to === undefined || from.id === to.id) continue
      edges.push({
        from: from.id,
        to: to.id,
        fromColumn: from.column,
        fromRow: from.row,
        toColumn: to.column,
        toRow: to.row,
      })
    }
  }

  return {
    nodes,
    columns,
    edges,
    unresolved,
    hasCycle: unresolved.length > 0,
    maxColumn: maxLayer,
    nodeCount: nodes.length,
    edgeCount: edges.length,
    /** 规范化签名：测试拿它比"两份输入给的是不是同一张图"，DOM 层拿它做重画判定。 */
    signature: nodes.map((n) => `${n.id}@${n.column},${n.row}`).join('|') + '#' + edges.map((e) => `${e.from}>${e.to}`).join('|'),
  }
}

/** 默认的几何参数（列宽/行高/卡片尺寸）。改这些只是改观感，不影响列号。 */
export const DEFAULT_GEOMETRY = { cellW: 214, cellH: 76, nodeW: 176, nodeH: 58, padX: 14, padY: 12 }

/**
 * 四档几何尺寸，从"舒服"到"最紧"（M7-9 响应式）。
 *
 * 为什么用档位而不是直接 `transform: scale`：缩放会把**文字**一起缩，
 * 缩到 0.5 就是"看得见但读不了"。所以先把卡片本身变小（字号不变），
 * 四档都放不下时才退回缩放（`fitGraphGeometry` 的返回值里带 `scale`）。
 */
export const GEOMETRY_PRESETS = [
  { name: 'comfortable', ...DEFAULT_GEOMETRY },
  { name: 'medium', cellW: 190, cellH: 66, nodeW: 156, nodeH: 52, padX: 14, padY: 12 },
  { name: 'compact', cellW: 164, cellH: 56, nodeW: 134, nodeH: 44, padX: 12, padY: 10 },
  { name: 'tight', cellW: 142, cellH: 48, nodeW: 116, nodeH: 38, padX: 10, padY: 8 },
]

/**
 * 按**可用空间**挑一档几何，实在放不下就缩放。
 *
 * 纯函数（只依赖 layout 与 available）——所以"1280/1024/800 三个宽度下放不放得下"
 * 这件事可以**在单测里算**，不必每次开浏览器量。
 *
 * @param {object} layout - `layoutDependencyGraph()` 的结果。
 * @param {{width: number, height: number}} available - 可见内容盒的尺寸（CSS px）。
 * @param {ReadonlyArray<object>} [presets]
 * @returns {object} `graphGeometry()` 的结果 + `preset`（档位名）+ `scale`（≤1）。
 */
export function fitGraphGeometry(layout, available, presets = GEOMETRY_PRESETS) {
  const width = Number.isFinite(available?.width) ? available.width : 0
  const height = Number.isFinite(available?.height) ? available.height : 0
  for (const preset of presets) {
    const geometry = graphGeometry(layout, preset)
    if (geometry.width <= width && geometry.height <= height) {
      return { ...geometry, preset: preset.name, scale: 1 }
    }
  }
  const tightest = presets[presets.length - 1]
  const geometry = graphGeometry(layout, tightest)
  // 缩放也是确定性的：只由"内容尺寸 / 可用尺寸"决定，与时间、随机无关。
  const raw = Math.min(1, width / Math.max(1, geometry.width), height / Math.max(1, geometry.height))
  const scale = Math.max(0.4, Math.round(raw * 100) / 100)
  return { ...geometry, preset: tightest.name, scale }
}

/**
 * 列号/行号 → 像素坐标 + 贝塞尔连线。纯函数，方便测"端点接在卡片边上"。
 *
 * 为什么分成两步（布局 → 几何）：列号是**语义**（最长前置链），像素是**观感**。
 * 混在一起的话，改一次卡片宽度就可能顺手改坏列号。
 *
 * @returns {{nodes: Record<string, {x: number, y: number, w: number, h: number, cx: number, cy: number}>, edges: object[], width: number, height: number}}
 */
export function graphGeometry(layout, options = {}) {
  const { cellW, cellH, nodeW, nodeH, padX, padY } = { ...DEFAULT_GEOMETRY, ...options }
  const nodes = {}
  let maxColumn = -1
  const rowsInColumn = new Map()
  for (const node of layout?.nodes ?? []) {
    const x = Math.round(padX + node.column * cellW)
    const y = Math.round(padY + node.row * cellH)
    nodes[node.id] = { x, y, w: nodeW, h: nodeH, cx: Math.round(x + nodeW / 2), cy: Math.round(y + nodeH / 2), column: node.column, row: node.row }
    maxColumn = Math.max(maxColumn, node.column)
    rowsInColumn.set(node.column, Math.max(rowsInColumn.get(node.column) ?? 0, node.row))
  }

  const edges = []
  for (const edge of layout?.edges ?? []) {
    const from = nodes[edge.from]
    const to = nodes[edge.to]
    if (from === undefined || to === undefined) continue
    // 从"前置"卡片右边缘中点 → "后置"卡片左边缘中点。
    const x1 = from.x + from.w
    const y1 = from.cy
    const x2 = to.x
    const y2 = to.cy
    // 控制点水平外推：连线以水平方向为主，这样多条边不会叠在一条直线上。
    const reach = Math.max(24, Math.round(Math.abs(x2 - x1) / 2))
    const path = `M ${x1} ${y1} C ${x1 + reach} ${y1}, ${x2 - reach} ${y2}, ${x2} ${y2}`
    edges.push({ from: edge.from, to: edge.to, x1, y1, x2, y2, path })
  }

  const maxRow = Math.max(0, ...rowsInColumn.values())
  return {
    nodes,
    edges,
    width: Math.round(padX * 2 + (maxColumn + 1) * cellW),
    height: Math.round(padY * 2 + (maxRow + 1) * cellH),
  }
}

/**
 * `blockedBy` 的**反向索引**：谁解锁了谁。
 *
 * 参考图详情栏里那句 "Unlocks t2,t3" 就是它——**不用新数据**（ROADMAP §3.6）。
 */
export function unlocksIndex(tasks) {
  const list = indexTasks(tasks)
  const known = new Set(list.map((t) => t.id))
  const ordinalMap = new Map(list.map((t) => [t.id, Number.isFinite(t.ordinal) ? t.ordinal : Number.MAX_SAFE_INTEGER]))
  const compare = byOrdinalThenId((id) => ordinalMap.get(id) ?? Number.MAX_SAFE_INTEGER)
  const index = {}
  for (const task of list) {
    for (const dep of Array.isArray(task.blockedBy) ? task.blockedBy : []) {
      if (typeof dep !== 'string' || !known.has(dep) || dep === task.id) continue
      const bucket = index[dep]
      if (bucket === undefined) index[dep] = [task.id]
      else if (!bucket.includes(task.id)) bucket.push(task.id)
    }
  }
  for (const bucket of Object.values(index)) bucket.sort(compare)
  return index
}

/** 任务状态的六态计数（顶部那行进度条用）。**只数，不改状态**。 */
export function countStatuses(tasks) {
  const counts = { total: 0 }
  for (const status of TASK_STATUSES) counts[status] = 0
  for (const task of indexTasks(tasks)) {
    counts.total += 1
    const status = TASK_STATUSES.includes(task.status) ? task.status : 'pending'
    counts[status] += 1
  }
  return counts
}

/**
 * 世界 → 看板要显示的三段数据（**M7-1 的数据适配器**）。
 *
 * 左：成员看板（`world.agents`，每人名下挂他的任务）；右：任务表（给布局用）；
 * 下：详情栏要的字段（`describeTask()` 再算解锁关系）。
 *
 * @param {{agents?: object[], tasks?: object[]}} world - 本地世界（快照 + 增量维护）。
 */
export function buildBoardModel(world) {
  const rawTasks = indexTasks(world?.tasks)
  const ordinalMap = new Map(rawTasks.map((t) => [t.id, Number.isFinite(t.ordinal) ? t.ordinal : Number.MAX_SAFE_INTEGER]))
  const compare = byOrdinalThenId((id) => ordinalMap.get(id) ?? Number.MAX_SAFE_INTEGER)
  const agents = (Array.isArray(world?.agents) ? world.agents : []).filter((a) => a !== null && typeof a === 'object' && typeof a.id === 'string')

  rawTasks.sort((a, b) => compare(a.id, b.id))
  const nameById = new Map(agents.map((a) => [a.id, a.name ?? a.id]))

  const tasks = rawTasks.map((task) => ({
    id: task.id,
    key: typeof task.key === 'string' ? task.key : task.id,
    title: typeof task.title === 'string' ? task.title : task.id,
    status: TASK_STATUSES.includes(task.status) ? task.status : 'pending',
    owner: typeof task.owner === 'string' ? task.owner : null,
    ownerName: typeof task.owner === 'string' ? (nameById.get(task.owner) ?? task.owner) : null,
    ordinal: Number.isFinite(task.ordinal) ? task.ordinal : Number.MAX_SAFE_INTEGER,
    progress: typeof task.progress === 'number' ? task.progress : 0,
    requires: Array.isArray(task.requires) ? [...task.requires] : [],
    blockedBy: Array.isArray(task.blockedBy) ? [...task.blockedBy] : [],
    station: typeof task.station === 'string' ? task.station : null,
    acceptance: typeof task.acceptance === 'string' ? task.acceptance : '',
    description: typeof task.description === 'string' ? task.description : '',
    // R45 / M10-9：工单的**产出**与失败原因（R44 起在小镇数据里，单张最长 2246 字）。
    // 空串归一成 null，这样 UI 只有一个"没有产出"的分支要写。
    output: typeof task.output === 'string' && task.output.trim() !== '' ? task.output : null,
    failureReason: typeof task.failureReason === 'string' && task.failureReason.trim() !== '' ? task.failureReason : null,
  }))

  const members = [...agents].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)).map((agent) => ({
    id: agent.id,
    name: agent.name ?? agent.id,
    role: typeof agent.role === 'string' ? agent.role : null,
    state: typeof agent.state === 'string' ? agent.state : null,
    carrying: typeof agent.carrying === 'string' ? agent.carrying : null,
    tasks: tasks.filter((t) => t.owner === agent.id).map((t) => t.id),
  }))

  return {
    members,
    tasks,
    byId: new Map(tasks.map((t) => [t.id, t])),
    unowned: tasks.filter((t) => t.owner === null).map((t) => t.id),
    counts: countStatuses(tasks),
  }
}

/**
 * 详情栏要显示的一件事（标题、状态、执行者、**"解锁了哪些任务"**）。
 *
 * `unlocks` 是 `blockedBy` 的反向索引算出来的；`blockedBy` 保留**原始**列表
 *（表外的前置也在），所以"卡在一个不在这张图上的单"这件事看得见。
 */
export function describeTask(model, taskId) {
  const task = model?.byId?.get?.(taskId) ?? null
  if (task === null) return null
  const unlocks = unlocksIndex(model.tasks)[taskId] ?? []
  const show = (ids) =>
    ids.map((id) => {
      const other = model.byId.get(id)
      return other === undefined
        ? { id, title: null, status: null }
        : { id, title: other.title, status: other.status }
    })
  return {
    ...task,
    statusToken: STATUS_TOKEN[task.status] ?? STATUS_TOKEN.pending,
    unlocks: show(unlocks),
    blockedByTasks: show(task.blockedBy),
    /** 需要 `review` 能力的任务在图上画橙色虚线框（ROADMAP §3.3 第 3 条："验证"是站点能力，不是一种角色）。 */
    needsReview: task.requires.includes('review'),
  }
}

/**
 * 左栏 chip 上的**短 id**（R45）。
 *
 * 为什么要有它：真机世界有 28 张单，左栏一个成员手上就有 5~7 张；每张都写 `task-28`
 * 等于把同一个前缀重复 N 遍，一个 300px 宽的列只能排成两三行（实测成员列内容 535px >
 * 容器 368px，最后几行被挤出去——`clipped()` 一眼就报出来了）。
 *
 * **短的只是显示**：`title` 与详情里仍然是完整 id（能复制、能对日志）。
 * 只对 `task-<数字>` 这种形状去前缀；别的形状（`hotfix-3`）原样保留，不猜。
 */
export function shortTaskId(id) {
  if (typeof id !== 'string') return ''
  const matched = /^task-(\d+)$/.exec(id)
  return matched === null ? id : matched[1]
}

/**
 * 看板要不要重画。
 *
 * 它是"**有没有任何对看板可见的变化**"的指纹：任务（状态/负责人/进度/标题/依赖/能力需求）
 * 与成员（名字/职业/状态/手上那张单）。
 *
 * **刻意不含 `world.tick`**：tick 一直在走，把它算进来就等于每次都重画；
 * 而看板只关心任务与成员的可见状态。这也是 `board.js update()` 的第一道闸门：
 * 指纹没变就**连模型都不折**（省掉 buildBoardModel + 布局 + 几何那三步）。
 */
export function boardSignature(world) {
  const parts = []
  for (const task of indexTasks(world?.tasks)) {
    const deps = Array.isArray(task.blockedBy) ? task.blockedBy.join(',') : ''
    const requires = Array.isArray(task.requires) ? task.requires.join(',') : ''
    parts.push(
      // 签名里带**产出的长度与失败原因的有无**（不是全文，代价要小）：产出是流式落地的，
      // 不带它的话详情区会在旁边更新后才刷新——用户点了单却看不到刚写好的结论。
      `t:${task.id}:${task.status}:${task.owner ?? ''}:${Math.round((task.progress ?? 0) * 100)}:${task.title ?? ''}:${deps}:${requires}:${typeof task.output === 'string' ? task.output.length : 0}:${task.failureReason ? 1 : 0}`,
    )
  }
  for (const agent of Array.isArray(world?.agents) ? world.agents : []) {
    parts.push(`a:${agent?.id}:${agent?.name ?? ''}:${agent?.role ?? ''}:${agent?.state ?? ''}:${agent?.carrying ?? ''}`)
  }
  parts.push(`n:${Array.isArray(world?.tasks) ? world.tasks.length : 0}/${Array.isArray(world?.agents) ? world.agents.length : 0}`)
  return parts.join('|')
}
