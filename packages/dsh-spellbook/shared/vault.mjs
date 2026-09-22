/**
 * 咒语书 —— 数据库协议
 *
 * 一条铁律：**md 是唯一被书写的真相，这个库是投影加一条事件流。**
 *
 *   A 区（可重建）  由 content/effects/*.md 投影而来。丢了无所谓，rebuild 就回来。
 *   events（不可重建）运行时唯一的历史。**任何 rebuild 都不得删它。**
 *   C 区（可重算）   proposals / inbox / slug_prior，由 events 与人的策展动作投影而来。
 *
 * 所以 rebuild 的删除白名单是写死的常量（LIBRARY_TABLES），不是「除了 events 全删」——
 * 后者哪天加了新表就会误删历史。测试里有一条专门盯着这条铁律。
 *
 * 用 node:sqlite（Node 22.5+ 内置），所以零第三方依赖这条线没有破。
 */

import { DatabaseSync } from 'node:sqlite'
import { createHash } from 'node:crypto'
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs'
import { basename, dirname, join } from 'node:path'

import { parse } from './parse.mjs'
import { validateEntry } from './schema.mjs'
import { BM25_ARGS, explain, matchExpr, scoreOf, spaced } from './vault-text.mjs'

export class VaultError extends Error {
  constructor(message) {
    super(message)
    this.name = 'VaultError'
  }
}

/**
 * 相关度门槛：候选的原始 bm25 至少要达到最好那条的 3%，否则算噪音不端出去。
 * 只在最好成绩为正时才启用（详见 search 里的说明）。
 */
const RAW_FLOOR_RATIO = 0.03

/* ------------------------------------------------------------------ *
 * 建表
 * ------------------------------------------------------------------ */

/** A 区：全部由 md 投影而来，rebuild 时整批删掉重填。 */
export const LIBRARY_TABLES = [
  'match_fts',
  'entry_caveats',
  'entry_notes',
  'entry_code',
  'entry_params',
  'entry_tags',
  'entry_mechanisms',
  'entry_files',
  'entries',
]

/** 永不参与 rebuild。改这个列表等于改历史留存的保证，测试会拦。 */
export const DURABLE_TABLES = ['events', 'proposals', 'inbox', 'slug_prior']

/**
 * 不属于上面两类的表，只有一张：`meta`。
 * 它记的是库自己的账（指纹、构建时间、schema 版本），既不是 md 的投影，也不是历史。
 * 单独列出来是为了让「库里每张表都必须被登记」这条不变量**可被检查**——
 * 否则这个常量会退化成文档，而文档拦不住下一个人新加一张表却忘了归类。
 */
export const BOOKKEEPING_TABLES = ['meta']

const DDL = `
CREATE TABLE IF NOT EXISTS meta (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

-- ═════════════ A 区：md 的投影，可随时重建 ═════════════

CREATE TABLE IF NOT EXISTS entries (
  slug        TEXT PRIMARY KEY,
  title       TEXT NOT NULL,
  category    TEXT NOT NULL,
  when_text   TEXT NOT NULL,
  stage       TEXT NOT NULL,
  source      TEXT,
  since       TEXT,
  tier        TEXT NOT NULL DEFAULT 'candidate',
  description TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS entry_mechanisms (
  slug       TEXT NOT NULL REFERENCES entries(slug) ON DELETE CASCADE,
  ordinal    INTEGER NOT NULL,
  phrase     TEXT NOT NULL,
  PRIMARY KEY (slug, ordinal)
);

CREATE TABLE IF NOT EXISTS entry_tags (
  slug    TEXT NOT NULL REFERENCES entries(slug) ON DELETE CASCADE,
  tag     TEXT NOT NULL,
  ordinal INTEGER NOT NULL,
  PRIMARY KEY (slug, tag)
);

CREATE TABLE IF NOT EXISTS entry_params (
  slug          TEXT NOT NULL REFERENCES entries(slug) ON DELETE CASCADE,
  name          TEXT NOT NULL,
  ordinal       INTEGER NOT NULL,
  label         TEXT,
  type          TEXT NOT NULL,
  min_v         REAL,
  max_v         REAL,
  step_v        REAL,
  default_value TEXT,
  unit          TEXT,
  options_json  TEXT,
  PRIMARY KEY (slug, name)
);

CREATE TABLE IF NOT EXISTS entry_code (
  slug          TEXT NOT NULL REFERENCES entries(slug) ON DELETE CASCADE,
  ordinal       INTEGER NOT NULL,
  lang          TEXT NOT NULL,
  body          TEXT NOT NULL,
  has_mech_line INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (slug, ordinal)
);

CREATE TABLE IF NOT EXISTS entry_notes (
  slug    TEXT NOT NULL REFERENCES entries(slug) ON DELETE CASCADE,
  ordinal INTEGER NOT NULL,
  text    TEXT NOT NULL,
  PRIMARY KEY (slug, ordinal)
);

-- 「这条什么时候会失效」。与机制同等重要，所以也单独成表：
-- 机制是迁移的承重墙，边界是用户真正会踩的坑，提议时要能跟效果一起端出去。
CREATE TABLE IF NOT EXISTS entry_caveats (
  slug    TEXT NOT NULL REFERENCES entries(slug) ON DELETE CASCADE,
  ordinal INTEGER NOT NULL,
  text    TEXT NOT NULL,
  PRIMARY KEY (slug, ordinal)
);

-- 源文件指纹：增量重建与漂移检测都靠它。
-- 故意不加外键——解析失败的文件也要能被记录、被报出来。
CREATE TABLE IF NOT EXISTS entry_files (
  slug     TEXT PRIMARY KEY,
  path     TEXT NOT NULL,
  mtime_ms INTEGER NOT NULL,
  sha256   TEXT NOT NULL
);

-- 列顺序必须与 vault-text.mjs 的 BM25_WEIGHTS 完全一致。
CREATE VIRTUAL TABLE IF NOT EXISTS match_fts USING fts5(
  slug UNINDEXED,
  title,
  when_text,
  tags,
  mechanisms,
  code_text,
  description,
  tokenize = 'unicode61'
);

-- ═════════════ 不可重建：运行时唯一的历史 ═════════════
-- 故意不给 slug 加外键：某条咒语将来被删了，它被提议过、被否决过的记录也必须活着。
-- proposal_id 也不加外键，理由同上（提议表本身是可重算的派生数据）。

CREATE TABLE IF NOT EXISTS events (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  ts          INTEGER NOT NULL,
  session     TEXT,
  slug        TEXT,
  kind        TEXT NOT NULL,
  query       TEXT,
  proposal_id INTEGER,
  score       REAL,
  reason      TEXT
);

CREATE TABLE IF NOT EXISTS proposals (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  ts          INTEGER NOT NULL,
  session     TEXT,
  query       TEXT NOT NULL,
  slug        TEXT NOT NULL,
  rank        INTEGER NOT NULL,
  score       REAL NOT NULL,
  state       TEXT NOT NULL DEFAULT 'pending',
  resolved_ts INTEGER,
  reason      TEXT
);

CREATE TABLE IF NOT EXISTS inbox (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  ts             INTEGER NOT NULL,
  origin         TEXT NOT NULL,
  raw_ref        TEXT,
  title_guess    TEXT,
  category_guess TEXT,
  state          TEXT NOT NULL DEFAULT 'new',
  slug           TEXT,
  note           TEXT
);

CREATE TABLE IF NOT EXISTS slug_prior (
  slug      TEXT PRIMARY KEY,
  exposures INTEGER NOT NULL DEFAULT 0,
  accepts   INTEGER NOT NULL DEFAULT 0,
  rejects   INTEGER NOT NULL DEFAULT 0,
  weight    REAL NOT NULL DEFAULT 0.5
);

CREATE INDEX IF NOT EXISTS idx_events_slug ON events(slug);
CREATE INDEX IF NOT EXISTS idx_proposals_state ON proposals(state);
`

/* ------------------------------------------------------------------ *
 * 小工具
 * ------------------------------------------------------------------ */

const sha256 = (text) => createHash('sha256').update(text, 'utf8').digest('hex')

/** node:sqlite 只吃字符串/数字/null/Buffer，undefined 与布尔都会炸，统一归一到 null。 */
const n = (v) => (v === undefined ? null : v)
const bit = (v) => (v ? 1 : 0)

function jsonOrNull(value) {
  if (value === undefined || value === null) return null
  if (Array.isArray(value) || typeof value === 'object') return JSON.stringify(value)
  return String(value)
}

/* ------------------------------------------------------------------ *
 * markdown 渲染（promote 专用）
 * ------------------------------------------------------------------ */

function renderParamLine(param) {
  const parts = [`name: ${param.name}`, `label: ${param.label}`, `type: ${param.type}`]
  if (param.type === 'range') {
    parts.push(`min: ${param.min}`, `max: ${param.max}`, `step: ${param.step}`, `default: ${param.default}`)
  } else if (param.type === 'select') {
    parts.push(`options: [${(param.options ?? []).join(', ')}]`, `default: ${param.default}`)
  } else if (param.default !== undefined) {
    parts.push(`default: ${param.default}`)
  }
  if (param.unit) parts.push(`unit: ${param.unit}`)
  return `  - { ${parts.join(', ')} }`
}

function renderEntryMd(spec) {
  const fm = [
    '---',
    `title: ${spec.title}`,
    `slug: ${spec.slug}`,
    `category: ${spec.category}`,
    `tags: [${(spec.tags ?? []).join(', ')}]`,
    `since: ${spec.since}`,
    `source: ${spec.source}`,
    `when: ${spec.when}`,
    `stage: ${spec.stage}`,
    `tier: ${spec.tier ?? 'candidate'}`,
  ]
  if (spec.params?.length) {
    fm.push('params:', ...spec.params.map(renderParamLine))
  }
  fm.push('---')

  const code = (spec.code ?? [])
    .map((block) => `\`\`\`${block.lang}\n${block.body.replace(/\n+$/, '')}\n\`\`\``)
    .join('\n\n')

  const notes = (spec.notes ?? []).map((t) => `- ${t}`).join('\n')
  const caveats = (spec.caveats ?? []).map((t) => `- ${t}`).join('\n')

  return [
    fm.join('\n'),
    '',
    '## 描述',
    '',
    spec.description.trim(),
    '',
    '## 代码',
    '',
    code,
    '',
    // 边界是可选的：没有就整段不写，不要留一个空的 ## 边界。
    // 空段落在解析侧会得到空数组，在站点上会渲染成一个孤零零的标题。
    ...(caveats ? ['## 边界', '', caveats, ''] : []),
    '## 备注',
    '',
    notes,
    '',
  ].join('\n')
}

/* ------------------------------------------------------------------ *
 * 入口
 * ------------------------------------------------------------------ */

/**
 * 打开（必要时创建）咒语库。
 * @param {{ dbPath: string, contentDir: string }} options
 */
export function openVault({ dbPath, contentDir }) {
  mkdirSync(dirname(dbPath), { recursive: true })
  const db = new DatabaseSync(dbPath)
  db.exec('PRAGMA foreign_keys = ON')
  db.exec('PRAGMA journal_mode = WAL')
  db.exec(DDL)

  const getMeta = (key) => db.prepare('SELECT value FROM meta WHERE key = ?').get(key)?.value ?? null
  const setMeta = (key, value) => {
    db.prepare('INSERT INTO meta(key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(
      key,
      String(value),
    )
  }

  /**
   * 一次事务；抛错自动回滚。
   *
   * 故意不支持嵌套：`promote` 会在写完 md 之后调用 `rebuild`，而 `rebuild` 自己开事务。
   * 哪天有人在 `promote` 外面套一层 `tx()`，SQLite 只会丢出
   * 「cannot start a transaction within a transaction」——报错指向症状而不是原因。
   * 所以这里直接数深度，嵌套时抛一句人话。
   */
  let txDepth = 0

  function tx(fn) {
    if (txDepth > 0) {
      throw new VaultError(
        '不支持嵌套事务：外层已经开了事务。promote 必须在事务外调用（它内部会自己 rebuild）。',
      )
    }
    txDepth++
    db.exec('BEGIN IMMEDIATE')
    try {
      const out = fn()
      db.exec('COMMIT')
      return out
    } catch (error) {
      try {
        db.exec('ROLLBACK')
      } catch {
        /* 回滚失败就让原始错误冒出去，别掩盖 */
      }
      throw error
    } finally {
      txDepth--
    }
  }

  const hasColumn = (table, column) =>
    db.prepare(`PRAGMA table_info(${table})`).all().some((c) => c.name === column)

  /**
   * 结构迁移。按「能不能重建」分两种处理，这是整套设计里最该守住的区别：
   *   · A 区表结构变了 → 整批 DROP，下一次 rebuild 会用新 DDL 造回来。投影就是有这好处。
   *   · events 变了 → 只能 ALTER。它是唯一不可重建的数据。
   * 绝不图省事「删库重建」——那会把历史一起带走。
   *
   * 判断依据是**实际列**（PRAGMA）而不是版本号：version 只在 migrate 自己里写，
   * 万一某次读到 0（库是先建的、还没重建过），光看版本号会漏掉加列，
   * 之后 INSERT 就会炸。版本号只当快路径。
   */
  const SCHEMA_VERSION = 2

  function migrate() {
    if (Number(getMeta('schema_version') ?? 0) >= SCHEMA_VERSION) return

    tx(() => {
      // v2：把「这次采纳处理的是哪条提议」显式记下来。
      // 原来靠 ts + slug + query 隐含推断，同一个 query 下同一 slug 被提议两次就分不清。
      if (!hasColumn('events', 'proposal_id')) {
        db.exec('ALTER TABLE events ADD COLUMN proposal_id INTEGER')
      }
      for (const table of LIBRARY_TABLES) db.exec(`DROP TABLE IF EXISTS ${table}`)
      // 顺序很关键：DDL 在 migrate() 之前就执行过了（否则 meta 表还不存在，读不到版本号），
      // 那时候这些投影表还在、CREATE IF NOT EXISTS 是空操作。刚 DROP 掉就必须补建一次，
      // 否则库里会只剩 events，连 entries 都没了。
      db.exec(DDL)
      // 投影表被丢掉了，指纹也就失效了；不清掉的话下一次 rebuild 会以为内容没变而跳过。
      db.prepare('DELETE FROM meta WHERE key = ?').run('library_fingerprint')
      setMeta('schema_version', String(SCHEMA_VERSION))
    })
  }

  migrate()

  function recordEvent(event) {
    db.prepare(
      'INSERT INTO events(ts, session, slug, kind, query, proposal_id, score, reason) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    ).run(
      event.ts ?? Date.now(),
      n(event.session),
      n(event.slug),
      event.kind,
      n(event.query),
      n(event.proposalId),
      n(event.score),
      n(event.reason),
    )
  }

  /**
   * 由 events 重算先验。events 是历史，这张表只是它的投影，所以随时可以推倒重来。
   * weight = 拉普拉斯平滑后的采纳率（0.5 = 还没有信息）。
   */
  function recomputePriors() {
    db.exec('DELETE FROM slug_prior')
    db.exec(`
      INSERT INTO slug_prior(slug, exposures, accepts, rejects, weight)
      SELECT
        slug,
        SUM(kind = 'propose'),
        SUM(kind = 'accept'),
        SUM(kind = 'reject'),
        CASE
          WHEN SUM(kind IN ('accept', 'reject')) = 0 THEN 0.5
          ELSE (SUM(kind = 'accept') + 1.0) / (SUM(kind IN ('accept', 'reject')) + 2.0)
        END
      FROM events
      WHERE slug IS NOT NULL
      GROUP BY slug
    `)
  }

  /* ---------------------------------------------------------------- *
   * rebuild：只碰 A 区
   * ---------------------------------------------------------------- */

  function scanContent() {
    if (!existsSync(contentDir)) throw new VaultError(`内容目录不存在：${contentDir}`)
    return readdirSync(contentDir)
      .filter((f) => f.endsWith('.md'))
      .sort()
      .map((file) => {
        const path = join(contentDir, file)
        const source = readFileSync(path, 'utf8')
        return {
          file,
          path,
          source,
          slug: file.replace(/\.md$/, ''),
          sha256: sha256(source),
          mtime_ms: Math.round(statSync(path).mtimeMs),
        }
      })
  }

  /**
   * 把 md 的当前状态投影进 A 区。
   * 先全部解析校验、全部通过才写库——绝不把半个库写进去。
   */
  function rebuild({ force = false } = {}) {
    const files = scanContent()

    const problems = []
    const parsed = []
    for (const item of files) {
      try {
        const entry = parse(item.source, item.file)
        const found = validateEntry(entry, { file: item.file, expectedSlug: item.slug })
        if (found.length) {
          problems.push(...found)
          continue
        }
        parsed.push({ ...item, entry })
      } catch (error) {
        problems.push(error.message ?? String(error))
      }
    }
    if (problems.length) {
      throw new VaultError(`内容校验未通过，拒绝重建：\n  ${problems.join('\n  ')}`)
    }

    const fingerprint = sha256(parsed.map((p) => `${p.slug}:${p.sha256}`).join('\n'))
    const unchanged = getMeta('library_fingerprint') === fingerprint
    const hasRows = db.prepare('SELECT COUNT(*) AS c FROM entries').get().c > 0
    if (!force && unchanged && hasRows) {
      /*
       * 跳过时也要报**库里真实的条数**，不能报解析出来的条数。
       *
       * build.mjs 拿这个返回值和内容条数对账（对不上就拒绝发布），那是一道
       * 「站点与库不许各说各话」的闸。若这里返回 parsed.length，对账就变成
       * 拿解析结果跟解析结果比 —— 自己跟自己比，恒等，闸门形同虚设；
       * 而跳过恰恰是日常路径（内容没变时每次构建都走这条），
       * 也就是说那道闸在最常走的路上从来没合上过。
       *
       * 指纹一致确实蕴含库是照着这份内容建的，所以现实里对得上；
       * 但那是「按设计应该对」，不是「有人查过」。这里查一次。
       */
      const rows = db.prepare('SELECT COUNT(*) AS c FROM entries').get().c
      return { skipped: true, entries: rows, fingerprint }
    }

    tx(() => {
      // 白名单删除。绝不用「除了 events 全删」这种写法——新表会被误伤。
      for (const table of LIBRARY_TABLES) db.exec(`DELETE FROM ${table}`)

      const insertEntry = db.prepare(
        'INSERT INTO entries(slug, title, category, when_text, stage, source, since, tier, description) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
      )
      const insertMech = db.prepare(
        'INSERT INTO entry_mechanisms(slug, ordinal, phrase) VALUES (?, ?, ?)',
      )
      const insertTag = db.prepare('INSERT INTO entry_tags(slug, tag, ordinal) VALUES (?, ?, ?)')
      const insertParam = db.prepare(
        'INSERT INTO entry_params(slug, name, ordinal, label, type, min_v, max_v, step_v, default_value, unit, options_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      )
      const insertCode = db.prepare(
        'INSERT INTO entry_code(slug, ordinal, lang, body, has_mech_line) VALUES (?, ?, ?, ?, ?)',
      )
      const insertNote = db.prepare('INSERT INTO entry_notes(slug, ordinal, text) VALUES (?, ?, ?)')
      const insertCaveat = db.prepare(
        'INSERT INTO entry_caveats(slug, ordinal, text) VALUES (?, ?, ?)',
      )
      const insertFile = db.prepare(
        'INSERT INTO entry_files(slug, path, mtime_ms, sha256) VALUES (?, ?, ?, ?)',
      )
      const insertFts = db.prepare(
        'INSERT INTO match_fts(slug, title, when_text, tags, mechanisms, code_text, description) VALUES (?, ?, ?, ?, ?, ?, ?)',
      )

      for (const { entry, slug, path, mtime_ms, sha256: sha } of parsed) {
        const meta = entry.meta
        const tier = meta.tier ?? 'candidate'
        insertEntry.run(
          slug,
          meta.title,
          meta.category,
          meta.when,
          meta.stage,
          n(meta.source),
          n(meta.since),
          tier,
          entry.description,
        )

        entry.mechanisms.forEach((phrase, i) => insertMech.run(slug, i, phrase))

        ;(meta.tags ?? []).forEach((tag, i) => insertTag.run(slug, String(tag), i))

        ;(meta.params ?? []).forEach((param, i) => {
          insertParam.run(
            slug,
            param.name,
            i,
            n(param.label),
            param.type,
            n(param.min),
            n(param.max),
            n(param.step),
            n(param.default === undefined ? null : String(param.default)),
            n(param.unit),
            jsonOrNull(param.options),
          )
        })

        let codeText = ''
        entry.code.forEach((block, i) => {
          const body = block.lines.join('\n')
          codeText += ` ${body}`
          insertCode.run(slug, i, block.lang, body, bit(block.mechanismLines.length > 0))
        })

        entry.notes.forEach((text, i) => insertNote.run(slug, i, text))
        entry.caveats.forEach((text, i) => insertCaveat.run(slug, i, text))
        insertFile.run(slug, path, mtime_ms, sha)

        // FTS 的每一列都先过拆字，查询侧同样处理，两边 token 才对得上。
        insertFts.run(
          slug,
          spaced(meta.title),
          spaced(meta.when),
          spaced((meta.tags ?? []).join(' ')),
          spaced(entry.mechanisms.join(' ')),
          spaced(codeText),
          spaced(entry.description),
        )
      }

      setMeta('library_fingerprint', fingerprint)
      setMeta('library_built_at', new Date().toISOString())
      // 这里**不能**写 schema_version：那是 migrate 的账。
      // 写在这里会让每次 rebuild 都把版本号打回 1，下次打开又跑一遍迁移、把刚建好的投影表全丢掉。
    })

    return { skipped: false, entries: parsed.length, fingerprint, builtAt: getMeta('library_built_at') }
  }

  /** 打开时如果 md 变了就自动重建。插件在会话开始调用它。 */
  function ensureFresh() {
    return rebuild({ force: false })
  }

  /* ---------------------------------------------------------------- *
   * 读
   * ---------------------------------------------------------------- */

  /**
   * 检索。默认只从「核心」出——自动提议求准，不求全。
   * @returns {Array<{slug, title, category, when, stage, tier, score, why}>}
   */
  function search(
    query,
    { limit = 8, tier = 'core', category = null, minRatio = RAW_FLOOR_RATIO, debug = false } = {},
  ) {
    const expr = matchExpr(query)
    if (!expr) return []

    const where = ["(? = 'all' OR e.tier = ?)"]
    const args = [expr, tier, tier]
    if (category) {
      where.push('e.category = ?')
      args.push(category)
    }

    const rows = db
      .prepare(`
        SELECT m.slug, m.raw, e.title, e.category, e.when_text, e.stage, e.tier, p.weight AS prior_weight
        FROM (
          SELECT slug, -bm25(match_fts, ${BM25_ARGS}) AS raw
          FROM match_fts
          WHERE match_fts MATCH ?
        ) m
        JOIN entries e ON e.slug = m.slug
        LEFT JOIN slug_prior p ON p.slug = e.slug
        WHERE ${where.join(' AND ')}
        ORDER BY m.raw DESC
        LIMIT 200
      `)
      .all(...args)

    const mechStmt = db.prepare('SELECT phrase FROM entry_mechanisms WHERE slug = ? ORDER BY ordinal')
    const tagStmt = db.prepare('SELECT tag FROM entry_tags WHERE slug = ? ORDER BY ordinal')
    const caveatStmt = db.prepare('SELECT text FROM entry_caveats WHERE slug = ? ORDER BY ordinal')

    const scored = rows
      .map((row) => {
        const mechanisms = mechStmt.all(row.slug).map((r) => r.phrase)
        const tags = tagStmt.all(row.slug).map((r) => r.tag)
        return {
          slug: row.slug,
          title: row.title,
          category: row.category,
          when: row.when_text,
          stage: row.stage,
          tier: row.tier,
          // mechanisms / tags / caveats 三个都返回。它们要么都对调用方有用，要么都不该返回——
          // 只给 caveats 不给 mechanisms，会让插件想显示「靠什么成立」时还得再 get() 一次。
          mechanisms,
          tags,
          caveats: caveatStmt.all(row.slug).map((r) => r.text),
          // raw 是 bm25 的原始分，只在排序和相关度门槛里用，返回前会被剥掉（debug 除外）
          raw: Number(row.raw),
          score: Number(scoreOf(row.raw, row.tier, row.prior_weight).toFixed(6)),
          why: explain({ mechanisms, tags, title: row.title, when_text: row.when_text }, query),
        }
      })
      .sort((a, b) => b.score - a.score)

    // 相关度门槛：bm25 对「只沾了一个词」的文档给出的是 1e-6 量级的正数，
    // 不是负数也不是 0，光靠「> 0」筛不掉。按最好成绩取相对比例——
    // 候选必须跟最好的那条可比，而不是舍入误差。推送求准：宁可少给，不拿噪音占位置。
    //
    // 注意：绝对门槛是错的。语料很小时（比如单元测试里的两条），bm25 对**真正命中**
    // 的文档也会算出负值，一刀切在 1e-4 会把唯一那条正确结果筛掉。
    // 所以只在最好成绩为正、可以相对比较时才过滤。
    const best = scored[0]?.raw ?? 0
    const filtered =
      minRatio > 0 && best > 0 ? scored.filter((hit) => hit.raw >= best * minRatio) : scored

    const hits = filtered.slice(0, limit)
    // raw 是内部实现细节，默认不外露：调用方要的是「谁更相关」，不是 bm25 给了几分。
    if (debug) return hits
    return hits.map(({ raw, ...hit }) => hit)
  }

  /** 取一条完整咒语（描述 + 代码 + 旋钮 + 备注）。 */
  function get(slug) {
    const row = db.prepare('SELECT * FROM entries WHERE slug = ?').get(slug)
    if (!row) return null
    return {
      meta: {
        slug: row.slug,
        title: row.title,
        category: row.category,
        when: row.when_text,
        stage: row.stage,
        source: row.source,
        since: row.since,
        tier: row.tier,
      },
      description: row.description,
      mechanisms: db
        .prepare('SELECT phrase FROM entry_mechanisms WHERE slug = ? ORDER BY ordinal')
        .all(slug)
        .map((r) => r.phrase),
      tags: db.prepare('SELECT tag FROM entry_tags WHERE slug = ? ORDER BY ordinal').all(slug).map((r) => r.tag),
      params: db
        .prepare('SELECT * FROM entry_params WHERE slug = ? ORDER BY ordinal')
        .all(slug)
        .map((r) => ({
          name: r.name,
          label: r.label,
          type: r.type,
          ...(r.min_v === null ? {} : { min: r.min_v }),
          ...(r.max_v === null ? {} : { max: r.max_v }),
          ...(r.step_v === null ? {} : { step: r.step_v }),
          ...(r.default_value === null ? {} : { default: r.default_value }),
          ...(r.unit === null ? {} : { unit: r.unit }),
          ...(r.options_json === null ? {} : { options: JSON.parse(r.options_json) }),
        })),
      code: db
        .prepare('SELECT * FROM entry_code WHERE slug = ? ORDER BY ordinal')
        .all(slug)
        .map((r) => ({ lang: r.lang, body: r.body, hasMechanismLine: !!r.has_mech_line })),
      notes: db
        .prepare('SELECT text FROM entry_notes WHERE slug = ? ORDER BY ordinal')
        .all(slug)
        .map((r) => r.text),
      caveats: db
        .prepare('SELECT text FROM entry_caveats WHERE slug = ? ORDER BY ordinal')
        .all(slug)
        .map((r) => r.text),
    }
  }

  function stats() {
    const byTier = db.prepare('SELECT tier, COUNT(*) AS c FROM entries GROUP BY tier').all()
    const byCategory = db
      .prepare('SELECT category, COUNT(*) AS c FROM entries GROUP BY category ORDER BY c DESC')
      .all()
    return {
      entries: db.prepare('SELECT COUNT(*) AS c FROM entries').get().c,
      byTier: Object.fromEntries(byTier.map((r) => [r.tier, r.c])),
      byCategory: Object.fromEntries(byCategory.map((r) => [r.category, r.c])),
      events: db.prepare('SELECT COUNT(*) AS c FROM events').get().c,
      pendingProposals: db.prepare("SELECT COUNT(*) AS c FROM proposals WHERE state = 'pending'").get().c,
      inboxNew: db.prepare("SELECT COUNT(*) AS c FROM inbox WHERE state = 'new'").get().c,
      builtAt: getMeta('library_built_at'),
    }
  }

  /** 投影是否已经落后于 md。不做修正，只报告——修不修由人决定。 */
  function drift() {
    const known = new Map(
      db.prepare('SELECT slug, path, sha256 FROM entry_files').all().map((r) => [r.slug, r]),
    )
    const onDisk = existsSync(contentDir)
      ? readdirSync(contentDir)
          .filter((f) => f.endsWith('.md'))
          .sort()
      : []
    const diskSlugs = new Set(onDisk.map((f) => f.replace(/\.md$/, '')))

    const changed = []
    for (const file of onDisk) {
      const slug = file.replace(/\.md$/, '')
      const prev = known.get(slug)
      if (!prev) continue // 新增的算 pending，不算 drift
      if (sha256(readFileSync(join(contentDir, file), 'utf8')) !== prev.sha256) changed.push(slug)
    }
    const missing = [...known.keys()].filter((slug) => !diskSlugs.has(slug)).sort()
    const added = [...diskSlugs].filter((slug) => !known.has(slug)).sort()

    return {
      inSync: changed.length === 0 && missing.length === 0 && added.length === 0,
      changed: changed.sort(),
      missing,
      added,
      fingerprint: getMeta('library_fingerprint'),
    }
  }

  function events({ limit = 50 } = {}) {
    return db.prepare('SELECT * FROM events ORDER BY id DESC LIMIT ?').all(limit)
  }

  /* ---------------------------------------------------------------- *
   * 写：运行期状态
   * ---------------------------------------------------------------- */

  /** 自动收到的东西一律先进收件箱，绝不直接进库。 */
  function intake({ origin, rawRef = null, titleGuess = null, categoryGuess = null, note = null }) {
    const { lastInsertRowid } = db
      .prepare(
        'INSERT INTO inbox(ts, origin, raw_ref, title_guess, category_guess, state, note) VALUES (?, ?, ?, ?, ?, ?, ?)',
      )
      .run(Date.now(), origin, n(rawRef), n(titleGuess), n(categoryGuess), 'new', n(note))
    return Number(lastInsertRowid)
  }

  function inbox({ state = 'new', limit = 50 } = {}) {
    return db.prepare('SELECT * FROM inbox WHERE state = ? ORDER BY id DESC LIMIT ?').all(state, limit)
  }

  /** 跑一次检索并把结果记成待决提议。提议与事件在同一事务里落。 */
  function propose(query, { session = 'main', tier = 'core', limit = 3 } = {}) {
    const hits = search(query, { tier, limit })
    if (!hits.length) {
      tx(() => recordEvent({ session, kind: 'propose', query, reason: '无候选' }))
      return []
    }
    return tx(() =>
      hits.map((hit, index) => {
        const { lastInsertRowid } = db
          .prepare(
            'INSERT INTO proposals(ts, session, query, slug, rank, score, state) VALUES (?, ?, ?, ?, ?, ?, ?)',
          )
          .run(Date.now(), session, query, hit.slug, index, hit.score, 'pending')
        const proposalId = Number(lastInsertRowid)
        recordEvent({
          session,
          slug: hit.slug,
          kind: 'propose',
          query,
          proposalId,
          score: hit.score,
          reason: hit.why,
        })
        return { proposalId, ...hit }
      }),
    )
  }

  /** 用户拍板。这就是「推送求准」的学习信号。 */
  function resolve({ proposalId, decision, reason = null, session = 'main' }) {
    if (decision !== 'accept' && decision !== 'reject') {
      throw new VaultError(`decision 只能是 accept 或 reject，收到 ${decision}`)
    }
    const proposal = db.prepare('SELECT * FROM proposals WHERE id = ?').get(proposalId)
    if (!proposal) throw new VaultError(`没有这条提议：#${proposalId}`)
    if (proposal.state !== 'pending') {
      throw new VaultError(`提议 #${proposalId} 已经处理过了（${proposal.state}）`)
    }

    return tx(() => {
      db.prepare('UPDATE proposals SET state = ?, resolved_ts = ?, reason = ? WHERE id = ?').run(
        decision === 'accept' ? 'accepted' : 'rejected',
        Date.now(),
        n(reason),
        proposalId,
      )
      recordEvent({
        session,
        slug: proposal.slug,
        kind: decision === 'accept' ? 'accept' : 'reject',
        query: proposal.query,
        proposalId: proposal.id,
        score: proposal.score,
        reason: n(reason),
      })
      recomputePriors()
      // 返回值保持同形：两种决定都回 { state, entry }。
      // 原来 accept 回整条 entry、reject 回 null，调用方每次都得先判分支才知道拿到了什么。
      return {
        state: decision === 'accept' ? 'accepted' : 'rejected',
        entry: decision === 'accept' ? get(proposal.slug) : null,
      }
    })
  }

  /* ---------------------------------------------------------------- *
   * 写：唯一能写 md 的入口
   * ---------------------------------------------------------------- */

  /**
   * 把 spec 渲染成 md 并校验，**但不落盘**。
   *
   * promote 用的就是这一份，所以「预演过了」等价于「转正能过」——两者共用同一条路径，
   * 不会出现「预演通过、真写却失败」。批量采集时先整批预演，再整批转正。
   *
   * @returns {{ ok: boolean, markdown: string, problems: string[] }}
   */
  function checkEntry(spec) {
    const slug = spec?.slug ?? ''
    const markdown = renderEntryMd({ ...spec, tier: spec?.tier ?? 'candidate' })
    try {
      const entry = parse(markdown, `${slug}.md`)
      const problems = validateEntry(entry, { file: `${slug}.md`, expectedSlug: slug })
      return { ok: problems.length === 0, markdown, problems }
    } catch (error) {
      return { ok: false, markdown, problems: [error.message ?? String(error)] }
    }
  }

  /**
   * 把收件箱里的一条转正成 content/effects/<slug>.md。
   *
   * 这是整套协议里**唯一会写内容文件**的函数。写出去的东西必须能通过
   * parse + validate，过不了就把文件删掉回滚——绝不留下一个坏掉的库。
   */
  function promote(inboxId, spec) {
    const item = db.prepare('SELECT * FROM inbox WHERE id = ?').get(inboxId)
    if (!item) throw new VaultError(`收件箱里没有 #${inboxId}`)
    if (item.state !== 'new') throw new VaultError(`收件箱 #${inboxId} 已经是 ${item.state}，不再重复转正`)

    const slug = spec.slug
    if (!slug) throw new VaultError('promote 必须给 slug')
    const path = join(contentDir, `${slug}.md`)
    if (existsSync(path)) throw new VaultError(`${path} 已存在——拒绝覆盖，改 slug 或先人工合并`)

    const { markdown, problems } = checkEntry(spec)
    if (problems.length) {
      throw new VaultError(`转正内容不合规，未写入：\n  ${problems.join('\n  ')}`)
    }

    writeFileSync(path, markdown, 'utf8')
    try {
      rebuild({ force: false })
    } catch (error) {
      // 刚写进去的文件把库搞坏了：删掉，让 md 回到干净状态。
      unlinkSync(path)
      throw new VaultError(`新条目写坏了内容库，已回滚（${basename(path)} 已删除）：${error.message}`)
    }

    db.prepare('UPDATE inbox SET state = ?, slug = ? WHERE id = ?').run('accepted', slug, inboxId)
    recordEvent({ kind: 'promote', slug, reason: `收件箱 #${inboxId}` })

    return { slug, path, markdown }
  }

  function close() {
    db.close()
  }

  /* ---------------------------------------------------------------- *
   * 备份：唯一不可重建的那部分
   * ---------------------------------------------------------------- */

  /**
   * 导出运行时状态。
   *
   * 存在的理由：A 区丢了 rebuild 就回来，但 events 丢了就是真丢了。
   * 一条号称「不可重建」的数据必须有一个能搬走的形式，否则这个保证是空的。
   * 导出时丢掉自增主键——id 是本地实现细节，跨库没有意义，去重靠内容键。
   */
  function exportState() {
    return {
      format: 'spellbook-vault-state',
      version: 1,
      exportedAt: new Date().toISOString(),
      events: db
        .prepare(
          'SELECT ts, session, slug, kind, query, proposal_id, score, reason FROM events ORDER BY id',
        )
        .all(),
      proposals: db
        .prepare(
          'SELECT ts, session, query, slug, rank, score, state, resolved_ts, reason FROM proposals ORDER BY id',
        )
        .all(),
      inbox: db
        .prepare(
          'SELECT ts, origin, raw_ref, title_guess, category_guess, state, slug, note FROM inbox ORDER BY id',
        )
        .all(),
    }
  }

  /** 合并一份备份。按内容键去重，所以重复导入同一份文件是安全的（幂等）。 */
  function importState(state) {
    if (state?.format !== 'spellbook-vault-state') {
      throw new VaultError('这不是咒语库的备份文件（缺少 format 标记）')
    }

    return tx(() => {
      const seenEvent = new Set(
        db
          .prepare(
            "SELECT ts, kind, IFNULL(slug, '') AS slug, IFNULL(query, '') AS query FROM events",
          )
          .all()
          .map((r) => `${r.ts}|${r.kind}|${r.slug}|${r.query}`),
      )
      let events = 0
      for (const e of state.events ?? []) {
        const key = `${e.ts}|${e.kind}|${e.slug ?? ''}|${e.query ?? ''}`
        if (seenEvent.has(key)) continue
        seenEvent.add(key)
        // 逐字段搬：备份里的列名是 snake_case，recordEvent 收的是 camelCase，
        // 直接 recordEvent(e) 会把 proposal_id 静默丢掉。
        recordEvent({
          ts: e.ts,
          session: e.session,
          slug: e.slug,
          kind: e.kind,
          query: e.query,
          proposalId: e.proposal_id,
          score: e.score,
          reason: e.reason,
        })
        events++
      }

      const seenInbox = new Set(
        db.prepare("SELECT ts, origin, IFNULL(raw_ref, '') AS ref FROM inbox").all().map((r) => `${r.ts}|${r.origin}|${r.ref}`),
      )
      let inbox = 0
      for (const item of state.inbox ?? []) {
        const key = `${item.ts}|${item.origin}|${item.raw_ref ?? ''}`
        if (seenInbox.has(key)) continue
        seenInbox.add(key)
        db.prepare(
          'INSERT INTO inbox(ts, origin, raw_ref, title_guess, category_guess, state, slug, note) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        ).run(
          item.ts,
          item.origin,
          n(item.raw_ref),
          n(item.title_guess),
          n(item.category_guess),
          item.state ?? 'new',
          n(item.slug),
          n(item.note),
        )
        inbox++
      }

      recomputePriors()
      return { events, inbox }
    })
  }

  return {
    db,
    ensureFresh,
    rebuild,
    search,
    get,
    stats,
    drift,
    events,
    intake,
    inbox,
    propose,
    resolve,
    promote,
    checkEntry,
    exportState,
    importState,
    // 事务原语开出去，有两个理由：调用方需要「多步写入要么全成要么全不成」；
    // 而且不开出去的话，上面那个嵌套守卫就是不可达的代码——守卫必须能被触发、被测试。
    transaction: tx,
    rebuildTables: LIBRARY_TABLES,
    close,
  }
}

/** 站点与插件共用的默认路径。 */
export function defaultVaultPaths(root) {
  return { dbPath: join(root, 'data', 'vault.db'), contentDir: join(root, 'content', 'effects') }
}
