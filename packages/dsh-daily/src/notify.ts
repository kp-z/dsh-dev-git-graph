/**
 * 桌面通知（macOS 原生）。
 *
 * 为什么要它：用户最初的需求第一条就是「**每日主动**给我推荐不同类型的新闻」。
 * 到目前为止"主动"只体现在两处：日报文件 + 注入 systemPrompt（模型在对话里提起）。
 * 这两者都要求用户**正在看**。桌面通知才是真的"不用看也知道"。
 *
 * 本机现实：宿主**没有**任何通知服务（`@deepseek-ai/` 下没有 notifier/toast 包，
 * 也没有对应 service 可 inject）。所以要落到系统层 —— macOS 用 `osascript`。
 *
 * 两条设计原则：
 *
 * 1. **默认关闭**。通知是侵入性的（会打断用户正在做的事）。一个"每天弹一次"的默认值
 *    不该由插件替用户决定 —— 和"默认不删归档"是同一个判断。
 *
 * 2. **文本走 argv，不拼进 AppleScript 源码**。新闻标题里出现引号、反斜杠、换行都是常态，
 *    拼接字符串总会有漏网之鱼（而且这类漏洞的表现是"脚本报错、通知不出现"，很难查）。
 *    `osascript -e 'on run argv' …' arg1 arg2` 把文本作为参数传进去，从根上杜绝。
 */
import type { Item } from './types.js'

export interface NotificationPayload {
	title: string
	body: string
}

export interface DailyNotificationInput {
	date: string
	/** 当天的条目总数。 */
	total: number
	/** 挑好的代表条目（调用方用 pickDiverse，好让通知也体现"不同类型"）。 */
	items: readonly Pick<Item, 'title' | 'topic'>[]
	/** 未读条数（可选）。 */
	unread?: number
	/** 正文里最多列几条标题。 */
	maxTitles?: number
	appName?: string
}

/** macOS 通知正文会被截断，留个余量。 */
export const BODY_MAX_CHARS = 180

function clip(text: string, max: number): string {
	const clean = text.replace(/\s+/g, ' ').trim()
	if (clean.length <= max) return clean
	return `${clean.slice(0, Math.max(0, max - 1))}…`
}

/**
 * 组装通知内容。
 *
 * 正文用「· 标题1 · 标题2」而不是换行：macOS 的通知横幅对换行支持很差，
 * 经常把多行压成一行还吃掉后半段。单行 + 分隔符是实测最稳的形态。
 */
export function buildDailyNotification(input: DailyNotificationInput): NotificationPayload {
	const appName = input.appName ?? '日报'
	const maxTitles = Math.max(0, input.maxTitles ?? 3)
	const shown = input.items.slice(0, maxTitles)

	const head =
		input.total > 0
			? `${input.total} 条索引${typeof input.unread === 'number' ? ` · ${input.unread} 未读` : ''}`
			: '今天没有新条目'

	const titles = shown.map((item) => clip(item.title, 40)).filter(Boolean)
	const body =
		titles.length > 0 ? clip(`${head}：${titles.join(' · ')}`, BODY_MAX_CHARS) : clip(head, BODY_MAX_CHARS)

	return { title: `${appName} · ${input.date}`, body: body || head }
}

export interface SpawnOutcome {
	ok: boolean
	error?: string
}

/** 注入点：测试里换成假的，就不用真的弹通知。 */
export type SpawnFn = (command: string, args: readonly string[]) => Promise<SpawnOutcome>

/** 默认 spawn：用 node:child_process，绝不继承 stdio（否则会污染插件日志）。 */
export const defaultSpawn: SpawnFn = async (command, args) => {
	const { spawn } = await import('node:child_process')
	return new Promise<SpawnOutcome>((resolve) => {
		try {
			const child = spawn(command, [...args], { stdio: 'ignore' })
			child.on('error', (error) => resolve({ ok: false, error: error.message }))
			child.on('close', (code) =>
				resolve(code === 0 ? { ok: true } : { ok: false, error: `osascript 退出码 ${code}` }),
			)
		} catch (error) {
			resolve({ ok: false, error: error instanceof Error ? error.message : String(error) })
		}
	})
}

export interface NotifyOptions {
	enabled: boolean
	spawn?: SpawnFn
	platform?: string
	signal?: AbortSignal
}

export interface NotifyResult {
	sent: boolean
	/** 没发出去的原因（会写进日志，方便用户搞清"为什么没弹通知"）。 */
	reason?: string
}

/**
 * AppleScript 片段：从 argv 取标题与正文。
 * 用 argv 而不是把内容拼进脚本 —— 见文件头第 2 条原则。
 */
export const APPLESCRIPT_ARGS = [
	'-e',
	'on run argv',
	'-e',
	'display notification (item 1 of argv) with title (item 2 of argv)',
	'-e',
	'end run',
]

/**
 * 发送通知。**永不抛异常** —— 通知失败绝不能影响采集结果。
 * 返回原因是为了可诊断：用户问"为什么没弹"，日志里要能答上来。
 */
export async function sendNotification(
	payload: NotificationPayload,
	options: NotifyOptions,
): Promise<NotifyResult> {
	if (!options.enabled) return { sent: false, reason: '未开启（notifyEnabled=false）' }
	const platform = options.platform ?? process.platform
	if (platform !== 'darwin') return { sent: false, reason: `当前平台（${platform}）暂不支持桌面通知` }
	if (!payload.body.trim()) return { sent: false, reason: '通知内容为空' }

	const spawnFn = options.spawn ?? defaultSpawn
	try {
		const outcome = await spawnFn('osascript', [...APPLESCRIPT_ARGS, payload.body, payload.title])
		return outcome.ok ? { sent: true } : { sent: false, reason: outcome.error ?? '未知错误' }
	} catch (error) {
		return { sent: false, reason: error instanceof Error ? error.message : String(error) }
	}
}
