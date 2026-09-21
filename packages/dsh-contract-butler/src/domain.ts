/**
 * 存储域声明。
 *
 * 直接用 DSH 的领域数据形式（`dsh-base` 里已挂 `dsh-storage` + `dsh-storage-json` +
 * `dsh-storage-domain`），所以本插件**不自己写 JSON 文件**，也不新增后端：
 * 一次 `defineDomain` + `ctx.storageDomain.open` 就拿到了"读同步、写持久、按序发事件"的语义。
 *
 * `defineDomain`/`domainTable` 取自本包的 `./spec.js`（而不是那个包本身），原因见那里的说明：
 * 那个包只存在于 app 的 node_modules，profile 插件在运行时解析不到它。
 *
 * **记录 schema 必须是 zod**（`domainTable` 的值 schema 会在领域打开时被
 * `valueSchema.parse(raw)` 逐条校验）。宿主自己也是这么分的：领域记录用 zod（以后同一份
 * schema 可以直接投影成 RPC 线的格式），插件 Config 才用 schemastery。用错库的后果不是
 * 类型报错，而是**领域打开时抛 `parse is not a function`**——那是运行期才会炸的错。
 *
 * 另一个容易踩的地方：zod 的对象默认**剥掉未声明的字段**。所以每条记录都必须把自己的
 * key 字段（`id`）老老实实声明出来，否则落盘再读出来 id 就没了——记录还在，但已经不是
 * 一条能被引用的记录了。
 *
 * 命名约束（由 `defineDomain` 在模块加载时强校验）：
 * - 域/表名必须匹配 `^[a-z][a-z0-9_]*$`，所以是 `contract_butler` 而不是 `contract-butler`。
 * - 记录 key 必须匹配 `[a-zA-Z0-9_-]+`，所以契约 id 用 `c_<hex>` 这类 key 安全的写法。
 *
 * 形状子树（`input`/`output`）刻意用 `z.any()` 承载：形状节点是递归结构，没有递归 schema
 * 可用，硬套会退化成一堆层数上限的丑陋定义。代价是这部分由 `parseShape()` 在读写两侧自行
 * 校验；收益是落盘 JSON 保持人类可读（能被直接打开检查），这对一个"让人看懂契约"的插件比
 * 让校验器多认一种类型更重要。
 */
import { z } from 'zod'
import { defineDomain, domainTable } from './spec.js'
import type { DomainSpecLike } from './types.js'

/** 形状子树的占位 schema；见文件头说明。 */
const shape = z.any()

/** 边界种类，与 `BoundaryKind` 保持一致。 */
const boundaryKind = z.enum(['tool', 'http', 'event', 'proto', 'schema', 'db', 'unknown'])

/** 版本控制形态，与 `VcsKind` 保持一致。 */
const vcsKind = z.enum(['git', 'none'])

/**
 * 一个字段的中文解释：`name` 与扫描出的字段名逐字相同，`zh` 是模型给出的中文。
 *
 * 契约记录与 AI 缓存行共用同一个形状——两处必须是同一条，否则缓存命中时补回契约记录的那一步
 * 会悄悄换成另一种形状（而面板只认 `{name, zh}`）。
 */
export const aiFieldSchema = z.object({
  name: z.string(),
  zh: z.string(),
})

/** 项目的纳管记录。 */
export const projectSchema = z.object({
  /** 记录 key，同时也是项目 id。 */
  id: z.string(),
  /** 绝对路径。 */
  root: z.string(),
  title: z.string(),
  vcs: vcsKind,
  /** git 基线提交；无 git 时为 null。 */
  baselineSha: z.string().nullable(),
  /** 无 git 时的基线内容哈希；有 git 时为 null。 */
  baselineHash: z.string().nullable(),
  createdAt: z.number(),
  scannedAt: z.number(),
  scan: z.object({
    excludeDirs: z.array(z.string()),
    maxFiles: z.number(),
  }),
  /** 纳管进来的契约 id；不在其中的候选属于"已知但未纳管"。 */
  include: z.array(z.string()),
})

/** 契约记录（定义层）。 */
export const contractSchema = z.object({
  /** 记录 key，同时也是契约 id。 */
  id: z.string(),
  projectId: z.string(),
  file: z.string(),
  boundary: z.string(),
  boundaryKind,
  source: z.string(),
  title: z.string(),
  symbol: z.string(),
  input: shape,
  output: shape,
  twins: z.array(z.string()),
  evidence: z.object({
    line: z.number(),
    hash: z.string(),
  }),
  confidence: z.number(),
  createdAt: z.number(),
  updatedAt: z.number(),
  /**
   * AI 理解结果（可选）。
   *
   * 声明成 optional 而不是 nullable：老记录里根本没有这几个字段，`undefined` 才是"没问过"
   * 的准确表达；而且 zod 会剥掉未声明的键，不在这儿声明出来，写回的结果落盘后就没了。
   * 另外注意：`title`（原始符号名）不在这一组里，它永远不会被 AI 结果覆盖。
   */
  aiTitle: z.string().optional(),
  aiFamily: z.string().optional(),
  /**
   * 字段级中文：`[{name, zh}]`，`name` 与扫描出的字段名逐字相同。
   *
   * **必须在这里声明**：它就是本插件唯一的"字段中文"落点（面板按名字对上才渲染那一栏）。
   * 漏声明的代价不是类型报错，而是 writeBack 明明写了、落盘那一刻被 zod 静默剥掉——
   * 界面表现为"外层中文有、每个字段的中文全空"，而所有单测（纯 Map 的存储替身）照样全绿。
   */
  aiFields: z.array(aiFieldSchema).optional(),
  aiRelations: z.array(z.object({ to: z.string(), rel: z.string(), why: z.string() })).optional(),
  aiHash: z.string().optional(),
  aiAt: z.number().optional(),
})

/** AI 结果的缓存行。key 是 `ai_<契约 id>`，是否可用由 `hash` 与当前内容对不对得上决定。 */
export const aiSchema = z.object({
  id: z.string(),
  projectId: z.string(),
  contractId: z.string(),
  hash: z.string(),
  titleZh: z.string(),
  family: z.string(),
  /**
   * 缓存里的字段级中文。**与契约记录上的 `aiFields` 同理必须声明**：不声明的话缓存命中时
   * 拿回来的永远是 `undefined`，而 hash 又对得上、模型不会再被问一次，字段中文就再也补不上。
   *
   * optional：本功能之前写下的老缓存行没有这一项。缺这一项的行由 `aiWorkflow.ts` 判成
   * "不算命中"（重新问模型），而不是在这里把它判成非法记录。
   */
  fields: z.array(aiFieldSchema).optional(),
  relations: z.array(z.object({ to: z.string(), rel: z.string(), why: z.string() })),
  at: z.number(),
  channel: z.string(),
})

/** 形状快照：某条契约在某一版上的样子。key 由 `snapshotKey()` 生成。 */
export const snapshotSchema = z.object({
  projectId: z.string(),
  contractId: z.string(),
  sha: z.string(),
  at: z.number(),
  inputHash: z.string(),
  outputHash: z.string(),
  input: shape,
  output: shape,
})

/** 演化记录（演化层）。 */
export const changeSchema = z.object({
  id: z.string(),
  projectId: z.string(),
  contractId: z.string(),
  /** 归因到的提交；未提交的改动是 `wt`。 */
  sha: z.string(),
  at: z.number(),
  subject: z.string(),
  kind: z.enum(['breaking', 'compatible']),
  reasons: z.array(z.string()),
  beforeHash: z.string(),
  afterHash: z.string(),
  createdAt: z.number(),
})

/** 运行层观测记录。 */
export const observationSchema = z.object({
  id: z.string(),
  projectId: z.string(),
  contractId: z.string(),
  at: z.number(),
  source: z.string(),
  subject: z.string(),
  ok: z.boolean(),
  reasons: z.array(z.string()),
  shapeHash: z.string(),
  sample: z.string(),
  bytes: z.number(),
})

/** 决策记录：人对契约/演化/观测做的全部写入。 */
export const decisionSchema = z.object({
  id: z.string(),
  projectId: z.string(),
  targetKind: z.enum(['contract', 'change', 'observation']),
  targetId: z.string(),
  action: z.enum(['ack', 'accept-baseline', 'silence', 'scope']),
  by: z.string(),
  at: z.number(),
  note: z.string(),
})

/**
 * 本插件独占的存储域。
 *
 * 七张表各管一层：`projects` 纳管范围、`contracts` 定义层、`snapshots` 某一版的形状、
 * `changes` 演化层、`observations` 运行层、`decisions` 人的全部写入、`ai` AI 理解的缓存。
 *
 * 加表**不动 version**：宿主那侧的介质是按 descriptor 里的表名逐个取的，缺的那张初始化成空表
 * （见 `dsh-storage-json` 的 `for (const table of descriptor.tables)`），所以加一张表对老数据是
 * 纯增量；反过来 bump 版本会让「stored version != expected」直接把整个域拒之门外。
 */
export const CONTRACT_BUTLER_DOMAIN: DomainSpecLike = defineDomain({
  name: 'contract_butler',
  version: 1,
  layout: 'single',
  invalidRecords: 'backup-and-skip',
  tables: {
    projects: domainTable(projectSchema),
    contracts: domainTable(contractSchema),
    snapshots: domainTable(snapshotSchema),
    changes: domainTable(changeSchema),
    observations: domainTable(observationSchema),
    decisions: domainTable(decisionSchema),
    ai: domainTable(aiSchema),
  },
})
