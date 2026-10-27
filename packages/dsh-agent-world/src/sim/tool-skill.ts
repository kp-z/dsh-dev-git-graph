/**
 * R368：工具名 → 技能/站点分类。
 *
 * 抽成纯函数的目的：这条映射决定 subagent 在舞台上走去哪，
 * 以前它藏在 index.ts 的内联正则里，改一个词就可能让所有工具回到 desk，且没有测试会红。
 */
export type ToolSkill = 'code' | 'review' | 'research' | 'compute'

export function skillForTool(name: string): ToolSkill {
  const value = String(name ?? '')
  if (/(content|search|read|memory|inspect|doc|wiki)/i.test(value)) return 'research'
  if (/(bash|terminal|shell|exec|compute|run)/i.test(value)) return 'compute'
  if (/(review|verify|check)/i.test(value)) return 'review'
  return 'code'
}
