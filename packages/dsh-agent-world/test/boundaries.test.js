/**
 * 模块边界强制检查（BACKLOG M1.6-2）。
 *
 * ## 这个文件是"禁止耦合"从口号变成事实的地方
 *
 * 规则写在 `src/protocol/boundaries.ts`（数据），这里**真的去读源码、解析 import、逐条判定**。
 * 违规就红。
 *
 * ## 它检查三类东西
 *
 * 1. **相对 import 的模块边界**：谁能 import 谁。且**区分类型导入与值导入**——
 *    `import type` 编译期就被擦除，不产生运行时依赖，所以它可以跨过值导入不许跨的线
 *    （典型：`protocol/wire/messages.ts` 需要 `World` 这个**类型**，世界的形状本来就是契约的一部分）。
 * 2. **禁止的外部依赖**：比如 `domain/` 不许 import `node:*` / `three`。
 * 3. **契约层的类型一致性**：`LIBRARY_KINDS`（协议层）与 `LIBRARY_SPECS`（内容层）必须一一对应，
 *    否则面板按协议层的库名遍历、内容层却少一个库，会静默地少显示一栏。
 *
 * ## 检查器本身也要被检查
 *
 * 一个"永远返回 0 违规"的检查器是有害的——它给人虚假的安全感。所以下面先用**人造违规**
 * 验证检查器真的会红，再去检查真实代码。
 */
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'

import {
  BOUNDARY_EXEMPTIONS,
  BOUNDARY_RULES,
  LIBRARY_KINDS,
  moduleOfPath,
  resolveImportTarget,
  ruleOf,
} from '../lib/protocol/index.js'
import { LIBRARY_SPECS } from '../lib/content/index.js'

const ROOT = fileURLToPath(new URL('..', import.meta.url))

// ── import 提取 ─────────────────────────────────────────────────────────────

/** 一条语句的起点：`import ...` 或 `export ...`。 */
const STATEMENT_START = /^[ \t]*(import|export)\b/

/** `... from 'x'`（同一段文本里找目标）。 */
const FROM_IN_TEXT = /from[ \t]*['"]([^'"]+)['"]/

/**
 * 抽出一个源文件里的全部 import / re-export。
 *
 * ## 为什么是"逐语句扫描"而不是一条大正则（这是 R14 修的一个真实缺陷）
 *
 * 原来用的是一条跨行长正则：`(import|export)\b([^;]{0,400}?)from *['"]([^'"]+)['"]`。
 * `[^;]{0,400}?` 遇到**没有分号**的声明就一路吃过去，于是
 *
 * ```ts
 * export interface PackVersion {   // ← 从这里开始匹配
 *   ...
 * }
 *
 * import type { World } from '../../domain/types.js'   // ← 被吃进来当成"from"
 * ```
 *
 * 这条语句被当成**一条 `export`**，`type` 也就不在开头 → 分类成**值导入**，
 * 于是检查器对着一条完全合法的 `import type` 报 `[value-import]`。
 *
 * 危害不只是误报：反向的误判是**把真的值导入当成类型导入而放过**——
 * 一个会漏报的检查器比没有检查器更糟（它给人虚假的安全感）。
 *
 * 现在的做法：按行找语句起点，只在这条语句**自己的范围**内找 `from`；
 * 一旦遇到新的语句起点就停手——那条语句没有 `from`（是声明，不是导入）。
 *
 * @param source - 源码文本。
 * @returns 每条含 `specifier` / `typeOnly`。
 */
export function extractImports(source) {
  const lines = source.split('\n')
  const out = []

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? ''
    const start = STATEMENT_START.exec(line)
    if (start === null) continue

    // 副作用导入：`import 'x'`（没有 from）。
    const sideEffect = /^[ \t]*import[ \t]*['"]([^'"]+)['"]/.exec(line)
    if (sideEffect !== null) {
      out.push({ specifier: sideEffect[1], typeOnly: false })
      continue
    }

    // 在**这一条语句内部**找 from：先看本行，再看后续几行，遇到新语句起点就放弃。
    let buffer = line
    let end = i
    let target = FROM_IN_TEXT.exec(buffer)?.[1] ?? null
    if (target === null) {
      for (let j = i + 1; j < Math.min(i + 10, lines.length); j++) {
        const next = lines[j] ?? ''
        if (STATEMENT_START.test(next)) break // 新语句 ⇒ 上面那条没有 from
        buffer += '\n' + next
        end = j
        const found = FROM_IN_TEXT.exec(buffer)
        if (found !== null) {
          target = found[1]
          break
        }
        if (next.includes(';')) break // 声明结束，没有 from
      }
    }
    if (target === null) continue

    // `import type` / `export type`：`type` 必须是**独立词**，
    // 否则 `import typewriter from` 会被误判。
    out.push({
      specifier: target,
      typeOnly: /^[ \t]*(import|export)[ \t]+type\b/.test(buffer),
    })
    i = end
  }
  return out
}

// ── 判定 ────────────────────────────────────────────────────────────────────

/**
 * 检查一个源文件。
 *
 * @param relPath - 相对 `src/` 的路径，如 `sim/step.ts`。
 * @param source - 源码。
 * @returns 违规列表（空数组 = 通过）。
 */
export function checkSource(relPath, source) {
  const module = moduleOfPath(relPath)
  if (module === null) return [] // 未登记的目录不参与检查（例如未来的 web/）
  const rule = ruleOf(module)
  const violations = []

  for (const imp of extractImports(source)) {
    // 1) 禁止的外部依赖
    for (const banned of rule.forbidden) {
      if (!imp.specifier.startsWith(banned)) continue
      const exempt = BOUNDARY_EXEMPTIONS.some((e) => e.path === relPath && e.allowance === banned)
      if (exempt) continue
      violations.push({
        kind: 'forbidden-dependency',
        relPath,
        specifier: imp.specifier,
        message:
          `模块 "${module}" 禁止依赖 "${banned}"，但这里 import 了 "${imp.specifier}"。` +
          `理由：${rule.rationale}`,
      })
    }

    // 2) 相对 import 的模块边界
    const target = resolveImportTarget(imp.specifier, relPath)
    if (target === 'external') continue
    if (target === module) continue // 同模块内部随便 import
    const allowed = imp.typeOnly ? rule.mayImportTypes : rule.mayImport
    if (allowed.includes(target)) continue
    violations.push({
      kind: imp.typeOnly ? 'type-import' : 'value-import',
      relPath,
      specifier: imp.specifier,
      message:
        `模块 "${module}" ${imp.typeOnly ? '（仅类型）' : '（值）'}不许 import "${target}"，` +
        `但这里 import 了 "${imp.specifier}"。允许的模块：${allowed.length > 0 ? allowed.join(' / ') : '（无）'}。` +
        `理由：${rule.rationale}`,
    })
  }

  return violations
}

/** 递归列出目录下所有 .ts 文件（相对 `src/`）。 */
function listTs(dir) {
  const out = []
  const walk = (abs, rel) => {
    for (const entry of readdirSync(abs)) {
      if (entry === 'node_modules' || entry.startsWith('.')) continue
      const absChild = join(abs, entry)
      const relChild = rel === '' ? entry : `${rel}/${entry}`
      if (statSync(absChild).isDirectory()) walk(absChild, relChild)
      else if (entry.endsWith('.ts')) out.push(relChild)
    }
  }
  walk(dir, '')
  return out.sort()
}

// ── 0. 检查器自身要能被验证 ─────────────────────────────────────────────────

test('检查器有效性：人造违规必须被抓到（否则它就是虚假的安全感）', () => {
  // sim 不许 import content —— 值导入应当违规。
  const v1 = checkSource('sim/step.ts', "import { registry } from '../content/registry.js'\n")
  assert.equal(v1.length, 1)
  assert.equal(v1[0].kind, 'value-import')
  assert.match(v1[0].message, /sim/)

  // 但**仅类型**允许：sim 可以 import protocol 与 domain 的类型。
  assert.deepEqual(checkSource('sim/step.ts', "import type { World } from '../domain/types.js'\n"), [])
  assert.deepEqual(checkSource('sim/step.ts', "import type { WorldServicePort } from '../protocol/index.js'\n"), [])

  // tools 不许 import domain —— 这正是本轮修掉的那处耦合。
  const v2 = checkSource('tools/world.ts', "import type { PluginState } from '../state.js'\n")
  assert.equal(v2.length, 1)
  assert.match(v2[0].message, /app/)

  // tools 只许 protocol：连 domain 的类型都不许。
  const v3 = checkSource('tools/world.ts', "import type { World } from '../domain/types.js'\n")
  assert.equal(v3.length, 1)

  // 禁止的外部依赖。
  const v4 = checkSource('domain/types.ts', "import { readFileSync } from 'node:fs'\n")
  assert.equal(v4.length, 1)
  assert.equal(v4[0].kind, 'forbidden-dependency')

  assert.deepEqual(checkSource('domain/types.ts', "import three from 'three'\n").length, 1)

  // 豁免表生效：content/load-files.ts 用 node: 是允许的。
  assert.deepEqual(checkSource('content/load-files.ts', "import { readFileSync } from 'node:fs'\n"), [])
  // 但豁免只对那一个文件、那一条前缀有效。
  assert.equal(checkSource('content/registry.ts', "import { readFileSync } from 'node:fs'\n").length, 1)

  // 同模块内部 import 永远允许。
  assert.deepEqual(checkSource('sim/step.ts', "import { ready } from './ready.js'\n"), [])
})

test('import 提取：类型导入与值导入要分清，副作用导入也算值导入', () => {
  const source = [
    "import type { A } from '../protocol/index.js'",
    "import { B } from '../protocol/index.js'",
    "import type {",
    '  C,',
    "} from '../domain/types.js'",
    "export type { D } from './x.js'",
    "export { E } from './y.js'",
    "import '../panel.js'",
    "import typewriter from './z.js'",
  ].join('\n')

  const imports = extractImports(source)
  const by = Object.fromEntries(imports.map((i) => [i.specifier, i.typeOnly]))

  // 同一路径出现两次（一次 type 一次值），两条都必须保留——按路径去重会丢掉"是不是类型导入"这个维度。
  assert.equal(imports.filter((i) => i.specifier === '../protocol/index.js').length, 2)
  assert.equal(imports.find((i) => i.specifier === '../protocol/index.js' && i.typeOnly)?.typeOnly, true)
  assert.equal(imports.find((i) => i.specifier === '../protocol/index.js' && !i.typeOnly)?.typeOnly, false)

  assert.equal(by['../domain/types.js'], true, '多行 import type 也要认出来')
  assert.equal(by['./x.js'], true, 'export type from 是类型导入')
  assert.equal(by['./y.js'], false, 'export from 是值导入')
  assert.equal(by['../panel.js'], false, '副作用导入是值导入')
  assert.equal(by['./z.js'], false, 'typewriter 不是 type（不能把 type 前缀当关键字切）')
})

test('路径解析：. / .. 都要归约到模块名', () => {
  assert.equal(resolveImportTarget('./ready.js', 'sim/step.ts'), 'sim')
  assert.equal(resolveImportTarget('../domain/types.js', 'sim/step.ts'), 'domain')
  assert.equal(resolveImportTarget('../../domain/types.js', 'protocol/ports/world-service.ts'), 'domain')
  assert.equal(resolveImportTarget('../../content/kinds.js', 'protocol/ports/world-service.ts'), 'content')
  // `./state.js` 从 tools/ 出发是 tools/state.js（不存在）→ 归到 tools；
  // 真正指向组合根的是 `../state.js`。
  assert.equal(resolveImportTarget('./state.js', 'tools/world.ts'), 'tools')
  assert.equal(resolveImportTarget('../state.js', 'tools/world.ts'), 'app')
  assert.equal(resolveImportTarget('node:fs', 'domain/types.ts'), 'external')
  assert.equal(resolveImportTarget('@deepseek-ai/dsh-tools', 'tools/world.ts'), 'external')
})

// ── 1. 真实代码检查 ─────────────────────────────────────────────────────────

test('真实源码：没有任何跨模块违规', () => {
  const srcDir = join(ROOT, 'src')
  const files = listTs(srcDir)

  assert.ok(files.length > 15, `只扫到 ${files.length} 个文件，扫描大概出错了`)

  const violations = []
  for (const relPath of files) {
    const source = readFileSync(join(srcDir, relPath.split('/').join(sep)), 'utf8')
    violations.push(...checkSource(relPath, source))
  }

  const report = violations
    .map((v) => `· [${v.kind}] ${v.relPath} → ${v.specifier}\n    ${v.message}`)
    .join('\n')

  assert.deepEqual(violations, [], `模块边界被打破了：\n${report}`)
})

test('每一条边界规则都指向真实存在的模块（或明确是未来的）', () => {
  const srcDir = join(ROOT, 'src')
  const present = new Set(readdirSync(srcDir).filter((e) => statSync(join(srcDir, e)).isDirectory()))
  present.add('app') // 根文件

  // 尚未创建的模块：规则可以先立着（先定协议），但必须在这里登记，避免"规则写了却没人记得"。
  const planned = new Set(['sim', 'store', 'runtime', 'bridge', 'routes', 'panel', 'web'])

  for (const rule of BOUNDARY_RULES) {
    if (rule.module === 'web') continue // web/ 是独立构建，不在 src/ 下
    const exists = present.has(rule.module)
    assert.ok(
      exists || planned.has(rule.module),
      `规则里有模块 "${rule.module}"，但 src/ 下既没有这个目录、也没登记为 planned。`,
    )
    assert.ok(rule.rationale.length > 10, `模块 "${rule.module}" 的 rationale 太短，等于没写理由`)
  }
})

test('web/ 一旦存在，只许 import protocol', () => {
  const webSrc = join(ROOT, 'web', 'src')
  if (!existsSync(webSrc)) return // M4 之前还没建，跳过（不是失败）

  const violations = []
  for (const relPath of listTs(webSrc)) {
    const source = readFileSync(join(webSrc, relPath.split('/').join(sep)), 'utf8')
    // web 里的相对路径是相对它自己的，先归约成"从 web/src 出发"，再按 protocol 规则判。
    const fromWeb = `web/${relPath}`
    for (const imp of extractImports(source)) {
      const target = resolveImportTarget(imp.specifier, fromWeb)
      if (target !== 'external' && target !== 'web' && target !== 'protocol') {
        violations.push({ relPath, specifier: imp.specifier, target })
      }
    }
  }
  assert.deepEqual(
    violations,
    [],
    `web/ 只许 import protocol，但发现：\n${violations.map((v) => `· ${v.relPath} → ${v.specifier}`).join('\n')}`,
  )
})

// ── 2. 契约层的类型一致性 ───────────────────────────────────────────────────

test('LIBRARY_KINDS（协议层）与 LIBRARY_SPECS（内容层）必须一一对应', () => {
  const fromSpecs = LIBRARY_SPECS.map((s) => s.kind).sort()
  const fromKinds = [...LIBRARY_KINDS].sort()
  assert.deepEqual(
    fromSpecs,
    fromKinds,
    '协议层的库清单与内容层的库目录不一致——面板按协议层的库名遍历时，会静默地少显示一栏。',
  )
})

test('每个库都有标题与说明（面板与诊断直接用它们，不许出现空标题）', () => {
  for (const spec of LIBRARY_SPECS) {
    assert.ok(spec.title.length > 0, `${spec.kind} 没有标题`)
    assert.ok(spec.summary.length > 0, `${spec.kind} 没有说明`)
    assert.ok(spec.idPrefix.endsWith('.'), `${spec.kind} 的 idPrefix 应当以 . 结尾（约定形如 "station."）`)
  }
})

test('相对路径不含反斜杠（跨平台路径拼接的常见坑）', () => {
  for (const relPath of listTs(join(ROOT, 'src'))) {
    assert.ok(!relPath.includes('\\'), `${relPath} 含反斜杠`)
  }
  assert.ok(relative(join(ROOT, 'src'), join(ROOT, 'src')).length === 0)
})

// ── 检查器本身也要被检查（R14 补的两个盲区）────────────────────────────────

test('提取器：`export interface` 后面紧跟 `import type` 时**不能把两者当成一条语句**（R14 修的真缺陷）', () => {
  // 这就是我踩到的那个形状：声明里没有分号，而后面那条 import 离得很近。
  // 旧实现（跨行长正则 `(import|export)\b([^;]{0,400}?)from`）会把
  // `export interface ... { ... }` 一路吃到下一行的 `from`，于是
  // 那条完全合法的 `import type` 被分类成 **value-import** 而误报。
  const source = [
    'export interface PackVersion {',
    '  id: string',
    '  version: string',
    '}',
    '',
    "import type { World } from '../../domain/types.js'",
    '',
    'export const X = 1',
  ].join('\n')

  const found = extractImports(source)

  assert.equal(found.length, 1, `应当只抽出一条 import，实际：${JSON.stringify(found)}`)
  assert.equal(found[0].specifier, '../../domain/types.js')
  assert.equal(found[0].typeOnly, true, '`import type` 必须被认成类型导入——误判成值导入会让检查器误报')
})

test('提取器：反向也要对——真正的值导入不能被放过（漏报比误报更糟）', () => {
  const source = [
    'export interface Thing {',
    '  a: number',
    '}',
    '',
    "import { step } from '../sim/step.js'", // 值导入
  ].join('\n')

  const found = extractImports(source)
  assert.equal(found.length, 1)
  assert.equal(found[0].typeOnly, false, '没有 type 的就是值导入，绝不能因为前一行是声明就变样')
})

test('提取器：多行 import、re-export、副作用导入都要认得', () => {
  const source = [
    "import {",
    '  a,',
    '  b,',
    "} from './multi.js'",
    '',
    "export { c } from './re-export.js'",
    "export type { D } from './re-type.js'",
    '',
    "import './side-effect.js'",
  ].join('\n')

  const found = extractImports(source)
  const by = Object.fromEntries(found.map((f) => [f.specifier, f.typeOnly]))

  assert.deepEqual(by, {
    './multi.js': false,
    './re-export.js': false,
    './re-type.js': true,
    './side-effect.js': false,
  })
})

test('提取器：`import typewriter from` 不该被当成类型导入（判 "type" 要判独立词）', () => {
  const found = extractImports("import typewriter from './tw.js'")
  assert.equal(found.length, 1)
  assert.equal(found[0].typeOnly, false)
})

test('目录覆盖：`src/` 下每个一级目录都必须在规则表里登记（否则检查器会**静默跳过**整个目录）', () => {
  // 这是 M1.6-8 那个反向盲区：`moduleOfPath()` 对没登记的目录返回 null，
  // 而 `checkSource()` 对 null 直接返回"无违规"——于是新建一个目录、忘了登记，
  // 那个目录下的**所有**跨模块 import 都不再被检查，而报告是全绿。
  const srcDir = join(ROOT, 'src')
  const dirs = readdirSync(srcDir, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)

  const registered = BOUNDARY_RULES.map((r) => r.module)
  // 反过来也要成立：规则表里的模块名如果不是目录（也不是 app 这种特殊名），
  // 那多半是个拼写错误——同样会让检查形同虚设。
  // 反向：规则表里**有规则但还没有目录**的模块。这一项不能一概禁止——
  // 有些是**计划中的**（写规则是为了先定契约），有些是**不在 src/ 下的**。
  // 但必须逐个写明理由，不能默默放过：R14 就是靠这条查出 `panel` 是**过期条目**
  // （面板早就并进 `routes/panel.ts` 了，规则还留着，app 的 mayImport 里也还列着它）。
  const planned = new Map([
    ['bridge', 'M7 计划：与真实 subagent 的桥，目录还没建'],
    ['web', '不在 src/ 下：浏览器侧的独立构建'],
  ])
  // **非本插件代码**的目录：`src/vendor/` 放的是第三方资源（three 等），
  // 没有 TS、不参与模块图，所以"登记模块规则"对它没有意义。
  // 但也不能默默放过——列在这里就等于写明"这些文件不是我们写的"。
  const notOurCode = new Map([['vendor', '第三方 vendored 资源，不参与本插件的模块图（见 src/vendor/README.md）']])

  const unregistered = dirs.filter((d) => !registered.includes(d) && !notOurCode.has(d))
  assert.deepEqual(
    unregistered,
    [],
    `这些目录既没登记进 BOUNDARY_RULES，也没写进忽略清单：${unregistered.join(' / ')}`,
  )

  const ghost = registered.filter((m) => m !== 'app' && !dirs.includes(m) && !planned.has(m))
  assert.deepEqual(
    ghost,
    [],
    `规则表里有不存在的模块（是过期条目还是漏建目录？）：${ghost.join(' / ')}。` +
      `如果是有意计划中的，请加进本测试的 planned 表并写明理由。`,
  )
})
