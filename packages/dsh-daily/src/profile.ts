/**
 * 项目画像：从项目工作目录里抽出一小段"这个项目是什么"的描述。
 *
 * 它是调研链条的第二环（① 项目模型 → ② **项目画像** → ③ AI 检索词 → ④ 定向检索 → ⑤ 回流项目）。
 * 日报不需要它（源是固定的），调研必须靠它 —— 因为"与项目有关"这个词，
 * 只有看了项目本身才知道指什么。
 *
 * ## 三条硬约束（都来自"这份数据会被送进模型"这个事实）
 *
 * 1. **绝不读敏感文件**。`.env*`、`*.pem`、`id_rsa*`、`credentials*`、`.npmrc`、`.git-credentials`…
 *    这些一旦被塞进 prompt，就等于把密钥交给了模型服务商。按**文件名**先挡一道，
 *    而不是"读了再过滤"——不读才是真的安全。
 * 2. **有界**。单文件 64KB / 总计 256KB / 最多 24 个文件。项目目录里可能有几个 G 的目录，
 *    不能因为"想了解项目"就把整个仓库读一遍。
 * 3. **可审计**。返回里明确列出**读了哪些文件、跳过了什么、为什么跳过**。
 *    用户有权知道插件为了"了解项目"到底看了什么 —— 这也是上面两条能被检验的前提。
 *
 * ## 为什么不用 AI 来做这一步
 * 抽语言、读依赖、统计高频词都是确定性的活儿，用模型做既慢又可能编。
 * 模型应该用在更难的地方：**从画像生成检索词**（③）。
 */

import { readFile, readdir } from 'node:fs/promises'
import { basename, join } from 'node:path'
import { normalizeDir } from './project.js'

export interface ProfileOptions {
	/** 单文件最多读多少字节。 */
	maxFileBytes?: number
	/** 总计最多读多少字节（含 README 摘录）。 */
	maxTotalBytes?: number
	/** 最多读多少个文件。 */
	maxFiles?: number
	/** 关键词数量上限。 */
	maxKeywords?: number
	/** README 摘录长度上限（字符）。 */
	readmeChars?: number
}

const DEFAULTS: Required<ProfileOptions> = {
	maxFileBytes: 64 * 1024,
	maxTotalBytes: 256 * 1024,
	maxFiles: 24,
	maxKeywords: 24,
	readmeChars: 1200,
}

/**
 * 敏感文件名。**先按名字挡，不读**。
 * 宁可漏掉一点信息，也不能把凭据送出去。
 */
const SENSITIVE_PATTERNS: RegExp[] = [
	/^\.env(\..*)?$/i,
	/\.env$/i,
	/^\.npmrc$/i,
	/^\.netrc$/i,
	/^\.git-credentials$/i,
	/^id_(rsa|dsa|ecdsa|ed25519)(\.pub)?$/i,
	/\.(pem|key|p12|pfx|jks|keystore)$/i,
	/^credentials?(\.|$)/i,
	/^secrets?(\.|$)/i,
	/^\.aws$/i,
	/^\.ssh$/i,
	/^service-account.*\.json$/i,
	/^\.htpasswd$/i,
	/^\.dockercfg$/i,
	/^config\.json$/i, // 有些工具把 token 放这里；宁可跳过
]

/** 大目录 / 生成物 / 依赖：读它们既没信息量又可能几万个文件。 */
const SKIP_DIRS = new Set([
	'node_modules',
	'.git',
	'.hg',
	'.svn',
	'dist',
	'build',
	'out',
	'target',
	'.next',
	'.nuxt',
	'.turbo',
	'.cache',
	'coverage',
	'vendor',
	'.venv',
	'venv',
	'__pycache__',
	'.pnpm-store',
	'.idea',
	'.vscode',
	'Pods',
	'DerivedData',
])

/** 锁文件：体积大、信息量（对"项目是什么"而言）几乎为零。 */
const SKIP_FILES = new Set([
	'package-lock.json',
	'pnpm-lock.yaml',
	'yarn.lock',
	'bun.lockb',
	'Cargo.lock',
	'poetry.lock',
	'Pipfile.lock',
	'go.sum',
	'composer.lock',
])

/** 会被读进去的文件（按优先级排序）。 */
const INTERESTING: Array<{ name: string; kind: ProfileFileKind; weight: number }> = [
	{ name: 'README.md', kind: 'readme', weight: 0 },
	{ name: 'README.zh.md', kind: 'readme', weight: 1 },
	{ name: 'README.zh_CN.md', kind: 'readme', weight: 2 },
	{ name: 'readme.md', kind: 'readme', weight: 3 },
	{ name: 'AGENTS.md', kind: 'doc', weight: 4 },
	{ name: 'CLAUDE.md', kind: 'doc', weight: 5 },
	{ name: 'package.json', kind: 'manifest', weight: 6 },
	{ name: 'pyproject.toml', kind: 'manifest', weight: 7 },
	{ name: 'requirements.txt', kind: 'manifest', weight: 8 },
	{ name: 'Cargo.toml', kind: 'manifest', weight: 9 },
	{ name: 'go.mod', kind: 'manifest', weight: 10 },
	{ name: 'pom.xml', kind: 'manifest', weight: 11 },
	{ name: 'build.gradle', kind: 'manifest', weight: 12 },
	{ name: 'CMakeLists.txt', kind: 'manifest', weight: 13 },
	{ name: 'tsconfig.json', kind: 'config', weight: 14 },
	{ name: 'Makefile', kind: 'config', weight: 15 },
	{ name: 'docker-compose.yml', kind: 'config', weight: 16 },
	{ name: 'Dockerfile', kind: 'config', weight: 17 },
]

export type ProfileFileKind = 'readme' | 'manifest' | 'doc' | 'config'

export interface ProfileFile {
	/** 相对项目目录的路径。 */
	path: string
	kind: ProfileFileKind
	bytes: number
	/** 是否被截断（只读了前 N 字节）。 */
	truncated: boolean
}

export interface SkippedFile {
	path: string
	reason: string
}

export interface ProjectProfile {
	dir: string
	name: string
	detectedAt: string
	/** 实际读了哪些文件 —— 可审计。 */
	files: ProfileFile[]
	/** 跳过了什么、为什么 —— 尤其是敏感文件。 */
	skipped: SkippedFile[]
	/** 顶层结构（只有名字，不递归）。 */
	topLevel: string[]
	languages: Array<{ name: string; evidence: string }>
	dependencies: string[]
	keywords: string[]
	/** 总字节数。 */
	bytes: number
	/** 给模型看的纯文本（有界）。 */
	summary: string
}

export function isSensitiveName(name: string): boolean {
	return SENSITIVE_PATTERNS.some((pattern) => pattern.test(name))
}

export function shouldSkipDir(name: string): boolean {
	// 隐藏目录默认跳过（.github 例外：它含 CI 配置，能说明项目形态）
	return SKIP_DIRS.has(name) || (name.startsWith('.') && name !== '.github')
}

export function shouldSkipFile(name: string): boolean {
	return SKIP_FILES.has(name) || isSensitiveName(name)
}

/** 极简停用词（英文）——只为了不让 "the/and/with" 挤掉真正的领域词。 */
const STOPWORDS = new Set([
	'the', 'and', 'for', 'with', 'that', 'this', 'from', 'are', 'was', 'were', 'have', 'has', 'had',
	'not', 'but', 'you', 'your', 'can', 'will', 'would', 'should', 'could', 'there', 'their', 'them',
	'then', 'than', 'when', 'what', 'which', 'while', 'into', 'onto', 'over', 'under', 'about', 'more',
	'most', 'some', 'such', 'only', 'also', 'just', 'like', 'use', 'used', 'using', 'uses', 'all',
	'any', 'each', 'other', 'these', 'those', 'how', 'why', 'who', 'whom', 'its', 'it', 'is', 'be',
	'been', 'being', 'do', 'does', 'did', 'done', 'of', 'to', 'in', 'on', 'at', 'by', 'as', 'or',
	'if', 'so', 'no', 'yes', 'up', 'down', 'out', 'off', 'new', 'old', 'one', 'two', 'per', 'via',
	'run', 'running', 'make', 'makes', 'made', 'get', 'gets', 'set', 'sets', 'see', 'sees', 'let',
	'add', 'adds', 'added', 'need', 'needs', 'want', 'wants', 'work', 'works', 'working', 'file',
	'files', 'dir', 'dirs', 'path', 'paths', 'name', 'names', 'list', 'lists', 'item', 'items',
	'http', 'https', 'www', 'com', 'org', 'github', 'gitlab', 'readme', 'license', 'npm', 'yaml',
	'json', 'html', 'true', 'false', 'null', 'undefined', 'function', 'const', 'let', 'return',
	'import', 'export', 'default', 'string', 'number', 'object', 'array', 'type', 'types',
])

/**
 * 确定性关键词抽取：ASCII 单词（长度 ≥3，去停用词）+ CJK 双字组。
 *
 * 不做词干化、不做 TF-IDF —— 这是"给模型一点线索"，不是搜索引擎。
 * 顺序稳定（按出现次数、再按字典序），方便测试与复现。
 */
export function extractKeywords(text: string, limit = 24): string[] {
	const counts = new Map<string, number>()
	const bump = (token: string): void => {
		counts.set(token, (counts.get(token) ?? 0) + 1)
	}

	// ASCII 词
	for (const match of text.toLowerCase().matchAll(/[a-z][a-z0-9+#._-]{2,}/g)) {
		const token = match[0].replace(/[._-]+$/, '')
		if (token.length < 3 || STOPWORDS.has(token)) continue
		if (/^\d+$/.test(token)) continue
		bump(token)
	}

	// CJK：取连续汉字段里的双字组（粗略分词，但对"领域词"够用）
	for (const match of text.matchAll(/[\u4e00-\u9fa5]{2,}/g)) {
		const run = match[0]
		for (let i = 0; i + 2 <= run.length; i++) {
			const gram = run.slice(i, i + 2)
			if (STOPWORDS.has(gram)) continue
			bump(gram)
		}
	}

	return [...counts.entries()]
		.sort((a, b) => (b[1] - a[1]) || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
		.slice(0, Math.max(0, limit))
		.map(([token]) => token)
}

const LANGUAGE_MARKERS: Array<{ name: string; files: string[] }> = [
	{ name: 'TypeScript', files: ['tsconfig.json'] },
	{ name: 'Node.js', files: ['package.json'] },
	{ name: 'Python', files: ['pyproject.toml', 'requirements.txt', 'setup.py', 'Pipfile'] },
	{ name: 'Rust', files: ['Cargo.toml'] },
	{ name: 'Go', files: ['go.mod'] },
	{ name: 'Java/Kotlin', files: ['pom.xml', 'build.gradle', 'build.gradle.kts'] },
	{ name: 'C/C++', files: ['CMakeLists.txt', 'meson.build'] },
	{ name: 'Swift', files: ['Package.swift'] },
	{ name: 'Ruby', files: ['Gemfile'] },
	{ name: 'PHP', files: ['composer.json'] },
]

/** 从 package.json 里取依赖名（不取版本号：版本对"项目在做什么"没意义，还占体积）。 */
export function depsFromPackageJson(raw: unknown, limit = 40): string[] {
	if (!raw || typeof raw !== 'object') return []
	const source = raw as Record<string, unknown>
	const groups = ['dependencies', 'peerDependencies', 'devDependencies']
	const names: string[] = []
	for (const group of groups) {
		const deps = source[group]
		if (!deps || typeof deps !== 'object') continue
		for (const name of Object.keys(deps as Record<string, unknown>)) {
			if (!names.includes(name)) names.push(name)
		}
	}
	// 运行时依赖比开发依赖更能说明"这个项目是什么"，所以先收集的天然在前
	return names.slice(0, limit)
}

/** 看起来像二进制就别读（null 字节是最省事的判据）。 */
function looksBinary(buffer: Buffer): boolean {
	const limit = Math.min(buffer.length, 8000)
	for (let i = 0; i < limit; i++) if (buffer[i] === 0) return true
	return false
}

function clip(text: string, max: number): string {
	if (text.length <= max) return text
	return `${text.slice(0, max)}…`
}

/**
 * 采集项目画像。
 *
 * 只读**顶层**的少量已知文件 + 顶层目录名 —— 不做递归扫描。
 * 想知道"这个项目是什么"，README 与 manifest 的信息量远大于遍历源码。
 */
export async function collectProjectProfile(
	dir: string,
	options: ProfileOptions = {},
): Promise<ProjectProfile> {
	const cfg = { ...DEFAULTS, ...options }
	const root = normalizeDir(dir)
	const detectedAt = new Date().toISOString()
	const files: ProfileFile[] = []
	const skipped: SkippedFile[] = []
	let totalBytes = 0

	// ---- 顶层条目 ----
	let entries: Array<{ name: string; isDirectory: boolean }> = []
	try {
		// 用 withFileTypes：**先分清是文件还是目录，再套各自的跳过规则**。
		// 踩过的坑：早先把"点开头的条目"一律当目录跳过，于是 `.env` 走了目录分支 ——
		// 敏感文件检查被绕过、审计记录里也没有它（内容确实没读，但审计链断了）。
		entries = (await readdir(root, { withFileTypes: true }))
			.map((entry) => ({ name: entry.name, isDirectory: entry.isDirectory() }))
			.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
	} catch (error) {
		return {
			dir: root,
			name: basename(root),
			detectedAt,
			files: [],
			skipped: [{ path: '.', reason: `无法读取目录：${error instanceof Error ? error.message : String(error)}` }],
			topLevel: [],
			languages: [],
			dependencies: [],
			keywords: [],
			bytes: 0,
			summary: `（无法读取项目目录 ${root}）`,
		}
	}

	const dirNames: string[] = []
	const fileNames: string[] = []
	for (const entry of entries) {
		const { name, isDirectory } = entry
		if (isDirectory) {
			// 目录只记名字、不进去（"有 node_modules / dist"本身就是信息）
			dirNames.push(name)
			continue
		}
		// 到这里一定是文件 —— 敏感文件名必须走这条分支被记录下来
		if (isSensitiveName(name)) {
			skipped.push({ path: name, reason: '敏感文件（绝不读取，避免把凭据送进模型）' })
			continue
		}
		if (shouldSkipFile(name)) {
			skipped.push({ path: name, reason: '锁文件/无信息量' })
			continue
		}
		fileNames.push(name)
	}

	// 摘要里列的是"项目长什么样"；敏感文件名（哪怕是名字）不进摘要更稳妥
	const topLevel = [...dirNames, ...fileNames]
		.filter((name) => !isSensitiveName(name))
		.sort()

	// ---- 按优先级读已知文件 ----
	const picked = INTERESTING.filter((item) => fileNames.includes(item.name)).sort(
		(a, b) => a.weight - b.weight,
	)
	const texts = new Map<string, string>()

	for (const item of picked) {
		if (files.length >= cfg.maxFiles) {
			skipped.push({ path: item.name, reason: `已达文件数上限（${cfg.maxFiles}）` })
			continue
		}
		if (totalBytes >= cfg.maxTotalBytes) {
			skipped.push({ path: item.name, reason: `已达总字节上限（${cfg.maxTotalBytes}）` })
			continue
		}
		try {
			const buffer = await readFile(join(root, item.name))
			if (looksBinary(buffer)) {
				skipped.push({ path: item.name, reason: '二进制文件' })
				continue
			}
			const budget = Math.min(cfg.maxFileBytes, cfg.maxTotalBytes - totalBytes)
			const truncated = buffer.length > budget
			const slice = buffer.subarray(0, budget)
			const text = slice.toString('utf8')
			texts.set(item.name, text)
			files.push({ path: item.name, kind: item.kind, bytes: slice.length, truncated })
			totalBytes += slice.length
		} catch (error) {
			skipped.push({ path: item.name, reason: `读取失败：${error instanceof Error ? error.message : String(error)}` })
		}
	}

	// ---- 语言/技术栈（靠文件标记，确定性） ----
	const present = new Set(fileNames)
	const languages: Array<{ name: string; evidence: string }> = []
	for (const marker of LANGUAGE_MARKERS) {
		const hit = marker.files.find((file) => present.has(file))
		if (hit) languages.push({ name: marker.name, evidence: hit })
	}
	/**
	 * 顶层目录作为**兜底**证据（项目没有 manifest 时）。
	 *
	 * 只留 `cmd` + `internal` 这一组：它们基本只在 Go 项目里成对出现。
	 * 早先还写了「`src/` → Python」，实测立刻误报 —— 本插件自己是 TypeScript 项目、
	 * 顶层同样有 `src/`。这段文本是要送进模型的，**报错比不报更糟**（模型会顺着错误前提去搜）。
	 */
	if (!languages.some((l) => l.name === 'Go') && dirNames.includes('cmd') && dirNames.includes('internal')) {
		languages.push({ name: 'Go', evidence: '顶层目录 cmd/ 与 internal/' })
	}

	// ---- 依赖（只取名字） ----
	let dependencies: string[] = []
	const pkgText = texts.get('package.json')
	if (pkgText) {
		try {
			dependencies = depsFromPackageJson(JSON.parse(pkgText))
		} catch {
			/* package.json 坏了不影响画像 */
		}
	}

	// ---- 关键词 ----
	const corpus = [
		...[...texts.entries()].map(([name, text]) => `${name}\n${text}`),
		dirNames.join(' '),
	]
		.join('\n')
		.slice(0, 40_000)
	const keywords = extractKeywords(corpus, cfg.maxKeywords)

	// ---- 给模型看的摘要 ----
	const readmeName = ['README.md', 'README.zh.md', 'README.zh_CN.md', 'readme.md'].find((n) =>
		texts.has(n),
	)
	const readmeExcerpt = readmeName
		? clip(
				// 去掉徽章/图片/纯链接行，留下真正的文字描述
				(texts.get(readmeName) ?? '')
					.split('\n')
					.filter((line) => {
						const t = line.trim()
						if (!t) return false
						if (/^!\[/.test(t) || /^\[!\[/.test(t)) return false
						if (/^<img/i.test(t) || /^<p align/i.test(t)) return false
						return true
					})
					.join('\n')
					.replace(/\n{3,}/g, '\n\n'),
				cfg.readmeChars,
			)
		: ''

	const lines: string[] = [
		`项目：${basename(root)}`,
		`工作目录：${root}`,
		languages.length > 0
			? `技术栈：${languages.map((l) => `${l.name}（${l.evidence}）`).join('、')}`
			: '技术栈：（未从顶层文件识别出来）',
		dependencies.length > 0 ? `主要依赖：${dependencies.slice(0, 30).join(', ')}` : '主要依赖：（未发现）',
		keywords.length > 0 ? `关键词：${keywords.join('、')}` : '关键词：（未提取到）',
		`顶层结构：${topLevel.slice(0, 40).join(', ') || '（空）'}`,
	]
	if (readmeExcerpt) {
		lines.push('', `README 摘录：`, readmeExcerpt)
	}
	lines.push(
		'',
		`（画像依据：读了 ${files.length} 个文件 / ${(totalBytes / 1024).toFixed(1)}KB；` +
			`跳过 ${skipped.length} 项，其中敏感文件 ${skipped.filter((s) => s.reason.includes('敏感')).length} 个）`,
	)

	return {
		dir: root,
		name: basename(root),
		detectedAt,
		files,
		skipped,
		topLevel,
		languages,
		dependencies,
		keywords,
		bytes: totalBytes,
		summary: lines.join('\n'),
	}
}

/** 把画像压成一行供日志/工具输出用。 */
export function describeProfile(profile: ProjectProfile): string {
	const languages = profile.languages.map((l) => l.name).join('/') || '未知技术栈'
	const sensitive = profile.skipped.filter((s) => s.reason.includes('敏感')).length
	return (
		`${profile.name}：${languages} · 读了 ${profile.files.length} 个文件（${(profile.bytes / 1024).toFixed(1)}KB）· ` +
		`关键词 ${profile.keywords.length} 个${sensitive > 0 ? ` · 已跳过 ${sensitive} 个敏感文件` : ''}`
	)
}

/**
 * 关键词的**用户编辑**（tag 化的数据层）。
 *
 * 设计取舍：用户编辑是**整体覆盖**而不是"在自动结果上打补丁"。
 * 因为"删除 + 添加 + 修改"三种操作在覆盖模型下都是同一件事（给出最终列表），
 * 而补丁模型要维护 removed/added/renamed 三份状态，迟早会不一致。
 * 想回到自动结果就调 `reset` —— 这是本项目"显式优先于推断"的一贯做法。
 */
export interface KeywordOverride {
	keywords: string[]
	editedAt: string
}

/** 归一化用户给的关键词列表：去空白、去重（不区分大小写）、限长限量。 */
export function normalizeKeywordList(raw: unknown): string[] | null {
	if (!Array.isArray(raw)) return null
	const out: string[] = []
	const seen = new Set<string>()
	for (const entry of raw) {
		if (typeof entry !== 'string') continue
		const text = entry.trim().replace(/\s+/g, ' ')
		if (text.length < 2 || text.length > 40) continue
		const key = text.toLowerCase()
		if (seen.has(key)) continue
		seen.add(key)
		out.push(text)
		if (out.length >= 40) break
	}
	return out
}

/**
 * 把用户编辑应用到自动抽取的关键词上。
 *
 * **用户的关键词不再过 `isMatchableTerm`**：那条过滤是"我替你判断这个词没用"，
 * 而用户明确写下来的词就是**显式意图** —— 显式优先于推断（否则会出现
 * "我加了 `数据` 但它没生效"这种无法解释的行为）。
 */
export function applyKeywordOverride(auto: readonly string[], override: KeywordOverride | null): string[] {
	if (!override) return [...auto]
	return [...override.keywords]
}
