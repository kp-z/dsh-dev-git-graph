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
	/**
	 * `apply` **整体兜底**：本插件在加载期抛异常，后果不是"功能少了"，
	 * 而是**插件条目加载失败**（客户端半体已经因此把用户的界面打成错误页一次）。
	 *
	 * 宿主半体的同步体本身很薄（配置默认值 + 建 service + 注册 inject 回调），
	 * `resolveConfig` 是纯默认值填充、不会抛 —— 但"薄"和"不会抛"都不是结构保证。
	 * 这里要的是一条**结构保证**：无论将来加了什么，本插件的加载期失败都只降级、不炸宿主。
	 */
	try {
		applyInner(ctx, config ?? {})
	} catch (error) {
		// 拿不到 logger 也要留痕：console 是最后可用的通道
		const detail = error instanceof Error ? error.stack ?? error.message : String(error)
		try {
			ctx.logger('daily').error(`日报插件初始化失败（已忽略，不影响 dsh 启动）：${detail}`)
		} catch {
			// eslint-disable-next-line no-console
			console.error('[dsh-daily] 初始化失败（已忽略，不影响 dsh 启动）：', detail)
		}
	}
}

function applyInner(ctx: Context, config: Partial<DailyConfig>): void {
	const settings = resolveConfig(config)
	if (!settings.enabled) return

	const raw = ctx.logger('daily')
	const logger: DailyLogger = {
		info: (message) => raw.info(message),
		warn: (message) => raw.warn(message),
		error: (message) => raw.error(message),
	}
	const service = new DailyService(settings, logger)

	// 可选服务用**各自的作用域**声明式获取：cordis 里没声明的服务访问会抛，
	// 所以不能靠在主作用域里 get()。各自 inject 的好处是"有就有、没有就跳过"，
	// 不会把主装配拖成 pending。
	for (const serviceName of ['sessions', 'workspaceRegistry'] as const) {
		try {
			ctx.inject([serviceName], (scoped) => {
				service.attachHost(scoped)
			})
		} catch (error) {
			logger.warn(
				`订阅宿主服务 ${serviceName} 失败（自动识别少一个来源）：${error instanceof Error ? error.message : String(error)}`,
			)
		}
	}

	ctx.inject(['tools', 'webServer'], (host) => {
		// 自动识别要读"当前会话/工作区"，先把宿主 ctx 交给 service（拿不到就保持默认项目）
		try {
			service.attachHost(host)
		} catch (error) {
			logger.warn(
				`把宿主上下文交给自动识别失败（其降级为关闭）：${error instanceof Error ? error.message : String(error)}`,
			)
		}
		void bootstrap(host, service, settings, logger)
	})
}

/**
 * 异步装配。**整体再包一层 try/catch**（最后防线）。
 *
 * 里面每一段接线都已各自兜底，这一层的价值在于：将来新增一段忘了兜底时，
 * 最坏结果是"后面几段没接上"，而不会变成一个 unhandled rejection ——
 * 那种情况在日志里只有一行警告，排查时根本不知道插件少接了什么。
 */
async function bootstrap(
	host: Context,
	service: DailyService,
	settings: DailyConfig,
	logger: DailyLogger,
): Promise<void> {
	try {
		await bootstrapInner(host, service, settings, logger)
	} catch (error) {
		logger.error(
			`装配过程中出现未预期错误（插件部分功能可能未接上）：${error instanceof Error ? error.stack ?? error.message : String(error)}`,
		)
	}
}

async function bootstrapInner(
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

	// ---- 项目自动识别（先来一次，让侧边栏首屏就是"当前项目"的数据）----
	try {
		const detected = await service.autoDetect()
		if (detected.changed) logger.info(`项目自动识别：已切到 ${detected.dir}（来源 ${detected.from}）`)
		else logger.info(`项目自动识别：${detected.reason}`)
	} catch (error) {
		logger.warn(`项目自动识别失败（保持当前项目）：${error instanceof Error ? error.message : String(error)}`)
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
	// 各自兜底：一段接线失败不该让**后面几段**跟着不接（早先这两段就是裸的，
	// 一抛就会把 AI 接线与启动补抓一起跳过，而日志里只看到一次 unhandled rejection）
	if (settings.announceToAgent) {
		try {
			const disposePrompt = installPromptSection(host, service, {
				maxItems: settings.announceMaxItems,
				logger,
				// 每轮装配都带上"当前会话"的上下文 —— 这是自动识别最准的来源
				onRender: (context) => service.notePromptContext(context),
			})
			host.effect(() => disposePrompt)
		} catch (error) {
			logger.warn(
				`注入 systemPrompt 失败（主动推荐降级为关闭）：${error instanceof Error ? error.message : String(error)}`,
			)
		}
	}

	// ---- 定时 ----
	try {
		const stopSchedule = installSchedule(host, service, {
			dailyTime: settings.dailyTime,
			intervalMinutes: settings.refreshIntervalMinutes,
			logger,
		})
		host.effect(() => stopSchedule)
	} catch (error) {
		logger.warn(
			`注册定时任务失败（定时刷新降级为关闭）：${error instanceof Error ? error.message : String(error)}`,
		)
	}

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
