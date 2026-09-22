import { test } from 'node:test'
import assert from 'node:assert/strict'

import { cssValue, paramValues } from '../shared/param.mjs'

const rangeWithUnit = { name: 'blur', type: 'range', unit: 'px', default: 18 }
const rangeNoUnit = { name: 'ratio', type: 'range', default: 1.6 }
const colorParam = { name: 'tint', type: 'color', default: '#ff0000' }

test('range 参数会补上单位', () => {
  assert.equal(cssValue(rangeWithUnit, 18), '18px')
})

test('没有声明单位的 range 不补', () => {
  assert.equal(cssValue(rangeNoUnit, 1.6), '1.6')
})

test('小数也补单位', () => {
  assert.equal(cssValue({ type: 'range', unit: 'rem', default: 0.5 }, 0.5), '0.5rem')
})

test('非 range 参数按原样输出', () => {
  assert.equal(cssValue(colorParam, '#ff0000'), '#ff0000')
})

test('0 是合法值，不能被当成空', () => {
  assert.equal(cssValue(rangeWithUnit, 0), '0px')
})

test('paramValues 用默认值摊平', () => {
  const values = paramValues([rangeWithUnit, rangeNoUnit, colorParam])
  assert.deepEqual(values, { blur: '18px', ratio: '1.6', tint: '#ff0000' })
})

test('paramValues 允许覆盖，且覆盖值同样补单位', () => {
  const values = paramValues([rangeWithUnit], { blur: 30 })
  assert.equal(values.blur, '30px')
})

test('paramValues 忽略没有 name 的项', () => {
  assert.deepEqual(paramValues([{ type: 'range' }]), {})
})

test('没有参数时返回空对象', () => {
  assert.deepEqual(paramValues(undefined), {})
})
