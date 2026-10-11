/**
 * spellbook_lookup 的测试 —— 验收 D（被引用自动实现）的第一条路。
 *
 * 护两件事：
 *
 * 1. **正文取得对**。这条工具的全部价值就是把那份 prompt.txt 递到模型手里；
 *    取错了条目、取了半截、或者拼错路径静默返回空串，模型都会一本正经地
 *    按错误的东西去实现，而且不报错。所以这里钉的是「哪一条 + 内容确实来自
 *    那份构建产物」。
 *
 * 2. **注册不成功必须留声**。tools 服务缺失或契约变了的时候，功能会静默消失 ——
 *    表现是「模型从来不用这条工具」，没有任何报错指向这里。所以那条 warn 也在测试里。
 *
 * 另外钉一条 slug 与检索的关系：库里的 RANK_COLUMNS 不含 slug 那一列，所以
 * 「neon-glow」这种最典型的引用形式走检索是搜不到的，必须靠全等短路。这条
 * 一旦被谁「顺手简化掉」，最常用的引用方式就会静默失效。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const DIST = path.join(ROOT, 'dist')

const { lookupSpell, registerSpellbookTool } = await import(
  pathToFileURL(path.join(ROOT, 'lib', 'tool.js')).href
)

test('给 slug 能取回那一整份任务书', async () => {
  const result = await lookupSpell(DIST, 'neon-glow')

  assert.equal(result.found, true)
  assert.equal(result.promptSlug, 'neon-glow')
  // 正文必须是构建期那份 prompt.txt，不是现场拼的
  assert.match(result.prompt, /任务：把「霓虹灯管」这个效果做进我的项目/)
  // 承重的三段都在：机制、边界、参考实现
  assert.match(result.prompt, /机制/)
  assert.match(result.prompt, /容易失效的地方/)
  assert.match(result.prompt, /参考实现/)
})

test('给一句效果描述也能找到，且名次与站点检索一致', async () => {
  const query = '深色招牌上发光的字'
  const result = await lookupSpell(DIST, query)
  assert.equal(result.found, true)
  assert.ok(result.prompt.length > 0, '命中了却没给正文')

  // 与站点同一套打分：dist/rank.mjs 的 buildIndex + rank。
  // 这里独立跑一遍作对照 —— 万一哪天有人在 tool.ts 里换了个便宜的打分，
  // 模型和你在侧边栏里搜到的就会不是同一条，而那种不一致几乎没人会发现。
  const mod = await import(pathToFileURL(path.join(DIST, 'rank.mjs')).href)
  const data = JSON.parse(
    await import('node:fs/promises').then((fs) =>
      fs.readFile(path.join(DIST, 'search-index.json'), 'utf8'),
    ),
  )
  const index = mod.buildIndex(data.docs)
  const expected = mod.rank(index, query, { limit: 6 })[0]

  assert.equal(result.promptSlug, expected.slug, '工具选的第一条与站点检索的第一条不是同一条')
  assert.equal(result.count, 6)
})

test('slug 全等要走短路 —— 检索那一列里根本没有 slug', async () => {
  // 先确认前提还成立：RANK_COLUMNS 里没有 slug，所以这条短路不是多余的优化
  const ranked = await lookupSpell(DIST, 'layered-translucency')
  assert.equal(ranked.promptSlug, 'layered-translucency', 'slug 没有走全等短路')
  assert.match(ranked.items[0], /^layered-translucency · /, '候选行第一项不是 slug 打头')

  const mod = await import(pathToFileURL(path.join(DIST, 'rank.mjs')).href)
  const fs = await import('node:fs/promises')
  const data = JSON.parse(await fs.readFile(path.join(DIST, 'search-index.json'), 'utf8'))
  const index = mod.buildIndex(data.docs)
  const viaRank = mod.rank(index, 'layered-translucency', { limit: 3 })
  const topsOut = viaRank.some((hit) => hit.slug === 'layered-translucency')
  assert.equal(
    topsOut,
    false,
    '检索竟然能直接命中 slug —— 说明 RANK_COLUMNS 变了，这条短路的前提要重看',
  )
})

test('查不到就说清楚，别给个空壳', async () => {
  // 这个查询与库里任何一条都不沾边（实测 0 命中）
  const missing = await lookupSpell(DIST, '量子隧穿霍尔效应')
  assert.equal(missing.found, false)
  assert.equal(missing.prompt, '')
  assert.equal(missing.count, 0)
  assert.ok(missing.hint.length > 0, '没命中却没给下一步提示')

  const blank = await lookupSpell(DIST, '   ')
  assert.equal(blank.found, false)
  assert.match(blank.hint, /slug/)
})

test('命中依据必须给出来 —— 得分高低说明不了相关性', async () => {
  // 钉的是一个反直觉的事实：罕见词会让**无关**条目拿到高分。
  // 「绝对」撞上 hamburger-morph 机制里的「绝对定位」，得分 58；
  // 而正经查「发光」，最好的 neon-glow 只有 4.2 分。
  // 所以不能靠分数设阈值（怎么设都是错的），只能把「命中在哪」交给模型判断。
  const collision = await lookupSpell(DIST, '一个绝对不存在的效果词牌')
  assert.equal(collision.found, true, '模糊检索本来就会给候选 —— 只是不该假装它准')
  assert.ok(collision.items.length > 0)
  for (const line of collision.items) {
    assert.match(line, /命中：/, `候选行没给命中依据，模型无从判断这条对不对：${line}`)
    assert.match(line, /^[a-z0-9-]+ · /, `候选行不是 slug 打头：${line}`)
  }

  // 正经查询的依据该落在「这条咒语是什么」的字段上
  const good = await lookupSpell(DIST, '发光')
  assert.equal(good.promptSlug, 'neon-glow')
  assert.match(good.items[0], /命中：标签「发光」/)
})

test('slug 只当文件名用，不能翻出 dist/', async () => {
  // 库里的数据是构建期生成的，但这道防线只有一行，留着便宜
  const escaped = await lookupSpell(DIST, '../../package.json')
  assert.equal(escaped.prompt.includes('"name"'), false, '读到了包外的东西')
  assert.equal(escaped.found, false)
})

test('注册到 tools 服务：名字、必填参数、以及能真的跑一遍', async () => {
  const registered = []
  const disposers = []
  const ctx = {
    get: (key) => (key === 'tools'
      ? { register: (definition) => { registered.push(definition); return () => disposers.push(definition) } }
      : undefined),
    effect: (fn) => { fn() },
  }

  registerSpellbookTool(ctx, DIST)

  assert.equal(registered.length, 1)
  const tool = registered[0]
  assert.equal(tool.name, 'spellbook_lookup')
  assert.equal(tool.parameters.required.includes('query'), true)
  // 描述里必须点出「先查再实现」，否则模型不会想到用它
  assert.match(tool.description, /先调它/)
  // 输出契约齐全：render 是模型真正读到的东西
  assert.equal(typeof tool.output.render, 'function')

  // 走一遍注册后的 execute —— 而不是直接调 lookupSpell，
  // 因为参数解包那段也只有注册之后才会被跑到
  const value = await tool.execute({ query: 'neon-glow' })
  assert.equal(value.found, true)
  assert.match(value.prompt, /霓虹灯管/)

  const blocks = tool.output.render({}, value)
  assert.equal(blocks.length, 1)
  assert.equal(blocks[0].type, 'text')
  assert.match(blocks[0].text, /霓虹灯管/)
  assert.match(blocks[0].text, /候选|^命中 1 条/m)

  // 参数不合法时不该把正文给出去，也不该抛
  const bad = await tool.execute({})
  assert.equal(bad.found, false)
})

test('声明给模型看的输出契约，必须和实际返回的值对得上', async () => {
  // 这条护的是一种不会报错的坏：schema 说有三个字段、实际返回四个（或反之）。
  // 模型读的是 render 出的文本，但 DSH 侧还会按这份 schema 校验/投影结果 ——
  // 对不上时不会有任何异常，只是模型拿到的和声明的不是一回事。
  let registered = null
  registerSpellbookTool(
    { get: () => ({ register: (d) => { registered = d; return () => {} } }), effect: (fn) => fn() },
    DIST,
  )
  assert.ok(registered)

  const schema = registered.output.schema
  const declared = Object.keys(schema.properties).sort()
  const required = [...schema.required].sort()
  assert.deepEqual(required, declared, 'schema.required 与 properties 对不上')

  const value = await registered.execute({ query: 'neon-glow' })
  assert.deepEqual(
    Object.keys(value).sort(),
    declared,
    '返回值与 output.schema 声明的字段对不上（多一个或少一个都不会报错）',
  )

  const types = {
    boolean: (v) => typeof v === 'boolean',
    number: (v) => typeof v === 'number',
    string: (v) => typeof v === 'string',
    array: (v) => Array.isArray(v),
  }
  for (const key of declared) {
    const kind = schema.properties[key].type
    assert.equal(
      types[kind](value[key]),
      true,
      `${key} 声明是 ${kind}，实际是 ${typeof value[key]}`,
    )
  }

  // 参数契约同样要对得上：模型会按这个填参数
  assert.equal(registered.parameters.type, 'object')
  assert.deepEqual(registered.parameters.required, ['query'])
  assert.deepEqual(
    Object.keys(registered.parameters.properties).sort(),
    ['category', 'query'],
  )
})

test('没有 tools 服务时留一声，且不抛', () => {
  const warnings = []
  const original = console.warn
  console.warn = (...args) => warnings.push(args.join(' '))
  try {
    assert.doesNotThrow(() => registerSpellbookTool({ get: () => undefined }, DIST))
    assert.doesNotThrow(() => registerSpellbookTool({}, DIST))
  } finally {
    console.warn = original
  }
  assert.equal(warnings.length, 2, '没有 tools 服务却没留声 —— 模型为什么不用这条工具就查不出来了')
  assert.match(warnings[0], /spellbook_lookup/)
})
