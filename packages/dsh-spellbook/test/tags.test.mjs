/**
 * 标签系统的测试。
 *
 * 这些用例护着的是「标签词表真的被用上了」这件事。词表本身没坏、但没人按它写，
 * 或者某一篇偷偷写了个词表外的值 —— 两种都会让筛选悄悄失效，而页面看起来完全正常。
 * 所以这里既验词表自身，也把全库 332 条逐一过一遍。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { parse } from '../shared/parse.mjs'
import { TAG_AXES, TAG_INDEX, TAGS_BY_AXIS, validateTags, tagsByAxis } from '../shared/tags.mjs'

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const DIR = path.join(ROOT, 'content', 'effects')

function entries() {
  return readdirSync(DIR)
    .filter((name) => name.endsWith('.md'))
    .map((name) => ({ name, entry: parse(readFileSync(path.join(DIR, name), 'utf8'), name) }))
}

test('词表里没有跨轴重名的标签', () => {
  // 这条守着一个具体的坑：「输入」原先同时在 use（输入框这个场合）与 how
  // （input 事件触发）两个轴上，而 TAG_INDEX 是 flatMap 出来的，后定义的轴会
  // 静默覆盖前面的 —— 写的人以为是场合，查出来归在触发。tags.mjs 里已加了
  // 加载期自检，这里再钉一遍，免得有人把那段自检删了。
  const seen = new Map()
  for (const axis of TAG_AXES) {
    for (const value of axis.values) {
      assert.equal(seen.has(value), false, `「${value}」同时出现在 ${seen.get(value)} 与 ${axis.key} 两个轴`)
      seen.set(value, axis.key)
    }
  }
  assert.equal(seen.size, TAG_INDEX.size)
})

test('四个轴都在，且各自有足够的值', () => {
  assert.deepEqual(
    TAG_AXES.map((axis) => axis.key),
    ['mech', 'look', 'use', 'how'],
  )
  for (const axis of TAG_AXES) {
    assert.ok(axis.label && axis.hint, `${axis.key} 缺 label 或 hint`)
    assert.ok(axis.values.length >= 10, `${axis.key} 只有 ${axis.values.length} 个值，太少了`)
    // 轴内不许重复
    assert.equal(new Set(axis.values).size, axis.values.length, `${axis.key} 轴内有重复值`)
  }
})

test('validateTags 该拒的都拒', () => {
  assert.ok(validateTags([]).length, '空数组应当被拒')
  assert.ok(validateTags(null).length, 'null 应当被拒')
  assert.ok(validateTags(['玻璃']).some((p) => p.includes('机制')), '缺机制轴应当被拒')
  assert.ok(
    validateTags(['backdrop-filter', 'blur']).some((p) => p.includes('场合') || p.includes('观感')),
    '缺场合与观感应当被拒',
  )
  assert.ok(
    validateTags(['backdrop-filter', 'glass']).some((p) => p.includes('不在词表里')),
    '词表外的值应当被拒',
  )
  assert.ok(
    validateTags(['backdrop-filter', 'blur', '玻璃', '玻璃']).some((p) => p.includes('重复')),
    '重复标签应当被拒',
  )
  // 词表外的值报错时要给出相近的值，省得写的人再去翻一遍词表
  assert.match(validateTags(['backdrop-filter', 'blur', '玻璃', '斜纹']).join(' '), /相近的|不在词表里/)
})

test('validateTags 该收的都收', () => {
  assert.deepEqual(validateTags(['backdrop-filter', 'blur', '玻璃', '浮层']), [])
  // 只看观感不看场合也合法：一条纯材质的咒语没有「用在哪」是正常的
  assert.deepEqual(validateTags(['repeating-gradient', '图案', '几何']), [])
})

test('标签数量在 3–6 之间，多了少了都拒', () => {
  assert.ok(validateTags(['backdrop-filter', '玻璃']).some((p) => p.includes('太少')))
  assert.ok(
    validateTags(['backdrop-filter', 'blur', 'mask', 'grid', 'flex', '玻璃', '浮层']).some((p) =>
      p.includes('太多'),
    ),
  )
})

test('全库每一条的标签都合规', () => {
  const all = entries()
  assert.ok(all.length > 300, `只读到 ${all.length} 条，路径或扫描方式可能变了`)
  const bad = []
  for (const { name, entry } of all) {
    const tags = entry.meta.tags ?? []
    const problems = validateTags(tags)
    if (problems.length) bad.push(`${name}: ${problems.join('；')}`)
  }
  assert.deepEqual(bad, [], `有 ${bad.length} 条的标签不合规：\n${bad.slice(0, 10).join('\n')}`)
})

test('词表是「受控」的：全库用到的标签都在词表里，且不散', () => {
  const all = entries()
  const used = new Set()
  for (const { entry } of all) for (const tag of entry.meta.tags ?? []) used.add(tag)

  const stray = [...used].filter((tag) => !TAG_INDEX.has(tag))
  assert.deepEqual(stray, [], '有词表外的标签在用')

  // 词表建立之前是 631 个标签、458 个只出现一次。受控之后用到的种类应当收敛到
  // 词表规模以内，而且绝大多数值都不是孤例 —— 这条用来发现「又变回随手写关键词了」。
  assert.ok(used.size <= TAG_INDEX.size)
  assert.ok(used.size < 260, `用到了 ${used.size} 种标签，词表受控的效果不明显`)
})

test('每个轴在库里都被真的用上了', () => {
  const counts = new Map(TAG_AXES.map((axis) => [axis.key, 0]))
  for (const { entry } of entries()) {
    for (const tag of entry.meta.tags ?? []) {
      const axis = TAG_INDEX.get(tag)
      if (axis) counts.set(axis, counts.get(axis) + 1)
    }
  }
  for (const [axis, count] of counts) {
    assert.ok(count > 0, `${axis} 轴一个标签都没用上`)
  }
})

test('用作筛选的标签能筛出东西，且不是几乎全库', () => {
  // 标签要能当筛子用：一个值如果覆盖全库 90%，它筛不出任何东西。
  const all = entries()
  const counts = new Map()
  for (const { entry } of all) for (const tag of entry.meta.tags ?? []) counts.set(tag, (counts.get(tag) ?? 0) + 1)

  const tooBroad = [...counts].filter(([, n]) => n > all.length * 0.5).map(([t, n]) => `${t}(${n})`)
  assert.deepEqual(tooBroad, [], '有标签覆盖了半个库，它当不了筛子')
})

test('tagsByAxis 按轴分组，丢掉没有值的轴', () => {
  const groups = tagsByAxis(['backdrop-filter', 'blur', '玻璃', '浮层'])
  assert.deepEqual(
    groups.map((g) => [g.key, g.tags]),
    [
      ['mech', ['backdrop-filter', 'blur']],
      ['look', ['玻璃']],
      ['use', ['浮层']],
    ],
  )
  // 没有 how 轴的那组不该出现
  assert.equal(groups.some((g) => g.key === 'how'), false)
  assert.deepEqual(tagsByAxis([]), [])
  assert.deepEqual(tagsByAxis(undefined), [])
})

test('轴的值集合与 TAG_INDEX 一致', () => {
  for (const axis of TAG_AXES) {
    assert.deepEqual(TAGS_BY_AXIS.get(axis.key), axis.values)
    for (const value of axis.values) assert.equal(TAG_INDEX.get(value), axis.key)
  }
})
