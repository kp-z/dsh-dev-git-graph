/**
 * 把 `web/` 同步到 `lib/web/`。
 *
 * 为什么要这一步（而不是直接服务 `web/`）：本仓库的 `file:` 依赖装进 profile 时是
 * **硬链接副本**，`files` 白名单**不包含** `web/`，而 `lib/` 是包含的。
 * 服务编译产物里的那一份，就不会踩"新增文件没被同步进 profile"的坑
 * （见 docs/DEVELOPMENT.md §7）。
 *
 * M4 会把它换成 Vite 构建；现在这一步没有打包，只是复制。
 */
import { cp, rm } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

const src = fileURLToPath(new URL('../web/', import.meta.url))
const dest = fileURLToPath(new URL('../lib/web/', import.meta.url))

await rm(dest, { recursive: true, force: true })
await cp(src, dest, { recursive: true })
console.log(`web → lib/web （${src}）`)

// vendored 第三方资源：源在 `src/vendor/`（入库），运行期读 `lib/vendor/`。
// 分开放是仓库约定（docs/DIRECTORY.md）：面板自己的资源与"别人写的代码"不该混在一起，
// 后者要走白名单路由，前者可以走通配。
const vendorSrc = fileURLToPath(new URL('../src/vendor/', import.meta.url))
const vendorDest = fileURLToPath(new URL('../lib/vendor/', import.meta.url))

await rm(vendorDest, { recursive: true, force: true })
await cp(vendorSrc, vendorDest, { recursive: true })
console.log(`src/vendor → lib/vendor （${vendorSrc}）`)
