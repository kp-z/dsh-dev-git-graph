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
