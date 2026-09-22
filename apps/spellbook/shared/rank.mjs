/**
 * 咒语书 —— 站点检索的排序器（纯函数）
 *
 * 为什么存在这一份：
 *   库里的检索问答由 SQLite FTS5 负责（shared/vault.mjs 的 search()）。
 *   站点首页是纯静态页，浏览器里没有 SQLite，所以那套用不上。
 *   但「站点搜出来的顺序」必须和「库里搜出来的顺序」是一回事 ——
 *   否则同一个查询在两个地方给两个答案，就等于有两个真相。
 *
 * 所以这一份刻意与 FTS5 对齐，而不是另起一套灵感：
 *   - 分词走 shared/vault-text.mjs 的 units()：中文按**双字滑窗成短语**，英文整词
 *   - 列权重走同一张 BM25_WEIGHTS 表（机制列 6.0 最高）
 *   - 打分公式用 FTS5 bm25() 的那一条：k1=1.2、b=0.75、idf 不夹负值
 *   - 综合分走同一份 scoreOf()（相关度 × 分层 × 历史先验）
 *
 * 有测试盯着这件事：test/rank.test.mjs 拿一批查询同时问库里和这里，
 * 要求 Top-1 一致。它们一旦分道扬镳，测试就红。
 *
 * 与 FTS5 已知的差异（不影响排序方向）：
 *   - FTS5 的 idf 用它的内部计数；这里用自然对数、按「含该短语的文档数」算
 *   - FTS5 的 |D| 是行内 token 总数；这里同样按各列 token 数求和
 *   绝对值会有差异，所以门槛也用**相对**比例，不用绝对分数。
 */

import { units, BM25_WEIGHTS, scoreOf } from './vault-text.mjs'

/**
 * 把 units 转出去给页面用（描红要按同一套切词走，否则高亮与命中会对不上）。
 * 这个包已经 import 了它，再 export 一次不额外增加请求。
 */
export { units }

/** FTS5 的默认参数。改它会让站点与库的分歧变大，没有理由别动。 */
export const BM25_K1 = 1.2
export const BM25_B = 0.75

/** 参与检索的列。顺序与 match_fts 的建表列一致（slug 是 UNINDEXED，不参与）。 */
export const RANK_COLUMNS = ['title', 'when_text', 'tags', 'mechanisms', 'code_text', 'description']

/**
 * 把一段文字切成 token 数组。
 * 与 FTS5 + spaced() 的索引结果一致：每个汉字各自一个 token，英文整词一个。
 */
export function tokenize(text) {
  return String(text ?? '')
    .replace(/([\u3400-\u4DBF\u4E00-\u9FFF\uF900-\uFAFF]|[\u3040-\u30FF\uAC00-\uD7AF])/g, ' $1 ')
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean)
}

/** 短语（若干相邻 token）在 token 数组里出现的次数。 */
function phraseCount(tokens, phrase) {
  const n = phrase.length
  if (!n || tokens.length < n) return 0
  let hits = 0
  outer: for (let i = 0; i <= tokens.length - n; i++) {
    for (let j = 0; j < n; j++) {
      if (tokens[i + j] !== phrase[j]) continue outer
    }
    hits++
  }
  return hits
}

const keyOf = (phrase) => phrase.join('\u0001')

/**
 * 建索引。docs 是 [{ slug, title, when_text, tags, mechanisms, code_text, description, ... }]，
 * 与 dist/search-index.json 里的一条一一对应（数组都已拼成字符串）。
 *
 * @returns {{N:number, avgdl:number, df:Map<string,number>, docs:Array}}
 */
export function buildIndex(docs) {
  const prepared = []
  const df = new Map()

  for (const doc of docs) {
    const tokens = {}
    let dl = 0
    for (const col of RANK_COLUMNS) {
      const t = tokenize(doc[col])
      tokens[col] = t
      dl += t.length
    }
    prepared.push({ doc, tokens, dl })

    // 文档频率按「这个短语出现在这篇文档里吗」算一次，不按出现次数
    const seen = new Set()
    for (const col of RANK_COLUMNS) {
      for (const phrase of allPhrasesOf(tokens[col])) seen.add(phrase)
    }
    for (const k of seen) df.set(k, (df.get(k) ?? 0) + 1)
  }

  const N = prepared.length
  const avgdl = N ? prepared.reduce((sum, p) => sum + p.dl, 0) / N : 0
  return { N, avgdl, df, docs: prepared }
}

/**
 * 一篇文档里出现过的所有短语（长度 1 与 2 的窗口）。
 * 只需要这两档：units() 产出的中文单元恰好是双字、英文单元是单个整词。
 */
function allPhrasesOf(tokens) {
  const out = []
  for (let i = 0; i < tokens.length; i++) {
    out.push(tokens[i])
    if (i + 1 < tokens.length) out.push(tokens[i] + '\u0001' + tokens[i + 1])
  }
  return out
}

/**
 * 对一个查询打分。返回按综合分降序的结果。
 *
 * @param {object} index buildIndex 的产物
 * @param {string} query
 * @param {{limit?:number, tier?:string|null, category?:string|null, minRatio?:number}} opts
 */
export function rank(index, query, { limit = 30, tier = null, category = null, minRatio = 0.03 } = {}) {
  const found = units(query)
  if (!found.length || !index.N) return []

  /*
   * 查询单元必须过一遍与文档**完全相同**的分词器，否则带连字符的英文词永远搜不到。
   *
   * 出在这里的原因：units() 刻意把 backdrop-filter 当成**一个**单元（它想表达的是
   * 「这个词是一件事」），而 FTS5 的 unicode61 与这里的 tokenize() 都把连字符当分隔符，
   * 索引里存的是 backdrop 与 filter 两个相邻 token。
   * 直接拿 ['backdrop-filter'] 去比，是拿一个不存在的 token 做全等比较 —— 命中恒为 0，
   * 而且不报错。实测过：查 backdrop-filter / clip-path / shape-outside 全是 0 条。
   *
   * 过一遍 tokenize 之后，['backdrop-filter'] 变成相邻短语 ['backdrop','filter']，
   * 语义与 FTS5 的短语查询一致，中文双字短语则原样保留。
   */
  const phrases = found
    .map((unit) => tokenize(unit.join('')))
    .filter((p) => p.length)
    .map((p) => ({ phrase: p, key: keyOf(p) }))

  if (!phrases.length) return []
  const scored = []

  for (const { doc, tokens, dl } of index.docs) {
    if (tier && tier !== 'all' && doc.tier !== tier) continue
    if (category && doc.category !== category) continue

    let raw = 0
    const hits = []

    for (const { phrase, key } of phrases) {
      // 各列的加权词频：FTS5 的 bm25(X, w1, w2, ...) 就是按列乘权重
      let weighted = 0
      const perCol = {}
      for (const col of RANK_COLUMNS) {
        const c = phraseCount(tokens[col], phrase)
        if (c) {
          perCol[col] = c
          weighted += (BM25_WEIGHTS[col] ?? 1) * c
        }
      }
      if (!weighted) continue

      const n = index.df.get(key) ?? 0
      // FTS5 不把 idf 夹到 0 —— 词出现在过半文档里时它是负的，这是原样保留的行为
      const idf = Math.log((index.N - n + 0.5) / (n + 0.5))
      const norm = BM25_K1 * (1 - BM25_B + (BM25_B * dl) / (index.avgdl || 1))
      raw += (idf * weighted * (BM25_K1 + 1)) / (weighted + norm)
      hits.push({ phrase, perCol })
    }

    if (!hits.length) continue
    scored.push({
      slug: doc.slug,
      raw,
      score: scoreOf(raw, doc.tier, doc.prior_weight ?? null),
      why: explainHit(doc, hits),
      hits,
    })
  }

  scored.sort((a, b) => b.score - a.score)

  // 相对门槛：bm25 对「只沾了一个词」的文档给出的是 1e-6 量级的正数，光靠 > 0 筛不掉。
  // 与库里同一条规则 —— 只在最好成绩为正、可以相对比较时才过滤。
  const best = scored[0]?.raw ?? 0
  const kept = minRatio > 0 && best > 0 ? scored.filter((hit) => hit.raw >= best * minRatio) : scored
  return kept.slice(0, limit)
}

const COL_LABEL = {
  mechanisms: '机制',
  tags: '标签',
  title: '标题',
  when_text: '场合',
  description: '描述',
  code_text: '代码',
}

/**
 * 说清「为什么是它」。与库里的 explain() 同一条优先级：
 * 机制 → 标签 → 标题 → 场合 → 描述。
 *
 * 站点上这一条是搜索的**签名**：结果不只要给标题，还要给出命中的那句机制，
 * 因为全库的立论是「机制是承重墙」——搜索也该照这个立论来解释自己。
 */
function explainHit(doc, hits) {
  const order = ['mechanisms', 'tags', 'title', 'when_text', 'description', 'code_text']
  let best = null
  for (const col of order) {
    for (const hit of hits) {
      if (hit.perCol[col]) {
        best = { col, phrase: hit.phrase }
        break
      }
    }
    if (best) break
  }
  if (!best) return null

  const label = COL_LABEL[best.col] ?? best.col
  const phrase = best.phrase
  // 能回原文的列就把原文整句拿出来，比只给一个词有用得多
  const source = best.col === 'mechanisms' ? (doc.mechanism_list ?? []) : null
  if (source) {
    const full = source.find((m) => tokenize(m).join('\u0001').includes(phrase.join('\u0001')))
    if (full) return { label, text: full, quote: true }
  }
  if (best.col === 'tags') {
    const full = (doc.tag_list ?? []).find((t) => tokenize(t).join('\u0001').includes(phrase.join('\u0001')))
    if (full) return { label, text: full, quote: true }
  }
  if (best.col === 'when_text') return { label, text: doc.when_text, quote: false }
  if (best.col === 'title') return { label, text: doc.title, quote: false }
  return { label, text: phrase.join(''), quote: false }
}
