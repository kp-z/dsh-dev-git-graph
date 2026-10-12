import type { Context } from '@deepseek-ai/cordis'
import type { DailyService } from './service.js'

/**
 * 定时任务。
 *
 * 为什么用 `setTimeout` 自己串链，而不是 `setInterval`：
 * - 日报要的是"**每天 08:00 整**"，而不是"每 24 小时"；
 * - 抓取耗时不定，interval 会让时间点持续漂移（今天 08:00:12，下周变成 08:03）；
 * - 每次跑完重新算"下一个 08:00"，天然纠正漂移与休眠错过。
 *
 * 清理走 `ctx.effect`：热重载/卸载时必须清掉定时器，否则每次 reload 都会多一个
 * 抓取器在后台跑（这是插件里最常见、也最难察觉的泄漏）。
 */

/** 计算下一次 `HH:mm`（本地时间）。时刻非法时退回 08:00。 */
export function computeNextRun(dailyTime: string, from: Date = new Date()): Date {
	const match = /^(\d{1,2}):(\d{2})$/.exec((dailyTime ?? '').trim())
	const hour = Math.min(23, Math.max(0, match ? Number(match[1]) : 8))
	const minute = Math.min(59, Math.max(0, match ? Number(match[2]) : 0))
	const next = new Date(from)
	next.setHours(hour, minute, 0, 0)
	if (next.getTime() <= from.getTime()) next.setDate(next.getDate() + 1)
	return next
}

export interface ScheduleOptions {
	dailyTime: string
	/** 额外的高频刷新间隔（分钟）；<=0 表示关闭。 */
	intervalMinutes: number
	logger: { info(message: string): void; warn(message: string): void }
	/** 每次刷新完成后的回调（用于刷新注入缓存）。 */
	onRefreshed?: () => void
}

/**
 * 装上定时；返回 disposer。
 * 定时回调里**任何异常都被吞掉并记日志** —— 一个网络抖动不该让定时链断掉。
 */
export function installSchedule(
	ctx: Context,
	service: DailyService,
	options: ScheduleOptions,
): () => void {
	let dailyTimer: ReturnType<typeof setTimeout> | null = null
	let intervalTimer: ReturnType<typeof setInterval> | null = null
	let disposed = false

	const runOnce = async (reason: string): Promise<void> => {
		if (disposed) return
		const started = Date.now()
		try {
			const summary = await service.refresh({ trigger: 'schedule' })
			options.logger.info(
				`${reason}：抓到 ${summary.total} 条，${summary.okSources} 源正常，耗时 ${Date.now() - started}ms`,
			)
			options.onRefreshed?.()
		} catch (error) {
			options.logger.warn(
				`${reason}失败：${error instanceof Error ? error.message : String(error)}`,
			)
		}
	}

	const armDaily = (): void => {
		if (disposed) return
		const next = computeNextRun(options.dailyTime)
		const delay = Math.max(1000, next.getTime() - Date.now())
		dailyTimer = setTimeout(() => {
			dailyTimer = null
			void runOnce('每日定时抓取').finally(armDaily)
		}, delay)
		// 长定时器不该拖住进程退出
		dailyTimer.unref?.()
		options.logger.info(
			`下一次定时抓取：${next.toLocaleString('zh-CN', { hour12: false })}（本地时间）`,
		)
	}
	armDaily()

	if (options.intervalMinutes > 0) {
		const ms = Math.max(60_000, options.intervalMinutes * 60_000)
		intervalTimer = setInterval(() => {
			void runOnce('周期抓取')
		}, ms)
		intervalTimer.unref?.()
		options.logger.info(`额外周期抓取：每 ${options.intervalMinutes} 分钟`)
	}

	const stop = (): void => {
		disposed = true
		if (dailyTimer) clearTimeout(dailyTimer)
		if (intervalTimer) clearInterval(intervalTimer)
		dailyTimer = null
		intervalTimer = null
	}
	ctx.effect(() => stop)
	return stop
}
