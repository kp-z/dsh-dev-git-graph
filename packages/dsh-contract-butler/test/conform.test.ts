/**
 * 运行时合规判定的单元测试。
 *
 * 这是"不符"的唯一来源，误报会让人不再相信它、漏报会让它形同虚设，所以两条路都要钉住：
 * **声明可选字段缺席不算违规**，**实际多出未声明字段算违规**。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { bytesOf, conforms, sampleOf } from '../lib/conform.js'
import { shapeOf } from '../lib/shape.js'

const declared = shapeOf({ id: 'x', age: 1 })
const withOptional = {
  kind: 'object' as const,
  fields: {
    id: { kind: 'string' as const },
    nick: { kind: 'string' as const, optional: true },
  },
}

test('conforms：完全对得上时没有任何结论', () => {
  assert.deepEqual(conforms(declared, { id: 'a', age: 2 }), [])
})

test('conforms：缺失必填字段是违规', () => {
  const out = conforms(declared, { id: 'a' })
  assert.equal(out.length, 1)
  assert.match(out[0] ?? '', /\$\.age/)
  assert.match(out[0] ?? '', /缺少声明的必填字段/)
})

test('conforms：缺失可选字段不是违规（这是最容易误报的地方）', () => {
  assert.deepEqual(conforms(withOptional, { id: 'a' }), [])
})

test('conforms：多出未声明字段是违规', () => {
  const out = conforms(declared, { id: 'a', age: 1, extra: true })
  assert.equal(out.length, 1)
  assert.match(out[0] ?? '', /\$\.extra/)
  assert.match(out[0] ?? '', /多出未声明/)
})

test('conforms：类型不符是违规，并且不再往里层钻', () => {
  const out = conforms(declared, { id: 123, age: 1 })
  assert.equal(out.length, 1)
  assert.match(out[0] ?? '', /类型不符/)
})

test('conforms：声明不接受 null 时收到 null 算违规，接受则不算', () => {
  assert.equal(conforms(declared, null).length, 1)
  assert.match(conforms(declared, null)[0] ?? '', /不接受 null/)
  const nullable = { kind: 'string' as const, nullable: true }
  assert.deepEqual(conforms(nullable, null), [])
})

test('conforms：声明未给形状时不做任何判定', () => {
  assert.deepEqual(conforms(null, { anything: 1 }), [])
})

test('conforms：数组按元素形状判定', () => {
  const arrayOfObjects = shapeOf({ items: [{ id: 'a' }] })
  assert.deepEqual(conforms(arrayOfObjects, { items: [{ id: 'b' }] }), [])
  const out = conforms(arrayOfObjects, { items: [{ id: 1 }] })
  assert.equal(out.length, 1)
  assert.match(out[0] ?? '', /\$\.items\[\]\.id/)
})

test('conforms：枚举越界只说路径与个数，不把取值写进结论', () => {
  const declaredEnum = { kind: 'string' as const, enumValues: ['new', 'done'] }
  const out = conforms(declaredEnum, 'weird')
  assert.equal(out.length, 1)
  assert.match(out[0] ?? '', /枚举范围/)
  assert.ok(!(out[0] ?? '').includes('weird'), '结论里不该出现实际取值')
})

test('sampleOf：敏感键打码，任意层级都生效', () => {
  const sample = sampleOf(
    { id: 'a', Authorization: 'Bearer secret', nested: { token: 't', ok: true } },
    ['authorization', 'token'],
    4096,
  )
  assert.ok(!sample.includes('Bearer secret'))
  assert.ok(!sample.includes('"t"'))
  assert.ok(sample.includes('***'))
  assert.ok(sample.includes('"id":"a"'))
})

test('sampleOf：超长时按字节截断并标注', () => {
  const sample = sampleOf({ text: 'x'.repeat(5000) }, [], 200)
  assert.ok(Buffer.byteLength(sample, 'utf8') <= 200 + 64)
  assert.match(sample, /已截断/)
})

test('sampleOf：无法序列化的值返回空串而不抛错', () => {
  const cyclic: Record<string, unknown> = {}
  cyclic.self = cyclic
  assert.doesNotThrow(() => sampleOf(cyclic, [], 100))
})

test('bytesOf 量的是真实载荷大小', () => {
  assert.equal(bytesOf({ a: 1 }), Buffer.byteLength('{"a":1}', 'utf8'))
  assert.equal(bytesOf('\u0000'), bytesOf('\u0000'))
})
