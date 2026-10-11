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
	}
}
