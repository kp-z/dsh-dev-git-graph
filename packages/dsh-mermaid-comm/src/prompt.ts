import type { PromptSection } from '@deepseek-ai/dsh-system-prompt'
import type { Context } from '@deepseek-ai/cordis'
import { ALL_DIAGRAM_TYPES } from './config.ts'

/** 生成「用 Mermaid 交流」的系统提示段文本。 */
export function buildPromptText(opts: {
  diagramTypes: string[]
  validateBeforeRender: boolean
}): string {
  const types = opts.diagramTypes.length > 0
    ? opts.diagramTypes.join(' / ')
    : ALL_DIAGRAM_TYPES.join(' / ')

  const validateLine = opts.validateBeforeRender
    ? '输出 Mermaid 前，先用 mermaid_validate 工具校验语法，确认无误再输出。'
    : ''

  return `## 开发交流优先用 Mermaid 图表达

在涉及开发的技术交流中，**尽可能用 Mermaid 图**来帮助理解，尤其是：

- 架构说明、模块关系 → flowchart 或 classDiagram
- 数据流 / 调用链 / 请求时序 → sequenceDiagram
- 状态流转 / 生命周期 → stateDiagram-v2
- 数据模型 / 表关系 → erDiagram
- 分支策略 / 提交历史 / 依赖演化 → gitGraph
- 计划排期 → gantt
- 其他适合的图 → ${types}

规则：
1. 先说一句话结论，再用 \`\`\`mermaid 围栏给出图；图要能独立表达核心信息，配简短图例说明。
2. 不要为了图而图：简单的单行结论、纯列表不需要画图。
3. 图必须语法正确。${validateLine}
4. 图是补充不是替代：文本解释仍要写清结论、理由、取舍。
5. 一次回复里多张图时，每张图聚焦一个主题，不要塞进一张图。`
}

/** 注入 systemPrompt.section（order 150，工具引导带）。 */
export function registerMermaidPrompt(ctx: Context, opts: {
  diagramTypes: string[]
  validateBeforeRender: boolean
}) {
  ctx.systemPrompt.section({
    name: 'mermaid-comm:guidance',
    order: 150,
    text: buildPromptText(opts),
  })
}
