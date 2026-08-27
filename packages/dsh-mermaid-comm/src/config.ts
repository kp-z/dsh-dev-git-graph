import z from '@deepseek-ai/schemastery'

/** dsh-mermaid-comm 插件配置 schema。 */
export const MermaidCommConfig = z.object({
  /** 总开关：false 时不注入 prompt、不注册校验工具。 */
  enabled: z.boolean().default(true),
  /** 行为引导强度：global=所有 agent 注入；off=关闭 prompt 注入（工具仍可用）。 */
  promptLevel: z.union(['global', 'off']).default('global'),
  /** 允许的图类型（数组）。空/缺省 = 全部类型开放。 */
  diagramTypes: z.array(z.string()).default([]),
  /** 提示模型在输出前用 mermaid_validate 自检。 */
  validateBeforeRender: z.boolean().default(true),
})

/** 从 schema 推导的配置类型（schemastery 无 z.infer，用全局命名空间 TypeT）。 */
export type MermaidCommConfig = Schemastery.TypeT<typeof MermaidCommConfig>

/** 支持的全部 Mermaid 图类型（用于描述 prompt 与校验工具）。 */
export const ALL_DIAGRAM_TYPES = [
  'flowchart',
  'sequenceDiagram',
  'classDiagram',
  'stateDiagram-v2',
  'erDiagram',
  'gantt',
  'pie',
  'gitGraph',
  'journey',
  'timeline',
  'architecture',
  'radar',
  'treeView',
  'packet',
  'info',
] as const

export type DiagramType = (typeof ALL_DIAGRAM_TYPES)[number]

/** @mermaid-js/parser（langium）严格支持的图类型子集。 */
export const STRICT_VALIDATED_TYPES: readonly string[] = [
  'info',
  'packet',
  'pie',
  'treeView',
  'architecture',
  'gitGraph',
  'eventmodeling',
  'radar',
  'railroad',
  'railroadEbnf',
  'railroadAbnf',
  'railroadPeg',
  'treemap',
  'wardley',
  'cynefin',
]

/** 需要启发式预检的旧类型（mermaid 核心 jison parser，node 端需 DOM）。 */
export const HEURISTIC_TYPES: readonly string[] = [
  'flowchart',
  'sequenceDiagram',
  'classDiagram',
  'stateDiagram-v2',
  'erDiagram',
  'gantt',
  'journey',
  'timeline',
]
