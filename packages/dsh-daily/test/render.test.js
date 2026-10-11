/**
 * render.ts 的回归测试 —— 重点是**多样化选取**。
 *
 * 需求原话是「每日主动给我推荐**不同**类型的新闻」。只按分数取前 N 会让一个高产源
 * （实测就是 Hacker News）吃掉整段，这条需求名存实亡。所以 pickDiverse 的约束必须有断言守着。
 *
 * 从 lib/ 导入，理由同 rank.test.js。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { humanAge, pickDiverse, renderBrief, renderDigest, statsText } from '../lib/render.js'

function item(overrides = {}) {
	return {
		id: overrides.url ?? 'x',
		title: 'T',
		url: 'https://e.com/1',
		kind: 'web',
		platform: 'web',
		sourceId: 'hn',
		sourceName: 'Hacker News',
		topic: '技术',
		score: 100,
		reasons: [],
		read: false,
		liked: false,
		disliked: false,
		hidden: false,
		firstSeenAt: '2026-10-12T00:00:00.000Z',
		...overrides,
	}
}

function many(count, overrides) {
	return Array.from({ length: count }, (_, i) =>
		item({
			url: `https://e.com/${overrides.sourceId}-${i}`,
			title: `${overrides.topic} story ${i}`,
			score: 100 - i,
			...overrides,
		}),
	)
}

test('pickDiverse：不会让一个源吃掉整段（每源上限 2）', () => {
	const items = [
		...many(10, { sourceId: 'hn', sourceName: 'HN', topic: '技术' }),
		...many(3, { sourceId: 'arxiv', sourceName: 'arXiv', topic: '学术' }),
		...many(3, { sourceId: 'sspai', sourceName: '少数派', topic: '效率' }),
	]
	const picked = pickDiverse(items, 6)
	const perSource = {}
	for (const p of picked) perSource[p.sourceId] = (perSource[p.sourceId] ?? 0) + 1
	assert.equal(picked.length, 6, `应取满 6 条，实际 ${picked.length}`)
	assert.ok(perSource.hn <= 2, `HN 最多 2 条，实际 ${perSource.hn}`)
	assert.equal(new Set(picked.map((p) => p.topic)).size, 3, '三个主题都该出现')
})

test('pickDiverse：源不够时上限让位于"补齐"（但不该继续堆同一个源）', () => {
	// 只有两个源、却要 6 条 —— 上限不可能同时满足，正确行为是补齐
	const items = [
		...many(10, { sourceId: 'hn', sourceName: 'HN', topic: '技术' }),
		...many(1, { sourceId: 'arxiv', sourceName: 'arXiv', topic: '学术' }),
	]
	const picked = pickDiverse(items, 6)
	assert.equal(picked.length, 6)
	// 补齐时优先用得最少的源：arXiv 先被用上，剩下的才轮到 HN
	assert.ok(picked.some((p) => p.sourceId === 'arxiv'))
})

test('pickDiverse：主题轮转 —— 多个主题都会被覆盖', () => {
	const items = [
		...many(5, { sourceId: 'hn', sourceName: 'HN', topic: '技术' }),
		...many(5, { sourceId: 'sspai', sourceName: '少数派', topic: '效率' }),
		...many(5, { sourceId: 'arxiv', sourceName: 'arXiv', topic: '学术' }),
	]
	const picked = pickDiverse(items, 6)
	const topics = new Set(picked.map((p) => p.topic))
	assert.equal(topics.size, 3, `三个主题都该出现，实际 ${JSON.stringify([...topics])}`)
})

test('pickDiverse：候选不足时放宽上限补齐，不留空', () => {
	const items = many(4, { sourceId: 'hn', sourceName: 'HN', topic: '技术' })
	const picked = pickDiverse(items, 6)
	assert.equal(picked.length, 4, '有多少给多少，不能因为限额就少给')
})

test('pickDiverse：maxItems 为 0 / 负数返回空', () => {
	assert.deepEqual(pickDiverse([item()], 0), [])
	assert.deepEqual(pickDiverse([item()], -3), [])
})

test('pickDiverse：同一个 URL 不会重复出现', () => {
	const dup = item({ url: 'https://e.com/same' })
	const picked = pickDiverse([dup, { ...dup }, { ...dup }], 5)
	assert.equal(picked.length, 1)
})

test('renderBrief：包含条数、失败源，并明确告诉模型什么时候用它', () => {
	const text = renderBrief({
		date: '2026-10-12',
		items: [item({ title: 'A story', url: 'https://e.com/a' })],
		sources: [
			{ id: 'hn', name: 'Hacker News', kind: 'web', ok: true, count: 1, error: null, durationMs: 10, at: 'x' },
			{ id: 'youtube', name: 'YouTube', kind: 'video', ok: false, count: 0, error: '全部镜像不可用', durationMs: 10, at: 'x' },
		],
		maxItems: 3,
		now: new Date('2026-10-12T02:00:00.000Z'),
	})
	assert.ok(text.includes('2026-10-12'))
	assert.ok(text.includes('1/2 源正常'), '应给出源健康度')
	assert.ok(text.includes('A story'))
	assert.ok(text.includes('https://e.com/a'), 'brief 必须带链接，模型才能引用')
	assert.ok(text.includes('YouTube'), '失败源要出现在 brief 里')
	assert.ok(text.includes('daily_refresh') === false, '空数据时才提示 refresh')
	assert.ok(text.includes('日报'), '要告诉模型去哪儿看完整索引')
})

test('renderBrief：没有条目时明确提示去刷新，而不是装作有内容', () => {
	const text = renderBrief({ date: '2026-10-12', items: [], sources: [], maxItems: 3 })
	assert.ok(text.includes('daily_refresh'), '空数据应引导模型调用 daily_refresh')
	assert.ok(!text.includes('最值得看的'), '没有条目就不该出现这段')
})

test('renderDigest：按主题分组、带链接与"为什么推荐"，失败源单独列出', () => {
	const text = renderDigest({
		date: '2026-10-12',
		items: [
			item({ title: 'AI 一', url: 'https://e.com/1', topic: 'AI', reasons: ['主题命中「AI」'], score: 200 }),
			item({ title: '开源的', url: 'https://e.com/2', topic: '开源', score: 100 }),
			item({ title: '带讨论的', url: 'https://e.com/3', topic: '技术', discussUrl: 'https://news.ycombinator.com/item?id=1', score: 90 }),
		],
		sources: [
			{ id: 'youtube', name: 'YouTube', kind: 'video', ok: false, count: 0, error: '镜像 502', durationMs: 5, at: 'x' },
		],
		prefs: { topics: ['AI'], keywords: [], blocked: [], sourceWeights: {}, dailyQuota: 100, maxItemsPerSource: 8, halfLifeHours: 36, tuningNotes: [], updatedAt: 'x' },
		generatedAt: new Date('2026-10-12T02:00:00.000Z'),
	})
	assert.ok(text.startsWith('# 今日日报 · 2026-10-12'))
	assert.ok(text.includes('## AI（1 条）'))
	assert.ok(text.includes('## 开源（1 条）'))
	assert.ok(text.includes('[AI 一](https://e.com/1)'))
	assert.ok(text.includes('为什么推荐：主题命中「AI」'))
	assert.ok(text.includes('[讨论](https://news.ycombinator.com/item?id=1)'), 'HN 讨论链接要出现在日报里')
	assert.ok(text.includes('❌ YouTube · 镜像 502'), '失败源要显式列出，不能静默')
	assert.ok(text.includes('当前偏好主题：AI'))
})

test('humanAge / statsText：人话时间与热度呈现', () => {
	const now = new Date('2026-10-12T02:00:00.000Z')
	assert.equal(humanAge('2026-10-12T01:59:40.000Z', now), '刚刚')
	assert.equal(humanAge('2026-10-12T01:30:00.000Z', now), '30 分钟前')
	assert.equal(humanAge('2026-10-11T20:00:00.000Z', now), '6 小时前')
	assert.equal(humanAge('2026-10-09T02:00:00.000Z', now), '3 天前')
	assert.equal(humanAge(undefined, now), '')
	assert.equal(humanAge('not a date', now), '')

	assert.equal(statsText(item({ stats: { points: 301 } })), '▲ 301 分')
	assert.equal(statsText(item({ stats: { stars: 4200 } })), '★ 4200')
	assert.equal(statsText(item({ stats: { views: 573000 } })), '573000 播放')
	assert.equal(statsText(item({ stats: {} })), '')
	assert.equal(statsText(item({ stats: undefined })), '')
})
