/**
 * 跨天去重的**集成**测试：走真实的 DailyService + 真实落盘的 days/*.json。
 *
 * 为什么不能只测纯函数：`buildRecentlySeen` 只保证"给定历史能算出正确的表"，
 * 但真正的失效点在**接线**上 —— service 有没有读历史、读的是哪几天、
 * 有没有真的把表传进 rankItems。这三件事任一漏了，纯函数测试全绿而功能是死的。
 *
 * 不联网：这里不触发 refresh，而是用 `tune()`（它会走 reRank → loadRecentlySeen → rankItems），
 * 所以整条"历史 → 窗口 → 重罚"的链路都会被真实执行一遍。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { DailyService } from '../lib/service.js'
import { resolveConfig } from '../lib/config.js'
import { localDate } from '../lib/store.js'

const SILENT = { info() {}, warn() {}, error() {} }

function shiftDate(date, days) {
	const d = new Date(`${date}T12:00:00`)
	d.setDate(d.getDate() + days)
	const y = d.getFullYear()
	const m = `${d.getMonth() + 1}`.padStart(2, '0')
	const day = `${d.getDate()}`.padStart(2, '0')
	return `${y}-${m}-${day}`
}

function makeItem(url, title, overrides = {}) {
	return {
		id: url.slice(-8),
		title,
		url,
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
		firstSeenAt: new Date().toISOString(),
		...overrides,
	}
}

test('集成：service 会读历史几天，并把窗口内推过的条目重罚（带"已推过"理由）', async (t) => {
	const dir = await mkdtemp(path.join(os.tmpdir(), 'dsh-daily-dedupe-'))
	t.after(() => rm(dir, { recursive: true, force: true }))

	const service = new DailyService(
		resolveConfig({ dataDir: dir, dedupeWindowDays: 3 }),
		SILENT,
	)
	await service.init()

	const today = localDate()
	const yesterday = shiftDate(today, -1)
	const fourDaysAgo = shiftDate(today, -4)

	// 昨天推过的（在窗口内）与四天前推过的（在窗口外）
	await service.store.writeDay({
		date: yesterday,
		items: [makeItem('https://e.com/old', 'Old news')],
		sources: [],
		lastRefresh: null,
	})
	await service.store.writeDay({
		date: fourDaysAgo,
		items: [makeItem('https://e.com/ancient', 'Ancient news')],
		sources: [],
		lastRefresh: null,
	})
	// 今天：三条 —— 窗口内重复的、窗口外重复的、全新的
	await service.store.writeDay({
		date: today,
		items: [
			makeItem('https://e.com/old', 'Old news'),
			makeItem('https://e.com/ancient', 'Ancient news'),
			makeItem('https://e.com/fresh', 'Fresh news'),
		],
		sources: [],
		lastRefresh: null,
	})

	// tune 会触发 reRank → loadRecentlySeen → rankItems，整条链路真实执行
	await service.tune('多推 AI')

	const day = await service.getDay(today)
	const byUrl = Object.fromEntries(day.items.map((item) => [item.url, item]))

	assert.ok(byUrl['https://e.com/old'], '重复条目应仍在索引里')
	assert.ok(
		byUrl['https://e.com/old'].reasons.some((r) => r.includes('已推过')),
		`昨天的条目应带"已推过"理由，实际 ${JSON.stringify(byUrl['https://e.com/old'].reasons)}`,
	)
	assert.ok(
		byUrl['https://e.com/old'].reasons.some((r) => r.includes(yesterday)),
		`理由里应写明是哪一天，实际 ${JSON.stringify(byUrl['https://e.com/old'].reasons)}`,
	)
	// 窗口外的不该被罚
	assert.equal(
		byUrl['https://e.com/ancient'].reasons.some((r) => r.includes('已推过')),
		false,
		'四天前推过的不属于 3 天窗口，不该被罚',
	)
	assert.equal(
		byUrl['https://e.com/fresh'].reasons.some((r) => r.includes('已推过')),
		false,
		'全新的条目不该被罚',
	)
	// 分数关系：被罚的应当明显低于另外两条
	assert.ok(
		byUrl['https://e.com/old'].score < byUrl['https://e.com/fresh'].score,
		`被罚条目应低于全新条目：${byUrl['https://e.com/old'].score} vs ${byUrl['https://e.com/fresh'].score}`,
	)
	assert.ok(
		byUrl['https://e.com/old'].score < byUrl['https://e.com/ancient'].score,
		'窗口内的应低于窗口外的同分条目',
	)
})

test('集成：dedupeWindowDays=0 时完全不读历史、不惩罚', async (t) => {
	const dir = await mkdtemp(path.join(os.tmpdir(), 'dsh-daily-nodedupe-'))
	t.after(() => rm(dir, { recursive: true, force: true }))

	const service = new DailyService(
		resolveConfig({ dataDir: dir, dedupeWindowDays: 0 }),
		SILENT,
	)
	await service.init()

	const today = localDate()
	await service.store.writeDay({
		date: shiftDate(today, -1),
		items: [makeItem('https://e.com/old', 'Old news')],
		sources: [],
		lastRefresh: null,
	})
	await service.store.writeDay({
		date: today,
		items: [makeItem('https://e.com/old', 'Old news')],
		sources: [],
		lastRefresh: null,
	})

	await service.tune('多推 AI')
	const day = await service.getDay(today)
	assert.equal(
		day.items[0].reasons.some((r) => r.includes('已推过')),
		false,
		'关闭去重后不该出现"已推过"',
	)
})
