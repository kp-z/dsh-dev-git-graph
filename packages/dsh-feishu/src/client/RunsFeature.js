/**
 * 「运行」功能页 —— 气泡墙 + 运行概览 + 会话活跃度 + 运行时长 Top5 + 需要人看一眼。
 * 工厂组件，模块顶层不 import react。
 *
 * 数据：ctx = { tasks, stats, onOpenTask, selectedId, now, onOpenSession }
 *   - `running` / `sessionTurn` / `startedAt` / `completedAt` / `suspendedAt` 全部直接读宿主快照，
 *     不在前端猜（时长 = now - startedAt；没有 startedAt 的标「未记录开始时间」）。
 * 纯计算在 `runsView.js`，气泡在 `Bubble.js`，样式在 `dashboardStyles.js` 的 `fr-` 段。
 */

import { buildRuns } from './runsView.js'
import { createBubble, createWaterLevel } from './Bubble.js'
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
  const WaterLevel = createWaterLevel(deps)
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

    /* 布局照 adventure 首页：顶部 KPI 行（圆球 + eyebrow + 数值 + 迷你水位条）
       → 中部卡片网格（气泡墙 / 执行历史）→ 底部两块（活跃度 & 时长 / 待人工）。
       末尾两块用 spansForTail(2, cols) 分跨列，保证每一排都铺满。 */
    const tailSpans = spansForTail(2, cols || 1)
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

    /* 1) KPI 行：圆球（数字）+ eyebrow + 中文标签 + 迷你水位条（占比按「未完成任务」算） */
    const runningKpi = view.overview[0] || { value: 0, pct: 0, total: view.total }
    const kpiRow = panel(0, 'kpis', '运行概览', '分母＝未完成任务（已完成的不计入）', `${view.total} 个未完成`,
      h('div', { className: 'fr-kpi-block' },
        h('div', { className: 'fr-level' },
          h('div', { className: 'fr-level-head' },
            h('span', { className: 'fr-kpi-eyebrow fr-tone-ok' }, 'RUNNING LEVEL'),
            h('span', { className: 'fr-level-value' }, `${runningKpi.value} / ${runningKpi.total} 正在跑 · ${runningKpi.pct}%`),
          ),
          h(WaterLevel, { pct: runningKpi.pct, size: 'md', tone: 'ok', label: '运行中水位' }),
        ),
        h('div', { className: 'fr-kpis' }, view.overview.map((row) => h('div', { key: row.key, className: `fr-kpi fr-tone-${row.tone}` },
        h('span', { className: `fr-kpi-ball${row.breathing ? ' is-running' : ''}`, 'aria-hidden': 'true' }, String(row.value)),
        h('span', { className: 'fr-kpi-body' },
          h('span', { className: 'fr-kpi-eyebrow' }, row.eyebrow),
          h('span', { className: 'fr-kpi-label' }, row.label),
          h(WaterLevel, { pct: row.pct, size: 'sm', tone: row.tone, label: row.label }),
          h('span', { className: 'fr-kpi-hint' }, `${row.value} / ${row.total} · ${row.hint}`),
        ),
      ))),
      ), 'all')

    /* 2) 气泡墙：一个未完成任务一个气泡（运行中绿色 + 呼吸） */
    const wall = panel(1, 'wall', '气泡墙', '绿色在呼吸就是正在跑', `${view.total} 个气泡`,
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

    /* 3) 执行历史风格列表：头像块 + 状态点 + 标题 + 「编号 • 相对时间」+ 详情按钮 */
    const history = panel(2, 'history', '执行历史', '按最近活跃排序 · 已完成的任务不在这里', `${view.history.length} 条`,
      view.history.length
        ? h('div', { className: 'fr-rows fr-scroll' }, view.history.map((row) => h('div', { key: row.id, className: `fr-row fr-tone-${row.tone}` },
          h('span', { className: 'fr-avatar' },
            h('span', { className: 'fr-avatar-glyph' }, row.no > 0 ? String(row.no).slice(-2) : '··'),
            h('span', { className: `fr-avatar-dot${row.breathing ? ' is-running' : ''}`, 'aria-hidden': 'true' }),
          ),
          h('span', { className: 'fr-row-main' },
            h('span', { className: 'fr-row-title' }, row.title),
            h('span', { className: 'fr-row-meta' }, `${row.noText} • ${row.agoText} · ${row.label}`),
          ),
          h('button', { type: 'button', className: 'fr-row-action', title: `查看 ${row.title} 的详情`, onClick: () => select(row.id) }, '详情'),
        )))
        : h('div', { className: 'fr-empty-line' }, '没有进行中的任务'), 'all')

    const longestMax = view.longest.reduce((max, row) => Math.max(max, row.elapsed), 0)

    /* 4) 会话活跃度 / 运行时长：同一套视觉语言（eyebrow + 数值 + 水位条 + 行） */
    const rhythm = panel(3, 'rhythm', '会话活跃度 / 运行时长', '轮次分档 · 开始得早的排前面', '',
      h('div', { className: 'fr-split' },
        h('div', { className: 'fr-split-col' },
          h('span', { className: 'fr-kpi-eyebrow' }, 'TURNS'),
          h('span', { className: 'fr-mini-head' }, `${view.boundSessions} 条已绑会话`),
          h('div', { className: 'fr-mini-list' }, view.activity.map((row) => h('div', { key: row.key, className: 'fr-mini-row fr-tone-brand' },
            h('span', { className: 'fr-mini-label' }, row.label),
            h('span', { className: 'fr-mini-bar' }, h(WaterLevel, { pct: Math.round(row.ratio * 100), size: 'sm', tone: 'brand', label: row.label })),
            h('span', { className: 'fr-mini-value' }, String(row.count)),
          ))),
        ),
        h('div', { className: 'fr-split-col' },
          h('span', { className: 'fr-kpi-eyebrow' }, 'DURATION'),
          h('span', { className: 'fr-mini-head' }, view.longestUntimed ? `${view.longestUntimed} 条缺开始时间` : ''),
          h('div', { className: 'fr-mini-list' }, view.longest.map((row) => h('button', {
            key: row.id,
            type: 'button',
            className: `fr-mini-row fr-mini-row-btn fr-tone-${row.untimed ? 'idle' : 'ok'}`,
            title: `打开 ${row.title}`,
            onClick: () => select(row.id),
          },
            h('span', { className: 'fr-mini-label', title: row.title }, row.title),
            h('span', { className: 'fr-mini-bar' }, h(WaterLevel, {
              pct: row.untimed || !longestMax ? 0 : Math.max(4, Math.round((row.elapsed / longestMax) * 100)),
              size: 'sm',
              tone: row.untimed ? 'idle' : 'ok',
              label: row.title,
            })),
            h('span', { className: 'fr-mini-value' }, row.elapsedText),
          ))),
        ),
      ), tailSpans[0])

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
        : h('div', { className: 'fr-empty-line' }, '都挺健康，不用管'), tailSpans[1])

    return h('div', {
      className: 'fr-page',
      'data-empty': '0',
      'data-cols': String(cols || ''),
      'data-skipped-done': String(view.skippedDone || 0),
      ref: hostRef || undefined,
    }, kpiRow, wall, history, rhythm, alerts)
  }
}

export default createRunsFeature
