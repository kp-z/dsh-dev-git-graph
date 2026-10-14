/**
 * 世界工具集（BACKLOG M0-2 / M1-5）。
 *
 * 设计原则沿用本仓库的约定（见 packages/dsh-daily/src/tools.ts 的注释）：
 * 1. **每个工具都说明副作用**——模型才知道什么时候敢调。
 * 2. **只读与写分开**——`agent_world_status` 只读；`agent_world_open` 会替换当前世界，必须写明。
 * 3. 输出是真给人/给模型读的中文文本，不吐枚举名。
 *
 * 命名空间 `agent_world_*`：与宿主其它工具不撞名，也让模型一眼看出这是一组。
 * 后续会加 `agent_world_dispatch`（用任务库派单）/ `agent_world_hire` / `agent_world_report`。
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
          const problems = state.contentIssues.filter((i) => i.level === 'error')
          const tail = problems.length > 0 ? `\n内容层有 ${problems.length} 个错误，先修它们：\n${problems.slice(0, 3).map((p) => `· [${p.where}] ${p.message}`).join('\n')}` : ''
          return `世界尚未创建。调用 agent_world_open 建一个。${tail}`
        }
        return [
          formatSummary(world),
          '',
          `内容来源：${state.describeContent()}`,
          `场景：${world.origin.scene}｜内容包：${world.origin.packs.join('、') || '（无）'}`,
          '',
          '花名册：',
          formatRoster(world),
          '',
          '工单板：',
          formatTaskBoard(world),
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
        const world = state.resetWorld(args.name)
        return [
          `已创建世界「${world.name}」，seed=${world.seed}。`,
          `场景：${world.origin.scene}｜花名册角色 ${world.agents.length} 人｜工单 ${world.tasks.length} 张（等 lead 派单）`,
          '',
          '当前只有世界模型与内容库，模拟循环（tick）与 3D 面板尚未接入——见 docs/BACKLOG.md 的 M2 与 M4。',
          '',
          formatSummary(world),
          '',
          '花名册：',
          formatRoster(world),
        ].join('\n')
      },
    }),
  )
}
