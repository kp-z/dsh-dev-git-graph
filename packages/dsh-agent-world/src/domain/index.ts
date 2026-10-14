/**
 * 领域层出口（BACKLOG M1-1）。
 *
 * **这一层只是一套类型与纯函数，不认识"内容"，也不认识"内容包"。**
 * 分层（决策 D10）：
 *
 *   domain/   世界模型：类型、数值调参、几何、摘要、随机源   ← 你在这里
 *   content/  内容库：类型、校验、注册表、内置包、实例化
 *   world/    装配：createWorld / （后续的 sim）
 *   web/      渲染：直接 import domain 拿类型，不复制
 *
 * 依赖**单向向上**。`domain` 不许 import `content` 或 `world`——一旦反过来，
 * 就再也没法单独测"世界模型"这一层了。
 */
export type {
  Agent,
  AgentLlmRoute,
  AgentRole,
  AgentState,
  Bounds,
  Capability,
  District,
  DistrictKind,
  Message,
  Station,
  StationKind,
  Task,
  TaskStatus,
  Vec2,
  World,
  WorldEvent,
  WorldEventType,
  WorldMode,
  WorldOrigin,
  WorldSummary,
} from './types.js'
export { MESSAGE_KINDS } from './types.js'

export type { Rng } from './rng.js'

export {
  DEFAULT_TICK_MS,
  EVENT_RING_SIZE,
  MAX_AGENTS,
  WALK_SPEED,
  WORK_SPEED,
  slotsFor,
} from './constants.js'

export { createRng, seedFromString } from './rng.js'
export { angleTo, boundsCenter, distance, latticeIn, normalizeAngle, stationSlot, stepToward, withinBounds } from './geometry.js'
export { summarize } from './summary.js'
