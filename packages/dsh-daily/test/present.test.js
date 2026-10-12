/**
 * 结果卡片展示层的回归测试（头图 + 中文介绍）。
 *
 * 重点验三件事：
 * - **头图不会变成破图**：取不到就**没有**（返回 undefined），交给界面走占位块
 * - **中文介绍一定有**：AI 不可用/输出坏掉时必须有确定性兜底（卡片不能空着）
 * - **不冒充**：兜底的介绍要标成 `fallback`，别让用户以为那是模型写的
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
	applyIntros,
	buildIntroPrompt,
	fallbackIntro,
	generateIntros,
	generateAllIntros,
	parseIntros,
	sourceLabelOf,
	thumbForFinding,
} from '../lib/present.js'

const gh = (extra = {}) => ({
	title: 'ant-design/ant-design-icons',
	url: 'https://github.com/ant-design/ant-design-icons',
	provider: 'github',
	query: 'ant design icons',
	summary: 'Ant Design Icons',
	stats: { stars: 1095 },
	...extra,
})
const hn = (extra = {}) => ({
	title: 'Node.js Best Practices',
	url: 'https://github.com/goldbergyoni/nodebestpractices',
	provider: 'hn-algolia',
	query: 'Node js best practices',
	stats: { points: 100 },
	...extra,
})

// ---------- 头图 ----------

test('thumbForFinding：GitHub 仓库用 owner 头像（稳定、无第三方、无 token）', () => {
	assert.equal(thumbForFinding(gh()), 'https://github.com/ant-design.png?size=96')
})

test('thumbForFinding：其它来源用**站点自己的** favicon（不引第三方服务）', () => {
	assert.equal(thumbForFinding(hn()), 'https://github.com/favicon.ico')
	assert.equal(
		thumbForFinding({ title: 't', url: 'https://blog.example.com/a/b?x=1', provider: 'hn-algolia', query: 'q' }),
		'https://blog.example.com/favicon.ico',
		'favicon 要取 origin，不能带上路径与查询串',
	)
})

test('thumbForFinding：拿不到就返回 undefined（绝不返回会导致破图的地址）', () => {
	// HN 自带的讨论页：域名是讨论站，不是内容来源，没有头图可言
	assert.equal(thumbForFinding({ title: 't', url: 'https://news.ycombinator.com/item?id=1', provider: 'hn-algolia', query: 'q' }), undefined)
	for (const bad of ['', 'not a url', 'javascript:alert(1)', 'ftp://x/y']) {
		assert.equal(thumbForFinding({ title: 't', url: bad, provider: 'hn-algolia', query: 'q' }), undefined, `${bad} 不该产生头图`)
	}
	assert.equal(thumbForFinding({ title: 't', url: undefined, provider: 'github', query: 'q' }), undefined)
})

// ---------- 中文介绍：兜底 ----------

test('fallbackIntro：用**结构化事实**拼出中文说明，并标明原文摘要的性质', () => {
	const text = fallbackIntro(gh())
	assert.match(text, /GitHub/)
	assert.match(text, /★1095/)
	assert.match(fallbackIntro(hn()), /100 分/)
	// 有原文摘要时保留，但必须标明是"原文简介"（不能让它看起来像中文介绍）
	const withSummary = fallbackIntro({ ...hn(), summary: 'A long English description' })
	assert.match(withSummary, /原文简介/)
	assert.match(withSummary, /A long English/)
	// 没有热度信息也要有话说
	assert.match(fallbackIntro({ title: 't', url: 'u', provider: 'github', query: 'q' }), /GitHub/)
})

test('fallbackIntro：原文摘要过长要截断（卡片不能被一段英文撑爆）', () => {
	const text = fallbackIntro({ ...hn(), summary: 'x'.repeat(500) })
	assert.ok(text.length < 200, `兜底说明不该太长：${text.length}`)
})

// ---------- 中文介绍：AI ----------

test('buildIntroPrompt：要求严格 JSON 数组、一句中文、不许编造', () => {
	const { system, user } = buildIntroPrompt([gh(), hn()])
	assert.match(system, /JSON 数组/)
	assert.match(system, /中文/)
	assert.match(system, /不要编造/)
	// 提示词必须把"它是怎么被找到的"给模型（没有这个就只能靠标题瞎猜）
	assert.match(user, /ant design icons/, '要带上命中的检索词')
	assert.match(user, /stars=1095/, '要带上热度')
	assert.match(user, /1\. 标题：/, '要编号，便于一一对应')
})

test('buildIntroPrompt：条数有上限（一条一句，别一次问太多）', () => {
	const many = Array.from({ length: 40 }, (_, i) => gh({ title: `t${i}` }))
	const { user } = buildIntroPrompt(many, { limit: 5 })
	assert.equal((user.match(/\d+\. 标题：/g) || []).length, 5)
})

test('parseIntros：能解析纯 JSON 与放在代码块里的 JSON', () => {
	assert.deepEqual(parseIntros('["甲","乙"]', 2), ['甲', '乙'])
	assert.deepEqual(parseIntros('```json\n["甲","乙"]\n```', 2), ['甲', '乙'])
	// 模型爱加的解释文字要能兜住（截取第一个 [ 到最后一个 ]）
	assert.deepEqual(parseIntros('好的：["甲","乙"] 完成', 2), ['甲', '乙'])
})

test('parseIntros：坏输出返回空数组（而不是抛错或猜），调用方会退回兜底', () => {
	for (const bad of [null, undefined, '', 'not json', '{"a":1}', '[1,2]', '[]']) {
		const out = parseIntros(bad, 2)
		assert.ok(Array.isArray(out), `${JSON.stringify(bad)} 应返回数组`)
		assert.ok(out.every((x) => typeof x === 'string'), '元素必须都是字符串')
		assert.ok(out.every((x) => x === ''), `${JSON.stringify(bad)} 不该造出内容`)
	}
})

test('parseIntros：条数与预期不一致时按位置对齐，缺的位置留空（不串位）', () => {
	assert.deepEqual(parseIntros('["甲"]', 3), ['甲', '', ''])
	assert.deepEqual(parseIntros('["甲","乙","丙"]', 2), ['甲', '乙'])
})

// ---------- 合起来 ----------

test('applyIntros：AI 有就写 AI、没有就兜底，并**标明来源**（不冒充）', () => {
	const findings = [gh(), hn()]
	const withAi = applyIntros(findings, ['Ant Design 官方图标库。', ''])
	assert.equal(withAi[0].intro, 'Ant Design 官方图标库。')
	assert.equal(withAi[0].introSource, 'ai')
	assert.equal(withAi[1].introSource, 'fallback', 'AI 没给的那条要退回兜底')
	assert.match(withAi[1].intro, /Hacker News/)
})

test('applyIntros：AI 完全不可用时，**每条**都要有中文介绍（卡片不能空着）', () => {
	const out = applyIntros([gh(), hn()], null)
	assert.equal(out.length, 2)
	for (const finding of out) {
		assert.ok(finding.intro.length > 0, '介绍不能为空')
		assert.equal(finding.introSource, 'fallback')
		assert.equal(finding.sourceLabel.includes('GitHub') || finding.sourceLabel.includes('Hacker'), true)
	}
})

test('applyIntros：头图与介绍一起补齐，且不破坏原始字段', () => {
	const [first] = applyIntros([gh()], null)
	assert.equal(first.thumb, 'https://github.com/ant-design.png?size=96')
	assert.equal(first.url, 'https://github.com/ant-design/ant-design-icons', '原有字段要保留')
	assert.equal(first.query, 'ant design icons', '命中的检索词要保留（可解释性）')
	assert.equal(sourceLabelOf(gh()), 'GitHub 项目')
	assert.equal(sourceLabelOf(hn()), 'Hacker News')
})


// ---------- AI 生成（**这里的事件类型必须是真实的 `text-delta`**）----------

/** 假 stream：按给定的 chunk 序列产出。 */
function fakeStream(chunks) {
	return () => ({
		async *[Symbol.asyncIterator]() {
			for (const chunk of chunks) yield chunk
		},
	})
}
const okStream = (payload) => fakeStream([
	{ type: 'text-delta', text: JSON.stringify(payload) },
	{ type: 'finish', reason: { kind: 'stop' } },
])

test('generateIntros：收集 text-delta 并解析出中文介绍', async () => {
	const intros = await generateIntros([gh(), hn()], {
		stream: okStream(['图标库的中文说明。', 'Node 最佳实践合集。']),
		provider: 'p',
		model: 'm',
	})
	assert.deepEqual(intros, ['图标库的中文说明。', 'Node 最佳实践合集。'])
})

test('generateIntros：流被**拆成多段**也要拼起来（真实流是逐 token 的）', async () => {
	const intros = await generateIntros([gh()], {
		stream: fakeStream([
			{ type: 'text-delta', text: '["图' },
			{ type: 'text-delta', text: '标库' },
			{ type: 'text-delta', text: '说明。"]' },
			{ type: 'finish', reason: { kind: 'stop' } },
		]),
		provider: 'p',
		model: 'm',
	})
	assert.deepEqual(intros, ['图标库说明。'])
})

test('generateIntros：任何失败都返回 null（调用方退回兜底，不让卡片空着）', async () => {
	const cases = {
		无正文: fakeStream([{ type: 'finish', reason: { kind: 'stop' } }]),
		推理烧光预算: fakeStream([{ type: 'reasoning-delta', text: '想了很久' }, { type: 'finish', reason: { kind: 'max-tokens' } }]),
		输出不是JSON: fakeStream([{ type: 'text-delta', text: '好的，我认为…' }, { type: 'finish', reason: { kind: 'stop' } }]),
		流抛错: () => ({ async *[Symbol.asyncIterator]() { throw new Error('boom') } }),
	}
	for (const [name, stream] of Object.entries(cases)) {
		const out = await generateIntros([gh()], { stream, provider: 'p', model: 'm' })
		assert.equal(out, null, `${name} 应返回 null`)
	}
	assert.equal(await generateIntros([], { stream: okStream(['x']), provider: 'p', model: 'm' }), null, '没有条目就别调模型')
})

test('generateIntros：超时要中止并返回 null（不能把整轮检索挂住）', async () => {
	const neverEnding = (request) => ({
		async *[Symbol.asyncIterator]() {
			await new Promise((resolve, reject) => {
				const timer = setTimeout(resolve, 5000)
				request?.signal?.addEventListener('abort', () => { clearTimeout(timer); reject(new Error('aborted')) })
			})
		},
	})
	const started = Date.now()
	const out = await generateIntros([gh()], { stream: neverEnding, provider: 'p', model: 'm', timeoutMs: 1000 })
	assert.equal(out, null)
	assert.ok(Date.now() - started < 4000, '超时应当及时返回')
})

test('generateIntros：maxTokens 要给推理留余量（与条数成正比）', async () => {
	let seen = null
	const spy = (request) => ({
		async *[Symbol.asyncIterator]() {
			seen = request
			yield { type: 'text-delta', text: '["甲"]' }
		},
	})
	await generateIntros(Array.from({ length: 12 }, () => gh()), { stream: spy, provider: 'p', model: 'm' })
	assert.ok(seen.maxTokens >= 2000, `token 预算太小会写不出正文：${seen.maxTokens}`)
	assert.equal(seen.provider, 'p')
	assert.equal(seen.messages.length, 1)
})


// ---------- 分批生成（覆盖全部结果） ----------

test('generateAllIntros：分批覆盖**全部**条目（前 12 条有 AI 介绍 ≠ 只给 12 条写）', async () => {
	const findings = Array.from({ length: 25 }, (_, i) => gh({ title: `t${i}` }))
	let calls = 0
	const stream = (request) => ({
		async *[Symbol.asyncIterator]() {
			calls += 1
			// 每条按提示词里的编号回一句，便于验证位置对齐
			const n = (String(request.messages[0].content).match(/\d+\. 标题：/g) || []).length
			yield { type: 'text-delta', text: JSON.stringify(Array.from({ length: n }, (_, i) => `介绍${i}`)) }
			yield { type: 'finish', reason: { kind: 'stop' } }
		},
	})
	const intros = await generateAllIntros(findings, { stream, provider: 'p', model: 'm', batchSize: 10 })
	assert.equal(calls, 3, '25 条按每批 10 条应当是 3 批')
	assert.equal(intros.length, 25, '返回值必须与条目一一对应（不能少元素，否则会串位）')
	assert.ok(intros.every((x) => x.length > 0), '每一批都要写出内容')
})

test('generateAllIntros：**单批失败不影响其它批**（第 2 批坏，1 和 3 照样是模型写的）', async () => {
	const findings = Array.from({ length: 30 }, (_, i) => gh({ title: `t${i}` }))
	let call = 0
	const stream = () => ({
		async *[Symbol.asyncIterator]() {
			call += 1
			if (call === 2) throw new Error('mid batch boom')
			yield { type: 'text-delta', text: JSON.stringify(['甲', '乙', '丙', '丁', '戊', '己', '庚', '辛', '壬', '癸']) }
			yield { type: 'finish', reason: { kind: 'stop' } }
		},
	})
	const intros = await generateAllIntros(findings, { stream, provider: 'p', model: 'm', batchSize: 10 })
	assert.equal(intros.length, 30)
	assert.ok(intros.slice(0, 10).every((x) => x.length > 0), '第 1 批应当成功')
	assert.ok(intros.slice(10, 20).every((x) => x === ''), '第 2 批应当留空（调用方走兜底）')
	assert.ok(intros.slice(20, 30).every((x) => x.length > 0), '第 3 批应当成功')
})

test('generateAllIntros：批数有上限（成本闸门），但**位置仍要对齐**', async () => {
	const findings = Array.from({ length: 100 }, () => gh())
	let calls = 0
	const stream = () => ({
		async *[Symbol.asyncIterator]() {
			calls += 1
			// 每批 10 条 → 假输出也必须是 10 个元素（少给会被按位置对齐成 'x','','',…）
			yield { type: 'text-delta', text: JSON.stringify(Array.from({ length: 10 }, () => 'x')) }
		},
	})
	const intros = await generateAllIntros(findings, { stream, provider: 'p', model: 'm', batchSize: 10, maxBatches: 2 })
	assert.equal(calls, 2, '最多只调 2 批')
	assert.equal(intros.length, 100, '长度必须与条目数一致')
	assert.equal(intros.slice(0, 20).filter((x) => x.length > 0).length, 20)
	assert.equal(intros.slice(20).filter((x) => x === '').length, 80, '超出的部分留空 → 走兜底')
})

test('generateAllIntros：**所有批都失败**要返回 null（调用方整体退回兜底）', async () => {
	const findings = Array.from({ length: 5 }, () => gh())
	const stream = () => ({ async *[Symbol.asyncIterator]() { throw new Error('all boom') } })
	assert.equal(await generateAllIntros(findings, { stream, provider: 'p', model: 'm' }), null)
	assert.equal(await generateAllIntros([], { stream, provider: 'p', model: 'm' }), null, '没有条目时不该说“成功”')
})
