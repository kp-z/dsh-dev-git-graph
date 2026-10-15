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
 *
 * 注意 `thinking` 帧的 `text` **不是空的**——它是提问者的原话（见 `DialogueEvent.text`）。
 * 不变量：**`thinking` 帧必须能自证"在回答谁说的什么"**，否则第二个面板无法拼出完整对话。
 *
 * `acting`（R35）是"他在干活"：模型调工具时推一帧，`actions` 是到目前为止的累积列表。
 * 它和 `thinking` 一样带着提问者原话——**理由相同**：任何一帧单独拿出来都要能自证上下文。
 * 一次搭话可能推多帧 `acting`（R34 真机是 3 次工具调用），面板按 `turnId` 累到同一条记录上。
 */
export type DialoguePhase = 'thinking' | 'acting' | 'replied' | 'failed'

/** 经 SSE 推给面板的一条对话事件。 */
export interface DialogueEvent {
  /** 同一次"搭话"的 id：面板拿它把 `thinking` 与后续的 `replied` 归到一起。 */
  readonly turnId: string
  /** 世界 tick（**对话也是世界里发生的事**，决策 D38）。 */
  readonly tick: number
  readonly phase: DialoguePhase
  readonly from: DialogueSpeaker
  readonly to: DialogueSpeaker
  /**
   * `replied` 时是**回复正文**；`thinking` 时是**提问者原话**；`failed` 时为空串。
   *
   * ## R24 修正（原设计是错的）
   *
   * 我最初把 `thinking` 定成"text 为空串"。写 M6-3 时发现这与 **D38** 冲突：
   * 对话既然是**世界里的事件**，那"玩家说了什么"就必须能被**第二个面板**看到。
   * 空串会让第二个面板只看到一句没有前文的回复。
   *
   * 所以改成：`thinking` 带着提问者的原话。
   * **一个诚实的边界**：在 `thinking` 帧之后才打开的面板仍然看不到那句话
   * ——SSE 是增量的，而快照里没有对话。那要 **M6-6（对话落库与回放）** 才能真正解决。
   */
  readonly text: string
  /**
   * `failed` 时的原因，**要能让人直接下手**（沿用内容校验那条规矩）：
   * 例如"模型没有配置""会话创建失败：<原因>""超时（30s）"。
   * 只写"失败"两个字的报错帮不了任何人。
   */
  readonly reason?: string
  /**
   * 角色在这一轮里**做过的事**（R35，M6-13）。
   *
   * `acting` 帧：到目前为止的**累积**列表（不是增量）——晚到的面板只看最新一帧也拼得出全貌。
   * `replied` 帧：这一轮的完整列表，渲染在回复正文下面。
   *
   * 为什么要有它：R34 真机上小蓝被要求"修登录 bug"，走了四步、调了 3 次工具，
   * 最后发了一整块工单板，而用户在面板上**只看得到第一句**"我先复现一下"。
   * 世界确实变了（多了 3 张工单），但看起来像是角色只说了句话。**看不见的干活等于没干。**
   */
  readonly actions?: readonly DialogueAction[]
}

/**
 * 角色调用过的一个工具（R35）。
 *
 * **只带够面板说清"他干了什么"的东西**，不带完整参数与返回值：
 * 那些在会话日志里都有，推到 SSE 上既占带宽、又可能把用户工作区的内容扩散到每个打开的面板。
 */
export interface DialogueAction {
  /** 工具名原样（如 `agent_world_dispatch`）。中文标签是面板的事（UI 文案）。 */
  readonly name: string
  /** 与本次调用最相关的**一个**参数（如任务集 id `task.quick-fix`）；没有就省略。 */
  readonly detail?: string
  /** 工具是否执行成功。失败的调用也要显示——"他试过但没成"本身就是信息。 */
  readonly ok: boolean
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
