/**
 * 咒语书 —— 检索用文本层
 *
 * 只干一件事：把「人写的中文」变成「SQLite FTS5 能算分的 token」，再决定各列权重。
 * 和 parse.mjs / schema.mjs 一样不依赖任何第三方库 —— 构建期和 DSH 插件共用同一份规则，
 * 否则同一个查询在站点和插件里会给出不同的答案，那就等于有两个真相。
 *
 * 为什么必须拆字：
 *   FTS5 默认的分词器 unicode61 把连续汉字当成 **一个 token**，
 *   所以 `液态玻璃面板` 会被索引成单独一个 token，查「玻璃」命中 0 条。
 *   在汉字两侧插空格，让每个汉字各自成为一个 token，中文子串检索才成立。
 *   这一条实测过：拆字前「玻璃」「面板」都搜不到，拆字后全部命中。
 */

/** 需要逐字拆开才搜得到的字符（表意文字 + 假名 + 谚文）。 */
const CJK = /([\u3400-\u4DBF\u4E00-\u9FFF\uF900-\uFAFF]|[\u3040-\u30FF\uAC00-\uD7AF])/g

/**
 * 在 CJK 字符两侧插空格。索引和查询都必须先过这一道，否则 token 对不上。
 * 不是 CJK 的部分（英文、数字、连字符）保持原样，交给 unicode61 正常分词。
 */
export function spaced(text) {
  return String(text ?? '').replace(CJK, ' $1 ')
}

/**
 * 提问里的虚词。留着它们只会让「我想要一个……的按钮」这种句子把 bm25 稀释，
 * 让真正有信息量的词（玻璃、模糊、跟随）失去区分度。
 */
export const STOPWORDS = new Set([
  '我', '你', '他', '她', '它', '我们', '要', '想', '想要', '需要', '希望', '最好', '应该',
  '的', '地', '得', '了', '着', '过', '把', '被', '让', '给', '跟', '和', '与', '或', '也', '都',
  '是', '有', '能', '会', '可以', '能过', '一个', '一种', '一块', '一条', '一些', '个', '些',
  '这', '那', '这种', '那个', '这个', '那么', '怎么', '如何', '什么', '为什', '哪个', '哪些',
  '在', '到', '从', '对', '向', '往', '把', '吗', '呢', '吧', '啊', '请', '帮我', '帮忙',
  '实现', '做', '做成', '搞', '弄', '写', '出来', '起来', '一下', '有点', '比较', '稍微',
  'a', 'an', 'the', 'i', 'we', 'you', 'it', 'to', 'of', 'and', 'or', 'for', 'with', 'is', 'are',
  'want', 'need', 'make', 'like', 'please', 'some', 'that', 'this',
  // 量词单字：它们自己没信息，还会跟后面的名词粘成「块玻」这种假词
  '一', '二', '三', '块', '个', '些', '条', '张', '只', '点', '种', '把', '位', '层', '段', '组',
  '串', '件', '台', '部', '本', '页', '行', '列', '颗', '粒', '滴', '副', '套', '对', '双',
])

/** 把一段文字切成检索用的 token（已拆字、已小写、已去停用词）。 */
export function terms(text) {
  return spaced(text)
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((t) => t && !STOPWORDS.has(t))
}

/** 单个汉字若本身是虚词，参与组双字时算「无信息」。 */
const STOP_CHARS = new Set([...STOPWORDS].filter((w) => w.length === 1))

const CJK_CLASS = '[\\u3400-\\u4DBF\\u4E00-\\u9FFF\\uF900-\\uFAFF\\u3040-\\u30FF\\uAC00-\\uD7AF]'
// 英文段允许连字符与点号留在词内，这样 backdrop-filter 是一个单元、成一条短语，
// 而不是被拆成 backdrop / filter 两个可各自命中的词——那样精度会掉。
const UNIT_RE = new RegExp(`(${CJK_CLASS}+)|([A-Za-z0-9][A-Za-z0-9_+#.-]*)`, 'g')

/**
 * 把查询切成检索单元。中文按**双字滑窗**成短语，不按单字。
 *
 * 为什么不是单字：单字精度太低。查「完全无关的东西 番茄炒蛋」这种纯噪音，
 * 单字 东 / 西 / 全 会在别的条目里碰到，于是噪音条目也能拿到分。
 * 双字短语要求两个字相邻，精度立刻上来，而「玻璃」「面板」这类词本来就是双字。
 *
 * 为什么不是整段：整段汉字当成一个短语就什么也搜不到——用户不会正好写出原文。
 *
 * @returns {string[][]} 每个单元是一串必须相邻的 token，例如 [['玻','璃']]
 */
export function units(text) {
  const out = []
  for (const m of String(text ?? '').matchAll(UNIT_RE)) {
    if (m[1]) {
      const run = m[1]
      if (run.length === 1) {
        if (!STOP_CHARS.has(run)) out.push([run])
        continue
      }
      for (let i = 0; i < run.length - 1; i++) {
        const a = run[i]
        const b = run[i + 1]
        // 两个字都是虚词（我想 / 要一 / 上的）这种双字没有区分度，丢掉
        if (STOP_CHARS.has(a) && STOP_CHARS.has(b)) continue
        out.push([a, b])
      }
    } else if (m[2]) {
      const word = m[2].toLowerCase().replace(/[.-]+$/, '')
      if (word.length > 1 && !STOPWORDS.has(word)) out.push([word])
    }
  }
  return out
}

/**
 * 组装 FTS5 的 MATCH 表达式。
 * 单元之间是 OR：中文提问里只要命中「玻璃」就该召回液态玻璃，不必强求同时命中「面板」；
 * 命中越多单元的自然被 bm25 排前面。
 * 单元之内是短语：两个字必须相邻，这是精度的来源。
 * @returns {string|null} 全是虚词时返回 null（调用方应直接返回空结果）
 */
export function matchExpr(text) {
  const found = units(text)
  if (!found.length) return null
  return found.map((u) => `"${u.join(' ').replace(/"/g, '""')}"`).join(' OR ')
}

/**
 * FTS5 各列的 bm25 权重。
 *
 * 顺序必须与 vault.mjs 里 match_fts 的建表列顺序完全一致。
 * mechanisms 给到最高（6.0），这是把站点上那条视觉规则下沉到检索排序里：
 * 描述里被红墨标出的 ==机制== 就是「排版权重 = 迁移权重」——
 * 用户说「要个跟着指针动的按钮」，命中机制短语 proximity 的那条，
 * 必须压过只在标题里出现「按钮」的那条。
 */
export const BM25_WEIGHTS = {
  slug: 0, // UNINDEXED，权重无效，占位用
  title: 2,
  when_text: 3,
  tags: 2.5,
  mechanisms: 6,
  code_text: 0.5, // 代码整段是噪音，压低
  description: 1.5,
}

/** 与建表列顺序一致的权重列表，直接拼进 bm25(...) 的 SQL 字面量（常量，非用户输入）。 */
export const BM25_ARGS = Object.values(BM25_WEIGHTS).join(', ')

/**
 * 分层权重。自动提议只从「核心」出，所以默认检索就限定 core；
 * 归档不是删除，它只是不再自动出现在你面前。
 */
export const TIER_WEIGHT = { core: 1, candidate: 0.4, archive: 0.05 }

/**
 * 历史先验的乘数。**入参是 weight 那个数字本身**（不是行对象）。
 * weight ∈ [0,1]，0.5 表示「还没有信息」（拉普拉斯平滑的中性点）。
 * 采纳过的排序上浮，最多 1.6 倍；被反复否决的下沉，最低 0.5 倍。
 * 乘数刻意温和：一条被采纳过一次的咒语，不该压过一条明显更贴切的咒语。
 *
 * 注意 null/undefined 必须单独判：Number(null) 是 0，
 * 会被当成「采纳率 0」狠狠扣分，而不是「还没有信息」的中性。
 */
export function priorBoost(weight) {
  if (weight === null || weight === undefined || weight === '') return 1
  const w = Number(weight)
  if (!Number.isFinite(w)) return 1
  return Math.min(1.6, Math.max(0.5, 1 + (w - 0.5) * 0.6))
}

/**
 * 综合排序分：相关度 × 分层 × 历史。
 *
 * 相关度用 exp(raw/SCALE) 而不是直接取 raw 再「max(0, ·)」夹掉负值——
 * bm25 的 IDF 项在「同一个词出现在过半文档里」时是负的，小语料上极易发生，
 * 那时 clamp 会把所有弱命中压成同一个 0 分，**顺序信息整个丢掉**。
 * exp 单调且恒正，既保住顺序，又保证分层与历史先验的乘法方向不会翻转
 * （否则归档的 0.05 倍会把一个负分拉近 0，反而排到核心条目前面）。
 */
const RELEVANCE_SCALE = 4

export function scoreOf(rawBm25, tier, priorWeight) {
  const relevance = Math.exp(Number(rawBm25 ?? 0) / RELEVANCE_SCALE)
  const tierW = TIER_WEIGHT[tier] ?? TIER_WEIGHT.candidate
  return relevance * tierW * priorBoost(priorWeight)
}

/**
 * 说清「为什么是它」。
 * 提议给用户看的时候必须有理由——只给一个排序结果，用户无法判断该不该信。
 * @returns {string} 例如「机制：pointer proximity」
 */
export function explain(row, query) {
  const tokens = terms(query)
  if (!tokens.length) return '无检索词'
  const has = (text) => {
    const hay = String(text ?? '').toLowerCase()
    return tokens.some((t) => hay.includes(t))
  }

  for (const phrase of row.mechanisms ?? []) {
    if (has(phrase)) return `机制：${phrase}`
  }
  for (const tag of row.tags ?? []) {
    if (has(tag)) return `标签：${tag}`
  }
  if (has(row.title)) return `标题：${row.title}`
  if (has(row.when_text)) return `场合：${row.when_text}`
  return '描述命中'
}
