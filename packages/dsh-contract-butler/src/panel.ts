/**
 * 面板静态资源：面板是一张自包含的 HTML，由宿主路由直接吐给浏览器。
 *
 * 为什么是"宿主路由 + iframe"而不是宿主内建组件：面板要画的东西（树、卡片、时光轴、
 * 实时流）跟宿主现有组件的形态差得远，塞进宿主的渲染树只会两边都别扭。走一条自己的路由，
 * 面板就只是一个网页——可以用 `curl` 看、可以在浏览器里调、可以独立迭代，不必跟着宿主的
 * 组件契约走。代价是主题需要自己同步（宿主注入的 CSS 变量在 iframe 里取不到）。
 */
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { ROUTE_PREFIX } from './routes.js'

/** 面板 HTML 的磁盘位置。构建时 `src/panel.html` 会被复制到 `lib/panel.html`。 */
export function panelPath(): string {
  return fileURLToPath(new URL('./panel.html', import.meta.url))
}

/**
 * 读出面板 HTML。
 * @returns 面板内容。
 * @throws 文件缺失或读不动时抛出（调用方负责翻成 HTTP 状态码）。
 */
export async function readPanel(): Promise<string> {
  return await readFile(panelPath(), 'utf8')
}

/* ---------- 第三方静态资源（vendored） ----------
   面板的字段表用 Tabulator 做真正的表格，但它**不走 CDN**：文件随包发布，由这里的白名单
   一条条放行。白名单是"精确文件名"式的，所以 `/`、`..`、URL 编码穿越这些花样根本进不了
   名单——这道防线不是靠"把路径解析做对"，而是靠"只认这几个名字"。 */

/** 面板第三方资源：**精确文件名 → MIME** 白名单。加文件必须同时改这里，否则一律 404。 */
export const VENDOR_TYPES: Readonly<Record<string, string>> = {
  'tabulator.min.js': 'text/javascript; charset=utf-8',
  'tabulator.min.css': 'text/css; charset=utf-8',
  'LICENSE.tabulator': 'text/plain; charset=utf-8',
  'README.md': 'text/markdown; charset=utf-8',
}

/** vendor 资源目录。构建时 `src/vendor` 会被同步到 `lib/vendor`（运行时读的是后者）。 */
export function vendorDir(): string {
  return fileURLToPath(new URL('./vendor/', import.meta.url))
}

/**
 * 资源名 → MIME。
 * @param name - 请求里给的文件名。
 * @returns MIME；不在白名单里（含 `/`、`..`、URL 编码穿越）返回 `null`。
 */
export function vendorType(name: unknown): string | null {
  if (typeof name !== 'string') return null
  if (!Object.prototype.hasOwnProperty.call(VENDOR_TYPES, name)) return null
  return VENDOR_TYPES[name] ?? null
}

/**
 * 白名单内的资源名 → 磁盘路径。
 * @param name - 请求里给的文件名。
 * @returns 磁盘路径；不在白名单里返回 `null`。
 */
export function vendorPath(name: unknown): string | null {
  if (typeof name !== 'string') return null
  if (!Object.prototype.hasOwnProperty.call(VENDOR_TYPES, name)) return null
  return path.join(vendorDir(), name)
}

/**
 * 从请求路径里取资源名（`/dsh-contract-butler/vendor/<name>`）。
 *
 * 取名字这一步是**越界的唯一入口**，所以宁可严：只接受"前缀 + 单段文件名"，解码之后还带
 * 分隔符 / 上跳 / 空字节的都不认（白名单本来也拦得住，这里是第二道）。
 * @param pathname - 已经过 `URL` 规范化的路径名（`new URL(req.url, ...).pathname`）。
 * @returns 资源名；路径不对、空名、解码失败、解码后越界一律 `null`（调用方回 404）。
 */
export function vendorNameOf(pathname: string): string | null {
  const base = `${ROUTE_PREFIX}/vendor/`
  if (!pathname.startsWith(base)) return null
  const raw = pathname.slice(base.length)
  if (raw === '') return null
  let name: string
  try {
    name = decodeURIComponent(raw)
  } catch {
    // 坏掉的百分号转义（`%zz`）也当"没有这个资源"，不为它单独抛错。
    return null
  }
  if (name.includes('/') || name.includes('\\') || name.includes('..') || name.includes('\0')) return null
  return name
}

/**
 * 读一个白名单内的资源。
 * @param name - 资源名（先过白名单）。
 * @returns 磁盘路径、MIME 与字节。
 * @throws 名字不在白名单，或文件缺失/读不动时抛出（调用方负责翻成 HTTP 状态码）。
 */
export async function readVendor(name: string): Promise<{ path: string; type: string; body: Buffer }> {
  const file = vendorPath(name)
  const type = vendorType(name)
  if (file === null || type === null) throw new Error(`没有这个资源：${name}`)
  return { path: file, type, body: await readFile(file) }
}
