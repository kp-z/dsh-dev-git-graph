import { createHash } from 'node:crypto'
import { FALLBACK_TOPIC, TOPIC_KEYWORDS } from './catalog.js'
import type { FeedbackMap, Item, ItemKind, KeywordWeight, Platform, Prefs, RawItem } from './types.js'
import { inferKind } from './collect/sources.js'

/**
 * 排序引擎 —— 这个插件的"高价值"就落在这个文件里。
 *
 * 设计取舍：**乘法模型 + 可解释理由**。
 * - 乘法意味着任何一个因子为 0 就出局（屏蔽词就该这样），而各因子之间可以独立调参。
 * - 每个因子都必须能吐出一句人话进 `reasons`：用户看不到"为什么给我看这个"，
 *   就永远调不动推荐，最后会直接放弃这个插件。
 */

/** 稳定短 id：同一条 URL 每天重建后仍然指向同一条，反馈才能跨天累积。 */
export function itemId(url: string): string {
	return createHash('sha1').update(url).digest('hex').slice(0, 12)
}

const TRACKING_PARAMS = [
	'utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content',
	'fbclid', 'gclid', 'spm_id_from', 'vd_source', 'from_source', 'share_source',
	'ref', 'ref_src', 'ref_url', 'share_medium', 'share_plat', 'share_tag', 'timestamp',
]

/** URL 规范化：去 fragment、去跟踪参数、去路径尾斜杠。用于去重与稳定 id。 */
export function normalizeUrl(input: string): string {
	try {
		const url = new URL(input)
		for (const key of [...url.searchParams.keys()]) {
			if (TRACKING_PARAMS.includes(key.toLowerCase())) url.searchParams.delete(key)
		}
		url.hash = ''
		url.hostname = url.hostname.toLowerCase().replace(/^www\./, '')
		// 尾斜杠要去在 **pathname** 上，不能去在整串末尾 ——
		// `/x/` 与 `/x` 是同一个资源，但 `/x/?id=7` 的最后一个字符是 `7`，
		// 只看整串末尾会让带查询参数的同一篇文章漏掉去重（踩过）。
		if (url.pathname.length > 1 && url.pathname.endsWith('/')) {
			url.pathname = url.pathname.replace(/\/+$/, '')
		}
		return url.toString()
	} catch {
		return input.trim()
	}
}

/** 标题归一化：只留下有区分度的字符，用于相似度比较与去重键。 */
export function titleKey(title: string): string {
	return title
		.toLowerCase()
		.replace(/[\s\u3000]+/g, ' ')
		.replace(/[!-/:-@[-`{-~。，、；：？！“”‘’（）《》【】—…·]/g, '')
		.trim()
}

function tokenSet(title: string): Set<string> {
	return new Set(
		titleKey(title)
			.split(' ')
			.filter((word) => word.length > 0),
	)
}

/**
 * 标题相似度 —— 用来抓"同一件事被多个源报道"。
 *
 * 曾经用字符 3-gram 的 Jaccard，**不够用**：标题之间最常见的差异是插入/删除一两个词，
 * 这会让插入点之后的**所有** trigram 错位，于是
 * 「OpenAI releases a new reasoning model」与「OpenAI releases new reasoning model」
 * 只算出 0.31 —— 真正该合并的一对反而合不了。
 *
 * 现在改成词级，取两个指标的最大值：
 * - **Jaccard**：两边词集的交并比。对称，适合"改写过的同一件事"。
 * - **containment**：交集 / 较小的那一侧。专治"一个标题是另一个的子集"。
 *   containment 天生激进，所以只在**较短一侧至少 4 个词**时才启用 ——
 *   否则「Apple」这种短标题会被「Apple releases X」吃掉。
 */
export function titleSimilarity(a: string, b: string): number {
	const sa = tokenSet(a)
	const sb = tokenSet(b)
	if (sa.size === 0 || sb.size === 0) return 0
	let inter = 0
	for (const token of sa) if (sb.has(token)) inter++
	const union = sa.size + sb.size - inter
	const jaccard = inter / union
	const containment = inter / Math.min(sa.size, sb.size)
	const shortSide = Math.min(sa.size, sb.size)
	return Math.max(jaccard, shortSide >= 4 ? containment : 0)
}

/** 判定"同一件事"的阈值。取 0.8：宁可漏合，也不要错合掉两条不同的新闻。 */
export const TITLE_MERGE_THRESHOLD = 0.8

const ASCII_WORD_RE = /^[a-z0-9+#. -]+$/i

/**
 * 关键词匹配。
 *
 * 为什么不能直接 `includes`：`ai` 会命中 `email`、`said`、`maintain`，
 * 于是"AI 相关"这个偏好会把一堆不相干的条目拉上来。
 * 纯 ASCII 的词强制走词边界；CJK 没有词边界概念，仍然用子串包含（这也是对的，
 * 中文的"大模型"就该在"大模型推理"里命中）。
 */
export function matchKeyword(haystack: string, word: string): boolean {
	const needle = word.trim().toLowerCase()
	if (!needle) return false
	const hay = haystack.toLowerCase()
	if (!ASCII_WORD_RE.test(needle)) return hay.includes(needle)
	const escaped = needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
	return new RegExp(`(^|[^a-z0-9])${escaped}([^a-z0-9]|$)`, 'i').test(hay)
}

/** 依关键词词典给条目定主题；全部落空时退回采集器自带主题，再退回"热点"。 */
export function classifyTopic(input: { title: string; summary?: string; fallback?: string }): string {
	const haystack = `${input.title} ${input.summary ?? ''}`
	for (const entry of TOPIC_KEYWORDS) {
		for (const word of entry.words) {
			if (matchKeyword(haystack, word)) return entry.topic
		}
	}
	return input.fallback?.trim() || FALLBACK_TOPIC
}

function heatBoost(platform: Platform, stats: Record<string, number> | undefined): { factor: number; text: string | null } {
	if (!stats) return { factor: 1, text: null }
	const digits = (n: number) => (n >= 10_000 ? `${(n / 10_000).toFixed(1)}万` : `${n}`)
	switch (platform) {
		case 'hackernews': {
			const points = stats.points ?? 0
			if (points <= 0) return { factor: 1, text: null }
			// 100 分 ≈ ×1.3。HN 的分数是强信号，但别让它压过新鲜度
			return { factor: 1 + Math.min(0.55, Math.log10(1 + points) / 4), text: `HN ${points} 分` }
		}
		case 'github': {
			const stars = stats.stars ?? 0
			if (stars <= 0) return { factor: 1, text: null }
			return { factor: 1 + Math.min(0.55, Math.log10(1 + stars) / 4.2), text: `★ ${digits(stars)}` }
		}
		case 'bilibili':
		case 'youtube': {
			const views = stats.views ?? 0
			if (views <= 0) return { factor: 1, text: null }
			return { factor: 1 + Math.min(0.5, Math.log10(1 + views) / 6), text: `${digits(views)} 播放` }
		}
		default:
			return { factor: 1, text: null }
	}
}

/** 新鲜度：半衰期衰减。没有发布时间时按"首次见到"算，并按 0.9 略罚（未知时间不该占便宜）。 */
export function freshnessFactor(publishedAt: string | undefined, firstSeenAt: string, halfLifeHours: number, now: Date): number {
	const halfLife = Math.max(1, halfLifeHours)
	const base = publishedAt ? Date.parse(publishedAt) : NaN
	const known = Number.isFinite(base)
	const reference = known ? base : Date.parse(firstSeenAt)
	if (!Number.isFinite(reference)) return 0.5
	const ageHours = Math.max(0, (now.getTime() - reference) / 3_600_000)
	const factor = 0.5 ** (ageHours / halfLife)
	return Math.max(0.04, known ? factor : factor * 0.9)
}

export interface ScoreBreakdown {
	score: number
	reasons: string[]
}

/** 单条评分。导出是为了让测试与 `daily_search` 能用同一套逻辑。 */
export function scoreItem(
	item: Item,
	prefs: Prefs,
	now: Date,
): ScoreBreakdown {
	const reasons: string[] = []
	let score = 100

	const fresh = freshnessFactor(item.publishedAt, item.firstSeenAt, prefs.halfLifeHours, now)
	score *= fresh
	if (item.publishedAt) {
		const ageHours = (now.getTime() - Date.parse(item.publishedAt)) / 3_600_000
		if (Number.isFinite(ageHours)) {
			if (ageHours < 1) reasons.push('刚刚发布')
			else if (ageHours < 24) reasons.push(`${Math.round(ageHours)} 小时前发布`)
			else reasons.push(`${Math.round(ageHours / 24)} 天前发布`)
		}
	}

	const sourceWeight = prefs.sourceWeights[item.sourceId]
	if (typeof sourceWeight === 'number' && Math.abs(sourceWeight - 1) > 0.01) {
		score *= Math.max(0.1, sourceWeight)
		reasons.push(`来源权重 ×${sourceWeight.toFixed(2)}`)
	}

	// 主题：用户点名要的主题优先；靠前的主题再高一点
	if (prefs.topics.length > 0) {
		const index = prefs.topics.indexOf(item.topic)
		if (index >= 0) {
			const boost = Math.max(1.25, 1.7 - index * 0.1)
			score *= boost
			reasons.push(`主题命中「${item.topic}」`)
		} else {
			score *= 0.7
		}
	}

	// 关键词：多命中可叠加，但设上限，避免长摘要把权重刷爆
	let keywordFactor = 1
	const haystack = `${item.title} ${item.summary ?? ''}`
	const hitWords: string[] = []
	for (const kw of prefs.keywords as KeywordWeight[]) {
		if (matchKeyword(haystack, kw.word)) {
			keywordFactor *= 1 + 0.22 * Math.max(0.2, kw.weight)
			hitWords.push(kw.word)
		}
	}
	keywordFactor = Math.min(2.4, keywordFactor)
	if (hitWords.length > 0) {
		score *= keywordFactor
		reasons.push(`关键词命中：${hitWords.slice(0, 3).join(' / ')}`)
	}

	const heat = heatBoost(item.platform, item.stats)
	score *= heat.factor
	if (heat.text) reasons.push(heat.text)

	// 屏蔽词：降到几乎不可见，但仍留在索引里（用户搜得到，只是不被推荐）
	const blocked = prefs.blocked.filter((word) => word && matchKeyword(haystack, word))
	if (blocked.length > 0) {
		score *= 0.02
		reasons.push(`命中屏蔽词：${blocked.slice(0, 2).join(' / ')}`)
	}

	if (item.liked) {
		score *= 1.35
		reasons.push('你标记过「有意思」')
	}
	if (item.disliked) {
		score *= 0.3
		reasons.push('你标记过「少推这类」')
	}

	return { score: Math.max(0, Math.round(score * 10) / 10), reasons: reasons.slice(0, 4) }
}

/**
 * 合并两条指向同一件事的条目。保留信息更全的那条，把"还有别的源报道"记进 `notes`。
 *
 * 注意 notes 是**带外**传出去的，不能直接写 `keep.reasons`：
 * 合并发生在评分之前，而评分会整体覆盖 `reasons`（踩过这个坑，导致合并提示凭空消失）。
 */
function mergeDuplicate(keep: Item, extra: Item, notes: string[]): Item {
	const stats = { ...(keep.stats ?? {}), ...(extra.stats ?? {}) }
	if (extra.sourceName && extra.sourceName !== keep.sourceName) {
		notes.push(`另有 ${extra.sourceName} 报道`)
	}
	return {
		...keep,
		stats,
		// 视频形态优先：视频信息量更低、更容易被忽略，让它保留缩略图
		...(keep.kind === 'web' && extra.kind === 'video'
			? {
					kind: 'video' as ItemKind,
					platform: extra.platform,
					thumb: extra.thumb ?? keep.thumb,
					duration: extra.duration ?? keep.duration,
				}
			: {}),
		summary: keep.summary ?? extra.summary,
		thumb: keep.thumb ?? extra.thumb,
		duration: keep.duration ?? extra.duration,
		discussUrl: keep.discussUrl ?? extra.discussUrl,
		publishedAt: keep.publishedAt ?? extra.publishedAt,
	}
}

export interface RankOptions {
	prefs: Prefs
	feedback: FeedbackMap
	now?: Date
	/** 每源上限（粗筛，防止某一源把配额吃光）。 */
	maxItemsPerSource?: number
	/** 总量上限。 */
	quota?: number
	/**
	 * 上一轮已见过条目的首次发现时间（url → ISO）。
	 *
	 * 没有这个，每次刷新都会把"首次见到"重置成现在 —— 那些**没有发布时间**的条目
	 * （HN 的部分条目、GitHub 之外的自建 feed）会因为"看起来刚出现"而反复冲到顶部。
	 */
	firstSeen?: Record<string, string>
}

/**
 * 把原始条目整理成最终索引：
 * 规范化 → 去重 → 合并用户态 → 定主题 → 评分 → 每源配额 → 全局配额 → 排序。
 *
 * 去重是两段式的：先按规范化 URL 精确合并（同一链接绝对不该出现两次），
 * 再按标题相似度合并（同一件事的不同链接）。第二段有小概率误伤，
 * 所以阈值定得偏保守（0.72）。
 */
export function rankItems(rawItems: readonly RawItem[], options: RankOptions): Item[] {
	const now = options.now ?? new Date()
	const { prefs, feedback } = options
	const maxPerSource = options.maxItemsPerSource ?? prefs.maxItemsPerSource ?? 8
	const quota = options.quota ?? prefs.dailyQuota ?? 120

	// ---- 1. 规范化 + 用户态 ----
	// 合并说明（"另有 X 报道"）挂在 url 上：评分阶段会整体覆盖 reasons，所以必须带外传。
	const mergeNotes = new Map<string, string[]>()
	const noteFor = (url: string): string[] => {
		const existing = mergeNotes.get(url)
		if (existing) return existing
		const created: string[] = []
		mergeNotes.set(url, created)
		return created
	}

	const byUrl = new Map<string, Item>()
	for (const raw of rawItems) {
		if (!raw.title?.trim() || !raw.url?.trim()) continue
		const url = normalizeUrl(raw.url)
		const id = itemId(url)
		const fb = feedback[id]
		const platform: Platform = raw.platform ?? 'web'
		const topic = raw.topic && raw.topic.trim() ? classifyTopic({ title: raw.title, summary: raw.summary, fallback: raw.topic }) : classifyTopic({ title: raw.title, summary: raw.summary })
		const candidate: Item = {
			...raw,
			url,
			id,
			kind: raw.kind ?? inferKind(platform, url),
			platform,
			topic,
			score: 0,
			reasons: [],
			read: fb?.read ?? false,
			liked: fb?.liked ?? false,
			disliked: fb?.disliked ?? false,
			hidden: fb?.hidden ?? false,
			firstSeenAt: options.firstSeen?.[url] ?? now.toISOString(),
		}
		const existing = byUrl.get(url)
		byUrl.set(url, existing ? mergeDuplicate(existing, candidate, noteFor(url)) : candidate)
	}

	// ---- 2. 标题相似度合并 ----
	const merged: Item[] = []
	for (const item of byUrl.values()) {
		let target: Item | undefined
		for (const candidate of merged) {
			if (candidate.topic !== item.topic && candidate.platform !== item.platform) continue
			if (titleSimilarity(candidate.title, item.title) >= TITLE_MERGE_THRESHOLD) {
				target = candidate
				break
			}
		}
		if (target) {
			const index = merged.indexOf(target)
			merged[index] = mergeDuplicate(target, item, noteFor(target.url))
		} else {
			merged.push(item)
		}
	}

	// ---- 3. 评分 ----
	for (const item of merged) {
		const breakdown = scoreItem(item, prefs, now)
		const notes = mergeNotes.get(item.url) ?? []
		item.score = breakdown.score
		// 合并说明放最前：它是"这条为什么值得看"里最具体的一条
		item.reasons = [...notes, ...breakdown.reasons].slice(0, 5)
	}

	// ---- 4. 每源配额：同一源最多 maxPerSource 条进最终列表 ----
	merged.sort((a, b) => b.score - a.score)
	const perSourceCount = new Map<string, number>()
	const selected: Item[] = []
	const overflow: Item[] = []
	for (const item of merged) {
		const used = perSourceCount.get(item.sourceId) ?? 0
		if (used >= maxPerSource) {
			overflow.push(item)
			continue
		}
		perSourceCount.set(item.sourceId, used + 1)
		selected.push(item)
	}

	// 隐藏的条目不进推荐列表（但仍留在索引里，daily_search 能找到）
	const visible = selected.filter((item) => !item.hidden)
	const hidden = selected.filter((item) => item.hidden)
	const finalList = [...visible, ...hidden].slice(0, quota)
	void overflow
	return finalList
}
