/**
 * 极小的 HTTP 路由表（BACKLOG M3-3）。
 *
 * ## 为什么自己写而不是引框架
 *
 * 需求只有三条：匹配 `:name` 段、解析 JSON 体、把异常翻成状态码。
 * 引一个框架要多一个依赖、多一层自己的错误语义，而这几条不到 150 行。
 * 本仓库的取舍一贯是：**能一眼看完的实现，胜过功能更多的依赖**。
 *
 * ## 传输层要薄
 *
 * 这一层只做"解析请求 → 调处理器 → 序列化响应 → 异常翻状态码"。
 * **任何业务判断都不许出现在这里**——同一个能力以后还要经工具暴露给模型，
 * 传输层变成第二个业务入口就会开始漂移。
 */
import type http from 'node:http'

/** 带状态码的错误。处理器抛它就能得到想要的状态码。 */
export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly detail?: unknown,
  ) {
    super(message)
    this.name = 'HttpError'
  }
}

/** 一个路由处理器收到的东西。 */
export interface RouteRequest {
  method: string
  /** 已经剥掉前缀的路径，形如 `/api/world`。 */
  pathname: string
  query: URLSearchParams
  body: unknown
  req: http.IncomingMessage
  /**
   * 原始响应对象。
   *
   * 只有"要自己接管响应"的处理器需要它（静态文件、以及 M3-4 的 SSE 长连接）——
   * 那种情况返回 `undefined`，路由层就不再序列化 JSON 了。
   */
  res: http.ServerResponse
}

/** 处理器返回的值会被序列化成 JSON；抛 `HttpError` 决定状态码。 */
export type RouteHandler = (request: RouteRequest) => unknown | Promise<unknown>

/**
 * 路由表里的一项。
 *
 * `pattern` 支持两种占位：
 * - `:name` —— 匹配**一段**，值进 `params`；
 * - 末尾的 `*` —— 匹配**剩余全部段**（含零段之后的任意嵌套），整体进 `params.rest`。
 *
 * `*` 是 R15 补的：原先只有单段占位，于是**静态面板服务不了嵌套目录**
 * （`/vendor/three/x.js` 匹配不上 `/:file`），而那时所有面板资源都是平铺的，
 * 所以这个缺陷一直没暴露——直到 vendor 进来的 three 放进子目录。
 */
export interface RouteEntry {
  method: string
  pattern: string
  handler: RouteHandler
}

/** 把 pattern 与 pathname 匹配，返回路径参数；不匹配返回 null。 */
export function matchPath(pattern: string, pathname: string): Record<string, string> | null {
  const p = pattern.split('/').filter((s) => s !== '')
  const a = pathname.split('/').filter((s) => s !== '')

  // 末尾的 `*`：匹配剩余全部段。**必须在长度比较之前处理**，
  // 否则 `/vendor/three/x.js` 会被 `/:file` 的长度检查直接拒掉。
  const wildcard = p[p.length - 1] === '*'
  const fixed = wildcard ? p.slice(0, -1) : p
  if (wildcard ? a.length < fixed.length : a.length !== fixed.length) return null

  const params: Record<string, string> = {}
  for (let i = 0; i < fixed.length; i++) {
    const seg = fixed[i] ?? ''
    const actual = a[i] ?? ''
    if (seg.startsWith(':')) {
      if (actual === '') return null
      params[seg.slice(1)] = decodeURIComponent(actual)
    } else if (seg !== actual) {
      return null
    }
  }
  if (wildcard) {
    // 逐段解码后拼回：**不要**整段 decodeURIComponent，那会把 `%2F` 变成真的斜杠，
    // 于是一个编码过的分隔符就能伪造出目录层级（路径穿越的经典手法）。
    params.rest = a
      .slice(fixed.length)
      .map((seg) => decodeURIComponent(seg))
      .join('/')
  }
  return params
}

/** 请求体上限。世界命令很小，超过这个尺寸的一律拒掉，不用读进内存。 */
const MAX_BODY_BYTES = 64 * 1024

/** 读并解析 JSON 体。空体返回 undefined；坏 JSON 抛 400。 */
export async function readJsonBody(req: http.IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = []
  let size = 0

  for await (const chunk of req) {
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as string)
    size += buf.length
    if (size > MAX_BODY_BYTES) {
      throw new HttpError(413, `请求体超过 ${MAX_BODY_BYTES} 字节。世界命令都很小，这么大的体多半是发错了端点。`)
    }
    chunks.push(buf)
  }

  if (size === 0) return undefined
  const text = Buffer.concat(chunks).toString('utf8')
  try {
    return JSON.parse(text) as unknown
  } catch (error) {
    throw new HttpError(400, `请求体不是合法 JSON：${error instanceof Error ? error.message : String(error)}`)
  }
}

/** 写一个 JSON 响应。 */
export function sendJson(res: http.ServerResponse, status: number, payload: unknown): void {
  const body = JSON.stringify(payload)
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    // 面板在同一个宿主页面上，但要经 fetch 读；明确禁掉缓存，
    // 否则浏览器会把快照缓存下来，表现为"世界不动了"。
    'Cache-Control': 'no-store',
  })
  res.end(body)
}

/** 把一个未知异常翻成状态码 + 可读信息。 */
export function toHttpError(error: unknown): HttpError {
  if (error instanceof HttpError) return error
  const message = error instanceof Error ? error.message : String(error)
  return new HttpError(500, message)
}

/**
 * 造一个符合宿主 `webServer.register` 形状的处理器。
 *
 * @param prefix - 本插件独占的路径前缀（形如 `/agent-world`）。
 * @param routes - 路由表。
 * @param onError - 出错时的回调（记日志用）；不影响响应。
 * @returns 一个 `(req, res) => Promise<void>` 的处理器。
 */
export function createHttpHandler(
  prefix: string,
  routes: readonly RouteEntry[],
  onError?: (error: unknown, request: RouteRequest) => void,
): (req: http.IncomingMessage, res: http.ServerResponse) => Promise<void> {
  const normalizedPrefix = prefix.endsWith('/') ? prefix.slice(0, -1) : prefix

  return async (req, res) => {
    let request: RouteRequest | null = null
    try {
      const url = new URL(req.url ?? '/', 'http://localhost')

      // 前缀必须按**整段**匹配：`/agent-world-x` 不该落进这里。
      // 只做 `startsWith(prefix)` 会让相邻插件的路径被吞掉，而且极难查。
      if (url.pathname !== normalizedPrefix && !url.pathname.startsWith(`${normalizedPrefix}/`)) {
        throw new HttpError(404, `不属于本插件的路由前缀 ${normalizedPrefix}。`)
      }
      const pathname = url.pathname.slice(normalizedPrefix.length) || '/'
      const method = (req.method ?? 'GET').toUpperCase()

      request = {
        method,
        pathname,
        query: url.searchParams,
        body: method === 'POST' || method === 'PUT' ? await readJsonBody(req) : undefined,
        req,
        res,
      }

      for (const route of routes) {
        if (route.method !== method) continue
        if (matchPath(route.pattern, pathname) === null) continue
        const value = await route.handler(request)
        // 处理器自己接管了响应（静态文件、SSE）时返回 undefined。
        if (value === undefined) return
        sendJson(res, 200, value)
        return
      }

      throw new HttpError(
        404,
        `没有匹配的路由：${method} ${pathname}。已注册：${routes.map((r) => `${r.method} ${r.pattern}`).join('、')}`,
      )
    } catch (error) {
      const httpError = toHttpError(error)
      if (request !== null) onError?.(error, request)
      // 响应已经发出去了就不要再写头（会抛 ERR_HTTP_HEADERS_SENT，反而掩盖原始错误）。
      if (res.headersSent) {
        res.end()
        return
      }
      sendJson(res, httpError.status, {
        error: httpError.message,
        ...(httpError.detail === undefined ? {} : { detail: httpError.detail }),
      })
    }
  }
}
