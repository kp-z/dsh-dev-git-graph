/**
 * dsh-tab-split host entry：无 host 行为。
 * 该插件是纯浏览器 client 插件（见 src/client.js），host 侧仅满足 Loader entry 契约。
 */
import type { Context } from '@deepseek-ai/cordis';

export const name = 'tab-split';
export const inject: string[] = [];

export interface TabSplitPluginConfig {}

export function apply(_ctx: Context, config: Partial<TabSplitPluginConfig> = {}): void {
	void config;
	// 浏览器半区通过 package.json dsh.client 元数据自动加载 ./client，无需 host 注册。
}
