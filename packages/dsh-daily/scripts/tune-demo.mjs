/**
 * 调教效果对照器 —— 证明"说一句话，排序真的变了"。
 *
 *   node scripts/tune-demo.mjs                          # 用今天的落盘数据 + 默认示例调教
 *   node scripts/tune-demo.mjs "以后多推开源，少推币圈"
 *
 * 为什么值得单独做一个脚本：排序引擎与调教解析都是纯函数，改完之后**必须**能一眼看到
 * "调教前 Top10 / 调教后 Top10 / 谁上来了 / 谁下去了"。只看单测的绿点是不够的 ——
 * 单测证明逻辑没坏，这个脚本证明**效果对不对**。
 *
 * 不联网：读 ~/.dsh/daily/days/<date>.json。没有数据就先跑 scripts/dev-server.mjs 抓一轮。
 */
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { applyTuning } from '../lib/tune.js'
import { rankItems } from '../lib/rank.js'
import { defaultPrefs, localDate } from '../lib/store.js'

const instruction = process.argv[2] || '以后每天多推 AI Agent 相关的，少推币圈'

const dir = process.env.DSH_DAILY_DIR || path.join(os.homedir(), '.dsh', 'daily')
const date = localDate()
const file = path.join(dir, 'days', `${date}.json`)

let day
try {
	day = JSON.parse(await readFile(file, 'utf8'))
} catch {
	console.error(`读不到 ${file}\n先跑：node scripts/dev-server.mjs（会抓一轮并落盘）`)
	process.exit(1)
}

if (!day.items?.length) {
	console.error(`${date} 没有任何条目，先抓一轮。`)
	process.exit(1)
}

// 沿用已见时间，避免重排时把"没有发布时间的条目"重新当成新条目
const firstSeen = {}
for (const item of day.items) firstSeen[item.url] = item.firstSeenAt

const basePrefs = defaultPrefs()
const tuned = applyTuning(instruction, basePrefs)

const before = rankItems(day.items, { prefs: basePrefs, feedback: {}, firstSeen, quota: 500 })
const after = rankItems(day.items, { prefs: tuned.prefs, feedback: {}, firstSeen, quota: 500 })

function top(items, n = 10) {
	return items.slice(0, n)
}

function show(label, items) {
	console.log(`\n${label}`)
	console.log('─'.repeat(78))
	items.forEach((item, index) => {
		console.log(
			`${String(index + 1).padStart(2)}. [${item.score.toFixed(1).padStart(6)}] [${item.topic}] ${item.title.slice(0, 52)}`,
		)
		console.log(`    ${item.sourceName} · ${item.reasons.join(' · ') || '(无理由)'}`)
	})
}

console.log(`数据源：${file}`)
console.log(`条目数：${day.items.length}`)
console.log(`调教语句：「${instruction}」`)
console.log(`\n解析出的偏好变更：`)
for (const change of tuned.applied) console.log(`  • ${change.detail}`)
console.log(`\n解析结果：${tuned.message}`)

const beforeTop = top(before)
const afterTop = top(after)
show('调教前 Top 10', beforeTop)
show('调教后 Top 10', afterTop)

// ---- 变化统计 ----
const beforeRank = new Map(before.map((item, i) => [item.url, i]))
const afterRank = new Map(after.map((item, i) => [item.url, i]))

const rose = []
const fell = []
const entered = []
const left = []
for (const item of afterTop) {
	const was = beforeRank.get(item.url)
	if (was === undefined) entered.push({ item, to: afterRank.get(item.url) })
	else if (was > afterRank.get(item.url)) rose.push({ item, from: was, to: afterRank.get(item.url) })
}
for (const item of beforeTop) {
	const now = afterRank.get(item.url)
	if (now === undefined) {
		// 条目应该都在（同一天数据），这里只是防御
		left.push({ item, to: null })
	} else if (now >= 10) {
		fell.push({ item, from: beforeRank.get(item.url), to: now })
	}
}
void left

console.log('\n变化摘要')
console.log('─'.repeat(78))
rose.sort((a, b) => b.from - b.to - (a.from - a.to))
fell.sort((a, b) => a.from - b.from)
console.log(`升幅最大：${rose.slice(0, 5).map((x) => `${x.item.title.slice(0, 28)}(${x.from + 1}→${x.to + 1})`).join('  ') || '（无）'}`)
console.log(`跌出前十：${fell.slice(0, 5).map((x) => `${x.item.title.slice(0, 28)}(${x.from + 1}→${x.to + 1})`).join('  ') || '（无）'}`)
console.log(`新进前十：${entered.slice(0, 5).map((x) => `${x.item.title.slice(0, 28)}(${x.to + 1})`).join('  ') || '（无）'}`)

// Top10 重合度：这是"调教是否真的起作用"最直观的单一数字
const overlap = afterTop.filter((item) => beforeRank.get(item.url) !== undefined && beforeRank.get(item.url) < 10).length
console.log(`\nTop10 重合度：${overlap}/10（越低说明这次调教改动越大）`)
