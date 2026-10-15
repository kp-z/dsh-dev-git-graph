/**
 * 把 `web/` 同步到 `lib/web/`（以及 `src/vendor/` → `lib/vendor/`）。
 *
 * 为什么要这一步（而不是直接服务 `web/`）：本仓库的 `file:` 依赖装进 profile 时是
 * **硬链接副本**，`files` 白名单**不包含** `web/`，而 `lib/` 是包含的。
 * 服务编译产物里的那一份，就不会踩"新增文件没被同步进 profile"的坑
 * （见 docs/DEVELOPMENT.md §7）。
 *
 * ## R35 修：必须**原地同步**，不能 `rm` + `cp`
 *
 * 旧实现是 `rm(dest)` 再 `cp(src, dest)`。这会给每个文件换一个**新 inode**——
 * 而 profile 里装的是指向旧 inode 的**硬链接**，于是 profile 永远看到旧文件。
 *
 * 实测（R35）：`lib/bridge/character-bridge.js` 链接数=2、与 profile 共享 inode（`tsc` 是原地覆盖）；
 * `lib/web/index.html` 链接数=1、inode 与 profile 那份**不同**。结果是 **从 R32 起真宿主一直在服务
 * 旧面板**——R32 的现代化与 R35 的动作行在真机上都看不见，而 R32 我是在临时服务器上验的面板，
 * 所以四轮都没发现。桥的改动却一直生效，因为 `tsc` 是原地写的。
 *
 * 所以这里改成：已有文件**就地写入**（保持 inode → 硬链接看得见），新文件新建，
 * 源里没有的文件删掉。
 *
 * ⚠️ 一个它解决不了的边界：**新文件**在 profile 那份里不存在（硬链接只覆盖装包时已有的文件）。
 * 所以**目录结构变化后要重装一次插件**（`dsh plugin --profile web add file:…`，必要时先删掉
 * profile 里的旧副本）。改已有文件（绝大多数迭代）则不必。
 */
import { mkdir, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

/** 递归列出一个目录下所有文件的相对路径。 */
async function listFiles(root) {
  const out = []
  async function walk(dir) {
    let entries
    try {
      entries = await readdir(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      const full = join(dir, entry.name)
      if (entry.isDirectory()) await walk(full)
      else if (entry.isFile()) out.push(relative(root, full))
    }
  }
  await walk(root)
  return out
}

/**
 * 原地同步：dest 里已有的文件**写入内容**（不换 inode），新文件新建，多余文件删除。
 *
 * @returns 写入 / 新建 / 删除 / 未变 的计数。
 */
async function syncInPlace(src, dest) {
  const counts = { written: 0, created: 0, removed: 0, unchanged: 0 }
  const srcFiles = await listFiles(src)
  const destFiles = new Set(await listFiles(dest))

  for (const rel of srcFiles) {
    const from = join(src, rel)
    const to = join(dest, rel)
    const content = await readFile(from)
    if (destFiles.has(rel)) {
      destFiles.delete(rel)
      const current = await readFile(to)
      if (current.equals(content)) {
        counts.unchanged += 1
        continue
      }
      // 就地写：打开已有文件截断再写，inode 不变，硬链接（profile 里那份）同步看到新内容。
      await writeFile(to, content)
      counts.written += 1
    } else {
      await mkdir(join(to, '..'), { recursive: true })
      await writeFile(to, content)
      counts.created += 1
    }
  }

  // 源里已经没有的文件：删掉，否则旧模块会一直挂在那里被误加载。
  for (const rel of destFiles) {
    await rm(join(dest, rel), { force: true })
    counts.removed += 1
  }
  await pruneEmptyDirs(dest)
  return counts
}

/** 删掉同步后变空的子目录（不删根）。 */
async function pruneEmptyDirs(root) {
  async function walk(dir) {
    let entries
    try {
      entries = await readdir(dir, { withFileTypes: true })
    } catch {
      return true
    }
    let empty = true
    for (const entry of entries) {
      if (entry.isDirectory()) {
        const childEmpty = await walk(join(dir, entry.name))
        if (childEmpty) await rm(join(dir, entry.name), { recursive: true, force: true })
        else empty = false
      } else {
        empty = false
      }
    }
    return empty
  }
  try {
    if ((await stat(root)).isDirectory()) await walk(root)
  } catch {
    // dest 还不存在：首次构建，什么都不用删
  }
}

const pairs = [
  ['../web/', '../lib/web/', 'web → lib/web'],
  // vendored 第三方资源：源在 `src/vendor/`（入库），运行期读 `lib/vendor/`。
  // 分开放是仓库约定（docs/DIRECTORY.md）：面板自己的资源与"别人写的代码"不该混在一起。
  ['../src/vendor/', '../lib/vendor/', 'src/vendor → lib/vendor'],
]

for (const [from, to, label] of pairs) {
  const src = fileURLToPath(new URL(from, import.meta.url))
  const dest = fileURLToPath(new URL(to, import.meta.url))
  await mkdir(dest, { recursive: true })
  const c = await syncInPlace(src, dest)
  console.log(`${label}：写入 ${c.written} · 新建 ${c.created} · 删除 ${c.removed} · 未变 ${c.unchanged}`)
}
