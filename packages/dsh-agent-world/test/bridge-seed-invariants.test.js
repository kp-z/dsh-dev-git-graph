// seed 的**真宿主不变量**（R30）。
//
// ## 为什么这组测试值得单独存在
//
// 这个 bug 在**所有**用假 `agentLoop` 的测试里都看不见：假的不会校验 seed，照单全收。
// 只有把插件装进真 profile、让真的 `dsh-session` 去 adopt 这条事件，才被照出来：
//
//     seed system/message at index 0 lacks an identified message
//
// 所以这里**照抄真实校验的判据**（`dsh-session/lib/types/index.js` 的
// `assertMessageEventShape` + `validateSessionEventData`），把"真宿主会拒绝什么"
// 变成一条本地就能跑的测试。判据是从实现里读出来的，不是我设计的。
import test from 'node:test'
import assert from 'node:assert/strict'

import { buildSystemPromptSeed, SEED_SEQ, SEED_STEP, SEED_TURN } from '../lib/bridge/index.js'

/** 真宿主的 `system/message` 不变量（逐条对应 assertMessageEventShape）。 */
function assertRealSystemMessageInvariants(event) {
  // ── 信封：必须是对象、有 type/seq/time/data ──
  assert.equal(typeof event, 'object')
  assert.equal(event.type, 'system/message')
  assert.equal(typeof event.seq, 'number')
  assert.equal(typeof event.time, 'number')
  // ── 表面元数据：append 不受 seq 约束（只有 replace 必须引用更早的 seq，见 surface.js）──
  assert.equal(event.surfaceOp, 'append')
  // ── 事件负载 ──
  const data = event.data
  assert.equal(typeof data.turn, 'number')
  assert.equal(typeof data.step, 'number')
  const message = data.message
  // ① 必须被"识别"：id 是非空字符串（这就是真宿主拒掉我们的那一条）
  assert.equal(typeof message.id, 'string')
  assert.notEqual(message.id, '')
  // ② role 必须与类型对应：system/message → 'system'
  assert.equal(message.role, 'system')
  // ③ source 必须是对象且 kind 非空；system/message 还要求恰好是 'system-prompt'
  assert.equal(typeof message.source, 'object')
  assert.equal(message.source.kind, 'system-prompt')
  // ④ content 必须是数组
  assert.ok(Array.isArray(message.content))
}

test('seed 满足真宿主的全部 system/message 不变量（R30 真机拒过一次）', () => {
  const seed = buildSystemPromptSeed('你是工头阿金。', { messageId: 's:persona' })
  assertRealSystemMessageInvariants(seed)
  assert.deepEqual(seed.data.message.content, [{ type: 'text', text: '你是工头阿金。' }])
})

test('messageId 必填：缺失或空串在**我们这边**就抛，而不是在宿主深处变成一句英文', () => {
  for (const bad of [undefined, '', null, 42]) {
    assert.throws(
      () => buildSystemPromptSeed('人设', { messageId: bad }),
      /messageId 必须是非空字符串/,
      `messageId=${String(bad)} 应当在我们这里被拦下`,
    )
  }
})

test('seed 是确定的：同样的输入给同样的输出（time 也由调用方给，便于重放）', () => {
  const a = buildSystemPromptSeed('人设', { messageId: 'm-1', time: 123 })
  const b = buildSystemPromptSeed('人设', { messageId: 'm-1', time: 123 })
  assert.deepEqual(a, b)
  assert.equal(a.time, 123)
})

test('seed 的默认位置：seq/turn/step 都是 0（append 不受 seq 约束，已由真宿主确认）', () => {
  const seed = buildSystemPromptSeed('人设', { messageId: 'm-1' })
  assert.equal(seed.seq, SEED_SEQ)
  assert.equal(seed.data.turn, SEED_TURN)
  assert.equal(seed.data.step, SEED_STEP)
})

test('空人设要抛，且说的是"内容库可能缺字段"——这是内容错误，不是代码错误', () => {
  for (const bad of ['', '   ', undefined, null]) {
    assert.throws(() => buildSystemPromptSeed(bad, { messageId: 'm-1' }), /人设文本是空的/)
  }
})
