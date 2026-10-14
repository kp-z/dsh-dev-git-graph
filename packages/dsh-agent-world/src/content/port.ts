/**
 * 内容端口实现（BACKLOG M1.6-3）。
 *
 * 内容层对外**只暴露这个**：工具、路由、面板都通过 `ContentPort` 读内容，
 * 而不是 import `ContentRegistry` 这个具体类。
 *
 * 这样做的收益不是抽象的："换一套内容装载方式"（比如将来支持从 npm 装内容包、
 * 或从远端拉）只需要换掉这个文件的实现，工具与面板一行不动。
 */
import { LIBRARY_SPECS } from './kinds.js'
import type { ContentRegistry } from './registry.js'
import type { ContentIssue, ContentPort, ContentView, PackDescriptor } from '../protocol/ports/content.js'
import type { LibraryDescriptor } from '../protocol/library-kinds.js'

/**
 * 把注册表与装载期问题包成一个只读端口。
 *
 * @param registry - 已装载的注册表。
 * @param issues - 装载期问题（内置 + 外部）。
 * @param externalRoot - 实际读取的外部内容目录；没配就是 null。
 */
export function contentPortOf(
  registry: ContentRegistry,
  issues: readonly ContentIssue[],
  externalRoot: string | null,
): ContentPort {
  const view = (): ContentView => {
    const packs: PackDescriptor[] = registry.packs.map((m) => ({
      id: m.id,
      name: m.name,
      version: m.version,
      schemaVersion: m.schemaVersion,
      requires: [...m.requires],
      provides: [...m.provides],
      overrides: [...m.overrides],
    }))

    // 条目数为 0 的库也列出来：`provides` 里声明了却空着，本身就是要看的信息。
    const libraries: LibraryDescriptor[] = LIBRARY_SPECS.map((spec) => ({
      kind: spec.kind,
      layer: spec.layer,
      title: spec.title,
      count: registry.size(spec.kind),
    }))

    return { packs, libraries, issues: [...issues], externalRoot }
  }

  return {
    view,
    providersOf: (kind, id) => registry.providersOf(kind, id),
  }
}
