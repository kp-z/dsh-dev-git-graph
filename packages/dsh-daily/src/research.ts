/**
 * 调研检索词：从「项目画像」生成"该去搜什么"。
 *
 * 链条位置：① 项目模型 → ② 项目画像 → ③ **检索词**（本文件）→ ④ 定向检索 → ⑤ 回流项目。
 *
 * ## 为什么"没有模型也要能用"
 * 检索词是整条链的**入口**。如果它强依赖一次模型调用，那么模型超时 / 路由没配 /
 * 输出格式跑偏，都会让"调研"这个功能整体变成不可用 —— 而用户看到的只是"点了没反应"。
 * 所以这里的设计是两层：
 * - **确定性种子**（纯函数，永远可用）：从技术栈、依赖、关键词直接拼出可搜的词
 * - **AI 增强**（可选）：把画像给模型，让它给出更贴合"这个项目缺什么"的检索词
 * AI 失败时**降级而不是失败**，并把降级原因记进 `notes`（用户能在结果里看见为什么是这套词）。
 *
 * ## 为什么缓存键是画像指纹
 * 画像变了（加了依赖、换了技术栈、README 改了口径），检索词就该重新生成；
 * 画像没变就没必要再花一次模型调用。所以用 `profileHash` 当缓存键，而不是靠时间。
 */

import { createHash } from 'node:crypto'
import type { ProjectProfile } from './profile.js'
import type { StreamChunkLike, StreamFn } from './ai.js'

export type QueryKind = 'tech' | 'dep' | 'keyword' | 'ai' | 'peers' | 'risks'

/**
 * **调研章法**：每个维度是"一类问题 + 自己的预算"。
 *
 * 为什么要有维度（用户的意见："链接到项目后需要根据项目搜索，要有章法"）：
 * 早先是**一个扁平列表**（最多 8 条词），谁排前面谁被搜 —— 结果是"依赖"类词经常
 * 把预算吃光，而"风险/坑""同类项目做法"这类**最需要主动去查**的东西一条都没轮到。
 * 有了维度，覆盖就变得**有保证且可解释**：
 * - `budget` 是"最多用几条词"（同时也是最多能占多少请求），任何维度都抢不走别人的份
 * - `label` 是给人看的：结果按维度归位，用户看到的是一份**有条理的调研**，不是一堆链接
 */
export interface ResearchDimension {
	id: QueryKind
	label: string
	/** 这个维度最多用几条检索词（＝预算；防止某个维度把名额吃光）。 */
	budget: number
	/** 这个维度在问什么问题（给用户看，也写进提示词）。 */
	question: string
}

/** 维度顺序 = 展示顺序，也代表优先级（越靠前越贴项目本身）。 */
export const RESEARCH_DIMENSIONS: readonly ResearchDimension[] = [
	{ id: 'keyword', label: '领域关键词', budget: 3, question: '这个项目的领域里最近有什么新东西？' },
	{ id: 'dep', label: '依赖动态', budget: 3, question: '我用到的这些依赖最近有什么变化、升级要注意什么？' },
	{ id: 'tech', label: '技术栈实践', budget: 2, question: '我这套技术栈最近有什么值得采纳的做法？' },
	{ id: 'peers', label: '同类项目', budget: 2, question: '别人在做类似的东西时是怎么做的？' },
	{ id: 'risks', label: '风险与坑', budget: 2, question: '有什么已知的破坏性变更、安全公告、弃用？' },
	{ id: 'ai', label: 'AI 补充', budget: 3, question: '（模型看了项目画像后补充的角度）' },
]

/** 查某个维度的定义（找不到时给一个安全的默认预算）。 */
export function dimensionOf(kind: QueryKind): ResearchDimension {
	return (
		RESEARCH_DIMENSIONS.find((d) => d.id === kind) ?? { id: kind, label: kind, budget: 2, question: '' }
	)
}

export interface ResearchQuery {
	/** 实际拿去搜的字符串。 */
	query: string
	kind: QueryKind
	/** 为什么要搜它 —— 可解释性是这类"自动决定去搜什么"的功能能被信任的前提。 */
	reason: string
}

export interface ResearchPlan {
	dir: string
	/** 生成时画像的指纹；变了就该重新生成。 */
	profileHash: string
	generatedAt: string
	/** 实际用了哪条路。 */
	by: 'ai' | 'deterministic'
	queries: ResearchQuery[]
	/** 降级原因 / 模型说明等，直接展示给用户。 */
	notes: string[]
}

export const QUERY_MAX_CHARS = 60
/**
 * 计划规模 = **各维度预算之和**（当前 12），而不是拍一个数字。
 *
 * 为什么：早先固定 8，于是"按顺序截断"决定了谁被保留 —— 我把 peers/risks 两个维度
 * 加进去之后，tech 维度（排在后面）直接被砍没了（真实回归，被测试逮到）。
 * 规模既然是维度预算的和，**每个维度的份就有保证**，顺序只影响展示。
 */
export const PLAN_QUERY_BUDGET = RESEARCH_DIMENSIONS.reduce((total, d) => total + d.budget, 0)
export const DEFAULT_QUERY_COUNT = PLAN_QUERY_BUDGET

/** 画像指纹：只取会影响检索词的字段，保证"无关变化不触发重新生成"。 */
export function profileHash(profile: ProjectProfile): string {
	const material = JSON.stringify({
		dir: profile.dir,
		languages: profile.languages.map((l) => l.name).sort(),
		deps: [...profile.dependencies].sort(),
		keywords: [...profile.keywords].sort(),
		// README 摘录取前 400 字：口径变了通常这里会变
		readme: (profile.summary ?? '').slice(0, 400),
	})
	return createHash('sha1').update(material).digest('hex').slice(0, 16)
}

/** 清洗一条检索词：压空白、去引号、限长。返回 null 表示不可用。 */
export function cleanQuery(raw: string, maxChars = QUERY_MAX_CHARS): string | null {
	let text = String(raw ?? '')
		.replace(/[\r\n\t]+/g, ' ')
		.replace(/^[\s"'`\-*•\d.、)）]+/, '')
		.replace(/[\s"'`]+$/, '')
		.replace(/\s{2,}/g, ' ')
		.trim()
	if (!text) return null
	// 模型爱写的礼貌性开头：「好的，以下是…」。
	// 判据是**前缀**而不是"总长超过上限"——那种判据对短句根本不触发（写错过一次）。
	// 检索词应该是短语；一旦以这些词开头且长到像个句子，就是格式没遵守，宁可丢掉。
	// 注意 `\b` 只用在 ASCII 备选后面：中文不是 \w，`好的\b` 永远不匹配（写错过一次）
	if (/^(好的|以下是|这是|根据|当然|注意|说明|ok\b|here\b|sure\b)/i.test(text) && text.length > 12) {
		return null
	}
	if (text.length > maxChars) text = text.slice(0, maxChars).trim()
	// 太短的（"AI"、"JS"）搜不出东西；但允许含空格的短语
	if (text.replace(/\s/g, '').length < 2) return null
	return text
}

/** 按小写去重，保留首个（保序）。 */
export function dedupeQueries(list: string[]): string[] {
	const seen = new Set<string>()
	const out: string[] = []
	for (const item of list) {
		const key = item.toLowerCase()
		if (seen.has(key)) continue
		seen.add(key)
		out.push(item)
	}
	return out
}

/**
 * 不是"领域词"的高频词：代码结构、工具链、文件形态。
 *
 * 真实联调时踩到：画像从 package.json 与目录名里抽出的高频词是
 * `context` / `pages` / `src` / `tech` / `task.md` —— 拿它们拼出「context 最新进展」
 * 这种检索词，搜出来的东西和项目毫无关系，等于污染了整条调研链的第一环。
 *
 * 判据是"这个词在**任何**项目里都会高频出现"：它不携带这个项目的信息量。
 */
const NON_DOMAIN_KEYWORDS = new Set([
	'src', 'lib', 'libs', 'dist', 'build', 'builds', 'out', 'output', 'public', 'static', 'assets',
	'node', 'node_modules', 'npm', 'yarn', 'pnpm', 'bun', 'deno', 'npx', 'package', 'packages',
	'module', 'modules', 'import', 'imports', 'export', 'exports', 'require', 'main', 'entry',
	'index', 'app', 'apps', 'core', 'common', 'shared', 'utils', 'util', 'helper', 'helpers',
	'page', 'pages', 'view', 'views', 'component', 'components', 'layout', 'layouts', 'style',
	'styles', 'css', 'less', 'scss', 'html', 'json', 'yaml', 'yml', 'toml', 'lock', 'config',
	'configs', 'conf', 'setting', 'settings', 'env', 'envs', 'dotenv', 'test', 'tests', 'testing',
	'spec', 'specs', 'mock', 'mocks', 'fixture', 'fixtures', 'e2e', 'coverage', 'bench', 'benchmark',
	'docs', 'doc', 'document', 'documents', 'readme', 'changelog', 'license', 'scripts', 'script',
	'task', 'tasks', 'todo', 'todos', 'run', 'dev', 'prod', 'start', 'stop', 'serve', 'watch',
	'vite', 'webpack', 'rollup', 'esbuild', 'babel', 'swc', 'tsc', 'eslint', 'prettier', 'husky',
	'lint', 'commit', 'hook', 'hooks', 'ci', 'cd', 'pipeline', 'pipelines', 'docker', 'dockerfile',
	'git', 'github', 'gitlab', 'branch', 'repo', 'version', 'versioning', 'release', 'releases',
	'tech', 'stack', 'framework', 'framework', 'library', 'libs', 'tool', 'tools', 'tooling',
	// 真实联调里从画像抽出来、又被拿去搜的词（`experiment` 单独搜回来的是
	// 「Pause Giant AI Experiments」「An Experimental Course on Operating Systems」这种毫不相干的东西）
	'experiment', 'experiments', 'experimental', 'demo', 'demos', 'sample', 'samples', 'example',
	'examples', 'portal', 'batch', 'batches', 'chunk', 'chunks', 'temp', 'tmp', 'tmpdir',
	'result', 'results', 'data', 'dataset', 'datasets', 'entry', 'entries', 'item', 'items',
	'list', 'lists', 'table', 'tables', 'detail', 'details', 'base', 'basic', 'default', 'custom',
	'context', 'ctx', 'state', 'store', 'stores', 'hook', 'hooks', 'props', 'render', 'rendering',
	'client', 'server', 'frontend', 'backend', 'fullstack', 'web', 'http', 'https', 'url', 'uri',
	'api', 'apis', 'rest', 'graphql', 'rpc', 'socket', 'ws', 'sdk', 'cli', 'ui', 'ux', 'dom',
	'error', 'errors', 'log', 'logs', 'logger', 'debug', 'info', 'warn', 'warning', 'type', 'types',
	'the', 'and', 'for', 'with', 'use', 'used', 'using', 'new', 'old', 'more', 'most', 'other',
])

/**
 * 把包名变成**检索关键词**：`@ant-design/icons` → `ant design icons`。
 *
 * 为什么要这层：检索通道是关键词匹配（HN Algolia / GitHub 搜索），
 * 而包名带 `@scope/`、连字符、斜杠 —— 实测 `@ant-design/icons changelog release notes`
 * 在 HN 是 0 条、在 GitHub 直接 422（非法字符）。去掉符号并展开连字符后命中率完全不同。
 */
export function depKeywords(name: string): string {
	return name
		.replace(/^@/, '')
		.replace(/[/\\]+/g, ' ')
		.replace(/[-_.]+/g, ' ')
		.replace(/\s{2,}/g, ' ')
		.trim()
}

/** 这个关键词值不值得拿去搜？（过滤结构词、文件形态、纯数字/符号） */
export function isDomainKeyword(word: string): boolean {
	const text = word.trim().toLowerCase()
	if (!text) return false
	if (text.length < 2) return false
	// 文件形态（task.md、a/b）与带扩展名的一律不要
	if (/[./\\]/.test(text)) return false
	if (NON_DOMAIN_KEYWORDS.has(text)) return false
	// 纯 ASCII 的短词（1 个音节级、2-3 字母）信息量太低；CJK 不受此限
	if (/^[a-z]{1,3}$/.test(text)) return false
	return true
}

/**
 * 单独一个词就太泛、搜回来必然不相干的词。
 *
 * 实测：`react` 单独搜回的是「Relicensing React, Jest, Flow…」「Honda conducts successful
 * launch and landing of…」（后者大概是因为页面里有 react 一词）。技术栈名单独当检索词
 * 等于把整个互联网拉回来 —— 它必须**与别的词组合**（如 `typescript best practices`）才有意义。
 */
const TOO_GENERIC_SINGLE: ReadonlySet<string> = new Set([
	'react', 'vue', 'angular', 'svelte', 'solid', 'preact', 'jquery', 'next', 'nuxt', 'remix',
	'vite', 'webpack', 'rollup', 'esbuild', 'babel', 'parcel', 'gulp', 'grunt',
	'node', 'deno', 'bun', 'npm', 'yarn', 'pnpm', 'python', 'java', 'kotlin', 'swift', 'rust',
	'go', 'golang', 'ruby', 'php', 'perl', 'scala', 'elixir', 'dart', 'lua',
	'three', 'd3', 'echarts', 'chart', 'charts', 'grafana', 'canvas', 'webgl', 'opengl',
	'css', 'html', 'scss', 'less', 'tailwind', 'bootstrap', 'antd',
	'docker', 'kubernetes', 'git', 'linux', 'macos', 'windows', 'android', 'ios', 'ubuntu',
	'redux', 'zustand', 'mobx', 'xstate', 'mobx', 'query', 'swr', 'axios', 'fetch',
])

/**
 * 这条检索词**够不够具体**？
 *
 * 判据刻意简单可解释：多词（≥2 段）算具体；单词只在"够长且不是通用技术名"时算具体；
 * 纯中文（≥2 字）算具体 —— 中文两字词在这个项目的语境里通常已经是领域词。
 * 过泛的词**不生成**，而不是生成了再去后悔（后者会白打请求、还会污染结果）。
 */
export function isSpecificQuery(query: string): boolean {
	const text = query.trim()
	if (!text) return false
	if (/^[\u4e00-\u9fa5]{2,}$/.test(text)) return true
	const tokens = text.split(/\s+/).filter(Boolean)
	if (tokens.length >= 2) return true
	const single = tokens[0]?.toLowerCase() ?? ''
	if (!single) return false
	if (TOO_GENERIC_SINGLE.has(single)) return false
	return single.length >= 6
}

/** 从画像关键词里挑出真正的领域词（保序、限数）。 */
export function domainKeywords(keywords: readonly string[], limit = 4): string[] {
	return keywords.filter((word) => isDomainKeyword(word)).slice(0, limit)
}

/**
 * 依赖名归"族"：作用域包按 scope 归（`@ant-design/icons` → `@ant-design`），
 * 普通包按第一段归（`react-dom` → `react`）。
 *
 * 目的是**避免同一族的包占满名额**：搜三次 `@ant-design/*` 的信息量远小于
 * 搜 `@ant-design` + `@antv` + `three` 各一次。
 */
function familyOf(name: string): string {
	if (name.startsWith('@')) {
		const scope = name.split('/')[0]
		return scope || name
	}
	return name.split(/[-.]/)[0] || name
}

/** 按族轮转取名（每族先各取 1 个，不够再放宽到每族 2 个）。保序。 */
export function diversifyByFamily(names: string[], limit: number): string[] {
	const out: string[] = []
	const used = new Map<string, number>()
	for (const cap of [1, 2]) {
		for (const name of names) {
			if (out.length >= limit) return out
			if (out.includes(name)) continue
			const family = familyOf(name)
			if ((used.get(family) ?? 0) >= cap) continue
			out.push(name)
			used.set(family, (used.get(family) ?? 0) + 1)
		}
	}
	return out
}

/**
 * 确定性种子检索词 —— 不依赖模型，任何情况下都能给出可搜的东西。
 *
 * 生成逻辑刻意"贴项目"：依赖名 + changelog/release 这类意图，
 * 比泛泛的"前端最新技术"有用得多（后者搜出来的东西和项目无关）。
 */
export function deterministicQueries(
	profile: ProjectProfile,
	limit = DEFAULT_QUERY_COUNT,
): ResearchQuery[] {
	const out: ResearchQuery[] = []
	// **预算在唯一漏斗处生效**：每个维度最多进它的 budget 条。
	// 这样"谁排前面谁被搜"就不存在了 —— 早先是按顺序截断，我加 peers/risks 时
	// 直接把 tech 挤没了（真实回归）。维度预算才是章法，顺序只影响展示。
	const counts = new Map<QueryKind, number>()
	const push = (query: string, kind: QueryKind, reason: string): void => {
		const budget = dimensionOf(kind).budget
		if ((counts.get(kind) ?? 0) >= budget) return
		const cleaned = cleanQuery(query)
		if (!cleaned) return
		counts.set(kind, (counts.get(kind) ?? 0) + 1)
		out.push({ query: cleaned, kind, reason })
	}

	/**
	 * 顺序 = **信息量从"最贴项目"到"最泛"**：关键词 → 依赖 → 技术栈。
	 *
	 * 这个顺序不是审美问题：合并时会按 count 截断，排在后面的会被砍掉。
	 * 早先把关键词排最后，真实联调时它们**全部被砍**（8 条里 0 条 keyword），
	 * 而"可视化 / 回放 / 状态管理"这类领域词恰恰是这个插件区别于普通新闻源的地方；
	 * "TypeScript best practices" 反而是任何 TS 项目都能用的泛泛之词。
	 */
	// 1) 关键词：项目自己的领域词。
	// **必须先过滤结构词**：画像抽到的高频词里混着 `src` / `pages` / `context` 这类
	// 任何项目都会高频出现的词，拿它们拼检索词等于污染整条链的第一环。
	for (const word of domainKeywords(profile.keywords, 4)) {
		// **不加中文后缀**：`experiment 最新进展` 这种混血词在英文通道（HN/GitHub）上
		// 照样返回 0 条 —— 而且因为 ASCII 占比够高，还会绕过"中文词"过滤白白发出去。
		// 纯词本身反而能命中（`typescript best practices` 实测 HN 3 / GitHub 2402）。
		if (isSpecificQuery(word)) push(word, 'keyword', `项目里的领域词「${word}」`)
	}
	// 2) 依赖：查它们的版本动态。必须**按族去重** —— 真实项目里
	// @ant-design/icons、@ant-design/plots、@ant-design/pro-components 连着排在前几位，
	// 直接取前 3 个等于用三次搜索问同一件事（真实联调时看到的）。
	const runtimeDeps = profile.dependencies.filter(
		(d) => !/^(@types\/|eslint|prettier|jest|vitest|mocha|typescript$)/.test(d),
	)
	for (const dep of diversifyByFamily(runtimeDeps, 3)) {
		// **短关键词，不要自然语言**：实测 `@ant-design/icons changelog release notes`
		// 在 HN 返回 0 条、在 GitHub 直接 422（`@`/`/` 非法）；换成 `ant design icons`
		// 则 HN 3 条、GitHub 102 条。检索通道吃的是关键词，不是句子。
		const depQuery = depKeywords(dep)
		if (isSpecificQuery(depQuery)) push(depQuery, 'dep', `项目依赖 ${dep}，查它的项目与版本动态`)
	}
	// 3) 技术栈：最泛，兜底用
	// 同类项目：别人怎么做的（换工具/抄做法时最有用的那类信息）
	// 同类项目：走**仓库**通道，所以用 GitHub 认的限定词（限定字段 + 质量门槛），
	// 而不是 `react alternatives` 这种自然语言（实测在仓库搜索上命中很差）
	for (const word of domainKeywords(profile.keywords, 2)) {
		const peers = `${word} in:name,description stars:>50`
		if (isSpecificQuery(peers)) push(peers, 'peers', `找 ${word} 方向上 star 较多的同类项目`)
	}
	for (const dep of diversifyByFamily(runtimeDeps, 1)) {
		const kw = depKeywords(dep)
		if (isSpecificQuery(kw)) push(`${kw} in:name,description`, 'peers', `看别人在 ${dep} 这块做了什么`)
	}

	// 风险与坑：走 **issues/PR** 通道（那里的信息实际存在），措辞也要对着 issue 文本
	for (const dep of diversifyByFamily(runtimeDeps, 2)) {
		const kw = depKeywords(dep)
		if (isSpecificQuery(kw)) push(`${kw} breaking change`, 'risks', `查 ${dep} 有无破坏性变更/弃用`)
	}

	for (const lang of profile.languages.slice(0, 2)) {
		// 与限定词组合才有意义：`react` 单独搜等于把整个互联网拉回来
		const techQuery = `${depKeywords(lang.name)} best practices`
		if (isSpecificQuery(techQuery)) push(techQuery, 'tech', `项目技术栈是 ${lang.name}`)
	}

	return dedupeQueries(out.map((q) => q.query))
		.slice(0, limit)
		.map((query) => out.find((q) => q.query === query) as ResearchQuery)
}

/** 给模型的提示词。刻意要 JSON 数组：比"每行一条"更不容易被模型的解释性文字污染。 */
export function buildResearchPrompt(
	profile: ProjectProfile,
	count = DEFAULT_QUERY_COUNT,
): { system: string; user: string } {
	const system = [
		'你是一个技术调研助手。根据给出的项目画像，产出**用于搜索的检索词**。',
		'要求：',
		`1. 只输出一个 JSON 字符串数组，最多 ${count} 条，不要任何解释文字、不要 markdown 代码块。`,
		`2. 每条是一个检索词/短语（不是句子），不超过 ${QUERY_MAX_CHARS} 个字符。`,
		'3. 目标是"这个项目接下来会遇到的新知识"：依赖的版本变更、技术栈的官方实践、领域内的新方案。',
		'4. 不要输出项目自己的名字；不要把项目里已有的实现当作待查问题。',
		'5. 与项目相关，避免"人工智能最新进展"这类泛泛之词。',
		// 实测教训：第一版没写这条，模型给的全是中文词，而检索通道（HN/GitHub）是英文语料
		// —— 12 次请求全 200 却 0 条结果，且不报错。所以语言要求必须显式写进提示词。
		'6. **用英文写检索词**（技术名词保持原样即可）：检索目标是 Hacker News 与 GitHub，都是英文语料；',
		'   中文检索词在这两个通道上只会返回 0 条，且不会报错。',
	].join('\n')

	const deps = profile.dependencies.slice(0, 25).join(', ') || '（未发现）'
	const user = [
		`项目：${profile.name}`,
		`技术栈：${profile.languages.map((l) => l.name).join('、') || '（未识别）'}`,
		`依赖：${deps}`,
		`关键词：${profile.keywords.join('、') || '（无）'}`,
		'',
		'项目画像原文（可能被截断）：',
		// 画像摘要本身已经是**有界**的（见 profile.ts），这里再兜一道
		(profile.summary ?? '').slice(0, 3000),
	].join('\n')

	return { system, user }
}

/**
 * 解析模型输出成检索词列表。**要能吃下各种脏输出**：
 * ```json\n[...]\n``` 代码块、前后带解释、单个带编号的列表、以及"JSON 里混了对象"。
 * 解析不出来就返回空数组，由调用方决定降级 —— 这里不抛异常。
 */
export function parseQueries(raw: string, limit = DEFAULT_QUERY_COUNT): string[] {
	const text = String(raw ?? '')
	if (!text.trim()) return []

	const collected: string[] = []

	// 1) 直接当 JSON 试
	const tryJson = (candidate: string): string[] | null => {
		try {
			const parsed = JSON.parse(candidate)
			if (Array.isArray(parsed)) {
				return parsed
					.map((x) => (typeof x === 'string' ? x : x && typeof x === 'object' ? String((x as Record<string, unknown>).query ?? (x as Record<string, unknown>).q ?? '') : ''))
					.filter(Boolean)
			}
			if (parsed && typeof parsed === 'object') {
				const value = (parsed as Record<string, unknown>).queries
				if (Array.isArray(value)) return value.map((x) => String(x)).filter(Boolean)
			}
		} catch {
			/* 不是 JSON，继续 */
		}
		return null
	}

	const direct = tryJson(text)
	if (direct) collected.push(...direct)

	// 2) 代码块里的 JSON
	if (collected.length === 0) {
		for (const match of text.matchAll(/```(?:json)?\s*([\s\S]*?)```/g)) {
			const inner = tryJson(match[1].trim())
			if (inner) collected.push(...inner)
		}
	}

	// 3) 兜底：JSON 里的字符串字面量（模型常在数组外面写解释）
	if (collected.length === 0) {
		const fromArray = text.match(/\[[\s\S]*\]/)
		if (fromArray) {
			for (const match of fromArray[0].matchAll(/"((?:[^"\\]|\\.)*)"/g)) collected.push(match[1])
		}
	}

	/**
	 * 4) 最后兜底：未经结构化的多行列表。
	 *
	 * **刻意收紧**：只在"≥2 行、且每行不像句子"时才收。
	 * 早先无条件按行取，于是模型回一句「这里没有任何可用检索词」也会被当成一条检索词
	 * —— 用户会拿到一条毫无意义的搜索词，而且完全看不出模型其实没按格式回答。
	 * 单行长文本一律判为格式失败 → 交给调用方降级（宁可降级，不要静默收垃圾）。
	 */
	if (collected.length === 0) {
		const lines = text
			.split('\n')
			.map((line) => line.trim())
			.filter(Boolean)
		if (lines.length >= 2 && lines.every((line) => !/[。！？!?]$/.test(line))) {
			for (const line of lines) collected.push(line)
		}
	}

	const cleaned = collected
		.map((item) => cleanQuery(item))
		.filter((item): item is string => item !== null)
		.filter((item) => !/^[[\]{},]+$/.test(item))

	return dedupeQueries(cleaned).slice(0, limit)
}

export interface PlanResearchOptions {
	stream?: StreamFn | null
	provider?: string
	model?: string
	count?: number
	timeoutMs?: number
	maxTokens?: number
	/** 强制只走确定性种子（测试/降级路径用）。 */
	deterministicOnly?: boolean
	now?: () => Date
}

/**
 * 从流里抽出文本与失败原因 —— 与 ai.ts 摘要路径同一套 chunk 约定
 * （`{ type, text?, reason?: { failure?: { message?, code? } } }`），避免两处理解不一致。
 *
 * 特别处理 `reason.failure`：流"正常结束"不代表成功，失败信息藏在终止原因里；
 * 只看 text 会把一次失败当成"模型给了空输出"，排查时看到的原因就是错的。
 */
function readChunks(chunks: StreamChunkLike[]): { text: string; failure: string | null } {
	let text = ''
	let failure: string | null = null
	for (const chunk of chunks) {
		if (!chunk || typeof chunk !== 'object') continue
		if (typeof chunk.text === 'string') text += chunk.text
		const fail = chunk.reason?.failure
		if (fail) failure = fail.message || fail.code || '模型流以失败结束'
	}
	return { text, failure }
}

/**
 * 生成调研计划：AI 优先，失败/不可用时降级到确定性种子。
 * **永不抛异常** —— 入口环节抛异常等于整个功能不可用。
 */
export async function planResearch(
	profile: ProjectProfile,
	options: PlanResearchOptions = {},
): Promise<ResearchPlan> {
	const count = Math.max(1, options.count ?? DEFAULT_QUERY_COUNT)
	const seed = deterministicQueries(profile, count)
	const now = (options.now ?? (() => new Date()))()
	const base: ResearchPlan = {
		dir: profile.dir,
		profileHash: profileHash(profile),
		generatedAt: now.toISOString(),
		by: 'deterministic',
		queries: seed,
		notes: [],
	}

	const stream = options.stream
	if (options.deterministicOnly || !stream) {
		if (!options.deterministicOnly) base.notes.push('宿主未提供模型服务，本条使用确定性种子检索词')
		return base
	}

	const prompt = buildResearchPrompt(profile, count)
	const controller = new AbortController()
	const timer = setTimeout(() => controller.abort(), Math.max(1000, options.timeoutMs ?? 30_000))
	let raw = ''
	try {
		const chunks: StreamChunkLike[] = []
		for await (const chunk of stream({
			provider: options.provider ?? '',
			model: options.model ?? '',
			system: prompt.system,
			messages: [{ role: 'user', content: prompt.user }],
			// 检索词是短 JSON，但要给推理模型留够"思考"预算（推理 token 与正文共享上限）
			maxTokens: Math.max(256, options.maxTokens ?? 1200),
			signal: controller.signal,
		})) {
			chunks.push(chunk)
		}
		const read = readChunks(chunks)
		if (read.failure) {
			base.notes.push(`模型流以失败结束，已降级为确定性种子检索词：${read.failure}`)
			return base
		}
		raw = read.text
	} catch (error) {
		base.notes.push(
			`模型调用失败，已降级为确定性种子检索词：${error instanceof Error ? error.message : String(error)}`,
		)
		return base
	} finally {
		clearTimeout(timer)
	}

	const parsed = parseQueries(raw, count)
	if (parsed.length === 0) {
		base.notes.push('模型输出里没有解析出可用检索词，已降级为确定性种子')
		return base
	}

	// 合并：AI 的词在前（更贴合"缺什么"），确定性种子补足数量并保证兜底
	const aiQueries: ResearchQuery[] = parsed.map((query) => ({
		query,
		kind: 'ai',
		reason: '模型依据项目画像生成',
	}))
	const merged = dedupeQueries([...aiQueries, ...seed].map((q) => q.query))
		.slice(0, count)
		.map((query) => [...aiQueries, ...seed].find((q) => q.query === query) as ResearchQuery)

	base.by = 'ai'
	base.queries = merged
	if (parsed.length < count) {
		base.notes.push(`模型给出 ${parsed.length} 条，其余 ${count - parsed.length} 条由确定性种子补足`)
	}
	return base
}

/** 计划是否可以复用（画像没变 + 有检索词）。 */
export function canReusePlan(plan: ResearchPlan | null, profile: ProjectProfile): boolean {
	if (!plan || !Array.isArray(plan.queries) || plan.queries.length === 0) return false
	return plan.profileHash === profileHash(profile)
}

/** 一行话描述计划，供日志与工具输出用。 */
export function describePlan(plan: ResearchPlan): string {
	const kinds = plan.queries.reduce<Record<string, number>>((acc, q) => {
		acc[q.kind] = (acc[q.kind] ?? 0) + 1
		return acc
	}, {})
	const detail = Object.entries(kinds)
		.map(([kind, n]) => `${kind}×${n}`)
		.join(' ')
	return `${plan.queries.length} 条检索词（${plan.by === 'ai' ? 'AI 生成' : '确定性种子'}${detail ? '，' + detail : ''}）`
}
