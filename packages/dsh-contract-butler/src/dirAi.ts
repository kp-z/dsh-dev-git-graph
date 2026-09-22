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
  '你在读一个代码仓库的目录结构，要给每个目录写一句中文职责。',
  '输入是一个 JSON：{"dirs":[{"path":"目录路径","members":[{"symbol":"符号名","file":"文件路径","boundary":"边界种类","title":"已有的中文（可能没有）"}]}]}。',
  '要求：',
  '1) 只输出 JSON，不要解释、不要 Markdown 围栏。',
  '2) 形状必须是 {"dirs":[{"path":"原样抄回的目录路径","title":"≤12 个字的职责","note":"4-40 个字说明这个目录负责什么"}]}。',
  '3) 输入的每个目录都要出现且只出现一次，path 必须逐字抄回；**不许新增输入里没有的目录**。',
  '4) title 与 note 必须是中文（含中日韩汉字），不要写英文、不要写"未知""待补充"这类空话。',
  '5) 依据只能是输入给的东西：目录路径与成员的符号名/边界/已有中文。看不出来就写这个目录"放的是哪一类东西"，不要编业务含义。',
].join('\n')

export interface DirPayload {
  path: string
  title: string
  note: string
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
    out.push({ path, title, note })
  }
  const absent = wantPaths.filter((path) => !seen.has(path))
  if (absent.length > 0) return { ok: false, why: `这些目录没给：${absent.join('、')}`, raw: rawText }
  return { ok: true, items: out }
}

/** 把一组目录摊成给模型看的 JSON：只放它需要的，不放记录里其它东西。 */
export function buildDirPromptParts(
  paths: readonly string[],
  membersOf: ReadonlyMap<string, readonly ContractRecord[]>,
): { system: string; user: string } {
  const dirs = paths.map((path) => ({
    path,
    members: (membersOf.get(path) ?? []).slice(0, 12).map((contract) => {
      const row: Record<string, string> = {
        symbol: contract.symbol,
        file: contract.file,
        boundary: contract.boundaryKind ?? '',
      }
      if (contract.aiTitle) row.title = contract.aiTitle
      return row
    }),
  }))
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
    if (row !== undefined && row.hash === hash) {
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
  let channel = ''

  const results = await runPool(
    batches.map((paths) => async () => {
      const turn = buildDirPromptParts(paths, grouped)
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
  return { dirs: resolved, generated: resolved.length - cached, cached, failed, missing }
}