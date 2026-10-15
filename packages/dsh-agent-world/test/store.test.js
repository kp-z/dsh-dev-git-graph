/**
 * 落盘测试（BACKLOG M3-1）。
 *
 * 这一层的风险不是"算错"，而是**在错误的时候毁掉数据**：写到一半掉电、
 * 读到一个半截 JSON、或者拿错误的版本去解释存档。所以测试集中在这几条上。
 */
import assert from 'node:assert/strict'
import { after, test } from 'node:test'
import { mkdtemp, readFile, writeFile, readdir, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { ContentRegistry, builtinPacks } from '../lib/content/index.js'
import { createWorld } from '../lib/world/create.js'
import { createPluginState } from '../lib/state.js'
import { resolveConfig } from '../lib/config.js'
import { createRuntime } from '../lib/runtime/index.js'
import { emitEvent } from '../lib/sim/journal.js'
import {
  WORLD_FILE,
  WORLD_FILE_VERSION,
  EVENTS_FILE,
  createWorldStore,
  loadWorldSync,
} from '../lib/store/index.js'

const tempDirs = []
after(async () => {
  const { rm } = await import('node:fs/promises')
  for (const dir of tempDirs) await rm(dir, { recursive: true, force: true })
})

async function tempDir() {
  const dir = await mkdtemp(join(tmpdir(), 'agent-world-store-'))
  tempDirs.push(dir)
  return dir
}

function makeWorld() {
  const content = new ContentRegistry()
  content.loadAll(builtinPacks())
  return createWorld({
    content,
    scene: 'scene.default-town',
    createdAt: '2026-01-01T00:00:00.000Z',
    taskSets: ['task.quick-fix'],
  })
}

const PACKS = [{ id: 'pack.default', version: '1.0.0' }]

// ── 存档本身 ────────────────────────────────────────────────────────────────

test('存档：存了能读回来，且**不带事件环形缓冲**（历史在 jsonl 里，不在快照里）', async () => {
  const dir = await tempDir()
  const store = createWorldStore(dir)
  const world = makeWorld()
  world.tick = 42
  emitEvent(world, 'world.paused', { paused: true })

  await store.saveWorld(world, PACKS)
  const loaded = await store.load()

  assert.ok(loaded && 'ok' in loaded)
  assert.equal(loaded.ok.world.tick, 42)
  assert.equal(loaded.ok.world.id, world.id)
  assert.deepEqual(loaded.ok.content, PACKS)
  assert.equal(loaded.ok.savedAtTick, 42)

  // 环形缓冲不落盘：它是活客户端的补洞窗口，不是历史。
  assert.equal(loaded.ok.world.events.length, 0)
  const onDisk = JSON.parse(await readFile(join(dir, WORLD_FILE), 'utf8'))
  assert.equal(onDisk.world.events, undefined, '快照里不该有事件环形缓冲')
  assert.equal(onDisk.fileVersion, WORLD_FILE_VERSION)
})

test('存档：同一个世界存两次 → **逐字节相同**（文件里没有墙上时间）', async () => {
  const dir = await tempDir()
  const store = createWorldStore(dir)
  const world = makeWorld()

  await store.saveWorld(world, PACKS)
  const first = await readFile(join(dir, WORLD_FILE), 'utf8')
  await store.saveWorld(world, PACKS)
  const second = await readFile(join(dir, WORLD_FILE), 'utf8')

  assert.equal(first, second, '存档里若有 Date.now()，这条就会红——而"存档可复现"是可验的前提')
})

test('存档：内容包列表按 id 排序（顺序变化不该算成不同的存档）', async () => {
  const dir = await tempDir()
  const store = createWorldStore(dir)
  await store.saveWorld(makeWorld(), [
    { id: 'pack.z', version: '2' },
    { id: 'pack.a', version: '1' },
  ])
  const onDisk = JSON.parse(await readFile(join(dir, WORLD_FILE), 'utf8'))
  assert.deepEqual(onDisk.content.map((p) => p.id), ['pack.a', 'pack.z'])
})

test('原子写：写完不留临时文件（留下的就说明上次写没跑完）', async () => {
  const dir = await tempDir()
  const store = createWorldStore(dir)
  await store.saveWorld(makeWorld(), PACKS)

  const entries = await readdir(dir)
  assert.deepEqual(entries.filter((n) => n.includes('.tmp-')), [], '不该有临时文件残留')
  assert.ok(entries.includes(WORLD_FILE))

  const info = await store.info()
  assert.equal(info.worldBytes !== null, true)
  assert.deepEqual(info.strayTempFiles, [])
})

test('读档：没有文件返回 null（不是错误）', async () => {
  const store = createWorldStore(await tempDir())
  assert.equal(await store.load(), null)
})

test('读档：坏 JSON → 明确的失败信息，**不抛异常**', async () => {
  const dir = await tempDir()
  await writeFile(join(dir, WORLD_FILE), '{"fileVersion": 1, "world": {', 'utf8')

  const loaded = await createWorldStore(dir).load()
  assert.ok(loaded && 'failure' in loaded)
  assert.match(loaded.failure.reason, /不是合法 JSON/)
  assert.match(loaded.failure.reason, /删掉它/, '要给出可照做的出路')
  assert.equal(loaded.failure.file, join(dir, WORLD_FILE))
})

test('读档：格式版本不匹配 → 拒绝，并说清期望哪个版本', async () => {
  const dir = await tempDir()
  await writeFile(
    join(dir, WORLD_FILE),
    JSON.stringify({ fileVersion: WORLD_FILE_VERSION + 1, savedAtTick: 0, content: [], world: {} }),
    'utf8',
  )

  const loaded = await createWorldStore(dir).load()
  assert.ok(loaded && 'failure' in loaded)
  assert.match(loaded.failure.reason, new RegExp(String(WORLD_FILE_VERSION + 1)))
  assert.match(loaded.failure.reason, new RegExp(`只读 ${WORLD_FILE_VERSION}`))
})

test('读档：world 缺必需字段 → 报出缺的是哪个，并列出实际有的字段', async () => {
  const dir = await tempDir()
  await writeFile(
    join(dir, WORLD_FILE),
    JSON.stringify({ fileVersion: WORLD_FILE_VERSION, savedAtTick: 0, content: [], world: { id: 'x', name: 'y' } }),
    'utf8',
  )

  const loaded = await createWorldStore(dir).load()
  assert.ok(loaded && 'failure' in loaded)
  assert.match(loaded.failure.reason, /缺少必需字段 "tick"/)
  assert.match(loaded.failure.reason, /已有的字段：id \/ name/, '要列出实际有的字段，别让人猜')
})

test('事件历史：追加式，一行一条；追加空数组是空操作且不建目录', async () => {
  const dir = await tempDir()
  const store = createWorldStore(dir)
  const world = makeWorld()

  assert.equal(await store.appendEvents([]), 0)
  await assert.rejects(() => readdir(join(dir, EVENTS_FILE)), /ENOTDIR|ENOENT/)

  const events = [emitEvent(world, 'world.paused', { paused: true }), emitEvent(world, 'world.paused', { paused: false })]
  assert.equal(await store.appendEvents(events), 2)
  assert.equal(await store.appendEvents([emitEvent(world, 'world.paused', { paused: true })]), 1)

  const text = await readFile(join(dir, EVENTS_FILE), 'utf8')
  const lines = text.split('\n').filter((l) => l.trim() !== '')
  assert.equal(lines.length, 3, '追加而不是覆盖')
  assert.equal(text.endsWith('\n'), true, '每行以换行结尾——被杀时最坏只有最后一行不完整')
  for (const line of lines) JSON.parse(line) // 每一行都得是独立合法 JSON
  assert.equal((await store.info()).eventLines, 3)
})

test('同步读档与异步读档结果一致（解析只有一份实现）', async () => {
  const dir = await tempDir()
  const world = makeWorld()
  await createWorldStore(dir).saveWorld(world, PACKS)

  const async_ = await createWorldStore(dir).load()
  const sync = loadWorldSync(dir)
  assert.deepEqual(sync, async_, '两条读法必须同结果——解析逻辑只该有一份')
  assert.equal(loadWorldSync(await tempDir()), null)
})

// ── 运行时：真的会写下去吗 ──────────────────────────────────────────────────

function makeState(overrides = {}) {
  const state = createPluginState(resolveConfig({ autoStart: false, persistEveryTicks: 0, ...overrides }))
  state.ensureWorld()
  return state
}

test('运行时：每 N tick checkpoint 一次，快照与事件都落盘', async () => {
  const dir = await tempDir()
  const state = makeState()
  state.dispatch('task.quick-fix')

  const runtime = createRuntime({
    service: state,
    tickMs: 100,
    persist: { store: createWorldStore(dir), checkpointEveryTicks: 50 },
  })

  runtime.advance(50)
  // checkpoint 是 fire-and-forget 的，给它一个微任务的机会。
  await new Promise((r) => setTimeout(r, 20))
  const afterFifty = await createWorldStore(dir).load()
  assert.ok(afterFifty && 'ok' in afterFifty, '第 50 tick 应当已经写过一次')
  assert.equal(afterFifty.ok.savedAtTick, 50)

  runtime.advance(50)
  await new Promise((r) => setTimeout(r, 20))
  const afterHundred = await createWorldStore(dir).load()
  assert.ok(afterHundred && 'ok' in afterHundred)
  assert.equal(afterHundred.ok.savedAtTick, 100)

  const info = await createWorldStore(dir).info()
  assert.ok((info.eventLines ?? 0) > 0, '事件历史也该有内容')
  assert.deepEqual(info.strayTempFiles, [])
  assert.equal(runtime.diagnostics.persistErrors, 0)
})

test('运行时：flush 立刻落盘；stop 也会刷（退出前那一段不能丢）', async () => {
  const dir = await tempDir()
  const state = makeState()
  const store = createWorldStore(dir)
  const runtime = createRuntime({
    service: state,
    tickMs: 100,
    // checkpoint 间隔设得很大，确保这两次落盘只可能来自 flush / stop。
    persist: { store, checkpointEveryTicks: 100_000 },
  })

  runtime.advance(10)
  assert.equal(await store.load(), null, '没到 checkpoint 就不该写')

  await runtime.flush()
  const flushed = await store.load()
  assert.ok(flushed && 'ok' in flushed)
  assert.equal(flushed.ok.savedAtTick, 10)

  runtime.advance(5)
  runtime.stop()
  await new Promise((r) => setTimeout(r, 20))
  const stopped = await store.load()
  assert.ok(stopped && 'ok' in stopped)
  assert.equal(stopped.ok.savedAtTick, 15, 'stop() 必须把最后一段刷下去')
})

test('运行时：写盘失败 → 计数 + 事件**留着重试**，不静默丢历史', async () => {
  const dir = await tempDir()
  const state = makeState()
  const errors = []

  let failNext = true
  const flaky = {
    ...createWorldStore(dir),
    async saveWorld() {
      if (failNext) throw new Error('磁盘满了')
    },
  }

  const runtime = createRuntime({
    service: state,
    tickMs: 100,
    persist: { store: flaky, checkpointEveryTicks: 10 },
    onError: (e) => errors.push(e),
  })

  runtime.advance(10)
  // **不要用固定的 `setTimeout` 当同步手段**（R27 修）。
  //
  // 原来是 `await new Promise(r => setTimeout(r, 20))` 然后断言 `persistErrors === 1`。
  // 这在机器空闲时没问题，但在**全量套件 + 队友并发**的负载下，那次持久化可能还没跑完，
  // 于是这里读到 0 → 变红。R27 亲历过一次：单独跑 3/3 全绿、全量跑红一次。
  //
  // 一条 flaky 的测试比一条失败的测试更糟：**它让"绿"变得不可信**，
  // 而"绿"正是这套验收纪律的基础。而且它护的这条不变量（写盘失败不许静默丢事件）
  // 一旦真的坏了，最可能的表现就是"有人说它 flaky 而已"。
  //
  // 改成"轮询到出现为止 + 截止时间"：它表达的是**等这件事发生**，
  // 而不是"猜 20ms 应该够了"。截止时间保证它仍然会失败（而不是永远等下去）。
  const deadline = Date.now() + 2000
  while (runtime.diagnostics.persistErrors === 0 && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 5))
  }
  assert.equal(runtime.diagnostics.persistErrors, 1, '2 秒内应当发生一次持久化失败')
  assert.equal(errors.length, 1)

  // 修好之后再刷：**那一批事件不该丢**。
  failNext = false
  await runtime.flush()
  assert.equal(runtime.diagnostics.persistErrors, 1)
  const info = await createWorldStore(dir).info()
  assert.ok((info.eventLines ?? 0) > 0, '重试之后事件应当写下去了')
})

test('运行时：stop 走**同步**刷盘——关停后立刻检查，文件就已经在了', async () => {
  const dir = await tempDir()
  const state = makeState()
  const store = createWorldStore(dir)
  const runtime = createRuntime({
    service: state,
    tickMs: 100,
    persist: { store, checkpointEveryTicks: 100_000 },
  })

  runtime.advance(8)
  runtime.stop()

  // **不 await、不等事件循环**：stop 之后进程可能立刻退出，所以这一刻文件就该是完整的。
  const loaded = loadWorldSync(dir)
  assert.ok(loaded && 'ok' in loaded, 'stop() 之后立刻读，存档就该在——否则退出时会丢最后一段')
  assert.equal(loaded.ok.savedAtTick, 8)

  const info = await store.info()
  assert.ok((info.eventLines ?? 0) > 0)
  assert.deepEqual(info.strayTempFiles, [], '同步路径也不该留临时文件')
})

test('运行时：没配 persist 就什么都不写（世界只活在内存里）', async () => {
  const state = makeState()
  const runtime = createRuntime({ service: state, tickMs: 100 })
  runtime.advance(20)
  await runtime.flush() // 空转，不抛
  assert.equal(runtime.diagnostics.persistErrors, 0)
})

// ── 恢复：接回旧世界，而且**不能是静默的** ──────────────────────────────────

test('恢复：新起的插件状态把上次的世界接回来，并记录来源', async () => {
  const dir = await tempDir()

  const first = createPluginState(resolveConfig({ autoStart: false, persistEveryTicks: 0 }), { storeDir: dir })
  const world = first.ensureWorld()
  world.tick = 77
  await createWorldStore(dir).saveWorld(world, PACKS)

  const second = createPluginState(resolveConfig({ autoStart: false, persistEveryTicks: 0 }), { storeDir: dir })
  const restored = second.ensureWorld()

  assert.equal(restored.tick, 77, '应当接回存档里的世界，而不是新开一局')
  assert.equal(restored.id, world.id)
  const from = second.restoredFrom()
  assert.ok(from, 'restoredFrom() 必须能说出来——恢复不能是静默行为')
  assert.equal(from.savedAtTick, 77)
  assert.deepEqual(from.packVersions, PACKS)
})

test('恢复：新开的局 restoredFrom() 是 null', () => {
  const state = createPluginState(resolveConfig({ autoStart: false, persistEveryTicks: 0 }), {
    storeDir: join(tmpdir(), 'agent-world-绝对不存在的目录'),
  })
  state.ensureWorld()
  assert.equal(state.restoredFrom(), null)
})

test('恢复：存档里的场景在当前内容里不存在 → **拒绝采用**，改为新开一局并记一条', async () => {
  const dir = await tempDir()
  const world = makeWorld()
  world.tick = 99
  await createWorldStore(dir).saveWorld({ ...world, origin: { ...world.origin, scene: 'scene.根本没有' } }, PACKS)

  const state = createPluginState(resolveConfig({ autoStart: false, persistEveryTicks: 0 }), { storeDir: dir })
  const fresh = state.ensureWorld()

  assert.notEqual(fresh.tick, 99, '场景都不在，接回来只会得到一块空画布')
  assert.equal(state.restoredFrom(), null)
  const problem = state.issues().find((i) => i.where === 'store/world.json')
  assert.ok(problem, '拒绝的原因要留下痕迹')
  assert.match(problem.message, /scene\.根本没有/)
  assert.match(problem.message, /可用场景/, '要列出当前可用的场景')
})

test('恢复：存档坏了 → 照样能起来，并记一条 warning（坏存档不该让插件起不来）', async () => {
  const dir = await tempDir()
  await writeFile(join(dir, WORLD_FILE), '{ 这不是 json', 'utf8')

  const state = createPluginState(resolveConfig({ autoStart: false, persistEveryTicks: 0 }), { storeDir: dir })
  const fresh = state.ensureWorld() // 不抛

  assert.ok(fresh.id.length > 0, '应当新开了一局')
  const problem = state.issues().find((i) => i.where === 'store/world.json')
  assert.ok(problem)
  assert.equal(problem.level, 'warning', '存档读不了不该阻断插件加载')
  assert.match(problem.message, /没被采用/)
})

test('恢复：内容包版本不一致 → **照常采纳**，但把差异写出来', async () => {
  const dir = await tempDir()
  const world = makeWorld()
  world.tick = 12
  await createWorldStore(dir).saveWorld(world, [{ id: 'pack.default', version: '9.9.9' }])

  const state = createPluginState(resolveConfig({ autoStart: false, persistEveryTicks: 0 }), { storeDir: dir })
  const restored = state.ensureWorld()

  assert.equal(restored.tick, 12, '内容升级本来就该改变表现——不该因此拒绝旧存档')
  const note = state.issues().find((i) => i.where === 'store/world.json')
  assert.ok(note)
  assert.match(note.message, /pack\.default@9\.9\.9/)
  assert.match(note.message, /pack\.default@1\.0\.0/, '要说清现在是什么版本')
})

test('恢复：场景还在，但站点/角色被内容改动过 → 仍采纳（内容升级的正常后果）', async () => {
  const dir = await tempDir()
  const world = makeWorld()
  world.agents[0].state = 'idle'
  world.tick = 5
  await createWorldStore(dir).saveWorld(world, PACKS)

  const state = createPluginState(resolveConfig({ autoStart: false, persistEveryTicks: 0 }), { storeDir: dir })
  const restored = state.ensureWorld()
  assert.equal(restored.tick, 5)
  assert.equal(restored.agents.length, world.agents.length)
  // 事件环是空的（不从存档恢复），但 seq 保住——客户端的补洞依赖它单调。
  assert.deepEqual(restored.events, [])
  assert.equal(restored.seq, world.seq)
})

test('端到端：跑一段 → 落盘 → 新起一个状态 → 世界接着跑（重启不丢）', async () => {
  const dir = await tempDir()

  const first = createPluginState(resolveConfig({ autoStart: false, persistEveryTicks: 0 }), { storeDir: dir })
  first.ensureWorld()
  first.dispatch('task.quick-fix')
  const runtime1 = createRuntime({
    service: first,
    tickMs: 100,
    persist: { store: createWorldStore(dir), checkpointEveryTicks: 100_000 },
  })
  runtime1.advance(400)
  await runtime1.flush()

  const second = createPluginState(resolveConfig({ autoStart: false, persistEveryTicks: 0 }), { storeDir: dir })
  const restored = second.ensureWorld()

  assert.equal(restored.tick, 400)
  assert.equal(restored.tasks.length, 3, '派过的工单要还在')
  assert.ok(second.restoredFrom() !== null)

  // 接回来之后还能继续跑，而且世界是活的（不是一份只读快照）。
  const runtime2 = createRuntime({ service: second, tickMs: 100 })
  runtime2.advance(50)
  assert.equal(second.currentWorld().tick, 450)
})

test('存档目录不存在时 saveWorld 会自己建出来', async () => {
  const base = await tempDir()
  const dir = join(base, '深/一点/的目录')
  const store = createWorldStore(dir)

  await store.saveWorld(makeWorld(), PACKS)
  assert.ok((await store.load()) && true)

  await mkdir(join(base, '别的'), { recursive: true })
  await store.appendEvents([emitEvent(makeWorld(), 'world.paused', {})])
  assert.equal((await store.info()).eventLines, 1)
})
