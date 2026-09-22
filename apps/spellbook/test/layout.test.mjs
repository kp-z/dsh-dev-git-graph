import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import { chineseNumeral, roman } from '../src/render/text.mjs'
import { chaptersOf, renderIndex, renderSpell } from '../src/render/pages.mjs'
import { CATEGORIES } from '../shared/schema.mjs'

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

test('每行右侧的缩略图指向该条目自己的 demo，并且自己是个按钮', () => {
  const html = renderIndex([entry({ slug: 'liquid-glass', category: '材质' })])
  // 缩略图从 <span> 改成了 <button data-peek>：它要点开放大预览。
  // 按钮不能嵌在 <a> 里（无效 HTML，而且点它会连带跳页），所以它是链接的兄弟节点。
  assert.match(html, /<button class="row-peek" type="button" data-peek="liquid-glass"/)
  assert.match(html, /src="spell\/liquid-glass\/demo\.html"/)
  assert.match(html, /href="spell\/liquid-glass\/"/)
  assert.match(html, /data-prompt="liquid-glass"/)
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

test('首页首屏让给检索，原导语挪到页脚', () => {
  const html = renderIndex([entry({ category: '材质' })])
  assert.match(html, /<section class="concordance"/)
  assert.match(html, /id="spellbook-query"/)
  // 立论还在，但不再是首屏标语
  assert.match(html, /colophon-lede[^>]*>一条咒语 = 一段描述 \+ 一段示例代码。/)
  assert.doesNotMatch(html, /class="prologue-lede"/)
})

test('限定分类的筹码由分类表生成，不是写死的', () => {
  const html = renderIndex([entry({ category: '材质' })])
  for (const category of CATEGORIES) {
    assert.match(html, new RegExp(`data-scope="${category}"`), `缺 ${category} 的筹码`)
  }
  assert.match(html, /data-scope="" aria-pressed="true"/)
})

test('放大预览用的 dialog 只在首页出现一次，且默认没内容', () => {
  const html = renderIndex([entry({ category: '材质' })])
  assert.equal((html.match(/data-peek-dialog/g) ?? []).length, 1)
  assert.match(html, /data-peek-stage><\/div>/)
})

test('编号在链接内部 —— 挪出去会失去 num 那一格', () => {
  const html = renderIndex([entry({ slug: 'x' })])
  // .row-link 的 grid-template-areas 点名了 num/name/leader/when 四格。
  // 编号一旦被挪到 <a> 外面，就找不到 num 那一格，会被自动排到整行的末尾。
  const link = html.match(/<a class="row-link"[\s\S]*?<\/a>/)?.[0] ?? ''
  assert.match(link, /class="row-numeral"/, '编号必须在 .row-link 里面')
  assert.match(link, /class="row-name"/)
  assert.match(link, /class="row-leader"/)
  assert.match(link, /class="row-when"/)
})

test('放大预览与抄咒语是链接的兄弟节点，不是它的子节点', () => {
  const html = renderIndex([entry({ slug: 'x' })])
  const link = html.match(/<a class="row-link"[\s\S]*?<\/a>/)?.[0] ?? ''
  assert.doesNotMatch(link, /<button/, '按钮嵌在 <a> 里是无效 HTML')
  assert.match(html, /<\/a>\s*<button class="row-copy"/)
  assert.match(html, /<\/button>\s*<button class="row-peek"/)
})

test('缩略图排在最右 —— 它是这一条的页码，不能被工具挤到中间', () => {
  // 次序是「正文 → 工具 → 页码」。缩略图一旦不在行尾，
  // 「引导线一路连到缩略图」那条设计就断了。
  const html = renderIndex([entry({ slug: 'x' })])
  const row = html.match(/<li class="row"[\s\S]*?<\/li>/)?.[0] ?? ''
  const peekAt = row.indexOf('row-peek')
  const copyAt = row.indexOf('row-copy')
  assert.ok(peekAt > -1 && copyAt > -1, '两个控件都该在行里')
  assert.ok(peekAt > copyAt, '缩略图必须在抄咒语之后（也就是更靠右）')
  assert.match(row, /row-peek"[^>]*$|<\/li>\s*$/)
  assert.ok(row.lastIndexOf('row-peek') > row.lastIndexOf('row-copy'))
})

test('有边栏时给 main 挂 has-rail，首屏才好跟着正文列对齐', () => {
  const two = renderIndex([entry({ category: '材质', slug: 'a' }), entry({ category: '动效', slug: 'b' })])
  assert.match(two, /<main id="main" class="has-rail">/)
  // 只有一章时没有边栏，就不该加位移
  const one = renderIndex([entry({ category: '材质' })])
  assert.match(one, /<main id="main">/)
})

test('样式表里有 [hidden] 兜底 —— 类规则上的 display 会盖过浏览器默认', () => {
  // .index-body.has-nav 是 display: grid，会盖掉浏览器自带的 [hidden] { display: none }。
  // 搜索时目录藏不住，会整片铺在结果下面。
  const css = readFileSync(new URL('../src/styles/spellbook.css', import.meta.url), 'utf8')
  assert.match(css, /\[hidden\]\s*\{\s*display:\s*none\s*!important/)
})

test('两套主题都声明了 color-scheme', () => {
  const css = readFileSync(new URL('../src/styles/spellbook.css', import.meta.url), 'utf8')
  assert.match(css, /:root \{[^}]*color-scheme: dark/)
  assert.match(css, /:root\[data-theme='light'\] \{[^}]*color-scheme: light/)
})

test('所有分类筹码都在 role=group 容器里', () => {
  // 之前是用字符串 replace 把筹码塞到 </div> 后面，结果只有第一个落在 group 内，
  // 另外六个散在外面：aria-label「限定分类」管不到它们，flex 间距也丢了，
  // 首屏因此多出一段说不清的空白。模板留洞才治本。
  const html = renderIndex([entry({ category: '材质' })])
  const group = html.match(/<div class="concordance-scope"[\s\S]*?<\/div>/)?.[0] ?? ''
  assert.ok(group, '应当有一个 concordance-scope 容器')
  assert.equal((group.match(/scope-chip/g) ?? []).length, CATEGORIES.length + 1, '全书 + 每个分类都该在里面')
  assert.match(group, /role="group"/)
  assert.match(group, /aria-label="限定分类"/)

  // group 结束后、状态行之前，不该再冒出击筹码。
  // 切点必须落在整段 group 之后：若按 'concordance-scope' 切，切点落在开标签里，
  // 会把组内的筹码也算进来，测试就会假红。
  const groupEnd = html.indexOf(group) + group.length
  const between = html.slice(groupEnd, html.indexOf('concordance-status', groupEnd))
  assert.equal((between.match(/scope-chip/g) ?? []).length, 0, '不该有筹码散在 group 外面')
})
