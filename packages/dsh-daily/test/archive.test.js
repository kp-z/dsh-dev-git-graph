/**
 * 归档与周报的回归测试。
 *
 * 两个容易错又不容易发现的地方：
 * 1. **日期边界**：周报窗口是"截至 endDate 的 N 天"，含头含尾；算错就会漏掉昨天或把今天算两遍。
 * 2. **某天没数据时的行为**：不该产出空行、也不该把整周报作废（用户只是某天没开机）。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm, readFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import {
	renderWeeklyReview,
	summarizeDay,
	topItems,
	topicDistribution,
	weekFileName,
} from '../lib/archive.js'
import { DailyService } from '../lib/service.js'
import { resolveConfig } from '../lib/config.js'
import { shiftDate } from '../lib/rank.js'

const SILENT = { info() {}, warn() {}, error() {} }
const NOW = new Date('2026-10-12T09:00:00.000Z')

function makeItem(overrides = {}) {
	return {
		id: overrides.id ?? 'x',
		title: 'T',
		url: 'https://e.com/1',
		kind: 'web',
		platform: 'hackernews',
		sourceId: 'hn',
		sourceName: 'Hacker News',
		topic: '技术',
		score: 100,
		reasons: [],
		read: false,
		liked: false,
		disliked: false,
		hidden: false,
		firstSeenAt: '2026-10-12T01:00:00.000Z',
		...overrides,
	}
}

// ---------- 单日摘要 ----------

test('summarizeDay：条数 / 未读 / 主题分布 / 是否有日报', () => {
	const items = [
		makeItem({ topic: 'AI', read: true }),
		makeItem({ topic: 'AI' }),
		makeItem({ topic: '技术' }),
	]
	const day = summarizeDay('2026-10-12', items, true)
	assert.equal(day.total, 3)
	assert.equal(day.unread, 2)
	assert.deepEqual(day.topics, { AI: 2, 技术: 1 })
	assert.equal(day.digest, true)
	assert.equal(summarizeDay('2026-10-11', [], false).topics !== undefined, true)
})

test('topItems / topicDistribution：排序与占比的边界', () => {
	const items = [
		makeItem({ score: 10, topic: 'A' }),
		makeItem({ score: 30, topic: 'B' }),
		makeItem({ score: 20, topic: 'A' }),
	]
	assert.deepEqual(topItems(items, 2).map((i) => i.score), [30, 20])
	assert.deepEqual(topItems(items, 0), [])
	assert.deepEqual(topicDistribution(items), [
		['A', 2],
		['B', 1],
	])
	assert.deepEqual(topicDistribution([]), [])
})

// ---------- 周报渲染 ----------

test('renderWeeklyReview：四个小节都在，且带上条数与未读', () => {
	const items = [
		makeItem({ title: 'AI 大新闻', url: 'https://e.com/ai', topic: 'AI', score: 200, aiSummary: '一句 AI 摘要。' }),
		makeItem({ title: '技术新闻', url: 'https://e.com/tech', topic: '技术', score: 100, reasons: ['主题命中「技术」'] }),
	]
	const days = [
		summarizeDay('2026-10-11', [items[0]], true),
		summarizeDay('2026-10-12', [items[1]], false),
	]
	const md = renderWeeklyReview({
		days,
		items,
		sources: [
			{ id: 'hn', name: 'Hacker News', kind: 'web', ok: true, count: 20, error: null, durationMs: 100, at: '2026-10-12T09:00:00.000Z' },
			{ id: 'youtube', name: 'YouTube', kind: 'video', ok: false, count: 0, error: '全部镜像不可用', durationMs: 100, at: '2026-10-12T09:00:00.000Z' },
		],
		start: '2026-10-06',
		end: '2026-10-12',
		now: NOW,
	})

	assert.ok(md.startsWith('# 日报周报 · 2026-10-06 ~ 2026-10-12'))
	assert.ok(md.includes('2 条索引'), '应给出总条数')
	assert.ok(md.includes('## 本周最值得看的'))
	// 分数高的排前面
	assert.ok(md.indexOf('AI 大新闻') < md.indexOf('技术新闻'))
	assert.ok(md.includes('[AI 大新闻](https://e.com/ai)'))
	assert.ok(md.includes('一句 AI 摘要。'), '有 AI 摘要时用它')
	assert.ok(md.includes('## 按主题'))
	assert.ok(md.includes('**AI**：1 条（50%）'))
	assert.ok(md.includes('## 每天'))
	assert.ok(md.includes('| 2026-10-11 |'), '每天小节应有每一天')
	assert.ok(md.includes('## 采集源'))
	assert.ok(md.includes('❌ YouTube · 全部镜像不可用'), '失败源必须显式写出，不能悄悄吞掉')
})

test('renderWeeklyReview：空窗口不炸，也不产出误导性内容', () => {
	const md = renderWeeklyReview({ days: [], items: [], sources: [], start: '2026-10-06', end: '2026-10-12', now: NOW })
	assert.ok(md.includes('0 条索引'))
	assert.ok(!md.includes('## 每天'), '没有数据时不该出现空的每天表格')
	assert.ok(!md.includes('## 按主题'))
})

test('renderWeeklyReview：topLimit 生效，且不超出实际条数', () => {
	const items = Array.from({ length: 3 }, (_, i) => makeItem({ title: `T${i}`, score: 10 - i, id: `i${i}` }))
	const md = renderWeeklyReview({ days: [], items, sources: [], start: 'a', end: 'b', topLimit: 10, now: NOW })
	assert.ok(md.includes('本周最值得看的 3 条'), '标题里应是实际条数而不是 topLimit')
})

test('weekFileName：范围写进文件名，一眼看出覆盖哪一周', () => {
	assert.equal(weekFileName('2026-10-06', '2026-10-12'), 'week-2026-10-06_2026-10-12.md')
})

// ---------- 集成 ----------

test('集成：listArchive 读真实落盘的每一天（新到旧）', async (t) => {
	const dir = await mkdtemp(path.join(os.tmpdir(), 'dsh-daily-archive-'))
	t.after(() => rm(dir, { recursive: true, force: true }))

	const service = new DailyService(resolveConfig({ dataDir: dir }), SILENT)
	await service.init()

	const today = '2026-10-12'
	const writes = [
		{ date: '2026-10-10', items: [makeItem({ topic: 'AI' })] },
		{ date: '2026-10-11', items: [makeItem({ topic: 'AI' }), makeItem({ topic: '技术' })] },
		{ date: today, items: [makeItem({ read: true })] },
	]
	for (const day of writes) {
		await service.store.writeDay({ date: day.date, items: day.items, sources: [], lastRefresh: null })
	}
	await service.store.writeDigest('2026-10-11', '# 有日报\n')

	const archive = await service.listArchive()
	assert.deepEqual(
		archive.map((d) => d.date),
		['2026-10-12', '2026-10-11', '2026-10-10'],
		'应从新到旧',
	)
	assert.equal(archive[1].total, 2)
	assert.equal(archive[1].digest, true, '10-11 有日报')
	assert.equal(archive[0].digest, false)
	assert.equal(archive[0].unread, 0, '那条已读')
})

test('集成：buildWeeklyReview 覆盖正确的日期窗口、含头含尾、并落盘', async (t) => {
	const dir = await mkdtemp(path.join(os.tmpdir(), 'dsh-daily-weekly-'))
	t.after(() => rm(dir, { recursive: true, force: true }))

	const service = new DailyService(resolveConfig({ dataDir: dir }), SILENT)
	await service.init()

	const end = '2026-10-12'
	const inWindow = ['2026-10-06', '2026-10-09', '2026-10-12'] // 含头（end - 6）与含尾（end）
	const outOfWindow = ['2026-10-05', '2026-10-13']
	for (const date of [...inWindow, ...outOfWindow]) {
		await service.store.writeDay({
			date,
			items: [makeItem({ id: date, title: `Story ${date}`, url: `https://e.com/${date}` })],
			sources: [],
			lastRefresh: null,
		})
	}

	const review = await service.buildWeeklyReview(end, 7)
	assert.equal(review.start, '2026-10-06', '窗口起点应是 end-6')
	assert.equal(review.end, end)
	assert.equal(review.days, 3, '只有窗口内那 3 天有数据')
	assert.equal(review.items, 3)
	assert.ok(!review.markdown.includes('2026-10-05'), '窗口外（更早）不该出现')
	assert.ok(!review.markdown.includes('2026-10-13'), '窗口外（更晚）不该出现')
	assert.ok(review.markdown.includes('2026-10-06'))
	assert.ok(review.markdown.includes(end))

	// 落盘
	const file = path.join(dir, 'digest', weekFileName('2026-10-06', end))
	const saved = await readFile(file, 'utf8')
	assert.equal(saved, review.markdown)
	assert.ok(shiftDate(end, -6) === review.start || true) // 断言用库自身的 shiftDate 交叉验证
	assert.equal(shiftDate(end, -6), review.start)
})

test('集成：窗口内一天数据都没有时，周报是空但文件仍可生成', async (t) => {
	const dir = await mkdtemp(path.join(os.tmpdir(), 'dsh-daily-weekly-empty-'))
	t.after(() => rm(dir, { recursive: true, force: true }))

	const service = new DailyService(resolveConfig({ dataDir: dir }), SILENT)
	await service.init()
	const review = await service.buildWeeklyReview('2026-10-12', 7)
	assert.equal(review.items, 0)
	assert.equal(review.days, 0)
	assert.ok(review.markdown.includes('0 条索引'))
	const saved = await readFile(path.join(dir, 'digest', review.name), 'utf8')
	assert.ok(saved.includes('日报周报'))
})
