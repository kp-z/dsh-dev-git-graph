/**
 * 「关系」功能页（功能注册表里的第一项）—— 工厂组件，模块顶层不 import react。
 *
 * 页面布局（task-17 起**单列**）：
 *   .fo-feature
 *     .fo-feature-bar   画布工具条：一键整理 / 建议 N（没有 organize 接口时整条不渲染）
 *     .fo-feature-body  .fo-canvas-area（画布铺满）
 *
 * task-17：范围树（原 `.fo-scope-column`）搬进 rail，成为一级项「关系」的**二级菜单**；
 * 页面里不再有第二列，范围折叠按钮与 `id="fo-scope-column"` 一起删除。
 * task-15 冗余审计：`.fo-feature-hint`（功能说明）与 `.fo-feature-meta`（当前范围）两个纯文字
 * span 已删 —— 功能名在 rail 一级项上，范围名由树上的选中态 + 正文头部面包屑 + 图头图名承担。
 *
 * 数据与交互状态全部由宿主 OverviewPanel 通过 ctx 传进来（本组件不取数据、不碰 store）：
 *   ctx.treeProps（交给 rail 的 SubNav）、ctx.graphs、ctx.selectedId、ctx.onOpenTask、
 *   ctx.nodePos、ctx.onNodeMove、ctx.hostReady、ctx.organize …
 */

import { createGraphView } from './GraphView.js'

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
  const GraphView = createGraphView(deps)

  return function GraphFeature(props) {
    const ctx = props || {}
    const org = ctx.organize && typeof ctx.organize === 'object' ? ctx.organize : null
    const orgAvailable = !!(org && org.available)
    const orgRunning = !!(org && org.running)
    const orgOpen = !!(org && org.open)
    const orgPending = org && Number(org.pending) > 0 ? Number(org.pending) : 0
    /* 没有整理接口（旧宿主）时工具条整条不渲染 —— 画布直接铺满，不留一条空条。 */
    const bar = orgAvailable
      ? h('div', { className: 'fo-feature-bar' },
        h('button', {
          type: 'button',
          className: 'fo-btn',
          'data-size': 'sm',
          'data-action': 'organize',
          disabled: orgRunning,
          title: '让 AI 为当前范围找前置/后置/来源关系，先出建议再落库',
          onClick: () => { if (!orgRunning && typeof org.onRun === 'function') org.onRun() },
        }, orgRunning ? '整理中…' : '一键整理', orgRunning ? null : sparkleIcon(h)),
        /* 有建议时给一个折叠开关：用来把抽屉收起来再打开，不用重跑一次模型。 */
        orgPending > 0
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
      )
      : null

    return h('div', { className: 'fo-feature' },
      bar,
      h('div', { className: 'fo-feature-body' },
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
