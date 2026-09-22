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

test('首屏不再有「限定分类」的筹码 —— 分类的入口只留章目导航一处', () => {
  // 那排筹码是章目导航的重复品：分类本来就是章，左边已经列过一遍。
  // 同样的入口做两遍，首屏就多出一条横带、还只占半幅，看着像没做完。
  // 用两个分类，才会长出章目导航（只有一章时它本来就不出现）。
  const html = renderIndex([entry({ category: '材质' }), entry({ slug: 'y', category: '动效' })])
  assert.doesNotMatch(html, /scope-chip/, '筹码该整排去掉')
  assert.doesNotMatch(html, /concordance-scope/, '容器也该去掉')
  assert.doesNotMatch(html, /data-scope=/, '作用域的钩子一个都不该留')
  // 但分类并没有从页面上消失：章首标题与章目导航仍在，按分类翻书照样成立
  assert.match(html, /chapter-nav/, '章目导航要在')
  assert.match(html, /材质/, '分类名仍该出现在章首/章目里')
})

test('筹码去掉后，site.js 里不该剩下作用域那套机件', () => {
  const js = readFileSync(new URL('../src/site.js', import.meta.url), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
  assert.doesNotMatch(js, /scope-chip/, '别再去找筹码')
  assert.doesNotMatch(js, /let scope = /, '作用域变量该一起删掉')
  assert.doesNotMatch(js, /category: scope/, '检索不该再按作用域过滤')
  // 不限分类仍然要能查（rank 的 category 缺省就是 null）
  assert.match(js, /rank\(ranker\.index, query, \{ limit: 40 \}\)/, '该退回到不限分类的查法')
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

test('状态行只在检索时有字，平时是空的活口', () => {
  // 状态行是检索的活口（role=status / aria-live），「正在取索引…」「N 条命中」
  // 「搜索不可用：…」都从这里报。不查的时候它空着，不能 display:none ——
  // 那会把活口从无障碍树里摘掉，读屏就播不出来了。
  const html = renderIndex([entry({ category: '材质' })])
  const status = html.match(/<p class="concordance-status"[^>]*><\/p>/)?.[0] ?? ''
  assert.ok(status, '状态行该是空的（初值不由模板写死）')
  assert.match(status, /role="status"/)
  assert.match(status, /aria-live="polite"/)
  assert.doesNotMatch(html, /共 \d+ 条咒语/, '「共 N 条」那句常驻说明已经去掉')

  const js = readFileSync(new URL('../src/site.js', import.meta.url), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')
  assert.match(js, /setStatus\(''\)/, '不查的时候该清空状态行')
  assert.doesNotMatch(js, /条咒语/, '别再写那句常驻计数')
  const css = readFileSync(new URL('../src/styles/spellbook.css', import.meta.url), 'utf8')
  assert.doesNotMatch(
    css.replace(/\/\*[\s\S]*?\*\//g, ''),
    /\.concordance-status[^{]*\{[^}]*display:\s*none/,
    '空的状态行不能 display:none，否则活口失效',
  )
})

/* ── 刊头：书名与检索口一行，检索口吸顶 ───────────────────────────── */

test('查词口住在刊头里，整格占满正文宽（右缘要跟条目对齐）', () => {
  const html = renderIndex([entry({ slug: 'x' })])
  const masthead = html.match(/<header class="masthead">[\s\S]*?<\/header>/)?.[0] ?? ''
  assert.ok(masthead, '该有刊头')
  assert.match(masthead, /class="wordmark"/, '书名叫 wordmark')
  assert.match(masthead, /class="concordance-field"/, '查词口要在刊头里')
  assert.match(masthead, /id="spellbook-query"/, '输入框也在刊头里')
  assert.match(masthead, /data-theme-toggle/, '明暗开关也在这一行')
  // 刊头是两格：第一格「书名 + 开关」，第二格整格给查词口。
  // 查词口必须**独占第二格** —— 开关但凡自己占一格，查词口就够不到 1250，
  // 右缘比下面的条目短一整个开关（实测 73px），首屏上缺一角。
  const idCell = masthead.match(/<div class="masthead-id">[\s\S]*?\n  <\/div>/)?.[0] ?? ''
  assert.ok(idCell, '该有 .masthead-id 这一格')
  assert.ok(idCell.includes('class="wordmark"'), '书名在第一格')
  assert.ok(idCell.includes('data-theme-toggle'), '开关也在第一格')
  assert.ok(!idCell.includes('concordance-field'), '查词口不许挤进第一格')
  // 栅格只留两列：任何第三列都会把查词口从右边缘顶开
  const css = readFileSync(new URL('../src/styles/spellbook.css', import.meta.url), 'utf8')
  const grid = css.match(/\n\.masthead \{[\s\S]*?\n\}/)?.[0] ?? ''
  const cols = grid.match(/grid-template-columns:([^;]+);/)?.[1] ?? ''
  assert.ok(cols, '刊头该写明栅格列')
  // 拆列时不能把 calc(...) / minmax(...) 里面的空格算成列分隔，所以要数括号层数
  const topLevel = (s) => {
    const out = []
    let depth = 0
    let cur = ''
    for (const ch of s.trim()) {
      if (ch === '(') depth++
      if (ch === ')') depth--
      if (/\s/.test(ch) && depth === 0) {
        if (cur) out.push(cur)
        cur = ''
        continue
      }
      cur += ch
    }
    if (cur) out.push(cur)
    return out
  }
  assert.equal(topLevel(cols).length, 2, `刊头只该有两列，实为「${cols.trim()}」`)
})

test('「说一句你要的效果」那个标题已经去掉', () => {
  const html = renderIndex([entry({ slug: 'x' })])
  assert.doesNotMatch(html, /说一句你要的效果/, '这句话不该再出现在页面上')
  assert.doesNotMatch(html, /concordance-head/, '它的样式钩子也该一并清掉')
})

test('首页只剩一个 h1，就是书名 —— 标题去掉了，一级标题得有人接班', () => {
  const html = renderIndex([entry({ slug: 'x' })])
  const h1s = html.match(/<h1[\s>]/g) ?? []
  assert.equal(h1s.length, 1, `首页该正好一个 h1，实得 ${h1s.length}`)
  const masthead = html.match(/<header class="masthead">[\s\S]*?<\/header>/)?.[0] ?? ''
  assert.match(masthead, /<h1 class="masthead-heading">/, '这个 h1 该是刊头里的书名')
})

test('内页的 h1 仍是条目名，不吃刊头那一份', () => {
  const html = renderSpell(entry({ slug: 'x', title: '液态玻璃面板' }), {
    ordinal: 1,
    total: 1,
    chapter: { index: 1 },
  })
  const h1s = html.match(/<h1[\s>]/g) ?? []
  assert.equal(h1s.length, 1, '内页也该正好一个 h1')
  assert.match(html, /<h1 class="title">/)
  assert.doesNotMatch(html, /masthead-heading/, '内页书名的 h1 不该出现')
})

test('查词口的记号是魔杖，不是「查」字，但可访问名还在', () => {
  const html = renderIndex([entry({ slug: 'x' })])
  const masthead = html.match(/<header class="masthead">[\s\S]*?<\/header>/)?.[0] ?? ''
  assert.doesNotMatch(masthead, /concordance-label/, '「查」字标签该没有了')
  assert.match(masthead, /class="concordance-wand"/, '该换成魔杖')
  // 魔杖是 aria-hidden 的画，读屏读不出，所以必须有别的办法说出这个输入框叫什么
  assert.match(
    masthead,
    /<label class="concordance-mark"[^>]*>[\s\S]*?class="visually-hidden">[^<]+</,
    '标签里要有一段只给读屏看的文字当可访问名',
  )
  const css = readFileSync(new URL('../src/styles/spellbook.css', import.meta.url), 'utf8')
  assert.match(css, /\.visually-hidden \{/, '配套的隐藏类得在样式表里')
})

test('刊头吸顶，并且是不透明的 —— 透字就废了', () => {
  const css = readFileSync(new URL('../src/styles/spellbook.css', import.meta.url), 'utf8')
  const rule = css.match(/^\.masthead \{[\s\S]*?^\}/m)?.[0] ?? ''
  assert.ok(rule, '该有 .masthead 规则')
  assert.match(rule, /position:\s*sticky/, '刊头要吸顶')
  assert.match(rule, /top:\s*0/, '吸在顶边')
  assert.match(rule, /z-index:\s*\d/, '要压住底下的内容')
  assert.match(rule, /background:\s*var\(--ground\)/, '底必须不透明')
})

test('章目导航吸顶时让开刊头，两级不会叠在一起', () => {
  const css = readFileSync(new URL('../src/styles/spellbook.css', import.meta.url), 'utf8')
  const rule = css.match(/^\.chapter-nav \{[\s\S]*?^\}/m)?.[0] ?? ''
  assert.match(rule, /position:\s*sticky/)
  assert.match(rule, /top:\s*calc\(var\(--masthead-h\)/, '让开的量要由 --masthead-h 算出来')
  // 刊头多高是内容定的（字号、字体加载都会变），写死数字迟早错位，
  // 所以得由脚本量一次写进变量。
  const js = readFileSync(new URL('../src/site.js', import.meta.url), 'utf8')
  assert.match(js, /setProperty\('--masthead-h'/)
  assert.match(js, /fonts\?\.ready/, '自托管字体后到，落位后要重量一次')
})

test('查词口与正文列在同一条左边缘上', () => {
  // 刊头第一格按 --rail 减掉间距来定宽，所以查词口正好落在正文那条线（370）上，
  // 与下面的筹码、结果、条目齐平 —— 吸顶的时候也不会跳。
  const css = readFileSync(new URL('../src/styles/spellbook.css', import.meta.url), 'utf8')
  const rule = css.match(/^\.masthead \{[\s\S]*?^\}/m)?.[0] ?? ''
  assert.match(
    rule,
    /grid-template-columns:\s*calc\(var\(--rail\) - var\(--masthead-gap\)\)/,
    '第一格宽度要从边栏占位推出来，不能写死',
  )
  assert.match(rule, /--masthead-gap/)
})

test('画框只有两档，查词口用小件那一档', () => {
  const css = readFileSync(new URL('../src/styles/spellbook.css', import.meta.url), 'utf8')
  assert.match(css, /--frame:\s*30px/)
  assert.match(css, /--frame-thin:\s*13px/)
  const field = css.match(/^\.concordance-field \{[\s\S]*?^\}/m)?.[0] ?? ''
  assert.match(field, /border-image-width:\s*var\(--frame-thin\)/, '查词口用小件档')
  // 窄屏那档若要收，必须比 13px 更细 —— 之前写 16px，在大档是 22px 时是「收」，
  // 大档改成 30px、小档 13px 之后，16px 反而变成了「放」，画框越缩越粗。
  // 别按位置切媒体查询块：基础规则恰好夹在两个 700px 段之间，按段一取就先撞上基础规则，
  // 于是"窄屏那条"取到的是 var(--frame-thin)，测出个 null 来。改成按内容找：
  // 全表扫 .concordance-field 的规则，谁把 border-image-width 写成了具体数字，谁就是窄屏那条。
  const allFieldRules = [...css.matchAll(/\.concordance-field \{[\s\S]*?\}/g)].map((m) => m[0])
  const narrowField =
    allFieldRules.find((rule) => /border-image-width:\s*\d+px/.test(rule)) ?? ''
  assert.ok(narrowField, '该有一条把画框宽度写成具体数字的窄屏规则')
  const width = narrowField.match(/border-image-width:\s*(\d+)px/)
  assert.ok(Number(width[1]) <= 13, `窄屏画框该比 13px 细，实得 ${width[1]}px`)
})

/* ── 缩略图：点图就预览 ───────────────────────────────────────────── */

test('缩略图的 iframe 必须让开指针 —— 否则点图没反应，而且不报错', () => {
  // 缩略图的可见部分就是那块 iframe，而 iframe 是另一个文档，会自己吃掉点击。
  // 实测：elementFromPoint 在缩略图正中心取到的是 IFRAME.row-preview-doc，
  // 不是外面那个按钮 —— 于是整张图上只有悬停冒出来的 13px 角标点得动，
  // 「点一下图就预览」是空话。这类失效不抛错、不报警，只能靠测试钉住。
  const css = readFileSync(new URL('../src/styles/spellbook.css', import.meta.url), 'utf8')
  const rule = css.match(/\.row-preview-doc \{[\s\S]*?\n\}/)?.[0] ?? ''
  assert.ok(rule, '该有 .row-preview-doc 规则')
  assert.match(rule, /pointer-events:\s*none/, '缩略图的 iframe 必须 pointer-events: none')
})

test('缩略图上的提示角标常驻，不只在悬停时出现', () => {
  // 触屏没有悬停：把唯一的提示藏进 :hover，等于对触屏用户不存在。
  const css = readFileSync(new URL('../src/styles/spellbook.css', import.meta.url), 'utf8')
  const rule = css.match(/\n\.row-peek-zoom \{[\s\S]*?\n\}/)?.[0] ?? ''
  assert.ok(rule, '该有 .row-peek-zoom 规则')
  const opacity = rule.match(/opacity:\s*([\d.]+)/)
  assert.ok(opacity, '该写明 opacity')
  assert.ok(Number(opacity[1]) > 0, `角标默认要看得见，实得 opacity ${opacity[1]}`)
})

test('缩略图是按钮，点图与点标题各走各的', () => {
  const html = renderIndex([entry({ slug: 'x', title: '液态玻璃面板' })])
  const row = html.match(/<li class="row"[\s\S]*?<\/li>/)?.[0] ?? ''
  // 缩略图必须是独立的 button，不能塞进 <a>：塞进去点图就跳条目页，预览反而开不了
  const linkEnd = row.indexOf('</a>')
  const peekAt = row.indexOf('row-peek')
  assert.ok(peekAt > linkEnd, '预览按钮必须在链接之外（链接已经闭合）')
  assert.match(row, /<button class="row-peek"[^>]*data-peek=/, '预览按钮该带 data-peek')
  assert.match(row, /aria-label="放大预览：液态玻璃面板"/, '该说清它是放大预览')
  assert.match(row, /<button class="row-copy"[^>]*data-prompt=/, '抄咒语仍该在')
})

test('没有对着链接去筛缩略图的死规则', () => {
  // .row-peek 是 .row-link 的**兄弟**，不是后代。
  // 原先写着 .row-link:hover .row-preview —— 选错了类，也选错了关系，永远匹配不上。
  const css = readFileSync(new URL('../src/styles/spellbook.css', import.meta.url), 'utf8')
  assert.doesNotMatch(css, /\.row-link:hover\s+\.row-peek/, '.row-link 里没有 .row-peek，别这么选')
  // 改名漏掉的那处也要清掉：HTML 里已经没有任何 .row-preview 元素了
  assert.doesNotMatch(css, /[^-]\.row-preview\s*\{/, '.row-preview 已改名 .row-peek，不该再有规则')
})

test('刊头第二格 = 正文宽，所以查词口的右缘才够得着 1250', () => {
  // 这是本次改动的要害：查词口右缘差 73px，等于「一个开关 + 一个格间距」。
  // 光看 CSS 很难发现，所以把这条算术钉住：首格 + 格间距 + 第二格 = 正文宽。
  const css = readFileSync(new URL('../src/styles/spellbook.css', import.meta.url), 'utf8')
  const grid = css.match(/\n\.masthead \{[\s\S]*?\n\}/)?.[0] ?? ''
  assert.match(grid, /grid-template-columns:\s*calc\(var\(--rail\) - var\(--masthead-gap\)\)\s+minmax\(0, 1fr\)/,
    '首格该是 rail - masthead-gap，第二格该吃掉剩下的全部')
  // 算一遍：--rail 220 = --rail-w 176 + --rail-gap 44
  // 首格（220 - 22）+ 格间距 22 = 220 = --rail
  // 第二格 = 正文宽 880 → 查词口右缘 = 370 + 880 = 1250 = 条目右缘 ✓
  const num = (name) => {
    const m = css.match(new RegExp(`--${name}:\\s*([0-9.]+)px;`))
    assert.ok(m, `该有 --${name}`)
    return Number(m[1])
  }
  const rail = num('rail-w') + num('rail-gap')
  assert.equal(num('rail-w') + num('rail-gap') - num('masthead-gap') + num('masthead-gap'), rail,
    '首格加格间距该正好等于 --rail')
  assert.equal(num('measure'), num('shell') - 2 * num('gutter') - rail,
    `正文宽该是 shell - 两侧留白 - 边栏，实得 --measure ${num('measure')}`)
  // 边栏的算法在 CSS 里写成 calc，确认它确实是 rail-w + rail-gap
  assert.match(css, /--rail:\s*calc\(var\(--rail-w\)\s*\+\s*var\(--rail-gap\)\)/,
    '--rail 该是 rail-w + rail-gap')
})

test('开关住在 .masthead-id 里，不再自己占一列', () => {
  const raw = readFileSync(new URL('../src/styles/spellbook.css', import.meta.url), 'utf8')
  // 先把注释剥掉 —— 注释里提到某个选择器，不代表真有那条规则
  const css = raw.replace(/\/\*[\s\S]*?\*\//g, '')
  // 只要还有 .masthead > .theme-toggle 这种「开关是栅格子元素」的写法，
  // 就说明开关又跑回第三格了 —— 查词口会立刻短 73px
  assert.doesNotMatch(css, /\.masthead\s*>\s*\.theme-toggle/, '开关不该是刊头的直接栅格子元素')
  assert.match(css, /\.masthead-id \{[\s\S]*?justify-content: space-between/, '第一格内部该是书名靠左、开关靠右')
})

test('空的状态行不许漏出上边距', () => {
  // 空块的高度是 0，可 margin 不会跟着消失 —— 那 12px 会永远横在
  // 刊头和花饰之间，查不查都在，成了凭空的空白。
  const css = readFileSync(new URL('../src/styles/spellbook.css', import.meta.url), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
  const base = css.match(/\.concordance-status \{[\s\S]*?\n\}/)?.[0] ?? ''
  assert.ok(base, '该有 .concordance-status 基础规则')
  assert.match(base, /margin:\s*0/, '基础规则不该带上边距')
  assert.match(css, /\.concordance-status:not\(:empty\) \{[\s\S]*?margin-top:\s*12px/,
    '上边距该钉在「有字」这一种情况上')
})

test('检索区的上边距不留给空状态行占位', () => {
  const css = readFileSync(new URL('../src/styles/spellbook.css', import.meta.url), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
  const rule = css.match(/\n\.concordance \{[\s\S]*?\n\}/)?.[0] ?? ''
  assert.ok(rule, '该有 .concordance 规则')
  assert.match(rule, /margin:\s*0/, '状态行空着时整块高度是 0，别再留 30px')
})
