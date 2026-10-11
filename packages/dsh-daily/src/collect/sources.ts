import type { DailyConfig } from '../config.js'
import type { Platform, RawItem } from '../types.js'
import { fetchJson, fetchText } from './http.js'
import type { MirrorPool } from './mirror.js'
import { absoluteUrl, cleanText, parseFeed } from './rss.js'

export interface CollectEnv {
	config: DailyConfig
	pool: MirrorPool
	signal?: AbortSignal
}

export interface SourceResult {
	items: RawItem[]
	/** 该源的补充说明（部分成功、降级路径等），会进日报的"源状态"里给人看。 */
	note?: string
}

export type SourceRunner = (env: CollectEnv) => Promise<SourceResult>

const HN_ARTICLE_RE = /Article URL:\s*(\S+)/i
const HN_POINTS_RE = /Points:\s*(\d+)/i
const HN_COMMENTS_RE = /#\s*Comments:\s*(\d+)/i
const HN_DISCUSS_RE = /Comments URL:\s*(\S+)/i

/**
 * Hacker News。
 *
 * 走 hnrss.org 而不是官方 Firebase API：官方 API 只给 id 列表，拿一条完整条目要再发一次请求
 * （20 条 = 21 次请求）；hnrss 一次就把标题、原文链接、分数、评论数都给全了。
 * 代价是分数要从 description 的 HTML 里抠 —— 抠不到就当没有，不影响条目本身。
 */
export async function collectHackerNews(env: CollectEnv): Promise<SourceResult> {
	const limit = Math.max(5, env.config.maxItemsPerSource * 2)
	const text = await fetchText('https://hnrss.org/frontpage', {
		timeoutMs: env.config.requestTimeoutMs,
		signal: env.signal,
	})
	const feed = parseFeed(text, 'https://hnrss.org/frontpage')
	const items: RawItem[] = []

	for (const entry of feed.items.slice(0, limit)) {
		const rawSummary = entry.summary ?? ''
		const articleUrl = HN_ARTICLE_RE.exec(rawSummary)?.[1]
		// hnrss 的 <link> 就是原文地址；description 里的 Article URL 是更稳的兜底
		const url = absoluteUrl(articleUrl ?? entry.link, 'https://hnrss.org')
		if (!url || !entry.title) continue
		const points = Number(HN_POINTS_RE.exec(rawSummary)?.[1] ?? NaN)
		const comments = Number(HN_COMMENTS_RE.exec(rawSummary)?.[1] ?? NaN)
		const discussUrl = HN_DISCUSS_RE.exec(rawSummary)?.[1]
		const stats: Record<string, number> = {}
		if (Number.isFinite(points)) stats.points = points
		if (Number.isFinite(comments)) stats.comments = comments

		items.push({
			title: entry.title,
			url,
			kind: 'web',
			platform: 'hackernews',
			sourceId: 'hn',
			sourceName: 'Hacker News',
			author: entry.author,
			publishedAt: entry.publishedAt,
			stats,
			discussUrl: discussUrl ? absoluteUrl(discussUrl, 'https://news.ycombinator.com') : undefined,
			topic: '技术',
		})
	}

	return { items }
}

/** arXiv 里我们真正关心的分类。cs.AI 太杂，配上 CL / LG / CV 才像"AI 前沿"。 */
const ARXIV_CATEGORIES = ['cs.AI', 'cs.CL', 'cs.LG', 'cs.CV']

export async function collectArxiv(env: CollectEnv): Promise<SourceResult> {
	const limit = Math.max(5, env.config.maxItemsPerSource)
	const query = ARXIV_CATEGORIES.map((c) => `cat:${c}`).join('+OR+')
	const url =
		`https://export.arxiv.org/api/query?search_query=${query}` +
		`&sortBy=submittedDate&sortOrder=descending&max_results=${limit}`
	const text = await fetchText(url, {
		timeoutMs: env.config.requestTimeoutMs,
		signal: env.signal,
	})
	const feed = parseFeed(text, 'https://arxiv.org')
	const items: RawItem[] = []

	for (const entry of feed.items) {
		if (!entry.title) continue
		// arXiv 的 <id> 是 http://arxiv.org/abs/xxxx，link rel=alternate 才是 https 的正式页
		const url = absoluteUrl(entry.link || entry.guid || '', 'https://arxiv.org')
		if (!url) continue
		items.push({
			title: entry.title.replace(/\s+/g, ' ').trim(),
			url,
			kind: 'web',
			platform: 'arxiv',
			sourceId: 'arxiv',
			sourceName: 'arXiv',
			author: entry.author,
			publishedAt: entry.publishedAt,
			summary: entry.summary ? clamp(cleanText(entry.summary), 400) : undefined,
			topic: '学术',
		})
	}

	return { items }
}

interface GithubRepo {
	full_name: string
	html_url: string
	description: string | null
	stargazers_count: number
	forks_count: number
	language: string | null
	created_at: string
	owner?: { avatar_url?: string }
}

/**
 * GitHub：**不用** Trending 页面（已实测超时），改用 Search API 做等价的事 ——
 * "最近 30 天创建、star 数最高"就是 Trending 的语义，而且是结构化 JSON。
 */
export async function collectGithub(env: CollectEnv): Promise<SourceResult> {
	const since = new Date(Date.now() - 30 * 86_400_000).toISOString().slice(0, 10)
	const limit = Math.max(5, env.config.maxItemsPerSource)
	const url =
		`https://api.github.com/search/repositories?q=stars:%3E80+created:%3E${since}` +
		`&sort=stars&order=desc&per_page=${limit}`
	const data = await fetchJson<{ items?: GithubRepo[] }>(url, {
		timeoutMs: env.config.requestTimeoutMs,
		signal: env.signal,
		headers: { accept: 'application/vnd.github+json' },
	})
	const items: RawItem[] = []

	for (const repo of data.items ?? []) {
		if (!repo.full_name || !repo.html_url) continue
		items.push({
			title: repo.full_name,
			url: repo.html_url,
			kind: 'web',
			platform: 'github',
			sourceId: 'github',
			sourceName: 'GitHub 新晋热门',
			author: repo.owner?.avatar_url ? undefined : undefined,
			publishedAt: repo.created_at,
			summary: repo.description ? clamp(cleanText(repo.description), 300) : undefined,
			stats: { stars: repo.stargazers_count, forks: repo.forks_count },
			topic: '开源',
		})
	}

	return { items }
}

interface BilibiliVideo {
	bvid?: string
	aid?: number
	title?: string
	pic?: string
	duration?: number
	pubdate?: number
	desc?: string
	owner?: { name?: string }
	stat?: { view?: number; danmaku?: number; like?: number }
}

interface BilibiliResponse {
	code: number
	message?: string
	data?: { list?: BilibiliVideo[] } | BilibiliVideo[]
}

/** 秒 → `mm:ss` / `h:mm:ss`。B 站给的是秒数，前端约定要字符串。 */
export function formatDuration(seconds: number | undefined): string | undefined {
	if (!seconds || !Number.isFinite(seconds) || seconds <= 0) return undefined
	const total = Math.round(seconds)
	const h = Math.floor(total / 3600)
	const m = Math.floor((total % 3600) / 60)
	const s = total % 60
	const pad = (n: number) => `${n}`.padStart(2, '0')
	return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`
}

const pad2 = (n: number) => `${n}`.padStart(2, '0')

/**
 * 把 feed 里五花八门的时长写法统一成 `mm:ss` / `h:mm:ss`。
 *
 * 为什么要归一化：`itunes:duration` 在不同 feed 里可能是
 * `754`（秒）、`12:34`、`1:02:03`，而 Atom 的 `media:content duration` 常用 ISO 8601 的
 * `PT12M34S`。前端的角标只认 `mm:ss` 形式，混着显示会出现 "PT12M34S" 这种噪音。
 * 认不出来就返回 undefined（宁可不显示，也不要显示错的）。
 */
export function normalizeDuration(input: string | undefined): string | undefined {
	if (!input) return undefined
	const raw = input.trim()
	if (!raw) return undefined
	// 已经是 mm:ss / h:mm:ss
	if (/^\d{1,3}:\d{1,2}(:\d{1,2})?$/.test(raw)) return raw
	// ISO 8601：PT1H2M3S / PT12M34S / PT45S
	const iso = /^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/i.exec(raw)
	if (iso) {
		const h = Number(iso[1] ?? 0)
		const m = Number(iso[2] ?? 0)
		const s = Number(iso[3] ?? 0)
		if (h + m + s === 0) return undefined
		return h > 0 ? `${h}:${pad2(m)}:${pad2(s)}` : `${m}:${pad2(s)}`
	}
	// 纯秒数
	if (/^\d+$/.test(raw)) return formatDuration(Number(raw))
	return undefined
}

function bilibiliThumb(pic: string | undefined): string | undefined {
	if (!pic) return undefined
	// 封面是 http 直链，页面在 https 的宿主里会被混合内容策略拦掉
	return pic.replace(/^http:\/\//, 'https://')
}

async function fetchBilibili(env: CollectEnv, apiUrl: string): Promise<BilibiliResponse> {
	return fetchJson<BilibiliResponse>(apiUrl, {
		timeoutMs: env.config.requestTimeoutMs,
		signal: env.signal,
		// B 站对无 Referer 的请求会返回 -352 风控
		referer: 'https://www.bilibili.com',
	})
}

function mapBilibiliVideos(
	list: BilibiliVideo[],
	sourceId: string,
	sourceName: string,
): RawItem[] {
	const items: RawItem[] = []
	for (const video of list) {
		if (!video.bvid || !video.title) continue
		const stats: Record<string, number> = {}
		if (typeof video.stat?.view === 'number') stats.views = video.stat.view
		if (typeof video.stat?.danmaku === 'number') stats.danmaku = video.stat.danmaku
		if (typeof video.stat?.like === 'number') stats.likes = video.stat.like
		items.push({
			title: video.title,
			url: `https://www.bilibili.com/video/${video.bvid}`,
			kind: 'video',
			platform: 'bilibili',
			sourceId,
			sourceName,
			author: video.owner?.name,
			publishedAt: video.pubdate ? new Date(video.pubdate * 1000).toISOString() : undefined,
			summary: video.desc ? clamp(cleanText(video.desc), 200) : undefined,
			thumb: bilibiliThumb(video.pic),
			duration: formatDuration(video.duration),
			stats,
			topic: '热点',
		})
	}
	return items
}

/** 哔哩哔哩·热门。这个接口无需签名，是本机实测最稳的视频源。 */
export async function collectBilibiliPopular(env: CollectEnv): Promise<SourceResult> {
	const ps = Math.max(5, env.config.maxItemsPerSource)
	const data = await fetchBilibili(
		env,
		`https://api.bilibili.com/x/web-interface/popular?ps=${ps}&pn=1`,
	)
	if (data.code !== 0) throw new Error(`B 站热门接口返回 code=${data.code}（${data.message ?? ''}）`)
	const list = Array.isArray(data.data) ? data.data : (data.data?.list ?? [])
	return { items: mapBilibiliVideos(list, 'bilibili-popular', '哔哩哔哩·热门') }
}

/** 哔哩哔哩·全站排行榜。带 rid=0 是全站；偶发 -352 风控，交给 http 层重试。 */
export async function collectBilibiliRanking(env: CollectEnv): Promise<SourceResult> {
	const data = await fetchBilibili(
		env,
		'https://api.bilibili.com/x/web-interface/ranking/v2?rid=0&type=all',
	)
	if (data.code !== 0) {
		throw new Error(`B 站排行榜接口返回 code=${data.code}（${data.message ?? ''}）`)
	}
	const list = Array.isArray(data.data) ? data.data : (data.data?.list ?? [])
	return {
		items: mapBilibiliVideos(list, 'bilibili-ranking', '哔哩哔哩·排行榜').slice(
			0,
			Math.max(5, env.config.maxItemsPerSource),
		),
	}
}

/**
 * YouTube：**必须**走 RSSHub 镜像池。
 * 官方 feed（`youtube.com/feeds/videos.xml`）、Invidious、Piped 在本机全部直连超时（已实测）。
 */
export async function collectYoutube(env: CollectEnv): Promise<SourceResult> {
	const channels = env.config.youtubeChannels
		.map(parseChannelSpec)
		.filter((c): c is ChannelSpec => c !== null)
	if (channels.length === 0) return { items: [], note: '未配置任何 YouTube 频道' }

	// 先花一次**并行**探测把"哪个镜像活着"确定下来，再逐频道取 feed。
	// 不预热的话每个频道都要自己串行试遍所有镜像：5 个频道 × 3 个镜像 × 12s 超时 ≈ 3 分钟（实测 50 秒）。
	await env.pool.warmUp(env.signal ? { signal: env.signal } : {})

	const items: RawItem[] = []
	const failures: string[] = []
	let usedMirror = ''

	for (const channel of channels) {
		if (env.signal?.aborted) break
		const route = channel.channelId.startsWith('@')
			? `/youtube/user/${channel.channelId}`
			: `/youtube/channel/${channel.channelId}`
		try {
			const { text, mirror } = await env.pool.fetchRoute(route, { signal: env.signal })
			usedMirror = mirror
			const feed = parseFeed(text, 'https://www.youtube.com')
			for (const entry of feed.items.slice(0, env.config.maxItemsPerSource)) {
				const videoId = extractYoutubeId(entry.guid ?? entry.link ?? '')
				const url = videoId
					? `https://www.youtube.com/watch?v=${videoId}`
					: absoluteUrl(entry.link, 'https://www.youtube.com')
				if (!url || !entry.title) continue
				items.push({
					title: entry.title,
					url,
					kind: 'video',
					platform: 'youtube',
					sourceId: 'youtube',
					sourceName: channel.name,
					author: entry.author ?? channel.name,
					publishedAt: entry.publishedAt,
					summary: entry.summary ? clamp(cleanText(entry.summary), 200) : undefined,
					thumb: entry.image ?? (videoId ? `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg` : undefined),
					duration: normalizeDuration(entry.duration),
					topic: channel.topic,
				})
			}
		} catch (error) {
			failures.push(`${channel.name}: ${error instanceof Error ? error.message : String(error)}`)
		}
	}

	if (items.length === 0 && failures.length > 0) {
		throw new Error(`全部频道抓取失败（${failures.slice(0, 2).join('；')}）`)
	}
	return {
		items,
		note: failures.length
			? `部分频道失败（${failures.length}/${channels.length}）：${failures[0]}`
			: `镜像 ${usedMirror.replace(/^https?:\/\//, '')}`,
	}
}

interface ChannelSpec {
	name: string
	channelId: string
	topic: string
}

/** 解析 `名称|频道ID或@handle|主题`。容错：只给两段时主题留空，交给自动分类。 */
export function parseChannelSpec(spec: string): ChannelSpec | null {
	const parts = (spec ?? '').split('|').map((p) => p.trim())
	if (parts.length < 2) return null
	const [name, channelId, topic] = parts
	if (!name || !channelId) return null
	return { name, channelId, topic: topic || 'AI' }
}

/** 从 `yt:video:XXXX` / `watch?v=XXXX` / feed 的 id 里取出视频 ID。 */
export function extractYoutubeId(input: string): string | null {
	const byScheme = /yt:video:([A-Za-z0-9_-]{6,})/.exec(input)
	if (byScheme?.[1]) return byScheme[1]
	const byQuery = /[?&]v=([A-Za-z0-9_-]{6,})/.exec(input)
	if (byQuery?.[1]) return byQuery[1]
	const byShorts = /\/shorts\/([A-Za-z0-9_-]{6,})/.exec(input)
	if (byShorts?.[1]) return byShorts[1]
	return null
}

/** 内置的中文科技媒体源。都是实测可达的直连 feed（不需要镜像）。 */
const BUILTIN_FEEDS: Record<string, { name: string; url: string; topic: string }> = {
	sspai: { name: '少数派', url: 'https://sspai.com/feed', topic: '效率' },
	ithome: { name: 'IT之家', url: 'https://www.ithome.com/rss/', topic: '技术' },
	solidot: { name: 'Solidot', url: 'https://www.solidot.org/index.rss', topic: '技术' },
	ruanyifeng: {
		name: '阮一峰的网络日志',
		url: 'https://www.ruanyifeng.com/blog/atom.xml',
		topic: '技术',
	},
}

async function collectFeedUrl(
	env: CollectEnv,
	target: { id: string; name: string; url: string; topic: string },
): Promise<RawItem[]> {
	const text = await fetchText(target.url, {
		timeoutMs: env.config.requestTimeoutMs,
		signal: env.signal,
	})
	const feed = parseFeed(text, target.url)
	const items: RawItem[] = []
	for (const entry of feed.items.slice(0, Math.max(5, env.config.maxItemsPerSource))) {
		const url = absoluteUrl(entry.link, target.url)
		if (!url || !entry.title) continue
		items.push({
			title: entry.title,
			url,
			kind: 'web',
			platform: 'rss',
			sourceId: target.id,
			sourceName: target.name,
			author: entry.author,
			publishedAt: entry.publishedAt,
			summary: entry.summary ? clamp(cleanText(entry.summary), 300) : undefined,
			thumb: entry.image,
			topic: target.topic,
		})
	}
	return items
}

/** 为某个内置 feed 生成 runner。 */
export function makeFeedRunner(id: string): SourceRunner {
	const target = BUILTIN_FEEDS[id]
	if (!target) throw new Error(`未知的内置 feed：${id}`)
	return async (env) => ({
		items: await collectFeedUrl(env, { id, ...target }),
	})
}

/** 用户自配的额外 RSS 源，格式 `名称|URL|主题`。 */
export function parseFeedSpec(spec: string): { name: string; url: string; topic: string } | null {
	const parts = (spec ?? '').split('|').map((p) => p.trim())
	if (parts.length < 2) return null
	const [name, url, topic] = parts
	if (!name || !url?.startsWith('http')) return null
	return { name, url, topic: (topic || '').trim() || '热点' }
}

export async function collectExtraFeeds(env: CollectEnv): Promise<SourceResult> {
	const specs = env.config.extraFeeds
		.map(parseFeedSpec)
		.filter((s): s is { name: string; url: string; topic: string } => s !== null)
	if (specs.length === 0) return { items: [] }

	const items: RawItem[] = []
	const failures: string[] = []
	for (const [index, spec] of specs.entries()) {
		try {
			items.push(
				...(await collectFeedUrl(env, { id: `extra-${index}`, ...spec })),
			)
		} catch (error) {
			failures.push(`${spec.name}: ${error instanceof Error ? error.message : String(error)}`)
		}
	}
	return {
		items,
		note: failures.length ? `${failures.length} 个自定义源失败` : undefined,
	}
}

/** 平台 → 默认形态。采集器没声明 kind 时的兜底判定。 */
export function inferKind(platform: Platform, url: string): 'web' | 'video' {
	if (platform === 'youtube' || platform === 'bilibili') return 'video'
	if (/youtube\.com\/watch|bilibili\.com\/video|youtu\.be\//.test(url)) return 'video'
	return 'web'
}

function clamp(text: string, max: number): string {
	if (text.length <= max) return text
	return `${text.slice(0, max - 1)}…`
}
