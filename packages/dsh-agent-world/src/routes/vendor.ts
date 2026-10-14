/**
 * 面板第三方资源的白名单服务（按仓库约定，BACKLOG M4-8）。
 *
 * ## 为什么不复用静态面板那条通配路由
 *
 * 静态面板的 `/*` 会服务**任何**能在目录树里找到、且扩展名在白名单里的文件。
 * 对面板自己的资源那是对的（同一次构建出来的，可以互相信任）；对 **vendored 第三方代码**
 * 就不合适了：那是一个"只该服务这几个确切文件"的地方，白名单应当**穷举**，
 * 而不是靠扩展名放行。仓库根 `docs/DIRECTORY.md` 的约定也是这个意思
 * （"精确文件名 → MIME；未命中 / 穿越一律 404"）。
 *
 * ## 路径穿越在这里天然不成立
 *
 * 路由模式是 `/vendor/:file`——**单段**，所以 `../` 根本进不来（那会让段数不匹配）。
 * 叠加上"只认白名单里的确切文件名"，这一层没有拼接路径的机会。
 * 这不是省了防护，是**把防护换成了更强的形式**：不构造路径，就不会拼错路径。
 *
 * ## 与约定的一处偏离
 *
 * 仓库约定里宿主路径是 `GET /vendor/:file`，但 `webServer.register` 对重复的
 * `(kind, path)` **会直接抛错**，而 `dsh-contract-butler` 已经占了它。
 * 所以这里挂在**本插件自己的前缀**下（`/agent-world/vendor/:file`），
 * 免得让对方的插件起不来。理由写在 `src/vendor/README.md` 里。
 */
import { readFile } from 'node:fs/promises'
import type http from 'node:http'
import { join } from 'node:path'
import type { RouteEntry } from './router.js'
import { HttpError } from './router.js'

/**
 * **穷举**白名单：文件名 → MIME。
 *
 * 加一个 vendored 文件必须同时加在这里——`test/vendor.test.js` 会逐个核对目录内容，
 * 漏了会红。这是刻意的摩擦：文件进了 `src/vendor/` 却忘了开路由，
 * 表现是"运行时 404"，而那时你已经在看别的错误了。
 */
export const VENDOR_WHITELIST: Readonly<Record<string, string>> = {
  'three.module.min.js': 'text/javascript; charset=utf-8',
  'three.OrbitControls.js': 'text/javascript; charset=utf-8',
  'LICENSE.three': 'text/plain; charset=utf-8',
}

/**
 * 造 vendor 路由。
 *
 * @param rootDir - vendored 资源目录（`lib/vendor`）。
 */
export function vendorRoutes(rootDir: string): RouteEntry[] {
  return [
    {
      method: 'GET',
      pattern: '/vendor/:file',
      handler: async ({ pathname, res }) => {
        const name = pathname.slice('/vendor/'.length)
        const mime = VENDOR_WHITELIST[name]
        if (mime === undefined) {
          throw new HttpError(
            404,
            `不在白名单里的第三方资源 "${name}"。已开放：${Object.keys(VENDOR_WHITELIST).join(' / ')}`,
          )
        }

        const body = await readFile(join(rootDir, name)).catch(() => null)
        if (body === null) {
          // 白名单里有、磁盘上没有：这是**构建没同步**，不是请求写错了。
          // 所以报错要说清该去哪找，而不是只说"找不到"。
          throw new HttpError(
            404,
            `资源 "${name}" 在白名单里但读不到。` +
              `多半是构建没把 src/vendor/ 同步到 lib/vendor/（跑 pnpm run build:web）。路径：${join(rootDir, name)}`,
          )
        }

        res.writeHead(200, {
          'Content-Type': mime,
          'Content-Length': body.length,
          // vendored 资源版本固定（在文件名与 README 里记着版本号），没有理由每次回源。
          'Cache-Control': 'public, max-age=3600',
        })
        res.end(body)
        return undefined
      },
    },
  ]
}

/**
 * 列出白名单里的文件名。
 *
 * 给测试与诊断用：`src/vendor/` 里出现没登记的文件时，要能报出"多了什么"。
 */
export function vendorFileNames(): string[] {
  return Object.keys(VENDOR_WHITELIST).sort()
}

/** 供类型推断用的响应形状（避免 `http` 被 TS 当成未使用）。 */
export type VendorResponse = http.ServerResponse
