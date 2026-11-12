/**
 * 任务节点卡片 —— 关系画布上的节点，**与面板里的飞书任务卡同一套设计**。
 *
 * 为什么单独一个文件：用户口径是「直接用当期飞书卡片的设计，用一个组件，注意内容隐显」。
 * 画布是 SVG，面板那张卡是 DOM，没法把同一个 DOM 组件塞进 canvas；所以这里把那张卡的
 * **结构与视觉口径**（1px 描边 / 9px 圆角 / 7-10 内边距 / 12.5px 标题 / 18px 徽标 /
 * 会话胶囊 / 优先级左侧色条）逐条搬过来，节点与 ghost 共用这一个渲染器。
 *
 * 内容隐显（用户特别点名的部分）见 GRAPH_CARD_FIELDS：
 *  - 画布上**只留**能一眼判断「这是什么、卡在哪、谁等谁」的信息；
 *  - 联系人、清单名、触发方式、文档、评论这些列表里才成立的内容**不进画布**；
 *  - 动作（打开会话 / 聚焦）收进悬停层，静止时不占视觉。
 */

import { CARD, statusLabel } from '../overview/layout.js'

/** 画布卡片上显示什么、藏什么。改这里就能改「隐显」，不用翻渲染代码。 */
export const GRAPH_CARD_FIELDS = {
  /** 三行都给足：不做简化（用户口径：「看着简化太多了，先不要简化」）。 */
  /** row1：优先级徽标 + 标题 + 会话胶囊；标题永远在，会话只在绑了会话时出现。 */
  title: 'always',
  priority: 'chip+left-bar',
  session: 'bound-session-only',
  /** row2：状态 + 关系计数 + 项目。 */
  state: 'badge',
  counts: ['predecessors', 'successors', 'temporal'],
  workspace: 'chip',
  /** row3：编号在左，动作在右（动作常显，只是压暗）。 */
  number: 'footer',
  actions: 'always',
  /** 只有列表里才成立、画布上确实放不下的（需要的人点开详情看）。 */
  hidden: ['due', 'people', 'docs', 'comments', 'reopen', 'suspensionNote', 'listName', 'trigger'],
}

/** 优先级 → 颜色（与面板 .task[data-priority] 的 border-left 一一对应）。 */
const PRIORITY_TONE = { P0: 'var(--fo-prio-p0)', P1: 'var(--fo-prio-p1)', P2: 'var(--fo-prio-p2)', P3: 'var(--fo-prio-p3)' }

/** 标题最终画出来的那串字（供渲染与测试共用）。 */
export function graphCardTitle(node, card) {
  const n = node && typeof node === 'object' ? node : {}
  const title = card && card.title ? card.title : {}
  const size = 12.5
  const width = Number(title.w) > 0 ? Number(title.w) : 200
  return fitText(n.fullTitle || n.label || n.id, width, size)
}

/** 状态徽标的语气（class 落在 --fo-b 上，颜色由 styles.js 决定）。 */
const STATE_TONE = { open: 'open', blocked: 'blocked', suspended: 'suspended', done: 'done', ghost: 'idle' }

/** 14px 线性图标：打开会话 / 聚焦。 */
const ACTION_ICONS = {
  open: 'M3 7 L7.4 2.6 M4 2.6 H7.4 V6',
  focus: 'M6 2.4 v1.6 M6 8 v1.6 M2.4 6 h1.6 M8 6 h1.6 M6 4.4 a1.6 1.6 0 1 0 0 3.2 a1.6 1.6 0 1 0 0 -3.2',
}

/** 徽标行内容：状态 + 计数。空数组表示没有可显示的徽标（纯标题卡）。 */
export function cardBadges(node) {
  const n = node && typeof node === 'object' ? node : {}
  const badges = []
  if (n.ghost === true || n.state === 'ghost') {
    badges.push({ key: 'state', label: statusLabel(n), tone: 'idle' })
    return badges
  }
  badges.push({ key: 'state', label: statusLabel(n), tone: STATE_TONE[n.state] || 'open' })
  const refs = n.refs && typeof n.refs === 'object' ? n.refs : {}
  const count = (value) => (Array.isArray(value) ? value.length : 0)
  const pre = count(refs.predecessors)
  const post = count(refs.successors)
  const time = count(refs.earlierTasks) + count(refs.laterTasks)
  if (pre) badges.push({ key: 'pre', label: `前置 ${pre}`, tone: n.state === 'blocked' ? 'blocked' : 'muted' })
  if (post) badges.push({ key: 'post', label: `后置 ${post}`, tone: 'muted' })
  if (time) badges.push({ key: 'time', label: `时间 ${time}`, tone: 'muted' })
  const project = String(n.workspaceLabel || '').trim()
  if (project) badges.push({ key: 'project', label: project, tone: 'project' })
  return badges
}

/** 粗略量宽（SVG 里没有 text-overflow）：汉字 1、ASCII 0.56，再乘字号。 */
function textWidth(value, size) {
  const s = String(value == null ? '' : value)
  let units = 0
  for (let i = 0; i < s.length; i += 1) units += s.charCodeAt(i) > 0x2e80 ? 1 : 0.56
  return units * size
}

/** 按可用宽度截断（SVG 没有 text-overflow；不截就会压到会话胶囊或出卡片）。 */
export function fitText(value, maxPx, size) {
  const s = String(value == null ? '' : value)
  if (textWidth(s, size) <= maxPx) return s
  let out = ''
  for (let i = 0; i < s.length; i += 1) {
    const next = out + s.charAt(i)
    if (textWidth(next + '…', size) > maxPx) break
    out = next
  }
  return (out.replace(/\s+$/, '') || s.slice(0, 1)) + '…'
}

export function createTaskNodeCard(deps) {
  const { h } = deps || {}

  return function taskNodeCard(input) {
    const o = input || {}
    const node = o.node || {}
    const card = o.card || {}
    const ghost = node.ghost === true
    const actions = Array.isArray(o.actions) ? o.actions : []
    const children = []

    /* 优先级：左侧 3px 色条 + 标题前的 P0-P3 徽标（与面板任务卡两处都给的做法一致）。 */
    if (!ghost && PRIORITY_TONE[node.priority]) {
      children.push(h('rect', {
        key: 'prio-bar',
        className: 'fo-node-prio',
        x: card.x + 0.5, y: card.y + 6, width: 3, height: card.h - 12, rx: 1.5,
        fill: PRIORITY_TONE[node.priority],
      }))
      if (card.prio) {
        children.push(h('g', { key: 'prio', className: 'fo-node-prio-chip', 'data-value': node.priority },
          h('rect', {
            className: 'fo-node-prio-bg',
            x: card.prio.x, y: card.prio.y, width: card.prio.w, height: card.prio.h, rx: card.prio.radius,
          }),
          h('text', {
            className: 'fo-node-prio-text',
            x: card.prio.x + card.prio.w / 2,
            y: card.prio.y + card.prio.h / 2 + 4,
            textAnchor: 'middle',
          }, node.priority),
        ))
      }
    }

    /* 标题行 */
    children.push(h('text', {
      key: 'title',
      className: 'fo-node-title',
      x: card.title.x,
      y: card.title.baseline,
    }, graphCardTitle(node, card)))

    /* 会话胶囊：只有绑了会话才出现（列表卡同一个位置、同一个形状） */
    if (card.session) {
      const s = card.session
      children.push(h('g', { key: 'sess', className: 'fo-node-sess' },
        h('rect', {
          className: 'fo-node-sess-bg',
          x: s.x, y: s.y, width: s.w, height: s.h, rx: s.radius,
        }),
        h('circle', { className: 'fo-node-sess-lamp', cx: s.x + 8, cy: s.y + s.h / 2, r: 3 }),
        h('text', {
          className: 'fo-node-sess-text',
          x: s.x + 15,
          y: s.y + s.h / 2 + 3.5,
        }, 'Session'),
      ))
    }

    /* 徽标行：状态 + 关系计数，横向排，放不下就停（绝不压到动作区）。 */
    const badges = cardBadges(node)
    let bx = card.meta.x
    const right = card.meta.right
    for (const badge of badges) {
      const padX = 6
      const width = Math.round(textWidth(badge.label, 11)) + padX * 2
      if (bx + width > right) break
      children.push(h('g', { key: `badge:${badge.key}`, className: 'fo-node-badge', 'data-tone': badge.tone },
        h('rect', {
          className: 'fo-node-badge-bg',
          x: bx, y: card.meta.y, width, height: card.meta.h, rx: CARD.BADGE_RADIUS,
        }),
        h('text', {
          className: 'fo-node-badge-text',
          x: bx + padX,
          y: card.meta.y + card.meta.h / 2 + 4,
        }, badge.label),
      ))
      bx += width + 5
    }

    /* 页脚：编号在左（与列表卡的 T编号 同一处信息）。 */
    if (!ghost && Number(node.no) > 0) {
      children.push(h('text', {
        key: 'no',
        className: 'fo-node-no',
        x: card.foot.x,
        y: card.foot.baseline,
      }, `T${node.no}`))
    }

    /* 动作：页脚右侧，**常显**（压暗，hover/聚焦/选中时提亮）。ghost 没有动作。 */
    for (const action of actions) {
      const box = (card.action.buttons || []).find((item) => item.key === action.key)
      if (!box) continue
      children.push(h('g', {
        key: `action:${action.key}`,
        className: 'fo-node-action',
        'data-key': action.key,
        'data-disabled': action.disabled ? '1' : '0',
        role: 'button',
        tabIndex: -1,
        'aria-disabled': action.disabled ? 'true' : 'false',
        'aria-label': `${action.label}${action.disabled ? `（${action.title}）` : ''}`,
        onClick: (event) => {
          if (typeof event.stopPropagation === 'function') event.stopPropagation()
          action.run()
        },
      },
        h('title', { key: 'tip' }, action.title),
        h('rect', {
          key: 'box',
          className: 'fo-node-action-bg',
          x: box.x, y: box.y, width: box.w, height: box.h, rx: box.radius,
        }),
        h('path', {
          key: 'icon',
          className: 'fo-node-action-icon',
          transform: `translate(${box.x}, ${box.y})`,
          d: ACTION_ICONS[action.key],
        }),
      ))
    }

    return children
  }
}

export default createTaskNodeCard
