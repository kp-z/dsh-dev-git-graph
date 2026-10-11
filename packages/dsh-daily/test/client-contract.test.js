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
