/**
 * 领域层出口（BACKLOG M1-1）。
 *
 * 只导出**稳定契约**：类型、常量、纯函数。内部实现文件（`create.ts` 的私有辅助等）
 * 不在此暴露，避免以后重构时被外部误以为是公共 API。
 *
 * `web/` 的 3D 面板直接 import 这个入口来拿类型与常量——不复制一份。
 * 这是刻意的：同一份世界契约复制成两份，就是接线漂移的开始。
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
  WorldSummary,
} from './types.js'

export type { StationTemplate } from './constants.js'
export type { CreateWorldOptions, TaskSeed } from './create.js'
export type { Rng } from './rng.js'

export {
  AGENT_PALETTE,
  DEFAULT_DISTRICTS,
  DEFAULT_STATIONS,
  DEFAULT_TICK_MS,
  DISTRICT_GROUND,
  EVENT_RING_SIZE,
  MAX_AGENTS,
  ROLE_COLOR,
  STATION_KIND_COLOR,
  TOWN_HALF,
  WALK_SPEED,
  WORK_SPEED,
  districtCenter,
  instantiateStation,
  slotsFor,
} from './constants.js'

export { createWorld, makeTask } from './create.js'
export { createRng, seedFromString } from './rng.js'
export { angleTo, distance, normalizeAngle, stationSlot, stepToward, withinBounds } from './geometry.js'
export { formatRoster, formatSummary, formatTaskBoard, roleLabel, stateLabel, summarize, taskLabel } from './summary.js'
