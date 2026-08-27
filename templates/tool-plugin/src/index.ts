import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'

/** Loader entry id（kebab-case，全局唯一）。 */
export const name = '<entry-id>'

/** 依赖的 service。 */
export const inject = ['tools']

/** 插件入口：注册工具。 */
export function apply(ctx: Context) {
  ctx.tools.register(defineTool({
    name: '<entry-id>_echo',
    description: '示例工具：回显输入文本。用于验证插件安装成功。',
    parameters: {
      text: {
        type: 'string',
        required: true,
        description: '要回显的文本',
      },
    },
    output: {
      schema: { type: 'string' },
      render: (_args, value) => [{ type: 'text', text: value }],
    },
    async execute(args) {
      return `[<entry-id>] ${args.text}`
    },
  }))
}
