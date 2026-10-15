/**
 * `SessionEvent` → bridge 能用的东西（M6-0 的"怎么收回复"落地）。
 *
 * ## 证据
 *
 * 订阅写法是从本仓库里**真在跑**的两个插件抄的（BRIDGE-RECON §4）：
 * `dsh-taskboard/src/index.ts:97` 与 `packages/dsh-mermaid-comm/src/gate.ts:57,146`。
 * 回复文本的位置 `event.data.message.content[].text` 也是从 `gate.ts` 那 10 行里确认的。
 *
 * ## 为什么写成"解码器"而不是直接断言
 *
 * `ctx.on('session/event', ...)` 的回调参数在真实类型里是 `SessionEvent`，但事件总线上
 * 任何插件都能 `session.append(...)` 塞**自定义**事件类型。相邻代码（`gate.ts`）的教训是：
 * 它老老实实写了 `if (event?.type !== 'assistant/message') return` 与
 * `Array.isArray(message.content)`。这里保持同样的谨慎——**不信任 `unknown`**。
 *
 * 本文件是纯函数，没有 `Date.now()` / `Math.random()`，也就能被单测穷举。
 */
import type { BridgeReply, BridgeSessionEvent, BridgeTurnEnd } from './types.js'

/** 一个不带角色的解码结果。角色由 bridge 按 `sessionId` 反查后补上。 */
export type DecodedEvent =
  | { readonly kind: 'reply'; readonly reply: Omit<BridgeReply, 'characterId'> }
  | { readonly kind: 'turn-end'; readonly turnEnd: Omit<BridgeTurnEnd, 'characterId'> }

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function asNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

/**
 * 从 `assistant/message` 的 `data` 里取出回复文本。
 *
 * `assistant/message` 的 data 形状是
 * `{ turn, step, message: AssistantMessage, stream: AssistantStreamRecord[], usage?, interrupted? }`。
 *
 * **用 `message.content` 而不是 `stream`**：`stream` 是逐 token 记录（`text-chunks` /
 * `reasoning-chunks` / `tool-call-chunks` 混在一起），拼它要处理工具调用交错的边界，
 * 而 `message.content` 已经是模型这一段话的最终块。只有"打字机效果"才需要 `stream`。
 *
 * @returns 文本（多块用空行连接）、turn/step、是否被打断；`data` 形状不对时 `null`。
 */
export function extractAssistantReply(
  data: unknown,
): { readonly text: string; readonly turn: number; readonly step: number; readonly interrupted: boolean } | null {
  if (!isRecord(data)) return null

  const message = data.message
  if (!isRecord(message) || message.role !== 'assistant') return null

  const content = Array.isArray(message.content) ? message.content : []
  const texts: string[] = []
  for (const block of content) {
    if (!isRecord(block)) continue
    if (block.type !== 'text') continue
    if (typeof block.text !== 'string') continue
    texts.push(block.text)
  }

  // 一个 text 块都没有：说明这一段只有工具调用（"他去干活了，没跟你说话"）。
  // 这不是错误，是**正常情况**——交回 null 让上层决定，不要伪造一句空回复。
  if (texts.length === 0) return null

  return {
    text: texts.join('\n\n'),
    turn: asNumber(data.turn, 0),
    step: asNumber(data.step, 0),
    interrupted: data.interrupted === true,
  }
}

/**
 * 从 `turn/end` 的 `data` 里取出结束原因。
 *
 * `TurnEndReasonMap` 有 7 个 kind；`error` 分支带 `LlmFailure.message`，
 * 那正是红线第 6 条要求的"他说不出话"的可下手原因。
 */
export function extractTurnEnd(data: unknown): { readonly turn: number; readonly kind: string; readonly errorMessage: string | undefined } | null {
  if (!isRecord(data)) return null

  const reason = data.reason
  if (!isRecord(reason) || typeof reason.kind !== 'string') return null

  const error = reason.error
  const errorMessage =
    reason.kind === 'error' && isRecord(error) && typeof error.message === 'string' ? error.message : undefined

  return { turn: asNumber(data.turn, 0), kind: reason.kind, errorMessage }
}

/**
 * 把一条会话事件解码成 bridge 关心的两种东西之一；其余类型返回 `undefined`。
 *
 * @param sessionId - 事件属于哪个会话（用于反查角色）。
 * @param event - 事件总线上的原始事件。
 */
export function decodeBridgeEvent(sessionId: string, event: BridgeSessionEvent): DecodedEvent | undefined {
  if (event.type === 'assistant/message') {
    const extracted = extractAssistantReply(event.data)
    if (extracted === null) return undefined
    return {
      kind: 'reply',
      reply: {
        sessionId,
        text: extracted.text,
        turn: extracted.turn,
        step: extracted.step,
        interrupted: extracted.interrupted,
        // 单条事件看不到整轮做过什么；bridge 结算时会换成这一轮累积的动作列表。
        actions: [],
      },
    }
  }

  if (event.type === 'turn/end') {
    const extracted = extractTurnEnd(event.data)
    if (extracted === null) return undefined
    return {
      kind: 'turn-end',
      turnEnd: {
        sessionId,
        turn: extracted.turn,
        kind: extracted.kind,
        errorMessage: extracted.errorMessage,
      },
    }
  }

  return undefined
}


/**
 * 从 `assistant/message` 的 `data` 里取出**工具调用**（R35）。
 *
 * 真机形状（R34 从小蓝的会话日志里读出来的）：
 * `content: [{ type:'tool-call', id:'call_…', name:'agent_world_dispatch', arguments:'{"taskSet":"…"}' }]`
 * —— `arguments` 是 **JSON 字符串**，不是对象，所以解析要包 try。
 *
 * @returns 每个调用一项；没有调用时返回空数组（不是 null——"没调工具"是正常情况）。
 */
export function extractToolCalls(
  data: unknown,
): { readonly callId: string; readonly name: string; readonly detail: string | undefined }[] {
  if (!isRecord(data)) return []
  const message = data.message
  if (!isRecord(message)) return []
  const content = Array.isArray(message.content) ? message.content : []

  const out: { callId: string; name: string; detail: string | undefined }[] = []
  for (const block of content) {
    if (!isRecord(block)) continue
    if (block.type !== 'tool-call') continue
    if (typeof block.name !== 'string' || block.name === '') continue
    const callId = typeof block.id === 'string' ? block.id : ''
    out.push({ callId, name: block.name, detail: describeToolArgs(block.name, block.arguments) })
  }
  return out
}

/**
 * 从一次工具调用的参数里挑出**一个**能让人看懂这次调用在干什么的值。
 *
 * 为什么只挑一个、而且按工具名挑：面板上要的是"🔧 派单 task.quick-fix"这种一眼能读的行。
 * 把整个参数 JSON 摊上去会变成噪音，而且工具参数里可能有用户工作区的内容，
 * 推到 SSE 上就会扩散到每个打开的面板。
 *
 * **这里的映射是"哪些参数值得给人看"，不是 UI 文案**——显示成什么词由面板决定。
 * 未知工具一律不猜（返回 undefined），宁可只显示工具名。
 */
function describeToolArgs(name: string, rawArguments: unknown): string | undefined {
  if (typeof rawArguments !== 'string' || rawArguments.trim() === '') return undefined
  let parsed: unknown
  try {
    parsed = JSON.parse(rawArguments)
  } catch {
    return undefined
  }
  if (!isRecord(parsed)) return undefined
  const pick = (...keys: string[]): string | undefined => {
    for (const key of keys) {
      const value = parsed[key]
      if (typeof value === 'string' && value.trim() !== '') return value
    }
    return undefined
  }
  switch (name) {
    case 'agent_world_dispatch':
      return pick('taskSet')
    case 'agent_world_content':
      return pick('kind')
    default:
      return undefined
  }
}

/** 从 `tool/result` 的 `data` 里取出它回应的是哪次调用、成没成。 */
export function extractToolResult(data: unknown): { readonly callId: string; readonly ok: boolean } | null {
  if (!isRecord(data)) return null
  const message = data.message
  if (!isRecord(message)) return null
  const callId = typeof message.toolCallId === 'string' ? message.toolCallId : ''
  if (callId === '') return null
  return { callId, ok: message.isError !== true }
}


/**
 * 一条会话事件里的**动作**部分（R35）：工具调用，或工具结果。
 *
 * 为什么和 {@link decodeBridgeEvent} 分开：**同一条 `assistant/message` 可能既有文字又有工具调用**
 * （R34 真机：「我先复现一下」+ 两次调用在同一条里）。一个只返回一种结果的解码器必然丢掉其中一半，
 * 所以文字走 `decodeBridgeEvent`、动作走这里，订阅方两个都调。
 */
export type DecodedAction =
  | { readonly kind: 'call'; readonly callId: string; readonly name: string; readonly detail: string | undefined }
  | { readonly kind: 'result'; readonly callId: string; readonly ok: boolean }

export function decodeBridgeActions(event: BridgeSessionEvent): DecodedAction[] {
  if (event.type === 'assistant/message') {
    return extractToolCalls(event.data).map((c) => ({ kind: 'call' as const, ...c }))
  }
  if (event.type === 'tool/result') {
    const r = extractToolResult(event.data)
    return r === null ? [] : [{ kind: 'result', callId: r.callId, ok: r.ok }]
  }
  return []
}
