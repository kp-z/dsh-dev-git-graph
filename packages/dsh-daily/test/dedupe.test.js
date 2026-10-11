/**
 * 跨天去重的回归测试。
 *
 * 为什么单独一个文件："每日推荐"最容易被诟病的就是**连着几天推同一条**。
 * 但这个功能有两个方向相反的失效模式，必须同时守住：
 * 罚得太松 → 天天空欢喜；罚得太狠或窗口算错 → 什么都推不出来。
 *
 * 从 lib/ 导入，理由同 rank.test.js。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildRecentlySeen, rankItems } from '../lib/rank.js'
import { defaultPrefs } from '../lib/store.js'

const TODAY = '2026-10-12'
const NOW = new Date('2026-10-12T09:00:00.000Z')

function raw(overrides = {}) {
	return {
		title: 'Some Title',
		url: 'https://example.com/a',
		sourceId: 'hn',
		sourceName: 'Hacker News',
		platform: 'hackernews',
		publishedAt: '2026-10-12T08:00:00.000Z',
		...overrides,
	}
}

function prefs(overrides = {}) {
	return { ...defaultPrefs(), ...overrides }
}

// ---------- 窗口计算（纯函数）----------

test('buildRecentlySeen：只取今天之前的 windowDays 天，且不含今天', () => {
	const days = [
		{ date: '2026-10-08', urls: ['https://a/8'] },
		{ date: '2026-10-09', urls: ['https://a/9'] },
		{ date: '2026-10-10', urls: ['https://a/10'] },
		{ date: '2026-10-11', urls: ['https://a/11'] },
		{ date: '2026-10-12', urls: ['https://a/12'] }, // 今天，必须被排除
	]
	const seen = buildRecentlySeen(days, TODAY, 2)
	assert.deepEqual(Object.keys(seen).sort(), ['https://a/10', 'https://a/11'])
	assert.equal(seen['https://a/12'], undefined, '今天的条目不该出现在窗口里（否则自己罚自己）')
	assert.equal(seen['https://a/9'], undefined, '窗口外的更早日期不该出现')
	// 窗口是按"最近 N 天"取的：给 3 就应含 09、10、11
	assert.deepEqual(Object.keys(buildRecentlySeen(days, TODAY, 3)).sort(), [
		'https://a/10',
		'https://a/11',
		'https://a/9',
	])
})

test('buildRecentlySeen：同一条 URL 出现在多天 → 留最近的那天', () => {
	const days = [
		{ date: '2026-10-10', urls: ['https://same/1'] },
		{ date: '2026-10-11', urls: ['https://same/1'] },
	]
	const seen = buildRecentlySeen(days, TODAY, 5)
	assert.equal(seen['https://same/1'], '2026-10-11', '文案要写"最近那次"，不是最早那次')
})

test('buildRecentlySeen：窗口按**日历天**算，不按归档文件个数（集成测试抓出来的 bug）', () => {
	// 归档稀疏：只有十天前和昨天两个文件。
	// 早先的实现是"取最近 N 个文件"，于是 windowDays=3 会把十天前那天也算进窗口，
	// 把真正的新内容压下去。正确行为是"往前数 3 个日历天"。
	const days = [
		{ date: '2026-10-02', urls: ['https://ancient'] },
		{ date: '2026-10-11', urls: ['https://yesterday'] },
	]
	const seen = buildRecentlySeen(days, TODAY, 3)
	assert.deepEqual(Object.keys(seen), ['https://yesterday'], '十天前的条目不该进 3 天窗口')
})

test('buildRecentlySeen：窗口下界含当天（往前数满 windowDays 天）', () => {
	const days = [
		{ date: '2026-10-09', urls: ['https://boundary'] }, // 正好 3 天前
		{ date: '2026-10-08', urls: ['https://outside'] }, // 差一天出界
	]
	const seen = buildRecentlySeen(days, TODAY, 3)
	assert.ok(seen['https://boundary'], '边界当天应算在窗口内')
	assert.equal(seen['https://outside'], undefined, '再往前一天应出界')
})

test('buildRecentlySeen：windowDays <= 0 直接返回空（关闭去重）', () => {
	const days = [{ date: '2026-10-11', urls: ['https://a/1'] }]
	assert.deepEqual(buildRecentlySeen(days, TODAY, 0), {})
	assert.deepEqual(buildRecentlySeen(days, TODAY, -2), {})
})

test('buildRecentlySeen：历史为空 / 日期乱序都不炸', () => {
	assert.deepEqual(buildRecentlySeen([], TODAY, 3), {})
	const shuffled = [
		{ date: '2026-10-11', urls: ['https://b'] },
		{ date: '2026-10-09', urls: ['https://c'] },
		{ date: '2026-10-10', urls: ['https://d'] },
	]
	const seen = buildRecentlySeen(shuffled, TODAY, 2)
	assert.deepEqual(Object.keys(seen).sort(), ['https://b', 'https://d'], '应取日期最大的 2 天')
})

// ---------- 惩罚效果 ----------

test('rankItems：窗口内推过的条目被重罚，并带上"已推过"的理由', () => {
	const raws = [
		raw({ title: 'Old news', url: 'https://e.com/old' }),
		raw({ title: 'Fresh news', url: 'https://e.com/new' }),
	]
	const plain = rankItems(raws, { prefs: prefs(), feedback: {}, now: NOW, today: TODAY })
	const deduped = rankItems(raws, {
		prefs: prefs(),
		feedback: {},
		now: NOW,
		today: TODAY,
		recentlySeen: { 'https://e.com/old': '2026-10-11' },
	})

	const oldPlain = plain.find((i) => i.url === 'https://e.com/old')
	const oldDeduped = deduped.find((i) => i.url === 'https://e.com/old')
	assert.ok(oldDeduped.score < oldPlain.score, '重复条目应被降分')
	assert.ok(
		oldDeduped.reasons.some((r) => r.includes('2026-10-11') && r.includes('已推过')),
		`理由里要写清哪天推过，实际 ${JSON.stringify(oldDeduped.reasons)}`,
	)
	// 没被推过的条目不受影响
	const fresh = deduped.find((i) => i.url === 'https://e.com/new')
	assert.equal(fresh.score, plain.find((i) => i.url === 'https://e.com/new').score)
})

test('rankItems：重复条目仍然**保留在索引里**（只是排后面），不是被删掉', () => {
	const raws = [raw({ title: 'Old news', url: 'https://e.com/old' })]
	const items = rankItems(raws, {
		prefs: prefs(),
		feedback: {},
		now: NOW,
		today: TODAY,
		recentlySeen: { 'https://e.com/old': '2026-10-11' },
	})
	assert.equal(items.length, 1, '重罚不等于删除 —— daily_search 仍然要搜得到')
	assert.ok(items[0].score > 0)
})

test('rankItems：同一批数据重排（today 相同）不会被判成重复', () => {
	const raws = [raw({ title: 'X', url: 'https://e.com/x' })]
	// 用户调教后会触发同一天重排；此时 recentlySeen 里若意外带上今天，会导致自己罚自己
	const items = rankItems(raws, {
		prefs: prefs(),
		feedback: {},
		now: NOW,
		today: TODAY,
		recentlySeen: { 'https://e.com/x': TODAY },
	})
	const baseline = rankItems(raws, { prefs: prefs(), feedback: {}, now: NOW, today: TODAY })
	assert.equal(items[0].score, baseline[0].score, 'today 命中的条目不该被罚')
})

test('rankItems：重罚足够强 —— 昨天推过的高分条目会落到新的低分条目之后', () => {
	// 两条发布时间相同，**只差热度**：这样"排序翻转"只可能由去重造成，而不是新鲜度造成的。
	// （第一版把昨天那条设成更旧，结果它本来就不排第一，测试断言的是错的东西。）
	const raws = [
		raw({
			title: 'Big story',
			url: 'https://e.com/big',
			publishedAt: '2026-10-12T08:00:00.000Z',
			stats: { points: 800 },
		}),
		raw({
			title: 'Small story',
			url: 'https://e.com/small',
			publishedAt: '2026-10-12T08:00:00.000Z',
			stats: { points: 5 },
		}),
	]
	const before = rankItems(raws, { prefs: prefs(), feedback: {}, now: NOW, today: TODAY })
	assert.equal(before[0].url, 'https://e.com/big', '不去重时高分那条应该排第一')

	const after = rankItems(raws, {
		prefs: prefs(),
		feedback: {},
		now: NOW,
		today: TODAY,
		recentlySeen: { 'https://e.com/big': '2026-10-11' },
	})
	assert.equal(after[0].url, 'https://e.com/small', '去重后新的低分条目应该反超')
})

test('rankItems：repeatPenalty 可调，0 等价于关闭', () => {
	const raws = [raw({ title: 'X', url: 'https://e.com/x' })]
	const off = rankItems(raws, {
		prefs: prefs(),
		feedback: {},
		now: NOW,
		today: TODAY,
		recentlySeen: { 'https://e.com/x': '2026-10-11' },
		repeatPenalty: 0,
	})
	const baseline = rankItems(raws, { prefs: prefs(), feedback: {}, now: NOW, today: TODAY })
	assert.equal(off[0].score, baseline[0].score)
})
