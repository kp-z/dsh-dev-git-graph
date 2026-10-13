/**
 * 项目自动识别的回归测试。
 *
 * 这个功能的失败模式不是"报错"，而是**悄悄做错事**：
 * - 把消息正文里出现的某个路径当成项目目录（误报 → 用户的数据被切到别处）
 * - 把用户手动选的项目**覆盖**掉（"我明明切过，又被它自己换回去"）
 * - 把相对路径/"main" 这种值当目录，切到一个不存在的地方
 * 所以测试重点在**误报与越权**，而不是"happy path 能不能跑通"。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import {
	chooseProject,
	collectDirs,
	describeChoice,
	extractProjectDir,
	parseWorkspacePaths,
	looksLikeAbsoluteDir,
} from '../lib/detect.js'
import { DailyService } from '../lib/service.js'
import { resolveConfig } from '../lib/config.js'
import { defaultRegistry, touchProject } from '../lib/project.js'

const SILENT = { info() {}, warn() {}, error() {} }

// ---------- 值判定 ----------

test('looksLikeAbsoluteDir：只认绝对目录，挡掉相对路径/URL/垃圾', () => {
	assert.equal(looksLikeAbsoluteDir('/Users/kp/DEV/app'), true)
	assert.equal(looksLikeAbsoluteDir('C:\\work\\app'), true)
	for (const bad of ['DEV/app', 'main', 'session-abc', '', '   ', 'https://x.com/a', null, 42, {}, '/a'.repeat(400)]) {
		assert.equal(looksLikeAbsoluteDir(bad), false, `${JSON.stringify(bad)} 不该被当成目录`)
	}
})

// ---------- 提取 ----------

test('extractProjectDir：直接字段、嵌套会话头、数组都能探到', () => {
	assert.equal(extractProjectDir({ cwd: '/tmp/proj' })?.dir, '/tmp/proj')
	assert.equal(extractProjectDir({ header: { cwd: '/tmp/proj' } })?.dir, '/tmp/proj')
	assert.equal(extractProjectDir({ session: { header: { cwd: '/tmp/deep' } } })?.dir, '/tmp/deep')
	assert.equal(extractProjectDir([{ cwd: '/tmp/in-array' }])?.dir, '/tmp/in-array')
	// from 要能说清来源（排查时全靠它）
	assert.match(extractProjectDir({ header: { cwd: '/tmp/proj' } })?.from ?? '', /header\.cwd/)
})

test('extractProjectDir：按键名权重取最可信的（cwd > path）', () => {
	const hit = extractProjectDir({ path: '/tmp/less', cwd: '/tmp/more' })
	assert.equal(hit?.dir, '/tmp/more', 'cwd 比 path 可信')
})

test('extractProjectDir：**类实例上的 getter 也要能探到**（Object.entries 看不见原型属性）', () => {
	// 这是"真实宿主里识别失败"最可能的原因：DSH 的 Session/Workspace 是类实例，
	// 数据在私有字段 + 原型 getter 上 —— `Object.entries()` 返回空数组，
	// 于是泛走遍历什么都看不到，而且不报错。必须靠按路径直接取值穿透。
	class FakeSession {
		// **私有字段**：这才是"泛走遍历看不见"的真实形态
		// （用 this._header 是不行的 —— 那是自有可枚举属性，Object.entries 看得见）
		#header
		constructor(cwd) {
			this.#header = { cwd }
		}
		get header() {
			return this.#header
		}
		get id() {
			return 'session-1'
		}
	}
	assert.deepEqual(Object.entries(new FakeSession('/tmp/x')), [], '前提：私有字段 + 原型 getter 对 Object.entries 完全不可见')
	assert.equal(extractProjectDir(new FakeSession('/tmp/real-session'))?.dir, '/tmp/real-session')

	// 直接挂 getter 的对象（非枚举）同样要能拿到
	const withGetter = {}
	Object.defineProperty(withGetter, 'cwd', { get: () => '/tmp/getter-cwd', enumerable: false })
	assert.equal(extractProjectDir(withGetter)?.dir, '/tmp/getter-cwd')
})

test('extractProjectDir：**不把消息正文里的路径当项目**（最常见的误报来源）', () => {
	const likeRealSession = {
		id: 'session-1',
		messages: [{ role: 'user', content: '帮我看下 /Users/kp/DEV/somewhere 这个目录' }],
		content: { text: '路径 /var/log/foo' },
	}
	assert.equal(extractProjectDir(likeRealSession), null, '正文/消息里的路径不该被当成项目目录')
})

test('extractProjectDir：坏输入、循环引用、超深嵌套都不会卡住或抛', () => {
	assert.equal(extractProjectDir(null), null)
	assert.equal(extractProjectDir('字符串'), null)
	assert.equal(extractProjectDir(42), null)
	// 循环引用
	const cyc = { name: 'a' }
	cyc.self = cyc
	assert.doesNotThrow(() => extractProjectDir(cyc))
	// 深度有界：默认上限是 4 层，再深就**不该**被探到（否则一个深层字符串就能把项目带偏）
	// 注：上限从 3 放宽到 4 是为了覆盖真实的会话嵌套（session.header.cwd 之类）
	assert.equal(extractProjectDir({ a: { b: { c: { cwd: '/tmp/ok-deep' } } } })?.dir, '/tmp/ok-deep')
	assert.equal(extractProjectDir({ a: { b: { c: { d: { e: { cwd: '/tmp/too-deep' } } } } } }), null)
	// 节点预算：构造一个超宽的树，不能无限遍历
	const wide = {}
	for (let i = 0; i < 500; i++) wide['k' + i] = { x: i }
	assert.doesNotThrow(() => extractProjectDir(wide))
})

test('extractProjectDir：getter 抛异常也不能把探测搞崩', () => {
	const nasty = {
		get bad() {
			throw new Error('boom')
		},
		cwd: '/tmp/ok',
	}
	assert.doesNotThrow(() => extractProjectDir(nasty))
})

test('collectDirs：保持输入顺序（顺序就是优先级）', () => {
	const out = collectDirs([
		{ value: { cwd: '/tmp/first' }, from: 'prompt' },
		{ value: { cwd: '/tmp/second' }, from: 'sessions' },
	])
	assert.deepEqual(out.map((d) => d.dir), ['/tmp/first', '/tmp/second'])
})

// ---------- 选择 ----------

test('chooseProject：**手动指定时绝不覆盖**（显式优先于推断）', () => {
	const result = chooseProject({
		current: '/tmp/current',
		manual: true,
		candidates: [{ dir: '/tmp/other', from: 'prompt', weight: 100 }],
		usable: () => true,
	})
	assert.equal(result, null, '用户手动选过的项目不该被自动识别顶掉')
})

test('chooseProject：跳过与当前相同的；不可用的候选被跳过', () => {
	const usableSet = new Set(['/tmp/good'])
	const result = chooseProject({
		current: '/tmp/current',
		manual: false,
		candidates: [
			{ dir: '/tmp/current', from: 'a', weight: 100 },
			{ dir: '/tmp/missing', from: 'b', weight: 90 },
			{ dir: '/tmp/good', from: 'c', weight: 80 },
		],
		usable: (dir) => usableSet.has(dir),
	})
	assert.equal(result?.dir, '/tmp/good')
	assert.equal(result?.from, 'c')
})

test('chooseProject：没有可用候选时返回 null（拿不到就不猜）', () => {
	assert.equal(
		chooseProject({ current: '/tmp/a', manual: false, candidates: [], usable: () => true }),
		null,
	)
	assert.equal(
		chooseProject({
			current: '/tmp/a',
			manual: false,
			candidates: [{ dir: '/tmp/b', from: 'x', weight: 1 }],
			usable: () => false,
		}),
		null,
	)
	// usable 自己抛异常也不能让调用方崩
	assert.equal(
		chooseProject({
			current: '/tmp/a',
			manual: false,
			candidates: [{ dir: '/tmp/b', from: 'x', weight: 1 }],
			usable: () => {
				throw new Error('stat 失败')
			},
		}),
		null,
	)
})

test('describeChoice：三种情形都有可读结论', () => {
	assert.match(describeChoice(null, true), /手动/)
	assert.match(describeChoice(null, false), /没有找到可用/)
	assert.match(describeChoice({ dir: '/tmp/x', from: 'prompt.cwd' }, false), /prompt\.cwd/)
})

// ---------- 注册表 ----------

test('注册表：source 字段可持久化、坏值回落 auto', () => {
	const root = '/tmp/root'
	const manual = touchProject(defaultRegistry(), root, '/tmp/p1', new Date('2026-10-12T00:00:00Z'), 'manual')
	assert.equal(manual.source, 'manual')
	const auto = touchProject(manual, root, '/tmp/p2', new Date('2026-10-12T01:00:00Z'), 'auto')
	assert.equal(auto.source, 'auto')
	// 不传则沿用上一次
	assert.equal(touchProject(manual, root, '/tmp/p3').source, 'manual')
})

// ---------- 服务集成 ----------

async function makeService(t) {
	const root = await mkdtemp(path.join(os.tmpdir(), 'dsh-detect-root-'))
	// **让测试环境密闭**：DSH 会给子进程设 DSH_HOME（指向开发机真实的 ~/.dsh），
	// 而磁盘来源（storages/workspace.json）会优先用它 —— 那样单测就会读到开发机
	// 真实的工作区列表，断言"没有候选"直接失败。显式指向空目录，只影响本测试进程。
	const isolatedHome = await mkdtemp(path.join(os.tmpdir(), 'dsh-detect-home-'))
	const savedHome = process.env.DSH_HOME
	process.env.DSH_HOME = isolatedHome
	t.after(async () => {
		if (savedHome === undefined) delete process.env.DSH_HOME
		else process.env.DSH_HOME = savedHome
		await rm(isolatedHome, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 })
	})
	const proj = await mkdtemp(path.join(os.tmpdir(), 'dsh-detect-proj-'))
	const proj2 = await mkdtemp(path.join(os.tmpdir(), 'dsh-detect-proj2-'))
	// maxRetries：异步识别可能仍在写盘，递归删目录偶发 ENOTEMPTY
	t.after(() => Promise.all([root, proj, proj2].map((d) => rm(d, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }))))
	const service = new DailyService(resolveConfig({ dataDir: root }), SILENT)
	await service.init()
	return { service, root, proj, proj2 }
}

test('集成：自动识别能换项目，并把自己标成 auto', async (t) => {
	const { service, proj } = await makeService(t)
	assert.equal(service.currentProject().isDefault, true)
	assert.equal(service.currentProject().source, 'auto', '默认项目就是自动模式')

	const result = await service.autoDetect([{ value: { cwd: proj }, from: 'prompt' }])
	assert.equal(result.changed, true)
	assert.equal(service.currentProject().dir, proj)
	assert.equal(service.currentProject().source, 'auto')
})

test('集成：**手动切换后自动识别不再覆盖**（这是本功能最容易做错的地方）', async (t) => {
	const { service, proj, proj2 } = await makeService(t)
	await service.useProject(proj)          // 用户手动指定
	assert.equal(service.currentProject().source, 'manual')

	const result = await service.autoDetect([{ value: { cwd: proj2 }, from: 'prompt' }])
	assert.equal(result.changed, false, '手动指定时不该被自动识别改掉')
	assert.match(result.reason, /手动/)
	assert.equal(service.currentProject().dir, proj)
})

test('集成：followAuto 把控制权交回自动识别（之后才允许被覆盖）', async (t) => {
	const { service, proj, proj2 } = await makeService(t)
	await service.useProject(proj)
	assert.equal(service.currentProject().source, 'manual')

	// 单测里没有宿主服务，所以这一步"没有候选可识别"是正常的：
	// 它只负责把控制权交回去，真正的识别靠宿主上下文（每轮 prompt 会喂）或后续调用
	const followed = await service.followAuto()
	assert.equal(followed.project.source, 'auto', '交回自动模式')

	// 交回之后，自动识别就允许覆盖了 —— 这才是 follow 的意义
	const after = await service.autoDetect([{ value: { cwd: proj2 }, from: 'prompt' }])
	assert.equal(after.changed, true, '交回自动后应能被识别覆盖')
	assert.equal(service.currentProject().dir, proj2)
})

test('集成：自动识别跨重启保留（manual 不会被重启洗掉）', async (t) => {
	const { service, root, proj, proj2 } = await makeService(t)
	await service.useProject(proj)

	const restarted = new DailyService(resolveConfig({ dataDir: root }), SILENT)
	await restarted.init()
	assert.equal(restarted.currentProject().dir, proj, '重启后仍在手动指定的项目')
	assert.equal(restarted.currentProject().source, 'manual')
	const blocked = await restarted.autoDetect([{ value: { cwd: proj2 }, from: 'prompt' }])
	assert.equal(blocked.changed, false, '重启后自动识别依然不该覆盖手动选择')
})

test('集成：配置关闭自动识别后，一切按手动来', async (t) => {
	const root = await mkdtemp(path.join(os.tmpdir(), 'dsh-detect-off-'))
	const proj = await mkdtemp(path.join(os.tmpdir(), 'dsh-detect-offp-'))
	t.after(() => Promise.all([root, proj].map((d) => rm(d, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }))))
	const service = new DailyService(resolveConfig({ dataDir: root, autoDetectProject: false }), SILENT)
	await service.init()

	const result = await service.autoDetect([{ value: { cwd: proj }, from: 'prompt' }])
	assert.equal(result.changed, false)
	assert.match(result.reason, /autoDetectProject|关闭/)
	assert.equal(service.currentProject().isDefault, true)
})

test('集成：识别到不存在的目录不会切换（拿不到就不猜）', async (t) => {
	const { service } = await makeService(t)
	const before = service.currentProject().dir
	const result = await service.autoDetect([{ value: { cwd: '/tmp/definitely-not-here-' + Date.now() }, from: 'prompt' }])
	assert.equal(result.changed, false)
	assert.equal(service.currentProject().dir, before)
})

test('集成：notePromptContext 有节流，且绝不抛', async (t) => {
	const { service, proj } = await makeService(t)
	// await 是为了让识别跑完 —— 否则它的异步写盘会和测试清理撞上（真踩过：ENOTEMPTY）
	await service.notePromptContext({ cwd: proj })
	assert.equal(service.currentProject().dir, proj, '识别生效')
	// 5 秒内再来一次被节流：不该再动（这里只验它不抛、不阻塞）
	await service.notePromptContext({ cwd: proj })
	await service.notePromptContext(null)
	assert.equal(service.currentProject().dir, proj)
})

test('parseWorkspacePaths：从存盘注册表取**精确路径**（内存会话为空时的唯一来源）', () => {
	// 真实形状：global.workspaceIds 是排序，tables.workspaces.<id>.path 是精确路径
	const raw = {
		unit: { name: 'workspace', version: 2 },
		global: { workspaceIds: ['b', 'a', 'missing'] },
		tables: { workspaces: { a: { path: '/tmp/a' }, b: { path: '/tmp/b' }, c: { path: '/tmp/c' } } },
	}
	assert.deepEqual(parseWorkspacePaths(raw), ['/tmp/b', '/tmp/a', '/tmp/c'], '按 workspaceIds 排序，未列出的补在后面')
	for (const bad of [null, 'x', 42, {}, { tables: {} }, { tables: { workspaces: 'no' } }]) {
		assert.deepEqual(parseWorkspacePaths(bad), [], `${JSON.stringify(bad)} 应返回空数组`)
	}
	// 相对路径/垃圾值要被丢掉（只认绝对目录）
	assert.deepEqual(parseWorkspacePaths({ tables: { workspaces: { x: { path: 'relative/no' }, y: { path: null } } } }), [])
})

test('集成：**没有活动会话时**，靠存盘的工作区注册表也能识别（真实故障的形状）', async (t) => {
	const { service, proj } = await makeService(t)
	// 模拟真实故障：内存 sessions 服务读得到但**是空的**，workspaceRegistry 不可用
	service.attachHost({ sessions: { list: () => [] } })

	// 造一个 DSH 主目录，里面只有存盘的工作区注册表
	const home = await mkdtemp(path.join(os.tmpdir(), 'dsh-home-'))
	const oldHome = process.env.DSH_HOME
	process.env.DSH_HOME = home
	t.after(async () => {
		if (oldHome === undefined) delete process.env.DSH_HOME
		else process.env.DSH_HOME = oldHome
		await rm(home, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 })
	})
	await mkdir(path.join(home, 'storages'), { recursive: true })
	await writeFile(
		path.join(home, 'storages', 'workspace.json'),
		JSON.stringify({ global: { workspaceIds: ['w1'] }, tables: { workspaces: { w1: { path: proj } } } }),
	)

	const result = await service.autoDetect()
	assert.equal(result.changed, true, '内存会话为空时，存盘工作区应当能把识别救回来')
	assert.equal(service.currentProject().dir, proj)
	assert.match(result.from ?? '', /workspace\.json/, '诊断里要写明来自存盘注册表')
	const diag = service.currentProject().detect
	assert.ok(diag.sources.some((x) => x.name === 'storages/workspace.json' && x.ok === true), JSON.stringify(diag.sources))
})

test('集成：**没有任何宿主作用域时**，磁盘来源仍要工作（巡检发现的真 bug）', async (t) => {
	// 曾经 hostCandidates() 在"没有宿主"时提前返回，而磁盘来源的收集写在它后面
	// → dev-server 这类没有 cordis 宿主的环境里那条路**永远跑不到**
	// （真实宿主有 host 所以掩盖了这个设计错误）。磁盘来源本来就不需要宿主。
	const { service, proj } = await makeService(t)
	const home = await mkdtemp(path.join(os.tmpdir(), 'dsh-home-nohost-'))
	const saved = process.env.DSH_HOME
	process.env.DSH_HOME = home
	t.after(async () => {
		if (saved === undefined) delete process.env.DSH_HOME
		else process.env.DSH_HOME = saved
		await rm(home, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 })
	})
	await mkdir(path.join(home, 'storages'), { recursive: true })
	await writeFile(
		path.join(home, 'storages', 'workspace.json'),
		JSON.stringify({ global: { workspaceIds: ['w1'] }, tables: { workspaces: { w1: { path: proj } } } }),
	)

	// 一个宿主都不附着
	const result = await service.autoDetect()
	assert.equal(result.changed, true, '没有宿主时也必须能靠磁盘来源识别')
	assert.equal(service.currentProject().dir, proj)
	const diag = service.currentProject().detect
	assert.equal(diag.hosts, 0, '诊断要如实说明没有宿主')
	assert.ok(diag.sources.some((x) => x.name === 'storages/workspace.json' && x.ok === true), JSON.stringify(diag.sources))
})

test('集成：宿主服务必须在合法作用域里取（未声明会抛 —— 客户端半体就是这么炸的）', async (t) => {
	const { service, proj } = await makeService(t)

	// 1) 模拟 cordis：访问未声明的服务直接抛。此时拿不到候选，但**绝不能崩**
	service.attachHost({
		get() {
			throw new Error('cannot get property "sessions" without inject')
		},
	})
	const blocked = await service.autoDetect()
	assert.equal(blocked.changed, false, '拿不到就不猜')

	// 2) 再加一个"合法作用域"（inject 声明过 → 能直接读到属性），识别应当立刻可用
	service.attachHost({ sessions: { list: () => [{ header: { cwd: proj } }] } })
	const detected = await service.autoDetect()
	assert.equal(detected.changed, true, '合法作用域里的服务必须被用上')
	assert.equal(service.currentProject().dir, proj)
})

test('集成：多个宿主作用域会依次尝试（第一个拿不到就用下一个）', async (t) => {
	const { service, proj } = await makeService(t)
	service.attachHost({ get: () => null })                                   // 拿不到
	service.attachHost({ workspaceRegistry: { list: () => [{ path: proj }] } }) // 这个可以
	const result = await service.autoDetect()
	assert.equal(result.changed, true)
	assert.match(result.from ?? '', /workspaceRegistry/)
})

test('集成：识别失败要留下**可远程读的诊断**（否则故障不可定位）', async (t) => {
	const { service } = await makeService(t)
	const before = service.currentProject().detect
	assert.equal(before, null, '还没识别过时不该有诊断')

	// 场景一：没有任何宿主作用域（inject 没附着上）—— 这是最需要能看出来的情况
	await service.autoDetect()
	const noHost = service.currentProject().detect
	assert.ok(noHost, '失败也必须留下诊断')
	assert.equal(noHost.hosts, 0)
	assert.equal(noHost.candidates, 0)
	assert.equal(noHost.changed, false)
	assert.match(JSON.stringify(noHost.sources), /没有任何宿主作用域附着/)

	// 场景二：有作用域但读不到服务
	service.attachHost({})
	await service.autoDetect()
	const noService = service.currentProject().detect
	assert.equal(noService.hosts, 1)
	assert.equal(noService.candidates, 0)
	assert.ok(noService.sources.some((x) => x.name === 'sessions' && x.ok === false))

	// 场景三：读到了会话但没有可用目录
	const proj2 = await mkdtemp(path.join(os.tmpdir(), 'dsh-detect-diag-'))
	t.after(() => rm(proj2, { recursive: true, force: true }))
	const withSession = new DailyService(resolveConfig({ dataDir: path.dirname(proj2) }), SILENT)
	await withSession.init()
	withSession.attachHost({ sessions: { list: () => [{ header: { cwd: proj2 } }] } })
	await withSession.autoDetect()
	const ok = withSession.currentProject().detect
	assert.equal(ok.candidates, 1, '候选数要能看见')
	assert.equal(ok.changed, true)
	assert.match(ok.sample.join(' '), /header\.cwd/, '样本要说明候选是从哪个路径探到的')
})

test('集成：项目清单里标出 isAuto（界面据此显示"自动"）', async (t) => {
	const { service, proj } = await makeService(t)
	const autoList = await service.listKnownProjects()
	assert.equal(autoList.projects.find((p) => p.isDefault)?.isAuto, true, '默认项目是自动模式')

	await service.useProject(proj)
	const manualList = await service.listKnownProjects()
	const current = manualList.projects.find((p) => p.isCurrent)
	assert.equal(current?.isAuto, false, '手动指定后不该标成自动')
})

test('集成：文件里写坏的 source 不会让插件崩，且按 auto 处理', async (t) => {
	const root = await mkdtemp(path.join(os.tmpdir(), 'dsh-detect-bad-'))
	t.after(() => rm(root, { recursive: true, force: true }))
	await writeFile(path.join(root, 'projects.json'), JSON.stringify({ version: 1, current: null, known: [], source: 'nonsense' }))
	const service = new DailyService(resolveConfig({ dataDir: root }), SILENT)
	await service.init()
	assert.equal(service.currentProject().source, 'auto')
})
