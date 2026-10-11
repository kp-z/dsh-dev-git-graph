/**
 * rank.ts 的回归测试。
 *
 * 一律从 `lib/` 导入（构建产物）而不是 `src/*.ts`：
 * ① 测的就是要发布出去的那份代码；② Node 的原生类型擦除不会把 `./x.js` 重写成 `./x.ts`，
 * 而 rank.ts 内部 import 的是 `./collect/sources.js`，直接引 src 会 ERR_MODULE_NOT_FOUND。
 * 所以 `pnpm test` 先跑 tsc 再跑断言。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
	classifyTopic,
	freshnessFactor,
	itemId,
	matchKeyword,
	normalizeUrl,
	rankItems,
	scoreItem,
	titleKey,
	titleSimilarity,
} from '../lib/rank.js'
import { defaultPrefs } from '../lib/store.js'

const NOW = new Date('2026-10-12T02:00:00.000Z')

function raw(overrides = {}) {
	return {
		title: 'Some Title',
		url: 'https://example.com/a',
		sourceId: 'hn',
		sourceName: 'Hacker News',
		platform: 'hackernews',
		...overrides,
	}
}

function prefs(overrides = {}) {
	return { ...defaultPrefs(), ...overrides }
}

// ---------- URL 规范化 ----------

test('normalizeUrl：去跟踪参数 / 去 fragment / 去 www / 去尾斜杠', () => {
	assert.equal(
		normalizeUrl('https://www.Example.com/path/?utm_source=x&utm_medium=y&id=7#frag'),
		'https://example.com/path?id=7',
	)
	assert.equal(normalizeUrl('https://a.com/x/'), 'https://a.com/x')
	// 根路径的末尾斜杠要保留（https://a.com/ 与 https://a.com 是同一个站，但别删成空路径）
	assert.equal(normalizeUrl('https://a.com/'), 'https://a.com/')
	// 非法输入原样返回，不抛
	assert.equal(normalizeUrl('not a url'), 'not a url')
})

test('itemId：同 URL 稳定、不同 URL 不同（反馈才能跨天累积到同一条）', () => {
	const a = itemId('https://example.com/a')
	assert.equal(a, itemId('https://example.com/a'))
	assert.notEqual(a, itemId('https://example.com/b'))
	assert.equal(a.length, 12)
})

// ---------- 标题相似度 ----------

test('titleKey / titleSimilarity：抓得住"同一件事被多个源报道"，不误伤不同的事', () => {
	assert.equal(titleKey('Hello, World!'), 'hello world')
	const same = titleSimilarity(
		'OpenAI releases a new reasoning model',
		'OpenAI releases new reasoning model',
	)
	const diff = titleSimilarity(
		'OpenAI releases a new reasoning model',
		'Rust 1.94 ships with a faster borrow checker',
	)
	assert.ok(same >= 0.72, `同义标题相似度应 ≥0.72，实际 ${same}`)
	assert.ok(diff < 0.4, `无关标题相似度应偏低，实际 ${diff}`)
})

// ---------- 关键词匹配 ----------

test('matchKeyword：ASCII 词走词边界，不会把 ai 命中到 email/said', () => {
	assert.equal(matchKeyword('email said maintain', 'ai'), false)
	assert.equal(matchKeyword('a new AI model', 'ai'), true)
	assert.equal(matchKeyword('AI 相关新闻', 'ai'), true)
	// 中文没有词边界概念，子串命中就是对的
	assert.equal(matchKeyword('大模型推理新进展', '大模型'), true)
	assert.equal(matchKeyword('完全无关的内容', '大模型'), false)
	// 正则元字符不能炸
	assert.equal(matchKeyword('c++ 与 c#', 'c++'), true)
})

// ---------- 主题分类 ----------

test('classifyTopic：AI 优先于技术；无命中时退回源主题；再退回热点', () => {
	// 同时含 AI 与技术词 —— 必须判 AI（词典顺序有意义）
	assert.equal(classifyTopic({ title: '新的 AI 编程工具', summary: '涉及前端与架构' }), 'AI')
	assert.equal(classifyTopic({ title: '普通的技术文章', fallback: '效率' }), '效率')
	assert.equal(classifyTopic({ title: '今天天气不错' }), '热点')
	// 'says' 里的 ai 不该把它判成 AI
	assert.equal(classifyTopic({ title: 'He says hello' }), '热点')
})

// ---------- 新鲜度 ----------

test('freshnessFactor：随时间单调递减、有下界、缺发布时间略罚', () => {
	const recent = freshnessFactor('2026-10-12T01:00:00.000Z', NOW.toISOString(), 36, NOW)
	const old = freshnessFactor('2026-10-05T01:00:00.000Z', NOW.toISOString(), 36, NOW)
	assert.ok(recent > old, '新的应该比旧的分高')
	assert.ok(recent <= 1 && old >= 0.04, '因子应落在 (0,1] 区间')
	// 半衰期：正好一个半衰期应约为 0.5
	const half = freshnessFactor('2026-10-10T14:00:00.000Z', NOW.toISOString(), 36, NOW)
	assert.ok(Math.abs(half - 0.5) < 0.02, `半衰期应为 0.5，实际 ${half}`)
	// 没有发布时间：按 firstSeen 算并打 0.9 折
	const unknown = freshnessFactor(undefined, NOW.toISOString(), 36, NOW)
	assert.ok(Math.abs(unknown - 0.9) < 0.02, `无时间应为 0.9，实际 ${unknown}`)
})

// ---------- 评分 ----------

test('scoreItem：主题偏好、关键词、屏蔽词、反馈都真的影响分数，且理由可读', () => {
	const base = rankItems([raw({ title: 'A generic post', url: 'https://e.com/1' })], {
		prefs: prefs(),
		feedback: {},
		now: NOW,
	}).length === 1
	assert.ok(base, '基本构造应产出 1 条')

	const neutral = rankItems([raw({ title: 'A generic post', url: 'https://e.com/1' })], {
		prefs: prefs(),
		feedback: {},
		now: NOW,
	})[0]

	const boosted = rankItems(
		[
			raw({
				title: 'A generic post about LLM agents',
				url: 'https://e.com/1',
				topic: 'AI',
			}),
		],
		{
			prefs: prefs({ topics: ['AI'], keywords: [{ word: 'agent', weight: 1.2 }] }),
			feedback: {},
			now: NOW,
		},
	)[0]

	assert.ok(boosted.score > neutral.score, '主题+关键词命中应提分')
	assert.ok(
		boosted.reasons.some((r) => r.includes('AI')),
		`理由里应说明主题命中，实际 ${JSON.stringify(boosted.reasons)}`,
	)

	const blocked = rankItems([raw({ title: 'A generic post', url: 'https://e.com/1' })], {
		prefs: prefs({ blocked: ['generic'] }),
		feedback: {},
		now: NOW,
	})[0]
	assert.ok(blocked.score < neutral.score * 0.1, '屏蔽词应把分数打到几乎不可见')
	assert.ok(blocked.reasons.some((r) => r.includes('屏蔽')))

	// 反馈：同一条 like 之后分数必须上升
	const plain = { title: 'Post', url: 'https://e.com/9', score: 0, reasons: [], platform: 'web', kind: 'web', topic: '热点', read: false, liked: false, disliked: false, hidden: false, firstSeenAt: NOW.toISOString(), sourceId: 'hn', sourceName: 'HN', id: 'x' }
	const liked = scoreItem({ ...plain, liked: true }, prefs(), NOW)
	const disliked = scoreItem({ ...plain, disliked: true }, prefs(), NOW)
	assert.ok(liked.score > disliked.score, 'like 应高于 dislike')
})

// ---------- 去重与配额 ----------

test('rankItems：同 URL 只留一条', () => {
	const items = rankItems(
		[
			raw({ title: 'A', url: 'https://e.com/x' }),
			raw({ title: 'A', url: 'https://e.com/x?utm_source=q' }),
		],
		{ prefs: prefs(), feedback: {}, now: NOW },
	)
	assert.equal(items.length, 1)
})

test('rankItems：标题近似（同一件事多源报道）会合并成一条，并标注"另有报道"', () => {
	const items = rankItems(
		[
			raw({ title: 'OpenAI releases a new reasoning model', url: 'https://a.com/1', sourceId: 'hn', sourceName: 'Hacker News' }),
			raw({ title: 'OpenAI releases new reasoning model', url: 'https://b.com/1', sourceId: 'sspai', sourceName: '少数派' }),
		],
		{ prefs: prefs(), feedback: {}, now: NOW },
	)
	assert.equal(items.length, 1, '近义标题应合并')
	assert.ok(
		items[0].reasons.some((r) => r.includes('另有')),
		`合并后的条目应说明还有别的源报道，实际 ${JSON.stringify(items[0].reasons)}`,
	)
})

test('rankItems：每源配额生效，且配额外的条目不会挤掉别的源', () => {
	// 标题必须真的互不相同：第一版写成 "HN story 0/1/2…" 时它们彼此高度相似，
	// 被标题去重合并成 2 条，测的就不是配额了（这也是这段注释存在的意义）。
	const WORDS = ['alpha', 'bravo', 'charlie', 'delta', 'echo', 'foxtrot', 'golf', 'hotel', 'india', 'juliet']
	const raws = []
	for (let i = 0; i < 20; i++) {
		raws.push(
			raw({
				title: `Report ${i} about ${WORDS[i % WORDS.length]} and ${WORDS[(i + 7) % WORDS.length]}`,
				url: `https://hn.com/${i}`,
				publishedAt: '2026-10-12T01:30:00.000Z',
			}),
		)
	}
	for (let i = 0; i < 3; i++) {
		raws.push(
			raw({
				title: `Study ${i} on ${WORDS[(i + 3) % WORDS.length]} with ${WORDS[(i + 5) % WORDS.length]}`,
				url: `https://arxiv.org/${i}`,
				sourceId: 'arxiv',
				sourceName: 'arXiv',
				platform: 'arxiv',
				publishedAt: '2026-10-12T01:30:00.000Z',
			}),
		)
	}
	const items = rankItems(raws, {
		prefs: prefs({ maxItemsPerSource: 5, dailyQuota: 100 }),
		feedback: {},
		now: NOW,
	})
	const bySource = {}
	for (const item of items) bySource[item.sourceId] = (bySource[item.sourceId] ?? 0) + 1
	assert.equal(bySource.hn, 5, `HN 应被压到 5 条，实际 ${bySource.hn}`)
	assert.equal(bySource.arxiv, 3, 'arXiv 不受 HN 影响')
})

test('rankItems：全局配额生效', () => {
	const raws = []
	for (let i = 0; i < 30; i++) {
		raws.push(raw({ title: `S${i}`, url: `https://x.com/${i}`, sourceId: `src${i % 10}`, sourceName: `S${i}` }))
	}
	const items = rankItems(raws, {
		prefs: prefs({ dailyQuota: 7, maxItemsPerSource: 10 }),
		feedback: {},
		now: NOW,
	})
	assert.equal(items.length, 7)
})

test('rankItems：firstSeen 会被沿用（没有发布时间的条目不会每次刷新都冲到顶部）', () => {
	const first = rankItems([raw({ title: 'No date', url: 'https://e.com/nd' })], {
		prefs: prefs(),
		feedback: {},
		now: NOW,
	})
	const seenAt = first[0].firstSeenAt
	assert.ok(seenAt)

	const later = new Date(NOW.getTime() + 10 * 3600 * 1000)
	const second = rankItems([raw({ title: 'No date', url: 'https://e.com/nd' })], {
		prefs: prefs(),
		feedback: {},
		now: later,
		firstSeen: { 'https://e.com/nd': seenAt },
	})
	assert.equal(second[0].firstSeenAt, seenAt, 'firstSeenAt 不应被重置成"现在"')
})

test('rankItems：用户态（已读/隐藏）来自 feedback；隐藏的不进推荐位但仍在数组尾部', () => {
	const id = itemId('https://e.com/h')
	const items = rankItems([raw({ title: 'Hidden one', url: 'https://e.com/h' })], {
		prefs: prefs(),
		feedback: { [id]: { hidden: true, at: NOW.toISOString() } },
		now: NOW,
	})
	assert.equal(items[0].hidden, true)
	assert.equal(items[0].read, false)
})
