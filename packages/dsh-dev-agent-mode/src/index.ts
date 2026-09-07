/**
 * dsh-dev-agent-mode host entry（薄壳）。
 *
 * MVP 目标「最薄」：Agent 模式是纯前端渲染（左侧栏 sidebar.workspaces 孔位替换），
 * 不需要任何 host 路由/服务/工具。此处仅保留占位入口，保证插件能作为 dsh bundle
 * 被加载（Loader 要求 name/inject/apply 三件套），并预留未来 host 能力
 * （Agent 个性注入、persistence 等）的挂载点。
 */
import type { Context } from '@deepseek-ai/cordis';

export const name = 'dev-agent-mode';
export const inject: string[] = [];

export interface DevAgentModePluginConfig {}

export function apply(_ctx: Context, _config: Partial<DevAgentModePluginConfig> = {}): void {
	// 纯客户端插件：host 侧无副作用。client.js 通过 dsh.client.inject 自动挂载。
}
