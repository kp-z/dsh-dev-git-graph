/**
 * 功能注册表（Feature Registry）
 *
 * 用户口径：「这个任务关系图应该只是其中之一的功能，以后还会有更多」。所以 rail 不是「项目树」，
 * 而是**功能导航**；关系图只是注册表里的第一项。
 *
 * 约定：
 * - `createFeatures(deps)` 返回 `[{ id, label, hint, icon, Component, SubNav? }]`：
 *   - `id`       稳定标识，落 store（键 `feature`），也是以后做深链/书签的锚点
 *   - `label`    rail 一级菜单上的文字（13px）
 *   - `hint`     一句话说明（一级项的 title）
 *   - `icon(h)`  20px 线性图标工厂（收 `h`，返回元素；不引图标字体/图片）
 *   - `SubNav`   **可选**：一级项的二级菜单组件。给了它，rail 里这一项就可展开/收起
 *                （展开态落 store 键 `nav`，默认展开），渲染时收到与功能页**同一个 ctx`。
 *   - `Component(deps)` → 组件工厂，渲染时收到一个 ctx 对象（见 OverviewPanel）
 * - rail 的导航项、正文渲染、store 里的 activeFeature **全部**从这里派生：
 *   加功能只往数组里追加一项，rail 与正文骨架都不用改（一级项数量 = 注册表长度）。
 *
 * 纯 ESM；只在 createFeatures 内部 import 具体功能（模块顶层不 import react）。
 */

import { createGraphFeature } from './GraphFeature.js'
import { createTreeNav } from './TreeNav.js'
import { createInsightFeature } from './InsightFeature.js'
import { createRunsFeature } from './RunsFeature.js'

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

/** 洞察的图标：一根柱状图 + 一条趋势线（与关系的链式图标区分）。 */
export function chartIcon(h) {
  return h('svg', {
    className: 'fo-nav-icon',
    width: 20, height: 20, viewBox: '0 0 20 20', fill: 'none',
    stroke: 'currentColor', strokeWidth: 1.5, strokeLinecap: 'round', strokeLinejoin: 'round',
    'aria-hidden': 'true',
  },
    h('path', { d: 'M3.5 16.5V9' }),
    h('path', { d: 'M8 16.5V4.5' }),
    h('path', { d: 'M12.5 16.5v-5' }),
    h('path', { d: 'M3.5 16.5h13' }),
    h('path', { d: 'M3.5 6.5l4-2.6 4 2.2 5-3.6' }),
  )
}

/** 运行的图标：一个带光晕的气泡（正在跑的会话）+ 一条基线。 */
export function bubbleIcon(h) {
  return h('svg', {
    className: 'fo-nav-icon',
    width: 20, height: 20, viewBox: '0 0 20 20', fill: 'none',
    stroke: 'currentColor', strokeWidth: 1.5, strokeLinecap: 'round', strokeLinejoin: 'round',
    'aria-hidden': 'true',
  },
    h('circle', { cx: 10, cy: 9, r: 5.2 }),
    h('circle', { cx: 10, cy: 9, r: 2 }),
    h('path', { d: 'M5.5 16.8h9' }),
  )
}

/**
 * 功能注册表：rail 一级菜单 = 这里每一项；哪一项要二级菜单就给它 `SubNav`。
 * 现在三项：关系（带范围的二级菜单）/ 洞察（全局指标）/ 运行（会话气泡墙）。
 */
export function createFeatures(deps) {
  const d = deps || {}
  const h = d.h
  const TreeNav = createTreeNav(d)
  return [
    {
      id: 'graph',
      /* 一级菜单口径（用户原话）：「当前第二列变成二级菜单，一级菜单叫关系」。 */
      label: '关系',
      hint: '同一目录的任务与依赖画在一张画布上',
      icon: graphIcon,
      /**
       * 二级菜单 = 范围树（全部任务 / 各目录 / 未分组，未分组下再列项目）。
       * 拖拽入组、右键菜单、键盘 ARIA tree 全在 TreeNav 内部，一字未改，只是换了个容器。
       */
      SubNav: (props) => {
        const ctx = props || {}
        return h('div', { className: 'fo-subnav' }, h(TreeNav, { ...(ctx.treeProps || {}), compact: true }))
      },
      Component: createGraphFeature(d),
    },
    {
      id: 'insight',
      label: '洞察',
      hint: '指标、分布、阻塞与最近动态（看全局，不跟范围走）',
      icon: chartIcon,
      Component: createInsightFeature(d),
    },
    {
      id: 'runs',
      label: '运行',
      hint: '一个任务一个气泡：绿色在呼吸就是在跑',
      icon: bubbleIcon,
      Component: createRunsFeature(d),
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
