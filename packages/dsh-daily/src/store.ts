import { mkdir, readFile, rename, readdir, unlink, writeFile } from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import type { DayState, FeedbackMap, Prefs, RefreshSummary } from './types.js'

/** 把 `~/x` 展开成绝对路径；其余原样返回（交给 path 处理相对路径）。 */
export function expandHome(input: string): string {
	if (input === '~') return os.homedir()
	if (input.startsWith('~/')) return path.join(os.homedir(), input.slice(2))
	return input
}

/** 本地时区的 YYYY-MM-DD。**不要用 toISOString()** —— 那是 UTC，凌晨会串天。 */
export function localDate(d: Date = new Date()): string {
	const y = d.getFullYear()
	const m = `${d.getMonth() + 1}`.padStart(2, '0')
	const day = `${d.getDate()}`.padStart(2, '0')
	return `${y}-${m}-${day}`
}

export interface Meta {
	version: number
	lastRefresh: RefreshSummary | null
	lastDigestDate: string | null
	/** RSSHub 镜像健康度：下一次采集可以直接从健康的那个开始，省一轮探测。 */
	mirrorHealth: Record<string, { ok: boolean; at: string; error: string | null }>
}

export function defaultPrefs(): Prefs {
	return {
		topics: [],
		keywords: [],
		blocked: [],
		sourceWeights: {},
		dailyQuota: 120,
		maxItemsPerSource: 8,
		halfLifeHours: 36,
		tuningNotes: [],
		extraFeeds: [],
		updatedAt: new Date().toISOString(),
	}
}

export function defaultMeta(): Meta {
	return {
		version: 1,
		lastRefresh: null,
		lastDigestDate: null,
		mirrorHealth: {},
	}
}

export function emptyDay(date: string): DayState {
	return { date, items: [], sources: [], lastRefresh: null }
}

/**
 * dsh-daily 的落盘层。
 *
 * 三条不变量：
 * 1. **原子写**：先写同目录临时文件再 rename。掉电/被杀只会留下没人读的临时文件，
 *    不会留下半截 JSON 把整个插件卡死。
 * 2. **同文件串行**：写请求按文件路径排队，避免两次并发写互相覆盖（采集完成 + 用户点了
 *    「已读」几乎必然同时发生）。
 * 3. **读失败不抛**：文件缺失/损坏一律回落默认值 —— 一个数据文件坏掉不该让 profile 起不来。
 */
export class DailyStore {
	readonly dir: string
	private readonly queues = new Map<string, Promise<unknown>>()

	constructor(dir: string) {
		this.dir = dir
	}

	static resolveDir(configured: string | undefined): string {
		const raw = (configured ?? '').trim()
		if (raw) return path.resolve(expandHome(raw))
		return path.join(os.homedir(), '.dsh', 'daily')
	}

	get prefsFile(): string {
		return path.join(this.dir, 'prefs.json')
	}
	get feedbackFile(): string {
		return path.join(this.dir, 'feedback.json')
	}
	get metaFile(): string {
		return path.join(this.dir, 'meta.json')
	}
	get digestDir(): string {
		return path.join(this.dir, 'digest')
	}
	get daysDir(): string {
		return path.join(this.dir, 'days')
	}
	dayFile(date: string): string {
		return path.join(this.daysDir, `${date}.json`)
	}
	digestFile(date: string): string {
		return path.join(this.digestDir, `${date}.md`)
	}

	async init(): Promise<void> {
		await mkdir(this.daysDir, { recursive: true })
		await mkdir(this.digestDir, { recursive: true })
	}

	/** 同路径串行执行，保证读-改-写不被交错。 */
	private enqueue<T>(key: string, task: () => Promise<T>): Promise<T> {
		const prev = this.queues.get(key) ?? Promise.resolve()
		const next = prev.then(task, task)
		// 队列本身不该因为一次失败就断掉
		this.queues.set(
			key,
			next.then(
				() => undefined,
				() => undefined,
			),
		)
		return next
	}

	private async readJson<T>(file: string): Promise<T | null> {
		try {
			const raw = await readFile(file, 'utf8')
			return JSON.parse(raw) as T
		} catch {
			return null
		}
	}

	private async writeFileAtomic(file: string, body: string): Promise<void> {
		await mkdir(path.dirname(file), { recursive: true })
		const tmp = `${file}.tmp-${process.pid}-${Date.now().toString(36)}`
		await writeFile(tmp, body, 'utf8')
		try {
			await rename(tmp, file)
		} catch (error) {
			await unlink(tmp).catch(() => undefined)
			throw error
		}
	}

	async readText(file: string): Promise<string | null> {
		try {
			return await readFile(file, 'utf8')
		} catch {
			return null
		}
	}

	// ---------- 通用 JSON 文件（AI 摘要缓存等）----------

	/** 读一个数据目录下的 JSON 文件；缺失或损坏都返回 null（调用方决定回落）。 */
	async readJsonFile(name: string): Promise<unknown> {
		return this.readJson(path.join(this.dir, name))
	}

	async writeJsonFile(name: string, value: unknown): Promise<void> {
		const file = path.join(this.dir, name)
		await this.enqueue(file, () =>
			this.writeFileAtomic(file, `${JSON.stringify(value, null, 2)}\n`),
		)
	}

	// ---------- prefs ----------

	async readPrefs(): Promise<Prefs> {
		const stored = await this.readJson<Partial<Prefs>>(this.prefsFile)
		if (!stored) return defaultPrefs()
		const base = defaultPrefs()
		return {
			...base,
			...stored,
			topics: Array.isArray(stored.topics) ? stored.topics : base.topics,
			keywords: Array.isArray(stored.keywords) ? stored.keywords : base.keywords,
			blocked: Array.isArray(stored.blocked) ? stored.blocked : base.blocked,
			sourceWeights:
				stored.sourceWeights && typeof stored.sourceWeights === 'object'
					? stored.sourceWeights
					: base.sourceWeights,
			tuningNotes: Array.isArray(stored.tuningNotes) ? stored.tuningNotes : base.tuningNotes,
			extraFeeds: Array.isArray(stored.extraFeeds) ? stored.extraFeeds : base.extraFeeds,
		}
	}

	async writePrefs(prefs: Prefs): Promise<void> {
		await this.enqueue(this.prefsFile, () =>
			this.writeFileAtomic(this.prefsFile, `${JSON.stringify(prefs, null, 2)}\n`),
		)
	}

	/** 读-改-写。mutate 会在队列里执行，所以并发调用不会丢更新。 */
	async updatePrefs(
		mutate: (current: Prefs) => Prefs | Promise<Prefs>,
	): Promise<Prefs> {
		return this.enqueue(this.prefsFile, async () => {
			const current = await this.readPrefs()
			const next = await mutate(current)
			next.updatedAt = new Date().toISOString()
			await this.writeFileAtomic(this.prefsFile, `${JSON.stringify(next, null, 2)}\n`)
			return next
		})
	}

	// ---------- feedback ----------

	async readFeedback(): Promise<FeedbackMap> {
		return (await this.readJson<FeedbackMap>(this.feedbackFile)) ?? {}
	}

	async updateFeedback(
		mutate: (current: FeedbackMap) => FeedbackMap,
	): Promise<FeedbackMap> {
		return this.enqueue(this.feedbackFile, async () => {
			const current = await this.readFeedback()
			const next = mutate(current)
			await this.writeFileAtomic(this.feedbackFile, `${JSON.stringify(next, null, 2)}\n`)
			return next
		})
	}

	// ---------- 每天的数据 ----------

	async readDay(date: string): Promise<DayState> {
		const stored = await this.readJson<DayState>(this.dayFile(date))
		if (!stored || !Array.isArray(stored.items)) return emptyDay(date)
		return {
			date,
			items: stored.items,
			sources: Array.isArray(stored.sources) ? stored.sources : [],
			lastRefresh: stored.lastRefresh ?? null,
		}
	}

	async writeDay(day: DayState): Promise<void> {
		const file = this.dayFile(day.date)
		await this.enqueue(file, () =>
			this.writeFileAtomic(file, `${JSON.stringify(day)}\n`),
		)
	}

	async listDays(): Promise<string[]> {
		try {
			const names = await readdir(this.daysDir)
			return names
				.filter((n) => /^\d{4}-\d{2}-\d{2}\.json$/.test(n))
				.map((n) => n.replace(/\.json$/, ''))
				.sort()
		} catch {
			return []
		}
	}

	// ---------- meta ----------

	async readMeta(): Promise<Meta> {
		const stored = await this.readJson<Partial<Meta>>(this.metaFile)
		if (!stored) return defaultMeta()
		return {
			...defaultMeta(),
			...stored,
			mirrorHealth:
				stored.mirrorHealth && typeof stored.mirrorHealth === 'object'
					? stored.mirrorHealth
					: {},
		}
	}

	async updateMeta(mutate: (current: Meta) => Meta): Promise<Meta> {
		return this.enqueue(this.metaFile, async () => {
			const current = await this.readMeta()
			const next = mutate(current)
			await this.writeFileAtomic(this.metaFile, `${JSON.stringify(next, null, 2)}\n`)
			return next
		})
	}

	// ---------- 日报 Markdown ----------

	async readDigest(date: string): Promise<string | null> {
		return this.readText(this.digestFile(date))
	}

	async writeDigest(date: string, markdown: string): Promise<void> {
		const file = this.digestFile(date)
		await this.enqueue(file, () => this.writeFileAtomic(file, markdown))
	}

	/** 按名字读写 digest 目录里的文件（周报用 `week-<start>_<end>.md`）。 */
	async readDigestNamed(name: string): Promise<string | null> {
		return this.readText(path.join(this.digestDir, name))
	}

	async writeDigestNamed(name: string, markdown: string): Promise<void> {
		const file = path.join(this.digestDir, name)
		await this.enqueue(file, () => this.writeFileAtomic(file, markdown))
	}
}
