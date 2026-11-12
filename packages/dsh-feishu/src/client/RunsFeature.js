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
import { iconDrawNodes, normalizeIcon, colorHex, autoIconFor, renderIcon } from './projectIcons.js'
import { derivePulses, prunePulses, toneColor, subscribeActivity, PULSE_TTL } from './sessionPulse.js'

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
  /* 参考项目 DASHBOARD_POSITIONS 的**原值**。
     之前为了填满更宽的面板把坐标往中心压了 22%，结果泡挤成一团（用户：「气泡不要那么集中」）——
     现在照抄散点，靠容器宽度（560）承担留白。 */
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
  const POSITIONS = RAW_POSITIONS.map((pos) => ({ ...pos }))
  const MAX_ORBS = 8
  /* 「刚做完」的气泡在墙上停留多久（毫秒）：用户口径「运行中和运行完都可以显示」，
     而已完成的任务按另一个口径不长驻运行页 —— 只留一小会儿，看到「已完成」就消失。
     想彻底不显示就把它改成 0。 */
  const RECENT_DONE_MS = 25 * 1000
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

  /**
   * 三点动画（「运行中」的视觉表达）。
   * 用户口径：「运行中的状态显示一个个… 的动画，不要用『运行中***』这样的文字」。
   * 文字只留在 aria-label / title 上（无障碍与 hover 提示），画面只有三个跳动的点。
   */
  const dotsNode = (label) => h('span', {
    className: 'frx-dots',
    role: 'status',
    'aria-label': label,
    title: label,
  }, h('i', { key: 'a', className: 'frx-dots-dot' }), h('i', { key: 'b', className: 'frx-dots-dot' }), h('i', { key: 'c', className: 'frx-dots-dot' }))

  /** 状态徽标里的图标（复用内置的 Lucide 图标集，不另画） */
  const BADGE_ICON = { check: 'lucide:check', alert: 'lucide:triangle-alert', pause: 'lucide:pause', clock: 'lucide:clock' }
  const badgeIcon = (name, size) => (BADGE_ICON[name] ? renderIcon({ h }, BADGE_ICON[name], size || 11) : null)

  /* ---------- 旭日图（项目卡片） ----------
     径向两层：内圈 = 合并后的项目（角度 ∝ 未完成条数），外圈 = 该项目里的状态拆分。
     SVG 的 fill 属性不支持 color-mix，所以这里用字面色（这一页本来就走非令牌的 frx 样式）。 */
  const PROJECT_COLORS = ['#60a5fa', '#a78bfa', '#34d399', '#fbbf24', '#f472b6', '#22d3ee']
  const ARC_STATE_COLORS = { running: '#3b82f6', blocked: '#f59e0b', suspended: '#a855f7', started: '#64748b', idle: '#475569' }
  const polar = (cx, cy, r, angle) => [cx + r * Math.cos(angle), cy + r * Math.sin(angle)]
  const arcPath = (cx, cy, r0, r1, a0, a1) => {
    const [x0, y0] = polar(cx, cy, r1, a0)
    const [x1, y1] = polar(cx, cy, r1, a1)
    const [x2, y2] = polar(cx, cy, r0, a1)
    const [x3, y3] = polar(cx, cy, r0, a0)
    const large = a1 - a0 > Math.PI ? 1 : 0
    return `M${x0.toFixed(2)} ${y0.toFixed(2)}A${r1} ${r1} 0 ${large} 1 ${x1.toFixed(2)} ${y1.toFixed(2)}L${x2.toFixed(2)} ${y2.toFixed(2)}A${r0} ${r0} 0 ${large} 0 ${x3.toFixed(2)} ${y3.toFixed(2)}Z`
  }

  const sunburst = (projects, total, size) => {
    const cx = size / 2
    const cy = size / 2
    const r0 = size * 0.16
    const r1 = size * 0.30
    const r2 = size * 0.44
    const sum = Math.max(1, total)
    let angle = -Math.PI / 2
    const paths = []
    projects.forEach((project, index) => {
      const color = PROJECT_COLORS[index % PROJECT_COLORS.length]
      const sweep = (project.count / sum) * Math.PI * 2
      const a0 = angle
      const a1 = angle + sweep
      paths.push(h('path', {
        key: `ring-${project.key}`,
        d: arcPath(cx, cy, r0, r1, a0 + 0.014, a1 - 0.014),
        fill: color,
        'fill-opacity': '0.92',
        /* 每段描一圈背景色：环段之间才有干净的分隔（否则相邻同色系会糊成一片） */
        stroke: '#0f1115',
        'stroke-width': '2',
      }, h('title', null, `${project.label} · ${project.count} 条${project.merged > 1 ? ` · 合并 ${project.merged} 个工作区` : ''}`)))
      /* 外圈：该项目的状态拆分 */
      let inner = a0
      Object.keys(project.states).forEach((state) => {
        const count = project.states[state] || 0
        if (!count) return
        const span = (count / project.count) * sweep
        paths.push(h('path', {
          key: `sub-${project.key}-${state}`,
          d: arcPath(cx, cy, r1 + 3, r2, inner + 0.01, inner + span - 0.01),
          fill: ARC_STATE_COLORS[state] || ARC_STATE_COLORS.idle,
          /* 外圈比内圈淡一档 + 背景色描边：一眼能分出「项目 / 状态」两层 */
          'fill-opacity': '0.58',
          stroke: '#0f1115',
          'stroke-width': '2',
        }, h('title', null, `${project.label} · ${stateText(state)} ${count} 条`)))
        inner += span
      })
      angle = a1
    })
    return h('svg', {
      className: 'frx-sun',
      width: size, height: size, viewBox: `0 0 ${size} ${size}`,
      role: 'img',
      'aria-label': `项目旭日图：${projects.map((project) => `${project.label} ${project.count} 条`).join('，')}`,
    },
      h('circle', { cx, cy, r: r2 + 1, fill: 'rgba(255,255,255,.02)' }),
      /* 内外圈之间留一道背景色细环，明确「内=项目，外=状态」 */
      h('circle', { cx, cy, r: (r1 + r1 + 3) / 2, fill: 'none', stroke: '#0f1115', 'stroke-width': '3' }),
      paths,
      h('text', { x: cx, y: cy + 2, className: 'frx-sun-total', textAnchor: 'middle' }, String(total)),
      h('text', { x: cx, y: cy + 15, className: 'frx-sun-unit', textAnchor: 'middle' }, '条'))
  }

  /** 相对时间（只用于「挂起于 …」这类说明文字，避免再引一个依赖） */
  const sinceText = (from) => {
    const ms = Math.max(0, Date.now() - Number(from || 0))
    const min = Math.floor(ms / 60000)
    if (min < 60) return `${min} 分钟前`
    const hour = Math.floor(min / 60)
    if (hour < 24) return `${hour} 小时前`
    return `${Math.floor(hour / 24)} 天前`
  }

  /** 状态色口径的单一出处：class 后缀（样式表里给颜色） */
  const stateClass = (state) => (state === 'running' ? 'running'
    : (state === 'blocked' ? 'blocked'
      : (state === 'done' ? 'done' : 'idle')))
  /** 状态文案 */
  const stateText = (state) => (state === 'running' ? '运行中'
    : (state === 'blocked' ? '阻塞'
      : (state === 'done' ? '已完成' : '等待中')))

  const orbSvg = (opts) => {
    const o = opts || {}
    const size = Math.max(24, Number(o.size) || 48)
    const pct = Math.max(0, Math.min(100, Number(o.percent) || 0))
    const running = o.running === true
    const suspended = o.suspended === true
    /* 状态色（用户口径）：运行中=蓝、完成=绿、报错（阻塞）=黄；等待/未开工沿用绿。 */
    const state = String(o.state || '')
    const palette = state === 'running' ? [59, 130, 246]
      : (state === 'blocked' ? [251, 191, 36]
        : [34, 197, 94])
    const label = String(o.label || '')
    const uid = `o${String(o.id || 'x').replace(/[^a-zA-Z0-9]/g, '')}`
    const R = 46
    const lineY = 100 - (pct / 100) * (R * 2)   // viewBox 100 单位下的水位线
    const wave1 = `M0,${lineY} Q25,${lineY - 2} 50,${lineY} T100,${lineY}`
    const wave2 = `M0,${lineY} Q25,${lineY + 2} 50,${lineY} T100,${lineY}`
    /* 颜色一律用**参考项目的原值 rgba**，不用 color-mix()：
       color-mix() 在 SVG 的 fill/stroke 表现属性里不生效（水与发光会整块不可见 —— 这正是
       「气泡里的水面动画和效果都失效了」的根因）。

       配色口径（对齐参考项目的「可用模型泡」）：**一律绿**。参考页面上所有泡都是绿色玻璃球
       （绿=可用，蓝=当前选中）；我们这页上的泡本来就都是「未完成/可用」，之前按 running/idle
       分成绿/灰，而真实数据里常年 0 条在跑 → 整片灰扑扑（用户：「和之前 adventure 还是不一样」）。
       运行中的绿更实一点，其余同色系。 */
    const accent = palette
    const rgba = (c, a) => `rgba(${c[0]}, ${c[1]}, ${c[2]}, ${a})`
    const stroke = rgba(accent, running ? 0.65 : 0.45)
    /* 玻璃球体：参考项目 from-white/8 via-white/4 to-transparent + 绿色内发光 */
    const fill = 'rgba(255, 255, 255, 0.035)'
    /* 参考项目 ClaudeModelBubbles 的发光配方：两层外发光 + 一层内发光 + 顶部内高光 */
    const glowOuter = rgba(accent, running ? 0.55 : 0.5)
    const glowOuter2 = rgba(accent, running ? 0.28 : 0.25)
    const glowInner = rgba(accent, 0.15)
    /* 水位颜色跟着**剩余量**走（对齐参考项目 WaterLevel.tsx 的绿→黄→红）：
       水位 = 这个项目已完成任务占比，水位越低 = 还有越多活没干 → 水色越暖。
       ⚠️ 只改**水**，气泡的描边/发光仍然是状态色（蓝=跑 / 黄=阻塞 / 绿=其余）——
       用户点名过的状态色口径不能被水位配色冲掉。 */
    const waterLevel = pct >= 66 ? [34, 197, 94] : (pct >= 33 ? [245, 158, 11] : [239, 68, 68])
    const waterFill = rgba(waterLevel, 0.3)
    const waterStroke = rgba(waterLevel, 0.82)
    return h('svg', {
      key: 'orb',
      width: size, height: size, viewBox: '0 0 100 100',
      'aria-hidden': 'true', focusable: 'false',
      style: { display: 'block', overflow: 'visible' },
    },
      h('defs', null,
        /* 球面高光：参考项目是 white/50 → white/20 → transparent 的模糊球 */
        h('radialGradient', { id: `${uid}-shine`, cx: '32%', cy: '26%', r: '46%' },
          h('stop', { offset: '0%', stopColor: '#ffffff', stopOpacity: 0.5 }),
          h('stop', { offset: '55%', stopColor: '#ffffff', stopOpacity: 0.18 }),
          h('stop', { offset: '100%', stopColor: '#ffffff', stopOpacity: 0 })),
        /* 内发光：中心向外 15% 状态色（对应 box-shadow 的 inset 0 0 30px） */
        h('radialGradient', { id: `${uid}-innerglow`, cx: '50%', cy: '50%', r: '50%' },
          h('stop', { offset: '55%', stopColor: accent, stopOpacity: 0.16 }),
          h('stop', { offset: '100%', stopColor: accent, stopOpacity: 0.02 })),
        /* 发光滤镜：参考项目用 box-shadow（本身带模糊），SVG 里必须用 feGaussianBlur 才是柔光，
           否则只是两个硬边圆环 —— 用户对比时看到的就是「我们的光是平的」。 */
        h('filter', { id: `${uid}-blur1`, x: '-60%', y: '-60%', width: '220%', height: '220%' },
          h('feGaussianBlur', { stdDeviation: 2.6 })),
        h('filter', { id: `${uid}-blur2`, x: '-80%', y: '-80%', width: '260%', height: '260%' },
          h('feGaussianBlur', { stdDeviation: 5.5 })),
        h('clipPath', { id: `${uid}-clip` }, h('circle', { cx: 50, cy: 50, r: R - 2 }))),
      /* 外发光：两层（≈20px 与 ≈40px，对应参考的 0 0 20px / 0 0 40px），所有泡都有 */
      h('circle', { cx: 50, cy: 50, r: R + 1, fill: 'none', stroke: glowOuter, strokeWidth: 7, filter: `url(#${uid}-blur1)` }),
      h('circle', { cx: 50, cy: 50, r: R + 4, fill: 'none', stroke: glowOuter2, strokeWidth: 11, filter: `url(#${uid}-blur2)` }),
      /* 底色圆 + 描边：几何即圆形 */
      h('circle', { cx: 50, cy: 50, r: R, fill, stroke, strokeWidth: 2 }),
      /* 球面高光（在水位之前画：水位是主体信息，不能被高光糊掉） */
      h('circle', { cx: 50, cy: 50, r: R, fill: `url(#${uid}-shine)`, opacity: 0.5 }),
      /* 内发光（inset 0 0 30px）。
         注意：**不要**再画「顶部内高光弧线」—— 参考项目那条是 CSS 的 `inset 0 1px 0 white/40`，
         只有 1px、贴着圆顶，几乎看不见；之前我用一条 1.8 单位宽的弧去模仿，放大到 SVG 尺度后
         变成气泡顶上一条明显的灰线（用户：「气泡上面多了一个奇怪的灰色线」）。 */
      h('g', { clipPath: `url(#${uid}-clip)` },
        h('circle', { cx: 50, cy: 50, r: R, fill: `url(#${uid}-innerglow)` })),
      /* 水位（裁剪在圆内）：**每个泡都画** —— 参考项目里所有可用泡都有水位，
         之前只在「运行中」才画，真实数据里 0 条在跑 → 整片气泡都没有水面（用户：「水面动画和效果都失效了」）。
         波浪线用 SMIL 动画，3s 循环（与参考的 WaterLevel.tsx 同节奏）。 */
      h('g', { clipPath: `url(#${uid}-clip)` },
        h('rect', { x: 0, y: lineY, width: 100, height: Math.max(0, 100 - lineY), fill: waterFill }),
        h('path', { d: wave1, fill: 'none', stroke: waterStroke, strokeWidth: 2.5 },
          h('animate', { attributeName: 'd', dur: '3s', repeatCount: 'indefinite', values: `${wave1};${wave2};${wave1}` }))),
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
      /* 订阅活动流（宿主已有 SSE /api/sessions/activity，推 {alive, phase, turn}）。
         没有 EventSource（老宿主/单测）时安静降级：只按快照口径显示状态。 */
      useEffect(() => {
        const off = subscribeActivity('/dsh-feishu/api/sessions/activity', {
          onSessions: (rows) => {
            sessionsRef.current = Array.isArray(rows) ? rows : []
            setPulseVersion((n) => n + 1)
          },
        })
        return () => { if (typeof off === 'function') off() }
      }, [])
      /* 每秒结算：静默太久的非 sticky 状态泡丢掉 —— 这就是「没有新消息自动消失」。 */
      useEffect(() => {
        const timer = setInterval(() => {
          const before = pulseMapRef.current
          const after = prunePulses(before, Date.now(), PULSE_TTL)
          if (after.size !== before.size) {
            pulseMapRef.current = after
            setPulseVersion((n) => n + 1)
          }
        }, 1000)
        return () => clearInterval(timer)
      }, [])
    }

    /* 状态对话气泡：Map(taskId → {text, tone, sticky, at}) + 版本号触起重渲染。
       纯逻辑在 sessionPulse.js（可离线单测），这里只管订阅活动流与定时结算。 */
    const pulseMapRef = useRef ? useRef(new Map()) : { current: new Map() }
    const sessionsRef = useRef ? useRef([]) : { current: [] }
    const [pulseTick, setPulseTick] = useState ? useState(0) : [0, () => {}]
    const pulseVersion = Array.isArray(pulseTick) ? pulseTick[0] : pulseTick
    const setPulseVersion = Array.isArray(pulseTick) ? pulseTick[1] : setPulseTick
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

    /* 把「刚做完」的窗口告诉 runsView（单位毫秒）；0 = 不上墙 */
    const snapshotForView = { ...(ctx.snapshot || ctx), recentDoneMs: RECENT_DONE_MS }
    const view = buildRuns(snapshotForView)
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
    /* 水位口径：**该项目已完成任务占比**（0~100）。
       为什么不用「这条跑了多久」：真实数据里只有少数任务有开始时间，水位全挤在底部、
       整片泡看起来一模一样（用户对比参考项目时就说「还是不一样」）。
       项目完成占比是同一份快照里的真实数据，天然有高有低：水位越高 = 这个项目越接近收尾。 */
    const progressOf = (() => {
      const map = new Map()
      const rows = Array.isArray((ctx.snapshot || ctx).tasks) ? (ctx.snapshot || ctx).tasks : []
      rows.forEach((row) => {
        const key = String((row && row.workspaceKey) || '')
        if (!key) return
        const cell = map.get(key) || { total: 0, done: 0 }
        cell.total += 1
        if (row && row.done === true) cell.done += 1
        map.set(key, cell)
      })
      return (key) => {
        const cell = map.get(String(key || ''))
        if (!cell || !cell.total) return 0
        return Math.round((cell.done / cell.total) * 100)
      }
    })()

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
    /* 气泡墙 = 未完成（不含挂起） + **刚做完还留在墙上的绿泡**（view.justDone）。
       「刚做完」的窗口由宿主快照的 recentDoneMs 决定（见 runsView 的说明）：
       它只影响气泡墙，KPI / 分组 / 历史 / 时长都不含它们。 */
    const wallRows = view.bubbles.filter((row) => row.state !== 'suspended').concat(view.justDone || [])
    /* 结算状态泡：快照（终态/阻塞/在跑）+ 活动流（phase/turn）→ 每个任务一句状态。
       同一条状态不重置计时，所以「没有新消息」会自然到点消失（见 sessionPulse.js）。 */
    /* 用**快照原始任务行**而不是 view.bubbles：气泡行只带 state，没有 running/started/blocked
       这些原始标记，而状态词要靠它们判断（view.bubbles 只用于渲染与排序）。 */
    const pulseTasks = Array.isArray((ctx.snapshot || ctx).tasks) ? (ctx.snapshot || ctx).tasks : []
    const pulseResult = derivePulses(pulseTasks, sessionsRef.current, pulseMapRef.current, Date.now())
    pulseMapRef.current = pulseResult.map
    const pulseOf = (id) => pulseMapRef.current.get(String(id || '')) || null

    const orbRows = wallRows.slice().sort((a, b) => {
      const diff = rank(a) - rank(b)
      if (diff !== 0) return diff
      return (Number(b.elapsed) || 0) - (Number(a.elapsed) || 0)
    }).slice(0, MAX_ORBS)
    const maxElapsed = orbRows.reduce((max, row) => Math.max(max, Number(row.elapsed) || 0), 0)

    const card = (key, opts) => {
      const o = opts || {}
      /* 跨度用 class 而不是内联样式：容器查询（窄面板降列）要能覆盖它。 */
      const span = o.span || (o.span2 ? 2 : 0)
      return h('section', {
        key,
        className: `frx-card${span ? ` is-span${span}` : ''}`,
        'aria-label': o.label || '',
      },
        h('div', { className: 'frx-card-glow', 'aria-hidden': 'true' }),
        h('div', { className: 'frx-card-inner' }, o.children))
    }

    /* 空态：与参考项目一致的卡片壳子，不画图 */
    const emptyCard = h('div', { className: 'frx-page', 'data-empty': '1' },
      h('div', { className: 'frx-grid', style: { height: 'auto' } },
        card('empty', { span: 2, label: '运行状态', children: [
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
    /* 「阻塞」= 未完成里被前置卡住的那批（与「运行中」无关，属于这张卡自己的补充口径） */
    const blockedList = view.bubbles.filter((row) => row.state === 'blocked')
    const unfinished = view.bubbles.length
    const suspendedCount = view.bubbles.filter((row) => row.state === 'suspended').length
    const bindSessions = view.boundSessions || 0

    /* ---------- 卡片 1：运行状态（参考项目的 Claude CLI Status，跨 2 列） ---------- */
    const statusCard = card('status', {
      span: 2,
      label: '运行状态',
      children: [
        h('div', { key: 'head', className: 'frx-card-head' },
          h('div', { className: 'frx-card-head-left' },
            h('div', { className: `frx-icon ${runningList.length ? 'is-ok' : 'is-idle'}` }, icon('activity', 24)),
            h('div', { key: 'tt' },
              h('h2', { className: 'frx-card-title' }, '运行状态'),
              h('p', { className: `frx-card-sub ${runningList.length ? 'is-ok' : 'is-idle'}` },
                runningList.length ? '会话正在跑 · 实时同步' : '空闲 · 等待任务开工'))),
          /* 用户口径：左上的这排状态监控放在**右上**（与标题同一行，右对齐） */
          h('div', { key: 'kpis', className: 'frx-kpis' },
            [['未完成', unfinished, 'lucide:chart-spline'],
              ['在跑', runningList.length, 'lucide:play'],
              ['会话', bindSessions, 'lucide:link'],
              ['阻塞', blockedList.length, 'lucide:triangle-alert']]
              .map(([label, value, iconId]) => h('span', {
                key: label,
                className: 'frx-kpi',
                'data-tone': label === '阻塞' && value > 0 ? 'warn' : 'flat',
              },
                h('span', { className: 'frx-kpi-icon', 'aria-hidden': 'true' }, renderIcon({ h }, iconId, 13)),
                h('b', null, String(value)),
                h('span', { className: 'frx-kpi-label' }, label))))),
        /* AVAILABLE MODELS → 可用任务 */
        h('div', { key: 'bubbles' },
          h('p', { className: 'frx-bubbles-label', title: '水位 = 该项目已完成任务占比（越高越接近收尾）' }, '可用任务'),
          orbRows.length
            ? h('div', {
              className: 'frx-bubbles',
              role: 'list',
              'aria-label': '任务气泡墙',
              /* 与参考一致：固定高度的散点场；宽一点让 8 个泡摊开（不挤成一团） */
              /* 用户口径「气泡高度太高了」：132 → 104（散点位仍是参考项目原值，只压高度） */
              style: { position: 'relative', width: '100%', maxWidth: '560px', height: '104px', margin: '4px auto 0' },
            },
              orbRows.map((row, index) => {
                const pos = POSITIONS[index]
                const isRunning = row.state === 'running'
                const isSuspended = row.state === 'suspended'
                const isDone = row.state === 'done'
                const canOpen = Boolean(row.sessionId)
                /* 只有一套颜色语义：绿=在跑、琥珀边=挂起、灰=未开始。
                   参考项目里「蓝=当前模型」是模型的「选中」概念，任务里没有对应物，
                   硬套会让「绿光气泡」和上方 KPI 的绿色对不上（用户实测指出的问题）。 */
                const tone = isRunning ? 'is-ok' : (isSuspended ? 'is-suspended' : 'is-dim')
                /* 水位 = 这条已跑时长 ÷ 未完成里最长的那个（相对量）。
                   给 10% 下限只是让波浪线可见（0 时水面贴在圆底、裁剪后看不出来）；
                   水位高 ≠ 好/坏，只表达「谁跑得久」。 */
                /* 水位 = 该项目已完成占比（≥8% 只为了让波浪线可见） */
                const pct = Math.max(8, Math.min(100, progressOf(row.workspaceKey)))
                const meta = [row.title || '', isRunning ? '运行中' : (isSuspended ? '挂起' : '未开始'),
                  row.elapsedText && row.elapsedText !== '—' ? row.elapsedText : ''].filter(Boolean).join(' · ')
                return h('div', {
                  key: row.id,
                  className: 'frx-orb-slot',
                  role: 'listitem',
                  'data-state': row.state,
                  'data-id': String(row.id),
                  /* 靠右的泡把状态泡翻到左上角（尾巴方向也在 CSS 里跟着翻），避免贴边被裁 */
                  'data-flip': Number.parseFloat(pos.left) >= 55 ? '1' : '0',
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
                  /* 状态对话气泡：贴在泡沿外右上角，尾巴朝左下指着泡。
                     没有新消息时由 prunePulses 丢掉 → 什么都不渲染（泡回到干净状态）。 */
                  (() => {
                    /* 用户口径：「运行完成的气泡不用显示时间图标」——
                       已完成（绿泡）本身就说明结果了，而且它只停留 25 秒就该消失，
                       不再挂任何图标（既不是时钟也不是勾）。 */
                    if (row.state === 'done') return null
                    const pulse = pulseOf(row.id)
                    if (!pulse) return null
                    /* 状态徽标（用户 review 后实施）：咬住泡的右下角，图标/三点表示状态；
                       文字只在 aria-label / title 上，画面里没有「运行中***」这类字样。 */
                    const body = pulse.dots ? dotsNode(pulse.text) : (badgeIcon(pulse.badge, 11) || h('i', { className: 'frx-badge-dot' }))
                    return h('span', {
                      key: 'pulse',
                      className: 'frx-badge',
                      'data-tone': pulse.tone,
                      'data-badge': pulse.badge || 'dot',
                      role: 'status',
                      'aria-label': pulse.text,
                      title: pulse.text,
                      style: { '--frx-badge-c': toneColor(pulse.tone) },
                    }, body)
                  })(),
                  /* 视觉：一层内联 SVG（正圆是几何，不是 CSS 圆角）；交互：覆在上面的透明 button。 */
                  orbSvg({
                    size: pos.size,
                    percent: pct,
                    running: isRunning,
                    suspended: isSuspended,
                    state: row.state,
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
                    /* hover 放大（对齐参考项目 ClaudeModelBubbles 的 hover:scale-110）：
                       作用在气泡插槽上，用 CSS 过渡，reduced-motion 下由样式表关掉。 */
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
                        isRunning
                          ? h('span', null, dotsNode('运行中'), ` · 水位 ${pct}%`)
                          : (isDone
                            ? '已完成'
                            : `${isSuspended ? '挂起' : '未开始'}${pct > 0 ? ` · 水位 ${pct}%` : ''}`)),
                      h('span', { className: 'frx-orb-tip-hint' }, canOpen ? '单击打开会话' : '没有绑定会话 · 单击看详情'))
                    : null)
              }))
            : h('p', { className: 'frx-subtitle' }, '没有未完成的任务')),
        /* 用户口径：「下方的项目名删掉」——原来贴在状态卡底部的项目占比列表整块移除，
           项目维度的统计改到**右侧的「按项目分布」卡**里，用横向柱表达。 */
      ],
    })

    /* 卡片 2「未完成任务」与卡片 3「运行中」已删除：数字进状态卡的 KPI 胶囊，
       在跑任务的明细在执行历史里（按最近活跃排序，在跑的排最前）。 */

    /* ---------- 右侧卡 A：按项目分布（横向柱） ----------
       用户口径：「运行状态右侧需要恢复之前的两个卡片，但里面的内容可以用图统计其他重要信息」。
       这张卡用**图表**回答「活压在哪个项目上」——这个数字不在 KPI 胶囊里，不重复。 */
    const projectCard = card('projects', {
      /* 用户口径：项目卡片用**旭日图**展示，并且**合并项目** ——
         合并规则直接复用总览页/关系图那套「自定义目录」：一个目录 = 一个项目（多个 workspace 合一）。 */
      label: '项目分布（旭日图）',
      children: [
        h('div', { key: 'head', className: 'frx-card-head', style: { marginBottom: '8px' } },
          h('div', { className: 'frx-card-head-left' },
            h('div', { className: 'frx-icon is-brand' }, icon('cpu', 20)),
            h('div', { key: 'tt' },
              h('h2', { className: 'frx-card-title' }, '项目分布'),
              h('p', { className: 'frx-card-sub is-idle' },
                (view.projects || []).some((project) => project.merged > 1)
                  ? '按自定义目录合并 · 外圈是状态'
                  : '按项目 · 外圈是状态')))),
        (view.projects || []).length
          ? h('div', { key: 'sun', className: 'frx-sun-wrap' },
            sunburst(view.projects, unfinished, 156),
            h('div', { key: 'legend', className: 'frx-sun-legend' },
              (view.projects || []).slice(0, 5).map((project, index) => h('div', {
                key: project.key, className: 'frx-sun-legend-row', title: `${project.label}：${project.count} 条未完成`,
              },
                h('i', { className: 'frx-sun-dot', style: { background: PROJECT_COLORS[index % PROJECT_COLORS.length] }, 'aria-hidden': 'true' }),
                h('span', { className: 'frx-sun-name' }, project.label),
                project.merged > 1
                  ? h('span', { className: 'frx-sun-merged' }, `合并 ${project.merged}`)
                  : null,
                h('span', { className: 'frx-sun-count' }, `${project.count} 条`))),
              /* 外圈是状态：给一行小图例，否则没人知道外圈颜色代表什么 */
              h('div', { key: 'states', className: 'frx-sun-states' },
                Object.keys(ARC_STATE_COLORS)
                  .filter((state) => (view.projects || []).some((project) => (project.states[state] || 0) > 0))
                  .map((state) => h('span', { key: state, className: 'frx-sun-state' },
                    h('i', { style: { background: ARC_STATE_COLORS[state] }, 'aria-hidden': 'true' }),
                    stateText(state))))))
          : h('p', { className: 'frx-subtitle' }, '没有未完成的任务'),
      ],
    })

    /* ---------- 右侧卡 B：阻塞排行（谁卡住了最多的任务） ----------
       按依赖关系聚合：被未完成的前置任务各记一票 —— 排最前的就是「卡住一片」的那个，
       比单纯数「阻塞 N 条」有用（直接告诉你该先动谁）。 */
    const blockers = (() => {
      const votes = new Map()
      view.bubbles.forEach((row) => {
        row.blockedBy.filter((item) => !item.done).forEach((item) => {
          const key = String(item.id || item.title)
          const cur = votes.get(key) || { id: item.id, title: item.title || item.id, stuck: 0 }
          cur.stuck += 1
          votes.set(key, cur)
        })
      })
      return [...votes.values()].sort((a, b) => b.stuck - a.stuck).slice(0, 5)
    })()
    const blockerCard = card('blockers', {
      label: '阻塞排行',
      children: [
        h('div', { key: 'head', className: 'frx-card-head', style: { marginBottom: '10px' } },
          h('div', { className: 'frx-card-head-left' },
            h('div', { className: `frx-icon ${blockers.length ? 'is-warn' : 'is-idle'}` }, icon('activity', 20)),
            h('div', { key: 'tt' },
              h('h2', { className: 'frx-card-title' }, '阻塞排行'),
              h('p', { className: 'frx-card-sub is-idle' },
                blockers.length ? '卡住别人最多的任务（先动它）' : '没有被前置卡住的任务')))),
        blockers.length
          ? h('div', { key: 'bars', className: 'frx-bars' },
            blockers.map((row) => h('button', {
              key: row.id || row.title,
              type: 'button',
              className: 'frx-bar-row is-click',
              title: `${row.title}：卡住 ${row.stuck} 条`,
              onClick: () => { if (row.id) select(row.id) },
            },
              h('span', { className: 'frx-bar-label' }, row.title),
              h('span', { className: 'frx-bar-track is-warn' },
                h('i', { style: { width: `${Math.max(10, Math.round((row.stuck / Math.max(1, blockers[0].stuck)) * 100))}%` } })),
              h('span', { className: 'frx-bar-value' }, `${row.stuck} 条`))))
          : h('p', { className: 'frx-subtitle' }, '没有被阻塞的任务'),
      ],
    })

    /* ---------- 补位卡：暂缓（挂起的任务） ----------
       用户口径是「挂起的不上气泡墙」，但**监控不能瞎**：挂起也算在「未完成」里，
       却没在任何地方露过面。这里给一张只读卡（计数 + 最近几条 + 挂起了多久）。 */
    const suspendedList = view.bubbles.filter((row) => row.state === 'suspended')
    const suspendedCard = card('suspended', {
      label: '暂缓',
      children: [
        h('div', { key: 'head', className: 'frx-card-head', style: { marginBottom: '10px' } },
          h('div', { className: 'frx-card-head-left' },
            h('div', { className: `frx-icon ${suspendedList.length ? 'is-idle' : 'is-idle'}` }, icon('activity', 20)),
            h('div', { key: 'tt' },
              h('h2', { className: 'frx-card-title' }, '暂缓'),
              h('p', { className: 'frx-card-sub is-idle' },
                suspendedList.length ? '挂在墙上但不上气泡墙' : '没有挂起的任务')))),
        suspendedList.length
          ? h('div', { key: 'rows', className: 'frx-rows' },
            suspendedList.slice(0, 4).map((row) => h('button', {
              key: row.id, type: 'button', className: 'frx-row', onClick: () => select(row.id),
            },
              h('span', { className: 'frx-row-left' },
                h('span', { className: 'frx-avatar' }, String(row.no || '').slice(-2) || '··',
                  h('span', { className: 'frx-avatar-dot is-idle', 'aria-hidden': 'true' })),
                h('span', { className: 'frx-row-main' },
                  h('span', { className: 'frx-row-title' }, row.title || ''),
                  h('span', { className: 'frx-row-meta' },
                    row.suspendedAt ? `挂起于 ${sinceText(row.suspendedAt)}` : '已挂起'))),
              h('span', { className: 'frx-row-status is-idle' }, row.elapsedText || '—'))))
          : h('p', { className: 'frx-subtitle' }, '没有挂起的任务'),
      ],
    })

    /* ---------- 补位卡：计时覆盖（有多少任务真的能算时长） ----------
       宿主只对「观察到在跑」的任务记时间，历史任务大多没有 startedAt —— 这直接影响
       「跑得最久」这类卡的可信度，所以单独把覆盖率摆出来（数据质量监控）。 */
    const timedCount = (view.longest || []).filter((row) => row.timed).length
    const untimedCount = (view.longestUntimed || []).length
    const timingCard = card('timing', {
      label: '计时覆盖',
      children: [
        h('div', { key: 'head', className: 'frx-card-head', style: { marginBottom: '10px' } },
          h('div', { className: 'frx-card-head-left' },
            h('div', { className: 'frx-icon is-brand' }, icon('refresh', 20)),
            h('div', { key: 'tt' },
              h('h2', { className: 'frx-card-title' }, '计时覆盖'),
              h('p', { className: 'frx-card-sub is-idle' }, '有多少任务能算出时长')))),
        h('div', { key: 'bars', className: 'frx-bars' },
          h('div', { className: 'frx-bar-row', title: '有开工时间（宿主观察到在跑 / 任务自带）' },
            h('span', { className: 'frx-bar-label' }, '有开始时间'),
            h('span', { className: 'frx-bar-track' },
              h('i', { style: { width: `${Math.round((timedCount / Math.max(1, timedCount + untimedCount)) * 100)}%` } })),
            h('span', { className: 'frx-bar-value' }, `${timedCount} 条`)),
          h('div', { className: 'frx-bar-row', title: '没记开始时间 —— 时长类指标对它们不成立' },
            h('span', { className: 'frx-bar-label' }, '未记录'),
            h('span', { className: 'frx-bar-track is-warn' },
              h('i', { style: { width: `${Math.round((untimedCount / Math.max(1, timedCount + untimedCount)) * 100)}%` } })),
            h('span', { className: 'frx-bar-value' }, `${untimedCount} 条`)),
          h('p', {
            className: 'frx-card-sub is-idle',
            style: { marginTop: '2px' },
          }, '未记录的任务跑起来后，宿主观测到就会补上')),
      ],
    })

    /* ---------- 卡片 2：待处理（阻塞 / 要人看一眼） ----------
       用户口径「运行页面卡片太少了，之前的两个没了，需要把必要的监控都加上」。
       这张卡只放**需要人动手**的东西，且每行给原因，与 KPI 胶囊里的计数不重复。 */
    const todoCard = card('todo', {
      label: '待处理',
      children: [
        h('div', { key: 'head', className: 'frx-card-head', style: { marginBottom: '12px' } },
          h('div', { className: 'frx-card-head-left' },
            h('div', { className: 'frx-icon is-warn' }, icon('activity', 22)),
            h('div', { key: 'tt' },
              h('h2', { className: 'frx-card-title' }, '待处理'),
              h('p', { className: 'frx-card-sub is-idle' }, '被前置卡住 / 需要人看一眼')))),
        (blockedList.length || (view.alerts || []).length)
          ? h('div', { key: 'rows', className: 'frx-rows' }, [
            ...blockedList.slice(0, 6).map((row) => h('button', {
              key: `b-${row.id}`, type: 'button', className: 'frx-row is-warn', onClick: () => select(row.id),
            },
              h('span', { className: 'frx-row-left' },
                h('span', { className: 'frx-avatar' }, String(row.no || '').slice(-2) || '··',
                  h('span', { className: 'frx-avatar-dot is-warn', 'aria-hidden': 'true' })),
                h('span', { className: 'frx-row-main' },
                  h('span', { className: 'frx-row-title' }, row.title || ''),
                  h('span', { className: 'frx-row-meta' },
                    row.blockedBy.length
                      ? `前置未完成 ${row.blockedBy.filter((item) => !item.done).length} / ${row.blockedBy.length}`
                      : '标记为阻塞'))),
              h('span', { className: 'frx-row-status is-warn' }, '阻塞'))),
            ...(view.alerts || []).slice(0, 3).map((row) => h('button', {
              key: `a-${row.id}`, type: 'button', className: 'frx-row', onClick: () => select(row.id),
            },
              h('span', { className: 'frx-row-left' },
                h('span', { className: 'frx-avatar' }, String(row.no || '').slice(-2) || '··',
                  h('span', { className: 'frx-avatar-dot is-idle', 'aria-hidden': 'true' })),
                h('span', { className: 'frx-row-main' },
                  h('span', { className: 'frx-row-title' }, row.title || ''),
                  h('span', { className: 'frx-row-meta' }, `停留 ${row.elapsedText || '—'}`))),
              h('span', { className: 'frx-row-status is-idle' }, '盯一下'))),
          ])
          : h('p', { className: 'frx-subtitle' }, '没有卡住的任务'),
      ],
    })

    /* ---------- 卡片 3：跑得最久（时长 Top，含没记开始时间的） ---------- */
    const longestCard = card('longest', {
      label: '跑得最久',
      children: [
        h('div', { key: 'head', className: 'frx-card-head', style: { marginBottom: '12px' } },
          h('div', { className: 'frx-card-head-left' },
            h('div', { className: 'frx-icon is-brand' }, icon('refresh', 22)),
            h('div', { key: 'tt' },
              h('h2', { className: 'frx-card-title' }, '跑得最久'),
              h('p', { className: 'frx-card-sub is-idle' },
                (view.longest || []).some((row) => row.timed)
                  ? '按已跑时长排序（没记开始时间的排后面）'
                  : '都还没有开始计时')))),
        (view.longest || []).length
          ? h('div', { key: 'rows', className: 'frx-rows' },
            (view.longest || []).slice(0, 5).map((row) => h('button', {
              key: row.id, type: 'button', className: 'frx-row', onClick: () => select(row.id),
            },
              h('span', { className: 'frx-row-left' },
                h('span', { className: 'frx-avatar' }, String(row.no || '').slice(-2) || '··',
                  h('span', { className: `frx-avatar-dot is-${stateClass(row.state)}`, 'aria-hidden': 'true' })),
                h('span', { className: 'frx-row-main' },
                  h('span', { className: 'frx-row-title' }, row.title || ''),
                  h('span', { className: 'frx-row-meta' }, row.startedText || '未记录开始时间'))),
              h('span', { className: 'frx-row-status is-idle' }, row.elapsedText || '—'))))
          : h('p', { className: 'frx-subtitle' }, '还没有任务在跑'),
      ],
    })

    /* ---------- 卡片 4：执行历史（参考项目的 History，跨 2 列） ---------- */
    const historyCard = card('history', {
      span: 2,
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
                h('span', { className: `frx-avatar-dot is-${stateClass(row.state)}`, 'aria-hidden': 'true' })),
              h('span', { className: 'frx-row-main' },
                h('span', { className: 'frx-row-title' }, row.title || ''),
                h('span', { className: 'frx-row-meta' },
                  `${row.no ? `#${row.no}` : ''}${row.elapsedText && row.elapsedText !== '—' ? ` · ${row.elapsedText}` : ''}`))),
            h('span', { style: { display: 'flex', alignItems: 'center', gap: '12px' } },
              /* 状态色口径（用户）：运行中=蓝、完成=绿、报错（阻塞）=黄、等待=中性 */
              h('span', { className: `frx-row-status is-${stateClass(row.state)}` },
                row.state === 'running' ? dotsNode(stateText(row.state)) : stateText(row.state)),
              /* 行的最右侧仍是「详情」按钮；状态列保持文字，方便扫读 */
              h('span', { className: 'frx-row-btn' }, '详情'))))),
      ],
    })

    /* ---------- 卡片 5：快捷操作（参考项目的 Quick Actions） ---------- */
    const actionCard = card('actions', {
      span: 2,
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

    return h('div', { ref: hostRef, className: 'frx-page', 'data-skipped-done': String(view.skippedDone || 0), 'data-skipped-suspended': String(view.skippedSuspended || 0) },
      /* 这里**不放页头**：用户口径「『运行 / N 条未完成任务…』这一行都不需要显示」。
         页面名已经在左侧导航与内容头部有，本页直接进卡片。
         被过滤掉的已完成/挂起数量仍挂在根节点的 data-skipped-* 上（自证用，不占版面）。 */
      /* 整页 **3 行 × 4 列**（用户口径：「应该是 3*4」），卡片自带跨度决定占几列：
           第 1 行 = 运行状态(2) + 按项目分布(1) + 阻塞排行(1) = 4
           第 2 行 = 待处理(1) + 跑得最久(1) + 暂缓(1) + 计时覆盖(1) = 4
           第 3 行 = 执行历史(2) + 快捷操作(2) = 4
         固定列数（不用 auto-fit）才能保证每行都是 4 列；窄面板由容器查询降列。 */
      h('div', { key: 'grid', className: 'frx-grid' },
        statusCard, projectCard, blockerCard,
        todoCard, longestCard, suspendedCard, timingCard,
        historyCard, actionCard),
    )
  }
}

export default createRunsFeature
