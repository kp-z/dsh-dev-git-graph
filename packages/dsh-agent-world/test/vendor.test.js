/**
 * vendored 第三方资源的白名单测试（BACKLOG M4-8）。
 *
 * ## 这条测试要挡的是什么
 *
 * `src/vendor/` 里放一个文件、但忘了开路由 —— 表现是**运行期 404**，
 * 而那时你已经在看别的错误了（"3D 起不来"看起来像场景代码写错了）。
 * 所以这里逐个核对目录内容与白名单，两个方向都查：
 *
 * - 目录里有、白名单里没有 → 那个文件服务不出去；
 * - 白名单里有、目录里没有 → 运行期必然 404（构建没同步）。
 */
import assert from 'node:assert/strict'
import { readdir, mkdtemp, rm, mkdir, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { after, test } from 'node:test'

import { createHandler } from '../lib/routes/index.js'
import { VENDOR_WHITELIST, vendorFileNames } from '../lib/routes/vendor.js'
import { createPluginState } from '../lib/state.js'
import { resolveConfig } from '../lib/config.js'
import { createEventHub, createRuntime } from '../lib/runtime/index.js'

const PREFIX = '/agent-world'
const VENDOR_SRC = fileURLToPath(new URL('../src/vendor', import.meta.url))

const tempDirs = []
after(async () => {
  for (const dir of tempDirs) await rm(dir, { recursive: true, force: true })
})

/** 造一个只挂了 vendor 路由的服务器。 */
async function withVendorServer(rootDir, fn) {
  const service = createPluginState(resolveConfig({ autoStart: false, persistEveryTicks: 0 }))
  service.ensureWorld()
  const hub = createEventHub()
  const handler = createHandler(PREFIX, {
    service,
    runtime: createRuntime({ service, tickMs: 100, sink: hub }),
    source: hub,
    tickMs: 100,
    vendorRoot: rootDir,
    webRoot: rootDir, // 面板通配也指到这里，用来验证"白名单优先于通配"
  })
  const server = createServer(handler)
  await new Promise((r) => server.listen(0, '127.0.0.1', r))
  const { port } = server.address()
  try {
    return await fn(`http://127.0.0.1:${port}`)
  } finally {
    await new Promise((r) => server.close(r))
  }
}

// ── 目录与白名单必须对得上 ──────────────────────────────────────────────────

test('白名单与 src/vendor/ 的目录内容一一对应（漏一个都会在运行期变成 404）', async () => {
  const entries = await readdir(VENDOR_SRC)
  // `README.md` 是给人看的说明，不需要也不该被服务出去。
  const onDisk = entries.filter((name) => name !== 'README.md').sort()
  const listed = vendorFileNames()

  const notServed = onDisk.filter((name) => !listed.includes(name))
  assert.deepEqual(
    notServed,
    [],
    `src/vendor/ 里的这些文件没有开路由，运行期会 404：${notServed.join(' / ')}。` +
      `请加进 src/routes/vendor.ts 的 VENDOR_WHITELIST。`,
  )

  const missing = listed.filter((name) => !onDisk.includes(name))
  assert.deepEqual(
    missing,
    [],
    `白名单里的这些文件在 src/vendor/ 里不存在，运行期必然 404：${missing.join(' / ')}`,
  )
})

test('白名单是穷举式的：没有通配、没有目录穿越的余地', () => {
  for (const name of Object.keys(VENDOR_WHITELIST)) {
    assert.ok(!name.includes('/'), `白名单项不该含路径分隔符：${name}`)
    assert.ok(!name.includes('..'), `白名单项不该含 ".."：${name}`)
    assert.ok(!name.startsWith('.'), `白名单项不该是隐藏文件：${name}`)
  }
  // 每个文件名都该带扩展名与库前缀（约定见 src/vendor/README.md）。
  assert.ok(VENDOR_WHITELIST['three.module.min.js'] !== undefined)
  assert.ok(VENDOR_WHITELIST['LICENSE.three'] !== undefined)
})

// ── 走一遍真实服务器 ────────────────────────────────────────────────────────

test('vendor 路由：白名单里的文件能取到，MIME 正确，且带缓存头', async () => {
  await withVendorServer(VENDOR_SRC, async (base) => {
    const res = await fetch(`${base}${PREFIX}/vendor/three.module.min.js`)
    assert.equal(res.status, 200)
    assert.match(res.headers.get('content-type'), /javascript/)
    assert.match(res.headers.get('cache-control'), /max-age/)
    const body = await res.text()
    assert.ok(body.length > 100_000, '拿到的是完整文件，不是空响应')

    const license = await fetch(`${base}${PREFIX}/vendor/LICENSE.three`)
    assert.equal(license.status, 200)
    assert.match(license.headers.get('content-type'), /text\/plain/)
  })
})

test('vendor 路由：不在白名单的文件一律 404，且**说明已开放哪些**', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'agent-world-vendor-'))
  tempDirs.push(dir)
  // 目录里真放一个"看起来该能服务"的文件：不做白名单的话它会被服务出去。
  await writeFile(join(dir, 'secret.js'), 'alert(1)', 'utf8')

  await withVendorServer(dir, async (base) => {
    const res = await fetch(`${base}${PREFIX}/vendor/secret.js`)
    assert.equal(res.status, 404, '不在白名单的文件不能因为扩展名是 .js 就被服务')
    const body = await res.json()
    assert.match(body.error, /不在白名单/)
    assert.match(body.error, /three\.module\.min\.js/, '要列出已开放的文件，别只说不允许')
  })
})

test('vendor 路由：白名单里有、磁盘上没有 → 报错指向"构建没同步"，而不是只说找不到', async () => {
  const empty = await mkdtemp(join(tmpdir(), 'agent-world-vendor-empty-'))
  tempDirs.push(empty)

  await withVendorServer(empty, async (base) => {
    const res = await fetch(`${base}${PREFIX}/vendor/three.module.min.js`)
    assert.equal(res.status, 404)
    const body = await res.json()
    assert.match(body.error, /构建没同步|build:web/, '要说清该去哪找原因')
  })
})

test('vendor 路由优先于静态面板的通配（否则第三方资源会被通配接走）', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'agent-world-vendor-order-'))
  tempDirs.push(dir)
  // 面板通配也指向同一个目录：如果顺序反了，请求会落到面板那条路上，
  // 得到的 404 文案会是"不在白名单"之外的东西。
  await withVendorServer(dir, async (base) => {
    const res = await fetch(`${base}${PREFIX}/vendor/three.module.min.js`)
    const body = await res.json()
    assert.match(body.error, /构建没同步|build:web/, '应当是 vendor 路由给的错误')
    assert.ok(!/不服务的文件类型/.test(body.error), '不该落到静态面板那条路')
  })
})

test('vendor 路由：多段路径与穿越都不匹配（模式是单段，天然进不来）', async () => {
  await withVendorServer(VENDOR_SRC, async (base) => {
    assert.equal((await fetch(`${base}${PREFIX}/vendor/a/b.js`)).status, 404)
    assert.equal((await fetch(`${base}${PREFIX}/vendor/..%2fpackage.json`)).status, 404)
  })
})

test('构建产物 lib/vendor/ 与 src/vendor/ 保持一致（否则运行期读的是旧文件）', async () => {
  const libDir = fileURLToPath(new URL('../lib/vendor', import.meta.url))
  const [src, lib] = await Promise.all([readdir(VENDOR_SRC), readdir(libDir).catch(() => [])])
  assert.deepEqual(
    lib.sort(),
    src.sort(),
    'lib/vendor 与 src/vendor 不一致——跑 pnpm run build:web 同步一次',
  )
})

test('面板的 import map 指向白名单里真实存在的文件（写错一个字符就是 3D 白屏）', async () => {
  const { readFile } = await import('node:fs/promises')
  const html = await readFile(fileURLToPath(new URL('../web/index.html', import.meta.url)), 'utf8')
  const mapText = /<script type="importmap">([\s\S]*?)<\/script>/.exec(html)
  assert.ok(mapText, 'index.html 里应当有 import map')

  const map = JSON.parse(mapText[1])
  const targets = Object.values(map.imports)
  assert.ok(targets.length >= 2, '至少要映射 three 与它的附加组件')

  for (const target of targets) {
    const name = String(target).replace('./vendor/', '')
    assert.ok(
      VENDOR_WHITELIST[name] !== undefined,
      `import map 指向了 "${target}"，而白名单里没有 "${name}"——3D 会白屏且只报一个 404`,
    )
  }
})

test('vendored 资源带许可证原文（MIT 要求保留版权声明）', async () => {
  const { readFile } = await import('node:fs/promises')
  const license = await readFile(join(VENDOR_SRC, 'LICENSE.three'), 'utf8')
  assert.match(license, /MIT/i)
  assert.match(license, /three\.js authors/i, '要保留上游的版权声明')
  void mkdir // 保持导入被使用
})
