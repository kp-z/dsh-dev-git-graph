/**
 * 契约的"AI 理解"层。
 *
 * 分工：扫描仍是确定性代码（符号名、字段、来源文件），这一步只负责把扫描结果交给 AI，
 * 让 AI 给出人能一眼看懂的中文职责、中文族名与关系，并严格校验 AI 的返回。
 *
 * 两条硬规则：
 * 1) AI 返回不合格 → 整批拒绝并回显原因，绝不在本地补写中文（不做词典式生成）；
 * 2) 原始符号名（title）永远不被覆盖，AI 结果只作为附加字段写回。
 *
 * 这一层刻意**不碰存储、不碰 HTTP、不碰模型**：它只认"种子进、结果出"。落盘与调用分别归
 * `aiWorkflow.ts`（缓存与写回）和 `hostAi.ts`（宿主自己的 llm 服务）。这样这一层的测试不需要网络、不需要磁盘。
 */
import { createHash } from 'node:crypto'

/** AI 允许使用的关系词，超出即拒绝 */
export const REL_ALLOWED = ['imports', 'emits', 'contains', 'defines'] as const
export type Rel = (typeof REL_ALLOWED)[number]

/** 扫描出来的原始契约（确定性部分） */
export interface ContractSeed {
  id: string
  /** 代码里的原始符号名，例如 ContractRecord */
  name: string
  /** 来源文件相对路径 */
  file: string
  /** 字段名（+类型）列表 */
  fields: string[]
  /**
   * 已知邻居：同形（twins）、同文件、同边界。
   *
   * 只给**确定性**的邻居，不给"可能相关"的猜测——喂进去的猜测量，最后会变成图上一条
   * 来历不明的连线，而这条连线的作者是谁没人说得清。
   */
  neighbours?: Array<{ rel: string; id: string; name: string }>
}

export interface AiRelation {
  to: string
  rel: Rel
  why?: string
}

export interface AiItem {
  id: string
  /** 一句话中文职责 */
  titleZh: string
  /** 中文族名 */
  family?: string
  /**
   * 字段级中文：**种子里每个字段名都必须在**，且 `zh` 非空；少一个整批拒绝。
   *
   * 字段中文只能来自模型——这里没有任何"按字段名猜一个中文"的兜底（不许词典式翻译）。
   */
  fields?: AiField[]
  relations?: AiRelation[]
}

/** 一个字段的中文解释。`name` 与种子里的字段名逐字相同。 */
export interface AiField {
  name: string
  zh: string
}

export type ValidateResult =
  | { ok: true; items: AiItem[]; /** 模型少写的那几条（不写、不猜，如实报出来） */ missing: string[] }
  | { ok: false; why: string; raw: string }

/** 内容哈希：只有内容变了才需要重新问 AI */
export function contentHash(seed: ContractSeed): string {
  const h = createHash('sha256')
  h.update(`${seed.name}\u0000${seed.file}\u0000${seed.fields.join('\u0001')}`)
  return h.digest('hex').slice(0, 16)
}

/** 提示词的开场白：口径与硬约束。 */
const PROMPT_INTRO = [
  '你在为一个"契约管理"工具生成说明。下面是扫描出来的真实代码契约（名字、来源文件、字段、已知邻居）。',
  '请为每一个契约写：titleZh（一句话中文职责，让不了解这个项目的人一眼看懂它在干什么，长度不限，不要用生僻缩写）、family（中文族名，例如 契约存储 / 引用解析 / 观测采集）、fields（**必填项，给下面给出的每一个字段一条中文解释**：{name, zh}，name 必须与给定的字段名逐字相同、一个都不能少、也不许自己加）、relations（只在与本批其它契约确实有关系时给出）。',
  'fields 是硬要求，不是可选装饰：每个契约下面 `fields` 里列出的字段（`名字:类型`，带"进来/出去"前缀时前缀只表示方向、name 里不要写）**每一个都要有**。少写一个字段、写错名字、或写一个上面没有的字段名，**整批**（连同其它契约的 titleZh、family）都会被判不合格、整批作废——所以宁可慢一点，也要逐个对上名字再写。契约下面没有列出任何字段时，该契约的 fields 写空数组即可。',
  '字段的中文要说清"这个字段是干什么用的、取值范围或单位"，不要只把字段名音译一遍；带"进来/出去"前缀的字段，前缀只表示方向，name 里不要写前缀。',
  '中文必须由你写：不要输出英文标题，也不要只把符号名音译。信息不足时按符号名与字段如实描述，不要编造行为。',
  '只输出 JSON，不要解释、不要 Markdown 代码块：',
  '{"items":[{"id":"<原样返回给定 id>","titleZh":"...","family":"...","fields":[{"name":"<给定的字段名>","zh":"..."}],"relations":[{"to":"<本批中的 id>","rel":"imports|emits|contains|defines","why":"一句话理由"}]}]}',
].join('\n')

/** 把种子整理成模型要看的载荷：只有事实。 */
function promptPayload(seeds: readonly ContractSeed[]): string {
  const contracts = seeds.map((s) => {
    const item: Record<string, unknown> = { id: s.id, name: s.name, file: s.file, fields: s.fields }
    if (s.neighbours !== undefined && s.neighbours.length > 0) {
      item['neighbours'] = s.neighbours.map((n) => ({ rel: n.rel, id: n.id, name: n.name }))
    }
    return item
  })
  return JSON.stringify({ contracts }, null, 1)
}

/** 提示词的用户段：这一批契约本身（不含任何现成中文答案）。 */
export function buildPromptUser(seeds: readonly ContractSeed[]): string {
  return promptPayload(seeds)
}

/**
 * 组装提示词：只给事实，不给答案。
 *
 * 保留这个"一整段"的入口是因为它读起来最省事；真要发给模型时用 `buildPromptParts()`——
 * 宿主 llm 服务收的就是 `system` + `messages` 两段，合成一段再拆回去是自找麻烦。
 */
export function buildPrompt(seeds: readonly ContractSeed[]): string {
  return `${PROMPT_INTRO}\n\n${promptPayload(seeds)}`
}

/**
 * 分段提示词：`system` 走宿主 llm 的 system 字段，`user` 走一条 user 消息。
 * 每一段都是**事实**（符号名、签名、字段、注释），中文职责由模型自己写。
 */
export function buildPromptParts(seeds: readonly ContractSeed[]): { system: string; user: string } {
  return { system: PROMPT_INTRO, user: promptPayload(seeds) }
}

/**
 * 种子里那一行行字段文本 → **字段名**。
 *
 * 两种写法都要认（种子的样子取决于来源）：
 *   - `进来 user_id:string（可缺省）` / `出去 ok:boolean` → `user_id` / `ok`（前缀只说方向）；
 *   - 裸名字 `id`（有的调用方直接给名字）。
 * `（抽取器没有记录到字段）`这种占位不是字段，会被滤掉——于是这条契约的字段要求就是"没有字段"。
 *
 * 同名只算一次：`进来 id` 与 `出去 id` 是同一个字段名的两侧，模型给一条中文就够（渲染时两侧共用）。
 */
export function seedFieldNames(seed: ContractSeed): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  for (const line of seed.fields) {
    const bare = line.replace(/^(进来|出去)\s*/, '').trim()
    if (bare === '' || bare.startsWith('（')) continue
    const cut = bare.indexOf(':')
    const name = (cut === -1 ? bare : bare.slice(0, cut)).trim()
    if (name === '' || seen.has(name)) continue
    seen.add(name)
    out.push(name)
  }
  return out
}

/** 校验时可以收紧的口径（默认全关，保持既有调用方的语义不变）。 */
export interface ValidateOptions {
  /**
   * 关系 `to` 允许指向的 id 集合。默认只允许本批——但有跨批的真实关系（同文件、同边界的两条
   * 契约经常不在同一批里），所以引擎那一侧会传"项目里全部契约 id"。
   */
  knownIds?: ReadonlySet<string>
  /** 要求 titleZh（与出现时的 family）必须含中文。 */
  requireChinese?: boolean
  /** 要求每条都必须给出 family。 */
  requireFamily?: boolean
  /** titleZh 的长度上限。 */
  titleMax?: number
  /**
   * 这一批**每一条契约的字段名清单**（键是契约 id）。
   *
   * 给了它就按字段级中文件严格判：种子里的每个字段名都必须在 `fields` 里出现且 `zh` 非空，
   * 缺一个 → **整批拒绝、零写回**；多出不存在的字段名同样拒绝（那是模型在编字段）。
   * 没给（单测里直接调校验器时）就不做字段级要求——要求什么，取决于调用方知道什么。
   */
  seedFields?: ReadonlyMap<string, readonly string[]>
  /** 字段中文的长度上限。 */
  fieldMax?: number
}

/** 长度上限的默认值：超过它基本可以断定模型写成了一整段。 */
const TITLE_MAX_DEFAULT = 200

/** 字段中文的长度上限：一行解释，不该是一段话。 */
const FIELD_MAX_DEFAULT = 120

/** 是否含中文。 */
function hasChinese(value: string): boolean {
  return /[\u3400-\u9fff]/.test(value)
}

/** 严格校验 AI 返回：任何一项不合格，整批拒绝 */
export function validateAiPayload(
  raw: unknown,
  batchIds: readonly string[],
  options: ValidateOptions = {},
): ValidateResult {
  const rawText = typeof raw === 'string' ? raw : safeStringify(raw)
  let data: unknown = raw
  if (typeof raw === 'string') {
    try {
      data = JSON.parse(raw)
    } catch {
      return { ok: false, why: 'AI 返回不是合法 JSON', raw: rawText }
    }
  }
  if (!data || typeof data !== 'object') return { ok: false, why: 'AI 返回不是对象', raw: rawText }
  const itemsRaw = (data as { items?: unknown }).items
  if (!Array.isArray(itemsRaw)) return { ok: false, why: 'AI 返回缺少 items 数组', raw: rawText }

  const allowed = new Set<string>(batchIds)
  // 关系的可达集合：默认就是本批，给了 knownIds 就以它为准（本批必须是它的子集，否则是调用方用错了）。
  const reachable = options.knownIds ?? allowed
  const titleMax = options.titleMax ?? TITLE_MAX_DEFAULT
  const fieldMax = options.fieldMax ?? FIELD_MAX_DEFAULT
  const out: AiItem[] = []
  const seen = new Set<string>()
  for (const entry of itemsRaw) {
    if (!entry || typeof entry !== 'object') return { ok: false, why: 'items 里出现非对象项', raw: rawText }
    const o = entry as Record<string, unknown>
    const id = typeof o.id === 'string' ? o.id : ''
    if (!id) return { ok: false, why: '有 item 缺少 id', raw: rawText }
    if (!allowed.has(id)) return { ok: false, why: `id ${id} 不属于本批（AI 编造或串批）`, raw: rawText }
    if (seen.has(id)) return { ok: false, why: `id ${id} 在本批里重复出现`, raw: rawText }
    seen.add(id)
    const titleZh = typeof o.titleZh === 'string' ? o.titleZh.trim() : ''
    if (!titleZh) return { ok: false, why: `id ${id} 的 titleZh 为空`, raw: rawText }
    if (titleZh.length > titleMax) {
      return { ok: false, why: `id ${id} 的 titleZh 超过 ${titleMax} 字（${titleZh.length}）`, raw: rawText }
    }
    if (/<[a-z!/][^>]*>/i.test(titleZh)) return { ok: false, why: `id ${id} 的 titleZh 含 HTML 标签`, raw: rawText }
    if (options.requireChinese === true && !hasChinese(titleZh)) {
      return { ok: false, why: `id ${id} 的 titleZh 不含中文（要求中文职责，不接受英文标题）`, raw: rawText }
    }

    const item: AiItem = { id, titleZh }
    const family = typeof o.family === 'string' ? o.family.trim() : ''
    if (family) {
      if (family.length > 40) return { ok: false, why: `id ${id} 的 family 超过 40 字`, raw: rawText }
      if (options.requireChinese === true && !hasChinese(family)) {
        return { ok: false, why: `id ${id} 的 family 不含中文（要求中文族名）`, raw: rawText }
      }
      item.family = family
    } else if (options.requireFamily === true) {
      return { ok: false, why: `id ${id} 缺少 family（要求中文族名）`, raw: rawText }
    }

    if (o.relations !== undefined) {
      if (!Array.isArray(o.relations)) return { ok: false, why: `id ${id} 的 relations 不是数组`, raw: rawText }
      const rels: AiRelation[] = []
      for (const r of o.relations) {
        const ro = r && typeof r === 'object' ? (r as Record<string, unknown>) : {}
        const to = typeof ro.to === 'string' ? ro.to : ''
        const rel = typeof ro.rel === 'string' ? ro.rel : ''
        if (!to || !(REL_ALLOWED as readonly string[]).includes(rel)) {
          return { ok: false, why: `id ${id} 的关系不合法（to=${to || '空'} rel=${rel || '空'}）`, raw: rawText }
        }
        if (!reachable.has(to)) return { ok: false, why: `id ${id} 的关系指向未知契约 ${to}`, raw: rawText }
        const one: AiRelation = { to, rel: rel as Rel }
        const why = typeof ro.why === 'string' ? ro.why.trim() : ''
        if (why) {
          if (why.length > 200) return { ok: false, why: `id ${id} 的关系理由超过 200 字`, raw: rawText }
          if (/<[a-z!/][^>]*>/i.test(why)) return { ok: false, why: `id ${id} 的关系理由含 HTML 标签`, raw: rawText }
          one.why = why
        }
        rels.push(one)
      }
      if (rels.length) item.relations = rels
    }

    /* 字段级中文：调用方给了"这一条有哪些字段"就按它严格判。
       放在最后判，是为了让"关系写错"这类更结构性问题的原因先报出来（老测试与老习惯都按那个认）。 */
    const wantFields = options.seedFields?.get(id)
    if (wantFields !== undefined) {
      const list = o.fields
      if (list !== undefined && !Array.isArray(list)) {
        return { ok: false, why: `id ${id} 的 fields 不是数组`, raw: rawText }
      }
      const given = Array.isArray(list) ? list : []
      const byName = new Map<string, string>()
      for (const entry of given) {
        if (!entry || typeof entry !== 'object') {
          return { ok: false, why: `id ${id} 的 fields 里出现非对象项`, raw: rawText }
        }
        const fo = entry as Record<string, unknown>
        const name = typeof fo.name === 'string' ? fo.name.trim() : ''
        if (name === '') return { ok: false, why: `id ${id} 的 fields 里有条目缺少 name`, raw: rawText }
        if (!wantFields.includes(name)) {
          return { ok: false, why: `id ${id} 的字段 ${name} 不在种子给出的字段里（AI 编造字段）`, raw: rawText }
        }
        if (byName.has(name)) return { ok: false, why: `id ${id} 的字段 ${name} 重复出现`, raw: rawText }
        const zh = typeof fo.zh === 'string' ? fo.zh.trim() : ''
        if (zh === '') {
          return { ok: false, why: `id ${id} 的字段 ${name} 的 zh 为空`, raw: rawText }
        }
        if (zh.length > fieldMax) {
          return { ok: false, why: `id ${id} 的字段 ${name} 的 zh 超过 ${fieldMax} 字（${zh.length}）`, raw: rawText }
        }
        if (/<[a-z!/][^>]*>/i.test(zh)) {
          return { ok: false, why: `id ${id} 的字段 ${name} 的 zh 含 HTML 标签`, raw: rawText }
        }
        if (options.requireChinese === true && !hasChinese(zh)) {
          return { ok: false, why: `id ${id} 的字段 ${name} 的 zh 不含中文（要求中文解释，不接受英文）`, raw: rawText }
        }
        byName.set(name, zh)
      }
      /* 一个字段都不能少：少一个就整批拒绝——半份字段中文比没有更糟，人会以为"就这些"。 */
      for (const name of wantFields) {
        if (!byName.has(name)) {
          return { ok: false, why: `id ${id} 的字段 ${name} 缺少中文解释（种子里的每个字段都要有）`, raw: rawText }
        }
      }
      /* 按种子的顺序写回：渲染时的顺序与扫描出的字段顺序一致，读起来稳。 */
      item.fields = wantFields.map((name) => ({ name, zh: byName.get(name) as string }))
      if (item.fields.length === 0) delete item.fields
    }
    out.push(item)
  }
  if (!out.length) return { ok: false, why: 'items 为空', raw: rawText }
  // 少写的那几条不算"不合格"（模型没说的东西不该由我们编），但必须如实报出来：
  // 它们既不写回、也不进缓存，下一次还会再问。
  const missing = batchIds.filter((id) => !seen.has(id))
  return { ok: true, items: out, missing }
}

/** 把 AI 结果写回契约：原始 name/title 不动，只加字段 */
export function applyAiItems<T extends { id: string }>(
  records: readonly T[],
  items: readonly AiItem[],
): Array<T & { aiTitle?: string; aiFamily?: string; aiFields?: AiField[]; aiRelations?: AiRelation[] }> {
  const by = new Map(items.map((i) => [i.id, i]))
  return records.map((r) => {
    const hit = by.get(r.id)
    if (!hit) return { ...r }
    const out: T & { aiTitle?: string; aiFamily?: string; aiFields?: AiField[]; aiRelations?: AiRelation[] } = {
      ...r,
      aiTitle: hit.titleZh,
    }
    if (hit.family) out.aiFamily = hit.family
    /* 字段中文只写模型真给过的：没有 `fields` 就不写这一项（绝不用本地词典补）。 */
    if (hit.fields && hit.fields.length > 0) out.aiFields = hit.fields.map((f) => ({ name: f.name, zh: f.zh }))
    if (hit.relations) out.aiRelations = hit.relations
    return out
  })
}

export interface UnderstandDeps {
  /** 真正调模型的地方：输入提示词与本批 id，返回模型原始输出（字符串或已解析对象） */
  caller: (prompt: string, ids: readonly string[]) => Promise<unknown>
  /** 内容哈希 → AI 结果；同一个 Map 反复用即实现缓存 */
  cache?: Map<string, AiItem>
  batchSize?: number
  /** 进度回调：已完成批数 / 总批数 */
  onBatch?: (done: number, total: number) => void
}

export interface UnderstandResult {
  ok: boolean
  batches: number
  /** 实际问过 AI 的契约数 */
  asked: number
  /** 命中缓存、没问 AI 的契约数 */
  cached: number
  written: number
  why?: string
}

/** 分批理解；任何一批不合格立即停止并返回原因（不做本地补写） */
export async function understand(
  seeds: readonly ContractSeed[],
  deps: UnderstandDeps,
): Promise<UnderstandResult> {
  const cache = deps.cache ?? new Map<string, AiItem>()
  const size = deps.batchSize && deps.batchSize > 0 ? deps.batchSize : 25
  const pending: ContractSeed[] = []
  let cached = 0
  for (const s of seeds) {
    if (cache.has(contentHash(s))) cached += 1
    else pending.push(s)
  }
  let batches = 0
  let asked = 0
  let written = 0
  const total = Math.ceil(pending.length / size)
  for (let i = 0; i < pending.length; i += size) {
    const slice = pending.slice(i, i + size)
    const ids = slice.map((s) => s.id)
    /* 字段级要求来自种子本身：这一批每条契约有哪些字段，校验器就该按它要求"每个字段都有中文"。
       少了字段、多编字段都是整批拒绝——所以这里不是可选项，是这一批的**合同**。 */
    const seedFields = new Map<string, readonly string[]>(
      slice.map((seed) => [seed.id, seedFieldNames(seed)] as const),
    )
    batches += 1
    const raw = await deps.caller(buildPrompt(slice), ids)
    const res = validateAiPayload(raw, ids, { seedFields })
    if (!res.ok) return { ok: false, batches, asked, cached, written, why: res.why }
    for (const item of res.items) {
      const seed = slice.find((s) => s.id === item.id)
      if (!seed) continue
      cache.set(contentHash(seed), item)
      written += 1
    }
    asked += slice.length
    if (deps.onBatch) deps.onBatch(batches, total)
  }
  return { ok: true, batches, asked, cached, written }
}

function safeStringify(v: unknown): string {
  try {
    return JSON.stringify(v) ?? String(v)
  } catch {
    return String(v)
  }
}