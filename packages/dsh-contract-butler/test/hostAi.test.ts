/**
 * 宿主 AI 适配器的单测：只测 `hostAi.ts` 这一层，不装整个插件。
 *
 * 这一层的职责边界很窄，但每一条都是红线：
 * 1. **挑路由只认宿主的事实**：默认模型 → 宿主已注册 provider；插件自己不再维护模型名单。
 * 2. **缺席就是失败**：没有 llm 服务时给的是"缺什么"的原因，而不是某条兜底通道。
 * 3. **文本从流里拼**：`text-delta` 要拼全（拼错就是"少了一半契约"）。
 * 4. **截断 / 报错 / 只想调工具都不算成功**：半截 JSON 放过去比直接报错坏得多。
 * 5. **这一层不认识密钥**：它只往外发 provider/model/提示词，没有任何凭据字段。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createHostAi, describeHostAi, pickRoute, providerNames } from '../lib/hostAi.js'

interface Chunk {
  type: string
  text?: string
  reason?: { kind: string; failure?: { message: string; code: string } }
}

/** 一个够用的假 llm 服务。`answer` 决定它吐什么；抛错用 `throws`。 */
function fakeLlm(options: {
  providers?: { id: string; name: string }[]
  models?: Record<string, string[]>
  chunks?: Chunk[]
  throws?: string
  noListModels?: boolean
} = {}): {
  service: {
    stream(options: Record<string, unknown>): AsyncIterable<Chunk>
    listProviders(): { id: string; name: string }[]
    listModels?(provider: string): Promise<{ provider: string; id: string; name: string }[]>
  }
  seen: Record<string, unknown>[]
} {
  const seen: Record<string, unknown>[] = []
  const providers = options.providers ?? [{ id: 'skynet', name: 'Skynet' }]
  const models = options.models ?? { skynet: ['fake-model'] }
  const chunks = options.chunks ?? [
    { type: 'text-delta', text: '{"items":' },
    { type: 'text-delta', text: '[]}' },
    { type: 'finish', reason: { kind: 'stop' } },
  ]
  const service: {
    stream(options: Record<string, unknown>): AsyncIterable<Chunk>
    listProviders(): { id: string; name: string }[]
    listModels?(provider: string): Promise<{ provider: string; id: string; name: string }[]>
  } = {
    listProviders: () => providers,
    async *stream(request: Record<string, unknown>): AsyncIterable<Chunk> {
      seen.push(request)
      if (options.throws !== undefined) throw new Error(options.throws)
      for (const chunk of chunks) yield chunk
    },
  }
  /* 形状照抄真宿主（`dsh-llm/lib/index.js:2018` 给的是模型元数据对象，不是字符串）。 */
  if (options.noListModels !== true) {
    service.listModels = async (provider: string) =>
      (models[provider] ?? []).map((id) => ({ provider, id, name: id }))
  }
  return { service, seen }
}

/* ---------- 挑路由 ---------- */

test('宿主面：默认模型就是路由；没有默认模型时退回第一个已注册 provider 并说明', async () => {
  const llm = fakeLlm({ models: { skynet: ['m-a', 'm-b'] } })

  // 有默认模型：用它。
  const byDefault = await pickRoute({ llm: llm.service, defaultModel: { currentSelection: () => ({ provider: 'skynet', model: 'm-b' }) } }, '')
  assert.deepEqual(byDefault, { provider: 'skynet', model: 'm-b', label: 'skynet · m-b' })

  // 没有 agentDefaultModel：退回第一条，且 notes 里说明（降级要说出来，不许悄悄换）。
  const notes: string[] = []
  const byFirst = await pickRoute({ llm: llm.service }, '', notes)
  assert.deepEqual(byFirst, { provider: 'skynet', model: 'm-a', label: 'skynet · m-a' })
  assert.ok(notes.some((note) => note.includes('agentDefaultModel')), notes.join(' | '))

  // agentDefaultModel 在，但没选：也算"没有默认模型"。
  const empty: string[] = []
  const byEmpty = await pickRoute({ llm: llm.service, defaultModel: { currentSelection: () => null } }, '', empty)
  assert.deepEqual((byEmpty as { model: string }).model, 'm-a')
  assert.ok(empty.some((note) => note.includes('agentDefaultModel')), empty.join(' | '))
})

test('宿主面：understandModel 的三种写法（provider:model / 裸模型名 / 指错）', async () => {
  const llm = fakeLlm({
    providers: [
      { id: 'skynet', name: 'Skynet' },
      { id: 'other', name: 'Other' },
    ],
    models: { skynet: ['m-a', 'm-b'], other: ['m-c'] },
  })

  // 指名 provider:model：直接用。
  assert.deepEqual(await pickRoute({ llm: llm.service }, 'other:m-c'), { provider: 'other', model: 'm-c', label: 'other · m-c' })
  // 只给模型名：在宿主已注册的 provider 里找到提供它的那条。
  assert.deepEqual(await pickRoute({ llm: llm.service }, 'm-c'), { provider: 'other', model: 'm-c', label: 'other · m-c' })
  // provider 写错：说清宿主注册了谁。
  const badProvider = await pickRoute({ llm: llm.service }, 'nope:m-a')
  assert.match(String((badProvider as { reason: string }).reason), /没有注册 provider nope/)
  assert.match(String((badProvider as { reason: string }).reason), /skynet、other/)
  // 模型写错：也说清。
  const badModel = await pickRoute({ llm: llm.service }, 'm-zzz')
  assert.match(String((badModel as { reason: string }).reason), /都没有模型「m-zzz」/)
  // 写法就不对（只有冒号）。
  const malformed = await pickRoute({ llm: llm.service }, ':m-a')
  assert.match(String((malformed as { reason: string }).reason), /写法不对/)
})

test('宿主面：没有 llm 服务 → 明确说缺什么（这是独立跑 dev-server 的那条路）', async () => {
  const status = await describeHostAi({})
  assert.equal(status.available, false)
  assert.equal(status.path, 'host-llm')
  assert.equal(status.route, null)
  assert.match(status.reason, /没有提供 llm 服务/)
  assert.match(status.reason, /dsh-llm/)
  assert.match(status.reason, /不自建通道/)

  const ready = await createHostAi({ services: {}, maxTokens: 100, timeoutMs: 1000 })
  assert.equal(ready.ok, false)
  assert.match((ready as { reason: string }).reason, /没有提供 llm 服务/)

  // 连 provider 都没注册时，原因里也要说清"一个都没有"，而不是给个空表让人猜。
  const none = await createHostAi({
    services: { llm: { stream: () => undefined, listProviders: () => [], listModels: async () => [] } },
    maxTokens: 100,
    timeoutMs: 1000,
  })
  assert.equal(none.ok, false)
  assert.match((none as { reason: string }).reason, /没有可用的模型路由/)
})

test('宿主面：默认模型的 provider 没注册 adapter → 避开它，换成已注册 provider 上的同名模型', async () => {
  /* 真机上踩到的就是这一条：`agentDefaultModel` 写 `mmt-vision · deepseek-v4-flash-tencent`，
     而 `llm.listProviders()` 里根本没有 `mmt-vision` —— 照它发出去每批都是
     `no adapter registered for provider`，整批 422。模型名是用户真选的，provider 只是出口。 */
  const llm = fakeLlm({
    providers: [
      { id: 'mmt', name: 'MMT' },
      { id: 'mmtv', name: 'MMTV' },
    ],
    models: { mmt: ['deepseek-v4-flash-tencent', 'glm-5.3'], mmtv: ['qwen3.5-flash'] },
  })
  const notes: string[] = []
  const picked = await pickRoute(
    { llm: llm.service, defaultModel: { currentSelection: () => ({ provider: 'mmt-vision', model: 'deepseek-v4-flash-tencent' }) } },
    '',
    notes,
  )
  assert.deepEqual(picked, { provider: 'mmt', model: 'deepseek-v4-flash-tencent', label: 'mmt · deepseek-v4-flash-tencent' })
  assert.ok(notes.some((note) => note.includes('mmt-vision') && note.includes('没有注册 adapter')), notes.join(' | '))
  assert.ok(notes.some((note) => note.includes('同一个模型')), notes.join(' | '))
})

test('宿主面：默认模型没注册、已注册 provider 也没有同名模型 → 退到第一条可用路由，并说明', async () => {
  const llm = fakeLlm({
    providers: [{ id: 'mmtv', name: 'MMTV' }],
    models: { mmtv: ['qwen3.5-flash', 'glm-5.3'] },
  })
  const notes: string[] = []
  const picked = await pickRoute(
    { llm: llm.service, defaultModel: { currentSelection: () => ({ provider: 'mmt-vision', model: 'deepseek-v4-flash-tencent' }) } },
    '',
    notes,
  )
  assert.deepEqual(picked, { provider: 'mmtv', model: 'qwen3.5-flash', label: 'mmtv · qwen3.5-flash' })
  assert.ok(notes.some((note) => note.includes('没有注册 adapter')), notes.join(' | '))
  assert.ok(notes.some((note) => note.includes('都没有模型「deepseek-v4-flash-tencent」')), notes.join(' | '))
})

test('宿主面：默认模型的 provider 已注册时原样照用（不做任何自作聪明的替换）', async () => {
  const llm = fakeLlm({
    providers: [{ id: 'mmt', name: 'MMT' }],
    models: { mmt: ['glm-5.3', 'deepseek-v4-flash-tencent'] },
  })
  const notes: string[] = []
  const picked = await pickRoute(
    { llm: llm.service, defaultModel: { currentSelection: () => ({ provider: 'mmt', model: 'deepseek-v4-flash-tencent' }) } },
    '',
    notes,
  )
  assert.deepEqual(picked, { provider: 'mmt', model: 'deepseek-v4-flash-tencent', label: 'mmt · deepseek-v4-flash-tencent' })
  assert.deepEqual(notes, [], '默认路由可用时不该有任何说明')
})

test('宿主面：模型目录是"建议性"的 —— 谁都没报出模型时，带上用户选的模型名照发一次', async () => {
  /* 宿主 adapter 不实现 listModels 时 `listModels()` 就是空表（基类默认 `[]`，dsh-llm:1653），
     而宿主自己的文档写明"目录只是建议性的，缺席不等于不能用"。这种时候把默认模型换成别的、
     或者干脆 503，都是替用户做主张；正确做法是第一个已注册 provider 带上他的模型名试一次。 */
  const llm = fakeLlm({ providers: [{ id: 'mmt', name: 'MMT' }], noListModels: true })
  const notes: string[] = []
  const picked = await pickRoute(
    { llm: llm.service, defaultModel: { currentSelection: () => ({ provider: 'mmt-vision', model: 'deepseek-v4-flash-tencent' }) } },
    '',
    notes,
  )
  assert.deepEqual(picked, { provider: 'mmt', model: 'deepseek-v4-flash-tencent', label: 'mmt · deepseek-v4-flash-tencent' })
  assert.ok(notes.some((note) => note.includes('没报出模型目录')), notes.join(' | '))
})

test('宿主面：listModels 只给字符串（旧形状）也认', async () => {
  const service = {
    stream: () => undefined,
    listProviders: () => [{ id: 'skynet', name: 'Skynet' }],
    listModels: async () => ['old-shape-model'],
  }
  const picked = await pickRoute({ llm: service }, 'old-shape-model')
  assert.deepEqual(picked, { provider: 'skynet', model: 'old-shape-model', label: 'skynet · old-shape-model' })
})

test('宿主面：首选发不出去就按顺序换下一条；换成功了后面不再回头试', async () => {
  /* 真机的形态：默认模型指的 provider 没 adapter，同名模型挂在 mmt 上（也发不出去），
     再往后 mmtv 是通的。插件必须**自己按顺序试**，而不是每批都把死的线重试一遍。 */
  const tried: string[] = []
  const service = {
    listProviders: () => [
      { id: 'mmt', name: 'MMT' },
      { id: 'mmtv', name: 'MMTV' },
    ],
    listModels: async (provider: string) =>
      (provider === 'mmt' ? ['deepseek-v4-flash-tencent'] : ['glm-5.3-flash']).map((id) => ({ provider, id, name: id })),
    async *stream(options: Record<string, unknown>): AsyncIterable<Chunk> {
      const provider = String(options.provider ?? '')
      tried.push(`${provider} · ${String(options.model ?? '')}`)
      if (provider === 'mmt') throw new Error('no adapter registered for provider "mmt"')
      yield { type: 'text-delta', text: '{"items":[]}' }
      yield { type: 'finish', reason: { kind: 'stop' } }
    },
  }
  const ready = await createHostAi({
    services: {
      llm: service,
      defaultModel: { currentSelection: () => ({ provider: 'mmt-vision', model: 'deepseek-v4-flash-tencent' }) },
    },
    maxTokens: 100,
    timeoutMs: 1000,
  })
  assert.equal(ready.ok, true)
  if (!ready.ok) return
  assert.equal(ready.route.label, 'mmt · deepseek-v4-flash-tencent', '首选是"同名模型换条线"')

  const first = await ready.caller({ system: 's', user: 'u' })
  assert.equal(first.channel, 'mmtv · glm-5.3-flash', '第一条死了就换下一条')
  assert.ok(
    ready.notes.some((note) => note.includes('发不出去') && note.includes('换下一条')),
    ready.notes.join(' | '),
  )

  /* 第二批：已经知道 mmtv 能用，就从它开始——不许再把 mmt 重试一遍。 */
  const before = tried.length
  const second = await ready.caller({ system: 's', user: 'u' })
  assert.equal(second.channel, 'mmtv · glm-5.3-flash')
  assert.equal(tried.length - before, 1, `第二批复用已确认的线，实际试了 ${tried.slice(before).join('、')}`)
})

test('宿主面：截断要换线（实测：同一条线 4000 截断、16000 通过），工具调用不换', async () => {
  /* 截断是"这条线在这个预算下没说完"，换一条线很可能说得完——真机上就是这么救回来的。
     而"模型要求调用工具"换谁都会这样（提示词里根本没有工具），换线纯属浪费。 */
  const tried: string[] = []
  const service = {
    listProviders: () => [
      { id: 'a', name: 'A' },
      { id: 'b', name: 'B' },
    ],
    listModels: async (provider: string) => [{ provider, id: `${provider}-model`, name: `${provider}-model` }],
    async *stream(options: Record<string, unknown>): AsyncIterable<Chunk> {
      const provider = String(options.provider ?? '')
      tried.push(provider)
      if (provider === 'a') {
        yield { type: 'text-delta', text: '{"items":' }
        yield { type: 'finish', reason: { kind: 'max-tokens' } }
        return
      }
      yield { type: 'text-delta', text: '{"items":[]}' }
      yield { type: 'finish', reason: { kind: 'stop' } }
    },
  }
  const ready = await createHostAi({
    services: { llm: service, defaultModel: { currentSelection: () => ({ provider: 'a', model: 'a-model' }) } },
    maxTokens: 100,
    timeoutMs: 1000,
  })
  assert.equal(ready.ok, true)
  if (!ready.ok) return
  const outcome = await ready.caller({ system: 's', user: 'u' })
  assert.equal(outcome.channel, 'b · b-model', '截断之后要试下一条')
  assert.deepEqual(tried, ['a', 'b'])
  assert.ok(ready.notes.some((note) => note.includes('换下一条')), ready.notes.join(' | '))

  /* 工具调用：所有线都一样，不换（否则只是把同一种失败重演 N 次）。 */
  const tools = {
    listProviders: () => [
      { id: 'a', name: 'A' },
      { id: 'b', name: 'B' },
    ],
    listModels: async (provider: string) => [{ provider, id: `${provider}-model`, name: `${provider}-model` }],
    async *stream(): AsyncIterable<Chunk> {
      yield { type: 'finish', reason: { kind: 'tool-calls' } }
    },
  }
  const stuck = await createHostAi({
    services: { llm: tools, defaultModel: { currentSelection: () => ({ provider: 'a', model: 'a-model' }) } },
    maxTokens: 100,
    timeoutMs: 1000,
  })
  assert.equal(stuck.ok, true)
  if (!stuck.ok) return
  await assert.rejects(() => stuck.caller({ system: 's', user: 'u' }), /调用工具/)
})

test('宿主面：状态里给出备选顺序（首选死了会发生什么，一眼看得到）', async () => {
  const llm = fakeLlm({
    providers: [
      { id: 'mmt', name: 'MMT' },
      { id: 'mmtv', name: 'MMTV' },
    ],
    models: { mmt: ['deepseek-v4-flash-tencent'], mmtv: ['glm-5.3-flash'] },
  })
  const status = await describeHostAi({
    llm: llm.service,
    defaultModel: { currentSelection: () => ({ provider: 'mmt', model: 'deepseek-v4-flash-tencent' }) },
  })
  assert.equal(status.route, 'mmt · deepseek-v4-flash-tencent')
  assert.deepEqual(status.fallbacks, ['mmtv · glm-5.3-flash'], '备选也要报出来')
})

test('宿主面：listProviders / listModels 抛错不影响插件（当没有，不崩）', () => {
  const broken = {
    stream: () => undefined,
    listProviders: () => {
      throw new Error('宿主内部炸了')
    },
  }
  assert.deepEqual(providerNames({ llm: broken }), [])
})

/* ---------- 发一次流 ---------- */

test('宿主面：把 text-delta 拼成文本，并把 system / user / 预算原样送出去', async () => {
  const llm = fakeLlm()
  const ready = await createHostAi({
    services: { llm: llm.service, defaultModel: { currentSelection: () => ({ provider: 'skynet', model: 'fake-model' }) } },
    maxTokens: 1234,
    timeoutMs: 5000,
  })
  assert.equal(ready.ok, true)
  if (!ready.ok) return

  const outcome = await ready.caller({ system: '你是理解器', user: '这批契约：{}' })
  assert.equal(outcome.text, '{"items":[]}', '分块的 text-delta 要拼全')
  assert.equal(outcome.channel, 'skynet · fake-model')
  assert.ok(outcome.ms >= 0)

  const sent = llm.seen[0] as Record<string, unknown>
  assert.equal(sent.provider, 'skynet')
  assert.equal(sent.model, 'fake-model')
  assert.equal(sent.system, '你是理解器')
  assert.equal(sent.maxTokens, 1234)
  assert.deepEqual(sent.messages, [{ role: 'user', content: [{ type: 'text', text: '这批契约：{}' }] }])
  assert.ok(sent.signal instanceof AbortSignal, '要带超时信号')
  // 红线：这一层不该出现任何凭据字段。
  const keys = Object.keys(sent).map((key) => key.toLowerCase())
  for (const banned of ['apikey', 'api_key', 'authorization', 'key', 'token']) {
    assert.equal(keys.includes(banned), false, `不该往外发 ${banned}`)
  }
})

test('宿主面：截断 / 报错 / 只想调工具 / 空输出 都不算成功', async () => {
  const cases: { name: string; chunks?: Chunk[]; throws?: string; why: RegExp }[] = [
    {
      name: 'max_tokens 截断',
      chunks: [{ type: 'text-delta', text: '{"items":[{"id":' }, { type: 'finish', reason: { kind: 'max-tokens' } }],
      why: /max_tokens/,
    },
    {
      name: '宿主服务抛错',
      throws: 'quote exceeded',
      why: /quote exceeded/,
    },
    {
      name: '只会调工具',
      chunks: [{ type: 'finish', reason: { kind: 'tool-calls' } }],
      why: /调用工具/,
    },
    {
      name: '没有任何文本',
      chunks: [{ type: 'finish', reason: { kind: 'stop' } }],
      why: /没有返回文本内容/,
    },
    {
      name: '终止块是 error',
      chunks: [{ type: 'finish', reason: { kind: 'error', failure: { message: '上游 500', code: 'X' } } }],
      why: /上游 500/,
    },
  ]
  for (const item of cases) {
    const llm = fakeLlm({ chunks: item.chunks, throws: item.throws })
    const ready = await createHostAi({
      services: { llm: llm.service, defaultModel: { currentSelection: () => ({ provider: 'skynet', model: 'fake-model' }) } },
      maxTokens: 100,
      timeoutMs: 5000,
    })
    assert.equal(ready.ok, true, item.name)
    if (!ready.ok) continue
    await assert.rejects(() => ready.caller({ system: 's', user: 'u' }), item.why, item.name)
  }
})

test('宿主面：超时是人话（不是 AbortError 一类的机器话）', async () => {
  /* 一个永远不结束的流 + 1ms 超时：错误文本要能直接显示给用户。 */
  const service = {
    listProviders: () => [{ id: 'skynet', name: 'Skynet' }],
    listModels: async () => ['fake-model'],
    async *stream(): AsyncIterable<Chunk> {
      await new Promise((resolve) => setTimeout(resolve, 50))
      yield { type: 'finish', reason: { kind: 'stop' } }
    },
  }
  const ready = await createHostAi({
    services: { llm: service, defaultModel: { currentSelection: () => ({ provider: 'skynet', model: 'fake-model' }) } },
    maxTokens: 100,
    timeoutMs: 1,
  })
  assert.equal(ready.ok, true)
  if (!ready.ok) return
  await assert.rejects(() => ready.caller({ system: 's', user: 'u' }), /超过 0 秒没有响应|超过 1 秒没有响应/)
})

test('宿主面：描述状态时给出路由、provider 表与说明（面板据此显示）', async () => {
  const llm = fakeLlm({ providers: [{ id: 'skynet', name: 'Skynet' }, { id: 'other', name: 'Other' }], models: { skynet: ['m-a'], other: [] } })
  const status = await describeHostAi(
    { llm: llm.service, defaultModel: { currentSelection: () => ({ provider: 'skynet', model: 'm-a' }) } },
    '',
  )
  assert.equal(status.available, true)
  assert.equal(status.route, 'skynet · m-a')
  assert.deepEqual(status.providers, ['skynet', 'other'])
  assert.equal(status.reason, '')
  assert.equal(status.path, 'host-llm')
})