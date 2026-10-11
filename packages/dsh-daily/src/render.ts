import { PLATFORM_LABEL } from './catalog.js'
import type { Item, Prefs, SourceState } from './types.js'

/**
 * 两种呈现，同一份数据：
 * - `renderDigest` → 完整 Markdown 日报，落盘给人看（也可被模型整篇读）。
 * - `renderBrief`  → 极简摘要，注入 systemPrompt 给模型看。
 *
 * 分开写是因为它们优化的目标完全相反：日报要"信息完整"，brief 要"token 极省"。
 * 把 brief 做成 digest 的前 N 行会很省事，但每一轮模型请求都在为那几行付钱。
 */

export function humanAge(iso: string | undefined, now: Date = new Date()): string {
	if (!iso) return ''
	const time = Date.parse(iso)
	if (!Number.isFinite(time)) return ''
	const minutes = Math.round((now.getTime() - time) / 60_000)
	if (minutes < 1) return '刚刚'
	if (minutes < 60) return `${minutes} 分钟前`
	const hours = Math.round(minutes / 60)
	if (hours < 24) return `${hours} 小时前`
	const days = Math.round(hours / 24)
	if (days < 30) return `${days} 天前`
	return new Date(time).toISOString().slice(0, 10)
}

/** 热度信号的统一呈现。不同平台的数字含义不同，所以带上单位词。 */
export function statsText(item: Item): string {
	const stats = item.stats
	if (!stats) return ''
	const parts: string[] = []
	if (typeof stats.points === 'number') parts.push(`▲ ${stats.points} 分`)
	if (typeof stats.stars === 'number') parts.push(`★ ${stats.stars}`)
	if (typeof stats.views === 'number') parts.push(`${stats.views} 播放`)
	if (typeof stats.comments === 'number') parts.push(`${stats.comments} 评论`)
	return parts.join(' · ')
}

function escapeMarkdown(text: string): string {
	return text.replace(/([\\[\]()*_`])/g, '\\$1')
}

function groupByTopic(items: Item[]): Array<{ topic: string; items: Item[] }> {
	const groups = new Map<string, Item[]>()
	for (const item of items) {
		const list = groups.get(item.topic)
		if (list) list.push(item)
		else groups.set(item.topic, [item])
	}
	// 组内保持 rank 给出的顺序；组间按"组内最高分"排，让最该看的主题在最前面
	return [...groups.entries()]
		.map(([topic, list]) => ({ topic, items: list }))
		.sort((a, b) => (b.items[0]?.score ?? 0) - (a.items[0]?.score ?? 0))
}

export interface DigestOptions {
	date: string
	items: readonly Item[]
	sources: readonly SourceState[]
	prefs: Prefs
	generatedAt?: Date
	/** 单主题最多展示多少条（完整索引在侧边栏，日报不必把所有条目都抄一遍）。 */
	perTopicLimit?: number
}

export function renderDigest(options: DigestOptions): string {
	const now = options.generatedAt ?? new Date()
	const perTopic = options.perTopicLimit ?? 12
	const okSources = options.sources.filter((s) => s.ok).length
	const total = options.items.length
	const unread = options.items.filter((i) => !i.read).length

	const lines: string[] = []
	lines.push(`# 今日日报 · ${options.date}`)
	lines.push('')
	lines.push(
		`> ${total} 条索引 · ${unread} 条未读 · ${okSources}/${options.sources.length} 源正常 · 生成于 ${now.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}`,
	)
	if (options.prefs.topics.length > 0) {
		lines.push(`> 当前偏好主题：${options.prefs.topics.join(' / ')}`)
	}
	lines.push('')

	for (const group of groupByTopic([...options.items])) {
		lines.push(`## ${group.topic}（${group.items.length} 条）`)
		lines.push('')
		for (const item of group.items.slice(0, perTopic)) {
			const badges = [PLATFORM_LABEL[item.platform], item.author, humanAge(item.publishedAt, now)]
				.filter(Boolean)
				.join(' · ')
			const heat = statsText(item)
			// HN 这类源：正文是外链，讨论才是价值所在，所以两个链接都给
			const discuss = item.discussUrl ? ` · [讨论](${item.discussUrl})` : ''
			lines.push(
				`- [${escapeMarkdown(item.title)}](${item.url})${discuss}${item.read ? ' ~~已读~~' : ''}`,
			)
			lines.push(`  ${badges}${heat ? ` · ${heat}` : ''}${item.duration ? ` · ⏱ ${item.duration}` : ''}`)
			if (item.summary) lines.push(`  ${item.summary.slice(0, 160)}`)
			if (item.reasons.length > 0) lines.push(`  _为什么推荐：${item.reasons.join(' · ')}_`)
			lines.push('')
		}
		if (group.items.length > perTopic) {
			lines.push(`  …该主题还有 ${group.items.length - perTopic} 条，见右侧栏「日报」tab。`)
			lines.push('')
		}
	}

	lines.push('## 采集源状态')
	lines.push('')
	for (const source of options.sources) {
		const icon = source.ok ? '✅' : '❌'
		const detail = source.ok
			? `${source.count} 条${source.error ? `（${source.error}）` : ''}`
			: `${source.error ?? '未知错误'}`
		lines.push(`- ${icon} ${source.name} · ${detail}`)
	}
	lines.push('')
	return lines.join('\n')
}

export interface BriefOptions {
	date: string
	items: readonly Item[]
	sources: readonly SourceState[]
	/** 最多带几条标题。这是每轮都要付的 token，默认 6。 */
	maxItems: number
	now?: Date
}

/**
 * 注入 systemPrompt 的紧凑摘要。
 *
 * 只说三件事：今天有多少条、最值得看的几条、出问题时哪个源挂了。
 * 明确告诉模型"什么时候该用它"，否则它会把这段当成背景噪音而无视。
 */
export function renderBrief(options: BriefOptions): string {
	const now = options.now ?? new Date()
	const okSources = options.sources.filter((s) => s.ok).length
	const failed = options.sources.filter((s) => !s.ok)
	const unread = options.items.filter((i) => !i.read).length
	const top = [...options.items].sort((a, b) => b.score - a.score).slice(0, Math.max(0, options.maxItems))

	const lines: string[] = []
	lines.push(`【今日日报 · ${options.date}】共 ${options.items.length} 条索引，${unread} 条未读；${okSources}/${options.sources.length} 源正常。`)
	if (top.length > 0) {
		lines.push('最值得看的：')
		for (const item of top) {
			const meta = [PLATFORM_LABEL[item.platform], item.topic, humanAge(item.publishedAt, now)]
				.filter(Boolean)
				.join(' · ')
			lines.push(`- ${item.title}（${meta}）${item.url}`)
		}
	} else {
		lines.push('（今天还没有采集到条目 —— 可以调用 daily_refresh 立刻抓一轮。）')
	}
	if (failed.length > 0) {
		lines.push(`本次失败源：${failed.map((s) => `${s.name}(${s.error ?? '未知'})`).join('；')}`)
	}
	lines.push('完整索引在右侧栏「日报」tab。用户问「今天有什么值得看的 / 有什么新闻」时，直接引用上面的条目，不要另编内容。')
	return lines.join('\n')
}
