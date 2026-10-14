/**
 * 线协议编解码（BACKLOG M1.6-4）。
 *
 * ## 这个文件就是"将来换 protobuf"的接缝
 *
 * 业务代码**从不直接碰 JSON**——它只调 `codec.encode/decode`，只认 `WireMessage`。
 * 所以有一天真要换成 protobuf（或 CBOR、或 MessagePack），改的是这个文件里
 * `jsonCodec` 的实现，以及它的 `.proto` 定义；**调用点一处不动**。
 *
 * ## 为什么现在不做 protobuf（决策 D17）
 *
 * 1. **进程内的模块之间不该序列化**。`domain`/`content`/`world`/`sim` 之间的调用是
 *    同进程函数调用，套一层 protobuf 只是白付编解码开销，还会**丢掉 tsc 的类型检查**
 *    ——那才是解耦真正依赖的东西。要"禁止耦合"，靠的是边界规则（`boundaries.ts` + 测试），
 *    不是序列化。
 * 2. **跨进程现在没有带宽压力**。10Hz tick、≤24 个角色，消息量在 JSON 下小到测不出来；
 *    而 JSON 能在浏览器 devtools 里直接看，开发期的收益远大于二进制省下的那点字节。
 * 3. **protobuf 的成本是真实的**：多一套 `.proto` + codegen 流水线 + 构建产物入库，
 *    而本仓库对"新增文件进 profile"这件事本来就有坑（见 `docs/DEVELOPMENT.md` §7）。
 *
 * **什么情况下该换**（判据，不是拍脑袋）：单条消息常态超过 ~64KB、事件频率超过 ~100Hz、
 * 或者出现**非 JS 的客户端**（那时 codegen 的收益就压过成本了）。在那之前，
 * 这个接缝保持"换起来是改一个文件"就够了。
 */
import { PROTOCOL_VERSION, checkCompatibility } from '../version.js'
import type { WireMessage, WireMessageType, WireErrorCode } from './messages.js'
import { WIRE_MESSAGE_TYPES } from './messages.js'

/** 解码失败。`code` 是稳定的错误码，`message` 给人看。 */
export class WireDecodeError extends Error {
  constructor(
    readonly code: WireErrorCode,
    message: string,
  ) {
    super(message)
    this.name = 'WireDecodeError'
  }
}

/** 编解码器接口。换 protobuf 就是换一个实现。 */
export interface WireCodec {
  /** HTTP 响应用的 Content-Type。 */
  readonly contentType: string
  encode(message: WireMessage): Uint8Array
  /**
   * 解码一条消息。
   *
   * @throws WireDecodeError 版本不匹配、JSON 坏、类型不认识、形状不对时。
   *   **不返回 null、不返回半成品**：宁可抛，也不要让调用点判空判到漏。
   */
  decode(raw: Uint8Array | string): WireMessage
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

/** 校验消息形状。只查"解出来能不能用"必须的那几项，不做完整 schema 校验。 */
function assertShape(message: Record<string, unknown>): void {
  const type = message.type as WireMessageType
  switch (type) {
    case 'hello':
      if (typeof message.tickMs !== 'number' || typeof message.server !== 'string') {
        throw new WireDecodeError('bad-shape', 'hello 消息缺少 server 或 tickMs。')
      }
      return
    case 'snapshot':
      if (typeof message.seq !== 'number' || !isObject(message.world)) {
        throw new WireDecodeError('bad-shape', 'snapshot 消息缺少 seq 或 world。')
      }
      return
    case 'events':
      if (typeof message.seq !== 'number' || !Array.isArray(message.events)) {
        throw new WireDecodeError('bad-shape', 'events 消息缺少 seq 或 events 数组。')
      }
      return
    case 'command':
      if (!isObject(message.command) || typeof message.command.kind !== 'string') {
        throw new WireDecodeError('bad-shape', 'command 消息缺少 command.kind。')
      }
      return
    case 'ack':
      if (typeof message.ok !== 'boolean' || typeof message.command !== 'string') {
        throw new WireDecodeError('bad-shape', 'ack 消息缺少 command 或 ok。')
      }
      return
    case 'error':
      if (typeof message.code !== 'string' || typeof message.message !== 'string') {
        throw new WireDecodeError('bad-shape', 'error 消息缺少 code 或 message。')
      }
      return
    default:
      throw new WireDecodeError(
        'unknown-type',
        `不认识的消息类型 ${JSON.stringify(message.type)}。已知类型：${WIRE_MESSAGE_TYPES.join(' / ')}。`,
      )
  }
}

/** JSON 编解码器（默认实现）。 */
export const jsonCodec: WireCodec = {
  contentType: 'application/json; charset=utf-8',

  encode(message: WireMessage): Uint8Array {
    return new TextEncoder().encode(JSON.stringify(message))
  },

  decode(raw: Uint8Array | string): WireMessage {
    const text = typeof raw === 'string' ? raw : new TextDecoder().decode(raw)

    let parsed: unknown
    try {
      parsed = JSON.parse(text) as unknown
    } catch (error) {
      throw new WireDecodeError('bad-json', `消息不是合法 JSON：${error instanceof Error ? error.message : String(error)}`)
    }

    if (!isObject(parsed)) {
      throw new WireDecodeError('bad-shape', '消息顶层必须是对象。')
    }

    // 版本先查：版本不对的话，后面按当前形状解析只会产生一堆误导性的报错。
    const compat = checkCompatibility(parsed.v, PROTOCOL_VERSION)
    if (!compat.ok) {
      throw new WireDecodeError('protocol-mismatch', compat.reason ?? '协议版本不匹配。')
    }

    assertShape(parsed)
    return parsed as unknown as WireMessage
  },
}
