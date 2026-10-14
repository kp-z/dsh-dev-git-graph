/**
 * 世界工具集（BACKLOG M0-2）。
 *
 * 设计原则沿用本仓库的约定（见 packages/dsh-daily/src/tools.ts 的注释）：
 * 1. **每个工具都说明副作用**——模型才知道什么时候敢调。
 * 2. **只读与写分开**——`agent_world_status` 只读；`agent_world_open` 会替换当前世界，必须写明。
 * 3. 输出是真给人/给模型读的中文文本，不吐枚举名。
 *
 * 命名空间 `agent_world_*`：与宿主其它工具不撞名，也让模型一眼看出这是一组。
 * 后续（BACKLOG M2）会加 `agent_world_dispatch` / `agent_world_hire` / `agent_world_report`。
 */
import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { formatRoster, formatSummary, formatTaskBoard } from '../domain/summary.js'
import type { PluginState } from '../state.js'

/** 注册全部 `agent_world_*` 工具。 */
export function registerWorldTools(ctx: Context, state: PluginState): void {
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
        const world = state.world
        if (!world) {
          return '世界尚未创建。调用 agent_world_open 建一个（会创建一座默认小镇并放入初始角色）。'
        }
        return [formatSummary(world), '', '花名册：', formatRoster(world), '', '工单板：', formatTaskBoard(world)].join('\n')
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
        name: { type: 'string', description: '世界名，也是随机种子的来源（同名 → 同一个小镇布局）。留空用配置里的默认名。' },
        agents: { type: 'number', description: '初始角色数，默认 8，受 maxAgents（默认 24）约束。' },
      },
      output: {
        schema: { type: 'string' },
        render: (_args, value) => [{ type: 'text', text: value }],
      },
      async execute(args) {
        if (args.name !== undefined && args.name.trim() === '') {
          throw new Error('世界名不能是空字符串（那会让 seed 来源变得不确定）。留空请直接不传这个参数。')
        }
        const world = state.resetWorld(args.name)
        const head =
          args.agents === undefined
            ? `已创建世界「${world.name}」，seed=${world.seed}。`
            : `已创建世界「${world.name}」，seed=${world.seed}，请求角色数 ${args.agents}（实际 ${world.agents.length}，受 maxAgents=${state.config.maxAgents} 约束）。`
        const note = [
          '',
          '当前只有世界模型，模拟循环（tick）与 3D 面板尚未接入——见 docs/BACKLOG.md 的 M1 与 M3。',
        ]
        return [head, ...note, '', formatSummary(world), '', '花名册：', formatRoster(world)].join('\n')
      },
    }),
  )
}
