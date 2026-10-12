import type http from 'node:http'
import { readFile, stat } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import type { DailyService } from './service.js'
import { localDate } from './store.js'

/**
 * HTTP 层：一个前缀路由，两种职责。
 *
 * - `/dsh-daily/`        → 直出 `web/` 里的侧面栏网页（静态，无构建步骤）
 * - `/dsh-daily/api/*`   → JSON 接口
 *
 * 挂在同一个前缀下是为了让页面里所有请求都能写成相对路径（`./api/state`），
 * 换端口、换 host、被反过来代理都不会坏。
 *
 * 安全：只接受 GET/HEAD/POST；静态路径先规范化再判断是否还在 web/ 内（`..` 出不去）；
 * 请求体有大小上限。这些都是同一个 host 上跑的代码，但"同源"不是"可信"。
 */

export const MOUNT = '/dsh-daily'
const API_PREFIX = `${MOUNT}/api/`
const MAX_BODY_BYTES = 64 * 1024

const MIME: Record<string, string> = {
	'.html': 'text/html; charset=utf-8',
	'.css': 'text/css; charset=utf-8',
	'.js': 'text/javascript; charset=utf-8',
	'.mjs': 'text/javascript; charset=utf-8',
	'.json': 'application/json; charset=utf-8',
	'.svg': 'image/svg+xml',
	'.png': 'image/png',
	'.jpg': 'image/jpeg',
	'.webp': 'image/webp',
	'.ico': 'image/x-icon',
}

function findRoot(start: string): string {
	let dir = start
	for (let i = 0; i < 4; i++) {
		if (existsSync(path.join(dir, 'package.json'))) return dir
		dir = path.resolve(dir, '..')
	}
	return start
}

/** 本文件编译后在 lib/api.js，所以 web/ 在包根下。 */
const PACKAGE_ROOT = findRoot(path.dirname(fileURLToPath(import.meta.url)))
const WEB_ROOT = path.join(PACKAGE_ROOT, 'web')

function sendJson(res: http.ServerResponse, status: number, payload: unknown): void {
	const body = JSON.stringify(payload)
	res.writeHead(status, {
		'content-type': 'application/json; charset=utf-8',
		'content-length': Buffer.byteLength(body),
		'cache-control': 'no-store',
	})
	res.end(body)
}

async function readJsonBody(req: http.IncomingMessage): Promise<Record<string, unknown>> {
	const chunks: Buffer[] = []
	let size = 0
	for await (const chunk of req) {
		const buf = chunk as Buffer
		size += buf.length
		if (size > MAX_BODY_BYTES) throw new Error('请求体过大')
		chunks.push(buf)
	}
	if (size === 0) return {}
	const text = Buffer.concat(chunks).toString('utf8')
	try {
		const parsed: unknown = JSON.parse(text)
		return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {}
	} catch {
		throw new Error('请求体不是合法 JSON')
	}
}

function first(value: string | null): string | undefined {
	return value === null || value === '' ? undefined : value
}

async function handleApi(
	service: DailyService,
	url: URL,
	req: http.IncomingMessage,
	res: http.ServerResponse,
): Promise<void> {
	const route = url.pathname.slice(API_PREFIX.length).replace(/\/+$/, '')
	const q = url.searchParams

	try {
		switch (route) {
			case 'state': {
				if (req.method !== 'GET') return sendJson(res, 405, { ok: false, error: '只支持 GET' })
				return sendJson(res, 200, await service.getState())
			}
			case 'items': {
				if (req.method !== 'GET') return sendJson(res, 405, { ok: false, error: '只支持 GET' })
				const limit = first(q.get('limit'))
				return sendJson(
					res,
					200,
					await service.getItems({
						date: first(q.get('date')),
						topic: first(q.get('topic')),
						q: first(q.get('q')),
						unread: q.get('unread') === '1',
						includeHidden: q.get('hidden') === '1',
						limit: limit ? Number(limit) : undefined,
					}),
				)
			}
			case 'sources': {
				if (req.method !== 'GET') return sendJson(res, 405, { ok: false, error: '只支持 GET' })
				return sendJson(res, 200, { ok: true, sources: service.sourceCatalogView() })
			}
			case 'digest': {
				if (req.method !== 'GET') return sendJson(res, 405, { ok: false, error: '只支持 GET' })
				// 默认日期必须走本地时区：用 toISOString() 会在凌晨 0~8 点串到昨天
				const date = first(q.get('date')) ?? localDate()
				const markdown = await service.store.readDigest(date)
				if (markdown === null) {
					// 「这一天还没有日报」是**正常状态**，不是接口错误。
					// 早先返回 ok:false，前端把它当整页错误处理，于是点「日报预览」什么都不发生、
					// 页面顶上却弹出一条错误 —— 一个正常的空状态被表达成了故障。
					return sendJson(res, 200, { ok: true, available: false, date, markdown: null })
				}
				return sendJson(res, 200, { ok: true, available: true, date, markdown })
			}
			case 'feedback': {
				if (req.method !== 'POST') return sendJson(res, 405, { ok: false, error: '只支持 POST' })
				const body = await readJsonBody(req)
				const id = typeof body.id === 'string' ? body.id : ''
				const action = typeof body.action === 'string' ? body.action : ''
				if (!id || !action) return sendJson(res, 400, { ok: false, error: '需要 id 与 action' })
				await service.setFeedback(id, action)
				return sendJson(res, 200, { ok: true })
			}
			case 'tune': {
				if (req.method !== 'POST') return sendJson(res, 405, { ok: false, error: '只支持 POST' })
				const body = await readJsonBody(req)
				const text = typeof body.text === 'string' ? body.text : ''
				if (!text.trim()) return sendJson(res, 400, { ok: false, error: '调教内容不能为空' })
				const result = await service.tune(text)
				return sendJson(res, 200, {
					ok: true,
					applied: result.applied.map((c) => c.detail),
					message: result.message,
					prefs: result.prefs,
				})
			}
			case 'ai': {
				if (req.method !== 'POST') return sendJson(res, 405, { ok: false, error: '只支持 POST' })
				const body = await readJsonBody(req)
				const date = typeof body.date === 'string' && body.date ? body.date : undefined
				// 会真的调模型（可能花 token），所以要求显式 POST；失败不影响已抓到的数据
				const stats = await service.regenerateAiSummaries(date)
				if (!stats) return sendJson(res, 200, { ok: false, error: '这一天还没有条目' })
				return sendJson(res, 200, { ok: true, stats })
			}
			case 'opml': {
				// GET = 导出（只读）；POST = 导入（写盘，下一次刷新生效）
				if (req.method === 'GET') {
					const { xml, count } = await service.exportOpml()
					return sendJson(res, 200, { ok: true, count, xml })
				}
				if (req.method === 'POST') {
					const body = await readJsonBody(req)
					const xml = typeof body.xml === 'string' ? body.xml : ''
					if (!xml.trim()) return sendJson(res, 400, { ok: false, error: '需要 xml 字段' })
					const result = await service.importOpml(xml)
					return sendJson(res, 200, { ok: true, ...result })
				}
				return sendJson(res, 405, { ok: false, error: '只支持 GET / POST' })
			}
			case 'research': {
				const fresh = new URL(url, 'http://x').searchParams.get('force') === '1'
				if (req.method === 'GET' && !fresh) {
					const cached = await service.readResearchPlan()
					return sendJson(res, 200, { ok: true, plan: cached, project: service.currentProject() })
				}
				if (req.method === 'POST' || (req.method === 'GET' && fresh)) {
					const plan = await service.planResearch({ force: fresh })
					return sendJson(res, 200, { ok: true, plan })
				}
				return sendJson(res, 405, { ok: false, error: '只支持 GET / POST' })
			}
			case 'profile': {
				// GET = 读上次生成的画像；POST = 重新采集（会写盘到该项目的 profile.json）
				if (req.method === 'GET') {
					const cached = await service.readProfile()
					return sendJson(res, 200, { ok: true, profile: cached, project: service.currentProject() })
				}
				if (req.method === 'POST') {
					const profile = await service.buildProfile()
					return sendJson(res, 200, { ok: true, profile })
				}
				return sendJson(res, 405, { ok: false, error: '只支持 GET / POST' })
			}
			case 'projects': {
				// 项目 = 工作目录。GET 看清单与当前，POST 切换（会影响后续所有读写）
				if (req.method === 'GET') {
					const { current, projects } = await service.listKnownProjects()
					return sendJson(res, 200, { ok: true, current, projects })
				}
				if (req.method === 'POST') {
					const body = await readJsonBody(req)
					// POST { auto: true } = 交回自动识别（并立刻识别一次）
					if (body.auto === true) {
						const followed = await service.followAuto()
						return sendJson(res, 200, { ok: true, project: followed.project, detected: followed.detected })
					}
					if (typeof body.dir !== 'string' || !body.dir.trim()) {
						return sendJson(res, 400, { ok: false, error: '需要 dir（项目工作目录的绝对路径）或 auto' })
					}
					const result = await service.useProject(body.dir)
					if (!result.ok) return sendJson(res, 200, { ok: false, error: result.reason })
					return sendJson(res, 200, { ok: true, project: result.project })
				}
				return sendJson(res, 405, { ok: false, error: '只支持 GET / POST' })
			}
			case 'feeds': {
				if (req.method === 'GET') {
					return sendJson(res, 200, { ok: true, feeds: await service.listCustomFeeds() })
				}
				if (req.method === 'POST') {
					const body = await readJsonBody(req)
					const action = typeof body.action === 'string' ? body.action : ''
					if (action !== 'remove') {
						return sendJson(res, 400, { ok: false, error: `未知的 action：${action}（可用：remove）` })
					}
					if (typeof body.url !== 'string' || !body.url.trim()) {
						return sendJson(res, 400, { ok: false, error: '需要 url' })
					}
					const result = await service.removeCustomFeed(body.url)
					return sendJson(res, 200, { ok: true, ...result })
				}
				return sendJson(res, 405, { ok: false, error: '只支持 GET / POST' })
			}
			case 'archive': {
				if (req.method !== 'GET') return sendJson(res, 405, { ok: false, error: '只支持 GET' })
				const limit = Number(first(q.get('limit')) ?? 30)
				return sendJson(res, 200, {
					ok: true,
					days: await service.listArchive(Number.isFinite(limit) ? Math.min(180, limit) : 30),
				})
			}
			case 'weekly': {
				if (req.method !== 'GET') return sendJson(res, 405, { ok: false, error: '只支持 GET' })
				// 与 digest 一致：缺就现场生成（幂等，且会落盘到 digest/）
				const end = first(q.get('end'))
				const days = Number(first(q.get('days')) ?? 7)
				const review = await service.buildWeeklyReview(
					end,
					Number.isFinite(days) ? Math.min(31, Math.max(1, days)) : 7,
				)
				return sendJson(res, 200, { ok: true, ...review })
			}
			case 'storage': {
				// GET = 只看容量与"会做什么"（dry run，不写盘）；POST = 真的执行整理
				if (req.method === 'GET') {
					const stats = await service.storageStats()
					const plan = await service.pruneArchive({ apply: false })
					return sendJson(res, 200, {
						ok: true,
						stats,
						plan: { keep: plan.keep, compacted: plan.compacted, deleted: plan.deleted, changes: plan.changes },
					})
				}
				if (req.method === 'POST') {
					const report = await service.pruneArchive({ apply: true })
					return sendJson(res, 200, { ok: true, ...report })
				}
				return sendJson(res, 405, { ok: false, error: '只支持 GET / POST' })
			}
			case 'refresh': {
				if (req.method !== 'POST') return sendJson(res, 405, { ok: false, error: '只支持 POST' })
				const summary = await service.refresh()
				return sendJson(res, 200, {
					ok: true,
					summary: {
						durationMs: summary.durationMs,
						okSources: summary.okSources,
						failedSources: summary.failedSources,
						total: summary.total,
						new: summary.added,
					},
				})
			}
			default:
				return sendJson(res, 404, { ok: false, error: `未知接口：${route}` })
		}
	} catch (error) {
		// 接口层绝不把异常变成"连接被重置"：前端要能显示一句人话
		sendJson(res, 500, {
			ok: false,
			error: error instanceof Error ? error.message : String(error),
		})
	}
}

async function resolveStatic(urlPath: string): Promise<string | null> {
	let clean: string
	try {
		clean = decodeURIComponent(urlPath.split('?')[0] ?? MOUNT)
	} catch {
		return null
	}
	if (!clean.startsWith(MOUNT)) return null
	const rel = clean.slice(MOUNT.length)
	const target = path.join(WEB_ROOT, rel === '' || rel === '/' ? 'index.html' : rel)
	if (target !== WEB_ROOT && !target.startsWith(WEB_ROOT + path.sep)) return null
	try {
		if ((await stat(target)).isFile()) return target
	} catch {
		return null
	}
	return null
}

async function handleStatic(
	url: URL,
	req: http.IncomingMessage,
	res: http.ServerResponse,
): Promise<void> {
	if (req.method !== 'GET' && req.method !== 'HEAD') {
		res.writeHead(405, { 'content-type': 'text/plain; charset=utf-8', allow: 'GET, HEAD' })
		res.end('只支持 GET / HEAD')
		return
	}
	const file = await resolveStatic(url.pathname)
	if (!file) {
		res.writeHead(404, { 'content-type': 'text/html; charset=utf-8' })
		res.end(
			`<h1>404</h1><p>日报页面没有这个资源。<a href="${MOUNT}/">回到日报</a>。</p>`,
		)
		return
	}
	try {
		const body = await readFile(file)
		res.writeHead(200, {
			'content-type': MIME[path.extname(file)] ?? 'application/octet-stream',
			// 页面是源码直出、路径不带指纹，所以不让缓存：改完刷新就能看到
			'cache-control': 'no-store',
		})
		res.end(req.method === 'HEAD' ? undefined : body)
	} catch (error) {
		res.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' })
		res.end(String(error))
	}
}

export interface WebServerLike {
	register(spec: {
		kind: 'exact' | 'prefix'
		path: string
		handler: (req: http.IncomingMessage, res: http.ServerResponse) => void
	}): () => void
}

export function mountRoutes(webServer: WebServerLike, service: DailyService): () => void {
	return webServer.register({
		kind: 'prefix',
		path: MOUNT,
		handler: (req, res) => {
			const url = new URL(req.url ?? MOUNT, 'http://localhost')
			if (url.pathname.startsWith(API_PREFIX)) {
				void handleApi(service, url, req, res)
				return
			}
			void handleStatic(url, req, res)
		},
	})
}
