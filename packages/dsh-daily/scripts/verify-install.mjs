/**
 * 安装校验：检查 dsh-daily 在一个 dsh profile 里**是不是真的装对了**。
 *
 *   node scripts/verify-install.mjs [profileName]        # 只读，默认 desktop
 *   node scripts/verify-install.mjs desktop --idempotent # 额外验证重复安装幂等（会写盘）
 *
 * 为什么需要它：install-to-profile.mjs 只负责"把文件拷过去 + 维护 patch 一行"，
 * 它**不做任何校验**。而这里有几类错是"装完看起来没事、跑起来才炸"的：
 *
 *   - **装成了符号链接**：dsh 的解析根是 `$DSH_HOME/profiles/node_modules`，
 *     符号链接会让真实路径落回工作区，`@deepseek-ai/*` 全部解析不到，插件导入直接失败。
 *   - **改了代码忘了重装**：工作区的 `lib/` 更新了，profile 里还是旧的那份。
 *     这种最坑 —— 你会对着新代码查半天，而跑的一直是旧的。
 *   - **patch 里那一行没了 / 名字对不上**：文件在，但 profile 根本不会加载它。
 *   - 构建产物不全（少了 `lib/client.js` → 右侧栏 tab 不存在，但 host 侧一切正常）。
 *
 * 退出码：全部通过 0；有 FAIL 则 1（可以直接当 CI/回归清单的一步）。
 */
import { createHash } from 'node:crypto'
import { existsSync, lstatSync, readdirSync, readFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const profileName = process.argv[2]?.startsWith('--') ? 'desktop' : (process.argv[2] ?? 'desktop')
const wantIdempotent = process.argv.includes('--idempotent')
const dshHome = process.env.DSH_HOME ?? path.join(os.homedir(), '.dsh')
const profileDir = path.join(dshHome, 'profiles', profileName)
const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

const results = []
const pass = (name, detail = '') => results.push({ ok: true, name, detail })
const fail = (name, detail = '') => results.push({ ok: false, name, detail })
const note = (name, detail = '') => results.push({ ok: null, name, detail })

function sha(file) {
	try {
		return createHash('sha256').update(readFileSync(file)).digest('hex').slice(0, 12)
	} catch {
		return null
	}
}

/** 递归列出目录里的相对文件路径（同时检查有没有符号链接）。 */
function walk(dir, base = dir, out = { files: [], links: [] }) {
	let entries
	try {
		entries = readdirSync(dir, { withFileTypes: true })
	} catch {
		return out
	}
	for (const entry of entries) {
		const full = path.join(dir, entry.name)
		const rel = path.relative(base, full)
		if (entry.isSymbolicLink()) {
			out.links.push(rel)
			continue
		}
		if (entry.isDirectory()) walk(full, base, out)
		else out.files.push(rel)
	}
	return out
}

// ---------- 1. profile 与 patch ----------

if (!existsSync(profileDir)) {
	fail('profile 目录存在', profileDir)
	report()
}
pass('profile 目录存在', profileDir)

const patchFile = path.join(profileDir, 'cordis.patch.yml')
if (!existsSync(patchFile)) {
	fail('cordis.patch.yml 存在', patchFile)
	report()
}
pass('cordis.patch.yml 存在')

const patch = readFileSync(patchFile, 'utf8')
const insertRow = patch.match(/- insert:\s*\n\s*- id:\s*(\S+)\s*\n\s*name:\s*([^\s#]+)/)
if (!insertRow) {
	fail('patch 里有我们的 insert 行', '找不到 `- insert:` + `- id:` + `name:` 结构')
	report()
}

const [, entryId, installedName] = insertRow
if (entryId === 'daily') pass('insert 行的 id 正确', entryId)
else fail('insert 行的 id 正确', `期望 daily，实际 ${entryId}`)

// 同名 insert 行只能有一条（多一条 = 加载两次或命名冲突）
const dupInserts = patch.match(/name:\s*dsh-daily[\w-]*/g) ?? []
if (dupInserts.length <= 1) pass('没有重复的 dsh-daily insert 行', `${dupInserts.length} 条`)
else fail('没有重复的 dsh-daily insert 行', `发现 ${dupInserts.length} 条：${dupInserts.join(', ')}`)

const target = path.join(profileDir, 'node_modules', installedName)
if (!existsSync(target)) {
	fail('patch 里写的名字对应一个真实目录', `${installedName} → ${target} 不存在`)
	report()
}
pass('patch 里写的名字对应一个真实目录', installedName)

// ---------- 2. 真实目录（最关键的不变量）----------

const stat = lstatSync(target)
if (stat.isSymbolicLink()) {
	fail(
		'装的是真实目录（不是符号链接）',
		`${target} 是符号链接 → Node 会跟着它回到工作区，@deepseek-ai/* 解析不到`,
	)
} else if (stat.isDirectory()) {
	pass('装的是真实目录（不是符号链接）')
} else {
	fail('装的是真实目录（不是符号链接）', '既不是目录也不是链接')
}

// 目录内部也不该有符号链接（同样会绕开 profile 的解析根）
const tree = walk(target)
if (tree.links.length === 0) pass('目录内没有符号链接')
else fail('目录内没有符号链接', tree.links.join(', '))

// ---------- 3. 必需的构建产物 ----------

const required = [
	'package.json',
	'cordis.patch.yml',
	'lib/index.js',
	'lib/client.js',   // 少了它 → 右侧栏 tab 不存在，但 host 侧一切正常（最难发现的一种缺）
	'lib/api.js',
	'web/index.html',
	'web/app.js',
	'web/style.css',
	'README.zh.md',
	'CHANGELOG.md',
]
const missing = required.filter((rel) => !existsSync(path.join(target, rel)))
if (missing.length === 0) pass('必需的构建产物齐全', `${required.length} 项`)
else fail('必需的构建产物齐全', `缺：${missing.join(', ')}`)

// 客户端半体里必须有 ModuleLoader 调用（否则 tab 不会注册）
const clientSrc = existsSync(path.join(target, 'lib/client.js'))
	? readFileSync(path.join(target, 'lib/client.js'), 'utf8')
	: ''
if (clientSrc.includes('__ModuleLoader__.load')) pass('lib/client.js 是有效的客户端半体')
else fail('lib/client.js 是有效的客户端半体', '没找到 window.__ModuleLoader__.load')

// index.html 里引用的本地资源必须都在
if (existsSync(path.join(target, 'web/index.html'))) {
	const html = readFileSync(path.join(target, 'web/index.html'), 'utf8')
	const refs = [...html.matchAll(/(?:src|href)="([^"#:]+)"/g)].map((m) => m[1])
	const missingAssets = refs.filter(
		(rel) => !rel.startsWith('data:') && !existsSync(path.join(target, 'web', rel.replace(/^\.\//, ''))),
	)
	if (missingAssets.length === 0) pass('index.html 引用的本地资源都在', `${refs.length} 个引用`)
	else fail('index.html 引用的本地资源都在', `缺：${missingAssets.join(', ')}`)
}

// package.json 的入口与客户端声明
const pkg = JSON.parse(readFileSync(path.join(target, 'package.json'), 'utf8'))

// 安装副本的包名与版本必须与工作区一致。
// 踩过的坑：早先只比对 lib/ 与 web/，于是"代码装上了但 package.json 还停在旧版本"
// 这种情况检查不出来 —— 而版本号对不上会让排查（"我装的是哪个版本"）直接失准。
const workspacePkg = JSON.parse(readFileSync(path.join(packageRoot, 'package.json'), 'utf8'))
if (pkg.name === workspacePkg.name && pkg.version === workspacePkg.version) {
	pass('安装副本的包名与版本与工作区一致', `${pkg.name}@${pkg.version}`)
} else {
	fail(
		'安装副本的包名与版本与工作区一致',
		`工作区 ${workspacePkg.name}@${workspacePkg.version} vs 已安装 ${pkg.name}@${pkg.version}`,
	)
}
if (pkg.main && existsSync(path.join(target, pkg.main))) pass('package.json 的 main 指向存在的文件', pkg.main)
else fail('package.json 的 main 指向存在的文件', String(pkg.main))

const clientDecl = pkg.dsh?.client
if (clientDecl?.platform === 'web' && Array.isArray(clientDecl.inject)) {
	pass('package.json 声明了客户端半体', `platform=${clientDecl.platform} inject=[${clientDecl.inject.join(',')}]`)
} else {
	fail('package.json 声明了客户端半体', JSON.stringify(clientDecl))
}

// ---------- 4. 是不是"改了代码忘了重装" ----------

const stale = []
for (const dir of ['lib', 'web']) {
	const srcDir = path.join(packageRoot, dir)
	const dstDir = path.join(target, dir)
	if (!existsSync(srcDir)) continue
	for (const rel of walk(srcDir).files) {
		const a = sha(path.join(srcDir, rel))
		const b = sha(path.join(dstDir, rel))
		if (a !== b) stale.push(`${dir}/${rel}${b === null ? '（缺失）' : ''}`)
	}
}
if (stale.length === 0) {
	pass('profile 里的代码与工作区构建产物一致')
} else {
	fail(
		'profile 里的代码与工作区构建产物一致',
		`${stale.length} 个文件不同步（跑一次 install-to-profile.mjs）：${stale.slice(0, 6).join(', ')}${stale.length > 6 ? ' …' : ''}`,
	)
}

// ---------- 5. 真的能被 Node 加载（@deepseek-ai/* 解析链）----------

/**
 * dsh 的共享解析根：`$DSH_HOME/profiles/node_modules/@deepseek-ai/*`。
 * 插件里 `import { defineTool } from '@deepseek-ai/dsh-tools'` 就靠它。
 * 它缺失、或者安装目录是符号链接（真实路径落回工作区、向上查找够不到这一层），导入都会失败 ——
 * 而这两种原因的处理方式完全不同，所以分开检查、分别报。
 */
const sharedRoot = path.join(dshHome, 'profiles', 'node_modules', '@deepseek-ai', 'dsh-tools')
if (existsSync(sharedRoot)) {
	pass('profile 的共享解析根存在', sharedRoot.replace(os.homedir(), '~'))
} else {
	fail('profile 的共享解析根存在', `${sharedRoot.replace(os.homedir(), '~')} 不存在 → @deepseek-ai/* 解析不到`)
}

try {
	const out = execFileSync(
		process.execPath,
		['--input-type=module', '-e', `const m = await import(${JSON.stringify(`file://${path.join(target, 'lib/index.js')}`)}); console.log(Object.keys(m).sort().join(','))`],
		{ encoding: 'utf8', timeout: 30000, stdio: ['ignore', 'pipe', 'pipe'] },
	).trim()
	pass('安装副本可以被 Node 导入（@deepseek-ai/* 解析链通）', out)
} catch (error) {
	const raw = (error.stderr || error.message || '').toString()
	// 把"为什么失败"说清楚：解析链问题 vs 代码本身有问题，修法完全不同
	const isResolution = raw.includes('@deepseek-ai/') && /Cannot find|ERR_MODULE_NOT_FOUND/.test(raw)
	const hint = isResolution
		? '解析链断在 @deepseek-ai/*：要么安装目录是符号链接（真实路径绕回工作区），要么 profile 的共享 node_modules 缺失'
		: raw.split('\n').filter((line) => line.trim()).slice(0, 2).join(' / ')
	fail('安装副本可以被 Node 导入（@deepseek-ai/* 解析链通）', hint)
}

// ---------- 6. 反复安装是否幂等 ----------

if (wantIdempotent) {
	const beforePatch = sha(patchFile)
	const beforeFiles = walk(target).files.map((rel) => `${rel}:${sha(path.join(target, rel))}`).join('|')
	try {
		execFileSync(process.execPath, [path.join(packageRoot, 'scripts', 'install-to-profile.mjs'), profileName], {
			encoding: 'utf8',
			timeout: 120000,
		})
	} catch (error) {
		fail('重复安装能成功执行', String(error.message).slice(0, 160))
	}
	const afterPatch = sha(patchFile)
	const afterFiles = walk(target).files.map((rel) => `${rel}:${sha(path.join(target, rel))}`).join('|')
	if (beforePatch === afterPatch) pass('重复安装后 patch 文件逐字节不变', beforePatch)
	else fail('重复安装后 patch 文件逐字节不变', `${beforePatch} → ${afterPatch}（多插了一行？）`)
	if (beforeFiles === afterFiles) pass('重复安装后文件内容逐字节不变')
	else fail('重复安装后文件内容逐字节不变', '有文件内容发生变化')
	// 再确认没有出现重复 insert
	const after = readFileSync(patchFile, 'utf8')
	const dupAfter = after.match(/name:\s*dsh-daily[\w-]*/g) ?? []
	if (dupAfter.length <= 1) pass('重复安装没有制造重复 insert 行', `${dupAfter.length} 条`)
	else fail('重复安装没有制造重复 insert 行', `${dupAfter.length} 条`)
}

report()

function report() {
	const width = results.length > 0 ? Math.max(...results.map((r) => r.name.length)) : 20
	console.log(`\n安装校验 · profile=${profileName}\n${'─'.repeat(width + 30)}`)
	for (const r of results) {
		const mark = r.ok === true ? '✅' : r.ok === false ? '❌' : 'ℹ️ '
		console.log(`${mark} ${r.name.padEnd(width)}  ${r.detail}`)
	}
	const failed = results.filter((r) => r.ok === false)
	console.log('─'.repeat(width + 30))
	console.log(failed.length === 0 ? `全部通过（${results.length} 项）` : `有 ${failed.length} 项失败`)
	process.exit(failed.length === 0 ? 0 : 1)
}
