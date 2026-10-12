/**
 * 宿主半体的**加载期安全契约**测试（静态检查 `src/index.ts`）。
 *
 * 为什么需要它：本插件在**加载期**抛异常不是"功能少了"，而是**插件条目加载失败**。
 * 客户端半体已经因此把用户的界面打成错误页一次（见 test/client-safety.test.js）。
 * 宿主半体的风险小得多（同步体很薄、`resolveConfig` 是纯默认值填充不会抛），
 * 但"风险小"不是结构保证 —— 这里要的是**结构保证**：
 *
 * 1. `apply` 必须整体包 try/catch —— 加载期失败只能降级，不能炸宿主
 * 2. `bootstrap` 必须整体包 try/catch —— 否则会变成一行 unhandled rejection，
 *    日志里看不出"少接了什么"
 * 3. 每个接线步骤必须在 try 块内 —— 一段失败不该让**后面几段**跟着不接
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'

const root = path.resolve(import.meta.dirname, '..')
const src = readFileSync(path.join(root, 'src/index.ts'), 'utf8')

/** 所有 `try { ... }` 的字符区间（大括号配对）。 */
function trySpans(text) {
	const spans = []
	for (const m of text.matchAll(/\btry\s*\{/g)) {
		const open = text.indexOf('{', m.index)
		let depth = 0
		for (let j = open; j < text.length; j++) {
			if (text[j] === '{') depth++
			else if (text[j] === '}') {
				depth--
				if (depth === 0) {
					spans.push([open, j])
					break
				}
			}
		}
	}
	return spans
}

const insideAny = (spans, idx) => spans.some(([a, b]) => idx > a && idx < b)

/** 去掉注释与多余空白：注释不该影响"第一件事是不是 try"的判断。 */
function stripComments(text) {
	return text
		.replace(/\/\*[\s\S]*?\*\//g, '')
		.replace(/(^|[^:])\/\/[^\n]*/g, '$1')
}


/** 取出某个函数（按 `function <name>(` 定位）的函数体。 */
function bodyOf(name, text = src) {
	const start = text.indexOf(`function ${name}(`)
	assert.ok(start >= 0, `找不到 function ${name}`)
	// 先跳过参数表：TS 签名里可能出现 `= {}` 这样的默认值，
	// 那个 `{` 不是函数体开头（写错过一次，导致取到的是 "{}"）
	let i = text.indexOf('(', start)
	let paren = 0
	for (; i < text.length; i++) {
		if (text[i] === '(') paren++
		else if (text[i] === ')') {
			paren--
			if (paren === 0) { i++; break }
		}
	}
	const open = text.indexOf('{', i)
	let depth = 0
	for (let j = open; j < text.length; j++) {
		if (text[j] === '{') depth++
		else if (text[j] === '}') {
			depth--
			if (depth === 0) return text.slice(open, j + 1)
		}
	}
	throw new Error(`function ${name} 没有闭合`)
}

test('宿主契约 1：apply 必须整体包 try/catch（加载期失败不能炸宿主）', () => {
	const body = stripComments(bodyOf('apply'))
	assert.match(body.replace(/^\{\s*/, ''), /^try\s*\{/, 'apply 的第一件事就该是 try（注释不算）')
	// 真正的装配在 applyInner 里 —— 它必须是被 apply 的 try 包着调用的
	assert.match(body, /applyInner\s*\(/, 'apply 应当把装配委托给 applyInner，以便整体兜底')
})

test('宿主契约 2：bootstrap 必须整体包 try/catch（否则只是一行 unhandled rejection）', () => {
	const body = stripComments(bodyOf('bootstrap'))
	assert.match(body.replace(/^\{\s*/, ''), /^try\s*\{/, 'bootstrap 的第一件事就该是 try（注释不算）')
	assert.match(body, /bootstrapInner\s*\(/, 'bootstrap 应当把装配委托给 bootstrapInner')
})

test('宿主契约 3：每个接线步骤都要在 try 块内（一段失败不能拖累后面几段）', () => {
	const spans = trySpans(src)
	assert.ok(spans.length >= 6, `try 块数量偏少（${spans.length}），接线可能没兜底`)
	// 这些是"跑起来才知道会不会抛"的接线动作，逐个确认被 try 包住
	const wiring = [
		'service.init()',
		'mountRoutes(',
		'registerDailyTools(',
		'installPromptSection(',
		'installSchedule(',
		'service.getDay()',
	]
	const unguarded = []
	for (const call of wiring) {
		const idx = src.indexOf(call)
		assert.ok(idx >= 0, `源码里找不到接线动作 ${call}`)
		if (!insideAny(spans, idx)) unguarded.push(call)
	}
	assert.deepEqual(unguarded, [], `这些接线动作没有 try 兜底：${unguarded.join(', ')}`)
})

test('宿主契约 5：可选服务必须用各自 inject 作用域获取（未声明访问会抛）', () => {
	// cordis 里 `ctx.get('sessions')` 在未声明时会抛 —— 客户端半体正是因此把界面打成错误页。
	// 宿主半体读 sessions/workspaceRegistry 做项目自动识别，必须走声明式作用域。
	assert.match(src, /ctx\.inject\(\[serviceName\]/, '可选服务要在自己的 inject 作用域里拿')
	for (const name of ['sessions', 'workspaceRegistry']) {
		assert.ok(src.includes(`'${name}'`), `应当声明并使用 ${name}`)
	}
})

test('宿主契约 4：apply 是同步的，异步初始化必须 fire-and-forget（不能让 loader 卡住）', () => {
	assert.match(src, /export function apply\([\s\S]{0,200}?\): void/, 'apply 的返回类型应是 void')
	assert.ok(!/export function apply[\s\S]{0,400}?await /.test(src), 'apply 里不该 await（会卡住 profile 加载）')
	assert.match(src, /void bootstrap\(/, '异步初始化应当用 void 明确 fire-and-forget')
})
