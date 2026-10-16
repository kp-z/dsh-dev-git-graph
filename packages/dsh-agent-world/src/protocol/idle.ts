/**
 * **待命行为的缝**（R68）。
 *
 * ## 为什么需要这个文件
 *
 * 行为目录是**内容**（红线 D37：表现是内容），它住在 `content/` 的 `actions` 库里。
 * 而**选行为的是模拟内核**（`sim/`），边界表规定 `sim/` **不许 import `content/`**
 *（那条规则是对的：模拟内核只认已经装配好的 `World`）。
 *
 * 所以需要一条缝：内容 → 一个**纯数据**形状 → 由 `runtime/`（它允许 import 两者）
 * 注入给 `step()`。这个文件就是那个形状。
 *
 * ## 为什么不挂在 `World` 上（像 `nav` 那样）
 *
 * `nav` 是几何、挂在世界上是对的。但**每新增一个 `World` 派生字段，就多一类
 * "只在 `createWorld` 里加了、忘了 `reconcileWorld`"的 bug**——R66 刚被这个咬过
 *（`{...world}` 的展开会**掩盖**漏掉的那一处，表现为"新开一局对、读旧档错"）。
 * 所以能不新增字段就不新增：这里用**可选第三参**注入，`World` 的形状不变，
 * 存档 schema 不变，现有调用点一行都不用改。
 *
 * ## 确定性（硬要求）
 *
 * 这个形状里**没有任何随机数**。选行为必须是 `(seed, agentId, tick)` 的纯函数，
 * 同一个 seed 必然长出同一段行为。`weight` 只是"相对可能性"，不是"随机"。
 */
/**
 * 待命行为的**种类**：做什么。
 *
 * 定义在协议层而不是内容层，因为**两边都要用它**：内容声明"这条行为是哪种"，
 * 而 `sim/` 要按种类决定怎么做（`look`=转方向、`pace`=走一小段、`rest`=坐下）。
 * 内容层可以 import 协议层（`content/kinds.ts` 已经在 import `protocol/library-kinds.js`），
 * 反过来不行——所以它只能住这里。
 */
export type IdleBehaviorKind = 'look' | 'pace' | 'rest'

/** 待命行为种类的全部取值（校验器与内容共用一份，避免两处各写一遍）。 */
export const IDLE_BEHAVIOR_KINDS: readonly IdleBehaviorKind[] = ['look', 'pace', 'rest']

/**
 * **sim 侧**的待命行为（`IdleBehaviorPlan`）。
 *
 * ⚠️ 与内容层的 `IdleBehaviorSpec`（`content/kinds.ts`）是**两个类型**，不是重复：
 * · `IdleBehaviorSpec` 是**内容作者写的东西**（关心"哪种行为、多久、走多远"）；
 * · `IdleBehaviorPlan` 是**模拟内核要吃的东西**（额外带上 `band` 与 `weight`，
 *   那是从同一条 `ActionEntry` 上取的——内容作者不必在 `idle` 块里重复写一遍）。
 *
 * 中间由 `content/port.ts` 的 `idleBehaviors()` 做一次映射。
 * 名字刻意不同：我第一版两边都叫 `IdleBehaviorSpec`，于是 `content/port.ts` 引了协议层的、
 * 而 `entry.data.idle` 是内容层的 → **属性对不上，10 条 TS 错**。**同名不同类型**比重复更坏。
 */
export interface IdleBehaviorPlan {
  /** 内容里的动作 id（如 `action.idle`）——诊断与测试要能指名道姓。 */
  readonly id: string
  /** 这条行为**做什么**。sim 按它决定动作（转方向 / 走一段 / 坐下）。 */
  readonly kind: IdleBehaviorKind
  /** 相对权重（越大越常被选中）。非正数视为不选。 */
  readonly weight: number
  /**
   * 一次行为至少/至多持续多少 tick。
   *
   * ⚠️ **与内容侧的 `IdleBehaviorSpec` 同名**（都是 `ticksMin`/`ticksMax`），这是刻意的：
   * 我一度让 sim 侧叫 `minTicks`/`maxTicks`，结果两侧各叫一个名字却被当成同一个类型，
   * 我和 bridge 在同一个契约上来回改了三次（TS 报错在两边跳）。**同名同义，别名不同义。**
   */
  readonly ticksMin: number
  readonly ticksMax: number
  /**
   * 这条行为里人会**走多远**（世界单位，0 = 原地不动）。
   *
   * 踱步类（`kind: 'pace'`）靠它；移动必须走 `findPath` + `world.nav`（R66 修好的绕障），
   * **不许直线插值**——那正是"穿墙"的成因。
   */
  readonly radius: number
}

/*
 * ⚠️ **这里刻意没有 `band`。**
 *
 * 我第一版给这个类型加了 `band`（`idle`/`walk`/`sit`），理由是"要跳过画不出来的动作"。
 * 那是错的：`band` 是**渲染**的事，模拟内核不该知道"图集里有没有那条带"——
 * 那正是边界规则要挡的泄漏。
 *
 * 正确的做法在映射那一侧：`content/port.ts` 的 `idleBehaviors()` **把 `band: null`
 * 的动作过滤掉**（图集里没有 → 2D 画不出来 → 不该被选为待命行为）。
 * 于是 sim 只看到"能演的"行为，而不必知道"为什么不能演"。
 */

/**
 * `step()` 的可选上下文。
 *
 * **可选**是刻意的：现有所有调用点（含 599 条测试）都只传两个参数，
 * 于是"没接内容"时 `step` 的行为与之前完全一致（待命的人不动）——
 * 这是回退路径，不是废弃路径。
 */
export interface StepContext {
  /** 待命行为目录。缺省 = 没有目录 = 待命时站着不动（R68 之前的行为）。 */
  readonly idleBehaviors?: readonly IdleBehaviorPlan[]
}
