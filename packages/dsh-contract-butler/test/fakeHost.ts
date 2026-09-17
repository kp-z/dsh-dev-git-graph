/**
 * 假宿主：一个够用的 cordis 语境替身。
 *
 * 装配测试和面板开发服务器共用这一份定义，好处是"宿主到底提供了什么"只有一处说法：
 * 服务名、注入时机、路由匹配规则（精确优先、其次最长前缀、查询串不参与匹配）都钉在这里。
 * 真宿主那一侧的关键假设（`storageDomain` / `webServer` 两个服务名、`tools/result` 事件名）
 * 已对着应用内的真包核对过。
 */
import type { FakeCtx, RouteSpec } from './fakeHostTypes.ts'

export type { FakeCtx, RouteSpec } from './fakeHostTypes.ts'

export function fakeCtx(): FakeCtx {
  const services = new Map<string, unknown>()
  const routes: RouteSpec[] = []
  const listeners = new Map<string, ((...args: unknown[]) => void)[]>()
  const logs: string[] = []
  let pending: { names: string[]; cb: (host: unknown) => unknown }[] = []

  const host = new Proxy(
    {},
    {
      get: (_target, key) => services.get(String(key)),
    },
  )

  const runInjections = (): void => {
    const ready = pending.filter((item) => item.names.every((name) => services.has(name)))
    if (ready.length === 0) return
    pending = pending.filter((item) => !ready.includes(item))
    for (const item of ready) item.cb(host)
  }

  const ctx = {
    logger: () => ({
      info: (message: unknown) => logs.push(`info ${String(message)}`),
      warn: (message: unknown) => logs.push(`warn ${String(message)}`),
      error: (message: unknown) => logs.push(`error ${String(message)}`),
    }),
    get: (name: string) => services.get(name),
    inject: (names: string[], cb: (host: unknown) => unknown) => {
      pending.push({ names, cb })
      runInjections()
      return () => undefined
    },
    on: (name: string, listener: (...args: unknown[]) => void) => {
      const list = listeners.get(name) ?? []
      list.push(listener)
      listeners.set(name, list)
      return () => undefined
    },
    effect: (fn: () => unknown) => {
      fn()
      return () => undefined
    },
  }

  /** 按宿主的匹配规则找路由：精确优先，其次最长前缀。匹配只看路径，查询串不参与。 */
  const match = (url: string): RouteSpec | undefined => {
    const pathname = url.split('?')[0] ?? url
    const exact = routes.find((item) => item.kind === 'exact' && item.path === pathname)
    if (exact !== undefined) return exact
    return routes
      .filter((item) => item.kind === 'prefix' && pathname.startsWith(item.path))
      .sort((a, b) => b.path.length - a.path.length)[0]
  }

  return {
    ctx,
    routes,
    logs,
    match,
    mount(name, value) {
      services.set(name, value)
      runInjections()
    },
    emit(name, ...args) {
      for (const listener of listeners.get(name) ?? []) listener(...args)
    },
    async call(method, url, body) {
      const route = match(url)
      if (route === undefined) {
        throw new Error(`没有匹配的路由：${method} ${url}（已注册：${routes.map((r) => r.path).join(', ')}）`)
      }
      const state = { status: 0, headers: {} as Record<string, string>, chunks: [] as string[], ended: false }
      const res = {
        get headersSent() {
          return state.status !== 0
        },
        writeHead(status: number, headers: Record<string, string>) {
          state.status = status
          state.headers = { ...headers }
        },
        write(chunk: unknown) {
          state.chunks.push(String(chunk))
          return true
        },
        end(chunk?: unknown) {
          if (chunk !== undefined) state.chunks.push(String(chunk))
          state.ended = true
        },
        on() {
          /* SSE 客户端断开用，不参与断言 */
        },
      }
      const chunks = body === undefined ? [] : [Buffer.from(JSON.stringify(body), 'utf8')]
      const req = {
        method,
        url,
        async *[Symbol.asyncIterator]() {
          for (const chunk of chunks) yield chunk
        },
        on() {
          /* 同上 */
        },
      }
      route.handler(req, res)
      for (let index = 0; index < 50 && !state.ended; index += 1) {
        await new Promise((resolve) => setTimeout(resolve, 5))
      }
      return { status: state.status, headers: state.headers, body: state.chunks.join('') }
    },
  }
}
