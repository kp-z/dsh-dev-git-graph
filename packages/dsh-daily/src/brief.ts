/**
 * 项目简报（第三阶段）：把"抓新闻"从**按天汇总**升级成**按项目理解**。
 *
 * 用户要的三件事 → 三类产出：
 * - 「帮我理解当前项目相关的概念」→ `concepts`
 * - 「获取最新资讯」→ `news`
 * - 「进化建议」→ `advice`
 *
 * ## 设计上的两条硬规矩（先写死，后面每期只做增量）
 * 1. **`news` 不依赖模型**：先用确定性相关性筛出"和项目有关"的条目（匹配到哪个词就是理由）。
 *    模型在时再复排并补"为什么与我有关"。这样**没有模型也有东西看**。
 * 2. **不编造**：`concepts` / `advice` 拿不到模型就**空着并写明原因**（进 `degraded`），
 *    绝不用模板拼一段看起来像建议的话。这个插件已经踩过太多次"看起来在工作"的坑。
 */

import { normalizeUrl } from './rank.js'
import type { ProjectProfile } from './profile.js'
import type { Item } from './types.js'

export type AdviceAction = '升级' | '采纳' | '规避' | '了解'

export interface BriefConcept {
	/** 术语本身（英文术语保留原文，便于搜索）。 */
	term: string
	/** 一句中文解释。 */
	explain: string
	/** 为什么与**这个项目**相关（这是它区别于百科的地方）。 */
	relation: string
	/** 从哪几条条目里看出来的（可追溯）。 */
	from: string[]
}

export interface BriefNews {
	id: string
	title: string
	url: string
	/** 为什么与我相关（模型给的更细；没有模型时用确定性匹配理由）。 */
	why: string
}

export interface BriefAdvice {
	action: AdviceAction
	title: string
	detail: string
	/** 依据：哪条依赖 / 哪条新闻 / 哪个版本线索。 */
	evidence: string[]
	confidence: 'high' | 'medium' | 'low'
}

export interface ProjectBrief {
	date: string
	projectHash: string
	generatedAt: string
	/** 实际使用的模型（空 = 没走 AI）。 */
	model: string
	concepts: BriefConcept[]
	news: BriefNews[]
	advice: BriefAdvice[]
	/** 哪一段降级了、为什么 —— 如实说明，不假装完整。 */
	degraded: Record<string, string>
}

export const ADVICE_ACTIONS: readonly AdviceAction[] = ['升级', '采纳', '规避', '了解']
export const CONFIDENCE_LEVELS = ['high', 'medium', 'low'] as const

/** 模型一次最多处理多少条（多了写不好，也不必要）。 */
export const BRIEF_MAX_ITEMS = 24
/** 每段最多输出多少条 —— 简报是"挑重点"，不是把条目搬一遍。 */
export const BRIEF_MAX_CONCEPTS = 6
export const BRIEF_MAX_NEWS = 10
export const BRIEF_MAX_ADVICE = 5

export interface RelatedItem {
	item: Item
	/** 命中的项目关键词（空 = 靠依赖名命中的）。 */
	hits: string[]
	score: number
}

/** 把项目画像里的"可匹配词"摊平：领域词 + 依赖名（去掉作用域/符号）。 */
export function projectTerms(profile: ProjectProfile): string[] {
	const terms = new Set<string>()
	for (const word of profile.keywords ?? []) {
		const text = String(word).trim().toLowerCase()
		if (text.length >= 2) terms.add(text)
	}
	for (const dep of profile.dependencies ?? []) {
		const raw = String(dep).replace(/^@/, '')
		const segments = raw.split('/').filter(Boolean)
		const pkg = (segments.pop() ?? '').replace(/[-_.]/g, ' ').trim().toLowerCase()
		// 作用域（`@ant-design/icons` 的 `ant-design`）也要收进来：
		// 只取包名末段（`icons`）太泛，而"ant design"才是真正有辨识度的词
		const scope = (segments.pop() ?? '').replace(/[-_.]/g, ' ').trim().toLowerCase()
		if (pkg && pkg.length >= 3) terms.add(pkg)
		if (scope && scope.length >= 3) {
			terms.add(scope)
			const firstOfScope = scope.split(' ')[0]
			if (firstOfScope && firstOfScope.length >= 4 && firstOfScope !== scope) terms.add(firstOfScope)
		}
	}
	return [...terms]
}

/**
 * 确定性相关性筛选：**没有模型也要有东西看**。
 *
 * 判据刻意简单可解释：条目的标题+摘要里出现了项目关键词（或依赖名）就算相关，
 * 并把**命中的词**记下来当"为什么与我相关"。命中越多分越高。
 */
export function selectRelatedItems(profile: ProjectProfile, items: readonly Item[], limit = BRIEF_MAX_ITEMS): RelatedItem[] {
	const terms = projectTerms(profile)
	const out: RelatedItem[] = []
	for (const item of items) {
		const haystack = `${item.title ?? ''} ${item.summary ?? ''}`.toLowerCase()
		if (!haystack.trim()) continue
		const hits = terms.filter((term) => haystack.includes(term))
		if (hits.length === 0) continue
		out.push({ item, hits, score: hits.length })
	}
	// 命中的词越多越靠前；同分时保留原有顺序（rank 已经排过一轮热度）
	return out.sort((a, b) => b.score - a.score).slice(0, Math.max(0, limit))
}

/** 给模型的提示词：要求严格 JSON，且**明确禁止编造**。 */
export function buildBriefPrompt(profile: ProjectProfile, related: readonly RelatedItem[]): { system: string; user: string } {
	const lines: string[] = []
	related.slice(0, BRIEF_MAX_ITEMS).forEach((entry, index) => {
		const item = entry.item
		lines.push(
			`${index + 1}. 标题:${item.title ?? ''}`,
			`   来源:${item.sourceName ?? ''}${item.topic ? ` · 主题 ${item.topic}` : ''}`,
			`   链接:${item.url ?? ''}`,
			entry.hits.length > 0 ? `   命中的项目关键词:${entry.hits.join('、')}` : '',
			item.summary ? `   摘要:${String(item.summary).slice(0, 160)}` : '',
		)
	})

	return {
		system: [
			'你在给一位中文开发者的**项目**做简报。项目信息如下：',
			`项目:${profile.name ?? '(未知)'}`,
			`技术栈:${(profile.languages ?? []).map((l) => l.name).join('、') || '(未知)'}`,
			`依赖:${(profile.dependencies ?? []).slice(0, 20).join('、') || '(未知)'}`,
			`领域关键词:${(profile.keywords ?? []).slice(0, 20).join('、') || '(未知)'}`,
			'',
			'任务：根据下面这些"与项目相关"的新闻条目，产出三段内容，**只输出一个 JSON 对象**：',
			'{',
			'  "concepts": [{"term":"术语","explain":"一句中文解释","relation":"为什么与这个项目相关","from":["条目标题"]}],',
			'  "news":     [{"index":1,"why":"为什么这条与项目相关"}],',
			'  "advice":   [{"action":"升级|采纳|规避|了解","title":"一句话建议","detail":"怎么做","evidence":["依据"],"confidence":"high|medium|low"}]',
			'}',
			'',
			'要求：',
			`1. concepts 最多 ${BRIEF_MAX_CONCEPTS} 条：只挑**开发者可能不熟悉**的术语，别解释常识；relation 要落到这个项目。`,
			`2. news 最多 ${BRIEF_MAX_NEWS} 条：**只能引用上面条目的 index**，why 写清楚与项目的关系。`,
			`3. advice 最多 ${BRIEF_MAX_ADVICE} 条：**可执行**（升级什么、采纳什么、规避什么），evidence 必须来自上面的项目信息或条目。`,
			'4. **信息不足就不要写**：宁可某段为空数组，也不要编造版本号、日期、结论。',
			'5. 不要输出 JSON 之外的任何文字，不要用代码块包裹。',
		].join('\n'),
		user: lines.filter(Boolean).join('\n'),
	}
}

function asString(value: unknown): string | null {
	return typeof value === 'string' && value.trim() ? value.trim() : null
}

function asStringArray(value: unknown, max = 4): string[] {
	if (!Array.isArray(value)) return []
	return value
		.map((v) => asString(v))
		.filter((v): v is string => !!v)
		.slice(0, max)
}

/** 从模型输出里截出 JSON 对象（允许它外面裹了文字或代码块）。 */
function extractJsonObject(raw: unknown): Record<string, unknown> | null {
	if (typeof raw !== 'string') return null
	const cleaned = raw.replace(/```(?:json)?/g, '').trim()
	const start = cleaned.indexOf('{')
	const end = cleaned.lastIndexOf('}')
	if (start < 0 || end <= start) return null
	try {
		const parsed = JSON.parse(cleaned.slice(start, end + 1))
		return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : null
	} catch {
		return null
	}
}

/**
 * 解析模型输出。
 *
 * **逐段容错**：`concepts` 坏了不影响 `advice`；某段为空就是空（由调用方标进 `degraded`）。
 * 任何情况下都不抛 —— 简报生成失败最多是"这一段没有"，不该让刷新/简报整体不可用。
 */
export function parseBrief(
	raw: unknown,
	related: readonly RelatedItem[],
): { concepts: BriefConcept[]; news: BriefNews[]; advice: BriefAdvice[] } {
	const json = extractJsonObject(raw)
	const concepts: BriefConcept[] = []
	const news: BriefNews[] = []
	const advice: BriefAdvice[] = []
	if (!json) return { concepts, news, advice }

	for (const entry of Array.isArray(json.concepts) ? json.concepts : []) {
		if (!entry || typeof entry !== 'object') continue
		const node = entry as Record<string, unknown>
		const term = asString(node.term)
		const explain = asString(node.explain)
		if (!term || !explain) continue
		concepts.push({
			term,
			explain,
			relation: asString(node.relation) ?? '',
			from: asStringArray(node.from),
		})
		if (concepts.length >= BRIEF_MAX_CONCEPTS) break
	}

	// news 只引用 index（模型不该自己编 URL —— 我们能用真实条目就一定会用）
	for (const entry of Array.isArray(json.news) ? json.news : []) {
		if (!entry || typeof entry !== 'object') continue
		const node = entry as Record<string, unknown>
		const index = typeof node.index === 'number' ? node.index : Number(node.index)
		if (!Number.isInteger(index) || index < 1 || index > related.length) continue
		const source = related[index - 1]
		if (!source?.item) continue
		news.push({
			id: source.item.id,
			title: source.item.title ?? '',
			url: source.item.url ?? '',
			why: asString(node.why) ?? `命中项目关键词：${source.hits.join('、') || '(依赖)'}`,
		})
		if (news.length >= BRIEF_MAX_NEWS) break
	}

	for (const entry of Array.isArray(json.advice) ? json.advice : []) {
		if (!entry || typeof entry !== 'object') continue
		const node = entry as Record<string, unknown>
		const title = asString(node.title)
		if (!title) continue
		const action = asString(node.action)
		const confidence = asString(node.confidence)
		advice.push({
			action: (ADVICE_ACTIONS as readonly string[]).includes(action ?? '') ? (action as AdviceAction) : '了解',
			title,
			detail: asString(node.detail) ?? '',
			evidence: asStringArray(node.evidence, 6),
			confidence: (CONFIDENCE_LEVELS as readonly string[]).includes(confidence ?? '')
				? (confidence as BriefAdvice['confidence'])
				: 'medium',
		})
		if (advice.length >= BRIEF_MAX_ADVICE) break
	}

	return { concepts, news, advice }
}

/** 确定性兜底的 news（没有模型 / 模型没给 news 时用）。 */
export function newsFromRelated(related: readonly RelatedItem[], limit = BRIEF_MAX_NEWS): BriefNews[] {
	return related.slice(0, Math.max(0, limit)).map((entry) => ({
		id: entry.item.id,
		title: entry.item.title ?? '',
		url: entry.item.url ?? '',
		why: entriesWhy(entry),
	}))
}

function entriesWhy(entry: RelatedItem): string {
	return entry.hits.length > 0 ? `命中项目关键词：${entry.hits.join('、')}` : '与项目依赖相关'
}

/**
 * 组装最终简报。**这里负责"如实说明"**：
 * - 没有模型 → `degraded.concepts/advice` 写明原因，`news` 用确定性兜底
 * - 模型给了但某段为空 → 也标出来（"模型未产出"），而不是静默留空
 */
export function assembleBrief(input: {
	date: string
	projectHash: string
	related: readonly RelatedItem[]
	model: string
	parsed?: { concepts: BriefConcept[]; news: BriefNews[]; advice: BriefAdvice[] } | null
	aiError?: string
	now?: () => Date
}): ProjectBrief {
	const parsed = input.parsed ?? null
	const degraded: Record<string, string> = {}
	const hasModel = !!input.model && !!parsed

	const news = parsed && parsed.news.length > 0 ? parsed.news : newsFromRelated(input.related)
	if (!hasModel) {
		const reason = input.aiError ? `模型不可用：${input.aiError}` : '未配置模型'
		degraded.concepts = reason
		degraded.advice = reason
		if (parsed?.news?.length) degraded.news = ''
	} else {
		if (parsed.concepts.length === 0) degraded.concepts = '模型未产出概念'
		if (parsed.advice.length === 0) degraded.advice = '模型未产出建议'
	}

	return {
		date: input.date,
		projectHash: input.projectHash,
		generatedAt: (input.now?.() ?? new Date()).toISOString(),
		model: hasModel ? input.model : '',
		concepts: parsed?.concepts ?? [],
		news,
		advice: parsed?.advice ?? [],
		degraded: Object.fromEntries(Object.entries(degraded).filter(([, v]) => v !== '')),
	}
}

/** 一行话说明简报状态（给日志/工具输出）。 */
export function describeBrief(brief: ProjectBrief): string {
	const parts = [`概念 ${brief.concepts.length}`, `资讯 ${brief.news.length}`, `建议 ${brief.advice.length}`]
	const degraded = Object.keys(brief.degraded)
	return `${parts.join(' · ')}${degraded.length > 0 ? `（降级：${degraded.join('/')}）` : ''}`
}

/** 简报里要用的条目 id 规范化（与日报去重同源，避免同一 URL 出现两次）。 */
export function briefItemKey(item: Item): string {
	return item.id || normalizeUrl(item.url ?? '') || (item.title ?? '')
}
