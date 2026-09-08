/**
 * dsh-dev-agent-mode host entry（薄壳 + avatar-suggest 路由）。
 *
 * Agent 模式左侧栏是纯前端 DOM 增强（client.js），不需要 host 参与；
 * 唯一 host 能力是「AI 生成头像」：POST /dsh-dev-agent-mode/api/avatar-suggest
 * 用用户的默认模型文生 SVG（见 avatar-suggest.ts）。
 * 软依赖：缺 webServer / llm / agentDefaultModel 任一时降级（AI 区块 503），
 * 预选头像（DiceBear，客户端直连）与上传路径不受影响。
 */
import type { Context } from '@deepseek-ai/cordis';
import { mountAvatarSuggest } from './avatar-suggest.js';

export const name = 'dev-agent-mode';
export const inject: string[] = [];

export interface DevAgentModePluginConfig {}

export function apply(ctx: Context, _config: Partial<DevAgentModePluginConfig> = {}): void {
	const disposers = mountAvatarSuggest(ctx);
	if (disposers.length === 0) return; // 无 webServer：纯客户端模式，无路由
	(ctx.on as (event: string, cb: () => void) => void)('dispose', () => {
		for (const d of disposers) d();
	});
}
