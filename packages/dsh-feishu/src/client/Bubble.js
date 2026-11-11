/**
 * 气泡组件（运行页的核心）—— 工厂组件，模块顶层不 import react。
 *
 * 形制照参考项目 Dashboard.tsx:69/81/91 的圆形成分（`rounded-full` + `border-2` +
 * `bg-<色>/20` + 同色光晕），颜色全部换成宿主令牌的 color-mix：
 * - 运行中：绿色描边 + 20% 底 + 光晕 + **呼吸动画**（用户口径）
 * - 已完成：绿色静态（同色但不呼吸）
 * - 阻塞 error / 挂起 warn / 等待与未开始 idle（未开始用虚线）
 *
 * 一个任务一个气泡：圈内是任务编号（等宽数字），圈下是标题（两行截断）+ 项目名 + 时长。
 * 交互：点气泡 = 选中（复用详情抽屉）；双击气泡或点右下角 ↗ = `host.openSession(sessionId)`，
 * 没有 sessionId 时按钮 disabled 且 title 说明原因（不静默失败）。
 */

const pad4 = (no) => {
  const n = Number(no)
  if (!Number.isFinite(n) || n <= 0) return ''
  return String(Math.floor(n))
}

export function createBubble(deps) {
  const { h } = deps || {}

  return function Bubble(props) {
    const p = props || {}
    const bubble = p.bubble || {}
    const size = Number(p.size) || 64
    const selected = p.selected === true
    const canOpen = bubble.canOpenSession === true && typeof p.onOpenSession === 'function'
    const classes = ['fr-bubble', `fr-tone-${bubble.tone || 'idle'}`]
    if (bubble.breathing) classes.push('is-running')
    if (bubble.dashed) classes.push('is-idle')
    if (selected) classes.push('is-selected')
    const label = bubble.no ? pad4(bubble.no) : (bubble.label || '·').slice(0, 1)

    return h('div', { className: 'fr-bubble-item' },
      h('button', {
        type: 'button',
        className: classes.join(' '),
        style: { '--fr-size': `${size}px` },
        'data-state': bubble.state || 'idle',
        'aria-pressed': selected ? 'true' : 'false',
        'aria-label': `${bubble.title || bubble.id}（${bubble.label || ''}）`,
        title: `${bubble.title || ''} · ${bubble.label || ''}${bubble.elapsedText && bubble.elapsedText !== '—' ? ` · ${bubble.elapsedText}` : ''}`,
        onClick: () => { if (typeof p.onSelect === 'function') p.onSelect(bubble.id) },
        onDoubleClick: () => { if (canOpen) p.onOpenSession(bubble.sessionId, bubble.title) },
      },
        h('span', { className: 'fr-bubble-num' }, label),
        bubble.breathing ? h('span', { className: 'fr-bubble-pulse', 'aria-hidden': 'true' }) : null,
      ),
      h('div', { className: 'fr-bubble-caption' },
        h('span', { className: 'fr-bubble-title', title: bubble.title }, bubble.title || bubble.id),
        h('span', { className: 'fr-bubble-meta' },
          h('span', { className: 'fr-bubble-ws', title: bubble.workspaceTitle }, bubble.workspaceTitle || ''),
          h('span', { className: 'fr-bubble-time' }, bubble.elapsedText && bubble.elapsedText !== '—' ? bubble.elapsedText : ''),
        ),
        typeof p.onOpenSession === 'function'
          ? h('button', {
            type: 'button',
            className: 'fr-bubble-go',
            disabled: !bubble.canOpenSession,
            title: bubble.canOpenSession ? '打开这条任务的会话' : '这个任务没有绑定会话',
            'aria-label': bubble.canOpenSession ? '打开会话' : '没有绑定会话',
            onClick: () => { if (bubble.canOpenSession) p.onOpenSession(bubble.sessionId, bubble.title) },
          }, '↗')
          : null,
      ),
    )
  }
}

export default createBubble

/**
 * 「空气泡水位」—— 完全复现参考站的**经验值水位条** `BaseView.tsx:87-97`：
 *
 *   <div class="w-full h-4 bg-black/40 rounded-full overflow-hidden border border-yellow-600/20">
 *     <motion.div initial={{width:0}} animate={{width:`${expPercent}%`}}
 *                 transition={{duration:1, ease:'easeOut', delay:0.3}}
 *                 class="h-full bg-gradient-to-r from-yellow-600 via-orange-500 to-yellow-600 relative">
 *       <div class="absolute inset-0 bg-gradient-to-r from-transparent via-white/30 to-transparent animate-pulse" />
 *     </motion.div>
 *   </div>
 *
 * 三件事一一对应（颜色换成宿主令牌，`fr-` 段在 dashboardStyles.js）：
 * 1. 轨道：16px 高（`size='sm'` 是 8px 迷你版）、圆角 999px、深色底 + 1px 描边、overflow hidden
 * 2. 填充：**三段** linear-gradient（左/中/右三个色标，中间那道是另一种色相），宽度 = pct
 * 3. 横扫高光：填充内叠一条 `transparent → 高光 30% → transparent`，`fr-water-shine` 循环 2.4s
 * 宽度有入场动画：`fr-water-rise` 0 → 目标宽度，easeOut 1s，延迟 0.3s（首次渲染就能看到水位涨上去）。
 * `prefers-reduced-motion` 下两条动画都关掉，宽度直接落位。
 */
export function createWaterLevel(deps) {
  const { h } = deps || {}

  return function WaterLevel(props) {
    const p = props || {}
    const pct = Math.max(0, Math.min(100, Number(p.pct) || 0))
    const size = p.size === 'sm' ? 'sm' : 'md'
    const tone = p.tone ? ` fr-tone-${p.tone}` : ''
    const label = p.label || ''
    return h('div', {
      className: `fr-water fr-water-${size}${tone}`,
      role: 'progressbar',
      'aria-valuenow': Math.round(pct),
      'aria-valuemin': 0,
      'aria-valuemax': 100,
      'aria-label': label ? `${label} ${Math.round(pct)}%` : `${Math.round(pct)}%`,
      title: label ? `${label} ${Math.round(pct)}%` : `${Math.round(pct)}%`,
    },
      h('span', {
        className: 'fr-water-fill',
        style: { '--fr-water-pct': `${pct}%` },
      },
        h('span', { className: 'fr-water-shine', 'aria-hidden': 'true' }),
      ),
    )
  }
}

