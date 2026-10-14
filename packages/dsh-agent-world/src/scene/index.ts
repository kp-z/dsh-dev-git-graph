/**
 * 场景描述层出口（BACKLOG M4-0）。
 *
 * 形状（`ScenePlan` 等）在 `protocol/scene.ts`——它是快照的一部分，要跨进程。
 * 这里只有派生逻辑：把世界 + 调色板 + 主题算成"要摆什么"。
 */
export { buildScenePlan } from './plan.js'
export type { SceneActor, SceneGround, ScenePlan, SceneProp } from '../protocol/scene.js'
export { resolveColor } from '../protocol/scene.js'
