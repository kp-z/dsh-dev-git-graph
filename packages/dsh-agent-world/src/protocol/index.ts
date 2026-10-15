/**
 * 契约层出口（BACKLOG M1.6）。
 *
 * ## 这个目录是整个工程的"缝"
 *
 * 模块之间**只通过这里**通信。三条最关键的禁令（完整规则见 `boundaries.ts`，
 * 由 `test/boundaries.test.js` 强制）：
 *
 * 1. `sim/` 不许 import `content/` —— 模拟内核只认装配好的 `World`。
 * 2. `tools/` 只许 import `protocol/` —— 工具通过 port 拿东西，不认具体实现。
 * 3. `web/` 只许 import `protocol/` —— 浏览器侧不许伸手进宿主内部。
 *
 * ## 为什么这里转出 domain 的类型
 *
 * 渲染层需要 `AgentState` / `Station` 这些形状。如果让它直接 import `domain/`，
 * 宿主与浏览器之间就有了第二条缝；多一条缝就多一处会漂移的地方。
 * 类型是编译期的东西，转出它**不会**让 web 在运行时依赖 domain 的代码。
 */
export type { LibraryDescriptor, LibraryKind, LibraryLayer } from './library-kinds.js'
export { LIBRARY_KINDS, LIBRARY_LAYERS } from './library-kinds.js'

export type { Compatibility } from './version.js'
export { PROTOCOL_VERSION, checkCompatibility } from './version.js'

export type {
  BoundaryExemption,
  BoundaryRule,
  ModuleName,
} from './boundaries.js'
export {
  BOUNDARY_EXEMPTIONS,
  BOUNDARY_RULES,
  moduleOfPath,
  resolveImportTarget,
  ruleOf,
} from './boundaries.js'

export type {
  ContentIssue,
  ContentPort,
  ContentView,
  IssueLevel,
  PackDescriptor,
  ProviderChain,
} from './ports/content.js'
export type { EventSinkPort, EventSourcePort } from './ports/events.js'
export type { RuntimeDiagnostics, RuntimePort } from './ports/runtime.js'
export type { ThemeCamera, ThemeFog, ThemeLighting, ThemePlan, ThemePost } from './theme.js'
export type { SceneActor, SceneGround, ScenePlan, SceneProp } from './scene.js'
export { resolveColor } from './scene.js'
export { nullEventSink } from './ports/events.js'
export type { DispatchOutcome, PackVersion, RestoredFrom, WorldServicePort } from './ports/world-service.js'

export type { WorldCommand, WorldCommandKind } from './wire/commands.js'
export { WORLD_COMMAND_KINDS, describeCommand, isWorldCommand } from './wire/commands.js'

export type {
  AckMessage,
  CommandMessage,
  ErrorMessage,
  EventsMessage,
  HelloMessage,
  SnapshotMessage,
  WireErrorCode,
  SnapshotPayload,
  WireMessage,
  WireMessageType,
  WorldSnapshot,
} from './wire/messages.js'
export { WIRE_MESSAGE_TYPES, hasSeqGap, hello, wireError } from './wire/messages.js'

export { AGENT_STATE_LABELS, TASK_STATUS_LABELS, roleLabel, stateLabel, taskLabel } from './format.js'
export {
  formatIssues,
  formatRoster,
  formatSummary,
  formatTaskBoard,
  summarizeForDisplay,
} from './format-text.js'

export type { WireCodec } from './wire/codec.js'
export { WireDecodeError, jsonCodec } from './wire/codec.js'

// ── 转出的 domain 形状（给 web 与诊断用，见文件头说明）──────────────────────
export type {
  Agent,
  AgentRole,
  AgentState,
  District,
  Message,
  Station,
  Task,
  TaskStatus,
  Vec2,
  World,
  WorldEvent,
  WorldEventType,
  WorldMode,
  WorldSummary,
} from '../domain/types.js'

export * from './dialogue.js'