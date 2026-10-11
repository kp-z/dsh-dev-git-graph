/**
 * 把本包安装进一个 dsh profile —— 用**真实目录**，不是符号链接。
 *
 *   node scripts/install-to-profile.mjs [profileName]     # 默认 desktop
 *
 * 为什么不用 `link:` / 符号链接（踩过的坑，写清楚免得下次再踩）：
 * dsh 的 profile 有一套共享解析根 —— `$DSH_HOME/profiles/node_modules/@deepseek-ai/*`
 * 全部是指向 dsh 安装目录的符号链接（`@deepseek-ai/dsh-tools`、`dsh-scope`、`dsh-llm` …）。
 * 插件里 `import { defineTool } from '@deepseek-ai/dsh-tools'` 就靠这条链解析。
 *
 * 而 Node 的 ESM/CJS 解析默认取**符号链接的真实路径**：插件被 `link:` 进 profile 后，
 * 它的真实路径在工作区（`/Users/kp/DEV/dsh-plugins/packages/dsh-daily`），
 * 向上查找永远走不到 `$DSH_HOME/profiles/node_modules`，于是导入直接失败：
 *   `Cannot find package '@deepseek-ai/dsh-tools'`
 * 更隐蔽的是：工作区自己那份 dsh-tools（0.1.x）与宿主（0.2.x）不是一套，
 * 即使解析到了也会因为内部依赖不匹配而崩。
 *
 * 所以：**运行期用真实目录安装**（这样解析链落在 profile 里，命中宿主自己的副本），
 * **开发期在工作区 node_modules 里放带类型声明的副本**供 tsc 用。
 * 两者互不干扰，改完源码重跑本脚本即可。
 *
 * 已知限制：官方 `dsh plugin add` / 插件市场的 install_bundle 在本机会失败
 * （profile 的 node_modules 由 pnpm store v10 链接，当前 pnpm 想用 v11），
 * 所以这里手工落盘 + 手工维护 profile 用户层 patch 里的那一行 insert（幂等）。
 */
import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { fileURLToPath } from 'node:url'

const PACKAGE_NAME = 'dsh-daily'
const ENTRY_ID = 'daily'

const profileName = process.argv[2] ?? process.env.DSH_PROFILE ?? 'desktop'
const dshHome = process.env.DSH_HOME ?? path.join(os.homedir(), '.dsh')
const profileDir = path.join(dshHome, 'profiles', profileName)
const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

if (!existsSync(profileDir)) {
	console.error(`找不到 profile 目录：${profileDir}`)
	process.exit(1)
}

const patchFile = path.join(profileDir, 'cordis.patch.yml')

/**
 * 装到哪个目录名 = patch 里现在写着哪个名字。
 *
 * 这个"跟随"很重要：Node 会按**模块 URL** 缓存实例化结果，而 URL 由目录名决定。
 * 一旦某个名字被用过（尤其是失败过），继续用它就不会真正重新加载。
 * 所以调试期可能被迫换个名字（如 `dsh-daily-v2`），而重启之后我们希望**沿用**这个名字，
 * 否则会同时存在两份代码、profile 加载的还是旧的那份。
 * 需要主动换名时用 `--dir-name=xxx`。
 */
function currentDirName() {
	const override = process.argv.find((a) => a.startsWith('--dir-name='))
	if (override) return override.slice('--dir-name='.length)
	try {
		const patch = readFileSync(patchFile, 'utf8')
		// 取我们那一段 insert：`- insert:` 与 `- id: daily` / `name: X` 相邻
		const block = patch.match(/- insert:\s*\n\s*- id:\s*daily\s*\n\s*name:\s*([^\s#]+)/)
		if (block?.[1]) return block[1].trim()
	} catch {
		/* 没有 patch 文件就走默认名 */
	}
	return PACKAGE_NAME
}

const dirName = currentDirName()
const target = path.join(profileDir, 'node_modules', dirName)

// 旧的符号链接（若存在）必须删掉：Node 会跟着它回到工作区，等于没装
if (existsSync(target)) {
	const { lstatSync } = await import('node:fs')
	if (lstatSync(target).isSymbolicLink()) {
		console.log(`移除旧的符号链接：${target}`)
		await rm(target, { force: true })
	}
}

await mkdir(target, { recursive: true })
for (const item of ['lib', 'web']) {
	const from = path.join(packageRoot, item)
	if (!existsSync(from)) {
		console.error(`缺少构建产物 ${item}/，先跑 pnpm build`)
		process.exit(1)
	}
	await cp(from, path.join(target, item), { recursive: true, force: true })
}
for (const file of ['package.json', 'cordis.patch.yml', 'README.md', 'README.zh.md', 'CHANGELOG.md', 'LICENSE']) {
	const from = path.join(packageRoot, file)
	if (existsSync(from)) await cp(from, path.join(target, file), { force: true })
}
console.log(`已安装到 ${target}`)

// ---- profile 用户层 patch：幂等地确保有一行 insert ----
let patch = existsSync(patchFile) ? await readFile(patchFile, 'utf8') : ''
const already = new RegExp(`id:\\s*${ENTRY_ID}\\s*\\n\\s*name:\\s*${dirName}\\b`).test(patch)
if (already) {
	console.log(`patch 里已有 id=${ENTRY_ID} name=${dirName}，跳过`)
} else if (new RegExp(`id:\\s*${ENTRY_ID}\\s*\\n\\s*name:`).test(patch)) {
	// 有这一行但名字不同（换过目录名）：就地改名，别插第二行
	patch = patch.replace(
		new RegExp(`(id:\\s*${ENTRY_ID}\\s*\\n\\s*name:\\s*)[^\\s#]+`),
		`$1${dirName}`,
	)
	await writeFile(patchFile, patch, 'utf8')
	console.log(`已把 patch 里的 name 改成 ${dirName}`)
} else {
	patch +=
		`\n# --- ${PACKAGE_NAME} ---\n` +
		`- insert:\n    - id: ${ENTRY_ID}\n      name: ${dirName}\n`
	await writeFile(patchFile, patch, 'utf8')
	console.log(`已在 ${patchFile} 追加 insert 行`)
}

console.log(`\n下一步：**重启 dsh** 才会生效。`)
console.log(`注意：host 侧的代码改动对**已经运行**的进程无效 —— Node 会缓存已成功导入的 ESM 模块，`)
console.log(`      plugin_manager 的 enable 切换不会重新加载它。这也是本项目"改完必须重启验证"的原因。`)
