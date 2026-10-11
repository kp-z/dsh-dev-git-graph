/**
 * 可选 AI 摘要。
 *
 * 定位：**默认关闭**。打开后会给当天的前 N 条生成一句中文摘要，显示在侧边栏与日报里。
 * 它直接提升"高价值索引"的可用性 —— 只有标题的列表要一条条点进去才知道值不值得看。
 *
 * 这个文件刻意做成**可注入 stream** 的形状：`summarizeItems` 只依赖一个函数，
 * 所以它的全部失败路径（超时、空输出、非 stop 终止、单条炸掉）都能用假 stream 测到，
 * 不需要真调模型。
 *
 * 三条从实践里得来的约束（参考 dsh-rss 的实测经验）：
 * 1. **`maxTokens` 要留足推理预算**：推理 token 与正文**共享**上限。
 *    把它设成 200 会让推理模型还没写正文就耗尽预算，finish 变成 `max-tokens`，该条判失败。
 *    默认 1024，且失败原因里会带上实际的终止原因，方便判断是不是撞了上限。
 * 2. **单条失败必须隔离**：20 条里挂 1 条，另外 19 条照常出。
 * 3. **按条目缓存**：重复条目（跨天重复的新闻）不该重复付钱。
 */

/** 生成选项。刻意只声明我们真正用到的字段，避免把 dsh-llm 的完整类型拖进来。 */
export interface StreamRequest {
	provider: string
	model: string
	system?: string
	messages: Array<{ role: 'user'; content: string }>
	maxTokens?: number
	temperature?: number
	signal?: AbortSignal
}

/** 我们关心的事件子集：文本增量、推理增量、终止原因。 */
export interface StreamChunkLike {
	type: string
	text?: string
	reason?: { kind?: string; failure?: { message?: string; code?: string } }
}

export type StreamFn = (options: StreamRequest) => AsyncIterable<StreamChunkLike>

export interface SummarySource {
	id: string
	title: string
	sourceName: string
	summary?: string
	platform?: string
	topic?: string
}

export interface SummaryOutcome {
	text: string
	model: string
}

export interface SummaryFailure {
	error: string
}

export interface SummaryOptions {
	provider: string
	model: string
	maxItems: number
	concurrency: number
	timeoutMs: number
	maxTokens: number
	stream: StreamFn
	signal?: AbortSignal
	/** 注入时钟，便于测试。 */
	now?: () => number
}

/** 摘要长度上限（字符）。一句中文摘要超过这个数就已经不像"一句话"了。 */
export const SUMMARY_MAX_CHARS = 60

export function buildSummaryPrompt(item: SummarySource): { system: string; user: string } {
	const system =
		'你是新闻摘要助手。只输出**一句中文**，不超过 40 个字。' +
		'要求：不复述标题、不加“摘要：”之类的前缀、不使用 Markdown、不加引号、不写客套话。' +
		'如果原文信息不足以判断，就基于标题说清它大致讲什么，不要编造具体数字或结论。'
	const parts = [`标题：${item.title}`, `来源：${item.sourceName}`]
	if (item.topic) parts.push(`主题：${item.topic}`)
	if (item.summary) parts.push(`原始摘要：${item.summary.slice(0, 400)}`)
	parts.push('', '请用一句中文说明这条内容讲了什么、为什么值得点开。')
	return { system, user: parts.join('\n') }
}

/**
 * 清洗模型输出。
 *
 * 模型很爱加的东西：引号、`摘要：` 前缀、换行、Markdown 星号、末尾的"（共 42 字）"。
 * 这些都是渲染噪音，一处不洗就会在列表里显得很脏。
 */
export function cleanSummary(raw: string, maxChars = SUMMARY_MAX_CHARS): string | null {
	if (!raw) return null
	let text = raw
		// 去掉代码块围栏与 Markdown 强调
		.replace(/```[a-z]*/gi, ' ')
		.replace(/[*_`#>]/g, ' ')
		// 去掉成对的引号（中英文）
		.replace(/^[\s"'“”『』「」]+|[\s"'“”『』「」]+$/g, '')
		// 去掉常见前缀
		.replace(/^\s*(摘要|总结|一句话|简评|摘要如下)\s*[:：]\s*/i, '')
		// 换行与多空格压成单空格
		.replace(/\s+/g, ' ')
		.trim()

	// 去前缀可能又露出引号
	text = text.replace(/^[\s"'“”『』「」]+|[\s"'“”『』「」]+$/g, '').trim()

	if (!text) return null
	// 太短的多半是"无法判断""抱歉"这类废输出
	if (text.length < 4) return null
	if (/^(抱歉|无法|不能|对不起|sorry)/i.test(text)) return null
	if (text.length > maxChars) {
		// 按句子边界截断，避免把一句话砍成半截
		const cut = text.slice(0, maxChars)
		const lastStop = Math.max(cut.lastIndexOf('。'), cut.lastIndexOf('，'), cut.lastIndexOf(' '))
		text = `${lastStop > maxChars * 0.6 ? cut.slice(0, lastStop) : cut}…`
	}
	return text
}

/**
 * 生成一条摘要。
 *
 * 关键在终止判断上：只有 `finish.reason.kind === 'stop'` 才算干净的完成。
 * 但**已经拿到可用文本时不必因为终止原因不干净就丢弃** —— 推理模型经常在
 * `max-tokens` 下也已经把正文写完了。没拿到文本时，终止原因就是唯一的诊断线索，
 * 要原样带出去（含 error / aborted 的 failure 说明）。
 */
export async function summarizeOne(
	item: SummarySource,
	options: SummaryOptions,
): Promise<SummaryOutcome | SummaryFailure> {
	const now = options.now ?? Date.now
	const timeoutSignal = AbortSignal.timeout(options.timeoutMs)
	const signal = options.signal
		? AbortSignal.any([timeoutSignal, options.signal])
		: timeoutSignal
	const { system, user } = buildSummaryPrompt(item)

	let text = ''
	let finish: string | null = null
	let failureMessage: string | null = null

	try {
		const stream = options.stream({
			provider: options.provider,
			model: options.model,
			system,
			messages: [{ role: 'user', content: user }],
			maxTokens: options.maxTokens,
			temperature: 0.3,
			signal,
		})
		for await (const chunk of stream) {
			if (chunk.type === 'text-delta' && chunk.text) text += chunk.text
			if (chunk.type === 'finish') {
				finish = chunk.reason?.kind ?? 'unknown'
				failureMessage = chunk.reason?.failure?.message ?? null
			}
		}
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error)
		const cleaned = cleanSummary(text)
		// 已经攒到可用文本就当成功 —— 流尾报错通常不影响前半段
		if (cleaned) return { text: cleaned, model: options.model }
		return { error: `请求失败：${message}` }
	}

	const cleaned = cleanSummary(text)
	if (cleaned) return { text: cleaned, model: options.model }

	const elapsed = now() // 仅用于错误信息里给一个"耗时"感（调用方会覆盖）
	void elapsed
	if (finish === 'max-tokens') {
		return { error: `模型没写出正文就用完了 maxTokens=${options.maxTokens}（终止原因 max-tokens）` }
	}
	if (finish === 'error' || finish === 'aborted') {
		return { error: `模型调用终止：${finish}${failureMessage ? ` · ${failureMessage}` : ''}` }
	}
	if (finish === null) return { error: '调用结束但没有收到 finish 事件' }
	return { error: `模型输出为空（终止原因 ${finish}）` }
}

export interface SummaryBatchResult {
	/** id → 摘要文本 */
	summaries: Map<string, SummaryOutcome>
	/** id → 失败原因。用来在日报里显式标注"这几条没摘要成功 + 为什么"。 */
	failures: Map<string, string>
	skipped: number
}

/**
 * 批量生成。并发受限、单条失败隔离。
 *
 * 为什么用"游标 + N 个 worker"而不是 `Promise.all(items.map(...))`：
 * 后者会一次性把所有请求打出去。20 条摘要对推理模型来说可能是几十秒的并发压力，
 * 撞限流只会让更多条失败。
 */
export async function summarizeItems(
	items: readonly SummarySource[],
	options: SummaryOptions,
): Promise<SummaryBatchResult> {
	const targets = items.slice(0, Math.max(0, options.maxItems))
	const summaries = new Map<string, SummaryOutcome>()
	const failures = new Map<string, string>()
	const skipped = Math.max(0, items.length - targets.length)

	let cursor = 0
	const workers = new Array(Math.max(1, Math.min(options.concurrency, targets.length)))
		.fill(null)
		.map(async () => {
			for (;;) {
				const index = cursor++
				const item = targets[index]
				if (!item) return
				if (options.signal?.aborted) return
				const result = await summarizeOne(item, options)
				if ('error' in result) failures.set(item.id, result.error)
				else summaries.set(item.id, result)
			}
		})
	await Promise.all(workers)

	return { summaries, failures, skipped }
}

// ---------- 缓存 ----------

export interface AiCacheEntry {
	text: string
	model: string
	at: string
}

export interface AiCache {
	version: number
	entries: Record<string, AiCacheEntry>
}

export function emptyCache(): AiCache {
	return { version: 1, entries: {} }
}

/** 读缓存并顺手清理过期/超量项。返回的是**可直接使用**的缓存。 */
export function readCache(
	raw: unknown,
	now: Date,
	ttlDays: number,
	maxEntries: number,
): AiCache {
	const source =
		raw && typeof raw === 'object' && 'entries' in (raw as Record<string, unknown>)
			? ((raw as AiCache).entries ?? {})
			: {}
	const ttlMs = Math.max(0, ttlDays) * 86_400_000
	const alive: Array<[string, AiCacheEntry]> = []
	for (const [key, entry] of Object.entries(source)) {
		if (!entry || typeof entry.text !== 'string' || !entry.text) continue
		const at = Date.parse(entry.at ?? '')
		if (!Number.isFinite(at)) continue
		if (ttlMs > 0 && now.getTime() - at > ttlMs) continue
		alive.push([key, { text: entry.text, model: entry.model ?? '', at: entry.at }])
	}
	// 超出上限时淘汰写入时间最早的
	alive.sort((a, b) => (a[1].at < b[1].at ? 1 : -1))
	return { version: 1, entries: Object.fromEntries(alive.slice(0, Math.max(0, maxEntries))) }
}

export function mergeCache(
	cache: AiCache,
	additions: Map<string, SummaryOutcome>,
	now: Date,
): AiCache {
	const entries = { ...cache.entries }
	for (const [id, outcome] of additions) {
		entries[id] = { text: outcome.text, model: outcome.model, at: now.toISOString() }
	}
	return { version: 1, entries }
}
