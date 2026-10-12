/**
 * 桌面通知的回归测试。
 *
 * 通知这类功能最容易"看起来能跑、实际从不生效"：平台不对、开关没开、
 * osascript 参数拼错、文案被截断到看不出是什么 —— 而它的失败是**静默**的。
 * 所以这里的重点不是"能不能弹出来"，而是：
 * - 关着的时候**绝不**调用外部命令（默认关闭必须是硬保证）
 * - 文本必须走 argv 而**不是**拼进 AppleScript 源码（标题里的引号不能破坏脚本）
 * - 任何失败都不抛异常（通知失败绝不能影响采集结果）
 * - 失败要给出可诊断的原因
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
	APPLESCRIPT_ARGS,
	BODY_MAX_CHARS,
	buildDailyNotification,
	sendNotification,
} from '../lib/notify.js'

const item = (title, topic = 'AI') => ({ title, topic })

// ---------- 文案 ----------

test('buildDailyNotification：标题带日期，正文含条数与前几条标题', () => {
	const payload = buildDailyNotification({
		date: '2026-10-12',
		total: 67,
		unread: 60,
		items: [item('甲新闻'), item('乙新闻'), item('丙新闻'), item('丁新闻')],
		maxTitles: 3,
		appName: '日报',
	})
	assert.equal(payload.title, '日报 · 2026-10-12')
	assert.ok(payload.body.includes('67 条索引'))
	assert.ok(payload.body.includes('60 未读'))
	assert.ok(payload.body.includes('甲新闻') && payload.body.includes('乙新闻') && payload.body.includes('丙新闻'))
	assert.ok(!payload.body.includes('丁新闻'), 'maxTitles 之外的不该出现')
})

test('buildDailyNotification：正文单行（macOS 横幅对换行支持很差）', () => {
	const payload = buildDailyNotification({
		date: '2026-10-12',
		total: 3,
		items: [item('带\n换行的\n标题'), item('另一个标题')],
	})
	assert.ok(!payload.body.includes('\n'), '正文里不该有换行')
	assert.ok(payload.body.includes('带 换行的 标题'), '标题内部的空白应被压成单空格')
})

test('buildDailyNotification：总量为 0 时不装作有内容', () => {
	const payload = buildDailyNotification({ date: '2026-10-12', total: 0, items: [] })
	assert.ok(payload.body.includes('今天没有新条目'))
	assert.ok(!payload.body.includes('：'), '没有条目就不该有"：标题"那一段')
})

test('buildDailyNotification：正文超长会被截断，且带省略号', () => {
	const many = Array.from({ length: 10 }, (_, i) => item(`很长的标题${i}` + '啊'.repeat(30)))
	const payload = buildDailyNotification({ date: '2026-10-12', total: 999, items: many, maxTitles: 10 })
	assert.ok(payload.body.length <= BODY_MAX_CHARS, `实际 ${payload.body.length} 应 <= ${BODY_MAX_CHARS}`)
	assert.ok(payload.body.endsWith('…'))
})

test('buildDailyNotification：即使标题全为空也产出可用文案', () => {
	const payload = buildDailyNotification({ date: '2026-10-12', total: 2, items: [item('   '), item('')] })
	assert.ok(payload.body.trim().length > 0)
	assert.ok(payload.body.includes('2 条索引'))
})

// ---------- 发送 ----------

function recordingSpawn(outcome = { ok: true }) {
	const calls = []
	return {
		calls,
		fn: async (command, args) => {
			calls.push({ command, args: [...args] })
			return outcome
		},
	}
}

test('sendNotification：开关关闭时**绝不**调用外部命令', async () => {
	const recorder = recordingSpawn()
	const result = await sendNotification({ title: 't', body: 'b' }, { enabled: false, spawn: recorder.fn })
	assert.equal(result.sent, false)
	assert.match(result.reason, /未开启/)
	assert.equal(recorder.calls.length, 0, '关着的时候连命令都不该拼')
})

test('sendNotification：非 macOS 平台安全跳过（并说明原因）', async () => {
	const recorder = recordingSpawn()
	const result = await sendNotification(
		{ title: 't', body: 'b' },
		{ enabled: true, platform: 'linux', spawn: recorder.fn },
	)
	assert.equal(result.sent, false)
	assert.match(result.reason, /linux/)
	assert.equal(recorder.calls.length, 0)
})

test('sendNotification：文本走 argv，**不是**拼进 AppleScript 源码', async () => {
	const recorder = recordingSpawn()
	const nasty = '标题里有 "引号" 和 \\ 反斜杠 以及 $变量 `反引号`'
	await sendNotification({ title: '日报 · 2026-10-12', body: nasty }, { enabled: true, platform: 'darwin', spawn: recorder.fn })

	assert.equal(recorder.calls.length, 1)
	const call = recorder.calls[0]
	assert.equal(call.command, 'osascript')
	// 脚本片段固定，且不含任何用户数据
	const scriptParts = call.args.slice(0, APPLESCRIPT_ARGS.length)
	assert.deepEqual(scriptParts, APPLESCRIPT_ARGS)
	assert.ok(
		!scriptParts.join(' ').includes('引号'),
		'脚本里绝不能出现正文内容（否则引号会破坏 AppleScript）',
	)
	// 正文与标题作为 argv 追加在后面
	assert.deepEqual(call.args.slice(APPLESCRIPT_ARGS.length), [nasty, '日报 · 2026-10-12'])
})

test('sendNotification：osascript 失败 → 不抛异常，返回可诊断原因', async () => {
	const result = await sendNotification(
		{ title: 't', body: 'b' },
		{ enabled: true, platform: 'darwin', spawn: async () => ({ ok: false, error: 'osascript 退出码 1' }) },
	)
	assert.equal(result.sent, false)
	assert.equal(result.reason, 'osascript 退出码 1')
})

test('sendNotification：spawn 自身抛错（例如找不到 osascript）也要被吞掉', async () => {
	const result = await sendNotification(
		{ title: 't', body: 'b' },
		{ enabled: true, platform: 'darwin', spawn: async () => { throw new Error('spawn osascript ENOENT') } },
	)
	assert.equal(result.sent, false)
	assert.match(result.reason, /ENOENT/)
})

test('sendNotification：空正文不发（避免弹出一条什么都没有的通知）', async () => {
	const recorder = recordingSpawn()
	const result = await sendNotification({ title: 't', body: '   ' }, { enabled: true, platform: 'darwin', spawn: recorder.fn })
	assert.equal(result.sent, false)
	assert.equal(recorder.calls.length, 0)
})

test('sendNotification：成功路径返回 sent=true', async () => {
	const recorder = recordingSpawn({ ok: true })
	const result = await sendNotification({ title: 't', body: 'b' }, { enabled: true, platform: 'darwin', spawn: recorder.fn })
	assert.deepEqual(result, { sent: true })
	assert.equal(recorder.calls.length, 1)
})

// ---------- 集成：触发时机（不该弹的绝不弹） ----------

test('集成：手动刷新不弹通知；定时/启动才弹（且带正确的 argv）', async () => {
	const { DailyService } = await import('../lib/service.js')
	const { resolveConfig } = await import('../lib/config.js')
	const { mkdtemp, rm } = await import('node:fs/promises')
	const os = await import('node:os')
	const path = await import('node:path')

	const dir = await mkdtemp(path.join(os.tmpdir(), 'dsh-daily-notify-'))
	try {
		const calls = []
		const service = new DailyService(
			resolveConfig({ dataDir: dir, notifyEnabled: true, notifyMaxTitles: 2 }),
			{ info() {}, warn() {}, error() {} },
			{
				spawn: async (command, args) => {
					calls.push({ command, args: [...args] })
					return { ok: true }
				},
			},
		)
		await service.init()

		// 造一天数据（不联网）
		const today = (await import('../lib/store.js')).localDate()
		await service.store.writeDay({
			date: today,
			items: [
				{ id: 'a', title: '甲', url: 'https://e.com/a', kind: 'web', platform: 'hackernews', sourceId: 'hn', sourceName: 'HN', topic: 'AI', score: 10, reasons: [], read: false, liked: false, disliked: false, hidden: false, firstSeenAt: `${today}T01:00:00.000Z` },
				{ id: 'b', title: '乙', url: 'https://e.com/b', kind: 'web', platform: 'arxiv', sourceId: 'arxiv', sourceName: 'arXiv', topic: '学术', score: 9, reasons: [], read: false, liked: false, disliked: false, hidden: false, firstSeenAt: `${today}T01:00:00.000Z` },
			],
			sources: [],
			lastRefresh: null,
		})

		// 手动触发：不该弹
		await service.refresh({ sourceIds: ['extra'], trigger: 'manual' })
		assert.equal(calls.length, 0, '手动刷新不该弹通知')

		// 定时触发：该弹
		await service.refresh({ sourceIds: ['extra'], trigger: 'schedule' })
		assert.equal(calls.length, 1, '定时刷新该弹一条')
		assert.equal(calls[0].command, 'osascript')
		assert.ok(
			calls[0].args.slice(0, APPLESCRIPT_ARGS.length).join('\n') === APPLESCRIPT_ARGS.join('\n'),
			'脚本片段必须固定',
		)
		assert.ok(calls[0].args[APPLESCRIPT_ARGS.length].length > 0, '正文不该为空')

		// 注：这里断言的是"该不该弹"，不是正文里有没有条目 ——
		// 因为本轮刷新用的是 sourceIds:['extra']（无自定义源 → 0 条），
		// 而**刷新会用新采集的条目覆盖当天**（见 STATUS R15 记录的 next-round 问题）。
		// 正文内容由 buildDailyNotification 的单测覆盖。
	} finally {
		await rm(dir, { recursive: true, force: true })
	}
})

test('集成：notifyEnabled=false 时，即使定时刷新也不弹', async () => {
	const { DailyService } = await import('../lib/service.js')
	const { resolveConfig } = await import('../lib/config.js')
	const { mkdtemp, rm } = await import('node:fs/promises')
	const os = await import('node:os')
	const path = await import('node:path')

	const dir = await mkdtemp(path.join(os.tmpdir(), 'dsh-daily-notify-off-'))
	try {
		let called = 0
		const service = new DailyService(
			resolveConfig({ dataDir: dir, notifyEnabled: false }),
			{ info() {}, warn() {}, error() {} },
			{ spawn: async () => { called++; return { ok: true } } },
		)
		await service.init()
		await service.refresh({ sourceIds: ['extra'], trigger: 'schedule' })
		assert.equal(called, 0, '默认关闭必须是硬保证')
	} finally {
		await rm(dir, { recursive: true, force: true })
	}
})
