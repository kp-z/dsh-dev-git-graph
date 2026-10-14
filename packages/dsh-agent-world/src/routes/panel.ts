/**
 * 静态面板服务（BACKLOG M3-5）。
 *
 * ## 三条必须自己做的事
 *
 * 1. **路径穿越防护**。`GET /../../etc/passwd` 这类请求在朴素实现里会真的把文件读出来。
 *    做法是拼接后 `path.resolve`，再断言结果仍在根目录之下——**用规范化后的绝对路径比**，
 *    不要用字符串 `includes('..')`（那对编码过的 `%2e%2e` 无效）。
 * 2. **MIME 白名单**。不猜类型、不照抄系统的 mime 表：只服务面板真正用到的几种，
 *    其余一律 404。白名单比黑名单安全，因为"没想到的扩展名"默认是拒绝的。
 * 3. **不做 SPA 回退**。宿主的 `registerFallback` 座位已经被官方 SPA 占了，
 *    我们只在自己前缀下服务明确存在的文件，找不到就 404。
 */
import { readFile, stat } from 'node:fs/promises'
import type http from 'node:http'
import { extname, join, resolve, sep } from 'node:path'
import type { RouteEntry } from './router.js'
import { HttpError } from './router.js'

/**
 * 扩展名 → Content-Type。
 *
 * 只列面板真正会用到的。加新类型要有理由——每加一项都是一个能被读出去的文件面。
 */
const MIME: Readonly<Record<string, string>> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  // 面板要加载 three.js 的模型/贴图时会用到；现在没有，先不列。
}

/** 允许服务的扩展名（从 MIME 表推导，只有一处真相）。 */
const ALLOWED_EXT = new Set(Object.keys(MIME))

/**
 * 把一个 URL 路径安全地解析成磁盘路径。
 *
 * @param rootDir - 静态根目录（绝对路径）。
 * @param urlPath - 请求路径，形如 `/app.js`。
 * @returns 绝对路径；越界或扩展名不在白名单时抛 `HttpError`。
 */
export function resolveStaticPath(rootDir: string, urlPath: string): string {
  const root = resolve(rootDir)
  // 先 decodeURIComponent 再 resolve：否则 `%2e%2e%2f` 会绕过字符串检查。
  let decoded: string
  try {
    decoded = decodeURIComponent(urlPath)
  } catch {
    throw new HttpError(400, `路径不是合法的 URL 编码：${urlPath}`)
  }
  if (decoded.includes('\0')) throw new HttpError(400, '路径里含空字节。')

  const filePath = resolve(join(root, decoded))

  // **关键的一步**：按规范化后的绝对路径判断越界，而不是看字符串里有没有 `..`。
  if (filePath !== root && !filePath.startsWith(root + sep)) {
    throw new HttpError(403, `路径越界：${urlPath} 不在面板目录内。`)
  }

  const ext = extname(filePath).toLowerCase()
  if (ext === '' || !ALLOWED_EXT.has(ext)) {
    throw new HttpError(
      404,
      `不服务的文件类型 ${ext === '' ? '(无扩展名)' : ext}。白名单：${[...ALLOWED_EXT].sort().join(' ')}`,
    )
  }
  return filePath
}

/** 读一个静态文件并写响应。 */
async function serveFile(res: http.ServerResponse, filePath: string): Promise<void> {
  const info = await stat(filePath).catch(() => null)
  if (info === null || !info.isFile()) {
    throw new HttpError(404, `文件不存在：${filePath}`)
  }
  const body = await readFile(filePath)
  const ext = extname(filePath).toLowerCase()
  res.writeHead(200, {
    'Content-Type': MIME[ext] ?? 'application/octet-stream',
    'Content-Length': body.length,
    // 面板是本地开发的，缓存只会制造"我改了它没变"的困惑。
    'Cache-Control': 'no-store',
  })
  res.end(body)
}

/**
 * 造静态面板路由。
 *
 * @param rootDir - 静态根目录（`lib/web`）。
 */
export function panelRoutes(rootDir: string): RouteEntry[] {
  const serve = async (urlPath: string, res: http.ServerResponse): Promise<undefined> => {
    const filePath = resolveStaticPath(rootDir, urlPath === '/' ? '/index.html' : urlPath)
    await serveFile(res, filePath)
    // 返回 undefined = "我已经接管了响应"，路由层不会再序列化 JSON。
    return undefined
  }

  return [
    {
      method: 'GET',
      pattern: '/',
      handler: ({ res }) => serve('/', res),
    },
    {
      method: 'GET',
      // `*` 而不是 `/:file`：静态资源要能放进子目录（vendor 的 three 就在
      // `vendor/three/` 下）。单段模式会让那些文件全都 404，而报错只是"没有匹配的路由"。
      pattern: '/*',
      handler: ({ pathname, res }) => serve(pathname, res),
    },
  ]
}
