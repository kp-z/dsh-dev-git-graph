/**
 * 连接层：**"多久没消息才算出事"**（R108）。
 *
 * 为什么这个值得单独钉死：R108 的真凶不是某个函数写错了，而是**两个常数之间的关系错了**——
 * 客户端把"过期"阈值写死成 8s，而服务端的心跳间隔是 **15s**。于是**健康的连接**
 * 每 15 秒里也有约 7 秒被判成"过期"，底栏一直在喊「N 秒没收到事件」，
 * 用户看到的是"世界一安静就报警"。
 *
 * 这类 bug 的特征是：**单看任何一处代码都"没错"**（8s 像个合理的超时值），
 * 错的是"阈值必须大于心跳间隔"这条**关系**。所以这里钉的就是那条关系，而不是某个数值。
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'

import { createConnection } from '../web/net/connection.js'

test('R108：过期阈值必须**大于**心跳间隔（阈值比心跳短 = 健康连接也会一直报警）', () => {
  const conn = createConnection({})
  const beat = conn.heartbeat()
  // 还没有任何观测时，用的是兜底假设值——它必须**大于**阈值本身才有意义。
  assert.ok(beat.staleAfterMs > 0, '阈值必须是正数')
  assert.ok(
    beat.staleAfterMs >= 30_000,
    `阈值 ${beat.staleAfterMs}ms 太短了：它必须 ≥ 心跳的两倍多一点（心跳 15s → 阈值 ≥ 30s）。` +
      'R108 就是阈值(8s)比心跳(15s)短，健康连接每 15 秒里有约 7 秒被判成过期。',
  )
})

test('R108：阈值是**按心跳节奏算出来的**，不是写死的常数', () => {
  const conn = createConnection({})
  const beat = conn.heartbeat()
  // 没观测到心跳之前：用兜底假设（15s）→ 两倍 + 余量。
  assert.equal(beat.hintMs, null, '没收到 hello 之前不该有 hint')
  assert.equal(beat.observedGapMs, 0, '没收到 sync 之前不该有观测值')
  assert.equal(beat.staleAfterMs, 35_000, '兜底假设 15s → 15*2+5 = 35s')
})

test('R108：还没连上时"静默"是无穷大，但那是**没意义**的——判据必须结合 connected', () => {
  const conn = createConnection({})
  // `lastMessageMs` 初值 0，所以 silentForMs 一开始就很大。
  // 如果只看它、不看 `connected`，**页面刚打开就会报警**——这是同一类错的另一种形态。
  assert.ok(conn.silentForMs() >= 0)
  assert.equal(conn.status().connected, false, '还没 start()，connected 必须是 false')
})

test('R108：`stop()` 之后 connected 立刻变 false（"真断开"这条判据的来源）', () => {
  const conn = createConnection({})
  conn.stop()
  assert.equal(conn.status().connected, false)
  // ⚠️ `stop()` 是**闭锁**：之后 `start()` 直接返回 null（什么也不做）。
  // 这条不是 bug 而是设计，但必须被知道——断线演练之后要刷新页面才能恢复。
  assert.equal(conn.start(), null, 'stop() 之后 start() 是空操作（闭锁），别指望它重连')
})
