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
