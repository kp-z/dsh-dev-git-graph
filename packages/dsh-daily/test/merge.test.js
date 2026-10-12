/**
 * 当天数据合并的回归测试。
 *
 * 修的是用户可见的症状：**刷新一下，条目反而变少了**。
 * 早先 `runRefresh` 用本轮采集结果整份覆盖当天，于是
 * - 定向刷新会冲掉当天其它源的内容
 * - 同一天第二次刷新时若某个源失败，那个源上午抓到的条目会消失
 *
 * 所以测试的重点是**"没抓到的东西必须还在"**，以及两件容易被顺手弄坏的事：
 * `firstSeenAt`（丢了老条目会被当成新内容）与 `aiSummary`（丢了就等于重新花钱）。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { mergeDayItems, mergeSourceStates } from '../lib/merge.js'
import { DailyService } from '../lib/service.js'
import { resolveConfig } from '../lib/config.js'
import { localDate } from '../lib/store.js'

const SILENT = { info() {}, warn() {}, error() {} }
const TODAY = '2026-10-12'

const raw = (url, title = 'T', extra = {}) => ({
	title,
	url,
	sourceId: 'hn',
	sourceName: 'HN',
	platform: 'hackernews',
	...extra,
})

const item = (url, extra = {}) => ({
	...raw(url),
	id: 'id-' + url,
	kind: 'web',
	topic: '技术',
	score: 1,
	reasons: [],
	read: false,
	liked: false,
	disliked: false,
	hidden: false,
	firstSeenAt: `${TODAY}T01:00:00.000Z`,
	...extra,
})

// ---------- 纯函数 ----------

test('mergeDayItems：没抓到的旧条目必须保留（这正是修的那个 bug）', () => {
	const previous = [item('https://e.com/a'), item('https://e.com/b')]
	const result = mergeDayItems(previous, [])
	assert.equal(result.items.length, 2, '本轮什么都没抓到，也绝不能把当天清空')
	assert.equal(result.carriedOver, 2)
	assert.equal(result.added, 0)
	assert.equal(result.refreshed, 0)
})

test('mergeDayItems：新抓到的与旧的并集，计数分得清', () => {
	const previous = [item('https://e.com/a'), item('https://e.com/b')]
	const fresh = [raw('https://e.com/b'), raw('https://e.com/c')]
	const result = mergeDayItems(previous, fresh)
	assert.equal(result.items.length, 3, 'a 保留 + b 更新 + c 新增')
	assert.equal(result.refreshed, 1)
	assert.equal(result.carriedOver, 1)
	assert.equal(result.added, 1)
})

test('mergeDayItems：同一条目以新字段为准，但继承 firstSeenAt 与 aiSummary', () => {
	const previous = [
		item('https://e.com/a', {
			firstSeenAt: '2026-10-12T00:10:00.000Z',
			aiSummary: '上午生成的摘要',
			summary: '旧摘要',
		}),
	]
	const fresh = [raw('https://e.com/a', '被源方改过的标题', { summary: '新摘要' })]
	const result = mergeDayItems(previous, fresh)
	const merged = result.items[0]
	assert.equal(merged.title, '被源方改过的标题', '标题应取新抓的（源方改过）')
	assert.equal(merged.summary, '新摘要')
	assert.equal(merged.firstSeenAt, '2026-10-12T00:10:00.000Z', 'firstSeenAt 必须继承（否则老条目会被当成新内容）')
	assert.equal(merged.aiSummary, '上午生成的摘要', '已生成的 AI 摘要必须继承（否则等于重新花钱）')
})

test('mergeDayItems：按规范化 URL 去重（utm 变体不会重复）', () => {
	const previous = [item('https://e.com/a?utm_source=x')]
	const fresh = [raw('https://e.com/a')]
	const result = mergeDayItems(previous, fresh)
	assert.equal(result.items.length, 1, '带 utm 的写法要能认出来是同一条')
	assert.equal(result.refreshed, 1)
	assert.equal(result.carriedOver, 0)
})

test('mergeDayItems：没有旧数据时就是全部新增；空输入不炸', () => {
	const result = mergeDayItems([], [raw('https://e.com/a'), raw('https://e.com/b')])
	assert.equal(result.added, 2)
	assert.equal(result.items.length, 2)
	assert.deepEqual(mergeDayItems([], []), { items: [], refreshed: 0, carriedOver: 0, added: 0 })
})

test('mergeDayItems：缺 url 的脏数据被跳过，不会把 undefined 混进列表', () => {
	const result = mergeDayItems([item('')], [raw('https://e.com/a'), { ...raw('https://e.com/b'), url: '' }])
	assert.equal(result.items.length, 1)
	assert.equal(result.items[0].url, 'https://e.com/a')
})

test('mergeSourceStates：本轮跑过的用新状态，没跑的沿用上一次', () => {
	const previous = [
		{ id: 'hn', ok: true, count: 16 },
		{ id: 'youtube', ok: true, count: 24 },
		{ id: 'arxiv', ok: true, count: 8 },
	]
	const fresh = [
		{ id: 'youtube', ok: false, count: 0 },
		{ id: 'bilibili-popular', ok: true, count: 8 },
	]
	const merged = mergeSourceStates(previous, fresh)
	assert.deepEqual(merged.map((s) => s.id), ['youtube', 'bilibili-popular', 'hn', 'arxiv'])
	assert.equal(merged.find((s) => s.id === 'youtube').ok, false, '跑过的源要用新状态（失败也要如实）')
	assert.equal(merged.find((s) => s.id === 'hn').count, 16, '没跑的源要沿用上一次')
	assert.equal(merged.length, 4, '不该重复（同 id 只保留新的那条）')
})

// ---------- 集成：真实 service ----------

function seededItem(url, title, extra = {}) {
	return {
		id: 'x-' + url,
		title,
		url,
		kind: 'web',
		platform: 'hackernews',
		sourceId: 'hn',
		sourceName: 'HN',
		topic: '技术',
		score: 10,
		reasons: [],
		read: false,
		liked: false,
		disliked: false,
		hidden: false,
		firstSeenAt: `${localDate()}T01:00:00.000Z`,
		...extra,
	}
}

test('集成：一次"什么都没抓到"的刷新不会清空当天（用户报的"刷新后条目变少"）', async (t) => {
	const dir = await mkdtemp(path.join(os.tmpdir(), 'dsh-daily-merge-'))
	t.after(() => rm(dir, { recursive: true, force: true }))

	const service = new DailyService(resolveConfig({ dataDir: dir }), SILENT)
	await service.init()
	const day = localDate()

	// 上午：抓到了 3 条（含两个来源）
	await service.store.writeDay({
		date: day,
		items: [
			seededItem('https://e.com/a', '上午的 A'),
			seededItem('https://e.com/b', '上午的 B', { sourceId: 'arxiv', sourceName: 'arXiv' }),
			seededItem('https://e.com/c', '上午的 C'),
		],
		sources: [
			{ id: 'hn', name: 'Hacker News', kind: 'web', ok: true, count: 2, error: null, durationMs: 100, at: `${day}T01:00:00.000Z` },
			{ id: 'arxiv', name: 'arXiv', kind: 'web', ok: true, count: 1, error: null, durationMs: 100, at: `${day}T01:00:00.000Z` },
		],
		lastRefresh: null,
	})

	// 下午：只跑 extra（本测试里没有自定义源 → 0 条）
	await service.refresh({ sourceIds: ['extra'], trigger: 'manual' })

	const after = await service.getDay(day)
	assert.equal(after.items.length, 3, '没抓到的条目必须还在（这正是修复的核心）')
	assert.deepEqual(
		after.items.map((i) => i.title).sort(),
		['上午的 A', '上午的 B', '上午的 C'],
	)

	// 源状态也不该被抹掉
	const ids = after.sources.map((s) => s.id).sort()
	assert.deepEqual(ids, ['arxiv', 'extra', 'hn'], '本轮没跑的源要沿用上一次的状态')
})

test('集成：重复抓到的条目保留 firstSeenAt 与已有 AI 摘要（且不再调用模型）', async (t) => {
	const dir = await mkdtemp(path.join(os.tmpdir(), 'dsh-daily-merge-ai-'))
	t.after(() => rm(dir, { recursive: true, force: true }))

	const calls = []
	const service = new DailyService(
		resolveConfig({
			dataDir: dir,
			aiSummaryEnabled: true,
			// 用一个不存在的自定义源，保证本轮"没有新条目"，只验证合并与摘要复用
		}),
		SILENT,
		{ spawn: async () => ({ ok: true }) },
	)
	await service.init()
	// 注入假 stream，统计调用次数
	service.setLlm(() => ({
		async *[Symbol.asyncIterator]() {
			calls.push(1)
			yield { type: 'text-delta', text: '新生成的摘要' }
			yield { type: 'finish', reason: { kind: 'stop' } }
		},
	}), () => null)

	const day = localDate()
	await service.store.writeDay({
		date: day,
		items: [
			seededItem('https://e.com/kept', '已有摘要的条目', {
				firstSeenAt: `${day}T00:05:00.000Z`,
				aiSummary: '上午生成过的摘要',
			}),
		],
		sources: [],
		lastRefresh: null,
	})

	const result = await service.refresh({ sourceIds: ['extra'], trigger: 'manual' })
	assert.equal(result.total, 1, '当天应仍有那一条')
	const after = await service.getDay(day)
	assert.equal(after.items[0].firstSeenAt, `${day}T00:05:00.000Z`, 'firstSeenAt 不能被刷新改掉')
	assert.equal(after.items[0].aiSummary, '上午生成过的摘要', '已有摘要应被复用')
	assert.equal(calls.length, 0, '已有 AI 摘要的条目不该重新调用模型（那是白花钱）')
})
