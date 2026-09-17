/**
 * 形状与差异判定的单元测试。
 *
 * 这里盯的是"契约有没有变、往哪边变"这个判断本身：它是整个插件的判定核心，一旦判错，
 * 上面所有界面展示都会自信地骗人。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  canonicalize,
  diffShape,
  mergeShape,
  parseShape,
  shapeHash,
  shapeOf,
  textHash,
} from '../lib/shape.js'

test('shapeOf 认出基本类型', () => {
  assert.deepEqual(shapeOf('a'), { kind: 'string' })
  assert.deepEqual(shapeOf(1), { kind: 'number' })
  assert.deepEqual(shapeOf(true), { kind: 'boolean' })
  assert.deepEqual(shapeOf(null), { kind: 'null' })
  assert.deepEqual(shapeOf(undefined), { kind: 'unknown' })
})

test('shapeOf 递归对象并按 key 排序，不收集枚举时字符串不带 enumValues', () => {
  assert.deepEqual(shapeOf({ b: 1, a: 'x' }), {
    kind: 'object',
    fields: { a: { kind: 'string' }, b: { kind: 'number' } },
  })
  assert.deepEqual(shapeOf('x', { enums: true }), { kind: 'string', enumValues: ['x'] })
})

test('shapeOf 数组合并元素形状，混合类型塌成 unknown', () => {
  assert.deepEqual(shapeOf([1, 2]), { kind: 'array', of: { kind: 'number' } })
  assert.deepEqual(shapeOf([1, 'a']), { kind: 'array', of: { kind: 'unknown' } })
  assert.deepEqual(shapeOf([]), { kind: 'array' })
})

test('mergeShape：null 合并只开 nullable，对象单侧字段变可选，类型冲突塌成 unknown', () => {
  assert.deepEqual(mergeShape({ kind: 'string' }, { kind: 'null' }), { kind: 'string', nullable: true })
  assert.deepEqual(mergeShape({ kind: 'string' }, { kind: 'number' }), { kind: 'unknown' })
  const merged = mergeShape(
    { kind: 'object', fields: { a: { kind: 'string' } } },
    { kind: 'object', fields: { b: { kind: 'number' } } },
  )
  assert.deepEqual(merged, {
    kind: 'object',
    fields: { a: { kind: 'string', optional: true }, b: { kind: 'number', optional: true } },
  })
})

test('shapeHash 对同结构稳定、对字段顺序不敏感、对 null 是空串', () => {
  const a = shapeOf({ x: 1, y: 2 })
  const b = shapeOf({ y: 2, x: 1 })
  assert.equal(shapeHash(a), shapeHash(b))
  assert.equal(shapeHash(null), '')
  assert.notEqual(shapeHash(shapeOf({ x: 1 })), shapeHash(shapeOf({ x: '1' })))
})

test('canonicalize 去掉空值并排序枚举取值', () => {
  assert.deepEqual(canonicalize({ kind: 'string', enumValues: ['b', 'a'], optional: false }), {
    kind: 'string',
    enumValues: ['a', 'b'],
  })
})

test('diffShape 把字段删除 / 类型改变 / 收紧判为破坏', () => {
  const before = shapeOf({ id: 'x', age: 1 })
  const after = shapeOf({ id: 2 })
  const diff = diffShape(before, after)
  const paths = diff.breaking.map((item) => item.path)
  assert.ok(paths.includes('$.age'), `期望 $.age 被删，实际 ${JSON.stringify(diff.breaking)}`)
  assert.ok(paths.includes('$.id'), `期望 $.id 类型改变，实际 ${JSON.stringify(diff.breaking)}`)
})

test('diffShape 把新增可选字段判为非破坏，新增必填字段判为破坏', () => {
  const before = shapeOf({ id: 'x' })
  const afterOptional = {
    kind: 'object' as const,
    fields: { id: { kind: 'string' as const }, nick: { kind: 'string' as const, optional: true } },
  }
  const optionalDiff = diffShape(before, afterOptional)
  assert.deepEqual(optionalDiff.breaking, [])
  assert.equal(optionalDiff.compatible.length, 1)

  const afterRequired = {
    kind: 'object' as const,
    fields: { id: { kind: 'string' as const }, email: { kind: 'string' as const } },
  }
  const diff = diffShape(before, afterRequired)
  assert.equal(diff.breaking.length, 1)
  assert.equal(diff.breaking[0]?.path, '$.email')
})

test('diffShape：契约消失是破坏，凭空出现是非破坏', () => {
  assert.equal(diffShape(shapeOf({ a: 1 }), null).breaking.length, 1)
  assert.equal(diffShape(null, shapeOf({ a: 1 })).breaking.length, 0)
  assert.equal(diffShape(null, shapeOf({ a: 1 })).compatible.length, 1)
})

test('diffShape 枚举取值被删是破坏，新增是非破坏', () => {
  const before = { kind: 'string' as const, enumValues: ['a', 'b'] }
  const after = { kind: 'string' as const, enumValues: ['b', 'c'] }
  const diff = diffShape(before, after)
  assert.equal(diff.breaking.length, 1)
  assert.match(diff.breaking[0]?.detail ?? '', /a/)
  assert.equal(diff.compatible.length, 1)
  assert.match(diff.compatible[0]?.detail ?? '', /c/)
})

test('parseShape 接受合法形状、拒绝脏数据、递归规范化', () => {
  assert.equal(parseShape(null), null)
  assert.equal(parseShape('nope'), null)
  assert.equal(parseShape({ kind: 'bogus' }), null)
  // 没有元素形状的数组本身是合法的（声明了"是数组"，只是没约束元素）。
  assert.deepEqual(parseShape({ kind: 'array' }), { kind: 'array' })
  const parsed = parseShape({
    kind: 'object',
    fields: { ok: { kind: 'boolean' }, bad: { kind: 'nope' } },
    extra: 'ignored',
  })
  assert.deepEqual(parsed, { kind: 'object', fields: { ok: { kind: 'boolean' } } })
  assert.deepEqual(parseShape({ kind: 'array', of: { kind: 'string' } }), {
    kind: 'array',
    of: { kind: 'string' },
  })
})

test('textHash 稳定且长度固定', () => {
  assert.equal(textHash('abc'), textHash('abc'))
  assert.notEqual(textHash('abc'), textHash('abd'))
  assert.equal(textHash('abc').length, 16)
})
