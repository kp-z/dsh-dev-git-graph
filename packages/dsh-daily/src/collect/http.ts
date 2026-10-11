/**
 * 采集层的 HTTP 基建。
 *
 * 这里只做三件事，但每件都是采集能不能活下来的关键：
 * 1. **超时**：单个源卡住不能拖垮整轮采集。用 AbortSignal.timeout，外部 signal 也一并接上。
 * 2. **退避重试**：只对"值得重试"的失败重试（网络错误、429、5xx）。
 *    4xx（除了 429）直接放弃 —— 拿 403 重试三次只是浪费用户 30 秒。
 * 3. **默认头**：不少站（尤其哔哩哔哩）对无 UA 的请求直接风控。
 */

export class HttpError extends Error {
	readonly status: number
	readonly url: string
	constructor(message: string, status: number, url: string) {
		super(message)
		this.name = 'HttpError'
		this.status = status
		this.url = url
	}
}

export interface FetchOptions {
	timeoutMs?: number
	/** 额外重试次数（不含首次）。默认 2。 */
	retries?: number
	headers?: Record<string, string>
	signal?: AbortSignal
	/** 部分源（哔哩哔哩）要求同站 Referer，否则 403 / 风控。 */
	referer?: string
}

const DEFAULT_UA =
	'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36'

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
	return new Promise((resolve, reject) => {
		const timer = setTimeout(() => {
			signal?.removeEventListener('abort', onAbort)
			resolve()
		}, ms)
		const onAbort = () => {
			clearTimeout(timer)
			reject(new Error('aborted'))
		}
		if (signal?.aborted) onAbort()
		else signal?.addEventListener('abort', onAbort, { once: true })
	})
}

function shouldRetry(status: number): boolean {
	return status === 429 || status === 408 || status >= 500
}

/** 把一次 HTTP 取文本的语义收干净：非 2xx 抛 HttpError，网络错误原样抛。 */
export async function fetchText(url: string, options: FetchOptions = {}): Promise<string> {
	const timeoutMs = options.timeoutMs ?? 12_000
	const retries = options.retries ?? 2
	let lastError: unknown

	for (let attempt = 0; attempt <= retries; attempt++) {
		if (options.signal?.aborted) throw new Error('aborted')
		// 每次尝试一个独立的超时窗；再和外部 signal 合并，任一触发就中断
		const timeout = AbortSignal.timeout(timeoutMs)
		const signals = options.signal ? [timeout, options.signal] : [timeout]
		const signal = AbortSignal.any(signals)
		const headers: Record<string, string> = {
			'user-agent': DEFAULT_UA,
			accept: 'application/rss+xml, application/atom+xml, application/xml, text/xml, application/json, text/html;q=0.8, */*;q=0.5',
			'accept-language': 'zh-CN,zh;q=0.9,en;q=0.8',
			...(options.referer ? { referer: options.referer } : {}),
			...options.headers,
		}

		try {
			const response = await fetch(url, { headers, signal, redirect: 'follow' })
			if (!response.ok) {
				const body = await response.text().catch(() => '')
				const error = new HttpError(
					`HTTP ${response.status}${body ? ` · ${body.slice(0, 120).replace(/\s+/g, ' ')}` : ''}`,
					response.status,
					url,
				)
				if (shouldRetry(response.status) && attempt < retries) {
					lastError = error
					await sleep(400 * 2 ** attempt + Math.floor(Math.random() * 200), options.signal)
					continue
				}
				throw error
			}
			return await response.text()
		} catch (error) {
			// 外部取消：立刻退出，不重试
			if (options.signal?.aborted) throw error
			lastError = error
			if (attempt < retries && !(error instanceof HttpError && !shouldRetry(error.status))) {
				await sleep(400 * 2 ** attempt + Math.floor(Math.random() * 200), options.signal)
				continue
			}
			throw error
		}
	}
	throw lastError instanceof Error ? lastError : new Error(String(lastError))
}

export async function fetchJson<T = unknown>(url: string, options: FetchOptions = {}): Promise<T> {
	const text = await fetchText(url, {
		...options,
		headers: { accept: 'application/json, */*;q=0.5', ...options.headers },
	})
	try {
		return JSON.parse(text) as T
	} catch {
		throw new Error(`响应不是合法 JSON：${url} · ${text.slice(0, 120)}`)
	}
}

/** 简单的并发闸门：抓取轮次用它限制同时在飞的请求数。 */
export async function mapLimit<T, R>(
	items: readonly T[],
	limit: number,
	mapper: (item: T, index: number) => Promise<R>,
): Promise<Array<PromiseSettledResult<R>>> {
	const results: Array<PromiseSettledResult<R>> = new Array(items.length)
	let cursor = 0
	const workers = new Array(Math.max(1, Math.min(limit, items.length))).fill(null).map(
		async () => {
			for (;;) {
				const index = cursor++
				if (index >= items.length) return
				try {
					const value = await mapper(items[index] as T, index)
					results[index] = { status: 'fulfilled', value }
				} catch (reason) {
					results[index] = { status: 'rejected', reason }
				}
			}
		},
	)
	await Promise.all(workers)
	return results
}
