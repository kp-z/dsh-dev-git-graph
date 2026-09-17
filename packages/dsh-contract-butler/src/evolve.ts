/**
 * 演化：重扫 → 比形状 → 记一条"谁在哪个提交把它改成了什么样"。
 *
 * 三条判定上的取舍：
 * - **只有形状变了才算改过。** 行号挪动、注释增删、字段顺序调整都不产生演化记录——否则
 *   演化历史会被格式变动冲垮，而人恰恰只想知道"数据结构变了没有"。
 * - **归因永远问 git，不问时钟。** 未提交的改动记 `wt`，已提交的记那个提交的 sha 与时间；
 *   两者都不会出现"未来改的"。
 * - **消失的契约不删记录。** 声明从代码里没了，记一条破坏性演化（形状 → 空），但保留记录。
 *   删掉它等于替用户决定"这条契约以后不用管了"，那是用户的决定，不是扫描器的。
 */
import { dirtyFiles, lastCommitOf } from './git.js'
import { scanProject } from './scan.js'
import { changeKey, snapshotKey } from './store.js'
import { diffShape, shapeHash, textHash } from './shape.js'
import type { Extractor } from './extract/index.js'
import type { ButlerStore } from './store.js'
import type { Candidate, ChangeRecord, ContractRecord, ProjectRecord } from './types.js'

/** 未提交改动在演化记录里的标记（与 UI 的"工作区"对应）。 */
export const WORKTREE = 'wt'

/** 演化选项。 */
export interface EvolveOptions {
  store: ButlerStore
  project: ProjectRecord
  extractors: Extractor[]
  /** 只重扫这些相对路径（监视器给了受影响的文件）；不给表示全量重扫。 */
  only?: string[]
  /** 运行时内省出来的候选（工具注册表）。 */
  runtimeCandidates?: Candidate[]
  /** 快照保留条数。 */
  snapshotKeep?: number
}

/** 演化结果。 */
export interface EvolveResult {
  filesSeen: number
  truncated: boolean
  /** 这次真的变了形状的契约（含"消失"）。 */
  changed: ContractRecord[]
  /** 新写入的演化记录。 */
  changes: ChangeRecord[]
  /** 纳管范围之外、新出现且尚未纳管的候选。 */
  newCandidates: Candidate[]
  errors: { file: string; message: string }[]
  durationMs: number
  /** 这次被重新归因到提交上的"原先未提交"记录条数。 */
  settled: number
}

/**
 * 重扫并记录演化。
 *
 * 局部重扫（给了 `only`）时**不做消失判定**：这一批里没有的契约，只说明它不在这一批里，
 * 不说明它没了。消失只在全量扫描时才有意义。
 * @param options - 演化选项。
 * @returns 演化结果。
 */
export async function evolveProject(options: EvolveOptions): Promise<EvolveResult> {
  const started = Date.now()
  const { store, project } = options
  const scan = await scanProject({
    root: project.root,
    excludeDirs: project.scan.excludeDirs,
    maxFiles: project.scan.maxFiles,
    extractors: options.extractors,
    ...(options.only === undefined ? {} : { only: options.only }),
  })

  const byId = new Map<string, Candidate>()
  for (const candidate of scan.candidates) byId.set(candidate.id, candidate)
  for (const candidate of options.runtimeCandidates ?? []) byId.set(candidate.id, candidate)

  const included = new Set(project.include)
  const full = options.only === undefined
  const now = Date.now()
  const changed: ContractRecord[] = []
  const changes: ChangeRecord[] = []
  const newCandidates: Candidate[] = []

  const existing = store.contractsOf(project.id)
  const seen = new Set<string>()

  for (const contract of existing) {
    if (!included.has(contract.id)) continue
    seen.add(contract.id)
    const candidate = byId.get(contract.id)

    if (candidate === undefined) {
      if (!full) continue
      // 声明没了：记一条破坏性演化，但保留契约记录（去留是用户的决定）。
      const record = await recordChange(store, project, contract, null, null, now)
      if (record !== null) {
        changes.push(record)
        changed.push(contract)
      }
      continue
    }

    const nextInputHash = shapeHash(candidate.input)
    const nextOutputHash = shapeHash(candidate.output)
    const currentInputHash = shapeHash(contract.input)
    const currentOutputHash = shapeHash(contract.output)

    if (nextInputHash === currentInputHash && nextOutputHash === currentOutputHash) {
      // 结构没变：只把证据位置与时间往前推，不产生演化记录。
      if (
        contract.evidence.line !== candidate.evidence.line ||
        contract.evidence.hash !== candidate.evidence.hash ||
        contract.source !== candidate.source
      ) {
        await store.contracts().update(contract.id, (record) => ({
          ...record,
          evidence: candidate.evidence,
          source: candidate.source,
          twins: candidate.twins,
          updatedAt: now,
        }))
      }
      continue
    }

    const updated: ContractRecord = {
      ...contract,
      input: candidate.input,
      output: candidate.output,
      evidence: candidate.evidence,
      twins: candidate.twins,
      updatedAt: now,
    }
    await store.contracts().put(contract.id, updated)
    const record = await recordChange(store, project, contract, candidate.input, candidate.output, now)
    if (record !== null) {
      changes.push(record)
      changed.push(updated)
    }
    await store.snapshots().put(snapshotKey(contract.id, record === null ? '' : record.sha), {
      projectId: project.id,
      contractId: contract.id,
      sha: record === null ? '' : record.sha,
      at: now,
      inputHash: nextInputHash,
      outputHash: nextOutputHash,
      input: candidate.input,
      output: candidate.output,
    })
    if (options.snapshotKeep !== undefined) {
      await store.pruneSnapshots(contract.id, options.snapshotKeep)
    }
  }

  // 新候选：程序里新长出来的契约。不自动纳管——纳管范围是人的决定。
  for (const candidate of byId.values()) {
    if (included.has(candidate.id) || seen.has(candidate.id)) continue
    if (candidate.input === null && candidate.output === null) continue
    if (existing.some((contract) => contract.id === candidate.id)) continue
    newCandidates.push(candidate)
  }

  await store.projects().update(project.id, (record) => ({ ...record, scannedAt: now }))

  // 归因只在"发现那一刻"做过一次，但变化被发现时还没提交、之后又被提交，是常态。不回头修
  // 正的话，界面会一直把已经进历史的变化说成"未提交的改动"——演化时间轴一旦这样说话，
  // 人就没法靠它判断"这件事到底落定了没有"。
  const settled = await reattributeSettled(store, project, existing)

  return {
    filesSeen: scan.filesSeen,
    truncated: scan.truncated,
    changed,
    changes,
    newCandidates,
    errors: scan.errors,
    durationMs: Date.now() - started,
    settled,
  }
}

/**
 * 把"当时未提交"的演化重新归到提交上：文件已经干净了，它就不再是工作区改动。
 * @param store - 存储门面。
 * @param project - 项目记录。
 * @param contracts - 该项目已纳管的契约（用来批量问哪些文件还脏）。
 * @returns 被重新归因的记录条数。
 */
async function reattributeSettled(
  store: ButlerStore,
  project: ProjectRecord,
  contracts: ContractRecord[],
): Promise<number> {
  if (project.vcs !== 'git') return 0
  const pending = store.changesOf(project.id).filter((change) => change.sha === WORKTREE)
  if (pending.length === 0) return 0
  const files = contracts.map((contract) => contract.file).filter((file) => !file.startsWith('('))
  if (files.length === 0) return 0
  const dirty = await dirtyFiles(project.root, files)
  let settled = 0
  for (const change of pending) {
    const contract = store.contracts().get(change.contractId)
    if (contract === undefined) continue
    // 还脏着就仍旧算工作区改动；追踪不到来源的文件（运行时契约）不参与。
    if (dirty.has(contract.file) || contract.file.startsWith('(')) continue
    const commit = await lastCommitOf(project.root, contract.file)
    if (commit === null) continue
    await store
      .changes()
      .update(change.id, (item) => ({ ...item, sha: commit.sha, at: commit.at * 1000, subject: commit.subject }))
    settled += 1
  }
  return settled
}

/**
 * 写一条演化记录。形状没变时返回 null（不该有记录）。
 * @param store - 存储门面。
 * @param project - 项目记录。
 * @param before - 变化前的契约。
 * @param nextInput - 变化后的输入形状。
 * @param nextOutput - 变化后的输出形状。
 * @param now - 当前时间（兜底用）。
 * @returns 写入的演化记录，或 null。
 */
async function recordChange(
  store: ButlerStore,
  project: ProjectRecord,
  before: ContractRecord,
  nextInput: Candidate['input'],
  nextOutput: Candidate['output'],
  now: number,
): Promise<ChangeRecord | null> {
  const beforeInputHash = shapeHash(before.input)
  const beforeOutputHash = shapeHash(before.output)
  const afterInputHash = shapeHash(nextInput)
  const afterOutputHash = shapeHash(nextOutput)
  if (beforeInputHash === afterInputHash && beforeOutputHash === afterOutputHash) return null

  const reasons: string[] = []
  const inputDiff = diffShape(before.input, nextInput)
  const outputDiff = diffShape(before.output, nextOutput)
  for (const item of inputDiff.breaking) reasons.push(`输入 ${item.path}：${item.detail}`)
  for (const item of outputDiff.breaking) reasons.push(`输出 ${item.path}：${item.detail}`)
  const compatible = [...inputDiff.compatible, ...outputDiff.compatible]
  for (const item of compatible) reasons.push(`（放宽）${item.path}：${item.detail}`)
  // 指纹变了却没归出任何一类，说明规则表漏了一种差异。宁可记一条含糊的记录，也不要让它
  // 变成"契约悄悄变了但没人知道"——那正好是这个插件要消灭的情况。
  if (reasons.length === 0) reasons.push('形状指纹变了，但差异未归类')

  const attribution = await attributeOf(project, before, now)
  const record: ChangeRecord = {
    id: changeKey(before.id, attribution.sha, afterInputHash, afterOutputHash),
    projectId: project.id,
    contractId: before.id,
    sha: attribution.sha,
    at: attribution.at,
    subject: attribution.subject,
    kind: inputDiff.breaking.length + outputDiff.breaking.length > 0 ? 'breaking' : 'compatible',
    reasons,
    beforeHash: `${beforeInputHash}>${beforeOutputHash}`,
    afterHash: `${afterInputHash}>${afterOutputHash}`,
    createdAt: now,
  }
  await store.changes().put(record.id, record)
  return record
}

/** 归因：这次变化算在哪个提交（或工作区）上。 */
async function attributeOf(
  project: ProjectRecord,
  contract: ContractRecord,
  now: number,
): Promise<{ sha: string; at: number; subject: string }> {
  if (project.vcs === 'none' || contract.file.startsWith('(')) {
    return { sha: `local-${textHash(JSON.stringify(contract.evidence)).slice(0, 8)}`, at: now, subject: '本地改动（该项目没有 git 历史）' }
  }
  const dirty = await dirtyFiles(project.root, [contract.file])
  if (dirty.size > 0) {
    return { sha: WORKTREE, at: now, subject: '未提交的改动' }
  }
  const commit = await lastCommitOf(project.root, contract.file)
  if (commit === null) {
    return { sha: `local-${textHash(contract.file).slice(0, 8)}`, at: now, subject: '无法归因到具体提交' }
  }
  return { sha: commit.sha, at: commit.at * 1000, subject: commit.subject }
}
