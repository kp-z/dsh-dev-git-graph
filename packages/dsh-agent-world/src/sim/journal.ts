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
