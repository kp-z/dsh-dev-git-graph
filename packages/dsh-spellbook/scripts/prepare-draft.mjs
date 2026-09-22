#!/usr/bin/env node
/**
 * 草稿预处理：把「好写的格式」变成「合法的 JS」。
 *
 * 草稿是人（或 AI）手写的，写的时候只关心内容。但有两件事 JS 语法不允许，
 * 而且报错都指向症状、不指向原因，手工修容易漏：
 *
 *   1. 描述与代码块里的反引号。它们是给渲染器看的行内代码标记，
 *      但在模板字符串里会直接把字符串截断。这里只转义**内部**的反引号，保留分隔符。
 *   2. 数组里的裸词。`tags: [网格, 响应式]` 语法上合法——汉字是合法标识符——
 *      但求值时会去找同名变量，报「网格 is not defined」。所以要加引号。
 *
 *   node scripts/prepare-draft.mjs drafts/batch-02.mjs
 */

import { readFileSync, writeFileSync } from 'node:fs'

const target = process.argv[2]
if (!target) {
  console.error('用法：node scripts/prepare-draft.mjs <draft.mjs>')
  process.exit(2)
}

let text = readFileSync(target, 'utf8')

/* ── 1. 转义模板字符串内部的反引号 ───────────────────────────────── */

const lines = text.split('\n')
const out = []
let inTemplate = false
let escaped = 0

const escapeInner = (s) =>
  s.replace(/(?<!\\)`/g, () => {
    escaped++
    return '\\`'
  })

for (const line of lines) {
  if (!inTemplate) {
    const match = line.match(/^(\s*(?:description|body): )`(.*)$/)
    if (match) {
      const rest = match[2]
      if (/`,\s*$/.test(rest)) {
        // 同一行就闭合了
        const last = rest.lastIndexOf('`')
        out.push(match[1] + '`' + escapeInner(rest.slice(0, last)) + rest.slice(last))
      } else {
        out.push(match[1] + '`' + escapeInner(rest))
        inTemplate = true
      }
      continue
    }
    out.push(line)
  } else if (/`,\s*$/.test(line)) {
    const last = line.lastIndexOf('`')
    out.push(escapeInner(line.slice(0, last)) + line.slice(last))
    inTemplate = false
  } else {
    out.push(escapeInner(line))
  }
}

text = out.join('\n')

/* ── 2. 给 tags / options 数组里的裸词加引号 ─────────────────────── */

let quoted = 0
text = text.replace(/^(\s*(?:tags|options): )\[([^\]]*)\],?$/gm, (whole, head, inner) => {
  const items = inner
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
    .map((item) => {
      if (/^['"]/.test(item)) return item
      quoted++
      return `'${item}'`
    })
  return head + '[' + items.join(', ') + ']' + (whole.trimEnd().endsWith(',') ? ',' : '')
})

writeFileSync(target, text)

console.log(`预处理 ${target}`)
console.log(`  转义内部反引号：${escaped} 处`)
console.log(`  数组加引号：    ${quoted} 处`)
if (inTemplate) console.log('  ⚠ 有模板字符串没有闭合，检查一下')
