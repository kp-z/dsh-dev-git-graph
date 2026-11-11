/**
 * 「空气泡水位」气泡墙 —— 从参考项目**直接搬过来**的组件（用户口径：
 * 「先找到对应的气泡墙的代码直接搬过来包括这个页面的布局」）。
 *
 * 参考实现（`kp-z/open_adventure` 私有仓库，前端 `src/app/`）：
 *   - `components/WaterLevel.tsx`              —— 圆内水位（SVG 裁剪 + 从水位线到底部的填充矩 + 波动曲线）
 *   - `components/ClaudeModelBubbles.tsx`      —— 气泡墙（绝对定位的散点、三档尺寸、float 漂浮动画、
 *                                                 hover 气泡放大 + 浮层说明；绿泡内再叠水位）
 *   - `pages/Dashboard.tsx`                    —— 页面布局（4 列网格：状态卡跨 2 列 + 两张指标卡 + 历史卡）
 *
 * 搬运时的**唯一改动**是渲染层：参考项目用 JSX + Tailwind，我们这边是插件的 `h()` + 宿主令牌样式，
 * 所以：
 *   1. 位置/尺寸/动画时长/层级/zIndex **全部沿用参考表的数值**（`DASHBOARD_POSITIONS` / `LAYOUT`）；
 *   2. 颜色一律换成宿主令牌（`--dsw-alias-*`），不写字面量颜色 —— 这是插件红线；
 *   3. Tailwind 的 `h-24` / `gap-4` 之类换成我们的 `fr-` 类（见 dashboardStyles.js）。
 *
 * 水位语义（参考项目是「已用 token 百分比」，剩余越多水位越高）：
 *   我们这边水位 = **这条任务已经跑了多久 / 当前最长的那条跑了多久**，
 *   所以「最久的那条」水位最高；没有运行时间的任务不画水位（不猜，跟 runsView 一个口径）。
 */

const PAD = 4

/** 参考项目 `DASHBOARD_POSITIONS` 原值：8 个散点位（size + top% + left%）。 */
export const DASHBOARD_POSITIONS = [
  { size: 55, top: '8%', left: '75%' },
  { size: 52, top: '10%', left: '28%' },
  { size: 48, top: '50%', left: '12%' },
  { size: 45, top: '18%', left: '50%' },
  { size: 38, top: '58%', left: '60%' },
  { size: 35, top: '55%', left: '85%' },
  { size: 32, top: '65%', left: '35%' },
  { size: 28, top: '15%', left: '8%' },
]

/** 参考项目 `LAYOUT['dashboard-desktop']`：容器 h-24（96px）、最多 8 个、标签 text-[8px]。 */
/** 数量不足 8 个时用哪几个点位（值 = DASHBOARD_POSITIONS 的下标），保证四个角都有东西。 */
const SPARSE_ORDER = {
  1: [3],
  2: [1, 4],
  3: [3, 0, 2],
  4: [1, 0, 2, 4],
  5: [3, 0, 2, 4, 1],
  6: [1, 3, 0, 4, 2, 5],
  7: [1, 3, 0, 4, 2, 5, 6],
}

export const DASHBOARD_LAYOUT = {
  height: 96,
  maxBubbles: 8,
  labelSize: 8,
}

/**
 * 圆内水位（`WaterLevel.tsx` 的忠实搬运）。
 *
 * 参考实现要点（这些细节决定「像不像」）：
 *   - 用 `clipPath` 的 circle 做圆形裁剪，半径 = size/2 − 2（border-2 占掉 2px）；
 *   - 填充是一条矩形，从水位线到底部；
 *   - 水位线本身是一条**波浪曲线**，用 SMIL `<animate>` 在 3s 内上下 2px 来回，无限循环；
 *   - 颜色按「剩余量」分三档：≥50% 绿、≥10% 黄、其余红（参考项目语义：剩余越多水越高）。
 *
 * 我们的差异：颜色换令牌；`id` 由调用方传入（参考项目用 `bubble-clip-${size}`，
 * 同尺寸的多个气泡会撞 id，是我们这边必须修的 bug）。
 */
export function createWaterLevel(deps) {
  const h = (deps && deps.h) || ((type, props, ...kids) => ({ type, props, kids }))

  /**
   * @param {object} props
   * @param {number} props.percent 0..100（越大水位越高）
   * @param {number} props.size    气泡直径（px，用于 viewBox 与裁剪半径）
   * @param {string} props.idSeed  唯一后缀（同页多个气泡必须不同）
   * @param {string} props.tone    'ok' | 'warn' | 'low'（不传则按 percent 自动分档）
   */
  return function WaterLevel(props) {
    const p = props || {}
    const size = Math.max(12, Number(p.size) || 60)
    const percent = Math.max(0, Math.min(100, Number(p.percent) || 0))
    /* 参考项目里 `percentage` 是「已用 token%」，所以水面高度 = 剩余量；
       我们这边传入的 percent 就直接是**水面高度**（0=空、100=满），语义更直白：
       水位线 = 从底部往上 percent%。颜色仍按参考项目的三档（够/紧张/见底）。 */
    const tone = p.tone || (percent >= 50 ? 'ok' : (percent >= 10 ? 'warn' : 'low'))
    const waveY = size - (percent / 100) * size
    const clipRadius = size / 2 - 2
    const clipId = `fr-clip-${p.idSeed || 'x'}`
    const waveId = `fr-wave-${p.idSeed || 'x'}`

    /* 参考项目的波浪路径：起点在左、两个控制点、T 收尾，铺满整个宽度 */
    const waveD = `M0,${waveY} Q${size * 0.25},${waveY - 2} ${size * 0.5},${waveY} T${size},${waveY}`
    const waveD2 = `M0,${waveY} Q${size * 0.25},${waveY + 2} ${size * 0.5},${waveY} T${size},${waveY}`

    return h('span', { className: `fr-water-svg fr-tone-${tone}`, 'aria-hidden': 'true' },
      /* 1) 水位线以下的填充 */
      h('svg', { className: 'fr-water-fill-svg', viewBox: `0 0 ${size} ${size}`, focusable: 'false' },
        h('defs', null, h('clipPath', { id: clipId }, h('circle', { cx: size / 2, cy: size / 2, r: clipRadius }))),
        h('rect', {
          x: 0,
          y: waveY,
          width: size,
          height: Math.max(0, size - waveY),
          className: 'fr-water-liquid',
          clipPath: `url(#${clipId})`,
        }),
      ),
      /* 2) 水面那条会动的波浪线 */
      h('svg', { className: 'fr-water-fill-svg', viewBox: `0 0 ${size} ${size}`, focusable: 'false' },
        h('defs', null, h('clipPath', { id: waveId }, h('circle', { cx: size / 2, cy: size / 2, r: clipRadius }))),
        h('g', { clipPath: `url(#${waveId})` },
          h('path', { className: 'fr-water-wave', d: waveD, strokeWidth: 2, fill: 'none' },
            /* SMIL：跟参考项目一样在 3 秒里上下 ±2px 来回（Chrome/Safari 都支持） */
            h('animate', {
              attributeName: 'd',
              dur: '3s',
              repeatCount: 'indefinite',
              values: `${waveD};${waveD2};${waveD}`,
            }),
          ),
        ),
      ),
    )
  }
}

/**
 * 气泡墙（`ClaudeModelBubblesColumn` 的 dashboard-desktop 版忠实搬运）。
 *
 * @param {object} deps { h }
 * @returns 组件：props = { bubbles, hoveredId, onHover, onSelect, onOpenSession, canOpenSession }
 *   bubbles: [{ id, label, title, state, percent, breathing, hasSession, tone }]
 *     - state: 'running' | 'waiting' | 'suspended' | 'idle'
 *     - percent: 0..100 水位（没有就不画）
 */
export function createBubbleWall(deps) {
  const h = (deps && deps.h) || ((type, props, ...kids) => ({ type, props, kids }))
  const WaterLevel = createWaterLevel(deps)

  return function BubbleWall(props) {
    const p = props || {}
    const list = Array.isArray(p.bubbles) ? p.bubbles.filter(Boolean) : []
    if (!list.length) return null
    const hoveredId = p.hoveredId == null ? null : String(p.hoveredId)
    const cap = Math.min(DASHBOARD_LAYOUT.maxBubbles, DASHBOARD_POSITIONS.length, list.length)
    /* 参考表是 8 个点的满配。只有 3~6 个时若照抄前几个点，会全挤在右上、左下大片留黑；
       所以按数量预挑一组更均衡的点（仍是参考表里的坐标，只是换用哪几个）。 */
    const order = SPARSE_ORDER[cap] || null
    const slotAt = (index) => DASHBOARD_POSITIONS[(order ? order[index] : index) % DASHBOARD_POSITIONS.length]

    return h('div', {
      className: 'fr-bubbles',
      style: { height: `${DASHBOARD_LAYOUT.height}px` },
      role: 'list',
      'aria-label': '任务气泡墙',
    }, list.slice(0, cap).map((bubble, index) => {
      const pos = slotAt(index)
      const isRunning = bubble.state === 'running'
      const isSuspended = bubble.state === 'suspended'
      const isIdle = bubble.state === 'idle'
      const classes = ['fr-bubble-orb']
      if (isRunning) classes.push('is-running')
      if (isSuspended) classes.push('is-suspended')
      if (isIdle) classes.push('is-idle')
      if (String(bubble.id) === hoveredId) classes.push('is-hovered')
      const canOpen = bubble.hasSession === true
      const meta = [
        bubble.title || bubble.label || '',
        isRunning ? '运行中' : (isSuspended ? '挂起' : (isIdle ? '未开始' : '等待中')),
        bubble.elapsedText && bubble.elapsedText !== '—' ? bubble.elapsedText : '',
      ].filter(Boolean).join(' · ')

      return h('div', {
        key: bubble.id,
        className: 'fr-bubble-slot',
        style: {
          top: pos.top,
          left: pos.left,
          width: `${pos.size}px`,
          height: `${pos.size}px`,
          /* 参考项目：每个气泡按索引错开 speed 与 delay，整体是在「漂浮」 */
          animation: `fr-float ${(3 + index * 0.5).toFixed(1)}s ease-in-out infinite`,
          animationDelay: `${(index * 0.3).toFixed(1)}s`,
        },
        role: 'listitem',
        'data-state': bubble.state || 'idle',
        'data-id': String(bubble.id),
      },
        h('button', {
          type: 'button',
          className: classes.join(' '),
          title: meta,
          'aria-label': meta,
          style: { '--fr-orb-size': `${pos.size}px`, '--fr-orb-label': `${DASHBOARD_LAYOUT.labelSize}px` },
          onMouseEnter: () => { if (typeof p.onHover === 'function') p.onHover(bubble.id) },
          onMouseLeave: () => { if (typeof p.onHover === 'function') p.onHover(null) },
          onClick: () => { if (typeof p.onSelect === 'function') p.onSelect(bubble.id) },
          onDoubleClick: () => { if (canOpen && typeof p.onOpenSession === 'function') p.onOpenSession(bubble.sessionId, bubble.title) },
        },
          /* 高光：参考项目在圆内左上角放一团模糊白光（+ 右上一个更小的点），做出球感 */
          h('span', { className: 'fr-orb-shine', 'aria-hidden': 'true' }),
          h('span', { className: 'fr-orb-spark', 'aria-hidden': 'true' }),
          /* 参考项目 dashboard 版：**绿泡始终画水位**（percent 为 0 时就是一条贴顶的水面线）。
             水位语义见文件头：跑了多久 / 当前最长那条跑了多久。 */
          /* 运行中的水一律绿色：状态由外圈发光表达，水位只表达「跑了多久」，
             两者用同一色系，避免出现「绿光 + 黄水」这种自相矛盾的视觉语言。 */
          isRunning
            ? h(WaterLevel, { percent: bubble.percent, size: pos.size, tone: 'ok', idSeed: `orb-${bubble.id}` })
            : null,
          h('span', { className: 'fr-orb-label' }, bubble.label || '·'),
        ),
        /* 参考项目：hover 时在气泡上方弹出说明卡（名字 + 状态 + 水位百分比） */
        String(bubble.id) === hoveredId
          ? h('span', { className: 'fr-orb-tip', role: 'tooltip' },
            h('span', { className: 'fr-orb-tip-name' }, bubble.title || bubble.label || ''),
            h('span', { className: 'fr-orb-tip-meta' }, `${isRunning ? '运行中' : (isSuspended ? '挂起' : (isIdle ? '未开始' : '等待中'))}`
              + (bubble.percent > 0 ? ` · 水位 ${Math.round(bubble.percent)}%` : '')),
            h('span', { className: 'fr-orb-tip-hint' }, canOpen ? '双击打开会话' : '这条任务没有绑定会话'),
          )
          : null,
      )
    }))
  }
}

/**
 * 把运行页的气泡数据映射成气泡墙要的形状（纯函数，方便测试）。
 * 尺寸不再由我们拍脑袋分档：**位置表里的尺寸已经是 55/52/48/45/38/35/32/28**，
 * 谁排前面谁就大 —— 排前面的是「正在跑 + 跑得最久」的，所以大小天然表达紧迫度。
 */
export function toOrbWall(bubbles, opts) {
  const list = Array.isArray(bubbles) ? bubbles.filter((row) => row && row.id && row.state !== 'done') : []
  const o = opts || {}
  const maxElapsed = list.reduce((max, row) => Math.max(max, Number(row.elapsed) || 0), 0)
  const sorted = list.slice().sort((a, b) => {
    const rank = (row) => (row.state === 'running' ? 0 : (row.state === 'suspended' ? 1 : (row.state === 'idle' ? 3 : 2)))
    const diff = rank(a) - rank(b)
    if (diff !== 0) return diff
    const elapsed = (Number(b.elapsed) || 0) - (Number(a.elapsed) || 0)
    if (elapsed !== 0) return elapsed
    return (Number(a.no) || 0) - (Number(b.no) || 0)
  })
  const max = Math.max(1, Math.min(Number(o.max) || DASHBOARD_LAYOUT.maxBubbles, DASHBOARD_POSITIONS.length))
  const shown = sorted.slice(0, max)
  const hidden = Math.max(0, sorted.length - shown.length)
  return {
    items: shown.map((row) => ({
      id: row.id,
      label: String(row.no || '').trim() || String(row.id).slice(-3),
      title: row.title,
      state: row.state,
      sessionId: row.sessionId,
      hasSession: Boolean(row.sessionId),
      elapsedText: row.elapsedText,
      /* 水位 = 这条跑了多久 / 当前最长的那条跑了多久（没有运行时间 → 不画水） */
      percent: maxElapsed > 0 && row.state === 'running' ? Math.round(((Number(row.elapsed) || 0) / maxElapsed) * 100) : 0,
    })),
    total: sorted.length,
    hidden,
    maxElapsed,
  }
}
