/**
 * 内容诊断的契约（BACKLOG M1.6-3）。
 *
 * 工具与面板通过它看内容层，而**不是**去 import `content/index.js`。
 * 好处不是"多一层好看"，而是：内容层换实现（比如将来支持从 npm 装内容包）时，
 * 消费方一行不用改。
 */
import type { LibraryDescriptor, LibraryKind } from '../library-kinds.js'

/** 校验级别。 */
export type IssueLevel = 'error' | 'warning'

/**
 * 一条内容问题。
 *
 * 形状与 `content/validate.ts` 的 `Issue` **完全一致**（那边现在直接 import 这个类型），
 * 所以不存在"两份定义漂移"的风险——这正是把它上提到契约层的意义。
 */
export interface ContentIssue {
  level: IssueLevel
  /** 出问题的内容包 id；与具体包无关时为 null。 */
  pack: string | null
  /** 位置，形如 `my-town/stations.json: stations[0].kind` 或 `sim/step.ts`。 */
  where: string
  message: string
}

/** 一个已装载的内容包的对外视图。 */
export interface PackDescriptor {
  id: string
  name: string
  version: string
  schemaVersion: number
  requires: readonly string[]
  provides: readonly LibraryKind[]
  overrides: readonly string[]
}

/** 某个 id 的提供方链——排查"为什么我的覆盖没生效"的入口。 */
export interface ProviderChain {
  kind: LibraryKind
  id: string
  /** 当前生效的包 id。 */
  active: string
  /** 完整链（含未生效的回退项），从生效到回退。 */
  chain: readonly string[]
}

/** 内容层的只读视图。 */
export interface ContentView {
  packs: readonly PackDescriptor[]
  libraries: readonly LibraryDescriptor[]
  issues: readonly ContentIssue[]
  /** 实际读取的外部内容目录；没配就是 null。 */
  externalRoot: string | null
}

/** 内容端口。**这是模块之间唯一的通信方式。** */
export interface ContentPort {
  /** 取只读视图。 */
  view(): ContentView
  /** 查某个 id 的提供方链。 */
  providersOf(kind: LibraryKind, id: string): readonly string[]
  /**
   * 列某个库当前生效的全部条目 id（已排序）。
   *
   * 存在的理由很具体：派单时用户给了一个不存在的任务集 id，
   * 报错必须**列出可用的任务集**——"没有这个 id"帮不了任何人。
   */
  entryIds(kind: LibraryKind): readonly string[]
}
