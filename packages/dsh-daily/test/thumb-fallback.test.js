/**
 * 封面降级契约（静态检查 `web/app.js`）。
 *
 * 背景：本机（以及多台机器）**访问不到 YouTube 封面**（`i.ytimg.com` 实测 timeout），
 * 而真实数据里就有 8 条 YouTube 封面（还有 bilibili / IT之家 / 阮一峰等的封面）。
 * 要求是：**封面取不到时降级成占位块，而不是破图**。
 *
 * 为什么用静态检查：这个行为只在"图片真的失败"时发生，而在共享浏览器里
 * `document.visibilityState === 'hidden'`，懒加载观察器根本不触发 → 图片压根不会插入 DOM。
 * 也就是说**在那个环境里永远测不到失败路径**。所以这里把三条不变量钉死：
 * 1. 占位块**无条件**先放进去（它是常驻底图，不依赖任何网络结果）
 * 2. `<img>` 必须有 `error` 监听器
 * 3. `error` 处理器必须**把 img 撤掉**（只加类名不改可见性是不够的 —— 破图图标仍在）
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'

const root = path.resolve(import.meta.dirname, '..')
const app = readFileSync(path.join(root, 'web/app.js'), 'utf8')

test('封面契约 1：占位块必须无条件先放进卡片（它是常驻底图）', () => {
	// 找到缩略图构造处
	const start = app.indexOf("var wrap = text('div', 'dd-thumb')")
	assert.ok(start >= 0, '找不到缩略图构造代码')
	const region = app.slice(start, start + 2600)
	assert.match(region, /thumbFallback\(\)/, '应当先构造占位块')
	// 占位块必须在"是否启用懒加载"的分支**之外**被 append（否则隐藏环境下就没有底图了）
	const appendIdx = region.indexOf('wrap.appendChild(fallback)')
	const observerIdx = region.search(/IntersectionObserver/)
	assert.ok(appendIdx >= 0, '占位块必须被 append')
	if (observerIdx >= 0) {
		assert.ok(appendIdx < observerIdx, '占位块要在懒加载逻辑之前就放好（不依赖任何网络结果）')
	}
})

test('封面契约 2 & 3：img 必须有 error 监听器，且处理器要把 img 撤掉', () => {
	const region = app.slice(app.indexOf("var wrap = text('div', 'dd-thumb')"))
	assert.match(region, /addEventListener\(\s*['"]error['"]/, 'img 必须有 error 监听器')
	// 处理器里必须真的移除节点（remove/removeChild），只加类名不够
	const errorIdx = region.search(/addEventListener\(\s*['"]error['"]/)
	const after = region.slice(errorIdx, errorIdx + 500)
	assert.match(after, /remove\(\)|removeChild\(/, 'error 处理器必须把 img 从 DOM 里撤掉，否则破图图标会留在占位块上')
})

test('封面契约 4：封面地址要过 safeUrl（别把任意 URL 塞进 img/src）', () => {
	assert.match(app, /var url = safeUrl\(it\.thumb\)/, '封面地址应经 safeUrl 过滤')
	assert.match(app, /function safeUrl\([\s\S]{0,240}https\?:/, 'safeUrl 应当只放行 http(s) 协议')
})
