/**
 * 采集层探针 —— 不做任何落盘，直接跑一轮真实采集并把结果打出来。
 *
 * 用途：①开发期验证各源在本机当前网络下到底通不通；②排查"为什么今天没有 YouTube 条目"；
 * ③改完采集器后跑一次，比翻日报文件快得多。
 *
 *   node scripts/probe-sources.mjs            # 全部源
 *   node scripts/probe-sources.mjs hn youtube # 只跑指定源
 */
import { resolveConfig } from '../lib/config.js'
import { resolveSourceIds, runCollection } from '../lib/collect/index.js'
import { rankItems } from '../lib/rank.js'
import { defaultPrefs } from '../lib/store.js'

const explicit = process.argv.slice(2).filter((a) => !a.startsWith('-'))
const config = resolveConfig({})
const targets = resolveSourceIds(config, explicit.length > 0 ? explicit : undefined)

console.log(`探针启动：${targets.length} 个源 —— ${targets.join(', ')}\n`)

const started = Date.now()
const outcome = await runCollection({ config })
const elapsed = Date.now() - started

console.log(`采集完成：${outcome.items.length} 条原始条目 / ${elapsed}ms\n`)
console.log('源状态：')
for (const source of outcome.sources) {
	const icon = source.ok ? '✅' : '❌'
	const detail = source.ok
		? `${String(source.count).padStart(3)} 条 · ${source.durationMs}ms${source.error ? ` · ${source.error}` : ''}`
		: `${source.error ?? '未知错误'}（${source.durationMs}ms）`
	console.log(`  ${icon} ${source.name.padEnd(18, ' ')} ${detail}`)
}

const videos = outcome.items.filter((i) => i.kind === 'video')
const platforms = new Map()
for (const item of outcome.items) {
	platforms.set(item.platform ?? 'web', (platforms.get(item.platform ?? 'web') ?? 0) + 1)
}
console.log(`\n平台分布：${[...platforms.entries()].map(([k, v]) => `${k}=${v}`).join(' · ')}`)
console.log(`视频条目：${videos.length} 条（YouTube ${videos.filter((v) => v.platform === 'youtube').length} / B站 ${videos.filter((v) => v.platform === 'bilibili').length}）`)

const prefs = { ...defaultPrefs(), topics: ['AI'] }
const ranked = rankItems(outcome.items, { prefs, feedback: {} })
console.log(`\n排序后：${ranked.length} 条（偏好主题 AI）。Top 10：`)
for (const [index, item] of ranked.slice(0, 10).entries()) {
	console.log(
		`  ${String(index + 1).padStart(2)}. [${item.score.toFixed(1)}] [${item.topic}] [${item.platform}] ${item.title.slice(0, 62)}`,
	)
	console.log(`      ${item.url}`)
	console.log(`      ${item.reasons.join(' · ') || '(无理由)'}`)
}

// 去重自检：同一规范化 URL 不该出现两次
const seen = new Set()
let dupes = 0
for (const item of ranked) {
	if (seen.has(item.url)) dupes++
	seen.add(item.url)
}
console.log(`\n去重自检：重复 URL ${dupes} 条（应为 0）`)

const failed = outcome.sources.filter((s) => !s.ok)
if (failed.length > 0) {
	console.log(`\n⚠️ ${failed.length} 个源失败：`)
	for (const source of failed) console.log(`   - ${source.name}：${source.error}`)
}
