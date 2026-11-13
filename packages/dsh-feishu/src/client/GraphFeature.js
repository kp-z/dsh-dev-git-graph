/**
 * 「关系」功能页（功能注册表里的第一项）—— 工厂组件，模块顶层不 import react。
 *
 * 页面布局（task-17 起**单列**，本页再收敛一次）：
 *   .fo-feature
 *     .fo-feature-body  .fo-canvas-area
 *       .fo-canvas-stage  GraphView（画布 + 右上角浮动工具卡片）
 *
 * 用户口径：
 *  - 「关系页面的按钮都要放在下面卡片里面，不要单起一行」→ 旧的 `.fo-feature-bar` 整条删掉；
 *    「建议」在正文头部；缩放/适应/复位布局/显示已完成在每张卡片的 header 里。
 *  - 「关系图画板要支持缩放平移聚焦」→ 这些交互与卡片一起落在 GraphView（状态在那里闭环），
 *    本组件只负责把宿主 ctx 透传下去。
 *
 * task-17：范围树（原 `.fo-scope-column`）搬进 rail，成为一级项「关系」的**二级菜单**；
 * 页面里不再有第二列。数据与交互状态全部由宿主 OverviewPanel 通过 ctx 传进来
 * （本组件不取数据、不碰 store）：ctx.treeProps、ctx.graphs、ctx.selectedId、ctx.onOpenTask、
 * ctx.nodePos、ctx.onNodeMove、ctx.hostReady、ctx.organize …
 */

import { createGraphView, sparkleIcon } from './GraphView.js'

export { sparkleIcon }

export function createGraphFeature(deps) {
  const { h } = deps || {}
  const GraphView = createGraphView(deps)

  return function GraphFeature(props) {
    const ctx = props || {}
    const note = typeof ctx.organizeNote === 'string' ? ctx.organizeNote.trim() : ''
    const noteBar = note
      ? h('div', { className: 'fo-note-bar', role: 'status' },
        h('span', { className: 'fo-note-text' }, note),
        /* 临时展开期间 hideDone 已经是 false，这个按钮自然不再出现。 */
        ctx.hideDone && typeof ctx.onShowDone === 'function'
          ? h('button', {
            type: 'button', className: 'fo-btn', 'data-size': 'sm', 'data-variant': 'ghost',
            onClick: () => ctx.onShowDone(),
          }, '显示已完成')
          : null,
        h('button', {
          type: 'button', className: 'fo-btn', 'data-size': 'sm', 'data-variant': 'ghost',
          'aria-label': '关闭提示',
          onClick: () => { if (typeof ctx.onDismissOrganizeNote === 'function') ctx.onDismissOrganizeNote() },
        }, '关闭'),
      )
      : null

    return h('div', { className: 'fo-feature' },
      noteBar,
      h('div', { className: 'fo-feature-body' },
        h('div', { className: 'fo-canvas-area' },
          h(GraphView, {
            graphs: ctx.graphs,
            selectedId: ctx.selectedId,
            focusedId: ctx.focusedId,
            nodePos: ctx.nodePos,
            hideDone: ctx.hideDone,
            hiddenDone: ctx.hiddenDone,
            onToggleHideDone: ctx.onToggleHideDone,
            onOpenTask: ctx.onOpenTask,
            onFocusTask: ctx.onFocusTask,
            onNodeMove: ctx.onNodeMove,
            onResetLayout: ctx.onResetLayout,
            onBlur: ctx.onBlur,
            hostReady: ctx.hostReady,
            hostReason: ctx.hostReason,
            onOpenSession: ctx.onOpenSession,
          }),
        ),
      ),
    )
  }
}

export default createGraphFeature
