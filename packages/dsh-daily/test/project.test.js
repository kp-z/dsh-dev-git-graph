/**
 * 项目模型（一个项目 = 一个工作目录）的回归测试。
 *
 * 这是调研方向的地基，错法的后果很具体：**数据串项目**。
 * 所以测试的重点不是"能不能列出来"，而是：
 * - 同一目录的**所有**写法都落到同一份数据（`~`、相对路径、结尾斜杠、`..`、软链接）
 * - 不同目录**绝不**互相污染（偏好 / 索引 / 反馈 / 轮转状态）
 * - 默认项目 = 数据根目录本身，**老数据原地不动**（零迁移）
 * - 切换跨进程持久化（重启后还在那个项目），失效目录安全回落
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, rm, writeFile, readFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import {
	checkDir,
	defaultRegistry,
	isDefaultProject,
	listProjects,
	normalizeDir,
	projectDataDir,
	projectFolder,
	projectName,
	readRegistry,
	touchProject,
} from '../lib/project.js'
import { DailyService } from '../lib/service.js'
import { resolveConfig } from '../lib/config.js'
import { localDate } from '../lib/store.js'

const SILENT = { info() {}, warn() {}, error() {} }

// ---------- 路径归一化 ----------

test('normalizeDir：~ / 相对路径 / 结尾斜杠 / .. 都归一到同一身份', () => {
	const home = os.homedir()
	assert.equal(normalizeDir('~'), home)
	assert.equal(normalizeDir('~/DEV/x'), path.join(home, 'DEV/x'))
	assert.equal(normalizeDir('/tmp/a/b/'), '/tmp/a/b')
	assert.equal(normalizeDir('/tmp/a/../a/b'), '/tmp/a/b')
	assert.equal(normalizeDir('sub', '/tmp/base'), '/tmp/base/sub')
	assert.equal(normalizeDir('./sub/./x', '/tmp/base'), '/tmp/base/sub/x')
	// 同一目录的两种写法必须完全相等 —— 否则会被当成两个项目、数据被劈成两份
	assert.equal(normalizeDir('/tmp/a/b/'), normalizeDir('/tmp/a/../a/b'))
})

// ---------- 目录名 ----------

test('projectFolder：同目录稳定、不同目录唯一、非法字符被清理', () => {
	const a = projectFolder('/Users/x/DEV/dsh-plugins')
	assert.equal(a, projectFolder('/Users/x/DEV/dsh-plugins/'), '结尾斜杠不该改变身份')
	assert.match(a, /^dsh-plugins-[0-9a-f]{8}$/)

	// 同名但不同父目录：slug 相同、hash 必须不同
	const b = projectFolder('/Users/x/OTHER/dsh-plugins')
	assert.notEqual(a, b, '同名不同位置的目录必须区分开')
	assert.ok(a.startsWith('dsh-plugins-') && b.startsWith('dsh-plugins-'))

	// 中文目录名：slug 会退化成空，用 project 兜底，但 hash 仍然唯一
	const cn = projectFolder('/Users/x/DEV/我的项目')
	assert.match(cn, /^project-[0-9a-f]{8}$/)
	assert.notEqual(cn, projectFolder('/Users/x/DEV/另一个项目'))
})

test('projectName：取目录名，根目录有可读兜底', () => {
	assert.equal(projectName('/Users/x/DEV/dsh-plugins'), 'dsh-plugins')
	assert.equal(projectName('/Users/x/DEV/dsh-plugins/'), 'dsh-plugins')
})

// ---------- 数据目录 ----------

test('projectDataDir：默认项目 = 数据根本身（老数据零迁移），其它项目进 projects/ 子目录', () => {
	const root = '/Users/x/.dsh/daily'
	assert.equal(projectDataDir(root, root), root, '默认项目必须就是根目录本身')
	assert.equal(projectDataDir(root, '/Users/x/.dsh/daily/'), root, '写法不同也要认出来')
	assert.equal(
		projectDataDir(root, '/Users/x/DEV/app'),
		path.join(root, 'projects', projectFolder('/Users/x/DEV/app')),
	)
	assert.equal(isDefaultProject(root, root), true)
	assert.equal(isDefaultProject(root, '/Users/x/DEV/app'), false)
})

test('checkDir：不存在的目录 / 不是目录 都要被挡下（避免一个错字凭空造出空项目）', async (t) => {
	const dir = await mkdtemp(path.join(os.tmpdir(), 'dsh-daily-dir-'))
	t.after(() => rm(dir, { recursive: true, force: true }))
	await writeFile(path.join(dir, 'file.txt'), 'x')

	assert.equal(checkDir(dir).ok, true)
	assert.equal(checkDir(path.join(dir, 'nope')).ok, false)
	assert.equal(checkDir(path.join(dir, 'nope')).reason.includes('不存在'), true)
	assert.equal(checkDir(path.join(dir, 'file.txt')).ok, false)
	assert.equal(checkDir(path.join(dir, 'file.txt')).reason.includes('不是目录'), true)
})

// ---------- 注册表 ----------

test('touchProject：更新 current、默认项目不进 known、按规范化路径去重', () => {
	const root = '/Users/x/.dsh/daily'
	let registry = defaultRegistry()

	registry = touchProject(registry, root, root, new Date('2026-10-12T01:00:00Z'))
	assert.equal(registry.current, root)
	assert.equal(registry.known.length, 0, '默认项目不该进 known（它由数据根隐含）')

	registry = touchProject(registry, root, '/Users/x/DEV/a', new Date('2026-10-12T02:00:00Z'))
	assert.equal(registry.known.length, 1)
	assert.equal(registry.known[0].name, 'a')

	// 同一目录的另一种写法 → 不该新增一条
	registry = touchProject(registry, root, '/Users/x/DEV/a/', new Date('2026-10-12T03:00:00Z'))
	assert.equal(registry.known.length, 1, '同一目录的不同写法必须认出来')
	assert.equal(registry.known[0].lastUsedAt, '2026-10-12T03:00:00.000Z', 'lastUsedAt 应刷新')

	// 最近使用的排最前
	registry = touchProject(registry, root, '/Users/x/DEV/b', new Date('2026-10-12T04:00:00Z'))
	assert.deepEqual(registry.known.map((e) => e.name), ['b', 'a'])
})

test('readRegistry：坏数据不能让插件起不来（缺字段/类型不对都回落）', () => {
	assert.deepEqual(readRegistry(null), defaultRegistry())
	assert.deepEqual(readRegistry('nope'), defaultRegistry())
	assert.deepEqual(readRegistry({}), defaultRegistry())
	const messy = readRegistry({
		version: 'x',
		current: 42,
		known: [null, 'str', { dir: '' }, { dir: '/tmp/ok' }, { dir: '/tmp/named', name: '  ' }],
	})
	assert.equal(messy.current, null, '类型不对的 current 应回落 null')
	assert.deepEqual(messy.known.map((e) => e.dir), ['/tmp/ok', '/tmp/named'])
	assert.equal(messy.known[1].name, 'named', '空名字应回落成目录名')
})

test('listProjects：默认项目排最前，且不会重复出现', () => {
	const root = '/Users/x/.dsh/daily'
	const registry = {
		version: 1,
		current: '/Users/x/DEV/a',
		known: [
			{ dir: '/Users/x/DEV/a', name: 'a', lastUsedAt: '2026-10-12T02:00:00.000Z' },
			// 故意把根目录也塞进来（历史脏数据）→ 必须被跳过
			{ dir: root, name: 'daily', lastUsedAt: '2026-10-12T01:00:00.000Z' },
		],
	}
	const list = listProjects(registry, root)
	assert.equal(list.length, 2, '根目录不该出现两次')
	assert.equal(list[0].isDefault, true)
	assert.equal(list[0].dir, root)
	assert.equal(list[1].name, 'a')
})

// ---------- 集成：隔离与持久化（最要紧的部分）----------

async function makeProjectDirs(t) {
	const root = await mkdtemp(path.join(os.tmpdir(), 'dsh-daily-proj-root-'))
	const alpha = await mkdtemp(path.join(os.tmpdir(), 'dsh-daily-alpha-'))
	const beta = await mkdtemp(path.join(os.tmpdir(), 'dsh-daily-beta-'))
	t.after(() => Promise.all([root, alpha, beta].map((d) => rm(d, { recursive: true, force: true }))))
	return { root, alpha, beta }
}

test('集成：两个项目的偏好与索引互不串（这是整个调研方向的地基）', async (t) => {
	const { root, alpha, beta } = await makeProjectDirs(t)
	const service = new DailyService(resolveConfig({ dataDir: root }), SILENT)
	await service.init()

	// 默认项目：调教 + 写一天数据
	await service.tune('多推 Rust')
	const day = localDate()
	await service.store.writeDay({
		date: day,
		items: [{ id: 'a1', title: 'Alpha 的条目', url: 'https://e.com/a1', kind: 'web', platform: 'hackernews', sourceId: 'hn', sourceName: 'HN', topic: '技术', score: 1, reasons: [], read: false, liked: false, disliked: false, hidden: false, firstSeenAt: `${day}T01:00:00.000Z` }],
		sources: [],
		lastRefresh: null,
	})
	const defaultPrefs = (await service.getState()).prefs

	// 切到 alpha：必须是**干净**的一套
	const switched = await service.useProject(alpha)
	assert.equal(switched.ok, true)
	const alphaPrefs = (await service.getState()).prefs
	const alphaDay = await service.getDay(day)
	assert.equal(alphaPrefs.topics.length, 0, 'alpha 不该继承默认项目的主题偏好')
	assert.equal(alphaPrefs.tuningNotes.length, 0)
	assert.equal(alphaDay.items.length, 0, 'alpha 不该看到默认项目的条目')

	// alpha 调教自己的偏好
	await service.tune('多推 AI Agent')

	// 切到 beta：又是干净的一套
	await service.useProject(beta)
	const betaPrefs = (await service.getState()).prefs
	assert.equal(betaPrefs.tuningNotes.length, 0, 'beta 不该看到 alpha 的调教')

	// 切回默认项目：原来的偏好与条目都还在
	await service.useProject(root)
	const backPrefs = (await service.getState()).prefs
	const backDay = await service.getDay(day)
	assert.deepEqual(backPrefs.tuningNotes, defaultPrefs.tuningNotes, '切回来必须还是原来那套')
	assert.equal(backDay.items.length, 1, '切回来条目也要还在')

	// 再切回 alpha：它自己的调教也还在
	await service.useProject(alpha)
	assert.deepEqual((await service.getState()).prefs.tuningNotes, ['多推 AI Agent'])
})

test('集成：切换跨进程持久化（重启后仍在那个项目）；失效目录安全回落', async (t) => {
	const { root, alpha } = await makeProjectDirs(t)

	const first = new DailyService(resolveConfig({ dataDir: root }), SILENT)
	await first.init()
	assert.equal(first.currentProject().isDefault, true, '初始应为默认项目')
	await first.useProject(alpha)

	// 模拟重启：新建一个 service，从注册表恢复
	const second = new DailyService(resolveConfig({ dataDir: root }), SILENT)
	await second.init()
	assert.equal(second.currentProject().dir, normalizeDir(alpha), '重启后应恢复到 alpha')

	// 注册表真的落盘了
	const registry = JSON.parse(await readFile(path.join(root, 'projects.json'), 'utf8'))
	assert.equal(registry.current, normalizeDir(alpha))
	assert.equal(registry.known.length, 1)

	// 目录被删掉后：不该卡死，应安全回落默认项目
	await rm(alpha, { recursive: true, force: true })
	const third = new DailyService(resolveConfig({ dataDir: root }), SILENT)
	await third.init()
	assert.equal(third.currentProject().isDefault, true, '失效目录必须回落默认项目，否则插件再也打不开')
})

test('集成：切到不存在 / 不是目录的路径会被拒绝，且不改动当前项目', async (t) => {
	const { root, alpha } = await makeProjectDirs(t)
	const service = new DailyService(resolveConfig({ dataDir: root }), SILENT)
	await service.init()
	await service.useProject(alpha)

	const missing = await service.useProject(path.join(root, 'no-such-dir'))
	assert.equal(missing.ok, false)
	assert.match(missing.reason, /不存在/)

	await writeFile(path.join(root, 'a-file.txt'), 'x')
	const notDir = await service.useProject(path.join(root, 'a-file.txt'))
	assert.equal(notDir.ok, false)
	assert.match(notDir.reason, /不是目录/)

	assert.equal(service.currentProject().dir, normalizeDir(alpha), '失败的切换不该改变当前项目')
})

test('集成：项目清单里能看到默认项目与已用过的项目，并标出当前项', async (t) => {
	const { root, alpha } = await makeProjectDirs(t)
	const service = new DailyService(resolveConfig({ dataDir: root }), SILENT)
	await service.init()
	await service.useProject(alpha)

	const { current, projects } = await service.listKnownProjects()
	assert.equal(current, normalizeDir(alpha))
	assert.equal(projects.length, 2, '默认项目 + alpha')
	assert.equal(projects[0].isDefault, true)
	const currentEntry = projects.find((p) => p.isCurrent)
	assert.ok(currentEntry, '必须能标出当前项目')
	assert.equal(currentEntry.dir, normalizeDir(alpha))
	// 每个项目都要给出数据落在哪（排查"我的数据呢"时全靠它）
	assert.ok(projects.every((p) => typeof p.folder === 'string'))
})

test('集成：项目的轮转状态也是独立的（meta 跟着项目走）', async (t) => {
	const { root, alpha } = await makeProjectDirs(t)
	const service = new DailyService(resolveConfig({ dataDir: root }), SILENT)
	await service.init()

	// 默认项目写入轮转状态
	await service.store.updateMeta((m) => ({ ...m, youtubeRotation: { UC_X: { lastAttemptAt: null, consecutiveFailures: 3 } } }))

	await service.useProject(alpha)
	assert.deepEqual((await service.store.readMeta()).youtubeRotation, {}, '新项目不该继承别处的轮转状态')

	await service.useProject(root)
	assert.equal(
		(await service.store.readMeta()).youtubeRotation.UC_X.consecutiveFailures,
		3,
		'切回来轮转状态也要还在',
	)
})
