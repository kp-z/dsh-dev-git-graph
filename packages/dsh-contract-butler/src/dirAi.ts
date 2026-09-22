/**
 * 目录节点的 AI 中文。
 *
 * 目录不是一个存储实体——它是契约的 `file` 路径归纳出来的东西，所以这里做两件事：
 * 1) 把契约按目录分组，口径与面板的 `dirNameOf` **逐字一致**（`src/hooks` / `（根目录）` / `（运行时）`）；
 * 2) 按目录问一次模型，拿到"这个目录负责什么"，写进 `dirAi` 表（一张目录一行，按指纹判是否过期）。
 *
 * 两条硬约束沿用契约级 AI 的同一套：
 * - 中文**只能来自模型**。校验不过就整批拒绝并记进 `missing`，绝不本地编一句顶上去。
 * - 只增不改：只往 `dirAi` 表里写，不碰契约记录里的任何字段。
 */
import { createHash } from 'node:crypto'
import type { AiCaller } from './aiWorkflow.js'
import type { ButlerStore } from './store.js'
import type { ContractRecord, DirAiRecord } from './types.js'

/** 目录这一行的表键：一个项目的一个目录一行。 */
export function dirKeyOf(projectId: string, path: string): string {
  return `dir_${projectId}_${path}`
}

/** 面板那侧 `dirNameOf` 的同义实现：口径必须逐字一致，否则查表永远查不到。 */
export function dirNameOf(file: string): string {
  const f = String(file || '')
  if (f === '' || f.charAt(0) === '(') return '（运行时）'
  const parts = f.split('/').filter((piece) => piece.length > 0)
  return parts.length > 1 ? parts.slice(0, parts.length - 1).join('/') : '（根目录）'
}

/** 按目录分组。键是目录路径，值是这一组里的契约；目录顺序排好，让每次运行的问法都一样。 */
export function groupByDir(contracts: readonly ContractRecord[]): Map<string, ContractRecord[]> {
  const out = new Map<string, ContractRecord[]>()
  for (const contract of contracts) {
    const path = dirNameOf(contract.file)
    const list = out.get(path)
    if (list === undefined) out.set(path, [contract])
    else list.push(contract)
  }
  return new Map([...out.entries()].sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0)))
}

/**
 * 目录的指纹：成员集合 + 每个成员已有的 AI 中文。
 *
 * 成员的中文变了，这个目录的"负责什么"就该重新问一遍——所以成员那一层也要进指纹，
 * 不能只算 id 集合。
 */
export function dirHashOf(path: string, members: readonly ContractRecord[]): string {
  const parts = members
    .map((contract) => {
      const fields = (contract.aiFields ?? []).map((field) => `${field.name}=${field.zh}`).join('\u0001')
      return [contract.id, contract.symbol, contract.file, contract.aiTitle ?? '', fields].join('\u0002')
    })
    .sort()
  const h = createHash('sha256')
  h.update(`${path}\u0000${parts.join('\u0003')}`)
  return h.digest('hex').slice(0, 16)
}

export interface DirAiInput {
  store: ButlerStore
  projectId: string
  contracts: readonly ContractRecord[]
  caller: AiCaller
  /** 忽略缓存，全部重问。 */
  force?: boolean
  /** 一次问几个目录。 */
  batchSize?: number
  concurrency?: number
  onProgress?: (progress: { done: number; total: number; dirs: string[] }) => void
}

export interface DirAiSummary {
  dirs: DirAiRecord[]
  generated: number
  cached: number
  failed: number
  /** 中文合格、但 AI 给的 Mermaid 图没过校验的目录数（这些目录这一轮没有图）。 */
  graphFailed: number
  /** 模型没给、或校验没过被整批拒掉的目录路径。 */
  missing: string[]
}

/** 一次问几个目录：目录的种子比契约短得多，可以比契约那条（24）问得少一点，回答更稳。 */
const BATCH_DEFAULT = 8
const TITLE_MIN = 2
const TITLE_MAX = 12
const NOTE_MIN = 4
const NOTE_MAX = 40

function hasChinese(value: string): boolean {
  return /[\u3400-\u9fff]/.test(value)
}

function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}

/** 这套 prompt 的口径：目录是"这一层放什么"，不是逐个文件的复述。 */
export const DIR_PROMPT_INTRO = [
  '你在读一个代码仓库的目录结构。对每个目录给出：中文职责、一句话说明，以及一张 Mermaid 图。',
  '输入 JSON：{"dirs":[{"path":"目录路径","members":[{"id":"契约 id","symbol":"符号名","kind":"protocol|gap","file":"文件路径","title":"成员已有中文（可能没有）"}],"relations":[{"from":"契约 id","rel":"关系词","to":"契约 id","why":"理由"}]}]}。',
  '只输出 JSON，不要解释、不要 Markdown 围栏。形状必须是：',
  '{"dirs":[{"path":"原样抄回","title":"不超过 12 个字的职责","note":"4-40 个字说明这个目录负责什么","graph":"Mermaid 文本；没有可画的就写空串"}]}',
  'graph 的写法（面板用的就是这个解析器，多一个字符都不认）：',
  '1) 第一行只能是 flowchart LR 或 flowchart TB；',
  '2) 每个实体一行：<契约 id>["显示名"]:::protocol（或 :::gap）—— 契约 id 必须原样照抄输入里的 id；',
  '3) 每条关系一行：<契约 id>-->|关系词|<契约 id> —— 关系词只能是 contains/imports/emits/defines；',
  '4) 边只能画输入 relations 里给的那些，**不许自己新增关系**，也不许把没给过的两端连起来；',
  '5) 最多 40 个实体、80 条边；不要写注释，不要出现 %% 开头的行；',
  '6) 想分组就这样写（可选、只允许一层）：subgraph g1["分组名"] 开头，里面放实体，最后一行 end；',
  '7) 分组名要中文、1-20 字，比如按模块或按数据模型分。',
  '其它：输入的每个目录都要出现且只出现一次，path 必须逐字抄回，不许新增输入里没有的目录；',
  'title 与 note 必须是中文（含中日韩汉字），不许写"未知""待补充"这类空话；',
  '依据只能是输入给的东西：目录路径、成员符号名、以及给定的关系。不要编业务含义。',
].join('\n')

export interface DirPayload {
  path: string
  title: string
  note: string
  /** AI 写的 Mermaid 图；空串 = 它说这个目录没什么可画的。图的合法性单独校验（见 validateDirGraph）。 */
  graph: string
}

export type DirValidateResult =
  | { ok: true; items: DirPayload[] }
  | { ok: false; why: string; raw: string }

/** 严格校验：任何一项不合格，整批拒绝（沿用契约级 AI 的那套闸门）。 */
export function validateDirPayload(raw: unknown, wantPaths: readonly string[]): DirValidateResult {
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
  const listRaw = (data as { dirs?: unknown }).dirs
  if (!Array.isArray(listRaw)) return { ok: false, why: 'AI 返回缺少 dirs 数组', raw: rawText }

  const allowed = new Set<string>(wantPaths)
  const out: DirPayload[] = []
  const seen = new Set<string>()
  for (const entry of listRaw) {
    if (!entry || typeof entry !== 'object') return { ok: false, why: 'dirs 里出现非对象项', raw: rawText }
    const item = entry as Record<string, unknown>
    const path = typeof item.path === 'string' ? item.path : ''
    if (path === '') return { ok: false, why: '有目录缺少 path', raw: rawText }
    if (!allowed.has(path)) return { ok: false, why: `path ${path} 不在这一批里（模型编了目录）`, raw: rawText }
    if (seen.has(path)) return { ok: false, why: `path ${path} 重复出现`, raw: rawText }
    const title = typeof item.title === 'string' ? item.title.trim() : ''
    const note = typeof item.note === 'string' ? item.note.trim() : ''
    if (!hasChinese(title)) return { ok: false, why: `${path} 的 title 不是中文`, raw: rawText }
    if (title.length < TITLE_MIN || title.length > TITLE_MAX) {
      return { ok: false, why: `${path} 的 title 长度越界（${title.length}）`, raw: rawText }
    }
    if (!hasChinese(note)) return { ok: false, why: `${path} 的 note 不是中文`, raw: rawText }
    if (note.length < NOTE_MIN || note.length > NOTE_MAX) {
      return { ok: false, why: `${path} 的 note 长度越界（${note.length}）`, raw: rawText }
    }
    seen.add(path)
    const graph = typeof item.graph === 'string' ? item.graph.trim() : ''
    out.push({ path, title, note, graph })
  }
  const absent = wantPaths.filter((path) => !seen.has(path))
  if (absent.length > 0) return { ok: false, why: `这些目录没给：${absent.join('、')}`, raw: rawText }
  return { ok: true, items: out }
}

/** 节点类型：口径与面板的 `protocolKindOf` 一致（有形状才算协议，两边都读不动就是缺口）。 */
export function kindOfContract(contract: ContractRecord): 'protocol' | 'gap' {
  const sides = [contract.input, contract.output].filter((side) => side !== null && side !== undefined)
  if (sides.length === 0) return 'gap'
  return sides.every((side) => (side as { kind?: string }).kind === 'unknown') ? 'gap' : 'protocol'
}

/** 图上最多多少个实体 / 多少条边：再大就不是"一眼看懂"的图了。 */
const DIR_GRAPH_MAX_NODES = 40
const DIR_GRAPH_MAX_EDGES = 80

/** 关系词与面板的 `M_RELS` 同源（面板多一个 missing，那是它自己标缺口的，不许模型用）。 */
const DIR_GRAPH_RELS = new Set(['contains', 'imports', 'emits', 'defines'])

export type DirGraphCheck = { ok: true; nodes: number; edges: number } | { ok: false; why: string }

/**
 * 校验 AI 写的 Mermaid 图。
 *
 * 语法必须与面板的 `parseMermaidGraph` 逐字对齐——面板认不认这段文本，决定用户能不能看见图，
 * 所以这里不能比它松：松一点的结果是"存下来了、面板渲染不出来"。
 * 另外两条闸门：实体只能是给过的 id（不许编契约），边只能是已声明的 AI 关系（不许编关系）。
 */
export function validateDirGraph(
  text: string,
  allowedIds: ReadonlySet<string>,
  kindOfId: (id: string) => string,
  declaredRelations: ReadonlySet<string>,
): DirGraphCheck {
  const raw = String(text ?? '').trim()
  if (raw === '') return { ok: true, nodes: 0, edges: 0 }
  const lines = raw.split(/\r?\n/).map((line) => line.trim()).filter((line) => line.length > 0)
  const head = lines[0] ?? ''
  if (!/^flowchart[ \t]+(LR|TB)$/.test(head)) {
    return { ok: false, why: '第一行必须是 flowchart LR 或 flowchart TB' }
  }
  const declared = new Set<string>()
  const bands: string[] = []
  let openBand: string | null = null
  let edges = 0
  for (let at = 1; at < lines.length; at += 1) {
    const line = lines[at] as string
    const node = /^([A-Za-z_]\w*)\["((?:[^"\\]|\\.)*)"\]:::(protocol|gap)$/.exec(line)
    if (node !== null) {
      const id = node[1] as string
      if (!allowedIds.has(id)) return { ok: false, why: `第 ${at + 1} 行的 ${id} 不在这个目录的输入里` }
      if (declared.has(id)) return { ok: false, why: `第 ${at + 1} 行把 ${id} 声明了两遍` }
      /* 反向也要查：带在前、实体在后时，撞名同样会让面板解析器整张拒掉 */
      if (bands.includes(id)) return { ok: false, why: `第 ${at + 1} 行的 ${id} 已经是个分组了` }
      const label = node[2] as string
      if (label.trim() === '') return { ok: false, why: `第 ${at + 1} 行的显示名是空的` }
      if (label.length > 60) return { ok: false, why: `第 ${at + 1} 行的显示名超过 60 字` }
      if (/<[a-z!/][^>]*>/i.test(label)) return { ok: false, why: `第 ${at + 1} 行的显示名含 HTML 标签` }
      const kind = node[3] as string
      const want = kindOfId(id)
      if (want !== '' && want !== kind) {
        return { ok: false, why: `第 ${at + 1} 行把 ${id} 标成了 ${kind}，它其实是 ${want}` }
      }
      declared.add(id)
      if (declared.size > DIR_GRAPH_MAX_NODES) return { ok: false, why: `实体超过 ${DIR_GRAPH_MAX_NODES} 个` }
      continue
    }
    const edge = /^([A-Za-z_]\w*)[ \t]*-->[ \t]*\|[ \t]*([A-Za-z_]\w*)[ \t]*\|[ \t]*([A-Za-z_]\w*)$/.exec(line)
    if (edge !== null) {
      const from = edge[1] as string
      const rel = edge[2] as string
      const to = edge[3] as string
      if (!DIR_GRAPH_RELS.has(rel)) return { ok: false, why: `第 ${at + 1} 行的关系词 ${rel} 不在允许的里面` }
      if (!declaredRelations.has(`${from}\u0000${rel}\u0000${to}`)) {
        return { ok: false, why: `第 ${at + 1} 行的关系 ${from}→${to} 不在给定的关系里（不许自己新增）` }
      }
      edges += 1
      if (edges > DIR_GRAPH_MAX_EDGES) return { ok: false, why: `关系超过 ${DIR_GRAPH_MAX_EDGES} 条` }
      continue
    }
    if (/^subgraph\b/.test(line)) {
      const sub = /^subgraph[ \t]+([A-Za-z_]\w*)[ \t]*\["((?:[^"\\]|\\.)*)"\][ \t]*$/.exec(line)
      if (sub === null) return { ok: false, why: `第 ${at + 1} 行的 subgraph 只允许 subgraph id["显示名"]` }
      if (openBand !== null) return { ok: false, why: `第 ${at + 1} 行套了第二层 subgraph（只允许一层）` }
      const bandId = sub[1] as string
      /* 带 id 不许和**任何一条契约 id** 重名：就算这张图里没声明它，撞名也会让人读错，
         面板解析器更是直接把整张图判掉。 */
      if (declared.has(bandId) || allowedIds.has(bandId)) {
        return { ok: false, why: `第 ${at + 1} 行的 ${bandId} 已经是个实体了` }
      }
      if (bands.includes(bandId)) return { ok: false, why: `第 ${at + 1} 行把 ${bandId} 声明了两遍` }
      const bandLabel = (sub[2] as string).trim()
      if (bandLabel === '' || bandLabel.length > 20) return { ok: false, why: `第 ${at + 1} 行的分组名要在 1-20 字之间` }
      bands.push(bandId)
      if (bands.length > 12) return { ok: false, why: '分组超过 12 个（再多就不是一眼能读的图了）' }
      openBand = bandId
      continue
    }
    if (line === 'end') {
      if (openBand === null) return { ok: false, why: `第 ${at + 1} 行的 end 没有对应的 subgraph` }
      openBand = null
      continue
    }
    return { ok: false, why: `第 ${at + 1} 行看不懂：${line}` }
  }
  if (openBand !== null) return { ok: false, why: `subgraph ${openBand} 没有 end 关闭` }
  if (declared.size === 0) return { ok: false, why: '一个实体都没声明' }
  return { ok: true, nodes: declared.size, edges }
}

/** 把一组目录摊成给模型看的 JSON：实体要给 id（它要照着写进图里），关系要给全（边只能从这里面挑）。 */
export function buildDirPromptParts(
  paths: readonly string[],
  membersOf: ReadonlyMap<string, readonly ContractRecord[]>,
  relationsOf: (contract: ContractRecord) => readonly { to: string; rel: string; why?: string }[] = () => [],
): { system: string; user: string } {
  const dirs = paths.map((path) => {
    const members = (membersOf.get(path) ?? []).slice(0, DIR_GRAPH_MAX_NODES)
    const onGraph = new Set(members.map((contract) => contract.id))
    const relations: { from: string; rel: string; to: string; why?: string }[] = []
    for (const contract of members) {
      for (const relation of relationsOf(contract)) {
        /* 只给"图上的实体之间"的关系：对端不在这一批里，模型画了也连不上。 */
        if (!onGraph.has(relation.to)) continue
        const row: { from: string; rel: string; to: string; why?: string } = {
          from: contract.id,
          rel: relation.rel,
          to: relation.to,
        }
        if (relation.why !== undefined) row.why = relation.why
        relations.push(row)
      }
    }
    return {
      path,
      members: members.map((contract) => {
        const row: Record<string, string> = {
          id: contract.id,
          symbol: contract.symbol,
          kind: kindOfContract(contract),
          file: contract.file,
        }
        if (contract.aiTitle) row.title = contract.aiTitle
        return row
      }),
      relations,
    }
  })
  return { system: DIR_PROMPT_INTRO, user: JSON.stringify({ dirs }) }
}

/** 在给定的并发度下跑完所有批次。 */
async function runPool<T>(tasks: readonly (() => Promise<T>)[], concurrency: number): Promise<T[]> {
  const out: T[] = new Array(tasks.length)
  let next = 0
  const workers = new Array(Math.max(1, Math.min(tasks.length || 1, concurrency))).fill(null).map(async () => {
    for (;;) {
      const mine = next
      next += 1
      const task = tasks[mine]
      if (task === undefined) return
      out[mine] = await task()
    }
  })
  await Promise.all(workers)
  return out
}

/**
 * 跑一轮目录级理解。
 *
 * 只有指纹变了（或 `force`）的目录才会真的问模型；一批问不成只影响这一批，
 * 记进 `missing` 让人看得见，而不是把整轮判失败。
 */
export async function understandDirs(input: DirAiInput): Promise<DirAiSummary> {
  const { store, projectId, contracts, caller } = input
  const force = input.force === true
  const grouped = groupByDir(contracts)
  const allPaths = [...grouped.keys()]
  const batchSize = Math.max(1, Math.floor(input.batchSize ?? BATCH_DEFAULT))
  const concurrency = Math.max(1, Math.min(8, Math.floor(input.concurrency ?? 2)))

  const table = store.dirAi()
  const resolved: DirAiRecord[] = []
  const pending: string[] = []
  const hashes = new Map<string, string>()
  let cached = 0

  for (const path of allPaths) {
    const members = grouped.get(path) ?? []
    const hash = dirHashOf(path, members)
    hashes.set(path, hash)
    const row = force ? undefined : table.get(dirKeyOf(projectId, path))
    /* 命中要求"这一行有图"：本功能之前写下的行没有图，让它重问一次补上，而不是永远没有图。 */
    if (row !== undefined && row.hash === hash && row.mermaid !== undefined) {
      resolved.push(row)
      cached += 1
      continue
    }
    pending.push(path)
  }

  const batches: string[][] = []
  for (let at = 0; at < pending.length; at += batchSize) batches.push(pending.slice(at, at + batchSize))

  let done = cached
  const missing: string[] = []
  let failed = 0
  /** 中文过了、图没过的目录数：如实报出来，不假装产出过图。 */
  let graphFailed = 0
  let channel = ''

  const results = await runPool(
    batches.map((paths) => async () => {
      const turn = buildDirPromptParts(paths, grouped, (contract) => contract.aiRelations ?? [])
      try {
        const answer = await caller(turn)
        channel = answer.channel || channel
        const checked = validateDirPayload(answer.text, paths)
        if (!checked.ok) {
          missing.push(...paths)
          failed += 1
          return
        }
        for (const item of checked.items) {
          const members = grouped.get(item.path) ?? []
          const allowed = new Set(members.map((contract) => contract.id))
          const kinds = new Map(members.map((contract) => [contract.id, kindOfContract(contract)]))
          const declared = new Set<string>()
          for (const contract of members) {
            for (const relation of contract.aiRelations ?? []) {
              declared.add(`${contract.id}\u0000${relation.rel}\u0000${relation.to}`)
            }
          }
          /* 图单独判：中文好、图不对时**保留中文**，只是这一轮没有图（字段缺失 → 下次重问）。
             整批连中文一起丢，等于因为一张画错的图把已经对的东西也扔了。 */
          const graph = validateDirGraph(item.graph, allowed, (id) => kinds.get(id) ?? '', declared)
          if (!graph.ok) graphFailed += 1
          const record: DirAiRecord = {
            id: dirKeyOf(projectId, item.path),
            projectId,
            path: item.path,
            hash: hashes.get(item.path) ?? '',
            titleZh: item.title,
            noteZh: item.note,
            at: Date.now(),
            channel: answer.channel,
          }
          if (graph.ok) record.mermaid = item.graph
          await table.put(record.id, record)
          resolved.push(record)
        }
      } catch {
        missing.push(...paths)
        failed += 1
      } finally {
        done += paths.length
        input.onProgress?.({ done, total: allPaths.length, dirs: paths })
      }
    }),
    concurrency,
  )
  void results

  /* 顺序按目录路径排好再交出去：面板按 path 建表，顺序不影响，但人看日志时稳定。 */
  resolved.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))
  return { dirs: resolved, generated: resolved.length - cached, cached, failed, missing, graphFailed }
}