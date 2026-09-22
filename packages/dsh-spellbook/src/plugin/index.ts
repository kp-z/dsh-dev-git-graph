/**
 * dsh-spellbook host entry —— 把构建好的咒语书静态站挂到宿主路由上。
 *
 *    GET /dsh-spellbook/            -> dist/index.html（目录页）
 *    GET /dsh-spellbook/spell/<slug>/ -> 条目页
 *    GET /dsh-spellbook/**          -> dist/ 下的静态文件（CSS / 字体 / 检索索引 / demo）
 *
 * 为什么整站从 dist/ 直出，而不是在插件里再渲染一遍：
 * 咒语书的每个条目都带一个**真在跑**的预览，而那些预览是构建期算好的独立文档
 * （dist/spell/<slug>/demo.html，被 sandbox 的 iframe 载入）。站点本身也是构建期的
 * 产物 —— 332 条咒语、检索索引、按条目数算出来的编号栏宽，都是 build.mjs 一次成型。
 * 插件在这里只该做一件事：把那个目录原样端出去。再渲染一遍就等于维护第二套渲染器，
 * 而它迟早跟构建期那套长得不一样。
 *
 * 安全：路径先规范化再判断是否还在 dist/ 里（`..` 出不去）；只管 GET/HEAD。
 */
import type http from 'node:http'
import type { Context } from '@deepseek-ai/cordis'
import { readFile, stat } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

export const name = 'dsh-spellbook'
export const inject = ['webServer']

/** 挂载前缀。站点内部全是相对路径，所以挂在子路径下不需要改任何一处链接。 */
const MOUNT = '/dsh-spellbook'

// 本文件编译后在 lib/index.js。但输出目录以后可能变（lib/plugin/… 之类），
// 所以不写死「往上几级」，而是往上找第一个带 package.json 的目录 —— 那就是包根。
// 找错了不会报错，只会整套 404，所以这里宁可多找两级也不要写死。
function findRoot(start: string): string {
	let dir = start
	for (let i = 0; i < 4; i++) {
		if (existsSync(path.join(dir, 'package.json'))) return dir
		dir = path.resolve(dir, '..')
	}
	return start
}

const ROOT = findRoot(path.dirname(fileURLToPath(import.meta.url)))
const DIST = path.join(ROOT, 'dist')

const MIME: Record<string, string> = {
	'.html': 'text/html; charset=utf-8',
	'.css': 'text/css; charset=utf-8',
	'.js': 'text/javascript; charset=utf-8',
	'.mjs': 'text/javascript; charset=utf-8',
	'.json': 'application/json; charset=utf-8',
	'.woff2': 'font/woff2',
	'.svg': 'image/svg+xml',
	'.png': 'image/png',
	'.jpg': 'image/jpeg',
	'.webp': 'image/webp',
	'.ico': 'image/x-icon',
}

async function isDirectory(target: string): Promise<boolean> {
	try {
		return (await stat(target)).isDirectory()
	} catch {
		return false
	}
}

/**
 * 把一个 URL 路径映射到 dist/ 里的真实文件。
 * 目录补 index.html，无扩展名也补一次（站点用的是 `spell/<slug>/` 这种目录式链接）。
 * 越界的（`..`、绝对路径逃逸）一律 null —— 返回 null 就是 404。
 */
async function resolveFile(urlPath: string): Promise<string | null> {
	let clean: string
	try {
		clean = decodeURIComponent(urlPath.split('?')[0])
	} catch {
		return null
	}
	if (!clean.startsWith(MOUNT)) return null

	const target = path.join(DIST, clean.slice(MOUNT.length))
	// path.join 已经规范化过，这里再确认它没跳出 dist
	if (target !== DIST && !target.startsWith(DIST + path.sep)) return null

	if (await isDirectory(target)) {
		const index = path.join(target, 'index.html')
		return existsSync(index) ? index : null
	}
	if (existsSync(target)) return target

	const withIndex = path.join(target, 'index.html')
	return existsSync(withIndex) ? withIndex : null
}

interface WebServerLike {
	register(spec: {
		kind: 'exact' | 'prefix'
		path: string
		handler: (req: http.IncomingMessage, res: http.ServerResponse) => void
	}): () => void
}

export function apply(ctx: Context): void {
	ctx.inject(['webServer'], (host) => {
		const webServer = (host as unknown as { webServer: WebServerLike }).webServer

		const dispose = webServer.register({
			kind: 'prefix',
			path: MOUNT,
			handler: (req, res) => {
				void (async () => {
					if (req.method !== 'GET' && req.method !== 'HEAD') {
						res.writeHead(405, { 'content-type': 'text/plain; charset=utf-8', allow: 'GET, HEAD' })
						res.end('只支持 GET / HEAD')
						return
					}

					const file = await resolveFile(req.url ?? MOUNT)
					if (!file) {
						res.writeHead(404, { 'content-type': 'text/html; charset=utf-8' })
						res.end(`<h1>404</h1><p>咒语书里没有这一页。<a href="${MOUNT}/">回目录</a>。</p>`)
						return
					}

					try {
						const body = await readFile(file)
						res.writeHead(200, {
							'content-type': MIME[path.extname(file)] ?? 'application/octet-stream',
							// 站点是构建产物，路径不带指纹，所以不让缓存 —— 重建后刷新就能看到新的
							'cache-control': 'no-store',
						})
						res.end(req.method === 'HEAD' ? undefined : body)
					} catch (error) {
						res.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' })
						res.end(String(error))
					}
				})()
			},
		})

		;(ctx.on as unknown as (event: string, cb: () => void) => void)('dispose', () => dispose())
	})
}
