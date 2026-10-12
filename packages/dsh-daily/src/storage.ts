import type { Item } from './types.js'

/**
 * 归档容量管理。
 *
 * 为什么必须做：这个插件要**每天跑、长期跑**。`days/*.json` 一天约 50KB，
 * 一年就是 ~19MB；而 `listArchive` / `daily_search` / 周报都要读这些文件，
 * 读得越久越慢。更关键的是：**旧条目的详细摘要早就不重要了** ——
 * 三个月前那篇论文的 400 字原文摘要没有任何人会回去看，但它的标题、链接、主题仍然有用。
 *
 * 所以策略是"分级保留"而不是"一刀切删除"：
 * - 最近 N 天（默认 60）：完整保留（摘要、热度、推荐理由、封面都在）
 * - 更早：**压缩**成索引（标题/链接/主题/来源/分数/已读状态）—— 搜索和归档都还能用
 * - 再早且用户显式开启（默认关闭）：删除整天文件
 *
 * 默认**不删除**任何东西。数据是不可再生的，一个"自动清理"的默认值不该由插件替用户决定。
 */

export interface StorageOptions {
	/** 超过这些天的归档被压缩。0 = 不压缩（保留全部细节）。 */
	compactAfterDays: number
	/** 超过这些天的归档被**删除**。0 = 永不删除。 */
	deleteAfterDays: number
}

export type PruneAction = 'keep' | 'compact' | 'delete'

export interface DayPlan {
	date: string
	action: PruneAction
	items: number
	bytes: number
	/** 压缩后预计占用（仅 compact 有意义）。 */
	estimatedBytes?: number
}

/** `YYYY-MM-DD` 减天数，纯字符串进纯字符串出。 */
function shift(date: string, days: number): string {
	const base = new Date(`${date}T12:00:00`)
	if (!Number.isFinite(base.getTime())) return date
	base.setDate(base.getDate() - days)
	const y = base.getFullYear()
	const m = `${base.getMonth() + 1}`.padStart(2, '0')
	const d = `${base.getDate()}`.padStart(2, '0')
	return `${y}-${m}-${d}`
}

/**
 * 决定每一天该怎么处理。
 *
 * 边界语义（都按"日历天"算，与跨天去重一致）：
 * - `date >= today - compactAfterDays` → keep
 * - `deleteAfterDays > 0 且 date < today - deleteAfterDays` → delete（**优先生效**）
 * - 否则 → compact
 *
 * `deleteAfterDays <= compactAfterDays` 是无意义的组合（会先压再删，白做功），
 * 这里把它当作"不删除"处理，由调用方记一条告警。
 */
export function planArchive(
	days: ReadonlyArray<{ date: string; items: number; bytes: number }>,
	today: string,
	options: StorageOptions,
): DayPlan[] {
	const compactAfter = Math.max(0, options.compactAfterDays)
	const deleteAfter = Math.max(0, options.deleteAfterDays)
	const effectiveDelete = deleteAfter > compactAfter ? deleteAfter : 0

	const keepFrom = shift(today, compactAfter)
	const deleteBefore = effectiveDelete > 0 ? shift(today, effectiveDelete) : null

	return days.map((day) => {
		const items = Math.max(0, day.items)
		const bytes = Math.max(0, day.bytes)
		if (compactAfter === 0) return { date: day.date, action: 'keep', items, bytes }
		if (deleteBefore && day.date < deleteBefore) {
			return { date: day.date, action: 'delete', items, bytes }
		}
		if (day.date < keepFrom) {
			return {
				date: day.date,
				action: 'compact',
				items,
				bytes,
				// 压缩后的粗估：每条索引约 200 字节（标题+链接+几个字段）
				estimatedBytes: 40 + items * 200,
			}
		}
		return { date: day.date, action: 'keep', items, bytes }
	})
}

/**
 * 把一条条目压成"索引态"。
 *
 * 保留：定位（id/url）、搜索（title/topic/sourceName/platform）、归档与周报
 * （score/publishedAt/firstSeenAt）、用户态（read/liked/disliked/hidden）、
 * 以及很短但很有用的 aiSummary 与 duration。
 *
 * 丢弃：summary（最长 400 字，是体积大头）、stats（热度只在当天有意义）、
 * reasons（推荐理由只在当天的列表里有参照价值）、thumb / discussUrl / author。
 */
export function compactItem(item: Item): Item {
	const out: Item = {
		id: item.id,
		title: item.title,
		url: item.url,
		kind: item.kind,
		platform: item.platform,
		sourceId: item.sourceId,
		sourceName: item.sourceName,
		topic: item.topic,
		score: item.score,
		reasons: [],
		read: item.read,
		liked: item.liked,
		disliked: item.disliked,
		hidden: item.hidden,
		firstSeenAt: item.firstSeenAt,
	}
	if (item.publishedAt) out.publishedAt = item.publishedAt
	if (item.aiSummary) out.aiSummary = item.aiSummary
	if (item.duration) out.duration = item.duration
	return out
}

/** 判断一条是否已经是索引态（避免重复压缩与无谓写盘）。 */
export function isCompacted(item: Item): boolean {
	return (
		item.summary === undefined &&
		item.stats === undefined &&
		item.thumb === undefined &&
		(item.reasons === undefined || item.reasons.length === 0)
	)
}

export function formatBytes(bytes: number): string {
	if (!Number.isFinite(bytes) || bytes <= 0) return '0 B'
	const units = ['B', 'KB', 'MB', 'GB']
	let value = bytes
	let unit = 0
	while (value >= 1024 && unit < units.length - 1) {
		value /= 1024
		unit++
	}
	return `${value >= 10 || unit === 0 ? Math.round(value) : value.toFixed(1)} ${units[unit]}`
}

export interface PruneReport {
	dryRun: boolean
	keep: number
	compacted: number
	deleted: number
	freedBytes: number
	/** 仅列出真正会/已经发生变化的日期（避免把 300 天都打出来）。 */
	changes: DayPlan[]
}
