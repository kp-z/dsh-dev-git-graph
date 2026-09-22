/**
 * 两套主题的对比度 —— 用眼睛看不出来的问题，用算术看
 *
 * 为什么值得单开一份测试：
 *   亮色模式里，「选中筹码」曾经用的是夜本的 --gilt-bright（#b8933f），
 *   落在羊皮纸底色 #eee7da 上对比度只有 **2.34** —— 那几个「全书 / 材质 / 动效」
 *   在亮色下几乎看不见。这不是审美分歧，是一个能被算出来的事实：
 *   2.34 远低于 WCAG AA 的 4.5。
 *   留着这份测试，以后谁再动 tokens 都会被立刻拦下。
 *
 * 判据用 WCAG 2.1 的相对亮度公式与对比度公式。
 * 4.5 是正文的线；大字（≥18.66px 粗体 或 ≥24px）3.0 就够，这里统一从严取 4.5。
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const CSS = readFileSync(new URL('../src/styles/spellbook.css', import.meta.url), 'utf8')

/** 抠出一个选择器块里的自定义属性。只认扁平的单层块，够用。 */
function tokensIn(selectorPattern) {
  const block = CSS.match(new RegExp(`${selectorPattern}\\s*\\{([\\s\\S]*?)\\n\\}`))?.[1] ?? ''
  const out = {}
  for (const [, name, value] of block.matchAll(/(--[\w-]+):\s*([^;]+);/g)) {
    out[name] = value.trim()
  }
  return out
}

const dark = tokensIn(':root')
const light = { ...dark, ...tokensIn(":root\\[data-theme='light'\\]") }

function channels(color) {
  const hex = color.replace('#', '')
  if (!/^[0-9a-f]{6}$/i.test(hex)) throw new Error(`只认 6 位十六进制色，收到 ${color}`)
  return [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
}

function luminance(color) {
  const [r, g, b] = channels(color).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4))
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

function contrast(a, b) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (hi + 0.05) / (lo + 0.05)
}

/**
 * 前景 token / 背景 token / 用途。
 * 背景取自实际渲染时该文字压着的那一层，不是一律用 --ground。
 */
const PAIRS = [
  ['--text', '--ground', '正文'],
  ['--text', '--ground-2', '正文压在浅一层底上（搜索框、命中条目）'],
  ['--text-dim', '--ground', '次要文字（场合、状态行）'],
  ['--text-dim', '--ground-2', '次要文字压在浅一层底上'],
  ['--gilt', '--ground', '金：栏目标签、条目编号'],
  ['--gilt', '--ground-2', '金压在浅一层底上'],
  ['--gilt-bright', '--ground-2', '亮金：选中的筹码、悬停的按钮与标题'],
  ['--rubric', '--ground', '朱批：命中的机制那一行'],
  ['--rule', '--ground', '分隔线（3.0 即可，它只是线）'],
]

const MIN = 4.5
/**
 * 分隔线不走 4.5。
 *
 * 这些线是**装饰性的**（条目之间本来还有大段留白隔着），WCAG 1.4.11 对纯装饰元素
 * 不设对比度要求，古书上的发丝线本来就该是「将将看得见」。
 * 所以这里的下限只守一件事：**它不能等于底色**。
 * 夜本的 --rule 实测 1.36，是刻意的淡，不是错误。
 */
const MIN_RULE = 1.25

for (const [themeName, tokens] of [
  ['夜', dark],
  ['昼', light],
]) {
  for (const [fg, bg, purpose] of PAIRS) {
    const isRule = fg === '--rule'
    test(`[${themeName}] ${purpose} 对比度达标`, () => {
      const ratio = contrast(tokens[fg], tokens[bg])
      const floor = isRule ? MIN_RULE : MIN
      assert.ok(
        ratio >= floor,
        `${themeName}本里 ${fg}(${tokens[fg]}) 压在 ${bg}(${tokens[bg]}) 上只有 ${ratio.toFixed(2)}，低于 ${floor} —— ${purpose}`,
      )
    })
  }
}

test('两套主题的底色确实不同（亮色不是暗色的别名）', () => {
  assert.notEqual(dark['--ground'], light['--ground'])
  assert.notEqual(dark['--text'], light['--text'])
})

test('亮色下「亮金」必须比「金」更深 —— 更跳的方向在羊皮纸上是往下走', () => {
  // 夜本里亮金更浅，昼本里亮金必须更深。搞反了就会出现 2.34 那种对比度。
  assert.ok(
    luminance(light['--gilt-bright']) < luminance(light['--gilt']),
    `昼本的 --gilt-bright(${light['--gilt-bright']}) 应当比 --gilt(${light['--gilt']}) 深`,
  )
  assert.ok(
    luminance(dark['--gilt-bright']) > luminance(dark['--gilt']),
    `夜本的 --gilt-bright(${dark['--gilt-bright']}) 应当比 --gilt(${dark['--gilt']}) 浅`,
  )
})
