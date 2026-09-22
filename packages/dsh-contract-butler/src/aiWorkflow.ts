/**
 * AI 理解的**接线层**：把 `understand.ts` 的判定与宿主给的模型面接到 store 上。
 *
 * 为什么要有这一层：`understand.ts` 是纯函数（种子进、结果出），`hostAi.ts` 只管把文本要回来，
 * 而"分批、进度、逐批失败、内容哈希缓存落盘、把结果写回契约记录"这些**有副作用**的事，
 * 谁也不该管、但总得有人管——就是这里。
 *
 * 三条规矩在这里落地：
 * 1. **判定只有一处**：合格与否一律过 `validateAiPayload`（`understand.ts`），这一层不自己
 *    再写一套校验，也不做任何"缺字段就补一个"的兜底。不合格 → 整批记进 `failures`（带模型
 *    原始返回与原因），那几条既不写回、也不进缓存。
 * 2. **缓存跟着领域落盘**：缓存行进 `ai` 表（key `ai_<契约 id>`），是否可用由内容哈希决定。
 *    重启宿主不该意味着"把所有契约再问一遍"。
 * 3. **原始符号名不动**：只写 `aiTitle` / `aiFamily` / `aiRelations` / `aiHash` / `aiAt`。
 *
 * 批量默认 24（用户口径 20~30）。一批失败不影响别的批：界面要能"展开看失败批次"，那就必须
 * 允许"有的批成了、有的批没有"。
 */
import type { ButlerStore } from './store.js'
import { aiKey } from './store.js'
import type { AiEdge, AiField, AiRecord, ContractRecord, ShapeNode } from './types.js'
import {
  REL_ALLOWED,
  buildPromptParts,
  contentHash,
  seedFieldNames,
  validateAiPayload,
  type AiItem,
  type AiRelation,
  type ContractSeed,
  type Rel,
} from './understand.js'

/** 一批的默认条数。 */
export const BATCH_DEFAULT = 24

/** 一批最少 / 最多条数。超出的值夹到这里，不报错。 */
export const BATCH_MIN = 20
export const BATCH_MAX = 30

/** 回显模型原始返回时的截断长度。 */
const RAW_MAX = 4000

/** 把批大小夹到 20~30。 */
export function clampBatch(size: number | undefined): number {
  if (size === undefined || !Number.isFinite(size)) return BATCH_DEFAULT
  return Math.min(BATCH_MAX, Math.max(BATCH_MIN, Math.floor(size)))
}

/** 一条"已知邻居"。全是确定性信息（同形 / 同文件 / 同边界），不是猜出来的相关性。 */
export interface Neighbour {
  rel: string
  id: string
  name: string
}

/** 邻居索引：项目可能有上千条契约，逐条扫全表是 O(n²)，所以索引只建一次。 */
export interface NeighbourIndex {
  of(contract: ContractRecord): Neighbour[]
}

/**
 * 建邻居索引。
 *
 * 只收三种确定性关系：`twins`（抽取器认出来的同实体多份表示）、`same-file`、`same-boundary`。
 * 每条最多给 12 个邻居：一个目录里几百条同文件契约时，提示词不能跟着涨到失控。
 * @param all - 项目下全部契约。
 * @returns 邻居索引。
 */
export function buildNeighbourIndex(all: ContractRecord[]): NeighbourIndex {
  const byId = new Map<string, ContractRecord>()
  const byFile = new Map<string, ContractRecord[]>()
  const byBoundary = new Map<string, ContractRecord[]>()
  for (const contract of all) {
    byId.set(contract.id, contract)
    const file = byFile.get(contract.file)
    if (file === undefined) byFile.set(contract.file, [contract])
    else file.push(contract)
    const boundary = byBoundary.get(contract.boundary)
    if (boundary === undefined) byBoundary.set(contract.boundary, [contract])
    else boundary.push(contract)
  }
  return {
    of(contract: ContractRecord): Neighbour[] {
      const out: Neighbour[] = []
      const seen = new Set<string>([contract.id])
      const push = (rel: string, other: ContractRecord | undefined): void => {
        if (other === undefined || seen.has(other.id)) return
        seen.add(other.id)
        out.push({ rel, id: other.id, name: other.symbol })
      }
      for (const twinId of contract.twins) push('twins', byId.get(twinId))
      for (const other of byFile.get(contract.file) ?? []) push('same-file', other)
      for (const other of byBoundary.get(contract.boundary) ?? []) push('same-boundary', other)
      return out.slice(0, 12)
    },
  }
}

/** 类型标签：数组写成 `T[]`，对象只写 `object`（字段已经在下面逐条列了）。 */
function typeLabel(node: ShapeNode): string {
  if (node.kind === 'array' && node.of !== undefined) return `${typeLabel(node.of)}[]`
  const values = node.enumValues
  if (values !== undefined && values.length > 0) return `${node.kind}(${values.slice(0, 4).join('|')}${values.length > 4 ? '|…' : ''})`
  return node.kind
}

/**
 * 形状 → 字段行（`名字:类型`，带必填/可缺省）。
 *
 * 字段名与类型都要给：只给名字的话，模型会把 `id` 猜成数据库主键，而它其实是个订单号。
 * @param shape - 形状节点。
 * @returns 排好序的字段行。
 */
export function fieldLines(shape: ShapeNode | null | undefined): string[] {
  const fields = shape?.fields
  if (fields === undefined) return []
  const out: string[] = []
  for (const name of Object.keys(fields).sort()) {
    const node = fields[name]
    if (node === undefined) continue
    const marks: string[] = []
    if (node.optional === true) marks.push('可缺省')
    if (node.nullable === true) marks.push('可为 null')
    out.push(`${name}:${typeLabel(node)}${marks.length > 0 ? `（${marks.join('/')}）` : ''}`)
  }
  return out
}

/**
 * 契约 → 送给模型的种子。
 *
 * 只放事实：符号名、字段（进来 / 出去两侧分开写，免得模型把响应字段当成请求字段）、
 * 来源文件、已知邻居。**不含**任何中文——中文必须从模型出来。
 * @param contract - 契约记录。
 * @param index - 邻居索引。
 * @returns 种子。
 */
export function seedOf(contract: ContractRecord, index: NeighbourIndex): ContractSeed {
  const input = fieldLines(contract.input)
  const output = fieldLines(contract.output)
  const both = input.length > 0 && output.length > 0
  const fields: string[] = []
  for (const line of input) fields.push(both ? `进来 ${line}` : line)
  for (const line of output) fields.push(both ? `出去 ${line}` : line)
  if (fields.length === 0) fields.push('（抽取器没有记录到字段）')
  const seed: ContractSeed = { id: contract.id, name: contract.symbol, file: contract.file, fields }
  const neighbours = index.of(contract)
  // 邻居**不进哈希**：多知道一个邻居不代表契约内容变了，那不该让缓存失效。
  if (neighbours.length > 0) seed.neighbours = neighbours
  return seed
}

/** 调模型的最小面（由 `hostAi.ts` 接到宿主的 llm 服务上，测试里换成假的）。 */
export type AiCaller = (turn: { system: string; user: string }) => Promise<{
  text: string
  /** 宿主那条路由的名字（`provider · model`），回显用。 */
  channel: string
  /** 这次调用的耗时（ms）。 */
  ms: number
}>

/** 进度：面板那条"第 N / M 批"就是从这里来的。 */
export interface UnderstandProgress {
  /** 已处理完的批次数（含失败的）。 */
  done: number
  /** 总批次数。 */
  total: number
  /** 正在处理的批次序号（1 起）。 */
  batch: number
  /** 这一组正在问的契约名（面板要说人话："正在为 a、b 生成中文说明"）。 */
  names?: string[]
  /** 已经问完的**条**数。组数是实现细节，条数才是人关心的。 */
  contractsDone?: number
  /** 这一轮一共要问多少条。 */
  contractsTotal?: number
}

/** 一批被拒绝的记录，原样保留模型的返回。 */
export interface UnderstandFailure {
  index: number
  ids: string[]
  why: string
  raw: string
}

/** 一条理解结果。 */
export interface UnderstandEntry {
  id: string
  symbol: string
  titleZh: string
  family: string
  /** 结果来自缓存还是这次问的模型。 */
  from: 'cache' | 'ai'
}

/** 一次理解的汇总。 */
export interface UnderstandSummary {
  ok: boolean
  projectId: string
  total: number
  batches: number
  cached: number
  requested: number
  understood: number
  /** 模型少写的契约 id（不写、不猜，如实报出来）。 */
  missing: string[]
  failures: UnderstandFailure[]
  /** 这次真正写回契约记录的条数。 */
  writeBacks: number
  /** 用到的通道（去重）。 */
  channels: string[]
  /** 总耗时（ms）。 */
  ms: number
  /** 逐条结果（按契约 id 排序）。 */
  entries: UnderstandEntry[]
}

/** 理解的入参。 */
export interface UnderstandInput {
  store: ButlerStore
  projectId: string
  contracts: ContractRecord[]
  caller: AiCaller
  batchSize?: number
  /** 并发批次数。默认 3（实测单批 3~4 秒，串行会把 42 批拖成两分半）。 */
  concurrency?: number
  /** 忽略缓存，全部重问。 */
  force?: boolean
  onProgress?: (progress: UnderstandProgress) => void
}

/** 契约当前内容对应的哈希（面板与路由都用它判断"AI 结果过期没有"）。 */
export function hashOf(contract: ContractRecord, index: NeighbourIndex): string {
  return contentHash(seedOf(contract, index))
}

/** 缓存行是否需要写回契约记录（缓存命中时也可能记录上没写全）。 */
function needsWriteBack(contract: ContractRecord, hash: string): boolean {
  return (
    contract.aiHash !== hash ||
    typeof contract.aiTitle !== 'string' ||
    contract.aiTitle === '' ||
    typeof contract.aiFamily !== 'string' ||
    /* 字段级中文也要补：老记录（这个功能之前生成的）没有 `aiFields`，命中缓存时照样写一次回。 */
    !Array.isArray(contract.aiFields) ||
    !Array.isArray(contract.aiRelations)
  )
}

/**
 * 缓存行里的字段中文，是否**带齐了**这条契约需要的那些。
 *
 * 为什么不能只比哈希：本功能之前写下的缓存行里根本没有 `fields`（那时候还没这一项），而哈希
 * 是按"符号名 + 字段名/类型 + 来源文件"算的——内容没变就永远对得上。只看哈希的话，这种老缓存行
 * 会被判成命中：模型不再被问，`aiFields` 也就**永远**补不上。所以老缓存行的处理是"不算命中、
 * 重新问一次模型"，让它在这一次把字段中文带回来（新缓存行会原样覆盖旧的）。
 *
 * 反向也不能过严：契约**本来就没有字段**（`wantFields` 为空）时，缓存行里没有 `fields` 是正常的。
 * @param rowFields - 缓存行里的字段中文（老行可能是 undefined）。
 * @param wantFields - 这条契约需要的字段名（与闸门同一份清单）。
 * @returns 是否可以当作缓存命中。
 */
function cacheCoversFields(rowFields: readonly AiField[] | undefined, wantFields: readonly string[]): boolean {
  if (wantFields.length === 0) return true
  if (!Array.isArray(rowFields)) return false
  const by = new Map<string, string>()
  for (const field of rowFields) {
    if (field === null || typeof field !== 'object') continue
    if (typeof field.name !== 'string' || typeof field.zh !== 'string') continue
    /* 空中文不算"带回来了"：闸门要求 `zh` 非空，缓存里存个空串等于没给。 */
    if (field.zh.trim() === '') continue
    by.set(field.name, field.zh)
  }
  return wantFields.every((name) => by.has(name))
}

/** 关系数组的统一形状：`AiRelation`（why 可选）→ `AiEdge`（why 必填，空串就是没给理由）。 */
function toEdges(relations: readonly { to: string; rel: string; why?: string }[] | undefined): AiEdge[] {
  return (relations ?? []).map((relation) => ({
    to: relation.to,
    rel: relation.rel,
    why: relation.why ?? '',
  }))
}

/**
 * `AiEdge`（落盘的形状）→ `AiRelation`（校验闸门认的形状）。
 *
 * 落盘的文件是能被手改的，所以关系词要**再过一遍白名单**：非法的那条直接丢掉，而不是硬转成
 * `Rel` 混过去——宁可少一条关系，也不放一个非法词进来。
 */
function toAiRelations(edges: readonly AiEdge[]): AiRelation[] {
  const out: AiRelation[] = []
  for (const edge of edges) {
    if (!(REL_ALLOWED as readonly string[]).includes(edge.rel)) continue
    const one: AiRelation = { to: edge.to, rel: edge.rel as Rel }
    if (edge.why !== '') one.why = edge.why
    out.push(one)
  }
  return out
}

/**
 * 跑一遍 AI 理解。
 *
 * 顺序（就是这里从上到下的顺序）：
 * 1. 逐条算内容哈希，缓存对得上的直接读缓存（**不问模型**），但结果照旧写回契约记录——
 *    面板只读契约表，AI 结果不落到记录上就等于没有；
 * 2. 剩下的按 20~30 条一批切开，问模型；
 * 3. 每批都过 `validateAiPayload`：通过才写（缓存表 + 契约表），不通过整批进 `failures`；
 * 4. 全程只写 `ai*` 字段，**绝不碰 `title` / `symbol`**。
 * @param input - 见 `UnderstandInput`。
 * @returns 汇总（逐条结果、缓存命中数、被拒批次、用到的通道、耗时）。
 */
export async function understandContracts(input: UnderstandInput): Promise<UnderstandSummary> {
  const started = Date.now()
  const { store, projectId, contracts, caller } = input
  const batchSize = clampBatch(input.batchSize)
  const concurrency = Math.max(1, Math.min(8, Math.floor(input.concurrency ?? 3)))
  const force = input.force === true
  const index = buildNeighbourIndex(contracts)
  // 关系可以指向项目里任何一条契约（同文件/同边界的两条经常不在同一批），所以可达集合是全集。
  const knownIds = new Set(contracts.map((contract) => contract.id))
  const entries: UnderstandEntry[] = []
  const missing: string[] = []
  const failures: UnderstandFailure[] = []
  const channels = new Set<string>()
  const pending: ContractRecord[] = []
  const hashes = new Map<string, string>()
  let cachedCount = 0
  let writeBacks = 0

  /** 把 AI 结果写回契约记录：只加 ai* 字段，原始符号名一个字都不动。 */
  const writeBack = async (contract: ContractRecord, hash: string, item: AiItem, at: number): Promise<void> => {
    await store.contracts().update(contract.id, (record) => ({
      ...record,
      aiTitle: item.titleZh,
      ...(item.family === undefined ? {} : { aiFamily: item.family }),
      aiRelations: toEdges(item.relations),
      /* 字段中文：**全量覆盖，不是合并**——`item.fields` 是这一批通过校验后的完整清单（闸门要求
         "种子里每个字段都有中文、且不许编造字段"，少一个就整批拒绝），所以这里写进去的就是全部。
         模型没给字段（契约本来就 0 个字段）时不写这一项，保留记录上原有内容，也绝不用本地词典补。 */
      ...(item.fields === undefined || item.fields.length === 0
        ? {}
        : { aiFields: item.fields.map((f) => ({ name: f.name, zh: f.zh })) }),
      aiHash: hash,
      aiAt: at,
    }))
    writeBacks += 1
  }

  for (const contract of contracts) {
    const seed = seedOf(contract, index)
    const hash = contentHash(seed)
    hashes.set(contract.id, hash)
    /* 这一条**该有哪些字段的中文**：与校验闸门用的是同一份清单（`seedFieldNames`），
       所以"缓存里带回来的"和"闸门要求的"不可能各说各话。 */
    const wantFields = seedFieldNames(seed)
    const row = force ? undefined : store.ai().get(aiKey(contract.id))
    if (
      row !== undefined &&
      row.contractId === contract.id &&
      row.hash === hash &&
      cacheCoversFields(row.fields, wantFields)
    ) {
      cachedCount += 1
      const item: AiItem = {
        id: contract.id,
        titleZh: row.titleZh,
        family: row.family,
        relations: toAiRelations(row.relations),
        /* 缓存里的字段中文原样带回（能被走到这里，就已经证明它带齐了 wantFields）。 */
        fields: (row.fields ?? []).map((f) => ({ name: f.name, zh: f.zh })),
      }
      entries.push({ id: contract.id, symbol: contract.symbol, titleZh: row.titleZh, family: row.family, from: 'cache' })
      if (needsWriteBack(contract, hash)) await writeBack(contract, hash, item, row.at)
      continue
    }
    pending.push(contract)
  }

  const batches = buildBatches(pending, batchSize)
  const requestCount = pending.length
  let done = 0
  let cursor = 0

  const runBatch = async (batchIndex: number): Promise<void> => {
    const batch = batches[batchIndex]
    if (batch === undefined) return
    const seeds = batch.map((contract) => seedOf(contract, index))
    const ids = batch.map((contract) => contract.id)
    const prompt = buildPromptParts(seeds)
    let raw = ''
    try {
      const outcome = await caller(prompt)
      raw = outcome.text
      if (outcome.channel !== '') channels.add(outcome.channel)
      const result = validateAiPayload(raw, ids, {
        knownIds,
        // 引擎这一侧收紧：中文职责、中文族名、字段级中文都是硬要求（"不要英文标题"是用户的原话）。
        requireChinese: true,
        requireFamily: true,
        titleMax: 200,
        /* 字段级中文的"合同"：这一批每条契约有哪些字段，种子里就有；校验器按它逐字要求，
           少一个字段、或编一个不存在的字段，都是整批拒绝、零写回。 */
        seedFields: new Map<string, readonly string[]>(
          seeds.map((seed) => [seed.id, seedFieldNames(seed)] as const),
        ),
      })
      if (!result.ok) {
        failures.push({ index: batchIndex + 1, ids, why: result.why, raw: result.raw })
        return
      }
      const at = Date.now()
      for (const id of result.missing) missing.push(id)
      const byId = new Map(batch.map((contract) => [contract.id, contract]))
      for (const item of result.items) {
        const contract = byId.get(item.id)
        if (contract === undefined) continue
        const hash = hashes.get(item.id) ?? hashOf(contract, index)
        const row: AiRecord = {
          id: aiKey(item.id),
          projectId,
          contractId: item.id,
          hash,
          titleZh: item.titleZh,
          family: item.family ?? '',
          relations: toEdges(item.relations),
          /* 字段级中文一起进缓存：内容没变的契约下次直接从缓存写回，不用再问一遍模型。 */
          fields: (item.fields ?? []).map((f) => ({ name: f.name, zh: f.zh })),
          at,
          channel: outcome.channel,
        }
        // 先落缓存再写契约：反过来的话，中途失败会留下"记录上有 AI 结果、缓存里没有"的状态，
        // 下一次同样的内容又要重问一遍。
        await store.ai().put(row.id, row)
        if (needsWriteBack(contract, hash)) await writeBack(contract, hash, item, at)
        entries.push({ id: item.id, symbol: contract.symbol, titleZh: item.titleZh, family: row.family, from: 'ai' })
      }
    } catch (error) {
      failures.push({
        index: batchIndex + 1,
        ids,
        why: `调用模型失败：${error instanceof Error ? error.message : String(error)}`,
        raw: raw.length > RAW_MAX ? `${raw.slice(0, RAW_MAX)}\n…（已截断）` : raw,
      })
    }
  }

  /* 进度同时给两套口径：组（done/total，宿主内部是按组问模型的）与条（contractsDone/contractsTotal）。
     名字取的是**这一组真的在问的那几条**，不按 batchSize 猜切片。 */
  let contractsDone = 0
  const worker = async (): Promise<void> => {
    for (;;) {
      const batchIndex = cursor
      cursor += 1
      if (batchIndex >= batches.length) return
      /* 上面已经挡了越界，这里 ?? [] 只是让类型收敛（strict 下索引访问是可空的） */
      const group = batches[batchIndex] ?? []
      const names = group.slice(0, 3).map((one) => one.symbol || one.file || one.id)
      const report = {
        done,
        total: batches.length,
        batch: batchIndex + 1,
        names,
        contractsDone,
        contractsTotal: pending.length,
      }
      input.onProgress?.(report)
      await runBatch(batchIndex)
      done += 1
      contractsDone += group.length
      input.onProgress?.({ ...report, done, contractsDone })
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, Math.max(batches.length, 1)) }, worker))

  failures.sort((a, b) => a.index - b.index)
  entries.sort((a, b) => a.id.localeCompare(b.id))
  return {
    ok: failures.length === 0,
    projectId,
    total: contracts.length,
    batches: batches.length,
    cached: cachedCount,
    requested: requestCount,
    understood: entries.length,
    missing: [...new Set(missing)].sort(),
    failures,
    writeBacks,
    channels: [...channels].sort(),
    ms: Date.now() - started,
    entries,
  }
}

/** 按 id 排序后切开：批次可复现，"上次第 7 批被拒"这种话才有意义。 */
function buildBatches(contracts: ContractRecord[], size: number): ContractRecord[][] {
  const sorted = [...contracts].sort((a, b) => a.id.localeCompare(b.id))
  const out: ContractRecord[][] = []
  for (let index = 0; index < sorted.length; index += size) out.push(sorted.slice(index, index + size))
  return out
}

/**
 * 跟着 store 落盘的缓存。
 *
 * 对 `understand()` 而言它就是一个 `Map`（`deps.cache` 要的正是 `Map<string, AiItem>`，键是
 * 内容哈希）；对 store 而言它是 `ai` 表的一层视图。于是"内存 Map"这件事被换成了"落盘的缓存"，
 * 而 `understand()` 的签名与行为一个字都不用改。
 *
 * 用法：`const cache = new PersistentAiCache(store, projectId).warm(seeds)` → 传给 `understand()`
 * → 结束后 `await cache.flush()`。
 */
export class PersistentAiCache extends Map<string, AiItem> {
  /** 哈希 → 契约 id（写回 `ai` 表时要知道这行属于谁）。 */
  private readonly owners = new Map<string, string>()
  private readonly rows = new Map<string, AiRecord>()
  private readonly dirty = new Set<string>()

  constructor(
    private readonly store: ButlerStore,
    private readonly projectId: string,
  ) {
    super()
  }

  /**
   * 按种子预热：内容对得上的缓存行读进 Map（内容变了的行**不读**，于是自动重问）。
   * @param seeds - 这一轮要理解的种子。
   * @returns 命中的条数。
   */
  warm(seeds: readonly ContractSeed[]): this {
    for (const seed of seeds) {
      const hash = contentHash(seed)
      this.owners.set(hash, seed.id)
      const row = this.store.ai().get(aiKey(seed.id))
      if (row === undefined || row.contractId !== seed.id || row.hash !== hash) continue
      this.rows.set(hash, row)
      // 用父类的 set：预热不算"新写的"，不该进 dirty。
      super.set(hash, {
        id: seed.id,
        titleZh: row.titleZh,
        family: row.family,
        relations: toAiRelations(row.relations),
        fields: (row.fields ?? []).map((f) => ({ name: f.name, zh: f.zh })),
      })
    }
    return this
  }

  /**
   * 记一条新结果（`understand()` 内部调的就是这个 `set`），并标记待落盘。
   * @param key - 内容哈希。
   * @param value - AI 结果。
   * @returns this。
   */
  override set(key: string, value: AiItem): this {
    super.set(key, value)
    const contractId = this.owners.get(key)
    // 预热时 set 过但没登记 owner 的键（跨批同内容）落不了盘，这里就不再假装能落。
    if (contractId !== undefined) {
      this.rows.set(key, {
        id: aiKey(contractId),
        projectId: this.projectId,
        contractId,
        hash: key,
        titleZh: value.titleZh,
        family: value.family ?? '',
        relations: toEdges(value.relations),
        fields: (value.fields ?? []).map((f) => ({ name: f.name, zh: f.zh })),
        at: Date.now(),
        // `understand()` 的 caller 不回传通道名，这里如实留空而不是编一个。
        channel: '',
      })
      this.dirty.add(key)
    }
    return this
  }

  /**
   * 把新结果写进 `ai` 表。
   * @returns 落盘的条数。
   */
  async flush(): Promise<number> {
    let written = 0
    for (const key of [...this.dirty]) {
      const row = this.rows.get(key)
      if (row === undefined) continue
      await this.store.ai().put(row.id, row)
      written += 1
    }
    this.dirty.clear()
    return written
  }

  /** 还等着落盘的条数。 */
  get pendingWrites(): number {
    return this.dirty.size
  }
}