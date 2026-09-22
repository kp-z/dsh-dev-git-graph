#!/usr/bin/env node
/**
 * 标签词表的查看与体检。
 *
 *   node scripts/tags.mjs           列出词表（按轴分组）
 *   node scripts/tags.mjs audit     体检当前内容：词表外的标签、缺轴的条目、各标签的条数
 *   node scripts/tags.mjs used      只看已经用上的标签与条数
 *
 * 采集工人打标签前应该先跑一次没有参数的那条，把值贴在眼前再挑。
 */
import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { parse } from '../shared/parse.mjs'
import { TAG_AXES, TAG_INDEX, validateTags } from '../shared/tags.mjs'

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const DIR = path.join(ROOT, 'content', 'effects')

function readEntries() {
  return readdirSync(DIR)
    .filter((name) => name.endsWith('.md'))
    .map((name) => ({ file: name, entry: parse(readFileSync(path.join(DIR, name), 'utf8'), name) }))
}

function listVocabulary() {
  for (const axis of TAG_AXES) {
    console.log(`\n【${axis.label} ${axis.key}】${axis.hint} —— ${axis.values.length} 个`)
    const lines = []
    for (let i = 0; i < axis.values.length; i += 6) {
      lines.push('  ' + axis.values.slice(i, i + 6).join('  '))
    }
    console.log(lines.join('\n'))
  }
  console.log(`\n共 ${TAG_AXES.length} 个轴、${TAG_INDEX.size} 个标签。`)
  console.log('每条咒语挑 3–6 个，必须含至少一个「机制」，以及至少一个「场合」或「观感」。')
  console.log('值不在上面的，校验会直接拒绝——缺什么就往 shared/tags.mjs 里加，不要在某一篇里随手写。')
}

function used() {
  const all = readEntries()
  const freq = new Map()
  for (const { entry } of all) {
    for (const tag of entry.meta.tags ?? []) freq.set(tag, (freq.get(tag) ?? 0) + 1)
  }
  const sorted = [...freq.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
  console.log(`用了 ${freq.size} 个不同标签，覆盖 ${all.length} 条咒语。\n`)
  for (const [tag, n] of sorted) {
    const axis = TAG_INDEX.get(tag) ?? '（词表外）'
    console.log(`  ${String(n).padStart(3)}  ${tag.padEnd(18)} ${axis}`)
  }
  const unused = TAG_AXES.flatMap((a) => a.values).filter((t) => !freq.has(t))
  if (unused.length) console.log(`\n还没被用过（${unused.length}）：${unused.join('、')}`)
}

function audit() {
  const all = readEntries()
  const offVocabulary = []
  const axisMissing = []
  const rate = new Map()
  let sizeBad = 0
  for (const { file, entry } of all) {
    const tags = entry.meta.tags ?? []
    const problems = validateTags(tags)
    const off = tags.filter((t) => !TAG_INDEX.has(t))
    if (off.length) offVocabulary.push(`${file}: ${off.join('、')}`)
    if (problems.length && !off.length) axisMissing.push(`${file}: ${problems.join('；')}`)
    if (tags.length < 3 || tags.length > 6) sizeBad++
    for (const t of tags) rate.set(t, (rate.get(t) ?? 0) + 1)
  }
  const axisCount = new Map()
  for (const { entry } of all) {
    for (const t of entry.meta.tags ?? []) {
      const k = TAG_INDEX.get(t)
      if (k) axisCount.set(k, (axisCount.get(k) ?? 0) + 1)
    }
  }
  console.log(`共 ${all.length} 条咒语`)
  console.log(`  用到的不同标签：${rate.size}（词表共 ${TAG_INDEX.size} 个）`)
  console.log(`  条数不在 3–6 之间：${sizeBad}`)
  console.log(`  含词表外标签的条目：${offVocabulary.length}`)
  console.log(`  轴不全的条目：${axisMissing.length}`)
  console.log(`  各轴标签总次数：${[...axisCount].map(([k, v]) => `${k} ${v}`).join(' / ')}`)
  const unused = TAG_AXES.flatMap((a) => a.values).filter((t) => !rate.has(t))
  console.log(`  从未被使用过的标签：${unused.length}`)
  if (offVocabulary.length) {
    console.log(`\n词表外的标签（这些就是「随手写的关键词」）：`)
    for (const line of offVocabulary.slice(0, 25)) console.log('  ' + line)
    if (offVocabulary.length > 25) console.log(`  …还有 ${offVocabulary.length - 25} 条`)
  }
  if (axisMissing.length) {
    console.log(`\n轴不全 / 数量不对：`)
    for (const line of axisMissing.slice(0, 15)) console.log('  ' + line)
  }
}

const command = process.argv[2] ?? 'list'
if (command === 'audit') audit()
else if (command === 'used') used()
else listVocabulary()
