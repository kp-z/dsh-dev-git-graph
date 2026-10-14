/**
 * 落盘层出口（BACKLOG M3-1）。
 *
 * 只做一件事：把世界**原子地**写进 `world.json`，把事件**追加**进 `events.jsonl`。
 * 不认识内容库，也不认识 three。
 */
export { buildEnvelope, loadWorldSync, parseEnvelope } from './worldStore.js'
export type { PackVersion } from '../protocol/index.js'
export type {
  LoadFailure,
  LoadedWorld,
  StoreInfo,
  WorldFileEnvelope,
  WorldStore,
} from './worldStore.js'
export {
  EVENTS_FILE,
  WORLD_FILE,
  WORLD_FILE_VERSION,
  createWorldStore,
  removeStore,
} from './worldStore.js'
