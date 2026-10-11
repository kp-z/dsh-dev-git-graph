/**
 * tune.ts 的回归测试 —— 自然语言调教是这个插件最容易被"感觉上没生效"毁掉的功能，
 * 所以每个意图都钉一条断言，并且**必须断言"改动清单里说了什么"**（那是用户唯一能看到的反馈）。
 *
 * 从 `lib/` 导入，理由同 rank.test.js。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { applyTuning } from '../lib/tune.js'
import { defaultPrefs } from '../lib/store.js'

function prefs(overrides = {}) {
	return { ...defaultPrefs(), ...overrides }
}

function details(result) {
	return result.applied.map((c) => `${c.kind}:${c.detail}`)
}

test('调教：用户原话（需求里的例子）→ 加主题 + 加关键词 + 加屏蔽词 + 记原话', () => {
	const result = applyTuning('以后每天多推 AI Agent 相关的，少推币圈', prefs())
	assert.ok(result.prefs.topics.includes('AI'), `应加主题 AI，实际 ${JSON.stringify(result.prefs.topics)}`)
	assert.ok(
		result.prefs.keywords.some((k) => k.word.toLowerCase() === 'agent'),
		`应加关键词 agent，实际 ${JSON.stringify(result.prefs.keywords)}`,
	)
	assert.ok(
		result.prefs.blocked.some((b) => b.includes('币圈')),
		`应屏蔽币圈，实际 ${JSON.stringify(result.prefs.blocked)}`,
	)
	assert.ok(result.prefs.tuningNotes.includes('以后每天多推 AI Agent 相关的，少推币圈'), '原话必须被记下来')
	// 每一处改动都要能被复述给用户看
	const text = details(result).join(' | ')
	assert.ok(text.includes('AI'), '改动清单里应出现主题')
	assert.ok(text.includes('币圈'), '改动清单里应出现屏蔽词')
})

test('调教：需求里的原句"我现在需要每天推荐 AI 相关的新闻"', () => {
	const result = applyTuning('我现在需要每天推荐 AI 相关的新闻', prefs())
	assert.ok(result.prefs.topics.includes('AI'), `应识别出 AI 主题，实际 ${JSON.stringify(result.prefs)}`)
})

test('调教：多推某个源 → 源权重 1.5；少推 → 0.4', () => {
	const up = applyTuning('多推少数派', prefs())
	assert.equal(up.prefs.sourceWeights.sspai, 1.5)
	const down = applyTuning('以后少推哔哩哔哩', prefs())
	assert.ok(
		Object.values(down.prefs.sourceWeights).includes(0.4),
		`应降低 B 站权重，实际 ${JSON.stringify(down.prefs.sourceWeights)}`,
	)
})

test('调教：屏蔽 / 取消屏蔽', () => {
	const blocked = applyTuning('屏蔽币圈', prefs())
	assert.ok(blocked.prefs.blocked.includes('币圈'))

	const unblocked = applyTuning('取消屏蔽币圈', prefs({ blocked: ['币圈'] }))
	assert.equal(unblocked.prefs.blocked.includes('币圈'), false, '取消屏蔽应把它移除')
	assert.ok(unblocked.applied.some((c) => c.kind === 'remove-blocked'))
})

test('调教：取消关注某个主题 → 从优先列表移除', () => {
	const result = applyTuning('不要 AI 了', prefs({ topics: ['AI', '开源'] }))
	assert.equal(result.prefs.topics.includes('AI'), false)
	assert.ok(result.prefs.topics.includes('开源'), '其它主题不受影响')
})

test('调教：每日条数上限', () => {
	const result = applyTuning('每天最多 30 条', prefs())
	assert.equal(result.prefs.dailyQuota, 30)
	assert.ok(result.applied.some((c) => c.kind === 'quota'))
})

test('调教：读不懂的话不瞎改，但一定记下原话（模型侧还能补救）', () => {
	const result = applyTuning('嗯……随便看看', prefs())
	assert.deepEqual(result.prefs.topics, [])
	assert.deepEqual(result.prefs.blocked, [])
	assert.deepEqual(result.prefs.keywords, [])
	assert.ok(result.prefs.tuningNotes.includes('嗯……随便看看'), '原话必须留住')
	assert.ok(result.message.length > 0, '必须给用户一句解释')
})

test('调教：空输入不产生任何改动，也不污染 tuningNotes', () => {
	const result = applyTuning('   ', prefs())
	assert.equal(result.applied.length, 0)
	assert.equal(result.prefs.tuningNotes.length, 0)
})

test('调教：纯函数 —— 不改动传入的 prefs（调用方决定要不要落盘）', () => {
	const before = prefs({ topics: ['AI'] })
	const snapshot = JSON.stringify(before)
	applyTuning('以后多推开源', before)
	assert.equal(JSON.stringify(before), snapshot, 'applyTuning 不得原地修改入参')
})

test('调教：同一条重复调教不产生重复项（幂等）', () => {
	const once = applyTuning('多推 AI', prefs())
	const twice = applyTuning('多推 AI', once.prefs)
	assert.equal(
		twice.prefs.topics.filter((t) => t === 'AI').length,
		1,
		`主题不该重复，实际 ${JSON.stringify(twice.prefs.topics)}`,
	)
})

test('调教：tuningNotes 有上限，不会无限膨胀', () => {
	let current = prefs()
	for (let i = 0; i < 60; i++) current = applyTuning(`第 ${i} 条想法`, current).prefs
	assert.ok(current.tuningNotes.length <= 50, `实际 ${current.tuningNotes.length}`)
})
