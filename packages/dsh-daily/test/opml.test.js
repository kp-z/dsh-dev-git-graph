/**
 * OPML 导入导出的回归测试。
 *
 * 重点不在"能不能解析一个规规矩矩的 OPML"（那太容易了），而在
 * **真实阅读器导出的那些形状**：嵌套分类、属性顺序任意、单引号、
 * 自闭合、实体、以及"这条 outline 到底是不是订阅源"。
 *
 * 从 lib/ 导入，理由同 rank.test.js。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm, readFile, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import {
	decodeEntities,
	escapeXml,
	isHttpUrl,
	mergeFeedSpecs,
	parseAttributes,
	parseOpml,
	serializeOpml,
	specToFeed,
} from '../lib/opml.js'
import { normalizeUrl } from '../lib/rank.js'
import { DailyService } from '../lib/service.js'
import { resolveConfig } from '../lib/config.js'
import { localDate } from '../lib/store.js'

// ---------- 实体与转义 ----------

test('decodeEntities：命名 / 十进制 / 十六进制各解一个，且只解一层', () => {
	assert.equal(decodeEntities('a &amp; b'), 'a & b')
	assert.equal(decodeEntities('&lt;tag&gt;'), '<tag>')
	assert.equal(decodeEntities('&#39;'), "'")
	assert.equal(decodeEntities('&#x4e2d;&#x6587;'), '中文')
	// 单趟扫描：&amp;lt; 必须解成 &lt; 而不是 <
	assert.equal(decodeEntities('&amp;lt;'), '&lt;')
	assert.equal(decodeEntities('&amp;amp;'), '&amp;')
})

test('decodeEntities：不认识的实体与裸 & 原样保留（不能吞文本）', () => {
	assert.equal(decodeEntities('a &unknown; b'), 'a &unknown; b')
	assert.equal(decodeEntities('rock & roll'), 'rock & roll')
	assert.equal(decodeEntities('100% & 更多'), '100% & 更多')
	// 分号太远就不当实体
	assert.equal(decodeEntities('&' + 'x'.repeat(50) + ';'), '&' + 'x'.repeat(50) + ';')
})

test('escapeXml：五个特殊字符都会被转义（导出后仍是合法 XML）', () => {
	assert.equal(escapeXml('a & b <c> "d" \'e\''), 'a &amp; b &lt;c&gt; &quot;d&quot; &apos;e&apos;')
})

// ---------- 属性 ----------

test('parseAttributes：顺序任意 / 单双引号 / 无引号值都能取到', () => {
	const a = parseAttributes('xmlUrl="https://a.com/feed" text="A" type="rss"')
	assert.equal(a.xmlurl, 'https://a.com/feed')
	assert.equal(a.text, 'A')
	assert.equal(a.type, 'rss')

	const b = parseAttributes("text='B' xmlUrl='https://b.com'")
	assert.equal(b.xmlurl, 'https://b.com')
	assert.equal(b.text, 'B')

	const c = parseAttributes('xmlUrl=https://c.com text=C')
	assert.equal(c.xmlurl, 'https://c.com')
	assert.equal(c.text, 'C')
})

test('parseAttributes：属性值里的实体会被解码', () => {
	const a = parseAttributes('text="Tech &amp; Science" xmlUrl="https://x.com?a=1&amp;b=2"')
	assert.equal(a.text, 'Tech & Science')
	assert.equal(a.xmlurl, 'https://x.com?a=1&b=2')
})

// ---------- 解析 ----------

const REAL_OPML = `<?xml version="1.0" encoding="UTF-8"?>
<opml version="2.0">
  <head>
    <title>我的订阅</title>
  </head>
  <body>
    <outline text="技术" title="技术">
      <outline type="rss" text="少数派" title="少数派" xmlUrl="https://sspai.com/feed" htmlUrl="https://sspai.com" />
      <outline type="rss" xmlUrl="https://www.solidot.org/index.rss" text="Solidot" />
    </outline>
    <outline text="社区">
      <outline text="Hacker News" type="rss" xmlUrl="https://hnrss.org/frontpage" />
    </outline>
    <outline text="没地址的分类" />
    <outline type="rss" text="裸条目" xmlUrl="https://example.com/rss" />
  </body>
</opml>`

test('parseOpml：真实形状 —— 嵌套分类被正确归属，无地址的 outline 计入分类', () => {
	const result = parseOpml(REAL_OPML)
	assert.equal(result.title, '我的订阅')
	assert.equal(result.feeds.length, 4)
	assert.equal(result.categories, 3) // 技术 / 社区 / 没地址的分类

	const byUrl = Object.fromEntries(result.feeds.map((f) => [f.url, f]))
	assert.equal(byUrl['https://sspai.com/feed'].category, '技术')
	assert.equal(byUrl['https://sspai.com/feed'].name, '少数派')
	assert.equal(byUrl['https://sspai.com/feed'].htmlUrl, 'https://sspai.com')
	assert.equal(byUrl['https://www.solidot.org/index.rss'].category, '技术')
	// xmlUrl 在 text 之前也要能取到名字
	assert.equal(byUrl['https://www.solidot.org/index.rss'].name, 'Solidot')
	// 嵌套一层分类
	assert.equal(byUrl['https://hnrss.org/frontpage'].category, '社区')
	// 顶层（无分类）
	assert.equal(byUrl['https://example.com/rss'].category, undefined)
	assert.equal(byUrl['https://example.com/rss'].name, '裸条目')
})

test('parseOpml：缺 text 时用 host 兜底，缺 xmlUrl 的直接不计入 feeds', () => {
	const xml = `<opml><body>
	  <outline type="rss" xmlUrl="https://news.example.com/feed.xml" />
	  <outline text="只有名字，没有地址" />
	</body></opml>`
	const result = parseOpml(xml)
	assert.equal(result.feeds.length, 1)
	assert.equal(result.feeds[0].name, 'news.example.com', '应回落成 host')
	assert.equal(result.categories, 1)
})

test('parseOpml：非法地址被跳过并计数（不让坏条目污染订阅列表）', () => {
	const xml = `<opml><body>
	  <outline type="rss" text="坏的" xmlUrl="ftp://a.com/feed" />
	  <outline type="rss" text="空的" xmlUrl="   " />
	  <outline type="rss" text="好的" xmlUrl="https://ok.com/feed" />
	</body></opml>`
	const result = parseOpml(xml)
	assert.equal(result.feeds.length, 1)
	assert.equal(result.skipped, 1, 'ftp 那条应计入 skipped')
})

test('parseOpml：空 / 非字符串 / 收藏夹 HTML 都不炸', () => {
	assert.deepEqual(parseOpml('').feeds, [])
	assert.deepEqual(parseOpml('<html><body>这其实是收藏夹</body></html>').feeds, [])
	assert.deepEqual(parseOpml(null).feeds, [])
	assert.deepEqual(parseOpml(undefined).feeds, [])
})

test('parseOpml：CDATA 标题、大小写不一致的标签、单引号属性都能处理', () => {
	const xml = `<OPML><HEAD><TITLE><![CDATA[我的 & 订阅]]></TITLE></HEAD><BODY>
	  <OUTLINE text='Upper' XMLURL='https://upper.com/feed' />
	</BODY></OPML>`
	const result = parseOpml(xml)
	assert.equal(result.title, '我的 & 订阅')
	assert.equal(result.feeds.length, 1)
	assert.equal(result.feeds[0].url, 'https://upper.com/feed')
})

// ---------- 序列化与往返 ----------

test('serializeOpml：按分类分组、特殊字符被转义', () => {
	const xml = serializeOpml({
		feeds: [
			{ name: 'A & B', url: 'https://a.com/feed?x=1&y=2', category: '技术' },
			{ name: '无分类的', url: 'https://b.com/feed' },
		],
		createdAt: '2026-10-12T00:00:00.000Z',
	})
	assert.ok(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>'))
	assert.ok(xml.includes('A &amp; B'))
	assert.ok(xml.includes('x=1&amp;y=2'))
	assert.ok(xml.includes('text="技术"'))
	assert.ok(xml.includes('<opml version="2.0">'))
})

test('serializeOpml → parseOpml 往返后条目等价（导出再导入不该变形）', () => {
	const feeds = [
		{ name: '少数派', url: 'https://sspai.com/feed', category: '技术' },
		{ name: 'A & B <x>', url: 'https://a.com/feed?x=1&y=2' },
		{ name: 'HN', url: 'https://hnrss.org/frontpage', category: '社区' },
	]
	const xml = serializeOpml({ feeds, createdAt: '2026-10-12T00:00:00.000Z' })
	const back = parseOpml(xml)
	assert.equal(back.feeds.length, 3)
	const byUrl = Object.fromEntries(back.feeds.map((f) => [f.url, f]))
	assert.equal(byUrl['https://a.com/feed?x=1&y=2'].name, 'A & B <x>', '实体已还原')
	assert.equal(byUrl['https://a.com/feed?x=1&y=2'].category, undefined)
	assert.equal(byUrl['https://sspai.com/feed'].category, '技术')
	assert.equal(byUrl['https://hnrss.org/frontpage'].category, '社区')
})

// ---------- 合并 ----------

test('mergeFeedSpecs：按 URL 去重，保留已有条目（用户改过的名字更可信）', () => {
	const existing = ['我自己起的名字|https://sspai.com/feed|效率']
	const incoming = [
		{ name: '少数派', url: 'https://sspai.com/feed?utm_source=x', category: '技术' },
		{ name: '新的源', url: 'https://new.com/feed', category: '学术' },
	]
	const result = mergeFeedSpecs(existing, incoming, normalizeUrl)
	assert.equal(result.added, 1, '只有 new.com 是新的')
	assert.equal(result.duplicated, 1)
	assert.equal(result.feeds[0], '我自己起的名字|https://sspai.com/feed|效率', '已有条目必须原样保留')
	assert.equal(result.feeds[1], '新的源|https://new.com/feed|学术')
	assert.deepEqual(result.addedNames, ['新的源'])
})

test('mergeFeedSpecs：reserved（内置源）参与判重，但不被输出', () => {
	const reserved = ['少数派|https://sspai.com/feed|效率']
	const result = mergeFeedSpecs(
		[],
		[
			// 带 utm 的变体也该被判重（规范化后与内置源同一个地址）
			{ name: '少数派', url: 'https://sspai.com/feed?utm_source=reader' },
			{ name: '新的', url: 'https://new.com/feed' },
		],
		normalizeUrl,
		'热点',
		reserved,
	)
	assert.equal(result.added, 1, '只有真正新的那条该被加入')
	assert.equal(result.duplicated, 1)
	assert.equal(result.feeds.length, 1)
	assert.equal(result.feeds[0].startsWith('新的|'), true)
	assert.equal(
		result.feeds.some((f) => f.includes('sspai')),
		false,
		'内置源不该被写进 extraFeeds（它已经在抓了）',
	)
})

test('mergeFeedSpecs：没分类时用默认主题；名字/主题里的 | 被清掉（否则编码会坏）', () => {
	const result = mergeFeedSpecs([], [{ name: 'A|B', url: 'https://a.com/feed' }], normalizeUrl, '热点')
	assert.equal(result.feeds[0], 'A B|https://a.com/feed|热点')
	assert.equal(result.added, 1)
})

test('mergeFeedSpecs：空输入与全是重复时不产生多余条目', () => {
	assert.deepEqual(mergeFeedSpecs([], [], normalizeUrl).feeds, [])
	const dup = mergeFeedSpecs(['X|https://a.com/f|技术'], [{ name: 'Y', url: 'https://a.com/f' }], normalizeUrl)
	assert.equal(dup.added, 0)
	assert.equal(dup.duplicated, 1)
	assert.equal(dup.feeds.length, 1)
})

test('specToFeed / isHttpUrl：编码还原与合法性判断', () => {
	assert.deepEqual(specToFeed('少数派|https://sspai.com/feed|效率'), {
		name: '少数派',
		url: 'https://sspai.com/feed',
		category: '效率',
	})
	assert.equal(specToFeed('坏了|ftp://a.com|技术'), null)
	assert.equal(specToFeed('没有地址'), null)
	assert.equal(isHttpUrl('https://a.com'), true)
	assert.equal(isHttpUrl(' http://a.com/feed '), true)
	assert.equal(isHttpUrl('file:///etc/passwd'), false)
})

// ---------- 集成（真实 DailyService + 真实落盘） ----------

test('集成：importOpml 落进 prefs，exportOpml 能原样读回来', async (t) => {
	const dir = await mkdtemp(path.join(os.tmpdir(), 'dsh-daily-opml-'))
	t.after(() => rm(dir, { recursive: true, force: true }))

	const service = new DailyService(resolveConfig({ dataDir: dir }), {
		info() {},
		warn() {},
		error() {},
	})
	await service.init()

	const first = await service.importOpml(REAL_OPML)
	assert.equal(first.parsed, 4)
	// REAL_OPML 里 4 条里 2 条已被内置源覆盖（少数派 / Solidot），所以只该进来 2 条。
	// 这条断言是在守一个具体行为：**内置源也参与判重**，否则同一份内容会被抓两次。
	assert.equal(first.added, 2, '内置源已覆盖的不该重复加入')
	assert.equal(first.duplicated, 2)
	assert.equal(first.total, 2)

	// 再导一次：全部重复，不该翻倍
	const second = await service.importOpml(REAL_OPML)
	assert.equal(second.added, 0)
	assert.equal(second.duplicated, 4)
	assert.equal(second.total, 2, '重复导入不该增长')

	// 落盘可读
	const raw = JSON.parse(await readFile(path.join(dir, 'prefs.json'), 'utf8'))
	assert.equal(raw.extraFeeds.length, 2)

	// 导出应包含导入的源 + 内置源
	const { xml, count } = await service.exportOpml()
	assert.ok(count >= 4, `导出条数应 ≥4，实际 ${count}`)
	const back = parseOpml(xml)
	const urls = back.feeds.map((f) => f.url)
	for (const feed of back.feeds) {
		assert.ok(isHttpUrl(feed.url))
	}
	assert.ok(urls.includes('https://sspai.com/feed'), '导入的源应出现在导出里')
	assert.ok(
		back.feeds.some((f) => f.url.includes('solidot')),
		'内置源也应被导出（用户能把喜欢的源带回自己的阅读器）',
	)
})

test('集成：importOpml 对垃圾输入不写盘、不抛异常', async (t) => {
	const dir = await mkdtemp(path.join(os.tmpdir(), 'dsh-daily-opml-bad-'))
	t.after(() => rm(dir, { recursive: true, force: true }))

	const service = new DailyService(resolveConfig({ dataDir: dir }), {
		info() {},
		warn() {},
		error() {},
	})
	await service.init()
	const result = await service.importOpml('<html>这不是 OPML</html>')
	assert.equal(result.parsed, 0)
	assert.equal(result.added, 0)
	assert.equal(result.total, 0)
	// 解析不出任何源时**不写盘**：文件不存在也算通过（无变更就不该产生副作用）
	let extra = null
	try {
		extra = JSON.parse(await readFile(path.join(dir, 'prefs.json'), 'utf8')).extraFeeds
	} catch {
		extra = null
	}
	assert.ok(extra === null || extra.length === 0, `不该写入任何源，实际 ${JSON.stringify(extra)}`)
})

test('集成：导入的源真的会被采集器读到（runCollection 的接线）', async () => {
	// 用"指向一个必然连不上的本机地址"来验证接线：不需要真网络，
	// 只要 extra 源的失败信息里出现我们导入的那个名字，就说明它确实被拿去抓了。
	const { runCollection } = await import('../lib/collect/index.js')
	const outcome = await runCollection({
		config: resolveConfig({ requestTimeoutMs: 1500 }),
		sourceIds: ['extra'],
		extraFeeds: ['导入进来的源|http://127.0.0.1:9/never-listen|技术'],
	})
	const extra = outcome.sources.find((s) => s.id === 'extra')
	assert.ok(extra, 'extra 源应出现在结果里')
	assert.equal(extra.ok, false, '连不上的地址应该失败（但整轮不该炸）')
	assert.equal(outcome.items.length, 0)
})

test('集成：listCustomFeeds / removeCustomFeed（侧边栏「订阅管理」用的两个接口）', async (t) => {
	const dir = await mkdtemp(path.join(os.tmpdir(), 'dsh-daily-feeds-'))
	t.after(() => rm(dir, { recursive: true, force: true }))

	const service = new DailyService(resolveConfig({ dataDir: dir }), {
		info() {},
		warn() {},
		error() {},
	})
	await service.init()
	await service.importOpml(REAL_OPML)

	const feeds = await service.listCustomFeeds()
	assert.equal(feeds.length, 2, 'REAL_OPML 里与内置源重叠的应该没进来')
	for (const feed of feeds) {
		assert.ok(feed.name && feed.url && feed.topic, `每条都该有名字/地址/主题：${JSON.stringify(feed)}`)
	}

	// 按**规范化 URL** 删除：带 utm 参数的写法也该命中
	const withUtm = feeds[0].url + '?utm_source=x'
	const removed = await service.removeCustomFeed(withUtm)
	assert.equal(removed.removed, 1, '带 utm 的写法应命中同一条')
	assert.equal(removed.total, feeds.length - 1)

	const after = await service.listCustomFeeds()
	assert.equal(after.length, feeds.length - 1)
	assert.ok(
		!after.some((f) => normalizeUrl(f.url) === normalizeUrl(feeds[0].url)),
		'被删的那条不该还在',
	)

	// 删一个不存在的：不报错、不误删
	const none = await service.removeCustomFeed('https://never-added.example.com/feed')
	assert.equal(none.removed, 0)
	assert.equal((await service.listCustomFeeds()).length, after.length)
})

test('集成：listCustomFeeds 对畸形 spec 容错（跳过没有 URL 的行）', async (t) => {
	const dir = await mkdtemp(path.join(os.tmpdir(), 'dsh-daily-feeds-bad-'))
	t.after(() => rm(dir, { recursive: true, force: true }))

	const service = new DailyService(resolveConfig({ dataDir: dir }), {
		info() {},
		warn() {},
		error() {},
	})
	await service.init()
	await service.store.updatePrefs((current) => ({
		...current,
		extraFeeds: ['没有地址的', '有名字|https://ok.com/feed', '||', '没有主题|https://b.com/feed|'],
	}))
	const feeds = await service.listCustomFeeds()
	assert.equal(feeds.length, 2, '只有带 URL 的两条有效')
	assert.equal(feeds[0].topic, '热点', '没写主题时回落成热点')
	assert.equal(feeds[0].name, '有名字')
})

test('集成：daily_opml 的工具路径（写文件后导入）', async (t) => {
	const dir = await mkdtemp(path.join(os.tmpdir(), 'dsh-daily-opml-file-'))
	t.after(() => rm(dir, { recursive: true, force: true }))

	const service = new DailyService(resolveConfig({ dataDir: dir }), {
		info() {},
		warn() {},
		error() {},
	})
	await service.init()

	const file = path.join(dir, 'subs.opml')
	await writeFile(file, REAL_OPML, 'utf8')
	const result = await service.importOpml(await readFile(file, 'utf8'))
	assert.equal(result.parsed, 4)
	assert.equal(result.added, 2, '与内置源重叠的两条被跳过')

	// 导出到文件
	const out = path.join(dir, 'export.opml')
	const { xml, count } = await service.exportOpml()
	await writeFile(out, xml, 'utf8')
	const text = await readFile(out, 'utf8')
	assert.ok(text.includes('<opml version="2.0">'))
	assert.equal(parseOpml(text).feeds.length, count)

	void localDate
})
