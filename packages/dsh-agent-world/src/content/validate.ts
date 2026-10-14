/**
 * 内容校验（BACKLOG M1-2）。
 *
 * 校验的目标不是"类型对不对"（那是 tsc 的活），而是**引用完整性**与**声明一致性**——
 * 这类错误 tsc 抓不到，却会在运行时表现成"某个站点不见了""某个角色不会走路"，
 * 极难定位。所以宁可在加载时就红，也不要到了画面上才发现。
 *
 * 不用 schemastery/zod：校验器要同时跑在 host 与浏览器，而这个包对 schemastery 只是 peer
 * 依赖；更重要的是**报错文案要给内容作者看**（"任务库 X 的工单 Y 引用了不存在的能力 'cod'，
 * 可用值：code / review / …"），手写比 schema 库的默认输出省事得多。
 */
import { assetPathProblem } from './asset-path.js'
import type {
  Capability,
  DistrictKind,
  AgentState,
  StationKind,
} from '../domain/types.js'
import { LIBRARY_SPECS } from './kinds.js'
import type { ContentPack, LibraryKind, PackManifest } from './kinds.js'
import { CONTENT_SCHEMA_VERSION } from './kinds.js'
import type { ContentIssue, IssueLevel } from '../protocol/ports/content.js'

/**
 * 校验结果。**形状定义在协议层**（`protocol/ports/content.ts`），这里只转出——
 * 因为工具与面板要读它，而它们不该 import 内容层（决策 D16）。
 *
 * 保留 `Issue` 这个名字是有意的：它在内容层读写起来更顺，而且它与 `ContentIssue`
 * 是**同一个类型**（不是两份定义），所以不存在漂移风险。
 */
export type { IssueLevel }
export type Issue = ContentIssue

/** 可用取值表——报错时要列出来，光说"不合法"帮不上忙。 */
const CAPABILITIES: readonly Capability[] = [
  'code',
  'review',
  'research',
  'converse',
  'compute',
  'deliver',
  'rest',
]
const STATION_KINDS: readonly StationKind[] = ['desk', 'meeting', 'server', 'mailroom', 'lab', 'breakroom']
const DISTRICT_KINDS: readonly DistrictKind[] = ['engineering', 'meeting', 'infra', 'commons']
const AGENT_STATES: readonly AgentState[] = [
  'idle',
  'walking',
  'working',
  'talking',
  'blocked',
  'celebrating',
  'sleeping',
]
const ROLES = ['lead', 'engineer', 'reviewer', 'researcher', 'ops', 'docs']

/** 收集器：省得每个检查都手写 push。 */
class IssueSink {
  readonly issues: Issue[] = []

  error(where: string, message: string, pack: string | null = null): void {
    this.issues.push({ level: 'error', pack, where, message })
  }

  warn(where: string, message: string, pack: string | null = null): void {
    this.issues.push({ level: 'warning', pack, where, message })
  }
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

/** 判断一个值是否是允许的枚举取值，并给出带候选列表的报错文案。 */
function checkEnum<T extends string>(
  sink: IssueSink,
  value: unknown,
  allowed: readonly T[],
  where: string,
  what: string,
  pack: string,
): value is T {
  if (typeof value !== 'string' || !(allowed as readonly string[]).includes(value)) {
    sink.error(where, `${what} 取值 ${JSON.stringify(value)} 不合法。可用值：${allowed.join(' / ')}`, pack)
    return false
  }
  return true
}

/** 校验一个 id 是否非空字符串。 */
function checkId(sink: IssueSink, value: unknown, where: string, what: string, pack: string): boolean {
  if (typeof value !== 'string' || value.trim() === '') {
    sink.error(where, `${what} 必须是非空字符串，得到 ${JSON.stringify(value)}`, pack)
    return false
  }
  return true
}

/**
 * 校验单个包的**自洽性**（清单、条目形状、集合内部的引用）。
 *
 * 跨包的引用（站点引用的地块、场景引用的主题）在这里查不到，由 `validateRegistry` 在合并后查。
 */
export function validatePack(pack: ContentPack): Issue[] {
  const sink = new IssueSink()
  const m = pack.manifest as PackManifest | undefined
  const packId = m && typeof m.id === 'string' && m.id !== '' ? m.id : '<未知包>'

  // ── 清单 ──
  if (!isObject(m)) {
    sink.error('pack.manifest', '缺少 manifest', null)
    return sink.issues
  }
  checkId(sink, m.id, 'pack.manifest.id', '包 id', packId)
  checkId(sink, m.name, 'pack.manifest.name', '包名', packId)
  checkId(sink, m.version, 'pack.manifest.version', '包版本', packId)

  if (m.schemaVersion !== CONTENT_SCHEMA_VERSION) {
    sink.error(
      'pack.manifest.schemaVersion',
      `清单格式版本 ${JSON.stringify(m.schemaVersion)} 不受支持，当前只认 ${CONTENT_SCHEMA_VERSION}。请升级插件或转换内容包。`,
      packId,
    )
  }
  if (!Array.isArray(m.requires)) sink.error('pack.manifest.requires', 'requires 必须是数组（没有依赖就给空数组）', packId)
  if (!Array.isArray(m.provides)) sink.error('pack.manifest.provides', 'provides 必须是数组', packId)
  if (!Array.isArray(m.overrides)) sink.error('pack.manifest.overrides', 'overrides 必须是数组', packId)

  // provides 声明与实到条目的一致性——两个方向都查。
  const declared = new Set<LibraryKind>(Array.isArray(m.provides) ? (m.provides as LibraryKind[]) : [])
  for (const kind of declared) {
    if (!LIBRARY_SPECS.some((s) => s.kind === kind)) {
      sink.error('pack.manifest.provides', `声明了不存在的库 ${JSON.stringify(kind)}`, packId)
      continue
    }
    const list = pack.entries[kind]
    if (!Array.isArray(list) || list.length === 0) {
      sink.warn('pack.manifest.provides', `声明提供 ${kind} 库，但没有任何条目`, packId)
    }
  }
  for (const kind of Object.keys(pack.entries) as LibraryKind[]) {
    if (!declared.has(kind)) {
      sink.warn(
        `pack.entries.${kind}`,
        `有 ${kind} 条目但没在 manifest.provides 里声明——声明式清单的意义就是能一眼看出包提供了什么`,
        packId,
      )
    }
  }

  // ── 条目形状（逐库） ──
  const entryIds = new Map<LibraryKind, Set<string>>()
  for (const kind of Object.keys(pack.entries) as LibraryKind[]) {
    const list = pack.entries[kind]
    if (!Array.isArray(list)) continue
    const seen = new Set<string>()
    entryIds.set(kind, seen)

    list.forEach((entry, i) => {
      const where = `${kind}[${i}]`
      if (!isObject(entry)) {
        sink.error(where, '条目必须是对象', packId)
        return
      }
      const id = entry.id
      if (!checkId(sink, id, `${where}.id`, '条目 id', packId)) return
      const entryId = id as string
      if (seen.has(entryId)) {
        sink.error(`${where}.id`, `${kind} 库里 id "${entryId}" 重复`, packId)
      }
      seen.add(entryId)

      const spec = LIBRARY_SPECS.find((s) => s.kind === kind)
      if (spec && !entryId.startsWith(spec.idPrefix)) {
        sink.warn(
          `${where}.id`,
          `id "${entryId}" 不符合 ${kind} 库的命名约定（建议以 "${spec.idPrefix}" 开头）。只是提醒，不影响加载。`,
          packId,
        )
      }

      validateEntryShape(sink, kind, entry, `${kind}/${entryId}`, packId)
    })
  }

  // ── 集合内部引用（任务模板之间） ──
  validateIntraPackRefs(sink, pack, packId)

  return sink.issues
}

/** 逐库检查条目形状。 */
function validateEntryShape(
  sink: IssueSink,
  kind: LibraryKind,
  entry: Record<string, unknown>,
  where: string,
  pack: string,
): void {
  switch (kind) {
    case 'districts': {
      checkId(sink, entry.name, `${where}.name`, '地块名', pack)
      checkEnum(sink, entry.kind, DISTRICT_KINDS, `${where}.kind`, '地块种类', pack)
      const b = entry.bounds
      if (!isObject(b) || !isObject(b.min) || !isObject(b.max)) {
        sink.error(`${where}.bounds`, '必须有 bounds.min 与 bounds.max（各含 x/z）', pack)
      }
      checkId(sink, entry.ground, `${where}.ground`, '地面色 token', pack)
      return
    }
    case 'stations': {
      checkId(sink, entry.name, `${where}.name`, '站点名', pack)
      checkEnum(sink, entry.kind, STATION_KINDS, `${where}.kind`, '站点种类', pack)
      checkId(sink, entry.district, `${where}.district`, '所属地块 id', pack)
      if (!isObject(entry.anchor) || typeof entry.anchor.x !== 'number' || typeof entry.anchor.z !== 'number') {
        sink.error(`${where}.anchor`, '必须有 anchor.x 与 anchor.z（数字）', pack)
      }
      const caps = entry.capabilities
      if (!Array.isArray(caps) || caps.length === 0) {
        sink.error(
          `${where}.capabilities`,
          `必须至少声明一个能力，否则任务永远落不到这个站点上。可用值：${CAPABILITIES.join(' / ')}`,
          pack,
        )
      } else {
        caps.forEach((c, i) => checkEnum(sink, c, CAPABILITIES, `${where}.capabilities[${i}]`, '能力', pack))
      }
      if (typeof entry.capacity !== 'number' || entry.capacity < 1) {
        sink.error(`${where}.capacity`, 'capacity 必须是 ≥1 的数字', pack)
      }
      return
    }
    case 'scenes': {
      checkId(sink, entry.name, `${where}.name`, '场景名', pack)
      for (const f of ['districts', 'stations'] as const) {
        if (!Array.isArray(entry[f])) sink.error(`${where}.${f}`, `${f} 必须是 id 数组`, pack)
      }
      if (!isObject(entry.spawn) || typeof entry.spawn.x !== 'number' || typeof entry.spawn.z !== 'number') {
        sink.error(`${where}.spawn`, '必须有 spawn.x 与 spawn.z', pack)
      }
      if (typeof entry.groundSize !== 'number' || entry.groundSize <= 0) {
        sink.error(`${where}.groundSize`, 'groundSize 必须是正数', pack)
      }
      checkId(sink, entry.theme, `${where}.theme`, '主题 id', pack)
      checkId(sink, entry.roster, `${where}.roster`, '花名册 id', pack)
      return
    }
    case 'rosters': {
      checkId(sink, entry.name, `${where}.name`, '花名册名', pack)
      const seats = entry.seats
      if (!Array.isArray(seats) || seats.length === 0) {
        sink.error(`${where}.seats`, '至少需要一个席位', pack)
        return
      }
      let leads = 0
      seats.forEach((s, i) => {
        if (!isObject(s)) {
          sink.error(`${where}.seats[${i}]`, '席位必须是对象', pack)
          return
        }
        if (checkEnum(sink, s.role, ROLES, `${where}.seats[${i}].role`, '职业', pack) && s.role === 'lead') leads++
        checkId(sink, s.name, `${where}.seats[${i}].name`, '角色名', pack)
        checkId(sink, s.palette, `${where}.seats[${i}].palette`, '配色 token', pack)
      })
      if (leads !== 1) {
        sink.error(
          `${where}.seats`,
          `必须恰好有一个 lead（现在有 ${leads} 个）。零个 lead 就没人派单；多个 lead 就没法确定谁是工头。`,
          pack,
        )
      }
      return
    }
    case 'tasks': {
      checkId(sink, entry.name, `${where}.name`, '任务集名', pack)
      const tasks = entry.tasks
      if (!Array.isArray(tasks) || tasks.length === 0) {
        sink.error(`${where}.tasks`, '任务集至少要有一张工单', pack)
        return
      }
      const keys = new Set<string>()
      tasks.forEach((t, i) => {
        if (!isObject(t)) {
          sink.error(`${where}.tasks[${i}]`, '工单模板必须是对象', pack)
          return
        }
        const tw = `${where}.tasks[${i}]`
        if (!checkId(sink, t.key, `${tw}.key`, '工单 key', pack)) return
        const key = t.key as string
        if (keys.has(key)) sink.error(`${tw}.key`, `工单 key "${key}" 在集合内重复`, pack)
        keys.add(key)
        checkId(sink, t.title, `${tw}.title`, '标题', pack)
        checkId(sink, t.acceptance, `${tw}.acceptance`, '验收条件', pack)
        const req = t.requires
        if (!Array.isArray(req) || req.length === 0) {
          sink.error(`${tw}.requires`, '必须至少声明一个能力，否则调度器不知道派去哪', pack)
        } else {
          req.forEach((c, j) => checkEnum(sink, c, CAPABILITIES, `${tw}.requires[${j}]`, '能力', pack))
        }
        if (!Array.isArray(t.dependsOn)) sink.error(`${tw}.dependsOn`, 'dependsOn 必须是 key 数组（没有依赖就给空数组）', pack)
        if (t.role !== null && t.role !== undefined) {
          checkEnum(sink, t.role, ROLES, `${tw}.role`, '建议职业', pack)
        }
        if (t.estimateTicks !== null && t.estimateTicks !== undefined && (typeof t.estimateTicks !== 'number' || t.estimateTicks <= 0)) {
          sink.error(`${tw}.estimateTicks`, 'estimateTicks 要么是正数，要么是 null', pack)
        }
      })
      return
    }
    case 'models': {
      checkId(sink, entry.name, `${where}.name`, '模型名', pack)
      const src = entry.source
      if (!isObject(src) || (src.kind !== 'glb' && src.kind !== 'procedural')) {
        sink.error(`${where}.source`, 'source.kind 必须是 "glb" 或 "procedural"', pack)
      } else if (src.kind === 'glb') {
        // **不是 `checkId`**：它只检查"非空字符串"，而复用到路径字段上
        // 等于"任意字符串都能过"——那个洞就是这么来的（见 asset-path.ts 的头注释）。
        const urlProblem = assetPathProblem(src.url, 'GLB 地址')
        if (urlProblem !== null) sink.error(`${where}.source.url`, urlProblem, pack)
      } else {
        checkId(sink, src.builder, `${where}.source.builder`, '构建器名', pack)
      }
      return
    }
    case 'actions': {
      checkId(sink, entry.name, `${where}.name`, '动作名', pack)
      checkEnum(sink, entry.state, AGENT_STATES, `${where}.state`, '服务状态', pack)
      if (entry.clip !== null && typeof entry.clip !== 'string') {
        sink.error(`${where}.clip`, 'clip 要么是剪辑名字符串，要么是 null（表示程序化动画）', pack)
      }
      if (typeof entry.speedScale !== 'number' || entry.speedScale <= 0) {
        sink.error(`${where}.speedScale`, 'speedScale 必须是正数', pack)
      }
      return
    }
    case 'skins': {
      checkId(sink, entry.name, `${where}.name`, '皮肤名', pack)
      if (!isObject(entry.colors) || Object.keys(entry.colors).length === 0) {
        sink.error(`${where}.colors`, 'colors 不能为空', pack)
      }
      return
    }
    case 'sounds': {
      checkId(sink, entry.name, `${where}.name`, '音效名', pack)
      const urlProblem = assetPathProblem(entry.url, '音效地址')
      if (urlProblem !== null) sink.error(`${where}.url`, urlProblem, pack)
      return
    }
    case 'themes': {
      checkId(sink, entry.name, `${where}.name`, '主题名', pack)
      const cam = entry.camera
      if (!isObject(cam) || (cam.projection !== 'orthographic' && cam.projection !== 'perspective')) {
        sink.error(`${where}.camera`, 'camera.projection 必须是 "orthographic" 或 "perspective"', pack)
      }
      if (!isObject(entry.lighting)) sink.error(`${where}.lighting`, 'lighting 必须是对象', pack)
      if (!isObject(entry.post)) sink.error(`${where}.post`, 'post 必须是对象', pack)
      return
    }
  }
}

/** 检查包内部的引用（目前只有任务集里的 dependsOn）。 */
function validateIntraPackRefs(sink: IssueSink, pack: ContentPack, packId: string): void {
  const sets = pack.entries.tasks ?? []
  for (const set of sets) {
    const keys = new Set(set.tasks.map((t) => t.key))
    set.tasks.forEach((t) => {
      for (const dep of t.dependsOn) {
        if (!keys.has(dep)) {
          sink.error(
            `tasks/${set.id}/${t.key}.dependsOn`,
            `依赖的 key "${dep}" 不在同一个任务集里。任务集的依赖只能指向集合内部（可用 key：${[...keys].join(' / ')}）；` +
              '跨集合的依赖请把两个集合合并，或改用场景级编排。',
            packId,
          )
        }
      }
      if (t.dependsOn.includes(t.key)) {
        sink.error(`tasks/${set.id}/${t.key}.dependsOn`, '工单不能依赖自己', packId)
      }
    })

    // 环检测：有环的话这些工单永远到不了 ready，调度器会静默卡死。
    const cycle = findDependencyCycle(set.tasks)
    if (cycle) {
      sink.error(
        `tasks/${set.id}`,
        `依赖存在环：${cycle.join(' → ')}。有环的工单永远等不到 ready，调度器会静默卡住。`,
        packId,
      )
    }
  }
}

/** 找依赖环，返回环上的 key 序列；没有环返回 null。 */
export function findDependencyCycle(tasks: readonly { key: string; dependsOn: readonly string[] }[]): string[] | null {
  const byKey = new Map(tasks.map((t) => [t.key, t]))
  const state = new Map<string, 'visiting' | 'done'>()
  const stack: string[] = []

  const visit = (key: string): string[] | null => {
    const s = state.get(key)
    if (s === 'done') return null
    if (s === 'visiting') {
      const at = stack.indexOf(key)
      return [...stack.slice(at), key]
    }
    state.set(key, 'visiting')
    stack.push(key)
    for (const dep of byKey.get(key)?.dependsOn ?? []) {
      if (!byKey.has(dep)) continue // 缺失引用由上面的检查单独报，这里不重复
      const found = visit(dep)
      if (found) return found
    }
    stack.pop()
    state.set(key, 'done')
    return null
  }

  for (const t of tasks) {
    const found = visit(t.key)
    if (found) return found
  }
  return null
}
