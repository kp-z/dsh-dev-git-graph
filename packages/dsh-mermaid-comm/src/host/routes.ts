/**
 * 主机端 chunk 路由：服务客户端 mermaid 懒加载 chunk。
 *
 * URL: /plugins/dsh-mermaid-comm/chunks/mermaid.js
 * 文件: <profile node_modules>/dsh-mermaid-comm/lib/client-mermaid.js
 *
 * 为什么不用官方 /plugins/<id>/client.js 路由：那个路由只服务 client.js 主 bundle，
 * 不能服务任意文件名（chunk 是独立 bundle）。对齐 dsh-better-sidebar 的 /sidebar/bundle
 * 模式：插件自己的 webServer 路由服务 chunk，带 ETag 缓存复用。
 *
 * 安全：只允许服务已知 chunk 文件名（白名单），避免任意文件读取；仅 GET/HEAD。
 */
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { readFile, stat } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import type { Context } from '@deepseek-ai/cordis'
import type { IncomingMessage, ServerResponse } from 'node:http'
// 触发 @deepseek-ai/dsh-host-webserver 的 cordis 模块增强（提供 ctx.webServer 类型）
import type {} from '@deepseek-ai/dsh-host-webserver'

/** 支持的 chunk 白名单（文件名 → 实际文件）。 */
const CHUNKS: Record<string, string> = {
  'mermaid': 'client-mermaid.js',
}

/** chunk 文件所在目录（插件包 lib/；lib/host/routes.js 的上级）。 */
function chunkDir(): string {
  const here = fileURLToPath(import.meta.url)
  return dirname(dirname(here))
}

const etags = new Map<string, string>()

async function etagOf(file: string): Promise<string | undefined> {
  const key = file
  try {
    const info = await stat(file)
    const memo = etags.get(key)
    if (memo !== undefined && memo.startsWith(`"${info.mtimeMs}:${info.size}"`)) {
      return memo
    }
    const hash = createHash('sha1').update(await readFile(file)).digest('hex').slice(0, 16)
    const etag = `"${info.mtimeMs}:${info.size}:${hash}"`
    etags.set(key, etag)
    return etag
  } catch {
    return undefined
  }
}

export function createChunkRouteHandler(): (req: IncomingMessage, res: ServerResponse) => Promise<void> {
  return async (req, res): Promise<void> => {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405)
      res.end()
      return
    }
    const pathname = new URL(req.url ?? '/', 'http://dsh.internal').pathname
    const match = /^\/plugins\/dsh-mermaid-comm\/chunks\/([a-z0-9-]+)\.js$/.exec(pathname)
    const name = match?.[1]
    if (name === undefined || CHUNKS[name] === undefined) {
      res.writeHead(404)
      res.end('not found')
      return
    }
    const file = join(chunkDir(), CHUNKS[name])
    const etag = await etagOf(file)
    if (etag === undefined) {
      res.writeHead(404)
      res.end('not found')
      return
    }
    if (req.headers['if-none-match'] === etag) {
      res.writeHead(304, { 'cache-control': 'no-cache', etag })
      res.end()
      return
    }
    try {
      const body = await readFile(file)
      res.writeHead(200, {
        'content-type': 'text/javascript; charset=utf-8',
        'cache-control': 'no-cache',
        etag,
      })
      res.end(body)
    } catch {
      res.writeHead(404)
      res.end('not found')
    }
  }
}

/** 注册 chunk 路由（随插件 fiber 销毁）。 */
export function registerChunkRoute(ctx: Context): () => void {
  return ctx.webServer.register({
    kind: 'prefix',
    path: '/plugins/dsh-mermaid-comm/chunks',
    handler: createChunkRouteHandler(),
  })
}
