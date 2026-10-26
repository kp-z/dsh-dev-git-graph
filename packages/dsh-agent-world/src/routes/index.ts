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
import { createDialogueChannel, dialogueRoutes } from './dialogue.js'
import type { DialogueChannel } from './dialogue.js'
import type { DialoguePort } from './dialogue.js'
import { eventsRoutes } from './events.js'
import { panelRoutes } from './panel.js'
import { HttpError } from './router.js'
import { vendorRoutes } from './vendor.js'

import type { EventSourcePort } from '../protocol/index.js'

/** 建传输层需要的依赖。 */
export interface HttpDeps extends ApiDeps {
  /** 事件来源（SSE 从它订阅）。 */
  source: EventSourcePort
  /**
   * 对话端口（M6-3）。**可选**：没有它时 `/api/say` 仍会登记对话，
   * 但会以 SSE `phase:'failed'` + 原因收场（headless profile 的真实路径）。
   *
   * 类型是 `routes` 本地声明的形状，所以传进来的可以是
   * `toDialoguePort(bridge)`（`src/index.ts` 负责接），而 `routes` 不必认识 `bridge`。
   */
  dialogue?: DialoguePort
  /** 覆盖"已唤醒角色"上限；不传则读 `service.config.maxLiveSessions`。 */
  maxLiveSessions?: number
  /** 等模型回复的超时（ms）；测试调短用。 */
  replyTimeoutMs?: number
  /** R340：把建好的对话通道交出去，供主会话事件注入。 */
  onDialogueChannel?: (channel: DialogueChannel) => void
  /** SSE 心跳间隔（ms）。默认 15 秒；测试会调短。 */
  heartbeatMs?: number
  /** 面板静态文件的根目录；默认取 `lib/web`（由 `scripts/copy-web.mjs` 从 `web/` 同步）。 */
  webRoot?: string
  /** vendored 第三方资源的根目录；默认取 `lib/vendor`（同一次构建同步过来）。 */
  vendorRoot?: string
}

/** 默认的面板静态目录：相对**编译产物**（`lib/routes/index.js` → `lib/web`）。 */
function defaultWebRoot(): string {
  return fileURLToPath(new URL('../web/', import.meta.url))
}

/** 默认的 vendored 资源目录（`lib/routes/index.js` → `lib/vendor`）。 */
function defaultVendorRoot(): string {
  return fileURLToPath(new URL('../vendor/', import.meta.url))
}

/**
 * 造完整路由表。
 *
 * 顺序有意义：SSE 与 API 在前（它们是精确路径），静态面板兜后（`/:file` 会吞掉单段路径）。
 * 把面板放前面的话 `/api/events` 会被 `/:file` 先匹配走。
 */
/**
 * `/api/` 命名空间的兜底路由。
 *
 * 为什么需要它：通配的静态面板会**接走任何路径**，于是把 `/api/wrld` 这种打错的端点
 * 变成一个"不服务的文件类型"错误——那句话对排查毫无帮助（用户明明是在调 API）。
 * 兜底路由给出的是**已注册的 API 列表**，这才是能照做的信息。
 *
 * 放在静态面板**之前**：顺序就是优先级。
 */
function apiCatchAll(): RouteEntry[] {
  // R163：**这份清单必须与 `api.ts` 的路由表同步**。原先漏了 `/api/session`，
  // 于是打它得到一个 404，报错里还"权威地"说自己只注册了四条 —— 我就是照着这条报错
  // 判定"端点根本没实现"的，白查了一轮（真相是宿主没重启）。
  // **会误导人的报错比没有报错更贵**：它让人停止怀疑真正的原因。
  const list =
    'GET /api/world（快照）· POST /api/command（命令）· POST /api/say（搭话）· GET /api/events（事件流）· GET /api/scene（AI 场景资源）· POST /api/scene/command（AI 场景编辑）· GET /api/session（会话名）· POST /api/activate（切换会话世界）· POST /api/deactivate（收起会话世界）'
  const missing = (method: string): RouteEntry => ({
    method,
    pattern: '/api/*',
    handler: () => {
      throw new HttpError(404, `没有这个 API 端点。已注册：${list}`)
    },
  })
  return [missing('GET'), missing('POST')]
}

export function buildRoutes(deps: HttpDeps): RouteEntry[] {
  // 对话通道**只建一次**，同时交给 SSE 与 `/api/say`：
  // 两条路由必须是同一个对象，否则"说出去的话"就到不了"正在监听的那条流"。
  const dialogue = createDialogueChannel({
    service: deps.service,
    ...(deps.dialogue === undefined ? {} : { port: deps.dialogue }),
    ...(deps.maxLiveSessions === undefined ? {} : { maxLiveSessions: deps.maxLiveSessions }),
    ...(deps.replyTimeoutMs === undefined ? {} : { replyTimeoutMs: deps.replyTimeoutMs }),
  })

  deps.onDialogueChannel?.(dialogue)

  return [
    ...eventsRoutes({
      source: deps.source,
      service: deps.service,
      dialogue,
      ...(deps.heartbeatMs === undefined ? {} : { heartbeatMs: deps.heartbeatMs }),
    }),
    ...apiRoutes(deps),
    ...dialogueRoutes(dialogue),
    ...apiCatchAll(), // 必须在静态面板之前：否则 API 的错路径会被当成静态文件
    ...vendorRoutes(deps.vendorRoot ?? defaultVendorRoot()), // 也在面板之前：白名单要优先于通配
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
