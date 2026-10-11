/**
 * spellbook_lookup —— 让模型自己把那条咒语取到手。
 *
 * 验收 D 是「被引用自动实现」：用户在对话里说「用咒语 neon-glow」，或者只说一句
 * 「深色招牌上要一行发光的字」，模型得自己把那份任务书取回来，而不是等用户从
 * 侧边栏复制粘贴过来。模型本来就会调工具，所以这条路比去改 composer 的 @ 引用稳。
 *
 * 检索走站点那一套：dist/rank.mjs（buildIndex + rank）配 dist/search-index.json。
 * 不另写一套打分 —— 那会变成第二个真相，而「你在侧边栏搜到的是这条、模型拿到的
 * 却是另一条」是最难发现的一类不一致。两者都在 dist/ 里，也就是发布出去的那份产物，
 * 所以宿主不用碰只存在于源码树的 shared/（它不在 package.json 的 files 里）。
 *
 * 咒语正文来自 dist/spell/<slug>/prompt.txt —— 与站点上「抄咒语」抄走的是同一份文件。
 *
 * ── 为什么手写 ToolDefinition，而不 import @deepseek-ai/dsh-tools 的 defineTool ──
 *
 * defineTool 把一份简写 spec 投影成 JSON Schema，而注册表收的本来就是裸 JSON Schema
 * （ToolSchema.parameters 是 Record<string, unknown>，output.schema 是 JsonSchemaNode）。
 * 它是个便利封装，不是必需品。
 *
 * 而它是**静态 import**：那个包一旦在运行期解析不到，这个文件就 import 失败，宿主
 * 半边整个挂掉 —— 连带着把 dist/ 端出去的那条路由一起没了。那等于拿验收 A
 * （侧边栏能预览）去赌一个便利封装。同仓库的 dsh-mermaid-comm 确实是静态 import，
 * 但它装在 desktop profile 的 dependencies 里、却不在 dsh.profile.bundles 里，
 * **从没被加载过** —— 所以它证明不了这条路在这个 profile 上走得通。
 *
 * 于是这里手写，参数校验也自己做。多出来的是十几行，换来的是：那个 import 成不成立，
 * 侧边栏里那本书都照样能看。
 */
import type { Context } from '@deepseek-ai/cordis'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

/** 一次给几条候选。够模型挑，又不至于把上下文灌满。 */
const LIMIT = 6

interface RankHit {
  slug: string
  score: number
  why?: { label?: string; text?: string }
}

interface RankModule {
  buildIndex(docs: unknown[]): unknown
  rank(
    index: unknown,
    query: string,
    options?: { limit?: number; category?: string | null },
  ): RankHit[]
}

type SearchDoc = Record<string, string>

interface LoadedSearch {
  mod: RankModule
  index: unknown
  bySlug: Map<string, SearchDoc>
}

/**
 * 索引只建一次。332 条的 BM25 索引建起来不到 100ms，但每次调用都建一遍是白烧的；
 * 而它又不可变（dist/ 是构建产物），所以不存在失效问题。
 */
let searchCache: Promise<LoadedSearch> | null = null

function loadSearch(dist: string): Promise<LoadedSearch> {
  if (!searchCache) {
    searchCache = (async () => {
      const mod = (await import(pathToFileURL(path.join(dist, 'rank.mjs')).href)) as RankModule
      const raw = await readFile(path.join(dist, 'search-index.json'), 'utf8')
      const data = JSON.parse(raw) as { docs: SearchDoc[] }
      return {
        mod,
        index: mod.buildIndex(data.docs),
        bySlug: new Map(data.docs.map((doc) => [String(doc.slug), doc])),
      }
    })()

    // 失败别把这个 rejected 的 promise 一直留着：否则一次磁盘抖动会让这个工具
    // 到进程重启为止都查不出任何东西，而那时根本没人在看日志。
    searchCache.catch(() => {
      searchCache = null
    })
  }
  return searchCache
}

export interface LookupResult {
  found: boolean
  count: number
  /** 每条一行：`slug · 标题 · 章节 · 用于…`。给模型一条能直接引用的身份。 */
  items: string[]
  /** 最佳那条的完整任务书；没命中时是空串。 */
  prompt: string
  /** 上面那段 prompt 属于哪一条。 */
  promptSlug: string
  hint: string
}

function nothing(hint: string): LookupResult {
  return { found: false, count: 0, items: [], prompt: '', promptSlug: '', hint }
}

/**
 * slug 只用来拼一个文件名，所以在这里挡一道：只放行它自己那套字符。
 * 数据是构建期生成的，本来不该出问题 —— 但「本来不该」不是一道防线，
 * 而这一道只有一行。
 */
const SLUG_SHAPE = /^[a-z0-9][a-z0-9-]*$/

async function readPrompt(dist: string, slug: string): Promise<string> {
  if (!SLUG_SHAPE.test(slug)) return ''
  try {
    return await readFile(path.join(dist, 'spell', slug, 'prompt.txt'), 'utf8')
  } catch {
    // 产物缺了这一份（比如构建半途被打断）。不当错误 —— 候选列表照样有用。
    return ''
  }
}

export async function lookupSpell(dist: string, query: string, category = ''): Promise<LookupResult> {
  const q = String(query ?? '').trim()
  if (!q) {
    return nothing('给一个关键词（「发光」「玻璃」）或一条咒语的 slug（「neon-glow」）。')
  }

  const { mod, index, bySlug } = await loadSearch(dist)

  // slug 全等先短路。库里 RANK_COLUMNS 不含 slug 那一列，所以「neon-glow」这种
  // 最典型的引用形式走检索是**搜不到**的 —— 而它恰恰是「引用一条咒语」最常见的说法。
  const exact = bySlug.get(q) ?? bySlug.get(q.toLowerCase())
  const hits = exact
    ? [{ slug: String(exact.slug), score: 1 } as RankHit]
    : mod.rank(index, q, { limit: LIMIT, category: category || null })

  if (!hits.length) {
    return nothing(`库里没有匹配「${q}」的咒语。换个说法再试 —— 直接描述你想要的效果就行。`)
  }

  const items = hits.map((hit) => {
    const doc = bySlug.get(String(hit.slug)) ?? {}
    // 「凭什么被选上」必须跟着走，光给标题不够。
    //
    // 这不是装饰：检索是模糊的，而**得分高低说明不了相关性**。实测过 ——
    // 「一个绝对不存在的效果词牌」拿到 58 分（「绝对」是罕见词，撞上了
    // hamburger-morph 机制里的「绝对定位」），而正经的「发光」只有 4.2 分。
    // 所以任何分数阈值都是错的解法。管用的是把依据交出去：
    // 模型看到「命中：机制『三条线共用同一个绝对定位原点…』」就知道这条不对，
    // 看到「命中：标签『发光』」就知道选对了。
    const why = hit.why && hit.why.text
      ? `命中：${hit.why.label ?? '文中'}「${hit.why.text}」`
      : ''
    return [doc.slug, doc.title, doc.category, doc.when_text ? `用于：${doc.when_text}` : '', why]
      .filter(Boolean)
      .join(' · ')
  })

  const promptSlug = String(hits[0].slug)
  const prompt = await readPrompt(dist, promptSlug)

  return {
    found: true,
    count: items.length,
    items,
    prompt,
    promptSlug,
    hint: items.length > 1
      ? '上面是候选。每条末尾的「命中：」就是它凭什么被选上 —— 依据弱就别用那条。' +
        '要另一条的完整正文，用它的 slug 再查一次。'
      : '',
  }
}

/* ------------------------------------------------------------ 注册 */

/** 只声明用到的那一个方法，免得为一个便利封装去 import 整个 tools 包。 */
interface ToolRegistrar {
  register(definition: unknown): () => void
}

const PARAMETERS = {
  type: 'object',
  properties: {
    query: {
      type: 'string',
      description: '要查的咒语：一句话描述想要的前端效果（「深色招牌上发光的字」），或一条咒语的 slug（neon-glow）。',
    },
    category: {
      type: 'string',
      description: '可选，把结果限在一个章节里：材质 / 动效 / 排版 / 交互 / 布局 / 图形。',
    },
  },
  required: ['query'],
  additionalProperties: false,
}

const OUTPUT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    found: { type: 'boolean', description: '有没有命中' },
    count: { type: 'number', description: '命中条数（最多 6 条候选）' },
    items: {
      type: 'array',
      items: { type: 'string' },
      description: '候选一览，每条一行：slug · 标题 · 章节 · 用于…',
    },
    prompt: { type: 'string', description: '最佳那条的完整任务书（效果 / 机制 / 边界 / 参考实现）；没命中时为空' },
    promptSlug: { type: 'string', description: 'prompt 属于哪一条' },
    hint: { type: 'string', description: '没命中或有多条候选时的下一步提示' },
  },
  required: ['found', 'count', 'items', 'prompt', 'promptSlug', 'hint'],
}

interface ToolDefinitionLike {
  name: string
  description: string
  parameters: unknown
  output: {
    schema: unknown
    render: (args: unknown, value: never) => Array<{ type: string; text: string }>
  }
  execute: (args: { query?: unknown; category?: unknown }, exec: unknown) => Promise<LookupResult>
}

/**
 * 把结果铺成一段模型能直接读的文本。
 *
 * 正文不做任何包装、不截断 —— 那份 prompt.txt 本来就是**为模型写的任务书**，
 * 中途砍掉任何一段（尤其是「容易失效的地方」）都会让它退化成一段普通示例。
 */
function renderLookup(value: LookupResult): Array<{ type: string; text: string }> {
  if (!value.found) {
    return [{ type: 'text', text: value.hint || '咒语书里没有匹配的条目。' }]
  }

  const head = [`命中 ${value.count} 条：`, ...value.items.map((line) => `- ${line}`)].join('\n')
  const body = value.prompt
    ? `\n\n──── ${value.promptSlug} 的完整咒语 ────\n\n${value.prompt}`
    : `\n\n（${value.promptSlug} 的正文没取到：构建产物里缺这一份 prompt.txt。）`
  const tail = value.hint ? `\n\n${value.hint}` : ''

  return [{ type: 'text', text: head + body + tail }]
}

export function registerSpellbookTool(ctx: Context, dist: string): void {
  // tools 是可选服务：没有它的时候这个功能不存在，但**必须留声**。
  // 静默跳过等于「模型从来不用这条工具」而没人知道为什么。
  const get = (ctx as unknown as { get?: (key: string) => unknown }).get
  const tools = (typeof get === 'function' ? get.call(ctx, 'tools') : undefined) as
    | ToolRegistrar
    | undefined

  if (!tools || typeof tools.register !== 'function') {
    console.warn('[dsh-spellbook] 没有 tools 服务，spellbook_lookup 没有注册 —— 「被引用自动实现」不会生效')
    return
  }

  const definition: ToolDefinitionLike = {
    name: 'spellbook_lookup',
    description:
      '查「咒语书」里的前端效果，取回那一条的完整任务书（效果 / 机制 / 边界 / 参考实现）。' +
      '用户提到某条咒语（说 slug，如 neon-glow），或用一句话描述想要的前端效果' +
      '（「深色招牌上一行发光的字」「玻璃面板的模糊」）时，先调它把任务书取回来，再照着实现。' +
      '取回的是与具体项目无关的机制说明：落到什么栈（React / Vue / SwiftUI / shader）由你按对方项目决定，' +
      '里面的示例代码只是一种写法，不是接口。',
    parameters: PARAMETERS,
    output: {
      schema: OUTPUT_SCHEMA,
      render: (_args: unknown, value: LookupResult) => renderLookup(value),
    },
    async execute(args) {
      const query = typeof args?.query === 'string' ? args.query : ''
      const category = typeof args?.category === 'string' ? args.category : ''
      return lookupSpell(dist, query, category)
    },
  }

  try {
    const unregister = tools.register(definition)
    if (ctx.effect) ctx.effect(() => unregister)
  } catch (error) {
    // 注册失败通常意味着契约变了（比如 parameters 的形状不再被接受）。
    // 这条必须是响的：它是唯一能说明「模型为什么不用这条工具」的地方。
    console.warn('[dsh-spellbook] spellbook_lookup 注册失败：', error)
  }
}
