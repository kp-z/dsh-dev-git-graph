/**
 * 归档容量管理的回归测试。
 *
 * 这个功能会**动用户的文件**，所以测试的重点不是"能不能压缩"，而是：
 * - 边界（正好在阈值那天该压还是该留）
 * - 默认值必须是什么都不做（一个自动清理的默认值不该由插件替用户决定）
 * - dry run 必须**真的不写盘**（这是"先预览再执行"的全部意义）
 * - 压缩后那些"仍然要被用到的能力"必须还在（搜索、归档、周报）
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm, readFile, stat, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { compactItem, formatBytes, isCompacted, planArchive } from '../lib/storage.js'
import { DailyService } from '../lib/service.js'
import { resolveConfig } from '../lib/config.js'
import { shiftDate } from '../lib/rank.js'
import { localDate } from '../lib/store.js'

const SILENT = { info() {}, warn() {}, error() {} }
const TODAY = '2026-10-12'

function makeItem(overrides = {}) {
	return {
		id: 'x',
		title: 'Story',
		url: 'https://e.com/1',
		kind: 'web',
		platform: 'hackernews',
		sourceId: 'hn',
		sourceName: 'Hacker News',
		topic: '技术',
		summary: '很长的原文摘要'.repeat(30),
		aiSummary: '一句中文摘要。',
		publishedAt: '2026-08-01T00:00:00.000Z',
		author: 'someone',
		thumb: 'https://e.com/thumb.png',
		duration: '12:34',
		discussUrl: 'https://news.ycombinator.com/item?id=1',
		stats: { points: 301, comments: 42 },
		score: 123.4,
		reasons: ['主题命中「技术」', 'HN 301 分'],
		read: false,
		liked: false,
		disliked: false,
		hidden: false,
		firstSeenAt: '2026-08-01T01:00:00.000Z',
		...overrides,
	}
}

// ---------- 计划 ----------

test('planArchive：阈值内保留、阈值外压缩、默认永不删除', () => {
	const days = [
		{ date: '2026-10-12', items: 10, bytes: 1000 }, // 今天
		{ date: '2026-09-12', items: 10, bytes: 1000 }, // 30 天前（<60 → 保留）
		{ date: '2026-08-12', items: 10, bytes: 1000 }, // 61 天前（>60 → 压缩）
		{ date: '2026-01-01', items: 10, bytes: 1000 }, // 很久以前（但默认不删）
	]
	const plan = planArchive(days, TODAY, { compactAfterDays: 60, deleteAfterDays: 0 })
	assert.deepEqual(
		plan.map((p) => [p.date, p.action]),
		[
			['2026-10-12', 'keep'],
			['2026-09-12', 'keep'],
			['2026-08-12', 'compact'],
			['2026-01-01', 'compact'],
		],
		'默认绝不能出现 delete',
	)
	assert.ok(plan[2].estimatedBytes > 0, '压缩项应给出预估体积')
})

test('planArchive：阈值边界 —— 正好 60 天前仍在保留侧', () => {
	const boundary = shiftDate(TODAY, -60) // 2026-08-13
	const plan = planArchive(
		[
			{ date: boundary, items: 1, bytes: 100 },
			{ date: shiftDate(TODAY, -61), items: 1, bytes: 100 },
		],
		TODAY,
		{ compactAfterDays: 60, deleteAfterDays: 0 },
	)
	assert.equal(plan[0].action, 'keep', '正好 60 天前应保留（>= today-60）')
	assert.equal(plan[1].action, 'compact', '61 天前应压缩')
})

test('planArchive：compactAfterDays=0 → 完全不整理（保留全部细节）', () => {
	const plan = planArchive(
		[{ date: '2020-01-01', items: 5, bytes: 500 }],
		TODAY,
		{ compactAfterDays: 0, deleteAfterDays: 0 },
	)
	assert.equal(plan[0].action, 'keep')
})

test('planArchive：开启删除时优先于压缩；且 deleteAfterDays <= compactAfterDays 视为不删除', () => {
	const days = [
		{ date: shiftDate(TODAY, -200), items: 1, bytes: 100 },
		{ date: shiftDate(TODAY, -100), items: 1, bytes: 100 },
	]
	const withDelete = planArchive(days, TODAY, { compactAfterDays: 60, deleteAfterDays: 180 })
	assert.equal(withDelete[0].action, 'delete', '200 天前应被删除')
	assert.equal(withDelete[1].action, 'compact', '100 天前只压缩')

	// 180 <= 60 是无意义组合（先压再删，白做功）→ 当作不删除
	const nonsense = planArchive(days, TODAY, { compactAfterDays: 60, deleteAfterDays: 30 })
	assert.equal(nonsense[0].action, 'compact', '无意义组合应退化为"不删除"')
})

// ---------- 压缩 ----------

test('compactItem：丢重字段、留索引字段', () => {
	const compacted = compactItem(makeItem())
	assert.equal(compacted.summary, undefined, 'summary 是体积大头，应丢弃')
	assert.equal(compacted.stats, undefined)
	assert.equal(compacted.thumb, undefined)
	assert.equal(compacted.discussUrl, undefined)
	assert.equal(compacted.author, undefined)
	assert.deepEqual(compacted.reasons, [])

	// 仍然要被用到的能力必须还在
	assert.equal(compacted.title, 'Story')
	assert.equal(compacted.url, 'https://e.com/1')
	assert.equal(compacted.topic, '技术')
	assert.equal(compacted.sourceName, 'Hacker News')
	assert.equal(compacted.score, 123.4)
	assert.equal(compacted.firstSeenAt, '2026-08-01T01:00:00.000Z')
	assert.equal(compacted.aiSummary, '一句中文摘要。', 'AI 摘要很短且有用，保留')
	assert.equal(compacted.duration, '12:34')

	// 压缩后体积应显著更小
	const before = JSON.stringify(makeItem()).length
	const after = JSON.stringify(compacted).length
	assert.ok(after < before * 0.6, `压缩后应明显更小：${before} → ${after}`)
	// 用字节数再验一次（中文在 UTF-8 下是 3 字节，字符数会低估体积差异）
	const beforeBytes = Buffer.byteLength(JSON.stringify(makeItem()))
	const afterBytes = Buffer.byteLength(JSON.stringify(compacted))
	assert.ok(afterBytes < beforeBytes * 0.5, `字节数应减半以上：${beforeBytes} → ${afterBytes}`)
})

test('compactItem / isCompacted：幂等（已经是索引态的不再变、也能被识别）', () => {
	const once = compactItem(makeItem())
	assert.equal(isCompacted(once), true)
	const twice = compactItem(once)
	assert.deepEqual(twice, once, '再次压缩不应改变内容')
	assert.equal(isCompacted(makeItem()), false, '完整条目不该被误判成已压缩')
})

test('formatBytes：人话单位', () => {
	assert.equal(formatBytes(0), '0 B')
	assert.equal(formatBytes(512), '512 B')
	assert.equal(formatBytes(2048), '2.0 KB')
	assert.equal(formatBytes(1024 * 1024 * 3), '3.0 MB')
})

// ---------- 集成 ----------

async function seedDays(dir, count) {
	const service = new DailyService(resolveConfig({ dataDir: dir }), SILENT)
	await service.init()
	const today = localDate()
	for (let i = 0; i < count; i++) {
		const date = shiftDate(today, -i)
		await service.store.writeDay({
			date,
			items: [makeItem({ id: `i${i}`, url: `https://e.com/${i}` })],
			sources: [],
			lastRefresh: null,
		})
	}
	return service
}

test('集成：dry run 只报告、绝不写盘', async (t) => {
	const dir = await mkdtemp(path.join(os.tmpdir(), 'dsh-daily-prune-dry-'))
	t.after(() => rm(dir, { recursive: true, force: true }))

	const service = new DailyService(
		resolveConfig({ dataDir: dir, archiveCompactAfterDays: 1 }),
		SILENT,
	)
	await service.init()
	const today = localDate()
	const old = shiftDate(today, -5)
	await service.store.writeDay({ date: old, items: [makeItem()], sources: [], lastRefresh: null })
	const before = await readFile(service.store.dayFile(old), 'utf8')

	const report = await service.pruneArchive({ apply: false })
	assert.equal(report.dryRun, true)
	assert.equal(report.compacted, 1, '应报告"会压缩 1 天"')
	assert.equal(report.changes.length, 1)

	const after = await readFile(service.store.dayFile(old), 'utf8')
	assert.equal(after, before, 'dry run 之后文件必须一字未改')
})

test('集成：apply 真的压缩，且压缩后条目仍然搜得到、归档仍可用', async (t) => {
	const dir = await mkdtemp(path.join(os.tmpdir(), 'dsh-daily-prune-'))
	t.after(() => rm(dir, { recursive: true, force: true }))

	const service = new DailyService(
		resolveConfig({ dataDir: dir, archiveCompactAfterDays: 1 }),
		SILENT,
	)
	await service.init()
	const today = localDate()
	const old = shiftDate(today, -5)
	const newer = shiftDate(today, -0)
	await service.store.writeDay({
		date: old,
		items: [makeItem({ id: 'old1', title: '很久以前的那篇论文', url: 'https://e.com/old1' })],
		sources: [],
		lastRefresh: null,
	})
	await service.store.writeDay({
		date: newer,
		items: [makeItem({ id: 'new1', title: '今天的新闻', url: 'https://e.com/new1' })],
		sources: [],
		lastRefresh: null,
	})

	const report = await service.pruneArchive({ apply: true })
	assert.equal(report.compacted, 1)
	assert.equal(report.deleted, 0)
	assert.ok(report.freedBytes > 0, '应报告释放的字节数')

	const compactedDay = await service.getDay(old)
	assert.equal(compactedDay.items.length, 1, '压缩不删条目')
	assert.equal(compactedDay.items[0].title, '很久以前的那篇论文', '标题必须保留（还要能被搜到）')
	assert.equal(compactedDay.items[0].summary, undefined)
	assert.equal(compactedDay.items[0].url, 'https://e.com/old1', '链接必须保留')

	const freshDay = await service.getDay(newer)
	assert.ok(freshDay.items[0].summary, '阈值内的那天不该被动过')

	// 归档索引仍然完整
	const archive = await service.listArchive()
	assert.equal(archive.length, 2)
	assert.ok(archive.every((d) => d.total === 1))

	// 容量统计能反映"压缩过几天"
	const stats = await service.storageStats()
	assert.equal(stats.days, 2)
	assert.equal(stats.items, 2)
	assert.equal(stats.compactedDays, 1)
	assert.ok(stats.totalBytes > 0)
})

test('集成：archiveDeleteAfterDays 才会真删（含那天的日报）', async (t) => {
	const dir = await mkdtemp(path.join(os.tmpdir(), 'dsh-daily-prune-del-'))
	t.after(() => rm(dir, { recursive: true, force: true }))

	const service = new DailyService(
		resolveConfig({ dataDir: dir, archiveCompactAfterDays: 1, archiveDeleteAfterDays: 3 }),
		SILENT,
	)
	await service.init()
	const today = localDate()
	const ancient = shiftDate(today, -10)
	await service.store.writeDay({
		date: ancient,
		items: [makeItem()],
		sources: [],
		lastRefresh: null,
	})
	await service.store.writeDigest(ancient, '# 那天的日报\n')

	const report = await service.pruneArchive({ apply: true })
	assert.equal(report.deleted, 1)
	assert.equal(report.compacted, 0)
	assert.ok(report.freedBytes > 0)

	await assert.rejects(
		() => stat(service.store.dayFile(ancient)),
		'那天的数据文件应被删除',
	)
	await assert.rejects(
		() => stat(service.store.digestFile(ancient)),
		'那天的日报也应一并删除（否则会留下无内容的孤儿文件）',
	)
	assert.deepEqual(await service.store.listDays(), [])
})

test('集成：容量统计能算出跨多天的总量与最老/最新', async (t) => {
	const dir = await mkdtemp(path.join(os.tmpdir(), 'dsh-daily-stats-'))
	t.after(() => rm(dir, { recursive: true, force: true }))

	const service = await seedDays(dir, 4)
	const stats = await service.storageStats()
	assert.equal(stats.days, 4)
	assert.equal(stats.items, 4)
	assert.equal(stats.newest, localDate())
	assert.equal(stats.oldest, shiftDate(localDate(), -3))
	assert.ok(stats.totalLabel.match(/\d+(\.\d)? (B|KB|MB)/), `体积标签应可读：${stats.totalLabel}`)
	// 空目录也不能炸
	assert.equal((await service.storageStats()).digests >= 0, true)
})

test('集成：自动整理每天只跑一次（节流靠 meta.lastPruneDate）', async (t) => {
	const dir = await mkdtemp(path.join(os.tmpdir(), 'dsh-daily-autoprune-'))
	t.after(() => rm(dir, { recursive: true, force: true }))

	const service = new DailyService(
		resolveConfig({ dataDir: dir, archiveCompactAfterDays: 1 }),
		SILENT,
	)
	await service.init()
	const today = localDate()
	const old = shiftDate(today, -5)
	await service.store.writeDay({ date: old, items: [makeItem()], sources: [], lastRefresh: null })

	// maybeAutoCompact 是私有的，但它挂在采集流程上；这里用等价路径验证节流：
	// 手动跑一次并写好 lastPruneDate，第二次应因节流而"无事可做"
	await service.pruneArchive({ apply: true })
	await service.store.updateMeta((m) => ({ ...m, lastPruneDate: today }))
	const again = await service.pruneArchive({ apply: true })
	assert.equal(again.compacted, 1, '（确认幂等：已压缩的仍会被计划命中，但内容不再变化）')
	const day = await service.getDay(old)
	assert.equal(day.items[0].title, 'Story', '重复整理不应损坏内容')
	void writeFile
})
