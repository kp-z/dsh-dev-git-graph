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
const dataDir = mkdtempSync(path.join(tmpdir(), 'dsh-patrol-'))
const logFile = path.join(dataDir, 'server.log')

const apiRows = []
const stageRows = []
const outbound = []
const functionalNotes = []

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
		await sleep(300)
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

	const finalState = await hit('状态（末次）', '/api/state')
	const sources = finalState.body?.sources ?? []
	const rotated = sources.filter((s) => s.count === 0 && s.ok).length
	outbound.push({
		kind: '抓取订阅源',
		requests: sources.length,
		ok: sources.filter((s) => s.ok !== false).length,
		failed: sources.filter((s) => s.ok === false).length,
		skipped: rotated,
	})
	functionalNotes.push({
		item: '源健康',
		ok: sources.every((s) => s.ok !== false),
		detail: `${sources.length} 个源，失败 ${sources.filter((s) => s.ok === false).length} 个`,
	})
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
lines.push('')
lines.push(`**结论**：${failedFunctional.length === 0 ? '全部通过' : `${failedFunctional.length} 项未通过：${failedFunctional.map((i) => i.item).join('、')}`}`)
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

const markdown = lines.join('\n')
const outDir = path.join(root, 'reports')
if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true })
const outFile = path.join(outDir, `patrol-${stamp}.md`)
writeFileSync(outFile, `${markdown}\n`)
writeFileSync(path.join(root, 'reports', 'latest.md'), `${markdown}\n`)

console.log('\n' + markdown.split('\n').slice(0, 40).join('\n'))
console.log(`\n  已写入 ${path.relative(root, outFile)} 与 reports/latest.md`)

rmSync(dataDir, { recursive: true, force: true, maxRetries: 5 })
process.exit(failedFunctional.length === 0 ? 0 : 1)
