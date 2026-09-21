/**
 * 面板第三方资源：**白名单路由** + 随包发布的字节。
 *
 * 面板的字段表用 Tabulator，而它必须有两条底线：运行期**不连 CDN**（文件随包发布），
 * 以及 `/vendor/:file` 这条只读路由**只能**放出白名单里那几个名字。所以这个文件压三件事：
 *
 * 1. 路由本身：命中给对字节、对的 MIME、一年 immutable；名字不在白名单 / 带 `/` /
 *    带 `..` / URL 编码穿越 / 坏转义 一律 404；白名单里的文件在磁盘上没了 → 500 且带路径。
 * 2. 名字与文件不脱节：`src/vendor` 里**每一个**文件都必须能通过路由取到（加了文件忘了改
 *    白名单就会在这里红——这是最容易发生、又最难在浏览器里发现的一种漂移）。
 * 3. 发布形态：`src/vendor` 与 `lib/vendor` 逐字节一致（运行时读的是 lib 那一份）。
 *
 * 只用 `webServer` 一个服务：路由是挂在 `ctx.inject(['webServer'])` 里的，与存储无关，
 * 所以不必等存储就绪——这条测试不该为了一个静态文件去开一整套存储。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { apply } from '../lib/index.js'
import { vendorDir, vendorNameOf, vendorPath, vendorType, VENDOR_TYPES } from '../lib/panel.js'
import { fakeCtx, type FakeCtx, type RouteSpec } from './fakeHost.ts'

const ROOT = path.resolve(fileURLToPath(new URL('..', import.meta.url)))
const SRC_VENDOR = path.join(ROOT, 'src', 'vendor')
const LIB_VENDOR = path.join(ROOT, 'lib', 'vendor')
/** 路由前缀（`ROUTE_PREFIX` + `/vendor`）。 */
const PREFIX = '/dsh-contract-butler/vendor'

/** 装一个只挂了 webServer 的插件实例：路由一注册就能用。 */
function mountRoutes(): FakeCtx {
  const fake = fakeCtx()
  apply(fake.ctx as never, { watchEnabled: false, introspectTools: false })
  fake.mount('webServer', {
    register(spec: RouteSpec) {
      fake.routes.push(spec)
      return () => undefined
    },
  })
  return fake
}

/**
 * 直接调路由处理器并按**原始字节**收响应。
 *
 * 为什么不直接用 `fake.call`：那家伙把 chunk 过了一道 `String(...)`，二进制资源一过就变形；
 * 这里要断言的正是"字节一模一样"，所以自己收 Buffer。（状态码/头部两边一致，另有一条
 * 用 `fake.call` 走宿主那套匹配的用例。）
 */
async function callBytes(
  fake: FakeCtx,
  url: string,
  method = 'GET',
): Promise<{ status: number; headers: Record<string, string>; body: Buffer }> {
  const route = fake.match(url)
  assert.ok(route !== undefined, `${url} 应当能匹配到路由（已注册：${fake.routes.map((r) => r.path).join(', ')}）`)
  const chunks: Buffer[] = []
  let status = 0
  let headers: Record<string, string> = {}
  const res = {
    get headersSent() {
      return status !== 0
    },
    writeHead(code: number, head: Record<string, string>) {
      status = code
      headers = { ...head }
    },
    write(chunk: unknown) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk), 'utf8'))
      return true
    },
    end(chunk?: unknown) {
      if (chunk !== undefined) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk), 'utf8'))
      ended = true
    },
    on() {
      /* SSE 用；这里有响必回，不参与断言。 */
    },
  }
  let ended = false
  const req = { method, url, on() {} }
  // 处理器是同步的（异步读盘写在 `.then` 里），所以还得等它把响应写完——和 fake.call 一样
  // 用"轮询到 ended"，不靠猜一个固定超时。
  const returned = route?.handler(req as never, res as never) as unknown
  if (returned !== null && typeof returned === 'object' && typeof (returned as PromiseLike<void>).then === 'function') {
    await (returned as PromiseLike<void>)
  }
  for (let index = 0; index < 200 && !ended; index += 1) await new Promise((resolve) => setTimeout(resolve, 5))
  assert.ok(ended, `${url} 的响应没有结束`)
  return { status, headers, body: Buffer.concat(chunks) }
}

/* ---------- 1) 命中：字节、MIME、缓存 ---------- */

test('vendor 路由：白名单里的文件按原始字节吐出来，MIME 与缓存头都对', async () => {
  const fake = mountRoutes()
  for (const [name, type] of [
    ['tabulator.min.js', 'text/javascript; charset=utf-8'],
    ['tabulator.min.css', 'text/css; charset=utf-8'],
    ['LICENSE.tabulator', 'text/plain; charset=utf-8'],
    ['README.md', 'text/markdown; charset=utf-8'],
  ] as const) {
    const res = await callBytes(fake, `${PREFIX}/${name}`)
    assert.equal(res.status, 200, `${name} 应当能取到`)
    assert.equal(res.headers['Content-Type'], type, `${name} 的 MIME`)
    assert.equal(res.headers['Cache-Control'], 'public, max-age=31536000, immutable',
      `${name} 是带版本查询串的静态资源，给一年 immutable`)
    assert.deepEqual(res.body, fs.readFileSync(path.join(SRC_VENDOR, name)),
      `${name} 的字节必须与 src/vendor 里的完全一致`)
  }
})

test('vendor 路由：走宿主的匹配规则（前缀路由）也能命中，查询串不参与路径', async () => {
  const fake = mountRoutes()
  // 面板里的引用带着 `?v=` 缓存钥匙，命中与不命中都得分得清。
  const hit = await fake.call('GET', `${PREFIX}/tabulator.min.js?v=6.5.3`)
  assert.equal(hit.status, 200, '带查询串也要能命中')
  assert.equal(hit.headers['Content-Type'], 'text/javascript; charset=utf-8')
  assert.ok(hit.body.startsWith('/* Tabulator v'), '吐出来的应当是组件本体')
  assert.deepEqual(Buffer.from(hit.body, 'utf8'), fs.readFileSync(path.join(SRC_VENDOR, 'tabulator.min.js')),
    '宿主那套匹配下也不能少字节')
})

/* ---------- 2) 未命中与穿越：一律 404 ---------- */

test('vendor 路由：未知名字、越界、坏转义、非 GET 全都不放行', async () => {
  const fake = mountRoutes()
  const cases: [string, string][] = [
    [`${PREFIX}/ghost.js`, '不在白名单里的名字'],
    [`${PREFIX}/panel.html`, '相邻的真文件也不许顺带取出来'],
    [`${PREFIX}/`, '空名字'],
    [`${PREFIX}`, '只有目录'],
    [`${PREFIX}/tabulator.min.js/extra`, '多一层路径'],
    [`${PREFIX}/tabulator.min.js%00.css`, '空字节'],
    [`${PREFIX}/..%2fpackage.json`, '编码过的分隔符'],
    [`${PREFIX}/%2e%2e%2fpackage.json`, '编码过的上跳'],
    [`${PREFIX}/%2e%2e/package.json`, '编码过的 .. 段'],
    [`${PREFIX}/..%5cpackage.json`, '编码过的反斜杠'],
    [`${PREFIX}/%zz.js`, '坏掉的百分号转义'],
  ]
  for (const [url, why] of cases) {
    const res = await callBytes(fake, url)
    assert.equal(res.status, 404, `${why}：${url} 应当是 404`)
    // 404 只说"没有这个资源"，不回显磁盘路径——探测者拿不到任何关于目录结构的信息。
    assert.ok(!res.body.toString('utf8').includes(vendorDir()), `404 的响应里不该回显真实路径（${url}）`)
  }
  // 真·路径穿越（没编码）会被 URL 规范化掉：不再是 /vendor/ 下的请求，宿主那头就 404 了。
  const plain = await callBytes(fake, `${PREFIX}/../package.json`)
  assert.equal(plain.status, 404, '字面量的 .. 也不能出去')

  // 只读：别的动词不接受（不是 404，而是明确告诉它这里只认 GET）。
  const post = await callBytes(fake, `${PREFIX}/tabulator.min.js`, 'POST')
  assert.equal(post.status, 405, 'POST 应当 405')
})

/* ---------- 3) 白名单与磁盘脱节 ---------- */

test('vendor 路由：src/vendor 里的每个文件都在白名单里且取得到（加了文件就得改白名单）', async () => {
  const fake = mountRoutes()
  const names = fs.readdirSync(SRC_VENDOR)
  assert.ok(names.length > 0, 'src/vendor 里应当有文件')
  for (const name of names) {
    assert.ok(vendorType(name) !== null, `${name} 必须写进 VENDOR_TYPES 白名单，否则面板永远拿不到它`)
    const res = await callBytes(fake, `${PREFIX}/${name}`)
    assert.equal(res.status, 200, `${name} 应当能通过路由取到`)
  }
  // 反向：白名单里不许出现磁盘上没有的名字（会出现"面板 500"这种运行期故障）。
  for (const name of Object.keys(VENDOR_TYPES)) {
    assert.ok(fs.existsSync(path.join(SRC_VENDOR, name)), `白名单里的 ${name} 在 src/vendor 里必须真的存在`)
  }
})

test('vendor 路由：白名单里的文件在磁盘上没了 → 500，且给出可读路径', async () => {
  const fake = mountRoutes()
  // 临时把 lib/vendor 里的一个文件改名（模拟"装漏了/被删了"），验完立刻恢复。
  const victim = path.join(LIB_VENDOR, 'README.md')
  const hidden = `${victim}.hidden-by-test`
  assert.ok(fs.existsSync(victim), `要先有 ${victim}——请先跑 npm test / npm run build:assets`)
  fs.renameSync(victim, hidden)
  try {
    const res = await callBytes(fake, `${PREFIX}/README.md`)
    assert.equal(res.status, 500, '文件不在磁盘上应当 500，而不是 404（名字是合法的）')
    const text = res.body.toString('utf8')
    assert.ok(text.includes('资源读不出来'), '要给一句人看得懂的话')
    assert.ok(text.includes(victim), '要带上可读的磁盘路径，便于直接去找')
  } finally {
    fs.renameSync(hidden, victim)
  }
})

/* ---------- 4) 纯函数：取名字这一步是越界的唯一入口 ---------- */

test('vendor 路由：取名字只认"前缀 + 单段文件名"', async () => {
  assert.equal(vendorNameOf(`${PREFIX}/tabulator.min.js`), 'tabulator.min.js')
  assert.equal(vendorNameOf(`${PREFIX}/tabulator.min.js/`), null, '尾部多一段就不认')
  assert.equal(vendorNameOf(`${PREFIX}/a/b`), null)
  assert.equal(vendorNameOf(`${PREFIX}/%2e%2e`), null)
  assert.equal(vendorNameOf(`${PREFIX}/`), null)
  assert.equal(vendorNameOf(`${PREFIX}`), null)
  assert.equal(vendorNameOf('/elsewhere/tabulator.min.js'), null, '前缀不对就不认')
  assert.equal(vendorNameOf(`${PREFIX}/%zz`), null, '坏转义不认')
  // 磁盘路径只从白名单拼：名字不在名单里就没有路径，也不存在"拼出去"的可能。
  assert.equal(vendorPath('ghost.js'), null)
  assert.equal(vendorPath('..%2fpackage.json'), null)
  assert.equal(vendorPath('../package.json'), null)
  assert.ok((vendorPath('tabulator.min.js') ?? '').startsWith(vendorDir()), '命中时必须在 vendor 目录里')
})

/* ---------- 5) 发布形态：src/vendor 与 lib/vendor 逐字节一致 ---------- */

test('发布形态：src/vendor 与 lib/vendor 逐字节一致', () => {
  assert.ok(fs.existsSync(LIB_VENDOR),
    'lib/vendor 应当存在——请先跑 npm test / npm run build:assets（构建会把 src/vendor 同步过去）')
  const src = fs.readdirSync(SRC_VENDOR).sort()
  const lib = fs.readdirSync(LIB_VENDOR).sort()
  assert.deepEqual(lib, src, '两边的文件清单必须一模一样（多一个少一个都是装出来的包有问题）')
  for (const name of src) {
    assert.deepEqual(fs.readFileSync(path.join(LIB_VENDOR, name)), fs.readFileSync(path.join(SRC_VENDOR, name)),
      `${name} 必须逐字节一致`)
  }
})

test('发布形态：Tabulator 的版本与许可在库里可查（MIT）', () => {
  const readme = fs.readFileSync(path.join(SRC_VENDOR, 'README.md'), 'utf8')
  // 版本、来源、哈希、许可四件套都写下来，升级时才有得对。
  assert.ok(/Tabulator 6\.\d+\.\d+/.test(readme), '要写明版本')
  assert.ok(readme.includes('https://unpkg.com/tabulator-tables@'), '要写明来源 URL')
  assert.ok((readme.match(/[0-9a-f]{64}/g) ?? []).length >= 3, '三个文件都要有 sha256')
  assert.ok(readme.includes('MIT'), '要写明许可')
  // JS 首行的 banner 也要对得上（文件换过版本而 README 没改，会在这里露馅）。
  const banner = fs.readFileSync(path.join(SRC_VENDOR, 'tabulator.min.js'), 'utf8').slice(0, 80)
  const version = /Tabulator v(\d+\.\d+\.\d+)/.exec(banner)?.[1]
  assert.ok(version !== undefined, `组件的 banner 应当写着版本：${banner}`)
  assert.ok(readme.includes(`Tabulator ${version}`), `README 里的版本（${version}）要与文件一致`)
  const license = fs.readFileSync(path.join(SRC_VENDOR, 'LICENSE.tabulator'), 'utf8')
  assert.ok(license.includes('MIT License'), '上游许可证原文要在库里')
})