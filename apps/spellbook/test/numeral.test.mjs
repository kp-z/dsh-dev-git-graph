import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import {
  roman,
  numeralWidth,
  widestNumeral,
  numeralColumnRem,
  numeralFontRem,
} from '../shared/numeral.mjs'

/**
 * 这组测试守的是「编号不许撞到标题上」。
 *
 * 起因：目录每一行是一张**独立**栅格，编号栏必须定宽标题才能跨行对齐，
 * 而罗马数字宽窄差很多 —— 125 行里有 33 行的编号越出 42px 的栏、撞进标题。
 * 修法是拿实测字宽算出「当下载库最长的编号要几像素」，由构建期写进 CSS。
 * 所以这里既要守住模型本身，也要守住「按当前条目数算出来的栏一定装得下」。
 */

/** 在浏览器里用真实字体（Cinzel 0.85rem／字距 0.1em）量出来的三个锚点。 */
const MEASURED_IN_BROWSER = [
  { text: 'LXXXVIII', px: 69 },
  { text: 'DCCCLXXXVIII', px: 116.8 },
  { text: 'CXXV', px: 44 },
]

test('罗马数字转换对得上', () => {
  assert.equal(roman(1), 'I')
  assert.equal(roman(4), 'IV')
  assert.equal(roman(9), 'IX')
  assert.equal(roman(14), 'XIV')
  assert.equal(roman(40), 'XL')
  assert.equal(roman(88), 'LXXXVIII')
  assert.equal(roman(125), 'CXXV')
  assert.equal(roman(888), 'DCCCLXXXVIII')
  assert.equal(roman(0), '')
})

test('宽度模型与浏览器实测吻合（误差 < 1px）', () => {
  for (const { text, px } of MEASURED_IN_BROWSER) {
    const modelled = numeralWidth(text, 13.6, 0.1)
    assert.ok(
      Math.abs(modelled - px) < 1,
      `${text} 模型算出 ${modelled.toFixed(2)}px，浏览器实测 ${px}px`,
    )
  }
})

test('最宽的不是条目数本身 —— 88 比 125 更宽', () => {
  // 这条正是当初翻车的原因：按 count 取编号，44px 的 CXXV 看着没问题，
  // 但同批里的 LXXXVIII 要 69px。所以必须扫 1..count 全部。
  const worst = widestNumeral(125, 13.6, 0.1)
  assert.equal(worst.text, 'LXXXVIII')
  assert.ok(worst.width > numeralWidth(roman(125), 13.6, 0.1))
})

test('按当前条目数算出的栏宽，一定装得下当前库里最宽的编号', () => {
  for (const count of [10, 50, 125, 250, 400, 999]) {
    const col = numeralColumnRem(count, { fontSizePx: 13.6 })
    const worst = widestNumeral(count, 13.6, 0.1)
    assert.ok(
      col * 16 >= worst.width,
      `${count} 条：栏 ${col}rem=${(col * 16).toFixed(1)}px 装不下 ${worst.text}=${worst.width.toFixed(1)}px`,
    )
  }
})

test('栏宽会随库增长 —— 不是写死的一个数', () => {
  const a = numeralColumnRem(50, { fontSizePx: 13.6 })
  const b = numeralColumnRem(125, { fontSizePx: 13.6 })
  const c = numeralColumnRem(400, { fontSizePx: 13.6 })
  assert.ok(a < b && b < c, `应当单调变宽，实际 ${a} / ${b} / ${c}`)
})

test('页边注的大编号字号一定塞得进 176px 的栏', () => {
  const RAIL = 176
  for (const count of [10, 50, 125, 250, 400, 999]) {
    const rem = numeralFontRem(count, { maxWidthPx: RAIL })
    const worst = widestNumeral(count, 16 * rem, 0.06)
    assert.ok(
      worst.width <= RAIL,
      `${count} 条：字号 ${rem}rem 时 ${worst.text} 要 ${worst.width.toFixed(1)}px，超过 ${RAIL}px`,
    )
  }
})

test('构建期真的把两个变量写进了 numeral.css，且样式表引用了它们', () => {
  const emitted = readFileSync(new URL('../dist/numeral.css', import.meta.url), 'utf8')
  assert.match(emitted, /--numeral-w:\s*[\d.]+rem/)
  assert.match(emitted, /--numeral-lead:\s*[\d.]+rem/)

  const css = readFileSync(new URL('../src/styles/spellbook.css', import.meta.url), 'utf8')
  // 目录行栅格与页边注都必须是「有兜底值的变量」，不能退回写死
  assert.match(css, /grid-template-columns:\s*var\(--numeral-w,\s*[\d.]+rem\)\s*auto\s*1fr/)
  assert.match(css, /font:\s*400\s*var\(--numeral-lead,\s*[\d.]+rem\)\/1\s*var\(--font-display\)/)

  const layout = readFileSync(new URL('../src/render/pages.mjs', import.meta.url), 'utf8')
  assert.match(layout, /numeral\.css/, '页面必须真的链上 numeral.css')
})
