/**
 * 派单工具 `agent_world_dispatch`（BACKLOG M2-9）。
 *
 * **这是任务库第一次被真正消费**：从内容库里取一条工作流（任务集），
 * 实例化成一世界的工单。内容库里加一条工作流，这个工具立刻就能派它——不改代码。
 *
 * ## 为什么它只 import `protocol/`
 *
 * 派单需要内容库（读任务集、实例化），但 `tools/` 按边界规则只许 import `protocol/`。
 * 所以真正的实现在 `state.ts` 里，通过 `WorldServicePort.dispatch()` 暴露。
 * 工具只管校验参数、拼给人看的话。
 */
import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { WorldServicePort } from '../protocol/index.js'
import { formatTaskBoard } from '../protocol/index.js'

/** 注册 `agent_world_dispatch`。 */
export function registerDispatchTool(ctx: Context, world: WorldServicePort): void {
  ctx.tools.register(
    defineTool({
      name: 'agent_world_dispatch',
      description:
        '把一整条工作流派进当前世界（**有副作用：会往世界追加工单**，但不会自动开工——开工由模拟循环按依赖与工位决定）。' +
        '派完返回新工单的 id 与整块工单板。' +
        '用户说「派个活 / 让团队做 X / 开一条流水线」时用它。' +
        '不知道有哪些工作流可选时，先调 agent_world_content 看 tasks 库。',
      parameters: {
        taskSet: {
          type: 'string',
          required: true,
          description: '任务库里的任务集 id，例如 task.town-inspection（巡检一次小镇，只用看世界/读内容就能走完）。',
        },
      },
      output: {
        schema: { type: 'string' },
        render: (_args, value) => [{ type: 'text', text: value }],
      },
      async execute(args) {
        const taskSet = args.taskSet
        if (typeof taskSet !== 'string' || taskSet.trim() === '') {
          throw new Error(`taskSet 不能为空。可用任务集：${availableSetsText(world)}`)
        }
        if (world.currentWorld() === null) {
          throw new Error('还没有世界。先调 agent_world_open 建一个，再派单。')
        }

        let outcome
        try {
          outcome = world.dispatch(taskSet.trim())
        } catch (error) {
          // 端口抛的是"找不到任务集 + 可用列表"，转成工具错误就够了；
          // 但补一句"去哪看有哪些工作流"，省得模型去猜 id。
          const detail = error instanceof Error ? error.message : String(error)
          throw new Error(`${detail}\n也可以调 agent_world_content（kind=tasks）看任务库的完整清单。`)
        }

        const current = world.currentWorld()
        return [
          `已派单：${outcome.taskSet}`,
          `新工单 ${outcome.addedTaskIds.length} 张（该工作流共 ${outcome.templateCount} 步）：${outcome.addedTaskIds.join('、')}`,
          `世界现在共 ${outcome.totalTasks} 张工单。`,
          '',
          '注意：工单不会立刻开工。模拟循环按「依赖是否满足」与「有没有空工位」决定谁去做——',
          '刚派进来的通常只有第一步是可领取的。',
          '',
          '工单板：',
          current === null ? '（世界没了）' : formatTaskBoard(current),
        ].join('\n')
      },
    }),
  )
}

/** 列出可用任务集，供参数错误时提示。 */
function availableSetsText(world: WorldServicePort): string {
  const ids = world.content().entryIds('tasks')
  return ids.length > 0 ? ids.join(' / ') : '（任务库是空的——检查内容包）'
}
