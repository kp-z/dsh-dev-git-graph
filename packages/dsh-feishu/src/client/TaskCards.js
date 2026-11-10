/**
 * 图下方的任务卡片区 —— 工厂组件，模块顶层不 import react。
 *
 * 一张卡片 = 一个任务：状态点 + 编号 + 标题（两行截断）+ 项目/状态/阻塞/后置标签。
 * 点卡片开详情；键盘 Enter/Space 同样。颜色只来自宿主状态令牌 + styles.js 的分色槽。
 *
 * props：
 *   tasks        [{...task}]（已经按 scope 过滤过）
 *   selectedId   当前详情里的任务 id（aria-current 高亮）
 *   colorOf      workspaceKey → 分色索引（可选，用于卡片左上小色点）
 *   onOpenTask(taskId, task)
 */

import * as modelModule from '../overview/model.js'
import { decoVar, stateVar } from './styles.js'

function toneOf(state) {
  if (state === 'blocked') return 'danger'
  if (state === 'done') return 'ok'
  if (state === 'suspended') return 'warn'
  return 'idle'
}

export function createTaskCards(deps) {
  const { h } = deps || {}
  /* 纯函数层优先用注入的实现（入口会传同一个模块），没传就直接用本模块 import 的 —— 两条路等价。 */
  const model = (deps && deps.model) || modelModule

  return function TaskCards(props) {
    const { tasks, selectedId = '', colorOf, onOpenTask, max = 200 } = props || {}
    const list = (Array.isArray(tasks) ? tasks : []).slice(0, Math.max(1, Number(max) || 200))

    if (!list.length) {
      return h('div', { className: 'fo-placeholder' },
        h('div', { className: 'fo-placeholder-title' }, '这里还没有任务'),
        h('div', { className: 'fo-placeholder-body' }, '插件同步到飞书任务后，这里会按项目列出卡片。'),
      )
    }

    return h('section', { 'aria-label': '任务卡片' },
      h('div', { className: 'fo-cards-title' },
        h('span', null, '任务'),
        h('span', { className: 'fo-chip' }, `${list.length}`),
      ),
      h('div', { className: 'fo-cards' }, list.map((task) => {
        const id = String(task.id)
        const state = model.stateOf(task)
        const no = model.taskNo(task)
        const title = model.collapse(task.title) || id
        const workspace = model.collapse(task.workspaceTitle) || model.workspaceOf(task).label
        const refs = model.refsOf(task)
        const blocked = state === 'blocked' ? refs.blockedBy.length : 0
        const successors = refs.successors.length
        const colorIndex = colorOf ? colorOf[model.workspaceOf(task).key] : undefined
        const style = Number.isFinite(colorIndex) ? { '--fo-c': decoVar(colorIndex) } : undefined
        const activate = () => { if (typeof onOpenTask === 'function') onOpenTask(id, task) }
        return h('button', {
          key: id,
          type: 'button',
          className: 'fo-card',
          'data-state': state,
          'aria-current': selectedId === id ? 'true' : 'false',
          title,
          onClick: activate,
        },
          h('div', { className: 'fo-card-top' },
            h('span', { className: 'fo-dot', style: { '--fo-c': stateVar(state) }, 'aria-hidden': 'true' }),
            h('span', { className: 'fo-card-no' }, no > 0 ? `T${no}` : id.slice(0, 8)),
            Number.isFinite(colorIndex) ? h('span', { className: 'fo-dot', style, 'aria-hidden': 'true', 'data-deco': '1' }) : null,
          ),
          h('div', { className: 'fo-card-title' }, title),
          h('div', { className: 'fo-card-foot' },
            h('span', { className: 'fo-tag', title: model.str(task.workspacePath) || workspace }, workspace || '未归属'),
            h('span', { className: 'fo-tag', 'data-tone': toneOf(state) }, model.stateLabel(state)),
            blocked ? h('span', { className: 'fo-tag', 'data-tone': 'danger' }, `阻塞 ${blocked}`) : null,
            successors ? h('span', { className: 'fo-tag' }, `后置 ${successors}`) : null,
          ),
        )
      })),
    )
  }
}

export default createTaskCards
