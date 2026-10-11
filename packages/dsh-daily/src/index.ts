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

	// ---- 启动补抓 ----
	if (settings.autoRefreshOnStart) {
		try {
			const day = await service.getDay()
			if (day.items.length === 0) {
				logger.info('今天还没有数据，启动补抓一轮……')
				void service.refresh().catch((error: unknown) => {
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
