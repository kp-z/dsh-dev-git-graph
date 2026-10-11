import type { DailyConfig } from './config.js'
import { homedir } from 'node:os'
import { sep } from 'node:path'
import { summarizeDay, renderWeeklyReview, weekFileName, type ArchiveDay } from './archive.js'
import {
	emptyCache,
	mergeCache,
	readCache,
	summarizeItems,
	type StreamFn,
	type SummarySource,
} from './ai.js'
import { SOURCE_CATALOG } from './catalog.js'
import { runCollection } from './collect/index.js'
import { MirrorPool } from './collect/mirror.js'
import { buildRecentlySeen, normalizeUrl, rankItems, shiftDate } from './rank.js'
import {
	mergeFeedSpecs,
	parseOpml,
	serializeOpml,
	specToFeed,
	type OpmlFeed,
} from './opml.js'
import { builtinFeedSpecs } from './collect/sources.js'
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

export interface AiRoute {
	provider: string
	model: string
}

/** 最近一次 AI 摘要的统计，暴露给 /api/state，让用户能看出"到底跑没跑、失败了几条"。 */
export interface AiRunStats {
	at: string
	model: string
	enabled: boolean
	fromCache: number
	generated: number
	failed: number
	/** 失败原因样例（最多 3 条），便于判断是撞了 max-tokens 还是限流。 */
	reasons: string[]
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
	/** 最近一次 AI 摘要的运行统计；功能关闭时 last 为 null 但 enabled 仍如实反映配置。 */
	ai: { enabled: boolean; last: AiRunStats | null }
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

/** 把绝对路径缩写成 `~/…`；不在 home 之下时原样返回。给界面显示用。 */
export function displayPath(absolute: string): string {
	const home = homedir()
	if (absolute === home) return '~'
	if (absolute.startsWith(`${home}${sep}`)) return `~${absolute.slice(home.length)}`
	return absolute
}

export class DailyService {
	readonly config: DailyConfig
	readonly store: DailyStore
	private readonly logger: DailyLogger
	private pool: MirrorPool
	private inflight: Promise<RefreshSummary> | null = null
	private readonly listeners = new Set<() => void>()
	/** 由 index.ts 在拿到 ctx.llm 后注入；null = 宿主没提供 llm 或功能关闭。 */
	private llmStream: StreamFn | null = null
	private defaultRoute: (() => AiRoute | null) | null = null
	private lastAiRun: AiRunStats | null = null

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

	/**
	 * 注入模型调用能力。
	 *
	 * 为什么不在构造函数里要：`apply()` 是同步的，而 `ctx.llm` 与默认模型选择要到
	 * 依赖注入完成之后才拿得到。所以这里用"先建服务、后接线"的形状，
	 * 也让 service 在单测里可以完全不接模型（不传就退化成"没有 AI 摘要"）。
	 */
	setLlm(stream: StreamFn | null, defaultRoute?: () => AiRoute | null): void {
		this.llmStream = stream
		this.defaultRoute = defaultRoute ?? null
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
			// 运行期追加的源（OPML 导入进来的）在这里并入，不需要改配置、不需要重载
			extraFeeds: prefs.extraFeeds,
		})
		this.pool = outcome.pool

		// 沿用已见条目的首次发现时间，避免"没有发布时间的条目"每次刷新都冲到顶部
		const firstSeen: Record<string, string> = {}
		for (const item of previous.items) firstSeen[item.url] = item.firstSeenAt

		const quota = Math.max(prefs.dailyQuota || 0, this.config.dailyQuota)
		const recentlySeen = await this.loadRecentlySeen(date, this.config.dedupeWindowDays)
		let items = rankItems(outcome.items, {
			prefs,
			feedback,
			maxItemsPerSource: Math.max(prefs.maxItemsPerSource || 0, this.config.maxItemsPerSource),
			quota,
			firstSeen,
			recentlySeen,
			today: date,
		})

		// AI 摘要放在排序之后：只给真正进了列表的前 N 条生成，不浪费在会被配额裁掉的条目上
		items = await this.applyAiSummaries(items)

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

	/**
	 * 归档索引：最近 N 天的摘要（新到旧）。
	 *
	 * 读的是 days/*.json —— 那是**已经落盘的真实数据**，不是重新抓的。
	 * 只给摘要（条数/未读/主题分布/有没有日报），条目本身按需再取，避免一次把几十天的数据全塞给前端。
	 */
	async listArchive(limit = 30): Promise<ArchiveDay[]> {
		const all = await this.store.listDays()
		const targets = all.slice(-Math.max(1, limit)).reverse()
		const out: ArchiveDay[] = []
		for (const date of targets) {
			const day = await this.store.readDay(date)
			const digestAvailable = (await this.store.readDigest(date)) !== null
			out.push(summarizeDay(date, day.items, digestAvailable))
		}
		return out
	}

	/**
	 * 周报：截至 `endDate` 的 N 天汇总，落盘到 `digest/week-<start>_<end>.md`。
	 *
	 * 与日报的区别是它回答的是"这一周"的问题：哪个方向占了我的注意力、
	 * 哪天信息量骤降（通常意味着采集出问题）、这周最好的是什么。
	 */
	async buildWeeklyReview(
		endDate?: string,
		windowDays = 7,
	): Promise<{ markdown: string; name: string; days: number; items: number; start: string; end: string }> {
		const end = endDate ?? localDate()
		const window = Math.max(1, windowDays)
		const dates: string[] = []
		for (let i = window - 1; i >= 0; i--) dates.push(shiftDate(end, -i))

		const days: ArchiveDay[] = []
		const items: Item[] = []
		let sources: SourceState[] = []
		for (const date of dates) {
			const day = await this.store.readDay(date)
			if (day.items.length === 0) continue
			days.push(summarizeDay(date, day.items, (await this.store.readDigest(date)) !== null))
			items.push(...day.items)
			if (day.sources.length > 0) sources = day.sources
		}

		const start = dates[0] ?? end
		const markdown = renderWeeklyReview({ days, items, sources, start, end })
		const name = weekFileName(start, end)
		await this.store.writeDigestNamed(name, markdown)
		this.logger.info(`周报已生成：${name}（${days.length} 天 / ${items.length} 条）`)
		return { markdown, name, days: days.length, items: items.length, start, end }
	}

	/**
	 * 给**已经抓到的**当天条目补 AI 摘要，不重新抓取。
	 *
	 * 为什么需要它：用户很可能先用几天、觉得不错，再去打开 AI 摘要 ——
	 * 那时当天数据已经在了，让他等第二天才看到摘要是不合理的。
	 * 也让这条链路可以在集成测试里被真实执行（refresh 需要联网，这条不需要）。
	 */
	async regenerateAiSummaries(date?: string): Promise<AiRunStats | null> {
		const target = date ?? localDate()
		const day = await this.store.readDay(target)
		if (day.items.length === 0) return null
		day.items = await this.applyAiSummaries(day.items)
		await this.store.writeDay(day)
		await this.rebuildDigest(target)
		this.emit()
		return this.lastAiRun
	}

	/**
	 * 给当天的前 N 条补一句话 AI 摘要（默认关闭）。
	 *
	 * 三件事必须做到，否则这个功能只会给用户添麻烦：
	 * 1. **命中缓存不重复调**：跨天重复的新闻不该重复付钱。
	 * 2. **单条失败隔离**：20 条挂 1 条，另外 19 条照常出；失败原因进日志与 state。
	 * 3. **任何异常都不影响主流程**：摘要失败绝不能让"日报没生成"。
	 */
	private async applyAiSummaries(items: Item[]): Promise<Item[]> {
		const cfg = this.config
		if (!cfg.aiSummaryEnabled) return items

		if (!this.llmStream) {
			this.logger.warn('AI 摘要已开启，但宿主没有提供 llm 服务，本轮跳过。')
			this.lastAiRun = {
				at: new Date().toISOString(),
				model: '',
				enabled: true,
				fromCache: 0,
				generated: 0,
				failed: 0,
				reasons: ['宿主未提供 llm 服务'],
			}
			return items
		}

		// 路由：显式配置优先；两者都空则跟随宿主默认模型（两者只填一个视为未配置）
		const configuredProvider = cfg.aiSummaryProvider.trim()
		const configuredModel = cfg.aiSummaryModel.trim()
		let route: AiRoute | null = null
		if (configuredProvider && configuredModel) {
			route = { provider: configuredProvider, model: configuredModel }
		} else if (!configuredProvider && !configuredModel) {
			try {
				route = this.defaultRoute?.() ?? null
			} catch {
				route = null
			}
		}
		if (!route) {
			this.logger.warn(
				'AI 摘要已开启但没有可用的模型路由：请同时配置 aiSummaryProvider 与 aiSummaryModel，或确保宿主有默认模型。',
			)
			this.lastAiRun = {
				at: new Date().toISOString(),
				model: '',
				enabled: true,
				fromCache: 0,
				generated: 0,
				failed: 0,
				reasons: ['没有可用的模型路由（provider/model 需成对配置）'],
			}
			return items
		}

		const now = new Date()
		const cache = readCache(
			await this.store.readJsonFile('ai-cache.json').catch(() => null),
			now,
			cfg.aiSummaryCacheTtlDays,
			cfg.aiSummaryCacheMax,
		)

		const targets = items.slice(0, Math.max(0, cfg.aiSummaryMaxItems))
		let fromCache = 0
		const missing: Item[] = []
		for (const item of targets) {
			const cached = cache.entries[item.id]
			if (cached) {
				item.aiSummary = cached.text
				fromCache++
			} else {
				missing.push(item)
			}
		}

		if (missing.length === 0) {
			this.lastAiRun = {
				at: now.toISOString(),
				model: route.model,
				enabled: true,
				fromCache,
				generated: 0,
				failed: 0,
				reasons: [],
			}
			this.logger.info(`AI 摘要：全部命中缓存（${fromCache} 条），未调用模型。`)
			return items
		}

		let result
		try {
			result = await summarizeItems(missing, {
				provider: route.provider,
				model: route.model,
				maxItems: missing.length,
				concurrency: Math.max(1, cfg.aiSummaryConcurrency),
				timeoutMs: Math.max(1000, cfg.aiSummaryTimeoutMs),
				maxTokens: Math.max(64, cfg.aiSummaryMaxTokens),
				stream: this.llmStream,
				now: () => Date.now(),
			})
		} catch (error) {
			this.logger.warn(
				`AI 摘要整体失败（已忽略，不影响日报）：${error instanceof Error ? error.message : String(error)}`,
			)
			return items
		}

		for (const item of missing) {
			const outcome = result.summaries.get(item.id)
			if (outcome) item.aiSummary = outcome.text
		}

		if (result.summaries.size > 0) {
			try {
				await this.store.writeJsonFile(
					'ai-cache.json',
					mergeCache(cache, result.summaries, now),
				)
			} catch (error) {
				this.logger.warn(
					`AI 摘要缓存写入失败：${error instanceof Error ? error.message : String(error)}`,
				)
			}
		}

		const reasons = [...new Set([...result.failures.values()])].slice(0, 3)
		this.lastAiRun = {
			at: now.toISOString(),
			model: route.model,
			enabled: true,
			fromCache,
			generated: result.summaries.size,
			failed: result.failures.size,
			reasons,
		}
		this.logger.info(
			`AI 摘要：缓存命中 ${fromCache} · 新生成 ${result.summaries.size} · 失败 ${result.failures.size}` +
				(reasons.length > 0 ? ` · 失败原因：${reasons.join('；')}` : ''),
		)
		return items
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

	private async loadRecentlySeen(
		today: string,
		windowDays: number,
	): Promise<Record<string, string>> {
		if (windowDays <= 0) return {}
		// 窗口是**日历窗口**（往前数 windowDays 天），不是"最近 N 个归档文件" ——
		// 后者在归档稀疏时会把很久以前的条目也算进来。这里把所有落在窗口内的天读出来，
		// 边界判断交给纯函数（它同时也是被测对象）。
		const cutoff = shiftDate(today, -windowDays)
		const candidates = (await this.store.listDays()).filter(
			(date) => date < today && date >= cutoff,
		)
		const days = []
		for (const date of candidates) {
			const day = await this.store.readDay(date)
			days.push({ date, urls: day.items.map((item) => item.url) })
		}
		return buildRecentlySeen(days, today, windowDays)
	}

	/**
	 * 导入 OPML：解析 → 合并（按 URL 去重）→ 落进 prefs.extraFeeds。
	 *
	 * 不需要改配置、不需要重载 profile，**下一次刷新就生效**。
	 * 返回的明细是给用户核对的：加了几条、跳过了几条、有几条重复。
	 */
	async importOpml(xml: string): Promise<{
		title: string | null
		parsed: number
		categories: number
		skipped: number
		added: number
		duplicated: number
		addedNames: string[]
		total: number
	}> {
		const parsed = parseOpml(xml)
		let added = 0
		let duplicated = 0
		let addedNames: string[] = []
		let total = 0

		if (parsed.feeds.length > 0) {
			// 内置源也参与判重：用户的 OPML 里若有同一条（哪怕带 utm 参数），
			// 就不该再加一遍 —— 否则同一份内容会被抓两次，源列表也会重复。
			const reserved = builtinFeedSpecs().map((f) => `${f.name}|${f.url}|${f.topic}`)
			const saved = await this.store.updatePrefs((current) => {
				const merged = mergeFeedSpecs(
					current.extraFeeds,
					parsed.feeds,
					normalizeUrl,
					'热点',
					reserved,
				)
				added = merged.added
				duplicated = merged.duplicated
				addedNames = merged.addedNames
				total = merged.feeds.length
				return { ...current, extraFeeds: merged.feeds }
			})
			total = saved.extraFeeds.length
		} else {
			total = (await this.store.readPrefs()).extraFeeds.length
		}

		this.logger.info(
			`OPML 导入：解析 ${parsed.feeds.length} 条 · 新增 ${added} · 重复 ${duplicated} · 跳过 ${parsed.skipped}`,
		)
		this.emit()
		return {
			title: parsed.title,
			parsed: parsed.feeds.length,
			categories: parsed.categories,
			skipped: parsed.skipped,
			added,
			duplicated,
			addedNames,
			total,
		}
	}

	/** 导出 OPML：内置源 + 配置里的额外源 + 导入进来的源，按 URL 去重。 */
	async exportOpml(): Promise<{ xml: string; count: number }> {
		const prefs = await this.store.readPrefs()
		const specs = [
			...builtinFeedSpecs().map((f) => `${f.name}|${f.url}|${f.topic}`),
			...this.config.extraFeeds,
			...prefs.extraFeeds,
		]
		const seen = new Set<string>()
		const feeds: OpmlFeed[] = []
		for (const spec of specs) {
			const feed = specToFeed(spec)
			if (!feed) continue
			const key = normalizeUrl(feed.url)
			if (seen.has(key)) continue
			seen.add(key)
			feeds.push(feed)
		}
		const xml = serializeOpml({ feeds, title: 'dsh-daily 订阅源' })
		return { xml, count: feeds.length }
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
			// 当天的条目本身就在 recentlySeen 的窗口之外（窗口只取 `< today`），
			// 所以这里可以安全复用同一份去重窗口
			recentlySeen: await this.loadRecentlySeen(date, this.config.dedupeWindowDays),
			today: date,
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
				// 用**真实**路径（可自定义数据目录），并在 home 之下时缩写成 ~/…
				// —— 早先这里是硬编码的 ~/.dsh/daily/…，自定义目录时界面上显示的是个不存在的路径。
				path: displayPath(this.store.digestFile(digestDate)),
				updatedAt: meta.lastDigestDate ? day.lastRefresh?.at ?? null : null,
			},
			ai: { enabled: this.config.aiSummaryEnabled, last: this.lastAiRun },
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
