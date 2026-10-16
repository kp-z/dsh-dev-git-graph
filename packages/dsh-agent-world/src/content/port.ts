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
