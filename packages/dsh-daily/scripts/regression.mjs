/**
 * 完整回归清单：**一条命令验完这个插件的所有交付面**。
 *
 * 为什么需要它：这个项目的交付面不只是一堆单测 —— 还有
 * ① 客户端半体的静态契约（id 必须与包名一致、加载期不能抛、封面降级契约…）
 * ② **真实 dev-server 冒烟**（单测全绿但接口 500 这种事，只有真起一次才知道）
 * ③ **装机幂等**（必须在隔离的 DSH_HOME 里跑，见下）
 * ④ **profile patch 能被 dsh 解析**（`name:` 以 @ 开头必须加引号，否则 dsh 起不来）
 *
 * 每一项都是真踩过的坑，所以它们不是"锦上添花"，而是**回归清单**。
 *
 * ⚠️ 隔离必须显式设 `DSH_HOME`：装机脚本解析主目录的顺序是
 * `process.env.DSH_HOME ?? homedir()/.dsh`，而 **DSH 会给子进程设好 DSH_HOME**。
 * 只改 `HOME` 挡不住（我因此误装过一次到真实 profile）。装机幂等那一步走
 * `scripts/verify-idempotent.sh`，它一上来就强制覆盖 DSH_HOME。
 */

import { spawn, spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, openSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

const root = path.resolve(import.meta.dirname, '..')
const results = []

function run(name, command, args, options = {}) {
	const started = Date.now()
	const proc = spawnSync(command, args, {
		cwd: root,
		encoding: 'utf8',
		stdio: options.capture ? 'pipe' : 'inherit',
		env: { ...process.env, ...(options.env ?? {}) },
		timeout: options.timeoutMs ?? 300_000,
	})
	const ok = proc.status === 0
	results.push({ name, ok, ms: Date.now() - started, output: options.capture ? `${proc.stdout ?? ''}${proc.stderr ?? ''}` : '' })
	console.log(`  ${ok ? '✅' : '❌'} ${name}（${((Date.now() - started) / 1000).toFixed(1)}s）`)
	return { ok, proc }
}

/** 等一个 URL 可访问（dev-server 启动需要时间）。 */
async function waitFor(url, timeoutMs = 15_000) {
	const deadline = Date.now() + timeoutMs
	while (Date.now() < deadline) {
		try {
			const res = await fetch(url)
			if (res.ok) return res
		} catch {
			/* 还没起来 */
		}
		await new Promise((r) => setTimeout(r, 300))
	}
	return null
}

console.log('══════ dsh-daily 完整回归 ══════')

// ---- 1. 构建（tsc + 资源复制，含模块 id 注入）----
console.log('\n[1/5] 构建')
run('tsc 编译', 'bash', ['-c', './node_modules/typescript/bin/tsc -p tsconfig.json'])
run('资源复制（客户端半体 + 页面）', 'bash', ['-c', 'node scripts/copy-assets.mjs'])

// ---- 2. 单元 + 静态契约 ----
console.log('\n[2/5] 单元测试与静态契约')
run('全量测试', 'bash', ['-c', 'node --test test/'])

// ---- 3. 真实 dev-server 冒烟 ----
console.log('\n[3/5] dev-server 冒烟（真起一个假宿主）')
const dataDir = mkdtempSync(path.join(tmpdir(), 'dsh-regression-'))
const port = 8971
// **必须用异步 spawn**：`spawnSync` 会等子进程退出，而 dev-server 永不退出 → 会把回归卡死
// （我第一版就是这么写的，实测挂住 10 分钟才发现）
// 输出落盘：冒烟失败时**必须能看出为什么**（第一版设成 ignore，失败却看不到原因）
const serverLog = path.join(dataDir, 'dev-server.log')
const logFd = openSync(serverLog, 'a')
// 这里**故意用等号写法** `--port=N`：它曾经被 dev-server 静默忽略（回落到 8799），
// 导致冒烟必然失败。现在参数解析两种写法都认、且不认识的参数会报错，
// 所以这行同时也是那个 bug 的回归哨兵 —— 哪天等号写法又失效，冒烟会立刻红。
const server = spawn('node', ['scripts/dev-server.mjs', `--data-dir=${dataDir}`, '--no-refresh', `--port=${port}`], {
	cwd: root,
	detached: true,
	stdio: ['ignore', logFd, logFd],
})
const base = `http://127.0.0.1:${port}/dsh-daily`
let smokeOk = true
try {
	const page = await waitFor(`${base}/`)
	smokeOk = !!page
	console.log(`  ${page ? '✅' : '❌'} 页面可访问 ${base}/`)
	if (page) {
		for (const endpoint of ['api/state', 'api/findings', 'api/projects']) {
			const res = await fetch(`${base}/${endpoint}`)
			const ok = res.ok
			if (!ok) smokeOk = false
			console.log(`  ${ok ? '✅' : '❌'} GET /${endpoint} → ${res.status}`)
		}
		// 状态里必须能读到识别诊断（这是"故障可定位"的保证）
		const state = await fetch(`${base}/api/state`).then((r) => r.json()).catch(() => null)
		const hasProject = !!state?.project
		console.log(`  ${hasProject ? '✅' : '❌'} /api/state 带 project 字段`)
		smokeOk = smokeOk && hasProject
	}
	if (!smokeOk) {
		const log = existsSync(serverLog) ? readFileSync(serverLog, 'utf8').trim() : '(没有日志)'
		console.log('  --- dev-server 日志（尾部）---')
		for (const line of log.split('\n').slice(-8)) console.log(`    ${line}`)
	}
} finally {
	if (server.pid) {
		// 先杀整个进程组（detached 起的话子进程自己也会在组里），失败再单独杀
		try {
			process.kill(-server.pid, 'SIGTERM')
		} catch {
			try {
				process.kill(server.pid, 'SIGTERM')
			} catch {
				/* 已经退出 */
			}
		}
		// 给一点时间让它优雅退出，避免端口残留影响下一次
		await new Promise((r) => setTimeout(r, 400))
	}
	rmSync(dataDir, { recursive: true, force: true, maxRetries: 5 })
}
results.push({ name: 'dev-server 冒烟', ok: smokeOk, ms: 0, output: '' })

// ---- 4. 装机幂等（沙箱，强制覆盖 DSH_HOME）----
console.log('\n[4/5] 装机幂等（隔离 DSH_HOME）')
run('装机幂等验证', 'bash', ['scripts/verify-idempotent.sh', 'desktop'])

// ---- 5. profile patch 契约 ----
console.log('\n[5/5] profile patch 契约')
const patchPath = path.join(root, 'cordis.patch.yml')
let patchOk = existsSync(patchPath)
if (patchOk) {
	const text = readFileSync(patchPath, 'utf8')
	// 以 @ 开头的标量必须加引号，否则 YAML 解析失败 → dsh 起不来（真踩过）
	const unquoted = text
		.split('\n')
		.map((line, index) => ({ line: line.trim(), index: index + 1 }))
		.filter((item) => /:\s*@/.test(item.line))
	patchOk = unquoted.length === 0
	console.log(`  ${patchOk ? '✅' : '❌'} name 以 @ 开头的标量都加了引号${patchOk ? '' : `（第 ${unquoted.map((u) => u.index).join('/')} 行未加）`}`)
	const quoted = /name:\s*"@[^"]+"/.test(text)
	console.log(`  ${quoted ? '✅' : '❌'} 包名写成引号形式`)
	patchOk = patchOk && quoted
} else {
	console.log('  ❌ 找不到 cordis.patch.yml')
}
results.push({ name: 'profile patch 契约', ok: patchOk, ms: 0, output: '' })

// ---- 汇总 ----
const failed = results.filter((r) => !r.ok)
console.log('\n══════ 汇总 ══════')
for (const item of results) {
	console.log(`  ${item.ok ? '✅' : '❌'} ${item.name}`)
}
if (failed.length > 0) {
	console.log(`\n  ❌ ${failed.length} 项失败：`)
	for (const item of failed) {
		if (item.output) console.log(`     ${item.name}: ${item.output.split('\n').slice(-6).join('\n     ')}`)
	}
	process.exit(1)
}
console.log(`\n  ✅ ${results.length} 项全部通过 —— 客户端契约 / 单测 / 真实接口 / 装机幂等 / patch 解析，都验过了`)
