import { test } from 'node:test'
import assert from 'node:assert/strict'

import { chineseNumeral, roman } from '../src/render/text.mjs'
import { chaptersOf, renderIndex, renderSpell } from '../src/render/pages.mjs'

function entry(meta = {}, extra = {}) {
  return {
    meta: {
      title: '无名',
      slug: 'wuming',
      category: '材质',
      since: '2025-09',
      source: '自行实现',
      when: '想用的时候',
      stage: 'plain',
      ...meta,
    },
    description: '机制是 ==某个东西==。',
    code: [{ lang: 'css', lines: ['.a {}'], mechanismLines: [0] }],
    notes: [],
    mechanisms: ['某个东西'],
    ...extra,
  }
}

/* ------------------------------------------------------------ 中文数字 */

test('章节数字用中文，条目数字用罗马 —— 两套记号不能混', () => {
  assert.equal(chineseNumeral(1), '一')
  assert.equal(chineseNumeral(9), '九')
  assert.equal(chineseNumeral(10), '十')
  assert.equal(chineseNumeral(11), '十一')
  assert.equal(chineseNumeral(20), '二十')
  assert.equal(chineseNumeral(21), '二十一')
  assert.equal(roman(1), 'I')
  assert.equal(roman(4), 'IV')
})

test('超出范围的中文数字老实退回阿拉伯数字', () => {
  assert.equal(chineseNumeral(0), '0')
  assert.equal(chineseNumeral(100), '100')
})

/* ---------------------------------------------------------------- 分章 */

test('分章按 CATEGORIES 的顺序，而不是出现顺序', () => {
  const chapters = chaptersOf([
    entry({ category: '交互', slug: 'a' }),
    entry({ category: '材质', slug: 'b' }),
    entry({ category: '交互', slug: 'c' }),
  ])
  assert.deepEqual(
    chapters.map((chapter) => chapter.category),
    ['材质', '交互'],
  )
  assert.deepEqual(
    chapters.map((chapter) => chapter.index),
    [1, 2],
  )
  assert.deepEqual(
    chapters.map((chapter) => chapter.items.length),
    [1, 2],
  )
})

test('空分类不占章号', () => {
  const chapters = chaptersOf([entry({ category: '图形' })])
  assert.equal(chapters.length, 1)
  assert.equal(chapters[0].index, 1)
  assert.equal(chapters[0].category, '图形')
})

/* ---------------------------------------------------------------- 目录 */

test('每一章都有章首标题，章号与顺序一致', () => {
  const html = renderIndex([
    entry({ category: '材质', title: '甲', slug: 'jia' }),
    entry({ category: '动效', title: '乙', slug: 'yi' }),
  ])
  assert.match(html, /第一章/)
  assert.match(html, /第二章/)
  assert.match(html, /chapter-材质/)
  assert.match(html, /chapter-动效/)
  assert.match(html, /chapter-nav-link/)
})

test('只有一章时不摆章目导航', () => {
  const html = renderIndex([entry({ category: '材质' })])
  assert.match(html, /chapter-head/)
  assert.doesNotMatch(html, /chapter-nav-link/)
  assert.doesNotMatch(html, /has-nav/)
})

test('多章时目录带 has-nav，走两栏布局', () => {
  const html = renderIndex([
    entry({ category: '材质', slug: 'a' }),
    entry({ category: '动效', slug: 'b' }),
  ])
  assert.match(html, /index-body has-nav/)
})

test('每行右侧的缩略图指向该条目自己的 demo', () => {
  const html = renderIndex([entry({ slug: 'liquid-glass', category: '材质' })])
  assert.match(html, /class="row-preview"/)
  assert.match(html, /src="spell\/liquid-glass\/demo\.html"/)
  assert.match(html, /href="spell\/liquid-glass\/"/)
})

test('缩略图与图版一样走沙箱，且不给它键盘焦点', () => {
  const html = renderIndex([entry({ slug: 'x' })])
  const preview = html.match(/<iframe class="row-preview-doc"[^>]*>/)?.[0] ?? ''
  assert.match(preview, /sandbox="allow-scripts"/)
  assert.match(preview, /tabindex="-1"/)
  assert.match(preview, /loading="lazy"/)
  assert.doesNotMatch(preview, /allow-same-origin/)
})

test('目录里出现魔杖与花饰', () => {
  const html = renderIndex([entry()])
  assert.match(html, /wordmark-wand/)
  assert.match(html, /class="fleuron"/)
})

test('条目序号全书连续，不随章节重置', () => {
  const html = renderIndex([
    entry({ category: '材质', title: '甲', slug: 'a' }),
    entry({ category: '动效', title: '乙', slug: 'b' }),
    entry({ category: '动效', title: '丙', slug: 'c' }),
  ])
  const numerals = [...html.matchAll(/class="row-numeral"[^>]*>([^<]+)</g)].map((m) => m[1])
  assert.deepEqual(numerals, ['I', 'II', 'III'])
})

/* -------------------------------------------------------------- 对开页 */

test('对开页页边注标出所属章节', () => {
  const html = renderSpell(entry({ category: '动效' }), {
    ordinal: 2,
    total: 5,
    chapter: { index: 2 },
  })
  assert.match(html, /marginalia-chapter/)
  assert.match(html, /第二章/)
  assert.match(html, /动效/)
  assert.match(html, />II</)
})

test('对开页不再单独列一行「分类」，章号已经说清楚了', () => {
  const html = renderSpell(entry(), { ordinal: 1, total: 1, chapter: { index: 1 } })
  assert.doesNotMatch(html, /<dt>分类<\/dt>/)
  assert.match(html, /<dt>收录<\/dt>/)
  assert.match(html, /<dt>出处<\/dt>/)
})
