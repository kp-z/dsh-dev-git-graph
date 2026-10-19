/**
 * **不变量修复**：`in_progress` 的单必须真的有人在推进它（R151 / task-25）。
 *
 * ## 为什么要这个模块
 *
 * R150 健康检查抓到一次真死锁：4 张单恒 `in_progress`、进度 0%，owner 却全是 `state=idle`
 * 且 `carrying` 仍指向那张单。三个门互相扣死：
 *  1. `scheduler.ts` 的 `idleAgents()` 只收 `state==='idle' && carrying===null` ⇒ 这 4 人**永远不被派新活**；
 *  2. 进度只在 `interaction.ts` 里推进，而它要求 `state==='working'`；`idle.ts` 又把他们当空闲的人
 *     拉去歇脚点 ⇒ **永远回不到工位**；
 *  3. `interaction.ts` 的兜底只在 `status`/`owner` 不符时触发，而这 4 张恰好都对 ⇒ **兜底不触发**。
 * 结果：**没有任何一步会把它拉回正轨**，120+ tick 一动不动。
 *
 * ## 这个模块修的是"不变量"，不是那次事故
 *
 * 判据只有一条：**一张 `in_progress` 的单，必须有一个正在前往或已经在该单工位上的人来推进它。**
 * 不满足就是违例——不管它是怎么变成这样的。
 *
 * ## 为什么"退回 ready"而不是"重送工位"
 *
 * 二选一，选**退回 `ready` 并清 owner**：
 *  1. **不假装知道**：违例状态下世界记录的是"这个人空闲"。把他送回工位等于**断言一件我们没有的事实**
 *     （"他刚才确实在干活"）。退回 ready 只说我们确定的那件事：**这张单没人干了**。
 *  2. **不复制站位逻辑**：送人回工位要先挑站、抢槽位（`pickStation` + 槽位占用仲裁），
 *     那是 `scheduler.ts` 的职责。在恢复路径里再实现一遍 = "谁坐哪"有两个真相，这正是这份代码最怕的漂移。
 *  3. **走回主路径**：退回 ready 之后由调度器重新认领——它能顺手处理"原来那个人根本没这个能力"
 *     这类更深的原因（换个人干）。恢复路径因此**没有特殊分支要维护**。
 *  4. **不丢活**：`progress` 保留，下一个人从原进度继续。
 *
 * ## N 为什么是 20 tick
 *
 * 见 `STALL_MIN_TICKS` 的注释（那一处集中写清楚，免得这里和代码各说一套）。
 */
import type { Agent, Task, World } from '../domain/types.js'

/**
 * 违例持续多少 tick 才动手回收。
 *
 * 三方面的取数理由（不是拍脑袋）：
 *  1. **拍的是"一个 tick 里能合法经过几个阶段"**：`step()` 里依次是
 *     ingest → scheduler → movement → idle → interaction → comms → mailbox ≈ **6 个阶段**。
 *     N=20 是它的 3 倍多，所以**任何 tick 内的阶段顺序都不可能**造成假报。
 *  2. **拍的是"人看得见多久"**：世界 10 tick/秒，20 tick = **2 秒**。真机那次死锁实测冻了
 *     **117+ tick（≈12 秒）**，N=20 远小于它，所以用户不会盯着一个卡住的 0% 干等。
 *  3. **拍的是"违例本身没有合法来源"**：下面 `stalledTasksOf` 认的是**闭集**
 *     （`idle` / `sleeping` / 根本不拿着这张单）——没有任何生产者会在 tick 结束时留下这种状态。
 *     既然不会有"正常的一瞬间"，等待的意义只是躲开阶段噪声，2 秒足够。
 */
export const STALL_MIN_TICKS = 20

/** 一条违例：某张 `in_progress` 的单没有任何人正在推进它。 */
export interface StalledTask {
  readonly taskId: string
  readonly ownerId: string | null
  /** 为什么算违例（写给人看，能照做）。 */
  readonly reason: string
  /** 违例是从哪个 tick 开始被记下的（`null` = 本 tick 第一次发现）。 */
  readonly sinceTick: number | null
}

/**
 * 一张 `in_progress` 的单是否"有人正在推进"。
 *
 * **两种合法形态**（与 `scheduler.ts` 认领时写的状态严格对应）：
 *  - 去工位路上：`state === 'walking'` **且** `targetStation === task.station`；
 *  - 已在工位干：`state === 'working'` **且** `station === task.station`。
 *
 * 其余一律算"没人推进"。特别地：`state === 'idle'` **但 `carrying` 还指向这张单**就是 R150 那种死锁；
 * `carrying` 指向别处（甚至为 null）同样没人会推进它（`interaction.ts` 只看 `carrying`）。
 *
 * ⚠️ 这里**故意不看位置坐标**，只看状态与工位字段：坐标会被物理/玩家操作挪动，
 * 而"状态说他在去工位"才是调度器自己的承诺。
 */
export function isTaskBeingWorked(world: World, task: Task, agents: ReadonlyMap<string, Agent>): boolean {
  if (task.status !== 'in_progress') return true
  if (task.owner === null) return false
  const agent = agents.get(task.owner)
  if (agent === undefined) return false
  if (agent.carrying !== task.id) return false
  if (agent.state === 'working') return task.station === null || agent.station === task.station
  if (agent.state === 'walking') return task.station !== null && agent.targetStation === task.station
  return false
}

/** 违例说明：能让人看出"谁该干、他现在在干什么"。 */
function reasonOf(task: Task, agent: Agent | undefined): string {
  if (task.owner === null) return '这张单在进行中，但没有负责人'
  if (agent === undefined) return `负责人 ${task.owner} 不在这个世界里`
  if (agent.carrying !== task.id) {
    return `负责人 ${agent.id} 手上拿的是 ${agent.carrying ?? '（空）'}，不是这张单`
  }
  return `负责人 ${agent.id} 状态是 ${agent.state}（没有在去工位，也没有在工位干活）`
}

/**
 * 找出所有"在进行中却没人推进"的单。**纯函数**：不改状态、不看时钟。
 *
 * @param world - 世界（只读）
 * @returns 违例列表（按 `task.ordinal` 稳定排序，便于对比两次读数）
 */
export function stalledTasksOf(world: World): StalledTask[] {
  const agents = new Map(world.agents.map((a) => [a.id, a]))
  const out: StalledTask[] = []
  for (const task of world.tasks) {
    if (task.status !== 'in_progress') continue
    if (isTaskBeingWorked(world, task, agents)) continue
    out.push({
      taskId: task.id,
      ownerId: task.owner,
      reason: reasonOf(task, task.owner === null ? undefined : agents.get(task.owner)),
      sinceTick: task.stalledSinceTick ?? null,
    })
  }
  return out.sort((a, b) => {
    const ta = world.tasks.find((t) => t.id === a.taskId)
    const tb = world.tasks.find((t) => t.id === b.taskId)
    return (ta?.ordinal ?? 0) - (tb?.ordinal ?? 0)
  })
}

/** 回收结果：哪些单被退回 ready。 */
export interface StallRecoveryOutcome {
  /** 这一 tick 真的被回收的（taskId, 原 owner, 违例持续了多少 tick）。 */
  readonly recovered: { taskId: string; ownerId: string | null; stalledTicks: number }[]
}

/**
 * 回收"持续 N tick 没人推进"的单：**退回 `ready`、清 owner/station/attempt**，保留 `progress`。
 *
 * **会就地修改 `world.tasks`。**
 *
 * 为什么保留 `progress`：进度是"这张单已经被干到哪了"的事实，与"谁在干"无关；
 * 清零等于把别人干过的活扔掉（还会让面板上的进度条莫名回退）。
 *
 * @param world - 世界（就地修改任务）
 * @param minTicks - 违例持续多少 tick 才回收（默认 `STALL_MIN_TICKS`）
 */
export function recoverStalledTasks(world: World, minTicks = STALL_MIN_TICKS): StallRecoveryOutcome {
  const recovered: StallRecoveryOutcome['recovered'] = []
  const stalled = stalledTasksOf(world)
  const stalledIds = new Set(stalled.map((s) => s.taskId))

  // 先给"本 tick 仍在违例"的单打上起点；已经恢复的单把起点清掉（否则下次违例会带着旧起点立刻触发）。
  for (const task of world.tasks) {
    if (task.status !== 'in_progress') {
      if (task.stalledSinceTick !== undefined) task.stalledSinceTick = null
      continue
    }
    if (!stalledIds.has(task.id)) {
      if (task.stalledSinceTick !== undefined) task.stalledSinceTick = null
      continue
    }
    if (task.stalledSinceTick === undefined || task.stalledSinceTick === null) task.stalledSinceTick = world.tick
  }

  for (const item of stalled) {
    const task = world.tasks.find((t) => t.id === item.taskId)
    if (task === undefined) continue
    const since = task.stalledSinceTick ?? world.tick
    const stalledTicks = world.tick - since
    if (stalledTicks < minTicks) continue

    // 退回 ready：清掉"谁在干"的全部痕迹，保留"干到哪了"。
    task.status = 'ready'
    task.owner = null
    task.station = null
    task.attemptId = null
    task.stalledSinceTick = null
    recovered.push({ taskId: task.id, ownerId: item.ownerId, stalledTicks })
  }
  return { recovered }
}

/**
 * 把"手上还押着一张 `in_progress` 单"的人从待命流程里摘出去（R151 第 1 条）。
 *
 * 单独抽成纯函数是为了让 `idle.ts` 的入口只有一行调用，也方便单测把
 * "押着单的人算不算空闲"这件事钉住——它是这次死锁的**第一个门**。
 *
 * ⚠️ 判据只看 `carrying` 是否指向一张仍在进行中的单：单一旦完成/失败/被回收，
 * 这个人就**立刻**回到可待命状态，不会被永久排除在待命流程之外。
 */
export function holdsUnfinishedTask(agent: Agent, tasksById: ReadonlyMap<string, Task>): boolean {
  if (agent.carrying === null) return false
  const task = tasksById.get(agent.carrying)
  return task !== undefined && task.status === 'in_progress'
}
