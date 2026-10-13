/**
 * 项目简报（第三阶段）的回归测试。
 *
 * 重点在三件事，都不是"能跑就行"：
 * - **没有模型也要有东西看**：`news` 必须由确定性相关性兜底
 * - **不编造**：模型没给/坏了 → `degraded` 如实写明，而不是拼一段像建议的话
 * - **模型不能自己造 URL**：news 只允许引用条目的 index（URL 一律用真实条目）
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
	assembleBrief,
	buildBriefPrompt,
	describeBrief,
	parseBrief,
	projectTerms,
	selectRelatedItems,
	isMatchableTerm,
	findingsToNews,
	mergeNews,
	projectTermList,
	ADVICE_ACTIONS,
} from '../lib/brief.js'

const profile = {
	name: 'msim-front-react',
	languages: [{ name: 'TypeScript', evidence: 'package.json' }],
	dependencies: ['@ant-design/icons', 'zustand', 'monaco-editor'],
	keywords: ['可视化', 'dashboard', '状态管理'],
}

const item = (id, title, summary = '', extra = {}) => ({
	id,
	title,
	url: `https://e.com/${id}`,
	summary,
	sourceId: 's',
	sourceName: 'S',
	topic: '技术',
	publishedAt: '2026-10-13T00:00:00Z',
	...extra,
})

// ---------- 确定性相关性（没有模型时的生命线） ----------

test('projectTerms：领域词 + 依赖名（去作用域/符号）都要能匹配', () => {
	const terms = projectTerms(profile)
	assert.ok(terms.includes('可视化'))
	assert.ok(terms.includes('dashboard'))
	assert.ok(terms.includes('zustand'), '依赖名要去掉 @scope/ 与符号后参与匹配')
	// 作用域包名 `@ant-design/icons`：包名末段 `icons` 太泛，作用域词 `ant design` 才够辨识
	assert.ok(terms.includes('icons'), '包名末段要收')
	assert.ok(terms.includes('ant design'), `作用域词也要收：${terms.join(' | ')}`)
})

test('selectRelatedItems：命中才要，并把**命中的词**当理由；命中多的排前面', () => {
	const items = [
		item('a', 'A dashboard for visualization', '状态管理相关'),
		item('b', 'Zustand v5 released'),
		item('c', '完全无关的币圈新闻'),
	]
	const related = selectRelatedItems(profile, items)
	assert.deepEqual(related.map((r) => r.item.id), ['a', 'b'], '无关条目要被筛掉')
	assert.ok(related[0].hits.length >= 2, `命中词要记下来：${related[0].hits.join('、')}`)
	assert.ok(related[0].score > related[1].score, '命中多的排前面')
	assert.ok(selectRelatedItems(profile, items, 1).length === 1, 'limit 生效')
	assert.deepEqual(selectRelatedItems(profile, []), [], '空输入不炸')
})

// ---------- 提示词 ----------

test('buildBriefPrompt：带上项目信息，要求严格 JSON，且**明确禁止编造**', () => {
	const { system, user } = buildBriefPrompt(profile, selectRelatedItems(profile, [item('a', 'A dashboard')]))
	assert.match(system, /msim-front-react/)
	assert.match(system, /TypeScript/)
	assert.match(system, /ant-design/)
	assert.match(system, /只输出一个 JSON 对象/)
	assert.match(system, /宁可某段为空数组，也不要编造/)
	assert.match(system, /只能引用上面条目的 index/, 'news 必须按 index 引用，不许自己造 URL')
	assert.match(user, /1\. 标题:A dashboard/, '条目要编号，供 news 引用')
})

// ---------- 解析容错 ----------

test('parseBrief：正常 JSON、代码块包裹、外层裹文字都要能解析', () => {
	const raw = JSON.stringify({
		concepts: [{ term: 'Zustand', explain: '一个状态管理库', relation: '项目依赖它', from: ['Zustand v5'] }],
		news: [{ index: 1, why: '直接关系到项目依赖' }],
		advice: [{ action: '升级', title: '升到 v5', detail: '按官方迁移指引', evidence: ['Zustand v5'], confidence: 'high' }],
	})
	const related = selectRelatedItems(profile, [item('a', 'Zustand v5 released')])
	for (const variant of [raw, '```json\n' + raw + '\n```', `好的：${raw} 完成`]) {
		const parsed = parseBrief(variant, related)
		assert.equal(parsed.concepts.length, 1, `变体应当能解析：${variant.slice(0, 20)}`)
		assert.equal(parsed.news[0].url, 'https://e.com/a', 'news 的 URL 必须用真实条目')
		assert.equal(parsed.advice[0].action, '升级')
	}
})

test('parseBrief：坏输出返回空、绝不抛', () => {
	const related = selectRelatedItems(profile, [item('a', 'Zustand v5')])
	for (const bad of [null, undefined, '', '不是 JSON', '{"concepts": "no"}', '[1,2]']) {
		const parsed = parseBrief(bad, related)
		assert.deepEqual(parsed, { concepts: [], news: [], advice: [] }, `${JSON.stringify(bad)} 应返回空三段`)
	}
})

test('parseBrief：脏字段被丢掉、枚举被规范化（模型经常给奇怪的值）', () => {
	const parsed = parseBrief(
		JSON.stringify({
			concepts: [{ term: 'X' }, { term: 'Y', explain: 'ok' }],
			news: [{ index: 99, why: '越界' }, { index: 1, why: 'ok' }, { url: 'https://evil.com', title: '自己造 URL' }],
			advice: [{ title: '建议' }, { action: '乱写', title: 'B', confidence: '乱写' }],
		}),
		selectRelatedItems(profile, [item('a', 'Zustand v5')]),
	)
	assert.deepEqual(parsed.concepts.map((c) => c.term), ['Y'], '缺 explain 的概念要丢掉')
	assert.equal(parsed.news.length, 1, '越界 index 与"自己造 URL"的条目都要丢掉')
	assert.equal(parsed.news[0].id, 'a')
	assert.ok(ADVICE_ACTIONS.includes(parsed.advice[0].action), `非法 action 要回落到"了解"：${parsed.advice[0].action}`)
	assert.equal(parsed.advice[1].confidence, 'medium', '非法 confidence 要回落')
})

// ---------- 组装与降级 ----------

test('assembleBrief：**没有模型**时 news 靠确定性兜底，concepts/advice 如实降级', () => {
	const related = selectRelatedItems(profile, [item('a', 'A dashboard'), item('b', 'Zustand v5')])
	const brief = assembleBrief({ date: '2026-10-13', projectHash: 'h', related, model: '', parsed: null })
	assert.equal(brief.model, '', '没走 AI 时不该写模型名')
	assert.equal(brief.news.length, 2, '没有模型也必须能看到相关资讯')
	assert.ok(brief.news[0].why.includes('关键词') || brief.news[0].why.includes('依赖'), '兜底理由要说明白')
	assert.equal(brief.concepts.length, 0)
	assert.equal(brief.advice.length, 0)
	assert.match(brief.degraded.concepts, /未配置模型/)
	assert.match(brief.degraded.advice, /未配置模型/)
	assert.equal(brief.degraded.news, undefined, 'news 没降级就不该出现在 degraded 里')
})

test('assembleBrief：模型可用但某段为空 → 也要如实标出来（不静默留空）', () => {
	const related = selectRelatedItems(profile, [item('a', 'A dashboard')])
	const brief = assembleBrief({
		date: '2026-10-13',
		projectHash: 'h',
		related,
		model: 'fake/model',
		parsed: { concepts: [], news: [], advice: [] },
	})
	assert.equal(brief.model, 'fake/model')
	assert.equal(brief.news.length, 1, '模型没给 news 时用确定性兜底，而不是留空')
	assert.match(brief.degraded.concepts, /模型未产出/)
	assert.match(brief.degraded.advice, /模型未产出/)
})

test('describeBrief：一句话能说清三段各有多少、哪段降级了', () => {
	const related = selectRelatedItems(profile, [item('a', 'A dashboard')])
	const text = describeBrief(assembleBrief({ date: 'd', projectHash: 'h', related, model: '', parsed: null }))
	assert.match(text, /概念 0/)
	assert.match(text, /资讯 1/)
	assert.match(text, /降级：concepts\/advice/)
})

test('过泛词不进匹配集（实测踩过：test/web/数据 把无关条目拉进简报）', () => {
	// 实测证据：第一版简报里出现过「browser-use/jev-ultrafast ← 命中 test、web」
	// 与「游戏测评 ← 命中 数据」这种完全无关的匹配
	for (const generic of ['test', 'web', 'data', 'api', 'ui', 'utils', 'main', '数据', '管理', '状态', '系统', '平台']) {
		assert.equal(isMatchableTerm(generic), false, `${generic} 不该用于判断相关性`)
	}
	for (const useful of ['dashboard', 'visualization', 'zustand', '可视化', '状态管理', 'ant design']) {
		assert.equal(isMatchableTerm(useful), true, `${useful} 应当可以用于判断相关性`)
	}
	// 结构词仍然被 isDomainKeyword 挡掉（复用研究侧的既有规则）
	assert.equal(isMatchableTerm('context'), false)
	assert.equal(isMatchableTerm('experiment'), false)
})

test('selectRelatedItems：过泛词命中**不算相关**（否则简报会混进无关内容）', () => {
	const noisy = {
		...profile,
		keywords: ['数据', 'dashboard'],
		dependencies: ['react'],
	}
	const items = [
		item('game', '游戏测评：这张卡的数据很强'), // 只命中"数据" → 不该算相关
		item('web', 'A web app built with test framework'), // 只命中 web/test → 不该算相关
		item('good', 'A dashboard for visualization'), // 命中 dashboard → 算相关
	]
	const related = selectRelatedItems(noisy, items)
	assert.deepEqual(related.map((r) => r.item.id), ['good'], `只该留下真正相关的：${related.map((r) => r.item.id)}`)
})

test('强弱两级：强词命中即相关；只有弱词要 ≥2 个（精度与召回的平衡）', () => {
	const p = { ...profile, keywords: ['react', '可视化', 'dashboard'], dependencies: ['zustand'] }
	const items = [
		item('strong', 'Zustand v5 发布'), // 强词（依赖名）→ 相关
		item('weak1', 'React 生态周报'), // 只有弱词 react → 不相关
		item('weak2', 'React 与可视化实践'), // react(弱) + 可视化(弱) = 2 个 → 相关
		item('noise', '币圈行情速览'),
	]
	const ids = selectRelatedItems(p, items).map((r) => r.item.id)
	assert.ok(ids.includes('strong'), `强词命中就该相关：${ids}`)
	assert.ok(!ids.includes('weak1'), `单个弱词不足以判定相关：${ids}`)
	assert.ok(ids.includes('weak2'), `两个弱词可以判定相关：${ids}`)
	assert.ok(!ids.includes('noise'), '无关条目仍要挡掉')
	// 强词得分要高于同等数量的弱词
	const strongScore = selectRelatedItems(p, [item('s', 'Zustand v5')])[0].score
	const weakScore = selectRelatedItems(p, [item('w', 'React 与可视化')])[0].score
	assert.ok(strongScore > weakScore, `强词权重应当更高：${strongScore} vs ${weakScore}`)
})

test('projectTermList：依赖名一律强、领域词按长度分强弱', () => {
	const list = projectTermList({ ...profile, keywords: ['react', '可视化', 'dashboard'] })
	const find = (t) => list.find((e) => e.term === t)?.strength
	assert.equal(find('zustand'), 'strong', '依赖名是项目独有的 → 强')
	assert.equal(find('icons'), 'strong', '作用域包名 → 强')
	assert.equal(find('dashboard'), 'strong', '够长的领域词 → 强')
	assert.equal(find('react'), 'weak', '生态词单独命中说明不了什么 → 弱')
	assert.equal(find('可视化'), 'weak', '三字中文词 → 弱')
})

test('findingsToNews：调研结果转资讯，并**写明是主动搜到的**（可追溯）', () => {
	const news = findingsToNews([
		{ title: 'Maintaining a Stable Protobuf API', url: 'https://e.com/pb', query: 'bufbuild protobuf', provider: 'hn-algolia', dimension: 'dep' },
		{ title: 'no url' },
	])
	assert.equal(news.length, 1, '缺 URL 的丢掉')
	assert.equal(news[0].source, 'research')
	assert.match(news[0].why, /由检索词「bufbuild protobuf」搜到/)
	assert.match(news[0].why, /hn-algolia/)
})

test('mergeNews：调研优先、同 URL 去重（日报与调研很可能撞同一条）', () => {
	const daily = [
		{ id: 'd1', title: '日报里的一条', url: 'https://e.com/a?utm=1', why: '命中 react', source: 'daily' },
		{ id: 'd2', title: '只存在于日报', url: 'https://e.com/b', why: '命中 dashboard', source: 'daily' },
	]
	const research = [
		{ id: 'r1', title: '搜到的同一条', url: 'https://e.com/a/', why: '由检索词「x」搜到', source: 'research' },
	]
	const merged = mergeNews(daily, research)
	assert.equal(merged.length, 2, '同 URL（仅 utm/尾斜杠不同）要合并成一条')
	assert.equal(merged[0].source, 'research', '调研结果优先（它是主动搜来的）')
	assert.equal(merged[0].title, '搜到的同一条')
	assert.ok(merged.some((n) => n.source === 'daily'), '日报里独有的那条要保留')
})
