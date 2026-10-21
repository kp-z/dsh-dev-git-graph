/**
 * 世界 API（BACKLOG M3-3）。
 *
 * 两个端点：
 * - `GET  /api/world`   全量快照（面板建连、或发现 seq 断裂时拉它）
 * - `POST /api/command` 把一条世界命令排进下一步
 *
 * ## 传输层不做业务判断
 *
 * 这里只做三件事：从端口取状态、把命令形状校验一遍、排进队列。
 * "该不该暂停""谁去做哪张单"都是模拟内核的事——传输层多一句判断，
 * 以后经工具走的那条路就会和它漂移。
 */
import { readFileSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { RouteEntry } from './router.js'
import { HttpError } from './router.js'
import type {
  RuntimePort,
  SnapshotMessage,
  WorldCommand,
  WorldServicePort,
  World,
} from '../protocol/index.js'
import { buildScenePlan } from '../scene/plan.js'
import { buildSceneSpace } from '../scene/space.js'
import type { FineRect } from '../scene/space.js'
import {
  PROTOCOL_VERSION,
  WORLD_COMMAND_KINDS,
  describeCommand,
  isWorldCommand,
} from '../protocol/index.js'

/** 建 API 路由需要的依赖。 */
export interface ApiDeps {
  service: WorldServicePort
  runtime: RuntimePort
  tickMs: number
  /**
   * 这个世界对应的 DSH 会话（队长会话）的**可读名字**（R162）。
   *
   * 为什么不放进快照：标题要异步读 session 日志（`sessionQuery.readTitle`），
   * 而 `buildSnapshot` 是同步的；单独一个小端点在页面加载后取一次，
   * 拿不到时调用方退回 teamName / captainSessionId，不编一个假名字。
   */
  worldSession?: () => Promise<{ id: string; teamName: string; title: string | null }>
  /** 切到某个会话自己的世界（R166）；由组合根负责停/起 ticker。 */
  activateSession?: (sessionId: string) => World | Promise<World>
  /** 关闭视图时保存并卸下当前会话世界。 */
  deactivateSession?: () => void
  /** 只读读取该会话最近的 agent-teams staged plan（R175）。 */
  teamPlan?: (sessionId: string) => Promise<unknown>
  /** 只读读取 experimental agent-teams roster/tasks（R176）。 */
  teamRoster?: (sessionId: string) => Promise<unknown>
  /** 官方 agentTeams 任务写入：create / CAS update（R179）。 */
  teamTask?: (payload: Record<string, unknown>) => Promise<unknown>
  /** 读取某个 Agent 对应的 DSH 会话历史。 */
  history?: (agentId: string) => Promise<unknown>
}

/**
 * 造一份快照载荷。
 *
 * **刻意丢掉 `world.events`**：面板要轮询它，带上最近 500 条事件会让一个快照到几百 KB，
 * 而面板根本不需要历史——历史由 `events` 增量推（M3-4）。
 */
/**
 * 精细碰撞体缓存：`地图 url` → `rects`。
 *
 * 文件与底图同源（`office.png` ↔ `office-colliders.json`），放在 `src/vendor/`。
 * 读不到就返回 null（没有精细数据时 `buildSceneSpace` 会按整格补，行为仍然正确）。
 */
const fineRectCache = new Map<string, { mtime: number; rects: readonly FineRect[] | null }>()

/** 手改碰撞体的覆盖文件：与 `*-colliders.json` 同目录，存在就**完全替代**自动数据。 */
function overridePathFor(mapUrl: string, root = join(dirname(fileURLToPath(import.meta.url)), '../vendor')): string {
  return join(root, mapUrl.replace(/\.png$/i, '-colliders-override.json'))
}

function readOverride(mapUrl: string): readonly FineRect[] | null {
  try {
    const raw = JSON.parse(readFileSync(overridePathFor(mapUrl), 'utf8')) as { rects?: unknown }
    if (!Array.isArray(raw.rects)) return null
    const rects = raw.rects.filter((r): r is FineRect =>
      Array.isArray(r) && r.length >= 4 && r.every((v) => Number.isFinite(v)) && r[2] > 0 && r[3] > 0,
    )
    return rects.length > 0 ? rects : null
  } catch {
    return null
  }
}

function fineRectsFor(mapUrl: string): readonly FineRect[] | null {
  const override = readOverride(mapUrl)
  if (override !== null) return override
  const vendorRoot = join(dirname(fileURLToPath(import.meta.url)), '../vendor')
  const file = join(vendorRoot, mapUrl.replace(/\.png$/i, '-colliders.json'))
  let mtime = 0
  try { mtime = statSync(file).mtimeMs } catch { mtime = 0 }
  const cached = fineRectCache.get(mapUrl)
  if (cached !== undefined && cached.mtime === mtime) return cached.rects
  let rects: readonly FineRect[] | null = null
  try {
    const raw = JSON.parse(readFileSync(file, 'utf8')) as { rects?: unknown }
    if (Array.isArray(raw.rects)) rects = raw.rects as FineRect[]
  } catch {
    rects = null
  }
  fineRectCache.set(mapUrl, { mtime, rects })
  return rects
}

/**
 * 手改碰撞体保存（`?edit=1` 的编辑器 → 这里）。
 *
 * 写两份：
 * - 宿主实际读取的 `lib/vendor/...`（`import.meta.url` 旁边）；
 * - 仓库源码 `src/vendor/...`（`cwd` 下，存在才写），下次构建不会丢。
 *
 * 只接受**当前场景的地图**，避免变成任意路径写文件。
 */
function saveOverride(mapUrl: string, rects: readonly FineRect[]): number {
  const source = join(process.cwd(), 'packages/dsh-agent-world/src/vendor', mapUrl.replace(/\.png$/i, '-colliders-override.json'))
  const host = overridePathFor(mapUrl)
  const payload = JSON.stringify({ rects, savedAt: new Date().toISOString() })
  for (const target of new Set([source, host])) {
    try { writeFileSync(target, payload) } catch { /* 源码目录不存在就算了，宿主那份必须写 */ }
  }
  fineRectCache.clear()
  return rects.length
}

export function buildSnapshot(deps: ApiDeps): SnapshotMessage {
  const world = deps.service.currentWorld()
  if (world === null) {
    throw new HttpError(503, '世界还没建出来。这通常是内容层有错误——见 agent_world_content 的输出。')
  }
  const { events: _events, ...slim } = world
  const content = deps.service.content()
  const view = content.view()

  return {
    v: PROTOCOL_VERSION,
    type: 'snapshot',
    seq: world.seq,
    world: slim,
    // 面板只许 import 协议层、读不到内容库，所以调色板必须在这儿解析好发出去。
    palette: { ...content.colors() },
    // 渲染就绪的"要摆什么"。**这是渲染层的唯一输入**：2D canvas 画它，
    // 将来的 three.js（不管是我们写的还是现成场景）也画它。
    scene: (() => {
      const mapEntry = content.map(world.origin.scene)
      const plan = buildScenePlan(
        world,
        content.colors(),
        content.themeFor(world.origin.scene),
        (id) => content.modelOf(id),
        // 状态 → 动作（R60）：**来自内容库**，渲染器不许自己写死这条映射。
        () => content.actions(),
        // 场景底图（R62）：按场景取——只有声明了底图的场景才有（否则 null，按分区铺色）。
        () => mapEntry,
      )
      // R227：把「nav + 精细碰撞体 + 站点」合成**一套**空间数据，随快照一次下发。
      // 渲染器不再自己 fetch `*-colliders.json`，也不再拿 nav 二次拼——三份数据从此同源。
      //
      // R233：手改覆盖存在时，**完全以覆盖为准**（连美术占位也关掉），
      // 编辑器保存什么就是什么，不再被自动推导"补"回来。
      const override = mapEntry === null || mapEntry.url === null ? null : readOverride(mapEntry.url)
      plan.space = buildSceneSpace({
        nav: world.nav,
        fineRects: override ?? (mapEntry === null || mapEntry.url === null ? null : fineRectsFor(mapEntry.url)),
        stations: world.stations,
        occupancyCells: override === null && mapEntry !== null ? mapEntry.occupancy ?? null : null,
        occupancyRects: override === null && mapEntry !== null ? mapEntry.occupancyRects ?? null : null,
        override: override !== null,
      })
      return plan
    })(),
    runtime: {
      running: deps.runtime.running,
      pending: deps.runtime.pending,
      tickMs: deps.tickMs,
      messageDeliveryTicks: deps.runtime.messageDeliveryTicks,
      diagnostics: { ...deps.runtime.diagnostics },
    },
    content: {
      packs: view.packs.map((p) => ({ id: p.id, name: p.name, version: p.version })),
      libraries: [...view.libraries],
    },
    // 流水线目录：id → 中文名（内容，前端读不到内容库，所以在这里解析下发）。
    taskSets: content.entrySummaries('tasks').map((e) => ({ id: e.id, name: e.name })),
  }
}

/** 处理一条世界命令。 */
export function applyCommand(deps: ApiDeps, body: unknown): Record<string, unknown> {
  // 没有世界时必须**立刻**拒绝：命令要等 `step()` 的 ingest 段才生效，
  // 而没有世界就没有下一步——排进队列等于石沉大海，而用户只会看到"点了没反应"。
  if (deps.service.currentWorld() === null) {
    throw new HttpError(503, '世界还没建出来，命令无处可施。这通常是内容层有错误。')
  }
  if (typeof body !== 'object' || body === null) {
    throw new HttpError(400, '请求体要形如 {"command":{"kind":"pause"}} 的对象。')
  }
  const command = (body as { command?: unknown }).command
  if (command === undefined) {
    throw new HttpError(400, '请求体缺少 `command` 字段。形如 {"command":{"kind":"pause"}}。')
  }
  if (!isWorldCommand(command)) {
    throw new HttpError(
      400,
      `无法识别的命令 ${JSON.stringify(command ?? null)}。可用 kind：${WORLD_COMMAND_KINDS.join(' / ')}。`,
    )
  }
  // 入队而不是立刻执行——见 RuntimePort.enqueue 的说明（命令要经 ingest 段才不破坏确定性）。
  deps.runtime.enqueue(command as WorldCommand)
  return {
    accepted: true,
    command: describeCommand(command as WorldCommand),
    pending: deps.runtime.pending,
  }
}

/** 造 API 路由表。 */
export function apiRoutes(deps: ApiDeps): RouteEntry[] {
  return [
    {
      method: 'GET',
      pattern: '/api/world',
      handler: () => buildSnapshot(deps),
    },
    {
      method: 'POST',
      pattern: '/api/command',
      handler: (request) => applyCommand(deps, request.body),
    },
    {
      method: 'POST',
      pattern: '/api/space-override',
      handler: (request) => {
        const body = request.body as { mapUrl?: unknown; rects?: unknown } | undefined
        const mapUrl = typeof body?.mapUrl === 'string' ? body.mapUrl : ''
        if (!/^[a-z0-9/_-]+\.png$/i.test(mapUrl)) throw new HttpError(400, 'mapUrl 形如 microverse/scene/office.png')
        const raw = body?.rects
        if (!Array.isArray(raw)) throw new HttpError(400, 'rects 必须是数组')
        const rects: FineRect[] = []
        for (const item of raw) {
          if (!Array.isArray(item) || item.length < 4) throw new HttpError(400, '每条 rect 形如 [x,y,w,h]')
          const x = Number(item[0] ?? NaN)
          const y = Number(item[1] ?? NaN)
          const w = Number(item[2] ?? NaN)
          const h = Number(item[3] ?? NaN)
          if (![x, y, w, h].every((v) => Number.isFinite(v))) throw new HttpError(400, 'rect 必须是有限数')
          if (!(w > 0) || !(h > 0)) throw new HttpError(400, 'rect 的 w/h 必须 > 0')
          rects.push([Math.round(x), Math.round(y), Math.round(w), Math.round(h)])
        }
        const count = saveOverride(mapUrl, rects)
        return { ok: true, count }
      },
    },
    {
      method: 'POST',
      pattern: '/api/activate',
      handler: async (request) => {
        const body = request.body as { sessionId?: unknown } | undefined
        const sessionId = typeof body?.sessionId === 'string' ? body.sessionId.trim() : ''
        if (sessionId === '') throw new HttpError(400, 'activate 需要 {"sessionId":"…"}')
        if (typeof deps.activateSession !== 'function') throw new HttpError(503, '这个宿主不支持会话级世界')
        const world = await deps.activateSession(sessionId)
        return { ok: true, sessionId, worldId: world.id, tick: world.tick, agents: world.agents.length }
      },
    },
    {
      method: 'POST',
      pattern: '/api/deactivate',
      handler: () => {
        deps.deactivateSession?.()
        return { ok: true }
      },
    },
    {
      method: 'POST',
      pattern: '/api/team/task',
      handler: async (request) => {
        const body = request.body
        if (typeof body !== 'object' || body === null || typeof deps.teamTask !== 'function') {
          return { ok: false, error: '任务写入不可用' }
        }
        try {
          return await deps.teamTask(body as Record<string, unknown>)
        } catch (error) {
          return { ok: false, error: error instanceof Error ? error.message : String(error) }
        }
      },
    },
    {
      method: 'GET',
      pattern: '/api/team',
      handler: async (request) => {
        const sessionId = request.query.get('session') ?? ''
        if (sessionId === '' || typeof deps.teamRoster !== 'function') return { team: null }
        try {
          return { team: await deps.teamRoster(sessionId) }
        } catch (error) {
          return { team: { available: false, reason: error instanceof Error ? error.message : String(error) } }
        }
      },
    },
    {
      method: 'GET',
      pattern: '/api/history',
      handler: async (request) => {
        const agentId = request.query.get('agent') ?? ''
        if (agentId === '' || typeof deps.history !== 'function') return { ok: false, messages: [] }
        try {
          return await deps.history(agentId)
        } catch (error) {
          return { ok: false, messages: [], error: error instanceof Error ? error.message : String(error) }
        }
      },
    },
    {
      method: 'GET',
      pattern: '/api/team/plan',
      handler: async (request) => {
        const sessionId = request.query.get('session') ?? ''
        if (sessionId === '' || typeof deps.teamPlan !== 'function') return { plan: null }
        try {
          return { plan: await deps.teamPlan(sessionId) }
        } catch {
          return { plan: null }
        }
      },
    },
    {
      method: 'GET',
      pattern: '/api/session',
      handler: async () => {
        if (typeof deps.worldSession !== 'function') {
          return { id: null, teamName: null, title: null }
        }
        return await deps.worldSession()
      },
    },
  ]
}
