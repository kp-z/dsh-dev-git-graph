/**
 * 「任务关系图」功能页（功能注册表里的第一项）—— 工厂组件，模块顶层不 import react。
 *
 * 页面布局（task-14 起，目录树从 rail 搬进来的）：
 *   .fo-feature
 *     .fo-feature-bar   范围列折叠按钮 + 功能说明 + 当前范围
 *     .fo-feature-body  .fo-scope（目录树列，可折叠）| .fo-canvas-area（画布，铺满剩余空间）
 *
 * 数据与交互状态全部由宿主 OverviewPanel 通过 ctx 传进来（本组件不取数据、不碰 store）：
 *   ctx.featureHint, ctx.scopeText, ctx.scopeCollapsed, ctx.onToggleScope
 *   ctx.treeProps                 原样转交 TreeNav（拖拽/右键/键盘 ARIA tree 全在它内部）
 *   ctx.graphs, ctx.selectedId, ctx.onOpenTask
 */

import { createGraphView } from './GraphView.js'
import { createTreeNav } from './TreeNav.js'

export function createGraphFeature(deps) {
  const { h } = deps || {}
  const TreeNav = createTreeNav(deps)
  const GraphView = createGraphView(deps)

  return function GraphFeature(props) {
    const ctx = props || {}
    const collapsed = ctx.scopeCollapsed === true

    return h('div', { className: 'fo-feature' },
      h('div', { className: 'fo-feature-bar' },
        h('button', {
          type: 'button',
          className: 'fo-btn',
          'data-size': 'sm',
          'data-variant': 'ghost',
          'aria-expanded': collapsed ? 'false' : 'true',
          'aria-controls': 'fo-scope-column',
          title: collapsed ? '展开范围列' : '折叠范围列',
          onClick: () => { if (typeof ctx.onToggleScope === 'function') ctx.onToggleScope() },
        }, collapsed ? '› 范围' : '‹ 范围'),
        h('span', { className: 'fo-feature-hint' }, ctx.featureHint || ''),
        h('span', { className: 'fo-feature-meta' }, ctx.scopeText || ''),
      ),
      h('div', { className: 'fo-feature-body' },
        collapsed
          ? null
          : h('div', { className: 'fo-scope-column', id: 'fo-scope-column' }, h(TreeNav, ctx.treeProps || {})),
        h('div', { className: 'fo-canvas-area' }, h(GraphView, {
          graphs: ctx.graphs,
          selectedId: ctx.selectedId,
          onOpenTask: ctx.onOpenTask,
        })),
      ),
    )
  }
}

export default createGraphFeature
