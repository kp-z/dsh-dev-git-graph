/**
 * YouTube 频道的**轮转与退避**调度（纯函数）。
 *
 * 为什么需要它（有实测证据）：本机环境下 YouTube 依赖一个免费公共 RSSHub 镜像，
 * 5 个频道每轮全量请求它，实测一次 2/5 频道失败、另一次**整源 0 条**（429 / 超时）。
 * 而该源又占了整轮刷新耗时的绝大部分（27~66s 里 27s 是它）。
 *
 * 做法是把"每轮抓所有频道"改成"每轮抓少数几个、按最久没抓的优先"（LRU）：
 *
 * - **不会漏内容**：RSS 返回的是频道最近 ~15 条投稿，不是"今天的投稿"。
 *   5 个频道每轮抓 3 个 → 每个频道约 2 轮（≈2 天）覆盖一次，
 *   除非某个频道两天发 15 条以上（不现实），否则不会漏。
 * - **顺带把刷新耗时压下来**：请求数从 5 降到 3。
 * - **失败会退避**：连续失败的频道按 2 的幂退避，不让一个挂掉的频道每轮都白等超时。
 *
 * 一个容易写错的地方：LRU 必须按 **lastAttempt（尝试时间）** 而不是 lastSuccess 排序。
 * 否则一个"每次都失败"的频道会永远是最久没成功的那个 → 每轮都被优先选中 → 每轮都白等。
 */

/**
 * 轮转只关心这三个字段。这里**故意不 import sources.ts 的 ChannelSpec** ——
 * sources.ts 会 import 本模块，类型层面的互相 import 虽然运行时会被擦除，
 * 但没必要制造这个环。用结构化类型 + 泛型保持调用方的具体类型。
 */
export interface RotationChannel {
	name: string
	channelId: string
	topic?: string
}

export interface ChannelAttempt {
	/** 上次尝试时间（ISO）。失败也算尝试。 */
	lastAttemptAt: string | null
	/** 上次成功时间（ISO），仅用于诊断展示。 */
	lastSuccessAt?: string | null
	/** 连续失败次数（成功即清零）。 */
	consecutiveFailures: number
}

/** 频道 ID → 尝试记录。持久化在 meta 里，跨进程/跨轮保留。 */
export type RotationState = Record<string, ChannelAttempt>

export interface PickOptions {
	/** 本轮抓几个频道。<= 0 或 >= 频道总数时视为"全抓"（关闭轮转）。 */
	perRefresh: number
	/** 当前时间戳（ms）。 */
	now: number
	/** 失败退避的基准分钟数（0 = 不退避）。 */
	cooldownMinutes: number
}

export interface PickResult<C extends RotationChannel = RotationChannel> {
	selected: C[]
	/** 本轮没抓的频道及原因，写进源状态让人看得见"为什么少了几个"。 */
	deferred: Array<{ name: string; reason: string }>
	/** 是否因为所有频道都在退避中而被迫忽略退避（宁可试也别一个都不抓）。 */
	forced: boolean
}

/** 连续失败 n 次的退避时长：base × 2^(n-1)，封顶 8×base。n=0 → 0。 */
export function cooldownMs(consecutiveFailures: number, baseMinutes: number): number {
	if (consecutiveFailures <= 0 || baseMinutes <= 0) return 0
	const factor = Math.min(8, 2 ** (consecutiveFailures - 1))
	return baseMinutes * factor * 60_000
}

function attemptTime(state: RotationState, key: string): number | null {
	const raw = state[key]?.lastAttemptAt
	if (!raw) return null
	const value = Date.parse(raw)
	return Number.isFinite(value) ? value : null
}

/**
 * 选出本轮要抓的频道。
 *
 * 顺序：**从没抓过的** → **最久没抓的**；仍在退避窗口内的排到最后，
 * 只有当可选频道凑不够时才会去动它们（并标记 forced）。
 */
export function pickChannels<C extends RotationChannel>(
	channels: readonly C[],
	state: RotationState,
	options: PickOptions,
): PickResult<C> {
	if (channels.length === 0) return { selected: [], deferred: [], forced: false }

	const perRefresh = Math.floor(options.perRefresh)
	// 关闭轮转 / 要的数量不小于总数 → 全抓（不看退避：用户明确要全量）
	if (perRefresh <= 0 || perRefresh >= channels.length) {
		return { selected: [...channels], deferred: [], forced: false }
	}

	const scored = channels.map((channel) => {
		const record = state[channel.channelId]
		const last = attemptTime(state, channel.channelId)
		const failures = record?.consecutiveFailures ?? 0
		const wait = cooldownMs(failures, options.cooldownMinutes)
		const until = last === null ? 0 : last + wait
		const blocked = last !== null && wait > 0 && options.now < until
		return { channel, last, failures, blocked, until }
	})

	const byStaleness = (a: (typeof scored)[number], b: (typeof scored)[number]): number => {
		// 从没抓过的（last === null）最优先
		if (a.last === null && b.last !== null) return -1
		if (b.last === null && a.last !== null) return 1
		if (a.last !== null && b.last !== null && a.last !== b.last) return a.last - b.last
		// 时间相同（含都为 null）时用名字保证稳定，避免每轮顺序抖动
		return a.channel.name < b.channel.name ? -1 : a.channel.name > b.channel.name ? 1 : 0
	}

	const available = scored.filter((entry) => !entry.blocked).sort(byStaleness)
	const blocked = scored.filter((entry) => entry.blocked).sort((a, b) => a.until - b.until || byStaleness(a, b))

	const selected = available.slice(0, perRefresh)
	let forced = false
	if (selected.length < perRefresh) {
		// 可选的不够 → 从退避中的补，宁可试也别空着（否则某个频道的退避会把整源饿死）
		const extra = blocked.slice(0, perRefresh - selected.length)
		if (extra.length > 0) forced = true
		selected.push(...extra)
	}

	const selectedKeys = new Set(selected.map((entry) => entry.channel.channelId))
	const deferred = [...available.slice(perRefresh), ...blocked.slice(Math.max(0, perRefresh - available.length))]
		.filter((entry) => !selectedKeys.has(entry.channel.channelId))
		.map((entry) => ({
			name: entry.channel.name,
			reason: entry.blocked
				? `失败 ${entry.failures} 次，退避至 ${new Date(entry.until).toISOString().slice(11, 16)}`
				: '按轮转下次优先',
		}))

	return {
		selected: selected.map((entry) => entry.channel),
		deferred,
		forced,
	}
}

/** 把本轮的成败写回状态。失败也算"尝试过"，这是 LRU 不退化的前提。 */
export function recordAttempts(
	state: RotationState,
	outcomes: ReadonlyArray<{ key: string; ok: boolean }>,
	now: Date,
): RotationState {
	const next: RotationState = { ...state }
	const iso = now.toISOString()
	for (const outcome of outcomes) {
		const prev = next[outcome.key]
		next[outcome.key] = {
			lastAttemptAt: iso,
			lastSuccessAt: outcome.ok ? iso : (prev?.lastSuccessAt ?? null),
			consecutiveFailures: outcome.ok ? 0 : (prev?.consecutiveFailures ?? 0) + 1,
		}
	}
	return next
}

/** 丢掉配置里已经不存在的频道记录（防止 meta 无限增长）。 */
export function pruneRotation(state: RotationState, keepKeys: readonly string[]): RotationState {
	const keep = new Set(keepKeys)
	const next: RotationState = {}
	for (const [key, value] of Object.entries(state)) {
		if (keep.has(key)) next[key] = value
	}
	return next
}

/** 给源状态/日报用的一句话摘要。 */
export function describeRotation(result: PickResult<RotationChannel>, total: number): string {
	if (result.selected.length >= total) return ''
	const parts = [`本轮轮转抓取 ${result.selected.length}/${total} 个频道`]
	if (result.forced) parts.push('（其余频道都在失败退避中，已强制选取）')
	if (result.deferred.length > 0) {
		parts.push(`：${result.deferred.map((d) => `${d.name}（${d.reason}）`).join('、')}`)
	}
	return parts.join('')
}
