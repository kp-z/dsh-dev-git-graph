/**
 * 右侧详情面板 —— 工厂组件，模块顶层不 import react。
 *
 * 一块面板 = 一个任务的全部信息：状态 / 项目 / 目录 / 编号 / 绑定会话 + 四组关系
 * （前置、后置、来源、派生）。关系项能点就点过去；任务表里查不到的就地禁掉并标「缺失」
 * —— 这是「关系里有、任务表里没有」的唯一诚实表达。
 *
 * props：
 *   task        原始任务对象（扁平契约）
 *   node        layout 里对应的节点（可能是 ghost；用来显示状态与归属）
 *   tasksById   {id: task} 用于判断关系项是否还存在
 *   colorOf     workspaceKey → 分色索引
 *   hostReady / hostReason / onOpenSession  宿主能力位：绑定会话能不能打开、不能打开时给个原因
 *   onClose() onSelectTask(id) onFocusProject(workspaceKey)
 */

import * as modelModule from '../overview/model.js'
import { decoVar, stateVar } from './styles.js'

const REF_SECTIONS = [
  { field: 'blockedBy', label: '前置（必须先完成）', kind: '前置' },
  { field: 'successors', label: '后置（等这个）', kind: '后置' },
  { field: 'sourceTasks', label: '来源任务', kind: '来源' },
  { field: 'derivedTasks', label: '派生任务', kind: '派生' },
  /* 时间先后只是「谁在前谁在后」，不阻塞；放在最后，别让人误读成依赖。
     optional：没有时间边时整段不渲染，别给每条任务都挂两个空标题。 */
  { field: 'earlierTasks', label: '更早的任务（时间先后）', kind: '更早', optional: true },
  { field: 'laterTasks', label: '更晚的任务（时间先后）', kind: '更晚', optional: true },
]

export function createDetailPanel(deps) {
  const { h } = deps || {}
  const model = (deps && deps.model) || modelModule

  return function DetailPanel(props) {
    const {
      task, node, tasksById, colorOf, onClose, onSelectTask, onFocusProject,
      hostReady, hostReason, onOpenSession,
    } = props || {}
    if (!task && !node) return null

    const id = model.str((task && task.id) || (node && node.id))
    const title = model.collapse(task && task.title) || (node && node.fullTitle) || id
    const workspace = model.workspaceOf(task || {})
    const state = node ? node.state : model.stateOf(task)
    const no = model.taskNo(task)
    const refs = model.refsOf(task || {})
    const colorIndex = colorOf ? colorOf[workspace.key] : undefined
    const known = (refId) => (tasksById && tasksById[refId]) || null
    /* 绑定会话：面板里能直接跳过去（与节点动作列同一个宿主能力位，口径一致）。 */
    const sessionId = model.str((task && task.sessionId) || (node && node.sessionId))

    const rows = []
    rows.push(['项目', workspace.label || '未归属', false])
    if (workspace.path) rows.push(['目录', workspace.path, true])
    rows.push(['状态', stateText(state, refs), false])
    rows.push(['编号', no > 0 ? `T${no}` : '—', true])
    rows.push(['任务 ID', id, true])
    rows.push(['绑定会话', model.str(task && task.sessionId) || '未绑定', true])

    const sections = REF_SECTIONS.map((section, sectionIndex) => {
      const items = refs[section.field] || []
      if (section.optional === true && !items.length) return null
      return h('section', { key: section.field, className: 'fo-sec', style: { '--fo-i': Math.min(sectionIndex + 1, 7) } },
        h('span', { className: 'fo-sec-label' }, section.label),
        items.length
          ? h('div', { className: 'fo-refs' }, items.map((ref, refIndex) => {
            /* 判缺失只看「任务表里有没有这条记录」：跨分组的引用仍然是能点过去的。 */
            const hit = known(ref.id)
            const missing = !hit
            const label = ref.title || (hit ? model.collapse(hit.title) : '') || ref.id
            return h('button', {
              key: `${section.field}:${ref.id}`,
              type: 'button',
              className: 'fo-ref',
              'data-missing': missing ? '1' : '0',
              disabled: missing,
              style: { '--fo-i': Math.min(refIndex, 7) },
              title: missing ? `${ref.id}（任务表里没有这条记录）` : label,
              onClick: missing ? undefined : () => { if (typeof onSelectTask === 'function') onSelectTask(ref.id) },
            },
              h('span', { className: 'fo-ref-kind' }, section.kind),
              h('span', { className: 'fo-ref-label' }, label),
              missing ? h('span', { className: 'fo-ref-kind' }, '缺失') : null,
            )
          }))
          : h('span', { className: 'fo-muted' }, '无'),
      )
    })

    const actions = []
    /* 「打开会话」：与节点上那个动作按钮同一套 disabled/title 口径，缺一不可时就地说明原因。 */
    const canOpen = hostReady === true && !!sessionId
    const openTitle = hostReady !== true
      ? (model.str(hostReason) || '当前宿主不支持打开会话')
      : (sessionId ? '在宿主里打开这个任务绑定的会话' : '这个任务没有绑定会话')
    actions.push(h('button', {
      key: 'session',
      type: 'button',
      className: 'fo-btn',
      disabled: !canOpen,
      title: openTitle,
      onClick: () => { if (canOpen && typeof onOpenSession === 'function') onOpenSession(sessionId, title) },
    }, '打开会话'))
    if (typeof onClose === 'function') actions.push(h('button', { key: 'close', type: 'button', className: 'fo-btn', onClick: onClose }, '关闭详情'))
    if (workspace.key && workspace.key !== model.UNGROUPED_KEY && typeof onFocusProject === 'function') {
      actions.push(h('button', {
        key: 'focus',
        type: 'button',
        className: 'fo-btn',
        'data-variant': 'ghost',
        onClick: () => onFocusProject(workspace.key),
      }, '只看这个项目'))
    }

    return h('aside', { className: 'fo-detail', 'aria-label': '任务详情' },
      h('div', { className: 'fo-detail-eyebrow' },
        h('span', { className: 'fo-dot', style: { '--fo-c': stateVar(state) }, 'aria-hidden': 'true' }),
        h('span', null, node && node.ghost === true
          ? (node.missing === true ? '缺失任务' : '跨分组任务')
          : `任务 ${no > 0 ? `T${no}` : id.slice(0, 8)}`),
        Number.isFinite(colorIndex)
          ? h('span', { className: 'fo-dot', style: { '--fo-c': decoVar(colorIndex) }, 'aria-hidden': 'true' })
          : null,
      ),
      h('h2', { className: 'fo-detail-title' }, title),
      h('dl', { className: 'fo-kv' }, rows.flatMap(([key, value, mono]) => [
        h('dt', { key: `${key}-k` }, key),
        h('dd', { key: `${key}-v`, className: mono ? 'fo-mono' : undefined }, value),
      ])),
      ...sections,
      node && node.ghost === true
        ? h('p', { className: 'fo-muted' }, node.missing === true
          ? '这个任务只在关系里出现，任务表里查不到：可能是跨清单引用，或者条目已经被删掉。'
          : `这个任务属于 ${node.workspaceLabel || '另一个项目'}，画在这里只是为了让依赖方向不断链。`)
        : null,
      h('div', { className: 'fo-detail-actions' }, actions),
    )
  }

  function stateText(state, refs) {
    if (state === 'done') return '已完成'
    if (state === 'blocked') return `阻塞（${(refs.blockedBy || []).length} 个前置未完成）`
    if (state === 'suspended') return '已挂起'
    if (state === 'ghost') return '不在当前范围的任务表里'
    return '就绪'
  }
}

export default createDetailPanel
