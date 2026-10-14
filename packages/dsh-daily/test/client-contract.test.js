/**
 * 客户端契约自检（静态）。
 *
 * 起因：本轮在页面上用 `API.opml` / `API.feeds` 去取数据，但**忘了把它们加进路径表**。
 * 后果不是报错，而是 fetch 了一个 `undefined` —— 界面上的表现是"点了按钮转一下就没了"，
 * 既没有异常也没有日志，肉眼极难定位。
 *
 * 这类"字符串键名写错/漏加"的问题，静态检查一秒就能抓到，所以固化成测试。
 * 同一份检查还顺手守住另外两件事：
 * - DELETE/未知 action 之类的后端契约变化不会静默漏改前端
 * - 页面对后端返回的条目字段如果用了白名单映射，新增字段要能对上（历史踩过 aiSummary）
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

async function readClient() {
	return readFile(path.join(root, 'web', 'app.js'), 'utf8')
}

test('客户端契约：每个 API.<key> 引用都在路径表里有定义', async () => {
	const source = await readClient()

	const tableMatch = /var API = \{([\s\S]*?)\n {2}\};/.exec(source)
	assert.ok(tableMatch, '找不到 API 路径表（改了结构就要同步改这条测试）')

	const defined = new Set(
		[...tableMatch[1].matchAll(/(\w+)\s*:\s*'\.\/api\//g)].map((m) => m[1]),
	)
	const used = new Set([...source.matchAll(/API\.(\w+)/g)].map((m) => m[1]))

	const missing = [...used].filter((key) => !defined.has(key)).sort()
	assert.deepEqual(
		missing,
		[],
		`这些键被引用了但没在 API 表里定义（会 fetch undefined）：${missing.join(', ')}`,
	)

	// 反向：表里定义了却没人用 → 通常是改名后的残留，也提醒一下（不作为失败）
	const unused = [...defined].filter((key) => !used.has(key)).sort()
	if (unused.length > 0) {
		console.log(`[client-contract] 提示：路径表里这些键没被引用：${unused.join(', ')}`)
	}
})

test('客户端契约：路径表里的每个 URL 都能在后端路由里找到对应分支', async () => {
	const source = await readClient()
	const tableMatch = /var API = \{([\s\S]*?)\n {2}\};/.exec(source)
	const routes = [...tableMatch[1].matchAll(/'\.\/api\/([\w-]+)'/g)].map((m) => m[1])

	const apiSource = await readFile(path.join(root, 'src', 'api.ts'), 'utf8')
	const missing = routes.filter((route) => !new RegExp(`case '${route}':`).test(apiSource))
	assert.deepEqual(missing, [], `后端 src/api.ts 里没有这些路由分支：${missing.join(', ')}`)
})

test('客户端契约：条目字段白名单覆盖后端会返回的字段', async () => {
	const source = await readClient()
	// normalizeItem 是"字段白名单"：后端加了字段而这里忘了加，数据会在这一层被静默丢掉。
	// 历史上 aiSummary 就是这么丢的，所以把它固化成断言。
	const fnMatch = /function normalizeItem\(raw\) \{([\s\S]*?)\n {2}\}/.exec(source)
	assert.ok(fnMatch, '找不到 normalizeItem')

	for (const field of ['aiSummary', 'discussUrl', 'summary', 'thumb', 'duration']) {
		assert.ok(
			new RegExp(`\\b${field}\\s*:`).test(fnMatch[1]),
			`normalizeItem 没有映射 \`${field}\` —— 后端返回的该字段会在客户端被丢掉`,
		)
	}
})

test('客户端契约：弹层里的元素 id 都真实存在于 index.html', async () => {
	const source = await readClient()
	const html = await readFile(path.join(root, 'web', 'index.html'), 'utf8')

	// el.xxx = $('dd-...') 里引用的 id，必须能在 HTML 里找到
	const ids = [...source.matchAll(/el\.\w+ = \$\('([\w-]+)'\)/g)].map((m) => m[1])
	assert.ok(ids.length > 10, `解析到的 id 太少（${ids.length}），检查正则是否失效`)

	const missing = ids.filter((id) => !html.includes(`id="${id}"`))
	assert.deepEqual(missing, [], `这些 id 在 index.html 里不存在：${missing.join(', ')}`)
})

test('客户端契约：打开外链的消息协议两侧一致（页面发起 + 客户端半体回执）', async () => {
	const page = await readClient()
	const half = await readFile(path.join(root, 'src', 'client.js'), 'utf8')

	// 页面发起
	assert.ok(page.includes("type: 'dsh-daily-open'"), '页面应发出 dsh-daily-open')
	// 客户端半体监听并回执
	assert.ok(half.includes('"dsh-daily-open"'), '客户端半体应监听 dsh-daily-open')
	assert.ok(half.includes('dsh-daily-open-ok'), '客户端半体应回执成功')
	assert.ok(half.includes('dsh-daily-open-failed'), '客户端半体应回执失败')
	// 页面处理回执（失败时必须给用户兜底提示，不能是"死点击"）
	assert.ok(page.includes("dsh-daily-open-failed"), '页面应处理失败回执')
	assert.ok(page.includes('showOpenFallback'), '页面必须有兜底提示')
	// 协议类型写死成字面量，改名就会有一侧失效 —— 用交叉断言钉住
	const pageTypes = [...page.matchAll(/dsh-daily-open[a-z-]*/g)].map((m) => m[0])
	const halfTypes = [...half.matchAll(/dsh-daily-open[a-z-]*/g)].map((m) => m[0])
	assert.deepEqual(
		[...new Set(pageTypes)].sort(),
		[...new Set(halfTypes)].sort(),
		'两侧用到的消息类型必须完全一致',
	)
})

test('客户端契约：整卡覆盖链接必须真的绝对定位（否则"点卡片不跳转"）', async () => {
	const css = await readFile(path.join(root, 'web', 'style.css'), 'utf8')
	const block = /\.dd-item-link\s*\{([^}]*)\}/.exec(css)
	assert.ok(block, '找不到 .dd-item-link 规则')
	assert.match(block[1], /position:\s*absolute/, '.dd-item-link 必须 absolute（覆盖整卡）')
	assert.match(block[1], /inset:\s*0/, '.dd-item-link 必须 inset:0（铺满卡片）')
	assert.match(block[1], /z-index:\s*1/, '覆盖层需要 z-index:1')

	// 覆盖层之上的交互控件必须显式抬层，否则 👍/展开 会被覆盖层吃掉点击
	const layered = /\.dd-act,[\s\S]{0,120}\.dd-summary-toggle,[\s\S]{0,120}\.dd-meta-discuss\s*\{([^}]*)\}/.exec(css)
	assert.ok(layered, '找不到"交互控件抬层"的规则')
	assert.match(layered[1], /position:\s*relative/, '交互控件需要 position:relative')
	assert.match(layered[1], /z-index:\s*2/, '交互控件需要 z-index:2（高于覆盖层）')

	// 卡片自身必须建立定位上下文，否则覆盖层会相对外层定位（可能盖住整页）
	const item = /\.dd-item\s*\{([^}]*)\}/.exec(css)
	assert.ok(item, '找不到 .dd-item 规则')
	assert.match(item[1], /position:\s*relative/, '.dd-item 必须 relative（给覆盖层当定位父级）')
})

test('客户端契约：每个 el.X.addEventListener 绑定都必须有守卫（R67 的真实故障）', async () => {
	// R67 实况：HTML 里删掉了「调教」表单，而 JS 里那行绑定没有守卫 →
	// 它在 bindEvents() 中途抛出 → 后面所有绑定（含视图切换）全部失效 →
	// 症状是"页面能打开、tab 也在，但点调研没反应、tag 不加载"，且不报任何错。
	// 这类问题靠"id 是否存在"的检查抓不到（那只覆盖查找），所以单独加一条。
	const lines = (await readClient()).split('\n')
	const unguarded = []
	lines.forEach((line, index) => {
		const dot = line.indexOf('.addEventListener')
		if (dot < 0) return
		const elAt = line.lastIndexOf('el.', dot)
		if (elAt < 0) return
		const rest = line.slice(elAt + 3, dot)
		if (!/^[A-Za-z_$][\w$]*$/.test(rest)) return
		const name = 'el.' + rest
		const nearby = lines.slice(Math.max(0, index - 5), index + 1).join('\n')
		const guarded = nearby.includes('if (' + name + ')') || line.includes(name + ' &&')
		if (!guarded) unguarded.push((index + 1) + ': ' + line.trim().slice(0, 70))
	})
	assert.deepEqual(
		unguarded,
		[],
		'这些绑定没有守卫：元素不存在时会中断 bindEvents()，导致后续所有绑定静默失效\n' + unguarded.join('\n'),
	)
})

test('客户端契约：renderResearch 必须**先 clear 再 appendBriefSummary**（R73 的回归）', async () => {
	// R73 实况：我把简报的渲染插在 clear(el.research) 之前 → 刚 append 就被清掉 →
	// 表现是"函数跑完、日志正常、DOM 里什么都没有"。我为此连猜三轮（缓存 → 竞态 → …）。
	// 这类**顺序**错误静态检查一秒就能抓到，所以固化成测试。
	const source = await readClient()
	const start = source.indexOf('function renderResearch(data)')
	assert.ok(start > 0, '找不到 renderResearch（改名要同步改这条测试）')
	const body = source.slice(start, source.indexOf('\n  }', start))
	const clearAt = body.indexOf('clear(el.research)')
	const briefAt = body.indexOf('appendBriefSummary(el.research')
	assert.ok(clearAt >= 0, 'renderResearch 里应当有 clear(el.research)')
	assert.ok(briefAt >= 0, 'renderResearch 里应当调用 appendBriefSummary')
	assert.ok(
		clearAt < briefAt,
		`顺序必须是「先 clear 再 append」：clear@${clearAt} · append@${briefAt} —— 反过来会把简报立刻清掉`,
	)
})

test('客户端契约：自诊断埋点不能消失（window.__ddDebug）', async () => {
	// 客户端此前"不报错、界面也不显示"，出问题时只能靠猜（R73 连猜三轮）。
	// 这个缓冲区是那一层的唯一入口，所以守一条：它必须还在，且关键点仍然埋着。
	const source = await readClient()
	assert.ok(source.includes('window.__ddDebug'), '自诊断缓冲区必须存在（出问题时唯一的读数入口）')
	for (const step of ['loadResearch:raw', 'loadResearch:state.brief', 'renderResearch', 'appendBriefSummary']) {
		assert.ok(source.includes(step), `自诊断埋点「${step}」不见了 —— 这一层一旦关掉，客户端问题又只能靠猜`)
	}
})
