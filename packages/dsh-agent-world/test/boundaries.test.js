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

/** 匹配 `import ... from 'x'` / `export ... from 'x'`。非贪婪且限长，避免跨整个文件乱抓。 */
const FROM_RE = /(^|\n)[ \t]*(import|export)\b([^;]{0,400}?)from[ \t]*['"]([^'"]+)['"]/g

/** 匹配副作用导入 `import 'x'`（不会命中带 from 的形式）。 */
const SIDE_EFFECT_RE = /(^|\n)[ \t]*import[ \t]*['"]([^'"]+)['"]/g

/**
 * 抽出一个源文件里的全部 import。
 *
 * @param source - 源码文本。
 * @returns 每条含 `specifier` / `typeOnly`。
 */
export function extractImports(source) {
  const out = []
  for (const m of source.matchAll(FROM_RE)) {
    const clause = m[3] ?? ''
    out.push({
      specifier: m[4],
      // `import type {` / `export type {` —— 注意要判 "type" 是**独立词**，
      // 否则 `import typewriter from` 会被误判。
      typeOnly: /^\s*type\s/.test(clause) || /^\s*type$/.test(clause.trim()),
    })
  }
  for (const m of source.matchAll(SIDE_EFFECT_RE)) {
    out.push({ specifier: m[2], typeOnly: false })
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
