/**
 * 世界服务端口（BACKLOG M1.6-3）。
 *
 * ## 它存在的直接理由
 *
 * 改这份文件之前，`src/tools/world.ts` 里写着 `import type { PluginState } from '../state.js'`。
 * 那就是耦合：工具知道了一个**具体实现类型**的存在，于是"换一套状态管理"要改工具，
 * "单测工具"要伪造整个 `PluginState`。
 *
 * 现在工具只认这个接口。谁会实现它？`state.ts`。工具不需要知道。
 */

import type { World } from '../../domain/types.js'
import type { ContentIssue, ContentPort } from './content.js'

/** 一个内容包的版本记录（协议层要跨进程带它，所以形状定在这里）。 */
export interface PackVersion {
  id: string
  version: string
}

/** 当前世界是从哪个存档接回来的。 */
export interface RestoredFrom {
  /** 存档落盘时世界推进到的 tick。 */
  savedAtTick: number
  /** 存档当时用的内容包版本。 */
  packVersions: readonly PackVersion[]
}


/** 一次派单的结果。 */
export interface DispatchOutcome {
  /** 派的是哪个任务集。 */
  taskSet: string
  /** 新追加进世界的工单 id。 */
  addedTaskIds: readonly string[]
  /** 该工单所属任务集里的步骤数（用于核对"这一套应该派进来几张"）。 */
  templateCount: number
  /** 派完后世界的工单总数。 */
  totalTasks: number
}

/** 世界服务：模型可见工具与世界交互的**唯一**通道。 */
export interface WorldServicePort {
  /** 逻辑 tick 间隔（ms）。渲染与诊断都要读它。 */
  readonly tickMs: number

  /** 当前世界；还没建就是 null。 */
  currentWorld(): World | null

  /**
   * 创建或重置世界。
   *
   * @param name - 世界名（也是 seed 来源）。不传用配置默认值。
   */
  open(name?: string): World

  /** 内容装载的一行摘要（诊断用）。 */
  describeContent(): string

  /**
   * 把一条工作流（任务库里的任务集）派进当前世界。
   *
   * **有副作用**：会往 `world.tasks` 追加实例化的工单。同一套任务集可以派多次
   * （做第二个功能），id 由实现保证不与既有工单冲突。
   *
   * @param taskSet - 任务集 id（`tasks` 库的条目 id）。
   * @throws 还没有世界、或任务集不存在时（报错要列出可用的任务集）。
   */
  dispatch(taskSet: string): DispatchOutcome

  /**
   * 这一局是不是从存档恢复的；新开的返回 null。
   *
   * **存在的理由是不让它变成静默行为**：从磁盘接回一个旧世界、而且那个世界是用
   * 另一批内容包版本装出来的——用户必须能看见这件事。不然症状是
   * "我明明重开了，怎么还是上次的样子"。
   */
  restoredFrom(): RestoredFrom | null

  /** 内容层的只读端口。工具要用内容诊断时走它，而不是伸手进 `state.content`。 */
  content(): ContentPort

  /** 内容层的全部问题（工具里要给全量，不能只给日志里的前 5 条）。 */
  issues(): readonly ContentIssue[]
}
