/**
 * dsh-agent-world —— host 入口。
 *
 * 装配逻辑一句话：**内容、世界、模拟循环必挂，界面可选**。
 * - `tools` 是硬依赖：没有工具注册表，模型无法与世界交互，这个插件就没有意义。
 * - `webServer`（M3-3 之后）会用 `ctx.inject` 按需等待：没有它时世界照跑，只是没有 3D 面板。
 *   把"模拟能力"与"展示能力"解耦，是为了让世界不依赖宿主是否恰好挂了 HTTP 服务。
 *
 * 当前进度（R7）：内容库层 + 契约层 + 模拟内核 + 运行时（**世界会动了**）。
 * 落盘与 HTTP/SSE 见 BACKLOG M3，3D 面板见 M4。
 * 架构见 docs/ARCHITECTURE.md，内容模型见 docs/CONTENT.md，协议见 docs/PROTOCOL.md。
 */
import { resolve } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import { type AgentWorldConfig, resolveConfig } from './config.js'
import { resolveContentRoot } from './content/load-files.js'
import { createHandler } from './routes/index.js'
import { createEventHub, createRuntime } from './runtime/index.js'
import { createWorldStore } from './store/index.js'
import { createPluginState } from './state.js'
import { registerDispatchTool } from './tools/dispatch.js'
import { registerWorldTools } from './tools/world.js'

/** Loader entry id（kebab-case，全局唯一，配置覆盖靠它定位）。 */
export const name = 'agent-world'

/**
 * 硬依赖：模型可见工具注册表。
 * 不写运行时兜底——缺它就 fail-loud，符合本仓库 docs/DEVELOPMENT.md §2 的约定。
 */
export const inject = ['tools']

/**
 * 插件入口。
 *
 * @param ctx - cordis 上下文。
 * @param config - Loader 传进来的**原始**配置（schema default 不会被自动填充，故走 resolveConfig）。
 */
export function apply(ctx: Context, config: Partial<AgentWorldConfig> = {}): void {
  const resolved = resolveConfig(config)
  const logger = ctx.logger('agent-world')

  // 外部内容目录的解析结果要**原样打出来**：用户配了 contentDir 却没生效时，
  // 第一个问题永远是"它到底去读哪个目录了"。
  const contentRoot = resolveContentRoot(resolved.contentDir, process.cwd())
  if (contentRoot.root !== null) {
    logger.info(`外部内容目录：${contentRoot.root}（${contentRoot.reason}）`)
  }

  // 存档目录：`stateDir` 目前按 `process.cwd()` 解析（与 contentDir 同一个基准，
  // 而"相对哪个 workspace"这件事是 M1.5-6 的待定项——多工作区时任何自动挑选都是猜）。
  // 把解析结果**原样打出来**：写盘位置是用户第一个会问的问题。
  const storeDir =
    resolved.persistEveryTicks > 0 ? resolve(process.cwd(), resolved.stateDir) : null
  if (storeDir !== null) logger.info(`世界存档目录：${storeDir}`)

  const state = createPluginState(resolved, { externalRoot: contentRoot.root, storeDir })

  registerWorldTools(ctx, state)
  registerDispatchTool(ctx, state)

  // 内容层的问题不阻断插件加载——照 dsh-daily 的做法：
  // 插件树加载失败会让**整个 dsh 起不来**，那个代价远大于"世界暂时建不出来"。
  const errors = state.issues().filter((i) => i.level === 'error')
  if (errors.length > 0) {
    const detail = errors
      .slice(0, 5)
      .map((e) => `[${e.where}] ${e.message}`)
      .join('；')
    logger.error(
      `内容层有 ${errors.length} 个错误，世界不会被创建（插件仍可用，agent_world_status 会列出细节）：${detail}`,
    )
    return
  }

  const warnings = state.issues().filter((i) => i.level === 'warning')
  if (warnings.length > 0) {
    logger.warn(
      `内容层有 ${warnings.length} 个警告：${warnings.slice(0, 3).map((w) => `[${w.where}] ${w.message}`).join('；')}`,
    )
  }

  // 世界先建出来（这样 agent_world_status 立刻有东西可看）。
  // **注意 `ensureWorld()` 会先试着接回上次的存档**——所以下面这句日志之前世界可能已经不是新的了。
  // `autoStart` 只决定**要不要开始推进**——配置的语义是"是否推进"，不是"是否存在"。
  try {
    state.ensureWorld()
  } catch (error) {
    logger.error(`建世界失败（已忽略，不影响 dsh 启动）：${error instanceof Error ? error.message : String(error)}`)
    return
  }

  // 事件广播：运行时往里**推**，SSE 订阅者往里**取**。同一个对象两副面孔。
  const hub = createEventHub()

  const runtime = createRuntime({
    service: state,
    tickMs: state.tickMs,
    sink: hub,
    ...(storeDir === null
      ? {}
      : {
          persist: {
            store: createWorldStore(storeDir),
            checkpointEveryTicks: resolved.persistEveryTicks,
          },
        }),
    onError: (error) =>
      logger.error(`模拟循环出错（已继续，诊断计数见 errors）：${error instanceof Error ? error.message : String(error)}`),
  })

  // **先挂清理，再启动。**
  //
  // 顺序是刻意的：dsh 支持热重载，泄漏的 setInterval 会让"改一次代码多一个世界在跑"，
  // 而症状是 CPU 慢慢爬高——很难归因到某个插件。如果先 start 再挂清理，
  // 而挂清理这一步抛了（比如 ctx 形状不对），定时器就**已经泄漏了**，没有任何人再能停它。
  ctx.effect(() => () => {
    runtime.stop()
  }, 'agent-world: runtime')

  if (resolved.autoStart) runtime.start()

  // ── HTTP：面板 + API ─────────────────────────────────────────────────────
  //
  // `webServer` 是**软依赖**：没有它时世界照跑，只是没有界面。用 `ctx.inject` 而不是写进
  // 顶层 `inject` ——写进去会让这个插件在 headless profile 里直接加载失败，
  // 而"世界能不能跑"和"有没有人看"本来就不该绑在一起（架构 §2 的第一原则）。
  ctx.inject(['webServer'], (host) => {
    const webServer = (host as unknown as {
      webServer: { register(route: { kind: 'prefix'; path: string; handler: unknown }): () => void }
    }).webServer

    const handler = createHandler(
      resolved.routePrefix,
      { service: state, runtime, source: hub, tickMs: state.tickMs },
      (error, request) => {
        const detail = error instanceof Error ? error.message : String(error)
        logger.warn(`HTTP ${request.method} ${request.pathname} 出错：${detail}`)
      },
    )

    // 整个插件只占**一个**路由座位（一个前缀），所以与别的插件不可能撞——
    // 而 `webServer.register` 撞了是会抛的，且 fallback 座位已被官方 SPA 占用，不能抢。
    const dispose = webServer.register({ kind: 'prefix', path: resolved.routePrefix, handler })
    host.effect(() => dispose, 'agent-world: http routes')

    logger.info(
      `面板与 API 挂在 ${resolved.routePrefix}/（同宿主地址）· 快照 ${resolved.routePrefix}/api/world · 事件流 ${resolved.routePrefix}/api/events`,
    )
  })

  const restored = state.restoredFrom()
  if (restored !== null) {
    logger.info(
      `已从存档接回世界（存档在 tick ${restored.savedAtTick}，用 ${restored.packVersions
        .map((p) => `${p.id}@${p.version}`)
        .join('、')} 装）——不是新开的一局。`,
    )
  }

  logger.info(
    `已就绪：${state.describeContent()} · 世界${
      resolved.autoStart ? `每 ${state.tickMs}ms 推进一次（autoStart）` : '已建好但未开始推进（autoStart=false）'
    }`,
  )
}
