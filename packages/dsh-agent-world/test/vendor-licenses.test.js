/**
 * vendored 资产的**许可守卫**（R59）。
 *
 * ## 它防的是什么
 *
 * R59 查出一件事：`src/vendor/microverse/` 里那套美术（LimeZu 的 Modern Office）**不是**它旁边
 * 那份 `LICENSE`（KsanaDock 的 MIT）覆盖的东西——那份 MIT 只覆盖 Microverse 的代码。
 * 也就是说：**"目录里有许可文件"是必要条件，不是充分条件**（语义那一半只能人去核，
 * 见 `docs/ASSET-LICENSES-EVIDENCE.md`）。
 *
 * 但必要条件也值得自动化：**没有凭据的资产不该混进来**。所以这条测试盯的是
 * 「`src/vendor/` 下每个资产包根目录，是否都有一份非空的许可文件」。
 *
 * ## "资产包根"怎么定义
 *
 * - `src/vendor/<X>` —— 如 `three/`、`kenney-furniture/`、`microverse/`
 * - `src/vendor/pixel/<类别>/<包>` —— pixel 是按类别组织的（R50 的约定），所以包根在第三层
 *
 * 判据是**包根目录里直接躺着**一份许可文件（`LICENSE*` / `Licence*` / `COPYING*` / `NOTICE*`），
 * 而且内容 > 50 字节（防"建个空文件糊过去"）。
 *
 * ## 为什么连"不含二进制"的包根也要查
 *
 * `three/` / `phaser/` / `pixi/` 里只有 `.js`——它们同样是要随包发布的第三方代码，
 * 同样需要保留版权与许可声明。只查"含 png/glb 的目录"会漏掉这一类。
 */
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'

const VENDOR = fileURLToPath(new URL('../src/vendor/', import.meta.url))

/** 许可文件名的前缀（大小写不敏感）。`License.txt` 与 `LICENSE` 都算。 */
const LICENSE_PREFIXES = ['license', 'licence', 'copying', 'notice']

/** 二进制资产的后缀（用于报告里说明"这个包根确实带了资产"）。 */
const BINARY_SUFFIXES = ['.png', '.glb', '.jpg', '.jpeg', '.gif', '.webp']

/** 许可文件的最小体积：50 字节。一个空文件或只有 "TODO" 的不算凭据。 */
const MIN_LICENSE_BYTES = 50

/** 目录里有没有直接躺着的许可文件（返回文件名）。 */
async function licenseFilesIn(dir) {
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => [])
  const out = []
  for (const entry of entries) {
    if (!entry.isFile()) continue
    const lower = entry.name.toLowerCase()
    if (LICENSE_PREFIXES.some((prefix) => lower.startsWith(prefix))) out.push(entry.name)
  }
  return out
}

/** 递归统计一个子树里有哪些后缀的文件。 */
async function walk(dir, onFile) {
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => [])
  for (const entry of entries) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) await walk(full, onFile)
    else if (entry.isFile()) await onFile(full)
  }
}

/**
 * 找出 `src/vendor/` 下的**资产包根**。
 *
 * `pixel/` 特殊：它是 `<类别>/<包>` 两层（R50 定的组织方式），所以包根在第三层。
 *
 * @param vendor - `src/vendor/` 的绝对路径。
 * @returns 包根目录的绝对路径列表（排序）。
 */
export async function findPackageRoots(vendor) {
  const roots = []
  for (const entry of await readdir(vendor, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    const top = join(vendor, entry.name)
    if (entry.name === 'pixel') {
      for (const category of await readdir(top, { withFileTypes: true })) {
        if (!category.isDirectory()) continue
        for (const pack of await readdir(join(top, category.name), { withFileTypes: true })) {
          if (pack.isDirectory()) roots.push(join(top, category.name, pack.name))
        }
      }
      continue
    }
    roots.push(top)
  }
  return roots.sort()
}

/**
 * 检查每个包根有没有凭据。
 *
 * 导出它是为了**给守卫自己写测试**：临时造假目录 → 它必须报出来。
 * 一个不会红的守卫等于没有守卫。
 *
 * @param vendor - `src/vendor/` 的绝对路径。
 * @returns 有问题的包根列表：`{ dir, reason }`。
 */
export async function findLicenseProblems(vendor) {
  const problems = []
  for (const root of await findPackageRoots(vendor)) {
    let binaries = 0
    await walk(root, (file) => {
      const lower = file.toLowerCase()
      if (BINARY_SUFFIXES.some((suffix) => lower.endsWith(suffix))) binaries += 1
    })

    const licenses = await licenseFilesIn(root)
    if (licenses.length === 0) {
      problems.push({
        dir: relative(vendor, root),
        reason: `没有任何许可文件（包里${binaries > 0 ? `有 ${binaries} 个二进制资产` : '有第三方代码'}）`,
      })
      continue
    }
    let biggest = 0
    for (const name of licenses) biggest = Math.max(biggest, (await stat(join(root, name))).size)
    if (biggest < MIN_LICENSE_BYTES) {
      problems.push({
        dir: relative(vendor, root),
        reason: `许可文件太小（最大 ${biggest} B < ${MIN_LICENSE_BYTES} B）——空文件不算凭据（${licenses.join(' / ')}）`,
      })
    }
  }
  return problems
}

// ── 真树：这条是每轮都要绿的 ─────────────────────────────────────────────────

test('src/vendor/ 下每个资产包根都有非空许可文件', async () => {
  const roots = await findPackageRoots(VENDOR)
  assert.ok(roots.length >= 8, `包根数不对（${roots.length}）——是不是目录结构变了？`)

  const problems = await findLicenseProblems(VENDOR)
  assert.deepEqual(
    problems,
    [],
    `这些包根缺凭据（新增 vendored 资产必须连许可一起进来）：\n` +
      problems.map((p) => `  · src/vendor/${p.dir} —— ${p.reason}`).join('\n'),
  )
})

test('许可守卫是真的会红的：造一个没凭据的包根，它必须被报出来', async () => {
  const fixture = await mkdtemp(join(tmpdir(), 'vendor-license-guard-'))
  try {
    // ① 有资产、没有任何许可文件 → 必须报
    await mkdir(join(fixture, 'bad-pack'), { recursive: true })
    await writeFile(join(fixture, 'bad-pack', 'sprite.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47]))

    // ② 有资产、许可文件是空的 → 也要报（空文件糊不过去）
    await mkdir(join(fixture, 'empty-license'), { recursive: true })
    await writeFile(join(fixture, 'empty-license', 'sprite.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47]))
    await writeFile(join(fixture, 'empty-license', 'LICENSE'), '')

    // ③ 有资产 + 一份像样的许可 → 不许报（否则守卫会误伤）
    await mkdir(join(fixture, 'good-pack'), { recursive: true })
    await writeFile(join(fixture, 'good-pack', 'sprite.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47]))
    await writeFile(
      join(fixture, 'good-pack', 'LICENSE.txt'),
      'License: CC0 1.0 — this is a long enough license note to count as evidence of provenance.\n',
    )

    const problems = await findLicenseProblems(fixture)
    const dirs = problems.map((p) => p.dir).sort()
    assert.deepEqual(dirs, ['bad-pack', 'empty-license'], `守卫没按预期报出问题：${JSON.stringify(problems)}`)
    assert.match(
      problems.find((p) => p.dir === 'bad-pack').reason,
      /没有.*许可文件/,
      '缺凭据的原因要说清楚',
    )
    assert.match(problems.find((p) => p.dir === 'empty-license').reason, /太小/, '空许可文件要被认出来')
  } finally {
    await rm(fixture, { recursive: true, force: true })
  }
})

test('许可核查的证据文档在（不许被静默删掉）', async () => {
  const doc = fileURLToPath(new URL('../docs/ASSET-LICENSES-EVIDENCE.md', import.meta.url))
  const info = await stat(doc)
  assert.ok(info.size > 1024, `docs/ASSET-LICENSES-EVIDENCE.md 太小（${info.size} B）——逐套证据还写了吗？`)
})
