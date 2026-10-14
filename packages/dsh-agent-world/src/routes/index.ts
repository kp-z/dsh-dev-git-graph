/**
 * HTTP 传输层出口（BACKLOG M3-3 / M3-5）。
 *
 * 把 API 路由与静态面板路由合成一个处理器，交给宿主 `webServer.register`。
 * **全部收在一个前缀下**（默认 `/agent-world`），所以只占一个路由座位，
 * 与其它插件不可能撞——而 `webServer.register` 撞了是会抛的。
 */
import { fileURLToPath } from 'node:url'
import type http from 'node:http'
import { createHttpHandler } from './router.js'
import type { RouteEntry } from './router.js'
import { apiRoutes } from './api.js'
import type { ApiDeps } from './api.js'
import { eventsRoutes } from './events.js'
import { panelRoutes } from './panel.js'

import type { EventSourcePort } from '../protocol/index.js'

/** 建传输层需要的依赖。 */
export interface HttpDeps extends ApiDeps {
  /** 事件来源（SSE 从它订阅）。 */
  source: EventSourcePort
  /** SSE 心跳间隔（ms）。默认 15 秒；测试会调短。 */
  heartbeatMs?: number
  /** 面板静态文件的根目录；默认取 `lib/web`（由 `scripts/copy-web.mjs` 从 `web/` 同步）。 */
  webRoot?: string
}

/** 默认的面板静态目录：相对**编译产物**（`lib/routes/index.js` → `lib/web`）。 */
function defaultWebRoot(): string {
  return fileURLToPath(new URL('../web/', import.meta.url))
}

/**
 * 造完整路由表。
 *
 * 顺序有意义：SSE 与 API 在前（它们是精确路径），静态面板兜后（`/:file` 会吞掉单段路径）。
 * 把面板放前面的话 `/api/events` 会被 `/:file` 先匹配走。
 */
export function buildRoutes(deps: HttpDeps): RouteEntry[] {
  return [
    ...eventsRoutes({
      source: deps.source,
      service: deps.service,
      ...(deps.heartbeatMs === undefined ? {} : { heartbeatMs: deps.heartbeatMs }),
    }),
    ...apiRoutes(deps),
    ...panelRoutes(deps.webRoot ?? defaultWebRoot()),
  ]
}

/**
 * 造一个可以直接交给 `webServer.register` 的处理器。
 *
 * @param prefix - 本插件独占的路径前缀。
 * @param deps - 依赖。
 * @param onError - 出错回调（记日志用）；不影响响应。
 */
export function createHandler(
  prefix: string,
  deps: HttpDeps,
  onError?: (error: unknown, request: { method: string; pathname: string }) => void,
): (req: http.IncomingMessage, res: http.ServerResponse) => Promise<void> {
  return createHttpHandler(prefix, buildRoutes(deps), onError)
}
