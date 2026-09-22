/**
 * 咒语书 —— 构建
 *
 *   node build.mjs
 *
 * 读取 content/effects/*.md → 解析 → 校验 → 渲染 dist/。
 * 校验不过就退出码 1，并把「哪个文件、哪个字段、为什么」打出来。
 * 坏数据绝不允许静默上线。
 */

import { readFile, writeFile, mkdir, readdir, cp, rm, rename, stat } from 'node:fs/promises'
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

/**
 * 构建先落到这个临时目录，全部写完再整体换名成 dist。
 *
 * 为什么不能直接往 dist 里写：serve.mjs 同时监听 content/ 与 src/ 并自动重建，
 * 而这里开头原本是 `rm -rf dist`。于是「编辑器改动触发的自动构建」和
 * 「手动 node build.mjs」一旦重叠，两边各自删掉对方正在写的目录，
 * dist 就停在半成品上 —— index.html 直接 404、spell/ 只剩二十来个。
 * 换名是瞬时的，中途不会再露出残缺的站点。
 * 带 pid 是为了两个构建撞在一起时各写各的，不互相撕。
 */
const STAGE = path.join(ROOT, `.dist-staging-${process.pid}`)

/**
 * 同一份产物同时只许一个构建写。
 *
 * 光靠"各写各的临时目录、最后换名"还不够：换名到已存在的非空目录在 POSIX 上是
 * ENOTEMPTY，会失败。两个构建都卡在"删掉 dist"和"换名"之间时，后到的那个换不过去，
 * 它的临时目录就整份烂在那儿（实测四路并发出三个完整的孤岛）。
 * 而并发构建同一份产物本来就没有意义，串起来即可。
 */
const LOCK = path.join(ROOT, '.build.lock')
const LOCK_WAIT_MS = 120000

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

async function acquireLock() {
  const deadline = Date.now() + LOCK_WAIT_MS
  for (;;) {
    try {
      await mkdir(LOCK)
      await writeFile(path.join(LOCK, 'pid'), String(process.pid), 'utf8')
      return
    } catch (error) {
      if (error.code !== 'EEXIST') throw error

      // 拿锁的进程要是已经没了，这就是把死锁，清掉重来
      try {
        const owner = Number((await readFile(path.join(LOCK, 'pid'), 'utf8')).trim())
        if (owner) {
          try {
            process.kill(owner, 0)
          } catch {
            await rm(LOCK, { recursive: true, force: true })
            continue
          }
        }
      } catch {
        // pid 文件还没写进去，或已经没了 —— 等下一轮再说
      }

      if (Date.now() > deadline) {
        throw new Error('等构建锁超时：.build.lock 一直被占着')
      }
      await sleep(120)
    }
  }
}

async function releaseLock() {
  await rm(LOCK, { recursive: true, force: true }).catch(() => {})
}
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

async function copyAssets(dest) {
  await cp(path.join(SRC, 'styles'), path.join(dest, 'styles'), { recursive: true })
  await cp(path.join(SRC, 'site.js'), path.join(dest, 'site.js'))
  // 浏览器侧要用同一份「参数 → CSS 值」规则
  await cp(path.join(ROOT, 'shared', 'param.mjs'), path.join(dest, 'param.mjs'))
  // 以及同一份分词与排序规则：站点搜出来的顺序必须与库里一致
  await cp(path.join(ROOT, 'shared', 'vault-text.mjs'), path.join(dest, 'vault-text.mjs'))
  await cp(path.join(ROOT, 'shared', 'rank.mjs'), path.join(dest, 'rank.mjs'))
  const fonts = path.join(SRC, 'fonts')
  if (existsSync(fonts)) {
    await cp(fonts, path.join(dest, 'fonts'), { recursive: true })
  }
  // 画框素材（第三方，改色后使用；来源与许可见 frames/README.md）
  const frames = path.join(SRC, 'frames')
  if (existsSync(frames)) {
    await mkdir(path.join(dest, 'frames'), { recursive: true })
    for (const name of await readdir(frames)) {
      if (!name.endsWith('.png')) continue
      await cp(path.join(frames, name), path.join(dest, 'frames', name))
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

  await rm(STAGE, { recursive: true, force: true })
  await mkdir(path.join(STAGE, 'spell'), { recursive: true })

  await writeFile(path.join(STAGE, 'index.html'), renderIndex(plain), 'utf8')

  for (const [index, { entry }] of sorted.entries()) {
    const dir = path.join(STAGE, 'spell', entry.meta.slug)
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
    path.join(STAGE, 'search-index.json'),
    JSON.stringify(searchIndex(sorted), null, 0) + '\n',
    'utf8',
  )

  await writeFile(
    path.join(STAGE, 'effects.json'),
    JSON.stringify(machineIndex(sorted, chapterMap), null, 2) + '\n',
    'utf8',
  )

  // 编号栏要多宽，取决于**当下载库**里最长的那个罗马数字，而它不是条目数本身：
  // 125 条的 CXXV 只有 44px，可 88 的 LXXXVIII 要 69px。算出来写进 CSS，
  // 库长大了栏会自己变宽，不会悄悄撞到标题上。详见 shared/numeral.mjs。
  await writeFile(
    path.join(STAGE, 'numeral.css'),
    `:root {
  /* 目录每行的编号栏宽（当下载库最宽的是 ${widest.text}） */
  --numeral-w: ${numeralColumnRem(total, { fontSizePx: NUMERAL_ROW_PX })}rem;
  /* 对开页页边注的大编号字号（栏只有 ${RAIL_W}px，再大就出框） */
  --numeral-lead: ${numeralFontRem(total, { maxWidthPx: RAIL_W })}rem;
}
`,
    'utf8',
  )

  await copyAssets(STAGE)

  // 全部写完才动 dist：先删旧的，再整体换名过去。中间那段空窗只有毫秒级，
  // 不会再出现「index.html 404、spell/ 只有一半」那种半成品对外服务。
  await rm(DIST, { recursive: true, force: true })
  await rename(STAGE, DIST)

  /* 收拾别的构建留下的临时目录。临时目录名字末尾就是那个构建的 pid，
     所以判断标准不用猜：**那个进程还活着就别碰**，死了才清。
     先前靠"修改时间超过十分钟"来判，安全但太钝 —— 并发跑几个构建，
     死掉那些目录就都赖着不走（实测一轮留三个）。
     再加一道年龄上限是防 pid 被系统回收重用：构建活不过半分钟，
     三十分钟还挂在那儿的，不管 pid 是谁都该清了。 */
  const PID_REUSE_MS = 30 * 60 * 1000
  const now = Date.now()
  for (const name of await readdir(ROOT)) {
    if (!name.startsWith('.dist-staging-') || name === path.basename(STAGE)) continue
    const dir = path.join(ROOT, name)
    const pid = Number(name.slice('.dist-staging-'.length))
    let alive = false
    try {
      process.kill(pid, 0)
      alive = true
    } catch {
      alive = false
    }
    try {
      const { mtimeMs } = await stat(dir)
      if (!alive || now - mtimeMs > PID_REUSE_MS) {
        await rm(dir, { recursive: true, force: true })
      }
    } catch {
      // 已经没了就算了
    }
  }


  console.log(`咒语书构建完成：${total} 条咒语 → ${path.relative(process.cwd(), DIST)}/`)
  for (const { entry } of sorted) {
    console.log(`  · ${entry.meta.title}（${entry.meta.category}，${entry.meta.stage}）`)
  }
}

async function main() {
  await acquireLock()
  try {
    await build()
  } finally {
    await releaseLock()
  }
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
