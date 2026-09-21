/**
 * 咒语库协议的测试。
 *
 * 这里盯的不是「代码跑得动」，而是几条不能破的规矩：
 *   · events 事件流在 rebuild 之后必须一行不少
 *   · 机制短语的排序权重必须真的高过标题
 *   · promote 是唯一写 md 的入口，写坏了必须回滚
 *   · tier=core 这道闸门真的把归档挡在外面
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

import {
  BOOKKEEPING_TABLES,
  DURABLE_TABLES,
  LIBRARY_TABLES,
  openVault,
  VaultError,
} from '../shared/vault.mjs'
import { matchExpr, units } from '../shared/vault-text.mjs'

/* ------------------------------------------------------------------ *
 * 夹具：在临时目录里造一个独立的内容库，绝不碰 content/
 * ------------------------------------------------------------------ */

/** 造一条能过 parse + validate 的合法条目。 */
function entryMd({
  slug,
  title,
  category = '材质',
  when = '需要它的时候',
  stage = 'plain',
  tier = null,
  mech = 'backdrop-filter blur',
  param = 'blur',
  caveats = [],
}) {
  const boundary = caveats.length
    ? `## 边界\n\n${caveats.map((c) => `- ${c}`).join('\n')}\n\n`
    : ''
  return `---
title: ${title}
slug: ${slug}
category: ${category}
tags: [测试]
since: 2026-01
source: 测试
when: ${when}
stage: ${stage}${tier ? `\ntier: ${tier}` : ''}
params:
  - { name: ${param}, label: 程度, type: range, min: 0, max: 40, step: 1, default: 8, unit: px }
---

## 描述

这是${title}。它靠的是 ==${mech}==，这句话里放的机制短语权重最高。

## 代码

\`\`\`css
.x {
  filter: ${param}(var(--${param}, 8px)); /* @mechanism */
}
\`\`\`

${boundary}## 备注

- 一条备注。
`
}

function fixture(entries) {
  const dir = mkdtempSync(join(tmpdir(), 'spellbook-vault-'))
  const contentDir = join(dir, 'effects')
  mkdirSync(contentDir, { recursive: true })
  for (const e of entries) writeFileSync(join(contentDir, `${e.slug}.md`), entryMd(e), 'utf8')
  return {
    contentDir,
    dbPath: join(dir, 'vault.db'),
    path: (slug) => join(contentDir, `${slug}.md`),
    cleanup: () => rmSync(dir, { recursive: true, force: true }),
  }
}

/**
 * 常用夹具：甲条把词放在机制里，乙条把同一个词放在标题里。
 * 后面三条不含「指针」，是必要的——bm25 的 IDF 在「词出现在过半文档里」时是负的，
 * 只有 2 条文档演示不出权重差别。这是 bm25 的真实性质，不是测试的将就。
 */
const MECH_VS_TITLE = [
  { slug: 'a-mech', title: '效果甲', mech: '指针 跟随', when: '甲场合', tier: 'core' },
  { slug: 'b-title', title: '指针效果', mech: '模糊 平滑', when: '乙场合', tier: 'core' },
  { slug: 'c-fill', title: '跑马灯', mech: '位移 循环', when: '丙场合', tier: 'core' },
  { slug: 'd-fill', title: '淡入', mech: '透明度 过渡', when: '丁场合', tier: 'core' },
  { slug: 'e-fill', title: '缩放', mech: 'scale 变换', when: '戊场合', tier: 'core' },
]

/* ------------------------------------------------------------------ *
 * 文本层
 * ------------------------------------------------------------------ */

test('中文按双字成短语，不按单字', () => {
  assert.deepEqual(units('玻璃'), [['玻', '璃']])
  assert.deepEqual(units('玻璃面板'), [
    ['玻', '璃'],
    ['璃', '面'],
    ['面', '板'],
  ])
  // 量词与虚词组成的双字没有信息量，必须被丢掉
  const noisy = units('我想要一块玻璃')
  assert.ok(
    noisy.some((u) => u.join('') === '玻璃'),
    '真正的词要留下',
  )
  assert.ok(
    !noisy.some((u) => u.join('') === '一块' || u.join('') === '我想'),
    '量词与虚词的双字要丢掉',
  )
  // 英文整词保留
  assert.deepEqual(units('backdrop-filter'), [['backdrop-filter']])
})

test('全是虚词时给不出检索表达式', () => {
  assert.equal(matchExpr('我想要一个'), null)
  assert.equal(matchExpr('   '), null)
  assert.equal(matchExpr('玻璃'), '"玻 璃"')
})

test('库表白名单里不许出现 events —— 这是不可重建历史的保证', () => {
  assert.ok(!LIBRARY_TABLES.includes('events'), 'events 出现在删除白名单里了')
  assert.ok(!LIBRARY_TABLES.includes('proposals'))
  assert.ok(!LIBRARY_TABLES.includes('inbox'))
})

test('库里每张表都必须被登记为「投影 / 历史 / 记账」之一', () => {
  const fx = fixture([{ slug: 'one', title: '随便一条', tier: 'core' }])
  const vault = openVault(fx)
  try {
    vault.rebuild()

    const registered = new Set([...LIBRARY_TABLES, ...DURABLE_TABLES, ...BOOKKEEPING_TABLES])
    // 两类内部表不归我们管：
    //   sqlite_sequence —— AUTOINCREMENT 自带的
    //   match_fts_*     —— FTS5 虚拟表的影子表，由 match_fts 派生（注意 `match_fts` 本身要登记）
    const INTERNAL = /^(sqlite_sequence$|match_fts_)/
    const actual = vault.db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
      .all()
      .map((r) => r.name)
      .filter((name) => !INTERNAL.test(name))

    assert.deepEqual(
      actual.filter((name) => !registered.has(name)),
      [],
      '有表没被归类：新加表必须登记进 LIBRARY_TABLES 或 DURABLE_TABLES',
    )
    assert.deepEqual(
      [...registered].filter((name) => !actual.includes(name)),
      [],
      '白名单里有不存在的表：改名或删表后忘了同步',
    )

    // 两个白名单绝不能重叠——重叠意味着某张表同时算「可重建」和「永不删」
    const overlap = LIBRARY_TABLES.filter((t) => DURABLE_TABLES.includes(t))
    assert.deepEqual(overlap, [], `这些表同时出现在两个白名单里：${overlap.join(' ')}`)
  } finally {
    vault.close()
    fx.cleanup()
  }
})

test('search 的载荷是对称的，且不外露 bm25 原始分', () => {
  const fx = fixture([{ slug: 'one', title: '玻璃面板', tier: 'core', caveats: ['白底看不出来'] }])
  const vault = openVault(fx)
  try {
    vault.rebuild()
    const [hit] = vault.search('玻璃')
    assert.ok(hit, '该命中一条')

    for (const field of ['mechanisms', 'tags', 'caveats']) {
      assert.ok(Array.isArray(hit[field]), `${field} 应当一并返回，否则调用方还得再 get() 一次`)
    }
    assert.equal(hit.raw, undefined, 'raw 是内部实现细节，默认不该外露')
    assert.ok(hit.why, 'why 要有')

    const [withRaw] = vault.search('玻璃', { debug: true })
    assert.equal(typeof withRaw.raw, 'number', 'debug 打开时才给原始分')
  } finally {
    vault.close()
    fx.cleanup()
  }
})

test('resolve 两种决定返回同一种形状', () => {
  const fx = fixture(MECH_VS_TITLE)
  const vault = openVault(fx)
  try {
    vault.rebuild()

    const accepted = vault.propose('指针', { limit: 2 })[0]
    const a = vault.resolve({ proposalId: accepted.proposalId, decision: 'accept' })
    assert.equal(a.state, 'accepted')
    assert.equal(a.entry.meta.slug, accepted.slug)

    const rejected = vault.propose('指针', { limit: 2 })[0]
    const r = vault.resolve({ proposalId: rejected.proposalId, decision: 'reject', reason: '不对' })
    assert.equal(r.state, 'rejected')
    assert.equal(r.entry, null)
  } finally {
    vault.close()
    fx.cleanup()
  }
})

test('事务：抛错整批回滚，嵌套时报错要指向原因', () => {
  const fx = fixture(MECH_VS_TITLE)
  const vault = openVault(fx)
  try {
    vault.rebuild()
    const count = () => vault.db.prepare('SELECT COUNT(*) AS c FROM inbox').get().c

    vault.transaction(() => {
      vault.intake({ origin: 'agent' })
      assert.equal(count(), 1, '事务内应当看得见自己的写入')
    })
    assert.equal(count(), 1, '提交后写入应当留下')

    assert.throws(
      () =>
        vault.transaction(() => {
          vault.intake({ origin: 'agent' })
          vault.intake({ origin: 'agent' })
          throw new Error('boom')
        }),
      /boom/,
    )
    assert.equal(count(), 1, '抛错要整批回滚，不能留下半截')

    // promote 内部会 rebuild、而 rebuild 自己开事务，所以嵌套必须报人话，
    // 而不是 SQLite 那句「cannot start a transaction within a transaction」。
    assert.throws(() => vault.transaction(() => vault.transaction(() => {})), /不支持嵌套事务/)

    // 嵌套抛出后深度计数不能被吃坏，外层还要能继续用
    vault.transaction(() => vault.intake({ origin: 'agent' }))
    assert.equal(count(), 2)
  } finally {
    vault.close()
    fx.cleanup()
  }
})

/* ------------------------------------------------------------------ *
 * rebuild
 * ------------------------------------------------------------------ */

test('rebuild 把 md 投影成表与索引，内容没变时跳过', () => {
  const fx = fixture([
    { slug: 'one', title: '液态玻璃' },
    { slug: 'two', title: '跑马灯', category: '动效', stage: 'plain' },
  ])
  const vault = openVault(fx)
  try {
    const first = vault.rebuild()
    assert.equal(first.skipped, false)
    assert.equal(first.entries, 2)
    assert.equal(vault.stats().entries, 2)
    assert.equal(vault.stats().byTier.candidate, 2, '没写 tier 的默认是候选')

    const second = vault.rebuild()
    assert.equal(second.skipped, true, '内容没变应当跳过')

    const forced = vault.rebuild({ force: true })
    assert.equal(forced.skipped, false, '--force 必须真重建')

    const entry = vault.get('one')
    assert.equal(entry.meta.title, '液态玻璃')
    assert.deepEqual(entry.mechanisms, ['backdrop-filter blur'])
    assert.equal(entry.params.length, 1)
    assert.equal(entry.params[0].name, 'blur')
    assert.equal(entry.params[0].unit, 'px')
    assert.equal(entry.code.length, 1)
    assert.equal(entry.notes.length, 1)
  } finally {
    vault.close()
    fx.cleanup()
  }
})

test('内容不合规时拒绝重建，绝不写半个库', () => {
  const fx = fixture([{ slug: 'good', title: '好的' }])
  // 再塞一条坏掉的：描述里没有 ==机制==
  writeFileSync(fx.path('bad'), '---\ntitle: 坏的\nslug: bad\n---\n\n## 描述\n\n没有标记\n', 'utf8')

  const vault = openVault(fx)
  try {
    assert.throws(() => vault.rebuild(), VaultError)
    assert.equal(vault.stats().entries, 0, '失败时不该留下任何条目')
  } finally {
    vault.close()
    fx.cleanup()
  }
})

/* ------------------------------------------------------------------ *
 * 排序：机制权重
 * ------------------------------------------------------------------ */

test('命中机制短语的条目必须压过只在标题里出现同一个词的条目', () => {
  const fx = fixture(MECH_VS_TITLE)
  const vault = openVault(fx)
  try {
    vault.rebuild()
    const hits = vault.search('指针', { tier: 'all' })
    assert.ok(hits.length >= 2, `两条都该召回，实际 ${hits.length} 条`)
    assert.equal(hits[0].slug, 'a-mech', '机制列（权重 6）应当压过标题列（权重 2）')
    assert.match(hits[0].why, /机制/)
    assert.ok(hits[0].score > hits[1].score, '机制命中的分数要更高')
  } finally {
    vault.close()
    fx.cleanup()
  }
})

test('命中结果要能说清为什么是它', () => {
  const fx = fixture(MECH_VS_TITLE)
  const vault = openVault(fx)
  try {
    vault.rebuild()
    const [hit] = vault.search('指针', { tier: 'all' })
    assert.equal(hit.why, '机制：指针 跟随')
  } finally {
    vault.close()
    fx.cleanup()
  }
})

/* ------------------------------------------------------------------ *
 * 分层闸门
 * ------------------------------------------------------------------ */

test('默认只从 core 出，归档不会自动冒出来', () => {
  const fx = fixture([
    { slug: 'live', title: '玻璃面板', tier: 'core' },
    { slug: 'frozen', title: '玻璃旧法', tier: 'archive' },
  ])
  const vault = openVault(fx)
  try {
    vault.rebuild()
    const core = vault.search('玻璃')
    assert.deepEqual(core.map((h) => h.slug), ['live'], '归档不该出现在默认结果里')

    const all = vault.search('玻璃', { tier: 'all' })
    assert.deepEqual(all.map((h) => h.slug).sort(), ['frozen', 'live'], 'tier=all 才看得到归档')

    // 归档不是删除：它仍然躺在库里、取得到
    assert.ok(vault.get('frozen'))
  } finally {
    vault.close()
    fx.cleanup()
  }
})

/* ------------------------------------------------------------------ *
 * 铁律：events 不被 rebuild 清掉
 * ------------------------------------------------------------------ */

test('rebuild 不得动事件流——那是唯一不可重建的历史', () => {
  const fx = fixture(MECH_VS_TITLE)
  const vault = openVault(fx)
  try {
    vault.rebuild()

    const inboxId = vault.intake({ origin: 'agent', rawRef: '看到一段很妙的滚动' })
    const proposals = vault.propose('指针', { limit: 2 })
    assert.ok(proposals.length >= 1, '应当提出候选')
    vault.resolve({ proposalId: proposals[0].proposalId, decision: 'reject', reason: '不是这个' })

    const before = vault.stats()
    assert.ok(before.events >= 2, 'propose + reject 至少两条事件')
    assert.ok(before.pendingProposals >= 1, '还有没处理的提议')

    vault.rebuild({ force: true })

    const after = vault.stats()
    assert.equal(after.events, before.events, 'rebuild 之后事件条数必须不变')
    assert.equal(
      after.pendingProposals,
      before.pendingProposals,
      '提议的状态不该被 rebuild 改动',
    )
    assert.equal(after.inboxNew, before.inboxNew, '收件箱条目必须还在')
    assert.ok(vault.events().some((e) => e.kind === 'reject'), '否决事件必须留下')
    assert.equal(vault.inbox({ state: 'new' })[0].id, inboxId)
    assert.notEqual(vault.db.prepare('SELECT COUNT(*) AS c FROM proposals').get().c, 0)
  } finally {
    vault.close()
    fx.cleanup()
  }
})

/* ------------------------------------------------------------------ *
 * 学习闭环
 * ------------------------------------------------------------------ */

test('采纳会抬高该条的排序，否决会压低', () => {
  const fx = fixture(MECH_VS_TITLE)
  const vault = openVault(fx)
  try {
    vault.rebuild()

    const scoreOf = (slug) => {
      const hit = vault.search('指针', { tier: 'all', limit: 10 }).find((h) => h.slug === slug)
      assert.ok(hit, `结果里应当有 ${slug}`)
      return hit.score
    }

    const beforeMech = scoreOf('a-mech')
    const beforeTitle = scoreOf('b-title')
    assert.ok(beforeMech > beforeTitle, '先说清楚：一开始机制那条更强')

    // 实际使用里「乙条」被反复选中，先验应当把它抬起来。
    // limit 给足，否则目标条目可能根本不在提议名单里，采纳会记到别人头上。
    const accept = (slug) => {
      const proposals = vault.propose('指针', { limit: 5 })
      const target = proposals.find((p) => p.slug === slug)
      assert.ok(target, `提议名单里应当有 ${slug}`)
      vault.resolve({ proposalId: target.proposalId, decision: 'accept' })
    }
    for (let i = 0; i < 3; i++) accept('b-title')

    const afterTitle = scoreOf('b-title')
    assert.ok(
      afterTitle > beforeTitle,
      `采纳之后分数应当上浮：${beforeTitle} → ${afterTitle}`,
    )

    const prior = vault.db.prepare('SELECT * FROM slug_prior WHERE slug = ?').get('b-title')
    assert.equal(prior.accepts, 3)
    assert.ok(prior.weight > 0.5, '采纳率高于中性点，权重应当上浮')
  } finally {
    vault.close()
    fx.cleanup()
  }
})

/* ------------------------------------------------------------------ *
 * promote：唯一写 md 的入口
 * ------------------------------------------------------------------ */

const GOOD_SPEC = {
  slug: 'promoted-one',
  title: '转正条目',
  category: '动效',
  tags: ['测试'],
  since: '2026-02',
  source: '测试来源',
  when: '需要转正的时候',
  stage: 'plain',
  tier: 'candidate',
  params: [{ name: 'speed', label: '速度', type: 'range', min: 1, max: 10, step: 1, default: 4, unit: 's' }],
  description: '这是一条用来测试转正的条目。它靠的是 ==animation-duration== 这个机制。',
  code: [{ lang: 'css', body: '.x {\n  animation-duration: var(--speed, 4s); /* @mechanism */\n}' }],
  notes: ['由 promote 写进来'],
}

test('checkEntry 只校验不落盘 —— 预演通过就等于转正能过', () => {
  const fx = fixture(MECH_VS_TITLE)
  const vault = openVault(fx)
  try {
    vault.rebuild()
    const before = readdirSync(fx.contentDir).sort()

    const good = vault.checkEntry(GOOD_SPEC)
    assert.equal(good.ok, true, `好 spec 应当通过：${good.problems.join('; ')}`)
    assert.match(good.markdown, /slug: promoted-one/)
    assert.match(good.markdown, /## 边界|## 备注/)

    // 描述里没有 ==机制==（代码是好的，所以会走到 validate 这一层）
    const noMechanism = vault.checkEntry({ ...GOOD_SPEC, description: '这条描述忘了标机制。' })
    assert.equal(noMechanism.ok, false)
    assert.ok(
      noMechanism.problems.some((p) => p.includes('==机制==')),
      `报错要指出缺机制：${noMechanism.problems.join('; ')}`,
    )

    // 代码小节整个空掉：parse 阶段就该拦下
    const noCode = vault.checkEntry({ ...GOOD_SPEC, code: [] })
    assert.equal(noCode.ok, false)
    assert.ok(noCode.problems.length, '没有代码必须报错')

    // 预演绝不能碰内容目录，否则「先预演再决定」就没意义了
    assert.deepEqual(readdirSync(fx.contentDir).sort(), before, 'checkEntry 不该写出任何文件')
    assert.equal(vault.stats().entries, MECH_VS_TITLE.length, 'checkEntry 不该动库')
  } finally {
    vault.close()
    fx.cleanup()
  }
})

test('promote 写出 md 并立刻被库收进去', () => {
  const fx = fixture(MECH_VS_TITLE)
  const vault = openVault(fx)
  try {
    vault.rebuild()
    const id = vault.intake({ origin: 'agent', rawRef: '某个很妙的动效' })

    const result = vault.promote(id, GOOD_SPEC)
    assert.equal(result.slug, 'promoted-one')

    // md 真的落盘了，而且能被原样读回来
    const text = readFileSync(fx.path('promoted-one'), 'utf8')
    assert.match(text, /^---\n/)
    assert.match(text, /slug: promoted-one/)
    assert.match(text, /tier: candidate/)
    assert.match(text, /## 描述/)
    assert.match(text, /@mechanism/)

    assert.equal(vault.get('promoted-one').meta.title, '转正条目')
    assert.equal(vault.inbox({ state: 'new' }).length, 0, '转正后收件箱里不再有它')
    assert.ok(vault.drift().inSync, '转正之后投影应与磁盘一致')
  } finally {
    vault.close()
    fx.cleanup()
  }
})

test('promote 内容不合规时抛错，且绝不留下坏文件', () => {
  const fx = fixture(MECH_VS_TITLE)
  const vault = openVault(fx)
  try {
    vault.rebuild()
    const id = vault.intake({ origin: 'agent', rawRef: '坏的' })

    const bad = { ...GOOD_SPEC, slug: 'bad-one', description: '描述里没有机制标记。' }
    assert.throws(() => vault.promote(id, bad), VaultError)

    assert.equal(existsSyncSafe(fx.path('bad-one')), false, '不合规的内容不该落盘')
    assert.equal(vault.get('bad-one'), null)
    assert.equal(vault.inbox({ state: 'new' }).length, 1, '失败后收件箱条目应当still是 new')
  } finally {
    vault.close()
    fx.cleanup()
  }
})

test('promote 拒绝覆盖已存在的条目', () => {
  const fx = fixture(MECH_VS_TITLE)
  const vault = openVault(fx)
  try {
    vault.rebuild()
    const first = vault.intake({ origin: 'agent' })
    vault.promote(first, GOOD_SPEC)

    const second = vault.intake({ origin: 'agent' })
    assert.throws(() => vault.promote(second, GOOD_SPEC), /已存在/)
    // 原文件必须原封不动
    assert.match(readFileSync(fx.path('promoted-one'), 'utf8'), /转正条目/)
  } finally {
    vault.close()
    fx.cleanup()
  }
})

/* ------------------------------------------------------------------ *
 * drift
 * ------------------------------------------------------------------ */

test('drift 报出被改动的条目', () => {
  const fx = fixture(MECH_VS_TITLE)
  const vault = openVault(fx)
  try {
    vault.rebuild()
    assert.equal(vault.drift().inSync, true)

    writeFileSync(fx.path('a-mech'), `${readFileSync(fx.path('a-mech'), 'utf8')}\n<!-- 手改 -->\n`, 'utf8')
    assert.equal(vault.drift().changed.includes('a-mech'), true)

    writeFileSync(fx.path('c-new'), entryMd({ slug: 'c-new', title: '新增的' }), 'utf8')
    assert.equal(vault.drift().added.includes('c-new'), true)

    rmSync(fx.path('b-title'))
    assert.equal(vault.drift().missing.includes('b-title'), true)
  } finally {
    vault.close()
    fx.cleanup()
  }
})

/* ------------------------------------------------------------------ *
 * 备份：唯一不可重建的那部分
 * ------------------------------------------------------------------ */

test('导出能整份恢复，重复导入是幂等的', () => {
  const fx = fixture(MECH_VS_TITLE)
  const vault = openVault(fx)
  try {
    vault.rebuild()
    vault.intake({ origin: 'agent', rawRef: '看到一段很妙的滚动' })
    const [target] = vault.propose('指针', { limit: 3 })
    assert.ok(target, '要有候选才能测')
    vault.resolve({ proposalId: target.proposalId, decision: 'accept' })

    const state = vault.exportState()
    assert.equal(state.format, 'spellbook-vault-state')
    assert.ok(state.events.length >= 2, '提议与采纳都该在备份里')

    // 重复导入同一份，必须一条都不新增
    assert.deepEqual(vault.importState(state), { events: 0, inbox: 0 })
    assert.equal(vault.stats().inboxNew, 1)
    assert.deepEqual(vault.importState(state), { events: 0, inbox: 0 })

    // 恢复到一个全新的库：事件一条不少，先验按事件重算后完全一致
    const fx2 = fixture(MECH_VS_TITLE)
    const fresh = openVault(fx2)
    try {
      fresh.rebuild()
      const added = fresh.importState(state)
      assert.equal(added.events, state.events.length)
      assert.equal(fresh.stats().events, state.events.length)
      const weight = (v, slug) =>
        v.db.prepare('SELECT weight FROM slug_prior WHERE slug = ?').get(slug)?.weight
      assert.equal(weight(fresh, target.slug), weight(vault, target.slug))
      assert.equal(fresh.inbox({ state: 'new' }).length, 1)
    } finally {
      fresh.close()
      fx2.cleanup()
    }

    assert.throws(() => vault.importState({ nope: true }), VaultError)
  } finally {
    vault.close()
    fx.cleanup()
  }
})

/* ------------------------------------------------------------------ *
 * 边界：这条什么时候会失效
 * ------------------------------------------------------------------ */

test('边界单独成段入库，并跟着命中一起返回', () => {
  const fx = fixture([
    ...MECH_VS_TITLE,
    {
      slug: 'with-caveats',
      title: '玻璃面板',
      tier: 'core',
      caveats: ['白底上几乎看不出来', '祖先有 transform 就整个失效'],
    },
    { slug: 'no-caveats', title: '玻璃的另一半', tier: 'core' },
  ])
  const vault = openVault(fx)
  try {
    vault.rebuild()

    assert.deepEqual(vault.get('with-caveats').caveats, [
      '白底上几乎看不出来',
      '祖先有 transform 就整个失效',
    ])
    assert.deepEqual(vault.get('no-caveats').caveats, [], '没写边界就是空数组，不是 undefined')

    const hit = vault.search('玻璃', { tier: 'all', limit: 10 }).find((h) => h.slug === 'with-caveats')
    assert.deepEqual(hit.caveats, ['白底上几乎看不出来', '祖先有 transform 就整个失效'])

    // 边界不进 FTS：它说的是「什么时候不管用」，拿来当召回依据会污染「我要什么」
    assert.deepEqual(vault.search('白底'), [], '边界文本不该能召回条目')
  } finally {
    vault.close()
    fx.cleanup()
  }
})

test('promote 能写出边界；没有边界时不留空段', () => {
  const fx = fixture(MECH_VS_TITLE)
  const vault = openVault(fx)
  try {
    vault.rebuild()

    const withBoundary = vault.intake({ origin: 'agent' })
    vault.promote(withBoundary, {
      ...GOOD_SPEC,
      caveats: ['只在支持 backdrop-filter 的浏览器上成立'],
    })
    const text = readFileSync(fx.path('promoted-one'), 'utf8')
    assert.match(text, /## 边界/)
    assert.match(text, /只在支持 backdrop-filter 的浏览器上成立/)
    assert.deepEqual(vault.get('promoted-one').caveats, ['只在支持 backdrop-filter 的浏览器上成立'])

    // 没有边界就整段不写，别留一个孤零零的 ## 边界 标题
    const noBoundary = vault.intake({ origin: 'agent' })
    vault.promote(noBoundary, { ...GOOD_SPEC, slug: 'promoted-two', title: '没有边界的' })
    assert.doesNotMatch(readFileSync(fx.path('promoted-two'), 'utf8'), /## 边界/)
    assert.deepEqual(vault.get('promoted-two').caveats, [])
  } finally {
    vault.close()
    fx.cleanup()
  }
})

/* ------------------------------------------------------------------ *
 * 事件与提议的显式关联
 * ------------------------------------------------------------------ */

test('事件显式记下处理的是哪条提议', () => {
  const fx = fixture(MECH_VS_TITLE)
  const vault = openVault(fx)
  try {
    vault.rebuild()
    const target = vault.propose('指针', { limit: 3 }).find((p) => p.slug === 'a-mech')
    assert.ok(target, '提案名单里应当有 a-mech')

    const proposeEvent = vault
      .events()
      .find((e) => e.kind === 'propose' && e.proposal_id === target.proposalId)
    assert.ok(proposeEvent, 'propose 事件应当指向刚建的那条提议')

    vault.resolve({ proposalId: target.proposalId, decision: 'accept' })
    const acceptEvent = vault.events().find((e) => e.kind === 'accept')
    assert.equal(acceptEvent.proposal_id, target.proposalId, '采纳事件要指向它处理的那条提议')
  } finally {
    vault.close()
    fx.cleanup()
  }
})

test('备份要把 proposal_id 一起带走', () => {
  const fx = fixture(MECH_VS_TITLE)
  const vault = openVault(fx)
  try {
    vault.rebuild()
    const [target] = vault.propose('指针', { limit: 1 })
    vault.resolve({ proposalId: target.proposalId, decision: 'accept' })

    const state = vault.exportState()
    assert.equal(state.events.find((e) => e.kind === 'accept').proposal_id, target.proposalId)

    const fx2 = fixture(MECH_VS_TITLE)
    const fresh = openVault(fx2)
    try {
      fresh.rebuild()
      fresh.importState(state)
      const restored = fresh.events().find((e) => e.kind === 'accept')
      // 列名是 snake_case、recordEvent 收 camelCase，搬错一步这里就会变成 null
      assert.equal(restored.proposal_id, target.proposalId, '恢复后 proposal_id 不能丢')
    } finally {
      fresh.close()
      fx2.cleanup()
    }
  } finally {
    vault.close()
    fx.cleanup()
  }
})

/* ------------------------------------------------------------------ *
 * 迁移：不可重建的那张表怎么改
 * ------------------------------------------------------------------ */

test('老结构的库能迁移：事件一条不少，投影表按新结构重建', () => {
  const fx = fixture(MECH_VS_TITLE)

  // 手搓一个 v1 老库：events 没有 proposal_id，entry_mechanisms 还留着 is_primary
  const old = new DatabaseSync(fx.dbPath)
  old.exec('CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)')
  old.exec(`CREATE TABLE events (
    id INTEGER PRIMARY KEY AUTOINCREMENT, ts INTEGER NOT NULL, session TEXT, slug TEXT,
    kind TEXT NOT NULL, query TEXT, score REAL, reason TEXT)`)
  old.exec(`CREATE TABLE entry_mechanisms (
    slug TEXT NOT NULL, ordinal INTEGER NOT NULL, phrase TEXT NOT NULL,
    is_primary INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (slug, ordinal))`)
  old.exec(`CREATE TABLE entries (
    slug TEXT PRIMARY KEY, title TEXT NOT NULL, category TEXT NOT NULL, when_text TEXT NOT NULL,
    stage TEXT NOT NULL, source TEXT, since TEXT, tier TEXT NOT NULL DEFAULT 'candidate',
    description TEXT NOT NULL)`)
  old.prepare("INSERT INTO meta(key, value) VALUES ('schema_version', '1')").run()
  old.prepare(
    'INSERT INTO events(ts, session, slug, kind, query, score, reason) VALUES (?, ?, ?, ?, ?, ?, ?)',
  ).run(12345, 'main', 'a-mech', 'accept', '指针', 3.2, '机制：指针 跟随')
  old.prepare(
    'INSERT INTO entries(slug, title, category, when_text, stage, tier, description) VALUES (?, ?, ?, ?, ?, ?, ?)',
  ).run('stale', '过期的投影', '材质', '场合', 'plain', 'core', '描述')
  old.close()

  const vault = openVault(fx)
  try {
    const columns = (table) =>
      vault.db.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name)

    assert.ok(columns('events').includes('proposal_id'), 'events 应当被加上 proposal_id')
    assert.ok(!columns('entry_mechanisms').includes('is_primary'), '只写不读的列应当消失')
    assert.ok(columns('entry_caveats').length > 0, 'entry_caveats 应当被建出来')

    // 唯一不可重建的东西：一条不少、字段完好
    const kept = vault.events()
    assert.equal(kept.length, 1, '迁移不该丢事件')
    assert.equal(kept[0].slug, 'a-mech')
    assert.equal(kept[0].query, '指针')
    assert.equal(kept[0].score, 3.2)
    assert.equal(kept[0].reason, '机制：指针 跟随')
    assert.equal(kept[0].proposal_id, null, '老事件没有提议可指，应当是 null')

    // 投影是脏的：迁移把它整批丢掉，等 rebuild 按新结构重建
    assert.equal(vault.stats().entries, 0, '过期的投影应当被丢弃')

    vault.rebuild()
    assert.equal(vault.stats().entries, MECH_VS_TITLE.length)
    assert.equal(vault.stats().events, 1, '重建不该动事件流')
  } finally {
    vault.close()
    fx.cleanup()
  }
})

test('迁移不会重复跑：再打开一次，投影还在', () => {
  const fx = fixture(MECH_VS_TITLE)
  const first = openVault(fx)
  first.rebuild()
  const before = first.stats().entries
  first.close()

  const second = openVault(fx)
  try {
    assert.equal(second.stats().entries, before, '版本号已是最新，不该再跑迁移把投影清掉')
  } finally {
    second.close()
    fx.cleanup()
  }
})

function existsSyncSafe(path) {
  try {
    readFileSync(path)
    return true
  } catch {
    return false
  }
}
