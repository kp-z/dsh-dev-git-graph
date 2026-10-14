/**
 * 契约层测试（BACKLOG M1.6-1/4）。
 *
 * 重点在两处：
 * 1. **编解码器是"将来换 protobuf"的接缝**，所以它的行为必须被钉住——
 *    换实现时只要这些测试还绿，调用点就没受影响。
 * 2. **版本不匹配必须在连接建立时就拒绝**，而不是硬着头皮解析出半个东西。
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  PROTOCOL_VERSION,
  WireDecodeError,
  checkCompatibility,
  describeCommand,
  hasSeqGap,
  hello,
  isWorldCommand,
  jsonCodec,
  wireError,
} from '../lib/protocol/index.js'
import { WORLD_COMMAND_KINDS } from '../lib/protocol/index.js'

// ── 版本 ────────────────────────────────────────────────────────────────────

test('版本兼容：相等才通，不等要给可读原因', () => {
  assert.deepEqual(checkCompatibility(PROTOCOL_VERSION), { ok: true, reason: null })

  const older = checkCompatibility(PROTOCOL_VERSION - 1)
  assert.equal(older.ok, false)
  assert.match(older.reason, /协议版本不匹配/)
  assert.match(older.reason, new RegExp(`v${PROTOCOL_VERSION - 1}`))
  assert.match(older.reason, new RegExp(`v${PROTOCOL_VERSION}`), '要同时报出两边的版本，否则没法判断该升哪边')

  for (const bad of [undefined, null, '1', 1.5, {}]) {
    const r = checkCompatibility(bad)
    assert.equal(r.ok, false, `${JSON.stringify(bad)} 不该被当成有效版本`)
    assert.ok(r.reason !== null)
  }
})

// ── 编解码往返 ──────────────────────────────────────────────────────────────

test('jsonCodec：每种消息都能往返', () => {
  const cases = [
    hello('world-abc', 100, PROTOCOL_VERSION),
    { v: PROTOCOL_VERSION, type: 'snapshot', seq: 7, world: { id: 'w', name: 'W' } },
    { v: PROTOCOL_VERSION, type: 'events', seq: 9, events: [{ seq: 8, tick: 1, type: 'world.tick', payload: {} }] },
    { v: PROTOCOL_VERSION, type: 'command', command: { kind: 'reset', name: null } },
    { v: PROTOCOL_VERSION, type: 'ack', command: 'reset', ok: true, detail: null },
    wireError('bad-json', '坏了', PROTOCOL_VERSION),
  ]

  for (const message of cases) {
    const bytes = jsonCodec.encode(message)
    assert.ok(bytes instanceof Uint8Array)
    assert.deepEqual(jsonCodec.decode(bytes), message, `${message.type} 往返后不一致`)
    // 字符串形式也要能解（HTTP 与 SSE 两条路径）。
    assert.deepEqual(jsonCodec.decode(new TextDecoder().decode(bytes)), message)
  }
  assert.match(jsonCodec.contentType, /application\/json/)
})

test('jsonCodec：坏 JSON 报 bad-json，且带上解析器原话', () => {
  assert.throws(
    () => jsonCodec.decode('{ 不是 json'),
    (error) => {
      assert.ok(error instanceof WireDecodeError)
      assert.equal(error.code, 'bad-json')
      assert.match(error.message, /JSON/)
      return true
    },
  )
})

test('jsonCodec：版本不对 → protocol-mismatch，且**在解析形状之前**就拒绝', () => {
  assert.throws(
    // 故意缺 world 字段：如果版本检查在形状检查之后，就会报 bad-shape 而不是协议不匹配，
    // 那样排查方向会被带偏（用户会以为是数据坏了，其实是版本没对齐）。
    () => jsonCodec.decode(JSON.stringify({ v: PROTOCOL_VERSION + 1, type: 'snapshot', seq: 1 })),
    (error) => {
      assert.equal(error.code, 'protocol-mismatch')
      return true
    },
  )
})

test('jsonCodec：不认识的消息类型 → unknown-type 并列出已知类型', () => {
  assert.throws(
    () => jsonCodec.decode(JSON.stringify({ v: PROTOCOL_VERSION, type: '看不懂的东西' })),
    (error) => {
      assert.equal(error.code, 'unknown-type')
      assert.match(error.message, /hello/, '要列出已知类型，否则对方不知道能用什么')
      return true
    },
  )
})

test('jsonCodec：顶层不是对象 → bad-shape', () => {
  for (const bad of ['[]', '"字符串"', 'null', '42']) {
    assert.throws(
      () => jsonCodec.decode(bad),
      (error) => {
        assert.equal(error.code, 'bad-shape')
        return true
      },
      `${bad} 应当被拒`,
    )
  }
})

test('jsonCodec：形状缺字段 → bad-shape，且说清缺什么', () => {
  const cases = [
    [{ v: PROTOCOL_VERSION, type: 'hello' }, /server|tickMs/],
    [{ v: PROTOCOL_VERSION, type: 'snapshot', seq: 1 }, /world/],
    [{ v: PROTOCOL_VERSION, type: 'events', seq: 1 }, /events/],
    [{ v: PROTOCOL_VERSION, type: 'command' }, /command/],
    [{ v: PROTOCOL_VERSION, type: 'ack', command: 'x' }, /ok/],
    [{ v: PROTOCOL_VERSION, type: 'error', code: 'x' }, /message/],
  ]
  for (const [message, pattern] of cases) {
    assert.throws(
      () => jsonCodec.decode(JSON.stringify(message)),
      (error) => {
        assert.equal(error.code, 'bad-shape')
        assert.match(error.message, pattern)
        return true
      },
      `${JSON.stringify(message)} 应当被拒`,
    )
  }
})

// ── seq gap 自愈 ────────────────────────────────────────────────────────────

test('hasSeqGap：倒退与重复投递要判为断裂，前进不算', () => {
  assert.equal(hasSeqGap(5, 9), false, '批是往后推进的，不算断裂')
  assert.equal(hasSeqGap(5, 5), true, '同号 = 重复投递，应当重新拉快照而不是叠加')
  assert.equal(hasSeqGap(9, 5), true, '倒退一定是错')
})

// ── 命令 ────────────────────────────────────────────────────────────────────

test('命令：判别式覆盖完整，且描述是可读中文', () => {
  const commands = [
    { kind: 'pause' },
    { kind: 'resume' },
    { kind: 'reset', name: null },
    { kind: 'reset', name: '新局' },
    { kind: 'dispatch', taskSet: 'task.quick-fix' },
    { kind: 'hire', role: 'engineer', name: null },
    { kind: 'setSpeed', speed: 2 },
  ]
  for (const command of commands) {
    assert.ok(isWorldCommand(command), `${JSON.stringify(command)} 应当是合法命令`)
    const text = describeCommand(command)
    assert.ok(text.length > 0)
    assert.ok(!/undefined|null/.test(text), `描述里不该漏出空值：${text}`)
  }
  assert.equal(describeCommand({ kind: 'reset', name: '新局' }), '重开一局（名为「新局」）')
})

test('命令：非法形状要被拒（线协议解码与工具参数都靠它）', () => {
  for (const bad of [null, undefined, 42, 'pause', {}, { kind: '不存在的命令' }, []]) {
    assert.equal(isWorldCommand(bad), false, `${JSON.stringify(bad)} 不该被当成命令`)
  }
  // 判别式取值表与 describeCommand 的 switch 必须同步——漏一个就会返回 undefined。
  for (const kind of WORLD_COMMAND_KINDS) {
    assert.ok(isWorldCommand({ kind }), `${kind} 在 WORLD_COMMAND_KINDS 里却不是合法命令`)
  }
})

test('命令：WORLD_COMMAND_KINDS 覆盖每一种命令（穷尽性）', () => {
  const seen = new Set(WORLD_COMMAND_KINDS)
  assert.equal(seen.size, WORLD_COMMAND_KINDS.length, '取值表里有重复')
  for (const kind of ['pause', 'resume', 'reset', 'dispatch', 'hire', 'setSpeed']) {
    assert.ok(seen.has(kind), `${kind} 漏在 WORLD_COMMAND_KINDS 之外`)
  }
})
