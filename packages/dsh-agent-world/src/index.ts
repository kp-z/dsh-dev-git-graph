/**
 * dsh-agent-world —— host 入口。
 *
 * 装配逻辑一句话：**内容与世界必挂，界面可选**。
 * - `tools` 是硬依赖：没有工具注册表，模型无法与世界交互，这个插件就没有意义。
 * - `webServer`（M3 之后）会用 `ctx.inject` 按需等待：没有它时世界照跑，只是没有 3D 面板。
 *   把"模拟能力"与"展示能力"解耦，是为了让世界不依赖宿主是否恰好挂了 HTTP 服务。
 *
 * 当前进度（R2）：内容库层（装载/校验/注册表/内置包）已就位，世界由内容装配。
 * 模拟循环见 BACKLOG M2，3D 面板见 M4。
 * 架构见 docs/ARCHITECTURE.md，内容模型见 docs/CONTENT.md，轮次队列见 docs/BACKLOG.md。
 */
import type { Context } from '@deepseek-ai/cordis'
import { type AgentWorldConfig, resolveConfig } from './config.js'
import { createPluginState } from './state.js'
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
  const state = createPluginState(resolved)

  registerWorldTools(ctx, state)

  // 内容层的问题不阻断插件加载——照 dsh-daily 的做法：
  // 插件树加载失败会让**整个 dsh 起不来**，那个代价远大于"世界暂时建不出来"。
  // 所以这里只把问题说出来，让人去 agent_world_status 看细节。
  const errors = state.contentIssues.filter((i) => i.level === 'error')
  if (errors.length > 0) {
    const detail = errors
      .slice(0, 5)
      .map((e) => `[${e.where}] ${e.message}`)
      .join('；')
    ctx.logger('agent-world').error(
      `内容层有 ${errors.length} 个错误，世界不会被创建（插件仍可用，agent_world_status 会列出细节）：${detail}`,
    )
    return
  }

  const warnings = state.contentIssues.filter((i) => i.level === 'warning')
  if (warnings.length > 0) {
    ctx.logger('agent-world').warn(`内容层有 ${warnings.length} 个警告：${warnings.slice(0, 3).map((w) => `[${w.where}] ${w.message}`).join('；')}`)
  }

  // `autoStart` 目前只是把世界先建出来（模拟循环还没接）。
  // 不要在这里把 autoStart=false 实现成"不建世界"——配置的语义是"是否推进"，不是"是否存在"。
  if (resolved.autoStart) {
    try {
      state.ensureWorld()
    } catch (error) {
      // 建世界失败同样不该拖垮整个 profile。
      ctx.logger('agent-world').error(`建世界失败（已忽略，不影响 dsh 启动）：${error instanceof Error ? error.message : String(error)}`)
    }
  }

  ctx.logger('agent-world').info(`已就绪：${state.describeContent()}`)
}
