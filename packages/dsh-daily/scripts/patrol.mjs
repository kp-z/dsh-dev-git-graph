/**
 * 巡检：一次跑出两份报告 —— ① 功能检查 ② 运行效率 / API 请求效率。
 *
 * ## 为什么要工具化（而不是每轮手写一段总结）
 * 手写的报告会随轮次漂移：这次记得量接口耗时、下次忘了；这次数了外部请求、下次没数。
 * 工具化之后，**两份报告的定义固定下来**，跨轮可比较 —— 否则"效率报告"只是文学。
 *
 * 报告口径：
 * - **功能检查**：每个接口的真实状态码（不是"应该有"）+ 关键字段是否在位，并显式列出**未验证**
 * - **效率**：分阶段墙钟（刷新 / 检索词 / 检索 / 卡片）、**外部请求数**（按源与通道拆开）、
 *   接口延迟与体积。外部请求数是重点：这个插件的成本几乎全在网络上。
 *
 * 用法：`node scripts/patrol.mjs [--port 8991] [--quick]`
 *   --quick 跳过需要联网的刷新与检索（只量接口），用于快速自检。
 */

import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, openSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { parseArgs, toNumber } from './args.mjs'

const root = path.resolve(import.meta.dirname, '..')
const parsed = parseArgs(process.argv.slice(2), { flags: ['quick'], values: ['port', 'project'] })
const errors = []
const port = toNumber(parsed.values.port, 'port', errors, { min: 1, max: 65535 }) ?? 8991
const quick = parsed.values.quick === true
const projectDir = typeof parsed.values.project === 'string' ? parsed.values.project : process.cwd()
if (errors.length > 0) {
	for (const message of errors) console.error(`  - ${message}`)
	process.exit(2)
}

const base = `http://127.0.0.1:${port}/dsh-daily`
const snapshotPath = path.join(root, 'reports', 'latest.json')
/** 上一轮的原始指标（存 JSON 而不是解析 Markdown —— 报告是给人看的，机器读快照） */
const previous = (() => {
	try {
		return JSON.parse(readFileSync(snapshotPath, 'utf8'))
	} catch {
		return null
	}
})()
const dataDir = mkdtempSync(path.join(tmpdir(), 'dsh-patrol-'))
const logFile = path.join(dataDir, 'server.log')

const apiRows = []
const stageRows = []
const outbound = []
const functionalNotes = []
/**
 * 外部依赖类检查。
 *
 * **为什么要分开**：源抓取失败是**外部抖动**（网站超时/限流），不是插件坏了。
 * 早先它和"页面打不开""诊断字段缺失"一起被算作失败 → 每轮退出码都是 1 →
 * **退出码失去意义**（分不清"产品坏了"与"外面抖了"）。
 * 现在：自身功能决定退出码；外部依赖**如实记录**，趋势交给"与上一轮对比"去看。
 */
const externalNotes = []
/** 按源耗时（在 try 里填充，报告段要用 —— 所以必须在**同一作用域**声明） */
let perSource = []
let slowestSource = null
/** 定点复测结果（对上一轮最慢的源单独跑一次，验证单源预算） */
let probeResult = null

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/** 请求插件自己的 HTTP 接口，记录状态码/延迟/体积。 */
async function hit(label, endpoint, init) {
	const started = Date.now()
	let status = 0
	let bytes = 0
	let body = null
	try {
		const res = await fetch(`${base}${endpoint}`, init)
		status = res.status
		const text = await res.text()
		bytes = Buffer.byteLength(text)
		try {
			body = JSON.parse(text)
		} catch {
			body = null
		}
	} catch (error) {
		status = -1
		body = { error: String(error) }
	}
	apiRows.push({ label, endpoint, method: init?.method ?? 'GET', status, ms: Date.now() - started, kb: bytes / 1024 })
	return { status, body, ms: Date.now() - started }
}

function stage(label, ms, detail = '') {
	stageRows.push({ label, ms, detail })
	console.log(`  · ${label}: ${(ms / 1000).toFixed(1)}s${detail ? ` （${detail}）` : ''}`)
}

async function waitFor(url, timeoutMs = 20_000) {
	const deadline = Date.now() + timeoutMs
	while (Date.now() < deadline) {
		try {
			const res = await fetch(url)
			if (res.ok) return true
		} catch {
			/* not up yet */
		}
		// 等它**真的**退出（最多 2s）：句柄没释放就去删目录是上一轮退出码 1 的直接原因
		await new Promise((resolve) => {
			let settled = false
			const finish = () => { if (!settled) { settled = true; resolve() } }
			server.once('exit', finish)
			setTimeout(finish, 2000)
		})
	}
	return false
}

console.log('══ 巡检开始 ══')
console.log(`  项目目录: ${projectDir}`)
console.log(`  模式: ${quick ? 'quick（跳过联网）' : '完整（含真实抓取与检索）'}`)

// 日志必须落盘：失败时要能看出为什么（`stdio: 'ignore'` 是上一轮刚修过的坑）
const logFd = openSync(logFile, 'a')
const server = spawn('node', ['scripts/dev-server.mjs', `--data-dir=${dataDir}`, '--no-refresh', '--ai-fake', '--port', String(port)], {
	cwd: root,
	detached: true,
	stdio: ['ignore', logFd, logFd],
})

const report = { at: new Date().toISOString(), port, quick, api: apiRows, stages: stageRows, outbound, functional: functionalNotes }

try {
	// ---------- 功能检查 ----------
	console.log('\n【功能检查】')
	const up = await waitFor(`${base}/`)
	functionalNotes.push({ item: '页面可访问 /dsh-daily/', ok: up, detail: up ? '200' : '连不上' })
	if (!up) {
		const log = existsSync(logFile) ? readFileSync(logFile, 'utf8').trim() : '(没有日志)'
		console.log('  --- dev-server 日志（尾部）---')
		for (const line of log.split('\n').slice(-8)) console.log(`    ${line}`)
	}

	// 探测**真实存在**的接口（第一版探了 `/api/prefs` —— 它不存在，
	// 偏好数据在 `/api/state` 里。巡检脚本自己也会犯错，报告里的状态码就是证据）
	for (const [label, endpoint] of [
		['状态', '/api/state'],
		['项目清单', '/api/projects'],
		['条目', '/api/items'],
		['订阅源', '/api/sources'],
		['日报 Markdown', '/api/digest'],
		['订阅列表', '/api/feeds'],
		['归档', '/api/archive'],
		['周报', '/api/weekly'],
		['容量', '/api/storage'],
		['调研结果', '/api/findings'],
	]) {
		await hit(label, endpoint)
	}

	// 切到目标项目（自动识别之外，显式指定一次以便巡检任何目录）
	if (!quick) {
		await hit('切换项目', '/api/projects', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ dir: projectDir }),
		})
	}

	const state = await hit('状态（复核项目）', '/api/state')
	const currentDir = state.body?.project?.dir ?? ''
	// quick 模式不主动切项目，就不该断言"已切换"（否则是自己造一个假失败）
	if (!quick) {
		functionalNotes.push({
			item: '项目已切换',
			ok: currentDir === projectDir,
			detail: currentDir || '（没有 project）',
		})
	}
	functionalNotes.push({
		item: '识别诊断字段在位',
		ok: !!state.body?.project?.detect,
		detail: state.body?.project?.detect
			? `hosts=${state.body.project.detect.hosts} candidates=${state.body.project.detect.candidates}`
			: '缺 project.detect',
	})

	// ---------- 运行效率 ----------
	console.log('\n【运行效率】')
	if (!quick) {
		// 1) 抓取：让服务自己报告耗时与源健康
		const t0 = Date.now()
		const refresh = await hit('刷新（触发抓取）', '/api/refresh', { method: 'POST' })
		stage('抓取订阅源', Date.now() - t0, refresh.body ? `${refresh.body.total ?? '?'} 条 / ${refresh.body.okSources ?? '?'} 源正常` : '')

		// 2) 检索词计划
		const t1 = Date.now()
		const plan = await hit('检索词计划', '/api/research', { method: 'POST' })
		stage('生成检索词', Date.now() - t1, plan.body?.plan ? `${plan.body.plan.queries?.length ?? '?'} 条词` : plan.body?.queries ? `${plan.body.queries.length} 条词` : '')

		// 3) 定向检索（含外部请求统计）
		const t2 = Date.now()
		const findings = await hit('定向检索', '/api/findings', { method: 'POST' })
		const stats = findings.body?.meta?.stats
		stage('定向检索', Date.now() - t2, stats ? `请求 ${stats.requests} 成功 ${stats.ok} 失败 ${stats.failed} 跳过 ${stats.skipped}` : '')
		if (stats) {
			outbound.push({ kind: '检索（HN + GitHub 搜索）', requests: stats.requests, ok: stats.ok, failed: stats.failed, skipped: stats.skipped })
		}
		functionalNotes.push({
			item: '调研返回结果',
			ok: (findings.body?.findings?.length ?? 0) > 0,
			detail: `${findings.body?.findings?.length ?? 0} 条 · 维度 ${(findings.body?.groups ?? []).length} 个`,
		})
		const fs2 = findings.body?.findings ?? []
		if (fs2.length > 0) {
			functionalNotes.push({
				item: '卡片字段（头图/中文介绍/来源）',
				ok: fs2.every((f) => f.intro && f.sourceLabel),
				detail: `头图 ${fs2.filter((f) => f.thumb).length}/${fs2.length} · AI 介绍 ${fs2.filter((f) => f.introSource === 'ai').length} · 兜底 ${fs2.filter((f) => f.introSource === 'fallback').length}`,
			})
		}
	} else {
		functionalNotes.push({ item: '抓取与检索', ok: true, detail: '（quick 模式跳过）' })
	}

	// **定点复测**：轮转会让"哪个源被抓"每轮不同，所以不能指望这一轮刚好抓到慢源。
	// 直接按上一轮最慢的那个源跑一次采集，才能确定地回答"单源预算生效了吗"。
	const probeTarget = (previous?.sources ?? [])[0]
	if (probeTarget?.id) {
		try {
			const { runCollection } = await import('../lib/collect/index.js')
			const { resolveConfig } = await import('../lib/config.js')
			const probeDir = mkdtempSync(path.join(tmpdir(), 'dsh-patrol-probe-'))
			const t3 = Date.now()
			const out = await runCollection({ config: resolveConfig({ dataDir: probeDir }), sourceIds: [probeTarget.id] })
			const wall = Date.now() - t3
			const state = out.sources[0]
			stage(
				`定点复测：${state?.name ?? probeTarget.id}`,
				wall,
				state ? `${state.ok ? `${state.count} 条` : `失败：${state.error ?? ''}`} · 源内计时 ${state.durationMs} ms` : '没有源状态',
			)
			probeResult = {
				id: probeTarget.id,
				previousMs: probeTarget.ms ?? 0,
				name: state?.name ?? probeTarget.name,
				ok: state?.ok === true,
				count: state?.count ?? 0,
				error: state?.error ?? null,
				durationMs: state?.durationMs ?? 0,
				wallMs: wall,
			}
			rmSync(probeDir, { recursive: true, force: true, maxRetries: 5 })
		} catch (error) {
			stage(`定点复测失败：${probeTarget.name}`, 0, error instanceof Error ? error.message : String(error))
		}
	}

	const finalState = await hit('状态（末次）', '/api/state')
	const sources = finalState.body?.sources ?? []
	// 按源耗时：`SourceState` 本来就带 `durationMs`，只是之前的报告没列出来 ——
	// 而"总耗时 50s"这种数字**无法指导优化**，必须知道是哪个源慢。
	perSource = sources
		.map((s) => ({ id: s.id ?? '', name: s.name ?? s.id ?? '?', ok: s.ok !== false, count: s.count ?? 0, ms: s.durationMs ?? 0 }))
		.sort((a, b) => b.ms - a.ms)
	slowestSource = perSource[0] ?? null
	if (slowestSource) stage('最慢的源', slowestSource.ms, `${slowestSource.name}（${slowestSource.count} 条）`)
	const rotated = sources.filter((s) => s.count === 0 && s.ok).length
	outbound.push({
		kind: '抓取订阅源',
		requests: sources.length,
		ok: sources.filter((s) => s.ok !== false).length,
		failed: sources.filter((s) => s.ok === false).length,
		skipped: rotated,
	})
	const failedSources = sources.filter((s) => s.ok === false)
	externalNotes.push({
		item: '源健康',
		ok: failedSources.length === 0,
		detail: `${sources.length} 个源，失败 ${failedSources.length} 个${failedSources.length > 0 ? '：' + failedSources.map((s) => s.name ?? s.id).join('、') : ''}`,
	})
	// 失败明细：只知道"失败 1 个"没用，要知道**是哪个、为什么**
	for (const row of failedSources) {
		externalNotes.push({
			item: `源失败：${row.name ?? row.id}`,
			ok: false,
			detail: `${row.error ? String(row.error).slice(0, 90) : '（没有错误说明）'} · ${row.durationMs ?? 0} ms`,
		})
	}
} finally {
	if (server.pid) {
		try {
			process.kill(-server.pid, 'SIGTERM')
		} catch {
			try {
				process.kill(server.pid, 'SIGTERM')
			} catch {
				/* 已退出 */
			}
		}
		await sleep(300)
	}
}

// ---------- 出报告 ----------
const now = new Date()
const pad = (n) => String(n).padStart(2, '0')
const stamp = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}`
const lines = []
lines.push(`# 巡检报告 ${stamp}`)
lines.push('')
lines.push('> ⚠️ 判断"报告与退出码是否一致"时先看这个时间戳 —— 脚本崩在写报告之前的话，')
lines.push('> `reports/latest.md` **还是上一轮的**（我为此白查了一轮：报告没变，其实是本轮压根没写成）')
lines.push('')
lines.push(`- 端口：${port} · 模式：${quick ? 'quick（跳过联网）' : '完整'} · 项目目录：\`${projectDir}\``)
lines.push('')

// ① 功能检查
lines.push('## ① 功能检查报告')
lines.push('')
lines.push('| 检查项 | 结果 | 证据 |')
lines.push('|---|---|---|')
for (const item of functionalNotes) {
	lines.push(`| ${item.item} | ${item.ok ? '✅' : '❌'} | ${item.detail} |`)
}
const failedFunctional = functionalNotes.filter((i) => !i.ok)
const failedExternal = externalNotes.filter((i) => !i.ok)
lines.push('')
lines.push(
	`**自身功能结论**：${failedFunctional.length === 0 ? '✅ 全部通过' : `❌ ${failedFunctional.length} 项未通过：${failedFunctional.map((i) => i.item).join('、')}`}`,
)
lines.push('')
lines.push('**外部依赖（不计入退出码 —— 外部抖动不代表插件坏了）**')
lines.push('')
lines.push('| 检查项 | 结果 | 证据 |')
lines.push('|---|---|---|')
for (const item of externalNotes) lines.push(`| ${item.item} | ${item.ok ? '✅' : '⚠️'} | ${item.detail} |`)
lines.push(
	`
**外部依赖结论**：${failedExternal.length === 0 ? '✅ 全部正常' : `⚠️ ${failedExternal.length} 项异常（外部原因，记录在案）`}`,
)
lines.push('')
lines.push('### 接口延迟与体积')
lines.push('')
lines.push('| 接口 | 方法 | 状态 | 延迟 | 体积 |')
lines.push('|---|---|---|---|---|')
for (const row of apiRows) {
	lines.push(`| \`${row.endpoint}\` ${row.label} | ${row.method} | ${row.status} | ${row.ms} ms | ${row.kb.toFixed(1)} KB |`)
}
const slowest = [...apiRows].sort((a, b) => b.ms - a.ms)[0]
lines.push('')
if (slowest) lines.push(`最慢一次是 \`${slowest.endpoint}\`（${slowest.ms} ms）${slowest.ms > 1000 ? ' —— 属于联网/模型调用，不是接口本身慢' : ''}`)
lines.push('')

// ② 效率报告
lines.push('## ② 运行效率 / API 请求效率报告')
lines.push('')
if (stageRows.length === 0) {
	lines.push('（quick 模式未跑联网阶段）')
} else {
	lines.push('| 阶段 | 耗时 | 说明 |')
	lines.push('|---|---|---|')
	for (const row of stageRows) lines.push(`| ${row.label} | ${(row.ms / 1000).toFixed(1)} s | ${row.detail} |`)
	const total = stageRows.reduce((sum, row) => sum + row.ms, 0)
	lines.push(`| **合计** | **${(total / 1000).toFixed(1)} s** | |`)
}
lines.push('')
lines.push('### 外部请求（成本几乎全在这里）')
lines.push('')
lines.push('| 环节 | 发出请求 | 成功 | 失败 | 跳过/未选中 |')
lines.push('|---|---|---|---|---|')
for (const row of outbound) {
	lines.push(`| ${row.kind} | ${row.requests} | ${row.ok ?? 0} | ${row.failed ?? 0} | ${row.skipped ?? 0} |`)
}
const totalReq = outbound.reduce((sum, row) => sum + (row.requests ?? 0), 0)
lines.push(`| **合计** | **${totalReq}** | | | |`)
lines.push('')
lines.push('> 说明：抓取侧有**频道轮转**（每轮只抓选中的一部分，其余下一轮），所以"未选中"是设计行为，不是失败；')
lines.push('> 检索侧按**维度轮流取**并且跳过语言不匹配的词，所以"跳过"也是设计行为。')
lines.push('')

lines.push('### 按源耗时（哪个源慢，才谈得上优化）')
lines.push('')
if (perSource.length === 0) {
	lines.push('（没有源状态）')
} else {
	lines.push('| 源 | 结果 | 条数 | 耗时 |')
	lines.push('|---|---|---|---|')
	for (const row of perSource) lines.push(`| ${row.name} | ${row.ok ? '✅' : '❌'} | ${row.count} | ${row.ms} ms |`)
	const slowTotal = perSource.reduce((sum, row) => sum + row.ms, 0)
	lines.push(`| **合计** | | | **${slowTotal} ms** |`)
}
lines.push('')

// 与上一轮对比：同一口径下的趋势。没有上一轮就说明为什么
if (probeResult) {
	lines.push('### 定点复测（单源预算是否生效）')
	lines.push('')
	lines.push(
		`上一轮最慢的源是 **${probeResult.name}**（${probeResult.previousMs} ms）。这一轮对它单独跑了一次采集：`,
	)
	lines.push('')
	lines.push('| 结果 | 条数 | 源内计时 | 墙钟 | 说明 |')
	lines.push('|---|---|---|---|---|')
	lines.push(
		`| ${probeResult.ok ? '✅ 成功' : '⛔ 被中止'} | ${probeResult.count} | ${probeResult.durationMs} ms | ${probeResult.wallMs} ms | ${probeResult.error ?? '—'} |`,
	)
	lines.push('')
}

lines.push('### 与上一轮对比')
lines.push('')
if (!previous) {
	lines.push('（没有上一轮快照，这是第一次带快照的巡检 —— 下次就能对比了）')
} else {
	const nowFetch = outbound.find((o) => o.kind === '抓取订阅源')?.requests ?? 0
	const prevFetch = (previous.outbound ?? []).find((o) => o.kind === '抓取订阅源')?.requests ?? 0
	const nowOut = outbound.reduce((sum, o) => sum + (o.requests ?? 0), 0)
	const prevOut = (previous.outbound ?? []).reduce((sum, o) => sum + (o.requests ?? 0), 0)
	const nowStage = stageRows.reduce((sum, r) => sum + r.ms, 0)
	const prevStage = (previous.stages ?? []).reduce((sum, r) => sum + r.ms, 0)
	const delta = (now, prev) => {
		const diff = now - prev
		if (prev === 0) return diff === 0 ? '—' : `+${diff}`
		return `${diff >= 0 ? '+' : ''}${diff}（${((diff / prev) * 100).toFixed(0)}%）`
	}
	lines.push(`上一轮：${previous.at ?? '?'}（${(previous.stages ?? []).length} 个阶段）`)
	lines.push('')
	lines.push('| 指标 | 上一轮 | 本轮 | 变化 |')
	lines.push('|---|---|---|---|')
	lines.push(`| 外部请求总数 | ${prevOut} | ${nowOut} | ${delta(nowOut, prevOut)} |`)
	lines.push(`| 抓取源数 | ${prevFetch} | ${nowFetch} | ${delta(nowFetch, prevFetch)} |`)
	lines.push(`| 联网阶段总耗时 | ${(prevStage / 1000).toFixed(1)} s | ${(nowStage / 1000).toFixed(1)} s | ${delta(Math.round(nowStage / 1000), Math.round(prevStage / 1000))} s |`)
	const nowFailed = outbound.reduce((sum, o) => sum + (o.failed ?? 0), 0)
	const prevFailed = (previous.outbound ?? []).reduce((sum, o) => sum + (o.failed ?? 0), 0)
	lines.push(`| 失败请求 | ${prevFailed} | ${nowFailed} | ${delta(nowFailed, prevFailed)} |`)
	// **哪个源在变差**：只报"失败 8 个"无法行动，要知道是哪些源失败、比上轮多了谁
	const prevFailedNames = (previous.sources ?? []).filter((s) => s.ok === false).map((s) => s.name)
	const nowFailedNames = perSource.filter((s) => s.ok === false).map((s) => s.name)
	const newlyFailed = nowFailedNames.filter((name) => !prevFailedNames.includes(name))
	const recovered = prevFailedNames.filter((name) => !nowFailedNames.includes(name))
	lines.push(`| 失败的源 | ${prevFailedNames.join('、') || '（无）'} | ${nowFailedNames.join('、') || '（无）'} | ${newlyFailed.length > 0 ? `新失败：${newlyFailed.join('、')}` : recovered.length > 0 ? `已恢复：${recovered.join('、')}` : '无变化'} |`)
	const prevSlow = (previous.sources ?? [])[0]
	if (prevSlow) {
		lines.push(
			`| 最慢的源 | ${prevSlow.name} ${prevSlow.ms} ms | ${slowestSource ? `${slowestSource.name} ${slowestSource.ms} ms` : '—'} | ${slowestSource ? `${delta(slowestSource.ms, prevSlow.ms)} ms` : '—'} |`,
		)
	}
}
lines.push('')

const markdown = lines.join('\n')
const outDir = path.join(root, 'reports')
if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true })
const outFile = path.join(outDir, `patrol-${stamp}.md`)
writeFileSync(outFile, `${markdown}\n`)
writeFileSync(path.join(root, 'reports', 'latest.md'), `${markdown}\n`)
// 机器读的快照：报告是给人看的，趋势对比要靠结构化数据（解析 Markdown 太脆）
writeFileSync(
	snapshotPath,
	`${JSON.stringify({ at: report.at, port, quick, api: apiRows, stages: stageRows, outbound, sources: perSource, functional: functionalNotes, external: externalNotes }, null, 2)}\n`,
)

console.log('\n' + markdown.split('\n').slice(0, 40).join('\n'))
console.log(`\n  已写入 ${path.relative(root, outFile)} 与 reports/latest.md`)

// **失败时必须留下日志**：上一轮巡检失败（dev-server 没起来），而日志写在临时目录里、
// 脚本结束时连目录一起删掉 → 只能靠猜。现在先把日志存到 reports/ 再清理。
try {
	if (existsSync(logFile)) {
		const logText = readFileSync(logFile, 'utf8')
		writeFileSync(path.join(root, 'reports', 'last-dev-server.log'), logText)
		if (failedFunctional.length > 0) {
			writeFileSync(path.join(root, 'reports', `dev-server-failed-${stamp}.log`), logText)
			console.log('\n  --- dev-server 日志（最后 12 行，已存进 reports/）---')
			for (const line of logText.trim().split('\n').slice(-12)) console.log(`    ${line}`)
		}
	}
} catch {
	/* 日志留存失败不影响报告 */
}

// **清理写在报告之后，但它曾经把退出码带成 1**：rmSync 没被包住，而 dev-server 刚被
// SIGTERM 时日志文件句柄可能还没释放 → 抛异常 → 未捕获 → 退出码 1，
// **而报告早就写好了（全绿）**。于是"退出码 1"看起来像功能失败，其实只是清理失败 ——
// 退出码就此失去可信度。修法：清理失败**不允许**影响退出码，并打出残留路径便于人工清。
let cleanupNote = ''
try {
	rmSync(dataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
} catch (error) {
	cleanupNote = `清理临时目录失败（不影响结论）：${error instanceof Error ? error.message : String(error)} · 残留 ${dataDir}`
}
if (cleanupNote) console.log(`\n  ⚠️ ${cleanupNote}`)
// 退出码只反映**自身功能**（外部源抖动不该让巡检"失败"）
process.exitCode = failedFunctional.length === 0 ? 0 : 1
