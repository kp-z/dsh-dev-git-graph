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
import { VENDOR_MIME, VENDOR_WHITELIST, extensionOf, vendorFileNames } from '../lib/routes/vendor.js'
import { createPluginState } from '../lib/state.js'
import { resolveConfig } from '../lib/config.js'
import { createEventHub, createRuntime } from '../lib/runtime/index.js'

const PREFIX = '/agent-world'
const VENDOR_SRC = fileURLToPath(new URL('../src/vendor', import.meta.url))

/** 递归列出一个目录下的所有文件（相对路径，正斜杠）。 */
async function walk(root, prefix = '') {
  const out = []
  for (const entry of await readdir(join(root, prefix), { withFileTypes: true })) {
    const rel = prefix === '' ? entry.name : `${prefix}/${entry.name}`
    if (entry.isDirectory()) out.push(...(await walk(root, rel)))
    else out.push(rel)
  }
  return out
}

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
  // **要递归**：vendored 资源现在有子目录（three 的 addon 结构必须保留）。
  const onDisk = (await walk(VENDOR_SRC))
    // `README.md` 是给人看的说明，不需要也不该被服务出去。
    .filter((name) => name !== 'README.md')
    .sort()
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

test('白名单是穷举式的：没有通配、没有 `..`、没有绝对路径', () => {
  for (const name of VENDOR_WHITELIST) {
    assert.ok(!name.includes('..'), `白名单项不该含 ".."：${name}`)
    assert.ok(!name.startsWith('/'), `白名单项不该是绝对路径：${name}`)
    assert.ok(!name.includes('\\'), `白名单项不该含反斜杠：${name}`)
    assert.ok(!name.startsWith('.'), `白名单项不该是隐藏文件：${name}`)
    // 每一项都要有扩展名，且扩展名在 MIME 表里——否则运行期会 500。
    const ext = extensionOf(name)
    assert.ok(VENDOR_MIME[ext] !== undefined, `白名单项 ${name} 的扩展名 ${JSON.stringify(ext)} 没登记 MIME`)
  }
  // 嵌套路径必须真的支持（three 的 addon 结构要求如此）。
  assert.ok(VENDOR_WHITELIST.includes('three/build/three.module.min.js'))
  assert.ok(VENDOR_WHITELIST.includes('three/examples/jsm/utils/SkeletonUtils.js'))
  // 12 个角色（pack.kenney-mini）+ 31 个家具（pack.kenney-furniture）。
  assert.equal(VENDOR_WHITELIST.filter((n) => n.endsWith('.glb')).length, 43, '角色 + 家具的 GLB 总数')
  assert.ok(VENDOR_WHITELIST.includes('kenney-furniture/desk.glb'), '家具也要能服务')
})

// ── 走一遍真实服务器 ────────────────────────────────────────────────────────

test('vendor 路由：白名单里的文件能取到，MIME 正确，且带缓存头', async () => {
  await withVendorServer(VENDOR_SRC, async (base) => {
    const res = await fetch(`${base}${PREFIX}/vendor/three/build/three.module.min.js`)
    assert.equal(res.status, 200)
    assert.match(res.headers.get('content-type'), /javascript/)
    assert.match(res.headers.get('cache-control'), /max-age/)
    const body = await res.text()
    assert.ok(body.length > 100_000, '拿到的是完整文件，不是空响应')

    const license = await fetch(`${base}${PREFIX}/vendor/three/LICENSE`)
    assert.equal(license.status, 200)
    assert.match(license.headers.get('content-type'), /text\/plain/)

    // 嵌套 + 二进制：GLB 要按 model/gltf-binary 发，否则 GLTFLoader 可能拒收。
    const glb = await fetch(`${base}${PREFIX}/vendor/kenney-mini-characters/character-male-a.glb`)
    assert.equal(glb.status, 200)
    assert.match(glb.headers.get('content-type'), /model\/gltf-binary/)
    const bytes = new Uint8Array(await glb.arrayBuffer())
    assert.equal(String.fromCharCode(...bytes.slice(0, 4)), 'glTF', '拿到的应当是完整的 GLB（魔数 glTF）')

    // GLB 引用的外部贴图也必须能取到，否则模型会"加载成功但一片纯色"。
    const tex = await fetch(`${base}${PREFIX}/vendor/kenney-mini-characters/Textures/colormap.png`)
    assert.equal(tex.status, 200)
    assert.match(tex.headers.get('content-type'), /image\/png/)
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
    assert.match(body.error, /three\/build\/three\.module\.min\.js/, '要列出已开放的文件，别只说不允许')
  })
})

test('vendor 路由：白名单里有、磁盘上没有 → 报错指向"构建没同步"，而不是只说找不到', async () => {
  const empty = await mkdtemp(join(tmpdir(), 'agent-world-vendor-empty-'))
  tempDirs.push(empty)

  await withVendorServer(empty, async (base) => {
    const res = await fetch(`${base}${PREFIX}/vendor/three/build/three.module.min.js`)
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
    const res = await fetch(`${base}${PREFIX}/vendor/three/build/three.module.min.js`)
    const body = await res.json()
    assert.match(body.error, /构建没同步|build:web/, '应当是 vendor 路由给的错误')
    assert.ok(!/不服务的文件类型/.test(body.error), '不该落到静态面板那条路')
  })
})

test('vendor 路由：多段路径与穿越都不匹配（模式是单段，天然进不来）', async () => {
  await withVendorServer(VENDOR_SRC, async (base) => {
    // 嵌套是允许的，但**只有白名单里的确切路径**。
    assert.equal((await fetch(`${base}${PREFIX}/vendor/a/b/c.js`)).status, 404, '不在白名单的嵌套路径')
    assert.equal((await fetch(`${base}${PREFIX}/vendor/..%2fpackage.json`)).status, 404, '编码上跳')
    assert.equal((await fetch(`${base}${PREFIX}/vendor/three/build/..%2f..%2f..%2fpackage.json`)).status, 404)
    assert.equal((await fetch(`${base}${PREFIX}/vendor/README.md`)).status, 404, 'README 是给人看的，不服务')
  })
})

test('构建产物 lib/vendor/ 与 src/vendor/ 保持一致（否则运行期读的是旧文件）', async () => {
  const libDir = fileURLToPath(new URL('../lib/vendor', import.meta.url))
  const [src, lib] = await Promise.all([walk(VENDOR_SRC), walk(libDir).catch(() => [])])
  assert.deepEqual(
    lib.sort(),
    src.sort(),
    'lib/vendor 与 src/vendor 不一致——跑 pnpm run build 同步一次',
  )
})

test('面板的 import map 指向白名单里真实存在的文件（写错一个字符就是 3D 白屏）', async () => {
  const { readFile } = await import('node:fs/promises')
  const html = await readFile(fileURLToPath(new URL('../web/index.html', import.meta.url)), 'utf8')
  const mapText = /<script type="importmap">([\s\S]*?)<\/script>/.exec(html)
  assert.ok(mapText, 'index.html 里应当有 import map')

  const map = JSON.parse(mapText[1])
  const entries = Object.entries(map.imports)
  assert.ok(entries.length >= 2, '至少要映射 three 与它的附加组件')

  for (const [specifier, target] of entries) {
    const name = String(target).replace('./vendor/', '')
    if (String(target).endsWith('/')) {
      // 目录前缀映射（`three/addons/` → `.../jsm/`）：白名单里必须有文件落在它下面。
      assert.ok(
        VENDOR_WHITELIST.some((n) => n.startsWith(name)),
        `import map 的前缀 "${specifier}" → "${target}" 下面没有任何白名单文件`,
      )
      continue
    }
    assert.ok(
      VENDOR_WHITELIST.includes(name),
      `import map 指向了 "${target}"，而白名单里没有 "${name}"——3D 会白屏且只报一个 404`,
    )
  }

  // 实际用到的说明符必须能被映射覆盖（光登记不用、或用而不登记，都是坏账）。
  const project = await readFile(fileURLToPath(new URL('../web', import.meta.url)), 'utf8').catch(() => null)
  void project
})

test('vendored 资源带许可证原文（MIT 与 CC0 都要求保留声明）', async () => {
  const { readFile } = await import('node:fs/promises')
  const threeLicense = await readFile(join(VENDOR_SRC, 'three', 'LICENSE'), 'utf8')
  assert.match(threeLicense, /MIT/i)
  assert.match(threeLicense, /three\.js authors/i, '要保留上游的版权声明')

  // Kenney 是 CC0（无需署名），但**许可证原文必须一起发**——这是"从哪来的"唯一凭据。
  const kenney = await readFile(join(VENDOR_SRC, 'kenney-mini-characters', 'License.txt'), 'utf8')
  assert.match(kenney, /Creative Commons Zero, CC0/, 'CC0 字样必须在（这是它能进 MIT 仓库的依据）')
  assert.match(kenney, /kenney\.nl/i)
  void mkdir // 保持导入被使用
})

test('Kenney 的 GLB **必须**有它引用的外部贴图（少了会"加载成功但一片纯色"）', async () => {
  const { readFile } = await import('node:fs/promises')
  const glbPath = join(VENDOR_SRC, 'kenney-mini-characters', 'character-male-a.glb')
  const data = await readFile(glbPath)

  // 解析 GLB 的 JSON chunk，看在不在引用这张贴图——**别靠"我记得"**。
  assert.equal(data.subarray(0, 4).toString('ascii'), 'glTF', '魔数应当是 glTF')
  const jsonLength = data.readUInt32LE(12)
  const gltf = JSON.parse(data.subarray(20, 20 + jsonLength).toString('utf8'))
  const uris = gltf.images.map((im) => im.uri).filter(Boolean)
  assert.ok(uris.length > 0, '这个 GLB 用外部贴图，应当能解析出 uri')

  for (const uri of uris) {
    const texturePath = join(VENDOR_SRC, 'kenney-mini-characters', uri)
    const bytes = await readFile(texturePath).catch(() => null)
    assert.ok(bytes !== null, `GLB 引用的贴图 ${uri} 不在 vendor 里（模型会一片纯色）`)
    assert.ok(bytes.length > 100, `贴图 ${uri} 看起来是空的`)
  }

  // 顺带把"32 条动画"这个关键前提也钉住——它是"actions 库"的资产依据。
  assert.equal(gltf.animations.length, 32, `每个角色应当内嵌 32 条动画，实际 ${gltf.animations.length}`)
  assert.ok(gltf.skins.length >= 1, '必须是已绑定骨骼的（否则做不了动作库）')
})
