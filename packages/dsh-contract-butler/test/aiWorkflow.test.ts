/**
 * AI 理解工作流的测试：从"宿主模型返回"一路测到"契约记录"。
 *
 * 这个文件刻意**不用网络、不用密钥、不用配置文件**：假模型就是宿主 `llm` 服务的一个替身，
 * 挂在假 ctx 上（`fake.mount('llm', …)`）。之所以能这么测，是因为插件这一侧已经没有自建管道了——
 * 它只认 `ctx.get('llm')` 这个服务面，所以"假宿主"就等于"假模型"，而且测的正是真那条路：
 * 路由 → 宿主服务 → 严格校验 → 缓存 → 写回契约。真模型只在"人肉实测"那一轮用。
 *
 * 覆盖的五件事，正好是这个工作流最容易做错的地方：
 * 1. 不合格**整批拒绝**：原因与模型原始返回都要回显，而且一个字都不许写进库；
 * 2. 缓存按内容哈希：第二次不问模型；内容变了才问；
 * 3. 写回**不覆盖原始 title**（符号名留着给人 grep）；
 * 4. 宿主 AI 面缺席（没挂 llm / 没有可用 provider / 指名模型不存在）时是明确的 503 + 可读原因，
 *    而不是"悄悄没有中文"，更不是插件自己另起一条通道；
 * 5. 挑路由只认宿主的事实（默认模型、已注册 provider），插件自己维护的模型名单已经作废。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { apply } from '../lib/index.js'
import { aiKey } from '../lib/store.js'
import { PersistentAiCache, understandContracts } from '../lib/aiWorkflow.js'
import type { ContractRecord } from '../lib/types.js'
import { contentHash, understand, type AiField, type ContractSeed } from '../src/understand.ts'
import { fakeCtx, type RouteSpec } from './fakeHost.ts'
import { MemoryDomain, memoryFacility, schemaCheckedFacility } from './fake.ts'
import { fieldsFromPrompt, seedsFromPrompt } from './aiFixture.ts'

/* ---------- 临时项目（与 wiring.test.ts 同一套做法） ---------- */

const PROTO = `syntax = "proto3";
package shop.v1;
message User {
  string id = 1;
  string name = 2;
  int32 age = 3;
}
message Order {
  string id = 1;
  string user_id = 2;
  repeated Item items = 3;
}
message Item {
  string sku = 1;
  int32 count = 2;
}
`

function makeProject(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'butler-ai-'))
  fs.writeFileSync(path.join(root, 'shop.proto'), PROTO)
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

/** 装好插件、纳管一个临时项目，返回项目 id 与契约。 */
async function mountWithProject(config: Record<string, unknown> = {}): Promise<{
  fake: Fake
  root: string
  projectId: string
  contracts: ContractRecordLike[]
}> {
  const root = makeProject()
  const fake = fakeCtx()
  const { facility } = memoryFacility()
  apply(fake.ctx as never, { watchEnabled: false, introspectTools: false, ...config })
  fake.mount('storageDomain', facility)
  fake.mount('webServer', {
    register(spec: RouteSpec) {
      fake.routes.push(spec)
      return () => undefined
    },
  })
  /* 等领域打开（apply 内部是异步的）。必须等"存储就绪"这条日志，而不是干等固定毫秒数：
     并行跑整个套件时，固定等待会偶尔不够，`/init` 就会回一个空响应，然后 JSON.parse 炸在这里——
     那种失败看起来像插件的错，其实是测试自己抢跑。 */
  for (let index = 0; index < 400; index += 1) {
    await new Promise((resolve) => setTimeout(resolve, 5))
    if (fake.logs.some((line) => line.includes('存储就绪'))) break
  }
  assert.ok(fake.logs.some((line) => line.includes('存储就绪')), `存储没就绪，日志：${fake.logs.join(' | ')}`)
  const init = JSON.parse((await fake.call('POST', '/dsh-contract-butler/init', { root, confirm: true })).body)
  const projectId = String(init.result.project.id)
  const list = JSON.parse((await fake.call('GET', `/dsh-contract-butler/contracts?project=${projectId}`)).body)
  return { fake, root, projectId, contracts: list.contracts.map((item: { contract: ContractRecordLike }) => item.contract) }
}

interface ContractRecordLike {
  id: string
  symbol: string
  title: string
  file: string
  /** 扫描出来的形状：AI 只许在旁边加中文，形状本身一个字都不许动。 */
  input?: { kind: string; fields?: Record<string, unknown> } | null
  output?: { kind: string; fields?: Record<string, unknown> } | null
  aiTitle?: string
  aiFamily?: string
  aiFields?: AiField[]
  aiHash?: string
  aiAt?: number
  aiRelations?: { to: string; rel: string; why: string }[]
}

type Fake = ReturnType<typeof fakeCtx>

/* ---------- 假宿主：llm 服务 ---------- */

/** 宿主流协议里我们认得的那两块（与 `hostAi.ts` 的读法一致，不是另编一套）。 */
interface Chunk {
  type: string
  text?: string
  reason?: { kind: string; failure?: { message: string; code: string } }
}

type Mode = 'ok' | 'bad-rel' | 'no-chinese' | 'missing' | 'boom' | 'max-tokens' | 'tool-calls' | 'fenced' | 'prose'

interface FakeLlm {
  stream(options: Record<string, unknown>): AsyncIterable<Chunk>
  listProviders(): { id: string; name: string }[]
  /**
   * 形状照抄真宿主：`llm.listModels()` 给的是**模型元数据对象**（`{provider, id, name}`，
   * 见 `dsh-llm/lib/index.js:2018`）。假服务要是图省事只给字符串，测出来的"绿"就假了——
   * 真机上会一条都看不见，自动换 provider 那条路直接失效。
   */
  listModels(provider: string): Promise<{ provider: string; id: string; name: string }[]>
}

/**
 * 一个会说人话的假模型：从请求里把这一批契约的 id 与**字段**抠出来，按模式回一个 JSON。
 *
 * 抠的方式与真模型看到的东西一致（同一段提示词，见 `aiFixture.ts`），所以"返回里的 id 属于本批"
 * "字段一个不缺"这两件事在假模型里也是真的成立/不成立，而不是测试自己编的。
 */
function fakeLlm(mode: Mode = 'ok', options: {
  models?: string[] | Record<string, string[]>
  delayMs?: number
  /** 这些 provider 上的线"发不出去"：照真机那样抛 `no adapter registered for provider`。 */
  dead?: string[]
  providers?: { id: string; name: string }[]
} = {}): {
  service: FakeLlm
  calls: () => number
  lastOptions: () => Record<string, unknown> | null
  lastUser: () => string
} {
  let calls = 0
  let lastOptions: Record<string, unknown> | null = null
  let lastUser = ''
  const providers = options.providers ?? [{ id: 'skynet', name: 'Skynet 网关' }]
  const catalog: Record<string, string[]> =
    options.models === undefined || Array.isArray(options.models)
      ? { skynet: options.models ?? ['fake-model'] }
      : options.models
  const dead = new Set(options.dead ?? [])
  /* 真模型是要花时间的（几百毫秒到几秒）。假模型默认瞬时返回，但"缓存命中就不该比问模型慢"
     这类断言需要一点真实延迟才有意义——`delayMs` 就是给它们的。 */
  const delayMs = options.delayMs ?? 0

  const service: FakeLlm = {
    listProviders: () => providers,
    listModels: async (provider: string) =>
      (catalog[provider] ?? []).map((id) => ({ provider, id, name: id })),
    async *stream(options: Record<string, unknown>): AsyncIterable<Chunk> {
      calls += 1
      lastOptions = options
      lastUser = userTextOf(options)
      const provider = String(options.provider ?? '')
      /* 没注册 adapter 的线：宿主是在 stream 里抛的（真机上的原话就是这个）。 */
      if (dead.has(provider)) throw new Error(`no adapter registered for provider "${provider}"`)
      if (delayMs > 0) await new Promise((resolve) => setTimeout(resolve, delayMs))
      if (mode === 'boom') throw new Error('quote exceeded for this provider')
      const seeds = seedsFromPrompt(lastUser)
      const payload = JSON.stringify({ items: itemsFor(mode, seeds, fieldsFromPrompt(lastUser)) })
      if (mode === 'max-tokens') {
        /* 截断的典型样子：先吐了半截 JSON，然后终止原因是 max-tokens。 */
        yield { type: 'text-delta', text: payload.slice(0, 20) }
        yield { type: 'finish', reason: { kind: 'max-tokens' } }
        return
      }
      if (mode === 'tool-calls') {
        yield { type: 'finish', reason: { kind: 'tool-calls' } }
        return
      }
      /* 围栏：模型很爱干这件事（提示词里写了"不要"，但它不一定听）。 */
      const wrapped = mode === 'fenced' ? '```json\n' + payload + '\n```' : mode === 'prose' ? `好的，结果如下：\n${payload}\n希望有帮助。` : payload
      /* 分两块吐出来：宿主是**流**，插件必须自己把 text-delta 拼起来（拼错就会丢掉后半段）。 */
      yield { type: 'text-delta', text: wrapped.slice(0, 24) }
      yield { type: 'text-delta', text: wrapped.slice(24) }
      yield { type: 'finish', reason: { kind: 'stop' } }
    },
  }
  return { service, calls: () => calls, lastOptions: () => lastOptions, lastUser: () => lastUser }
}

/** 从一条 user 消息里取纯文本（与宿主消息形状一致）。 */
function userTextOf(options: Record<string, unknown>): string {
  const messages = Array.isArray(options.messages) ? (options.messages as Record<string, unknown>[]) : []
  const parts: string[] = []
  for (const message of messages) {
    const content = Array.isArray(message.content) ? (message.content as Record<string, unknown>[]) : []
    for (const block of content) if (block.type === 'text' && typeof block.text === 'string') parts.push(block.text)
  }
  return parts.join('\n')
}

/**
 * 一个"合格答案"长什么样：id + 中文职责 + 中文族名 + **种子里每个字段的中文**。
 *
 * 字段照提示词里给出的字段回（`fieldsFromPrompt`），不手抄：字段级中文少一个就是整批拒绝，
 * 手抄的清单迟早会跟扫描出来的字段分叉，那时的红看着像插件坏了，其实是假模型答错了卷。
 *
 * 想造拒收用的那一批，就把毛病收在这一处：标题不是中文 / 关系词非法 / 少答一条，各一个模式——
 * 别的部分照样答满，这样测试断言的那个原因才是**唯一**的毛病。
 */
function itemsFor(mode: Mode, seeds: ContractSeed[], fields: Map<string, AiField[]>): Record<string, unknown>[] {
  const items = seeds.map((seed) => {
    const id = seed.id
    /* 这一条要答的字段；种子里没有字段的契约就是空数组（那就一条都不写）。 */
    const mine = fields.get(id) ?? []
    if (mode === 'bad-rel') {
      return { id, titleZh: `中文职责 ${id}`, family: '测试族', fields: mine, relations: [{ to: seeds[0]?.id ?? id, rel: 'depends-on', why: '非法关系词' }] }
    }
    /* 英文标题：这道闸门在字段之前，所以字段照样答齐，测的就是"标题不是中文"。 */
    if (mode === 'no-chinese') return { id, titleZh: `does something ${id}`, family: '测试族', fields: mine }
    return { id, titleZh: `负责 ${id} 的那件事`, family: '测试族', fields: mine, relations: [] }
  })
  /* 少写一条：模型漏答。不算拒收，但那一条不写回、不进缓存。 */
  if (mode === 'missing') items.pop()
  return items
}

/**
 * 把假 AI 面挂到假宿主上。
 *
 * `defaultModel: false` 模拟"宿主挂了 llm 但没给默认模型"；`llm: false` 模拟"宿主压根没有 llm 服务"
 * （独立跑 dev-server 就是这一种）。两者都必须是**可读的失败**，不是悄悄降级。
 */
function mountAi(
  fake: Fake,
  llm: ReturnType<typeof fakeLlm> | null,
  options: { defaultModel?: { provider: string; model: string } | false } = {},
): void {
  if (llm !== null) fake.mount('llm', llm.service)
  const selection = options.defaultModel ?? { provider: 'skynet', model: 'fake-model' }
  if (selection !== false) fake.mount('agentDefaultModel', { currentSelection: () => selection })
}

/** 断言用：拿一条契约记录（路由返回的列表里）。 */
async function contractById(fake: Fake, projectId: string, id: string): Promise<ContractRecordLike> {
  const list = JSON.parse((await fake.call('GET', `/dsh-contract-butler/contracts?project=${projectId}`)).body)
  return list.contracts.map((item: { contract: ContractRecordLike }) => item.contract).find((c: ContractRecordLike) => c.id === id)
}

/* ---------- 路由：整体链路 ---------- */

test('路由：AI 返回合格 → 写回 aiTitle / aiFamily，且原始 title 一个字不动', async () => {
  const { fake, projectId, contracts } = await mountWithProject()
  const llm = fakeLlm('ok')
  mountAi(fake, llm)

  const response = await fake.call('POST', '/dsh-contract-butler/understand', { projectId })
  assert.equal(response.status, 200, response.body)
  const data = JSON.parse(response.body)
  assert.equal(data.ok, true)
  assert.equal(data.summary.understood, contracts.length)
  assert.equal(data.summary.cached, 0)
  assert.equal(data.summary.failures.length, 0)
  assert.equal(llm.calls(), 1, '四条契约一批就够')
  // 回显用的"通道"就是宿主那条路由，而不是插件自己编的名字。
  assert.deepEqual(data.summary.channels, ['skynet · fake-model'])
  // 提示词是原样送出去的：system 与 user 两段都在，且 system 不是空的。
  const options = llm.lastOptions()
  assert.equal(typeof options?.system, 'string')
  assert.ok(String(options?.system).length > 0, 'system 段要送过去')
  assert.equal(options?.provider, 'skynet')
  assert.equal(options?.model, 'fake-model')
  assert.equal(typeof options?.maxTokens, 'number')

  const after: ContractRecordLike[] = data.contracts.map((item: { contract: ContractRecordLike }) => item.contract)
  for (const contract of after) {
    assert.ok(contract.aiTitle && contract.aiTitle.length > 0, '每条都该有 AI 中文职责')
    assert.equal(contract.aiFamily, '测试族')
    assert.ok(contract.aiHash && contract.aiHash.length === 16, 'aiHash 是内容哈希')
    // 最关键的一条：原始符号名不许被 AI 结果盖掉（那是给人 grep 的名字）。
    const before = contracts.find((c) => c.id === contract.id)
    assert.equal(contract.title, before?.title)
    assert.equal(contract.title, before?.symbol)
  }
})

test('路由：字段级中文写进 aiFields，而原始符号名与形状一个字不动', async () => {
  const { fake, projectId, contracts } = await mountWithProject()
  const llm = fakeLlm('ok')
  mountAi(fake, llm)

  const response = await fake.call('POST', '/dsh-contract-butler/understand', { projectId })
  assert.equal(response.status, 200, response.body)

  /* 该写回什么，从假模型看到的那段提示词里算——断言照"合同"来，不是照实现抄的。 */
  const answer = fieldsFromPrompt(llm.lastUser())
  const after: ContractRecordLike[] = JSON.parse(response.body).contracts.map(
    (row: { contract: ContractRecordLike }) => row.contract,
  )
  assert.equal(after.length, contracts.length)
  let withFields = 0
  for (const record of after) {
    const before = contracts.find((one) => one.id === record.id)
    const want = answer.get(record.id) ?? []
    if (want.length === 0) {
      /* 种子里没有字段的契约：那就没有字段中文可写，也不许凭空造一个。 */
      assert.equal(record.aiFields, undefined, `${record.id}：种子里没有字段就不该有 aiFields`)
    } else {
      withFields += 1
      assert.deepEqual(record.aiFields, want, `${record.id} 的字段中文要按种子顺序逐字写回`)
      /* 只加不改：字段中文只进 aiFields，扫描出来的字段名一个不多一个不少。 */
      const shapeNames = new Set([
        ...Object.keys(record.input?.fields ?? {}),
        ...Object.keys(record.output?.fields ?? {}),
      ])
      for (const field of record.aiFields ?? []) {
        assert.ok(shapeNames.has(field.name), `字段中文只能加在扫描到的字段上：${field.name}`)
      }
    }
    /* 形状是扫描的事实，AI 那一路一个字都不许动它（不只是"没多字段"，是逐字节相同）。 */
    assert.equal(JSON.stringify(record.input), JSON.stringify(before?.input), '输入形状不许被动过')
    assert.equal(JSON.stringify(record.output), JSON.stringify(before?.output), '输出形状不许被动过')
    assert.equal(record.title, before?.title, '原始标题不动')
    assert.equal(record.symbol, before?.symbol, '原始符号名不动')
  }
  assert.ok(withFields > 0, '这个项目里的契约都该拿到字段中文')
})

test('路由：非法 rel → 整批拒绝、422、回显原因与原始返回，库里一个字都没写', async () => {
  const { fake, projectId, contracts } = await mountWithProject()
  const llm = fakeLlm('bad-rel')
  mountAi(fake, llm)

  const response = await fake.call('POST', '/dsh-contract-butler/understand', { projectId })
  assert.equal(response.status, 422, `应当是校验失败的状态码，实际 ${response.status}：${response.body}`)
  const data = JSON.parse(response.body)
  assert.match(String(data.error), /没有一批通过校验/)
  assert.match(String(data.error), /关系不合法/)
  assert.equal(data.detail.failures.length, 1, '只有一批，被拒绝了')
  const failure = data.detail.failures[0]
  assert.match(String(failure.why), /关系不合法/)
  assert.match(String(failure.raw), /depends-on/, '模型原始返回要原样回显')
  assert.equal(failure.ids.length, contracts.length)

  // 拒绝 = 不写。契约记录上没有 AI 结果，缓存表也是空的。
  const list = JSON.parse((await fake.call('GET', `/dsh-contract-butler/contracts?project=${projectId}`)).body)
  for (const item of list.contracts) {
    assert.equal(item.contract.aiTitle, undefined, '被拒绝的批次不许留下任何中文')
    assert.equal(item.contract.aiHash, undefined)
  }
  const status = JSON.parse((await fake.call('GET', '/dsh-contract-butler/status')).body)
  assert.equal(status.understand.available, true, 'AI 面是通的，失败纯粹是校验拒绝')
  assert.equal(status.understand.channels.length > 0, true)
  assert.equal(status.understand.path, 'host-llm')
})

test('路由：英文标题也被拒（要的就是中文职责，不接受的不是"格式"而是"没做到"）', async () => {
  const { fake, projectId } = await mountWithProject()
  mountAi(fake, fakeLlm('no-chinese'))

  const response = await fake.call('POST', '/dsh-contract-butler/understand', { projectId })
  assert.equal(response.status, 422)
  assert.match(JSON.parse(response.body).error, /不含中文/)
})

test('路由：模型少写几条 → 不算拒绝，但如实报出来且不写回', async () => {
  const { fake, projectId, contracts } = await mountWithProject()
  mountAi(fake, fakeLlm('missing'))

  const response = await fake.call('POST', '/dsh-contract-butler/understand', { projectId })
  assert.equal(response.status, 200, response.body)
  const data = JSON.parse(response.body)
  assert.equal(data.summary.missing.length, 1, '少写的那一条要报出来')
  assert.equal(data.summary.understood, contracts.length - 1)
  assert.equal(data.summary.ok, true, '少写不是"不合格"，是不写')
  const list = JSON.parse((await fake.call('GET', `/dsh-contract-butler/contracts?project=${projectId}`)).body)
  const bare = list.contracts.filter((item: { contract: ContractRecordLike }) => !item.contract.aiTitle)
  assert.equal(bare.length, 1, '模型没说的那条不许被补上')
})

test('路由：缓存按内容哈希 —— 第二次一条都不问模型，耗时归零', async () => {
  const { fake, projectId, contracts } = await mountWithProject()
  /* 给假模型一点真实延迟：这样"命中缓存更快"才是一条有信号的断言，而不是拿两次瞬时操作比
     毫秒噪声（旧实现靠网络的天然延迟凑出这个信号，那条路已经不在了）。 */
  const llm = fakeLlm('ok', { delayMs: 40 })
  mountAi(fake, llm)

  const first = JSON.parse((await fake.call('POST', '/dsh-contract-butler/understand', { projectId })).body)
  assert.equal(first.summary.cached, 0)
  assert.equal(first.summary.requested, contracts.length)
  assert.ok(first.summary.ms >= 40, `问过模型就该有这个量级的耗时，实际 ${first.summary.ms}`)
  const callsAfterFirst = llm.calls()

  const second = JSON.parse((await fake.call('POST', '/dsh-contract-butler/understand', { projectId })).body)
  assert.equal(second.summary.cached, contracts.length, '内容没变 → 全部命中缓存')
  assert.equal(second.summary.requested, 0)
  assert.equal(second.summary.batches, 0, '没有要问的批次')
  assert.equal(llm.calls(), callsAfterFirst, '第二次一个请求都不该发出去')
  assert.ok(second.summary.ms <= first.summary.ms, `命中缓存不该比问模型慢：${second.summary.ms} vs ${first.summary.ms}`)
})

test('路由：契约内容变了 → 哈希变了 → 只有它重新问模型', async () => {
  const { fake, root, projectId, contracts } = await mountWithProject()
  const llm = fakeLlm('ok')
  mountAi(fake, llm)

  await fake.call('POST', '/dsh-contract-butler/understand', { projectId })
  const callsAfterFirst = llm.calls()

  // 改一个字段：同一条契约的内容变了。
  fs.writeFileSync(path.join(root, 'shop.proto'), PROTO.replace('int32 age = 3;', 'int32 age = 3;\n  string nickname = 4;'))
  await fake.call('POST', '/dsh-contract-butler/rescan', { project: projectId })
  const third = JSON.parse((await fake.call('POST', '/dsh-contract-butler/understand', { projectId })).body)
  assert.equal(llm.calls(), callsAfterFirst + 1, '只有变过的那条重新问')
  assert.ok(third.summary.cached >= contracts.length - 1, `没变的都该命中缓存，实际 ${third.summary.cached}`)
  assert.equal(third.summary.requested, 1)
})

test('路由：force 忽略缓存，全部重问', async () => {
  const { fake, projectId, contracts } = await mountWithProject()
  const llm = fakeLlm('ok')
  mountAi(fake, llm)

  await fake.call('POST', '/dsh-contract-butler/understand', { projectId })
  const after = llm.calls()
  const forced = JSON.parse((await fake.call('POST', '/dsh-contract-butler/understand', { projectId, force: true })).body)
  assert.equal(forced.summary.cached, 0)
  assert.equal(forced.summary.requested, contracts.length)
  assert.ok(llm.calls() > after)
})

test('路由：单条重新理解（详情页那个入口）只动这一条', async () => {
  const { fake, projectId, contracts } = await mountWithProject()
  mountAi(fake, fakeLlm('ok'))

  const target = contracts[0] as ContractRecordLike
  const response = JSON.parse(
    (await fake.call('POST', '/dsh-contract-butler/understand', { projectId, contractIds: [target.id], force: true })).body,
  )
  assert.equal(response.summary.total, 1)
  assert.equal(response.summary.understood, 1)
  const list = JSON.parse((await fake.call('GET', `/dsh-contract-butler/contracts?project=${projectId}`)).body)
  const withAi = list.contracts.filter((item: { contract: ContractRecordLike }) => item.contract.aiTitle)
  assert.equal(withAi.length, 1)
  assert.equal(withAi[0].contract.id, target.id)
})

test('路由：入参与状态的边界（400 / 404 / 405）', async () => {
  const { fake, projectId } = await mountWithProject()
  const llm = fakeLlm('ok')
  mountAi(fake, llm)

  assert.equal((await fake.call('POST', '/dsh-contract-butler/understand', {})).status, 400, '缺 projectId')
  assert.equal((await fake.call('POST', '/dsh-contract-butler/understand', { projectId: 'p_nope' })).status, 404)
  assert.equal(
    (await fake.call('POST', '/dsh-contract-butler/understand', { projectId, contractIds: ['c_nope'] })).status,
    404,
    '指名要理解的契约不存在',
  )
  assert.equal((await fake.call('GET', '/dsh-contract-butler/understand')).status, 405, 'GET 不允许')
  assert.equal(llm.calls(), 0, '上面这些请求一个都不该打到模型')
})

/* ---------- 宿主 AI 面：缺席与挑路由 ---------- */

test('宿主面：没挂 llm 服务 → 503 + 可读原因，且没有任何本地补写', async () => {
  const { fake, projectId } = await mountWithProject()
  // 独立跑 dev-server 就是这一种：没有宿主，就没有 AI。不许静默降级，更不许自建通道。
  mountAi(fake, null)

  const response = await fake.call('POST', '/dsh-contract-butler/understand', { projectId })
  assert.equal(response.status, 503, response.body)
  const data = JSON.parse(response.body)
  assert.match(String(data.error), /没有提供 llm 服务/, '说清缺的是哪个服务')
  assert.match(String(data.error), /dsh-llm/, '说清缺的是谁提供的')
  assert.match(String(data.error), /不自建通道/, '说清插件的立场')

  const list = JSON.parse((await fake.call('GET', `/dsh-contract-butler/contracts?project=${projectId}`)).body)
  for (const item of list.contracts) assert.equal(item.contract.aiTitle, undefined, '没有 AI 就没有中文，不许编')

  // 状态里也如实说：不可用 + 原因（面板据此显示失败原因）。
  const status = JSON.parse((await fake.call('GET', '/dsh-contract-butler/status')).body)
  assert.equal(status.understand.available, false)
  assert.equal(status.understand.route, null)
  assert.deepEqual(status.understand.channels, [])
  assert.deepEqual(status.understand.fallbacks, [], '没有 AI 时备选也是空的（不是 undefined）')
  assert.match(String(status.understand.reason), /没有提供 llm 服务/)
})

test('宿主面：挂了 llm 但没有默认模型 → 退回宿主第一个已注册 provider，并记一条说明', async () => {
  const { fake, projectId } = await mountWithProject()
  const llm = fakeLlm('ok', { models: ['backup-model'] })
  mountAi(fake, llm, { defaultModel: false })

  const status = JSON.parse((await fake.call('GET', '/dsh-contract-butler/status')).body)
  assert.equal(status.understand.available, true)
  assert.equal(status.understand.route, 'skynet · backup-model')
  assert.deepEqual(status.understand.fallbacks, [], '只有一条候选时备选为空')
  assert.deepEqual(status.understand.providers, ['skynet'])
  assert.ok(
    status.understand.notes.some((note: string) => note.includes('agentDefaultModel')),
    `要说明为什么退回了第一条，实际：${JSON.stringify(status.understand.notes)}`,
  )

  const response = await fake.call('POST', '/dsh-contract-butler/understand', { projectId })
  assert.equal(response.status, 200, response.body)
  assert.equal(llm.calls(), 1)
})

test('宿主面：understandModel 指名就照办，指错了就 503 并列出宿主有什么', async () => {
  /* 指名成功：`provider:model` 直接用它，不参与任何"偏好表"。 */
  const pinned = await mountWithProject({ understandModel: 'skynet:other-model' })
  const llm = fakeLlm('ok', { models: ['fake-model', 'other-model'] })
  mountAi(pinned.fake, llm)
  const pinnedStatus = JSON.parse((await pinned.fake.call('GET', '/dsh-contract-butler/status')).body)
  assert.equal(pinnedStatus.understand.route, 'skynet · other-model')
  assert.equal((await pinned.fake.call('POST', '/dsh-contract-butler/understand', { projectId: pinned.projectId })).status, 200)
  assert.equal(llm.lastOptions()?.model, 'other-model', '发出去的就是指名那个模型')

  /* 指名的模型宿主没有 → 明确失败，不许悄悄换一个模型顶上。 */
  const unknownModel = await mountWithProject({ understandModel: 'no-such-model' })
  const llmB = fakeLlm('ok', { models: ['fake-model'] })
  mountAi(unknownModel.fake, llmB)
  const response = await unknownModel.fake.call('POST', '/dsh-contract-butler/understand', { projectId: unknownModel.projectId })
  assert.equal(response.status, 503, response.body)
  assert.match(JSON.parse(response.body).error, /都没有模型「no-such-model」/)
  assert.match(JSON.parse(response.body).error, /skynet/, '要列出宿主已注册的 provider')
  assert.equal(llmB.calls(), 0, '挑不出路由就不该发请求')

  /* 指名的 provider 宿主没注册 → 也是明确失败。 */
  const unknownProvider = await mountWithProject({ understandModel: 'nope:model' })
  mountAi(unknownProvider.fake, fakeLlm('ok'))
  const second = await unknownProvider.fake.call('POST', '/dsh-contract-butler/understand', { projectId: unknownProvider.projectId })
  assert.equal(second.status, 503, second.body)
  assert.match(JSON.parse(second.body).error, /没有注册 provider nope/)
})

test('宿主面：默认模型的 provider 没注册 adapter → 自动换成已注册 provider 上的同名模型，照常出中文', async () => {
  /* 真机上的那一次失败就是这条：宿主默认模型写着 `mmt-vision · deepseek-v4-flash-tencent`，
     而 llm 里没有 mmt-vision 的 adapter → 每批 no adapter registered → 整批 422。
     插件该做的是：模型名保留，换一个**注册过 adapter 的** provider 出去，并把这件事记进 notes。 */
  const { fake, projectId, contracts } = await mountWithProject()
  const llm = fakeLlm('ok', { models: ['deepseek-v4-flash-tencent'] })
  mountAi(fake, llm, { defaultModel: { provider: 'mmt-vision', model: 'deepseek-v4-flash-tencent' } })

  const response = await fake.call('POST', '/dsh-contract-butler/understand', { projectId })
  assert.equal(response.status, 200, response.body)
  assert.equal(llm.lastOptions()?.provider, 'skynet', '要换到注册过 adapter 的 provider')
  assert.equal(llm.lastOptions()?.model, 'deepseek-v4-flash-tencent', '模型名不许换')
  const summary = JSON.parse(response.body).summary
  assert.equal(summary.channels[0], 'skynet · deepseek-v4-flash-tencent')
  const first = await contractById(fake, projectId, contracts[0].id)
  assert.match(String(first.aiTitle), /[\u4e00-\u9fa5]/, '该写回的还是照写')
  assert.ok(fake.logs.some((line) => line.includes('没有注册 adapter')), '降级要留痕：' + fake.logs.join(' | '))
})

test('路由：limit 在分批之前就裁掉多余的契约（不是"第一批照样 24 条"）', async () => {
  const { fake, projectId, contracts } = await mountWithProject()
  assert.ok(contracts.length >= 3, '这个用例要靠多条契约才看得出裁剪')
  const llm = fakeLlm('ok')
  mountAi(fake, llm)

  const response = await fake.call('POST', '/dsh-contract-butler/understand', { projectId, limit: 2, force: true })
  assert.equal(response.status, 200, response.body)
  const summary = JSON.parse(response.body).summary
  assert.equal(summary.requested, 2, `只该问 2 条，实际 ${summary.requested}`)
  assert.equal(summary.batches, 1, '2 条只够一批')
  assert.deepEqual(summary.entries.map((entry: { symbol: string }) => entry.symbol), contracts.slice(0, 2).map((c) => c.symbol))
  for (const contract of contracts.slice(2)) {
    const record = await contractById(fake, projectId, contract.id)
    assert.equal(record.aiTitle, undefined, 'limit 之外的契约一个字都不该动')
  }

  // limit 是"这次最多几条"，不是"每批几条"：给 1 就只理解第一条。
  const one = JSON.parse((await fake.call('POST', '/dsh-contract-butler/understand', { projectId, limit: 1, force: true })).body)
  assert.equal(one.summary.requested, 1)
  // 非法 limit（0 / 负数 / NaN）当没给：不许变成"一条都不理解"。
  const zero = JSON.parse((await fake.call('POST', '/dsh-contract-butler/understand', { projectId, limit: 0, force: true })).body)
  assert.equal(zero.summary.requested, contracts.length)
})

test('宿主面：默认模型指着一个没注册 adapter 的 provider → 换已注册的线，照常出中文且说明换线', async () => {
  /* 真机现场（照抄）：`agentDefaultModel` = `mmt-vision · deepseek-v4-flash-tencent`，
     而 `llm.listProviders()` 里只有 deepseek-official / mmt / mmtv / mmtv-openai。
     插件该做的：避开 mmt-vision，在已注册的线里挑；**首选那条也发不出去时**按顺序换下一条。 */
  const { fake, projectId, contracts } = await mountWithProject()
  const llm = fakeLlm('ok', {
    providers: [
      { id: 'deepseek-official', name: 'DeepSeek' },
      { id: 'mmt', name: 'MMT' },
      { id: 'mmtv', name: 'MMTV' },
    ],
    models: {
      'deepseek-official': ['deepseek-chat'],
      mmt: ['deepseek-v4-flash-tencent'],
      mmtv: ['glm-5.3-flash'],
    },
    dead: ['mmt'], // 同名模型那条线在本机发不出去
  })
  mountAi(fake, llm, { defaultModel: { provider: 'mmt-vision', model: 'deepseek-v4-flash-tencent' } })

  const response = await fake.call('POST', '/dsh-contract-butler/understand', { projectId })
  assert.equal(response.status, 200, response.body)
  const summary = JSON.parse(response.body).summary
  assert.equal(summary.channels[0], 'deepseek-official · deepseek-chat', `实际用的是 ${summary.channels.join('、')}`)
  assert.equal(llm.lastOptions()?.provider, 'deepseek-official')
  const first = await contractById(fake, projectId, contracts[0].id)
  assert.match(String(first.aiTitle), /[\u4e00-\u9fa5]/, '换线之后照样要写回中文')
  assert.ok(fake.logs.some((line) => line.includes('没有注册 adapter')), '避开 mmt-vision 要留痕')
})

test('宿主面：understandProvider 钉死 provider；钉错了是 503，不会悄悄换一条', async () => {
  const { fake, projectId } = await mountWithProject({ understandProvider: 'mmtv' })
  const llm = fakeLlm('ok', {
    providers: [{ id: 'mmtv', name: 'MMTV' }, { id: 'mmt', name: 'MMT' }],
    models: { mmtv: ['glm-5.3-flash'], mmt: ['deepseek-v4-flash-tencent'] },
  })
  mountAi(fake, llm, { defaultModel: { provider: 'mmt', model: 'deepseek-v4-flash-tencent' } })

  const pinned = await fake.call('POST', '/dsh-contract-butler/understand', { projectId })
  assert.equal(pinned.status, 200, pinned.body)
  assert.equal(llm.lastOptions()?.provider, 'mmtv', '钉了 mmtv 就不许走 mmt（哪怕它是宿主默认）')
  assert.equal(llm.lastOptions()?.model, 'glm-5.3-flash', '没给模型就取它报出来的第一条')
  assert.equal(JSON.parse(pinned.body).summary.channels[0], 'mmtv · glm-5.3-flash')

  /* 钉一个宿主没注册的 provider：明确 503 + 说清宿主有什么，绝不换线。 */
  const wrong = await mountWithProject({ understandProvider: 'mmt-vision' })
  const llm2 = fakeLlm('ok', { providers: [{ id: 'mmtv', name: 'MMTV' }], models: { mmtv: ['glm-5.3-flash'] } })
  mountAi(wrong.fake, llm2)
  const failed = await wrong.fake.call('POST', '/dsh-contract-butler/understand', { projectId: wrong.projectId })
  assert.equal(failed.status, 503, failed.body)
  assert.match(JSON.parse(failed.body).error, /understandProvider「mmt-vision」/)
  assert.match(JSON.parse(failed.body).error, /没有注册 adapter/)
  assert.match(JSON.parse(failed.body).error, /mmtv/, '要列出宿主注册了什么')
  assert.equal(llm2.calls(), 0, '钉错了就不该发请求')
})

test('宿主面：宿主模型这一路失败（异常 / 截断 / 只会调工具）→ 批次失败并回显原因，不写回', async () => {
  /* 三种失败都必须是"这一批没成"，而不是"看起来成了"：
     - 宿主服务抛异常（额度用尽、网关挂了）；
     - 输出被 max_tokens 截断（半截 JSON 最危险）；
     - 模型只想调工具。
     同一批契约连着三种失败都要回显各自的原因，且一个字都不许写进库。 */
  const { fake, projectId, contracts } = await mountWithProject()
  for (const [mode, why] of [
    ['boom', /quote exceeded/],
    ['max-tokens', /max_tokens/],
    ['tool-calls', /调用工具/],
  ] as [Mode, RegExp][]) {
    mountAi(fake, fakeLlm(mode))
    const response = await fake.call('POST', '/dsh-contract-butler/understand', { projectId, force: true })
    assert.equal(response.status, 422, `${mode} 应当是 422，实际 ${response.status}：${response.body}`)
    const data = JSON.parse(response.body)
    assert.match(String(data.error), why, `${mode} 的原因要说清`)
    assert.equal(data.detail.failures.length, 1, mode)
    for (const contract of contracts) {
      const record = await contractById(fake, projectId, contract.id)
      assert.equal(record.aiTitle, undefined, `${mode}：失败了就不许有中文`)
    }
  }
})

test('路由：模型把 JSON 包在围栏里 → 脱掉照常收；包在散文里 → 照样拒（不替它找 JSON）', async () => {
  /* 围栏是**包装**问题（提示词明写了不要，但听不听是模型的事），脱掉就该照常收；
     而"从一堆散文里找一段 JSON"是另一回事——那种返回就是没按要求答，必须拒，且让用户看得见。 */
  const { fake, projectId, contracts } = await mountWithProject()
  mountAi(fake, fakeLlm('fenced'))
  const fenced = await fake.call('POST', '/dsh-contract-butler/understand', { projectId })
  assert.equal(fenced.status, 200, fenced.body)
  assert.equal(JSON.parse(fenced.body).summary.understood, contracts.length)
  const record = await contractById(fake, projectId, contracts[0].id)
  assert.match(String(record.aiTitle), /[\u4e00-\u9fa5]/, '脱了围栏就该写回中文')

  const prose = await mountWithProject()
  mountAi(prose.fake, fakeLlm('prose'))
  const rejected = await prose.fake.call('POST', '/dsh-contract-butler/understand', { projectId: prose.projectId })
  assert.equal(rejected.status, 422, rejected.body)
  assert.match(JSON.parse(rejected.body).error, /不是合法 JSON/)
})

/* ---------- 引擎与缓存：不经路由的部分 ---------- */

test('引擎：关系指向未知契约 / 关系词非法 / 没有中文族名，都是整批拒绝', async () => {
  const { contracts } = await mountWithProject()
  const record = contracts[0] as ContractRecordLike
  const full = (contracts as ContractRecordLike[]).map((c) => ({
    ...c,
    input: null,
    output: { kind: 'object' as const, fields: { id: { kind: 'string' as const } } },
    twins: [],
    aiRelations: undefined,
  }))
  const store = (await mountStore()).store

  const cases: { name: string; items: unknown; why: RegExp }[] = [
    {
      name: '关系指向未知契约',
      items: [{ id: record.id, titleZh: '中文职责', family: '测试族', relations: [{ to: 'c_missing', rel: 'imports', why: '瞎指' }] }],
      why: /关系指向未知契约/,
    },
    {
      name: '关系词非法',
      items: [{ id: record.id, titleZh: '中文职责', family: '测试族', relations: [{ to: record.id, rel: 'depends', why: '瞎写' }] }],
      why: /关系不合法/,
    },
    {
      name: '没有族名',
      items: [{ id: record.id, titleZh: '中文职责' }],
      why: /缺少 family/,
    },
  ]
  for (const item of cases) {
    const summary = await understandContracts({
      store,
      projectId: 'p_test',
      contracts: full.slice(0, 1) as never,
      caller: async (turn) => {
        /* 每个用例只留一处毛病：字段中文照提示词答齐，别让"缺字段"抢了本来要测的那个原因。 */
        const fields = fieldsFromPrompt(turn)
        const items = (item.items as Record<string, unknown>[]).map((one) => ({
          ...one,
          fields: fields.get(String(one['id'])) ?? [],
        }))
        return { text: JSON.stringify({ items }), channel: 'fake', ms: 1 }
      },
      batchSize: 20,
    })
    assert.equal(summary.ok, false, item.name)
    assert.equal(summary.failures.length, 1, item.name)
    assert.match(String(summary.failures[0]?.why), item.why, item.name)
    assert.equal(summary.understood, 0, `${item.name}：拒绝了就不许有结果`)
  }
})

test('持久化缓存：understand() 的 Map 换成落盘实现后，签名与行为都不变', async () => {
  const { store } = await mountStore()
  const seeds: ContractSeed[] = [
    { id: 'c_a', name: 'RefResolver', file: 'src/a.ts', fields: ['ref:string'], neighbours: [{ rel: 'same-file', id: 'c_b', name: 'RefTable' }] },
    { id: 'c_b', name: 'RefTable', file: 'src/a.ts', fields: ['keys:string[]'] },
  ]
  let calls = 0
  const caller = async (prompt: string, ids: readonly string[]) => {
    calls += 1
    const fields = fieldsFromPrompt(prompt)
    return { items: ids.map((id) => ({ id, titleZh: `负责 ${id} 的解析`, family: '引用解析', fields: fields.get(id) ?? [] })) }
  }

  const cache = new PersistentAiCache(store, 'p_test').warm(seeds)
  const first = await understand(seeds, { caller, cache, batchSize: 20 })
  assert.equal(first.ok, true)
  assert.equal(first.written, 2)
  const flushed = await cache.flush()
  assert.equal(flushed, 2, '新结果要落盘')

  // 缓存真的在 store 里：按契约 id 查得到，且哈希与内容对得上。
  const rowA = store.ai().get(aiKey('c_a'))
  assert.ok(rowA, 'ai 表里应当有这一行')
  assert.equal(rowA?.contractId, 'c_a')
  assert.equal(rowA?.hash, contentHash(seeds[0] as ContractSeed))
  assert.equal(rowA?.titleZh, '负责 c_a 的解析')
  assert.equal(calls, 1)

  // 第二次：换一个"重新预热"的缓存实例（模拟重启宿主），内容没变 → 一条都不问。
  const again = await understand(seeds, { caller, cache: new PersistentAiCache(store, 'p_test').warm(seeds), batchSize: 20 })
  assert.equal(again.ok, true)
  assert.equal(again.cached, 2, '重启后仍然命中：缓存是落盘的，不是内存里那点')
  assert.equal(again.asked, 0)
  assert.equal(calls, 1, '第二次没有再问模型')
})

/* ---------- 字段级中文：整批拒绝与缓存补齐（引擎这一侧） ---------- */

/**
 * 造一条够引擎用的合成契约。
 *
 * 这里刻意不走扫描：要测的是"25 条契约切成两批、其中一批被拒"这种**分批**行为，真扫一个临时项目
 * 只能扫出三四条，凑不出两批。字段名带上序号，断言时一眼能看出是哪条契约的哪个字段。
 */
function syntheticContract(index: number): ContractRecord {
  const tag = String(index).padStart(2, '0')
  return {
    id: `c_syn_${tag}`,
    projectId: 'p_test',
    file: 'src/syn.ts',
    boundary: `tool:syn_${tag}`,
    boundaryKind: 'tool',
    source: 'test',
    title: `Syn${tag}`,
    symbol: `Syn${tag}`,
    input: { kind: 'object', fields: { [`in_${tag}`]: { kind: 'string' } } },
    output: { kind: 'object', fields: { [`out_${tag}`]: { kind: 'number' } } },
    twins: [],
    evidence: { line: 1, hash: `h${tag}` },
    confidence: 1,
    createdAt: 0,
    updatedAt: 0,
  }
}

test('字段级中文：一条契约少答一个字段 → 那一批整批拒绝、零写回，别的批照常写', async () => {
  const { store } = await mountStore()
  const all = Array.from({ length: 25 }, (_, index) => syntheticContract(index))
  for (const contract of all) await store.contracts().put(contract.id, contract)
  /* 形状与符号名的"改前"快照：写回只许加 ai* 字段，别的一个字节都不许变。 */
  const frozen = new Map(
    all.map((contract) => [
      contract.id,
      JSON.stringify({ title: contract.title, symbol: contract.symbol, input: contract.input, output: contract.output }),
    ]),
  )
  /** 契约 id → 它所在那批的提示词：断言要照假模型看到的同一份"合同"来算。 */
  const prompts = new Map<string, string>()
  /** 被故意少答的那个字段名：从同一份"合同"里算出来，不硬编（顺序变了也不会误判）。 */
  let dropped = ''
  const caller = async (turn: { system: string; user: string }) => {
    const seeds = seedsFromPrompt(turn)
    const fields = fieldsFromPrompt(turn)
    for (const seed of seeds) prompts.set(seed.id, turn.user)
    return {
      text: JSON.stringify({
        items: seeds.map((seed) => {
          const mine = fields.get(seed.id) ?? []
          /* 只对 c_syn_00 少答一个字段：整批都该被拒，而不是"就那一条没中文"。 */
          const cut = seed.id === 'c_syn_00'
          if (cut) dropped = mine[0]?.name ?? ''
          return {
            id: seed.id,
            titleZh: `负责 ${seed.id} 的中文职责`,
            family: '合成族',
            fields: cut ? mine.slice(1) : mine,
            relations: [],
          }
        }),
      }),
      channel: 'fake',
      ms: 1,
    }
  }

  const summary = await understandContracts({ store, projectId: 'p_test', contracts: all, caller, batchSize: 20 })
  assert.equal(summary.batches, 2, '25 条按每批 20 切，就是两批')
  assert.equal(summary.failures.length, 1, '只有含 c_syn_00 的那一批被拒')
  const failure = summary.failures[0]
  assert.equal(failure?.ids.length, 20, '整批 20 条一起被拒（不是只拒那一条）')
  assert.ok(failure?.ids.includes('c_syn_00'))
  assert.match(String(failure?.why), /缺少中文解释/)
  assert.ok(dropped !== '', '夹具该真的少答了一个字段')
  assert.ok(
    String(failure?.why).includes(`的字段 ${dropped} 缺少中文解释`),
    `原因要点名缺的是哪个字段：${dropped}，实际 ${failure?.why}`,
  )

  /* understood 只算真写回的那些：被拒那一批的 20 条一条都不在里面。 */
  const understood = new Set(summary.entries.map((entry) => entry.id))
  assert.equal(summary.understood, 5)
  assert.equal(summary.writeBacks, 5, '只写回了通过的那一批')
  assert.equal(understood.has('c_syn_00'), false, '被拒的批次不算"理解了"')

  const rejected = new Set(failure?.ids ?? [])
  for (const contract of all) {
    const record = store.contracts().get(contract.id)
    if (rejected.has(contract.id)) {
      assert.equal(record?.aiTitle, undefined, `${contract.id}：整批被拒 → 零写回`)
      assert.equal(record?.aiFields, undefined, `${contract.id}：字段中文一个字都不许留`)
      assert.equal(record?.aiHash, undefined, `${contract.id}：哈希也不许写`)
      assert.equal(store.ai().get(aiKey(contract.id)), undefined, `${contract.id}：不进缓存，下次还得重新问`)
      continue
    }
    assert.ok(understood.has(contract.id), `${contract.id}：通过的那批该在结果里`)
    const want = fieldsFromPrompt(prompts.get(contract.id) as string).get(contract.id)
    assert.deepEqual(record?.aiFields, want, `${contract.id}：字段中文按种子顺序写回`)
    assert.equal(store.ai().get(aiKey(contract.id))?.hash, record?.aiHash, `${contract.id}：通过的那批要进缓存`)
    assert.equal(
      JSON.stringify({ title: record?.title, symbol: record?.symbol, input: record?.input, output: record?.output }),
      frozen.get(contract.id),
      `${contract.id}：原始标题、符号名与形状一个字都不许动`,
    )
  }
})

test('缓存：命中缓存照样补齐 aiFields —— 这个功能之前写好的记录，再跑一次就补上了', async () => {
  const { store } = await mountStore()
  const contract = syntheticContract(0)
  await store.contracts().put(contract.id, contract)
  let calls = 0
  let promptSeen = ''
  const caller = async (turn: { system: string; user: string }) => {
    calls += 1
    promptSeen = turn.user
    const fields = fieldsFromPrompt(turn)
    return {
      text: JSON.stringify({
        items: [{ id: contract.id, titleZh: '合成的一条中文职责', family: '合成族', fields: fields.get(contract.id) ?? [], relations: [] }],
      }),
      channel: 'fake',
      ms: 1,
    }
  }

  const first = await understandContracts({ store, projectId: 'p_test', contracts: [contract], caller })
  assert.equal(first.ok, true)
  assert.equal(first.writeBacks, 1)
  const want = fieldsFromPrompt(promptSeen).get(contract.id)
  assert.deepEqual(store.contracts().get(contract.id)?.aiFields, want, '第一次就该写回字段中文')
  assert.deepEqual(store.ai().get(aiKey(contract.id))?.fields, want, '缓存行里也要带上：下次命中才有东西可写')

  /* 把 aiFields 抹掉，模拟"这条记录是这个功能之前写好的"——其余 AI 结果都在。 */
  await store.contracts().update(contract.id, (record) => {
    const older = { ...record }
    delete older.aiFields
    return older
  })
  const older = store.contracts().get(contract.id) as ContractRecord
  assert.equal(older.aiFields, undefined)
  assert.ok(older.aiHash !== undefined, '老记录上别的 AI 结果都在，缺的只有 aiFields')

  /* 传进去的是**从库里读出来的**那条（路由就是这么干的）：于是这次写回的唯一理由就是缺 aiFields。 */
  const second = await understandContracts({ store, projectId: 'p_test', contracts: [older], caller })
  assert.equal(calls, 1, '内容没变 → 一条都不问模型')
  assert.ok(second.cached > 0, '第二次命中的是缓存')
  assert.equal(second.requested, 0)
  assert.equal(second.batches, 0)
  assert.equal(second.writeBacks, 1, '记录上缺 aiFields → 命中缓存也要补一次写回')
  assert.deepEqual(store.contracts().get(contract.id)?.aiFields, want, '字段中文从缓存来，一个字不改')
  assert.equal(store.contracts().get(contract.id)?.aiTitle, '合成的一条中文职责', '缓存里的中文照样用')
  assert.equal(store.contracts().get(contract.id)?.title, contract.title, '原始符号名一个字不动')

  /* 补过一次就够了：什么都不缺时不该再写一遍（缓存命中不等于每次都要落一次盘）。 */
  const third = await understandContracts({
    store,
    projectId: 'p_test',
    contracts: [store.contracts().get(contract.id) as ContractRecord],
    caller,
  })
  assert.equal(third.cached, 1)
  assert.equal(third.writeBacks, 0, '记录上什么都不缺了，就不该再写一遍')
  assert.equal(calls, 1)
})

/* ---------- 小工具：只要一个 store ---------- */

async function mountStore(): Promise<{ store: import('../lib/store.js').ButlerStore }> {
  const { facility, domain } = memoryFacility()
  const fake = fakeCtx()
  let opened: import('../lib/store.js').ButlerStore | null = null
  // 直接用门面打开同一个内存域：测试要的是 store，不是整个插件。
  const { ButlerStore } = await import('../lib/store.js')
  opened = await ButlerStore.open(facility as never)
  void domain
  void fake
  return { store: opened }
}

/* ==========================================================================
   字段级中文（`aiFields`）：这一组钉的是"AI 生成后，表格里中文解释那一栏不能是空的"
   ——包括真栈语义（宿主打开领域时会逐条 valueSchema.parse）与老缓存行的自愈。
   ========================================================================== */

/** 起一份完整插件：真路由 + 真存储设施 + 可选假 llm。`domain` 传同一个就模拟"宿主重启"。 */
async function bootButler(
  domain: MemoryDomain,
  llm: ReturnType<typeof fakeLlm> | null,
): Promise<{ fake: Fake; facility: ReturnType<typeof schemaCheckedFacility>['facility'] }> {
  const fake = fakeCtx()
  const { facility } = schemaCheckedFacility(domain)
  apply(fake.ctx as never, { watchEnabled: false, introspectTools: false })
  fake.mount('storageDomain', facility)
  fake.mount('webServer', {
    register(spec: RouteSpec) {
      fake.routes.push(spec)
      return () => undefined
    },
  })
  if (llm !== null) mountAi(fake, llm)
  for (let index = 0; index < 400; index += 1) {
    await new Promise((resolve) => setTimeout(resolve, 5))
    if (fake.logs.some((line) => line.includes('存储就绪'))) break
  }
  assert.ok(fake.logs.some((line) => line.includes('存储就绪')), `存储没就绪，日志：${fake.logs.join(' | ')}`)
  return { fake, facility }
}

/** 一条契约**扫描出来的**字段名（两侧合并去重，就是面板要渲染的那些行）。 */
function scannedFieldNames(contract: ContractRecordLike): string[] {
  const names = new Set<string>()
  for (const side of [contract.input, contract.output]) {
    for (const name of Object.keys(side?.fields ?? {})) names.add(name)
  }
  return [...names]
}

/**
 * 端到端（真栈语义）：AI 生成 → 每条契约的每个字段都拿到中文 → **宿主重启（领域重开）后还在**。
 *
 * 这里的存储设施是 `schemaCheckedFacility`：打开领域时照真宿主那样对每条记录调
 * `valueSchema.parse`（真包 `dsh-storage-domain` 的 `parseRecord`）。这一条正是本功能先前失守的
 * 地方——`aiFields` 没在 schema 里声明，写回的中文在"重启后打开领域"这一步被 zod 静默剥掉，
 * 于是界面只有外层中文、字段那一栏全空，而所有用纯 Map 替身的单测照样全绿。
 */
test('字段级中文端到端：AI 生成后每个字段都有中文，且宿主重启（领域重开）后不丢', async () => {
  const domain = new MemoryDomain()
  const root = makeProject()
  const first = await bootButler(domain, fakeLlm('ok'))
  const init = JSON.parse((await first.fake.call('POST', '/dsh-contract-butler/init', { root, confirm: true })).body)
  const projectId = String(init.result.project.id)

  const understood = JSON.parse((await first.fake.call('POST', '/dsh-contract-butler/understand', { projectId })).body)
  assert.equal(understood.ok, true, understood.body)
  assert.equal(understood.summary.failures.length, 0, '这一批该整批通过')

  /** 数一遍"应该有多少字段中文、实际有多少"——数字要能直接读出来。 */
  const coverage = (list: { contract: ContractRecordLike[] }[] | { contract: ContractRecordLike }[]): { contracts: number; fields: number; withZh: number } => {
    let fields = 0
    let withZh = 0
    for (const item of list) {
      const want = scannedFieldNames(item.contract)
      const zh = new Map((item.contract.aiFields ?? []).map((f) => [f.name, f.zh]))
      for (const name of want) {
        fields += 1
        const text = zh.get(name)
        if (typeof text === 'string' && text.trim() !== '') withZh += 1
      }
    }
    return { contracts: list.length, fields, withZh }
  }

  const before = JSON.parse((await first.fake.call('GET', `/dsh-contract-butler/contracts?project=${projectId}`)).body)
  const runA = coverage(before.contracts)
  assert.ok(runA.contracts >= 3, `这个夹具该扫出至少 3 条契约，实际 ${runA.contracts}`)
  assert.ok(runA.fields > 0, '夹具必须真的带字段，否则这条测试什么也没验到')
  assert.equal(runA.withZh, runA.fields, `生成后每个字段都要有中文：${runA.withZh}/${runA.fields}`)

  /* 宿主重启：**同一个领域**重新打开（真宿主就是在 open() 里逐条 parse 的）。 */
  const second = await bootButler(domain, null)
  const after = JSON.parse((await second.fake.call('GET', `/dsh-contract-butler/contracts?project=${projectId}`)).body)
  const runB = coverage(after.contracts)
  assert.deepEqual(
    { contracts: runB.contracts, fields: runB.fields },
    { contracts: runA.contracts, fields: runA.fields },
    '重启后契约与字段都还在（不然说明扫描结果本身丢了）',
  )
  assert.equal(runB.withZh, runB.fields, `重启后字段中文一个都不许丢：${runB.withZh}/${runB.fields}`)
})

/** 一条**没有字段**的合成契约（两侧都没有字段，抽取器也没记到）。 */
function fieldlessContract(index: number): ContractRecord {
  const contract = syntheticContract(index)
  return { ...contract, id: `c_nofield_${index}`, input: null, output: null, boundary: `tool:nofield_${index}` }
}

test('0 字段契约：没有字段可解释 → 正常通过，不因为"没有字段"被判失败', async () => {
  const { store } = await mountStore()
  const contract = fieldlessContract(1)
  await store.contracts().put(contract.id, contract)
  let calls = 0
  const caller = async (turn: { system: string; user: string }) => {
    calls += 1
    const seeds = seedsFromPrompt(turn)
    return {
      text: JSON.stringify({
        items: seeds.map((seed) => ({ id: seed.id, titleZh: `负责 ${seed.id} 的中文职责`, family: '合成族', relations: [] })),
      }),
      channel: 'fake',
      ms: 1,
    }
  }

  const summary = await understandContracts({ store, projectId: 'p_test', contracts: [contract], caller })
  assert.equal(calls, 1, '这一批该真的问一次模型')
  assert.equal(summary.ok, true)
  assert.equal(summary.failures.length, 0, '没有字段 ≠ 失败')
  assert.equal(summary.understood, 1)
  const record = store.contracts().get(contract.id)
  assert.equal(record?.aiTitle, `负责 ${contract.id} 的中文职责`, '外层中文照写')
  assert.equal(record?.aiFields, undefined, '没有字段就没有字段中文（不编、不塞空串）')
})

test('字段级中文是硬要求：模型整批不返回字段 → 整批拒绝、零写回、不进缓存', async () => {
  const { store } = await mountStore()
  const contract = syntheticContract(3)
  await store.contracts().put(contract.id, contract)
  const caller = async (turn: { system: string; user: string }) => {
    const seeds = seedsFromPrompt(turn)
    return {
      /* 每一条都只答外层中文，`fields` 一个字都不给——正是用户遇到的那种模型行为。 */
      text: JSON.stringify({ items: seeds.map((seed) => ({ id: seed.id, titleZh: `负责 ${seed.id} 的中文职责`, family: '合成族', relations: [] })) }),
      channel: 'fake',
      ms: 1,
    }
  }

  const summary = await understandContracts({ store, projectId: 'p_test', contracts: [contract], caller })
  assert.equal(summary.failures.length, 1, '缺字段级中文 → 整批拒绝')
  assert.equal(summary.understood, 0)
  assert.equal(summary.writeBacks, 0, '整批被拒 → 零写回')
  assert.match(String(summary.failures[0]?.why), /缺少中文解释/, `原因要能读出"缺字段中文"：${summary.failures[0]?.why}`)
  assert.ok(String(summary.failures[0]?.why).includes(contract.id), `原因要点名是哪条契约：${summary.failures[0]?.why}`)
  const record = store.contracts().get(contract.id)
  assert.equal(record?.aiTitle, undefined, '被拒 → 外层中文也不许写（绝不部分写回）')
  assert.equal(record?.aiFields, undefined)
  assert.equal(store.ai().get(aiKey(contract.id)), undefined, '被拒 → 不进缓存，下次还得重新问')
})

test('字段级中文：模型把名字写成"进来 x"（对不上种子的字段名）→ 整批拒绝，原因点名那个字段', async () => {
  const { store } = await mountStore()
  const contract = syntheticContract(4)
  await store.contracts().put(contract.id, contract)
  let prefixed = ''
  const caller = async (turn: { system: string; user: string }) => {
    const seeds = seedsFromPrompt(turn)
    const fields = fieldsFromPrompt(turn)
    for (const seed of seeds) {
      const mine = fields.get(seed.id) ?? []
      /* 模型很爱把提示词里的方向前缀抄进 name——名字对不上就必须整批拒绝。 */
      if (mine.length > 0) prefixed = `进来 ${mine[0]?.name ?? ''}`
    }
    return {
      text: JSON.stringify({
        items: seeds.map((seed) => {
          const mine = fields.get(seed.id) ?? []
          return {
            id: seed.id,
            titleZh: `负责 ${seed.id} 的中文职责`,
            family: '合成族',
            fields: mine.map((one, index) => (index === 0 ? { name: `进来 ${one.name}`, zh: one.zh } : one)),
            relations: [],
          }
        }),
      }),
      channel: 'fake',
      ms: 1,
    }
  }

  const summary = await understandContracts({ store, projectId: 'p_test', contracts: [contract], caller })
  assert.equal(summary.failures.length, 1, '名字对不上 → 整批拒绝')
  assert.equal(summary.writeBacks, 0)
  const why = String(summary.failures[0]?.why)
  assert.ok(why.includes(prefixed), `原因要点名那个对不上的字段名（${prefixed}）：${why}`)
  assert.equal(store.contracts().get(contract.id)?.aiFields, undefined)
})

test('老缓存行没有字段中文 → 不算命中，重新问一次模型并补上 aiFields', async () => {
  const { store } = await mountStore()
  const contract = syntheticContract(5)
  await store.contracts().put(contract.id, contract)
  let calls = 0
  const caller = async (turn: { system: string; user: string }) => {
    calls += 1
    const seeds = seedsFromPrompt(turn)
    const fields = fieldsFromPrompt(turn)
    return {
      text: JSON.stringify({
        items: seeds.map((seed) => ({ id: seed.id, titleZh: `负责 ${seed.id} 的中文职责`, family: '合成族', fields: fields.get(seed.id) ?? [], relations: [] })),
      }),
      channel: 'fake',
      ms: 1,
    }
  }

  /* 第一次正常跑：记录与缓存行都带上字段中文。 */
  await understandContracts({ store, projectId: 'p_test', contracts: [contract], caller })
  assert.equal(calls, 1)
  const want = store.contracts().get(contract.id)?.aiFields
  assert.ok(Array.isArray(want) && want.length > 0, '第一次就该写回字段中文')

  /* 退回"本功能之前"的样子：缓存行没有 fields，契约记录也没有 aiFields——其它 AI 结果都在。
     这正是用户升级后再点一次"AI 生成"时库里的状态。 */
  await store.ai().update(aiKey(contract.id), (row) => {
    const older = { ...row }
    delete older.fields
    return older
  })
  await store.contracts().update(contract.id, (record) => {
    const older = { ...record }
    delete older.aiFields
    return older
  })

  const again = await understandContracts({
    store,
    projectId: 'p_test',
    contracts: [store.contracts().get(contract.id) as ContractRecord],
    caller,
  })
  assert.equal(calls, 2, '缓存行里没有字段中文 → 不许当命中，必须重新问模型')
  assert.equal(again.cached, 0, '这一条不算缓存命中')
  assert.deepEqual(store.contracts().get(contract.id)?.aiFields, want, '补回来的字段中文与模型这次给的一字不差')
  assert.deepEqual(store.ai().get(aiKey(contract.id))?.fields, want, '缓存行也补上，下次才是真命中')

  /* 补过之后：内容没变就是真命中，一条都不再问。 */
  const third = await understandContracts({
    store,
    projectId: 'p_test',
    contracts: [store.contracts().get(contract.id) as ContractRecord],
    caller,
  })
  assert.equal(calls, 2, '这回才是真命中，不该再问')
  assert.equal(third.cached, 1)
})

test('字段级中文：一次失败不许污染记录上既有的 aiFields', async () => {
  const { store } = await mountStore()
  const contract = syntheticContract(6)
  await store.contracts().put(contract.id, contract)
  const good = async (turn: { system: string; user: string }) => {
    const seeds = seedsFromPrompt(turn)
    const fields = fieldsFromPrompt(turn)
    return {
      text: JSON.stringify({
        items: seeds.map((seed) => ({ id: seed.id, titleZh: `负责 ${seed.id} 的中文职责`, family: '合成族', fields: fields.get(seed.id) ?? [], relations: [] })),
      }),
      channel: 'fake',
      ms: 1,
    }
  }
  await understandContracts({ store, projectId: 'p_test', contracts: [contract], caller: good })
  const kept = store.contracts().get(contract.id)?.aiFields
  const keptAt = store.contracts().get(contract.id)?.aiAt
  assert.ok(Array.isArray(kept) && kept.length > 0)

  /* 契约内容变了（哈希跟着变）→ 这一条要重新问；而这次模型缺字段中文 → 整批拒绝。
     结果是：记录上原有的字段中文**一个字都不许动**（既不是清空，也不是半份覆盖）。 */
  const changed = await store.contracts().update(contract.id, (record) => ({
    ...record,
    output: { kind: 'object', fields: { out_06: { kind: 'string' } } },
    updatedAt: 9,
  }))
  assert.deepEqual(changed.aiFields, kept, '前置条件：改形状这一步本身不该动 aiFields')
  const bad = async (turn: { system: string; user: string }) => {
    const seeds = seedsFromPrompt(turn)
    return {
      text: JSON.stringify({ items: seeds.map((seed) => ({ id: seed.id, titleZh: `负责 ${seed.id} 的中文职责`, family: '合成族', relations: [] })) }),
      channel: 'fake',
      ms: 1,
    }
  }
  const summary = await understandContracts({ store, projectId: 'p_test', contracts: [changed], caller: bad, force: true })
  assert.equal(summary.failures.length, 1, '这次该被拒')
  const record = store.contracts().get(contract.id)
  assert.deepEqual(record?.aiFields, kept, '被拒 → 原有字段中文原样保留')
  assert.equal(record?.aiAt, keptAt, 'aiAt 也不许被失败的那次改写')
})