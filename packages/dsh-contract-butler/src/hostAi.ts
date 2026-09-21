/**
 * 宿主 AI 面：把「问一次模型」接到 **DSH 自己的模型服务**上。
 *
 * 为什么是这一层、而不是自己读配置打网关：插件不该有第二条 AI 管道。谁有凭据、谁能用哪个模型、
 * 配额与重试，都是宿主的决定；插件自己读一份 settings、再自己发一次 HTTP，等于把这套决定抄一遍，
 * 抄错一次（密钥失效、网关改协议、模型下架）就是插件这边莫名其妙的 401/403。所以这里只做三件事：
 *
 * 1. **挑路由**：`provider` + `model` 从宿主已注册的 provider 与用户选定的默认模型里出；
 * 2. **发一次流**：`ctx.get('llm').stream(options)`，与宿主自己的插件（如会话标题）走同一条路；
 * 3. **收文本**：把 `text-delta` 拼起来，把终止块翻译成人话。
 *
 * 这一层**不读配置文件、不碰密钥、不发 HTTP**——它连"密钥"这个词都不认识。挑不出路由时给的是
 * 可读原因（缺哪个服务、宿主注册了哪些 provider），而不是悄悄退回一条自建通道。
 *
 * 与服务名的关系（对着应用内的真包核对过）：
 * - `llm`：`@deepseek-ai/dsh-llm`，`dsh-base/cordis.patch.yml` 挂在根层，`ctx.get('llm')` 可取；
 * - `agentDefaultModel`：`@deepseek-ai/dsh-agent-default-model`，`currentSelection()` 给 `{provider, model}`；
 *   **软依赖**：没挂或没选时退回"宿主第一个已注册 provider 的第一个模型"，并在 `notes` 里说明。
 *
 * 宿主完全缺席时（独立跑 dev-server）这里必须**明确失败**：`available: false` + 原因，面板照实显示。
 */
import type { AiCaller } from './aiWorkflow.js'

/** 流里我们认得的那几块。宿主协议比这里宽，认不出的块原样忽略（不猜、不拼）。 */
export interface HostLlmChunk {
  type?: string
  text?: string
  reason?: {
    kind?: string
    failure?: { message?: string; code?: string }
  }
}

/**
 * `llm` 服务的最小面（只声明我们真正用到的三个方法）。
 *
 * 刻意用结构化类型而不是 import 宿主内部包：插件与宿主是两个包，跨包 import 宿主内部模块
 * 会让"宿主升级"变成"插件编译失败"。这里只要形状对得上就能用。
 */
export interface HostLlmLike {
  stream(options: Record<string, unknown>): unknown
  listProviders?(): { id?: string; name?: string }[]
  /**
   * 宿主 `llm.listModels(provider)` 给的是**模型元数据对象**（`{provider, id, name, …}`，
   * 见 `dsh-llm/lib/index.js:2018`），不是字符串——`string` 只是为兼容旧形状/测试留下的。
   * 另外宿主明确写着：模型目录是**建议性**的，适配器可以接受未列出的模型 id，
   * 所以调用方不许把"查不到"当成"用不了"的依据。
   */
  listModels?(provider: string): Promise<readonly (string | { id?: string })[]>
}

/** `agentDefaultModel` 服务的最小面。 */
export interface HostDefaultModelLike {
  currentSelection(): { provider?: string; model?: string } | null | undefined
}

/** 宿主给的两个服务（谁缺席就是谁的错，如实报出来）。 */
export interface HostAiServices {
  llm?: HostLlmLike | undefined
  defaultModel?: HostDefaultModelLike | undefined
}

/** 一次问答的路由。`label` 是回显用的名字（`provider · model`），永远不含凭据。 */
export interface HostAiRoute {
  provider: string
  model: string
  label: string
}

/** 给面板/报告看的状态。 */
export interface HostAiStatus {
  available: boolean
  /** 这条 AI 路走的是谁：宿主的 llm 服务。 */
  path: 'host-llm'
  /** 宿主已注册的 provider 名（挑不出路由时，这就是"到底有什么"。 */
  providers: string[]
  /** 这次会用的路由标签，挑不出来时 null。 */
  route: string | null
  /** 首选发不出去时才会用到的备选（顺序即尝试顺序）。 */
  fallbacks: string[]
  /** 不可用 / 降级的原因（人话）。可用且无需说明时为空串。 */
  reason: string
  /** 用得上的补充说明（例如默认模型不可用、退回了第一条）。 */
  notes: string[]
}

/** `createHostAi` 的入参。 */
export interface HostAiOptions {
  /** 现取宿主服务：**每次请求现取**，服务晚挂上来也认得，宿主重启后不认死句柄。 */
  services: HostAiServices
  /** 配置里指定的模型：`provider:model` 直接指名，或只给模型名（在宿主 provider 里找）。空串=按默认。 */
  model?: string
  /** 配置里指定的 provider：钉死这一条线（模型见 `model`）。空串=按默认。 */
  provider?: string
  /** 单批发出去的最大输出 token。 */
  maxTokens: number
  /** 单批超时（ms）。 */
  timeoutMs: number
}

/** 现场装好的调用面：`ok` 为假时只有原因，没有 caller。 */
export type HostAiReady =
  | { ok: true; caller: AiCaller; route: HostAiRoute; notes: string[] }
  | { ok: false; reason: string; notes: string[] }

/** 缺服务时给用户的话：**说清缺什么**，而不是只说"不可用"。 */
const NO_LLM =
  '宿主没有提供 llm 服务（@deepseek-ai/dsh-llm 未挂载）：AI 理解要用宿主自己的模型服务，' +
  '本插件不自建通道，也不读配置文件里的密钥。'

/** 超时措辞与旧实现一致（面板与测试都按这句认）。 */
function timeoutMessage(ms: number): string {
  return `超过 ${Math.round(ms / 1000)} 秒没有响应`
}

/** 只用来报错的截断：绝不把整段响应塞进错误文本。 */
function clip(text: string, max: number): string {
  const one = text.replace(/\s+/g, ' ').trim()
  return one.length > max ? `${one.slice(0, max)}…` : one
}

/** 宿主已注册的 provider 名（挑不出路由时给排查用）。 */
export function providerNames(services: HostAiServices): string[] {
  const llm = services.llm
  if (llm === undefined || typeof llm.listProviders !== 'function') return []
  try {
    const listed = llm.listProviders()
    if (!Array.isArray(listed)) return []
    const out: string[] = []
    for (const item of listed) {
      const id = typeof item?.id === 'string' ? item.id.trim() : ''
      if (id !== '') out.push(id)
    }
    return out
  } catch {
    // 宿主那边的实现有问题不该把插件带崩：这里只是"报状态"，出错就当没列出来。
    return []
  }
}

/**
 * 一个 provider 的模型清单（只要 id）。
 *
 * 宿主给的是对象数组，照字符串过滤就会"一条都看不见"——那会把本该自动换 provider 的情形
 * 变成 503。两种形状都收。宿主不提供 listModels、或它抛错（宿主会对非法目录抛 INVALID_CATALOG）
 * 时给空表：**空表只表示"问不到"，不表示"没有"**，调用方据此退化而不是拒绝。
 */
async function modelsOf(llm: HostLlmLike, provider: string): Promise<string[]> {
  if (typeof llm.listModels !== 'function') return []
  try {
    const models = await llm.listModels(provider)
    if (!Array.isArray(models)) return []
    const out: string[] = []
    for (const item of models) {
      const id = typeof item === 'string' ? item.trim() : typeof item?.id === 'string' ? item.id.trim() : ''
      if (id !== '') out.push(id)
    }
    return out
  } catch {
    return []
  }
}

/**
 * 默认模型：宿主自己选定的那个——**但要先确认它挑的 provider 真的有 adapter**。
 *
 * 宿主里 `agentDefaultModel` 与 `llm` 是两处配置：默认模型可以指着一个 `llm` 根本没注册
 * adapter 的 provider（真机上就踩到过：默认写 `mmt-vision · deepseek-v4-flash-tencent`，
 * 而 `llm.listProviders()` 里只有 `deepseek-official/mmt/mmtv/mmtv-openai`），照它发出去
 * 每批都会以 `no adapter registered for provider` 失败，整批 422——用户看到的却是"AI 不好使"。
 * 所以：provider 没注册就避开，先在同名模型的已注册 provider 里找一个（模型名不变、换个能用的
 * adapter），再退到第一个已注册 provider；每一步都记一条说明，绝不悄悄换成别的模型还不吭声。
 */
async function defaultRoute(services: HostAiServices, notes: string[]): Promise<HostAiRoute | null> {
  const picker = services.defaultModel
  if (picker !== undefined && typeof picker.currentSelection === 'function') {
    try {
      const selection = picker.currentSelection()
      const provider = typeof selection?.provider === 'string' ? selection.provider.trim() : ''
      const model = typeof selection?.model === 'string' ? selection.model.trim() : ''
      if (provider !== '' && model !== '') {
        const known = providerNames(services)
        if (known.length === 0 || known.includes(provider)) return routeOf(provider, model)
        notes.push(`宿主默认模型的 provider「${provider}」没有注册 adapter（已注册的：${known.join('、')}），已避开`)
        return await sameModelElsewhere(services, model, known, notes)
      }
      notes.push('宿主的 agentDefaultModel 没给出默认模型（没选），改用已注册 provider 的第一条')
    } catch {
      notes.push('读宿主的 agentDefaultModel 时出错，改用已注册 provider 的第一条')
    }
  } else {
    notes.push('宿主没有 agentDefaultModel 服务（未挂载），改用已注册 provider 的第一条')
  }
  return null
}

/**
 * 默认模型用不了时：在已注册 provider 里找**同一个模型名**的那条。
 *
 * 模型名是用户真正选的东西，provider 只是"从哪条线出去"；同名模型换个已注册的 adapter 继续用，
 * 比随手换一个模型更接近用户的意图。三级阶梯：
 *   1. 有 provider 报出了这个模型 → 用它（真机上的 `mmt · deepseek-v4-flash-tencent` 走这条）；
 *   2. 谁都没报出**任何**模型（adapter 没实现 listModels 时是常态）→ 第一个已注册 provider 带上
 *      用户选的模型名试一次 —— 宿主自己的文档写着模型目录只是建议性的，缺席不等于发不出去；
 *   3. 目录里有数据、但确实没有这个模型 → 这里返回 null，交给 `candidateRoutes()` 的备选循环
 *      挑一个**报得出来**的模型（照实记说明）。
 */
async function sameModelElsewhere(
  services: HostAiServices,
  model: string,
  known: readonly string[],
  notes: string[],
): Promise<HostAiRoute | null> {
  const llm = services.llm
  if (llm === undefined) return null
  let anyCatalog = false
  for (const provider of known) {
    const models = await modelsOf(llm, provider)
    if (models.length > 0) anyCatalog = true
    if (models.includes(model)) {
      notes.push(`改用已注册 provider「${provider}」上的同一个模型：${model}`)
      return routeOf(provider, model)
    }
  }
  const first = known[0]
  if (!anyCatalog && first !== undefined) {
    notes.push(`已注册 provider 都没报出模型目录，先用「${first}」带上默认模型 ${model} 试一次`)
    return routeOf(first, model)
  }
  if (anyCatalog) notes.push(`已注册的 provider 都没有模型「${model}」，改用第一个报得出模型的 provider`)
  return null
}

function routeOf(provider: string, model: string): HostAiRoute {
  return { provider, model, label: `${provider} · ${model}` }
}

/**
 * 挑一条路由（= 候选表的第一条）。
 *
 * 优先级：配置里指名的模型 > 宿主选定的默认模型 > 宿主第一个已注册 provider 的第一条。
 * **可用性以 `llm.listProviders()` 为准**：只有注册过 adapter 的 provider 才发得出去（默认模型
 * 指着一个没注册的 provider 时会被避开并记说明）。三条都挑不出来时报"到底缺什么"，绝不伪造模型名。
 *
 * 真正的调用走的是 `candidateRoutes()`：那里给的是**一整张按顺序的候选表**，首选发不出去
 * （`no adapter registered` / 401 / 连不上）时才会用后面的，见 `createHostAi()`。
 */
export async function pickRoute(
  services: HostAiServices,
  want: string,
  notes: string[] = [],
): Promise<HostAiRoute | { reason: string }> {
  const set = await candidateRoutes(services, want, '', notes)
  if ('reason' in set) return set
  return set.routes[0] as HostAiRoute
}

/**
 * 按顺序排好的候选路由表。
 *
 * 配置指名了就**只有那一条**（显式即显式：不许在用户眼皮底下换 provider）；没指名时按
 * "宿主默认模型 → 同名模型换个已注册 adapter → 其余已注册 provider 各一条" 排，首选之外的都是
 * 备选，仅在同一批发不出去时才轮到它们。
 */
async function candidateRoutes(
  services: HostAiServices,
  want: string,
  wantProvider: string,
  notes: string[],
): Promise<{ routes: HostAiRoute[] } | { reason: string }> {
  const llm = services.llm
  if (llm === undefined) return { reason: NO_LLM }
  const known = providerNames(services)
  const pinnedProvider = wantProvider.trim()
  const wanted = want.trim()

  /* `understandProvider`：把 provider 钉死。模型要么由 `understandModel` 给，要么取它"最可能能用"的那条。 */
  if (pinnedProvider !== '') {
    if (known.length > 0 && !known.includes(pinnedProvider)) {
      return {
        reason:
          `understandProvider「${pinnedProvider}」在宿主里没有注册 adapter` +
          `（已注册的：${known.join('、') || '一个都没有'}）——换个 provider，或把它从配置里去掉。`,
      }
    }
    let model = ''
    if (wanted.includes(':')) {
      const colon = wanted.indexOf(':')
      const wantedProvider = wanted.slice(0, colon).trim()
      model = wanted.slice(colon + 1).trim()
      if (wantedProvider !== '' && wantedProvider !== pinnedProvider) {
        return { reason: `understandModel「${wanted}」里的 provider 与 understandProvider「${pinnedProvider}」不一致，只能留一个` }
      }
      if (model === '') return { reason: `understandModel「${wanted}」写法不对：应当是 provider:model` }
    } else {
      model = wanted !== '' ? wanted : await bestModel(llm, pinnedProvider, '')
    }
    if (model === '') {
      return { reason: `provider「${pinnedProvider}」报不出可用模型，也没有默认模型可用：请在配置里写明 understandModel` }
    }
    return { routes: [routeOf(pinnedProvider, model)] }
  }

  if (wanted !== '') {
    if (wanted.includes(':')) {
      const colon = wanted.indexOf(':')
      const provider = wanted.slice(0, colon).trim()
      const model = wanted.slice(colon + 1).trim()
      if (provider === '' || model === '') return { reason: `understandModel「${wanted}」写法不对：应当是 provider:model` }
      if (known.length > 0 && !known.includes(provider)) {
        return { reason: `宿主没有注册 provider ${provider}（已注册的：${known.join('、') || '一个都没有'}）` }
      }
      return { routes: [routeOf(provider, model)] }
    }
    /* 只给了模型名：在宿主已注册的 provider 里找所有提供它的（同名模型可能挂在多条线上，
       第一条发不出去还有下一条）。与旧实现的"偏好表"不同，这里认的是宿主的事实。 */
    const carriers: HostAiRoute[] = []
    for (const provider of known) {
      const models = await modelsOf(llm, provider)
      if (models.includes(wanted)) carriers.push(routeOf(provider, wanted))
    }
    if (carriers.length > 0) return { routes: carriers }
    return {
      reason:
        `宿主已注册的 provider 都没有模型「${wanted}」` +
        (known.length > 0 ? `（已注册的：${known.join('、')}）` : '（一个 provider 都没注册）'),
    }
  }

  const routes: HostAiRoute[] = []
  const push = (route: HostAiRoute): void => {
    if (!routes.some((item) => item.provider === route.provider && item.model === route.model)) routes.push(route)
  }

  const byDefault = await defaultRoute(services, notes)
  if (byDefault !== null) push(byDefault)
  /* 备选：每个已注册 provider 各来一条"它最可能能用"的路由（默认模型它也有的话，优先用它）。 */
  for (const provider of known) {
    const model = await bestModel(llm, provider, byDefault?.model ?? '')
    if (model !== '') push(routeOf(provider, model))
  }
  if (routes.length === 0) {
    return {
      reason:
        '宿主没有可用的模型路由：agentDefaultModel 没给出选择，llm.listProviders() 也没有可用的 provider' +
        '（宿主侧要配好 provider 并选一个默认模型）。',
    }
  }
  return { routes }
}

/**
 * 某个 provider 上"最可能能用"的模型：优先用它自己报出来的默认模型，其次它报的第一条。
 *
 * 模型目录是建议性的（宿主文档原话）：一条都没报出来时，宁可带上已知的模型名试一次，
 * 也不要凭空判它死刑。
 */
async function bestModel(llm: HostLlmLike, provider: string, prefer: string): Promise<string> {
  const models = await modelsOf(llm, provider)
  if (prefer !== '' && models.includes(prefer)) return prefer
  if (models.length > 0) return models[0] as string
  return models.length === 0 ? prefer : ''
}

/**
 * 这一批错误属于"这条路根本没给出答案"，值得换下一条候选。
 *
 * 默认**换**，只有这三类不换，因为换一条线也是一样的结果：
 *   - 模型要求调用工具：我们的提示词里根本没有工具，换谁都会这样；
 *   - 我自己的超时：这条线慢/卡，再等一条只会让用户等更久（可读的超时错误更有用）；
 *   - 用户取消。
 *
 * 为什么反过来定（默认换，而不是列一串"发不出去"的关键词）——真机实测踩到过两次：
 *  1. `llm-pi-ai: no credential for provider route "mmt"; its profile resolves MMT_API_KEY, which is not set`
 *     这种原话不在任何关键词表里。按"列举"的写法就会**不换线**：用户拿着一条根本发不出去的首选，
 *     看到"AI 不好使"，而后面那条候选其实是通的。
 *  2. `输出被 max_tokens 截断`：同一批真契约、同一条线，预算 4000 时截断（23 秒后整批失败），
 *     预算 16000 时正常返回并通过校验——截断是"这条线在这个预算下没说完"，换一条线很可能说得完。
 *
 * 反过来定的代价只是多试几条（每次都记进说明里，谁都能看见），换来的是"只要还有一条能用的线，
 * 就别让用户看到失败"。
 */
const HOPELESS_FAILURE = /要求调用工具|没有响应|aborted|用户取消/i

function isRouteFailure(message: string): boolean {
  return !HOPELESS_FAILURE.test(message)
}

/** 现取一次状态（面板的"现在到底有没有 AI"就走它）。 */
export async function describeHostAi(services: HostAiServices, model = '', provider = ''): Promise<HostAiStatus> {
  const providers = providerNames(services)
  if (services.llm === undefined) {
    return { available: false, path: 'host-llm', providers, route: null, fallbacks: [], reason: NO_LLM, notes: [] }
  }
  const notes: string[] = []
  const set = await candidateRoutes(services, model, provider, notes)
  if ('reason' in set) {
    return { available: false, path: 'host-llm', providers, route: null, fallbacks: [], reason: set.reason, notes }
  }
  const first = set.routes[0] as HostAiRoute
  return {
    available: true,
    path: 'host-llm',
    providers,
    route: first.label,
    fallbacks: set.routes.slice(1).map((route) => route.label),
    reason: '',
    notes,
  }
}

/**
 * 装一个 `AiCaller`：路由挑不出来就给原因（路由层据此回 503），挑出来就给能用的 caller。
 *
 * `system` 与 `user` 原样送过去——提示词怎么拼是 `understand.ts` 的事，这一层不加工、不裁剪。
 *
 * **会换线，但只在"这条路根本发不出去"时**：宿主里允许注册多条线，默认模型指的那条未必有
 * adapter（真机上就踩到过 `no adapter registered for provider "mmt-vision"`）。这种情况按候选表
 * 顺序换下一条重发同一批；一旦某条成功就记住它，后面的批次不再试。**内容类问题绝不换线**：
 * 截断、没文本、校验不过都是"这批没成"，换一条线再来一次只会把真实问题掩盖掉。
 */
export async function createHostAi(options: HostAiOptions): Promise<HostAiReady> {
  const notes: string[] = []
  const set = await candidateRoutes(options.services, options.model ?? '', options.provider ?? '', notes)
  if ('reason' in set) return { ok: false, reason: set.reason, notes }
  const routes = set.routes
  const llm = options.services.llm
  /* candidateRoutes 已经证明 llm 在，这里只是把类型收窄（不是防御性判空）。 */
  if (llm === undefined) return { ok: false, reason: NO_LLM, notes }
  const first = routes[0] as HostAiRoute

  /** 已经确定能用的那条；换线成功后所有后续批次都从它开始。 */
  let at = 0

  const streamOnce = async (route: HostAiRoute, turn: { system: string; user: string }): Promise<string> => {
    const signal = AbortSignal.timeout(options.timeoutMs)
    const parts: string[] = []
    let finish = ''
    let failure = ''
    try {
      const streamed = llm.stream({
        provider: route.provider,
        model: route.model,
        system: turn.system,
        messages: [{ role: 'user', content: [{ type: 'text', text: turn.user }] }],
        maxTokens: options.maxTokens,
        signal,
      })
      /* 宿主的 stream 是 async iterable；万一哪版返回的是 Promise，这里等一次也接得住。 */
      const chunks = (isAsyncIterable(streamed) ? streamed : await streamed) as AsyncIterable<HostLlmChunk>
      if (!isAsyncIterable(chunks)) throw new Error('宿主的 llm.stream 没有返回可迭代的流')
      for await (const chunk of chunks) {
        if (chunk === null || typeof chunk !== 'object') continue
        if (chunk.type === 'text-delta' && typeof chunk.text === 'string') parts.push(chunk.text)
        else if (chunk.type === 'finish') {
          finish = typeof chunk.reason?.kind === 'string' ? chunk.reason.kind : ''
          failure = typeof chunk.reason?.failure?.message === 'string' ? chunk.reason.failure.message : ''
        }
      }
    } catch (error) {
      if (signal.aborted) throw new Error(timeoutMessage(options.timeoutMs))
      throw new Error(`调宿主模型失败：${clip(error instanceof Error ? error.message : String(error), 300)}`)
    }
    if (signal.aborted) throw new Error(timeoutMessage(options.timeoutMs))
    /* 围栏是包装问题，不是内容问题：先脱掉，再由上面那把唯一的闸门判合格与否。 */
    const text = stripFence(parts.join('').trim())
    /* 终止块与旧实现的两个"必须当失败"的口径对齐：没有文本、被 max_tokens 截断。截断的 JSON 是
       "不完整的对象"，放它过关就会变成"看起来理解成功了、其实少了一半契约"。 */
    if (finish === 'error' || finish === 'aborted') {
      throw new Error(`宿主模型这一路失败了：${clip(failure, 300) || finish}`)
    }
    if (finish === 'max-tokens') throw new Error('输出被 max_tokens 截断（JSON 不完整）')
    if (text === '') {
      throw new Error(finish === 'tool-calls' ? '模型要求调用工具，而不是回答' : '模型没有返回文本内容')
    }
    return text
  }

  const caller: AiCaller = async (turn) => {
    const started = Date.now()
    for (let index = at; index < routes.length; index += 1) {
      const route = routes[index] as HostAiRoute
      try {
        const text = await streamOnce(route, turn)
        /* 这条线能用：记住它，后面的批次直接从它开始（不再从首选重试一遍）。 */
        if (index !== at) notes.push(`已换到 ${route.label}`)
        at = index
        return { text, channel: route.label, ms: Date.now() - started }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        /* 最后一条、或不是"发不出去"这一类：原样抛出——真实原因不许被换线掩盖。 */
        if (index + 1 >= routes.length || !isRouteFailure(message)) throw error
        /* 换线要说出来（面板与日志都看得到），否则"结果来自哪条线"就说不清了。 */
        notes.push(`${route.label} 发不出去（${clip(message, 160)}），换下一条候选`)
      }
    }
    throw new Error(`宿主注册的 ${routes.length} 条候选路由都发不出去`)
  }

  return { ok: true, caller, route: first, notes }
}

/** 宿主返回的东西是不是能 `for await`。 */
function isAsyncIterable(value: unknown): value is AsyncIterable<HostLlmChunk> {
  return value !== null && typeof value === 'object' && Symbol.asyncIterator in (value as object)
}

/**
 * 剥掉**包住整段**的一层 Markdown 围栏（```json … ``` / ``` … ```）。
 *
 * 提示词里明写着"不要 Markdown 代码块"，但写不写是模型的事，而围栏会让整批以
 * "AI 返回不是合法 JSON" 被拒——用户看到的是"AI 不好使"，其实是包装问题。这里只做这一件事：
 * 围栏必须**从第一个字符包到最后一个字符**才剥；从一堆散文里"找一段 JSON"是另一回事，不做——
 * 那种返回就该被拒，让用户看到模型真的没按要求答。剥完是不是合格，仍由 `validateAiPayload` 说了算。
 */
function stripFence(text: string): string {
  const match = /^```[a-zA-Z0-9_-]*[ \t]*\r?\n([\s\S]*?)\r?\n?```$/.exec(text.trim())
  return match?.[1] === undefined ? text : match[1].trim()
}