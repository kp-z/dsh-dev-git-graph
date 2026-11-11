/**
 * 「运行」功能页 —— **按参考项目 kp-z/open_adventure 的 Dashboard 页面重排**。
 *
 * 用户口径（原话）：「整个运行页面的卡片布局样式和大小都不对」「风格要和参考项目完全一致」。
 * 所以这一页不再是令牌调色出来的「像」，而是：
 *   - 布局抄 `pages/Dashboard.tsx`：space-y-8 + 4 列网格 + 状态卡跨 2 列 + 两张数字卡 + 历史卡 + 快捷操作；
 *   - 卡片抄 `components/ui-shared.tsx` 的 GlassCard：bg-white/5 + backdrop-blur-md + border-white/10
 *     + rounded-2xl(16px) + p-6(24px) + shadow-xl；
 *   - 气泡抄 `ClaudeModelBubbles.tsx` + `WaterLevel.tsx`：散点位、float 漂浮、圆内水位（SVG 裁剪 + 波浪线）；
 *   - 样式集中在 `runsExactStyles.js`（`.frx-` 前缀、独立 style id，颜色按参考项目原值）。
 *
 * 数据：ctx = { tasks, stats, onOpenTask, selectedId, now, onOpenSession }
 * 纯计算仍在 `runsView.js`（含「已完成任务不上页」的入口过滤）。
 */

import { buildRuns } from './runsView.js'
import { injectExactStyles } from './runsExactStyles.js'
import { iconDrawNodes, normalizeIcon, colorHex, autoIconFor } from './projectIcons.js'

let styleReady = false
function ensureStyles() {
  if (styleReady) return
  styleReady = true
  try {
    injectExactStyles()
  } catch (error) {
    /* node 环境没有 document */
  }
}

/* 模块加载时就注入一次：组件首次渲染前样式就已经在 <head> 里，
   避免「首帧白方块闪一下」；渲染时再兜一次（宿主可能清过 head）。 */
ensureStyles()

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
  const useEffect = React && typeof React.useEffect === 'function' ? React.useEffect : null
  const useRef = React && typeof React.useRef === 'function' ? React.useRef : null
  const useState = React && typeof React.useState === 'function' ? React.useState : null

  /* 参考项目的气泡坐标表（DASHBOARD_POSITIONS 原值） */
  /* 参考项目的 8 个散点位，但**往中心收了一档**（top/left 各向 50% 压缩 22%）。
     原因：参考卡只占 4 列网格的 2 列（~520px），我们这块面板更宽，照抄会显得「四周大片空白」；
     收一档后仍保持「星座式、不重叠」的观感，但成簇感更强。 */
  const compress = (pct) => `${Math.round(50 + (Number.parseFloat(pct) - 50) * 0.78)}%`
  const RAW_POSITIONS = [
    { size: 55, top: '8%', left: '75%' },
    { size: 52, top: '10%', left: '28%' },
    { size: 48, top: '50%', left: '12%' },
    { size: 45, top: '18%', left: '50%' },
    { size: 38, top: '58%', left: '60%' },
    { size: 35, top: '55%', left: '85%' },
    { size: 32, top: '65%', left: '35%' },
    { size: 28, top: '15%', left: '8%' },
  ]
  const POSITIONS = RAW_POSITIONS.map((pos) => ({ ...pos, top: compress(pos.top), left: compress(pos.left) }))
  const MAX_ORBS = 8
  /* 极简标记 → SVG 标签（图标数据为了体积压缩过标签名） */
  const TAG_MAP = { p: 'path', c: 'circle', r: 'rect', l: 'line', pl: 'polyline', pg: 'polygon' }

  /** 图标（内联 SVG，不引图标库；参考项目用的是 lucide） */
  const icon = (name, size) => {
    const s = size || 20
    const common = { width: s, height: s, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round' }
    const paths = {
      activity: [h('path', { key: 'a', d: 'M22 12h-4l-3 9L9 3l-3 9H2' })],
      cpu: [h('rect', { key: 'a', x: 4, y: 4, width: 16, height: 16, rx: 2 }), h('rect', { key: 'b', x: 9, y: 9, width: 6, height: 6 })],
      code: [h('path', { key: 'a', d: 'm16 18 6-6-6-6' }), h('path', { key: 'b', d: 'm8 6-6 6 6 6' })],
      plus: [h('path', { key: 'a', d: 'M5 12h14' }), h('path', { key: 'b', d: 'M12 5v14' })],
      refresh: [h('path', { key: 'a', d: 'M21 12a9 9 0 1 1-3-6.7' }), h('path', { key: 'b', d: 'M21 3v6h-6' })],
      terminal: [h('path', { key: 'a', d: 'm4 17 6-6-6-6' }), h('path', { key: 'b', d: 'M12 19h8' })],
    }
    return h('svg', common, paths[name] || paths.activity)
  }

  /**
   * 气泡 = **一个内联 SVG**。
   *
   * 为什么不用 CSS 画圆：宿主对 `div/button/span` 都可能带通用圆角或内边距规则，
   * `border-radius: 50%` 在不同宿主里被压掉过好几次（用户连续三次看到「圆角方块」）。
   * SVG 的 <circle> 是几何图元 —— 只要 viewBox 是正方形，它就是正圆，没有「被样式覆盖」这回事。
   *
   * 一层 SVG 里画完：底色圆 + 描边 + 球面高光（radialGradient）+ 水位（clipPath + 矩形 + 波浪线）+ 数字（<text>）。
   */
  /**
   * 圆内内容：项目图标（Lucide 节点）/ Emoji / 任务编号，三选一。
   * 项目配了颜色就用到图标描边（emoji 无法上色，靠气泡描边表达）。
   */
  const orbInner = (o) => {
    const icon = String(o.icon || '')
    if (icon.startsWith('emoji:')) {
      return h('text', { x: 50, y: 53, textAnchor: 'middle', dominantBaseline: 'central', fontSize: 50, fill: 'currentColor' }, icon.slice(6))
    }
    const nodes = iconDrawNodes(icon)
    if (nodes && nodes.length) {
      return h('g', {
        /* 图标只占圆内约 1/3（32/100）：之前 54 太大，圆里显得糊 */
        transform: `translate(34 34) scale(${(32 / 24).toFixed(4)})`,
        fill: 'none',
        stroke: o.tint || 'var(--dsw-alias-label-primary)',
        strokeWidth: (2 / (32 / 24)).toFixed(3),
        strokeLinecap: 'round', strokeLinejoin: 'round',
      }, nodes.map((node, i) => h(TAG_MAP[node.tag] || 'path', { key: i, ...node.attrs })))
    }
    return h('text', {
      x: 50, y: 50, textAnchor: 'middle', dominantBaseline: 'central',
      fontSize: String(o.label || '').length > 3 ? 20 : 24, fontWeight: 700,
      fill: 'var(--dsw-alias-label-primary)',
      style: { fontVariantNumeric: 'tabular-nums', letterSpacing: '0.02em' },
    }, o.label || '')
  }

  const orbSvg = (opts) => {
    const o = opts || {}
    const size = Math.max(24, Number(o.size) || 48)
    const pct = Math.max(0, Math.min(100, Number(o.percent) || 0))
    const running = o.running === true
    const suspended = o.suspended === true
    const label = String(o.label || '')
    const uid = `o${String(o.id || 'x').replace(/[^a-zA-Z0-9]/g, '')}`
    const R = 46
    const lineY = 100 - (pct / 100) * (R * 2)   // viewBox 100 单位下的水位线
    const wave1 = `M0,${lineY} Q25,${lineY - 2} 50,${lineY} T100,${lineY}`
    const wave2 = `M0,${lineY} Q25,${lineY + 2} 50,${lineY} T100,${lineY}`
    /* 颜色：运行=绿、挂起=琥珀、未开始=中性灰。用 CSS 变量 + 兜底值，亮暗都能看。 */
    const stroke = running
      ? 'color-mix(in oklab, var(--dsw-alias-state-success-primary) 55%, transparent)'
      : (suspended ? 'color-mix(in oklab, var(--dsw-alias-state-warn-primary) 52%, transparent)' : 'color-mix(in oklab, var(--dsw-alias-label-secondary) 78%, transparent)')
    const fill = running
      ? 'color-mix(in oklab, var(--dsw-alias-bg-layer-2) 96%, transparent)'
      : 'color-mix(in oklab, var(--dsw-alias-bg-layer-1) 92%, transparent)'
    const glow = running ? 'color-mix(in oklab, var(--dsw-alias-state-success-primary) 30%, transparent)' : 'transparent'
    const waterFill = 'color-mix(in oklab, var(--dsw-alias-state-success-primary) 46%, transparent)'
    const waterStroke = 'color-mix(in oklab, var(--dsw-alias-state-success-primary) 96%, transparent)'
    return h('svg', {
      key: 'orb',
      width: size, height: size, viewBox: '0 0 100 100',
      'aria-hidden': 'true', focusable: 'false',
      style: { display: 'block', overflow: 'visible' },
    },
      h('defs', null,
        h('radialGradient', { id: `${uid}-shine`, cx: '32%', cy: '26%', r: '42%' },
          h('stop', { offset: '0%', stopColor: 'var(--dsw-alias-label-primary)', stopOpacity: 0.5 }),
          h('stop', { offset: '60%', stopColor: 'var(--dsw-alias-label-primary)', stopOpacity: 0.08 }),
          h('stop', { offset: '100%', stopColor: 'var(--dsw-alias-label-primary)', stopOpacity: 0 })),
        h('clipPath', { id: `${uid}-clip` }, h('circle', { cx: 50, cy: 50, r: R - 2 }))),
      /* 外发光：运行中才画，用一圈半透明粗描边模拟（不依赖 box-shadow） */
      running ? h('circle', { cx: 50, cy: 50, r: R + 2, fill: 'none', stroke: glow, strokeWidth: 8, opacity: 0.55 }) : null,
      /* 底色圆 + 描边：几何即圆形 */
      h('circle', { cx: 50, cy: 50, r: R, fill, stroke, strokeWidth: 2 }),
      /* 球面高光（在水位之前画：水位是主体信息，不能被高光糊掉） */
      h('circle', { cx: 50, cy: 50, r: R, fill: `url(#${uid}-shine)`, opacity: 0.9 }),
      /* 水位（裁剪在圆内） */
      running
        ? h('g', { clipPath: `url(#${uid}-clip)` },
          h('rect', { x: 0, y: lineY, width: 100, height: Math.max(0, 100 - lineY), fill: waterFill }),
          h('path', { d: wave1, fill: 'none', stroke: waterStroke, strokeWidth: 2.5 },
            h('animate', { attributeName: 'd', dur: '3s', repeatCount: 'indefinite', values: `${wave1};${wave2};${wave1}` })))
        : null,
      /* 数字：SVG 文本，text-anchor + dominant-baseline 严格居中 */
      /* 圆内内容：项目图标 / emoji / 任务编号 */
      orbInner({ icon: o.icon || '', tint: o.tint || '', label }),
    )
  }

  /** 圆内水位（WaterLevel.tsx 的搬运：clipPath 圆裁剪 + 填充矩形 + SMIL 波浪线） */
  const waterLevel = (percent, size, seed) => {
    const pct = Math.max(0, Math.min(100, Number(percent) || 0))
    const lineY = size - (pct / 100) * size
    const r = size / 2 - 2
    const clipId = `frx-clip-${seed}`
    const waveId = `frx-wave-${seed}`
    const d1 = `M0,${lineY} Q${size * 0.25},${lineY - 2} ${size * 0.5},${lineY} T${size},${lineY}`
    const d2 = `M0,${lineY} Q${size * 0.25},${lineY + 2} ${size * 0.5},${lineY} T${size},${lineY}`
    return [
      h('svg', { key: 'fill', className: 'frx-water is-fill', viewBox: `0 0 ${size} ${size}`, focusable: 'false', 'aria-hidden': 'true' },
        h('defs', null, h('clipPath', { id: clipId }, h('circle', { cx: size / 2, cy: size / 2, r }))),
        h('rect', { className: 'frx-water-liquid', x: 0, y: lineY, width: size, height: Math.max(0, size - lineY), clipPath: `url(#${clipId})` })),
      h('svg', { key: 'wave', className: 'frx-water is-wave', viewBox: `0 0 ${size} ${size}`, focusable: 'false', 'aria-hidden': 'true' },
        h('defs', null, h('clipPath', { id: waveId }, h('circle', { cx: size / 2, cy: size / 2, r }))),
        h('g', { clipPath: `url(#${waveId})` },
          h('path', { className: 'frx-water-wave', d: d1, strokeWidth: 2, fill: 'none' },
            h('animate', { attributeName: 'd', dur: '3s', repeatCount: 'indefinite', values: `${d1};${d2};${d1}` })))),
    ]
  }

  return function RunsFeature(props) {
    const ctx = props || {}
    ensureStyles()
    if (useEffect) {
      useEffect(() => {
        /* 宿主热重载/主题切换可能会替换 head：挂载后再确认一次样式还在 */
        try {
          if (typeof document !== 'undefined' && !document.getElementById('dsh-feishu-runs-exact-style')) injectExactStyles()
        } catch (error) { /* 忽略 */ }
      }, [])
    }

    const hostRef = useRef ? useRef(null) : null
    const [colState, setColState] = useState ? useState(toNum(ctx.columns) || 0) : [toNum(ctx.columns) || 0, () => {}]
    const cols = Array.isArray(colState) ? colState[0] : colState
    const setCols = Array.isArray(colState) ? colState[1] : setColState
    const [hoverState, setHoverState] = useState ? useState(null) : [null, () => {}]
    const hoveredId = Array.isArray(hoverState) ? hoverState[0] : hoverState
    const setHoveredId = Array.isArray(hoverState) ? hoverState[1] : setHoverState

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
    /* 项目图标（纯本地配置，宿主快照 workspaces[].logo 带下来）。
       气泡是 SVG，所以这里拿的是**路径数据**，不是 DOM 元素。 */
    const logoMap = (() => {
      const map = new Map()
      const rows = Array.isArray((ctx.snapshot || ctx).workspaces) ? (ctx.snapshot || ctx).workspaces : []
      rows.forEach((row) => {
        const icon = normalizeIcon(row && row.logo)
        if (icon && row && row.key) map.set(String(row.key), { icon, color: colorHex(row.logoColor) })
      })
      return map
    })()
    /* 手动配置优先；没配就按项目名自动推一个（确定性），保证气泡开箱就能看出是哪个项目 */
    const logoFor = (key, title) => {
      const manual = logoMap.get(String(key || ''))
      if (manual && manual.icon) return manual
      const auto = autoIconFor(title || '')
      if (!auto.icon) return manual || null
      return { icon: auto.icon, color: (manual && manual.color) || colorHex(auto.color) }
    }
    const openSession = typeof ctx.onOpenSession === 'function' ? ctx.onOpenSession : null
    const select = (id) => { if (typeof ctx.onOpenTask === 'function') ctx.onOpenTask(id) }

    /* 气泡：只放未完成任务（runsView 已过滤 done）。排在前面的拿参考表里更大的点：
       运行中优先、其次跑得久的 —— 大小天然表达紧迫度。 */
    const rank = (row) => (row.state === 'running' ? 0 : (row.state === 'suspended' ? 1 : (row.state === 'idle' ? 3 : 2)))
    /* 气泡只放「活着且在跑/待跑」的：挂起 = 暂时不做，不占气泡墙（用户在运行页看到挂起的
       「车位」任务会以为是多出来的）。挂起仍会出现在 KPI 与「需要人看一眼」里。 */
    const wallRows = view.bubbles.filter((row) => row.state !== 'suspended')
    const orbRows = wallRows.slice().sort((a, b) => {
      const diff = rank(a) - rank(b)
      if (diff !== 0) return diff
      return (Number(b.elapsed) || 0) - (Number(a.elapsed) || 0)
    }).slice(0, MAX_ORBS)
    const maxElapsed = orbRows.reduce((max, row) => Math.max(max, Number(row.elapsed) || 0), 0)

    const card = (key, opts) => {
      const o = opts || {}
      return h('section', {
        key,
        className: `frx-card${o.span2 ? ' is-span2' : ''}`,
        'aria-label': o.label || '',
        /* 关键几何写进内联样式：插件样式表在宿主里万一没注入（或被宿主 button/card 规则压掉），
           页面也不会塌成「一堆白方块」。外链样式只负责细节。 */
        style: { gridColumn: o.span2 ? 'span 2' : 'auto' },
      },
        h('div', { className: 'frx-card-glow', 'aria-hidden': 'true' }),
        h('div', { className: 'frx-card-inner' }, o.children))
    }

    /* 空态：与参考项目一致的卡片壳子，不画图 */
    const emptyCard = h('div', { className: 'frx-page', 'data-empty': '1' },
      h('div', { className: 'frx-grid', style: { height: 'auto' } },
        card('empty', { span2: true, label: '运行状态', children: [
          h('div', { key: 'head', className: 'frx-card-head' },
            h('div', { className: 'frx-card-head-left' },
              h('div', { className: 'frx-icon is-idle' }, icon('activity', 24)),
              h('div', { key: 't' },
                h('h2', { className: 'frx-card-title' }, '运行状态'),
                h('p', { className: 'frx-card-sub is-idle' }, '没有未完成的任务'))),
          ),
          h('p', { key: 'body', className: 'frx-subtitle' }, '任务同步进来、会话跑起来之后，这里会按状态长出一片气泡墙。'),
        ] })))

    if (view.empty) return h('div', { ref: hostRef }, emptyCard)

    const runningList = view.bubbles.filter((row) => row.state === 'running')
    const unfinished = view.bubbles.length
    const suspendedCount = view.bubbles.filter((row) => row.state === 'suspended').length
    const bindSessions = view.boundSessions || 0

    /* ---------- 卡片 1：运行状态（参考项目的 Claude CLI Status，跨 2 列） ---------- */
    const statusCard = card('status', {
      span2: true,
      label: '运行状态',
      children: [
        h('div', { key: 'head', className: 'frx-card-head' },
          h('div', { className: 'frx-card-head-left' },
            h('div', { className: `frx-icon ${runningList.length ? 'is-ok' : 'is-idle'}` }, icon('activity', 24)),
            h('div', { key: 'tt' },
              h('h2', { className: 'frx-card-title' }, '运行状态'),
              h('p', { className: `frx-card-sub ${runningList.length ? 'is-ok' : 'is-idle'}` },
                runningList.length ? '会话正在跑 · 实时同步' : '空闲 · 等待任务开工'))),
          h('div', { key: 'right', style: { display: 'flex', alignItems: 'center', gap: '8px', flex: '0 0 auto' } },
            h('div', { className: 'frx-version' },
              h('p', { className: 'frx-version-label' }, '未完成'),
              h('p', { className: 'frx-version-value' }, `${unfinished} 条`)),
            h('button', {
              type: 'button', className: 'frx-icon-btn', title: '刷新快照',
              onClick: () => { if (typeof ctx.onRefresh === 'function') ctx.onRefresh() },
            }, icon('refresh', 16)))),
        /* AVAILABLE MODELS → 可用任务 */
        h('div', { key: 'bubbles' },
          h('p', { className: 'frx-bubbles-label' }, '可用任务'),
          orbRows.length
            ? h('div', {
              className: 'frx-bubbles',
              role: 'list',
              'aria-label': '任务气泡墙',
              style: { position: 'relative', width: '100%', maxWidth: '430px', height: '112px', margin: '4px auto 0' },
            },
              orbRows.map((row, index) => {
                const pos = POSITIONS[index]
                const isRunning = row.state === 'running'
                const isSuspended = row.state === 'suspended'
                const canOpen = Boolean(row.sessionId)
                /* 只有一套颜色语义：绿=在跑、琥珀边=挂起、灰=未开始。
                   参考项目里「蓝=当前模型」是模型的「选中」概念，任务里没有对应物，
                   硬套会让「绿光气泡」和上方 KPI 的绿色对不上（用户实测指出的问题）。 */
                const tone = isRunning ? 'is-ok' : (isSuspended ? 'is-suspended' : 'is-dim')
                const pct = maxElapsed > 0 && isRunning ? Math.round(((Number(row.elapsed) || 0) / maxElapsed) * 100) : 0
                const meta = [row.title || '', isRunning ? '运行中' : (isSuspended ? '挂起' : '未开始'),
                  row.elapsedText && row.elapsedText !== '—' ? row.elapsedText : ''].filter(Boolean).join(' · ')
                return h('div', {
                  key: row.id,
                  className: 'frx-orb-slot',
                  role: 'listitem',
                  'data-state': row.state,
                  'data-id': String(row.id),
                  style: {
                    /* position 必须内联：这条规则只写在样式表里，样式表一旦没生效，
                       slot 就退回普通块级元素（宽度=整行、高度自动），
                       里面那个 50% 圆角的 button 就被拉成「圆角矩形」——正是用户看到的方块。 */
                    position: 'absolute',
                    top: pos.top, left: pos.left, width: `${pos.size}px`, height: `${pos.size}px`,
                    animation: `frx-float ${(3 + index * 0.5).toFixed(1)}s ease-in-out infinite`,
                    animationDelay: `${(index * 0.3).toFixed(1)}s`,
                  },
                },
                  /* 视觉：一层内联 SVG（正圆是几何，不是 CSS 圆角）；交互：覆在上面的透明 button。 */
                  orbSvg({
                    size: pos.size,
                    percent: pct,
                    running: isRunning,
                    suspended: isSuspended,
                    label: String(row.no || '').slice(-4) || String(row.id).slice(-3),
                    icon: (logoFor(row.workspaceKey, row.workspaceTitle) || {}).icon || '',
                    /* 用户口径：图标就用正常文字色，不要彩色的（彩图标太跳）。 */
                    tint: '',
                    id: row.id,
                  }),
                  h('button', {
                    type: 'button',
                    className: 'frx-orb-hit',
                    title: meta,
                    'aria-label': meta,
                    style: {
                      position: 'absolute', inset: 0, width: '100%', height: '100%',
                      borderRadius: '50%', padding: 0, margin: 0, border: 'none',
                      background: 'transparent', color: 'transparent', cursor: 'pointer',
                    },
                    onMouseEnter: () => { if (typeof setHoveredId === 'function') setHoveredId(row.id) },
                    onMouseLeave: () => { if (typeof setHoveredId === 'function') setHoveredId(null) },
                    /* 单击就跳会话（用户口径）：有绑定会话的泡点一下直接切过去；
                       没绑会话的泡退化成「选中并看详情」，不留死点。 */
                    onClick: () => {
                      if (canOpen && openSession) openSession(row.sessionId, row.title)
                      else select(row.id)
                    },
                  }),
                  hoveredId === row.id
                    ? h('span', {
                      className: 'frx-orb-tip',
                      role: 'tooltip',
                      /* 靠右的气泡把浮层往左拉、靠左的往右拉：卡片是 overflow:hidden，
                         否则最外侧的浮层还会被卡片边裁掉。 */
                      style: {
                        transform: `translateX(${(() => {
                          const left = Number.parseFloat(pos.left) || 50
                          if (left > 55) return -85
                          if (left < 15) return -15
                          return -50
                        })()}%)`,
                      },
                    },
                      h('span', { className: 'frx-orb-tip-name' }, row.title || ''),
                      h('span', { className: 'frx-orb-tip-meta' },
                        `${isRunning ? '运行中' : (isSuspended ? '挂起' : '未开始')}${pct > 0 ? ` · 水位 ${pct}%` : ''}`),
                      h('span', { className: 'frx-orb-tip-hint' }, canOpen ? '单击打开会话' : '没有绑定会话 · 单击看详情'))
                    : null)
              }))
            : h('p', { className: 'frx-subtitle' }, '没有未完成的任务')),
        /* Health Score / Status → 运行中 / 阻塞 */
        h('div', { key: 'boxes', className: 'frx-boxes' },
          h('div', { className: 'frx-box' },
            h('p', { className: 'frx-box-label' }, '运行中'),
            h('p', { className: 'frx-box-value is-green' }, String(runningList.length),
              h('span', { className: 'frx-box-unit' }, '条'))),
          h('div', { className: 'frx-box' },
            h('p', { className: 'frx-box-label' }, '已绑会话'),
            h('p', { className: 'frx-box-value is-purple' }, String(bindSessions),
              h('span', { className: 'frx-box-unit' }, '条')))),
      ],
    })

    /* ---------- 卡片 2：未完成任务（参考项目的 Total Skills） ---------- */
    const totalCard = card('total', {
      label: '未完成任务',
      children: [
        h('div', { key: 'bigrow', className: 'frx-bigrow' },
          h('div', { className: 'frx-chip is-blue' }, icon('cpu', 20)),
          h('span', { className: 'frx-delta is-up' }, `${runningList.length} 在跑`)),
        h('div', { key: 'stat', style: { marginTop: 'auto' } },
          h('p', { className: 'frx-stat-label' }, '未完成任务'),
          h('p', { className: 'frx-stat-value' }, String(unfinished))),
        /* 按项目分布：横向条 + 名称 + 条数。比「一排没有坐标的柱子」有信息量，
           也把这张卡的下半部分填满（用户口径：一行里不要留大片空白）。 */
        h('div', { key: 'chart', className: 'frx-bydist' },
          (() => {
            const counts = new Map()
            view.bubbles.forEach((row) => {
              const key = row.workspaceTitle || '未归属项目'
              counts.set(key, (counts.get(key) || 0) + 1)
            })
            const rows = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4)
            const max = Math.max(1, ...rows.map((entry) => entry[1]))
            return rows.map(([label, count]) => h('div', { key: label, className: 'frx-bydist-row' },
              h('span', { className: 'frx-bydist-label', title: label }, label),
              h('span', { className: 'frx-bydist-track' },
                h('i', { style: { width: `${Math.max(8, Math.round((count / max) * 100))}%` } })),
              h('span', { className: 'frx-bydist-value' }, String(count))))
          })()),
      ],
    })

    /* ---------- 卡片 3：运行中（参考项目的 Agents Running） ---------- */
    const runningCard = card('running', {
      label: '运行中',
      children: [
        h('div', { key: 'bigrow', className: 'frx-bigrow' },
          h('div', { className: 'frx-chip is-purple' }, icon('terminal', 20)),
          h('span', { className: 'frx-delta is-flat' }, `${bindSessions} 绑会话`)),
        h('div', { key: 'stat', style: { marginTop: 'auto' } },
          h('p', { className: 'frx-stat-label' }, '运行中'),
          h('p', { className: 'frx-stat-value' }, String(runningList.length))),
        h('div', { key: 'pills', className: 'frx-pills' },
          runningList.slice(0, 4).map((row) => h('span', { key: row.id, className: 'frx-pill' },
            String(row.no || ''), ' ', h('em', null, row.elapsedText || '—')))),
      ],
    })

    /* ---------- 卡片 4：执行历史（参考项目的 History，跨 2 列） ---------- */
    const historyCard = card('history', {
      span2: true,
      label: '执行历史',
      children: [
        h('div', { key: 'head', className: 'frx-card-head', style: { marginBottom: '12px' } },
          h('div', { className: 'frx-card-head-left' },
            h('div', { className: 'frx-icon is-brand' }, icon('code', 22)),
            h('div', { key: 'tt' },
              h('h2', { className: 'frx-card-title' }, '执行历史'),
              h('p', { className: 'frx-card-sub is-idle' }, '按最近活跃排序 · 已完成的任务不在这里')))),
        h('div', { key: 'rows', className: 'frx-rows' },
          (view.history || []).slice(0, 12).map((row) => h('button', {
            key: row.id,
            type: 'button',
            className: 'frx-row',
            onClick: () => select(row.id),
          },
            h('span', { className: 'frx-row-left' },
              h('span', { className: 'frx-avatar' },
                String(row.no || '').slice(-2) || '··',
                h('span', { className: `frx-avatar-dot is-${row.state || 'idle'}`.replace('is-waiting', 'is-idle'), 'aria-hidden': 'true' })),
              h('span', { className: 'frx-row-main' },
                h('span', { className: 'frx-row-title' }, row.title || ''),
                h('span', { className: 'frx-row-meta' },
                  `${row.no ? `#${row.no}` : ''}${row.elapsedText && row.elapsedText !== '—' ? ` · ${row.elapsedText}` : ''}`))),
            h('span', { style: { display: 'flex', alignItems: 'center', gap: '12px' } },
              h('span', { className: `frx-row-status is-${row.state === 'running' ? 'running' : (row.state === 'suspended' ? 'suspended' : 'idle')}` },
                row.state === 'running' ? '运行中' : (row.state === 'suspended' ? '挂起' : '等待中')),
              h('span', { className: 'frx-row-btn' }, '详情'))))),
      ],
    })

    /* ---------- 卡片 5：快捷操作（参考项目的 Quick Actions） ---------- */
    const actionCard = card('actions', {
      span2: true,
      label: '快捷操作',
      children: [
        h('div', { key: 'head', className: 'frx-card-head', style: { marginBottom: '12px' } },
          h('div', { className: 'frx-card-head-left' },
            h('div', { className: 'frx-icon is-brand' }, icon('plus', 22)),
            h('div', { key: 'tt' },
              h('h2', { className: 'frx-card-title' }, '快捷操作'),
              h('p', { className: 'frx-card-sub is-idle' }, '直接跳到最需要处理的地方')))),
        /* 2×2 四个入口：让这张跨 2 列的卡不留大片空白（用户口径：一行里不要出现空白部分） */
        h('div', { key: 'acts', className: 'frx-actions' },
          h('button', {
            type: 'button', className: 'frx-action is-blue',
            onClick: () => { const first = runningList[0]; if (first) select(first.id) },
          },
            h('span', { className: 'frx-action-icon' }, icon('activity', 20)),
            h('span', null,
              h('span', { className: 'frx-action-title' }, '打开正在跑的任务'),
              h('span', { className: 'frx-action-sub' }, runningList.length ? `${runningList.length} 条在跑` : '当前没有在跑的任务'))),
          h('button', {
            type: 'button', className: 'frx-action is-purple',
            onClick: () => { if (typeof ctx.onRefresh === 'function') ctx.onRefresh() },
          },
            h('span', { className: 'frx-action-icon' }, icon('refresh', 20)),
            h('span', null,
              h('span', { className: 'frx-action-title' }, '刷新快照'),
              h('span', { className: 'frx-action-sub' }, '重新读一次宿主状态'))),
          h('button', {
            type: 'button', className: 'frx-action is-ghost',
            onClick: () => { const first = view.history[0] || view.bubbles[0]; if (first) select(first.id) },
          },
            h('span', { className: 'frx-action-icon' }, icon('code', 20)),
            h('span', null,
              h('span', { className: 'frx-action-title' }, '看最近活跃的一条'),
              h('span', { className: 'frx-action-sub' }, view.history[0] ? (view.history[0].title || '').slice(0, 18) : '暂无记录'))),
          h('button', {
            type: 'button', className: 'frx-action is-ghost',
            onClick: () => { const stuck = (view.alerts || [])[0]; if (stuck) select(stuck.id) },
          },
            h('span', { className: 'frx-action-icon' }, icon('terminal', 20)),
            h('span', null,
              h('span', { className: 'frx-action-title' }, '看需要人看一眼的'),
              h('span', { className: 'frx-action-sub' }, (view.alerts || []).length ? `${view.alerts.length} 条待人工` : '暂时没有需要插手的')))),
      ],
    })

    return h('div', { ref: hostRef, className: 'frx-page', 'data-skipped-done': String(view.skippedDone || 0) },
      h('header', { key: 'h', className: 'frx-header' },
        h('h1', { className: 'frx-title' }, '运行'),
        h('p', { className: 'frx-subtitle' },
          `${unfinished} 条未完成任务 · ${runningList.length} 条正在跑 · ${view.skippedDone || 0} 条已完成（不上页）`)),
      h('div', {
        key: 'row1',
        className: 'frx-grid',
        style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '16px' },
      }, statusCard, totalCard, runningCard),
      h('div', {
        key: 'row2',
        className: 'frx-grid is-tight',
        style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '16px' },
      }, historyCard, actionCard),
    )
  }
}

export default createRunsFeature
