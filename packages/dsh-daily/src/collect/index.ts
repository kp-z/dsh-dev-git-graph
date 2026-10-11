import { SOURCE_CATALOG } from '../catalog.js'
import type { DailyConfig } from '../config.js'
import type { RawItem, SourceState } from '../types.js'
import { mapLimit } from './http.js'
import { MirrorPool } from './mirror.js'
import {
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
}

export interface CollectOutcome {
	items: RawItem[]
	sources: SourceState[]
	pool: MirrorPool
	durationMs: number
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
	const env: CollectEnv = {
		config,
		pool,
		...(options.signal ? { signal: options.signal } : {}),
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
		try {
			const outcome = await runner(env)
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
			return { items: outcome.items, state }
		} catch (error) {
			const state: SourceState = {
				id,
				name: meta.name,
				kind: meta.kind,
				ok: false,
				count: 0,
				error: error instanceof Error ? error.message : String(error),
				durationMs: Date.now() - t0,
				at,
			}
			return { items: [] as RawItem[], state }
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

	return {
		items,
		sources,
		pool,
		durationMs: Date.now() - started,
	}
}
