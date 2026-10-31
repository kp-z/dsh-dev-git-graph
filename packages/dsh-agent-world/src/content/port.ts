/**
 * 内容端口实现（BACKLOG M1.6-3）。
 *
 * 内容层对外**只暴露这个**：工具、路由、面板都通过 `ContentPort` 读内容，
 * 而不是 import `ContentRegistry` 这个具体类。
 *
 * 这样做的收益不是抽象的："换一套内容装载方式"（比如将来支持从 npm 装内容包、
 * 或从远端拉）只需要换掉这个文件的实现，工具与面板一行不动。
 */
import { LIBRARY_SPECS } from './kinds.js'
import type { IdleBehaviorPlan } from '../protocol/idle.js'
import type { ContentRegistry } from './registry.js'
import type { ContentIssue, ContentPort, ContentView, PackDescriptor } from '../protocol/ports/content.js'
import type { LibraryDescriptor } from '../protocol/library-kinds.js'
import type { ThemePlan } from '../protocol/theme.js'
import { resolveColor } from '../protocol/scene.js'

/**
 * 把内容里的主题映射成渲染就绪的 `ThemePlan`。
 *
 * ## 为什么这里必须做窄化（而不是强转）
 *
 * `ThemeEntry.lighting` 与 `.post` 在内容类型里是**刻意的自由结构**
 * （`Record<string, unknown>`，避免"每加一个光照效果就要改类型"）。
 * 代价正好落在这里：渲染器要的是确定结构，所以映射函数必须**一边读一边校验**。
 *
 * 用强转（`as`）也能过编译，但那只是把"字段写错了"从编译期推到运行期——
 * 而那时的表现是画面诡异，不是报错。所以这里逐个字段窄化，且缺省值集中在一处：
 * 渲染器里不该再散落 `?? 0.5` 这种兜底，否则真正的默认值没人说得清。
 */
function buildThemePlan(registry: ContentRegistry, sceneId: string): ThemePlan | null {
  const merged: Record<string, string> = {}
  for (const skin of registry.list('skins')) {
    for (const [token, value] of Object.entries(skin.data.colors)) merged[token] = value
  }

  // 复用协议层的解析器：`skin.` 这个约定本身就是跨边界的，两个实现一定会漂移，
  // 而漂移的症状是"某处少了一个颜色"，很难归因。
  const color = (value: unknown, fallback: string): string =>
    resolveColor(typeof value === 'string' ? value : null, merged, fallback)

  // `registry.get` 找不到时返回 undefined（不是 null）——这里统一成"没有就退出"。
  const sceneEntry = registry.get('scenes', sceneId)
  if (sceneEntry === undefined) return null
  const themeId = typeof sceneEntry.data.theme === 'string' ? sceneEntry.data.theme : null
  if (themeId === null) return null
  const entry = registry.get('themes', themeId)
  if (entry === undefined) return null

  // ── 窄化小工具 ──
  const obj = (v: unknown): Record<string, unknown> =>
    typeof v === 'object' && v !== null ? (v as Record<string, unknown>) : {}
  const has = (o: Record<string, unknown>): boolean => Object.keys(o).length > 0
  const num = (v: unknown, fallback: number): number => (typeof v === 'number' && Number.isFinite(v) ? v : fallback)
  const str = (v: unknown, fallback: string): string => (typeof v === 'string' && v !== '' ? v : fallback)
  const bool = (v: unknown, fallback: boolean): boolean => (typeof v === 'boolean' ? v : fallback)

  const d = entry.data
  const lighting = obj(d.lighting)
  const hemi = obj(lighting.hemisphere)
  const dir = obj(lighting.directional)
  const dirPos = obj(dir.position)
  const amb = obj(lighting.ambient)
  const post = obj(d.post)
  const bloom = obj(post.bloom)
  const fog = d.fog

  return {
    id: entry.id,
    name: entry.data.name,
    camera: {
      projection: d.camera.projection === 'perspective' ? 'perspective' : 'orthographic',
      yawDeg: num(d.camera.yawDeg, 45),
      pitchDeg: num(d.camera.pitchDeg, 35.264),
      fov: typeof d.camera.fov === 'number' ? d.camera.fov : null,
      zoom: num(d.camera.zoom, 1),
    },
    fog:
      fog === null || fog === undefined
        ? null
        : { color: color(fog.color, '#DCE3EA'), density: num(fog.density, 0.01) },
    lighting: {
      hemisphere: has(hemi)
        ? { sky: color(hemi.sky, '#FFFFFF'), ground: color(hemi.ground, '#666666'), intensity: num(hemi.intensity, 0.5) }
        : null,
      directional: has(dir)
        ? {
            color: color(dir.color, '#FFFFFF'),
            intensity: num(dir.intensity, 1),
            position: { x: num(dirPos.x, 10), y: num(dirPos.y, 18), z: num(dirPos.z, 8) },
            castShadow: bool(dir.castShadow, true),
            shadowMapSize: num(dir.shadowMapSize, 2048),
          }
        : null,
      ambient: has(amb) ? { color: color(amb.color, '#FFFFFF'), intensity: num(amb.intensity, 0.2) } : null,
    },
    post: {
      toneMapping: str(post.toneMapping, 'ACESFilmic'),
      exposure: num(post.exposure, 1),
      bloom: {
        enabled: bool(bloom.enabled, false),
        threshold: num(bloom.threshold, 0.9),
        strength: num(bloom.strength, 0.35),
      },
    },
  }
}

/**
 * 把注册表与装载期问题包成一个只读端口。
 *
 * @param registry - 已装载的注册表。
 * @param issues - 装载期问题（内置 + 外部）。
 * @param externalRoot - 实际读取的外部内容目录；没配就是 null。
 */
export function contentPortOf(
  registry: ContentRegistry,
  issues: readonly ContentIssue[],
  externalRoot: string | null,
): ContentPort {
  const view = (): ContentView => {
    const packs: PackDescriptor[] = registry.packs.map((m) => ({
      id: m.id,
      name: m.name,
      version: m.version,
      schemaVersion: m.schemaVersion,
      requires: [...m.requires],
      provides: [...m.provides],
      overrides: [...m.overrides],
    }))

    // 条目数为 0 的库也列出来：`provides` 里声明了却空着，本身就是要看的信息。
    const libraries: LibraryDescriptor[] = LIBRARY_SPECS.map((spec) => ({
      kind: spec.kind,
      layer: spec.layer,
      title: spec.title,
      count: registry.size(spec.kind),
    }))

    return { packs, libraries, issues: [...issues], externalRoot }
  }

  return {
    view,
    providersOf: (kind, id) => registry.providersOf(kind, id),
    entryIds: (kind) => registry.list(kind).map((e) => e.id),
    entrySummaries: (kind) =>
      registry.list(kind).map((e) => {
        const raw = (e.data as { name?: unknown }).name
        return { id: e.id, name: typeof raw === 'string' && raw.trim() !== '' ? raw : null }
      }),
    colors: () => {
      // 按 list 的顺序叠加（list 已按 id 排序，稳定）；后出现的覆盖先出现的。
      const merged: Record<string, string> = {}
      for (const skin of registry.list('skins')) {
        for (const [token, value] of Object.entries(skin.data.colors)) merged[token] = value
      }
      return merged
    },
    themeFor: (sceneId) => buildThemePlan(registry, sceneId),
    /**
     * **待命行为目录**（R68）：把 `actions` 库投影成模拟内核能吃的纯数据。
     *
     * ## 为什么是"投影"而不是"直接给 ActionEntry"
     *
     * `sim/` 不许 import 内容库（边界规则），所以只能给它纯数据。这里做三件事：
     * 挑出**待命能用的**动作、补上 sim 需要而内容还没表达的字段、以及把
     * `band: null` 的动作**如实带过去**（让 sim 自己跳过，而不是在这里悄悄换成别的带）。
     *
     * ## 时长与踱步半径从哪来
     *
     * 内容目前只声明了 `band` / `weight`（R60 加的），**没有**时长与踱步半径。
     * 这里给的是**保守默认值**（时长 90~240 tick ≈ 9~24 秒；原地不动），
     * 并把"要按行为区分时长"这件事留给内容——见下面 `idleDurationOf` 的注释。
     * 我刻意**不**在代码里写一张"哪个动作多长"的表：那就是把表现写进代码（违反 D37）。
     */
    idleBehaviors: () => {
      // 把**内容侧**的 `ActionEntry.idle`（`IdleBehaviorSpec`：kind / ticksMin / ticksMax / radius）
      // 投影成 **sim 侧**的 `IdleBehaviorPlan`。
      //
      // 这里做**过滤**而不是把 `band` 传给 sim：`band: null` 表示图集里没有那条带，
      // 也就是"2D 里画不出来"。**画不出来就不该被选成待命行为**——否则角色会站着不动，
      // 而数据说他在"张望"。但"为什么画不出来"是渲染的事，**不该泄漏进 sim**
      //（模拟内核只认已经装配好的数据，不认图集）。
      //
      // 两个类型**同名不同类型**比重复更坏：我第一版两边都叫 `IdleBehaviorSpec`，
      // 于是这里引协议层的、`entry.data.idle` 是内容层的 → 属性对不上、10 条 TS 错。
      const out: IdleBehaviorPlan[] = []
      for (const entry of registry.list('actions')) {
        const action = entry.data
        const spec = action.idle
        // `null` = 这条动作**没有待命语义**（例如 `action.walk` 是移动的结果，不是待命行为）。
        if (spec === null || spec === undefined) continue
        // 图集里没有这条带 → 2D 演不出来 → 不参与选择。
        if (action.band === null) continue
        // 两侧**同名**（`ticksMin`/`ticksMax`）——见 `protocol/idle.ts` 里那段注释：
        // 我一度让两侧各叫一个名字，结果被当成同一个类型，在同一处来回改了三次。
        const ticksMin = Math.max(1, Math.floor(spec.ticksMin))
        out.push({
          id: action.id,
          kind: spec.kind,
          weight: Number.isFinite(action.weight) && action.weight > 0 ? action.weight : 1,
          ticksMin,
          ticksMax: Math.max(ticksMin, Math.floor(spec.ticksMax)),
          radius: Math.max(0, spec.radius),
        })
      }
      return out
    },
    /**
     * 场景底图（R62）。按场景 id 取：`scenes` 条目上的 `map` 字段指向 `maps` 库里的底图。
     * 之前这里取"maps 库里第一条"——于是默认小镇也拿到原版办公室的底图，家具画了两遍
     * （底图烘一遍 + 站点 props 再摆一遍）。改成按场景查：没声明底图就返回 null。
     */
    map: (sceneId) => {
      const sceneEntry = registry.get('scenes', sceneId)
      const mapId = typeof sceneEntry?.data?.map === 'string' ? sceneEntry.data.map : null
      if (mapId === null) return null
      const entry = registry.get('maps', mapId)
      if (entry === undefined) return null
      const m = entry.data
      return {
        url: m.url,
        width: m.width,
        height: m.height,
        cellPx: m.cellPx,
        unitsPerCell: m.unitsPerCell,
        ...(m.occupancy === undefined ? {} : { occupancy: m.occupancy }),
        ...(m.occupancyRects === undefined ? {} : { occupancyRects: m.occupancyRects }),
      }
    },
    /**
     * 状态 → 动作的映射（R60）。**渲染器不许自己写死这条映射**——
     * 在此之前 2D 渲染器硬编码 `walking ? 'walk' : 'idle'`，内容库里的
     * `action.work` / `action.talk` 全是摆设，而"表现是内容"是我们自己的红线（D31）。
     */
    actions: () =>
      registry.list('actions').map((e) => ({
        id: e.id,
        name: e.data.name,
        state: e.data.state,
        // `band` 缺省 null = **如实声明 2D 图集里没有这个动作**，渲染器要退回而不是硬播。
        band: e.data.band ?? null,
        // 缺省 1：老内容包没写 weight 也能跑。
        weight: typeof e.data.weight === 'number' ? e.data.weight : 1,
        speedScale: e.data.speedScale,
        fadeMs: e.data.fadeMs,
      })),
    modelOf: (id) => {
      // `get` 返回的是 `{ id, pack, data }`（解析结果），条目本身在 `data` 里。
      const resolved = registry.get('models', id)
      if (resolved === undefined) return null
      const { source, scale, rotationY, anchorY } = resolved.data
      // 映射在这里做（而不是让渲染器读 `ModelEntry`）：只有内容层知道条目的原始形状。
      if (source.kind === 'procedural') {
        return { id, builder: source.builder, url: null, sheet: null, scale, rotationY, anchorY }
      }
      if (source.kind === 'glb') {
        return { id, builder: null, url: source.url, sheet: null, scale, rotationY, anchorY }
      }
      // 像素图集（R51）：把 `SheetSpec` 摊成渲染器要的形状。
      // 缺省值在这里补（`layout` 缺省 `row`、`mirror` 缺省 false），所以内容作者只写必要的东西。
      const animations: Record<string, { col: number; row: number; frames: number; frameMs: number; layout: 'row' | 'column'; mirror: boolean }> = {}
      for (const [name, a] of Object.entries(source.sheet.animations)) {
        animations[name] = {
          col: a.col,
          row: a.row,
          frames: a.frames,
          frameMs: a.frameMs,
          layout: a.layout ?? 'row',
          mirror: a.mirror === true,
        }
      }
      return {
        id,
        builder: null,
        url: source.url,
        sheet: {
          cellW: source.sheet.cellW,
          cellH: source.sheet.cellH,
          rowsPerFigure: source.sheet.rowsPerFigure,
          anchor: source.sheet.anchor,
          animations,
          // 缺省 false（不染）——别人画好的美术默认不动，见 `SheetSpec.recolor`。
          recolor: source.sheet.recolor === true,
        },
        scale,
        rotationY,
        anchorY,
      }
    },
  }
}
