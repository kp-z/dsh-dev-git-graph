/**
 * schedule.ts 的时刻计算测试。
 *
 * 这里只测纯函数 `computeNextRun` —— 定时链本身（setTimeout 自串链）没法在单测里稳定验，
 * 但**时刻算错**才是真正会让人错过日报的那类 bug，所以把它钉死。
 *
 * 从 lib/ 导入，理由同 rank.test.js。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { computeNextRun } from '../lib/schedule.js'

const at = (iso) => new Date(iso)

test('computeNextRun：还没到点 → 今天那个时刻', () => {
	const next = computeNextRun('08:00', at('2026-10-12T02:10:00+08:00'))
	assert.equal(next.getDate(), 12)
	assert.equal(next.getHours(), 8)
	assert.equal(next.getMinutes(), 0)
	assert.equal(next.getSeconds(), 0)
	assert.equal(next.getMilliseconds(), 0)
})

test('computeNextRun：已经过点 → 明天那个时刻（不是"立刻补跑"）', () => {
	const next = computeNextRun('08:00', at('2026-10-12T09:00:00+08:00'))
	assert.equal(next.getDate(), 13)
	assert.equal(next.getHours(), 8)
})

test('computeNextRun：正好等于目标时刻 → 排到明天（避免刚跑完又立刻跑一次）', () => {
	const next = computeNextRun('08:00', at('2026-10-12T08:00:00+08:00'))
	assert.equal(next.getDate(), 13)
})

test('computeNextRun：跨月/跨年正确进一位', () => {
	const next = computeNextRun('08:00', at('2026-10-31T09:00:00+08:00'))
	assert.equal(next.getMonth(), 10) // 11 月（0 基）
	assert.equal(next.getDate(), 1)

	const newYear = computeNextRun('08:00', at('2026-12-31T09:00:00+08:00'))
	assert.equal(newYear.getFullYear(), 2027)
	assert.equal(newYear.getMonth(), 0)
	assert.equal(newYear.getDate(), 1)
})

test('computeNextRun：缺前导零的小时也能解析（"8:05"）', () => {
	const next = computeNextRun('8:05', at('2026-10-12T02:10:00+08:00'))
	assert.equal(next.getHours(), 8)
	assert.equal(next.getMinutes(), 5)
})

test('computeNextRun：非法输入回落到 08:00，而不是抛异常或算出 NaN', () => {
	for (const bad of ['abc', '', '  ', '25:99', '8', '08-00']) {
		const next = computeNextRun(bad, at('2026-10-12T02:10:00+08:00'))
		assert.ok(Number.isFinite(next.getTime()), `"${bad}" 不应产出 Invalid Date`)
		assert.ok(next.getTime() > at('2026-10-12T02:10:00+08:00').getTime(), `"${bad}" 应排在未来`)
	}
})

test('computeNextRun：越界数值被夹紧，且永远落在未来', () => {
	const from = at('2026-10-12T02:10:00+08:00')
	for (const odd of ['99:99', '23:59', '00:00']) {
		const next = computeNextRun(odd, from)
		assert.ok(next.getTime() > from.getTime(), `"${odd}" 应在未来`)
		assert.ok(next.getHours() >= 0 && next.getHours() <= 23)
		assert.ok(next.getMinutes() >= 0 && next.getMinutes() <= 59)
	}
})
