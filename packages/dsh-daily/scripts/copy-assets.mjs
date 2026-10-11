/**
 * 构建后的资源拷贝。
 *
 * 只有一件事：`src/client.js` 是浏览器半体（原生 JS，不是 TS，因为它要被
 * Loader 以 `window.__ModuleLoader__.load` 的形式直接执行，走 tsc 只会多一层包装），
 * 需要原样拷到 `lib/client.js`，因为 package.json 的 `exports["./client"]` 指向那里。
 *
 * `web/` 不需要拷贝：host 路由直接从包根的 `web/` 直出静态文件，
 * 多拷一份反而会制造"改了 web/ 但页面没变"的困惑。
 */
import { copyFile, mkdir } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const tasks = [
	['src/client.js', 'lib/client.js'],
]

await mkdir(path.join(root, 'lib'), { recursive: true })
for (const [from, to] of tasks) {
	await copyFile(path.join(root, from), path.join(root, to))
	console.log(`copied ${from} → ${to}`)
}
