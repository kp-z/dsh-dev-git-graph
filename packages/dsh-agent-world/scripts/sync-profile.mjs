#!/usr/bin/env node
/**
 * 把包内的 `lib/`（以及 `lib/web/`）同步到 **DSH profile** 里那份安装副本。
 *
 * ## 为什么需要这个脚本
 * 宿主加载插件时读的是 **profile 里的副本**，不是本仓库的 `packages/.../lib/`。
 * 那份副本的文件是**硬链接**，于是有两种不同步：
 *
 * 1. **被修改的文件**：`tsc` 是**原地写**，硬链还在，内容会自动跟着变 —— 通常没事；
 * 2. **新增的文件**：**建硬链这件事没人做**。`lib/web/` 里一刀新文件，
 *    profile 里就没有它 → 浏览器请求它得 404 → **整条 ES 模块图断掉 → 全站白屏**。
 *
 * 第 2 类已经真实发生过两次（R137 的 `task-label.js`、R159 的 `member-avatar.js`），
 * 两次的表现都是"页面看起来加载完了，但 `__agentWorld*` 门面一个都没有"，
 * 而单测全绿——因为单测读的是**包内**文件，不是 profile 里那份。
 *
 * ## 用法
 * ```bash
 * node scripts/sync-profile.mjs          # 只检查，列出差异；有缺失时退出码 1
 * node scripts/sync-profile.mjs --fix    # 补建硬链（跨设备时退回普通拷贝）
 * node scripts/sync-profile.mjs --profile /path/to/profile   # 显式指定 profile
 * ```
 *
 * 找 profile 的顺序：`--profile` > `$DSH_PROFILE` > `~/.dsh/profiles/web`。
 * 找不到就**说清楚为什么跳过**并退出 0（别的机器上没有这个 profile 是正常情况，不该红）。
 */
import { copyFile, link, readdir, stat } from 'node:fs/promises'
import { dirname, isAbsolute, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { homedir } from 'node:os'

const PKG_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const PKG_NAME = 'dsh-agent-world'

const args = process.argv.slice(2)
const fix = args.includes('--fix')
const profileFlag = args.indexOf('--profile')
const profileArg = profileFlag >= 0 ? args[profileFlag + 1] : undefined

// ⚠️ 不要复用 `DSH_PROFILE`：它在本环境里是 **profile 名**（如 `desktop`），不是路径。
// 拿它当路径会得到 `desktop/node_modules/...` 这种相对路径，然后"找不到 profile"静默跳过——
// 一个**看起来正常**的跳过，比报错更坏（脚本会永远是绿的）。所以这里要**绝对路径**才算数。
const envProfile = process.env.AGENT_WORLD_PROFILE_DIR
const profileFromEnv = envProfile !== undefined && isAbsolute(envProfile) ? envProfile : undefined
const profileRoot = profileArg ?? profileFromEnv ?? join(homedir(), '.dsh', 'profiles', 'web')
const profileLib = join(profileRoot, 'node_modules', PKG_NAME, 'lib')
const sourceLib = join(PKG_ROOT, 'lib')

/** 递归列出某个目录下的所有文件（相对路径）。目录不存在时返回空。 */
async function listFiles(root) {
  const out = []
  const walk = async (dir) => {
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
  return out.sort()
}

async function main() {
  try {
    await stat(sourceLib)
  } catch {
    console.error(`✗ 找不到 ${sourceLib} —— 先跑一次构建（tsc）再同步。`)
    process.exit(1)
  }
  try {
    await stat(profileLib)
  } catch {
    console.log(`· 跳过：本机没有这个 profile 的安装副本（${profileLib}）。`)
    console.log('  这不是错误——只有在要用宿主加载本插件时才需要同步。')
    return
  }

  const source = new Set(await listFiles(sourceLib))
  const target = new Set(await listFiles(profileLib))

  const missing = [...source].filter((f) => !target.has(f))
  const extra = [...target].filter((f) => !source.has(f))
  // 只声明"需要运行时"的类型：`.d.ts` / `.map` 缺了不影响运行，不刷噪音。
  const runtimeMissing = missing.filter((f) => f.endsWith('.js'))

  if (missing.length === 0 && extra.length === 0) {
    console.log(`✓ profile 与包内 lib 一致（${source.size} 个文件）。`)
    return
  }

  if (extra.length > 0) {
    console.log(`· profile 多出 ${extra.length} 个文件（通常是旧构建残留，一般无害）：`)
    for (const f of extra.slice(0, 10)) console.log(`    + ${f}`)
  }

  if (missing.length === 0) return

  console.log(`\n${fix ? '补齐' : '缺失'} ${missing.length} 个文件（其中 ${runtimeMissing.length} 个是运行时 .js）：`)
  for (const f of missing) console.log(`    - ${f}`)

  if (runtimeMissing.length > 0 && !fix) {
    console.error(
      '\n✗ 运行时文件缺失会让宿主 404，浏览器侧表现是**整站白屏**（模块图断掉、门面全空）。' +
        '\n  修：`node scripts/sync-profile.mjs --fix`',
    )
    process.exit(1)
  }

  if (!fix) return

  for (const f of missing) {
    const from = join(sourceLib, f)
    const to = join(profileLib, f)
    try {
      await link(from, to)
    } catch {
      // 跨设备或已有同名文件时退回复制：行为一样，只是以后不再共享内容。
      await copyFile(from, to)
    }
  }
  console.log(`\n✓ 已补齐 ${missing.length} 个文件（优先硬链）。`)
}

await main()
