/**
 * 世界工具集（BACKLOG M0-2 / M1-5 / M1.6-5）。
 *
 * 设计原则沿用本仓库的约定（见 packages/dsh-daily/src/tools.ts 的注释）：
 * 1. **每个工具都说明副作用**——模型才知道什么时候敢调。
 * 2. **只读与写分开**——`agent_world_status` / `agent_world_content` 只读；
 *    `agent_world_open` 会替换当前世界，必须写明。
 * 3. 输出是真给人/给模型读的中文文本，不吐枚举名。
 *
 * ## 它为什么只 import `protocol/`
 *
 * 参数类型是 `WorldServicePort` —— 一个**接口**，不是具体实现。这不是洁癖：
 * 之前它写着 `import type { PluginState } from '../state.js'`，于是"给工具写单测"
 * 要伪造整个插件状态，"换状态管理方式"要改工具。现在塞一个假端口就能测，
 * 而 `test/boundaries.test.js` 会替我们守住这条。
 *
 * 排版（`formatSummary` / `formatRoster` / `formatTaskBoard`）也来自 `protocol/`，
 * 不在这里自己实现一份——HUD 用的是同一套，两份必然跑偏。
 */
import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { ContentView, LibraryKind, WorldServicePort } from '../protocol/index.js'
import { LIBRARY_KINDS, formatRoster, formatSummary, formatTaskBoard } from '../protocol/index.js'

/**
 * 把工具参数里的库名收窄成 `LibraryKind`。
 *
 * 用户/模型可能传一个不存在的库名，这时要给**可用取值**而不是让它一路传到
 * `providersOf` 里变成 undefined 行为。
 */
function asLibraryKind(kind: string): LibraryKind {
  if ((LIBRARY_KINDS as readonly string[]).includes(kind)) return kind as LibraryKind
  throw new Error(`没有名为 "${kind}" 的库。可用库名：${LIBRARY_KINDS.join(' / ')}`)
}

/** 注册全部 `agent_world_*` 工具。 */
export function registerWorldTools(ctx: Context, world: WorldServicePort): void {
  ctx.tools.register(
    defineTool({
      name: 'agent_world_status',
      description:
        '查看当前 Agent World 的状态（只读，不写盘、不联网）。返回世界摘要、角色花名册（谁在哪、在干什么、手头拿着哪张工单）与工单板。' +
        '用户问「现在谁在干什么 / agent 世界怎么样了 / 谁卡住了」时用它，不要凭空描述。' +
        '如果返回「世界尚未创建」，说明还没调过 agent_world_open。',
      parameters: {},
      output: {
        schema: { type: 'string' },
        render: (_args, value) => [{ type: 'text', text: value }],
      },
      async execute() {
        const current = world.currentWorld()
        if (!current) {
          return `世界尚未创建。调用 agent_world_open 建一个。${contentErrorTail(world)}`
        }
        return [
          formatSummary(current),
          '',
          `内容来源：${world.describeContent()}`,
          `场景：${current.origin.scene}｜内容包：${current.origin.packs.join('、') || '（无）'}`,
          '',
          '花名册：',
          formatRoster(current),
          '',
          '工单板：',
          formatTaskBoard(current),
        ].join('\n')
      },
    }),
  )

  ctx.tools.register(
    defineTool({
      name: 'agent_world_open',
      description:
        '创建或重置 Agent World（**有副作用：会丢弃当前世界并重建**，世界目前只存在内存里）。' +
        '返回新世界的摘要与花名册。' +
        '用户说「开始 / 建一个 agent 世界 / 重开一局」时用它。' +
        '只想看状态就别调它，用 agent_world_status。',
      parameters: {
        name: { type: 'string', description: '世界名，也是随机种子的来源（同名同场景 → 同一座小镇）。留空用配置里的默认名。' },
      },
      output: {
        schema: { type: 'string' },
        render: (_args, value) => [{ type: 'text', text: value }],
      },
      async execute(args) {
        if (args.name !== undefined && args.name.trim() === '') {
          throw new Error('世界名不能是空字符串（那会让 seed 来源变得不确定）。留空请直接不传这个参数。')
        }
        const created = world.open(args.name)
        return [
          `已创建世界「${created.name}」，seed=${created.seed}。`,
          `场景：${created.origin.scene}｜花名册角色 ${created.agents.length} 人｜工单 ${created.tasks.length} 张（等 lead 派单）`,
          '',
          '当前只有世界模型与内容库，模拟循环（tick）与 3D 面板尚未接入——见 docs/BACKLOG.md 的 M2 与 M4。',
          '',
          formatSummary(created),
          '',
          '花名册：',
          formatRoster(created),
        ].join('\n')
      },
    }),
  )

  ctx.tools.register(
    defineTool({
      name: 'agent_world_content',
      description:
        '查看 Agent World 的**内容层**（只读，不写盘、不联网）：装了什么内容包、每个库有多少条目、' +
        '某个条目由哪个包提供、以及全部内容问题。' +
        '用户问「装了哪些内容包 / 为什么我的覆盖没生效 / 为什么这座小镇长这样」时用它。' +
        '可选 `kind` + `id` 查某个条目的提供方链——这是排查"覆盖没生效"最直接的入口。',
      parameters: {
        kind: { type: 'string', description: '要查的库名，例如 stations / actions / rosters。留空则只列概览。' },
        id: { type: 'string', description: '要看提供方链的条目 id，例如 station.desk-a。需要同时给 kind。' },
      },
      output: {
        schema: { type: 'string' },
        render: (_args, value) => [{ type: 'text', text: value }],
      },
      async execute(args) {
        const port = world.content()
        const view = port.view()

        if (args.kind !== undefined && args.id !== undefined) {
          const kind = asLibraryKind(args.kind)
          return describeProviderChain(view, port.providersOf(kind, args.id), kind, args.id)
        }
        if (args.id !== undefined) {
          throw new Error('查提供方链需要同时给 kind 与 id（只说 id 没法知道去哪张表里找）。')
        }
        return formatContentView(view, args.kind)
      },
    }),
  )
}

/** 内容有 error 时，在"世界尚未创建"后面附上前几条，省得再去调一个工具。 */
function contentErrorTail(world: WorldServicePort): string {
  const errors = world.issues().filter((i) => i.level === 'error')
  if (errors.length === 0) return ''
  const head = errors
    .slice(0, 3)
    .map((e) => `· [${e.where}] ${e.message}`)
    .join('\n')
  return `\n内容层有 ${errors.length} 个错误，先修它们：\n${head}`
}

/** 渲染提供方链。 */
function describeProviderChain(
  view: ContentView,
  chain: readonly string[],
  kind: string,
  id: string,
): string {
  if (chain.length === 0) {
    const library = view.libraries.find((l) => l.kind === kind)
    return library === undefined
      ? `内容里没有 ${kind}/${id}。\n（没有名为 "${kind}" 的库。可用库：${view.libraries.map((l) => l.kind).join(' / ')}）`
      : `内容里没有 ${kind}/${id}。\n（${library.title} 当前有 ${library.count} 个条目）`
  }
  return [
    `${kind}/${id} 的提供方链（第一个是当前生效的）：`,
    ...chain.map((pack, i) => `${i === 0 ? '▶' : ' '} ${i + 1}. ${pack}`),
    '',
    chain.length === 1
      ? '只有一个提供方，所以没有可切换的备选。'
      : '后面的提供方是回退项；要切换优先顺序见 docs/CONTENT.md §5.3。',
  ].join('\n')
}

/** 渲染内容概览。 */
function formatContentView(view: ContentView, onlyKind: string | undefined): string {
  const lines: string[] = []

  lines.push(`已装载 ${view.packs.length} 个内容包：`)
  for (const p of view.packs) {
    const overrides = p.overrides.length > 0 ? ` · 显式覆盖 ${p.overrides.length} 条` : ''
    lines.push(`· ${p.id} v${p.version}（${p.name}）· 提供 ${p.provides.length} 个库${overrides}`)
  }
  lines.push(`外部内容目录：${view.externalRoot ?? '（未配置，只用内置内容）'}`)

  const libraries =
    onlyKind === undefined ? view.libraries : view.libraries.filter((l) => l.kind === onlyKind)
  if (libraries.length === 0) {
    lines.push('', `没有名为 "${onlyKind}" 的库。可用库：${view.libraries.map((l) => l.kind).join(' / ')}`)
  } else {
    lines.push('', '各库条目数：')
    for (const l of libraries) {
      const layer = l.layer === 'semantic' ? '语义库' : '表现库'
      lines.push(`· ${l.kind}（${l.title}·${layer}）：${l.count} 条`)
    }
  }

  const errors = view.issues.filter((i) => i.level === 'error')
  const warnings = view.issues.filter((i) => i.level === 'warning')
  if (errors.length === 0 && warnings.length === 0) {
    lines.push('', '内容层没有任何问题。')
  } else {
    // 工具里给**全量**：日志里只打前几条是怕刷屏，这里用户是主动来查的。
    lines.push('', `内容问题：${errors.length} 个错误 / ${warnings.length} 个警告`)
    for (const i of [...errors, ...warnings]) {
      lines.push(`· [${i.level === 'error' ? '错误' : '警告'}][${i.where}] ${i.message}`)
    }
  }
  return lines.join('\n')
}
