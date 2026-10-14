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

  /** 内容层的只读端口。工具要用内容诊断时走它，而不是伸手进 `state.content`。 */
  content(): ContentPort

  /** 内容层的全部问题（工具里要给全量，不能只给日志里的前 5 条）。 */
  issues(): readonly ContentIssue[]
}
