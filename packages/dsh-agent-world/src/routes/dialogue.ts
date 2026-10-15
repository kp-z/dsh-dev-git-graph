/**
 * 对话通道（BACKLOG M6-3）：`POST /api/say` + 对话事件的中转。
 *
 * ## 这一层只做传输，不做"怎么想"
 *
 * 契约（`src/protocol/dialogue.ts`，R22 冻结）把时序定死了：
 *
 *     面板 ──POST /api/say──▶ 本文件：登记一次对话，**立刻**返回 { accepted, turnId }
 *     本文件 ──DialogueEvent──▶ SSE ──▶ 所有面板：thinking → replied / failed
 *
 * 所以 `parseSay()` 是**同步**的：它只判断"这话能不能收"，一个模型字节都不碰。
 * 在 HTTP 里等模型会把面板和宿主一起拖住——这正是 R21 那条教训
 * （"前端卡顿常常来自在错误的层等了不该等的东西"）。
 *
 * ## 为什么在这里定义 `DialoguePort`，而不是 import `bridge`
 *
 * `src/protocol/boundaries.ts` 规定 `routes` 只许 import `['protocol','runtime','scene']`。
 * 所以传输层**不认识**"DSH 会话"这个东西，只认识一个三方法的形状；
 * 由组合根（`src/index.ts`）把 `toDialoguePort(bridge)` 注进来。
 * 好处很实际：本文件可以在**完全没有 Agent 服务的环境**里被单测（假 port 即可），
 * 而"没有 port"本身就是一条必须退化的真实路径（headless profile）。
 *
 * ## 上限（决策 D36）
 *
 * 上限数的是**已唤醒的角色数**（被搭过话的角色），不是"正在进行中的轮次"。
 * 这是刻意的：D36 要控的成本是**会话**，不是某一句话——所以名额由
 * `release`/`disposeAll` 释放，而不是一句话说完就还回去。
 * 对成本上限来说**多算比少算安全**：少算会超开模型会话（真花钱），
 * 多算只会让用户看到一条写清了当前值/上限/怎么办的拒绝。
 */
import type { RouteEntry } from './router.js'
import type { DialogueEvent, DialogueSpeaker, SayResponse, WorldServicePort } from '../protocol/index.js'

/**
 * 对话端口：传输层需要的**全部** Agent 能力。
 *
 * 与 `src/bridge/dialogue-port.ts` 的 `DialoguePortFace` 结构等价（各自声明，见文件头）。
 */
export interface DialoguePort {
  /** 把一句话投给角色。`ok` 只表示"投出去了"，回复另走 `waitForReply`。 */
  say(characterId: string, text: string): Promise<{ readonly ok: true } | { readonly ok: false; readonly reason: string }>
  /** 等这个角色的下一条回复；超时/出错都返回可下手的 `reason`。 */
  waitForReply(
    characterId: string,
    timeoutMs: number,
  ): Promise<{ readonly ok: true; readonly text: string } | { readonly ok: false; readonly reason: string }>
  /** 当前活着的会话数（诊断用）。 */
  liveCount(): number
}

/** 建对话通道需要的依赖。 */
export interface DialogueDeps {
  service: WorldServicePort
  /** 没有它时对话仍会被登记，但会以 `failed` + 原因收场（headless profile 的真实路径）。 */
  port?: DialoguePort
  /** 覆盖上限；不传则读 `service.config.maxLiveSessions`。 */
  maxLiveSessions?: number
  /** 等模型回复的超时（ms）。默认 60 秒。 */
  replyTimeoutMs?: number
  /** 旁路错误日志（一个坏监听器不该打断对话）。 */
  onError?: (reason: string) => void
}

/** 对话通道。 */
export interface DialogueChannel {
  /** 处理 `POST /api/say` 的请求体。**同步**返回（不等模型）。 */
  parseSay(body: unknown): SayResponse
  /** 订阅对话事件（SSE 路由用）。返回取消订阅。 */
  subscribe(listener: (event: DialogueEvent) => void): () => void
  /** 已登记（唤醒）的角色数 —— 面板"会话数"的数据源。 */
  awakeCount(): number
  /** 世界重开 / 插件卸载时清空登记。 */
  reset(): void
}

/** 上限的兜底值，与 `config.ts` 的 schema default 保持一致。 */
const DEFAULT_MAX_LIVE_SESSIONS = 4

/** 等回复的兜底超时（ms）。 */
const DEFAULT_REPLY_TIMEOUT_MS = 60_000

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/**
 * 从插件状态里读上限。
 *
 * **结构式读取**而不是 `import { resolveConfig }`：`routes` 的边界规则里没有 `config`，
 * 而这里真正需要的只是一个数字。`state.config` 是 `PluginState` 的公开字段（`config.ts` 注释
 * 也写了它必须与 schema 一一对应），所以这不是偷看私有实现。
 */
function capFrom(service: unknown, override: number | undefined): number {
  if (override !== undefined && Number.isInteger(override) && override > 0) return override
  const config = (service as { config?: { maxLiveSessions?: unknown } } | null | undefined)?.config
  const value = config?.maxLiveSessions
  if (typeof value === 'number' && Number.isInteger(value) && value > 0) return value
  return DEFAULT_MAX_LIVE_SESSIONS
}

/**
 * 造一个对话通道。
 *
 * @param deps - 见 {@link DialogueDeps}。
 */
export function createDialogueChannel(deps: DialogueDeps): DialogueChannel {
  const cap = capFrom(deps.service, deps.maxLiveSessions)
  const replyTimeoutMs =
    deps.replyTimeoutMs !== undefined && deps.replyTimeoutMs > 0 ? deps.replyTimeoutMs : DEFAULT_REPLY_TIMEOUT_MS

  /** 已唤醒的角色 id。**这是上限的计数依据，也是"同一角色不重复占名额"的依据。** */
  const awake = new Set<string>()
  const listeners = new Set<(event: DialogueEvent) => void>()
  let turnSeq = 0

  /** 世界 tick。**对话是世界里发生的事（D38），所以时间用世界 tick，不用 `Date.now()`。** */
  function worldTick(): number {
    return deps.service.currentWorld()?.tick ?? 0
  }

  function emit(event: DialogueEvent): void {
    for (const listener of [...listeners]) {
      try {
        listener(event)
      } catch (error) {
        deps.onError?.(`对话事件监听器抛了（已忽略，不影响其它面板）：${messageOf(error)}`)
      }
    }
  }

  function emitFailure(
    turnId: string,
    from: DialogueSpeaker,
    to: DialogueSpeaker,
    reason: string,
  ): void {
    emit({ turnId, tick: worldTick(), phase: 'failed', from, to, text: '', reason })
  }

  /**
   * 一轮对话的**异步**部分：投递 → 等回复 → 发 `replied` / `failed`。
   *
   * 刻意 `void` 调用（fire-and-forget）：HTTP 响应已经在它之前发出去了，
   * 所以模型多慢都不会体现在 `/api/say` 的耗时里。
   */
  async function runTurn(input: {
    readonly turnId: string
    readonly agentId: string
    readonly text: string
    readonly from: DialogueSpeaker
    readonly to: DialogueSpeaker
  }): Promise<void> {
    const port = deps.port
    try {
      if (port === undefined) {
        emitFailure(
          input.turnId,
          input.from,
          input.to,
          '对话通道没启用（DSH 会话服务不可用）：这句话已经登记，但没有会话能回它。' +
            '确认插件加载的 profile 里挂了会话服务，再试一次。',
        )
        return
      }

      const ack = await port.say(input.agentId, input.text)
      if (!ack.ok) {
        emitFailure(input.turnId, input.from, input.to, ack.reason)
        return
      }

      const reply = await port.waitForReply(input.agentId, replyTimeoutMs)
      if (!reply.ok) {
        emitFailure(input.turnId, input.from, input.to, reply.reason)
        return
      }

      emit({
        turnId: input.turnId,
        tick: worldTick(),
        phase: 'replied',
        from: input.to,
        to: input.from,
        text: reply.text,
      })
    } catch (error) {
      // 任何漏网的异常都要变成一条 `failed`（带原因），绝不能让面板永远停在"他在想"。
      emitFailure(input.turnId, input.from, input.to, `对话处理出错：${messageOf(error)}`)
    }
  }

  return {
    parseSay(body: unknown): SayResponse {
      const world = deps.service.currentWorld()
      if (world === null) {
        return { accepted: false, reason: '世界还没建出来，没有人可以搭话。这通常是内容层有错误——见 agent_world_content 的输出。' }
      }

      if (typeof body !== 'object' || body === null) {
        return { accepted: false, reason: '请求体要形如 {"agentId":"agent-3","text":"你去把登录 bug 修一下"} 的对象。' }
      }

      const { agentId, text } = body as { agentId?: unknown; text?: unknown }
      const ids = world.agents.map((agent) => agent.id)

      // 角色不存在时**同时**给出被拒的 id 与可用取值：只说"不存在"用户没法照做。
      if (typeof agentId !== 'string' || agentId.trim() === '' || !ids.includes(agentId)) {
        return {
          accepted: false,
          reason: `角色 ${JSON.stringify(agentId ?? null)} 不存在：世界里现在有 ${ids.length === 0 ? '（一个都没有）' : ids.join('、')}。`,
        }
      }

      if (typeof text !== 'string' || text.trim() === '') {
        return { accepted: false, reason: '文本为空或全是空白：说话内容不能为空，请输入一句话再发。' }
      }

      // 已经醒着的角色不重复占名额（同一角色说十句话也只是一个会话）。
      if (!awake.has(agentId) && awake.size >= cap) {
        return {
          accepted: false,
          reason:
            `已唤醒 ${awake.size} 个角色，上限 ${cap}（maxLiveSessions）：` +
            '先让某个角色下线（释放会话），或调大插件配置里的 maxLiveSessions 再试。' +
            '这个角色没有被唤醒，他保持原来的行为。',
        }
      }
      awake.add(agentId)

      turnSeq += 1
      const turnId = `turn-${turnSeq}`
      const from: DialogueSpeaker = { kind: 'god' }
      const to: DialogueSpeaker = { kind: 'agent', id: agentId }

      // `thinking` 的 text 带**提问者原话**（契约决定，R22）：
      // 对话是世界里的事件（D38），第二个面板/刷新后的面板必须也能看到玩家说了什么。
      emit({ turnId, tick: worldTick(), phase: 'thinking', from, to, text })

      void runTurn({ turnId, agentId, text, from, to })

      return { accepted: true, turnId }
    },

    subscribe(listener) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },

    awakeCount: () => awake.size,

    reset() {
      awake.clear()
      turnSeq = 0
    },
  }
}

/** `POST /api/say` 的路由表。 */
export function dialogueRoutes(channel: DialogueChannel): RouteEntry[] {
  return [
    {
      method: 'POST',
      pattern: '/api/say',
      handler: (request) => channel.parseSay(request.body),
    },
  ]
}
