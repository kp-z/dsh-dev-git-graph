/**
 * 线协议消息（BACKLOG M1.6-4）。
 *
 * 这是 host 与浏览器之间的**唯一**通信形状。两边都不许自己造一个"差不多的"结构。
 *
 * ## 版本策略
 *
 * 每条消息都带 `v`。对端 `v` 与本地不等时，**在连接建立阶段就拒绝**（`protocol-mismatch`），
 * 而不是硬着头皮解析——版本不同还继续通信，只会把错误推迟成更难查的症状。
 * 演进规则见 `version.ts`：只许加可选字段。
 *
 * ## `seq` 是 gap 自愈的依据
 *
 * `snapshot` 与 `events` 都带单调 `seq`。客户端发现 `seq` 不连续（丢包、断线重连）
 * 就必须**丢掉本地状态重新拉快照**，而不是继续增量应用——后者会造成静默的状态漂移。
 */
import type { World, WorldEvent } from '../../domain/types.js'
import type { LibraryDescriptor } from '../library-kinds.js'
import type { ScenePlan } from '../scene.js'
import type { RuntimeDiagnostics } from '../ports/runtime.js'
import type { WorldCommand } from './commands.js'

/**
 * 快照里的世界：**去掉事件环形缓冲**。
 *
 * 理由很实际：面板要轮询它。带上最近 500 条事件，一个快照能到几百 KB，
 * 而面板根本不需要历史——历史由 `events` 增量推。
 */
export type WorldSnapshot = Omit<World, 'events'>

/** 快照载荷。面板靠它一个人就能把画面对起来。 */
export interface SnapshotPayload {
  world: WorldSnapshot
  /**
   * 表现层 token 解析表（来自 `skins` 库，已在服务端合并成扁平表）。
   *
   * **面板不许自己去读内容库**（它只许 import 协议层），所以颜色必须随快照一起发。
   * 值形如 `{ 'ground.engineering': '#6F7D5A', 'role.lead': '#F0B429' }`。
   */
  palette: Record<string, string>
  /**
   * 渲染就绪的场景描述（地块/站点/角色/主题，颜色都已解析）。
   *
   * 这是"要摆什么"，与渲染器无关：2D canvas 画它，将来 three.js 也画它，
   * 换成现成的 three.js 场景同样消费它——**模拟层与内容库一行不用改**。
   */
  scene: ScenePlan
  /** 运行时的诊断计数——这是回答"它到底在跑吗"的唯一出口。 */
  runtime: {
    running: boolean
    pending: number
    tickMs: number
    /**
     * 一条消息从发出到送达要多少 tick。
     *
     * 渲染层靠它算"纸条飞到哪了"。不发给它的话，渲染层就得自己去抄一遍
     * `MESSAGE_DELIVERY_TICKS`——两处真相，改一处就会让纸条的落点
     * 与"已送达"对不上（纸条到了人还没到，或者反过来）。
     */
    messageDeliveryTicks: number
    diagnostics: RuntimeDiagnostics
  }
  /** 内容概况（装了哪些包、各库多少条）。面板的状态条用它。 */
  content: {
    packs: { id: string; name: string; version: string }[]
    libraries: LibraryDescriptor[]
  }
  /**
   * 任务集（流水线）目录：id → 中文名。
   *
   * 看板要按流水线分组，而 `world.tasks[].set` 只是 id（`task.quick-fix`）。
   * 中文名是内容，前端读不到内容库，所以在这里下发——与 `palette` 同一条缝（D22）。
   */
  taskSets: { id: string; name: string | null }[]
}

/** 消息类型。 */
export type WireMessageType = 'hello' | 'snapshot' | 'events' | 'command' | 'ack' | 'error'

/** 线协议错误码。码是稳定的，文案可以改。 */
export type WireErrorCode =
  | 'protocol-mismatch'
  | 'bad-json'
  | 'unknown-type'
  | 'bad-shape'
  | 'internal'

/** 服务端握手：告诉客户端"我是谁、什么版本、心跳多快"。 */
export interface HelloMessage {
  v: number
  type: 'hello'
  /** 服务端标识（世界 id 或插件版本），诊断用。 */
  server: string
  /** 逻辑 tick 间隔，客户端据此算插值窗口。 */
  tickMs: number
}

/** 全量快照。客户端建立连接、或发现 seq 断裂时拉它。 */
export interface SnapshotMessage extends SnapshotPayload {
  v: number
  type: 'snapshot'
  /** 这个快照对应的世界 seq。之后的 events 必须从它往后连续。 */
  seq: number
}

/** 增量事件批。 */
export interface EventsMessage {
  v: number
  type: 'events'
  /** 本批最后一条事件的 seq。 */
  seq: number
  events: readonly WorldEvent[]
}

/** 客户端发来的命令。 */
export interface CommandMessage {
  v: number
  type: 'command'
  command: WorldCommand
}

/** 命令受理结果。`detail` 在失败时说明原因。 */
export interface AckMessage {
  v: number
  type: 'ack'
  command: string
  ok: boolean
  detail: string | null
}

/** 错误。 */
export interface ErrorMessage {
  v: number
  type: 'error'
  code: WireErrorCode
  message: string
}

/** 一条线协议消息。 */
export type WireMessage =
  | HelloMessage
  | SnapshotMessage
  | EventsMessage
  | CommandMessage
  | AckMessage
  | ErrorMessage

/** 全部消息类型（校验用）。 */
export const WIRE_MESSAGE_TYPES: readonly WireMessageType[] = [
  'hello',
  'snapshot',
  'events',
  'command',
  'ack',
  'error',
] as const

/** 造一条握手消息。 */
export function hello(server: string, tickMs: number, v: number): HelloMessage {
  return { v, type: 'hello', server, tickMs }
}

/** 造一条错误消息。 */
export function wireError(code: WireErrorCode, message: string, v: number): ErrorMessage {
  return { v, type: 'error', code, message }
}

/**
 * 判断两段事件之间是否丢了东西。
 *
 * @param previousSeq - 已经收到的最后一条 seq。
 * @param nextSeq - 新到的一批的 seq。
 * @returns true 表示有断裂，客户端应当**重新拉快照**而不是继续增量应用。
 */
export function hasSeqGap(previousSeq: number, nextSeq: number): boolean {
  // 事件是成批的：`nextSeq` 是批内最后一条，所以只要 next > previous 就不算断裂，
  // 真正的断裂是 next <= previous（乱序/重放）或跨度过大（丢批）。
  // 这里只判"倒退"与"完全相同的重放"——前者一定是错，后者是幂等的重复投递。
  return nextSeq <= previousSeq
}
