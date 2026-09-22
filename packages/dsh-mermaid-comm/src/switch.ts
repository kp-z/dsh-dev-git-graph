import type http from 'node:http'
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'

/**
 * 「勾选后才注入」的开关。
 *
 * 为什么状态住在 host 侧：注入点是 `ctx.systemPrompt.section()`——system prompt 在 host 侧
 * 组装，对话输入框里的勾选按钮只是这台开关的遥控器。若把状态只放在客户端组件里，
 * 它既进不了 prompt 组装，也会在切换会话时随组件重挂载而丢（官方 renderer 明确要求
 * 组件局部状态不得跨会话泄漏）。因此：**host 持有真值，client 读写**。
 *
 * 持久化走 `ctx.settings`（namespace `mermaid-comm-inject`），落在 profile 的 settings
 * 文档里，重启后仍在。`settings` 服务缺失时退化为进程内状态——功能照常，只是重启回到
 * 配置的默认值。两条路径都不改变对外的同步读接口 {@link InjectSwitch.isOn}，因为
 * prompt section 的 text provider 必须在组装那一刻同步拿到答案。
 */

/** 开关状态的对外接口。 */
export interface InjectSwitch {
  /** 当前是否注入（同步——供 prompt section 的 text provider 在组装时调用）。 */
  isOn(): boolean
  /** 写入开关状态，并尽力持久化（持久化失败不影响本次进程内生效）。 */
  set(on: boolean): Promise<void>
}

/** 持久化用的 settings namespace（小写连字符标识符）。 */
const NAMESPACE = 'mermaid-comm-inject'

/** 客户端读写开关的路由。 */
export const SWITCH_ROUTE = '/dsh-mermaid-comm/state'

/** 请求体上限：这个路由只收一个布尔值，8KB 已是极宽。 */
const MAX_BODY_BYTES = 8 * 1024

const SWITCH_SCHEMA = z.object({
  /** 是否向 system prompt 注入 Mermaid 引导段。 */
  inject: z.boolean().default(false),
})

/** settings 服务的窄视图（只声明本插件用到的能力，避免依赖其完整类型）。 */
interface SettingsScopeLike {
  get(): { inject: boolean }
  update(patch: object): Promise<void>
  watch(callback: (next: { inject: boolean }) => void): () => void
}

interface SettingsLike {
  register(namespace: string, schema: unknown, options?: unknown): SettingsScopeLike
}

/** webServer 服务的窄视图。 */
interface WebServerLike {
  register(spec: {
    kind: 'exact' | 'prefix'
    path: string
    handler: (req: http.IncomingMessage, res: http.ServerResponse) => void
  }): () => void
}

function warn(...args: unknown[]): void {
  try { console.warn('[mermaid-comm]', ...args) } catch {}
}

/**
 * 建立开关：以 `defaultInject` 为初值，settings 可用时立刻用它覆盖并持续跟随，
 * 之后所有 set 都先改进程内真值（保证同步读立刻正确）再异步落盘。
 */
export function registerInjectSwitch(ctx: Context, opts: { defaultInject: boolean }): InjectSwitch {
  let on = opts.defaultInject
  let scope: SettingsScopeLike | undefined

  // 可选依赖：有 settings 就持久化，没有就纯进程内。用 ctx.inject 而非硬 inject，
  // 是为了让「勾选注入」这件事不依赖宿主恰好挂了某个包。
  // 外面再包一层 try：若沙箱拒绝注入这个服务，也只能退化成进程内状态，
  // 绝不能让「持久化」把整个插件（校验工具/图库/输出闸）拖垮。
  try {
    ctx.inject(['settings'], (host) => {
      const settings = (host as unknown as { settings?: SettingsLike }).settings
      if (!settings || typeof settings.register !== 'function') return
      try {
        const registered = settings.register(
          NAMESPACE,
          SWITCH_SCHEMA.default({ inject: opts.defaultInject }),
          { applies: 'live' },
        )
        scope = registered
        // 已存过就用存的值，否则 schema 默认值（= defaultInject）。
        on = registered.get().inject
        const stopWatching = registered.watch((next) => { on = next.inject })
        ctx.effect(() => stopWatching)
      } catch (error) {
        // 注册失败（例如 namespace 被占）不该让整个插件挂掉：退化为进程内状态。
        warn('settings namespace registration failed, falling back to in-process state:', String(error))
        scope = undefined
      }
    })
  } catch (error) {
    warn('settings service unavailable, using in-process state:', String(error))
  }

  return {
    isOn: () => on,
    async set(next: boolean) {
      on = next
      if (!scope) return
      try {
        await scope.update({ inject: next })
      } catch (error) {
        warn('failed to persist inject switch:', String(error))
      }
    },
  }
}

/** 读取请求体并解析为 JSON（空体返回 undefined）。 */
function readJsonBody(req: http.IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    let size = 0
    req.on('data', (chunk: Buffer) => {
      size += chunk.length
      if (size > MAX_BODY_BYTES) {
        reject(new Error('request body too large'))
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => {
      const text = Buffer.concat(chunks).toString('utf8').trim()
      if (text === '') { resolve(undefined); return }
      try { resolve(JSON.parse(text)) } catch (error) { reject(error) }
    })
    req.on('error', reject)
  })
}

function sendJson(res: http.ServerResponse, status: number, payload: unknown): void {
  const body = JSON.stringify(payload)
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'content-length': Buffer.byteLength(body),
  })
  res.end(body)
}

/**
 * 注册开关的 HTTP 路由，供客户端读写。
 *
 *   GET  {SWITCH_ROUTE} → { toggle: true, inject: boolean }
 *   POST {SWITCH_ROUTE} { inject: boolean } → 同上（回读后的真值）
 *
 * `toggle` 表示本插件当前是否处于「由按钮控制」模式：promptLevel 为 global/off 时
 * 客户端据此隐藏按钮，避免给出一个点了没用的控件。
 */
export function registerSwitchRoutes(ctx: Context, sw: InjectSwitch, opts: { toggle: boolean }): void {
  const state = () => ({ toggle: opts.toggle, inject: sw.isOn() })

  try {
    ctx.inject(['webServer'], (host) => {
      const webServer = (host as unknown as { webServer?: WebServerLike }).webServer
      if (!webServer || typeof webServer.register !== 'function') return

      const dispose = webServer.register({
        kind: 'exact',
        path: SWITCH_ROUTE,
        handler: (req, res) => {
          const method = (req.method ?? 'GET').toUpperCase()
          if (method === 'GET' || method === 'HEAD') {
            sendJson(res, 200, state())
            return
          }
          if (method !== 'POST') {
            res.writeHead(405, { allow: 'GET, HEAD, POST' })
            res.end()
            return
          }
          // 非 toggle 模式下不接写入：避免客户端与配置的 promptLevel 打架。
          if (!opts.toggle) {
            sendJson(res, 200, state())
            return
          }
          readJsonBody(req).then(async (body) => {
            const inject = (body as { inject?: unknown } | undefined)?.inject
            if (typeof inject !== 'boolean') {
              sendJson(res, 400, { error: 'body must be {"inject": boolean}' })
              return
            }
            await sw.set(inject)
            sendJson(res, 200, state())
          }).catch((error: unknown) => {
            if (!res.headersSent) sendJson(res, 400, { error: String(error) })
          })
        },
      })
      ctx.effect(() => dispose)
    })
  } catch (error) {
    warn('webServer service unavailable, toggle route not registered:', String(error))
  }
}
