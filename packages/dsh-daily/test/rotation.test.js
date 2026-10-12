/**
 * YouTube 频道轮转与退避的回归测试。
 *
 * 背景（有实测证据）：本机 YouTube 依赖一个免费公共 RSSHub 镜像，5 个频道每轮全量请求它，
 * 实测一次 2/5 频道失败、另一次**整源 0 条**（429/超时），且该源占了整轮刷新耗时的绝大部分。
 *
 * 测试全部**不联网**：用假的镜像池驱动真实的 `collectYoutube`，
 * 所以"只请求了选中的频道""失败计数真的涨了""退避真的生效"这些都能被钉住。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
	cooldownMs,
	describeRotation,
	pickChannels,
	pruneRotation,
	recordAttempts,
} from '../lib/rotation.js'
import { collectYoutube } from '../lib/collect/sources.js'
import { runCollection } from '../lib/collect/index.js'
import { resolveConfig } from '../lib/config.js'

const CHANNELS = [
	{ name: 'A', channelId: 'UC_A', topic: 'AI' },
	{ name: 'B', channelId: 'UC_B', topic: 'AI' },
	{ name: 'C', channelId: 'UC_C', topic: '技术' },
	{ name: 'D', channelId: 'UC_D', topic: '技术' },
	{ name: 'E', channelId: 'UC_E', topic: '学术' },
]

const FEED = (id) => `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <title>频道</title>
  <entry>
    <id>yt:video:${id}</id>
    <title>视频 ${id}</title>
    <link href="https://www.youtube.com/watch?v=${id}"/>
    <author><name>作者</name></author>
    <published>2026-10-12T00:00:00.000Z</published>
  </entry>
</feed>`

/** 假镜像池：记录被请求的 route，按规则成功/失败。 */
function fakePool(behavior) {
	const requested = []
	return {
		requested,
		async warmUp() {},
		async fetchRoute(route) {
			requested.push(route)
			const rule = behavior(route)
			if (rule === 'ok') return { text: FEED('abcdefghijk'), mirror: 'https://fake.mirror', fromCache: false }
			throw new Error(rule || '失败')
		},
		snapshot() {
			return { warmOrder: [], mirrorHealth: {} }
		},
	}
}

// ---------- 退避时长 ----------

test('cooldownMs：0 次失败不退避，之后按 2 的幂递增并封顶 8 倍', () => {
	assert.equal(cooldownMs(0, 20), 0)
	assert.equal(cooldownMs(1, 20), 20 * 60_000)
	assert.equal(cooldownMs(2, 20), 40 * 60_000)
	assert.equal(cooldownMs(3, 20), 80 * 60_000)
	assert.equal(cooldownMs(5, 20), 160 * 60_000, '封顶 8 倍')
	assert.equal(cooldownMs(9, 20), 160 * 60_000)
	assert.equal(cooldownMs(3, 0), 0, '基准为 0 就是不退避')
})

// ---------- 选谁 ----------

test('pickChannels：perRefresh 为 0 或不小于总数 → 全抓（关闭轮转）', () => {
	for (const per of [0, -1, 5, 99]) {
		const result = pickChannels(CHANNELS, {}, { perRefresh: per, now: 0, cooldownMinutes: 20 })
		assert.equal(result.selected.length, CHANNELS.length, `perRefresh=${per}`)
		assert.equal(result.deferred.length, 0)
		assert.equal(result.forced, false)
	}
})

test('pickChannels：没抓过的优先，其次是最久没抓的（真 LRU）', () => {
	const now = Date.parse('2026-10-12T12:00:00.000Z')
	const state = {
		UC_A: { lastAttemptAt: '2026-10-12T11:00:00.000Z', consecutiveFailures: 0 },
		UC_B: { lastAttemptAt: '2026-10-12T09:00:00.000Z', consecutiveFailures: 0 },
		// C 从没抓过
		UC_D: { lastAttemptAt: '2026-10-12T10:00:00.000Z', consecutiveFailures: 0 },
	}
	const result = pickChannels(CHANNELS, state, { perRefresh: 3, now, cooldownMinutes: 0 })
	// 没抓过的有 C 和 E（E 不在 state 里 = 从没抓过）→ 按名字稳定排序；之后才是最久没抓的 B
	assert.deepEqual(result.selected.map((c) => c.channelId), ['UC_C', 'UC_E', 'UC_B'])
	assert.deepEqual(
		result.deferred.map((d) => d.name).sort(),
		['A', 'D'],
		'D(10:00) 与 A(11:00) 都抓过，都排在 B(09:00) 之后',
	)
})

test('pickChannels：LRU 按**尝试**时间排序 —— 老是失败的频道不会每轮都被优先选中', () => {
	const now = Date.parse('2026-10-12T12:00:00.000Z')
	// 只用 A、B 两个候选，才能干净地比较"尝试时间"与"成功时间"谁在起作用：
	// A 的 lastSuccess 很早（老失败）但刚刚尝试过；B 很久没尝试。
	const two = [CHANNELS[0], CHANNELS[1]]
	const state = {
		UC_A: { lastAttemptAt: '2026-10-12T11:59:00.000Z', lastSuccessAt: '2026-01-01T00:00:00.000Z', consecutiveFailures: 1 },
		UC_B: { lastAttemptAt: '2026-10-12T06:00:00.000Z', lastSuccessAt: '2026-10-12T06:00:00.000Z', consecutiveFailures: 0 },
	}
	const result = pickChannels(two, state, { perRefresh: 1, now, cooldownMinutes: 0 })
	assert.deepEqual(
		result.selected.map((c) => c.channelId),
		['UC_B'],
		'久未尝试的应优先，哪怕 A 的"上次成功"更早（按 lastAttempt 而不是 lastSuccess）',
	)
})

test('pickChannels：退避窗口内的频道被跳过，并说明原因', () => {
	const now = Date.parse('2026-10-12T12:00:00.000Z')
	const state = {
		// 连续失败 3 次 → 退避 80 分钟；11:30 尝试过，12:00 仍在窗口内
		UC_A: { lastAttemptAt: '2026-10-12T11:30:00.000Z', consecutiveFailures: 3 },
	}
	const result = pickChannels(CHANNELS, state, { perRefresh: 3, now, cooldownMinutes: 20 })
	assert.equal(result.selected.some((c) => c.channelId === 'UC_A'), false, '退避中的不该被抓')
	const deferredA = result.deferred.find((d) => d.name === 'A')
	assert.ok(deferredA && /退避/.test(deferredA.reason), `A 应带着退避原因：${JSON.stringify(deferredA)}`)
	assert.equal(result.forced, false)
})

test('pickChannels：所有频道都在退避中 → 强制选取，绝不一个都不抓', () => {
	const now = Date.parse('2026-10-12T12:00:00.000Z')
	const state = Object.fromEntries(
		CHANNELS.map((c) => [c.channelId, { lastAttemptAt: '2026-10-12T11:55:00.000Z', consecutiveFailures: 5 }]),
	)
	const result = pickChannels(CHANNELS, state, { perRefresh: 2, now, cooldownMinutes: 60 })
	assert.equal(result.selected.length, 2, '退避不能把源饿死')
	assert.equal(result.forced, true, '应标记为"被迫忽略退避"')
	assert.equal(describeRotation(result, CHANNELS.length).includes('强制选取'), true)
})

test('pickChannels：空频道列表不炸', () => {
	const result = pickChannels([], {}, { perRefresh: 3, now: 0, cooldownMinutes: 20 })
	assert.deepEqual(result, { selected: [], deferred: [], forced: false })
})

// ---------- 记账 ----------

test('recordAttempts：成功清零失败计数，失败累加，且不改动输入', () => {
	const state = { UC_A: { lastAttemptAt: '2026-10-01T00:00:00.000Z', consecutiveFailures: 2 } }
	const now = new Date('2026-10-12T12:00:00.000Z')
	const next = recordAttempts(state, [{ key: 'UC_A', ok: true }, { key: 'UC_B', ok: false }], now)
	assert.equal(next.UC_A.consecutiveFailures, 0, '成功应清零')
	assert.equal(next.UC_A.lastAttemptAt, now.toISOString())
	assert.equal(next.UC_A.lastSuccessAt, now.toISOString())
	assert.equal(next.UC_B.consecutiveFailures, 1, '新频道失败应为 1')
	assert.equal(next.UC_B.lastSuccessAt, null)
	assert.equal(state.UC_A.consecutiveFailures, 2, '输入对象不该被改动')

	// 再失败一次 → 2
	const next2 = recordAttempts(next, [{ key: 'UC_B', ok: false }], now)
	assert.equal(next2.UC_B.consecutiveFailures, 2)
})

test('pruneRotation：丢掉配置里已不存在的频道（防止 meta 无限增长）', () => {
	const state = { UC_A: { lastAttemptAt: null, consecutiveFailures: 0 }, GONE: { lastAttemptAt: null, consecutiveFailures: 3 } }
	assert.deepEqual(Object.keys(pruneRotation(state, ['UC_A'])), ['UC_A'])
	assert.deepEqual(pruneRotation(state, []), {})
})

// ---------- 集成（不联网：假镜像池 + 真实的 collectYoutube）----------

function youtubeConfig(channels) {
	return resolveConfig({ youtubeChannels: channels, maxItemsPerSource: 3 })
}

test('集成：只请求选中的频道（轮转真的在减少请求数）', async () => {
	const pool = fakePool(() => 'ok')
	const env = { config: youtubeConfig(CHANNELS.map((c) => `${c.name}|${c.channelId}|${c.topic}`)), pool }
	const result = await collectYoutube(env)

	assert.equal(pool.requested.length, 3, '5 个频道、每轮 3 个 → 只应有 3 次请求')
	assert.deepEqual(pool.requested, ['/youtube/channel/UC_A', '/youtube/channel/UC_B', '/youtube/channel/UC_C'])
	assert.equal(result.rotationUpdates.length, 3)
	assert.ok(result.rotationUpdates.every((u) => u.ok))
	assert.ok(result.note.includes('轮转抓取 3/5'), `说明里要讲清是轮转不是故障：${result.note}`)
})

test('集成：轮转状态让下一轮换一批频道（两轮覆盖全部 5 个）', async () => {
	const config = youtubeConfig(CHANNELS.map((c) => `${c.name}|${c.channelId}|${c.topic}`))
	const pool = fakePool(() => 'ok')

	const first = await collectYoutube({ config, pool })
	const afterFirst = recordAttempts({}, first.rotationUpdates, new Date('2026-10-12T12:00:00.000Z'))
	assert.deepEqual(pool.requested.map((r) => r.split('/').pop()), ['UC_A', 'UC_B', 'UC_C'])

	pool.requested.length = 0
	const second = await collectYoutube({ config, pool, rotation: afterFirst })
	assert.deepEqual(
		pool.requested.map((r) => r.split('/').pop()),
		['UC_D', 'UC_E', 'UC_A'],
		'第二轮应优先抓没抓过的 D、E，再往后补最久没抓的 A',
	)
	const afterSecond = recordAttempts(afterFirst, second.rotationUpdates, new Date('2026-10-12T12:10:00.000Z'))
	assert.deepEqual(Object.keys(afterSecond).sort(), ['UC_A', 'UC_B', 'UC_C', 'UC_D', 'UC_E'], '两轮覆盖全部频道')
})

test('集成：部分频道失败 → 说明里带上失败数，且失败的进入退避', async () => {
	const pool = fakePool((route) => (route.endsWith('UC_B') ? 'HTTP 429' : 'ok'))
	const config = youtubeConfig(CHANNELS.map((c) => `${c.name}|${c.channelId}|${c.topic}`))
	const result = await collectYoutube({ config, pool })

	assert.equal(result.items.length, 2, 'A、C 各 1 条')
	assert.ok(result.note.includes('HTTP 429'), `失败原因要露出来：${result.note}`)
	assert.deepEqual(
		result.rotationUpdates,
		[
			{ key: 'UC_A', ok: true },
			{ key: 'UC_B', ok: false },
			{ key: 'UC_C', ok: true },
		],
	)
})

test('集成：整源失败时抛错，但**轮转记录必须跟着异常带出来**', async () => {
	const pool = fakePool(() => 'HTTP 429')
	const config = youtubeConfig(CHANNELS.map((c) => `${c.name}|${c.channelId}|${c.topic}`))
	await assert.rejects(
		() => collectYoutube({ config, pool }),
		(error) => {
			assert.equal(error.name, 'SourceFailure')
			assert.match(error.message, /全部失败/)
			assert.equal(error.rotationUpdates.length, 3, '失败记录不能因为抛错就丢掉（否则退避永不生效）')
			assert.ok(error.rotationUpdates.every((u) => u.ok === false))
			return true
		},
	)
})

test('集成：runCollection 把失败的尝试记录也汇总进 outcome.rotation', async () => {
	const pool = fakePool(() => 'HTTP 429')
	const config = youtubeConfig(CHANNELS.map((c) => `${c.name}|${c.channelId}|${c.topic}`))
	const outcome = await runCollection({
		config,
		pool,
		sourceIds: ['youtube'],
		rotation: {},
	})

	const youtube = outcome.sources.find((s) => s.id === 'youtube')
	assert.equal(youtube?.ok, false, '整源失败应体现为源状态 ❌')
	assert.equal(Object.keys(outcome.rotation).length, 3, '失败也要记账 —— 这是退避生效的前提')
	for (const key of Object.keys(outcome.rotation)) {
		assert.equal(outcome.rotation[key].consecutiveFailures, 1)
	}
})

test('集成：runCollection 在成功时也汇总轮转状态', async () => {
	const pool = fakePool(() => 'ok')
	const config = youtubeConfig(CHANNELS.map((c) => `${c.name}|${c.channelId}|${c.topic}`))
	const outcome = await runCollection({ config, pool, sourceIds: ['youtube'], rotation: {} })

	assert.equal(Object.keys(outcome.rotation).length, 3)
	assert.equal(outcome.items.length, 3)
	assert.ok(Object.values(outcome.rotation).every((r) => r.consecutiveFailures === 0))
})

test('集成：没跑 youtube 时轮转状态原样返回（不会被清空）', async () => {
	const seeded = { UC_A: { lastAttemptAt: '2026-10-01T00:00:00.000Z', consecutiveFailures: 2 } }
	const outcome = await runCollection({
		config: resolveConfig({}),
		pool: fakePool(() => 'ok'),
		sourceIds: ['extra'],
		rotation: seeded,
	})
	assert.deepEqual(outcome.rotation, seeded)
})
