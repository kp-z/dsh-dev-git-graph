/**
 * AI 摘要的回归测试。
 *
 * 这个功能的失败面比它看起来大得多，所以每一条失败路径都用**假 stream**钉住：
 * 超时 / 空输出 / 非 stop 终止 / 流中途抛错 / 单条炸掉 / 缓存过期。
 * 不需要真调模型 —— 真调模型反而测不到这些分支。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
	buildSummaryPrompt,
	cleanSummary,
	emptyCache,
	mergeCache,
	readCache,
	summarizeItems,
	summarizeOne,
} from '../lib/ai.js'

const ITEM = {
	id: 'abc123',
	title: 'DeepSeek releases a new reasoning model',
	sourceName: 'Hacker News',
	summary: '原文摘要里的一些细节。',
	topic: 'AI',
	platform: 'hackernews',
}

/** 造一个假 stream：把给定事件依次吐出来。 */
function fakeStream(chunks, options = {}) {
	return function stream() {
		return {
			async *[Symbol.asyncIterator]() {
				for (const chunk of chunks) yield chunk
				if (options.throwAfter) throw new Error(options.throwAfter)
			},
		}
	}
}

function opts(overrides = {}) {
	return {
		provider: 'fake',
		model: 'fake-model',
		maxItems: 10,
		concurrency: 2,
		timeoutMs: 5000,
		maxTokens: 1024,
		stream: fakeStream([
			{ type: 'text-delta', text: '这是一句' },
			{ type: 'text-delta', text: '中文摘要。' },
			{ type: 'finish', reason: { kind: 'stop' } },
		]),
		...overrides,
	}
}

// ---------- prompt ----------

test('buildSummaryPrompt：带上标题/来源/主题/原文摘要，并明确禁止 Markdown 与前缀', () => {
	const { system, user } = buildSummaryPrompt(ITEM)
	assert.ok(user.includes(ITEM.title))
	assert.ok(user.includes(ITEM.sourceName))
	assert.ok(user.includes('AI'))
	assert.ok(user.includes('原文摘要'))
	assert.ok(system.includes('一句中文'))
	assert.ok(system.includes('Markdown'))
	assert.ok(system.includes('不'), 'system 里要有明确禁止项')
})

test('buildSummaryPrompt：原文摘要过长时会被截断（避免把整篇文章塞进 prompt）', () => {
	const long = { ...ITEM, summary: 'x'.repeat(5000) }
	const { user } = buildSummaryPrompt(long)
	assert.ok(user.length < 1200, `prompt 不该把长摘要原样带入，实际 ${user.length} 字`)
})

test('buildSummaryPrompt：没有 summary 也能构造（只用标题）', () => {
	const { user } = buildSummaryPrompt({ ...ITEM, summary: undefined })
	assert.ok(user.includes(ITEM.title))
	assert.ok(!user.includes('原始摘要'))
})

// ---------- 清洗 ----------

test('cleanSummary：剥掉引号、前缀、Markdown、换行', () => {
	assert.equal(cleanSummary('  “这是一句摘要。”  '), '这是一句摘要。')
	assert.equal(cleanSummary('摘要：这是一句摘要'), '这是一句摘要')
	assert.equal(cleanSummary('**这是一句摘要**'), '这是一句摘要')
	assert.equal(cleanSummary('一句话：\n这 是\n一句摘要'), '这 是 一句摘要'.replace(/\s+/g, ' '))
	assert.equal(cleanSummary('`code` 包围的摘要'), 'code 包围的摘要')
})

test('cleanSummary：拒绝空、过短、以及"抱歉/无法"这类废输出', () => {
	assert.equal(cleanSummary(''), null)
	assert.equal(cleanSummary('   '), null)
	assert.equal(cleanSummary('好'), null)
	assert.equal(cleanSummary('抱歉，我无法总结这条内容。'), null)
	assert.equal(cleanSummary('Sorry, I cannot summarize this.'), null)
})

test('cleanSummary：超长时按句子边界截断并加省略号', () => {
	const text = '第一句话讲清楚这件事。第二句话补充了一些背景信息。第三句话又说了别的。'
	const out = cleanSummary(text, 20)
	assert.ok(out.length <= 21, `实际长度 ${out.length}`)
	assert.ok(out.endsWith('…'))
	assert.ok(!out.includes('第三句'), '不该超出上限')
})

// ---------- 单条生成 ----------

test('summarizeOne：正常路径返回清洗后的文本', async () => {
	const result = await summarizeOne(ITEM, opts())
	assert.ok(!('error' in result), `不该失败：${JSON.stringify(result)}`)
	assert.equal(result.text, '这是一句中文摘要。')
	assert.equal(result.model, 'fake-model')
})

test('summarizeOne：撞 max-tokens 且没有正文 → 报错里点明 maxTokens（可诊断）', async () => {
	const result = await summarizeOne(
		ITEM,
		opts({ maxTokens: 200, stream: fakeStream([{ type: 'reasoning-delta', text: '思考中…' }, { type: 'finish', reason: { kind: 'max-tokens' } }]) }),
	)
	assert.ok('error' in result)
	assert.ok(result.error.includes('max-tokens'), `错误信息应含终止原因，实际 ${result.error}`)
	assert.ok(result.error.includes('200'), `错误信息应含 maxTokens 数值，实际 ${result.error}`)
})

test('summarizeOne：撞 max-tokens 但已经写出正文 → 仍然算成功（推理模型常见）', async () => {
	const result = await summarizeOne(
		ITEM,
		opts({
			stream: fakeStream([
				{ type: 'reasoning-delta', text: '先想想…' },
				{ type: 'text-delta', text: '模型给出了摘要。' },
				{ type: 'finish', reason: { kind: 'max-tokens' } },
			]),
		}),
	)
	assert.ok(!('error' in result), '已拿到可用正文就不该判失败')
	assert.equal(result.text, '模型给出了摘要。')
})

test('summarizeOne：terminate=error 时把 failure 说明带出来', async () => {
	const result = await summarizeOne(
		ITEM,
		opts({
			stream: fakeStream([
				{ type: 'finish', reason: { kind: 'error', failure: { message: 'rate limited', code: 'RATE_LIMIT' } } },
			]),
		}),
	)
	assert.ok('error' in result)
	assert.ok(result.error.includes('rate limited'), `应带出 failure.message，实际 ${result.error}`)
})

test('summarizeOne：没有 finish 事件 → 明确报错，而不是静默成功', async () => {
	const result = await summarizeOne(ITEM, opts({ stream: fakeStream([{ type: 'text-delta', text: '' }]) }))
	assert.ok('error' in result)
	assert.ok(result.error.includes('finish'))
})

test('summarizeOne：流中途抛错但已攒到文本 → 当成功（尾部错误不影响前半段）', async () => {
	const result = await summarizeOne(
		ITEM,
		opts({
			stream: fakeStream([{ type: 'text-delta', text: '已经写好的摘要。' }], { throwAfter: 'connection reset' }),
		}),
	)
	assert.ok(!('error' in result), `应视作成功，实际 ${JSON.stringify(result)}`)
	assert.equal(result.text, '已经写好的摘要。')
})

test('summarizeOne：流抛错且没有文本 → 报错里带出原因', async () => {
	const result = await summarizeOne(ITEM, opts({ stream: fakeStream([], { throwAfter: 'ECONNRESET' }) }))
	assert.ok('error' in result)
	assert.ok(result.error.includes('ECONNRESET'))
})

// ---------- 批量 ----------

test('summarizeItems：单条失败不影响其它条（隔离）', async () => {
	const items = [
		{ ...ITEM, id: 'ok1', title: 'A' },
		{ ...ITEM, id: 'bad', title: 'B' },
		{ ...ITEM, id: 'ok2', title: 'C' },
	]
	const stream = (options) => {
		// 从 prompt 里判不出是哪条，就用调用序号：第 2 次调用失败
		const index = stream.calls++
		if (index === 1) {
			return {
				async *[Symbol.asyncIterator]() {
					yield { type: 'finish', reason: { kind: 'error', failure: { message: 'boom' } } }
				},
			}
		}
		return {
			async *[Symbol.asyncIterator]() {
				yield { type: 'text-delta', text: `摘要 ${index}` }
				yield { type: 'finish', reason: { kind: 'stop' } }
			},
		}
	}
	stream.calls = 0

	const result = await summarizeItems(items, opts({ stream, concurrency: 1 }))
	assert.equal(result.summaries.size, 2)
	assert.equal(result.failures.size, 1)
	assert.equal(result.failures.get('bad'), '模型调用终止：error · boom')
})

test('summarizeItems：maxItems 截断，多余的计入 skipped', async () => {
	const items = Array.from({ length: 10 }, (_, i) => ({ ...ITEM, id: `i${i}` }))
	const result = await summarizeItems(items, opts({ maxItems: 3, concurrency: 2 }))
	assert.equal(result.summaries.size, 3)
	assert.equal(result.skipped, 7)
})

test('summarizeItems：并发受限（同时最多 concurrency 个在飞）', async () => {
	let live = 0
	let peak = 0
	const stream = () => ({
		async *[Symbol.asyncIterator]() {
			live++
			peak = Math.max(peak, live)
			await new Promise((r) => setTimeout(r, 5))
			yield { type: 'text-delta', text: '摘要文本。' }
			yield { type: 'finish', reason: { kind: 'stop' } }
			live--
		},
	})
	const items = Array.from({ length: 8 }, (_, i) => ({ ...ITEM, id: `c${i}` }))
	await summarizeItems(items, opts({ stream, concurrency: 2 }))
	assert.ok(peak <= 2, `并发不该超过 2，实际峰值 ${peak}`)
})

test('summarizeItems：maxItems=0 时不调用模型', async () => {
	let called = 0
	const stream = () => {
		called++
		return { async *[Symbol.asyncIterator]() {} }
	}
	const result = await summarizeItems([ITEM], opts({ stream, maxItems: 0 }))
	assert.equal(called, 0)
	assert.equal(result.summaries.size, 0)
})

// ---------- 缓存 ----------

test('readCache：丢弃过期与非法的条目', () => {
	const now = new Date('2026-10-12T00:00:00.000Z')
	const raw = {
		version: 1,
		entries: {
			fresh: { text: '新的', model: 'm', at: '2026-10-11T00:00:00.000Z' },
			old: { text: '过期的', model: 'm', at: '2026-08-01T00:00:00.000Z' },
			broken: { text: '时间坏了', model: 'm', at: 'not-a-date' },
			empty: { text: '', model: 'm', at: '2026-10-11T00:00:00.000Z' },
		},
	}
	const cache = readCache(raw, now, 30, 100)
	assert.deepEqual(Object.keys(cache.entries), ['fresh'])
})

test('readCache：超出上限时保留最新的（按写入时间）', () => {
	const now = new Date('2026-10-12T00:00:00.000Z')
	const entries = {}
	for (let i = 0; i < 10; i++) {
		entries[`k${i}`] = {
			text: `t${i}`,
			model: 'm',
			at: new Date(now.getTime() - i * 3600_000).toISOString(),
		}
	}
	const cache = readCache({ version: 1, entries }, now, 30, 3)
	assert.equal(Object.keys(cache.entries).length, 3)
	assert.ok(cache.entries.k0 && cache.entries.k1 && cache.entries.k2, '应保留写入时间最新的 3 条')
})

test('readCache：脏输入（null / 数组 / 缺 entries）不炸，返回空缓存', () => {
	const now = new Date()
	assert.deepEqual(readCache(null, now, 30, 10), emptyCache())
	assert.deepEqual(readCache({ version: 1 }, now, 30, 10), emptyCache())
	assert.deepEqual(readCache({ entries: 'nonsense' }, now, 30, 10), emptyCache())
})

test('mergeCache：新写入的条目带当前时间，已有条目不丢', () => {
	const now = new Date('2026-10-12T00:00:00.000Z')
	const base = { version: 1, entries: { keep: { text: '留着', model: 'm', at: '2026-10-10T00:00:00.000Z' } } }
	const merged = mergeCache(base, new Map([['new', { text: '新增', model: 'm2' }]]), now)
	assert.equal(merged.entries.keep.text, '留着')
	assert.equal(merged.entries.new.text, '新增')
	assert.equal(merged.entries.new.at, now.toISOString())
})

test('摘要 token 预算：默认必须**留足推理空间**（实测 1024 会把预算烧在思考上）', async () => {
	const { resolveConfig } = await import('../lib/config.js')
	const cfg = resolveConfig({})
	// 实测证据：日志里出现过「模型没写出正文就用完了 maxTokens=1024（终止原因 max-tokens）」
	assert.ok(
		cfg.aiSummaryMaxTokens >= 2048,
		`默认预算太小会让带推理的模型写不出正文（实测 1024 失败过）：${cfg.aiSummaryMaxTokens}`,
	)
	// 但用户显式配置仍然优先（不越权改用户的值）
	const custom = resolveConfig({ aiSummaryMaxTokens: 800 })
	assert.equal(custom.aiSummaryMaxTokens, 800)
})
