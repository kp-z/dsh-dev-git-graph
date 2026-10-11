import { PLATFORM_LABEL } from './catalog.js'
import type { Item, SourceState } from './types.js'

/**
 * 归档与周报。
 *
 * 为什么需要：侧边栏原本只看得到今天。"高价值**索引**"这个词本身就意味着能往回翻 ——
 * 三天前看到的那篇论文、上周那条视频，都应该找得回来（`daily_search` 能搜，
 * 但"按天翻"是另一条完全不同的检索路径，而且更符合人的回忆方式：
 * "我记得是周二前后看到的"）。
 *
 * 这里的函数全是**纯函数**：service 负责读盘，本文件只做聚合与渲染。
 * 于是"周报到底长什么样、边界日期怎么算"都能被单测钉住。
 */

export interface ArchiveDay {
	date: string
	total: number
	unread: number
	/** 主题 → 条数 */
	topics: Record<string, number>
	/** 是否已经生成过那天的 Markdown 日报 */
	digest: boolean
}

/** 把一天的条目压成归档摘要。 */
export function summarizeDay(
	date: string,
	items: readonly Item[],
	digestAvailable: boolean,
): ArchiveDay {
	const topics: Record<string, number> = {}
	let unread = 0
	for (const item of items) {
		topics[item.topic] = (topics[item.topic] ?? 0) + 1
		if (!item.read) unread++
	}
	return { date, total: items.length, unread, topics, digest: digestAvailable }
}

/** 取某天里分数最高的几条。周报的"最值得看"用它。 */
export function topItems(items: readonly Item[], limit: number): Item[] {
	return [...items].sort((a, b) => b.score - a.score).slice(0, Math.max(0, limit))
}

/** 主题分布：返回按条数降序的 `[主题, 条数]`。 */
export function topicDistribution(items: readonly Item[]): Array<[string, number]> {
	const counts = new Map<string, number>()
	for (const item of items) counts.set(item.topic, (counts.get(item.topic) ?? 0) + 1)
	return [...counts.entries()].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))
}

export interface WeeklyInput {
	/** 窗口内的日期列表（升序），用于"每天"小节。 */
	days: readonly ArchiveDay[]
	/** 窗口内的全部条目。 */
	items: readonly Item[]
	/** 最近一天的源状态（周报里只报最近一次，因为历史源状态没有留存） */
	sources: readonly SourceState[]
	start: string
	end: string
	/** "最值得看"取几条。 */
	topLimit?: number
	/** 主题分布里每个主题带一个代表条目。 */
	now?: Date
}

function escapeMarkdown(text: string): string {
	return text.replace(/([\\[\]()*_`])/g, '\\$1')
}

/**
 * 渲染周报 Markdown。
 *
 * 四个小节各有各的用处：
 * - **最值得看**：跨天的全局排序，回答"这周最好的东西是什么"
 * - **按主题**：回答"我这周的时间花在哪个方向上了"
 * - **每天**：回答"哪天信息量大/哪天断采了"（条数骤降通常意味着采集出问题）
 * - **源健康**：把失败源显式写出来，避免"某周少了 YouTube"这种问题被悄悄吞掉
 */
export function renderWeeklyReview(input: WeeklyInput): string {
	const now = input.now ?? new Date()
	const topLimit = input.topLimit ?? 10
	const total = input.items.length
	const unread = input.items.filter((item) => !item.read).length
	const sources = input.sources

	const lines: string[] = []
	lines.push(`# 日报周报 · ${input.start} ~ ${input.end}`)
	lines.push('')
	lines.push(
		`> ${input.days.length} 天 · ${total} 条索引 · ${unread} 条未读 · 覆盖 ${sources.length} 个采集源`,
	)
	lines.push('')

	// ---- 最值得看 ----
	lines.push(`## 本周最值得看的 ${Math.min(topLimit, total)} 条`)
	lines.push('')
	for (const [index, item] of topItems(input.items, topLimit).entries()) {
		const meta = [PLATFORM_LABEL[item.platform], item.topic, item.sourceName, item.publishedAt?.slice(0, 10)]
			.filter(Boolean)
			.join(' · ')
		lines.push(`${index + 1}. [${escapeMarkdown(item.title)}](${item.url})`)
		lines.push(`   ${meta} · 分数 ${item.score}`)
		const blurb = item.aiSummary ?? item.summary
		if (blurb) lines.push(`   ${blurb.slice(0, 140)}`)
		if (item.reasons.length > 0) lines.push(`   _${item.reasons.join(' · ')}_`)
		lines.push('')
	}

	// ---- 按主题 ----
	const distribution = topicDistribution(input.items)
	if (distribution.length > 0) {
		lines.push('## 按主题')
		lines.push('')
		for (const [topic, count] of distribution) {
			const share = total > 0 ? Math.round((count / total) * 100) : 0
			// 代表条目：该主题里分数最高的那条
			const best = topItems(
				input.items.filter((item) => item.topic === topic),
				1,
			)[0]
			const label = best ? ` · 代表：[${escapeMarkdown(best.title.slice(0, 40))}](${best.url})` : ''
			lines.push(`- **${topic}**：${count} 条（${share}%）${label}`)
		}
		lines.push('')
	}

	// ---- 每天 ----
	if (input.days.length > 0) {
		lines.push('## 每天')
		lines.push('')
		lines.push('| 日期 | 条数 | 未读 | 最高分 | 日报 |')
		lines.push('| --- | --- | --- | --- | --- |')
		for (const day of input.days) {
			const dayItems = input.items.filter((item) => (item.firstSeenAt ?? '').startsWith(day.date))
			const best = dayItems.length > 0 ? Math.max(...dayItems.map((item) => item.score)) : null
			const topics = Object.entries(day.topics)
				.sort((a, b) => b[1] - a[1])
				.slice(0, 2)
				.map(([topic, count]) => `${topic} ${count}`)
				.join('、')
			lines.push(
				`| ${day.date} | ${day.total}${topics ? `（${topics}）` : ''} | ${day.unread} | ${best === null ? '—' : best.toFixed(1)} | ${day.digest ? '✅' : '—'} |`,
			)
		}
		lines.push('')
	}

	// ---- 源健康 ----
	if (sources.length > 0) {
		lines.push(`## 采集源（最近一轮 ${sources[0]?.at?.slice(0, 16)?.replace('T', ' ') ?? ''}）`)
		lines.push('')
		for (const source of sources) {
			const icon = source.ok ? '✅' : '❌'
			lines.push(
				`- ${icon} ${source.name} · ${source.ok ? `${source.count} 条` : (source.error ?? '失败')}`,
			)
		}
		lines.push('')
	}

	lines.push(`_生成于 ${now.toISOString().slice(0, 16).replace('T', ' ')}_`)
	lines.push('')
	return lines.join('\n')
}

/** 周报文件名：按 ISO 周编号，便于一眼看出覆盖哪一周。 */
export function weekFileName(start: string, end: string): string {
	return `week-${start}_${end}.md`
}
