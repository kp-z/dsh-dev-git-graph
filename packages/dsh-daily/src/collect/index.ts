import { SOURCE_CATALOG } from '../catalog.js'
import type { DailyConfig } from '../config.js'
import { pruneRotation, recordAttempts, type RotationState } from '../rotation.js'
import type { RawItem, SourceState } from '../types.js'
import { mapLimit } from './http.js'
import { MirrorPool } from './mirror.js'
import { SourceFailure,
	collectArxiv,
	collectBilibiliPopular,
	collectBilibiliRanking,
	collectExtraFeeds,
	collectGithub,
	collectHackerNews,
	collectYoutube,
	makeFeedRunner,
	type CollectEnv,
	type SourceRunner,
} from './sources.js'

/**
 * 源 id → 采集实现。
 *
 * 单独留一个 `extra` 虚拟源：用户在配置里加的任意 RSS 源会被它一次收完。
 * 这样"多一个自定义源"不会变成"多一个并发槽位"，也不会让源列表随配置无限膨胀。
 */
/**
 * 单个源的**总预算**（毫秒）。
 *
 * 与 `fetchText` 的"每次尝试 12s"是两件事：那边默认重试 2 次 → 最坏 ≈ 40s，
 * 一个慢源就能独占整轮刷新（实测 YouTube 43–47s）。这里给的是**源这一层**的天花板。
 */
export const SOURCE_BUDGET_MS = 20_000

export const SOURCE_RUNNERS: Record<string, SourceRunner> = {
	hn: collectHackerNews,
	arxiv: collectArxiv,
	github: collectGithub,
	youtube: collectYoutube,
	'bilibili-popular': collectBilibiliPopular,
	'bilibili-ranking': collectBilibiliRanking,
	sspai: makeFeedRunner('sspai'),
	ithome: makeFeedRunner('ithome'),
	solidot: makeFeedRunner('solidot'),
	ruanyifeng: makeFeedRunner('ruanyifeng'),
	extra: collectExtraFeeds,
}

/** `extra` 是虚拟源：它没有固定主页，但必须出现在源状态里，否则用户以为配置没生效。 */
const EXTRA_SOURCE = {
	id: 'extra',
	name: '自定义 RSS 源',
	kind: 'web' as const,
	topic: '热点',
	homepage: '',
}

export interface CollectOptions {
	config: DailyConfig
	/** 已存在的镜像池（跨轮复用健康度）；不传则新建一个不持久化的。 */
	pool?: MirrorPool
	signal?: AbortSignal
	/** 只跑这些源；缺省=内置目录 + extra，并按 config.enabledSources 过滤。 */
	sourceIds?: string[]
	/**
	 * 运行期追加的自定义源（`名称|URL|主题`），与 config.extraFeeds 合并后使用。
	 * 用户导入 OPML 后不需要改配置、不需要重载 profile 就能生效。
	 */
	extraFeeds?: readonly string[]
	/** YouTube 频道的轮转/退避状态（输入）。缺省视为"都没抓过"，即全部可抓。 */
	rotation?: RotationState
	/** 单个源的**总预算**（毫秒）；缺省 `SOURCE_BUDGET_MS`。测试与"想更保守"的用户可用。 */
	sourceBudgetMs?: number
}

export interface CollectOutcome {
	items: RawItem[]
	sources: SourceState[]
	pool: MirrorPool
	durationMs: number
	/** 汇总后的轮转状态（含本轮尝试结果），由 service 落进 meta。 */
	rotation: RotationState
}

/** 决定这一轮跑哪些源。config.enabledSources 为空 = 全部启用。 */
export function resolveSourceIds(config: DailyConfig, explicit?: string[]): string[] {
	const all = [...SOURCE_CATALOG.map((s) => s.id), EXTRA_SOURCE.id]
	if (explicit && explicit.length > 0) {
		return all.filter((id) => explicit.includes(id))
	}
	const enabled = config.enabledSources
	if (!enabled || enabled.length === 0) return all
	return all.filter((id) => enabled.includes(id))
}

function sourceMeta(id: string): { name: string; kind: 'web' | 'video' } {
	if (id === EXTRA_SOURCE.id) return { name: EXTRA_SOURCE.name, kind: EXTRA_SOURCE.kind }
	const def = SOURCE_CATALOG.find((s) => s.id === id)
	return { name: def?.name ?? id, kind: def?.kind ?? 'web' }
}

/**
 * 跑一轮采集。
 *
 * 关键语义：**单源失败绝不上升为整轮失败**。失败的源带着 error 进 sourceState，
 * 成功的源照常产出 —— 日报里会显示"8/9 源正常"，用户看到的是一条明确的降级说明，
 * 而不是一个空白页面。
 */
export async function runCollection(options: CollectOptions): Promise<CollectOutcome> {
	const started = Date.now()
	// 运行期追加的源与配置里的合并：两者同格式，去重交给下游（它按 URL 去重）
	const config: DailyConfig =
		options.extraFeeds && options.extraFeeds.length > 0
			? { ...options.config, extraFeeds: [...options.config.extraFeeds, ...options.extraFeeds] }
			: options.config
	const pool =
		options.pool ?? new MirrorPool(config.rsshubMirrors, config.requestTimeoutMs)
	const rotationIn = options.rotation ?? {}
	const env: CollectEnv = {
		sourceBudgetMs: options.sourceBudgetMs,
		config,
		pool,
		...(options.signal ? { signal: options.signal } : {}),
		rotation: rotationIn,
	}

	const ids = resolveSourceIds(config, options.sourceIds)
	const results = await mapLimit(ids, Math.max(1, options.config.concurrency), async (id) => {
		const runner = SOURCE_RUNNERS[id]
		const meta = sourceMeta(id)
		const at = new Date().toISOString()
		const t0 = Date.now()
		if (!runner) {
			const state: SourceState = {
				id,
				name: meta.name,
				kind: meta.kind,
				ok: false,
				count: 0,
				error: '没有对应的采集实现',
				durationMs: 0,
				at,
			}
			return { items: [] as RawItem[], state }
		}
		// **单源总预算**：`fetchText` 每次尝试有 12s 超时、但默认重试 2 次 →
		// 最坏 12×3 + 退避 ≈ 40s（实测 YouTube 43–47s 就是这么来的）。
		// 一个源不该独占整轮刷新，所以在**源这一层**再设一个总预算：
		// 到点就中止（信号会顺着 env.signal 传到 fetch），并按失败记录 —— 该源随后进入退避。
		const budgetMs = env.sourceBudgetMs ?? SOURCE_BUDGET_MS
		const controller = new AbortController()
		// 这个定时器**不必清**：controller 是每个源新建的，源跑完后没有任何东西再用它的 signal；
		// 未触发的定时器到点会 abort 一个已经没人引用的 controller —— 无副作用。
		const budgetTimer = setTimeout(() => controller.abort(), budgetMs)
		const signal = env.signal ? AbortSignal.any([env.signal, controller.signal]) : controller.signal
		try {
			const outcome = await runner({ ...env, signal })
			const state: SourceState = {
				id,
				name: meta.name,
				kind: meta.kind,
				ok: true,
				count: outcome.items.length,
				error: outcome.note ?? null,
				durationMs: Date.now() - t0,
				at,
			}
			// `rotationUpdates` 必须一起带出来 —— 漏掉它的话成功路径就不更新轮转状态，
			// LRU 会永远选中同一批频道（实测被集成测试直接抓到）
			return {
				items: outcome.items,
				state,
				...(outcome.rotationUpdates ? { rotationUpdates: outcome.rotationUpdates } : {}),
			}
		} catch (error) {
			// 预算到点导致的失败要说清楚是**超预算**，而不是把底层报错原样丢出来
			// （"aborted" 这种消息看报告的人无法判断是我中止的还是网络断的）
			const abortedByBudget = controller.signal.aborted
			const message = abortedByBudget
				? `单源超时：超过 ${Math.round(budgetMs / 1000)}s 预算已中止`
				: error instanceof Error
					? error.message
					: String(error)
			const state: SourceState = {
				id,
				name: meta.name,
				kind: meta.kind,
				ok: false,
				count: 0,
				error: message,
				durationMs: Date.now() - t0,
				at,
			}
			// 失败也要把尝试记录带出来，否则失败计数不增长、退避不生效
			const rotationUpdates = error instanceof SourceFailure ? error.rotationUpdates : undefined
			return { items: [] as RawItem[], state, ...(rotationUpdates ? { rotationUpdates } : {}) }
		}
	})

	const items: RawItem[] = []
	const sources: SourceState[] = []
	results.forEach((result) => {
		if (result.status === 'fulfilled') {
			items.push(...result.value.items)
			sources.push(result.value.state)
		}
	})

	// 汇总各源的"尝试结果"（目前只有 YouTube 会产出）→ 得到新的轮转状态。
	// 采集器不落盘：产出状态、由 service 写进 meta，保持这一层纯粹可测。
	const attempts = results.flatMap((result) =>
		result.status === 'fulfilled' ? (result.value.rotationUpdates ?? []) : [],
	)
	const rotation = attempts.length > 0 ? recordAttempts(rotationIn, attempts, new Date()) : rotationIn

	return {
		items,
		sources,
		pool,
		durationMs: Date.now() - started,
		rotation,
	}
}
