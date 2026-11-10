/**
 * 「洞察」功能页 —— dashboard 风格，工厂组件，模块顶层不 import react。
 *
 * 六个面板（CSS grid `repeat(auto-fit, minmax(240px, 1fr))` + `grid-auto-rows: 1fr` 填满）：
 *   1. KPI 气泡行（全宽跨列）  2. 状态分布 donut（手绘 SVG，不引图表库）
 *   3. 项目分布横条            4. 关系概览
 *   5. 阻塞榜 Top5             6. 最近动态三列
 *
 * 数据全部来自 ctx（与关系图功能同一份快照）：{ tasks, relations, groups, workspaces, stats,
 * onOpenTask, selectedId }；纯计算在 `insightView.js` 的 `buildInsight`，这里只做渲染。
 * 样式在 `dashboardStyles.js`（`fd-` 前缀），组件首次渲染时幂等注入一次。
 */

import { buildInsight } from './insightView.js'
import { injectStyles } from './dashboardStyles.js'

const R = 52
const TAU = Math.PI * 2
const BOX = 132
const CENTER = BOX / 2
const CIRC = TAU * R

const toNum = (value) => {
  const n = Number(value)
  return Number.isFinite(n) ? n : 0
}

let styleReady = false

function ensureStyles() {
  if (styleReady) return
  styleReady = true
  try {
    injectStyles()
  } catch (error) {
    /* 没有 document（node 单测环境）时静默跳过，样式交给宿主注入 */
  }
}

/**
 * 5 个尾部面板在 cols 列里怎么跨列，才能让**最后一行也铺满**（不留空洞）。
 * count=5, cols=4 → [4]（最后一格整行）；cols=3 → [2,1]；cols=6 → [2,1,1,1,1]。
 */
export function spansForTail(count, cols) {
  const n = Math.max(1, Math.floor(Number(count) || 1))
  const c = Math.max(1, Math.floor(Number(cols) || 1))
  const spans = new Array(n).fill(1)
  const rem = n % c
  if (!rem) return spans
  const base = Math.floor(c / rem)
  let extra = c - base * rem
  for (let i = n - rem; i < n; i += 1) {
    spans[i] = base + (extra > 0 ? 1 : 0)
    if (extra > 0) extra -= 1
  }
  return spans
}

export function createInsightFeature(deps) {
  const { React, h } = deps || {}
  const useEffect = React && typeof React.useEffect === 'function' ? React.useEffect : null
  const useRef = React && typeof React.useRef === 'function' ? React.useRef : null
  const useState = React && typeof React.useState === 'function' ? React.useState : null

  function Donut(view) {
    const total = view.totals.tasks
    let offset = 0
    const arcs = view.statusMix.filter((row) => row.count > 0).map((row) => {
      const len = total > 0 ? (row.count / total) * CIRC : 0
      const arc = { key: row.key, len, offset, tone: row.tone }
      offset += len
      return arc
    })
    return h('div', { className: 'fd-donut' },
      h('svg', { className: 'fd-donut-svg', viewBox: `0 0 ${BOX} ${BOX}`, role: 'img', 'aria-label': `状态分布：共 ${total} 个任务` },
        h('circle', { className: 'fd-donut-track', cx: CENTER, cy: CENTER, r: R }),
        h('g', { transform: `rotate(-90 ${CENTER} ${CENTER})` }, arcs.map((arc) => h('circle', {
          key: arc.key,
          className: `fd-donut-arc fd-tone-${arc.tone}`,
          cx: CENTER,
          cy: CENTER,
          r: R,
          strokeDasharray: `${Math.max(0, arc.len)} ${Math.max(0, CIRC - arc.len)}`,
          strokeDashoffset: -arc.offset,
        }))),
        h('text', { className: 'fd-donut-center', x: CENTER, y: CENTER + 2, textAnchor: 'middle' }, String(total)),
        h('text', { className: 'fd-donut-caption', x: CENTER, y: CENTER + 18, textAnchor: 'middle' }, '任务'),
      ),
      h('div', { className: 'fd-legend' }, view.statusMix.map((row) => h('div', { key: row.key, className: `fd-legend-row fd-tone-${row.tone}` },
        h('span', { className: 'fd-legend-dot', 'aria-hidden': 'true' }),
        h('span', { className: 'fd-legend-label' }, row.label),
        h('span', { className: 'fd-legend-value' }, String(row.count)),
        h('span', { className: 'fd-legend-pct' }, `${row.pct}%`),
      ))),
    )
  }

  function openTask(ctx, id) {
    if (typeof ctx.onOpenTask === 'function' && id) ctx.onOpenTask(id)
  }

  return function InsightFeature(props) {
    const ctx = props || {}
    ensureStyles()
    if (useEffect) {
      useEffect(() => { ensureStyles() }, [])
    }
    /* 实测列数：auto-fit 用 minmax(240px,1fr)+gap 12，宽 w 时列数 = floor((w+12)/252)。
       ctx.columns 可显式给（静态自测页/测试用），否则用 ResizeObserver 量。 */
    const hostRef = useRef ? useRef(null) : null
    const [cols, setColsState] = useState ? useState(toNum(ctx.columns) || 0) : [toNum(ctx.columns) || 0, () => {}]
    const setCols = typeof setColsState === 'function' ? setColsState : (setColsState && setColsState[1]) || (() => {})
    if (useEffect) {
      useEffect(() => {
        if (toNum(ctx.columns)) return undefined
        const el = hostRef && hostRef.current
        if (!el || typeof ResizeObserver !== 'function') return undefined
        const compute = (width) => {
          const next = Math.max(1, Math.min(6, Math.floor((width + 12) / 252)))
          if (next > 0) setCols((prev) => (prev === next ? prev : next))
        }
        compute(el.getBoundingClientRect().width)
        const ro = new ResizeObserver((entries) => {
          for (const entry of entries) compute(entry.contentRect ? entry.contentRect.width : 0)
        })
        ro.observe(el)
        return () => ro.disconnect()
      }, [])
    }
    const view = buildInsight(ctx.snapshot || ctx)

    if (view.empty) {
      return h('div', { className: 'fd-page', 'data-empty': '1' },
        h('div', { className: 'fd-empty', role: 'status' },
          h('div', { className: 'fd-empty-title' }, '还没有任务可以洞察'),
          h('div', { className: 'fd-empty-body' }, '等飞书任务同步进来，这里会自动长出指标、分布与榜单。'),
        ),
      )
    }

    const tailSpans = spansForTail(5, cols || 1)
    const panel = (index, key, title, hint, extra, body, span) => h('section', {
      key,
      className: 'fd-panel',
      'data-span': span === 'all' ? 'all' : String(span || 1),
      'aria-label': title,
      style: span === 'all' ? { '--fd-i': index } : { '--fd-i': index, gridColumn: `span ${span || 1}` },
    },
      h('div', { className: 'fd-panel-head' },
        h('span', { className: 'fd-panel-title' }, title),
        hint ? h('span', { className: 'fd-panel-hint' }, hint) : null,
        extra ? h('span', { className: 'fd-panel-extra' }, extra) : null,
      ),
      h('div', { className: 'fd-panel-body' }, body),
    )

    /* 1) KPI 气泡行 */
    const kpis = panel(0, 'kpi', '关键指标', `共 ${view.totals.tasks} 个任务`, view.totals.running ? `${view.totals.running} 个会话在跑` : '',
      h('div', { className: 'fd-kpis' }, view.kpis.map((kpi) => h('div', { key: kpi.id, className: `fd-kpi fd-tone-${kpi.tone}` },
        h('span', { className: 'fd-kpi-bubble' }, kpi.text),
        h('span', { className: 'fd-kpi-main' },
          h('span', { className: 'fd-kpi-label' }, kpi.label),
          h('span', { className: 'fd-bar', role: 'presentation' }, h('i', { style: { width: `${Math.round(kpi.ratio * 100)}%` } })),
          h('span', { className: 'fd-kpi-note' }, kpi.note || ''),
        ),
      ))), 'all')

    /* 2) 状态分布 donut */
    const donut = panel(1, 'status', '状态分布', '互斥四桶，和恰好 100%', '', Donut(view), tailSpans[0])

    /* 3) 项目分布 */
    const workspaces = panel(2, 'projects', '项目分布', `Top 8${view.workspaces.length > 8 ? ' + 其他' : ''}`, `${view.projectCount} 个项目`,
      h('div', { className: 'fd-list fd-scroll' }, view.workspaces.map((row) => h('div', {
        key: row.key,
        className: 'fd-list-row',
        /* 项目分色：insightView 算好的 deco 指到 --fo-deco-N（与画布上同一个色板），
           不要用 fd-tone-*（那是状态色调，项目行没有 tone，会拿到 fd-tone-undefined → 全部回退品牌色）。 */
        style: { '--fd-tone': `var(--fo-deco-${row.deco}, var(--dsw-alias-brand-primary))` },
      },
        h('span', { className: 'fd-list-label', title: row.label }, row.label),
        h('span', { className: 'fd-list-bar' },
          h('span', { className: 'fd-bar-split' },
            h('i', { style: { width: `${Math.max(2, Math.round(row.share * 100))}%` } }),
            h('b', { style: { width: `${Math.max(0, Math.round(row.share * row.ratio * 100))}%` } }),
          ),
        ),
        h('span', { className: 'fd-list-value' }, `${row.done}/${row.total}`),
        h('span', { className: 'fd-list-meta' }, `${row.pct}%`),
      ))), tailSpans[1])

    /* 4) 关系概览 */
    const relations = panel(3, 'relations', '关系概览', '', `${view.relations.total} 条关系`,
      h('div', { className: 'fd-kv' }, view.relations.rows.map((row) => h('div', { key: row.key, className: `fd-kv-item fd-tone-${row.tone}` },
        h('span', { className: 'fd-kv-label' }, row.label),
        h('span', { className: 'fd-kv-value' }, String(row.value)),
        h('span', { className: 'fd-kv-hint', title: row.hint }, row.hint),
      ))), tailSpans[2])

    /* 5) 阻塞榜 Top5 */
    const blockers = panel(4, 'blockers', '阻塞榜', '按「等几个」排序', view.blockers.length ? `Top ${view.blockers.length}` : '',
      view.blockers.length
        ? h('div', { className: 'fd-list fd-scroll' }, view.blockers.map((row) => h('button', {
          key: row.id,
          type: 'button',
          className: 'fd-item fd-tone-danger',
          title: `打开 ${row.title}`,
          onClick: () => openTask(ctx, row.id),
        },
          h('span', { className: 'fd-item-rank' }, String(row.rank)),
          h('span', { className: 'fd-item-main' },
            h('span', { className: 'fd-item-title' }, row.title),
            h('span', { className: 'fd-item-sub' }, `等 ${row.waitingText}`),
          ),
          h('span', { className: 'fd-item-badge' }, `${row.count} 个`),
        )))
        : h('div', { className: 'fd-empty-line' }, '没有被阻塞的任务 🎉'), tailSpans[3])

    /* 6) 最近动态 */
    const recentCol = (key, label, rows) => h('div', { key, className: 'fd-recent-col' },
      h('div', { className: 'fd-recent-title' }, label),
      rows.length
        ? rows.map((row) => h('button', {
          key: row.id,
          type: 'button',
          className: 'fd-item',
          title: `打开 ${row.title}`,
          onClick: () => openTask(ctx, row.id),
        },
          row.running ? h('span', { className: 'fd-live-dot', 'aria-label': '运行中' }) : null,
          h('span', { className: 'fd-item-main' },
            h('span', { className: 'fd-item-title' }, row.title),
            h('span', { className: 'fd-item-sub' }, [row.atText, row.workspaceTitle].filter(Boolean).join(' · ') || (row.no ? `#${row.no}` : '')),
          ),
        ))
        : h('div', { className: 'fd-empty-line' }, '暂无'),
    )
    const recent = panel(5, 'recent', '最近动态', `按${view.recent.orderBy}`, '',
      h('div', { className: 'fd-recent' },
        recentCol('done', '最近完成', view.recent.done),
        recentCol('started', '最近开始', view.recent.started),
        recentCol('suspended', '最近挂起', view.recent.suspended),
      ), tailSpans[4])

    return h('div', {
      className: 'fd-page',
      'data-empty': '0',
      'data-cols': String(cols || ''),
      ref: hostRef || undefined,
    }, kpis, donut, workspaces, relations, blockers, recent)
  }
}

export default createInsightFeature
