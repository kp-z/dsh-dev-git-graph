#!/usr/bin/env node
/**
 * 批量入库。
 *
 * 采集来的效果永远走同一条路：**先入收件箱，再转正**。
 * 收件箱在不可重建的那一区，所以「这条是从哪个 URL 扒来的」这类出处信息天然留存——
 * 不需要另建一个隔离目录，`inbox` 本来就是隔离区。
 *
 *   node scripts/ingest.mjs specs.json --dry-run     # 只预演，不碰库
 *   node scripts/ingest.mjs specs.json               # 真入库
 *   node scripts/ingest.mjs specs.json --only a,b    # 只挑这几条
 *
 * specs.json 是 spec 数组，每个 spec 就是 promote() 要的形状，外加两个下划线开头的
 * 采集元数据（不会被写进 md）：
 *
 *   _rawRef    出处 URL，写进收件箱的 raw_ref
 *   _origin    来源分类，默认 crawl
 *   _titleGuess / _categoryGuess  进收件箱的猜测值，方便日后回看
 *
 * 一条失败不影响其余：整批跑完再汇总。有任何一条没过，退出码非零。
 */

import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

import { defaultVaultPaths, openVault } from '../shared/vault.mjs'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')

/** 下划线开头的是采集元数据，不进 md。 */
const META_KEYS = new Set(['_rawRef', '_origin', '_titleGuess', '_categoryGuess', '_note'])

function toSpec(raw) {
  const spec = {}
  for (const [key, value] of Object.entries(raw)) {
    if (!META_KEYS.has(key)) spec[key] = value
  }
  return spec
}

function parseArgs(argv) {
  const args = { file: null, dryRun: false, only: null }
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === '--dry-run') args.dryRun = true
    else if (arg === '--only') args.only = new Set((argv[++i] ?? '').split(',').filter(Boolean))
    else if (!args.file) args.file = arg
  }
  return args
}

/**
 * 草稿可以写成 .json，也可以写成 .mjs。
 * 推荐 .mjs：代码块是多行 CSS/HTML，用模板字符串写比在 JSON 里转义 \n 舒服得多。
 */
async function loadSpecs(file) {
  if (/\.[cm]?js$/.test(file)) {
    const mod = await import(pathToFileURL(resolve(file)).href)
    const list = mod.default ?? mod.specs
    if (!Array.isArray(list)) throw new Error(`${file} 没有默认导出 spec 数组`)
    return list
  }
  const parsed = JSON.parse(readFileSync(file, 'utf8'))
  const list = Array.isArray(parsed) ? parsed : parsed.entries
  if (!Array.isArray(list)) throw new Error(`${file} 里没有找到 spec 数组（顶层数组或 .entries）`)
  return list
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  if (!args.file) {
    console.error('用法：node scripts/ingest.mjs <specs.json|specs.mjs> [--dry-run] [--only slug,slug]')
    process.exit(2)
  }

  const all = await loadSpecs(args.file)
  const specs = args.only ? all.filter((s) => args.only.has(s.slug)) : all
  if (!specs.length) {
    console.log('没有要处理的条目。')
    return
  }

  const vault = openVault(defaultVaultPaths(ROOT))
  const adopted = []
  const failed = []

  try {
    vault.ensureFresh()

    for (const raw of specs) {
      const spec = toSpec(raw)
      const label = spec.slug ?? '(缺 slug)'
      const { problems } = vault.checkEntry(spec)

      if (problems.length) {
        failed.push({ slug: label, problems })
        continue
      }

      if (args.dryRun) {
        adopted.push({ slug: label, title: spec.title, note: '预演通过' })
        continue
      }

      try {
        // 先记出处，再转正：即使转正失败，收件箱里也留下了「试图加过这条」的痕迹。
        const inboxId = vault.intake({
          origin: raw._origin ?? 'crawl',
          rawRef: raw._rawRef ?? null,
          titleGuess: raw._titleGuess ?? spec.title ?? null,
          categoryGuess: raw._categoryGuess ?? spec.category ?? null,
          note: raw._note ?? null,
        })
        vault.promote(inboxId, spec)
        adopted.push({ slug: label, title: spec.title })
      } catch (error) {
        failed.push({ slug: label, problems: [error.message ?? String(error)] })
      }
    }
  } finally {
    vault.close()
  }

  const head = args.dryRun ? '预演' : '入库'
  console.log(`\n${head}完成：通过 ${adopted.length} 条，未通过 ${failed.length} 条\n`)

  for (const item of adopted) {
    console.log(`  ok   ${item.slug}  ${item.title ?? ''}`)
  }
  for (const item of failed) {
    console.log(`  FAIL ${item.slug}`)
    for (const problem of item.problems) console.log(`         ${problem}`)
  }

  if (failed.length) process.exit(1)
}

await main()
