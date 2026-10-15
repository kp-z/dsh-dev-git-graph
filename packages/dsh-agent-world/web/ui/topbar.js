/*
 * 顶栏（R32）—— 品牌 · 视图切换 · 状态胶囊 · 命令。
 *
 * ── 为什么状态做成"胶囊"而不是一行小字 ──────────────────────────────────────
 *
 * 原来是一串用 ` · ` 拼起来的文字，长了以后没人能一眼看出"现在到底正不正常"。
 * 现在每件事一个胶囊：**颜色即结论**（绿=正常、琥珀=要留意、红=出错了），
 * 文字只是细节。DESIGN.md 第零节第 5 条说的"字号层级扁平"也是这个问题的一半。
 *
 * ── 性能 ────────────────────────────────────────────────────────────────────
 *
 * 这个面板每秒会被调用十几次（渲染循环里），所以**先比签名再动 DOM**：
 * 内容没变就一次 innerHTML 都不做。
 */

/**
 * 建顶栏。
 *
 * @param {object} options
 * @param {HTMLElement} options.root - 顶栏容器。
 * @param {(mode: 'top'|'3d') => void} options.onMode
 * @param {(kind: 'pause'|'resume') => void} options.onCommand
 * @param {() => void} [options.onToggleDrawer]
 * @param {Document} [options.document]
 */
import { agentStateLabel } from './labels.js'

export function createTopbar(options) {
  const doc = options.document ?? globalThis.document
  const root = options.root
  const ready = root !== null && root !== undefined
  const $status = ready ? root.querySelector('.topbar-status') : null
  const $top = ready ? root.querySelector('#view-top') : null
  const $three = ready ? root.querySelector('#view-3d') : null
  const $pause = ready ? root.querySelector('#cmd-pause') : null
  const $resume = ready ? root.querySelector('#cmd-resume') : null
  const $drawer = ready ? root.querySelector('#drawer-toggle') : null
  let lastSignature = null
  let currentMode = 'top'

  const chip = (text, tone, extra = '') =>
    `<span class="chip${tone === undefined ? '' : ` chip-${tone}`}${extra}">${text}</span>`

  if (ready) {
    $top?.addEventListener('click', () => options.onMode?.('top'))
    $three?.addEventListener('click', () => options.onMode?.('3d'))
    $pause?.addEventListener('click', () => options.onCommand?.('pause'))
    $resume?.addEventListener('click', () => options.onCommand?.('resume'))
    $drawer?.addEventListener('click', () => options.onToggleDrawer?.())
  }

  /**
   * 重画状态区。
   *
   * @param {object} info
   * @param {object} info.world
   * @param {object} info.meta
   * @param {number} info.tick
   * @param {boolean} info.connected
   * @param {number} info.nextSeq
   * @param {number} info.silentForMs
   * @param {number} info.waiting
   * @param {string} [info.perf] - 3D 的真实计数（由装配处拼好）。
   */
  function render(info) {
    if (!ready || $status === null) return
    const { world, meta, tick, connected, nextSeq, silentForMs, waiting } = info
    const states = world.agents.reduce((acc, a) => ({ ...acc, [a.state]: (acc[a.state] ?? 0) + 1 }), {})
    const stateText = Object.entries(states)
      .map(([k, v]) => `${agentStateLabel(k)} ${v}`)
      .join(' · ')
    const flying = world.messages.filter((m) => (m.deliverAtTick ?? 0) > tick).length
    const stale = silentForMs > (info.staleAfterMs ?? 8000)

    const chips = [
      world.paused ? chip('已暂停', 'warn') : chip('运行中', 'ok'),
      chip(`tick <b>${tick}</b>`, 'mono'),
      connected ? chip('事件流已连接', 'ok') : chip('事件流重连中', 'warn'),
      // 数据旧了必须说出来：否则"画面不动"会被理解成"世界停了"，而那是两件事。
      stale ? chip(`${Math.round(silentForMs / 1000)} 秒没收到事件`, 'warn') : '',
      waiting > 0 ? chip(`${waiting} 句话在等回复`, 'warn') : '',
      (meta.persistErrors ?? 0) > 0 ? chip(`落盘失败 ${meta.persistErrors} 次`, 'danger') : '',
      flying > 0 ? chip(`飞行中纸条 ${flying}`, 'dim') : '',
      stateText === '' ? '' : chip(stateText, 'dim', ' chip-optional'),
      info.perf === undefined || info.perf === '' ? '' : chip(info.perf, 'mono', ' chip-optional'),
      chip(`seq ${nextSeq}`, 'dim', ' chip-optional'),
    ]
      .filter(Boolean)
      .join('')

    const signature = `${chips}|${world.paused}|${info.mode}`
    if (signature === lastSignature) return
    lastSignature = signature
    $status.innerHTML = chips
  }

  /** 视图切换的选中态。 */
  function setMode(mode) {
    currentMode = mode
    if (!ready) return
    $top?.classList.toggle('active', mode === 'top')
    $three?.classList.toggle('active', mode === '3d')
    $top?.setAttribute('aria-selected', String(mode === 'top'))
    $three?.setAttribute('aria-selected', String(mode === '3d'))
    lastSignature = null
  }

  return {
    ready,
    render,
    setMode,
    mode: () => currentMode,
    /** 抽屉开关按钮的选中态（别的地方也能开抽屉）。 */
    setDrawerOpen(open) {
      $drawer?.classList.toggle('active', open)
    },
  }
}
