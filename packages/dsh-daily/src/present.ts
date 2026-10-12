/**
 * 结果卡片的**展示层**：头图 + 中文介绍。
 *
 * 用户的要求：「结果卡片需要写清楚，最好配上头图和中文介绍」。
 * 为什么这件事值得单独做一层：检索回来的东西**天生是给机器看的** ——
 * GitHub 的英文 description、HN 的英文标题、一串 URL。直接丢给用户，
 * 他看到的是"50 条英文链接"，仍然要自己点进去判断值不值得看。
 *
 * 两层降级（这是本模块的设计原则）：
 * 1. **AI 能跑** → 每条一句中文介绍
 * 2. **AI 跑不了**（没配模型/超时/输出坏了）→ **确定性兜底**：用已有的结构化事实
 *    （★star 数、来源、命中的检索词）拼一句中文说明。
 *    兜底**不假装是 AI 写的**（`introSource` 标出来），而且带着"它是怎么被找到的"，
 *    这本身就是有用的信息。
 */

import type { Finding } from './retrieve.js'

/** 一条结果在界面上的样子。 */
export interface PresentedFinding extends Finding {
	/** 头图（拿不到就没有，界面用占位块 —— 与日报封面同一套契约）。 */
	thumb?: string
	/** 一句话中文介绍。 */
	intro: string
	/** 这句介绍是 AI 写的，还是确定性兜底拼的 —— 不冒充。 */
	introSource: 'ai' | 'fallback'
	/** 展示用的来源名（中文优先）。 */
	sourceLabel: string
}

const GITHUB_PREFIX = 'https://github.com/'

/**
 * 取头图地址。
 *
 * - GitHub 仓库 → **owner 头像**（`github.com/<owner>.png`，稳定、无第三方、无 token）
 * - 其它（HN 文章等）→ **站点自己的 favicon**（`https://<host>/favicon.ico`）
 *   刻意**不**用 Google/DDG 的 favicon 服务：多一个第三方就多一个不可达的失败点
 *   （YouTube 封面在几台机器上都不可达，这个教训够了）。
 *   取不到就让界面走占位块 —— 那条契约（`test/thumb-fallback.test.js`）已经钉住了。
 */
export function thumbForFinding(finding: Finding): string | undefined {
	const url = finding.url
	if (!url) return undefined
	if (finding.provider === 'github' && url.startsWith(GITHUB_PREFIX)) {
		const owner = url.slice(GITHUB_PREFIX.length).split('/')[0]
		if (owner && !owner.includes('?')) return `${GITHUB_PREFIX}${owner}.png?size=96`
	}
	try {
		const parsed = new URL(url)
		// HN 自己的讨论页没有"头图"可言（域名是讨论站，不是内容来源）
		if (/(^|\.)ycombinator\.com$/.test(parsed.hostname)) return undefined
		if (!/^https?:$/.test(parsed.protocol)) return undefined
		return `${parsed.origin}/favicon.ico`
	} catch {
		return undefined
	}
}

/** 来源的中文名（界面用）。 */
export function sourceLabelOf(finding: Finding): string {
	return finding.provider === 'github' ? 'GitHub 项目' : 'Hacker News'
}

/** 把结构化事实拼成一句中文说明（无 AI 时的兜底，也用于给 AI 的提示词提供上下文）。 */
export function fallbackIntro(finding: Finding): string {
	const stats = finding.stats ?? {}
	const facts: string[] = []
	if (typeof stats.stars === 'number') facts.push(`★${stats.stars}`)
	if (typeof stats.points === 'number') facts.push(`${stats.points} 分`)
	if (typeof stats.comments === 'number') facts.push(`${stats.comments} 条讨论`)

	const heat = facts.length > 0 ? `（${facts.join(' · ')}）` : ''
	const base =
		finding.provider === 'github'
			? `GitHub 上的相关项目${heat}`
			: `Hacker News 上的相关讨论${heat}`
	const summary = (finding.summary ?? '').trim()
	// 原文摘要（多半是英文）保留，但**标明是原文**，别让它看起来像中文介绍
	return summary ? `${base}。原文简介：${summary.slice(0, 120)}` : base
}

export interface IntroPromptOptions {
	/** 最多给多少条写介绍（一条一个 token 预算，别一次问太多）。 */
	limit?: number
}

/** 给模型的中文介绍提示词。要求严格 JSON，便于解析；同时给出检索词作为上下文。 */
export function buildIntroPrompt(findings: Finding[], options: IntroPromptOptions = {}): { system: string; user: string } {
	const limit = Math.max(1, options.limit ?? 12)
	const picked = findings.slice(0, limit)
	const lines: string[] = []
	picked.forEach((finding, index) => {
		const stats = finding.stats ?? {}
		const heat = Object.entries(stats)
			.map(([k, v]) => `${k}=${v}`)
			.join(' ')
		lines.push(
			`${index + 1}. 标题：${finding.title}`,
			`   来源：${finding.provider}${heat ? ` · ${heat}` : ''}`,
			`   命中检索词：${finding.query}`,
			finding.summary ? `   原文简介：${finding.summary}` : '',
			`   链接：${finding.url}`,
		)
	})

	return {
		system: [
			'你在给一位中文开发者做**技术调研的结果卡片**。',
			'任务：为下面每条结果写**一句中文介绍**，让他在不点开链接的情况下判断值不值得看。',
			'要求：',
			'1. 一句中文，不超过 60 字，说清"这是什么、和什么有关"。',
			'2. **不要复述标题原文**，不要写"这是一篇关于…的文章"这种空话。',
			'3. 信息不足就基于标题与命中检索词做**保守**的概括，不要编造具体数字或结论。',
			'4. 只输出 JSON 数组，元素是与条目一一对应的字符串，不要任何解释、不要代码块。',
			'例：["React 19 的升级迁移要点，官方变更记录。","可视化状态管理的一个开源实现，star 较多。"]',
		].join('\n'),
		user: lines.filter(Boolean).join('\n'),
	}
}

/**
 * 解析模型给出的中文介绍数组。
 *
 * 解析失败**返回空数组**而不是抛错或猜：调用方会退回 `fallbackIntro`，
 * 于是"模型抽风"最多退化成"介绍不那么好"，不会让卡片没有内容。
 */
export function parseIntros(raw: unknown, expected: number): string[] {
	const text = typeof raw === 'string' ? raw : ''
	if (!text.trim()) return []
	// 允许模型把 JSON 放在代码块里（虽然提示词明确禁止）
	const cleaned = text.replace(/```(?:json)?/g, '').trim()
	const start = cleaned.indexOf('[')
	const end = cleaned.lastIndexOf(']')
	if (start < 0 || end <= start) return []
	let parsed: unknown
	try {
		parsed = JSON.parse(cleaned.slice(start, end + 1))
	} catch {
		return []
	}
	if (!Array.isArray(parsed)) return []
	const out: string[] = []
	for (let i = 0; i < expected; i++) {
		const value = parsed[i]
		out.push(typeof value === 'string' && value.trim() ? value.trim().slice(0, 200) : '')
	}
	return out
}

/** 把 AI 的介绍（可能有空缺）合到结果上；空缺与 AI 不可用都退回确定性兜底。 */
export function applyIntros(findings: Finding[], intros: string[] | null): PresentedFinding[] {
	return findings.map((finding, index) => {
		const ai = intros?.[index]?.trim()
		return {
			...finding,
			thumb: thumbForFinding(finding),
			intro: ai && ai.length > 0 ? ai : fallbackIntro(finding),
			introSource: ai && ai.length > 0 ? 'ai' : 'fallback',
			sourceLabel: sourceLabelOf(finding),
		}
	})
}

/** 生成中文介绍所需的依赖（与 ai.ts 的 StreamFn 同形，但不引入耦合）。 */
export interface IntroGeneratorOptions {
	stream: (options: {
		provider: string
		model: string
		system?: string
		messages: Array<{ role: 'user'; content: string }>
		maxTokens?: number
		signal?: AbortSignal
	}) => AsyncIterable<{ type: string; text?: string; reason?: { kind?: string; failure?: { message?: string } } }>
	provider: string
	model: string
	/** 一次写多少条（上限，别把整页都塞进一次调用）。 */
	limit?: number
	/**
	 * token 上限。**要给推理留足** —— 推理 token 与正文共享这个上限
	 * （dsh-rss 踩过的坑：正文还没开始写就把预算烧完了）。
	 */
	maxTokens?: number
	timeoutMs?: number
}

/** 默认一条介绍大约需要的 token（含推理摊分），乘条数再留一倍余量。 */
const INTRO_TOKENS_PER_ITEM = 220

/**
 * 用模型给结果写中文介绍。
 *
 * **任何失败都返回 `null`**（超时、模型报错、输出解析不出来）—— 调用方会退回确定性兜底，
 * 于是"模型抽风"最多让介绍没那么好，不会让卡片空着，更不会让整轮检索失败。
 */
export async function generateIntros(
	findings: Finding[],
	options: IntroGeneratorOptions,
): Promise<string[] | null> {
	const limit = Math.max(1, options.limit ?? 12)
	const picked = findings.slice(0, limit)
	if (picked.length === 0) return null

	const prompt = buildIntroPrompt(picked, { limit })
	const maxTokens = Math.max(512, options.maxTokens ?? picked.length * INTRO_TOKENS_PER_ITEM * 2)
	const controller = new AbortController()
	const timer = setTimeout(() => controller.abort(), Math.max(2000, options.timeoutMs ?? 60_000))

	try {
		let text = ''
		let failure = ''
		for await (const chunk of options.stream({
			provider: options.provider,
			model: options.model,
			system: prompt.system,
			messages: [{ role: 'user', content: prompt.user }],
			maxTokens,
			signal: controller.signal,
		})) {
			// **真实事件类型是 `text-delta`**（我第一版写成 `text`，会永远收不到正文 → 静默退回兜底）。
			// 两种都认，免得将来 DSH 改个名又静默失效。
			if ((chunk.type === 'text-delta' || chunk.type === 'text') && typeof chunk.text === 'string') {
				text += chunk.text
			}
			if (chunk.reason?.failure?.message) failure = chunk.reason.failure.message
			// 推理 token 把预算烧光、正文没写出来 → 当作失败，退回兜底（别把空数组当成功）
			if (chunk.reason?.kind === 'max-tokens' && !text.trim()) failure = '模型没写出正文就用完了 maxTokens'
		}
		if (!text.trim()) return null
		const intros = parseIntros(text, picked.length)
		if (intros.every((item) => item === '')) return null
		if (failure) return null
		return intros
	} catch {
		return null
	} finally {
		clearTimeout(timer)
	}
}
