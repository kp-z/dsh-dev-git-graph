/**
 * 客户端半体的**安全契约**测试（静态检查 `src/client.js`）。
 *
 * 为什么必须用静态检查而不是运行时测试：这个 bug 的失败模式是
 * **`apply()` 抛异常 → 条目 fiber 变 failed → 宿主 boot 挂掉、GUI 变成错误页**。
 * 要复现它需要一个完整的 DSH 宿主 + 一次重启，常规单测做不到；
 * 而且它只在"某个服务此刻不可用/没声明"时才触发，跑一百次单测也可能不出现。
 *
 * 代价是**用户打不开 DSH** ——本插件任何可选能力都不该有这种权力。
 * 所以这里把三条不变量钉死（背景：0.2.2 就是因为漏了第一条 + 第二条，
 * 把用户的界面打成了错误页）：
 *
 * 1. 注册的模块 id 必须等于包名（否则加载器 not-registered → boot 失败）
 * 2. `exports.inject` 必须声明所有被访问的服务（cordis 里访问未声明的服务**会抛**）
 * 3. `apply` 必须整体包一层 try/catch（最后防线：宁可入口不出现，也不能拖垮宿主）
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'

const root = path.resolve(import.meta.dirname, '..')
const src = readFileSync(path.join(root, 'src/client.js'), 'utf8')
const pkg = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'))

/** 取出 `exports.apply = <fn>` 指向的那个函数的函数体。 */
function applyBody() {
	const m = src.match(/exports\.apply\s*=\s*([A-Za-z_$][\w$]*)\s*;/)
	assert.ok(m, '找不到 exports.apply 的赋值')
	const name = m[1]
	const start = src.indexOf(`function ${name}(`)
	assert.ok(start >= 0, `找不到 function ${name}`)
	// 大括号配对
	let i = src.indexOf('{', start)
	let depth = 0
	for (let j = i; j < src.length; j++) {
		if (src[j] === '{') depth++
		else if (src[j] === '}') {
			depth--
			if (depth === 0) return src.slice(i, j + 1)
		}
	}
	throw new Error('函数体没有闭合')
}

/** `exports.inject = [...]` 里的服务名。 */
function declaredInject() {
	const m = src.match(/exports\.inject\s*=\s*(\[[^\]]*\])/)
	assert.ok(m, '找不到 exports.inject')
	return JSON.parse(m[1].replace(/'/g, '"'))
}

test('契约 1：注册的模块 id 必须等于包名', () => {
	const m = src.match(/__ModuleLoader__\.load\(\s*\{[\s\S]{0,300}?id:\s*([^\s,]+)/)
	assert.ok(m, '找不到 __ModuleLoader__.load 的 id')
	const raw = m[1].replace(/["'`]/g, '')
	// 构建时会把它换成真实包名；源码里是占位符，两者都必须等于包名
	const okRaw = raw === '__DSH_PACKAGE_NAME__'
	assert.ok(okRaw, `源码里应当写占位符 __DSH_PACKAGE_NAME__，实际是 ${raw}`)
	const built = src.replaceAll('__DSH_PACKAGE_NAME__', pkg.name)
	const builtId = built.match(/__ModuleLoader__\.load\(\s*\{[\s\S]{0,300}?id:\s*([^\s,]+)/)[1].replace(/["'`]/g, '')
	assert.equal(builtId, pkg.name, '构建后的 id 必须等于 package.json 的 name')
})

test('契约 2：`exports.inject` 必须声明所有被访问的服务（未声明会抛 → boot 挂）', () => {
	const declared = declaredInject()
	assert.ok(Array.isArray(declared) && declared.length > 0, 'inject 不能为空：访问未声明的服务会抛')

	const accessed = new Set()
	// ctx.get("x") / ctx.get('x')
	for (const m of src.matchAll(/ctx\.get\(\s*["']([^"']+)["']\s*\)/g)) accessed.add(m[1])
	// ctx.x（排除 get / effect / logger 这类非服务成员）
	for (const m of src.matchAll(/\bctx\.([A-Za-z_$][\w$]*)/g)) {
		const name = m[1]
		if (['get', 'effect', 'logger', 'on', 'emit', 'set', 'provide'].includes(name)) continue
		accessed.add(name)
	}
	const missing = [...accessed].filter((name) => !declared.includes(name))
	assert.deepEqual(missing, [], `这些服务被访问但没在 exports.inject 里声明：${missing.join(', ')}`)
})

test('契约 3：`apply` 必须整体包一层 try/catch（任何可选能力失败都不能拖垮宿主）', () => {
	const body = applyBody()
	assert.match(body, /try\s*\{/, 'apply 的函数体里必须有顶层 try/catch')
	// 顶层 try：函数体去空白后应以 try 开头
	assert.match(body.replace(/^\{\s*/, ''), /^try\s*\{/, 'apply 的第一件事就该是 try，不允许有没保护的语句跑在前面')
})

test('契约 4：服务取值必须走 safeService（便于逐处兜底 + 统一行为）', () => {
	// 允许两种写法：safeService(ctx, "x") 或包在 try 里
	const directAccess = [...src.matchAll(/ctx\.(slots|betterSidebar)\b/g)]
	assert.equal(directAccess.length, 0, '不该直接 ctx.<服务> 取值，要走 safeService（否则漏一处就挂 boot）')
	assert.match(src, /function safeService\(ctx, name\)/, 'safeService 必须存在')
})

test('契约 5：package.json 的 dsh.client.inject 与 exports.inject 一致', () => {
	const fromPkg = (pkg.dsh?.client?.inject ?? []).slice().sort()
	const fromSrc = declaredInject().slice().sort()
	assert.deepEqual(fromPkg, fromSrc, '两处声明必须一致，否则一处改了另一处忘改')
})
