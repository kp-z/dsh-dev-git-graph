/**
 * 命令行参数解析的回归测试。
 *
 * 这些测试的存在理由是一次真实事故：`--port=8971` 被**静默忽略**、回落到默认 8799，
 * 而调用方一直轮询 8971 → 冒烟必然失败，且**日志里没有任何警告**。
 * 所以这里钉住两条：**两种写法等价**、**不认识的参数必须报错**。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseArgs, toNumber } from '../scripts/args.mjs'

const spec = { flags: ['no-refresh', 'ai-fake'], values: ['port', 'data-dir', 'seed-history'] }

test('空格写法与等号写法**等价**（事故的直接来源：等号写法曾被静默忽略）', () => {
	const spaced = parseArgs(['--port', '8971', '--data-dir', '/tmp/x'], spec)
	const equals = parseArgs(['--port=8971', '--data-dir=/tmp/x'], spec)
	assert.deepEqual(spaced.errors, [])
	assert.deepEqual(equals.errors, [])
	assert.equal(spaced.values.port, '8971')
	assert.equal(equals.values.port, '8971', '--port=8971 必须和 --port 8971 一样生效')
	assert.equal(spaced.values['data-dir'], '/tmp/x')
	assert.equal(equals.values['data-dir'], '/tmp/x')
})

test('开关参数两种写法都能认，且开关不接受取值', () => {
	assert.equal(parseArgs(['--no-refresh'], spec).values['no-refresh'], true)
	assert.equal(parseArgs(['--ai-fake', '--no-refresh'], spec).values['ai-fake'], true)
	// 开关后面跟了个"值"不算它的值，而是当成位置参数报错
	const bad = parseArgs(['--no-refresh=yes'], spec)
	assert.equal(bad.errors.length, 1)
	assert.match(bad.errors[0], /开关/)
})

test('**不认识的参数必须报错**，绝不静默忽略（这类"不报错的失败"已经踩过多次）', () => {
	const { values, errors } = parseArgs(['--port', '8971', '--nonsense', '--portt=1'], spec)
	assert.equal(values.port, '8971', '已知参数仍要解析出来')
	assert.equal(errors.length, 2)
	assert.match(errors[0], /无法识别的参数：--nonsense/)
	assert.match(errors[1], /--portt/)
})

test('取值参数缺值要报错（空格写法后面跟另一个参数时也算缺值）', () => {
	assert.match(parseArgs(['--port'], spec).errors[0], /缺少取值/)
	assert.match(parseArgs(['--port', '--no-refresh'], spec).errors[0], /缺少取值/)
	assert.match(parseArgs(['--port='], spec).errors[0], /缺少取值/)
})

test('位置参数（不带 --）要报错，而不是被当成值吃掉', () => {
	const { errors } = parseArgs(['8799'], spec)
	assert.equal(errors.length, 1)
	assert.match(errors[0], /位置参数不支持/)
})

test('多个参数顺序任意，且不会互相污染', () => {
	const { values, errors } = parseArgs(['--ai-fake', '--seed-history=3', '--no-refresh', '--port', '8799'], spec)
	assert.deepEqual(errors, [])
	assert.deepEqual(values, { 'ai-fake': true, 'seed-history': '3', 'no-refresh': true, port: '8799' })
})

test('空参数表不报错', () => {
	assert.deepEqual(parseArgs([], spec), { values: {}, errors: [] })
})

test('toNumber：非法值报错而不是静默回落', () => {
	const errors = []
	assert.equal(toNumber('8971', 'port', errors), 8971)
	assert.deepEqual(errors, [])
	assert.equal(toNumber('abc', 'port', errors), undefined)
	assert.match(errors[0], /需要是一个数字/)
	assert.equal(toNumber(undefined, 'port', errors), undefined, '没给就不是错')
	errors.length = 0
	assert.equal(toNumber('99999', 'port', errors, { max: 65535 }), undefined)
	assert.match(errors[0], /不能大于/)
	errors.length = 0
	assert.equal(toNumber('0', 'port', errors, { min: 1 }), undefined)
	assert.match(errors[0], /不能小于/)
})
