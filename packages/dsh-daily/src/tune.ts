import { SOURCE_CATALOG, TOPIC_KEYWORDS } from './catalog.js'
import { matchKeyword } from './rank.js'
import type { Prefs, TuneChange, TuneResult } from './types.js'

/**
 * 自然语言调教。
 *
 * 这是需求 1(b) 的落点，也是本插件跟"表单式配置"的既有插件最大的区别：
 * 用户应该说「以后每天多推 AI Agent 相关的，少推币圈」，而不是去勾选框里找。
 *
 * 三条设计决定：
 * 1. **纯函数**：只受输入与 prefs 影响，不做 I/O、不调模型。所以它可测、可重放，
 *    也能在 `daily_tune` 工具与 HTTP 接口之间共用。
 * 2. **本地规则优先**：绝大多数调教只是"加个主题/加个屏蔽词"，本地解析毫秒出结果、
 *    零成本、零不确定性。真正的兜底（完全读不懂时）留给模型侧的 `daily_tune` 工具：
 *    工具会把用户原话记进 tuningNotes，由模型自己理解后再次调用。
 * 3. **每一处改动都要能被复述**：`applied` 里的每一条都会原样显示给用户看
 *    （"新增屏蔽词：币圈"），否则用户没法判断"我这句话到底生效了没有"。
 */

/** 要剥掉的口语词。剥完剩下的才当候选关键词。 */
const STOPWORDS = [
	'我想要', '我想要看', '我希望', '帮我', '请', '可以', '以后', '现在', '从今天起', '接下来',
	'每天', '每日', '推荐', '推送', '关注', '重点', '主要', '多看', '多想看', '想看', '要看',
	'新闻', '资讯', '文章', '内容', '信息', '视频', '相关', '这类', '这些', '那种', '方向',
	'一点', '一些', '多点', '多点', '更多', '少点', '更少', '增加', '减少', '提高', '降低',
	'多推', '少推', '推', '给我', '来点', '搞点', '加上', '添加', '加入', '去掉', '取消',
	'不要', '不想', '不看', '别', '屏蔽', '过滤', '排除', '不感兴趣', '了', '的', '和', '与',
	'及', '以及', '或者', '还是', '吧', '呢', '啊', '，', '。', '、', '：', '；',
]

const NEG_RE = /屏蔽|不要|不想|不看|别推|别说|少推|少看|减少|降低|去掉|排除|过滤|不感兴趣|取消/
const UNBLOCK_RE = /取消屏蔽|不再屏蔽|恢复|解禁|取消过滤/
const POS_RE = /多推|多看|多想看|想看|要看|推荐|关注|重点|主要|增加|提高|每天|每日|希望|需要|来点/
const QUOTA_RE = /(\d{1,4})\s*条/

/** 主题的同义说法 → 我们词典里的主题名。 */
const TOPIC_ALIASES: Record<string, string> = {
	ai: 'AI',
	人工智能: 'AI',
	大模型: 'AI',
	大语言模型: 'AI',
	机器学习: 'AI',
	llm: 'AI',
	开源: '开源',
	oss: '开源',
	学术: '学术',
	论文: '学术',
	研究: '学术',
	硬件: '硬件',
	芯片: '硬件',
	商业: '商业',
	创业: '商业',
	效率: '效率',
	工具: '效率',
	技术: '技术',
	编程: '技术',
	开发: '技术',
	热点: '热点',
}

const KNOWN_TOPICS = [
	...new Set([
		...TOPIC_KEYWORDS.map((t) => t.topic),
		'热点',
	]),
]

function splitClauses(text: string): string[] {
	return text
		.split(/[，,。；;！!？?\n\r]+/)
		.map((c) => c.trim())
		.filter(Boolean)
}

/** 找出这段话里点到的主题（用别名 + 词典关键词双重匹配）。 */
function detectTopics(clause: string): string[] {
	const hits = new Set<string>()
	for (const [alias, topic] of Object.entries(TOPIC_ALIASES)) {
		if (matchKeyword(clause, alias)) hits.add(topic)
	}
	return [...hits]
}

/** 找出这段话里点到的源（用名字的任意一段匹配，例如"少数派"）。 */
function detectSources(clause: string): string[] {
	const hits: string[] = []
	for (const source of SOURCE_CATALOG) {
		// "哔哩哔哩·热门" → 期望用户只说"哔哩哔哩"或"B站"也能命中
		const short = source.name.split(/[·\s]/)[0] ?? source.name
		if (short && clause.includes(short)) hits.push(source.id)
	}
	if (/b站|bilibili|哔哩/i.test(clause)) hits.push('bilibili-popular')
	if (/hn|hacker\s*news/i.test(clause)) hits.push('hn')
	if (/github/i.test(clause)) hits.push('github')
	if (/arxiv/i.test(clause)) hits.push('arxiv')
	if (/youtube|油管|优兔/i.test(clause)) hits.push('youtube')
	return [...new Set(hits)]
}

/** 剥掉口语词与已识别的主题/源名，剩下的碎片当候选关键词。 */
function extractKeywords(clause: string, consumed: string[]): string[] {
	let rest = clause
	for (const word of [...STOPWORDS, ...consumed]) {
		rest = rest.split(word).join(' ')
	}
	rest = rest.replace(/[，,。；;！!？?、：:（）()「」【】"']/g, ' ')
	return rest
		.split(/\s+|和|与|及|以及|或者|、/)
		.map((w) => w.trim())
		.filter((w) => w.length >= 2 && w.length <= 18)
		.filter((w) => !/^\d+$/.test(w))
		.filter((w) => !/^(ai|llm|news|rss)$/i.test(w))
		.slice(0, 3)
}

function clone(prefs: Prefs): Prefs {
	return {
		...prefs,
		topics: [...prefs.topics],
		keywords: prefs.keywords.map((k) => ({ ...k })),
		blocked: [...prefs.blocked],
		sourceWeights: { ...prefs.sourceWeights },
		tuningNotes: [...prefs.tuningNotes],
	}
}

/**
 * 把一句自然语言落成偏好变更。
 *
 * 返回的 `prefs` 是**新对象**，不会改动传入的 prefs —— 调用方决定要不要落盘。
 */
export function applyTuning(text: string, prefs: Prefs): TuneResult {
	const next = clone(prefs)
	const applied: TuneChange[] = []
	const raw = (text ?? '').trim()
	if (!raw) {
		return { applied, prefs: next, message: '没有收到任何调教内容。' }
	}

	for (const clause of splitClauses(raw)) {
		const unblock = UNBLOCK_RE.test(clause)
		const negative = !unblock && NEG_RE.test(clause)
		const positive = !negative && POS_RE.test(clause)

		const quotaMatch = QUOTA_RE.exec(clause)
		if (quotaMatch?.[1]) {
			const quota = Math.max(5, Math.min(500, Number(quotaMatch[1])))
			if (quota !== next.dailyQuota) {
				next.dailyQuota = quota
				applied.push({
					kind: 'quota',
					field: 'dailyQuota',
					detail: `每日最多保留 ${quota} 条`,
				})
			}
		}

		const topics = detectTopics(clause)
		const sources = detectSources(clause)
		const consumed = [...topics, ...sources]

		if (unblock) {
			const words = extractKeywords(clause, consumed)
			for (const word of words) {
				const index = next.blocked.findIndex((b) => b.toLowerCase() === word.toLowerCase())
				if (index >= 0) {
					next.blocked.splice(index, 1)
					applied.push({ kind: 'remove-blocked', field: 'blocked', detail: `取消屏蔽：${word}` })
				}
			}
			// "取消屏蔽 AI" 这类：把主题加回来
			for (const topic of topics) {
				if (!next.topics.includes(topic)) {
					next.topics.push(topic)
					applied.push({ kind: 'add-topic', field: 'topics', detail: `重新关注主题：${topic}` })
				}
			}
			continue
		}

		for (const topic of topics) {
			if (negative) {
				const index = next.topics.indexOf(topic)
				if (index >= 0) {
					next.topics.splice(index, 1)
					applied.push({ kind: 'remove-topic', field: 'topics', detail: `不再优先推送主题：${topic}` })
				} else {
					applied.push({ kind: 'remove-topic', field: 'topics', detail: `主题「${topic}」本来就没在优先列表里` })
				}
			} else if (!next.topics.includes(topic)) {
				next.topics.push(topic)
				applied.push({ kind: 'add-topic', field: 'topics', detail: `新增主题偏好：${topic}` })
			}
		}

		for (const sourceId of sources) {
			const weight = negative ? 0.4 : 1.5
			next.sourceWeights[sourceId] = weight
			const name = SOURCE_CATALOG.find((s) => s.id === sourceId)?.name ?? sourceId
			applied.push({
				kind: 'source-weight',
				field: `sourceWeights.${sourceId}`,
				detail: negative ? `降低来源权重：${name} ×${weight}` : `提高来源权重：${name} ×${weight}`,
			})
		}

		const keywords = extractKeywords(clause, consumed)
		for (const word of keywords) {
			if (negative) {
				if (!next.blocked.some((b) => b.toLowerCase() === word.toLowerCase())) {
					next.blocked.push(word)
					applied.push({ kind: 'add-blocked', field: 'blocked', detail: `新增屏蔽词：${word}` })
				}
			} else if (positive) {
				const existing = next.keywords.find((k) => k.word.toLowerCase() === word.toLowerCase())
				if (existing) {
					existing.weight = Math.min(2, existing.weight + 0.3)
					applied.push({
						kind: 'add-keyword',
						field: 'keywords',
						detail: `提高关键词权重：${word} → ${existing.weight.toFixed(1)}`,
					})
				} else {
					next.keywords.push({ word, weight: 1.2 })
					applied.push({ kind: 'add-keyword', field: 'keywords', detail: `新增关键词偏好：${word}` })
				}
			}
		}
	}

	// 用户原话无论如何都记下来：它是模型理解"用户到底想要什么"的唯一原始依据，
	// 而上面的规则解析永远会有覆盖不到的表达。
	next.tuningNotes.push(raw)
	if (next.tuningNotes.length > 50) next.tuningNotes.splice(0, next.tuningNotes.length - 50)
	applied.push({ kind: 'note', field: 'tuningNotes', detail: '已记下你的原话，供模型理解上下文' })

	const message = applied.length > 1
		? `已应用 ${applied.length - 1} 项偏好变更。`
		: '没解析出可执行的变更，已记为偏好备注；也可以直接对模型说，让它用 daily_tune 处理。'

	return { applied, prefs: next, message }
}
