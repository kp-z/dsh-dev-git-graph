/**
 * 同一天的数据合并。
 *
 * 修的是什么：早先 `runRefresh` 是"用本轮采集结果**整份覆盖**当天"——
 * `items = rankItems(outcome.items)` 之后直接 `writeDay`。后果对用户可见：
 *
 * - **定向刷新会冲掉当天其它源的内容**（`daily_refresh({ sources: [...] })`、
 *   以及任何只跑部分源的调用）
 * - **同一天第二次刷新时若某个源失败，那个源上午抓到的条目会从今天的列表里消失** ——
 *   表现就是"刷新了一下，条目反而变少了"。在一个"索引"类产品里，这种观感比崩溃更伤信任
 *
 * 改成语义正确的**合并**：当天已有的条目 + 本轮新抓的条目，按规范化 URL 去重后一起排序。
 *
 * 合并时必须**继承**的东西（否则修好一个问题会引入另一个）：
 * - `firstSeenAt`：条目"第一次被我看到"的时间。丢了它会让老条目看起来是刚出现的，
 *   从而在跨天去重和新鲜度打分上被当成新内容
 * - `aiSummary`：已经花过钱生成的摘要。丢了就等于每次刷新都重新调用模型
 *
 * 不需要继承的：`read/liked/disliked/hidden` —— 这些的真源是 `feedback.json`
 * （按 `itemId(url)` 索引），`rankItems` 每次都会从那里重新填，所以天然不会丢。
 */

import { normalizeUrl } from './rank.js'
import type { RawItem } from './types.js'

/**
 * 合并只关心"采集器给的字段 + 两个需要继承的字段"。
 * 用这个结构而不是 `Item`：新抓的条目还没排名、还没有 `id/score/read` 这些派生字段。
 */
export type MergeableItem = RawItem & { firstSeenAt?: string; aiSummary?: string }

export interface MergeDayResult {
	/** 合并后的条目（未排序；排序交给 rankItems）。 */
	items: MergeableItem[]
	/** 本轮重新抓到、并与旧记录合并了的条数。 */
	refreshed: number
	/** 本轮没抓到、但从旧记录里保留下来的条数（**这个数字就是被覆盖 bug 吃掉的量**）。 */
	carriedOver: number
	/** 本轮新出现、旧记录里没有的条数。 */
	added: number
}

/**
 * 合并当天的旧条目与本轮新抓到的条目。
 *
 * 冲突时以**新抓的**字段为准（标题/摘要可能被源方改过），但继承旧记录的
 * `firstSeenAt` 与 `aiSummary`。
 */
export function mergeDayItems(
	previous: readonly MergeableItem[],
	fresh: readonly MergeableItem[],
): MergeDayResult {
	const oldByUrl = new Map<string, MergeableItem>()
	for (const item of previous) {
		if (!item?.url) continue
		oldByUrl.set(normalizeUrl(item.url), item)
	}

	const items: MergeableItem[] = []
	let refreshed = 0
	let added = 0

	for (const candidate of fresh) {
		if (!candidate?.url) continue
		const key = normalizeUrl(candidate.url)
		const old = oldByUrl.get(key)
		if (!old) {
			items.push(candidate)
			added++
			continue
		}
		oldByUrl.delete(key)
		items.push({
			...candidate,
			firstSeenAt: old.firstSeenAt ?? candidate.firstSeenAt,
			// 摘要太短、不占体积，却要花钱生成；旧记录里有就留着
			aiSummary: candidate.aiSummary ?? old.aiSummary,
		})
		refreshed++
	}

	// 本轮没抓到的旧条目：**保留**。这正是修复的核心。
	const carried: MergeableItem[] = []
	for (const item of oldByUrl.values()) carried.push(item)
	carried.sort((a, b) => {
		// 缺失 firstSeenAt 的排最后；相同时保持稳定（不引入随机顺序）
		const left = a.firstSeenAt ?? ''
		const right = b.firstSeenAt ?? ''
		if (left === right) return 0
		return left < right ? 1 : -1
	})
	items.push(...carried)

	return { items, refreshed, carriedOver: carried.length, added }
}

/**
 * 合并源状态：本轮**跑过**的源用新状态，没跑的沿用上一次。
 *
 * 不这么做的话，一次只跑 YouTube 的刷新会把日报的"采集源状态"里其它 10 个源全抹掉 ——
 * 用户看到的是"只剩一个源了"，而实际上其它源只是这轮没跑。
 */
export function mergeSourceStates<T extends { id: string }>(previous: readonly T[], fresh: readonly T[]): T[] {
	const ranIds = new Set(fresh.map((source) => source.id))
	return [...fresh, ...previous.filter((source) => !ranIds.has(source.id))]
}
