/**
 * 「任务关系图」功能页（功能注册表里的第一项）—— 工厂组件，模块顶层不 import react。
 *
 * 页面布局（task-14 起目录树从 rail 搬进来；task-15 起工具条只剩一个**控件**）：
 *   .fo-feature
 *     .fo-feature-bar   范围列折叠按钮（唯一的控件；功能说明/当前范围已删，见下）
 *     .fo-feature-body  .fo-scope（目录树列，可折叠）| .fo-canvas-area（画布，铺满剩余空间）
 *
 * task-15 冗余审计：这里原来还有 `.fo-feature-hint`（功能说明）与 `.fo-feature-meta`（当前范围）两个
 * 纯文字 span。功能名已在 rail 品牌区 / 功能项出现，范围名已由树上的选中态 + 正文头部面包屑 + 图头
 * 图名三处承担 —— 同一份信息只该出现在**离它描述的对象最近**的那一处，所以这两个 span 连同它的
 * ctx 字段（scopeText）一起删掉；`ctx.featureHint` 仍在（rail 功能项的 title、以及别的功能页要用）。
 *
 * 数据与交互状态全部由宿主 OverviewPanel 通过 ctx 传进来（本组件不取数据、不碰 store）：
 *   ctx.scopeCollapsed, ctx.onToggleScope
 *   ctx.treeProps                 原样转交 TreeNav（拖拽/右键/键盘 ARIA tree 全在它内部）
 *   ctx.graphs, ctx.selectedId, ctx.onOpenTask, ctx.nodePos, ctx.onNodeMove …
 */

import { createGraphView } from './GraphView.js'
import { createTreeNav } from './TreeNav.js'

/** 「一键整理」的图标：20px 线性 sparkle（自绘，不引图标字体/图片）。 */
export function sparkleIcon(h) {
  return h('svg', {
    className: 'fo-btn-icon',
    width: 14,
    height: 14,
    viewBox: '0 0 20 20',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.5,
    strokeLinecap: 'round',
    strokeLinejoin: 'round',
    'aria-hidden': 'true',
  },
    h('path', { d: 'M10 2.4l1.5 4.1 4.1 1.5-4.1 1.5L10 13.6 8.5 9.5 4.4 8l4.1-1.5z' }),
    h('path', { d: 'M15.6 13.4l.7 1.9 1.9.7-1.9.7-.7 1.9-.7-1.9-1.9-.7 1.9-.7z' }),
  )
}

export function createGraphFeature(deps) {
  const { h } = deps || {}
  const TreeNav = createTreeNav(deps)
  const GraphView = createGraphView(deps)

  return function GraphFeature(props) {
    const ctx = props || {}
    const collapsed = ctx.scopeCollapsed === true
    const org = ctx.organize && typeof ctx.organize === 'object' ? ctx.organize : null
    const orgAvailable = !!(org && org.available)
    const orgRunning = !!(org && org.running)
    const orgOpen = !!(org && org.open)
    const orgPending = org && Number(org.pending) > 0 ? Number(org.pending) : 0

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
        /* 一键整理：宿主没有 organize 接口（旧宿主）时整块不渲染，而不是点了报错。 */
        orgAvailable
          ? h('button', {
            type: 'button',
            className: 'fo-btn',
            'data-size': 'sm',
            'data-action': 'organize',
            disabled: orgRunning,
            title: '让 AI 为当前范围找前置/后置/来源关系，先出建议再落库',
            onClick: () => { if (!orgRunning && typeof org.onRun === 'function') org.onRun() },
          }, orgRunning ? '整理中…' : '一键整理', orgRunning ? null : sparkleIcon(h))
          : null,
        /* 有建议时给一个折叠开关：用来把抽屉收起来再打开，不用重跑一次模型。 */
        orgAvailable && orgPending > 0
          ? h('button', {
            type: 'button',
            className: 'fo-btn',
            'data-size': 'sm',
            'data-variant': 'ghost',
            'data-action': 'organize-toggle',
            'aria-expanded': orgOpen ? 'true' : 'false',
            'aria-controls': 'fo-organize-column',
            onClick: () => { if (typeof org.onToggle === 'function') org.onToggle() },
          }, orgOpen ? '收起建议' : `建议 ${orgPending}`)
          : null,
      ),
      h('div', { className: 'fo-feature-body' },
        collapsed
          ? null
          : h('div', { className: 'fo-scope-column', id: 'fo-scope-column' }, h(TreeNav, ctx.treeProps || {})),
        h('div', { className: 'fo-canvas-area' }, h(GraphView, {
          graphs: ctx.graphs,
          selectedId: ctx.selectedId,
          focusedId: ctx.focusedId,
          nodePos: ctx.nodePos,
          onOpenTask: ctx.onOpenTask,
          onFocusTask: ctx.onFocusTask,
          onNodeMove: ctx.onNodeMove,
          onResetLayout: ctx.onResetLayout,
          onBlur: ctx.onBlur,
          hostReady: ctx.hostReady,
          hostReason: ctx.hostReason,
          onOpenSession: ctx.onOpenSession,
        })),
      ),
    )
  }
}

export default createGraphFeature
