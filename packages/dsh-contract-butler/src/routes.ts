/**
 * HTTP 传输层：路由表 + 事件流。
 *
 * 这一层刻意做得"薄"：它只负责解析请求、调用处理器、序列化响应、把异常翻成状态码。所有
 * 业务判断都在 `index.ts` 那侧——因为同一个能力以后还要经工具暴露给模型，传输层不该成为
 * 第二个业务入口。
 *
 * SSE 用来推送实时事件：`dsh-host-webserver` 不压缩 SSE，正好适合长连接。事件只在
 * **有东西真的变了**的时候发，不做心跳之外的例行广播——订阅者要的是"又发生了什么"，
 * 不是"服务器还活着"（那由 TCP 自己负责）。
 */
import type http from 'node:http'

/** 路由注册面（`ctx.webServer` 的子集）。 */
export interface WebServerLike {
  register(spec: {
    kind: 'exact' | 'prefix'
    path: string
    handler: (req: http.IncomingMessage, res: http.ServerResponse) => void
  }): () => void
}

/** 带状态码的错误。处理器抛它就能得到想要的状态码。 */
export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message)
  }
}

/** 一个路由处理器。返回值会被序列化成 JSON。 */
export type RouteHandler = (request: {
  query: URLSearchParams
  body: unknown
  req: http.IncomingMessage
}) => unknown | Promise<unknown>

/** 路由表里的一项。 */
export interface RouteEntry {
  method: string
  /** 路径，支持 `:name` 形式的单段参数。 */
  path: string
  handler?: RouteHandler
  /**
   * 原始处理器：需要自己接管响应的情况（SSE 长连接）。
   *
   * 有了它是为了让传输层的"JSON 化"不是强制的——事件流一旦被序列化成 JSON 响应就死了。
   */
  raw?: (req: http.IncomingMessage, res: http.ServerResponse) => void
}

/** 事件流广播器。 */
export class EventHub {
  private readonly clients = new Set<http.ServerResponse>()

  /**
   * 接受一个 SSE 订阅。
   * @param res - 响应对象。
   * @param greeting - 建立连接时先发一条的事件，便于客户端确认订阅成功。
   */
  subscribe(res: http.ServerResponse, greeting: { type: string; data: unknown }): void {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-store',
      Connection: 'keep-alive',
      // 明确禁掉代理缓冲，否则事件会攒着不定期推送。
      'X-Accel-Buffering': 'no',
    })
    res.write(': connected\n\n')
    this.clients.add(res)
    res.on('close', () => {
      this.clients.delete(res)
    })
    this.send(res, greeting.type, greeting.data)
  }

  /**
   * 向所有订阅者广播。
   * @param type - 事件类型。
   * @param data - 事件载荷（JSON 可序列化）。
   */
  broadcast(type: string, data: unknown): void {
    for (const res of [...this.clients]) this.send(res, type, data)
  }

  /** 关闭全部订阅。 */
  close(): void {
    for (const res of [...this.clients]) {
      try {
        res.end()
      } catch {
        // 客户端已经走了就算了。
      }
    }
    this.clients.clear()
  }

  /** 当前订阅者数量。 */
  get size(): number {
    return this.clients.size
  }

  private send(res: http.ServerResponse, type: string, data: unknown): void {
    try {
      res.write(`event: ${type}\ndata: ${JSON.stringify(data)}\n\n`)
    } catch {
      this.clients.delete(res)
    }
  }
}

/** 前缀，所有路由都挂在它下面。 */
export const ROUTE_PREFIX = '/dsh-contract-butler'

/**
 * 注册路由表。
 * @param webServer - 宿主 web 服务器。
 * @param entries - 路由表。
 * @returns 逐条注册得到的释放函数。
 */
export function registerRoutes(webServer: WebServerLike, entries: RouteEntry[]): (() => void)[] {
  const disposers: (() => void)[] = []
  for (const entry of entries) {
    const raw = entry.raw
    // 带 `:name` 的路径按前缀注册（`id` 由处理器自己从 URL 里取），其余一律精确匹配——
    // 精确路由在宿主的匹配顺序里优先于前缀，所以 `/contracts` 不会被 `/contracts/:id` 抢走。
    const colon = entry.path.indexOf('/:')
    const path = colon === -1 ? `${ROUTE_PREFIX}${entry.path}` : `${ROUTE_PREFIX}${entry.path.slice(0, colon)}`
    disposers.push(
      webServer.register({
        kind: colon === -1 ? 'exact' : 'prefix',
        path,
        handler:
          raw === undefined
            ? (req, res) => {
                void handle(entry, req, res)
              }
            : raw,
      }),
    )
  }
  return disposers
}

/** 处理一个请求：匹配方法、取查询与请求体、调用处理器、回响应。 */
async function handle(entry: RouteEntry, req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  try {
    const handler = entry.handler
    // 原始处理器（SSE）不走这里；走到这一行说明路由表里配漏了 handler。
    if (handler === undefined) {
      sendJson(res, 501, { error: `路由 ${entry.method} ${entry.path} 没有处理器` })
      return
    }
    const method = (req.method ?? 'GET').toUpperCase()
    // 前缀路由会命中同前缀下的其它路径，方法或路径对不上时明确 404，而不是硬塞给处理器。
    if (method !== entry.method) {
      const url = new URL(req.url ?? '/', 'http://localhost')
      if (!pathMatches(entry.path, url.pathname)) {
        sendJson(res, 404, { error: `没有这条路由：${method} ${url.pathname}` })
        return
      }
      sendJson(res, 405, { error: `该路由只接受 ${entry.method}` })
      return
    }
    const url = new URL(req.url ?? '/', 'http://localhost')
    const prefix = `${ROUTE_PREFIX}${entry.path.split('/:')[0] ?? ''}`
    const params = matchParams(entry.path, url.pathname, prefix)
    const query = url.searchParams
    for (const [key, value] of Object.entries(params)) query.set(key, value)

    const body = entry.method === 'POST' || entry.method === 'PUT' ? await readJson(req) : undefined
    const result = await handler({ query, body, req })
    if (res.headersSent) return
    sendJson(res, 200, result ?? { ok: true })
  } catch (error) {
    if (res.headersSent) return
    if (error instanceof HttpError) {
      sendJson(res, error.status, { error: error.message })
      return
    }
    sendJson(res, 500, { error: error instanceof Error ? error.message : String(error) })
  }
}

/** 路径是否匹配（`/a/:id` 风格的解析）。 */
function pathMatches(pattern: string, pathname: string): boolean {
  const prefix = `${ROUTE_PREFIX}${pattern.split('/:')[0] ?? ''}`
  if (pattern === '') return pathname === ROUTE_PREFIX || pathname === `${ROUTE_PREFIX}/`
  return pathname.startsWith(prefix)
}

/** 从路径里取出 `:name` 参数。 */
function matchParams(pattern: string, pathname: string, prefix: string): Record<string, string> {
  const params: Record<string, string> = {}
  const colon = pattern.indexOf('/:')
  if (colon === -1) return params
  const names = pattern
    .slice(colon)
    .split('/')
    .filter((segment) => segment.startsWith(':'))
    .map((segment) => segment.slice(1))
  const rest = pathname.slice(prefix.length).replace(/^\//, '')
  const values = rest.split('/').filter((segment) => segment !== '')
  names.forEach((name, index) => {
    const value = values[index]
    if (value !== undefined) params[name] = decodeURIComponent(value)
  })
  return params
}

/** 读并解析 JSON 请求体；空体当空对象。 */
async function readJson(req: http.IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk))
    size += buffer.length
    // 上限 4MB：这是配置与决策的接口，不是上传接口。
    if (size > 4 * 1024 * 1024) throw new HttpError(413, '请求体过大')
    chunks.push(buffer)
  }
  if (size === 0) return {}
  const text = Buffer.concat(chunks).toString('utf8')
  try {
    return JSON.parse(text)
  } catch {
    throw new HttpError(400, '请求体不是合法 JSON')
  }
}

/** 回一个 JSON 响应。 */
function sendJson(res: http.ServerResponse, status: number, value: unknown): void {
  const text = JSON.stringify(value)
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  })
  res.end(text)
}
