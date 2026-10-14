import type { DailyConfig } from './config.js'
import { existsSync, readFileSync } from 'node:fs'
import { stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join, sep } from 'node:path'
import { summarizeDay, renderWeeklyReview, weekFileName, type ArchiveDay } from './archive.js'
import { pruneRotation, type RotationState } from './rotation.js'
import {
	checkDir,
	defaultRegistry,
	isDefaultProject,
	listProjects,
	normalizeDir,
	projectDataDir,
	projectName,
	readRegistry,
	touchProject,
	type ProjectEntry,
	type ProjectRegistry,
} from './project.js'
import { buildDailyNotification, sendNotification, type SpawnFn } from './notify.js'
import {
	compactItem,
	formatBytes,
	isCompacted,
	planArchive,
	type DayPlan,
	type PruneReport,
} from './storage.js'
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
import { boostByKeywords, buildRecentlySeen, normalizeUrl, rankItems, shiftDate } from './rank.js'
import {
	mergeFeedSpecs,
	parseOpml,
	serializeOpml,
	specToFeed,
	type OpmlFeed,
} from './opml.js'
import { builtinFeedSpecs } from './collect/sources.js'
import { pickDiverse, renderBrief, renderDigest } from './render.js'
import { mergeDayItems, mergeSourceStates } from './merge.js'
import {
	applyKeywordOverride,
	collectProjectProfile,
	describeProfile,
	normalizeKeywordList,
	type KeywordOverride,
	type ProjectProfile,
} from './profile.js'
import { chooseProject, collectDirs, describeChoice, parseWorkspacePaths, type DetectedDir } from './detect.js'
import { profileHash, canReusePlan, describePlan, planResearch, type ResearchPlan } from './research.js'
import { describeRetrieval, runRetrieval, type Finding, type RetrieveResult } from './retrieve.js'
import { applyIntros, generateAllIntros, type PresentedFinding } from './present.js'
import { isMatchableTerm } from './brief.js'
import {
	assembleBrief,
	findingsToNews,
	generateBriefText,
	parseBrief,
	selectRelatedItems,
	describeBrief,
	type ProjectBrief,
} from './brief.js'
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

/** 本次刷新是谁触发的 —— 决定要不要弹桌面通知（手动刷新不弹）。 */
export type RefreshTrigger = 'schedule' | 'startup' | 'manual'

/**
 * 可注入的外部依赖。
 *
 * `spawn` 存在的唯一理由是**测试**：`maybeNotify` 内部要调 osascript，
 * 而"开着通知的集成测试"绝不能真的往用户屏幕上弹东西 —— 那是测试污染真实环境。
 * 注入一个假的 spawn 就能干净地断言"该弹的时候弹了、不该弹的时候没弹"。
 */
export interface ServiceDeps {
	spawn?: SpawnFn
}

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
	/** 自定义源数量（内置源不计），给界面上的入口显示用。 */
	feeds: number
	/** 当前项目（调研插件的地基：一个项目 = 一个工作目录）。 */
	project: { dir: string; name: string; isDefault: boolean; dataDir: string }
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
	store: DailyStore
	private readonly logger: DailyLogger
	/** YouTube 频道的轮转/退避状态（从 meta 恢复，刷新后写回）。 */
	private rotation: RotationState = {}

	private deps: ServiceDeps
	/** 数据根（不随项目切换而变）。 */
	private root: string
	/** 数据根的 store —— 只用来读写 projects.json 注册表。 */
	private rootStore: DailyStore
	/** 当前项目的工作目录（身份）。 */
	private projectDir: string
	private pool: MirrorPool
	private inflight: Promise<RefreshSummary> | null = null
	private readonly listeners = new Set<() => void>()
	/** 由 index.ts 在拿到 ctx.llm 后注入；null = 宿主没提供 llm 或功能关闭。 */
	/**
	 * 宿主上下文（可能多个）。
	 *
	 * **为什么是数组**：cordis 里"访问未在 inject 里声明的服务"会直接抛
	 * （`cannot get property "X" without inject`）—— 客户端半体就是这么把界面打成错误页的。
	 * 所以每个服务要在它自己的 `ctx.inject([...], cb)` 作用域里拿；
	 * 每个作用域能合法访问的服务不同，于是这里累积所有作用域，读的时候依次尝试。
	 */
	private hosts: unknown[] = []
	/** 当前项目的来源：manual = 用户手动选的，auto = 自动识别/默认。 */
	private projectSource: 'manual' | 'auto' = 'auto'
	/** 上次自动识别的时间（节流：每一轮 prompt 都会触发一次探测，没必要每次都读盘）。 */
	private lastDetectAt = 0
	/**
	 * 上次自动识别的**诊断快照**。
	 *
	 * 为什么要有它：识别失败时是**静默**的（候选为空 → 保持默认项目，日志也没话说）。
	 * 而我拿不到那台机器的 shell（受限跳板），只能从插件接口看 —— 所以把"试了哪些来源、
	 * 各找到几个候选、为什么没切"记下来，暴露在 /api/state 里，故障才可定位。
	 */
	private lastDetect: {
		at: string
		reason: string
		changed: boolean
		hosts: number
		candidates: number
		sample: string[]
		sources: Array<{ name: string; ok: boolean; count: number; note?: string }>
	} | null = null

	private llmStream: StreamFn | null = null
	private defaultRoute: (() => AiRoute | null) | null = null
	private lastAiRun: AiRunStats | null = null

	constructor(config: DailyConfig, logger: DailyLogger, deps: ServiceDeps = {}) {
		this.config = config
		this.logger = logger
		this.deps = deps
		// **数据根**：注册表与"额外项目"的父目录。默认项目就是它本身。
		this.root = DailyStore.resolveDir(config.dataDir)
		this.rootStore = new DailyStore(this.root)
		// 当前项目目录（绝对路径）。构造时先按默认项目，init() 再按注册表恢复。
		this.projectDir = this.root
		this.store = new DailyStore(this.root)
		this.pool = new MirrorPool(config.rsshubMirrors, config.requestTimeoutMs)
	}

	async init(): Promise<void> {
		// 注册表放在数据根，不随项目切换而变
		await this.rootStore.init()
		const registry = await this.readRegistryFile()
		// 恢复上次的项目；目录若已不存在（被删/改名）就安全回落默认项目，
		// 否则一个失效路径会让插件再也打不开。
		const restored = registry.current && checkDir(registry.current).ok ? normalizeDir(registry.current) : this.root
		this.projectDir = restored
		// 恢复"来源"：manual 时自动识别不覆盖（显式优先于推断）
		this.projectSource = registry.source === 'manual' ? 'manual' : 'auto'
		this.store = new DailyStore(projectDataDir(this.root, restored))
		await this.store.init()
		if (restored !== normalizeDir(registry.current ?? '')) {
			await this.writeRegistryFile(touchProject(registry, this.root, restored))
		}
		const meta = await this.store.readMeta()
		// 跨轮复用镜像健康度：上一次成功的镜像直接排到队首，省一轮探测
		this.pool = this.makePool(meta)
		// 跨进程恢复 YouTube 轮转状态：否则每次重启都当作"都没抓过"，
		// 每轮都从同一批频道开始，LRU 形同虚设。
		this.rotation = meta.youtubeRotation ?? {}
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
	async refresh(
		options: { sourceIds?: string[]; signal?: AbortSignal; trigger?: RefreshTrigger } = {},
	): Promise<RefreshSummary> {
		if (this.inflight) return this.inflight
		this.inflight = this.runRefresh(options).finally(() => {
			this.inflight = null
		})
		return this.inflight
	}

	private async runRefresh(
		options: { sourceIds?: string[]; signal?: AbortSignal; trigger?: RefreshTrigger },
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
			// YouTube 轮转状态：从 meta 恢复、本轮更新后再写回
			rotation: this.rotation,
		})
		this.pool = outcome.pool

		// 沿用已见条目的首次发现时间，避免"没有发布时间的条目"每次刷新都冲到顶部
		const firstSeen: Record<string, string> = {}
		for (const item of previous.items) firstSeen[item.url] = item.firstSeenAt

		const quota = Math.max(prefs.dailyQuota || 0, this.config.dailyQuota)
		const recentlySeen = await this.loadRecentlySeen(date, this.config.dedupeWindowDays)
		// **合并**而不是覆盖：当天已有的条目 + 本轮新抓的，一起去重排序。
		// 覆盖的后果是"定向刷新冲掉其它源""某个源失败后上午的条目消失"，
		// 也就是用户看到的"刷新了一下，条目反而变少了"。
		const merged = mergeDayItems(previous.items, outcome.items)
		if (merged.carriedOver > 0) {
			this.logger.info(
				`当天已有 ${previous.items.length} 条：本轮新增 ${merged.added} · 更新 ${merged.refreshed} · 保留 ${merged.carriedOver}`,
			)
		}

		let items = rankItems(merged.items, {
			prefs,
			feedback,
			maxItemsPerSource: Math.max(prefs.maxItemsPerSource || 0, this.config.maxItemsPerSource),
			quota,
			firstSeen,
			recentlySeen,
			today: date,
		})

		// **关键词作用到日报**（不只是调研）：命中关键词的条目提前。
		// 语义是"放大器"而不是"过滤器" —— 不设关键词时列表完全不变，
		// 设了之后命中项浮上来，**不会让用户丢内容**。
		const keywordList = (await this.keywordState()).effective
		if (keywordList.length > 0) items = boostByKeywords(items, keywordList)

		// AI 摘要放在排序之后：只给真正进了列表的前 N 条生成，不浪费在会被配额裁掉的条目上
		items = await this.applyAiSummaries(items)

		// 源状态也合并：本轮跑过的用新状态，没跑的沿用上一次 ——
		// 否则一次只跑 YouTube 的刷新会让日报里其它 10 个源"消失"
		const sources = mergeSourceStates(previous.sources, outcome.sources)
		const okSources = sources.filter((s) => s.ok).length
		const previousUrls = new Set(previous.items.map((i) => normalizeUrl(i.url)))
		const summary: RefreshSummary = {
			at: new Date().toISOString(),
			durationMs: outcome.durationMs,
			ok: okSources > 0,
			okSources,
			failedSources: outcome.sources.length - okSources,
			total: items.length,
			added: items.filter((i) => !previousUrls.has(i.url)).length,
		}

		const day: DayState = { date, items, sources, lastRefresh: summary }
		await this.store.writeDay(day)
		// 轮转状态也落盘：跨轮/跨进程的"最久没抓的优先"与失败退避都依赖它
		const channelKeys = this.config.youtubeChannels
			.map((spec) => spec.split('|')[1]?.trim() ?? '')
			.filter(Boolean)
		this.rotation = pruneRotation(outcome.rotation, channelKeys)
		await this.store.updateMeta((meta) => ({
			...meta,
			lastRefresh: summary,
			mirrorHealth: this.pool.snapshot().mirrorHealth,
			youtubeRotation: this.rotation,
		}))

		// 日报随刷新一起更新：用户点"刷新"就是想要一份新的日报，不该还要再点一次
		try {
			await this.rebuildDigest(date)
		} catch (error) {
			this.logger.warn(`日报生成失败：${error instanceof Error ? error.message : String(error)}`)
		}

		// 桌面通知：只在**定时/启动**这两种"用户没在看"的时机弹。
		// 手动刷新时用户本来就在看界面，再弹一条只是噪音。
		await this.maybeNotify(options.trigger ?? 'manual', date, items)

		// 归档整理挂在采集之后：用户不需要知道它的存在，但长期跑下去必须有人做。
		// 失败不影响刷新结果，所以单独 try/catch。
		try {
			await this.maybeAutoCompact(date)
		} catch (error) {
			this.logger.warn(
				`归档自动整理失败（不影响本次刷新）：${error instanceof Error ? error.message : String(error)}`,
			)
		}

		this.logger.info(
			`刷新完成：${items.length} 条 / ${okSources}~${outcome.sources.length} 源正常 / ${outcome.durationMs}ms`,
		)
		this.emit()
		return summary
	}

	/** 当前的自定义源（只有运行期追加的那些；内置源在代码里，不在此列）。 */
	async listCustomFeeds(): Promise<Array<{ name: string; url: string; topic: string }>> {
		const prefs = await this.store.readPrefs()
		const out: Array<{ name: string; url: string; topic: string }> = []
		for (const spec of prefs.extraFeeds) {
			const [name, url, topic] = spec.split('|')
			if (!url?.trim()) continue
			out.push({ name: (name ?? '').trim() || url.trim(), url: url.trim(), topic: (topic ?? '').trim() || '热点' })
		}
		return out
	}

	/**
	 * 移除一个自定义源（按规范化 URL 匹配，所以带 utm 参数的写法也能删掉）。
	 * 已经有历史条目的源被移除后，**历史索引不受影响** —— 删的是"以后还抓不抓"，不是数据。
	 */
	async removeCustomFeed(url: string): Promise<{ removed: number; total: number }> {
		const key = normalizeUrl((url ?? '').trim())
		let removed = 0
		let total = 0
		await this.store.updatePrefs((current) => {
			const kept: string[] = []
			for (const spec of current.extraFeeds) {
				const specUrl = (spec.split('|')[1] ?? '').trim()
				if (specUrl && normalizeUrl(specUrl) === key) {
					removed++
					continue
				}
				kept.push(spec)
			}
			total = kept.length
			return { ...current, extraFeeds: kept }
		})
		if (removed > 0) this.logger.info(`已移除自定义源：${url}`)
		this.emit()
		return { removed, total }
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

	/* ---------- 项目 ---------- */

	private async readRegistryFile(): Promise<ProjectRegistry> {
		const raw = await this.rootStore.readJsonFile('projects.json')
		return readRegistry(raw ?? defaultRegistry())
	}

	private async writeRegistryFile(registry: ProjectRegistry): Promise<void> {
		await this.rootStore.writeJsonFile('projects.json', registry)
	}

	/** 当前项目。 */
	currentProject(): {
		dir: string
		name: string
		isDefault: boolean
		dataDir: string
		/** 这个项目是自动识别来的，还是用户手动指定的 —— 界面要显示出来，用户才知道为什么看到这些内容。 */
		source: 'manual' | 'auto'
		/** 上次识别的诊断（远程排查用：识别为什么没生效，看这里） */
		detect: {
			at: string
			reason: string
			changed: boolean
			hosts: number
			candidates: number
			sample: string[]
			sources: Array<{ name: string; ok: boolean; count: number; note?: string }>
		} | null
	} {
		return {
			dir: this.projectDir,
			name: projectName(this.projectDir),
			isDefault: isDefaultProject(this.root, this.projectDir),
			dataDir: projectDataDir(this.root, this.projectDir),
			source: this.projectSource,
			detect: this.lastDetect,
		}
	}

	/** 宿主上下文到手（可能有多个作用域）—— 自动识别用它去读会话/工作区。 */
	attachHost(host: unknown): void {
		if (!host) return
		if (!this.hosts.includes(host)) this.hosts.push(host)
	}

	/**
	 * 自动识别当前项目。
	 *
	 * 候选来源（按可信度排序，全部"探不到就当没有"，任何一步失败都不影响主流程）：
	 * 1. 调用方直接给的上下文（最准：**当前会话**的 cwd）
	 * 2. 宿主 `sessions.list()`：最近活跃的会话
	 * 3. 宿主 `workspaceRegistry.list()`：工作区清单
	 *
	 * **显式优先**：用户手动选过的项目不会被覆盖（结论见 detect.chooseProject）。
	 */
	async autoDetect(
		candidates: Array<{ value: unknown; from: string }> = [],
	): Promise<{ changed: boolean; dir?: string; from?: string; reason: string }> {
		if (!this.config.autoDetectProject) {
			return { changed: false, reason: '自动识别已在配置里关闭（autoDetectProject=false）' }
		}
		if (this.projectSource === 'manual') {
			return { changed: false, reason: describeChoice(null, true) }
		}

		const hostRead = await this.hostCandidates()
		const all = [...candidates, ...hostRead.items]
		const detected: DetectedDir[] = collectDirs(all)
		const snapshot = {
			at: new Date().toISOString(),
			reason: '',
			changed: false,
			hosts: this.hosts.length,
			candidates: detected.length,
			sample: detected.slice(0, 5).map((d) => `${d.dir} ← ${d.from}`),
			sources: hostRead.sources,
		}
		this.lastDetect = snapshot
		const pick = chooseProject({
			current: this.projectDir,
			manual: false,
			candidates: detected,
			usable: (dir) => checkDir(dir).ok,
		})
		if (!pick) {
			const reason = describeChoice(null, false)
			snapshot.reason = reason
			return { changed: false, reason }
		}

		const switched = await this.useProject(pick.dir, { source: 'auto' })
		if (!switched.ok) {
			return { changed: false, reason: `识别到 ${pick.dir} 但切换失败：${switched.reason ?? '未知原因'}` }
		}
		const reason = describeChoice(pick, false)
		snapshot.reason = reason
		snapshot.changed = true
		this.logger.info(`项目自动识别：${pick.dir}（${pick.from}）`)
		return { changed: true, dir: pick.dir, from: pick.from, reason }
	}

	/**
	 * 回到"自动跟随"模式，并立刻识别一次。
	 *
	 * 用户手动选过项目后，只有显式调它才会把控制权交回自动识别 ——
	 * 这就是"显式优先于推断"的出口，避免自动识别把用户的选择悄悄顶掉。
	 */
	async followAuto(): Promise<{
		project: ReturnType<DailyService['currentProject']>
		detected: { changed: boolean; dir?: string; from?: string; reason: string }
	}> {
		const registry = await this.readRegistryFile()
		if (registry.source !== 'auto') {
			await this.writeRegistryFile({ ...registry, source: 'auto' })
		}
		this.projectSource = 'auto'
		this.lastDetectAt = 0
		const detected = await this.autoDetect()
		this.emit()
		return { project: this.currentProject(), detected }
	}

	/** 读 DSH 的工作区注册表存盘（拿不到就返回空数组，绝不抛）。 */
	private storedWorkspaceDirs(): string[] {
		try {
			// DSH 主目录：环境变量优先；否则**从插件自己的数据根推导**（其父目录）。
			// 用 dirname(root) 而不是 homedir()/'.dsh' 有两个好处：
			// ① 用户把 dataDir 配到别处时，我们跟随的是**真实的 DSH 主目录**
			// ② 单测里 root 是临时目录 → 天然读不到开发机的真实工作区（密闭，不会串环境）
			const home = process.env.DSH_HOME?.trim() || dirname(this.root)
			const file = join(home, 'storages', 'workspace.json')
			if (!existsSync(file)) return []
			const raw = JSON.parse(readFileSync(file, 'utf8')) as unknown
			return parseWorkspacePaths(raw).filter((dir) => checkDir(dir).ok)
		} catch {
			return []
		}
	}

	/** 按目录 mtime 降序（失败保持原序）。数组里的路径会被 collectDirs 逐个探测。 */
	private async rankByMtime(dirs: string[]): Promise<Array<Record<string, string>>> {
		const withTime = await Promise.all(
			dirs.map(async (dir) => {
				try {
					const info = await stat(dir)
					return { path: dir, mtime: String(info.mtimeMs) }
				} catch {
					return { path: dir, mtime: '0' }
				}
			}),
		)
		withTime.sort((a, b) => Number(b.mtime) - Number(a.mtime))
		// 形状用 `path` —— collectDirs 的显式访问路径里有它
		return withTime.map((item) => ({ path: item.path }))
	}

	/** 从宿主服务收集候选（每一项都单独兜底，缺服务就当没有）。 */
	private async hostCandidates(): Promise<{
		items: Array<{ value: unknown; from: string }>
		sources: Array<{ name: string; ok: boolean; count: number; note?: string }>
	}> {
		const out: Array<{ value: unknown; from: string }> = []
		const sources: Array<{ name: string; ok: boolean; count: number; note?: string }> = []
		// **磁盘来源不需要任何宿主**，所以必须在"没有宿主就提前返回"之前先收。
		// （早先放在后面 → dev-server 这类没有 cordis 宿主的环境里，磁盘来源永远跑不到；
		//   真实宿主有 host 所以掩盖了这个设计错误。巡检脚本把它暴露出来了。）
		const stored = this.storedWorkspaceDirs()
		if (stored.length > 0) {
			// 按目录修改时间排序：最近动过的项目更可能是"当前项目"（排序失败就保持原序）
			const ranked = await this.rankByMtime(stored)
			out.push({ value: ranked, from: 'storages/workspace.json' })
		}

		if (this.hosts.length === 0) {
			// 这一条最关键：hosts=0 说明 inject 作用域压根没附着上
			sources.push({ name: '(host)', ok: false, count: 0, note: '没有任何宿主作用域附着' })
			sources.push({ name: 'storages/workspace.json', ok: stored.length > 0, count: stored.length })
			return { items: out, sources }
		}
		/** 依次在每个作用域里试着取该服务；抛（未声明）就当没有，换下一个作用域。 */
		const read = (name: string, pick: (svc: Record<string, unknown>) => unknown): void => {
			for (const host of this.hosts) {
				try {
					const scoped = host as { get?: (n: string) => unknown; [k: string]: unknown }
					// 先试属性（inject 声明过就能直接访问），再试 get()
					const svc =
						typeof scoped[name] === 'object' && scoped[name] !== null
							? scoped[name]
							: typeof scoped.get === 'function'
								? scoped.get(name)
								: null
					if (!svc || typeof svc !== 'object') continue
					const value = pick(svc as Record<string, unknown>)
					if (value) {
						out.push({ value, from: name })
						return
					}
				} catch {
					/* 该作用域拿不到 → 试下一个 */
				}
			}
		}
		// 会话：list() 返回的数组顺序即"活跃度"，只探最近几个，别整表遍历
		read('sessions', (svc) => {
			const list = typeof svc.list === 'function' ? (svc.list as () => unknown[])() : null
			return Array.isArray(list) ? list.slice(-5).reverse() : null
		})
		read('workspaceRegistry', (svc) => {
			const list = typeof svc.list === 'function' ? (svc.list as () => unknown[])() : null
			return Array.isArray(list) ? list.slice(-5).reverse() : null
		})
		// 来源明细：把"哪个服务读到了几个"记下来
		for (const name of ['sessions', 'workspaceRegistry', 'storages/workspace.json']) {
			const hit = out.find((item) => item.from === name)
			sources.push({ name, ok: !!hit, count: Array.isArray(hit?.value) ? (hit.value as unknown[]).length : 0 })
		}
		return { items: out, sources }
	}

	/**
	 * 每轮 prompt 装配时被调用（同步、极轻）：把**当前会话的上下文**喂给自动识别。
	 *
	 * 用节流是因为这个钩子每一轮都会响，而会话目录不会每轮都变；
	 * 真正的切换是异步的（要写注册表），这里 fire-and-forget，绝不阻塞 prompt 装配。
	 */
	notePromptContext(context: unknown): Promise<void> {
		if (!this.config.autoDetectProject || this.projectSource === 'manual') return Promise.resolve()
		const now = Date.now()
		if (now - this.lastDetectAt < 5000) return Promise.resolve()
		this.lastDetectAt = now
		// 返回值只是给测试/排查用的：调用方（prompt 渲染）可以直接忽略，
		// 它 fire-and-forget 的语义不变 —— 但"有没有还在跑的识别"从此可观察
		return this.autoDetect([{ value: context, from: 'prompt' }])
			.then(() => undefined)
			.catch(() => {
				/* 探测失败绝不影响对话 */
			})
	}

	/**
	 * 采集当前项目的画像（调研链条的第二环）。
	 *
	 * 结果落盘到该项目的 `profile.json`：③ 生成检索词时要用它，
	 * 用户也该能看见"插件为了了解项目读了哪些文件"（敏感文件永远不读）。
	 */
	async buildProfile(options: { dir?: string; save?: boolean } = {}): Promise<ProjectProfile> {
		const dir = options.dir ? normalizeDir(options.dir) : this.projectDir
		const profile = await collectProjectProfile(dir)
		if (options.save !== false) {
			await this.store.writeJsonFile('profile.json', profile)
		}
		this.logger.info(`项目画像：${describeProfile(profile)}`)
		return profile
	}

	/** 读取上次生成的画像（没有就返回 null，不自动重建）。 */
	async readProfile(): Promise<ProjectProfile | null> {
		const raw = await this.store.readJsonFile('profile.json')
		if (!raw || typeof raw !== 'object') return null
		return raw as ProjectProfile
	}

	/**
	 * 解析 AI 路由：显式配置优先（provider 与 model 必须成对），两者都空则跟随宿主默认模型。
	 * 抽成方法是因为**摘要与调研检索词都要用它** —— 两处各写一份必然会漂移。
	 */
	private resolveAiRoute(): AiRoute | null {
		const provider = this.config.aiSummaryProvider.trim()
		const model = this.config.aiSummaryModel.trim()
		if (provider && model) return { provider, model }
		if (!provider && !model) {
			try {
				return this.defaultRoute?.() ?? null
			} catch {
				return null
			}
		}
		return null   // 只填一个视为未配置
	}

	/**
	 * 生成（或复用）当前项目的调研检索词计划。
	 *
	 * 复用规则：**画像指纹没变就不重新生成**（重新画像是读文件、重新生成是调模型，都不该白做）。
	 * `force` 用于用户显式要求重算。整条路径不抛异常 —— 检索词是调研的入口，
	 * 入口失败等于功能不可用（失败会降级成确定性种子并写进 notes）。
	 */
	async planResearch(options: { force?: boolean; dir?: string } = {}): Promise<ResearchPlan> {
		// **走 effectiveProfile**：用户在界面上编辑过的关键词必须驱动检索词，
		// 否则"编辑关键词"就只是装饰品（界面上变了、搜出来的东西没变）。
		const profile = await this.effectiveProfile({ dir: options.dir })

		if (!options.force) {
			const cached = await this.readResearchPlan()
			if (cached && canReusePlan(cached, profile)) {
				this.logger.info(`调研检索词：复用上次结果（${describePlan(cached)}）`)
				return cached
			}
		}

		const route = this.resolveAiRoute()
		const plan = await planResearch(profile, {
			stream: this.llmStream,
			provider: route?.provider ?? '',
			model: route?.model ?? '',
		})
		await this.store.writeJsonFile('research-plan.json', plan)
		this.logger.info(`调研检索词：${describePlan(plan)}${plan.notes.length > 0 ? `（${plan.notes[0]}）` : ''}`)
		return plan
	}

	/**
	 * 跑一轮**定向检索**：用③生成的检索词去真正搜内容。
	 *
	 * 没有检索词就先生成（工具/接口是幂等的：没计划也能直接跑）。
	 * 整条路径不抛异常 —— 检索失败最多是"这轮没搜到"，不该让调研功能整体不可用。
	 */
	async runFindings(options: { force?: boolean } = {}): Promise<Omit<RetrieveResult, 'findings'> & { findings: PresentedFinding[]; plan: ResearchPlan }> {
		const plan = await this.planResearch({ force: options.force === true })
		const result = await runRetrieval(plan.queries, {
			// 宿主是 Node：直接用全局 fetch。将来若要走宿主的 web 服务，只需换这一处
			fetch: typeof globalThis.fetch === 'function' ? (globalThis.fetch as never) : null,
		})
		// **展示层**：头图 + 中文介绍（用户要求"卡片要写清楚"）。
		// 有模型路由就让 AI 写介绍；没有/超时/输出坏掉，全都退回确定性兜底 ——
		// 卡片不会空着，`introSource` 也会如实标明这句是谁写的。
		let intros: string[] | null = null
		try {
			const route = this.resolveAiRoute()
			if (route && this.llmStream) {
				// **分批**生成：单批坏掉不影响其它批，且总批数有上限（成本闸门）
				intros = await generateAllIntros(result.findings, {
					stream: this.llmStream,
					provider: route.provider,
					model: route.model,
					batchSize: 10,
					maxBatches: 5,
				})
				if (!intros) this.logger.warn('AI 中文介绍未生成（超时/输出无法解析），本轮改用兜底说明。')
			}
		} catch (error) {
			this.logger.warn(`AI 中文介绍失败（改用兜底）：${error instanceof Error ? error.message : String(error)}`)
		}
		const presented: PresentedFinding[] = applyIntros(result.findings, intros)
		const withPresentation = { ...result, findings: presented }

		await this.store.writeJsonFile('findings.json', {
			generatedAt: new Date().toISOString(),
			planHash: plan.profileHash,
			queries: plan.queries.map((q) => q.query),
			...withPresentation,
		})
		this.logger.info(
			`定向检索：${describeRetrieval(result)}${result.errors.length > 0 ? `（首个失败：${result.errors[0]}）` : ''}`,
		)
		return { ...withPresentation, plan }
	}

	/**
	 * 生成**项目简报**（第三阶段）：概念 / 资讯 / 建议。
	 *
	 * 三道保证（与设计一致）：
	 * 1. **没有模型也有东西看**：`news` 由确定性相关性兜底
	 * 2. **不编造**：模型没给或坏掉 → 写进 `degraded` 并说明原因
	 * 3. **不花冤枉钱**：画像没变且已有简报时直接复用（`force` 才重算）
	 */
	async buildBrief(options: { force?: boolean } = {}): Promise<ProjectBrief> {
		const profile = await this.effectiveProfile()
		const existing = await this.readBrief()

		if (!options.force && existing && existing.projectHash === profileHash(profile)) {
			return existing
		}

		const day = await this.store.readDay(localDate())
		const related = selectRelatedItems(profile, day?.items ?? [])

		// **把调研结果接进来**（R59 的结论）：通用新闻流里筛"与项目相关"有天花板，
		// 所以资讯要两条腿走路 —— 主动搜到的（调研）+ 日报里筛出来的。
		// 用**已缓存的**调研结果（不在这里触发网络请求：简报不该偷偷花钱/耗时）
		const cachedFindings = await this.readFindings().catch(() => null)
		const researchNews = findingsToNews(cachedFindings?.findings ?? [])

		let parsed: ReturnType<typeof parseBrief> | null = null
		let model = ''
		let aiError = ''
		const route = this.resolveAiRoute()
		if (route && this.llmStream) {
			model = route.model
			try {
				const text = await generateBriefText({
					stream: this.llmStream,
					provider: route.provider,
					model: route.model,
					profile,
					related,
				})
				parsed = text ? parseBrief(text, related) : null
				if (!parsed) aiError = '模型没有给出可用输出（超时或格式不可解析）'
			} catch (error) {
				parsed = null
				aiError = error instanceof Error ? error.message : String(error)
			}
		} else {
			aiError = route ? '宿主未提供模型服务' : '没有可用的模型路由'
		}

		const brief = assembleBrief({
			date: localDate(),
			projectHash: profileHash(profile),
			related,
			model: parsed ? model : '',
			parsed,
			aiError,
			researchNews,
		})
		await this.store.writeJsonFile('briefs/latest-brief.json', brief)
		this.logger.info(`项目简报：${describeBrief(brief)}`)
		return brief
	}

	/**
	 * 关键词状态：自动抽取的 vs 当前生效的（用户编辑优先）。
	 *
	 * `edited` 让界面能显示"这是你改过的"，并提供"恢复自动"。
	 */
	async keywordState(): Promise<{ auto: string[]; effective: string[]; edited: boolean }> {
		const profile = await this.buildProfile({ save: false })
		const override = await this.readKeywordOverride()
		// **展示的"自动"必须是系统真正会用的那一份**：原样抽出的词里有大量结构词与文件名
		// （`src`/`pages`/`task.md`/`version_test`/`必须`…），它们在匹配与检索时本来就会被过滤掉。
		// 展示未过滤的版本会让人以为"这些词在起作用"——那是假的。
		const auto = (profile.keywords ?? []).filter((word) => isMatchableTerm(String(word)))
		return {
			auto,
			effective: applyKeywordOverride(auto, override),
			edited: !!override,
		}
	}

	/** 读取关键词的用户编辑（没有就返回 null）。 */
	private async readKeywordOverride(): Promise<KeywordOverride | null> {
		const raw = await this.store.readJsonFile('keywords.json').catch(() => null)
		if (!raw || typeof raw !== 'object') return null
		if ((raw as { reset?: unknown }).reset === true) return null
		const list = normalizeKeywordList((raw as { keywords?: unknown }).keywords)
		if (!list) return null
		return { keywords: list, editedAt: String((raw as { editedAt?: unknown }).editedAt ?? '') }
	}

	/** 保存用户编辑的关键词列表（整体覆盖）。 */
	async setKeywords(raw: unknown): Promise<{ effective: string[]; edited: boolean }> {
		const list = normalizeKeywordList(raw)
		if (!list) throw new Error('关键词列表格式不对（需要字符串数组）')
		const override: KeywordOverride = { keywords: list, editedAt: new Date().toISOString() }
		await this.store.writeJsonFile('keywords.json', override)
		this.logger.info(`项目关键词已更新：${list.length} 个（用户编辑优先于自动抽取）`)
		return { effective: list, edited: true }
	}

	/** 恢复自动抽取（删掉用户编辑）。 */
	async resetKeywords(): Promise<{ effective: string[]; edited: boolean }> {
		await this.store.writeJsonFile('keywords.json', { keywords: [], editedAt: '' })
		// 写空表等于"没有编辑" —— readKeywordOverride 会把空数组当成有效覆盖，
		// 所以这里明确写一个标记位，让读取端能区分"用户清空了所有关键词"与"恢复自动"
		await this.store.writeJsonFile('keywords.json', { reset: true, at: new Date().toISOString() })
		const state = await this.keywordState()
		return { effective: state.effective, edited: state.edited }
	}

	/**
	 * 带**用户关键词编辑**的画像。
	 *
	 * 关键词驱动两件事：定向检索的检索词、简报的相关性筛选。
	 * 如果只在界面上显示编辑结果、却不让这两条链路用上，那编辑就是装饰品 ——
	 * 所以这里统一出口，**所有"用关键词"的地方都走它**。
	 */
	async effectiveProfile(options: { dir?: string } = {}): Promise<ProjectProfile> {
		const profile = await this.buildProfile({ ...options, save: false })
		const override = await this.readKeywordOverride()
		const keywords = applyKeywordOverride(profile.keywords ?? [], override)
		return keywords === profile.keywords ? profile : { ...profile, keywords }
	}

	/** 读取上次生成的简报（不自动重算）。 */
	async readBrief(): Promise<ProjectBrief | null> {
		const raw = await this.store.readJsonFile('briefs/latest-brief.json').catch(() => null)
		return raw && typeof raw === 'object' ? (raw as ProjectBrief) : null
	}

	/** 读取上次的检索结果（不自动重跑）。 */
	async readFindings(): Promise<{ generatedAt: string; queries: string[]; findings: PresentedFinding[]; stats: RetrieveResult['stats']; errors: string[] } | null> {
		const raw = await this.store.readJsonFile('findings.json')
		if (!raw || typeof raw !== 'object') return null
		return raw as { generatedAt: string; queries: string[]; findings: PresentedFinding[]; stats: RetrieveResult['stats']; errors: string[] }
	}

	/** 读取上次生成的检索词计划（不自动重建）。 */
	async readResearchPlan(): Promise<ResearchPlan | null> {
		const raw = await this.store.readJsonFile('research-plan.json')
		if (!raw || typeof raw !== 'object') return null
		return raw as ResearchPlan
	}

	/** 已知项目（默认项目排最前）。 */
	async listKnownProjects(): Promise<{ current: string; projects: ProjectEntry[] }> {
		const registry = await this.readRegistryFile()
		const projects = listProjects(registry, this.root).map((entry) => ({
			...entry,
			// 标记当前项目，界面直接用
			isCurrent: normalizeDir(entry.dir) === this.projectDir,
			// 当前项目是否"自动识别来的" —— 界面要显示，用户才知道为什么看到这些内容
			isAuto: normalizeDir(entry.dir) === this.projectDir && this.projectSource === 'auto',
		}))
		return { current: this.projectDir, projects: projects as ProjectEntry[] }
	}

	/**
	 * 切换到某个项目目录。
	 *
	 * 只切"数据放在哪"，**不切换别的东西**：镜像池照旧复用，
	 * 每个项目自己的 prefs/meta/轮转状态都在它自己的数据目录里，互不影响。
	 */
	async useProject(
		dir: string,
		options: { source?: 'manual' | 'auto' } = {},
	): Promise<{ ok: boolean; reason?: string; project?: ReturnType<DailyService['currentProject']> }> {
		const check = checkDir(dir)
		if (!check.ok) return { ok: false, reason: check.reason }
		const normalized = normalizeDir(dir)
		// 直接调用（工具/界面/API）默认视为**用户手动指定** —— 只有自动识别那条路会显式传 auto
		const source = options.source ?? 'manual'

		const registry = await this.readRegistryFile()
		const next = touchProject(registry, this.root, normalized, new Date(), source)
		await this.writeRegistryFile(next)

		this.projectSource = source
		this.projectDir = normalized
		this.store = new DailyStore(projectDataDir(this.root, normalized))
		await this.store.init()
		this.logger.info(`已切换项目：${normalized}`)
		this.emit()
		return { ok: true, project: this.currentProject() }
	}

	/**
	 * 归档容量统计。
	 *
	 * 这个插件是要**每天跑、长期跑**的：`days/*.json` 一天约 50KB，一年 ~19MB。
	 * 用户有权知道它在占多少地方、最老的数据是哪天、有没有哪天已经丢过细节。
	 */
	async storageStats(): Promise<{
		days: number
		items: number
		oldest: string | null
		newest: string | null
		dayBytes: number
		digestBytes: number
		totalBytes: number
		totalLabel: string
		digests: number
		compactedDays: number
	}> {
		const dates = await this.store.listDays()
		let dayBytes = 0
		let items = 0
		let compactedDays = 0
		for (const date of dates) {
			dayBytes += await this.store.fileSize(this.store.dayFile(date))
			const day = await this.store.readDay(date)
			items += day.items.length
			// 一天里过半条目已是索引态，就算这天已被压缩过
			if (day.items.length > 0 && day.items.filter(isCompacted).length >= day.items.length / 2) {
				compactedDays++
			}
		}
		const digestNames = await this.store.listDigests()
		let digestBytes = 0
		for (const name of digestNames) digestBytes += await this.store.fileSize(join(this.store.digestDir, name))

		const totalBytes = dayBytes + digestBytes
		return {
			days: dates.length,
			items,
			oldest: dates[0] ?? null,
			newest: dates[dates.length - 1] ?? null,
			dayBytes,
			digestBytes,
			totalBytes,
			totalLabel: formatBytes(totalBytes),
			digests: digestNames.length,
			compactedDays,
		}
	}

	/**
	 * 按计划压缩 / 删除旧归档。
	 *
	 * `apply=false`（默认）只**报告会做什么**，不写盘 —— 破坏性操作必须先能预览。
	 */
	async pruneArchive(options: { apply?: boolean } = {}): Promise<PruneReport & { stats: Awaited<ReturnType<DailyService['storageStats']>> }> {
		const apply = options.apply === true
		const today = localDate()
		const dates = await this.store.listDays()

		const sizes: Array<{ date: string; items: number; bytes: number }> = []
		for (const date of dates) {
			const bytes = await this.store.fileSize(this.store.dayFile(date))
			const day = await this.store.readDay(date)
			sizes.push({ date, items: day.items.length, bytes })
		}

		const plan = planArchive(sizes, today, {
			compactAfterDays: this.config.archiveCompactAfterDays,
			deleteAfterDays: this.config.archiveDeleteAfterDays,
		})

		let compacted = 0
		let deleted = 0
		let freedBytes = 0
		const changes: DayPlan[] = []

		for (const entry of plan) {
			if (entry.action === 'keep') continue
			changes.push(entry)
			const isDelete = entry.action === 'delete'

			if (!apply) {
				// 预览也要把"几天会被压缩/删除"算准。
				// 踩过的坑：早先这里直接 continue，于是预览的报告写着
				// 「压缩 0 天 · 删除 0 天」却同时列出了待处理日期 —— 数字与清单自相矛盾，
				// 用户会以为"没事可做"。而这类报告正是用户决定要不要执行的全部依据。
				freedBytes += isDelete
					? entry.bytes
					: Math.max(0, entry.bytes - (entry.estimatedBytes ?? entry.bytes))
				if (isDelete) deleted++
				else compacted++
				continue
			}

			try {
				if (isDelete) {
					const removed = await this.store.removeDay(entry.date)
					freedBytes += removed.dayBytes + removed.digestBytes
					deleted++
				} else {
					const day = await this.store.readDay(entry.date)
					const before = Buffer.byteLength(JSON.stringify(day))
					day.items = day.items.map(compactItem)
					const after = Buffer.byteLength(JSON.stringify(day))
					await this.store.writeDay(day)
					freedBytes += Math.max(0, before - after)
					compacted++
				}
			} catch (error) {
				this.logger.warn(
					`归档处理失败（${entry.date} · ${entry.action}）：${error instanceof Error ? error.message : String(error)}`,
				)
			}
		}

		if (apply && (compacted > 0 || deleted > 0)) {
			this.logger.info(
				`归档整理：压缩 ${compacted} 天 · 删除 ${deleted} 天 · 释放 ${formatBytes(freedBytes)}`,
			)
		}

		return {
			dryRun: !apply,
			keep: plan.filter((p) => p.action === 'keep').length,
			compacted,
			deleted,
			freedBytes,
			changes,
			stats: await this.storageStats(),
		}
	}

	/**
	 * 按需发送桌面通知。
	 *
	 * 用 `pickDiverse` 挑代表条目，好让通知也体现用户最初的诉求「推荐**不同**类型的新闻」——
	 * 否则通知里三条标题很可能全来自同一个源。
	 */
	private async maybeNotify(trigger: RefreshTrigger, date: string, items: readonly Item[]): Promise<void> {
		if (!this.config.notifyEnabled) return
		// 手动刷新不弹：用户此刻就在看界面，再弹一条纯属噪音（也是"通知很烦"最常见的来源）
		if (trigger === 'manual') return
		const unread = items.filter((item) => !item.read).length
		const payload = buildDailyNotification({
			date,
			total: items.length,
			unread,
			items: pickDiverse(items, Math.max(1, this.config.notifyMaxTitles)),
			maxTitles: this.config.notifyMaxTitles,
		})
		const result = await sendNotification(payload, {
			enabled: true,
			...(this.deps.spawn ? { spawn: this.deps.spawn } : {}),
		})
		if (result.sent) this.logger.info(`已发送桌面通知：${payload.body}`)
		else this.logger.warn(`桌面通知未发送：${result.reason ?? '未知原因'}`)
	}

	/** 每天最多自动整理一次（挂在采集完成后，不需要用户操心）。 */
	private async maybeAutoCompact(today: string): Promise<void> {
		if (this.config.archiveCompactAfterDays <= 0 && this.config.archiveDeleteAfterDays <= 0) return
		const meta = await this.store.readMeta()
		if (meta.lastPruneDate === today) return
		const report = await this.pruneArchive({ apply: true })
		await this.store.updateMeta((current) => ({ ...current, lastPruneDate: today }))
		// 只有真做了事才值得记一条日志
		if (report.compacted > 0 || report.deleted > 0) {
			this.logger.info(
				`归档自动整理完成：压缩 ${report.compacted} 天 · 删除 ${report.deleted} 天`,
			)
		}
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
		const route = this.resolveAiRoute()
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
		let alreadyHad = 0
		for (const item of targets) {
			const cached = cache.entries[item.id]
			if (cached) {
				item.aiSummary = cached.text
				fromCache++
				continue
			}
			// 合并当天数据时会继承已有的 aiSummary；那就不必再花一次钱。
			// （缓存只覆盖"跨天重复"，覆盖不了"同一天刷新两次"。）
			if (typeof item.aiSummary === 'string' && item.aiSummary.trim()) {
				alreadyHad++
				continue
			}
			missing.push(item)
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
			feeds: prefs.extraFeeds.length,
			project: this.currentProject(),
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
