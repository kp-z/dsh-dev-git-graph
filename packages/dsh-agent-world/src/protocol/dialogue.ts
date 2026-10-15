/**
 * 对话的**传输契约**（M6 系列共用，R22 冻结）。
 *
 * ## 为什么单独一份、并且先冻结
 *
 * M6 会同时动两处：宿主侧的 `bridge/`（角色 ↔ DSH Agent）与面板侧的对话 UI。
 * 两边分头写的时候，**唯一会互相打断的就是契约**——所以先把这一层定下来，
 * 剩下的各自实现，接口不匹配会在 `tsc` 阶段就报出来。
 *
 * ## 范围：只冻结"线上过什么"
 *
 * 这里**只有传输形状**（HTTP 请求/响应 + SSE 事件载荷）。
 * **世界里怎么存这段对话，故意没冻结**——那是 M6-3 的设计题，
 * 但它必须满足决策 D38：**对话是世界里的事件**（进事件流、可被多个面板同时看到、可回放），
 * 而不是面板与模型之间的私有旁路。
 *
 * ## 一条时序约定（很重要）
 *
 * `POST /api/say` **只表示"话收到了"**，不表示"回复来了"。
 * 模型可能要几秒——HTTP 请求里等它会把面板与宿主一起拖住（R21 的教训：
 * 前端卡顿常常来自"在错误的层等了不该等的东西"）。
 *
 * 所以流程是：
 *
 *     面板 ──POST /api/say──▶ 宿主：登记一次对话，返回 { accepted: true, turnId }
 *     宿主 ──SSE dialogue──▶ 所有面板：phase='thinking' → 若干 'replied' / 'failed'
 *
 * 也就是说：**发送是同步的，回复是事件驱动的**。面板不轮询、不等待。
 */

/**
 * 一次对话里"谁在说"。
 *
 * `god` 是玩家/操作者（面板背后的人）；`agent` 是世界里的小人物；
 * `system` 留给"世界本身"发的话（例如"任务已派给你"这类由规则产生、但出现在对话里的行）。
 */
export type DialogueSpeaker = { kind: 'god' } | { kind: 'agent'; id: string } | { kind: 'system' }

/**
 * 一次发言所处阶段。
 *
 * `thinking` 是**刻意的**：模型几秒才回，面板必须能显示"他在想"
 * （否则用户会以为卡住了，再点一次，于是同一句话发两遍）。
 */
export type DialoguePhase = 'thinking' | 'replied' | 'failed'

/** 经 SSE 推给面板的一条对话事件。 */
export interface DialogueEvent {
  /** 同一次"搭话"的 id：面板拿它把 `thinking` 与后续的 `replied` 归到一起。 */
  readonly turnId: string
  /** 世界 tick（**对话也是世界里发生的事**，决策 D38）。 */
  readonly tick: number
  readonly phase: DialoguePhase
  readonly from: DialogueSpeaker
  readonly to: DialogueSpeaker
  /** `replied` 时是回复正文；`thinking` 时为空串。 */
  readonly text: string
  /**
   * `failed` 时的原因，**要能让人直接下手**（沿用内容校验那条规矩）：
   * 例如"模型没有配置""会话创建失败：<原因>""超时（30s）"。
   * 只写"失败"两个字的报错帮不了任何人。
   */
  readonly reason?: string
}

/** `POST /api/say` 的请求体。 */
export interface SayRequest {
  /** 跟哪个角色说话（世界里的 `Agent.id`，形如 `agent-3`）。 */
  readonly agentId: string
  /** 说的话。空串或全空白会被拒。 */
  readonly text: string
}

/** `POST /api/say` 的响应体。 */
export interface SayResponse {
  /** 话收到了没有。**不代表回复**——回复走 SSE 的 `DialogueEvent`。 */
  readonly accepted: boolean
  /** 接收了才有：这次搭话的 id，与 `DialogueEvent.turnId` 一致。 */
  readonly turnId?: string
  /** 没接收时给原因（角色不存在 / 文本为空 / 该角色的会话数已达上限…）。 */
  readonly reason?: string
}
