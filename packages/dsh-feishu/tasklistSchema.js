/** Managed Task v2 tasklist contract. No model calls, no inferred destination list. */
export const TASKLIST_SCHEMA_VERSION = 1
export const DEFAULT_TASKLIST_NAME = 'DSH 任务清单'

export function tasklistFields(settings = {}, workspaceNames = []) {
  const f = settings.taskFields || {}
  const rows = [
    { key: 'workspace', name: f.workspace || '工作区', type: 'single_select', options: [...new Set(workspaceNames.filter(Boolean))], accepts: ['text', 'single_select', 'multi_select'] },
    { key: 'trigger', name: f.trigger || '触发条件', type: 'single_select', options: ['人工触发', '自动执行', '按时执行'] },
    { key: 'legacyAuto', name: f.legacyAuto || '自动开工', type: 'single_select', options: ['是', '否'], optional: true },
    { key: 'doc', name: f.doc || '文档', type: 'text' },
    { key: 'priority', name: f.priority || '优先级', type: 'single_select', options: settings.priorityOptions || ['P0', 'P1', 'P2', 'P3'] },
    { key: 'eta', name: f.eta || '预期完成', type: 'text' },
    { key: 'startCol', name: f.startCol || '开始时间', type: 'datetime' },
    { key: 'endCol', name: f.endCol || '结束时间', type: 'datetime' },
    { key: 'suspension', name: '处理状态', type: 'single_select', options: ['正常', '挂起'] },
    { key: 'predecessors', name: '前置任务', type: 'text' },
    { key: 'successors', name: '后置任务', type: 'text' },
    { key: 'source', name: '来源任务', type: 'text' },
  ].map(row => ({ ...row, name: String(row.name).trim() }))
  const names = new Set()
  for (const row of rows) {
    if (!row.name || names.has(row.name)) throw new Error('任务字段配置名称重复或为空：' + row.name)
    names.add(row.name)
  }
  return rows
}

export function schemaSignature(settings, workspaceNames = []) {
  return JSON.stringify([TASKLIST_SCHEMA_VERSION, settings.managedTasklist, tasklistFields(settings, workspaceNames)])
}

export function selectTaskList(rawLists, managedGuid) {
  const ids = [...new Set((rawLists || []).map(row => row?.tasklist_guid).filter(Boolean))]
  if (managedGuid && ids.includes(managedGuid)) return { guid: managedGuid, ambiguous: false }
  return { guid: ids.length === 1 ? ids[0] : '', ambiguous: ids.length > 1 }
}
