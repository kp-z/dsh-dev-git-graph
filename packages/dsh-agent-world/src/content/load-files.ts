/**
 * 外部内容包加载器（BACKLOG M1.5-1 / M1.5-3）。
 *
 * 把 `<rootDir>/<packId>/` 下的 JSON 读成 `ContentPack`。
 *
 * ## 目录形态
 *
 * ```
 * <rootDir>/
 *   my-town/                   ← 一个目录 = 一个包
 *     pack.json                ← manifest（必需）
 *     districts.json           ← 每个库一个文件，内容是条目数组
 *     stations.json
 *     scene.json   / scenes.json
 *     rosters.json
 *     tasks.json
 *     models.json
 *     actions.json
 *     skins.json
 *     sounds.json
 *     themes.json
 * ```
 *
 * 缺哪个库文件就是"这个包不提供那个库"，**不是错误**。
 *
 * ## 两条刻意的设计
 *
 * 1. **报错必须带文件路径**（M1.5-3）。内置内容写错了，报错只要说清是哪个条目的哪个字段；
 *    外部内容写错了，**第一件事是"我该去改哪个文件"**。所以这里把所有 Issue 的 `where`
 *    统一前缀成 `<包目录>/<文件>: <原来的位置>`。
 * 2. **不认识的 .json 文件一律警告**。`station.json`（单数）、`task.json` 这种拼错，
 *    症状是"站点一个都没有"，而报错什么都不说 —— 那种问题能耗掉一小时。宁可吵一点。
 *
 * ## 这个文件**不许**被 `content/index.ts` 导出
 *
 * 它 import 了 `node:fs`。`content/index.ts` 是给浏览器侧的 `web/` 也能 import 的入口，
 * 一旦把 fs 混进去，Vite 打包就会当场炸。所以它只由 host 侧的 `state.ts` 直接引用。
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { isAbsolute, join, relative, resolve } from 'node:path'
import { LIBRARY_SPECS } from './kinds.js'
import type { ContentPack, LibraryKind, PackManifest } from './kinds.js'
import { CONTENT_SCHEMA_VERSION } from './kinds.js'
import type { Issue } from './validate.js'
import { validatePack } from './validate.js'

/** 加载结果。 */
export interface LoadedPacks {
  packs: ContentPack[]
  issues: Issue[]
}

/** 外部内容根目录的解析结果。 */
export interface ResolvedContentRoot {
  /** 绝对路径；不需要外部内容时为 null。 */
  root: string | null
  /** 为什么是这个结果——要能原样打给用户看，否则"为什么没读到我的包"无从下手。 */
  reason: string
}

/**
 * 把配置里的 `contentDir` 解析成绝对路径。
 *
 * **策略是明确的，不含猜测**：
 * 1. 空字符串 → null（只用内置内容）。
 * 2. 绝对路径 → 原样使用。
 * 3. 相对路径 → 相对 `cwd`（宿主进程的工作目录，通常就是 workspace）。
 *
 * 刻意**不**去猜"当前 session 的 workspace"：`workspaceRegistry` 只提供 `list()` 与
 * `resolveByPath()`，没有"当前是哪个"的概念，多工作区时任何自动挑选都是猜。
 * 猜错的症状是"读到了另一个项目的包"，比"没读到"难查得多。
 * 需要精确指向时请写绝对路径。
 *
 * @param contentDir - 配置值。
 * @param cwd - 基准目录（由调用方注入，便于测试）。
 */
export function resolveContentRoot(contentDir: string, cwd: string): ResolvedContentRoot {
  const trimmed = contentDir.trim()
  if (trimmed === '') return { root: null, reason: 'contentDir 未配置，只用内置内容' }
  if (isAbsolute(trimmed)) return { root: resolve(trimmed), reason: `contentDir 是绝对路径` }
  return { root: resolve(cwd, trimmed), reason: `contentDir 是相对路径，按工作目录 ${cwd} 解析` }
}

/** 清单文件名。 */
const MANIFEST_FILE = 'pack.json'

/** 库文件名（不带 .json）。`scenes` 额外接受单数 `scene`。 */
function kindFileNames(kind: LibraryKind): string[] {
  if (kind === 'scenes') return ['scenes', 'scene']
  return [kind]
}

/** kind → 它接受的文件名集合（含 .json）。 */
function acceptedFiles(): Map<string, LibraryKind> {
  const map = new Map<string, LibraryKind>()
  for (const spec of LIBRARY_SPECS) {
    for (const name of kindFileNames(spec.kind)) map.set(`${name}.json`, spec.kind)
  }
  return map
}

/**
 * 把一个 Issue 的 where 前缀成"**具体文件** + 原位置"。
 *
 * 校验器给出的 where 是按库分的（`stations/station.x.kind`、`tasks[0].id`），
 * 它不知道文件叫什么。但用户需要知道的是"去改哪个文件"——只说包目录等于没说。
 * 所以这里按 where 的**首段**反查该库实际用的是哪个文件。
 *
 * @param issue - 校验器给的问题。
 * @param relDir - 包目录（相对内容根）。
 * @param filesOfKind - 这个包里 kind → 实际文件名（`stations` → `stations.json`）。
 */
function located(issue: Issue, relDir: string, filesOfKind: Map<LibraryKind, string>): Issue {
  for (const [kind, file] of filesOfKind) {
    // 匹配 `stations` / `stations/...` / `stations[0]...` 三种开头。
    if (issue.where === kind || issue.where.startsWith(`${kind}/`) || issue.where.startsWith(`${kind}[`)) {
      return { ...issue, where: `${relDir}/${file}: ${issue.where}` }
    }
  }
  // 清单自身的问题。
  if (issue.where.startsWith('pack.')) {
    return { ...issue, where: `${relDir}/${MANIFEST_FILE}: ${issue.where}` }
  }
  // 说不清是哪个文件的（例如跨库的通用问题），退回包目录。
  return { ...issue, where: `${relDir}: ${issue.where}` }
}

/** 读一个 JSON 文件；失败时返回一条带路径的 error。 */
function readJson(file: string, displayPath: string, issues: Issue[]): unknown {
  let text: string
  try {
    text = readFileSync(file, 'utf8')
  } catch (error) {
    issues.push({
      level: 'error',
      pack: null,
      where: displayPath,
      message: `读不了这个文件：${error instanceof Error ? error.message : String(error)}`,
    })
    return undefined
  }
  try {
    return JSON.parse(text) as unknown
  } catch (error) {
    issues.push({
      level: 'error',
      pack: null,
      where: displayPath,
      message: `JSON 语法错误：${error instanceof Error ? error.message : String(error)}。请在编辑器里定位这一行。`,
    })
    return undefined
  }
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

/**
 * 加载一个目录下的全部内容包。
 *
 * @param rootDir - 绝对路径。**这个函数不决定"内容目录在哪"**——那是调用方的事
 *   （`state.ts` 按配置与 workspace 解析）。这样它才能被临时目录直接测。
 * @returns 解析出的包与全部问题。`error` 级的包会被丢掉，不进入 `packs`。
 */
export function loadContentPacks(rootDir: string): LoadedPacks {
  const packs: ContentPack[] = []
  const issues: Issue[] = []
  const accepted = acceptedFiles()

  if (!existsSync(rootDir) || !statSync(rootDir).isDirectory()) {
    issues.push({
      level: 'warning',
      pack: null,
      where: rootDir,
      message: '内容目录不存在或不是目录，已跳过外部内容（只剩内置内容）。要么去掉这个配置，要么把目录建出来。',
    })
    return { packs, issues }
  }

  const entries = readdirSync(rootDir, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .sort() // 稳定顺序：否则包装载顺序会随文件系统变化，覆盖关系就飘了

  if (entries.length === 0) {
    issues.push({
      level: 'warning',
      pack: null,
      where: rootDir,
      message: '内容目录是空的（下面没有子目录）。每个子目录应当是一个内容包，最少要有一个 pack.json。',
    })
  }

  for (const packDirName of entries) {
    const packDir = join(rootDir, packDirName)
    const manifestFile = join(packDir, MANIFEST_FILE)
    const relDir = relative(rootDir, packDir) || packDirName

    if (!existsSync(manifestFile)) {
      issues.push({
        level: 'warning',
        pack: null,
        where: `${relDir}/`,
        message: `跳过这个目录：没有 ${MANIFEST_FILE}。子目录必须是一个内容包（最少有清单文件）；如果你只是想放别的东西，请挪出内容目录。`,
      })
      continue
    }

    const manifestPath = `${relDir}/${MANIFEST_FILE}`
    const rawManifest = readJson(manifestFile, manifestPath, issues)
    if (rawManifest === undefined) continue

    if (!isPlainObject(rawManifest)) {
      issues.push({
        level: 'error',
        pack: null,
        where: manifestPath,
        message: `${MANIFEST_FILE} 的顶层必须是一个对象（形如 { "id": "...", "name": "...", ... }）。`,
      })
      continue
    }

    const manifest = rawManifest as unknown as PackManifest
    const packId = typeof manifest.id === 'string' && manifest.id !== '' ? manifest.id : null

    // ── 逐个库文件 ──
    const packEntries: ContentPack['entries'] = {}
    /** kind → 实际用了哪个文件。报错时据此把用户指到具体文件，而不是"这个包里有问题"。 */
    const filesOfKind = new Map<LibraryKind, string>()
    const files = readdirSync(packDir).filter((f) => f.endsWith('.json') && f !== MANIFEST_FILE).sort()

    for (const file of files) {
      const kind = accepted.get(file)
      const displayPath = `${relDir}/${file}`
      if (kind === undefined) {
        issues.push({
          level: 'warning',
          pack: packId,
          where: displayPath,
          message:
            `不认识的库文件，已忽略。可用的文件名：${[...new Set([...accepted.keys()])].sort().join(' / ')}。` +
            '（最常见的是把复数写成了单数，例如 station.json 应当是 stations.json——那样站点会一个都加载不到。）',
        })
        continue
      }

      const raw = readJson(join(packDir, file), displayPath, issues)
      if (raw === undefined) continue

      // 允许两种写法：数组，或单个对象（`scene.json` 只有一条时少写一层方括号）。
      const list = Array.isArray(raw) ? raw : isPlainObject(raw) ? [raw] : undefined
      if (list === undefined) {
        issues.push({
          level: 'error',
          pack: packId,
          where: displayPath,
          message: `顶层必须是条目数组（或单个条目对象），得到 ${raw === null ? 'null' : typeof raw}。`,
        })
        continue
      }
      if (list.length === 0) {
        issues.push({
          level: 'warning',
          pack: packId,
          where: displayPath,
          message: '这个是空数组。如果本包不提供这个库，直接删掉这个文件即可（缺文件 = 不提供，不是错误）。',
        })
      }
      // 类型上 entries[kind] 是 EntryOf<kind>[]，这里经过 JSON.parse 无法静态确认，交由下层校验。
      ;(packEntries as Record<string, unknown>)[kind] = list
      filesOfKind.set(kind, file)
    }

    const pack: ContentPack = { manifest, entries: packEntries }

    // 交给统一的校验器查形状与引用（它会给出与内置内容完全一致的错误口径），
    // 只是把 where 统一加上文件路径。**不在这里自己再查一遍 schemaVersion**：
    // 校验器已经查了，重复报同一条错只会让人以为有两个问题。
    const merged = validatePack(pack).map((issue) => located(issue, relDir, filesOfKind))
    issues.push(...merged)

    if (merged.some((i) => i.level === 'error')) {
      issues.push({
        level: 'warning',
        pack: packId,
        where: `${relDir}/`,
        message: `这个包有错误，已整体跳过（不会加载它的一半）。修好上面的问题后会重新尝试。`,
      })
      continue
    }

    packs.push(pack)
  }

  return { packs, issues }
}
