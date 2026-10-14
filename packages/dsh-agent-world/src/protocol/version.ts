/**
 * 协议版本（BACKLOG M1.6-1）。
 *
 * ## 规则：只许加可选字段
 *
 * - **允许**：新增可选字段、新增消息类型、新增枚举取值（消费方必须对未知取值有默认行为）。
 * - **必须 bump 版本**：删除字段、改字段语义、改必填性、收窄枚举取值集合。
 *
 * 版本是**单个整数**，不做「同 major 就兼容」。理由：这个协议的消费方只有我们自己两端，
 * 宽松匹配带来的兼容层成本远大于它的收益；严格相等能保证"不匹配"在**连接建立时**就暴露，
 * 而不是等到某个字段读出 undefined 才在画面上表现成怪现象。
 */

/** 当前协议版本。任何一次破坏性改动都要 +1，并在 docs/PROTOCOL.md 的变更记录里写一行。 */
export const PROTOCOL_VERSION = 1

/** 兼容性判定结果。 */
export interface Compatibility {
  ok: boolean
  /** 不兼容时的可读原因；兼容时为 null。 */
  reason: string | null
}

/**
 * 判定对端版本能否与本地通信。
 *
 * @param remote - 对端声明的版本。
 * @param local - 本地版本，默认当前。
 */
export function checkCompatibility(remote: unknown, local: number = PROTOCOL_VERSION): Compatibility {
  if (typeof remote !== 'number' || !Number.isInteger(remote)) {
    return { ok: false, reason: `对端没有声明有效的协议版本（收到 ${JSON.stringify(remote)}）。` }
  }
  if (remote !== local) {
    return {
      ok: false,
      reason:
        `协议版本不匹配：对端 v${remote}，本地 v${local}。` +
        '请升级插件到同一版本——两边版本不同还继续通信，只会把错误推迟成更难查的症状。',
    }
  }
  return { ok: true, reason: null }
}
