/**
 * 「运行」功能页 —— 气泡墙 + 运行概览 + 会话活跃度 + 运行时长 Top5 + 需要人看一眼。
 * 工厂组件，模块顶层不 import react。
 *
 * 数据：ctx = { tasks, stats, onOpenTask, selectedId, now, onOpenSession }
 *   - `running` / `sessionTurn` / `startedAt` / `completedAt` / `suspendedAt` 全部直接读宿主快照，
 *     不在前端猜（时长 = now - startedAt；没有 startedAt 的标「未记录开始时间」）。
 * 纯计算在 `runsView.js`，气泡在 `Bubble.js`，样式在 `dashboardStyles.js` 的 `fr-` 段。
 */

import { buildRuns, formatDuration } from './runsView.js'
import { createBubble } from './Bubble.js'
import { injectStyles } from './dashboardStyles.js'

let styleReady = false
function ensureStyles() {
  if (styleReady) return
  styleReady = true
  try {
    injectStyles()
  } catch (error) {
    /* node 环境没有 document，样式交给宿主注入 */
  }
}

const toNum = (value) => {
  const n = Number(value)
  return Number.isFinite(n) ? n : 0
}

/** 5 个尾部面板在 cols 列里怎么跨列才能让每排都铺满（与洞察页同一套算法）。 */
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

export function createRunsFeature(deps) {
  const { React, h } = deps || {}
  const Bubble = createBubble(deps)
  const useEffect = React && typeof React.useEffect === 'function' ? React.useEffect : null
  const useRef = React && typeof React.useRef === 'function' ? React.useRef : null
  const useState = React && typeof React.useState === 'function' ? React.useState : null

  return function RunsFeature(props) {
    const ctx = props || {}
    ensureStyles()
    if (useEffect) {
      useEffect(() => { ensureStyles() }, [])
    }

    const hostRef = useRef ? useRef(null) : null
    const [colsState, setColsState] = useState ? useState(toNum(ctx.columns) || 0) : [toNum(ctx.columns) || 0, () => {}]
    const cols = Array.isArray(colsState) ? colsState[0] : colsState
    const setCols = Array.isArray(colsState) ? colsState[1] : setColsState

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

    const view = buildRuns(ctx.snapshot || ctx)
    const openSession = typeof ctx.onOpenSession === 'function' ? ctx.onOpenSession : null
    const select = (id) => { if (typeof ctx.onOpenTask === 'function') ctx.onOpenTask(id) }
    const selectedId = typeof ctx.selectedId === 'string' ? ctx.selectedId : ''

    if (view.empty) {
      return h('div', { className: 'fr-page', 'data-empty': '1' },
        h('div', { className: 'fr-empty', role: 'status' },
          h('div', { className: 'fr-empty-title' }, '还没有正在运行的任务'),
          h('div', { className: 'fr-empty-body' }, '任务同步进来、会话跑起来之后，这里会按状态长出一片气泡墙。'),
        ),
      )
    }

    const tailSpans = spansForTail(4, cols || 1)
    const panel = (index, key, title, hint, extra, body, span) => h('section', {
      key,
      className: 'fr-panel',
      'data-span': span === 'all' ? 'all' : String(span || 1),
      'aria-label': title,
      style: span === 'all' ? { '--fr-i': index } : { '--fr-i': index, gridColumn: `span ${span || 1}` },
    },
      h('div', { className: 'fr-panel-head' },
        h('span', { className: 'fr-panel-title' }, title),
        hint ? h('span', { className: 'fr-panel-hint' }, hint) : null,
        extra ? h('span', { className: 'fr-panel-extra' }, extra) : null,
      ),
      h('div', { className: 'fr-panel-body' }, body),
    )

    /* 1) 气泡墙：一个任务一个气泡，按状态分组（运行中在最前） */
    const wall = panel(0, 'wall', '气泡墙', '一个任务一个气泡 · 绿色在呼吸就是正在跑', `${view.total} 个任务`,
      h('div', { className: 'fr-groups fr-scroll' }, view.groups.map((group) => h('div', { key: group.key, className: 'fr-group' },
        h('div', { className: 'fr-group-head' },
          h('span', { className: `fr-group-dot fr-tone-${group.tone}` }),
          h('span', { className: 'fr-group-title' }, group.label),
          h('span', { className: 'fr-group-count' }, String(group.count)),
        ),
        h('div', { className: 'fr-wall' }, group.bubbles.map((bubble) => h(Bubble, {
          key: bubble.id,
          bubble,
          size: 64,
          selected: bubble.id === selectedId,
          onSelect: select,
          onOpenSession: openSession,
        }))),
      ))), 'all')

    /* 2) 运行概览：四个气泡式计数卡 */
    const overview = panel(1, 'overview', '运行概览', '', `${view.boundSessions} 条任务已绑会话`,
      h('div', { className: 'fr-stats' }, view.overview.map((row) => h('div', { key: row.key, className: `fr-stat fr-tone-${row.tone}` },
        h('span', { className: `fr-stat-ring${row.breathing ? ' is-running' : ''}` }, String(row.value)),
        h('span', { className: 'fr-stat-main' },
          h('span', { className: 'fr-stat-label' }, row.label),
          h('span', { className: 'fr-stat-hint' }, row.hint),
        ),
      ))), tailSpans[0])

    /* 3) 会话活跃度：按 sessionTurn 分档 */
    const activity = panel(2, 'activity', '会话活跃度', '按跑到第几轮分档', `已绑 ${view.boundSessions}`,
      h('div', { className: 'fr-list' }, view.activity.map((row) => h('div', { key: row.key, className: 'fr-list-row' },
        h('span', { className: 'fr-list-label' }, row.label),
        h('span', { className: 'fr-list-bar' },
          h('span', { className: 'fr-bar' }, h('i', { style: { width: `${Math.max(0, Math.round(row.ratio * 100))}%` } })),
        ),
        h('span', { className: 'fr-list-value' }, String(row.count)),
        h('span', { className: 'fr-list-meta' }, row.running ? `${row.running} 跑` : ''),
      ))), tailSpans[1])

    /* 4) 运行时长 Top5 */
    const longestMax = view.longest.reduce((max, row) => Math.max(max, row.elapsed), 0)
    const longest = panel(3, 'longest', '运行时长 Top 5', 'now − 开始时间', view.longestUntimed ? `${view.longestUntimed} 条缺开始时间` : '',
      view.longest.length
        ? h('div', { className: 'fr-list' }, view.longest.map((row) => h('button', {
          key: row.id,
          type: 'button',
          className: 'fr-item',
          title: `打开 ${row.title}`,
          onClick: () => select(row.id),
        },
          h('span', { className: 'fr-item-main' },
            h('span', { className: 'fr-item-title' }, row.title),
            h('span', { className: 'fr-item-sub' }, row.workspaceTitle),
          ),
          h('span', { className: 'fr-item-bar' },
            h('span', { className: 'fr-bar' }, h('i', { style: { width: `${row.untimed || !longestMax ? 0 : Math.max(4, Math.round((row.elapsed / longestMax) * 100))}%` } })),
          ),
          h('span', { className: 'fr-item-value' }, row.elapsedText),
        )))
        : h('div', { className: 'fr-empty-line' }, '没有在跑的任务'), tailSpans[2])

    /* 5) 需要人看一眼 */
    const alerts = panel(4, 'alerts', '需要人看一眼', '挂起中 · 前置都完成了却还标阻塞', view.alerts.length ? `${view.alerts.length} 条` : '',
      view.alerts.length
        ? h('div', { className: 'fr-alert-list fr-scroll' }, view.alerts.map((row) => h('button', {
          key: `${row.reason}:${row.id}`,
          type: 'button',
          className: `fr-item fr-tone-${row.reason === 'suspended' ? 'warn' : 'error'}`,
          title: `打开 ${row.title}`,
          onClick: () => select(row.id),
        },
          h('span', { className: 'fr-item-badge' }, row.reasonText),
          h('span', { className: 'fr-item-main' },
            h('span', { className: 'fr-item-title' }, row.title),
            h('span', { className: 'fr-item-sub' }, row.detail),
          ),
        )))
        : h('div', { className: 'fr-empty-line' }, '都挺健康，不用管'), tailSpans[3])

    return h('div', {
      className: 'fr-page',
      'data-empty': '0',
      'data-cols': String(cols || ''),
      ref: hostRef || undefined,
    }, wall, overview, activity, longest, alerts)
  }
}

export default createRunsFeature
