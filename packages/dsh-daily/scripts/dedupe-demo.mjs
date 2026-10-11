/**
 * 跨天去重的效果演示 —— 用**真实的今日条目**跑一遍"昨天已经推过"的场景。
 *
 *   node scripts/dedupe-demo.mjs
 *
 * 做法：把真实的 days/<今天>.json 复制到临时目录里当作"昨天"，再把它本身当作"今天"，
 * 然后调用**真实的 DailyService**（不是重写一遍逻辑）触发一次重排 ——
 * 于是"读历史 → 日历窗口 → 重罚"整条链路都真的跑了一遍，只是数据落在临时目录里，
 * **不会污染 ~/.dsh/daily**。
 *
 * 为什么值得单独做：去重的"接线"（service 有没有读历史、传没传进 rankItems）
 * 纯函数测试是覆盖不到的，而这里跑的就是那条线。
 */
import { mkdtemp, readFile, writeFile, mkdir, cp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { DailyService } from '../lib/service.js'
import { resolveConfig } from '../lib/config.js'
import { localDate } from '../lib/store.js'
import { shiftDate } from '../lib/rank.js'

const realDir = process.env.DSH_DAILY_DIR || path.join(os.homedir(), '.dsh', 'daily')
const today = localDate()
const yesterday = shiftDate(today, -1)

let source
try {
	source = await readFile(path.join(realDir, 'days', `${today}.json`), 'utf8')
} catch {
	console.error(`读不到 ${realDir}/days/${today}.json\n先跑：node scripts/dev-server.mjs（会抓一轮并落盘）`)
	process.exit(1)
}

const tmp = await mkdtemp(path.join(os.tmpdir(), 'dsh-daily-dedupe-demo-'))
try {
	await mkdir(path.join(tmp, 'days'), { recursive: true })
	await mkdir(path.join(tmp, 'digest'), { recursive: true })
	// "昨天"与"今天"放同一批真实条目 —— 模拟"这批内容昨天已经推过一次"
	await cp(path.join(realDir, 'days', `${today}.json`), path.join(tmp, 'days', `${yesterday}.json`))
	const day = JSON.parse(source)
	day.date = today
	await writeFile(path.join(tmp, 'days', `${today}.json`), JSON.stringify(day))

	const service = new DailyService(
		resolveConfig({ dataDir: tmp, dedupeWindowDays: 3 }),
		{ info() {}, warn() {}, error() {} },
	)
	await service.init()
	const before = await service.getDay(today)
	const beforeTop = [...before.items].sort((a, b) => b.score - a.score).slice(0, 8)

	// tune 会触发 reRank → loadRecentlySeen → rankItems
	await service.tune('多推 AI')
	const after = await service.getDay(today)
	const afterTop = [...after.items].sort((a, b) => b.score - a.score).slice(0, 8)

	const show = (label, items) => {
		console.log(`\n${label}`)
		console.log('─'.repeat(78))
		items.forEach((item, i) => {
			console.log(`${String(i + 1).padStart(2)}. [${String(item.score).padStart(6)}] ${item.title.slice(0, 46)}`)
			console.log(`    ${item.reasons.join(' · ') || '(无理由)'}`)
		})
	}

	console.log(`真实条目：${before.items.length} 条（来自 ${realDir}/days/${today}.json）`)
	console.log(`模拟场景：把今天这批内容复制成「${yesterday} 已经推过」，窗口 dedupeWindowDays=3`)
	show('去重前 Top 8', beforeTop)
	show('去重后 Top 8', afterTop)

	const penalized = after.items.filter((i) => i.reasons.some((r) => r.includes('已推过')))
	console.log(`\n被判为"已推过"：${penalized.length} / ${after.items.length} 条`)
	console.log(`样例：${penalized.slice(0, 3).map((i) => `${i.title.slice(0, 24)}(分数 ${i.score})`).join('  ') || '（无）'}`)
	const topChanged = beforeTop[0].url !== afterTop[0].url
	console.log(`\nTop1 是否变化：${topChanged ? '是' : '否'}（${afterTop[0].title.slice(0, 40)}）`)
	console.log(`\n说明：本轮演示把同一天的真实条目当作"昨天推过"，所以惩罚覆盖面最大；`)
	console.log(`真实使用时每天只有**重复出现**的那部分会被罚。数据落在临时目录，用户数据未被改动。`)
} finally {
	await rm(tmp, { recursive: true, force: true })
}
