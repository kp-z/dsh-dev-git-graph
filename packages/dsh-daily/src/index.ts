/**
 * dsh-daily host 入口。
 *
 * 装配顺序（每一步都依赖前一步）：
 *   store 就绪 → 挂 HTTP 路由（侧边栏页面与接口）→ 注册工具 → 注入 systemPrompt → 装定时 → 启动补抓
 *
 * 一个刻意的选择：`apply` 是同步的，异步初始化放在 `bootstrap` 里 fire-and-forget。
 * Loader 不等待 apply 的返回值，如果这里 await 一个可能超时的初始化（比如首次抓取），
 * 表现会是"整个 profile 卡住"。所以：初始化尽早在后台跑，失败只记日志、不抛。
 */
import type { Context } from '@deepseek-ai/cordis'
import type { StreamChunkLike, StreamRequest } from './ai.js'
import { DailyConfig, resolveConfig } from './config.js'
import { mountRoutes } from './api.js'
import { installPromptSection } from './prompt.js'
import { installSchedule } from './schedule.js'
import { DailyService, type DailyLogger, type ServiceStatePayload } from './service.js'
import { registerDailyTools } from './tools.js'

/** Loader entry id。 */
export const name = 'daily'

/** 依赖的 service。缺一个就 fail-loud —— 这两种能力都是本插件的骨架。 */
export const inject = ['tools', 'webServer']

/** 配置 schema（dsh 用它做校验与设置页投影）。 */
export { DailyConfig }

export type { ServiceStatePayload }

interface WebServerLike {
	register(spec: {
		kind: 'exact' | 'prefix'
		path: string
		handler: (req: import('node:http').IncomingMessage, res: import('node:http').ServerResponse) => void
	}): () => void
}

/**
 * 宿主 llm 服务的窄视图。
 *
 * 只声明我们真正会调的那一个方法：插件与 `@deepseek-ai/dsh-llm` 的完整类型解耦，
 * 也不至于因为宿主版本的签名细节差异而编译不过 —— 我们只往这个缝里塞一个 GenerateOptions 子集。
 */
interface LlmLike {
	stream(options: StreamRequest): AsyncIterable<StreamChunkLike>
}

export function apply(ctx: Context, config: Partial<DailyConfig> = {}): void {
	const settings = resolveConfig(config ?? {})
	if (!settings.enabled) return

	const raw = ctx.logger('daily')
	const logger: DailyLogger = {
		info: (message) => raw.info(message),
		warn: (message) => raw.warn(message),
		error: (message) => raw.error(message),
	}
	const service = new DailyService(settings, logger)

	ctx.inject(['tools', 'webServer'], (host) => {
		void bootstrap(host, service, settings, logger)
	})
}

async function bootstrap(
	host: Context,
	service: DailyService,
	settings: DailyConfig,
	logger: DailyLogger,
): Promise<void> {
	try {
		await service.init()
	} catch (error) {
		logger.error(
			`数据目录初始化失败，插件停用：${error instanceof Error ? error.message : String(error)}`,
		)
		return
	}

	// ---- HTTP 路由：侧边栏网页 + 接口 ----
	try {
		const webServer = (host as unknown as { webServer: WebServerLike }).webServer
		const disposeRoutes = mountRoutes(webServer, service)
		host.effect(() => disposeRoutes)
		logger.info('路由已挂载：/dsh-daily/（侧边栏页面）与 /dsh-daily/api/*')
	} catch (error) {
		logger.error(
			`挂载路由失败：${error instanceof Error ? error.message : String(error)}`,
		)
	}

	// ---- 工具 ----
	try {
		registerDailyTools(host, service)
	} catch (error) {
		logger.warn(`注册工具失败：${error instanceof Error ? error.message : String(error)}`)
	}

	// ---- systemPrompt 主动推荐 ----
	if (settings.announceToAgent) {
		const disposePrompt = installPromptSection(host, service, {
			maxItems: settings.announceMaxItems,
			logger,
		})
		host.effect(() => disposePrompt)
	}

	// ---- 定时 ----
	const stopSchedule = installSchedule(host, service, {
		dailyTime: settings.dailyTime,
		intervalMinutes: settings.refreshIntervalMinutes,
		logger,
	})
	host.effect(() => stopSchedule)

	// ---- AI 摘要接线（可选功能，默认关闭）----
	// 放在依赖注入完成之后：service 先建好，这里再把 ctx.llm 与默认模型选择递进去。
	// 拿不到就递 null —— service 会退化成"没有 AI 摘要"，而不是让插件加载失败。
	try {
		const scoped = host as unknown as {
			llm?: LlmLike
			agentDefaultModel?: { currentSelection?: () => { provider?: string; model?: string } }
			get?: (name: string) => unknown
		}
		const llm = scoped.llm ?? (typeof scoped.get === 'function' ? (scoped.get('llm') as LlmLike) : undefined)
		const defaults =
			scoped.agentDefaultModel ??
			(typeof scoped.get === 'function'
				? (scoped.get('agentDefaultModel') as { currentSelection?: () => { provider?: string; model?: string } })
				: undefined)
		service.setLlm(
			llm && typeof llm.stream === 'function' ? (options) => llm.stream(options) : null,
			() => {
				try {
					const selection = defaults?.currentSelection?.()
					if (selection?.provider && selection?.model) {
						return { provider: selection.provider, model: selection.model }
					}
				} catch {
					/* 默认模型读不到就当作没有 */
				}
				return null
			},
		)
		if (settings.aiSummaryEnabled) {
			logger.info(
				llm ? 'AI 摘要已开启：模型能力已接入。' : 'AI 摘要已开启，但宿主没有 llm 服务，本轮不会生成摘要。',
			)
		}
	} catch (error) {
		logger.warn(`AI 摘要接线失败（功能降级为关闭）：${error instanceof Error ? error.message : String(error)}`)
	}

	// ---- 启动补抓 ----
	if (settings.autoRefreshOnStart) {
		try {
			const day = await service.getDay()
			if (day.items.length === 0) {
				logger.info('今天还没有数据，启动补抓一轮……')
				void service.refresh({ trigger: 'startup' }).catch((error: unknown) => {
					logger.warn(
						`启动补抓失败：${error instanceof Error ? error.message : String(error)}`,
					)
				})
			}
		} catch (error) {
			logger.warn(
				`检查当天数据失败：${error instanceof Error ? error.message : String(error)}`,
			)
		}
	}
}
