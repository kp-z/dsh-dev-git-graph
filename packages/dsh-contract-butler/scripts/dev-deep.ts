/**
 * 面板开发服务器：用真插件、真路由、真数据起一个能被浏览器打开的面板。
 *
 * 存在的理由：面板是给人在浏览器里看的东西，"curl 接口通了"并不能说明它画得对。这个脚本
 * 把插件挂在一个假宿主上（存储用内存实现，重启即清空），再用真 HTTP 服务器转发到插件注册
 * 的路由，于是 `src/panel.html` 可以像一个正常网页一样被打开、点、截图。
 *
 *   node scripts/dev-server.ts [端口]
 *
 * 造的数据刻意覆盖三种状态，好让面板的每种渲染都被看到：
 *   - 一条改过形状的契约（未提交 → 归到工作区，破坏性）
 *   - 一次对不上的运行观测（多带了字段 → 不符）
 *   - 一条没动过的契约（什么都不该画）
 */
import http from 'node:http'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { apply } from '../lib/index.js'
import { fakeCtx, type RouteSpec } from '../test/fakeHost.ts'
import { memoryFacility } from '../test/fake.ts'

const PORT = Number(process.argv[2] ?? 4599)
const ROOT = path.resolve(fileURLToPath(new URL('..', import.meta.url)))
const PANEL_HTML = path.join(ROOT, 'src', 'panel.html')

const GIT_ENV = {
  ...process.env,
  GIT_AUTHOR_NAME: '演示',
  GIT_AUTHOR_EMAIL: 'demo@example.test',
  GIT_COMMITTER_NAME: '演示',
  GIT_COMMITTER_EMAIL: 'demo@example.test',
}

/** 造一个带三个边界、且已经提交过的演示项目。 */
function makeProject(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'butler-demo-'))
  /* 深目录 fixture：专门用来量叶子（契约行）的缩进，浅树看不出问题 */
  fs.mkdirSync(path.join(root, 'deep/app/api/v2/types'), { recursive: true })
  fs.writeFileSync(path.join(root, 'deep/app/api/v2/types/deep.ts'), [
    'export type DeepOne = { id: string; n: number }',
    'export type DeepTwo = { a: string[]; b?: boolean }',
    'export type DeepThree = { nested: DeepTwo }',
  ].join('\n'))
  fs.mkdirSync(path.join(root, 'deep/app/api/v2/handlers'), { recursive: true })
  fs.writeFileSync(path.join(root, 'deep/app/api/v2/handlers/h.ts'), [
    'export type HandlerInput = { q: string }',
  ].join('\n'))
  fs.mkdirSync(path.join(root, 'proto'), { recursive: true })
  fs.mkdirSync(path.join(root, 'src'), { recursive: true })
  fs.writeFileSync(
    path.join(root, 'proto', 'order.proto'),
    `syntax = "proto3";
package shop.v1;

message Order {
  string id = 1;
  string user_id = 2;
  int64 amount_cents = 3;
  repeated Item items = 4;
}

message Item {
  string sku = 1;
  int32 qty = 2;
}
`,
  )
  fs.writeFileSync(
    path.join(root, 'proto', 'user.proto'),
    `syntax = "proto3";
package shop.v1;

message User {
  string id = 1;
  string name = 2;
  string email = 3;
}
`,
  )
  fs.writeFileSync(
    path.join(root, 'openapi.yaml'),
    `openapi: 3.0.0
info: { title: 订单服务, version: "1.0" }
paths:
  /orders/{id}:
    get:
      operationId: getOrder
      parameters:
        - name: id
          in: path
          required: true
          schema: { type: string }
      responses:
        "200":
          content:
            application/json:
              schema: { $ref: "#/components/schemas/OrderView" }
components:
  schemas:
    OrderView:
      type: object
      required: [id, amount_cents]
      properties:
        id: { type: string }
        amount_cents: { type: integer }
        note: { type: string, nullable: true }
`,
  )
  execFileSync('git', ['-c', 'init.defaultBranch=main', 'init', '-q'], { cwd: root, env: GIT_ENV })
  execFileSync('git', ['add', '-A'], { cwd: root, env: GIT_ENV })
  execFileSync('git', ['commit', '-q', '-m', '初始化订单与用户契约'], { cwd: root, env: GIT_ENV })
  return root
}

const fake = fakeCtx()
const { facility } = memoryFacility()
apply(fake.ctx as never, { watchEnabled: false, introspectTools: true })
fake.mount('storageDomain', facility)
fake.mount('webServer', {
  register(spec: RouteSpec) {
    fake.routes.push(spec)
    return () => undefined
  },
})
fake.mount('tools', {
  schemas: () => [{ name: 'search_orders', description: '按用户查订单', parameters: { user_id: { type: 'string', required: true }, limit: { type: 'number' } } }],
  get: (name: string) =>
    name === 'search_orders'
      ? {
          name: 'search_orders',
          description: '按用户查订单',
          parameters: { user_id: { type: 'string', required: true }, limit: { type: 'number' } },
          output: {
            schema: {
              type: 'object',
              properties: { orders: { type: 'array', items: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] } } },
              required: ['orders'],
              additionalProperties: false,
            },
          },
        }
      : undefined,
})

/** 让出时间等插件把存储打开。 */
async function settle(ms = 400): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms))
}

async function seed(): Promise<void> {
  await settle()
  const root = makeProject()
  const init = await fake.call('POST', '/dsh-contract-butler/init', { root, confirm: true, title: '订单服务（演示）' })
  const parsed = JSON.parse(init.body)
  if (parsed.result === undefined) throw new Error(`纳管失败：${init.body.slice(0, 300)}`)
  const projectId: string = parsed.result.project.id

  // 1) 改形状但不提交：删字段、加必填字段 —— 应当被判成破坏性的"工作区"变化。
  fs.writeFileSync(
    path.join(root, 'proto', 'user.proto'),
    `syntax = "proto3";
package shop.v1;

message User {
  string id = 1;
  string email = 3;
  string phone = 4;
}
`,
  )
  await fake.call('POST', '/dsh-contract-butler/rescan', { project: projectId })

  // 2) 提交一次，让演化带上"已提交"的样子（界面上会显示短 sha 与提交说明）。
  execFileSync('git', ['add', '-A'], { cwd: root, env: GIT_ENV })
  execFileSync('git', ['commit', '-q', '-m', 'user：去掉 name，加 phone'], { cwd: root, env: GIT_ENV })
  await fake.call('POST', '/dsh-contract-butler/rescan', { project: projectId })

  // 3) 一次对不上的运行观测：返回里多带了契约没声明的字段。
  fake.emit(
    'tools/result',
    { name: 'search_orders', callId: 'demo-1', agent: 'agent', arguments: { user_id: 'u_1', limit: 10 } },
    { value: { orders: [{ id: 'o_1', 内部字段: '不该出现' }] } },
  )
  // 4) 一次对得上的调用，用来证明"不符"是判出来的、不是一律报错。
  fake.emit(
    'tools/result',
    { name: 'search_orders', callId: 'demo-2', agent: 'agent', arguments: { user_id: 'u_1' } },
    { value: { orders: [{ id: 'o_2' }] } },
  )
  await settle(200)

  const summary = JSON.parse((await fake.call('GET', '/dsh-contract-butler/contracts')).body)
  const counts = summary.contracts.map(
    (item: { contract: { boundary: string }; changes: unknown[]; findings: unknown[] }) =>
      `${item.contract.boundary}(变${item.changes.length}/不符${item.findings.length})`,
  )
  console.log(`演示项目：${root}`)
  console.log(`纳管契约：${counts.join('  ')}`)
}

const server = http.createServer((req, res) => {
  const url = req.url ?? '/'
  const pathname = url.split('?')[0] ?? url
  // 面板本体直接从 src/ 读，改完刷新即可，不必重新构建。
  if (pathname === '/dsh-contract-butler/panel') {
    const html = fs.readFileSync(PANEL_HTML)
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' })
    res.end(html)
    return
  }
  if (pathname === '/') {
    res.writeHead(302, { Location: '/dsh-contract-butler/panel' })
    res.end()
    return
  }
  const route = fake.match(pathname)
  if (route === undefined) {
    res.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8' })
    res.end(JSON.stringify({ error: `没有这个接口：${pathname}` }))
    return
  }
  try {
    route.handler(req, res)
  } catch (error) {
    res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' })
    res.end(JSON.stringify({ error: String(error) }))
  }
})

await seed()
server.listen(PORT, '127.0.0.1', () => {
  console.log(`面板：http://127.0.0.1:${PORT}/dsh-contract-butler/panel`)
})
