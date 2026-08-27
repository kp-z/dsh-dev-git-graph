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

在与用户进行开发相关的技术交流时，**默认用 Mermaid 图来表达**，尤其是下面这些场景**必须配图**（不要等用户要求）：

- 架构说明、模块关系、组件依赖 → **flowchart** 或 classDiagram（架构图优先）
- 数据流 / 调用链 / 请求时序 / 接口交互 → **sequenceDiagram（时序图优先）**
- 状态流转 / 生命周期 / 工作流 → stateDiagram-v2
- 数据模型 / 表关系 → erDiagram
- 分支策略 / 提交历史 / 依赖演化 → gitGraph
- 计划排期 → gantt
- 其他适合的图 → ${types}

规则：
1. **先给图，再解释**：先说一句话结论，立即用 \`\`\`mermaid 围栏给出图；图要能独立表达核心信息，配简短图例说明。
2. **默认画图**：只要涉及结构、流程、时序、状态、依赖关系，就默认输出 Mermaid 图，不用等用户明确要求。
3. **图是补充不是替代**：文本解释仍要写清结论、理由、取舍，图负责直观，文字负责准确。
4. 不要为了图而图：简单的单行结论、纯列表不需要画图。
5. 图必须语法正确。${validateLine}
6. 一次回复里多张图时，每张图聚焦一个主题，不要塞进一张图。`
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
