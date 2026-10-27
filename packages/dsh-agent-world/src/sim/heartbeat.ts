/**
 * R315：agent heartbeat。
 *
 * 不是“消息一到就自动回复”。每个 agent 按固定心跳（HEARTBEAT_TICKS）醒一次，
 * 读当时的世界，产出两类东西：
 *  - `needs`：外部事实要求它做的事（未回的消息、可领的任务、被占用的工位）；
 *  - `wants`：它自己此刻想做的事（回复、工作、休息、开会）。
 * 只有两者都指向 reply 时才发一条 answer；其余情况只发 intent 事件，交给上层/UI 决策。
 *
 * 相位由 (seed, agent.id) 定，和 tick 无关，所以同一 seed 回放一致。
 */
import { seedFromString, createRng } from '../domain/rng.js'
import type { Agent, Message, Task, World } from '../domain/types.js'
import type { DeliverOutcome, SendOutcome } from './mailbox.js'
import { sendMessages } from './mailbox.js'
import { findPath } from './pathfind.js'
import { occupancyOf } from './scheduler.js'
import { stationSlot } from '../domain/geometry.js'

export const HEARTBEAT_TICKS = 20

export interface AgentIntent {
  agentId: string
  tick: number
  needs: string[]
  wants: string[]
  decision: 'reply' | 'work' | 'rest' | 'meet' | 'idle'
  replyTo: string | null
  taskId: string | null
}

export interface HeartbeatOutcome {
  intents: AgentIntent[]
  sent: SendOutcome['sent']
}

const REPLY_KINDS: ReadonlySet<Message['kind']> = new Set(['question', 'handoff'])

function phaseOf(seed: number, agentId: string): number {
  return createRng((seed ^ seedFromString(`heartbeat:${agentId}`)) >>> 0).int(HEARTBEAT_TICKS)
}

export function heartbeatDue(world: World, agent: Agent): boolean {
  return (world.tick + phaseOf(world.seed, agent.id)) % HEARTBEAT_TICKS === 0
}

function currentMessage(world: World, agentId: string, delivered: DeliverOutcome['delivered']): Message | null {
  const byId = new Map(world.messages.map((message) => [message.id, message]))
  for (const receipt of delivered) {
    if (receipt.to !== agentId) continue
    const message = byId.get(receipt.messageId)
    if (message !== undefined && REPLY_KINDS.has(message.kind)) return message
  }
  return null
}

function readyTaskFor(world: World, agent: Agent): Task | null {
  const candidates = world.tasks
    .filter((task) => task.status === 'ready')
    .filter((task) => task.suggestedRole === null || task.suggestedRole === agent.role)
  return candidates.sort((a, b) => a.createdAtTick - b.createdAtTick || a.ordinal - b.ordinal)[0] ?? null
}

/** 该 agent 这次心跳在想什么。纯函数，便于测试/回放。 */
export function heartbeatFor(world: World, agent: Agent, delivered: DeliverOutcome['delivered'] = []): AgentIntent {
  const needs: string[] = []
  const wants: string[] = []
  const message = currentMessage(world, agent.id, delivered)
  if (message !== null) {
    needs.push(`reply:${message.id}`)
    wants.push('reply')
  }
  const task = message === null && agent.state === 'idle' && agent.carrying === null ? readyTaskFor(world, agent) : null
  if (task !== null) {
    needs.push(`work:${task.id}`)
    wants.push('work')
  }
  // 没有外部需要时，心跳给一个“想做的事”，由渲染层表达，不直接改状态。
  if (needs.length === 0 && agent.state === 'idle') {
    wants.push(world.tick % (HEARTBEAT_TICKS * 3) === 0 ? 'meet' : 'rest')
  }
  if (needs.length === 0 && agent.state === 'working') wants.push('work')
  const decision: AgentIntent['decision'] = message !== null ? 'reply' : task !== null ? 'work' : wants.includes('meet') ? 'meet' : wants.includes('rest') ? 'rest' : 'idle'
  return {
    agentId: agent.id,
    tick: world.tick,
    needs,
    wants: [...new Set(wants)],
    decision,
    replyTo: message?.id ?? null,
    taskId: task?.id ?? null,
  }
}

function assignActivity(world: World, agent: Agent, kind: 'meet' | 'rest'): boolean {
  if (agent.state !== 'idle' || agent.carrying !== null) return false
  const capability = kind === 'rest' ? 'rest' : 'converse'
  const station = world.stations.find((candidate) => candidate.capabilities.includes(capability) && occupancyOf(world, candidate.id) < candidate.capacity)
  if (station === undefined) return false
  const path = findPath(world.nav, agent.position, stationSlot(station, occupancyOf(world, station.id)))
  if (path.length === 0) return false
  agent.state = 'walking'
  agent.targetStation = station.id
  agent.station = null
  agent.path = path
  agent.activityKind = kind
  agent.activityUntil = world.tick + 60
  return true
}

export function runHeartbeats(world: World, delivered: DeliverOutcome['delivered'] = []): HeartbeatOutcome {
  const intents: AgentIntent[] = []
  const drafts = []
  for (const agent of world.agents) {
    if (!heartbeatDue(world, agent)) continue
    const intent = heartbeatFor(world, agent, delivered)
    intents.push(intent)
    if (world.gameMode === true && (intent.decision === 'meet' || intent.decision === 'rest')) assignActivity(world, agent, intent.decision)
    if (intent.decision !== 'reply' || intent.replyTo === null) continue
    const message = world.messages.find((candidate) => candidate.id === intent.replyTo)
    if (message === undefined || message.from === message.to) continue
    drafts.push({ from: message.to, to: message.from, kind: 'answer' as const, body: `收到：${message.body}` })
  }
  const sent = drafts.length === 0 ? [] : sendMessages(world, drafts).sent
  return { intents, sent }
}
