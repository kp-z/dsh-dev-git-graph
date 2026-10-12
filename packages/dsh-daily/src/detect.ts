/**
 * 项目自动识别：从宿主给的零散上下文里，**探出"用户现在在哪个目录"**。
 *
 * ## 为什么是"探"而不是直接读字段
 * DSH 的 `Session` / `Agent` / `Workspace` 是我拿不到编译期类型的宿主内部对象
 * （`dsh-system-prompt` 这类包只发 JS，没有 `.d.ts`）。硬写 `session.header.cwd`
 * 这种路径，在宿主换个版本时就变成 `undefined` —— 而且**静默**变成 undefined。
 * 所以这里按"已知的键名集合"去探，并且：
 * - **深度有界**（只走 3 层、最多 60 个节点）：宿主对象可能很大且带环，不能乱遍历
 * - **只认绝对路径**：相对路径、"main"、"session-abc" 这类值直接丢掉，避免把垃圾当项目
 * - **探不到就返回 null**：调用方保持现状（默认项目），**绝不猜**
 *
 * ## 为什么显式优先于推断
 * 用户手动选过的项目必须压过自动识别。否则会出现"我明明切过，又被它自己换回去"——
 * 那比不自动识别更让人恼火。所以 `chooseProject` 把 `manual` 作为第一判断。
 */

/** 键名优先级：越靠前越可信（`cwd` 是 DSH 会话头里那个字段）。 */
const KEY_PRIORITY: Array<{ key: RegExp; weight: number }> = [
	{ key: /^cwd$/i, weight: 100 },
	{ key: /^(workingDirectory|workdir)$/i, weight: 95 },
	{ key: /^(workspacePath|workspaceDir)$/i, weight: 90 },
	{ key: /^(projectDir|projectPath|projectRoot)$/i, weight: 85 },
	{ key: /^(rootDir|baseDir|basePath|root)$/i, weight: 60 },
	{ key: /^(dir|directory|path)$/i, weight: 40 },
]

export interface DetectedDir {
	dir: string
	/** 从哪儿探到的，形如 `session.header.cwd` —— 出问题时这行就是线索。 */
	from: string
	weight: number
}

/** 看起来像"一个绝对目录"才算数。 */
export function looksLikeAbsoluteDir(value: unknown): value is string {
	if (typeof value !== 'string') return false
	const text = value.trim()
	if (text.length < 2 || text.length > 512) return false
	if (!text.startsWith('/') && !/^[A-Za-z]:[\\/]/.test(text)) return false
	if (text.includes('\0')) return false
	// 明显的 URL / 协议字符串不是目录
	if (/^[a-z]+:\/\//i.test(text)) return false
	return true
}

function weightOf(key: string): number | null {
	for (const entry of KEY_PRIORITY) if (entry.key.test(key)) return entry.weight
	return null
}

/**
 * **显式访问路径**（含 getter / 原型属性）。
 *
 * 为什么必须补这一层：`Object.entries()` 只看得到**自有可枚举属性**。
 * 而 DSH 的 `Session` / `Workspace` 很可能是类实例 —— `cwd` 挂在原型上的 getter，
 * 或者干脆藏在私有字段里。那种情况下泛走遍历**什么都看不到**，而且不报错。
 * 这里按键路径直接取值，getter 也能触发。
 */
const ACCESS_PATHS: readonly string[] = [
	'cwd',
	'header.cwd',
	'meta.cwd',
	'options.cwd',
	'session.cwd',
	'session.header.cwd',
	'workspace.cwd',
	'workspacePath',
	'workspace.path',
	'header.workspacePath',
	'path',
	'root',
	'dir',
	'directory',
	'projectDir',
	'projectPath',
]

/** 按 `a.b.c` 路径取值；任一段是函数就调用它（getter 走属性访问自然会触发）。 */
function getByPath(node: unknown, path: string): unknown {
	let current: unknown = node
	for (const key of path.split('.')) {
		if (current === null || current === undefined) return undefined
		try {
			current = (current as Record<string, unknown>)[key]
			if (typeof current === 'function') current = (current as () => unknown).call(node)
		} catch {
			return undefined
		}
	}
	return current
}

export interface ExtractOptions {
	/** 最大深度（默认 3）。 */
	maxDepth?: number
	/** 最大访问节点数（默认 60）。 */
	maxNodes?: number
	/** 路径前缀，拼进 `from` 里便于排查。 */
	prefix?: string
}

/**
 * 从一个宿主对象里探出目录。返回**最可信**的那一个（按键名权重），探不到返回 null。
 */
export function extractProjectDir(candidate: unknown, options: ExtractOptions = {}): DetectedDir | null {
	const maxDepth = options.maxDepth ?? 4
	const maxNodes = options.maxNodes ?? 200
	const prefix = options.prefix ?? ''
	const seen = new Set<unknown>()
	const found: DetectedDir[] = []
	let visited = 0

	const visit = (node: unknown, path: string, depth: number): void => {
		if (visited >= maxNodes || depth > maxDepth) return
		if (node === null || typeof node !== 'object') return
		if (seen.has(node)) return
		seen.add(node)
		visited++

		let entries: Array<[string, unknown]>
		try {
			entries = Object.entries(node as Record<string, unknown>)
		} catch {
			return
		}
		for (const [key, value] of entries) {
			const weight = weightOf(key)
			const here = path ? `${path}.${key}` : key
			if (weight !== null && looksLikeAbsoluteDir(value)) {
				found.push({ dir: value.trim(), from: `${prefix}${here}`, weight })
				continue
			}
			// 不下探"明显是数据"的字段（消息内容里出现路径是最常见的误报来源）
			if (/^(messages?|content|blocks?|text|body|history|log|logs|tools?|schema)$/i.test(key)) continue
			if (value && typeof value === 'object') visit(value, here, depth + 1)
		}
	}

	// 第一轮：显式路径（能穿透 getter/原型；类实例只有这一条路走得通）
	for (const path of ACCESS_PATHS) {
		const value = getByPath(candidate, path)
		if (looksLikeAbsoluteDir(value)) {
			return { dir: value.trim(), from: `${prefix}${path}`, weight: weightOf(path.split('.').pop() ?? path) ?? 50 }
		}
	}

	// 第二轮：泛走（自有可枚举属性；覆盖普通对象字面量）
	visit(candidate, '', 1)
	if (found.length === 0) return null
	// 权重高的优先；同权重取先探到的（浅层优先，更可能是"本体"）
	found.sort((a, b) => (b.weight - a.weight) || 0)
	return found[0]
}

/** 从一组宿主对象里收集候选（保持输入顺序 = 优先级）。 */
export function collectDirs(candidates: Array<{ value: unknown; from: string }>): DetectedDir[] {
	const out: DetectedDir[] = []
	for (const item of candidates) {
		const hit = extractProjectDir(item.value, { prefix: `${item.from}.` })
		if (hit) out.push({ ...hit, from: hit.from || item.from })
	}
	return out
}

export interface ChooseOptions {
	/** 当前项目目录（归一化后的绝对路径）。 */
	current: string
	/** 当前项目是否来自用户手动指定。 */
	manual: boolean
	/** 候选目录（按优先级排序）。 */
	candidates: DetectedDir[]
	/** 该目录是否可用（存在、是目录、且不是"明显不该当项目"的目录）。 */
	usable: (dir: string) => boolean
}

export interface ChooseResult {
	dir: string
	from: string
}

/**
 * 决定要不要换项目。返回 null = 保持现状。
 *
 * 判断顺序（**显式优先于推断**）：
 * 1. 用户手动指定过 → 不动（除非他自己回到自动模式）
 * 2. 依次看候选，第一个"可用且与当前不同"的胜出
 * 3. 都不行 → null（保持默认，绝不猜）
 */
export function chooseProject(options: ChooseOptions): ChooseResult | null {
	if (options.manual) return null
	for (const candidate of options.candidates) {
		if (candidate.dir === options.current) continue
		let ok = false
		try {
			ok = options.usable(candidate.dir)
		} catch {
			ok = false
		}
		if (ok) return { dir: candidate.dir, from: candidate.from }
	}
	return null
}

/** 一行话说明为什么选/不选，供日志与界面展示。 */
export function describeChoice(result: ChooseResult | null, manual: boolean): string {
	if (manual) return '当前项目由用户手动指定，自动识别不会覆盖'
	if (!result) return '没有找到可用的项目目录，保持当前项目'
	return `自动识别到项目目录（来源：${result.from}）`
}
