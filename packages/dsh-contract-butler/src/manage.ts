/**
 * 纳管：把一个项目从"一堆文件"变成"一组被盯住的契约"。
 *
 * 分成两段是刻意的：`previewInit` 只读、可反复调用（用户点开对话框、换个范围、再看一眼），
 * `commitInit` 才写。所以"扫一下看看"永远不会留下副作用——这对一个要读别人整个仓库的功能
 * 来说是最基本的礼貌。
 *
 * 写进去的三样东西：项目记录（纳管范围 + 当时的基线）、被选中的契约、每条契约在基线版本上
 * 的形状快照。之后所有"变过"都是相对这个基线算出来的。
 */
import { headCommit, isRepo } from './git.js'
import { scanProject, DEFAULT_EXCLUDE_DIRS } from './scan.js'
import { changeKey, snapshotKey } from './store.js'
import { shapeHash, textHash } from './shape.js'
import type { Extractor } from './extract/index.js'
import type { ButlerStore } from './store.js'
import type { Candidate, ContractRecord, ProjectRecord, ScanConfig, ScanResult, ShapeNode, VcsKind } from './types.js'

/** 纳管的预览结果。 */
export interface InitPreview {
  root: string
  vcs: VcsKind
  /** 基线提交；无 git 时为 null。 */
  head: { sha: string; at: number; subject: string } | null
  candidates: Candidate[]
  scan: ScanResult
}

/** 预览选项。 */
export interface InitOptions {
  root: string
  extractors: Extractor[]
  /** 项目级扫描配置；缺省用默认值。 */
  scan?: Partial<ScanConfig>
  /** 运行时内省出来的候选（工具注册表），一并并入。 */
  runtimeCandidates?: Candidate[]
}

/** 默认扫描配置。 */
export function defaultScanConfig(overrides: Partial<ScanConfig> = {}): ScanConfig {
  return {
    excludeDirs: overrides.excludeDirs ?? DEFAULT_EXCLUDE_DIRS,
    maxFiles: overrides.maxFiles ?? 2000,
  }
}

/**
 * 只读预览：扫出候选，不动任何存储。
 * @param options - 纳管选项。
 * @returns 预览结果（含各自项目的版本控制形态与基线提交）。
 */
export async function previewInit(options: InitOptions): Promise<InitPreview> {
  const scanConfig = defaultScanConfig(options.scan)
  const scan = await scanProject({
    root: options.root,
    excludeDirs: scanConfig.excludeDirs,
    maxFiles: scanConfig.maxFiles,
    extractors: options.extractors,
  })

  const hasGit = await isRepo(options.root)
  const head = hasGit ? await headCommit(options.root) : null
  const runtime = options.runtimeCandidates ?? []
  const candidates = [...scan.candidates, ...runtime]

  return {
    root: options.root,
    vcs: head === null ? 'none' : 'git',
    head,
    candidates,
    scan: { ...scan, candidates },
  }
}

/** 落库选项。 */
export interface CommitInitOptions extends InitOptions {
  /** 项目展示名。 */
  title?: string
  /** 只纳管这些候选 id；不填表示纳管预览里的全部候选。 */
  include?: string[]
}

/** 纳管结果。 */
export interface InitResult {
  project: ProjectRecord
  /** 实际写入的契约条数。 */
  contracts: number
  /** 被跳过的候选（没有形状可言，纳管它没有意义）。 */
  skipped: Candidate[]
}

/**
 * 落库：写项目记录 + 契约 + 基线快照。
 *
 * 只有**至少有一个形状**的候选才会被纳管：一条既不声明输入也不声明输出的"契约"没有任何
 * 可对照的东西，纳管它只会制造噪声。
 * @param store - 存储门面。
 * @param options - 纳管选项与选中范围。
 * @returns 纳管结果。
 */
export async function commitInit(store: ButlerStore, options: CommitInitOptions): Promise<InitResult> {
  const preview = await previewInit(options)
  const wanted = options.include === undefined ? null : new Set(options.include)
  const now = Date.now()

  const projectId = projectIdOf(preview.root)
  const title = options.title ?? basenameOf(preview.root)
  const baselineSha = preview.head?.sha ?? null
  // 无 git 的项目没有提交可比，基线退化为内容哈希——界面必须如实说明这一点，否则用户会
  // 以为自己在比版本，实际只是在比文件内容。
  const baselineHash = preview.head === null ? textHash(preview.root) : null
  const snapshotSha = baselineSha ?? baselineHash ?? ''

  const accepted: Candidate[] = []
  const skipped: Candidate[] = []
  for (const candidate of preview.candidates) {
    if (wanted !== null && !wanted.has(candidate.id)) continue
    if (candidate.input === null && candidate.output === null) {
      skipped.push(candidate)
      continue
    }
    accepted.push(candidate)
  }

  // 契约先落，随后才是项目记录——项目记录里的 `include` 一旦可读，就应当指向已经存在的契约，
  // 否则中途失败会留下一个"纳管了但契约不见了"的项目。
  for (const candidate of accepted) {
    const record: ContractRecord = {
      id: candidate.id,
      projectId,
      file: candidate.file,
      boundary: candidate.boundary,
      boundaryKind: candidate.boundaryKind,
      source: candidate.source,
      title: candidate.title,
      symbol: candidate.symbol,
      input: candidate.input,
      output: candidate.output,
      twins: candidate.twins,
      evidence: candidate.evidence,
      confidence: candidate.confidence,
      createdAt: now,
      updatedAt: now,
    }
    await store.contracts().put(record.id, record)
    await store.snapshots().put(snapshotKey(record.id, snapshotSha), {
      projectId,
      contractId: record.id,
      sha: snapshotSha,
      at: preview.head?.at ?? now,
      inputHash: shapeHash(record.input),
      outputHash: shapeHash(record.output),
      input: record.input,
      output: record.output,
    })
  }

  const project: ProjectRecord = {
    id: projectId,
    root: preview.root,
    title,
    vcs: preview.vcs,
    baselineSha,
    baselineHash,
    createdAt: now,
    scannedAt: now,
    scan: defaultScanConfig(options.scan),
    include: accepted.map((candidate) => candidate.id),
  }
  await store.projects().put(project.id, project)

  return { project, contracts: accepted.length, skipped }
}

/** 项目 id：根路径的稳定哈希。 */
export function projectIdOf(root: string): string {
  return `p_${textHash(root).slice(0, 12)}`
}

/** 取路径最后一段当默认标题。 */
function basenameOf(path: string): string {
  const parts = path.replace(/[/\\]+$/, '').split(/[/\\]/)
  return parts[parts.length - 1] ?? path
}
