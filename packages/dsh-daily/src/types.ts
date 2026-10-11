/**
 * dsh-daily 的统一数据模型。
 *
 * 一条原则：**原始采集结果（RawItem）与用户态条目（Item）分开**。
 * 采集器只产出 RawItem；id / 评分 / 已读反馈这些只在 Item 上出现，
 * 由 store 层持有并跨轮持久化。这样"重新抓一次"永远不需要担心把用户态冲掉。
 */

/** 条目形态。只有两种 —— 需求里说得很明确：网页，或视频。 */
export type ItemKind = 'web' | 'video'

/** 条目来路。用于徽标、优先级与热度语义（不同平台的"热度"含义完全不同）。 */
export type Platform =
	| 'web'
	| 'rss'
	| 'hackernews'
	| 'arxiv'
	| 'github'
	| 'youtube'
	| 'bilibili'

/** 采集器的产出。没有 id、没有分数、没有用户态。 */
export interface RawItem {
	title: string
	url: string
	/** 采集器已知的形态；缺省时由 rank 依据 platform / url 判定。 */
	kind?: ItemKind
	platform?: Platform
	sourceId: string
	sourceName: string
	summary?: string
	/** ISO 8601；拿不到就留空，排序会退化为"按发现时间"。 */
	publishedAt?: string
	author?: string
	/** 视频封面 / 文章头图。 */
	thumb?: string
	/** 视频时长，形如 "12:34"。 */
	duration?: string
	/** 讨论页（Hacker News 的 item 页、Reddit 帖等）。和正文链接不是一回事，值得单独留一格。 */
	discussUrl?: string
	/** 热度信号。语义随平台不同：HN 是 points，B 站是 views，GitHub 是 stars。 */
	stats?: Record<string, number>
	/** 采集器已知的主题（比自动分类更可信，例如 arXiv 的 cat 直接映射）。 */
	topic?: string
}

/** 落盘并送到前端的完整条目。 */
export interface Item extends RawItem {
	id: string
	kind: ItemKind
	platform: Platform
	topic: string
	score: number
	/** 可解释性：这条为什么排在前面。前端会展示，调教排查也靠它。 */
	reasons: string[]
	read: boolean
	liked: boolean
	disliked: boolean
	hidden: boolean
	/** 首次见到它的时间，用于排序兜底与"新增"判定。 */
	firstSeenAt: string
	/**
	 * 可选的 AI 一句话摘要（默认关闭该功能）。
	 * 与采集器自带的 `summary` 分开存：后者是原文摘要，前者是模型生成的中文一句话，
	 * 前端优先显示它、并在缺失时回落 —— 混成一个字段会让"这条到底是不是 AI 写的"无从判断。
	 */
	aiSummary?: string
}

/** 用户反馈。与 Item 分开存：条目每天重建，反馈要跨天累积用于学习。 */
export interface FeedbackEntry {
	read?: boolean
	liked?: boolean
	disliked?: boolean
	hidden?: boolean
	at: string
}

export type FeedbackMap = Record<string, FeedbackEntry>

export interface KeywordWeight {
	word: string
	weight: number
}

/** 用户偏好档案 —— 「调教」的落点。 */
export interface Prefs {
	/** 想看的主题，有序：靠前的在配额分配上更靠前。 */
	topics: string[]
	keywords: KeywordWeight[]
	/** 屏蔽词：标题/摘要命中即降权到几乎不可见。 */
	blocked: string[]
	/** 单源权重倍数，1 = 中性。 */
	sourceWeights: Record<string, number>
	/** 每日最多留多少条。 */
	dailyQuota: number
	/** 每源最多取多少条。 */
	maxItemsPerSource: number
	/** 新鲜度半衰期（小时）。越小越"只看新的"。 */
	halfLifeHours: number
	/** 用户原话。模型可读，用于让推荐"有上下文"。 */
	tuningNotes: string[]
	updatedAt: string
}

/** 单个采集源的运行状态 —— 失败必须显式暴露，不许静默丢源。 */
export interface SourceState {
	id: string
	name: string
	kind: ItemKind
	ok: boolean
	count: number
	error: string | null
	durationMs: number
	at: string
}

export interface RefreshSummary {
	at: string
	durationMs: number
	ok: boolean
	okSources: number
	failedSources: number
	total: number
	/** 相对上一轮新增的条数。 */
	added: number
}

/** 某一天的全部落盘状态。 */
export interface DayState {
	date: string
	items: Item[]
	sources: SourceState[]
	lastRefresh: RefreshSummary | null
}

/** 调教解析出的可执行变更。前端会把它们逐条展示给用户看"到底改了什么"。 */
export interface TuneChange {
	kind:
		| 'add-topic'
		| 'remove-topic'
		| 'add-keyword'
		| 'remove-keyword'
		| 'add-blocked'
		| 'remove-blocked'
		| 'source-weight'
		| 'quota'
		| 'note'
	field: string
	detail: string
}

export interface TuneResult {
	applied: TuneChange[]
	prefs: Prefs
	/** 解析器的说明（例如「未识别出可执行变更，已记为偏好备注」）。 */
	message: string
}
