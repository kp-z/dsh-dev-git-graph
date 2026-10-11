import type { DailyConfig } from './config.js'
import { SOURCE_CATALOG } from './catalog.js'
import { runCollection } from './collect/index.js'
import { MirrorPool } from './collect/mirror.js'
import { rankItems } from './rank.js'
import { renderBrief, renderDigest } from './render.js'
import { DailyStore, localDate } from './store.js'
import { applyTuning } from './tune.js'
import type {
	DayState,
	FeedbackMap,
	Item,
	ItemKind,
	Prefs,
	RefreshSummary,
	SourceState,
	TuneResult,
} from './types.js'

/**
 * 插件的业务核心。api / tools / schedule / prompt 都只跟它打交道，
 * 各自不碰 store、不碰采集器 —— 这样"刷新"永远只有一条路径。
 */

export interface DailyLogger {
	info(message: string): void
	warn(message: string): void
	error(message: string): void
}

export interface ServiceStatePayload {
	ok: true
	date: string
	generatedAt: string
	lastRefresh: RefreshSummary | null
	refreshing: boolean
	counts: { total: number; unread: number; byTopic: Record<string, number> }
	sources: SourceState[]
	prefs: Prefs
	digest: { available: boolean; path: string; updatedAt: string | null }
}

export interface ItemsPayload {
	ok: true
	date: string
	total: number
	returned: number
	items: Item[]
}

export interface ItemsQuery {
	date?: string
	topic?: string
	q?: string
	unread?: boolean
	kind?: ItemKind
	limit?: number
	/** 包含被隐藏的条目（搜索用；推荐列表不包含）。 */
	includeHidden?: boolean
}

/** 反馈动作 → 对反馈表的变更。放在这里是为了让"语义"只有一处定义。 */
function applyFeedbackAction(current: FeedbackMap, id: string, action: string): FeedbackMap {
	const next: FeedbackMap = { ...current }
	const entry = { ...(next[id] ?? { at: new Date().toISOString() }) }
	switch (action) {
		case 'read':
			entry.read = true
			break
		case 'unread':
			entry.read = false
			break
		case 'like':
			entry.liked = true
			entry.disliked = false
			break
		case 'dislike':
			entry.disliked = true
			entry.liked = false
			break
		case 'hide':
			entry.hidden = true
			break
		case 'unhide':
			entry.hidden = false
			break
		case 'clear':
			delete next[id]
			return next
		default:
			throw new Error(`未知的反馈动作：${action}`)
	}
	entry.at = new Date().toISOString()
	next[id] = entry
	return next
}

export class DailyService {
	readonly config: DailyConfig
	readonly store: DailyStore
	private readonly logger: DailyLogger
	private pool: MirrorPool
	private inflight: Promise<RefreshSummary> | null = null
	private readonly listeners = new Set<() => void>()

	constructor(config: DailyConfig, logger: DailyLogger) {
		this.config = config
		this.logger = logger
		this.store = new DailyStore(DailyStore.resolveDir(config.dataDir))
		this.pool = new MirrorPool(config.rsshubMirrors, config.requestTimeoutMs)
	}

	async init(): Promise<void> {
		await this.store.init()
		const meta = await this.store.readMeta()
		// 跨轮复用镜像健康度：上一次成功的镜像直接排到队首，省一轮探测
		this.pool = this.makePool(meta)
	}

	private makePool(seed?: Awaited<ReturnType<DailyStore['readMeta']>>): MirrorPool {
		return new MirrorPool(
			this.config.rsshubMirrors,
			this.config.requestTimeoutMs,
			seed ?? null,
			(message) => this.logger.info(message),
		)
	}

	subscribe(listener: () => void): () => void {
		this.listeners.add(listener)
		return () => this.listeners.delete(listener)
	}

	private emit(): void {
		for (const listener of this.listeners) {
			try {
				listener()
			} catch {
				// 一个订阅者出错不该影响其它订阅者，也不该让采集失败
			}
		}
	}

	async getPrefs(): Promise<Prefs> {
		return this.store.readPrefs()
	}

	async getFeedback(): Promise<FeedbackMap> {
		return this.store.readFeedback()
	}

	async getDay(date?: string): Promise<DayState> {
		return this.store.readDay(date ?? localDate())
	}

	/** 跑一轮采集。**并发调用会合流到同一次刷新**，不会重复抓。 */
	async refresh(options: { sourceIds?: string[]; signal?: AbortSignal } = {}): Promise<RefreshSummary> {
		if (this.inflight) return this.inflight
		this.inflight = this.runRefresh(options).finally(() => {
			this.inflight = null
		})
		return this.inflight
	}

	private async runRefresh(
		options: { sourceIds?: string[]; signal?: AbortSignal },
	): Promise<RefreshSummary> {
		const date = localDate()
		const previous = await this.store.readDay(date)
		const prefs = await this.store.readPrefs()
		const feedback = await this.store.readFeedback()

		const outcome = await runCollection({
			config: this.config,
			pool: this.pool,
			...(options.sourceIds ? { sourceIds: options.sourceIds } : {}),
			...(options.signal ? { signal: options.signal } : {}),
		})
		this.pool = outcome.pool

		// 沿用已见条目的首次发现时间，避免"没有发布时间的条目"每次刷新都冲到顶部
		const firstSeen: Record<string, string> = {}
		for (const item of previous.items) firstSeen[item.url] = item.firstSeenAt

		const quota = Math.max(prefs.dailyQuota || 0, this.config.dailyQuota)
		const items = rankItems(outcome.items, {
			prefs,
			feedback,
			maxItemsPerSource: Math.max(prefs.maxItemsPerSource || 0, this.config.maxItemsPerSource),
			quota,
			firstSeen,
		})

		const okSources = outcome.sources.filter((s) => s.ok).length
		const previousUrls = new Set(previous.items.map((i) => i.url))
		const summary: RefreshSummary = {
			at: new Date().toISOString(),
			durationMs: outcome.durationMs,
			ok: okSources > 0,
			okSources,
			failedSources: outcome.sources.length - okSources,
			total: items.length,
			added: items.filter((i) => !previousUrls.has(i.url)).length,
		}

		const day: DayState = { date, items, sources: outcome.sources, lastRefresh: summary }
		await this.store.writeDay(day)
		await this.store.updateMeta((meta) => ({
			...meta,
			lastRefresh: summary,
			mirrorHealth: this.pool.snapshot().mirrorHealth,
		}))

		// 日报随刷新一起更新：用户点"刷新"就是想要一份新的日报，不该还要再点一次
		try {
			await this.rebuildDigest(date)
		} catch (error) {
			this.logger.warn(`日报生成失败：${error instanceof Error ? error.message : String(error)}`)
		}

		this.logger.info(
			`刷新完成：${items.length} 条 / ${okSources}~${outcome.sources.length} 源正常 / ${outcome.durationMs}ms`,
		)
		this.emit()
		return summary
	}

	async rebuildDigest(date?: string): Promise<string> {
		const target = date ?? localDate()
		const [day, prefs] = await Promise.all([this.store.readDay(target), this.store.readPrefs()])
		const markdown = renderDigest({
			date: target,
			items: day.items,
			sources: day.sources,
			prefs,
		})
		await this.store.writeDigest(target, markdown)
		await this.store.updateMeta((meta) => ({ ...meta, lastDigestDate: target }))
		return markdown
	}

	/** 只读的紧凑摘要，给 systemPrompt 注入用。 */
	async briefNow(maxItems: number, now = new Date()): Promise<string | null> {
		const date = localDate(now)
		const day = await this.store.readDay(date)
		if (day.items.length === 0) return null
		return renderBrief({ date, items: day.items, sources: day.sources, maxItems, now })
	}

	async setFeedback(id: string, action: string): Promise<FeedbackMap> {
		const next = await this.store.updateFeedback((current) =>
			applyFeedbackAction(current, id, action),
		)
		// 即时把用户态同步进当天数据，前端下一次拉取就能看到一致的视图
		const date = localDate()
		const day = await this.store.readDay(date)
		let changed = false
		for (const item of day.items) {
			if (item.id !== id) continue
			const entry = next[id]
			item.read = entry?.read ?? false
			item.liked = entry?.liked ?? false
			item.disliked = entry?.disliked ?? false
			item.hidden = entry?.hidden ?? false
			changed = true
		}
		if (changed) await this.store.writeDay(day)
		this.emit()
		return next
	}

	/** 调教：解析 → 落盘 → 立即重排（否则用户要等到明天才看得到效果）。 */
	async tune(text: string): Promise<TuneResult> {
		const current = await this.store.readPrefs()
		const result = applyTuning(text, current)
		const saved = await this.store.updatePrefs(() => result.prefs)
		const date = localDate()
		const day = await this.store.readDay(date)
		if (day.items.length > 0) {
			await this.reRank(date, day, saved)
		}
		this.emit()
		return { ...result, prefs: saved }
	}

	/** 用现有原始条目按新偏好重新排名（不重新抓取）。 */
	private async reRank(date: string, day: DayState, prefs: Prefs): Promise<void> {
		const feedback = await this.store.readFeedback()
		const firstSeen: Record<string, string> = {}
		for (const item of day.items) firstSeen[item.url] = item.firstSeenAt
		const items = rankItems(day.items, {
			prefs,
			feedback,
			maxItemsPerSource: Math.max(prefs.maxItemsPerSource || 0, this.config.maxItemsPerSource),
			quota: Math.max(prefs.dailyQuota || 0, this.config.dailyQuota),
			firstSeen,
		})
		await this.store.writeDay({ ...day, items })
		await this.rebuildDigest(date)
	}

	async getState(): Promise<ServiceStatePayload> {
		const date = localDate()
		const [day, prefs, meta] = await Promise.all([
			this.store.readDay(date),
			this.store.readPrefs(),
			this.store.readMeta(),
		])
		const byTopic: Record<string, number> = {}
		for (const item of day.items) byTopic[item.topic] = (byTopic[item.topic] ?? 0) + 1
		const digestDate = meta.lastDigestDate ?? date
		return {
			ok: true,
			date,
			generatedAt: new Date().toISOString(),
			lastRefresh: day.lastRefresh ?? meta.lastRefresh,
			refreshing: this.inflight !== null,
			counts: {
				total: day.items.length,
				unread: day.items.filter((i) => !i.read).length,
				byTopic,
			},
			sources: day.sources,
			prefs,
			digest: {
				available: meta.lastDigestDate !== null,
				path: `~/.dsh/daily/digest/${digestDate}.md`,
				updatedAt: meta.lastDigestDate ? day.lastRefresh?.at ?? null : null,
			},
		}
	}

	async getItems(query: ItemsQuery = {}): Promise<ItemsPayload> {
		const date = query.date ?? localDate()
		const day = await this.store.readDay(date)
		const limit = Math.max(1, Math.min(500, query.limit ?? 300))
		let items = day.items

		if (!query.includeHidden) items = items.filter((i) => !i.hidden)
		if (query.topic && query.topic !== '全部') {
			items = items.filter((i) => i.topic === query.topic)
		}
		if (query.kind) items = items.filter((i) => i.kind === query.kind)
		if (query.unread) items = items.filter((i) => !i.read)
		if (query.q) {
			const needle = query.q.trim().toLowerCase()
			items = items.filter(
				(i) =>
					i.title.toLowerCase().includes(needle) ||
					(i.summary ?? '').toLowerCase().includes(needle) ||
					i.sourceName.toLowerCase().includes(needle) ||
					(i.author ?? '').toLowerCase().includes(needle),
			)
		}

		return {
			ok: true,
			date,
			total: day.items.length,
			returned: items.length,
			items: items.slice(0, limit),
		}
	}

	/** 源清单（含内置目录里这一轮没跑的），供前端与工具展示。 */
	sourceCatalogView(): Array<{ id: string; name: string; kind: ItemKind; homepage: string }> {
		return SOURCE_CATALOG.map((s) => ({
			id: s.id,
			name: s.name,
			kind: s.kind,
			homepage: s.homepage,
		}))
	}
}
