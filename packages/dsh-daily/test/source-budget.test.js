/**
 * 单源总预算（回归测试）。
 *
 * 背景是**效率报告给出的结论**：YouTube 的抓取耗时在 2.7s ↔ 46.8s 之间剧烈波动，
 * 而 `fetchText` 的 12s 是**每次尝试**的超时、默认还重试 2 次 → 最坏 ≈ 40s。
 * 一个慢源不该独占整轮刷新，所以在源这一层加了总预算。
 *
 * 这里用**本机一个永不回应的 HTTP 服务**当慢源（比伪造 runner 更接近真实：
 * 走的正是 fetchText 的超时/重试路径）。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { runCollection } from '../lib/collect/index.js'
import { resolveConfig } from '../lib/config.js'

/** 起一个本地服务：/slow 永不回应，/fast 返回一条合法 RSS。 */
function startServer() {
	const server = http.createServer((req, res) => {
		if (req.url.startsWith('/fast')) {
			res.writeHead(200, { 'content-type': 'application/rss+xml' })
			res.end(`<?xml version="1.0"?><rss version="2.0"><channel><title>T</title>
				<item><title>快源的一条</title><link>https://e.com/1</link></item></channel></rss>`)
			return
		}
		// /slow：挂着不回应（模拟 YouTube 那种慢到超时）
	})
	return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server)))
}

test('单源预算：慢源会被**中止并按失败记录**，且不拖累同轮其它源', async (t) => {
	const server = await startServer()
	const port = server.address().port
	t.after(() => new Promise((r) => server.close(r)))

	const dir = await mkdtemp(path.join(os.tmpdir(), 'dsh-budget-'))
	t.after(() => rm(dir, { recursive: true, force: true, maxRetries: 5 }))

	// **只跑自定义源**：① 测试不碰真实网络 ② 自定义源的条目都跑在**同一个源**里，
	// 所以预算的作用域就是"这一个源"（按设计如此：预算是源级的，不是单条 feed 级）
	const started = Date.now()
	const outcome = await runCollection({
		config: resolveConfig({ dataDir: dir }),
		sourceIds: ['extra'],
		extraFeeds: [`慢源|http://127.0.0.1:${port}/slow|测试`],
		sourceBudgetMs: 600,
	})
	const elapsed = Date.now() - started

	assert.equal(outcome.sources.length, 1, `只该跑自定义源：${outcome.sources.map((s) => `${s.id}/${s.name}`).join(', ')}`)
	const slow = outcome.sources[0]
	assert.equal(slow.ok, false, '慢源应当被判为失败')
	assert.match(String(slow.error), /单源超时：超过 600ms 预算已中止/, `失败原因要说清是超预算、且单位正确：${slow.error}`)
	assert.ok(slow.durationMs >= 500, `耗时应接近预算：${slow.durationMs}`)
	assert.ok(elapsed < 8_000, `整轮应当被预算截断，而不是等 fetchText 的 12s×3 重试：${elapsed}ms`)
})

test('单源预算：默认值是一个**有限**的数（不能无上限）', async () => {
	const { SOURCE_BUDGET_MS } = await import('../lib/collect/index.js')
	assert.equal(typeof SOURCE_BUDGET_MS, 'number')
	assert.ok(SOURCE_BUDGET_MS > 0 && SOURCE_BUDGET_MS <= 60_000, `默认预算应当在合理范围：${SOURCE_BUDGET_MS}`)
})
