/**
 * 项目模型：**一个项目 = 一个工作目录**。
 *
 * 这是"从日报变成调研插件"的地基。日报是全局的（今天世界上发生了什么），
 * 调研是定向的（**这个项目**缺的那块知识在哪），所以每一份偏好、每一天的索引、
 * 每一条反馈都必须按项目隔离 —— 否则给 A 项目调教的"多推 Rust"会污染 B 项目。
 *
 * 三个关键决定：
 *
 * 1. **默认项目就是数据根目录本身**（`~/.dsh/daily/`）。
 *    这样老用户升级后数据原地不动、零迁移；只有额外项目才落到子目录里。
 *
 * 2. **目录名用 `slug-hash8`**：slug 给人看（`dsh-plugins`），hash 保证唯一
 *    （不同父目录下的同名项目不会撞在一起）。纯 slug 会撞，纯 hash 看不懂。
 *
 * 3. **路径必须先归一化再当身份**：`~`、相对路径、结尾斜杠、`..`、软链接
 *    都会让"同一个目录"产生不同的字符串。身份不一致 = 数据被劈成两份。
 */
import { createHash } from 'node:crypto'
import { existsSync, statSync } from 'node:fs'
import { basename, isAbsolute, join, resolve, sep } from 'node:path'
import { homedir } from 'node:os'

export interface ProjectEntry {
	/** 归一化后的绝对路径。**这是项目的身份**。 */
	dir: string
	/** 显示名（默认取目录名，用户可改）。 */
	name: string
	/** 目录名（projects/ 下的子目录名）；默认项目为空字符串。 */
	folder: string
	/** 最后一次使用时间（ISO）。 */
	lastUsedAt: string
	/** 是否是默认项目（数据根目录本身）。 */
	isDefault: boolean
}

export interface ProjectRegistry {
	version: number
	/** 当前项目目录（绝对路径）。 */
	current: string | null
	/** 已知项目（默认项目不在其中，它由数据根隐含）。 */
	known: Array<{ dir: string; name: string; lastUsedAt: string }>
}

export function defaultRegistry(): ProjectRegistry {
	return { version: 1, current: null, known: [] }
}

/** 把 `~`、相对路径、结尾斜杠、`..` 统一成一个绝对路径。 */
export function normalizeDir(input: string, cwd: string = process.cwd()): string {
	const raw = (input ?? '').trim()
	if (!raw) return resolve(cwd)
	let expanded = raw
	if (expanded === '~') expanded = homedir()
	else if (expanded.startsWith('~/') || expanded.startsWith(`~${sep}`)) {
		expanded = join(homedir(), expanded.slice(2))
	}
	// 关键：**两种路径都必须过 resolve()**。
	// 早先写成"绝对路径就直接用"，于是 `/tmp/a/../a/b` 与 `/tmp/a/b` 被当成两个项目 ——
	// 同一目录两个身份，数据会被劈成两份（测试当场抓到的）。
	const abs = resolve(isAbsolute(expanded) ? expanded : join(cwd, expanded))
	// resolve 已经会去掉结尾斜杠与 `..`；这里只保证不是 "/" 这种退化值
	return abs.length > 1 && abs.endsWith(sep) ? abs.slice(0, -1) : abs
}

/**
 * 目录名：`<slug>-<hash8>`。
 *
 * slug 只保留 `[a-z0-9-]`（中文项目名会退化成空，这时用 `project`），
 * 截断到 32 字符；hash 取归一化路径的 sha1 前 8 位 —— 保证唯一且稳定。
 */
export function projectFolder(dir: string): string {
	const normalized = normalizeDir(dir)
	const hash = createHash('sha1').update(normalized).digest('hex').slice(0, 8)
	const slug = basename(normalized)
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-+|-+$/g, '')
		.slice(0, 32)
		.replace(/-+$/, '')
	return `${slug || 'project'}-${hash}`
}

/** 显示名：目录名；根目录这种退化情况给个可读的兜底。 */
export function projectName(dir: string): string {
	const normalized = normalizeDir(dir)
	const base = basename(normalized)
	return base || normalized
}

/**
 * 解析某个项目的数据目录。
 *
 * 默认项目 → 数据根目录本身（`<root>`）；其它项目 → `<root>/projects/<folder>`。
 * `root` 与 `dir` 都先归一化，所以同一目录无论怎么写都落到同一处。
 */
export function projectDataDir(root: string, dir: string): string {
	const normalizedRoot = normalizeDir(root)
	const normalizedDir = normalizeDir(dir)
	if (normalizedDir === normalizedRoot) return normalizedRoot
	return join(normalizedRoot, 'projects', projectFolder(normalizedDir))
}

export function isDefaultProject(root: string, dir: string): boolean {
	return normalizeDir(root) === normalizeDir(dir)
}

export interface DirCheck {
	ok: boolean
	reason?: string
}

/** 项目目录必须真实存在且是目录 —— 否则会因为一个错字凭空造出一个空项目。 */
export function checkDir(dir: string): DirCheck {
	const normalized = normalizeDir(dir)
	if (!existsSync(normalized)) return { ok: false, reason: `目录不存在：${normalized}` }
	try {
		if (!statSync(normalized).isDirectory()) return { ok: false, reason: `不是目录：${normalized}` }
	} catch (error) {
		return { ok: false, reason: `无法访问：${error instanceof Error ? error.message : String(error)}` }
	}
	return { ok: true }
}

/**
 * 把一次"使用某项目"写进注册表：更新 current、把该项目并入 known、刷新 lastUsedAt。
 * 默认项目不进 known（它由数据根隐含），避免注册表里出现一条永远存在的冗余记录。
 */
export function touchProject(
	registry: ProjectRegistry,
	root: string,
	dir: string,
	now: Date = new Date(),
): ProjectRegistry {
	const normalizedDir = normalizeDir(dir)
	const iso = now.toISOString()
	const isDefault = isDefaultProject(root, normalizedDir)

	const known = registry.known.filter((entry) => normalizeDir(entry.dir) !== normalizedDir)
	if (!isDefault) {
		const existing = registry.known.find((entry) => normalizeDir(entry.dir) === normalizedDir)
		known.push({
			dir: normalizedDir,
			name: existing?.name || projectName(normalizedDir),
			lastUsedAt: iso,
		})
	}
	known.sort((a, b) => (a.lastUsedAt < b.lastUsedAt ? 1 : a.lastUsedAt > b.lastUsedAt ? -1 : 0))

	return { version: registry.version, current: normalizedDir, known }
}

/** 读注册表时的容错：字段缺失/类型不对都回落默认，坏数据不能让插件起不来。 */
export function readRegistry(raw: unknown): ProjectRegistry {
	if (!raw || typeof raw !== 'object') return defaultRegistry()
	const source = raw as Record<string, unknown>
	const knownRaw = Array.isArray(source.known) ? source.known : []
	const known: ProjectRegistry['known'] = []
	for (const entry of knownRaw) {
		if (!entry || typeof entry !== 'object') continue
		const item = entry as Record<string, unknown>
		if (typeof item.dir !== 'string' || !item.dir.trim()) continue
		known.push({
			dir: item.dir,
			name: typeof item.name === 'string' && item.name.trim() ? item.name : projectName(item.dir),
			lastUsedAt: typeof item.lastUsedAt === 'string' ? item.lastUsedAt : new Date(0).toISOString(),
		})
	}
	return {
		version: typeof source.version === 'number' ? source.version : 1,
		current: typeof source.current === 'string' && source.current.trim() ? source.current : null,
		known,
	}
}

/** 展开成界面/工具要用的清单（默认项目排最前）。 */
export function listProjects(
	registry: ProjectRegistry,
	root: string,
): ProjectEntry[] {
	const normalizedRoot = normalizeDir(root)
	const out: ProjectEntry[] = [
		{
			dir: normalizedRoot,
			name: `${projectName(normalizedRoot)}（默认）`,
			folder: '',
			lastUsedAt: new Date(0).toISOString(),
			isDefault: true,
		},
	]
	for (const entry of registry.known) {
		const dir = normalizeDir(entry.dir)
		if (dir === normalizedRoot) continue
		out.push({
			dir,
			name: entry.name,
			folder: projectFolder(dir),
			lastUsedAt: entry.lastUsedAt,
			isDefault: false,
		})
	}
	return out
}
