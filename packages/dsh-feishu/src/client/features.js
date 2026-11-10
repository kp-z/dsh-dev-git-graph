/**
 * 功能注册表（Feature Registry）
 *
 * 用户口径：「这个任务关系图应该只是其中之一的功能，以后还会有更多」。所以 rail 不是「项目树」，
 * 而是**功能导航**；关系图只是注册表里的第一项。
 *
 * 约定：
 * - `createFeatures(deps)` 返回 `[{ id, label, hint, icon, Component }]`：
 *   - `id`       稳定标识，落 store（键 `feature`），也是以后做深链/书签的锚点
 *   - `label`    rail 导航项上的文字（13px）
 *   - `hint`     正文头部的一句话说明
 *   - `icon(h)`  20px 线性图标工厂（收 `h`，返回元素；不引图标字体/图片）
 *   - `Component(deps)` → 组件工厂，渲染时收到一个 ctx 对象（见 OverviewPanel）
 * - rail 的导航项、正文渲染、store 里的 activeFeature **全部**从这里派生：
 *   加功能只往数组里追加一项，rail 与正文骨架都不用改。
 *
 * 纯 ESM；只在 createFeatures 内部 import 具体功能（模块顶层不 import react）。
 */

import { createGraphFeature } from './GraphFeature.js'

/** 关系图的图标：三个节点连成一条链（与 rail 品牌 logo 的图元区分）。 */
export function graphIcon(h) {
  return h('svg', {
    className: 'fo-nav-icon',
    width: 20,
    height: 20,
    viewBox: '0 0 20 20',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.5,
    strokeLinecap: 'round',
    strokeLinejoin: 'round',
    'aria-hidden': 'true',
  },
    h('circle', { cx: 4.6, cy: 15.4, r: 2.2 }),
    h('circle', { cx: 10, cy: 4.8, r: 2.2 }),
    h('circle', { cx: 15.4, cy: 15.4, r: 2.2 }),
    h('path', { d: 'M5.6 13.5 9 7.3' }),
    h('path', { d: 'M11 7.3l3.4 6.2' }),
    h('path', { d: 'M6.9 15.4h6.2' }),
  )
}

/** 今天只有一项；以后加功能只往这个数组里追加。 */
export function createFeatures(deps) {
  const d = deps || {}
  return [
    {
      id: 'graph',
      label: '任务关系图',
      hint: '同一目录的任务与依赖画在一张画布上',
      icon: graphIcon,
      Component: createGraphFeature(d),
    },
  ]
}

/** 按 id 取功能；id 不存在（被删/改名/坏 store）时退回第一项，永不返回 undefined。 */
export function featureById(features, id) {
  const list = Array.isArray(features) ? features.filter((row) => row && typeof row === 'object' && row.id) : []
  if (!list.length) return null
  const hit = list.find((row) => row.id === id)
  return hit || list[0]
}

/** 规整 id：给固定清单 + 当前 id，返回一个一定有效的 id（'' 表示没有功能）。 */
export function resolveFeatureId(features, id) {
  const hit = featureById(features, id)
  return hit ? hit.id : ''
}
