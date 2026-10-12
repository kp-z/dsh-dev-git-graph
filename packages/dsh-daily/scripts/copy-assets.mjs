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
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const pkg = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'))

await mkdir(path.join(root, 'lib'), { recursive: true })

// 浏览器半体：把模块 id 占位符替换成**真实包名**。
// 必须与 package.json 的 name 一致 —— DSH 的客户端模块清单按包名索引，
// id 对不上时 bundle 会被正常请求（200）却永不激活（详见 src/client.js 顶部注释）。
const client = await readFile(path.join(root, 'src/client.js'), 'utf8')
if (!client.includes('__DSH_PACKAGE_NAME__')) {
	throw new Error('src/client.js 里找不到 __DSH_PACKAGE_NAME__ 占位符 —— 模块 id 会与包名漂移')
}
await writeFile(path.join(root, 'lib/client.js'), client.replaceAll('__DSH_PACKAGE_NAME__', pkg.name))
console.log(`copied src/client.js → lib/client.js（模块 id = ${pkg.name}）`)
