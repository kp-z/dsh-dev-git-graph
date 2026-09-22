/**
 * 站点检索排序器 —— 与库里 FTS5 的一致性
 *
 * 这份测试存在的唯一理由：**不能有两个真相**。
 *
 * 库里的检索由 SQLite FTS5 算分（shared/vault.mjs），站点是静态页、用不了 FTS5，
 * 于是有了 shared/rank.mjs 这一份纯函数实现。两份实现一旦分道扬镳，
 * 同一个查询在 CLI 和站点上就会给出不同的答案，而这正是 shared/vault-text.mjs
 * 开头明令要避免的事。
 *
 * 所以这里不只是「跑得通」，而是**拿同一批查询同时问两边，要求 Top-1 一致**。
 * 哪天有人改了列权重、分词规则或打分公式，这条测试会立刻红。
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { buildIndex, rank, tokenize } from '../shared/rank.mjs'
import { units, BM25_WEIGHTS } from '../shared/vault-text.mjs'
import { buildPrompt, stripMarks, stripMechanismAnnotations } from '../shared/prompt.mjs'
import { openVault, defaultVaultPaths } from '../shared/vault.mjs'

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')

function loadIndexFile() {
  return JSON.parse(readFileSync(path.join(ROOT, 'dist', 'search-index.json'), 'utf8'))
}

/* ------------------------------------------------------------- 分词 */

test('tokenize 与 FTS5 的索引口径一致：每个汉字各自成 token', () => {
  assert.deepEqual(tokenize('液态玻璃'), ['液', '态', '玻', '璃'])
})

test('tokenize 把连字符当分隔符 —— 与 FTS5 的 unicode61 一致', () => {
  assert.deepEqual(tokenize('backdrop-filter'), ['backdrop', 'filter'])
})

/*
 * 这一条盯着一个真实发生过的 bug。
 *
 * units() 刻意把 backdrop-filter 当成**一个**单元，而索引里存的是 backdrop 与 filter
 * 两个相邻 token（连字符是分隔符）。如果查询单元不过一遍 tokenize 就直接拿去比，
 * 就是拿一个不存在的 token 做全等比较 —— 命中恒为 0，而且不报错。
 * 当时 backdrop-filter / clip-path / shape-outside 全是 0 条，正是前端最会去搜的那类词。
 */
test('带连字符的属性名能搜到（回归）', () => {
  const data = loadIndexFile()
  const index = buildIndex(data.docs)
  const expected = [
    ['backdrop-filter', 'liquid-glass'],
    ['clip-path', 'wipe-reveal'],
    ['shape-outside', 'shape-outside-wrap'],
    ['tabular-nums', 'tabular-numbers'],
  ]
  for (const [query, slug] of expected) {
    const hits = rank(index, query, { limit: 5 })
    assert.ok(hits.length > 0, `查「${query}」不该是 0 条`)
    assert.equal(hits[0]?.slug, slug, `查「${query}」的 Top-1 应当是 ${slug}`)
  }
})

test('中文查询被切成双字短语，不是单字', () => {
  const u = units('玻璃面板')
  assert.deepEqual(u, [['玻', '璃'], ['璃', '面'], ['面', '板']])
})

/* --------------------------------------------------------------- 排序 */

test('索引能建起来，且规模与索引文件一致', () => {
  const data = loadIndexFile()
  const index = buildIndex(data.docs)
  assert.equal(index.N, data.count)
  assert.ok(index.avgdl > 0)
})

test('说人话的查询能命中该命中的那条', () => {
  const data = loadIndexFile()
  const index = buildIndex(data.docs)
  const cases = [
    ['玻璃', 'liquid-glass'],
    ['文字绕图排', 'shape-outside-wrap'],
    ['跟着鼠标动的按钮', 'cursor-glow-follow'],
  ]
  for (const [query, expected] of cases) {
    const hits = rank(index, query, { limit: 5 })
    assert.equal(hits[0]?.slug, expected, `查「${query}」的 Top-1 应当是 ${expected}`)
  }
})

test('纯噪音查询返回空 —— 精度来自双字短语', () => {
  const data = loadIndexFile()
  const index = buildIndex(data.docs)
  assert.equal(rank(index, '番茄炒蛋').length, 0)
})

test('分类限定真的把结果限住了', () => {
  const data = loadIndexFile()
  const index = buildIndex(data.docs)
  const hits = rank(index, '动', { category: '排版', limit: 20 })
  for (const hit of hits) {
    assert.equal(data.docs.find((d) => d.slug === hit.slug).category, '排版')
  }
})

/* ------------------------------------------------ 与库的一致性（核心） */

test('站点排序与库里 FTS5 的 Top-1 一致', () => {
  const data = loadIndexFile()
  const index = buildIndex(data.docs)
  const vault = openVault(defaultVaultPaths(ROOT))

  const queries = [
    '跟着鼠标动的按钮', '玻璃', '模糊面板', '斜条纹', '文字绕图排', '粘性', '滚动动画',
    '打字机', '渐变色文字', '3D 翻转', '骨架屏', '焦点环', '弹窗', '饼图', '噪点', '阴影',
    '鼠标磁吸', '呼吸', '抖动', '排版', '网格布局', '对比', '磨砂', '金属', '光',
  ]

  const mismatched = []
  for (const query of queries) {
    const mine = rank(index, query, { limit: 8, tier: 'core' })[0]?.slug ?? null
    const theirs = vault.search(query, { limit: 8, tier: 'core' })[0]?.slug ?? null
    if (mine !== theirs) mismatched.push(`${query}: 站点=${mine} 库=${theirs}`)
  }

  vault.close()
  assert.deepEqual(mismatched, [], `站点与库的排序分岔了：\n  ${mismatched.join('\n  ')}`)
})

test('索引文件的列名与 BM25_WEIGHTS 对得上（改列名就会红）', () => {
  const data = loadIndexFile()
  for (const col of Object.keys(BM25_WEIGHTS)) {
    if (col === 'slug') continue // UNINDEXED，不参与打分
    assert.ok(
      Object.hasOwn(data.docs[0], col),
      `索引里缺列 ${col} —— rank.mjs 会按这个列名取权重，缺了就悄悄算成 1`,
    )
  }
})

/* --------------------------------------------------------------- 咒语 */

test('拼出来的咒语同时带着描述与代码', () => {
  const entry = {
    meta: { title: '测试条', slug: 't', category: '材质', when: '什么时候用', source: '出处' },
    description: '这是 ==机制== 描述。',
    mechanisms: ['机制短语'],
    code: [{ lang: 'css', body: '.a { color: red; }' }],
    caveats: ['会失效的情况'],
  }
  const text = buildPrompt(entry)
  assert.match(text, /任务：把「测试条」这个效果做进我的项目。/)
  assert.match(text, /什么时候用它：什么时候用/)
  assert.match(text, /要的效果：/)
  assert.match(text, /这是 机制 描述。/) // ==标记== 被去掉
  assert.match(text, /靠什么成立：/)
  assert.match(text, /\.a \{ color: red; \}/) // 代码在
  assert.match(text, /容易失效的地方：/)
  assert.match(text, /出处：出处/)
})

/*
 * 这一条盯着这一层原先写错的地方。
 *
 * 提示开头曾是「用 HTML/CSS 实现这个前端效果：」。它替对方把技术栈定死了 ——
 * 可库里的示例是 HTML/CSS，只因为「描述 + 代码」总要挑一种语言把机制演示出来，
 * 不因为它就是对方项目该用的那一栈。落到什么栈上，只有对方那个项目知道。
 */
test('提示不替对方决定技术栈', () => {
  const text = buildPrompt({
    meta: { title: '液态玻璃', slug: 'g' },
    description: '毛玻璃。',
    code: [{ lang: 'css', body: '.a { backdrop-filter: blur(2px); }' }],
  })
  assert.doesNotMatch(text, /用 HTML\/CSS/, '不该点名 HTML/CSS 当实现栈')
  assert.doesNotMatch(text, /用 [A-Za-z/]+ 实现/, '任何语言都不该被写成命令')
  // 反过来，必须明说「按你手里那个项目来」
  assert.match(text, /取决于你那个项目/, '该把决定权交回给目标项目')
  assert.match(text, /用什么都行/, '该点明换语言也行，不强制')
})

/*
 * 曾经做过一版：从 entry_code.lang 现算一份语言清单，写成「示例用 A、B、C 写成」。
 *
 * 那是多余的机件。这份提示要交出去的是**效果与实现思路**，对方用什么语言是他
 * 那一头的事 —— 提示不该管，也不该由提示来点。代码块自己在哪门语言里，
 * 标签已经写在块头上，够用了。
 */
test('代码块的标签跟着数据走，但提示不替对方算一份语言清单', () => {
  const doc = buildPrompt({
    meta: { title: 'x' },
    code: [{ lang: 'tsx', body: 'const A = () => null' }],
  })
  assert.match(doc, /^--- TSX ---$/m, '块头标签该写清这是哪门语言的例子')
  assert.doesNotMatch(doc, /示例用.*写成/, '不该再算一份语言清单')

  // 查不到的语言用原样，不吞不猜 —— 例子不限于 html/css，React 也行，别的也行
  const exotic = buildPrompt({
    meta: { title: 'x' },
    code: [{ lang: 'swiftui', body: 'Text("hi")' }],
  })
  assert.match(exotic, /^--- swiftui ---$/m)
})

test('约束排在示例前面 —— 先说要什么、什么会坏，再给参考', () => {
  const text = buildPrompt({
    meta: { title: 'x' },
    description: '描述正文',
    mechanisms: ['机制'],
    caveats: ['边界'],
    code: [{ lang: 'css', body: '.a{}' }],
  })
  const at = (re) => text.search(re)
  assert.ok(at(/要的效果：/) < at(/靠什么成立：/), '效果该在机制前')
  assert.ok(at(/靠什么成立：/) < at(/容易失效的地方：/), '机制该在边界前')
  assert.ok(at(/容易失效的地方：/) < at(/参考实现/), '边界该在示例前')
  assert.ok(at(/参考实现/) < at(/^--- CSS ---$/m), '说明该在代码块前')
})

test('prompt 认得两种代码块形状（lines 与 body）', () => {
  const fromParse = buildPrompt({
    meta: { title: 'x' },
    code: [{ lang: 'css', lines: ['.a {', '}'] }],
  })
  const fromVault = buildPrompt({
    meta: { title: 'x' },
    code: [{ lang: 'css', body: '.a {\n}' }],
  })
  assert.match(fromParse, /\.a \{/)
  assert.match(fromVault, /\.a \{/)
})

test('站内的机制批注不会混进复制出去的咒语', () => {
  const withNote = stripMechanismAnnotations('/* @mechanism 原点在底边 */ transform: scaleY(1);')
  assert.equal(withNote, '/* 原点在底边 */ transform: scaleY(1);')

  const bare = stripMechanismAnnotations('color: red; /* @mechanism */\nheight: 1px;')
  assert.ok(!bare.includes('@mechanism'), `纯标记应当被删掉，实际：${bare}`)
  assert.match(bare, /height: 1px;/)

  const jsNote = stripMechanismAnnotations('// @mechanism 格子本身不转\nconst a = 1')
  assert.equal(jsNote, '// 格子本身不转\nconst a = 1')
})

test('真实内容里的每一份咒语都不含站内标记、且都带代码', () => {
  const vault = openVault(defaultVaultPaths(ROOT))
  const slugs = vault.db.prepare('SELECT slug FROM entries').all().map((r) => r.slug)
  const problems = []
  for (const slug of slugs) {
    const text = buildPrompt(vault.get(slug))
    if (text.includes('@mechanism')) problems.push(`${slug}: 残留 @mechanism`)
    if (/---\s*(HTML|CSS|JavaScript)\s*---\n\s*\n/.test(text)) problems.push(`${slug}: 代码段是空的`)
    if (!text.includes('容易失效的地方')) problems.push(`${slug}: 缺边界`)
  }
  vault.close()
  assert.deepEqual(problems, [], `咒语拼装有问题：\n  ${problems.join('\n  ')}`)
})

test('stripMarks 只去标记，不动文字', () => {
  assert.equal(stripMarks('这是 ==机制== 描述'), '这是 机制 描述')
  assert.equal(stripMarks('没有标记'), '没有标记')
})
