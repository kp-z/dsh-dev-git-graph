/**
 * 咒语书 —— 构建
 *
 *   node build.mjs
 *
 * 读取 content/effects/*.md → 解析 → 校验 → 渲染 dist/。
 * 校验不过就退出码 1，并把「哪个文件、哪个字段、为什么」打出来。
 * 坏数据绝不允许静默上线。
 */

import { readFile, writeFile, mkdir, readdir, cp, rm } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { parse, ParseError } from './shared/parse.mjs'
import { validateAll, CATEGORIES } from './shared/schema.mjs'
import { buildDemoDocument } from './src/render/demo.mjs'
import { renderIndex, renderSpell, chaptersOf } from './src/render/pages.mjs'
import { stripMechanismMarkers } from './src/render/text.mjs'
import { buildPrompt } from './shared/prompt.mjs'
import { widestNumeral, numeralColumnRem, numeralFontRem } from './shared/numeral.mjs'

/* 目录行的编号字号 0.85rem = 13.6px；页边注那栏是 --rail-w。改 CSS 要同步改这里。 */
const NUMERAL_ROW_PX = 13.6
const RAIL_W = 176

const ROOT = path.dirname(fileURLToPath(import.meta.url))
const CONTENT_DIR = path.join(ROOT, 'content', 'effects')
const DIST = path.join(ROOT, 'dist')
const SRC = path.join(ROOT, 'src')

async function loadEntries() {
  const files = (await readdir(CONTENT_DIR)).filter((name) => name.endsWith('.md')).sort()
  const entries = []
  const parseErrors = []

  for (const file of files) {
    const source = await readFile(path.join(CONTENT_DIR, file), 'utf8')
    const slug = file.replace(/\.md$/, '')
    try {
      entries.push({ entry: parse(source, file), file, slug })
    } catch (error) {
      if (error instanceof ParseError) parseErrors.push(error.message)
      else throw error
    }
  }

  return { entries, parseErrors }
}

function sortEntries(entries) {
  const rank = (entry) => {
    const index = CATEGORIES.indexOf(entry.entry.meta.category)
    return index === -1 ? CATEGORIES.length : index
  }
  return entries.sort(
    (a, b) =>
      rank(a) - rank(b) ||
      String(a.entry.meta.title).localeCompare(String(b.entry.meta.title), 'zh-Hans-CN'),
  )
}

function machineIndex(entries, chapterMap) {
  return {
    generatedAt: new Date().toISOString(),
    count: entries.length,
    categories: CATEGORIES,
    effects: entries.map(({ entry }, index) => ({
      ordinal: index + 1,
      chapter: chapterMap.get(entry.meta.category) ?? 1,
      slug: entry.meta.slug,
      title: entry.meta.title,
      category: entry.meta.category,
      tags: entry.meta.tags ?? [],
      since: entry.meta.since,
      source: entry.meta.source,
      when: entry.meta.when,
      stage: entry.meta.stage,
      params: entry.meta.params ?? [],
      // 机制短语：迁移中必须保留的部分，也是将来匹配器最该索引的字段
      mechanisms: entry.mechanisms,
      description: entry.description,
      notes: entry.notes,
      code: entry.code.map((block) => ({
        lang: block.lang,
        code: stripMechanismMarkers(block.lines.join('\n')),
        mechanismLines: block.mechanismLines,
      })),
      url: `/spell/${entry.meta.slug}/`,
    })),
  }
}

/**
 * 站点检索用的索引。
 *
 * 列名与口径刻意与 shared/vault-text.mjs 的 BM25_WEIGHTS 一一对应 ——
 * 浏览器侧 shared/rank.mjs 就是按这些列名取权重算分的，
 * 这里改名字或漏一列，站点与库的排序就会分道扬镳。
 *
 * 与库里的差别：这里**不带 slug_prior 的历史先验**（构建期不读数据库）。
 * 先验为空时两者结果一致；一旦有先验，parity 测试会红，那时再把权重并进来。
 */
function searchIndex(entries) {
  return {
    version: 1,
    generatedAt: new Date().toISOString(),
    count: entries.length,
    docs: entries.map(({ entry }) => {
      const meta = entry.meta
      return {
        slug: meta.slug,
        // —— 参与打分的列（与 BM25_WEIGHTS 同名同义）——
        title: meta.title,
        when_text: meta.when ?? '',
        tags: (meta.tags ?? []).join(' '),
        mechanisms: (entry.mechanisms ?? []).join(' '),
        code_text: entry.code.map((block) => stripMechanismMarkers(block.lines.join('\n'))).join('\n'),
        description: entry.description ?? '',
        // —— 展示与筛选用 ——
        category: meta.category,
        tier: meta.tier ?? 'candidate',
        stage: meta.stage,
        since: meta.since,
        source: meta.source ?? '',
        url: `spell/${encodeURIComponent(meta.slug)}/`,
        tag_list: meta.tags ?? [],
        mechanism_list: entry.mechanisms ?? [],
        caveat_count: (entry.caveats ?? []).length,
        param_count: (meta.params ?? []).length,
      }
    }),
  }
}

async function copyAssets() {
  await cp(path.join(SRC, 'styles'), path.join(DIST, 'styles'), { recursive: true })
  await cp(path.join(SRC, 'site.js'), path.join(DIST, 'site.js'))
  // 浏览器侧要用同一份「参数 → CSS 值」规则
  await cp(path.join(ROOT, 'shared', 'param.mjs'), path.join(DIST, 'param.mjs'))
  // 以及同一份分词与排序规则：站点搜出来的顺序必须与库里一致
  await cp(path.join(ROOT, 'shared', 'vault-text.mjs'), path.join(DIST, 'vault-text.mjs'))
  await cp(path.join(ROOT, 'shared', 'rank.mjs'), path.join(DIST, 'rank.mjs'))
  const fonts = path.join(SRC, 'fonts')
  if (existsSync(fonts)) {
    await cp(fonts, path.join(DIST, 'fonts'), { recursive: true })
  }
  // 画框素材（第三方，改色后使用；来源与许可见 frames/README.md）
  const frames = path.join(SRC, 'frames')
  if (existsSync(frames)) {
    await mkdir(path.join(DIST, 'frames'), { recursive: true })
    for (const name of await readdir(frames)) {
      if (!name.endsWith('.png')) continue
      await cp(path.join(frames, name), path.join(DIST, 'frames', name))
    }
  }
}

async function build() {
  const { entries, parseErrors } = await loadEntries()

  if (parseErrors.length) {
    console.error('解析失败：\n  ' + parseErrors.join('\n  ') + '\n')
    process.exit(1)
  }

  const { ok, errors } = validateAll(entries)
  if (!ok) {
    console.error('校验失败：\n  ' + errors.join('\n  ') + '\n')
    process.exit(1)
  }

  const sorted = sortEntries(entries)
  const total = sorted.length
  const widest = widestNumeral(total, NUMERAL_ROW_PX, 0.1)
  const plain = sorted.map((item) => item.entry)
  const chapterMap = new Map(chaptersOf(plain).map((chapter) => [chapter.category, chapter.index]))

  await rm(DIST, { recursive: true, force: true })
  await mkdir(path.join(DIST, 'spell'), { recursive: true })

  await writeFile(path.join(DIST, 'index.html'), renderIndex(plain), 'utf8')

  for (const [index, { entry }] of sorted.entries()) {
    const dir = path.join(DIST, 'spell', entry.meta.slug)
    await mkdir(dir, { recursive: true })
    await writeFile(
      path.join(dir, 'index.html'),
      renderSpell(entry, {
        ordinal: index + 1,
        total,
        chapter: { index: chapterMap.get(entry.meta.category) ?? 1 },
      }),
      'utf8',
    )
    await writeFile(path.join(dir, 'demo.html'), buildDemoDocument(entry), 'utf8')
    // 首页「抄咒语」按需取这一份；同时它也是一个能直接 curl 的纯文本咒语
    await writeFile(path.join(dir, 'prompt.txt'), buildPrompt(entry), 'utf8')
  }

  await writeFile(
    path.join(DIST, 'search-index.json'),
    JSON.stringify(searchIndex(sorted), null, 0) + '\n',
    'utf8',
  )

  await writeFile(
    path.join(DIST, 'effects.json'),
    JSON.stringify(machineIndex(sorted, chapterMap), null, 2) + '\n',
    'utf8',
  )

  // 编号栏要多宽，取决于**当下载库**里最长的那个罗马数字，而它不是条目数本身：
  // 125 条的 CXXV 只有 44px，可 88 的 LXXXVIII 要 69px。算出来写进 CSS，
  // 库长大了栏会自己变宽，不会悄悄撞到标题上。详见 shared/numeral.mjs。
  await writeFile(
    path.join(DIST, 'numeral.css'),
    `:root {
  /* 目录每行的编号栏宽（当下载库最宽的是 ${widest.text}） */
  --numeral-w: ${numeralColumnRem(total, { fontSizePx: NUMERAL_ROW_PX })}rem;
  /* 对开页页边注的大编号字号（栏只有 ${RAIL_W}px，再大就出框） */
  --numeral-lead: ${numeralFontRem(total, { maxWidthPx: RAIL_W })}rem;
}
`,
    'utf8',
  )

  await copyAssets()

  console.log(`咒语书构建完成：${total} 条咒语 → ${path.relative(process.cwd(), DIST)}/`)
  for (const { entry } of sorted) {
    console.log(`  · ${entry.meta.title}（${entry.meta.category}，${entry.meta.stage}）`)
  }
}

build().catch((error) => {
  console.error(error)
  process.exit(1)
})
