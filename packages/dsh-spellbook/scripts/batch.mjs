#!/usr/bin/env node
/**
 * 把 content/effects 下的文件切成 N 份，打印第 k 份。
 *
 *   node scripts/batch.mjs 1 10    第 1 份（共 10 份）
 *   node scripts/batch.mjs 1 10 --count   只打印份数
 *
 * 为什么要有这个：批量改 332 个文件时，派工的人不该在每份提示词里贴一长串路径 ——
 * 贴错了就是两个工人抢同一批文件、或者有一批谁都没碰。让每个工人自己按编号
 * 取自己的那一份，切法只有这一处定义，就不会错位。
 *
 * 切法：按文件名排序后**连续**切片。连续而不是交错，是为了让同一批文件在目录上
 * 挨着 —— 工人 `ls` 一眼能看出自己那一段的边界。
 */
import { readdirSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const DIR = path.join(ROOT, 'content', 'effects')

const index = Number(process.argv[2])
const total = Number(process.argv[3])

if (!Number.isInteger(index) || !Number.isInteger(total) || total < 1) {
  console.error('用法：node scripts/batch.mjs <第几份 从 1 起> <共几份>')
  process.exit(2)
}

const all = readdirSync(DIR).filter((n) => n.endsWith('.md')).sort()
const size = Math.ceil(all.length / total)
const slice = all.slice((index - 1) * size, index * size)

if (process.argv.includes('--count')) {
  console.log(`共 ${all.length} 个文件，切 ${total} 份，每份最多 ${size} 个`)
  const tail = index > Math.ceil(all.length / size) ? '（越界，是空的）' : ''
  console.log(`第 ${index} 份有 ${slice.length} 个${tail}`)
} else if (!slice.length) {
  console.error(`第 ${index} 份是空的：一共只有 ${Math.ceil(all.length / size)} 份有内容`)
  process.exit(1)
} else {
  for (const name of slice) console.log(`content/effects/${name}`)
  console.error(`\n第 ${index}/${total} 份，共 ${slice.length} 个文件（全库 ${all.length} 个）`)
}
