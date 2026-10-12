/**
 * 定向检索的回归测试。
 *
 * 这里的重点不是"能否搜到东西"，而是三件更容易做错的事：
 * - **失败隔离**：N 条检索词 × 2 个通道 = 很多格，任何一格失败都不能让整轮没有结果
 * - **有界**：检索词可能很多，不能一次全打出去；每条词每通道取多少也要有上限
 * - **可解释**：每条结果必须记住"是哪条检索词找到的"，否则就退化成了又一个新闻流
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
	buildSearchRequests,
	dedupeFindings,
	describeRetrieval,
	encodeQuery,
	heatOf,
	parseGitHubResponse,
	parseHnResponse,
	runRetrieval,
	shapeQuery,
	querySpecificity,
	acceptsQuery,
	nonAsciiRatio,
	skippedQueries,
} from '../lib/retrieve.js'

const q = (query) => ({ query, kind: 'ai', reason: '测试' })

test('shapeQuery：清掉括号注释与引号（模型爱加「（假设）」这类噪声）', () => {
	assert.equal(shapeQuery('（假）react 19 迁移'), 'react 19 迁移')
	assert.equal(shapeQuery('react 19 (breaking changes)'), 'react 19')
	assert.equal(shapeQuery('  "zustand v5"  '), 'zustand v5')
	assert.equal(shapeQuery('正常 检索 词'), '正常 检索 词')
})

test('acceptsQuery：英文语料通道不吃中文检索词（实测：200 但 0 条）', () => {
	assert.equal(nonAsciiRatio('react 19 migration'), 0)
	assert.ok(nonAsciiRatio('react 19 迁移注意事项') > 0.4)
	for (const provider of ['hn-algolia', 'github']) {
		assert.equal(acceptsQuery(provider, 'react 19 migration'), true)
		assert.equal(acceptsQuery(provider, 'react 19 迁移注意事项'), false, `${provider} 不该打中文词`)
	}
})

test('buildSearchRequests：语言不匹配的词不会白打请求，且能被列出', () => {
	const mixed = [q('react 19 migration'), q('react 19 迁移注意事项')]
	const requests = buildSearchRequests(mixed, { maxQueries: 5 })
	assert.equal(requests.length, 2, '只有英文那条会展开成 2 次请求（HN + GitHub）')
	assert.ok(requests.every((r) => r.query === 'react 19 migration'))
	assert.deepEqual(skippedQueries(mixed, { maxQueries: 5 }), ['react 19 迁移注意事项'])
})
const queries = [q('react 19'), q('zustand v5'), q('vite 6')]

/** 假 fetch：按 URL 里的 query 参数返回预设响应。 */
function fakeFetch(routes, log = []) {
	return async (url, init) => {
		log.push(url)
		for (const [matcher, response] of routes) {
			if (url.includes(matcher)) {
				if (response instanceof Error) throw response
				if (typeof response === 'function') return response(url, init)
				return { ok: response.ok !== false, status: response.status ?? 200, json: async () => response.body }
			}
		}
		return { ok: false, status: 404, json: async () => ({}) }
	}
}

const hnBody = (title, url, points = 10) => ({ hits: [{ title, url, objectID: '1', points, num_comments: 2, created_at: '2026-10-01T00:00:00Z' }] })
const ghBody = (full, stars = 100) => ({ items: [{ full_name: full, html_url: 'https://github.com/' + full, description: 'desc', stargazers_count: stars, updated_at: '2026-10-01T00:00:00Z' }] })

// ---------- 基础 ----------

test('encodeQuery：编码并限长（模型可能给出很长的短语）', () => {
	assert.equal(encodeQuery('react 19'), 'react%2019')
	assert.equal(encodeQuery('  react 19  '), 'react%2019')
	assert.ok(encodeQuery('x'.repeat(500)).length <= 120 * 3)
})

// ---------- 解析 ----------

test('parseHnResponse：hits 转结果；缺外链回落讨论页；脏数据被跳过', () => {
	const findings = parseHnResponse(
		{
			hits: [
				{ title: 'React 19', url: 'https://example.com/a', objectID: '1', points: 100, num_comments: 5 },
				{ title: 'Ask HN: 怎么办', objectID: '2' },              // 无 url → 讨论页
				{ objectID: '3' },                                        // 无标题 → 跳过
				null,
				'字符串',
			],
		},
		'react 19',
	)
	assert.equal(findings.length, 2)
	assert.equal(findings[0].url, 'https://example.com/a')
	assert.equal(findings[0].provider, 'hn-algolia')
	assert.equal(findings[0].query, 'react 19', '必须记住是哪条检索词找到的')
	assert.deepEqual(findings[0].stats, { points: 100, comments: 5 })
	assert.equal(findings[1].url, 'https://news.ycombinator.com/item?id=2')
})

test('parseHnResponse / parseGitHubResponse：坏输入返回空数组而不是崩', () => {
	for (const bad of [null, undefined, 'x', 42, {}, { hits: 'no' }]) {
		assert.deepEqual(parseHnResponse(bad, 'q'), [])
		assert.deepEqual(parseGitHubResponse(bad, 'q'), [])
	}
})

test('parseGitHubResponse：repo 转结果，保留 star 数', () => {
	const findings = parseGitHubResponse(
		{ items: [{ full_name: 'a/b', html_url: 'https://github.com/a/b', description: 'd', stargazers_count: 9 }, { description: 'no url' }] },
		'viz',
	)
	assert.equal(findings.length, 1)
	assert.equal(findings[0].title, 'a/b')
	assert.equal(findings[0].provider, 'github')
	assert.equal(findings[0].stats.stars, 9)
	assert.equal(findings[0].query, 'viz')
})

// ---------- 有界 ----------

test('buildSearchRequests：条数有界（检索词 × 通道），且顺序稳定', () => {
	const requests = buildSearchRequests(queries, { maxQueries: 2, perQueryLimit: 3 })
	assert.equal(requests.length, 4, '2 条词 × 2 个通道')
	assert.deepEqual([...new Set(requests.map((r) => r.query))], ['react 19', 'zustand v5'])
	assert.ok(requests.every((r) => r.url.includes('per_page=3') || r.url.includes('hitsPerPage=3')))
	// 可只用一个通道
	assert.equal(buildSearchRequests(queries, { providers: [] }).length, 0)
})

// ---------- 去重与排序 ----------

test('dedupeFindings：按规范化 URL 去重，并把命中的多条检索词并起来', () => {
	const merged = dedupeFindings([
		{ title: 'A', url: 'https://e.com/a?utm=1', provider: 'github', query: 'q1' },
		{ title: 'A', url: 'https://e.com/a/', provider: 'github', query: 'q2' },
		{ title: 'B', url: 'https://e.com/b', provider: 'github', query: 'q1' },
	])
	assert.equal(merged.length, 2)
	assert.match(merged[0].query, /q1/)
	assert.match(merged[0].query, /q2/, '被两条检索词命中是"更相关"的信号')
})

test('querySpecificity：词越多/越长越具体', () => {
	assert.ok(querySpecificity('ant design icons') > querySpecificity('react'))
	assert.ok(querySpecificity('state management patterns') >= querySpecificity('icons'))
	assert.equal(querySpecificity(''), 0)
})

test('heatOf：具体词的结果要压过过泛词的结果（同热度时）', () => {
	const generic = { title: 'a', url: 'u', provider: 'github', query: 'react', stats: { stars: 100 } }
	const specific = { title: 'b', url: 'v', provider: 'github', query: 'ant design icons', stats: { stars: 100 } }
	assert.ok(heatOf(specific) > heatOf(generic), '同 star 数时，具体词的条目该排前面')
})

test('heatOf：HN 点数与 GitHub star 都能抬高热度', () => {
	const hn = { title: 'a', url: 'u', provider: 'hn-algolia', query: 'q', stats: { points: 100 } }
	const gh = { title: 'b', url: 'v', provider: 'github', query: 'q', stats: { stars: 50000 } }
	const none = { title: 'c', url: 'w', provider: 'github', query: 'q' }
	assert.ok(heatOf(hn) > heatOf(none))
	assert.ok(heatOf(gh) > heatOf(none))
})

// ---------- 跑一轮（失败隔离是重点） ----------

test('runRetrieval：两条通道都成功时，结果按热度排序并带统计', async () => {
	const result = await runRetrieval([q('react 19')], {
		fetch: fakeFetch([
			['hn.algolia.com', { body: hnBody('热门讨论', 'https://e.com/hot', 500) }],
			['api.github.com', { body: ghBody('a/b', 10) }],
		]),
	})
	assert.equal(result.findings.length, 2)
	assert.equal(result.findings[0].title, '热门讨论', '热度高的排前面')
	assert.deepEqual(result.stats.requests, 2)
	assert.equal(result.stats.ok, 2)
	assert.equal(result.stats.failed, 0)
	assert.deepEqual(result.errors, [])
})

test('runRetrieval：**一格失败不影响其它格**（一次抖动不该让整轮没结果）', async () => {
	const result = await runRetrieval(queries, {
		maxQueries: 3,
		fetch: fakeFetch([
			// GitHub 全挂，HN 正常
			['api.github.com', { ok: false, status: 503 }],
			['hn.algolia.com', { body: hnBody('HN 的结果', 'https://e.com/hn') }],
		]),
	})
	assert.ok(result.findings.length > 0, 'HN 的结果必须还在')
	assert.equal(result.stats.ok, 3)
	assert.equal(result.stats.failed, 3)
	assert.equal(result.errors.length, 3)
	assert.match(result.errors[0], /GitHub/)
})

test('runRetrieval：网络异常被记进 errors，绝不抛', async () => {
	const result = await runRetrieval([q('x')], {
		fetch: fakeFetch([
			['api.github.com', new Error('ECONNRESET')],
			['hn.algolia.com', { body: hnBody('ok', 'https://e.com/1') }],
		]),
	})
	assert.equal(result.findings.length, 1)
	assert.ok(result.errors.some((e) => /ECONNRESET/.test(e)), result.errors.join('|'))
})

test('runRetrieval：超时会中止并按失败记录（不会永久挂住）', async () => {
	const slowFetch = async (url, init) => {
		if (url.includes('hn.algolia')) {
			// 模拟"慢到超时"：等 abort 信号
			await new Promise((resolve, reject) => {
				const timer = setTimeout(resolve, 5000)
				init?.signal?.addEventListener('abort', () => {
					clearTimeout(timer)
					reject(new Error('aborted'))
				})
			})
		}
		return { ok: true, status: 200, json: async () => ghBody('a/b') }
	}
	const result = await runRetrieval([q('x')], { fetch: slowFetch, timeoutMs: 1000 })
	assert.equal(result.stats.failed, 1)
	assert.ok(result.findings.length >= 1, 'GitHub 那条仍应成功')
})

test('runRetrieval：环境没有 fetch 时给出说明而不是崩', async () => {
	// 显式 null = 禁用（不传 undefined 会回退到全局 fetch，单测就会真的打网络 —— 实测 7 秒）
	const result = await runRetrieval([q('x')], { fetch: null })
	assert.deepEqual(result.findings, [])
	assert.match(result.errors[0], /fetch/)
})

test('runRetrieval：空检索词列表不发任何请求', async () => {
	const log = []
	const result = await runRetrieval([], { fetch: fakeFetch([['hn.algolia', { body: { hits: [] } }]], log) })
	assert.equal(log.length, 0)
	assert.equal(result.stats.requests, 0)
	assert.deepEqual(result.findings, [])
})

test('runRetrieval：并发受控但每个请求都会发出（不丢格）', async () => {
	const log = []
	const result = await runRetrieval(queries, {
		maxQueries: 3,
		concurrency: 2,
		fetch: fakeFetch(
			[
				['hn.algolia.com', { body: { hits: [] } }],
				['api.github.com', { body: { items: [] } }],
			],
			log,
		),
	})
	assert.equal(log.length, 6, '3 条词 × 2 通道 = 6 次请求，一个都不能少')
	assert.equal(result.stats.requests, 6)
	assert.equal(result.stats.ok, 6)
})

test('describeRetrieval：一句话说清搜了几次、成没成', () => {
	const text = describeRetrieval({ findings: [1, 2], stats: { requests: 4, ok: 3, failed: 1, providers: [], queries: 2, skipped: 0 }, errors: [] })
	assert.match(text, /2 条结果/)
	assert.match(text, /成功 3/)
	assert.match(text, /失败 1/)
})
