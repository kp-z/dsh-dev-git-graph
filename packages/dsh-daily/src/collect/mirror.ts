import { fetchText } from './http.js'

/**
 * RSSHub 镜像池。
 *
 * 为什么非要有这个：YouTube 官方 feed 在本机直连超时，Invidious / Piped 公共实例也超时，
 * 唯一能拿到 YouTube 条目的路径是 RSSHub 路由。而公共 RSSHub 镜像**极不稳定**
 * （实测 8 个里只有 `rsshub.ktachibana.party` 能用：其余超时 / 502 / DNS 解析失败），
 * 所以"写死一个地址"在这种网络环境下等价于"这个功能随时会静默消失"。
 *
 * 池子的策略：
 * - 优先用**最近一次成功的**镜像（省一轮探测）；
 * - 退而用从未试过的；
 * - 最后用最近失败的（它的失败可能只是当时抖）。
 * 每次结果都回写到 meta，下一次采集直接从这里起步。
 */

export interface MirrorHealthRecord {
	ok: boolean
	at: string
	error: string | null
	/** 首次记录的延迟；从旧版 meta 读出来的记录可能没有这个字段。 */
	latencyMs?: number
}

export interface MirrorSnapshot {
	mirrorHealth: Record<string, MirrorHealthRecord>
}

/** 判断一段文本像不像 feed。RSSHub 的失败响应经常是 200 + 一张 HTML 欢迎页。 */
function looksLikeFeed(text: string): boolean {
	const head = text.slice(0, 2048)
	return /<rss[\s>]/i.test(head) || /<feed[\s>]/i.test(head) || /<rdf:RDF[\s>]/i.test(head)
}

export class MirrorPool {
	private readonly configured: string[]
	private readonly timeoutMs: number
	private health: Record<string, MirrorHealthRecord>
	/** 预热得到的"可达且延迟最优"顺序；空 = 还没预热过。 */
	private warmOrder: string[] = []
	private readonly logger?: (message: string) => void

	constructor(
		configured: readonly string[],
		timeoutMs: number,
		seed?: MirrorSnapshot | null,
		logger?: (message: string) => void,
	) {
		// 去重 + 去掉尾部斜杠，避免 `/a//b` 这种拼接
		const seen = new Set<string>()
		this.configured = []
		for (const raw of configured) {
			const url = (raw ?? '').trim().replace(/\/+$/, '')
			if (!url || seen.has(url)) continue
			seen.add(url)
			this.configured.push(url)
		}
		this.timeoutMs = timeoutMs
		this.health = { ...(seed?.mirrorHealth ?? {}) }
		this.logger = logger
	}

	get mirrors(): readonly string[] {
		return this.configured
	}

	/** 按"上次成功 → 未试过 → 上次失败"排序，尽量第一发就中。 */
	private ordered(): string[] {
		const never: string[] = []
		const okList: Array<{ url: string; at: number }> = []
		const failList: Array<{ url: string; at: number }> = []
		for (const url of this.configured) {
			const h = this.health[url]
			if (!h) {
				never.push(url)
				continue
			}
			const at = Date.parse(h.at) || 0
			if (h.ok) okList.push({ url, at })
			else failList.push({ url, at })
		}
		okList.sort((a, b) => b.at - a.at)
		failList.sort((a, b) => b.at - a.at)
		return [...okList.map((x) => x.url), ...never, ...failList.map((x) => x.url)]
	}

	/**
	 * 预热：**并行**探一遍所有镜像，按探测延迟排出优先序。
	 *
	 * 为什么需要它：YouTube 有 5 个频道，每个频道一次镜像请求。若每个频道都串行试 3 个镜像、
	 * 每个镜像等满超时，最坏情况是 5×3×12s = 3 分钟（实测第一版就要 50 秒）。
	 * 预热把"发现哪些镜像活着"的成本从**每频道一份**降到**整轮一份**，
	 * 而且并行的 6 秒远小于串行的 36 秒。
	 *
	 * 探测用站点根路径：我们只需要"这个镜像网络可达"，不需要它真的返回 feed ——
	 * 具体路由能不能出内容，交给随后的 fetchRoute 判断。
	 */
	async warmUp(options: { signal?: AbortSignal } = {}): Promise<string[]> {
		const probeTimeout = Math.min(6000, this.timeoutMs)
		const probes = this.configured.map(async (mirror) => {
			const started = Date.now()
			try {
				const response = await fetch(mirror, {
					signal: options.signal
						? AbortSignal.any([AbortSignal.timeout(probeTimeout), options.signal])
						: AbortSignal.timeout(probeTimeout),
					redirect: 'follow',
				})
				const latencyMs = Date.now() - started
				if (!response.ok) {
					this.record(mirror, false, `HTTP ${response.status}`, latencyMs)
					return null
				}
				// 预热成功只说明可达；ok 仍标记为 true，让"上次成功"的排序也能受益
				this.record(mirror, true, null, latencyMs)
				return { mirror, latencyMs }
			} catch (error) {
				this.record(
					mirror,
					false,
					error instanceof Error ? error.message : String(error),
					Date.now() - started,
				)
				return null
			}
		})
		const results = await Promise.all(probes)
		const alive = results
			.filter((r): r is { mirror: string; latencyMs: number } => r !== null)
			.sort((a, b) => a.latencyMs - b.latencyMs)
			.map((r) => r.mirror)
		this.warmOrder = alive
		if (alive.length > 0) {
			this.logger?.(`镜像预热：${alive.length}/${this.configured.length} 可达，首选 ${alive[0]}`)
		} else {
			this.logger?.('镜像预热：全部不可达')
		}
		return alive
	}

	/** 预热结果排在最前，其余按历史健康度排。 */
	private effectiveOrder(): string[] {
		if (this.warmOrder.length === 0) return this.ordered()
		const head = this.warmOrder
		const rest = this.ordered().filter((url) => !head.includes(url))
		return [...head, ...rest]
	}

	snapshot(): MirrorSnapshot {
		return { mirrorHealth: { ...this.health } }
	}

	private record(url: string, ok: boolean, error: string | null, latencyMs: number): void {
		this.health[url] = { ok, at: new Date().toISOString(), error, latencyMs }
	}

	/**
	 * 依次尝试镜像，返回第一个**内容看起来是 feed**的响应。
	 * 全挂时抛出的错误里带上每个镜像各自的失败原因 —— 排查时这句比 "fetch failed" 有用得多。
	 */
	async fetchRoute(
		route: string,
		options: { signal?: AbortSignal } = {},
	): Promise<{ text: string; mirror: string }> {
		if (this.configured.length === 0) {
			throw new Error('没有配置任何 RSSHub 镜像')
		}
		const path = route.startsWith('/') ? route : `/${route}`
		const failures: string[] = []

		for (const mirror of this.effectiveOrder()) {
			if (options.signal?.aborted) throw new Error('aborted')
			const started = Date.now()
			try {
				const text = await fetchText(`${mirror}${path}`, {
					timeoutMs: this.timeoutMs,
					retries: 0,
					signal: options.signal,
					headers: { accept: 'application/rss+xml, application/atom+xml, */*;q=0.5' },
				})
				const latencyMs = Date.now() - started
				if (!looksLikeFeed(text)) {
					this.record(mirror, false, '响应不是 feed（可能是镜像的欢迎页）', latencyMs)
					failures.push(`${mirror}: 响应不是 feed`)
					continue
				}
				this.record(mirror, true, null, latencyMs)
				return { text, mirror }
			} catch (error) {
				const latencyMs = Date.now() - started
				const reason = error instanceof Error ? error.message : String(error)
				this.record(mirror, false, reason, latencyMs)
				failures.push(`${mirror}: ${reason}`)
			}
		}

		throw new Error(`全部镜像不可用（${failures.join('；')}）`)
	}
}
