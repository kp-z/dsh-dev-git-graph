/**
 * 交互重构：**一个入口 + 一条链**。
 *
 * 用户的原话是"重新扫描 / 重新生成 / AI 理解完全是重复的，要放在左侧侧边栏里合并成一个，
 * 点开弹窗选这次要重新生成什么"，以及"AI 理解不是单独的一步，要和整个生成结合在一起"。
 * 面板那侧的改动（按钮合并、弹窗、三段加载）是 HTML/JS，能在这里断言的是它的**接线**；
 * 真正会被"点坏"的是宿主那一侧新增的那条只读预告路由，所以这个文件主要压它。
 *
 * 这个文件最要紧的一条：**预告不许是假话**。`/generate/plan` 说"会问 2 批"，跑一遍
 * `/understand` 就必须真的是 2 批；它说"31 条要问"，那 31 条就必须是缓存判定里真正会
 * 落到 pending 的那一批。两边一旦分叉，用户就是照着一句假话点的确认——这正是最不能错的地方。
 *
 * 刻意不用网络、不用密钥、不用配置文件：假模型就是宿主 `llm` 服务的一个替身
 * （`ctx.get('llm')` 是插件唯一认的那条路）。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { apply } from '../lib/index.js'
import { seedFieldNames } from '../lib/understand.js'
import { fakeCtx, type RouteSpec } from './fakeHost.ts'
import { memoryFacility } from './fake.ts'

type Fake = ReturnType<typeof fakeCtx>

/* ---------- 临时项目 ---------- */

const PROTO_V1 = `syntax = "proto3";
package shop.v1;

message User {
  string id = 1;
  string name = 2;
}

message Order {
  string id = 1;
  string user_id = 2;
  int64 amount_cents = 3;
}
`

const OPENAPI = `openapi: 3.0.0
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
      required: [id]
      properties:
        id: { type: string }
`

function makeProject(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'butler-generate-'))
  fs.mkdirSync(path.join(root, 'proto'), { recursive: true })
  fs.mkdirSync(path.join(root, 'api'), { recursive: true })
  fs.writeFileSync(path.join(root, 'proto', 'shop.proto'), PROTO_V1)
  fs.writeFileSync(path.join(root, 'api', 'orders.yaml'), OPENAPI)
  const env = {
    ...process.env,
    GIT_AUTHOR_NAME: 'T',
    GIT_AUTHOR_EMAIL: 't@example.test',
    GIT_COMMITTER_NAME: 'T',
    GIT_COMMITTER_EMAIL: 't@example.test',
  }
  execFileSync('git', ['-c', 'init.defaultBranch=main', 'init', '-q'], { cwd: root, env })
  execFileSync('git', ['add', '-A'], { cwd: root, env })
  execFileSync('git', ['commit', '-q', '-m', '初始化'], { cwd: root, env })
  return root
}

/* ---------- 假宿主：llm 服务 ---------- */

interface Chunk {
  type: string
  text?: string
  reason?: { kind: string }
}

/** 只会说"这一批每条都合格"的假模型：从 user 段里把 id 抠出来，照原样写回中文。 */
function fakeLlm(delayMs = 0): {
  service: Record<string, unknown>
  calls: () => number
  batchesSeen: () => number[]
} {
  let calls = 0
  const batchesSeen: number[] = []
  const service = {
    listProviders: () => [{ id: 'skynet', name: 'Skynet 网关' }],
    listModels: async (provider: string) => [{ provider, id: 'fake-model', name: 'fake-model' }],
    async *stream(options: Record<string, unknown>): AsyncIterable<Chunk> {
      calls += 1
      if (delayMs > 0) await new Promise((resolve) => setTimeout(resolve, delayMs))
      const contracts = contractsOf(options)
      batchesSeen.push(contracts.length)
      yield { type: 'text-delta', text: JSON.stringify({ items: itemsFor(contracts) }) }
      yield { type: 'finish', reason: { kind: 'stop' } }
    },
  }
  return { service, calls: () => calls, batchesSeen: () => batchesSeen }
}

/** 与 aiWorkflow 的提示词形状一致：user 段就是那批契约的 JSON（每条都带 fields）。 */
function contractsOf(options: Record<string, unknown>): { id: string; fields: string[] }[] {
  const messages = Array.isArray(options['messages']) ? (options['messages'] as Record<string, unknown>[]) : []
  const parts: string[] = []
  for (const message of messages) {
    const content = Array.isArray(message['content']) ? (message['content'] as Record<string, unknown>[]) : []
    for (const block of content) if (block['type'] === 'text' && typeof block['text'] === 'string') parts.push(block['text'])
  }
  const user = parts.join('\n')
  try {
    const marker = user.indexOf('"contracts"')
    const brace = marker < 0 ? -1 : user.lastIndexOf('{', marker)
    const payload = JSON.parse(user.slice(brace)) as {
      contracts: { id: string; name?: string; file?: string; fields?: string[] }[]
    }
    /* 字段名用生产代码那一个抽取器解析（`seedFieldNames`）：假模型照"合同"回一份合格的答案，
       这样假模型和真的校验口径不会各说各话。 */
    return payload.contracts.map((item) => ({
      id: item.id,
      fields: seedFieldNames({
        id: item.id,
        name: item.name ?? '',
        file: item.file ?? '',
        fields: Array.isArray(item.fields) ? item.fields : [],
      }),
    }))
  } catch {
    return []
  }
}

function itemsFor(contracts: { id: string; fields: string[] }[]): Record<string, unknown>[] {
  /* 字段级中文是硬要求：种子里的字段一个都不能少（少一个整批拒绝）。假模型如实照办。 */
  return contracts.map((c) => ({
    id: c.id,
    titleZh: `负责 ${c.id} 的那件事`,
    family: '测试族',
    relations: [],
    fields: c.fields.map((name) => ({ name, zh: `字段 ${name}：这条契约里的一个值` })),
  }))
}

/* ---------- 装一个能用的插件 ---------- */

async function mountPlugin(options: { llm?: boolean } = {}): Promise<{
  fake: Fake
  root: string
  projectId: string
  llm: ReturnType<typeof fakeLlm>
}> {
  const root = makeProject()
  const fake = fakeCtx()
  const { facility } = memoryFacility()
  apply(fake.ctx as never, { watchEnabled: false, introspectTools: false })
  fake.mount('storageDomain', facility)
  fake.mount('webServer', {
    register(spec: RouteSpec) {
      fake.routes.push(spec)
      return () => undefined
    },
  })
  const llm = fakeLlm()
  /* `llm: false` 模拟独立 dev-server：宿主没有 llm 服务，AI 那一段必须是明确的 503 + 可读原因。 */
  if (options.llm !== false) {
    fake.mount('llm', llm.service)
    fake.mount('agentDefaultModel', { currentSelection: () => ({ provider: 'skynet', model: 'fake-model' }) })
  }
  for (let index = 0; index < 400; index += 1) {
    await new Promise((resolve) => setTimeout(resolve, 5))
    if (fake.logs.some((line) => line.includes('存储就绪'))) break
  }
  assert.ok(fake.logs.some((line) => line.includes('存储就绪')), `存储没就绪，日志：${fake.logs.join(' | ')}`)
  const init = JSON.parse((await fake.call('POST', '/dsh-contract-butler/init', { root, confirm: true })).body)
  return { fake, root, projectId: String(init.result.project.id), llm }
}

const plan = async (fake: Fake, body: Record<string, unknown>): Promise<{ status: number; data: Record<string, any> }> => {
  const res = await fake.call('POST', '/dsh-contract-butler/generate/plan', body)
  return { status: res.status, data: JSON.parse(res.body) as Record<string, any> }
}

/* ============================================================
   1) 预告路由：数字是真的，而且没有任何副作用
   ============================================================ */

test('生成预告：路由挂上了，且是**只读**的（跑完什么都没变）', async () => {
  const { fake, projectId } = await mountPlugin()
  const paths = fake.routes.map((item) => item.path)
  assert.ok(paths.includes('/dsh-contract-butler/generate/plan'), `缺预告路由，实际：${paths.join(', ')}`)

  const before = JSON.parse((await fake.call('GET', `/dsh-contract-butler/contracts?project=${projectId}`)).body)
  const one = await plan(fake, { projectId, mode: 'rescan' })
  assert.equal(one.status, 200)
  const after = JSON.parse((await fake.call('GET', `/dsh-contract-butler/contracts?project=${projectId}`)).body)
  assert.deepEqual(after.contracts, before.contracts, '预告不该动任何契约记录')
  assert.equal(one.data.generated.contracts, before.contracts.length, '预告里的契约条数要与现状一致')
})

test('生成预告：文件数按扫描器同一套规则真数出来，且与 /rescan 报的一致', async () => {
  const { fake, projectId } = await mountPlugin()
  const one = await plan(fake, { projectId, mode: 'rescan' })
  assert.ok(one.data.code, '选了重扫就该给出代码那一段的预告')
  assert.equal(one.data.code.mode, 'rescan')
  // 两个 .proto/.yaml 源文件 + 其余仓库文件，至少是这两个。
  assert.ok(one.data.code.files >= 2, `文件数应当至少是 2，实际 ${one.data.code.files}`)

  // 真扫一遍：路径数必须与预告一致（同一套排除规则、同一个 walker）。
  const rescan = JSON.parse((await fake.call('POST', '/dsh-contract-butler/rescan', { project: projectId })).body)
  assert.equal(one.data.code.files, rescan.result.filesSeen, '预告的文件数必须等于真扫时的 filesSeen')

  // 不选重扫就不该去走目录（也就没有这一段）。
  const none = await plan(fake, { projectId, mode: 'none' })
  assert.equal(none.data.code, null, '不动代码时不该有代码那一段的预告')
})

test('生成预告：重建会清掉多少，与 clearGenerated **真的**清掉的一致', async () => {
  const { fake, projectId } = await mountPlugin()
  // 先造点数据出来：理解一次（落 AI 缓存），这样才有"会被清掉的东西"。
  await fake.call('POST', '/dsh-contract-butler/understand', { projectId })
  const predicted = (await plan(fake, { projectId, mode: 'rebuild' })).data.generated
  assert.ok(predicted.contracts > 0, '应当有契约会被清掉')
  assert.ok(predicted.ai > 0, 'AI 缓存也属于"生成出来的数据"，应当会被清掉')

  const rebuilt = JSON.parse((await fake.call('POST', '/dsh-contract-butler/rebuild', { projectId })).body)
  assert.deepEqual(rebuilt.cleared, predicted, '预告的数必须就是真清掉的那一批（两边共用一套判据）')

  // 清完之后契约被重抽回来，但 AI 缓存确实没了：再看预告，pending 应当是全部。
  const after = await plan(fake, { projectId })
  assert.equal(after.data.scope.cached, 0, '重建清掉了 AI 缓存，事后不该还有命中')
  assert.equal(after.data.scope.pending, after.data.scope.contracts, '缓存清空后，全部都要问模型')
})

/* ============================================================
   2) 预告与真实那一次调用**逐字对齐**（这是这个文件的核心）
   ============================================================ */

test('生成预告：说"会问 N 批"就真的是 N 批，说"多少条要问"就真的是那么多条', async () => {
  const { fake, projectId, llm } = await mountPlugin()

  const first = await plan(fake, { projectId })
  assert.ok(first.data.scope.contracts >= 3, `这个项目应当有 3 条以上契约，实际 ${first.data.scope.contracts}`)
  assert.equal(first.data.scope.pending, first.data.scope.contracts, '一次都没理解过：全部都要问')
  assert.equal(first.data.scope.cached, 0)

  // 第一次理解：批数与问过的条数，必须与预告一模一样。
  const understood = JSON.parse((await fake.call('POST', '/dsh-contract-butler/understand', { projectId })).body)
  assert.equal(understood.summary.batches, first.data.ai.batches, '预告的批数必须等于真实批数')
  assert.equal(understood.summary.requested, first.data.scope.pending, '预告"要问多少条"必须等于真实问过的条数')
  assert.equal(llm.batchesSeen().length, first.data.ai.batches, '模型被调用的次数就是批数')

  // 第二次：全部命中缓存 → 预告必须说 0 条要问、0 批；真跑也必须是 0 批、没再问模型。
  const second = await plan(fake, { projectId })
  assert.equal(second.data.scope.cached, second.data.scope.contracts, '内容没变：全部命中缓存')
  assert.equal(second.data.scope.pending, 0)
  assert.equal(second.data.ai.batches, 0)
  const callsBefore = llm.calls()
  const again = JSON.parse((await fake.call('POST', '/dsh-contract-butler/understand', { projectId })).body)
  assert.equal(again.summary.batches, 0, '预告 0 批，真跑就该 0 批')
  assert.equal(llm.calls(), callsBefore, '命中缓存就不该再问模型')
  assert.equal(again.summary.cached, second.data.scope.cached, '命中条数也要与预告一致')
})

test('生成预告：内容变过的契约会被算成"要问"，force 会把命中的也拉进来', async () => {
  const { fake, root, projectId } = await mountPlugin()
  await fake.call('POST', '/dsh-contract-butler/understand', { projectId })
  const cached = await plan(fake, { projectId })
  assert.equal(cached.data.scope.pending, 0, '刚理解完：没有要问的')

  // 改一条契约的形状（未提交 → 工作区演化），它的内容哈希就变了。
  const changed = PROTO_V1.replace('string name = 2;', 'string name = 2;\n  string email = 3;')
  fs.writeFileSync(path.join(root, 'proto', 'shop.proto'), changed)
  await fake.call('POST', '/dsh-contract-butler/rescan', { project: projectId })

  const afterChange = await plan(fake, { projectId })
  assert.ok(afterChange.data.scope.pending >= 1, '内容变过的那条必须重新算成"要问"')
  assert.ok(afterChange.data.scope.cached < afterChange.data.scope.contracts, '不该还是全部命中')
  assert.equal(afterChange.data.scope.pending + afterChange.data.scope.cached, afterChange.data.scope.contracts)

  // force：忽略缓存，全部重问。
  const forced = await plan(fake, { projectId, force: true })
  assert.equal(forced.data.scope.pending, forced.data.scope.contracts, 'force 时全部都要问')
  assert.equal(forced.data.scope.cached, 0, 'force 时不谈命中')
  assert.equal(forced.data.ai.batches, Math.ceil(forced.data.scope.contracts / forced.data.ai.batchSize))

  // 而且真跑一遍 force，批数也要对上。
  const run = JSON.parse((await fake.call('POST', '/dsh-contract-butler/understand', { projectId, force: true })).body)
  assert.equal(run.summary.batches, forced.data.ai.batches, 'force 的批数预告也必须是真的')
})

/* ============================================================
   3) 作用范围：只经 contractIds 下传（与 /understand 同一个机制）
   ============================================================ */

test('生成预告：范围缩到一批 id 时，预告与真跑问的是**同一批**契约', async () => {
  const { fake, projectId } = await mountPlugin()
  const all = await plan(fake, { projectId })
  const total = all.data.scope.contracts as number
  assert.ok(total >= 3, `这个项目应当有 3 条以上契约，实际 ${total}`)

  const list = JSON.parse((await fake.call('GET', `/dsh-contract-butler/contracts?project=${projectId}`)).body)
  const ids = (list.contracts as { contract: { id: string; file: string } }[])
    .filter((item) => item.contract.file.startsWith('api/'))
    .map((item) => item.contract.id)
  assert.ok(ids.length >= 1, 'api/ 下应当至少有一条契约')
  assert.ok(ids.length < total, '这一批应当是整个项目的真子集')

  const scoped = await plan(fake, { projectId, contractIds: ids })
  assert.equal(scoped.data.scope.kind, 'contracts')
  assert.equal(scoped.data.scope.contracts, ids.length, '预告里的条数就是这一批')
  assert.equal(scoped.data.ai.projectContracts, total, '整个项目有多少条也要照实说')

  // 真跑同一批：理解的条数与问过的条数都必须与预告一致。
  const run = JSON.parse((await fake.call('POST', '/dsh-contract-butler/understand', { projectId, contractIds: ids })).body)
  assert.equal(run.summary.total, scoped.data.scope.contracts, '范围里多少条，真跑就该理解多少条')
  assert.equal(run.summary.requested, scoped.data.scope.pending, '预告要问多少条，真跑就问多少条')
  assert.ok(run.summary.total < total, '这一跑确实只碰了这一批，不是整个项目')

  // 单条范围：一条契约 = 一批。
  const single = await plan(fake, { projectId, contractIds: [ids[0]], force: true })
  assert.equal(single.data.scope.contracts, 1)
  assert.equal(single.data.scope.pending, 1)
  assert.equal(single.data.ai.batches, 1)
})

test('生成预告：范围/项目不对时给明确错误，不是 200 也不是 500', async () => {
  const { fake, projectId } = await mountPlugin()
  assert.equal((await plan(fake, {})).status, 400, '缺 projectId 应当是 400')
  assert.equal((await plan(fake, { projectId: 'p_不存在' })).status, 404, '项目不存在应当是 404')
  assert.equal((await plan(fake, { projectId, contractIds: ['c_不存在'] })).status, 404, '契约不存在应当是 404')
})

/* ============================================================
   4) 一条链：一次点击对应的请求序列真能跑通
   ============================================================ */

test('一次点击的请求序列：预告 → 重扫 → 理解 → 渲染，全链路语义正确', async () => {
  const { fake, projectId } = await mountPlugin()

  // ① 弹窗打开时：预告（只读）
  const predicted = await plan(fake, { projectId, mode: 'rescan', force: false })
  assert.equal(predicted.status, 200)

  // ② 点"开始生成"：扫描
  const scan = JSON.parse((await fake.call('POST', '/dsh-contract-butler/rescan', { project: projectId })).body)
  assert.equal(scan.result.filesSeen, predicted.data.code.files, '扫描读到的文件数与预告一致')

  // ③ 理解：预告别说会问 0 批，否则这一步没有意义
  const ai = JSON.parse((await fake.call('POST', '/dsh-contract-butler/understand', { projectId })).body)
  assert.equal(ai.summary.batches, predicted.data.ai.batches)
  assert.ok(ai.summary.understood > 0, '应当有中文说明被写回')

  // ④ 渲染：面板拿到的列表里，三条渲染（.tai 灰字 / 图上 gai / 详情 aiBlock）都靠 aiTitle
  const list = JSON.parse((await fake.call('GET', `/dsh-contract-butler/contracts?project=${projectId}`)).body)
  for (const item of list.contracts as { contract: { symbol: string; title: string; aiTitle?: string; aiHash?: string } }[]) {
    assert.ok(item.contract.aiTitle, `${item.contract.symbol} 应当拿到中文说明`)
    assert.match(item.contract.aiTitle ?? '', /[\u3400-\u9fff]/, '中文说明必须是中文')
    assert.equal(item.contract.title, item.contract.symbol, '原始符号名一个字都不许被覆盖')
  }

  // 再跑一次"渲染"这一步（面板的 refresh）：内容没变 → 0 批，不该再烧一次模型。
  const cachedRun = await plan(fake, { projectId, mode: 'rescan' })
  assert.equal(cachedRun.data.scope.pending, 0, '内容没变，第二次不该再问模型')
})

test('独立 dev-server（宿主没有 llm）：理解那一段是 503 + 同一句可读原因，且预告当场就能预警', async () => {
  const { fake, projectId } = await mountPlugin({ llm: false })

  const predicted = await plan(fake, { projectId })
  assert.equal(predicted.data.ai.available, false, '没有 llm 时预告就该说"不可用"')
  assert.ok(String(predicted.data.ai.reason).length > 0, '不可用必须给可读原因')

  const res = await fake.call('POST', '/dsh-contract-butler/understand', { projectId })
  assert.equal(res.status, 503, '必须是明确的 503，不是 200 也不是 500')
  const why = String(JSON.parse(res.body).error)
  assert.ok(why.length > 0, '503 必须带可读原因')
  assert.ok(
    why.includes(String(predicted.data.ai.reason)) || String(predicted.data.ai.reason).includes(why),
    `预告里的原因与 503 的原因应当是同一句：预告=${predicted.data.ai.reason} 503=${why}`,
  )
})

/* ============================================================
   5) 面板接线：入口只有一个，且已经不在顶栏
   ============================================================ */

function panelHtml(): string {
  return fs.readFileSync(path.resolve(fileURLToPath(new URL('..', import.meta.url)), 'src', 'panel.html'), 'utf8')
}

test('面板：原先那三个按钮全没了，入口只剩侧边栏里的一个「生成」', () => {
  const html = panelHtml()
  for (const id of ['btnRescan', 'btnRebuild', 'btnUnderstand']) {
    assert.ok(!html.includes(id), `${id} 应当已经被合并掉`)
  }
  // 三个按钮的文案也不该再作为按钮出现。
  for (const label of ['>重新扫描<', '>重新生成<', '>AI 理解<']) {
    assert.ok(!html.includes(label), `按钮文案 ${label} 不该再出现`)
  }
  // 唯一的入口在 `<aside class="sidebar">` 里面，不在顶栏里。
  const aside = html.slice(html.indexOf('<aside class="sidebar'), html.indexOf('</aside>'))
  assert.ok(aside.includes('id="btnGenerate"'), '「生成」按钮必须在左侧侧边栏里')
  assert.ok(aside.includes('>生成<'), '按钮上写的就该是「生成」')
  const topbar = html.slice(html.indexOf('<header class="topbar'), html.indexOf('</header>'))
  assert.ok(!topbar.includes('btnGenerate'), '生成按钮不该留在顶栏里')
  /* 下面这条原来是反的：「纳管项目」曾经作为第二个动作入口留在顶栏。现在它并进了侧栏那一个
     入口（未纳管时它就叫"纳管项目"），所以这里改成钉"顶栏不再有动作入口"。 */
  assert.ok(!topbar.includes('btnInit'), '顶栏不该再有第二个动作入口：纳管项目已并进侧栏那一个入口')
  assert.ok(!/openFlow|btnInit|btnRescan|btnRebuild|btnUnderstand/.test(topbar),
    '顶栏里不该有任何能到达 /init /rescan /rebuild 的入口')
  // 侧栏那一个是**唯一**的动作入口：只有一个按钮绑 openFlow。
  //（详情页那个「重新生成这一条…」是同一个弹窗的范围预置快捷方式，不是第二条路径。）
  const binders = html.match(/addEventListener\('click', function \(\) \{ openFlow\(\); \}/g) || []
  assert.strictEqual(binders.length, 1, '打开动作弹窗的按钮只能有一个：侧栏那一个')
  assert.ok(!/openInit|openGenerate/.test(html), '旧的第二个入口（openInit/openGenerate）不该再存在')
})

test('面板：一个入口两个状态（未纳管=纳管项目 / 已纳管=生成），且不新增第二个入口', () => {
  const html = panelHtml()
  // 唯一的入口只有一个：openFlow 是唯一分流点。
  assert.ok(html.includes('function openFlow(preset, opts)'), '要有唯一的入口分流函数 openFlow')
  const flow = html.slice(html.indexOf('function openFlow(preset, opts)'), html.indexOf('function syncFlowEntry'))
  assert.ok(flow.includes('var wantOnboard = (opts && opts.onboard === true) || !S.p;'),
    '没有项目（或调用方明确要求）→ 未纳管的形态（选目录纳管）')
  assert.ok(flow.includes('if (wantOnboard) return flowOnboard('), '未纳管走 flowOnboard，纳管过走 flowGenerate')
  assert.ok(flow.includes('return flowGenerate(preset)'), '已有项目 → 已纳管的形态（选这次重生成什么）')
  // 入口文案跟着状态走：同一个按钮，两种说法。
  assert.ok(html.includes('function syncFlowEntry()'), '入口文案要有一个同步点')
  const syncAt = html.indexOf('function syncFlowEntry()')
  const sync = html.slice(syncAt, syncAt + 800)
  assert.ok(sync.includes("onboard ? '纳管项目' : '生成'"), '未纳管写「纳管项目」、已纳管写「生成」')
  // 状态一变（重画顶栏）就要同步，不能只在启动时写一次。
  const topAt = html.indexOf('function renderTop()')
  assert.ok(html.slice(topAt, topAt + 400).includes('syncFlowEntry()'),
    '每次重画顶栏都要同步入口文案（状态一变就跟着变）')
  // 两个形态之间不再互跳：旧的两处互跳要删掉。
  assert.ok(!html.includes('{ openInit(); return'), '旧的两处互跳要删掉')
  assert.ok(!html.includes('{ openInit(); }'), '旧的两处互跳要删掉')
})

test('弹窗：作用范围只在勾了 AI 时出现；「清掉重生成」要第二道确认', () => {
  const html = panelHtml()
  // 作用范围只管 AI：不勾 AI 整块不出现。
  assert.ok(html.includes("scopeSec.style.display = G.ai ? '' : 'none'"), '不勾 AI 时作用范围整块不出现')
  const syncAt = html.indexOf('function syncAll()')
  assert.ok(html.slice(syncAt, syncAt + 500).includes('scopeSec.style.display'),
    '显隐要在"选项联动"那一处统一同步，不能只在打开时算一次')
  // 破坏性动作的第二道闸：第一下说清代价，第二下才真的跑；默认那档不受影响。
  const goAt = html.indexOf("go.addEventListener('click'")
  const go = html.slice(goAt, goAt + 800)
  assert.ok(go.includes("G.mode === 'rebuild' && !G.confirmRebuild"),
    '只有「清掉重生成」才要第二下确认（且第一下不跑）')
  assert.ok(go.includes('确认清掉并重新生成（不可撤销）'), '第二下的按钮要把代价写在脸上')
  assert.ok(html.includes('清掉这个项目已生成的契约、快照、演化、观测、决策与 AI 缓存'),
    '确认文案要把清掉的东西列清楚')
  assert.ok(html.includes('resetRebuildGate'), '选项一变就要把这道确认撤掉（旧确认不能盖住新选择）')
})

test('面板：弹窗里有那四组选择，且预告是问宿主算出来的（不是写死的）', () => {
  const html = panelHtml()
  // 四组：代码（三选一）/ 补 AI 说明 / 强制重问 / 作用范围
  for (const text of ['不动代码', '增量重扫', '清掉重生成', '补 AI 中文说明', '忽略缓存，强制重问', '作用范围']) {
    assert.ok(html.includes(text), `弹窗里应当有「${text}」这一项`)
  }
  // 预告必须来自宿主：面板唯一能拿到"这次会做什么"的地方就是这条只读路由。
  assert.ok(html.includes("'/generate/plan'"), '弹窗必须问 /generate/plan 要真实数字')
  // 范围只作用于 AI 那一段——做不到的范围维度不假装有，所以这句话必须写在弹窗里。
  /* 翻转过：用户要求删掉"作用范围"整块，那句"重扫与重生成不受这个范围影响"也一并删了。 */
  assert.ok(!html.includes('重扫与重生成是项目级动作'), '那句说明句要删掉，不许换个说法放回来')
  // 预告里的数字全部来自宿主返回，面板不自己编一个。
  assert.ok(!/将重扫\s*\d+\s*个文件/.test(html), '预告文案不许写死任何数字')
})

test('面板：一条链 = 扫描 → 理解 → 渲染，且"AI 理解"不再是独立步骤', () => {
  const html = panelHtml()
  // 三段的名字（加载卡片上的阶段就是这三个）。
  assert.ok(html.includes("var UND_STAGES = ['扫描', '理解', '渲染']"), '三个阶段应当是 扫描 / 理解 / 渲染')
  // 阶段文字要体现"在扫描还是在理解"。
  /* 这条也翻转过一次：原来钉「扫描中…」，用户要求说人话 → 「正在扫描 <项目名>…」。 */
  assert.ok(html.includes("'正在扫描 ' + ((S.p && S.p.title) ? S.p.title : '这个项目') + '…'"),
    '应当有「正在扫描 <项目名>…」这段文字')
  /* 这条断言在"右下角说人话"那一轮**翻转过一次**：原来钉的是「理解中 第 N / M 批」，
     用户明令"批/批次/分批不许再出现"，所以改成钉同一件事的新说法——AI 那一段的标题里
     必须写出"正在为谁生成、已经完成几条"，而且数字口径是**条**不是组。
     意图没变：这一段的标题必须是真的进度，不是一句空转的"理解中…"。 */
  assert.ok(html.includes("'正在为 '") && html.includes("' 生成中文说明（已完成 '"),
    '应当有「正在为 a、b 生成中文说明（已完成 5 / 12 条）」这段文字')
  assert.ok(!html.includes('批'), '那一段的文案里不许再出现"批"')
  assert.ok(html.includes("'渲染中…'"), '应当有「渲染中…」这段文字')
  // 一条链：runGenerate 里按顺序调这三条路由。
  const start = html.indexOf('function runGenerate')
  const end = html.indexOf('function genScopes')
  assert.ok(start > 0 && end > start, '应当能取出 runGenerate 这一段')
  const fn = html.slice(start, end)
  assert.ok(fn.includes("'/rebuild'") && fn.includes("'/rescan'") && fn.includes("'/understand'"),
    '生成链必须自己按顺序调扫描/理解接口')
  assert.ok(fn.indexOf("'/understand'") > fn.indexOf("'/rescan'"), '理解必须排在扫描之后')
  // 没勾 AI 时，那一段要明确标成"跳过"，不能假装做过。
  assert.ok(html.includes('undSkipStage'), '没勾 AI 时"理解"那一段必须标成跳过')
  assert.ok(html.includes('（跳过）'), '跳过要有可见文字')
})

test('面板：红线还在——AI 中文只来自模型，没有本地词典、没有自建管道', () => {
  const html = panelHtml()
  // 面板不许自己"造"一个中文标题出来（三条渲染都只读 contract.aiTitle）。
  assert.ok(html.includes('it.contract.aiTitle') || html.includes('c.aiTitle'), '三处渲染读的是契约记录上的 aiTitle')
  const src = path.resolve(fileURLToPath(new URL('..', import.meta.url)), 'src')
  assert.ok(!fs.existsSync(path.join(src, 'llm.ts')), '自建 AI 管道保持删除状态')
  // 仓库里不许出现读配置/密钥/网关调用的代码。
  for (const name of fs.readdirSync(src)) {
    if (!name.endsWith('.ts') && !name.endsWith('.html')) continue
    const text = fs.readFileSync(path.join(src, name), 'utf8')
    assert.ok(!/settings\.yaml/.test(text), `${name} 不该读 settings.yaml`)
  }
})
/* ============================================================
   5) 字段级中文：只来自模型、一个字段都不能少、渲染进表里
   ============================================================ */

test('字段级中文：跑一遍理解，每条契约的字段都带上中文，且原始形状一个字没动', async () => {
  const { fake, projectId } = await mountPlugin()

  // 跑之前先把"原始形状"记下来：等会儿要逐字对比。
  const before = JSON.parse((await fake.call('GET', `/dsh-contract-butler/contracts?project=${projectId}`)).body)
  const shapeBefore = new Map<string, string>()
  for (const item of before.contracts as { contract: { id: string; input: unknown; output: unknown } }[]) {
    shapeBefore.set(item.contract.id, JSON.stringify([item.contract.input, item.contract.output]))
  }

  const run = JSON.parse((await fake.call('POST', '/dsh-contract-butler/understand', { projectId })).body)
  assert.equal(run.summary.ok, true, `理解应当全部成功：${JSON.stringify(run.summary.failures ?? [])}`)

  const after = JSON.parse((await fake.call('GET', `/dsh-contract-butler/contracts?project=${projectId}`)).body)
  let withFields = 0
  for (const item of after.contracts as {
    contract: { id: string; input: { fields?: Record<string, unknown> } | null; output: { fields?: Record<string, unknown> } | null
      aiFields?: { name: string; zh: string }[] }
  }[]) {
    const c = item.contract
    // 原始形状逐字不变：字段级中文只加不改。
    assert.equal(JSON.stringify([c.input, c.output]), shapeBefore.get(c.id), `${c.id} 的原始形状不许被改写`)
    const names = new Set<string>()
    for (const side of [c.input, c.output]) {
      for (const name of Object.keys(side?.fields ?? {})) names.add(name)
    }
    if (names.size === 0) continue
    withFields += 1
    assert.ok(Array.isArray(c.aiFields), `${c.id} 应当写下 aiFields`)
    assert.deepEqual((c.aiFields ?? []).map((f) => f.name).sort(), [...names].sort(),
      `${c.id} 的每个字段都要有一条中文，一个不多一个不少`)
    for (const f of c.aiFields ?? []) assert.ok(f.zh !== '' && /[\u4e00-\u9fa5]/.test(f.zh), '字段中文必须是中文')
  }
  assert.ok(withFields > 0, '至少要有一条带字段的契约')
})

test('面板：字段中文只读模型给的，本地不翻译', () => {
  const html = panelHtml()
  // 渲染读的就是契约记录上的 aiFields。
  assert.ok(html.includes('item.contract.aiFields'), '字段中文读的是契约记录上的 aiFields')
  // 一个字段名对不上就不显示 —— 没有兜底词典。
  const start = html.indexOf('function aiFieldZh')
  const end = html.indexOf('function fieldMarks')
  assert.ok(start > 0 && end > start, '应当能取出 aiFieldZh 这一段')
  const fn = html.slice(start, end)
  assert.ok(!/\bzh\s*[:=]\s*['"]/.test(fn), 'aiFieldZh 里不许出现任何写死的中文兜底')
  // 表的列里有"中文解释"，且空的时候留白。
  /* 列标题现在由那份**共用规格**（`FT_COLS`）统一给出：组件版按它建列、静态降级版按它建
     thead——两条渲染路径只有一份标题，不许各写一份（写两份就一定有一天对不上）。
     所以这里断言的是规格里的那一项，而不是某个 `el('th', …)` 字面量。 */
  assert.ok(html.includes("title: '中文解释'"), '字段表要有「中文解释」这一列')
  assert.ok(html.includes("el('th', { text: c.title })"), '静态版的表头也要从那份规格生成')
  assert.ok(html.includes("class: 'fzh'"), '中文解释那一格有自己的样式')
  // 图上节点的悬停提示也带上中文（给了才有）。
  assert.ok(html.includes('中文：') && html.includes('partTip(f, zh)'), '图节点提示里要带上字段中文')
})

/* ============================================================
   6) schema 页下半部分：左图右表、中间可拖、比例记得住
   ============================================================ */

test('面板：schema 页是左图右表，中间一根可拖的分隔条，比例写进 localStorage', () => {
  const html = panelHtml()
  // 左右两块 + 中间那根条。
  assert.ok(html.includes('.ssplit'), '应当有左右分栏的容器样式')
  assert.ok(html.includes('grid-template-columns: var(--ss-left, 38%) 9px minmax(0, 1fr)'),
    '默认左 38% / 右 62%，中间 9px 分隔条')
  assert.ok(html.includes("class: 'ssbar'"), '分隔条要在 DOM 里')
  assert.ok(html.includes('cursor: col-resize'), '分隔条要能拖（col-resize 光标）')
  assert.ok(html.includes('.ssbar:hover::before') && html.includes('.ssbar.on::before'),
    'hover 与拖动时要有反馈')
  // 两侧各自滚动，页面不横向滚。
  assert.ok(html.includes('.ssbody { flex: 1; min-height: 0; overflow: auto;'),
    '图与表各自独立滚动')
  // 最小值与持久化。
  assert.ok(html.includes('var SS_MIN_L = 260'), '左侧最小 260px')
  assert.ok(html.includes('var SS_MIN_R = 380'), '右侧最小 380px')
  assert.ok(html.includes("var SS_KEY = 'dsh-contract-butler.schemaSplit'"),
    '比例要存进带 dsh-contract-butler. 前缀的 key')
  assert.ok(html.includes('ssSave('), '拖动结束要真的写进去')
  // 拖动之后按新宽度重画图（坐标是同步算的，不重画节点会停在旧位置）。
  const start = html.indexOf('function schemaSplit')
  const end = html.indexOf('function shapeGraphIR')
  assert.ok(start > 0 && end > start, '应当能取出 schemaSplit 这一段')
  const fn = html.slice(start, end)
  assert.ok(fn.includes('addEventListener(\'pointermove\''), '拖动要跟 pointermove')
  assert.ok(fn.includes('fillLeft('), '拖完要按新宽度重画形状图')
  assert.ok(fn.includes('ssClamp('), '拖动结果要夹在最小宽度里')
  // 键盘也能调：拖动不是唯一路径。
  assert.ok(fn.includes('ArrowLeft') && fn.includes('ArrowRight'), '分隔条要能用左右方向键调')
})

test('面板：字段表是现代表格——吸顶表头、极淡斑马、类型彩色 chip、复用状态点', () => {
  const html = panelHtml()
  assert.ok(html.includes('table.ft thead th { position: sticky; top: 0'),
    '表头要吸顶')
  assert.ok(html.includes('table.ft tbody tr:nth-child(even)'), '要有极淡的斑马纹')
  assert.ok(html.includes('table.ft tbody tr:hover'), '要有 hover')
  assert.ok(html.includes('table.ft .fname') && html.includes('var(--mono)'), '字段名列走等宽字体')
  assert.ok(html.includes("class: 'fchip fchip-'"), '类型要渲染成彩色 chip')
  assert.ok(html.includes('table.ft .fzh'), '中文解释一列是灰字')
  assert.ok(html.includes('.freq') && html.includes('.freq.is-opt'), '必填与可选要能一眼分开')
  assert.ok(html.includes('table.ft td.fnum'), '数字列右对齐的规则要在')
  assert.ok(html.includes("class: 'ftrunc'"), '长文本要截断并带原生 title')
  // 状态点复用既有的那套 tone，不新造颜色。
  assert.ok(html.includes("class: 'dot ' + stat.cls") && html.includes("'d-bad'") && html.includes("'d-changed'"),
    '字段状态点复用 d-bad / d-changed')
  // chip 的色相全部来自现有 token / color-mix，不许出现新的写死色值。
  const start = html.indexOf('.fchip {')
  const end = html.indexOf('.freq {')
  assert.ok(start > 0 && end > start, '应当能取出 chip 这一段的样式')
  const css = html.slice(start, end)
  assert.ok(!/#[0-9a-fA-F]{3,8}\b/.test(css), `chip 那一段不许出现新的硬编码色值：${css.slice(0, 200)}`)
  assert.ok(css.includes('color-mix') && /var\(--(accent|ok|warn|ink3|ink|bad)\)/.test(css),
    'chip 的颜色要从现有 token mix 出来')
})

test('面板：详情页卡片标头已删、计数下沉到内容里', () => {
  const html = panelHtml()
  // 标头那三行 CSS 连同 DOM 一起删掉——留着就是死代码。
  // （断的是"规则没了"，不是"字面量没了"：删除处留的那句说明本身要提到 `.sshead`，
  //   否则下一个人根本不知道这里曾经有什么。）
  assert.ok(!html.includes('.sshead {') && !html.includes('.sshead h3') && !html.includes('.sshead .ssnote'),
    '`.sshead`（卡片标头）的三条样式规则应当已经删掉')
  assert.ok(!html.includes("class: 'sshead'"), '标头那块 DOM 也应当没了')
  // 以后只认这一种做法：标头的活由内容自己干。
  assert.ok(html.includes('计数下沉') || html.includes('标头去掉'),
    '删除处要留一句话说明计数去哪了（不然下一个人会以为计数丢了）')

  // DOM 那侧：详情页的左图右表这一段里不该再有 h3。
  const start = html.indexOf('function schemaSplit')
  const end = html.indexOf('function shapeGraphIR')
  assert.ok(start > 0 && end > start, '应当能取出 schemaSplit 这一段')
  const fn = html.slice(start, end)
  assert.ok(!fn.includes('h3'), '详情页的「形状」「字段」两张卡片不该再有 h3 标头')

  // 计数一个都不能少：左＝两行小节标题，右＝每张表上方那行小字。
  assert.ok(fn.includes("shapeSection('进来什么 · ' + inRows.length + ' 条'"), '左侧要有「进来什么 · N 条」')
  assert.ok(fn.includes("shapeSection('出去什么 · ' + outRows.length + ' 条'"), '左侧要有「出去什么 · M 条」')
  assert.ok(fn.includes("advFieldTable(inRows, '输入')") && fn.includes("advFieldTable(outRows, '输出')"),
    '右侧两张表都要走组件版')

  // 「输入/输出 · N 条 · X 条有中文」：这行是两个方向各自的计数，两个数都要给全
  // （0 条有中文也照写——"没中文"和"没统计"是两回事）。
  const dl = html.indexOf('function dirLine')
  assert.ok(dl > 0, '应当有 dirLine 这一段')
  const dir = html.slice(dl, dl + 500)
  assert.ok(dir.includes("dir + ' · ' + rows.length + ' 条 · ' + zhN + ' 条有中文'"),
    '计数行要给全条数与有中文的条数')
})

test('面板：字段表换成组件（本地 vendor，不走 CDN），组件不在时明确降级', () => {
  const html = panelHtml()
  // 本地引用：脚本与样式都指向宿主那条白名单路由（带版本查询串当缓存钥匙），没有一个外链域名。
  assert.ok(/<script src="\.\/vendor\/tabulator\.min\.js\?v=[\d.]+"><\/script>/.test(html),
    '组件脚本要从本地的 ./vendor/ 引，并带版本号')
  assert.ok(/<link rel="stylesheet" href="\.\/vendor\/tabulator\.min\.css\?v=[\d.]+">/.test(html),
    '组件样式要从本地的 ./vendor/ 引，并带版本号')
  /* 运行期不依赖 CDN：全文件只允许出现一个 http:// 字面量——SVG 的命名空间
     （`http://www.w3.org/2000/svg` 是个标识符，不是请求），此外任何 `src=`/`href=` 都不许指外网。 */
  assert.ok(!/(?:src|href)\s*=/.test(html) || !/(?:src|href)\s*=\s*["']https?:\/\//.test(html),
    '面板里不许有指向外网的 src/href')
  const urls = html.match(/https?:\/\/[^\s"'<>)]*/g) ?? []
  assert.deepEqual(urls.filter((u) => u !== 'http://www.w3.org/2000/svg'), [],
    '除了 SVG 命名空间，面板里不该还有任何外网地址')

  // 列规格：首列固定 + 首列有 minWidth 底线（其余列同规格，一起断言）。
  const cs = html.indexOf('var FT_COLS = [')
  const ce = html.indexOf('];', cs)
  assert.ok(cs > 0 && ce > cs, '应当能取出 FT_COLS 这一段')
  const cols = html.slice(cs, ce)
  assert.ok(cols.includes('frozen: true'), '字段那一列要固定（横滚时钉在最左）')
  assert.ok(/key: 'n'[^}]*minWidth: \d+/.test(cols), '首列要有 minWidth：拖到底也不许窄到看不见名字')
  // 名字要能看全：不套 .ftrunc、**不用省略号**；列宽按该表最长名字实测（有上下限）。
  // 短名字自然是单行，超过上限才折行——折行是为了不裁字，不是拿空间去换行。
  assert.ok(!html.includes("class: 'fname ftrunc'"), '字段名不该再套截断类')
  const fn = html.indexOf('table.ft .fname')
  assert.ok(fn > 0 && html.slice(fn, fn + 240).includes('overflow-wrap: anywhere'),
    '字段名要能折行读完（不裁剪、也不用省略号）')
  assert.ok(!html.slice(fn, fn + 240).includes('ellipsis'), '.fname 不该用省略号截断')
  const nwM = /key: 'n'[^}]*width: (\d+)/.exec(cols)
  assert.ok(nwM, '首列要有宽度')
  const nwV = Number(nwM![1])
  assert.ok(nwV >= 240 && nwV <= 460,
    '首列宽度按实测给且有上限（240–460）：超长名字折行，而不是把整表撑出横向滚动条')
  assert.ok(/key: 'n'[^}]*maxWidth: 460/.test(cols), '首列要有 maxWidth 上限')
  for (const key of ['n', 't', 'r', 'zh', 'st']) {
    assert.ok(cols.includes(`key: '${key}'`), `列规格里要有 ${key} 这一列`)
  }
  assert.ok(cols.includes('width: 320') && cols.includes('width: 340') && cols.includes('width: 360'),
    '其余列宽写在规格里；首列宽度由实测覆盖（见上）')
  assert.ok(cols.includes('maxWidth: 460'), '首列上限 460：再长的名字折行，不把整表撑出横向滚动条')

  // 名字列被压成 30px 竖排梯子：分面栏那条 `.fname{width:30px}` 没作用域，把表内名字也管住了。
  // 两件事都要钉住：分面栏收作用域 + 表内明确 width:auto（不靠"没写所以就自动"这种巧合）。
  assert.ok(html.includes('.faxis .fname {'), '分面栏的 .fname 要有作用域，不许再泄漏到字段表里')
  assert.ok(!/^ {2}\.fname \{/m.test(html), '不该还有裸的 .fname 规则（它是 30px 那条的泄漏源）')
  assert.ok(html.slice(fn, fn + 240).includes('width: auto'),
    '表内字段名要 width:auto：否则继承 30px，长名字会折成一条竖排梯子')

  // 降级静态表的横向滚动阈值 = 各列最小宽之和，必须 ≤ 900px 窗格扣掉内距后的可用宽（871）。
  const mins = [...cols.matchAll(/minWidth: (\d+)/g)].map((m) => Number(m[1]))
  const ftMinSum = mins.reduce((a, b) => a + b, 0)
  assert.ok(ftMinSum <= 871, `各列最小宽之和 ${ftMinSum} 要 ≤ 871：900px 窗格里不该有无谓的横向滚动条`)

  // ③ 块与块之间不再画线（靠间距分节），但表格的行线/表头线必须还在；.chead 那条按实测保留
  // （它的下一个兄弟就是滚动体，和 .side-top / .dbar / .dfoot 同一个模式）。
  assert.ok(!/\.block \{[^}]*border-top/.test(html), '.block 不许再有 border-top（块之间靠间距分节）')
  assert.ok(/\.block \{[^}]*margin-top: 26px/.test(html), '.block 间距要补到 26px（删线后靠它分节）')
  assert.ok(/table\.f td \{[^}]*border-bottom/.test(html), 'table.f 的行线必须还在（那是结构线）')
  assert.ok(/table\.ft td \{[^}]*border-bottom/.test(html), 'table.ft 的行线必须还在（那是结构线）')
  assert.ok(!/\.sheet-h \{[^}]*border-bottom/.test(html), '.sheet-h 不许再有 border-bottom（整体滚动、头不 sticky）')
  assert.ok(/\.chead \{[^}]*border-bottom/.test(html), '.chead 那条线要保留（贴着滚动体的那条边）')

  // 组件版建表：fitData + 明确宽度（合计超容器就出横向滚动条）、可拖列宽、可排序、每实例自带滚动区。
  const as = html.indexOf('function advFieldTable')
  const ae = html.indexOf('/* ---------- 事实判定', as)
  assert.ok(as > 0 && ae > as, '应当能取出 advFieldTable 这一段')
  const adv = html.slice(as, ae)
  // 布局：fitColumns + 首列定宽（不参与分配）+ 其余列 widthGrow 瓜分剩余 —— 这才铺得满窗格。
  // fitDataStretch 只把剩余塞给最后一列，前四列永远是写死的宽，宽窗格照样出横向滚动条（实测 1168/1267）。
  assert.ok(adv.includes("layout: 'fitColumns'"), '布局要铺满窗格：宽窗格里不该有无谓的横向滚动条')
  assert.ok(!adv.includes("layout: 'fitDataStretch'"), '不该再退回 fitDataStretch（它铺不满）')
  assert.ok(adv.includes('variableHeight: true'), '中文解释要能换行读完')
  assert.ok(adv.includes("height: '100%'"), '表高度交给外层 flex')
  assert.ok(!adv.includes("maxHeight: '"),
    '表不再自己钉高度：里外两层滚动条并存是之前最大的设计错')
  assert.ok(adv.includes("class: 'fadv fsec'") && adv.includes("class: 'fhost'")
    && adv.includes("class: 'fscroll'"), '字段小节 + 各自唯一的滚动区（组件版与降级版各一份）')
  // 字段区只留一层滚动：外层窗格不滚，滚动交给每张表自己。
  const ssf = html.indexOf('.ssbody.ssflex')
  assert.ok(ssf > 0, '字段区要有 ssflex 那一层')
  assert.ok(html.slice(ssf, ssf + 260).includes('overflow: hidden'),
    '字段区外层不滚（里外两层滚动条会打架）')
  // 高度上限必须来自一个有定义的令牌：`var(--ss-h)` 悬空时 max-height 整条无效，
  // 字段区就会被内容撑开、表不再内部滚动——这种静默失效必须被测试挡住。
  assert.ok(html.includes('--ss-h: 64vh'), '详情页高度令牌 --ss-h 要有定义')
  assert.ok(html.includes('max-height: var(--ss-h)'),
    '两侧窗格的高度上限要共用同一个令牌（不各写一份 vh）')
  assert.ok(!html.includes('max-height: none'), '字段区不许没有高度上限（会被内容撑开）')
  assert.ok(html.includes("style: 'min-width:' + minSum"),
    '降级静态表要有最小宽度：窄窗格横向滚动，而不是把列压成一条缝')
  // 列级能力在那份列定义里（`ftColumn`），不在建表那一段——两处都断，免得哪天被挪走就没人看。
  const fc = html.indexOf('function ftColumn')
  const fce = html.indexOf('function advFieldTable', fc)
  assert.ok(fc > 0 && fce > fc, '应当能取出 ftColumn 这一段')
  const colDef = html.slice(fc, fce)
  assert.ok(colDef.includes('resizable: true') && colDef.includes('headerSort: true'),
    '列宽可拖、表头可排序（真正的表格能力）')
  assert.ok(colDef.includes('frozen: c.frozen === true'), '固定列的开关要真的接到列定义上')
  assert.ok(colDef.includes('minWidth: c.minWidth'), '最小列宽也要接到列定义上')
  assert.ok(colDef.includes('maxWidth: c.maxWidth'),
    '最大列宽也要接到列定义上（否则首列 460 上限在组件版不生效）')
  assert.ok(colDef.includes('def.widthGrow = c.width / 100'),
    '其余列按 widthGrow 瓜分剩余宽度（fitColumns 下这才铺得满）')
  assert.ok(colDef.includes("else if (c.key === 'n') def.widthGrow = ftNameGrow(c.width)"),
    '首列也参与剩余分配：份额按实测需要推（窄窗格里先让位，900 档才不出横向滚动条）')
  assert.ok(colDef.includes('if (dragged) def.width = w'),
    '用户拖过的列宽一律当定宽用（拖拽意愿优先，且刷新后还在）')
  assert.ok(html.includes('function ftNameGrow') && html.includes('FT_NAME_REF'),
    '首列份额要有出处：按实测需要 + 参考可用宽推出来，不是拍一个数')
  // 首列的上下限仍必须挂在列定义上：上限 460（名字再长折行）、下限 200（窄窗格还能让位）。
  assert.ok(html.includes('minWidth: 200, maxWidth: 460, frozen: c.frozen'),
    '首列上下限 200/460 要一起交给组件（460 上限 + 窄窗格可缩到 200）')
  assert.ok(colDef.includes('cellwrap') && colDef.includes('formatter:'),
    '中文解释那列要换行，且各列走共用的格子构造')
  // 拖完的列宽要落进 localStorage，两张表共用一份。
  const cs2 = html.indexOf('function ftColsLoad')
  assert.ok(cs2 > 0, '应当有列宽持久化这一段')
  assert.ok(html.includes("var FT_COLS_KEY = 'dsh-contract-butler.cols'"),
    '列宽存进带 dsh-contract-butler. 前缀的 key')
  /* 降级：`window.Tabulator` 不在就**明说**并退回静态表。
     静默失败会让人以为是数据没了——所以这句话必须在，且必须真的回退。 */
  assert.ok(adv.includes('!window.Tabulator'), '要判断组件在不在')
  assert.ok(adv.includes('高级表格组件未加载，已退化为静态表'), '降级要有一句给人看的说明')
  assert.ok(adv.includes('ftStaticTable(rows)'), '降级要真的退回静态表，不是留个空框')
  // 主题覆盖：组件那套默认灰蓝必须被 token 压回去，且不许新造写死色值。
  const ps = html.indexOf('.fadv .tabulator {')
  const pe = html.indexOf('/* 空表占位', ps)
  assert.ok(ps > 0 && pe > ps, '应当能取出组件主题覆盖这一段')
  const skin = html.slice(ps, pe)
  assert.ok(skin.includes('var(--line') && skin.includes('var(--ink') && skin.includes('color-mix'),
    '组件的底色/边线要从现有 token mix 出来（明暗两套都跟着走）')
  assert.ok(!/#[0-9a-fA-F]{3,8}\b/.test(skin.replace(/\/\*[\s\S]*?\*\//g, '')),
    `覆盖段里（去掉注释后）不许出现写死的色值：${skin.slice(0, 160)}`)
})

test('面板：字段级状态点是从宿主给的原因里读出来的，读不出来就不标', () => {
  const html = panelHtml()
  const start = html.indexOf('function fieldMarks')
  const end = html.indexOf('function fieldRowsOf')
  assert.ok(start > 0 && end > start, '应当能取出 fieldMarks 这一段')
  const fn = html.slice(start, end)
  // 认的是宿主那条固定格式：`输入 $.phone：…` / `（放宽）$.phone：…`
  assert.ok(fn.includes('输入|输出'), '要认带方向的那一种')
  assert.ok(fn.includes('（放宽）'), '要认不带方向的那一种')
  // 解析不出来就不标（不编一个状态出来）。
  assert.ok(fn.includes("if (!m2) return;"), '认不出的原因要直接跳过')
})

test('弹窗：默认必须是"增量重扫"，而且那一档真的处于选中态', () => {
  const html = panelHtml()
  const start = html.indexOf('function radioRow')
  const end = html.indexOf('function checkRow')
  assert.ok(start > 0 && end > start, '应当能取出 radioRow 这一段')
  const fn = html.slice(start, end)
  // 读与写必须分开：同一个回调既当读又当写时，"同步整张表"那次**读**会顺手把值改掉，
  // 三行按顺序各读一次 → 最后一行（清掉重生成）赢了 → 默认悄悄变成会清库的那一档，
  // 而三行又全都不在选中态。这个 bug 在截图里是"没有任何一档被选中"。
  assert.ok(/function radioRow\([^)]*\bget\b[^)]*\bset\b[^)]*\)/.test(fn),
    'radioRow 要同时收 get 与 set（像 checkRow 那样），不能只收一个回调')
  assert.ok(fn.includes('value === get()'), '选中态要来自 get() 的返回值')
  assert.ok(fn.includes('set(value)'), '改选要调 set(value)')

  // 三个模式行的 get 必须是同一个只读读取，set 才是写。
  for (const [value, label] of [['none', '不动代码'], ['rescan', '增量重扫（默认）'], ['rebuild', '清掉重生成']] as const) {
    const at = html.indexOf(`radioRow('genmode', '${value}'`)
    assert.ok(at > 0, `应当有 ${label} 这一档`)
    const seg = html.slice(at, at + 400)
    /* 参数顺序是 get 在前、set 在后：get 必须是只读的 `return G.mode`，
       而写只能出现在 set 里——所以 `G.mode = 'xxx'` 必须被 `return G.mode` 挡在后面。 */
    const gi = seg.indexOf('function () { return G.mode; }')
    const si = seg.indexOf("function () { G.mode = '")
    assert.ok(gi > 0, `${label} 这一档的 get 要读 G.mode`)
    assert.ok(si > gi, `${label} 这一档的写（G.mode = …）要在 get 之后，不能拿来当 get`)
  }
  // 默认值本身：flowGenerate 里初始化的就是 rescan。
  const open = html.indexOf('function flowGenerate')
  const g = html.slice(open, open + 600)
  assert.ok(g.includes("mode: 'rescan'"), '打开弹窗时的默认模式必须是增量重扫')
  assert.ok(html.includes('增量重扫（默认）'), '那一档的标题要写明它是默认')
})

/**
 * 生成弹窗这一轮的三件事：网格卡片布局、目录块（只能加、提交是并集）、右下角说人话。
 *
 * 最要紧的一条是**并集**：项目记录里的 `include` 存的是**候选（文件）id**，重跑 init 是
 * **替换**语义——不在集合里的候选就不算纳管了。所以这个块提交时必须发"现有 ∪ 新勾"，
 * 只发新勾的那几条会把已经纳管的一整组挤掉。这条一旦写错，用户就是"加一个目录，掉了十个"。
 */
/**
 * 目录块的**真实口径**：并入是并集（老的一条不掉），并入之后下一次扫描仍在。
 *
 * 为什么单独压这一条：面板那个块提交的是"现有 id ∪ 新勾的 id"，而 `commitInit` 对 `include`
 * 是**替换**语义——只发新勾的那几条，已经纳管的一整组就会被挤出项目。这条测试走真路由、
 * 真存储，先人为把 include 缩到一半（还原"早就纳管过、但只纳了一部分"的现场），再并回去。
 */
test('目录块：并入是并集（老的一条不掉），并入后下一次扫描仍在', async () => {
  const { fake, root, projectId } = await mountPlugin()
  const includeOf = async (): Promise<string[]> => {
    const data = JSON.parse((await fake.call('GET', '/dsh-contract-butler/projects')).body) as { projects: any[] }
    const mine = data.projects.find((p) => p.id === projectId)
    assert.ok(mine, '项目记录要在')
    return mine.include as string[]
  }
  const full = await includeOf()
  assert.ok(full.length > 1, `布景要有不止一条候选，现在是 ${full.length} 条`)

  // 只读预览：不带 confirm，拿候选（这一步不该有任何副作用）。
  const preview = JSON.parse((await fake.call('POST', '/dsh-contract-butler/init', { root })).body) as { preview: any }
  const ids = (preview.preview.candidates as any[]).map((c) => String(c.id))
  assert.ok(ids.length > 1, '预览要给得出候选')
  assert.deepEqual(await includeOf(), full, '不带 confirm 的 /init 必须只读，不许改 include')

  // 缩到一半：替换语义在这里是**真的**（这条也顺手钉住了"只发一部分会掉老的"）。
  const half = ids.slice(0, Math.max(1, Math.floor(ids.length / 2)))
  await fake.call('POST', '/dsh-contract-butler/init', { root, include: half, confirm: true })
  const shrunk = await includeOf()
  assert.ok(shrunk.length < full.length, '显式给 include 时是替换：给小了就真的变小')

  // 面板那一块提交的是并集：现有 ∪ 新勾。
  const add = ids.filter((id) => !half.includes(id))
  const union = [...half, ...add]
  await fake.call('POST', '/dsh-contract-butler/init', { root, include: union, confirm: true })
  const merged = await includeOf()
  assert.equal(merged.length, union.length, '并集要整份进去')
  for (const id of half) assert.ok(merged.includes(id), '老的一条都不许掉——只发新勾就会闯这个祸')
  for (const id of add) assert.ok(merged.includes(id), '新勾的也要进去')

  // 下一次扫描（增量重扫）之后，include 不该变。
  const scan = await fake.call('POST', '/dsh-contract-butler/rescan', { project: projectId })
  assert.equal(scan.status, 200, `重扫要成：${scan.body.slice(0, 200)}`)
  const after = await includeOf()
  for (const id of union) assert.ok(after.includes(id), '重扫之后 include 里还得有它')
  assert.equal(after.length, merged.length, '重扫不该动 include')
})

test('生成弹窗：网格布局 + 目录块（只加不减、提交并集）+ 右下角不说"批"', () => {
  const html = panelHtml()

  // 1) 弹窗是网格卡片，不是单列堆叠；两列并排，窄屏塌成一列。
  assert.ok(html.includes("el('div', { class: 'gengrid' }"), '生成弹窗要用网格容器')
  const grid = html.slice(html.indexOf('.gengrid {'), html.indexOf('.gengrid {') + 700)
  assert.match(grid, /grid-template-columns:\s*minmax\(0,\s*1fr\)\s*minmax\(0,\s*1fr\)/,
    '两列网格：左「这一步做什么」、右「在哪些目录上做」')
  assert.ok(html.includes('@media (max-width: 780px) { .gengrid { grid-template-columns: minmax(0, 1fr); } }'),
    '窄屏要塌成一列，不能挤成两条缝')
  // 通栏：按钮条 / 预告 / 作用范围 / 确认条都要横跨两列
  assert.match(html, /\.gengrid > \.genspan, \.gengrid > \.genfoot, \.gengrid > \.genplan,/,
    '通栏规则要写明')
  assert.ok(html.includes("class: 'gpl warn genspan'"), '「清掉重生成」的确认条要通栏')
  // 弹窗要用宽版（两列才有意义）
  assert.match(html, /openOverlay\('生成', el\('div', \{ class: 'gengrid' \}[\s\S]{0,1600}?\n      true\);/,
    '生成弹窗要按宽版打开')

  // 2) 目录块：显示 root 与"现在纳管了哪些目录"，但**只提供加**。
  /* 这一条在"极简化"那一轮**翻转过**：原来钉「在哪些目录上做」这个长句，用户要求标题短，
     而且整块从一张卡变成"这一步做什么"里的一行。 */
  assert.ok(html.includes("text: '目录'") || html.includes("'目录'"), '目录那一行的标题要短')
  /* B2：两卡等高。B1：作用范围那块不再挂进弹窗（范围由目录卡决定）。 */
  assert.ok(html.includes('.gengrid { align-items: stretch; }'), '网格要拉伸，两卡等高')
  assert.ok(html.includes('.gencard { height: 100%; min-height: 0; }'), '卡片要撑满那一行')
  assert.ok(!/scopeSec,\s*planBox,/.test(html), '作用范围那块不许再挂进弹窗')
  assert.ok(!html.includes('在哪些目录上做'), '那个长句标题不许再出现')
  /* 这一轮又翻转过：用户说"步骤太多、不需要那么多按钮"——「再加目录…」这一步删了，
     选择器**常显**在右侧那张卡里，点开弹窗就自动加载（不用先点一下才看到）。 */
  assert.ok(!html.includes('再加目录…'), '「再加目录…」这个多余步骤要删掉')
  assert.ok(!html.includes("dirPick.style.display = 'none'"), '选择器要常显，不许默认藏起来')
  assert.ok(html.includes('loadDirs();'), '打开弹窗就要自动把目录读出来')
  /* 预勾口径回归：目录树节点是逐段嵌套的（name 只是单段、完整路径在 path），
     而已纳管集合的键是完整目录路径——早先按 node.name 比，预勾永远是 0（活体量到勾选数 0）。 */
  assert.ok(html.includes('managed[node.path || node.name]'), '预勾要比完整目录路径，不是单段节点名')
  /* A1 的硬证据：变更钩子挂在容器上（事件委托），不依赖 setDir 尾部、也不怕重画换对象。 */
  assert.ok(html.includes("rowsBox.addEventListener('change', function () { DG.dirty = true;"),
    '勾选变化必须能置上 dirty（事件委托，别依赖 setDir 尾部）')
  assert.ok(html.includes('if (!DG.dirty || !DG.pick) { run(); return; }'), '主按钮靠 dirty 决定走不走进写回')
  /* 翻转过：加载态从「正在读目录…」压成「读取中…」（用户要求删说明、压到最短）。 */
  assert.ok(html.includes('读取中…'), '加载中要说人话（压短后也得有）')
  assert.ok(html.includes('DG.pick.locked[node.name] = true'), '已纳管目录要预勾并锁住')
  /* A2：已纳管目录两条口径取并集——契约记录的 file + include 里候选自带的 file。 */
  assert.ok(html.includes('it.contract.file'), '要用契约记录自己的 file 归纳已纳管目录')
  assert.ok(html.includes('managed[dirNameOf(f)] = true'), '两条口径要并起来找目录')
  assert.ok(html.includes('pk.locked') && html.includes('onLocked'), '锁住要有视觉与一句轻提示')
  /* 也翻转过：卡面上不许再写"只能加，不能减"这种解释——规则说明只放选择器里那一句。 */
  assert.ok(!html.includes('只能加，不能减'), '卡面上不许再出现"只能加，不能减"')
  /* 本轮翻转：用户要求"删除大部分说明"，手填框的占位语从"路径读不到？填绝对路径后回车"压到"绝对路径，回车"。
     要求本身没变：手填绝对路径必须在，且**不给它单独按钮**（回车即勾上）。 */
  assert.ok(html.includes("placeholder: '绝对路径，回车'"), '手填绝对路径留着（回车即勾上，不给它单独按钮）')
  assert.ok(!html.includes('路径读不到？填绝对路径后回车'), '那条解释性占位语要删掉')
  // 已纳管范围是**展示用**：从契约 file 归纳，写回永远用 id。
  assert.ok(html.includes('function renderDirFact()'), '已纳管范围要归纳成一行事实')
  assert.ok(!html.includes('真正的依据是候选 id'), '不许在界面上讲实现（id / 并集 / 替换）')
  assert.ok(html.includes("return '（运行时）';"), '没有 file 的那几条也要有归宿，不能凭空消失')
  // 只读预览拿候选：POST /init 不带 confirm。
  assert.match(html, /api\('\/init', \{ method: 'POST', body: \{ root: S\.p\.root \} \}\)/,
    '扫目录只走只读预览（不带 confirm）')
  // 复用纳管那套目录树：同一份 S.init / S.pick 状态与同一套勾父连子。
  assert.ok(html.includes('S.init = pv;'), '目录树要接上纳管那套状态')
  assert.ok(html.includes('S.pick = DG.pick;'), '目录树要接上纳管那套勾选状态')
  assert.ok(html.includes('setDir(node, true);'), '手填路径也要走同一套勾选（勾父连子）')

  // 3) 提交必须是并集，而且绝不能只发新勾的；提交点是**主按钮**，不再是自己的小按钮。
  /* 这一轮翻转过：原来量的是「并入」那个独立按钮，用户说"不需要那么多按钮"——
     勾选就是界面状态，由主按钮「开始生成」一次生效（并集 ∪ 这一档的扫法 ∪ 要不要补 AI）。 */
  const goAt = html.indexOf("go.addEventListener('click'")
  assert.ok(goAt > 0, '要找到主按钮的提交点')
  const save = html.slice(goAt, goAt + 2400)
  assert.ok(save.includes('var union = includeIds();'), '提交前要先读出现有的 id（并集的左半边）')
  assert.ok(save.includes('if (DG.pick.picked[c.id] && union.indexOf(c.id) < 0) union.push(c.id);'),
    '新勾的并进现有，不许去重掉老的')
  assert.ok(save.includes('include: union, confirm: true'), '提交的是并集 + confirm')
  assert.ok(save.includes('if (!DG.dirty || !DG.pick) { run(); return; }'), '没动过就不写回（避免无声扩大）')
  assert.ok(save.includes('mode: G.mode'), '跑的是弹窗里选定的那一档（默认增量重扫）')
  assert.ok(!/include: picked/.test(html), '绝不能只提交新勾的那几条（那会把老的一整组挤掉）')
  assert.ok(!html.includes('并入并补中文说明'), '长按钮名不许再出现')
  assert.ok(!html.includes("text: '并入'"), '「并入」这个单独动作已经不存在了（勾选即状态）')
  assert.ok(!html.includes('dirSave'), '那个独立提交按钮已经删掉了')
  assert.ok(!html.includes('dirAdd'), '「再加目录…」那个按钮也已经删掉了')
  assert.ok(save.includes('return loadProjects();'), '写回后要先刷新项目记录（include 变了）')
  // 不给"取消纳管"的入口：那是另一件事，要先给代价与确认。
  assert.ok(!html.includes('并入时发的是'), '卡面上不许讲并集/载荷')
  /* 这一轮翻转过：用户说"说明太多没必要"——那句规则小字删了，改由锁定徽标（已纳管）自己说明；
     "点了已纳管目录"仍给一句轻提示，避免误操作。 */
  assert.ok(!html.includes('只会增加，不会移除已纳管的目录'), '那句规则小字要删掉（用户要求少说明）')
  assert.ok(html.includes('已经纳管了，这块只能加不能减'), '误点已纳管目录时仍给一句轻提示')
  assert.ok(!/dirRemove|removeDir|取消纳管/.test(html), '这块里不许出现移除已纳管目录的入口')

  // 4) 右下角说人话：全文件不许再出现"批"这个字。
  assert.ok(!html.includes('批'), '右下角与注释里都不许再出现"批/批次/分批"')
  assert.ok(html.includes("'模型：' + result.channels.join('、')"), '通道要改叫"模型："')
  assert.ok(html.includes("'正在准备…'"), '数字没到就说"正在准备…"，不猜')
  assert.ok(html.includes('正在为 '), '标题要说人话：正在为 a、b 生成中文说明')
  assert.ok(html.includes('（已完成 '), '进度要写"已完成 5 / 12 条"这种条数口径')
  assert.ok(!html.includes('第 N / M'), '旧的"第 N / M"字样不许再留')
})
