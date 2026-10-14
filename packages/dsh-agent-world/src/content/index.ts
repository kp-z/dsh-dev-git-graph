/**
 * 内容库层出口（BACKLOG M1）。
 *
 * 对外只暴露四样东西：**类型**（写内容包要用）、**校验**（发现问题）、
 * **注册表**（装载与切换）、**内置包**（默认内容）。
 * 实例化函数（`instantiate.ts`）不在此导出——它是 `world/` 的内部工具，
 * 不是给外部用的 API。
 */
export type {
  ActionEntry,
  ContentPack,
  DistrictEntry,
  EntryOf,
  LibraryKind,
  LibraryLayer,
  LibrarySpec,
  ModelEntry,
  ModelSource,
  PackManifest,
  RosterEntry,
  RosterSeat,
  SceneEntry,
  SkinEntry,
  SoundEntry,
  StationEntry,
  TaskSetEntry,
  TaskTemplate,
  ThemeEntry,
} from './kinds.js'

export { CONTENT_SCHEMA_VERSION, LIBRARY_SPECS, librarySpec } from './kinds.js'

export type { Issue, IssueLevel } from './validate.js'
export { findDependencyCycle, validatePack } from './validate.js'

export type { LoadOptions, Provider, Resolved } from './registry.js'
export { ContentRegistry } from './registry.js'

export { builtinPacks, defaultPack } from './packs/default.js'
