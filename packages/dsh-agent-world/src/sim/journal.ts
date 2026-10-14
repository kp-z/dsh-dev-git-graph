/**
 * 事件日志（BACKLOG M2-7）。
 *
 * **只有本模块能改 `world.seq` 与 `world.events`。** 事件序号是客户端 gap 自愈的依据
 * （见 `docs/PROTOCOL.md` §4.3），如果多处各自造序号，序号会重复或跳号，
 * 而症状是"面板偶尔重拉一次快照"——没人会去查。
 *
 * 环形缓冲：`world.events` 只留最近 `EVENT_RING_SIZE` 条。世界的历史靠落盘
 * （M3-1 的 events.jsonl）保留，内存里只留够 HUD 回看的一段。
 */
import { taskPatch } from './patches.js'
import { EVENT_RING_SIZE } from '../domain/constants.js'
import type { World, WorldEvent, WorldEventType } from '../domain/types.js'

/**
 * 记一条事件：取当前 `world.seq` 当序号、自增、写进环形缓冲。
 *
 * @param world - 世界（就地修改 `seq` 与 `events`）。
 * @param type - 事件类型。
 * @param payload - 载荷（必须 JSON 可序列化，它会经线协议发给面板）。
 * @returns 刚记下的事件。
 */
export function emitEvent(
  world: World,
  type: WorldEventType,
  payload: Record<string, unknown>,
): WorldEvent {
  const event: WorldEvent = { seq: world.seq, tick: world.tick, type, payload }
  world.seq += 1
  world.events.push(event)

  const excess = world.events.length - EVENT_RING_SIZE
  if (excess > 0) world.events.splice(0, excess)

  return event
}

/**
 * 记一笔**命令驱动的变更**（不是 tick 驱动的事件）。
 *
 * ## 为什么这条路径必须存在
 *
 * `agent_world_dispatch` 是**在 tick 之外**往世界里加工单的。如果它不进日志，
 * 只收增量的客户端（SSE 的面板）**永远看不到新工单**——而工具调用者自己看得到
 * （他拿的是同步返回值）。这种"我这里有、你那里没有"的分叉极难查。
 *
 * ## 与 emit.ts 的分工
 *
 * tick 驱动的事件（移动、进度、到站）只从 `emit.ts` 出，那条铁律不变。
 * 这里管的是**另一种东西**：外部命令引起的、不发生在任何一步里的变更。
 * 两者共用同一个 `seq` 与同一个环形缓冲——因为对客户端而言它们都是"世界变了"。
 *
 * @param world - 世界（就地修改）。
 * @param taskIds - 新增的工单 id。
 */
export function noteTasksAdded(world: World, taskIds: readonly string[]): WorldEvent[] {
  return taskIds.map((id) =>
    emitEvent(world, 'task.changed', { id, ...taskPatch(world, id), reason: 'dispatched' }),
  )
}
