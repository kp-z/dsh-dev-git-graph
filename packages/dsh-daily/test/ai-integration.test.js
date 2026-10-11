/**
 * AI 摘要的**集成**测试：走真实 DailyService + 真实落盘。
 *
 * 纯函数测试证明"每条失败路径都能被正确识别"，但证明不了**接线**：
 * 配置有没有传进去、缓存有没有读、摘要有没有真的写回条目与磁盘。
 * 这里用假 stream 跑真实 service，所以既能验接线、又不花真实 token。
 *
 * 用的是 `regenerateAiSummaries()`（对已抓到的条目补摘要）而不是 `refresh()`，
 * 因为后者需要联网 —— 这也正是这个方法存在的意义之一。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm, readFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { DailyService } from '../lib/service.js'
import { resolveConfig } from '../lib/config.js'
import { localDate } from '../lib/store.js'

const SILENT = { info() {}, warn() {}, error() {} }

function makeItem(n, overrides = {}) {
	return {
		id: `item-${n}`,
		title: `Story number ${n}`,
		url: `https://e.com/${n}`,
		kind: 'web',
		platform: 'hackernews',
		sourceId: 'hn',
		sourceName: 'Hacker News',
		summary: `原始摘要 ${n}`,
		topic: '技术',
		score: 100 - n,
		reasons: [],
		read: false,
		liked: false,
		disliked: false,
		hidden: false,
		firstSeenAt: new Date().toISOString(),
		...overrides,
	}
}

/** 记账用的假 stream：统计调用次数，并返回可预测的文本。 */
function countingStream(state) {
	return function stream() {
		state.calls++
		const n = state.calls
		return {
			async *[Symbol.asyncIterator]() {
				yield { type: 'text-delta', text: `第 ${n} 条的` }
				yield { type: 'text-delta', text: '中文摘要。' }
				yield { type: 'finish', reason: { kind: 'stop' } }
			},
		}
	}
}

test('集成：开启后给当天条目补摘要，写回内存与磁盘，并写入缓存', async (t) => {
	const dir = await mkdtemp(path.join(os.tmpdir(), 'dsh-daily-ai-'))
	t.after(() => rm(dir, { recursive: true, force: true }))

	const service = new DailyService(
		resolveConfig({
			dataDir: dir,
			aiSummaryEnabled: true,
			aiSummaryProvider: 'fake',
			aiSummaryModel: 'fake-model',
			aiSummaryMaxItems: 5,
			aiSummaryConcurrency: 2,
		}),
		SILENT,
	)
	await service.init()

	const today = localDate()
	await service.store.writeDay({
		date: today,
		items: [makeItem(1), makeItem(2), makeItem(3)],
		sources: [],
		lastRefresh: null,
	})

	const state = { calls: 0 }
	service.setLlm(countingStream(state), () => null)

	const stats = await service.regenerateAiSummaries(today)
	assert.ok(stats, '应返回运行统计')
	assert.equal(stats.generated, 3)
	assert.equal(stats.failed, 0)
	assert.equal(state.calls, 3, '三条各调用一次')

	// 内存态与磁盘都要有
	const day = await service.getDay(today)
	assert.ok(day.items.every((item) => typeof item.aiSummary === 'string' && item.aiSummary.length > 0))
	const onDisk = JSON.parse(await readFile(path.join(dir, 'days', `${today}.json`), 'utf8'))
	assert.ok(
		onDisk.items.every((item) => typeof item.aiSummary === 'string'),
		'aiSummary 必须落盘（重启后不该丢）',
	)

	// 缓存文件
	const cache = JSON.parse(await readFile(path.join(dir, 'ai-cache.json'), 'utf8'))
	assert.equal(Object.keys(cache.entries).length, 3)

	// 日报里应该带上 AI 摘要
	const digest = await service.store.readDigest(today)
	assert.ok(digest.includes('中文摘要'), '日报正文应包含 AI 摘要')
})

test('集成：第二次调用命中缓存，不再请求模型', async (t) => {
	const dir = await mkdtemp(path.join(os.tmpdir(), 'dsh-daily-ai-cache-'))
	t.after(() => rm(dir, { recursive: true, force: true }))

	const service = new DailyService(
		resolveConfig({
			dataDir: dir,
			aiSummaryEnabled: true,
			aiSummaryProvider: 'fake',
			aiSummaryModel: 'fake-model',
		}),
		SILENT,
	)
	await service.init()
	const today = localDate()
	await service.store.writeDay({
		date: today,
		items: [makeItem(1), makeItem(2)],
		sources: [],
		lastRefresh: null,
	})

	const state = { calls: 0 }
	service.setLlm(countingStream(state), () => null)
	await service.regenerateAiSummaries(today)
	assert.equal(state.calls, 2)

	const second = await service.regenerateAiSummaries(today)
	assert.equal(state.calls, 2, '第二次不该再调模型')
	assert.equal(second.fromCache, 2)
	assert.equal(second.generated, 0)
})

test('集成：功能关闭时不调用模型（默认关闭，必须有守）', async (t) => {
	const dir = await mkdtemp(path.join(os.tmpdir(), 'dsh-daily-ai-off-'))
	t.after(() => rm(dir, { recursive: true, force: true }))

	const service = new DailyService(resolveConfig({ dataDir: dir }), SILENT)
	await service.init()
	const today = localDate()
	await service.store.writeDay({
		date: today,
		items: [makeItem(1)],
		sources: [],
		lastRefresh: null,
	})

	const state = { calls: 0 }
	service.setLlm(countingStream(state), () => null)
	const stats = await service.regenerateAiSummaries(today)
	assert.equal(state.calls, 0, '默认关闭时绝不能调模型（会产生真实费用）')
	assert.equal(stats, null)

	const day = await service.getDay(today)
	assert.equal(day.items[0].aiSummary, undefined)
})

test('集成：没有注入 llm（宿主不提供）时降级，不抛异常', async (t) => {
	const dir = await mkdtemp(path.join(os.tmpdir(), 'dsh-daily-ai-nollm-'))
	t.after(() => rm(dir, { recursive: true, force: true }))

	const service = new DailyService(
		resolveConfig({ dataDir: dir, aiSummaryEnabled: true }),
		SILENT,
	)
	await service.init()
	const today = localDate()
	await service.store.writeDay({
		date: today,
		items: [makeItem(1)],
		sources: [],
		lastRefresh: null,
	})

	const stats = await service.regenerateAiSummaries(today)
	assert.ok(stats, '应返回统计而不是抛错')
	assert.equal(stats.generated, 0)
	assert.ok(stats.reasons.some((r) => r.includes('llm')), `原因应说明缺 llm，实际 ${JSON.stringify(stats.reasons)}`)
})

test('集成：只填 provider 或只填 model = 未配置（不猜、不静默跟随默认）', async (t) => {
	const dir = await mkdtemp(path.join(os.tmpdir(), 'dsh-daily-ai-half-'))
	t.after(() => rm(dir, { recursive: true, force: true }))

	const service = new DailyService(
		resolveConfig({
			dataDir: dir,
			aiSummaryEnabled: true,
			aiSummaryProvider: 'fake',
			aiSummaryModel: '',
		}),
		SILENT,
	)
	await service.init()
	const today = localDate()
	await service.store.writeDay({
		date: today,
		items: [makeItem(1)],
		sources: [],
		lastRefresh: null,
	})

	const state = { calls: 0 }
	// 即使宿主有默认模型，也不该在"只填了一半"时自作主张用默认
	service.setLlm(countingStream(state), () => ({ provider: 'default', model: 'default-model' }))
	const stats = await service.regenerateAiSummaries(today)
	assert.equal(state.calls, 0)
	assert.ok(stats.reasons.some((r) => r.includes('成对')), `应提示成对配置，实际 ${JSON.stringify(stats.reasons)}`)
})
