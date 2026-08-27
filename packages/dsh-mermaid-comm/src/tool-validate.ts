import { defineTool } from '@deepseek-ai/dsh-tools'
import type { Context } from '@deepseek-ai/cordis'
import { ALL_DIAGRAM_TYPES } from './config.ts'
import { validateMermaid } from './validate.ts'

/** 注册 mermaid_validate 工具（模型输出前自检语法）。 */
export function registerValidateTool(ctx: Context) {
  ctx.tools.register(defineTool({
    name: 'mermaid_validate',
    description: '校验 Mermaid 图语法，避免渲染失败。输出前先调用它检查要生成的图。' +
      '严格校验：pie/gitGraph/architecture/treeView/radar 等（可靠）；' +
      '启发式预检：flowchart/sequenceDiagram/classDiagram/stateDiagram-v2/erDiagram/gantt（不能 100% 保证）。',
    parameters: {
      type: {
        type: 'string',
        required: true,
        description: `图类型，支持：${ALL_DIAGRAM_TYPES.join(' / ')}。`,
      },
      code: {
        type: 'string',
        required: true,
        description: 'Mermaid 源码（不含 ```mermaid 围栏）。',
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          ok: { type: 'boolean', required: true },
          errors: {
            type: 'array',
            required: true,
            items: { type: 'string' },
          },
          mode: {
            type: 'string',
            required: true,
            enum: ['strict', 'heuristic', 'unknown'],
          },
          warnings: {
            type: 'array',
            required: true,
            items: { type: 'string' },
          },
        },
      },
      render: (_args, value) => [{
        type: 'text',
        text: JSON.stringify(value, null, 2),
      }],
    },
    async execute(args) {
      const result = await validateMermaid(args.type, args.code)
      return {
        ok: result.ok,
        errors: result.errors,
        mode: result.mode,
        warnings: result.warnings,
      }
    },
  }))
}
