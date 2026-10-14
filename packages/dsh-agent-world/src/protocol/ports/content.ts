/**
 * 内容诊断的契约（BACKLOG M1.6-3）。
 *
 * 工具与面板通过它看内容层，而**不是**去 import `content/index.js`。
 * 好处不是"多一层好看"，而是：内容层换实现（比如将来支持从 npm 装内容包）时，
 * 消费方一行不用改。
 */
import type { LibraryDescriptor, LibraryKind } from '../library-kinds.js'
import type { ThemePlan } from '../theme.js'

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
  /**
   * 合并后的调色板：token → 色值。
   *
   * 面板要按地块/职业上色，而它只许 import 协议层、读不到内容库，
   * 所以调色板必须由服务端算好随快照发出去（见 `SnapshotPayload.palette`）。
   *
   * 合并规则：按注册表里的提供方链顺序叠加，**后面的覆盖前面的**——
   * 于是"换一套皮肤包"就是加一个包，不用改任何代码。
   */
  colors(): Readonly<Record<string, string>>
  /**
   * 取某个场景用到的主题，映射成**渲染就绪**的 `ThemePlan`（色值已解析）。
   *
   * 由内容层做这件事，因为只有它知道主题条目的原始形状。
   * 场景不存在、场景没指定主题、或指定了不存在的主题时返回 null——
   * 渲染器应当退回一组内置缺省，而不是黑屏。
   */
  themeFor(sceneId: string): ThemePlan | null
}
