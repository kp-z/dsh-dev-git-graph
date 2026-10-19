/**
 * 人设 → system prompt（BACKLOG M6-2，决策 D37）。
 *
 * ## 这个文件为什么能留在代码里
 *
 * 红线第 2 条是"**人设是内容**"：代码里不许出现角色名、性格描述、台词。
 * 这里一个字都没有——它只是一个**通用脚手架**：
 * `persona`（这个人是谁）与 `speechStyle`（他怎么说话）**全部由调用方从内容库取**。
 * 所以"换一个花名册 = 换一套性格"成立，而且不需要改一行代码。
 *
 * ## 为什么是纯函数
 *
 * `(座位, 世界事实) → string`，没有 `Date.now()`、没有 `Math.random()`、不读全局。
 * 于是两件本来只能"声明"的事**可以被证明**：
 * 1. 内容里的文本确实进了 prompt（不是"函数被调用了"）；
 * 2. 换掉内容 → prompt 跟着变（它真的在读内容，而不是读了别的什么）。
 *
 * ## 一件踩过一次的坑（写在这里免得下次再踩）
 *
 * **绝不要按 `role` 去反查座位**：一个花名册里有**三个 `engineer`**，
 * 按 role 找会让这三个角色拿到**同一份人设**——症状是"这三个人说话一模一样"，
 * 而它**不会报错**。所以 {@link seatForAgent} 按**序号**（域自己的规则
 * `roster.seats[i] → agent-<i+1>`，见 `content/instantiate.ts`）或**名字**映射，
 * 并且名字有歧义时**宁可拒绝**，返回 `undefined` 让上层报出可下手的原因。
 */
import type { PersonaSeat, WorldContextFacts } from './types.js'

/** `AgentState` 的中文说法（**引擎级措辞**，不是角色台词）。 */
const STATE_LABEL: Readonly<Record<string, string>> = {
  idle: '闲着（在歇脚点待命）',
  walking: '正在小镇里走动',
  working: '在工作站上干活',
  talking: '正在跟人说话',
  blocked: '被卡住了，在等前置条件',
  celebrating: '刚干完一件事',
  sleeping: '在歇着（没有活干）',
}

/**
 * 从 `agent-<n>` 里取出**座位序号**（1 起）。
 *
 * 域自己的规则：`content/instantiate.ts` 里 `roster.seats.slice(0, maxAgents)` 之后
 * `id: \`agent-${i + 1}\``。所以 `agent-3` ↔ 花名册第 3 个座位。
 *
 * @returns 解析不出来时 `null`（这时走按名字回退，而不是猜）。
 */
export function ordinalFromAgentId(agentId: string): number | null {
  const match = /^agent-(\d+)$/.exec(agentId)
  const digits = match?.[1]
  if (digits === undefined) return null
  const ordinal = Number.parseInt(digits, 10)
  return Number.isInteger(ordinal) && ordinal >= 1 ? ordinal : null
}

/**
 * 找出这个世界角色对应花名册里的哪个座位。
 *
 * 两条路径，**都不看 `role`**：
 * 1. **序号**：`agent-<n>` → `seats[n-1]`；但要求名字对得上——
 *    对不上说明花名册在运行期变过（换包 / 热重载），那就别硬认，走第 2 条。
 * 2. **名字**：唯一匹配才算数。**有歧义时返回 `undefined` 而不是挑第一个**——
 *    挑错了的表现是"两个人共用一份人设"，那是最难查的一类 bug。
 *
 * @param seats - 花名册的座位表（内容）。
 * @param agent - 世界里的角色（只要 `id` 与 `name`）。
 * @returns 找不到或无法唯一确定时 `undefined`（由调用方报可下手的原因）。
 */
export function seatForAgent(
  seats: readonly PersonaSeat[],
  agent: { readonly id: string; readonly name: string; readonly role?: string },
): PersonaSeat | undefined {
  const ordinal = ordinalFromAgentId(agent.id)
  if (ordinal !== null) {
    const byOrdinal = seats[ordinal - 1]
    if (byOrdinal !== undefined && byOrdinal.name === agent.name) return byOrdinal
    // ⚠️ R164：**显示名是可以被改写的**，花名册里的名字不行。
    // 例：队长的显示名被固定成 `leader`（防分叉，用户要求），而花名册那位还叫「工头阿金」——
    // 只比名字就永远匹配不上，表现是"他说不出话：花名册里找不到对应的座位"。
    // 序号本身是权威的（`agent-N` ↔ 第 N 个座位，报错文案里也是这么写的）；
    // 这里再用**角色**做一道护栏，避免"世界里的顺序与花名册不一致"时悄悄配错人设
    // （配错的表现是两个人共用一份人设，那是最难查的一类）。
    if (byOrdinal !== undefined && agent.role !== undefined && byOrdinal.role === agent.role) return byOrdinal
  }

  const byName = seats.filter((seat) => seat.name === agent.name)
  return byName.length === 1 ? byName[0] : undefined
}

/** 把世界事实拼成一句"他现在在做什么"。措辞是引擎级的，**不含角色专属文字**。 */
function describeDoing(facts: WorldContextFacts): string {
  const walking = facts.walkingTo !== null ? `，正要前往「${facts.walkingTo}」` : ''
  const label = STATE_LABEL[facts.state] ?? `状态是 ${facts.state}`
  return `${label}${walking}`
}

/**
 * 拼出这个角色的 system prompt。
 *
 * @param seat - 花名册里的座位（**人设与说话方式来自内容**）。
 * @param facts - 此刻的世界事实（世界名 / 世界时钟 / 状态 / 所在站点 / 手上的工单）。
 * @throws `persona` 或 `speechStyle` 是空的时候 —— 内容校验（`checkProse`）本来就会拦，
 *   这里再拦一次是因为**一份空人设不会报错，只会让所有角色听起来像同一个人**：
 *   那种失败很难归因，宁可在建会话时直接给出原因。
 */
export function buildCharacterSystemPrompt(
  seat: PersonaSeat,
  facts: WorldContextFacts,
  rules: readonly string[] = [],
): string {
  const persona = seat.persona.trim()
  const speechStyle = seat.speechStyle.trim()

  if (persona === '') {
    throw new Error(
      `角色「${seat.name}」的人设是空的（花名册的 persona 字段）：生成不了说话方式，` +
        '一个没有人设的角色会跟别人听起来一模一样。请去内容库把这一条补上。',
    )
  }
  if (speechStyle === '') {
    throw new Error(
      `角色「${seat.name}」的说话方式是空的（花名册的 speechStyle 字段）：` +
        '人设写了他是什么人，但没写他怎么说话，prompt 会缺少最关键的那一半。请去内容库把这一条补上。',
    )
  }

  const task = facts.taskTitle === null ? '你手上没有工单' : `你手上的工单：${facts.taskTitle}`
  const where = facts.stationName === null ? '你现在不在任何站点上' : `你所在的站点：${facts.stationName}`

  return [
    `你是「${facts.worldName}」里的一个居民。下面是你是谁、你怎么说话，以及此刻的事实。`,
    '',
    '## 你是谁',
    persona,
    '',
    '## 你怎么说话',
    speechStyle,
    '',
    '## 此刻的事实',
    `- 你的名字：${seat.name}`,
    `- 你的岗位：${seat.role}`,
    `- 世界时钟：第 ${facts.tick} 个 tick`,
    `- ${where}`,
    `- 你现在：${describeDoing(facts)}`,
    `- ${task}`,
    // 规矩来自内容库（场景的 residentRules，R42）；没写就没有这一节。
    ...(rules.length === 0 ? [] : ['', '## 规矩', ...rules.map((rule) => `- ${rule}`)]),
  ].join('\n')
}
