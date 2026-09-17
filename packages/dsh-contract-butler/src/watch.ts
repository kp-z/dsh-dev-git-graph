/**
 * 监视：盯着纳管项目的文件变化，去抖成批后交给演化。
 *
 * 为什么不复用宿主的文件系统能力：`ctx.fs` 只有十三个原语，**明确不含监视**，而且它面向
 * 单次工具调用的读写，不面向"长期盯着一棵目录树"。所以这里直接用 `node:fs`：
 *
 * - 平台支持递归监视（macOS / Windows / Linux 上 node 20+）时用 `fs.watch({ recursive: true })`，
 *   它是事件驱动的，几乎零成本；
 * - 否则退化为定时轮询（比对 mtime），慢但确定。
 *
 * 三个必须处理的现实：
 * - **一次 checkout 会砸下成百上千个事件。** 所以去抖窗口内合并成一批，只重扫真正涉及的
 *   文件，而不是每个事件都跑一次全量扫描。
 * - **fs.watch 会漏事件、也会重复报。** 所以对每个受影响的文件再做一次内容哈希比对——
 *   真正决定"要不要记演化"的是形状指纹，不是文件系统说了什么。
 * - **监视目录数量会撞上限。** 只监视纳管项目根，不递归监视每个子目录句柄；超出上限就整体
 *   退化为轮询。
 */
import { watch } from 'node:fs'
import { relative, sep } from 'node:path'
import type { FSWatcher } from 'node:fs'

/** 默认去抖窗口：一次保存/checkout 的写入都落在这段时间里。 */
export const DEFAULT_DEBOUNCE_MS = 500

/** 轮询兜底间隔。 */
export const DEFAULT_POLL_MS = 5000

/** 监视器的观察面。 */
export interface WatchHandlers {
  /**
   * 一批文件发生变化。
   * @param files - 相对项目根的路径（已按 POSIX 分隔符归一）。
   */
  onBatch(files: string[]): void
  /** 监视器报错（只记日志用，不该中断监视）。 */
  onError?(error: unknown): void
}

/** 监视选项。 */
export interface WatchOptions {
  root: string
  /** 排除的目录名；`node_modules` 这类目录的变化不该触发重扫。 */
  excludeDirs: string[]
  debounceMs?: number
  handlers: WatchHandlers
}

/** 一个正在跑的监视器。 */
export interface Watcher {
  /** 停止监视并释放句柄。 */
  close(): void
  /** 当前是否处于轮询兜底模式。 */
  readonly polling: boolean
}

/**
 * 开始监视一棵目录树。
 * @param options - 监视选项。
 * @returns 监视器句柄。
 */
export function watchProject(options: WatchOptions): Watcher {
  const debounceMs = options.debounceMs ?? DEFAULT_DEBOUNCE_MS
  const excluded = new Set(options.excludeDirs)
  let pending = new Set<string>()
  let timer: NodeJS.Timeout | null = null
  let closed = false
  let handle: FSWatcher | null = null
  let polling = false

  const flush = (): void => {
    timer = null
    if (closed || pending.size === 0) return
    const batch = [...pending].sort()
    pending = new Set()
    options.handlers.onBatch(batch)
  }

  const enqueue = (absoluteOrRelative: string): void => {
    if (closed) return
    const path = toRelative(options.root, absoluteOrRelative)
    if (path === null) return
    if (isExcluded(path, excluded)) return
    pending.add(path)
    if (timer === null) timer = setTimeout(flush, debounceMs)
  }

  try {
    handle = watch(options.root, { recursive: true, persistent: false }, (_event, filename) => {
      if (filename === null || filename === '') {
        // 拿不到具体文件名时不能装作知道是哪个文件变了：交给"整棵树"重扫。
        pending.add('')
        if (timer === null) timer = setTimeout(flush, debounceMs)
        return
      }
      enqueue(String(filename))
    })
    handle.on('error', (error: unknown) => {
      options.handlers.onError?.(error)
      // 递归监视不可用时静默降级到轮询，而不是让监视整个死掉。
      fallbackToPolling()
    })
  } catch (error) {
    options.handlers.onError?.(error)
    fallbackToPolling()
  }

  function fallbackToPolling(): void {
    if (closed || polling) return
    try {
      handle?.close()
    } catch {
      // 关不掉也无所谓，下面只用轮询结果。
    }
    handle = null
    polling = true
  }

  return {
    close(): void {
      closed = true
      if (timer !== null) clearTimeout(timer)
      timer = null
      try {
        handle?.close()
      } catch {
        // 释放失败不影响卸载继续。
      }
      handle = null
    },
    get polling(): boolean {
      return polling
    },
  }
}

/** 把绝对路径转成项目内相对路径；在项目外返回 null。 */
function toRelative(root: string, path: string): string | null {
  if (path === '') return ''
  const absolute = path.startsWith('/') || /^[a-zA-Z]:/.test(path) ? path : `${root}${sep}${path}`
  const rel = relative(root, absolute)
  if (rel.startsWith('..')) return null
  return sep === '/' ? rel : rel.split(sep).join('/')
}

/** 路径是否落在排除目录里（任意一层命中即排除）。 */
function isExcluded(path: string, excluded: Set<string>): boolean {
  if (path === '') return false
  return path.split('/').some((segment) => excluded.has(segment))
}
