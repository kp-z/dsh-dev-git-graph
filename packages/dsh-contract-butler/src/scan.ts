/**
 * 项目扫描：遍历文件树、按 `match()` 分派给抽取器、汇总候选。
 *
 * 三条刻意的克制：
 * - **有上限。** `maxFiles` 一到就停，并把 `truncated` 如实报出去——宁可让用户知道"没扫完"，
 *   也不要静默地给出一个看起来完整、实际残缺的契约集合。
 * - **单文件失败不致命。** 解析不了的进 `errors`，其余照常产出。一个畸形文件不该让整次
 *   纳管白跑。
 * - **增量优先。** 已经知道是哪几个文件变了（监视器给的），就只读这几个，不重复走全树。
 */
import { readFile, readdir, stat } from 'node:fs/promises'
import { isAbsolute, join, relative, sep } from 'node:path'
import { linkTwins } from './extract/registry.js'
import type { Extractor } from './extract/registry.js'
import type { Candidate, ScanResult } from './types.js'

/** 单文件大小上限：超过就不解析（大文件通常是产物或数据，不是契约声明）。 */
const MAX_FILE_BYTES = 2 * 1024 * 1024

/** 默认排除的目录名。 */
export const DEFAULT_EXCLUDE_DIRS = [
  'node_modules',
  '.git',
  'dist',
  'lib',
  'build',
  'out',
  'coverage',
  '.next',
  '.nuxt',
  '.turbo',
  '.cache',
  '.venv',
  'venv',
  '__pycache__',
  'target',
  'vendor',
]

/** 扫描选项。 */
export interface ScanOptions {
  /** 项目根（绝对路径）。 */
  root: string
  /** 排除的目录名。 */
  excludeDirs: string[]
  /** 文件数上限。 */
  maxFiles: number
  /** 参与分派的抽取器。 */
  extractors: Extractor[]
  /** 只扫这些相对路径（增量重扫用）；`undefined` 表示走全树。 */
  only?: string[]
  /** 是否读 `.gitignore` 并遵守它（默认遵守）。 */
  honorGitignore?: boolean
}

/** 一次扫描过程。 */
/**
 * 只列出会被扫描的文件（不做抽取）。
 *
 * 轮询兜底需要一份"这个项目里有哪些文件"的清单，并且必须与扫描器用**同一套**排除规则——
 * 两边规则一旦不一致，轮询就会不断报出扫描器根本不看的文件（比如产物目录），把重扫变成空转。
 * @param root - 项目根。
 * @param excludeDirs - 排除的目录名。
 * @param maxFiles - 文件数上限。
 * @returns 相对路径清单（POSIX 分隔符）与截断标志。
 */
export async function listProjectFiles(
  root: string,
  excludeDirs: string[],
  maxFiles: number,
  honorGitignore = true,
): Promise<{ files: string[]; truncated: boolean }> {
  const ignore = honorGitignore ? await loadGitignore(root) : () => false
  const walk = await walkFiles(root, excludeDirs, ignore, maxFiles)
  return { files: walk.files, truncated: walk.truncated }
}

export async function scanProject(options: ScanOptions): Promise<ScanResult> {
  const started = Date.now()
  const errors: { file: string; message: string }[] = []
  const candidates: Candidate[] = []
  let filesSeen = 0
  let truncated = false

  const read = (relativePath: string): Promise<string | null> => readTextFile(options.root, relativePath)

  const ignore = (options.honorGitignore ?? true) ? await loadGitignore(options.root) : () => false

  const asked = options.only
  const targets: string[] = []
  if (asked !== undefined) {
    for (const file of asked) {
      if (targets.length >= options.maxFiles) {
        truncated = true
        break
      }
      targets.push(file)
    }
  } else {
    const walk = await walkFiles(options.root, options.excludeDirs, ignore, options.maxFiles)
    targets.push(...walk.files)
    truncated = walk.truncated
    if (walk.errors.length > 0) errors.push(...walk.errors)
  }

  for (const file of targets) {
    filesSeen += 1
    const text = await read(file)
    if (text === null) continue
    for (const extractor of options.extractors) {
      if (!extractor.match(file)) continue
      try {
        const found = await extractor.extract(file, text, { root: options.root, read })
        for (const candidate of found) candidates.push(candidate)
      } catch (error) {
        errors.push({ file, message: messageOf(error) })
      }
    }
  }

  return {
    candidates: linkTwins(candidates),
    filesSeen,
    truncated,
    errors,
    durationMs: Date.now() - started,
  }
}

/** 读项目内文件；越界或读不到返回 null。 */
async function readTextFile(root: string, relativePath: string): Promise<string | null> {
  const absolute = isAbsolute(relativePath) ? relativePath : join(root, relativePath)
  if (!isInside(root, absolute)) return null
  try {
    const info = await stat(absolute)
    if (!info.isFile() || info.size > MAX_FILE_BYTES) return null
    return await readFile(absolute, 'utf8')
  } catch {
    return null
  }
}

/** `child` 是否在 `root` 之内。 */
export function isInside(root: string, child: string): boolean {
  const rel = relative(root, child)
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel))
}

/** 遍历结果。 */
interface WalkResult {
  files: string[]
  truncated: boolean
  errors: { file: string; message: string }[]
}

/** 广度优先遍历，按目录名排序保证顺序稳定。 */
async function walkFiles(
  root: string,
  excludeDirs: string[],
  ignore: (relativePath: string, isDir: boolean) => boolean,
  maxFiles: number,
): Promise<WalkResult> {
  const files: string[] = []
  const errors: { file: string; message: string }[] = []
  const excluded = new Set(excludeDirs)
  let truncated = false

  const queue: string[] = ['']
  while (queue.length > 0) {
    const dir = queue.shift()
    if (dir === undefined) break
    let entries
    try {
      entries = await readdir(dir === '' ? root : join(root, dir), { withFileTypes: true })
    } catch (error) {
      errors.push({ file: dir === '' ? '.' : dir, message: messageOf(error) })
      continue
    }
    entries.sort((a, b) => a.name.localeCompare(b.name))
    for (const entry of entries) {
      const child = dir === '' ? entry.name : `${dir}/${entry.name}`
      if (entry.isDirectory()) {
        if (excluded.has(entry.name)) continue
        if (entry.name.startsWith('.') && entry.name !== '.github') continue
        if (ignore(child, true)) continue
        queue.push(child)
        continue
      }
      if (!entry.isFile()) continue
      if (ignore(child, false)) continue
      if (files.length >= maxFiles) {
        truncated = true
        return { files, truncated, errors }
      }
      // 统一成 POSIX 分隔符，让契约 id 与展示都不受平台影响。
      files.push(sep === '/' ? child : child.split(sep).join('/'))
    }
  }
  return { files, truncated, errors }
}

/**
 * 读根目录的 `.gitignore`，返回一个匹配函数。
 *
 * 只认根目录一份、只支持 `*`/`**`/`?` 与目录后缀——真正的 gitignore 语义（嵌套文件、
 * 否定模式、字符集）不在这里重造。够用即可：目的是别把 `node_modules` 和产物扫进来，
 * 而这两者通常就写在根 `.gitignore` 里。
 */
async function loadGitignore(root: string): Promise<(relativePath: string, isDir: boolean) => boolean> {
  let text: string
  try {
    text = await readFile(join(root, '.gitignore'), 'utf8')
  } catch {
    return () => false
  }
  const rules: { re: RegExp; dirOnly: boolean }[] = []
  for (const raw of text.split('\n')) {
    const line = raw.trim()
    if (line === '' || line.startsWith('#') || line.startsWith('!')) continue
    const dirOnly = line.endsWith('/')
    const pattern = line.replace(/\/+$/, '').replace(/^\/+/, '')
    if (pattern === '') continue
    rules.push({ re: globToRegExp(pattern), dirOnly })
  }
  return (relativePath: string, isDir: boolean) => {
    for (const rule of rules) {
      if (rule.dirOnly && !isDir) continue
      if (rule.re.test(relativePath)) return true
    }
    return false
  }
}

/** 把 gitignore 片段转成正则；`**` 跨层，`*` 不跨层。 */
function globToRegExp(pattern: string): RegExp {
  const escaped = pattern
    .split('')
    .map((char) => {
      if (char === '*') return '*'
      if (char === '?') return '?'
      return char.replace(/[.+^${}()|[\]\\]/g, '\\$&')
    })
    .join('')
  const body = escaped
    .replace(/\*\*\//g, '\u0000')
    .replace(/\*\*/g, '\u0001')
    .replace(/\*/g, '[^/]*')
    .replace(/\?/g, '[^/]')
    .replace(/\u0000/g, '(?:.*/)?')
    .replace(/\u0001/g, '.*')
  // 匹配该路径本身，或它作为某一层的目录前缀（gitignore 的目录规则会连带其内容）。
  return new RegExp(`^(?:.*/)?${body}(?:/.*)?$`)
}

/** 从任意抛出物里取一句人类可读的话。 */
export function messageOf(error: unknown): string {
  if (error instanceof Error) return error.message
  return String(error)
}
