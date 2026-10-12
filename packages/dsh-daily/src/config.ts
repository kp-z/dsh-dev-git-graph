import z from '@deepseek-ai/schemastery'

/**
 * dsh-daily 的插件配置。
 *
 * 边界划清：**配置管安装级默认，偏好管运行时可调**。
 * - 这里的字段是"装好之后基本不动"的东西（数据目录、镜像池、超时、并发）。
 * - 用户日常调的（想看什么主题、屏蔽什么词、每源几条）落在 `~/.dsh/daily/prefs.json`，
 *   由右侧栏页面和 `daily_tune` 工具改写 —— 走配置会触发 profile 重载，体验不对。
 *
 * `youtubeChannels` / `extraFeeds` 用 `名称|标识|主题` 的单字符串编码，
 * 而不是嵌套对象数组：这两个字段经常要粘贴、要在设置页里手改，
 * 扁平的字符串数组比嵌套对象好写、好读、也好 diff。
 */
export const DailyConfig = z.object({
	/** 总开关。关掉后不采集、不定时、不注入、不注册工具。 */
	enabled: z.boolean().default(true),

	/** 数据目录。空 = `~/.dsh/daily`。 */
	dataDir: z.string().default(''),

	/** 每天几点生成日报（本地时间，HH:mm）。 */
	dailyTime: z.string().default('08:00'),

	/** 是否把当日日报摘要注入 systemPrompt（=「主动推荐」的机制）。 */
	announceToAgent: z.boolean().default(true),

	/** 注入时最多带几条标题 —— 这是每一轮模型请求都要付的 token，别贪。 */
	announceMaxItems: z.number().default(6),

	/** 启动时若今天还没有数据，自动抓一次。 */
	autoRefreshOnStart: z.boolean().default(true),

	/** 定时刷新间隔（分钟）。0 = 关闭，只靠每日定时。 */
	refreshIntervalMinutes: z.number().default(0),

	/** 单次 HTTP 超时（毫秒）。 */
	requestTimeoutMs: z.number().default(12000),

	/** 并发抓取上限。别开太大：不少站会按 IP 限流。 */
	concurrency: z.number().default(6),

	/** 每源最多取多少条（粗筛，精排由 rank 负责）。 */
	maxItemsPerSource: z.number().default(8),

	/** 当天最多留多少条。 */
	dailyQuota: z.number().default(120),

	/**
	 * 跨天去重窗口（天）。0 = 关闭。
	 *
	 * 默认 3：同一条新闻在最近 3 天推过，就重罚到几乎不会出现在推荐位
	 * （但仍在索引里，`daily_search` 搜得到）。这是"每日推荐"最容易被诟病的地方 ——
	 * 连着三天给你同一条，用户会立刻认定这个插件没用。
	 */
	dedupeWindowDays: z.number().default(3),

	/**
	 * RSSHub 镜像池（按顺序探测，第一个健康的就是它）。
	 * 本机实测（2026-10-12）：8 个公共镜像里只有 ktachibana 可用，
	 * 其余超时 / 502 / DNS 失败 —— 所以这里必须是池，不能写死一个。
	 */
	rsshubMirrors: z
		.array(z.string())
		.default([
			'https://rsshub.ktachibana.party',
			'https://rsshub.rssforever.com',
			'https://rsshub.app',
		]),

	/** YouTube 频道。格式 `名称|@handle 或 UCxxxx|主题`。 */
	youtubeChannels: z
		.array(z.string())
		.default([
			'Two Minute Papers|UCbfYPyITQ-7l4upoX8nvctg|AI',
			'Yannic Kilcher|UCZHmQk67mSJgfCCTn7xBfew|AI',
			'AI Explained|UCNJ1Ymd5yFuUPtn21xtRbbw|AI',
			'Fireship|UCsBjURrPoezykLs9EqgamOA|技术',
			'3Blue1Brown|UCYO_jab_esuFRV4b17AJtAw|学术',
		]),

	/** 额外 RSS/Atom 源。格式 `名称|URL|主题`。 */
	extraFeeds: z.array(z.string()).default([]),

	/** 启用的内置源 id 列表。空 = 全部启用。 */
	enabledSources: z.array(z.string()).default([]),

	/** 屏蔽词（安装级；用户级屏蔽词在 prefs 里，两者取并集）。 */
	blocked: z.array(z.string()).default([]),

	// ---------- 可选 AI 摘要（默认关闭）----------
	// 默认关闭是刻意的：它会真的花 token，也可能失败。用户明确打开才启用。

	/** 是否给当天的条目生成一句话中文摘要。 */
	aiSummaryEnabled: z.boolean().default(false),

	/** 模型路由。两个都留空 = 跟随宿主默认模型。 */
	aiSummaryProvider: z.string().default(''),
	aiSummaryModel: z.string().default(''),

	/** 当天最多摘要几条（列表前 N 条）。 */
	aiSummaryMaxItems: z.number().default(20),

	/** 并发数。推理模型并发太高只会集体撞限流。 */
	aiSummaryConcurrency: z.number().default(3),

	/**
	 * 单次调用的 maxTokens。
	 *
	 * **别调太小**：推理 token 与正文共享这个上限。实测经验（来自 dsh-rss）：
	 * 200 时 20 条里只有 7 条成功，1024 时 12 条，4096 时 20 条全成功。
	 * 撞上限的条目会以"终止原因 max-tokens"的形式明确报告出来，而不是静默变空摘要。
	 */
	aiSummaryMaxTokens: z.number().default(1024),

	/** 单条超时（毫秒）。 */
	aiSummaryTimeoutMs: z.number().default(20000),

	/** 摘要缓存有效期（天）。同一条新闻跨天重复时不该重复付钱。 */
	aiSummaryCacheTtlDays: z.number().default(30),

	/** 缓存条数上限（超出按写入时间淘汰最旧）。 */
	aiSummaryCacheMax: z.number().default(500),

	// ---------- 归档容量（长期运行）----------

	/**
	 * 超过这些天的归档被**压缩**成索引（丢摘要/热度/理由，保留标题/链接/主题/分数）。
	 * 0 = 不压缩。默认 60 天。
	 */
	archiveCompactAfterDays: z.number().default(60),

	/**
	 * 超过这些天的归档被**删除**。0 = 永不删除（默认）。
	 *
	 * 默认不删：数据不可再生，一个"自动清理"的默认值不该由插件替用户决定。
	 * 想开就设成比 archiveCompactAfterDays 更大的值（比如 180）。
	 */
	archiveDeleteAfterDays: z.number().default(0),
})

export type DailyConfig = Schemastery.TypeT<typeof DailyConfig>

/** 兜底默认值 —— Loader 传进来的 config 是 patch 里的**原始值**，不会自动填 schema default。 */
export function resolveConfig(config: Partial<DailyConfig> = {}): DailyConfig {
	return {
		enabled: config.enabled ?? true,
		dataDir: config.dataDir ?? '',
		dailyTime: config.dailyTime ?? '08:00',
		announceToAgent: config.announceToAgent ?? true,
		announceMaxItems: config.announceMaxItems ?? 6,
		autoRefreshOnStart: config.autoRefreshOnStart ?? true,
		refreshIntervalMinutes: config.refreshIntervalMinutes ?? 0,
		requestTimeoutMs: config.requestTimeoutMs ?? 12000,
		concurrency: config.concurrency ?? 6,
		maxItemsPerSource: config.maxItemsPerSource ?? 8,
		dailyQuota: config.dailyQuota ?? 120,
		dedupeWindowDays: config.dedupeWindowDays ?? 3,
		rsshubMirrors: config.rsshubMirrors ?? [
			'https://rsshub.ktachibana.party',
			'https://rsshub.rssforever.com',
			'https://rsshub.app',
		],
		youtubeChannels: config.youtubeChannels ?? [
			'Two Minute Papers|UCbfYPyITQ-7l4upoX8nvctg|AI',
			'Yannic Kilcher|UCZHmQk67mSJgfCCTn7xBfew|AI',
			'AI Explained|UCNJ1Ymd5yFuUPtn21xtRbbw|AI',
			'Fireship|UCsBjURrPoezykLs9EqgamOA|技术',
			'3Blue1Brown|UCYO_jab_esuFRV4b17AJtAw|学术',
		],
		extraFeeds: config.extraFeeds ?? [],
		enabledSources: config.enabledSources ?? [],
		blocked: config.blocked ?? [],
		aiSummaryEnabled: config.aiSummaryEnabled ?? false,
		aiSummaryProvider: config.aiSummaryProvider ?? '',
		aiSummaryModel: config.aiSummaryModel ?? '',
		aiSummaryMaxItems: config.aiSummaryMaxItems ?? 20,
		aiSummaryConcurrency: config.aiSummaryConcurrency ?? 3,
		aiSummaryMaxTokens: config.aiSummaryMaxTokens ?? 1024,
		aiSummaryTimeoutMs: config.aiSummaryTimeoutMs ?? 20000,
		aiSummaryCacheTtlDays: config.aiSummaryCacheTtlDays ?? 30,
		aiSummaryCacheMax: config.aiSummaryCacheMax ?? 500,
		archiveCompactAfterDays: config.archiveCompactAfterDays ?? 60,
		archiveDeleteAfterDays: config.archiveDeleteAfterDays ?? 0,
	}
}
