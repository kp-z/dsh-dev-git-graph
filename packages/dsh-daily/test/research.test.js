/**
 * 调研检索词的回归测试。
 *
 * 这是调研链的**入口**。入口环节最要紧的性质不是"AI 生成的词有多好"，而是
 * **它永远不会因为模型问题而整体不可用**：
 * - 没配模型 → 用确定性种子，并在 notes 里说清原因
 * - 模型超时 / 抛错 / 输出跑偏 / 流以失败结束 → 全部降级，绝不抛给调用方
 * 另外要守住"缓存键是画像指纹"这条：画像没变就不该重新花一次模型调用。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
	buildResearchPrompt,
	canReusePlan,
	cleanQuery,
	dedupeQueries,
	describePlan,
	deterministicQueries,
	parseQueries,
	planResearch,
	profileHash,
	QUERY_MAX_CHARS,
	diversifyByFamily,
	depKeywords,
	RESEARCH_DIMENSIONS,
	isSpecificQuery,
	domainKeywords,
	isDomainKeyword,
} from '../lib/research.js'

/** 造一个画像（只填检索词会用到的字段）。 */
const profile = (over = {}) => ({
	dir: '/Users/x/DEV/app',
	name: 'app',
	detectedAt: '2026-10-12T00:00:00.000Z',
	files: [],
	skipped: [],
	topLevel: [],
	languages: [{ name: 'TypeScript', evidence: 'tsconfig.json' }],
	// 依赖刻意用"能生成具体检索词"的真实形态：`react` 这种单个通用词现在会被
	// isSpecificQuery 挡掉（实测它单独搜回来的是毫不相干的结果）
	dependencies: ['@ant-design/icons', 'monaco-editor'],
	keywords: ['可视化', '回放'],
	bytes: 1000,
	summary: '项目：app\n技术栈：TypeScript\n关键词：可视化、回放',
	...over,
})

/** 假流：把给定片段按 chunk 吐出；可选延迟与对 abort 的反应。 */
function fakeStream(chunks, opts = {}) {
	return (request) => ({
		async *[Symbol.asyncIterator]() {
			for (const chunk of chunks) {
				if (opts.delayMs) {
					await new Promise((resolve) => setTimeout(resolve, opts.delayMs))
					if (request.signal?.aborted) throw new Error('aborted')
				}
				yield chunk
			}
			if (opts.throwAtEnd) throw new Error(opts.throwAtEnd)
		},
	})
}

const texts = (arr) => arr.map((t) => ({ type: 'text-delta', text: t }))

// ---------- 清洗与去重 ----------

test('cleanQuery：去掉编号/项目符号/引号，压空白、限长', () => {
	assert.equal(cleanQuery('  1. react 19 新特性  '), 'react 19 新特性')
	assert.equal(cleanQuery('- "zustand v5 迁移"'), 'zustand v5 迁移')
	assert.equal(cleanQuery('• 可视化 方案'), '可视化 方案')
	assert.equal(cleanQuery('多行\n检索\t词'), '多行 检索 词')
	assert.equal(cleanQuery('   '), null)
	assert.equal(cleanQuery('a'), null, '太短的搜不出东西')
	const long = cleanQuery('x'.repeat(200))
	assert.equal(long.length, QUERY_MAX_CHARS)
})

test('cleanQuery：模型的礼貌性开场（长文本）被拒，短词正常保留', () => {
	assert.equal(cleanQuery('好的，以下是为你生成的检索词列表，请查收并根据需要调整，谢谢配合与使用'), null)
	assert.equal(cleanQuery('好的'), '好的', '短词不该被误杀')
})

test('dedupeQueries：大小写不敏感去重且保序', () => {
	assert.deepEqual(dedupeQueries(['React', 'react', 'zustand', 'REACT']), ['React', 'zustand'])
})

// ---------- 确定性种子 ----------

test('deterministicQueries：贴项目（依赖/技术栈/关键词），且每条都有理由', () => {
	const queries = deterministicQueries(profile())
	assert.ok(queries.length > 0)
	for (const q of queries) {
		assert.ok(q.query.length > 0)
		assert.ok(q.reason.length > 0, `每条都该说明为什么：${JSON.stringify(q)}`)
		// 对照**维度声明**而不是硬编码列表：以后加维度不会再让这条假红
		assert.ok(
			RESEARCH_DIMENSIONS.some((d) => d.id === q.kind),
			`每条检索词都要属于一个已声明的维度：${q.kind}`,
		)
	}
	const joined = queries.map((q) => q.query).join(' | ')
	assert.match(joined, /ant design icons/, '应围绕依赖生成（且已从包名整形为关键词）')
	assert.match(joined, /TypeScript/, '应包含技术栈')
	// 去重
	assert.equal(new Set(queries.map((q) => q.query.toLowerCase())).size, queries.length)
})

test('deterministicQueries：跳过 @types / lint / 测试这类"查了也没用"的开发依赖', () => {
	const queries = deterministicQueries(
		profile({ dependencies: ['@types/node', 'eslint', 'prettier', 'vitest', 'typescript', '@ant-design/icons'] }),
	)
	const joined = queries.map((q) => q.query).join(' | ')
	assert.match(joined, /ant design icons/, `应保留真正的依赖：${joined}`)
	assert.ok(!/@types/.test(joined), `不该为 @types 生成检索词：${joined}`)
	assert.ok(!/eslint/.test(joined))
})

test('deterministicQueries：截断时优先保住"最贴项目"的领域关键词（真实踩到过）', async () => {
	// 真实联调：8 条里 keyword 一条不剩，因为种子顺序把关键词排在了最后
	const rich = profile({
		dependencies: ['react', 'zustand', 'three'],
		keywords: ['可视化', '回放', '状态管理', '时间轴'],
		languages: [{ name: 'TypeScript', evidence: 'tsconfig.json' }, { name: 'Node.js', evidence: 'package.json' }],
	})
	const plan = await planResearch(rich, {
		stream: fakeStream(texts([JSON.stringify(['a1 词', 'b2 词', 'c3 词'])])),
		count: 8,
	})
	const kinds = plan.queries.map((q) => q.kind)
	assert.ok(kinds.includes('keyword'), `关键词不该被砍光：${JSON.stringify(plan.queries.map((q) => q.query))}`)
	// AI 的词排最前是对的（它是主源）；关键是**种子里的第一个必须是关键词**，
	// 这样截断时才轮不到把它砍掉
	const firstSeed = kinds.find((k) => k !== 'ai')
	assert.equal(firstSeed, 'keyword', `种子里最贴项目的该排最前：${kinds.join(',')}`)
})

test('deterministicQueries：同一 scope 的依赖不会占满名额（真实项目踩到过）', () => {
	// @ant-design/* 连排是真实依赖表的常态
	const queries = deterministicQueries(
		profile({
			dependencies: [
				'@ant-design/icons',
				'@ant-design/plots',
				'@ant-design/pro-components',
				'@antv/g2',
				'monaco-editor',
			],
		}),
	)
	const depQueries = queries.filter((q) => q.kind === 'dep').map((q) => q.query)
	assert.equal(depQueries.length, 3)
	const scopes = depQueries.map((q) => q.split('/')[0].split(' ')[0])
	assert.equal(new Set(scopes).size, 3, `三个名额该给三个不同的族：${depQueries.join(' | ')}`)
})

test('diversifyByFamily：先每族 1 个，不够再放宽到每族 2 个', () => {
	assert.deepEqual(diversifyByFamily(['@a/x', '@a/y', '@b/z'], 2), ['@a/x', '@b/z'])
	assert.deepEqual(diversifyByFamily(['@a/x', '@a/y', '@b/z'], 3), ['@a/x', '@b/z', '@a/y'])
	assert.deepEqual(diversifyByFamily(['react', 'react-dom', 'vue'], 2), ['react', 'vue'])
	assert.deepEqual(diversifyByFamily([], 3), [])
})

test('isSpecificQuery：过泛的词不该单独去搜（实测 react 拉回不相干结果）', () => {
	// 多词/中文/够长的单词 = 具体
	for (const good of ['ant design icons', 'TypeScript best practices', '可视化', 'visualization', 'state management']) {
		assert.equal(isSpecificQuery(good), true, `${good} 应算具体`)
	}
	// 单独一个通用技术名 = 太泛（`react` 单独搜回的是 Honda 那条）
	for (const bad of ['react', 'vue', 'vite', 'node', 'three', 'css', 'redux', 'go', 'api']) {
		assert.equal(isSpecificQuery(bad), false, `${bad} 太泛，不该单独搜`)
	}
	assert.equal(isSpecificQuery(''), false)
})

test('deterministicQueries：过泛的领域词/技术栈名不会变成检索词', () => {
	const queries = deterministicQueries(
		profile({
			// 依赖刻意用"能生成具体检索词"的真实形态：`react` 这种单个通用词现在会被
	// isSpecificQuery 挡掉（实测它单独搜回来的是毫不相干的结果）
	dependencies: ['@ant-design/icons', 'monaco-editor'],
			keywords: ['experiment', 'portal', 'react', 'visualization'],
			languages: [{ name: 'react', evidence: 'package.json' }],
		}),
	)
	const all = queries.map((q) => q.query)
	assert.ok(!all.includes('react'), `不该单独搜 react：${all.join(' | ')}`)
	assert.ok(!all.includes('experiment'), 'experiment 是结构词')
	assert.ok(!all.includes('portal'), 'portal 是结构词')
	assert.ok(all.some((q) => q.includes('visualization')), '真正的领域词要留下')
	assert.ok(all.every((q) => !q.includes('@') && !q.includes('/')), '检索词不该带 @ 或 /')
})

test('depKeywords：包名要变成能搜的关键词（实测 @scope/ 会让 GitHub 422、HN 0 条）', () => {
	assert.equal(depKeywords('@ant-design/icons'), 'ant design icons')
	assert.equal(depKeywords('react-dom'), 'react dom')
	assert.equal(depKeywords('three'), 'three')
	// 生成的依赖类检索词里不该再出现 @ 或 /
	const queries = deterministicQueries(profile({ dependencies: ['@ant-design/icons', 'react-dom'] }))
	const deps = queries.filter((q) => q.kind === 'dep').map((q) => q.query)
	assert.ok(deps.length > 0)
	for (const d of deps) {
		assert.ok(!d.includes('@') && !d.includes('/'), `依赖检索词不该带 @ 或 /：${d}`)
	}
})

test('isDomainKeyword：代码结构词/文件形态要被挡掉（真实联调里它们污染了检索词）', () => {
	// 真实画像里抽出来的词（mvizlite）
	for (const bad of ['src', 'pages', 'context', 'tech', 'test', 'build', 'scripts', 'lib', 'app', 'node', 'task.md', 'docs/readme', 'the', 'x']) {
		assert.equal(isDomainKeyword(bad), false, `${bad} 不该当领域词`)
	}
	for (const good of ['可视化', '回放', '状态管理', 'time travel', 'lidar', 'pointcloud']) {
		assert.equal(isDomainKeyword(good), true, `${good} 应该是领域词`)
	}
})

test('domainKeywords：保序、限数、把结构词滤掉', () => {
	assert.deepEqual(domainKeywords(['src', '可视化', 'pages', '回放', 'context', '时间轴'], 3), ['可视化', '回放', '时间轴'])
})

test('deterministicQueries：真实画像的关键词不再产出"context 最新进展"这类词', () => {
	const queries = deterministicQueries(
		profile({ keywords: ['context', 'pages', 'src', 'tech', '可视化', '回放'] }),
	)
	const kw = queries.filter((q) => q.kind === 'keyword').map((q) => q.query)
	assert.deepEqual(kw, ['可视化', '回放'], '不要给领域词加中文后缀（英文通道会 0 条）')
})

test('deterministicQueries：limit 生效；极端空画像也不抛异常', () => {
	assert.ok(deterministicQueries(profile(), 2).length <= 2)
	const bare = deterministicQueries({ ...profile(), languages: [], dependencies: [], keywords: [] })
	assert.deepEqual(bare, [], '什么都没有时返回空数组而不是报错')
})

// ---------- 画像指纹 ----------

test('profileHash：相关变化会改指纹，无关变化不会', () => {
	const base = profileHash(profile())
	assert.equal(profileHash(profile()), base, '同样输入要稳定')
	assert.notEqual(profileHash(profile({ dependencies: ['react', 'zustand', 'three'] })), base, '依赖变了要重算')
	assert.notEqual(profileHash(profile({ keywords: ['可视化'] })), base, '关键词变了要重算')
	assert.notEqual(profileHash(profile({ languages: [{ name: 'Rust', evidence: 'Cargo.toml' }] })), base)
	assert.notEqual(profileHash(profile({ summary: '换了口径的摘要' })), base, '画像口径变了要重算')
	// 与检索词无关的字段不该影响：
	assert.equal(profileHash(profile({ bytes: 999999, detectedAt: '2027-01-01T00:00:00.000Z' })), base)
	assert.equal(profileHash(profile({ files: [{ path: 'x', kind: 'doc', bytes: 1, truncated: false }] })), base)
})

test('canReusePlan：画像没变且有计划才能复用', () => {
	const p = profile()
	const plan = { dir: p.dir, profileHash: profileHash(p), generatedAt: '', by: 'ai', queries: [{ query: 'x', kind: 'ai', reason: 'r' }], notes: [] }
	assert.equal(canReusePlan(plan, p), true)
	assert.equal(canReusePlan(plan, profile({ dependencies: ['vue'] })), false, '画像变了不该复用')
	assert.equal(canReusePlan(null, p), false)
	assert.equal(canReusePlan({ ...plan, queries: [] }, p), false, '空计划不该复用')
})

// ---------- 提示词与解析 ----------

test('buildResearchPrompt：带上项目信息，且明确要求 JSON 数组', () => {
	const { system, user } = buildResearchPrompt(profile())
	assert.match(system, /JSON/)
	assert.match(user, /app/)
	assert.match(user, /ant-design/, '提示词里要带上项目依赖')
	assert.ok(user.length < 4000, '提示词要有界')
})

test('parseQueries：能吃下各种脏输出', () => {
	assert.deepEqual(parseQueries('["a b","c d"]'), ['a b', 'c d'])
	assert.deepEqual(parseQueries('```json\n["a b","c d"]\n```'), ['a b', 'c d'])
	assert.deepEqual(
		parseQueries('好的，这是检索词：\n```json\n["react 19","zustand v5"]\n```\n希望有帮助'),
		['react 19', 'zustand v5'],
	)
	assert.deepEqual(parseQueries('["react 19","zustand v5"] 以上'), ['react 19', 'zustand v5'], '数组外有解释')
	assert.deepEqual(parseQueries('{"queries":["react 19"]}'), ['react 19'], '包成对象的也认')
	assert.deepEqual(parseQueries('[{"query":"react 19"},{"query":"vite 6"}]'), ['react 19', 'vite 6'])
	assert.deepEqual(parseQueries('1. react 19\n2. vite 6\n3. zustand v5'), ['react 19', 'vite 6', 'zustand v5'], '带编号列表兜底')
	assert.deepEqual(parseQueries('react 19 迁移\nvite 6 变更'), ['react 19 迁移', 'vite 6 变更'], '无编号的多行也认')
	assert.deepEqual(parseQueries('这里没有任何可用检索词'), [], '单行散文不能被当成一条检索词')
	assert.deepEqual(parseQueries('这是一段解释。\n这是另一段。'), [], '像句子的多行也不认')
	assert.deepEqual(parseQueries(''), [])
	assert.deepEqual(parseQueries('   \n  '), [])
	assert.deepEqual(parseQueries('[[[{' ), [])
	assert.deepEqual(parseQueries('["ab cd","ab cd","AB CD"]'), ['ab cd'], '解析后要去重（大小写不敏感）')
	assert.ok(parseQueries('["1","2","3","4","5"]', 2).length <= 2)
})

// ---------- 生成计划（不抛异常是核心） ----------

test('planResearch：没有模型服务时用确定性种子，并说明原因', async () => {
	const plan = await planResearch(profile(), { stream: null })
	assert.equal(plan.by, 'deterministic')
	assert.ok(plan.queries.length > 0)
	assert.ok(plan.notes.some((n) => n.includes('未提供模型服务')), plan.notes.join('|'))
})

test('planResearch：AI 成功时用 AI 的词打头，种子补足', async () => {
	const plan = await planResearch(profile(), { stream: fakeStream(texts(['["react 19 迁移指南","zustand v5 破坏性变更"]'])) })
	assert.equal(plan.by, 'ai')
	assert.equal(plan.queries[0].query, 'react 19 迁移指南')
	assert.equal(plan.queries[0].kind, 'ai')
	assert.ok(plan.queries.length > 2, '不足的部分应由确定性种子补足')
	assert.ok(
		plan.queries.some((q) => q.kind === 'dep' || q.kind === 'tech' || q.kind === 'keyword'),
		'种子也在里面（保证兜底有内容）',
	)
})

test('planResearch：模型输出跑偏 → 降级且不抛异常', async () => {
	const plan = await planResearch(profile(), { stream: fakeStream(texts(['这里没有任何可用检索词'])) })
	assert.equal(plan.by, 'deterministic')
	assert.ok(plan.queries.length > 0, '降级后仍要有可搜的词')
	assert.ok(plan.notes.some((n) => n.includes('没有解析出')), plan.notes.join('|'))
})

test('planResearch：模型抛错 → 降级并把原因带出来', async () => {
	const plan = await planResearch(profile(), { stream: fakeStream(texts(['x']), { throwAtEnd: 'boom' }) })
	assert.equal(plan.by, 'deterministic')
	assert.ok(plan.notes.some((n) => n.includes('boom')), plan.notes.join('|'))
})

test('planResearch：流以失败结束（reason.failure）→ 当作失败而不是"空输出"', async () => {
	const plan = await planResearch(profile(), {
		stream: fakeStream([
			...texts(['["a b"]']),
			{ type: 'finish', reason: { kind: 'failure', failure: { message: '配额不足', code: 'quota' } } },
		]),
	})
	assert.equal(plan.by, 'deterministic')
	assert.ok(plan.notes.some((n) => n.includes('配额不足')), `应带出真实失败原因：${plan.notes.join('|')}`)
})

test('planResearch：超时会中止并降级（不会永久挂住）', async () => {
	const plan = await planResearch(profile(), {
		stream: fakeStream(texts(['["react 19 迁移"]']), { delayMs: 60 }),
		timeoutMs: 1000,
	})
	assert.equal(plan.by, 'ai', '没超时就该用模型结果')
	// 真正超时的场景：让流比超时还慢（假流会检查 signal.aborted 并抛出）
	const slow = await planResearch(profile(), {
		stream: fakeStream(texts(['["react 19 迁移"]']), { delayMs: 5000 }),
		timeoutMs: 1000,
	})
	assert.equal(slow.by, 'deterministic')
	assert.ok(slow.notes.length > 0)
})

test('planResearch：模型只给少量时说明其余由种子补足；deterministicOnly 不写降级说明', async () => {
	const few = await planResearch(profile(), { stream: fakeStream(texts(['["a b"]'])), count: 5 })
	assert.equal(few.by, 'ai')
	assert.ok(few.notes.some((n) => n.includes('补足')), few.notes.join('|'))

	const forced = await planResearch(profile(), { stream: fakeStream(texts(['["a b"]'])), deterministicOnly: true })
	assert.equal(forced.by, 'deterministic')
	assert.deepEqual(forced.notes, [], '强制确定性时不该写"模型失败"之类的话')
})

test('planResearch：带上画像指纹与目录，供缓存判断使用', async () => {
	const p = profile()
	const plan = await planResearch(p, { stream: null })
	assert.equal(plan.profileHash, profileHash(p))
	assert.equal(plan.dir, p.dir)
	assert.ok(Date.parse(plan.generatedAt) > 0)
})

test('describePlan：一句话说清用了哪条路与多少条', () => {
	const plan = { dir: '/x', profileHash: 'h', generatedAt: '', by: 'ai', queries: [
		{ query: 'a', kind: 'ai', reason: '' },
		{ query: 'b', kind: 'dep', reason: '' },
	], notes: [] }
	const text = describePlan(plan)
	assert.match(text, /2 条/)
	assert.match(text, /AI 生成/)
	assert.match(text, /dep×1/)
})

test('isSpecificQuery：**够长 ≠ 够具体**（实测 dashboard 拉回无关内容）', () => {
	// R60 实测：dashboard 9 个字符、按长度会被判"具体"，但单独去搜回来的是
	// "Guitar Dashboard""family e-paper dashboard"这类与项目无关的内容
	for (const generic of ['dashboard', 'performance', 'security', 'database', 'architecture', 'workflow', 'tutorial', 'benchmark']) {
		assert.equal(isSpecificQuery(generic), false, `${generic} 够长但语义泛，不该单独去搜`)
	}
	// **组合起来就具体了**（这是给这类词的出路，不是一刀切封杀）
	for (const combined of ['dashboard react', 'performance optimization', 'security audit']) {
		assert.equal(isSpecificQuery(combined), true, `${combined} 有上下文，应当算具体`)
	}
	// 真正有辨识度的单词仍然可以单独搜（注意 `visualization` 已在泛词黑名单里）
	// 基础设施名词（docker/kubernetes/git…）本来就在原黑名单里：它们对"搜索"而言太泛
	// 只用**确定不在**原黑名单里的词（`kubernetes`/`echarts`/`zustand` 这些基础设施与
	// 前端框架名本来就在名单里 —— 我写这条断言时连续撞了三次，才意识到该先查名单）
	for (const useful of ['protobuf', 'bufbuild', 'monaco']) {
		assert.equal(isSpecificQuery(useful), true, `${useful} 应当可以单独搜`)
	}
})

test('deterministicQueries：语义泛词不会单独变成检索词', () => {
	const queries = deterministicQueries(profile({ keywords: ['dashboard', '可视化', 'protobuf'] }))
	const all = queries.map((q) => q.query)
	assert.ok(!all.includes('dashboard'), `dashboard 不该单独成词：${all.join(' | ')}`)
	assert.ok(all.every((q) => q.split(/\s+/).length >= 2 || q === '可视化' || q.length >= 7), '留下来的词要么有上下文、要么真有辨识度')
})
