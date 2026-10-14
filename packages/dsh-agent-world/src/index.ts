/**
 * dsh-agent-world —— host 入口。
 *
 * 装配逻辑一句话：**世界模型与工具必挂，界面可选**。
 * - `tools` 是硬依赖：没有工具注册表，模型无法与世界交互，这个插件就没有意义。
 * - `webServer`（M2 之后）会用 `ctx.inject` 按需等待：没有它时世界照跑，只是没有 3D 面板。
 *   把"模拟能力"与"展示能力"解耦，是为了让世界不依赖宿主是否恰好挂了 HTTP 服务。
 *
 * 当前进度（R1）：世界模型 + 两个工具。模拟循环见 BACKLOG M1，3D 面板见 M3。
 * 架构见 docs/ARCHITECTURE.md，轮次队列见 docs/BACKLOG.md。
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

  // `autoStart` 目前只是把世界先建出来（模拟循环还没接）。
  // 不要在这里把 autoStart=false 实现成"不建世界"——配置的语义是"是否推进"，不是"是否存在"。
  if (resolved.autoStart) state.ensureWorld()
}
