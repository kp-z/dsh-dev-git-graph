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
import type { Context } from '@deepseek-ai/cordis'
import { type AgentWorldConfig, resolveConfig } from './config.js'
import { resolveContentRoot } from './content/load-files.js'
import { createRuntime } from './runtime/index.js'
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

  const state = createPluginState(resolved, { externalRoot: contentRoot.root })

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
  // `autoStart` 只决定**要不要开始推进**——配置的语义是"是否推进"，不是"是否存在"。
  try {
    state.ensureWorld()
  } catch (error) {
    logger.error(`建世界失败（已忽略，不影响 dsh 启动）：${error instanceof Error ? error.message : String(error)}`)
    return
  }

  const runtime = createRuntime({
    service: state,
    tickMs: state.tickMs,
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

  logger.info(
    `已就绪：${state.describeContent()} · 世界${
      resolved.autoStart ? `每 ${state.tickMs}ms 推进一次（autoStart）` : '已建好但未开始推进（autoStart=false）'
    }`,
  )
}
