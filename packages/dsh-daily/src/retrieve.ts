/**
 * 定向检索：拿③生成的检索词，去**真正搜出内容**。
 *
 * 链条位置：① 项目 → ② 画像 → ③ 检索词 → ④ **定向检索**（本文件）→ ⑤ 回流项目。
 *
 * ## 为什么选这两个通道
 * 它们都是**关键词驱动**的，天然适配"用检索词去搜"：
 * - HN Algolia（`hn.algolia.com`）：技术圈讨论与发布消息，实测可达
 * - GitHub 搜索（`api.github.com/search`）：同类项目与实践，实测可达
 * 而 YouTube / Google News 这条路在本机与多台机器上都不可达（前几轮已确认），
 * 所以不把它们放进关键路径 —— **能跑通比覆盖面全更重要**。
 *
 * ## 与日报采集的区别（这是本模块的设计核心）
 * 日报是"把源全都抓一遍再排序"；定向检索是"**带着问题去搜**"。
 * 所以每条结果都必须记住**是哪条检索词把它找出来的**（`query` 字段）——
 * 否则用户看到一堆链接却不知道"为什么要给我看这个"，那就退化成了又一个新闻流。
 *
 * ## 失败处理
 * 检索是"多对多"的（N 条检索词 × 2 个通道）：任何一格失败都只记录在 `errors` 里，
 * **绝不抛异常**。一次网络抖动不该让整轮调研没有结果。
 */

import type { ResearchQuery } from './research.js'

export type ProviderId = 'hn-algolia' | 'github'

export interface ProviderSpec {
	id: ProviderId
	label: string
	/** 用检索词拼出请求 URL。 */
	build: (query: string, limit: number) => string
	headers?: Record<string, string>
	/** 解析响应体成结果。 */
	parse: (raw: unknown, query: string) => Finding[]
}

/**
 * 给某个通道"整形"检索词。
 *
 * 实测教训：真实跑一轮时 **12 次请求 HTTP 200，结果 0 条** —— 因为 AI 给的是中文检索词，
 * 而 HN Algolia 与 GitHub 搜索都是**英文语料**，中文查询只会安静地返回 0 条
 * （不报错、不告警，看起来"检索成功了但没有结果"）。
 * 所以这里做两件事：清掉括号类噪声（`（假）react 19`）、
 * 并对纯英文通道**跳过**以非 ASCII 为主的检索词（记为 skipped，而不是白打一次请求）。
 */
export function shapeQuery(query: string): string {
	return query
		.replace(/[（(][^）)]{0,24}[）)]/g, ' ')   // 模型爱加的括号注释（放宽到 24 字：'(breaking changes)' 也要能清掉）
		.replace(/["'`]+/g, ' ')
		// `@` 与 `/` 会直接让 GitHub 搜索返回 422（实测：`@ant-design/icons …` 报错），
		// 对 HN 也只是噪声 —— 包名里的作用域与斜杠换成空格，关键词反而更好命中
		.replace(/[@/\\]+/g, ' ')
		.replace(/\s{2,}/g, ' ')
		.trim()
}

/** 非 ASCII 字符占比（0 = 全英文）。 */
export function nonAsciiRatio(query: string): number {
	const compact = query.replace(/\s/g, '')
	if (!compact) return 1
	let nonAscii = 0
	for (const ch of compact) if (ch.charCodeAt(0) > 127) nonAscii++
	return nonAscii / compact.length
}

/** 这个通道是否认这条检索词。英文语料的通道遇到中文词就别打了。 */
export function acceptsQuery(provider: ProviderId, query: string): boolean {
	if (provider === 'hn-algolia' || provider === 'github') return nonAsciiRatio(query) <= 0.4
	return true
}

export interface Finding {
	title: string
	url: string
	provider: ProviderId
	/** **哪条检索词找到的** —— 可解释性的关键。 */
	query: string
	summary?: string
	/** 热度信号：HN 是 points，GitHub 是 stars。 */
	stats?: Record<string, number>
	publishedAt?: string
}

/** 最小 fetch 契约（便于注入假实现做测试）。 */
export type FetchLike = (
	url: string,
	init?: { signal?: AbortSignal; headers?: Record<string, string> },
) => Promise<{ ok: boolean; status: number; json: () => Promise<unknown> }>

export interface RetrieveOptions {
	/**
	 * 注入的 fetch。
	 * - 不传（undefined）= 用环境的全局 fetch
	 * - 显式传 `null` = **明确禁用**（测试用；否则单测会真的去打网络，既慢又不稳定）
	 */
	fetch?: FetchLike | null
	/** 每条检索词在每个通道取多少条。 */
	perQueryLimit?: number
	/** 最多用几条检索词（检索词可能有很多，别一次全打出去）。 */
	maxQueries?: number
	timeoutMs?: number
	concurrency?: number
	providers?: ProviderSpec[]
	now?: () => Date
}

const DEFAULTS = {
	perQueryLimit: 5,
	maxQueries: 6,
	timeoutMs: 12_000,
	concurrency: 4,
}

/** URL 编码 + 把检索词收进合理长度（有些模型会给出很长的短语）。 */
export function encodeQuery(query: string): string {
	return encodeURIComponent(query.trim().slice(0, 120))
}

function asString(value: unknown): string | undefined {
	return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function asNumber(value: unknown): number | undefined {
	return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

/** HN Algolia：`hits` 里每个 story 有 title/url/objectID/points/created_at。 */
export function parseHnResponse(raw: unknown, query: string): Finding[] {
	const hits = (raw as { hits?: unknown[] } | null)?.hits
	if (!Array.isArray(hits)) return []
	const out: Finding[] = []
	for (const hit of hits) {
		if (!hit || typeof hit !== 'object') continue
		const node = hit as Record<string, unknown>
		const title = asString(node.title) ?? asString(node.story_title)
		if (!title) continue
		// 有的条目没有外链（Ask HN 之类），落到讨论页
		const objectId = asString(node.objectID)
		const url = asString(node.url) ?? (objectId ? `https://news.ycombinator.com/item?id=${objectId}` : undefined)
		if (!url) continue
		const points = asNumber(node.points)
		const comments = asNumber(node.num_comments)
		out.push({
			title,
			url,
			provider: 'hn-algolia',
			query,
			summary: asString(node.story_text)?.slice(0, 200),
			stats: {
				...(points !== undefined ? { points } : {}),
				...(comments !== undefined ? { comments } : {}),
			},
			publishedAt: asString(node.created_at),
		})
	}
	return out
}

/** GitHub 搜索：`items` 里每个 repo 有 full_name/html_url/description/stargazers_count。 */
export function parseGitHubResponse(raw: unknown, query: string): Finding[] {
	const items = (raw as { items?: unknown[] } | null)?.items
	if (!Array.isArray(items)) return []
	const out: Finding[] = []
	for (const item of items) {
		if (!item || typeof item !== 'object') continue
		const node = item as Record<string, unknown>
		const url = asString(node.html_url)
		const name = asString(node.full_name) ?? asString(node.name)
		if (!url || !name) continue
		const stars = asNumber(node.stargazers_count)
		out.push({
			title: name,
			url,
			provider: 'github',
			query,
			summary: asString(node.description)?.slice(0, 200),
			stats: stars !== undefined ? { stars } : {},
			publishedAt: asString(node.updated_at) ?? asString(node.pushed_at),
		})
	}
	return out
}

export const DEFAULT_PROVIDERS: ProviderSpec[] = [
	{
		id: 'hn-algolia',
		label: 'Hacker News（Algolia 检索）',
		build: (query, limit) =>
			`https://hn.algolia.com/api/v1/search?query=${encodeQuery(query)}&tags=story&hitsPerPage=${limit}`,
		parse: parseHnResponse,
	},
	{
		id: 'github',
		label: 'GitHub 仓库检索',
		build: (query, limit) =>
			`https://api.github.com/search/repositories?q=${encodeQuery(query)}&sort=stars&order=desc&per_page=${limit}`,
		headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'dsh-daily' },
		parse: parseGitHubResponse,
	},
]

/** 一次检索请求的描述（可打印、可测试，不直接发网络）。 */
export interface SearchRequest {
	provider: ProviderId
	query: string
	url: string
	headers?: Record<string, string>
}

/** 把检索词展开成具体请求（**有界**：最多 maxQueries 条词 × 通道数）。 */
export function buildSearchRequests(
	queries: ResearchQuery[],
	options: RetrieveOptions = {},
): SearchRequest[] {
	const providers = options.providers ?? DEFAULT_PROVIDERS
	const limit = Math.max(1, options.perQueryLimit ?? DEFAULTS.perQueryLimit)
	const maxQueries = Math.max(1, options.maxQueries ?? DEFAULTS.maxQueries)
	const out: SearchRequest[] = []
	const accepted: string[] = []
	// **先在候选里挑出"这个通道认的"词，再受 maxQueries 约束**。
	// 早先是先 slice 再过滤 —— 预算会被注定跳过的中文词吃掉，结果一个请求都不发（实测踩到）
	for (const item of queries) {
		if (accepted.length >= maxQueries) break
		if (!item || typeof item.query !== 'string' || !item.query.trim()) continue
		const shaped = shapeQuery(item.query)
		if (!shaped) continue
		if (!providers.some((p) => acceptsQuery(p.id, shaped))) continue
		accepted.push(shaped)
		for (const provider of providers) {
			// 语言不匹配的词直接不打：打过去也是 200 + 0 条，既浪费配额又让人误以为"搜过了"
			if (!acceptsQuery(provider.id, shaped)) continue
			out.push({ provider: provider.id, query: shaped, url: provider.build(shaped, limit), headers: provider.headers })
		}
	}
	return out
}

/** 因语言不匹配而被跳过的检索词（给用户看，别让"没搜"变成"静默没搜"）。 */
export function skippedQueries(queries: ResearchQuery[], options: RetrieveOptions = {}): string[] {
	const providers = options.providers ?? DEFAULT_PROVIDERS
	const maxQueries = Math.max(1, options.maxQueries ?? DEFAULTS.maxQueries)
	return queries
		.map((q) => shapeQuery(String(q?.query ?? '')))
		.filter((shaped) => shaped && providers.every((p) => !acceptsQuery(p.id, shaped)))
}

export interface RetrieveResult {
	findings: Finding[]
	/** 真实发出的请求数与成功/失败数 —— 用户有权知道"它到底搜了几次"。 */
	stats: {
		requests: number
		ok: number
		failed: number
		providers: ProviderId[]
		queries: number
		/** 因语言不匹配被跳过的检索词条数（英文语料通道遇到中文词）。 */
		skipped: number
	}
	/** 失败明细（不抛异常，但要说清哪里失败了）。 */
	errors: string[]
}

/** 按 URL 去重，保留首次出现（并合并"被多条检索词命中"的信息）。 */
export function dedupeFindings(findings: Finding[]): Finding[] {
	const seen = new Map<string, Finding>()
	for (const finding of findings) {
		const key = finding.url.replace(/[#?].*$/, '').replace(/\/$/, '').toLowerCase()
		const existing = seen.get(key)
		if (!existing) {
			seen.set(key, finding)
			continue
		}
		// 同一条被多条检索词命中：把检索词并起来，这本身就是"更相关"的信号
		if (!existing.query.includes(finding.query)) existing.query = `${existing.query}｜${finding.query}`
	}
	return [...seen.values()]
}

/** 热度权重：用于把"搜到的"排一排（HN 点数 / GitHub star）。 */
export function heatOf(finding: Finding): number {
	const stats = finding.stats ?? {}
	const points = stats.points ?? 0
	const stars = stats.stars ?? 0
	return points * 3 + Math.log10(Math.max(1, stars)) * 10
}

/**
 * 跑一轮定向检索。
 *
 * **绝不抛异常**：每格失败都进 `errors`。并发受 `concurrency` 限制，
 * 单个请求超时走 AbortController（不依赖 fetch 自己是否支持超时）。
 */
export async function runRetrieval(
	queries: ResearchQuery[],
	options: RetrieveOptions = {},
): Promise<RetrieveResult> {
	const providers = options.providers ?? DEFAULT_PROVIDERS
	// 注意用 undefined 判断而不是 ??：显式传 null 表示"禁用"，不能被全局 fetch 顶替
	const doFetch =
		options.fetch === undefined
			? (((globalThis.fetch as unknown) as FetchLike | undefined) ?? null)
			: options.fetch
	const requests = buildSearchRequests(queries, options)
	const skipped = skippedQueries(queries, options)
	const errors: string[] = []
	if (skipped.length > 0) {
		errors.push(`跳过 ${skipped.length} 条检索词：它们以中文为主，而 HN/GitHub 是英文语料（打过去只会返回 0 条）`)
	}
	const collected: Finding[] = []
	let ok = 0
	let failed = 0

	if (typeof doFetch !== 'function') {
		return {
			findings: [],
			stats: {
				requests: requests.length,
				ok: 0,
				failed: requests.length,
				providers: providers.map((p) => p.id),
				queries: new Set(requests.map((r) => r.query)).size,
				skipped: skippedQueries(queries, options).length,
			},
			errors: ['当前环境没有可用的 fetch，定向检索跳过'],
		}
	}

	const providerMap = new Map(providers.map((p) => [p.id, p]))
	const byProvider = new Map<ProviderId, Finding[]>()

	const runOne = async (request: SearchRequest): Promise<void> => {
		const provider = providerMap.get(request.provider)
		if (!provider) return
		const controller = new AbortController()
		const timer = setTimeout(() => controller.abort(), Math.max(1000, options.timeoutMs ?? DEFAULTS.timeoutMs))
		try {
			const response = await doFetch(request.url, { signal: controller.signal, headers: request.headers })
			if (!response || !response.ok) {
				failed++
				errors.push(`${provider.label}「${request.query}」失败：HTTP ${response ? response.status : '无响应'}`)
				return
			}
			const parsed = provider.parse(await response.json(), request.query)
			ok++
			const bucket = byProvider.get(provider.id) ?? []
			bucket.push(...parsed)
			byProvider.set(provider.id, bucket)
		} catch (error) {
			failed++
			const message = error instanceof Error ? error.message : String(error)
			errors.push(`${provider.label}「${request.query}」失败：${message.slice(0, 120)}`)
		} finally {
			clearTimeout(timer)
		}
	}

	// 并发闸门：手写而不是引入依赖 —— 只有这一处用得上
	const concurrency = Math.max(1, options.concurrency ?? DEFAULTS.concurrency)
	let cursor = 0
	const workers = Array.from({ length: Math.min(concurrency, requests.length) }, async () => {
		while (cursor < requests.length) {
			const index = cursor++
			const request = requests[index]
			if (!request) break
			await runOne(request)
		}
	})
	await Promise.all(workers)

	for (const bucket of byProvider.values()) collected.push(...bucket)

	return {
		findings: dedupeFindings(collected).sort((a, b) => heatOf(b) - heatOf(a)),
		stats: {
			requests: requests.length,
			ok,
			failed,
			providers: providers.map((p) => p.id),
			queries: new Set(requests.map((r) => r.query)).size,
			skipped: skipped.length,
		},
		errors,
	}
}

/** 一行话描述检索结果，供日志与工具输出。 */
export function describeRetrieval(result: RetrieveResult): string {
	const { requests, ok, failed } = result.stats
	return `${result.findings.length} 条结果（发出 ${requests} 次请求，成功 ${ok}，失败 ${failed}）`
}
