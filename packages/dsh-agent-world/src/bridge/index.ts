/**
 * `bridge/` —— 角色 ↔ DSH Agent 会话的桥（BACKLOG M6-1）。
 *
 * ## 这一层是什么
 *
 * 世界上每个角色在 `sim/` 里只是 `{ id, position, ... }`；他的"脑子"在 DSH 里是一个
 * **独立的 Agent 会话**。本目录负责把两者安全地绑起来：
 *
 * ```
 *   面板 ──say()──▶ bridge ──prompt()──▶ sessionController ──▶ DSH Agent
 *                    ▲                                            │
 *                    └──── session/event（assistant/message）◀────┘
 * ```
 *
 * ## 三条不能破的规矩（都在 GOAL.md 第五节）
 *
 * 1. **AI 不改世界**：bridge 只把话递给 Agent，Agent 想干活必须调工具（D35）。
 * 2. **人设是内容**：本目录里没有任何角色名或台词；system prompt 由 `systemPromptFor`
 *    从内容库取（D37）。
 * 3. **成本可见可控**：懒创建 + 上限 + `liveCount()` 给面板显示（D36）。
 *
 * ## 生产 vs 测试
 *
 * | | 工厂 | 通道 |
 * |---|---|---|
 * | 生产 | `createAgentFactory(ctx)` | `createSessionTransport(ctx)` |
 * | 测试 | 计数器 + 假 handle | 假 transport（事件手动投递） |
 *
 * 两者都是**注入**的 —— 测试里一次模型调用都不会发生。
 *
 * 侦查证据（Inspect 原始输出 + DSH 实现片段）见 `docs/BRIDGE-RECON.md`。
 */
export { createCharacterBridge, DEFAULT_MAX_LIVE_SESSIONS, DEFAULT_REPLY_TIMEOUT_MS, isBadRequest } from './character-bridge.js'
export { buildPersonaSeed, buildSystemPromptSeed, SEED_SEQ, SEED_STEP, SEED_TURN } from './seed.js'
export { decodeBridgeEvent, extractAssistantReply, extractTurnEnd } from './decode.js'
export { toDialoguePort, toLazyDialoguePort } from './dialogue-port.js'
export type {
  DialogueAck,
  DialoguePortFace,
  DialogueReply,
  ToDialoguePortOptions,
} from './dialogue-port.js'
export type { BuildSystemSeedOptions } from './seed.js'
export { buildCharacterSystemPrompt, ordinalFromAgentId, seatForAgent } from './persona-prompt.js'
export type { DecodedEvent } from './decode.js'
export {
  checkModelReadiness,
  createAgentFactory,
  createDshCharacterBridge,
  readDefaultModelSelection,
  createSessionTransport,
  createSessionEventFeed,
  createTeamsCaptain,
  normalizeSessionEvent,
} from './dsh-adapter.js'
export type { DshBridgeOptions, DshBridgeResult } from './dsh-adapter.js'
export type {
  AgentFactory,
  BridgeAgent,
  BridgeAgentHandle,
  BridgeAgentOptions,
  BridgeCreateAgentOptions,
  BridgeFailureCode,
  BridgePromptPart,
  BridgePromptRequest,
  BridgeReadiness,
  BridgeReply,
  BridgeSeedEvent,
  BridgeSessionEvent,
  BridgeTurnEnd,
  CharacterBridge,
  CharacterBridgeOptions,
  DisposeAllResult,
  PersonaSeat,
  ReleaseResult,
  SayOptions,
  SayResult,
  SessionTransport,
  SystemMessageSeedEvent,
  WaitForReplyOptions,
  WaitReplyResult,
  WakeResult,
  WorldContextFacts,
} from './types.js'

export { createTeamsPort } from './teams.js'
export type { TeamsPort, TeamsPortOptions, TeamTaskRow } from './teams.js'
