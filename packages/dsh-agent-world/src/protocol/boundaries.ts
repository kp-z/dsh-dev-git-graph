/**
 * 模块边界规则（BACKLOG M1.6-2）。
 *
 * ## 这份表是可执行的，不是文档里的愿望
 *
 * "禁止耦合"如果不被检查，就只是一句话。所以规则写成**数据**放这里，
 * 由 `test/boundaries.test.js` 去读源码、解析 import、逐条判定，违规就红。
 *
 * 判定只针对**相对路径 import**（`./` 或 `../`）。外部包（`node:fs`、`three`、
 * `@deepseek-ai/*`）由 `forbidden` 那栏单独管，因为它们不是"模块"而是"依赖种类"。
 *
 * ## 三条最关键的禁令
 *
 * 1. **`sim/` 不许 import `content/`** —— 模拟内核只认已经装配好的 `World`。
 *    一旦它开始 import 内容库，换一套内容就得动模拟逻辑，R2 拆出来的那层就白拆了。
 * 2. **`tools/` 只许 import `protocol/`** —— 工具通过 **port 接口**拿东西，
 *    不许 import `state.ts` / `domain/` / `sim/`。这是"模块之间用协议通信"最直接的落点：
 *    今天 `tools/world.ts` 就是直接 import `../state.js`，这条规则会当场把它标红。
 * 3. **`web/` 只许 import `protocol/`** —— 浏览器侧不许伸手进宿主内部。
 *    `protocol/` 会把渲染需要的类型转出去，所以这不是限制能力，而是把缝收到一处。
 */
import type { LibraryKind } from './library-kinds.js'

/** 模块名 = `src/` 下的一级目录名；根下的散文件归入 `app`。 */
export type ModuleName =
  | 'protocol'
  | 'domain'
  | 'content'
  | 'world'
  | 'scene'
  | 'sim'
  | 'store'
  | 'runtime'
  | 'bridge'
  | 'tools'
  | 'routes'
  | 'app'
  | 'web'

/** 一个模块的边界规则。 */
export interface BoundaryRule {
  module: ModuleName
  /** 允许**值** import 的模块（运行时有依赖；自己总是允许）。 */
  mayImport: readonly ModuleName[]
  /**
   * 允许**仅类型** import 的模块。
   *
   * 必须区分这两者，否则规则会自相矛盾：`protocol/wire/messages.ts` 要 import
   * `World` 这个**类型**——世界的形状本来就是契约的一部分。但 `import type` 会被
   * 编译期完全擦除，不产生任何运行时依赖，所以它跟"protocol 依赖了 domain 的实现"是两回事。
   *
   * （这是写完第一版规则后自己踩到的坑：一刀切地禁止 protocol import domain，
   * 结果连"世界长什么样"都没法写进协议。）
   */
  mayImportTypes: readonly ModuleName[]
  /**
   * 禁止的**外部依赖前缀**。用于把"这个模块不该碰的东西"也钉住：
   * 渲染器、Node 内置模块、宿主服务。
   */
  forbidden: readonly string[]
  /** 为什么这么划。写在数据里，改规则时能看见当初的理由。 */
  rationale: string
}

/** 文件级豁免：某个文件虽然属于某模块，但职责特殊。**每条都必须给出理由**。 */
export interface BoundaryExemption {
  /** 相对 `src/` 的路径，如 `content/load-files.ts`。 */
  path: string
  /** 豁免哪一条（`forbidden` 里的前缀）。 */
  allowance: string
  why: string
}

/** 全部模块的边界规则。 */
export const BOUNDARY_RULES: readonly BoundaryRule[] = [
  {
    module: 'protocol',
    mayImport: [],
    mayImportTypes: ['domain'],
    forbidden: ['node:', 'three', '@deepseek-ai/'],
    rationale:
      '契约层只能定义类型、接口、编码。它 import 任何业务模块或宿主服务，就变成了"又一个业务模块"，缝就没了。',
  },
  {
    module: 'domain',
    mayImport: ['protocol'],
    mayImportTypes: ['protocol'],
    forbidden: ['node:', 'three', '@deepseek-ai/'],
    rationale:
      '世界模型是纯数据与纯函数，不认识内容、不认识 IO、不认识渲染器。允许 import protocol 只是为了共用类型标签。',
  },
  {
    module: 'content',
    mayImport: ['protocol', 'domain'],
    mayImportTypes: ['protocol', 'domain'],
    forbidden: ['node:', 'three', '@deepseek-ai/'],
    rationale:
      '内容库只依赖世界模型的类型。它不认识模拟、不认识世界装配、更不认识渲染。' +
      '（`node:` 的例外是 load-files.ts —— 见豁免表。）',
  },
  {
    module: 'world',
    mayImport: ['protocol', 'domain', 'content'],
    mayImportTypes: ['protocol', 'domain', 'content'],
    forbidden: ['node:', 'three', '@deepseek-ai/'],
    rationale: '装配层：把内容装成 World。它必须认识内容，否则没法装；但也仅止于此。',
  },
  {
    module: 'scene',
    mayImport: ['protocol', 'domain'],
    mayImportTypes: ['protocol', 'domain'],
    forbidden: ['node:', 'three', '@deepseek-ai/'],
    rationale:
      '场景描述层把世界翻译成"要摆什么"，是渲染器的输入。它**不许认识 three**（否则就成了某一个渲染器的实现细节），' +
      '也不许认识内容库（配色由调用方解析好传进来）；它必须是纯函数，才能在 node --test 里直接验。',
  },
  {
    module: 'sim',
    mayImport: ['protocol', 'domain'],
    mayImportTypes: ['protocol', 'domain'],
    forbidden: ['node:', 'three', '@deepseek-ai/'],
    rationale:
      '★ 模拟内核**只认 World**，不认识内容库、不认识 IO、不认识渲染器。' +
      '这是"换一套内容不用改模拟逻辑"的前提，也是全表最该守住的一条。',
  },
  {
    module: 'store',
    mayImport: ['protocol', 'domain'],
    mayImportTypes: ['protocol', 'domain'],
    forbidden: ['three', '@deepseek-ai/'],
    rationale: '落盘只关心 World 的形状。允许 node:（fs/path 是它的本职）。',
  },
  {
    module: 'runtime',
    mayImport: ['protocol', 'domain', 'content', 'world', 'sim', 'store', 'bridge'],
    mayImportTypes: ['protocol', 'domain', 'content', 'world', 'sim', 'store', 'bridge'],
    forbidden: ['three', '@deepseek-ai/'],
    rationale: '编排层：把上面几个模块接起来。它是唯一允许"什么都知道"的非 app 模块。',
  },
  {
    module: 'bridge',
    mayImport: ['protocol', 'domain', 'runtime'],
    mayImportTypes: ['protocol', 'domain', 'runtime'],
    forbidden: ['three'],
    rationale: '接真实 subagent：需要 DSH 服务与 runtime，但不该碰渲染。',
  },
  {
    module: 'tools',
    mayImport: ['protocol'],
    mayImportTypes: ['protocol'],
    forbidden: ['three', '@deepseek-ai/dsh-tools/'],
    rationale:
      '★ 模型可见工具**只通过 port 接口**与世界交互。它 import 具体实现（state/domain/sim）' +
      '就是把编排层焊死在工具里，换实现要改工具。' +
      '（`@deepseek-ai/dsh-tools` 本身当然要用，禁的只是它的深层子路径。）',
  },
  {
    module: 'routes',
    mayImport: ['protocol', 'runtime', 'scene'],
    mayImportTypes: ['protocol', 'runtime', 'scene'],
    forbidden: ['three'],
    rationale: 'HTTP/SSE 是传输层：只做解析、调用、序列化。业务判断不在这里。',
  },
  {
    module: 'web',
    mayImport: ['protocol'],
    mayImportTypes: ['protocol'],
    forbidden: ['node:'],
    rationale:
      '★ 浏览器侧**只许 import 契约层**。渲染需要的类型由 protocol 转出，' +
      '所以这不是限制能力，而是把宿主机与浏览器之间那道缝收在一处。',
  },
  {
    module: 'app',
    mayImport: [
      'protocol',
      'domain',
      'content',
      'world',
      'scene',
      'sim',
      'store',
      'runtime',
      'bridge',
      'tools',
      'routes',
    ],
    mayImportTypes: [
      'protocol',
      'domain',
      'content',
      'world',
      'scene',
      'sim',
      'store',
      'runtime',
      'bridge',
      'tools',
      'routes',
    ],
    forbidden: ['three'],
    rationale: '根文件（index/config/state）是组合根：它负责把一切接起来，理所当然认识所有人。',
  },
] as const

/** 文件级豁免。**每条都必须有 why**，否则就是例外变成了常态。 */
export const BOUNDARY_EXEMPTIONS: readonly BoundaryExemption[] = [
  {
    path: 'content/load-files.ts',
    allowance: 'node:',
    why:
      '它是"把磁盘上的 JSON 读成内容包"，本质是 IO 适配器，只能用 fs/path。' +
      '关键约束是它**不被 `content/index.ts` 导出**（那条写在 load-files.ts 的文件头里），' +
      '所以浏览器侧与域层都不会因此沾上 node:。',
  },
]

/** 按模块名取规则。 */
export function ruleOf(module: ModuleName): BoundaryRule {
  const found = BOUNDARY_RULES.find((r) => r.module === module)
  if (!found) throw new Error(`没有为模块 "${module}" 声明边界规则。加模块必须同时加规则。`)
  return found
}

/**
 * 把相对 `src/` 的路径解析成模块名。
 *
 * 根下的散文件（`index.ts` / `config.ts` / `state.ts`）归入 `app`。
 *
 * @param relPath - 形如 `sim/step.ts` 或 `state.ts`。
 */
export function moduleOfPath(relPath: string): ModuleName | null {
  const normalized = relPath.replace(/^\.\//, '')
  const slash = normalized.indexOf('/')
  if (slash === -1) return 'app' // 根下的文件
  const head = normalized.slice(0, slash)
  const known: readonly string[] = BOUNDARY_RULES.map((r) => r.module)
  return known.includes(head) ? (head as ModuleName) : null
}

/**
 * 把 import 说明符解析成它所属的模块名。
 *
 * @param specifier - 源码里 from 后面那一串。
 * @param fromRelPath - 发起 import 的文件（相对 `src/`）。
 * @returns 目标模块名；不是本地相对 import 时返回 `'external'`。
 */
export function resolveImportTarget(specifier: string, fromRelPath: string): ModuleName | 'external' {
  if (!specifier.startsWith('.')) return 'external'
  const fromDir = fromRelPath.includes('/') ? fromRelPath.slice(0, fromRelPath.lastIndexOf('/')) : ''
  const parts = (fromDir === '' ? specifier.split('/') : `${fromDir}/${specifier}`.split('/'))
  const stack: string[] = []
  for (const part of parts) {
    if (part === '' || part === '.') continue
    if (part === '..') stack.pop()
    else stack.push(part)
  }
  const rel = stack.join('/')
  // 目标可能是 `sim/step.ts`（文件）或 `sim`（目录）或 `../content/index.js`。
  const head = rel.split('/')[0] ?? ''
  const known: readonly string[] = BOUNDARY_RULES.map((r) => r.module)
  if (head !== '' && known.includes(head)) return head as ModuleName
  // 落在根下 = app。
  if (!rel.includes('/')) return 'app'
  return 'external'
}

/**
 * 给 `web/` 用的库清单视图。
 *
 * 它在这里只有一个目的：证明 **web 需要的类型由契约层转出**，
 * 而不是让 web 去 import `content/kinds.ts`。类型是从 content 复用的，
 * 所以不会有两份定义漂移的风险。
 */
export type WireLibraryKind = LibraryKind
