import { test } from 'node:test'
import assert from 'node:assert/strict'

import { parse } from '../shared/parse.mjs'
import { validateEntry, validateAll, CATEGORIES, STAGES } from '../shared/schema.mjs'

function make(overrides = {}, body = {}) {
  const fm = {
    title: '液态玻璃面板',
    slug: 'liquid-glass',
    category: '材质',
    since: '2025-09',
    source: '自行实现',
    when: '需要一块浮在内容之上的面板',
    stage: 'photo',
    ...overrides,
  }
  const lines = Object.entries(fm)
    .filter(([, v]) => v !== undefined)
    .map(([k, v]) => {
      if (k === 'params') {
        return `${k}:\n` + v.map((p) => `  - { ${Object.entries(p).map(([a, b]) => `${a}: ${b}`).join(', ')} }`).join('\n')
      }
      if (Array.isArray(v)) return `${k}: [${v.join(', ')}]`
      return `${k}: ${v}`
    })

  const source = `---
${lines.join('\n')}
---

## 描述

机制是 ==${body.mechanism ?? 'backdrop-filter'}==。

## 代码

\`\`\`css
.glass {
  /* @mechanism */
  backdrop-filter: ${body.uses ?? 'blur(var(--blur, 18px))'};
}
\`\`\`
`
  return parse(source, body.file ?? 'liquid-glass.md')
}

test('合法条目通过校验', () => {
  const params = [
    { name: 'blur', label: '模糊', type: 'range', min: 0, max: 40, step: 1, default: 18, unit: 'px' },
  ]
  const entry = make({ params })
  assert.deepEqual(validateEntry(entry, { file: 'a.md', expectedSlug: 'liquid-glass' }), [])
})

test('缺少 source 必须报错（不能被后续逻辑吃掉）', () => {
  const entry = make({ source: undefined })
  const problems = validateEntry(entry, { file: 'a.md' })
  assert.equal(problems.length, 1)
  assert.match(problems[0], /source/)
})

test('缺少多个必填字段时一个都不能丢', () => {
  const entry = make({ source: undefined, when: undefined, since: undefined })
  const problems = validateEntry(entry, { file: 'a.md' })
  assert.equal(problems.length, 3)
  for (const key of ['source', 'when', 'since']) {
    assert.ok(
      problems.some((p) => p.includes(key)),
      `应该报出 ${key}，实际：${problems.join(' | ')}`,
    )
  }
})

test('非法 category 与 stage 都被拦下，并列出允许值', () => {
  const bad = validateEntry(make({ category: '玄学', stage: 'rainbow' }), { file: 'a.md' })
  assert.ok(bad.some((p) => /category/.test(p) && p.includes('材质')))
  assert.ok(bad.some((p) => /stage/.test(p) && p.includes('plain')))
})

test('slug 与文件名不一致会被指出', () => {
  const problems = validateEntry(make(), { file: 'a.md', expectedSlug: 'other' })
  assert.ok(problems.some((p) => /不一致/.test(p)))
})

test('since 必须是 YYYY-MM', () => {
  const problems = validateEntry(make({ since: '2025/09/01' }), { file: 'a.md' })
  assert.ok(problems.some((p) => /YYYY-MM/.test(p)))
})

test('参数重名会被指出', () => {
  const params = [
    { name: 'blur', label: '模糊', type: 'range', min: 0, max: 40, default: 18 },
    { name: 'blur', label: '再模糊', type: 'range', min: 0, max: 40, default: 20 },
  ]
  const problems = validateEntry(make({ params }), { file: 'a.md' })
  assert.ok(problems.some((p) => /重复/.test(p)))
})

test('range 参数缺 min 会被指出', () => {
  const params = [{ name: 'blur', label: '模糊', type: 'range', max: 40, default: 18 }]
  const problems = validateEntry(make({ params }), { file: 'a.md' })
  assert.ok(problems.some((p) => /缺少数字 min/.test(p)))
})

test('参数在代码里没被用到会被指出（否则滑杆是假的）', () => {
  const params = [
    { name: 'blur', label: '模糊', type: 'range', min: 0, max: 40, default: 18 },
    { name: 'ghost', label: '幽灵', type: 'range', min: 0, max: 1, default: 0.5 },
  ]
  const entry = make({ params }, { uses: 'blur(var(--blur, 18px))' })
  const problems = validateEntry(entry, { file: 'a.md' })
  assert.equal(problems.length, 1)
  assert.match(problems[0], /ghost/)
  assert.match(problems[0], /var\(--ghost\)/)
})

test('slug 跨条目重复会被指出', () => {
  const a = make()
  const b = make()
  const { ok, errors } = validateAll([
    { entry: a, file: 'a.md', slug: 'liquid-glass' },
    { entry: b, file: 'b.md', slug: 'liquid-glass' },
  ])
  assert.equal(ok, false)
  assert.ok(errors.some((e) => /重复/.test(e) && e.includes('a.md')))
})

test('枚举值与文档一致', () => {
  assert.deepEqual(CATEGORIES, ['材质', '动效', '排版', '交互', '布局', '图形'])
  assert.deepEqual(STAGES, ['plain', 'photo', 'grid', 'dark'])
})
