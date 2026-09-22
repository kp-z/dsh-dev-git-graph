#!/usr/bin/env node
/**
 * 单文件校验：解析 + 校验，**不碰数据库**。
 *
 * 为什么单独有一个：
 *   批量采集时会有很多只手同时往 content/effects/ 里写条目。主校验入口是
 *   `vault.mjs rebuild`，可它会写 data/vault.db —— 几十个进程一起跑就是抢锁，
 *   而「我这一条写得合不合规」本来也用不着数据库。
 *
 *   所以这里只读文件、只打印结论，可以随便并发。
 *
 *   node scripts/check-file.mjs content/effects/*.md
 *   node scripts/check-file.mjs content/effects/新条目.md
 */

import { readFileSync } from 'node:fs'
import { basename } from 'node:path'
import { parse, ParseError } from '../shared/parse.mjs'
import { validateEntry } from '../shared/schema.mjs'

const files = process.argv.slice(2)
if (!files.length) {
  console.error('用法：node scripts/check-file.mjs <条目.md> [...]')
  process.exit(2)
}

let bad = 0

for (const file of files) {
  const slug = basename(file).replace(/\.md$/, '')
  let entry
  try {
    entry = parse(readFileSync(file, 'utf8'), file)
  } catch (error) {
    bad++
    console.log(`✖ ${slug}`)
    console.log(`    ${error instanceof ParseError ? error.message : error.stack}`)
    continue
  }

  const problems = validateEntry(entry, { file, expectedSlug: slug })
  if (problems.length) {
    bad++
    console.log(`✖ ${slug}`)
    for (const problem of problems) console.log(`    ${problem}`)
  } else {
    console.log(`✔ ${slug}`)
  }
}

console.log(`\n${files.length - bad} 通过 / ${bad} 有问题`)
process.exit(bad ? 1 : 0)
