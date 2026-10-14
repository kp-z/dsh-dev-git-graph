/**
 * 内容库的种类（契约层）。
 *
 * ## 为什么这个联合类型住在协议层，而不是内容层
 *
 * 因为它是**边界类型**：工具要按库名查诊断、线协议要告诉面板"有哪些库、各多少条目"、
 * 面板要按库分组显示。三方都要用它，而三方里只有内容层是"实现"。
 * 如果它住在 `content/kinds.ts`，那 `protocol/` 与 `web/` 就都得去 import 内容层——
 * 契约层 import 业务模块，缝就没了（这是我自己写这条规则后当场踩到的第一个坑）。
 *
 * 所以：**联合类型在协议层，库目录（标题、说明、id 前缀）在内容层**。
 * 前者是"有哪些"，后者是"怎么描述"，后者可以随文档改而不动契约。
 */

/** 全部库的种类。 */
export type LibraryKind =
  // 语义库
  | 'districts'
  | 'stations'
  | 'scenes'
  | 'rosters'
  | 'tasks'
  // 表现库
  | 'models'
  | 'actions'
  | 'skins'
  | 'sounds'
  | 'themes'

/** 库属于哪一层。 */
export type LibraryLayer = 'semantic' | 'presentation'

/** 全部库名（顺序稳定，用于遍历与展示）。 */
export const LIBRARY_KINDS: readonly LibraryKind[] = [
  'districts',
  'stations',
  'scenes',
  'rosters',
  'tasks',
  'models',
  'actions',
  'skins',
  'sounds',
  'themes',
] as const

/** 每个库属于哪一层。协议层与内容层的库目录必须一致——有一条测试钉住这件事。 */
export const LIBRARY_LAYERS: Readonly<Record<LibraryKind, LibraryLayer>> = {
  districts: 'semantic',
  stations: 'semantic',
  scenes: 'semantic',
  rosters: 'semantic',
  tasks: 'semantic',
  models: 'presentation',
  actions: 'presentation',
  skins: 'presentation',
  sounds: 'presentation',
  themes: 'presentation',
}

/** 一个库在诊断/面板里的描述。内容层负责填充它。 */
export interface LibraryDescriptor {
  kind: LibraryKind
  layer: LibraryLayer
  title: string
  /** 当前生效的条目数。 */
  count: number
}
