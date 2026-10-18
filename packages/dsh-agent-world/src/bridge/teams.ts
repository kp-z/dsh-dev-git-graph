/**
 * 套壳在 `@nanmicoder/dsh-agent-teams` 上的对话端口（R37）。
 *
 * ## 为什么这么做
 *
 * R24–R36 我们自己在 `character-bridge.ts` 里手写了整套角色会话生命周期：
 * 建会话、already exists 转 resume、人设 section、工具白名单、发话、等回复、
 * 死会话自愈……约 2300 行，而且真机上每踩一个坑就打一个补丁。
 *
 * 用户指出（原话）：*"这些会话功能……为什么不直接在 dsh-agent-teams 这个插件上套壳？"*
 * 查过契约之后确认他是对的：`dsh-agent-teams` 已经提供了持久的子 agent、成员名册、
 * 信箱、带依赖的任务图与调度器，**我们只需要当队长**。
 *
 * ## 套壳的确切方式（都是读真实现得到的，不是猜的）
 *
 * - 它**不暴露服务**，只注册 14 个 `agent_teams_*` 工具（`lib/index.js` 的
 *   `inject = ['tools','llm','subagents','systemPrompt','agents']`）。
 * - 工具从 `exec.agent` 拿调用者（`tools.js` 的 `requireCaptain`：
 *   *"agent_teams tools require a calling agent (exec.agent was undefined)"*），
 *   **谁调 `agent_teams_create`，谁就是队长**。
 * - 所以我们的插件持有**一个队长 agent**（一个普通 DSH 会话，它自己从不需要发言），
 *   用 `ctx.tools.execute({ agent: captain, ... })` **确定性地**调这些工具——
 *   不经过任何 LLM 转述，所以是快且可测的。
 * - 成员由它的 `spawnMember` 通过 `ctx.subagents.startContinuable` 建出来，
 *   会话 id 就是 `start.childId`，label 是 `agent-teams:<teamId>:<成员名>`
 *   （`members.js`：`const MEMBER_LABEL_PREFIX = 'agent-teams:'`）。
 *   **成员的会话 id 我们用官方接口 `subagents.listChildren(captainId)` 按 label 反查**，
 *   不去读它内部的状态文件。
 * - 人设走 `agent_teams_add_member` 的 `executionPrompt`，它会被拼进
 *   `memberPersona()`（`members.js`）里的 "Execution guidance" 段。
 *
 * ## 与旧实现的关系
 *
 * 这个模块实现**同一个** `DialoguePortFace`（`say` / `waitForReply` / `liveCount`）。
 * 路由（`src/routes/dialogue.ts`）、协议、面板都不需要知道背后换人了。
 * 旧的手写实现保留到真机验证通过为止，用配置开关切换。
 */
import type { BridgeAgentHandle, BridgeAgentOptions, BridgeAction, CharacterBridge } from './types.js'

/** 与 `routes/dialogue.ts` 里 `DialoguePort` 同形；两边靠结构兼容，不互相 import。 */
export interface TeamsDialogueAck {
  readonly ok: true
}
export interface TeamsDialogueFailure {
  readonly ok: false
  readonly reason: string
}
export interface TeamsDialogueReplyOk {
  readonly ok: true
  readonly text: string
  readonly actions: readonly BridgeAction[]
}

/** 一次工具调用的结果（`ctx.tools.execute` 的返回）。只用到我们关心的字段。 */
interface ToolExecutionResult {
  readonly isError?: boolean
  readonly content?: readonly unknown[]
  /**
   * 工具的结构化返回值。**字段名是 `value`**——从 `dsh-tools` 的 `materializeFinalResult`
   * 读出来的（`deepFreeze({ ...presentation, value: result.value })`）。
   * 第一版我写成了 `structured`，真机上团队明明建好了却被当成失败（R37）。
   */
  readonly value?: unknown
  /** 失败时的错误（`isError: true` 分支带它；文字可能只在这里，不在 content 里）。 */
  readonly error?: unknown
}

/** `ctx.tools` 里我们用到的部分。 */
interface ToolScope {
  execute?(input: {
    readonly callId: string
    readonly name: string
    readonly arguments: Record<string, unknown>
    readonly agent: unknown
    readonly signal: AbortSignal
  }): Promise<ToolExecutionResult>
}

/**
 * 一条 `user/message` 的文本是否**含我们发出去的原话**（R119）。
 *
 * 用"包含"而不是"相等"：agent-teams 投递时会包一层信封
 *（实测：`AgentTeams message from member 工头阿金: …原话…`），所以原话是子串。
 * 原话为空时一律不匹配——否则空串会"包含于"任何消息，把第一条无关消息认成我们的。
 */
export function containsSentText(data: Record<string, unknown>, sentText: string): boolean {
  if (sentText === '') return false
  const content = data['content']
  if (!Array.isArray(content)) return false
  for (const block of content) {
    if (typeof block !== 'object' || block === null) continue
    const b = block as Record<string, unknown>
    if (b['type'] === 'text' && typeof b['text'] === 'string' && b['text'].includes(sentText)) return true
  }
  return false
}

/** `ctx.subagents` 里我们用到的部分（官方接口，用来按 label 反查成员会话）。 */
interface SubagentScope {
  listChildren?(parentSessionId: string, signal?: AbortSignal): Promise<readonly { readonly id: string; readonly label?: string }[]>
}

/** 建端口要的东西。**全部注入**，所以这个模块可以被单测完全驱动。 */
export interface TeamsPortOptions {
  /** 队长会话 id。固定值，所以重启后还是同一个队长、同一个团队。 */
  readonly captainSessionId: string
  /** 队长的工作目录（团队状态落在 `<cwd>/<stateDir>/<teamId>/`）。 */
  readonly cwd: string
  /** 团队名（会变成 teamId）。 */
  readonly teamName: string
  /** 团队目标，写进成员人设的 "Team goal"。 */
  readonly teamDescription: string
  /** 角色 id → 成员名（内容库给，代码里零字面量）。 */
  readonly memberNameFor: (characterId: string) => string
  /** 角色 id → 岗位（写进成员人设的 role）。 */
  readonly memberRoleFor: (characterId: string) => string
  /** 角色 id → 人设正文（走 `executionPrompt`）。 */
  readonly personaFor: (characterId: string) => string
  /**
   * 成员的工具策略 id（agent-teams 的 `toolPolicies` 里由部署方声明，成员按 id 选）。
   * 用它把角色限制成"只许动世界"（D35）。不给 = 用 agent-teams 的默认工具集。
   */
  readonly toolPolicy?: string
  /** 模型路由（成员的 provider/model）。 */
  readonly agentOptionsFor?: () => BridgeAgentOptions | undefined
  /** 旁路错误日志。 */
  readonly onError?: (reason: string) => void
  /** 惰性建队长会话；由 `dsh-adapter` 提供（与旧实现共用同一套 create/resume 兜底）。 */
  readonly createCaptain: (sessionId: string, cwd: string) => Promise<BridgeAgentHandle>
}

/** 端口能对外说的东西（与 `DialoguePort` 结构兼容）。 */
export interface TeamsPort {
  say(characterId: string, text: string): Promise<TeamsDialogueAck | TeamsDialogueFailure>
  waitForReply(
    characterId: string,
    timeoutMs: number,
    onProgress?: (actions: readonly BridgeAction[]) => void,
  ): Promise<TeamsDialogueReplyOk | TeamsDialogueFailure>
  liveCount(): number
  /** 诊断：当前团队 id（还没建出来时 `undefined`）。 */
  teamId(): string | undefined
  /**
   * 读团队里的全部任务（D41，R43）。
   *
   * 走 `agent_teams_status`：agent-teams 的任务事件**不写进会话**（这个宿主不认识 `agent-teams/*` 事件类型，
   * 它原话 "Disk state remains the authoritative source"），所以只能问它。
   * 返回值字段是从 `lib/tools.js` 的 status 段读出来的：`tasks[].{id,subject,status,assignee,dependencies,attempt_id}`。
   *
   * @returns 任务列表；团队还没建出来时空数组。
   */
  readTasks(): Promise<readonly TeamTaskRow[]>
  /**
   * 在团队里建一张任务（D41，R43）。`dependencies` 是**团队任务 id**（先建的先拿到 id）。
   *
   * @returns 新任务的 id（`value.task_id`）。
   */
  createTask(input: { subject: string; description?: string; dependencies?: readonly string[] }): Promise<string>
  dispose(): Promise<void>
}

/** `agent_teams_status` 里一张任务的原样字段（只取小镇用得上的）。 */
export interface TeamTaskRow {
  readonly id: string
  readonly subject: string
  readonly status: 'pending' | 'claimed' | 'in_progress' | 'completed' | 'failed' | 'cancelled'
  readonly assignee: string
  readonly dependencies: readonly string[]
  readonly attemptId: string
  readonly output: string
}

/** 一次调用的顺序号：`callId` 要唯一且确定（不用随机数、不用时钟）。 */
let callSeq = 0

/**
 * 建一个套在 `dsh-agent-teams` 上的对话端口。
 *
 * @param tools - `ctx.tools`（缺了就直接报出来：没有它调不了 `agent_teams_*`）。
 * @param subagents - `ctx.subagents`（用来按 label 反查成员会话）。
 * @param transport - 会话事件订阅（复用旧实现那套，抓成员的回复）。
 */
export function createTeamsPort(
  tools: unknown,
  subagents: unknown,
  transport: { subscribe(listener: (sessionId: string, event: unknown) => void): () => void } | undefined,
  options: TeamsPortOptions,
): TeamsPort {
  const toolScope = tools as ToolScope | undefined
  const subagentScope = subagents as SubagentScope | undefined

  let captain: BridgeAgentHandle | undefined
  let teamId: string | undefined
  /** 已经加进名册的成员名（幂等：同一个角色说第二句话不重复加）。 */
  const addedMembers = new Set<string>()
  /** 成员名 → 会话 id（第一次用到时反查，之后记住）。 */
  const memberSessions = new Map<string, string>()
  let disposed = false

  const report = (reason: string): void => options.onError?.(reason)

  /**
   * 调一个 `agent_teams_*` 工具。
   *
   * `tools.execute` 的入参形状是从 `dsh-tools` 的 `createExecution` 读出来的：
   * 它取 `exec.callId` / `exec.name` / `exec.agent` / `exec.signal` / `exec.arguments`。
   */
  async function callTeamTool(
    name: string,
    args: Record<string, unknown>,
    signal: AbortSignal,
  ): Promise<ToolExecutionResult> {
    if (toolScope?.execute === undefined) {
      throw new Error('ctx.tools.execute 不可用：没有它调不了 agent_teams_* 工具')
    }
    if (captain === undefined) throw new Error('队长会话还没建出来')
    callSeq += 1
    return await toolScope.execute({
      callId: `agent-world-teams-${callSeq}`,
      name,
      arguments: args,
      agent: captain.agent,
      signal,
    })
  }

  /** 把一次工具结果里的文字拼出来（失败时用来拼可下手的原因）。 */
  function textOf(result: ToolExecutionResult): string {
    const parts: string[] = []
    const err = result.error as { message?: unknown; reason?: unknown } | string | undefined
    if (typeof err === 'string') parts.push(err)
    else if (err !== undefined && err !== null) {
      if (typeof err.message === 'string') parts.push(err.message)
      if (typeof err.reason === 'string') parts.push(err.reason)
    }
    for (const block of result.content ?? []) {
      if (typeof block === 'object' && block !== null) {
        const b = block as Record<string, unknown>
        if (b['type'] === 'text' && typeof b['text'] === 'string') parts.push(b['text'])
      }
    }
    return parts.join('\n')
  }

  /** 队长的会话（懒建；建不起来就抛，由调用方转成可下手的原因）。 */
  async function ensureCaptain(): Promise<BridgeAgentHandle> {
    if (captain !== undefined) return captain
    const handle = await options.createCaptain(options.captainSessionId, options.cwd)
    captain = handle
    return handle
  }

  /**
   * 建团队（幂等）。
   *
   * `agent_teams_create` 的 `approval: 'automatic'` = 立即执行（另一档是 staged，
   * 要人在面板上点"批准并运行"）。我们用 automatic：**玩家在游戏里说话就是批准**，
   * 不该再让他在另一个面板上点一次。
   *
   * 已经带过队时它会报错（`findTeamByCaptain` 那套），所以把"已经存在"当成成功——
   * 这样插件重启后接回同一个队长不会把世界打死。
   */
  async function ensureTeam(signal: AbortSignal): Promise<string> {
    if (teamId !== undefined) return teamId
    await ensureCaptain()
    const created = await callTeamTool(
      'agent_teams_create',
      { name: options.teamName, description: options.teamDescription, approval: 'automatic' },
      signal,
    )
    const structured = created.value as Record<string, unknown> | undefined
    const id = typeof structured?.['team_id'] === 'string' ? (structured['team_id'] as string) : undefined
    if (id !== undefined && id !== '') {
      teamId = id
      return id
    }
    // 没有 team_id：要么失败了，要么"这个队长已经带了一个队"。
    const detail = textOf(created)
    if (/already|exists|leading/i.test(detail)) {
      // 已经有队：用 status 把 team_id 找回来，而不是重建。
      const status = await callTeamTool('agent_teams_status', {}, signal)
      const s = status.value as Record<string, unknown> | undefined
      const found = typeof s?.['team_id'] === 'string' ? (s['team_id'] as string) : undefined
      if (found !== undefined && found !== '') {
        teamId = found
        return found
      }
    }
    throw new Error(`建团队失败：${detail === '' ? '工具没有返回 team_id' : detail}`)
  }

  /** 把角色加进名册（幂等；人设走 `executionPrompt`）。 */
  async function ensureMember(characterId: string, signal: AbortSignal): Promise<string> {
    const name = options.memberNameFor(characterId)
    if (addedMembers.has(name)) return name
    await ensureTeam(signal)
    const result = await callTeamTool(
      'agent_teams_add_member',
      {
        name,
        role: options.memberRoleFor(characterId),
        executionPrompt: options.personaFor(characterId),
        ...(options.toolPolicy === undefined || options.toolPolicy === '' ? {} : { tool_policy: options.toolPolicy }),
        ...modelArgs(),
      },
      signal,
    )
    const detail = textOf(result)
    // "已经用过的名字"是正常的接回路径（插件重启后同一个团队还在）。
    if (result.isError === true && !/already been used|already/i.test(detail)) {
      throw new Error(`加成员「${name}」失败：${detail}`)
    }
    addedMembers.add(name)
    return name
  }

  /** 成员模型路由：用户选了就带上，没选就让 agent-teams 用队长的路由。 */
  function modelArgs(): Record<string, unknown> {
    let selection: BridgeAgentOptions | undefined
    try {
      selection = options.agentOptionsFor?.()
    } catch (error) {
      report(`读默认模型失败（成员将用队长的路由）：${error instanceof Error ? error.message : String(error)}`)
      return {}
    }
    if (selection === undefined) return {}
    return {
      provider: selection.provider,
      model: selection.model,
      ...(selection.reasoningEffort === undefined ? {} : { reasoning_effort: selection.reasoningEffort }),
    }
  }

  /**
   * 按 label 反查成员的会话 id。
   *
   * label 的格式来自 `members.js`：`` `${MEMBER_LABEL_PREFIX}${team.id}:${member.name}` ``
   * 也就是 `agent-teams:<teamId>:<成员名>`。用**官方接口** `subagents.listChildren`
   * 拿，不读它内部的状态文件——那些是它的实现细节，会随版本变。
   */
  async function resolveMemberSession(memberName: string, signal: AbortSignal): Promise<string | undefined> {
    const cached = memberSessions.get(memberName)
    if (cached !== undefined) return cached
    if (subagentScope?.listChildren === undefined || captain === undefined) return undefined
    const id = (captain.agent as { id?: string }).id
    if (typeof id !== 'string') return undefined
    const children = await subagentScope.listChildren(id, signal)
    const suffix = `:${memberName}`
    const hit = children.find((c) => typeof c.label === 'string' && c.label.startsWith('agent-teams:') && c.label.endsWith(suffix))
    if (hit === undefined) return undefined
    memberSessions.set(memberName, hit.id)
    return hit.id
  }

  /** 角色 id → 最后一次投出去的原话（R119：`waitForReply` 用它认出我们那一轮）。 */
  const lastSentText = new Map<string, string>()

  return {
    async say(characterId: string, text: string): Promise<TeamsDialogueAck | TeamsDialogueFailure> {
      if (disposed) return { ok: false, reason: '插件已卸载：这句话没有投出去。' }
      if (typeof text !== 'string' || text.trim() === '') {
        return { ok: false, reason: '消息是空的（或只有空白）：先打点字再发。' }
      }
      const signal = new AbortController().signal
      try {
        const name = await ensureMember(characterId, signal)
        const result = await callTeamTool('agent_teams_send_message', { to: name, content: text }, signal)
        // R119：记下原话——`waitForReply` 靠它在事件流里认出"装着这句话的那一轮"。
        if (result.isError !== true) lastSentText.set(characterId, text.trim())
        if (result.isError === true) {
          return { ok: false, reason: `消息没投出去：${textOf(result) || '工具报错但没给原因'}` }
        }
        return { ok: true }
      } catch (error) {
        return { ok: false, reason: `套壳 agent-teams 时出错：${error instanceof Error ? error.message : String(error)}` }
      }
    },

    async waitForReply(
      characterId: string,
      timeoutMs: number,
      onProgress?: (actions: readonly BridgeAction[]) => void,
    ): Promise<TeamsDialogueReplyOk | TeamsDialogueFailure> {
      if (transport === undefined) {
        return { ok: false, reason: '拿不到会话事件总线（ctx.on），所以收不到角色的回复。' }
      }
      const signal = new AbortController().signal
      const memberName = options.memberNameFor(characterId)

      let sessionId: string | undefined
      try {
        sessionId = await resolveMemberSession(memberName, signal)
      } catch (error) {
        report(`反查成员会话失败：${error instanceof Error ? error.message : String(error)}`)
      }
      if (sessionId === undefined) {
        return {
          ok: false,
          reason:
            `还没拿到成员「${memberName}」的会话 id（它可能还没被唤醒）。` +
            'agent-teams 的成员在第一次收到消息时才真正建会话，稍等一下再试。',
        }
      }

      return await new Promise<TeamsDialogueReplyOk | TeamsDialogueFailure>((resolve) => {
        const actions: { name: string; detail?: string; ok: boolean }[] = []
        let text = ''
        let settled = false
        /**
         * **我们这一轮是第几轮**（R119 / task-18）。
         *
         * ## 根因
         *
         * 时序是 `say()` **先投递**、`waitForReply()` **后订阅**。旧代码对**任何** `turn/end`
         * 都直接收尾——如果订阅时会话里已经有一轮在跑，我们会先收到**那一轮的 `turn/end`**
         *（而它的正文在我们订阅前就发完了），于是立刻判「没有发言，也没有动手」。
         *
         * 队长会话（`agent-world:captain` = 工头阿金）实测在 58→67 轮之间**连续转轮**：
         * `subagent-settled` / `agent-teams` / `runtime-context` 不断注入消息，它几乎从不空闲。
         * 所以这个误判对 agent-1 是**稳定复现**的（对空闲成员才偶尔看不出来）。
         *
         * ## 判据：认出**装着那句话的那一轮**
         *
         * 真机会话记录（`~/.dsh/sessions/.../agent-world:captain`）实测，我们发出去的原话
         * 会作为一条 `user/message` 出现在会话里（`source.kind` 为 `agent-teams`；
         * character-bridge 那条路是 `user` + `rpcId: agent-world-say:<角色>:<n>`）。
         * 于是：
         *
         *   ① `user/message` 的文本**含我们发出去的原话** ⇒ 记下当前轮次 = **我们这一轮**；
         *   ② 只有**那一轮**的 `turn/end` 才结算。
         *
         * ⚠️ **为什么不用"订阅之后开始的轮次"当判据**（我第一版就是这么写的，被回放测试打回）：
         * 队长会话里 `subagent-settled` 也会**在订阅之后**开启新的轮次（实测 60/63/64 都是），
         * 那些轮次同样"订阅后才开始"，于是它们的 `turn/end` 会被误当成我们的——
         * 把**别人的回复**（如"我先看看团队状态。"）报成答案。
         * **"订阅后开始"只是必要条件，不是充分条件。**
         *
         * ⚠️ **不用时间启发式**（"收到得早所以是陈旧的"）：脆弱、无法测试。
         * 这里用的是事件里的**内容与轮次号**，两者都可在单测里构造。
         *
         * ⚠️ **反向判据同样重要**：真"模型一句话没说"的那一轮**仍会报失败**——
         * 我们那条 `user/message` 照样会到，`ourTurn` 照样认得出来，
         * 它的 `turn/end` 照常结算（`text` 为空 → 报「没有发言」）。
         * 若改成"永远不结算"，就把"坏掉"伪装成"正常"——那比原 bug 更坏。
         */
        const sentText = lastSentText.get(characterId) ?? ''
        let ourTurn: number | null = null
        let currentTurn: number | null = null
        const finish = (result: TeamsDialogueReplyOk | TeamsDialogueFailure): void => {
          if (settled) return
          settled = true
          clearTimeout(timer)
          unsubscribe()
          resolve(result)
        }
        const timer = setTimeout(() => {
          finish({ ok: false, reason: `等了 ${timeoutMs}ms 还没等到「${memberName}」的回复。` })
        }, timeoutMs)

        const unsubscribe = transport.subscribe((sid, raw) => {
          if (sid !== sessionId) return
          const event = raw as { type?: string; data?: unknown } | undefined
          if (event === undefined || typeof event.type !== 'string') return
          const data = (event.data ?? {}) as Record<string, unknown>

          if (event.type === 'turn/start') {
            const turn = data['turn']
            if (typeof turn === 'number') currentTurn = turn
            return
          }

          if (event.type === 'user/message') {
            // 我们发出去的原话会作为一条 user/message 落进会话——认出它，就认出了我们这一轮。
            // 只认**第一次**匹配（同一条消息可能被引用/复述，后面的匹配不是"投递"）。
            if (ourTurn === null && currentTurn !== null && containsSentText(data, sentText)) {
              ourTurn = currentTurn
            }
            return
          }

          if (event.type === 'assistant/message') {
            const message = data['message'] as { content?: unknown } | undefined
            const blocks = Array.isArray(message?.content) ? message?.content : []
            const texts: string[] = []
            for (const block of blocks) {
              if (typeof block !== 'object' || block === null) continue
              const b = block as Record<string, unknown>
              if (b['type'] === 'text' && typeof b['text'] === 'string') texts.push(b['text'])
              if (b['type'] === 'tool-call' && typeof b['name'] === 'string') {
                actions.push({ name: b['name'], ok: true })
              }
            }
            if (texts.length > 0) text = texts.join('\n\n')
            if (actions.length > 0) onProgress?.(actions.map((a) => ({ ...a })))
            return
          }

          if (event.type === 'turn/end') {
            // R119：**只结算"装着那句话的那一轮"**。
            //  · 还没认出我们的轮次 → 任何 `turn/end` 都不结算（宁可等到超时，也不把别人的
            //    回复报成答案——那正是"工头阿金说不出话"的镜像错误）；
            //  · 认出来了 → 只有那一轮的 `turn/end` 算数。
            const endingTurn = data['turn']
            if (ourTurn === null) return
            if (typeof endingTurn === 'number' && endingTurn !== ourTurn) return
            const reason = data['reason'] as { kind?: string; error?: { message?: string } } | undefined
            if (reason?.kind === 'error') {
              finish({ ok: false, reason: `这一轮模型报错（${reason.error?.message ?? '没有详情'}）。` })
              return
            }
            if (text.trim() === '') {
              finish({
                ok: false,
                reason:
                  actions.length === 0
                    ? `「${memberName}」这一轮没有发言，也没有动手。再问一次，或换个说法。`
                    : `「${memberName}」这一轮只动了手（${actions.map((a) => a.name).join('、')}），一句话也没说。`,
              })
              return
            }
            finish({ ok: true, text, actions: actions.map((a) => ({ ...a })) })
          }
        })
      })
    },

    liveCount: () => (captain === undefined ? 0 : 1),
    teamId: () => teamId,

    async readTasks(): Promise<readonly TeamTaskRow[]> {
      if (teamId === undefined) return []
      const signal = new AbortController().signal
      const result = await callTeamTool('agent_teams_status', {}, signal)
      if (result.isError === true) throw new Error(`读团队任务失败：${textOf(result)}`)
      const value = result.value as { tasks?: unknown } | undefined
      const rows = Array.isArray(value?.tasks) ? value.tasks : []
      const out: TeamTaskRow[] = []
      for (const row of rows) {
        if (typeof row !== 'object' || row === null) continue
        const r = row as Record<string, unknown>
        if (typeof r['id'] !== 'string') continue
        out.push({
          id: r['id'],
          subject: typeof r['subject'] === 'string' ? r['subject'] : '',
          status: (typeof r['status'] === 'string' ? r['status'] : 'pending') as TeamTaskRow['status'],
          assignee: typeof r['assignee'] === 'string' ? r['assignee'] : '',
          dependencies: Array.isArray(r['dependencies']) ? (r['dependencies'] as unknown[]).filter((d): d is string => typeof d === 'string') : [],
          attemptId: typeof r['attempt_id'] === 'string' ? r['attempt_id'] : '',
          // status 里**没有** output 字段（它只给完成的结果摘要在 deliverable 里）；留空，完成仍以状态为准。
          output: typeof r['output'] === 'string' ? r['output'] : '',
        })
      }
      return out
    },

    async createTask(input): Promise<string> {
      const signal = new AbortController().signal
      await ensureTeam(signal)
      const result = await callTeamTool(
        'agent_teams_create_task',
        {
          subject: input.subject,
          ...(input.description === undefined || input.description === '' ? {} : { description: input.description }),
          ...(input.dependencies === undefined || input.dependencies.length === 0 ? {} : { dependencies: [...input.dependencies] }),
        },
        signal,
      )
      const value = result.value as { task_id?: unknown } | undefined
      if (result.isError === true || typeof value?.task_id !== 'string' || value.task_id === '') {
        throw new Error(`在团队里建任务失败：${textOf(result) || '工具没有返回 task_id'}`)
      }
      return value.task_id
    },

    async dispose(): Promise<void> {
      disposed = true
      const handle = captain
      captain = undefined
      if (handle !== undefined) {
        try {
          await handle.dispose()
        } catch (error) {
          report(`释放队长会话时出错（已忽略）：${error instanceof Error ? error.message : String(error)}`)
        }
      }
    },
  }
}
