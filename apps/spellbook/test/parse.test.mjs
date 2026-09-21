import { test } from 'node:test'
import assert from 'node:assert/strict'

import { parse, ParseError } from '../shared/parse.mjs'

const VALID = `---
title: 液态玻璃面板
slug: liquid-glass
category: 材质
tags: [玻璃, 模糊, 深色模式]
since: 2025-09
source: 自行实现
when: 需要一块浮在内容之上的面板
stage: photo
params:
  - { name: blur, label: 模糊, type: range, min: 0, max: 40, step: 1, default: 18, unit: px }
  - { name: tint, label: 不透明度, type: range, min: 0.1, max: 0.9, step: 0.05, default: 0.55 }
---

## 描述

做成会呼吸的玻璃面。机制是 ==backdrop-filter 的 blur 与 saturate==。

## 代码

\`\`\`css
.glass {
  /* @mechanism */
  backdrop-filter: blur(var(--blur, 18px));
  background: rgb(255 255 255 / var(--tint, 0.55));
}
\`\`\`

## 备注

- 白底上看不出效果。
`

test('解析一条完整的咒语', () => {
  const entry = parse(VALID, 'liquid-glass.md')

  assert.equal(entry.meta.title, '液态玻璃面板')
  assert.equal(entry.meta.slug, 'liquid-glass')
  assert.equal(entry.meta.since, '2025-09')
  assert.equal(entry.meta.stage, 'photo')
  assert.deepEqual(entry.meta.tags, ['玻璃', '模糊', '深色模式'])
  assert.equal(entry.meta.params.length, 2)
  assert.equal(entry.meta.params[0].name, 'blur')
  assert.equal(entry.meta.params[0].default, 18)
  assert.equal(entry.meta.params[1].name, 'tint')

  assert.deepEqual(entry.mechanisms, ['backdrop-filter 的 blur 与 saturate'])
  assert.equal(entry.code.length, 1)
  assert.equal(entry.code[0].lang, 'css')
  assert.deepEqual(entry.code[0].mechanismLines, [1])
  assert.deepEqual(entry.notes, ['白底上看不出效果。'])
})

test('保留 @mechanism 标记本身，供渲染层剔除', () => {
  const entry = parse(VALID, 'liquid-glass.md')
  assert.match(entry.code[0].lines[1], /@mechanism/)
})

test('tags 支持裸词流式数组', () => {
  const entry = parse(VALID, 'x.md')
  assert.deepEqual(entry.meta.tags, ['玻璃', '模糊', '深色模式'])
})

test('params 支持缩进短横线列表加内联对象', () => {
  const entry = parse(VALID, 'x.md')
  assert.equal(entry.meta.params[0].unit, 'px')
  assert.equal(entry.meta.params[1].min, 0.1)
})

test('多行流式对象也能配平', () => {
  const source = `---
title: t
slug: t
category: 材质
since: 2025-09
source: s
when: w
stage: plain
params: [
  { name: a, label: A, type: range, min: 0, max: 1, default: 0.5 },
  { name: b, label: B, type: range, min: 0, max: 1, default: 0.5 }
]
---

## 描述
机制是 ==X==。

## 代码
\`\`\`css
.a { /* @mechanism */ opacity: var(--a, 0.5); color: var(--b); }
\`\`\`
`
  const entry = parse(source, 'multi.md')
  assert.equal(entry.meta.params.length, 2)
  assert.equal(entry.meta.params[1].name, 'b')
})

test('缺少 ## 代码 会报错并指出文件名', () => {
  const broken = VALID.replace(/## 代码[\s\S]*$/, '')
  assert.throws(
    () => parse(broken, 'broken.md'),
    (error) => {
      assert.ok(error instanceof ParseError)
      assert.match(error.message, /broken\.md/)
      assert.match(error.message, /## 代码/)
      return true
    },
  )
})

test('==机制== 不成对会报错', () => {
  const broken = VALID.replace('==backdrop-filter 的 blur 与 saturate==', '==没闭合')
  assert.throws(() => parse(broken, 'broken.md'), /没有成对/)
})

test('描述里一处机制都不标会报错', () => {
  const broken = VALID.replace('==backdrop-filter 的 blur 与 saturate==', 'backdrop-filter')
  assert.throws(() => parse(broken, 'broken.md'), /至少要标出一处/)
})

test('代码里没有 @mechanism 会报错', () => {
  const broken = VALID.replace('/* @mechanism */', '')
  assert.throws(() => parse(broken, 'broken.md'), /@mechanism/)
})

test('frontmatter 没有闭合会报错', () => {
  assert.throws(() => parse('---\ntitle: x\n\n## 描述\n', 'x.md'), /闭合/)
})

test('文件开头没有 --- 会报错', () => {
  assert.throws(() => parse('## 描述\n', 'x.md'), /缺少 frontmatter/)
})

test('代码围栏没闭合会报错', () => {
  const broken = VALID.replace(/\n\`\`\`\n\n## 备注/, '\n\n## 备注')
  assert.throws(() => parse(broken, 'broken.md'), /围栏/)
})

test('围栏里的 ## 不会被当成小节标题', () => {
  const source = `---
title: t
slug: t
category: 材质
since: 2025-09
source: s
when: w
stage: plain
---

## 描述
机制是 ==X==。

## 代码
\`\`\`sh
## 这是注释，不是小节
echo hi   # @mechanism
\`\`\`

## 备注
- 备注还在。
`
  const entry = parse(source, 'fence.md')
  assert.equal(entry.code[0].lines.length, 2)
  assert.deepEqual(entry.notes, ['备注还在。'])
})

test('备注可以整节省略', () => {
  const source = VALID.replace(/## 备注[\s\S]*$/, '')
  const entry = parse(source, 'no-notes.md')
  assert.deepEqual(entry.notes, [])
})
