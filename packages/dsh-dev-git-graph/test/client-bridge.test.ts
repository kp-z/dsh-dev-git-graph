/**
 * diff 桥的契约测试：iframe -> 父页(client.js) -> better-sidebar 原生 DiffTab。
 *
 * 存在的理由（用户报的真实故障）：点文件只弹「Unable to View Diff」，没有任何页签。
 * 根因是桥的注册方式 —— 旧实现用 `bridgeRef` 守卫 + `[onOpenDiff]` 依赖，而
 * better-sidebar **每次渲染都传入新的内联 onOpenDiff**（client-registry.js 里
 * `<ChangesTab onOpenDiff={...} />` 之类的内联箭头），于是依赖变化 -> cleanup 摘掉
 * 监听器 -> effect 重跑又被守卫提前 return -> 监听器再也挂不回去，iframe 永远等不到
 * ack，3s 后超时弹窗。
 *
 * 所以这里用假 React 驱动「渲染 -> 重渲染（换 onOpenDiff 身份）」并断言监听器仍在、
 * 且用的是**最新**回调；旧实现会在这一步直接红。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'

const REPO = '/Users/kp/dev/repo'

/* ---------------- 假 React：只实现本插件用到的 useRef/useEffect/createElement ---------------- */
function createReactStub() {
	const slots: any[] = []
	let cursor = 0
	let pending: any[] = []
	const React = {
		createElement(type: unknown, props?: unknown) { return { type, props } },
		useRef(initial?: unknown) {
			const index = cursor++
			if (!slots[index]) slots[index] = { value: initial === undefined ? null : initial }
			return slots[index]
		},
		useEffect(fn: () => unknown, deps?: unknown[]) {
			const index = cursor++
			const prev = slots[index]
			const changed = !prev || !deps || !prev.deps
				|| deps.length !== prev.deps.length
				|| deps.some((dep, i) => dep !== prev.deps[i])
			slots[index] = { deps, cleanup: prev ? prev.cleanup : null }
			if (changed) pending.push({ slot: slots[index], fn, prev })
		},
		useState(initial?: unknown) {
			const index = cursor++
			if (!slots[index]) slots[index] = { value: initial }
			return [slots[index].value, (value: unknown) => { slots[index].value = value }]
		},
	}
	return {
		React,
		render(fn: (props: any) => unknown, props: any) { cursor = 0; pending = []; return fn(props) },
		/** 跑掉本次渲染排队的 effect（React 的 commit 阶段等价物）。 */
		flush() {
			for (const item of pending) {
				if (item.prev && typeof item.prev.cleanup === 'function') item.prev.cleanup()
				const cleanup = item.fn()
				item.slot.cleanup = typeof cleanup === 'function' ? cleanup : null
			}
			pending = []
		},
		unmountAll() {
			for (const slot of slots) {
				if (slot && typeof slot.cleanup === 'function') slot.cleanup()
				if (slot) slot.cleanup = null
			}
		},
	}
}

/* ---------------- 假 window：记录监听器，可派发消息 ---------------- */
function createWindow() {
	const listeners: any[] = []
	return {
		location: { origin: 'http://127.0.0.1:43120' },
		listeners,
		addEventListener(type: string, fn: any) { if (type === 'message') listeners.push(fn) },
		removeEventListener(type: string, fn: any) {
			if (type !== 'message') return
			const index = listeners.indexOf(fn)
			if (index !== -1) listeners.splice(index, 1)
		},
		/** 派发一条来自 iframe 的消息；返回该 iframe 收到的回执类型。 */
		dispatchFrom(data: unknown) {
			const received: string[] = []
			const source = { postMessage: (msg: any) => { received.push(msg && msg.type) } }
			for (const fn of listeners.slice()) fn({ data, source })
			return received
		},
	}
}

/* ---------------- 加载 client.js 并取出 better-sidebar tab 描述符 ---------------- */
function loadPlugin() {
	const source = readFileSync(new URL('../src/client.js', import.meta.url), 'utf8')
	let definition: any
	const win = createWindow()
	const styleEl: any = {}
	const sandbox: any = {
		window: Object.assign(win, {
			__ModuleLoader__: { load(value: any) { definition = value } },
		}),
		document: {
			getElementById: () => null,
			createElement: () => styleEl,
			head: { appendChild() {} },
			body: {},
			querySelectorAll: () => [],
		},
		MutationObserver: function MutationObserver() { return { observe() {}, disconnect() {} } },
	}
	vm.runInNewContext(source, sandbox)

	const reactStub = createReactStub()
	const plugin = definition.factory((id: string) => {
		if (id === 'react') return reactStub.React
		throw new Error('unexpected require: ' + id)
	})

	let descriptor: any
	const registrations: any[] = []
	const ctx: any = {
		slots: {
			inject(name: string, fn: any) { registrations.push({ name, fn }) },
		},
		betterSidebar: {
			registerTab(value: any) { descriptor = value; return () => { descriptor = undefined } },
		},
		effect() { /* 无需在测试里执行 dispose */ },
	}
	plugin.apply(ctx)

	// apply() 自己也挂了一个 message 监听（iframe 启动时的主题请求），
	// 所以下面一律用「基线 + 1」来断言 diff 桥的监听器数量。
	return { plugin, descriptor, reactStub, win, registrations, baseListeners: win.listeners.length }
}

const WORKTREE_DIFF = { kind: 'worktree', path: 'src/a.ts', staged: false, untracked: false, repoRoot: REPO }
const WORKTREE_TAB = { id: 'diff:w:' + encodeURIComponent(REPO) + ':u:src/a.ts', title: 'a.ts' }
const OPEN_MESSAGE = { type: 'dsh-dev-gg-open-diff', host: 'better-sidebar', diff: WORKTREE_DIFF, tab: WORKTREE_TAB }

/**
 * client.js 跑在 vm 的另一个 realm 里，跨 realm 的对象原型不同，
 * deepStrictEqual 会因为原型不等而报「看起来一模一样」的失败 ——
 * 先过一遍 JSON 拍平成当前 realm 的纯对象。
 */
function plain(value: any) { return JSON.parse(JSON.stringify(value)) }

/* ---------------- 用例 ---------------- */

test('side bar tab 注册成功，并暴露供测试的桥内部件', () => {
	const { plugin, descriptor } = loadPlugin()
	assert.equal(descriptor.id, 'dev-git-graph')
	assert.equal(typeof descriptor.component, 'function')
	assert.equal(typeof plugin.__internal.attachDiffBridge, 'function')
	assert.equal(typeof plugin.__internal.diffTabIdOf, 'function')
})

test('重渲染（onOpenDiff 换新身份）后监听器仍在，且用最新回调打开原生 DiffTab（R2 回归护栏）', () => {
	const { descriptor, reactStub, win, baseListeners } = loadPlugin()
	const opened: any[] = []
	const first = (tab: any) => opened.push({ which: 'first', tab })
	const second = (tab: any) => opened.push({ which: 'second', tab })

	reactStub.render(descriptor.component, { scope: { repoRoot: REPO }, onOpenDiff: first })
	reactStub.flush()
	assert.equal(win.listeners.length, baseListeners + 1, '挂载后应多出 1 个 diff 桥监听器')

	// better-sidebar 每次渲染都传新的内联箭头：这里模拟重渲染
	reactStub.render(descriptor.component, { scope: { repoRoot: REPO }, onOpenDiff: second })
	reactStub.flush()
	assert.equal(win.listeners.length, baseListeners + 1, '重渲染不得摘掉监听器（旧实现在此变回基线）')

	const acks = win.dispatchFrom(OPEN_MESSAGE)
	assert.deepEqual(acks, ['dsh-dev-gg-bs-diff-ack'], '必须给 iframe 回 ack')
	assert.equal(opened.length, 1, '重渲染后消息仍要被处理（旧实现在此变成 0）')
	assert.equal(opened[0].which, 'second', '必须调用最新的 onOpenDiff')
	assert.deepEqual(plain(opened[0].tab), { id: WORKTREE_TAB.id, type: 'diff', title: 'a.ts', diff: WORKTREE_DIFF })
})

test('宿主没给 tab 种子时回退到与 diffTabOf 同构的 id/标题', () => {
	const { descriptor, reactStub, win } = loadPlugin()
	const opened: any[] = []
	reactStub.render(descriptor.component, { scope: { repoRoot: REPO }, onOpenDiff: (tab: any) => opened.push(tab) })
	reactStub.flush()

	win.dispatchFrom({ type: 'dsh-dev-gg-open-diff', host: 'better-sidebar', diff: { ...WORKTREE_DIFF, path: 'src/deep/b.ts' } })
	assert.equal(opened[0].id, 'diff:w:' + encodeURIComponent(REPO) + ':u:src/deep/b.ts')
	assert.equal(opened[0].title, 'b.ts')

	const hashFull = 'c50e4a501b3d3c1c9a0f2e5d4b7a8c9d0e1f2a3b'
	win.dispatchFrom({
		type: 'dsh-dev-gg-open-diff', host: 'better-sidebar',
		diff: { kind: 'commit', hash: 'c50e4a50', hashFull, subject: 'fix: x', repoRoot: REPO },
	})
	assert.equal(opened[1].id, 'diff:c:' + encodeURIComponent(REPO) + ':' + hashFull)
	assert.equal(opened[1].title, 'c50e4a50 fix: x')
})

test('缺 better-sidebar（无 onOpenDiff）/ 未知宿主 / 非法载荷 -> 回 unavailable 且不打开页签', () => {
	const { descriptor, reactStub, win } = loadPlugin()
	const opened: any[] = []
	reactStub.render(descriptor.component, { scope: { repoRoot: REPO }, onOpenDiff: (tab: any) => opened.push(tab) })
	reactStub.flush()

	assert.deepEqual(win.dispatchFrom({ ...OPEN_MESSAGE, host: 'unknown-host' }), ['dsh-dev-gg-bs-diff-unavailable'])
	assert.deepEqual(win.dispatchFrom({ ...OPEN_MESSAGE, diff: { kind: 'nope' } }), ['dsh-dev-gg-bs-diff-unavailable'])
	assert.deepEqual(win.dispatchFrom({ ...OPEN_MESSAGE, diff: undefined }), ['dsh-dev-gg-bs-diff-unavailable'])
	assert.deepEqual(win.dispatchFrom({ type: 'other-event' }), [], '无关消息不回应')
	assert.equal(opened.length, 0)

	// 无 onOpenDiff（未装 better-sidebar / 非 sidebar tab 上下文）
	reactStub.render(descriptor.component, { scope: { repoRoot: REPO } })
	reactStub.flush()
	assert.deepEqual(win.dispatchFrom(OPEN_MESSAGE), ['dsh-dev-gg-bs-diff-unavailable'])
})

test('onOpenDiff 抛错 -> 回 unavailable（不让 iframe 干等到 3s 超时）', () => {
	const { descriptor, reactStub, win } = loadPlugin()
	reactStub.render(descriptor.component, {
		scope: { repoRoot: REPO },
		onOpenDiff: () => { throw new Error('provider blew up') },
	})
	reactStub.flush()
	assert.deepEqual(win.dispatchFrom(OPEN_MESSAGE), ['dsh-dev-gg-bs-diff-unavailable'])
})

test('卸载后监听器摘除', () => {
	const { descriptor, reactStub, win, baseListeners } = loadPlugin()
	reactStub.render(descriptor.component, { scope: { repoRoot: REPO }, onOpenDiff: () => {} })
	reactStub.flush()
	assert.equal(win.listeners.length, baseListeners + 1)
	reactStub.unmountAll()
	assert.equal(win.listeners.length, baseListeners)
})