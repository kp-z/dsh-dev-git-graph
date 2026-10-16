/**
 * 待命行为的调度（R68）。
 *
 * ## 它修的是什么
 *
 * `advanceIdle` 会让待命的人**走到歇脚点**，然后就没有下文了——8 个人到了点就彻底静止，
 * 看起来像 8 个摆件。用户要的是游戏，所以下一步是"没人派活的时候，他们在忙自己的事"。
 *
 * ## 为什么**不存**"我现在在干嘛"
 *
 * 直觉做法是给每个角色存一个"当前行为 + 干到第几 tick"。但那要动 `Agent`
 *（`src/domain/` 的类型），存档 schema 跟着变，而"待命的人在干嘛"这件事**不值得进存档**——
 * 它没有任何玩法含义，重开一局就该重来。
 *
 * 所以这里把"此刻在做什么"写成 **`(seed, agent.id, tick)` 的纯函数**：
 * 每个角色有一个由 id 派生的固定相位（错开槽位边界，避免 8 个人同一 tick 一起换动作，
 * 那看起来像集体抽搐），每个槽的内容由 `hash(seed, id, 槽号)` 定。
 *
 * 三个直接好处：
 *  1. **同一 seed 必然长出同一段行为**（可单测，见 `test/idle-behavior.test.js`）；
 *  2. 读档/回放后行为一致——它只依赖世界自己的 `seed` 与 `tick`，不依赖挂钟；
 *  3. **零新增状态**，`Agent` 与存档格式一个字段都不用加。
 *
 * ## 输入形状来自协议层
 *
 * 目录的类型是 `protocol/idle.ts` 的 `IdleBehaviorPlan`（不是这里另起一个）。
 * 内容层的 `ActionEntry.idle`（`IdleBehaviorSpec`）由 `content/port.ts` 的
 * `idleBehaviors()` 映射成它，`runtime/` 再注入给 `step()`——`sim/` 全程不认识内容库。
 *
 * ⚠️ 这个形状里**没有 `band`**，也不该有：`band: null`（图集里没有那条带）由
 * `port.ts` **在投影时就滤掉**了。为什么不在 sim 里判断——"他为啥画不出来"是渲染的事，
 * 泄漏进模拟内核就等于让 sim 认识图集。所以这里只当"目录里每一条都是可画的"。
 *
 * ## 不用 Math.random / Date.now
 *
 * 随机源是 `domain/rng.ts` 的 mulberry32，**每个 (角色, 槽) 现场建一个**并立即用完——
 * 既确定，也不会在两次调用之间留下会漂移的状态。
 */
import { createRng, seedFromString } from '../domain/rng.js'
import type { IdleBehaviorKind, IdleBehaviorPlan } from '../protocol/idle.js'

/** 一个槽位有多长（tick）：取目录里最长的 `ticksMax`，下限 1。 */
export function slotTicks(behaviors: readonly IdleBehaviorPlan[]): number {
  let max = 1
  for (const behavior of behaviors) {
    if (Number.isFinite(behavior.ticksMax) && behavior.ticksMax > max) max = behavior.ticksMax
  }
  return max
}

/** 某个角色在某个槽位里做的事。 */
export interface IdleSlot {
  /** 槽位序号（同一角色随时间递增）。固定相位保证它不会与别人同步跳变。 */
  readonly index: number
  /** 本槽选中的行为。 */
  readonly behavior: IdleBehaviorPlan
  /** 他**正在做**这件事；`false` = 本槽已做完，此刻在发呆。 */
  readonly active: boolean
}

/** 按权重挑一条；权重全为 0（或非法）时退回第一条——只保证不崩，内容错由校验器挡。 */
function pickWeighted(
  behaviors: readonly IdleBehaviorPlan[],
  rng: ReturnType<typeof createRng>,
): IdleBehaviorPlan | null {
  if (behaviors.length === 0) return null
  const weights = behaviors.map((behavior) =>
    Number.isFinite(behavior.weight) && behavior.weight > 0 ? behavior.weight : 0,
  )
  let total = 0
  for (const weight of weights) total += weight
  if (total <= 0) return behaviors[0] ?? null
  const index = rng.weighted(weights)
  return behaviors[index >= 0 && index < behaviors.length ? index : 0] ?? null
}

/**
 * 算某角色此刻的槽位。
 *
 * @param behaviors - 待命行为目录（协议层形状，由 runtime 注入；空目录 = 这个功能没配）。
 * @param seed - 世界种子（`World.seed`）。
 * @param agentId - 角色 id（相位的来源）。
 * @param tick - 世界 tick（**不是**挂钟时间）。
 * @returns 槽位；目录为空时返回 null。
 */
export function idleSlotAt(
  behaviors: readonly IdleBehaviorPlan[],
  seed: number,
  agentId: string,
  tick: number,
): IdleSlot | null {
  if (behaviors.length === 0) return null
  const slot = slotTicks(behaviors)

  // 相位：由 (seed, id) 定，与 tick 无关 → 同一个人的槽位边界永远落在同一批 tick 上，
  // 但每个人都不一样。⚠️ **不要**用角色在数组里的下标：加一个角色就会让所有人的相位
  // 一起平移，"同一 seed 同一段行为"这条就不成立了。
  const phase = createRng((seed ^ seedFromString(agentId)) >>> 0).int(slot)
  const shifted = tick + phase
  const index = Math.floor(shifted / slot)
  const offset = shifted - index * slot

  // 槽内容：只由 (seed, id, 槽号) 定，与 tick 也无关 → 一个槽里做什么是稳定的，
  // 不会每 tick 重挑（那会变成"原地抽搐"）。
  const rng = createRng((seed ^ seedFromString(`${agentId}#${index}`)) >>> 0)
  const behavior = pickWeighted(behaviors, rng)
  if (behavior === null) return null
  const span = Math.max(1, Math.round(rng.range(behavior.ticksMin, behavior.ticksMax)))
  return { index, behavior, active: offset < span }
}

/**
 * 本槽的踱步目标点。
 *
 * 距歇脚点 `0.5·radius .. radius`（用 `sqrt` 是为了让点落在**圆面**上而不是全挤在边上），
 * 方向由槽 hash 定——同一槽里反复调用得到同一个点，所以"他朝那儿走"是稳定的。
 *
 * @param navWalkable - 可选的可行性判定；返回 false 就换一个方向再试。
 *   为什么要它：踱步点若落进墙里，`findPath` 会给一条"尽量靠近"的路，人就会贴着墙磨——
 *   那正是 R66 刚修好的绕障最容易被弄坏的方式。
 */
export function paceGoal(
  seed: number,
  agentId: string,
  slotIndex: number,
  home: { readonly x: number; readonly z: number },
  radius: number,
  navWalkable?: (point: { readonly x: number; readonly z: number }) => boolean,
): { x: number; z: number } {
  const rng = createRng((seed ^ seedFromString(`${agentId}#${slotIndex}@goal`)) >>> 0)
  // 从随机方向开始，最多试 6 个方向；都不行就**待在原地**（返回歇脚点），而不是硬走。
  const start = rng.int(6)
  for (let attempt = 0; attempt < 6; attempt += 1) {
    const angle = ((start + attempt) / 6) * Math.PI * 2
    const distance = radius * (0.5 + 0.5 * Math.sqrt(rng.next()))
    const point = { x: home.x + Math.cos(angle) * distance, z: home.z + Math.sin(angle) * distance }
    if (navWalkable === undefined || navWalkable(point)) return point
  }
  return { x: home.x, z: home.z }
}

/** 四个方向对应的朝向角（下标与 `quarterOf` 一致）。 */
const QUARTER_FACINGS: readonly number[] = [0, Math.PI / 2, Math.PI, -Math.PI / 2]

/**
 * 朝向 → 四方向下标。
 *
 * 这是 `web/core/scene-layout.js` 的 `directionOf` 的**同一套判定**（含那个 `1e-9` 偏置，
 * 否则正好压在 45° 上时两边会给出不同答案）。`sim` 不许 import `web/`，所以只能各写一份——
 * `test/idle-behavior.test.js` 拿 `directionOf` 在整圈角度上逐点比对，把两份钉在一起。
 *
 * 为什么待命行为要认识"方向"：图集只有**四向**。随机取一个绝对角度有四分之一的概率
 * 落在**同一个方向**上——那在屏幕上就等于什么都没发生，而"待命的人在动"正是本轮要解决的。
 */
export function quarterOf(facing: number): number {
  const value = Number.isFinite(facing) ? facing : 0
  const dz = Math.sin(value)
  const dx = Math.cos(value)
  if (Math.abs(dz) + 1e-9 >= Math.abs(dx)) return dz >= 0 ? 1 : 3
  return dx >= 0 ? 0 : 2
}

/** 四方向下标 → 朝向角。 */
export function quarterFacing(index: number): number {
  return QUARTER_FACINGS[((index % 4) + 4) % 4] ?? 0
}

/**
 * 本槽张望到哪个方向（`kind: 'look'` 用）。
 *
 * **绝对角度，不是"相对当前转一下"**：相对写法在槽内会被每 tick 调用一次，
 * 于是每次再加 90°，人就在原地转圈。绝对写法的同一槽反复调用得到同一个值，
 * 所以 `idle.ts` 里"不一样才写"的判据自然变成"一槽只写一次"。
 *
 * ## 为什么是"每槽固定转 90°"这种闭式写法
 *
 * 第一版想让"本槽与上一槽不同"，于是拿上一槽的**原始**抽签值去比——那是错的：
 * 上一槽自己也可能被"撞了就挪一格"改过，所以比的对象并不是它**最终**的方向。
 * 真要比较就得递归回溯到第 0 槽，而长跑之后那个深度会爆栈。
 *
 * 改成闭式：**每个角色有自己固定的转向步长（±90°）**，方向 = `基点 + 槽号 × 步长`。
 * 于是相邻两槽**必然**差 90°（步长 1 或 3，模 4 都不是 0），而且
 *  · 基点每人不同 → 8 个人不会整齐划一地转；
 *  · 步长每人不同 → 有人习惯往左转、有人往右转（像个性格，不是随机的）；
 *  · O(1)、幂等、只依赖 `(seed, id, 槽号)`。
 *
 * 代价说清楚：他每轮"张望"都朝同一个旋向转，看久了能看出规律。
 * 要更自然得靠更多美术/更多带，而不是在这里加随机——那会把确定性弄坏。
 */
export function lookFacing(seed: number, agentId: string, slotIndex: number): number {
  // 基点与步长只按 (seed, id) 抽一次：它们是"这个人的习惯"，不该每槽变。
  const own = createRng((seed ^ seedFromString(`${agentId}@look`)) >>> 0)
  const base = own.int(4)
  const stride = own.int(2) === 0 ? 1 : 3 // +90°，或 3 == -1 (mod 4) 即 -90°
  return quarterFacing(base + slotIndex * stride)
}

/** 行为种类 → 人话（诊断与测试要能看懂"他刚才在干嘛"）。 */
export function describeKind(kind: IdleBehaviorKind): string {
  if (kind === 'look') return '张望'
  if (kind === 'pace') return '踱步'
  return '歇会儿'
}
