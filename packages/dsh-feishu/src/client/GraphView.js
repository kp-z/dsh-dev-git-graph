/**
 * 主视图：关系图（一个自定义目录 = 恰好一张图、一套坐标系）—— 工厂组件，模块顶层不 import react。
 *
 * 一张画布（task-13 起）：
 * - 一个目录 = 一张画布：该目录的**全部任务一次性布局**，不再按项目切泳道/分块；
 * - 横向列 = 依赖深度（只在 depends_on 上分层），列太长会折成多根物理列；行 = 列内序号；
 * - 项目身份靠**节点分色**（--fo-deco-N）+ **图头图例**；跨项目的边在同一坐标系里天然直连；
 * - 实线箭头 = depends_on，虚线 = derived_from，点线 = temporal（时间先后，不阻塞）；端点在图外的补 ghost 节点（虚线框，不可点选）；
 * - 节点可点、可 Tab、可 Enter/Space，选中项与它相连的边一起高亮。
 *
 * task-15：
 * - 节点换成参考项目 WorkflowEditor 的 **workflow 式三段卡片**（左动作列 | 中信息 | 右状态）；
 * - **拖动**：pointerdown 跟手、松手吸附 40px 网格，位置按「图 key + 任务 id」交给宿主的 nodePos；
 * - **聚焦**：聚焦的节点是主角，同图其余节点降透明度；点空白 / Esc 取消；
 * - **跳会话**：动作列第一个按钮 = host.openSession（不可用时 disabled + title 说明原因）。
 *
 * props：
 *   graphs        layoutScope(...).graphs（每张图自带 nodes/edges/legend/width/height/top）
 *   selectedId    当前选中的任务 id（高亮相连边、给卡片描边）
 *   focusedId     当前聚焦的任务 id（同图其余节点降透明度）
 *   nodePos       { 图 key: { 任务 id: {x,y} } } 本地拖动位置（宿主从 store 读写）
 *   onOpenTask(id) onFocusTask(id) onNodeMove(graphKey,id,pos) onResetLayout(graphKey) onBlur()
 *   hostReady / hostReason / onOpenSession(sessionId, title)
 */

import { cardGeometry, describeNode, describeNodeCard, edgePath, snapToGrid, statusLabel } from '../overview/layout.js'
import { decoVar } from './styles.js'

function safeId(value) {
  return String(value == null ? '' : value).replace(/[^A-Za-z0-9_-]/g, '_')
}

/** band / node 的分色：色槽来自 styles.js 的 --fo-deco-N（宿主令牌派生），组件不写死颜色。 */
function decoStyle(colorRef) {
  if (colorRef == null || !(Number(colorRef) >= 0)) return undefined
  return { '--fo-c': decoVar(colorRef) }
}

const num = (value, fallback) => {
  const n = Number(value)
  return isFinite(n) ? n : fallback
}

/** 动作按钮的图标（14px 口径：12×12 线稿，stroke 走 currentColor 之外的 CSS 变量）。 */
const ACTION_ICONS = {
  open: 'M3 7 L7.4 2.6 M4 2.6 H7.4 V6',
  focus: 'M6 2.4 v1.6 M6 8 v1.6 M2.4 6 h1.6 M8 6 h1.6 M6 4.4 a1.6 1.6 0 1 0 0 3.2 a1.6 1.6 0 1 0 0 -3.2',
}

export function createGraphView(deps) {
  const { h, React } = deps || {}
  const { useCallback, useRef, useState } = React

  return function GraphView(props) {
    const {
      graphs, selectedId = '', focusedId = '', nodePos, onOpenTask, onFocusTask,
      onNodeMove, onResetLayout, onBlur, hostReady, hostReason, onOpenSession,
    } = props || {}
    const list = Array.isArray(graphs) ? graphs : []
    const [drag, setDrag] = useState(null)
    /* 拖动过就不算点击：pointerup 之后浏览器还会补一个 click，用它把选中/详情挡掉。 */
    const dragMoved = useRef(false)
    const svgRefs = useRef({})
    const nodeRefs = useRef({})

    const posOf = useCallback((graphKey, node) => {
      const bag = nodePos && typeof nodePos === 'object' ? nodePos[graphKey] : null
      const hit = bag && typeof bag === 'object' ? bag[node.id] : null
      if (!hit || !isFinite(Number(hit.x)) || !isFinite(Number(hit.y))) return { x: node.x, y: node.y }
      return { x: Number(hit.x), y: Number(hit.y) }
    }, [nodePos])

    /* 视图缩放：viewBox 是 layout 坐标系，元素是 CSS 尺寸，跟随指针要除以这个比例。 */
    const scaleOf = useCallback((graph) => {
      const el = svgRefs.current[graph.key]
      if (!el || typeof el.getBoundingClientRect !== 'function') return 1
      let rect = null
      try { rect = el.getBoundingClientRect() } catch (error) { rect = null }
      if (!rect || !rect.width || !rect.height || !graph.width || !graph.height) return 1
      const scale = Math.min(rect.width / graph.width, rect.height / graph.height)
      return isFinite(scale) && scale > 0 ? scale : 1
    }, [])

    const beginDrag = (event, graph, node) => {
      if (typeof event.stopPropagation === 'function') event.stopPropagation()
      if (event.button != null && Number(event.button) !== 0) return
      dragMoved.current = false
      const target = event.currentTarget
      if (target && typeof target.setPointerCapture === 'function' && event.pointerId != null) {
        try { target.setPointerCapture(event.pointerId) } catch (error) { /* 指针已经没了就算了 */ }
      }
      setDrag({
        key: node.key,
        graphKey: graph.key,
        id: node.id,
        clientX: num(event.clientX, 0),
        clientY: num(event.clientY, 0),
        dx: 0,
        dy: 0,
      })
    }

    const moveDrag = (event, graph, node) => {
      if (!drag || drag.key !== node.key) return
      const scale = scaleOf(graph)
      const dx = (num(event.clientX, 0) - drag.clientX) / scale
      const dy = (num(event.clientY, 0) - drag.clientY) / scale
      if (Math.abs(dx) > 3 || Math.abs(dy) > 3) {
        dragMoved.current = true
        if (typeof event.preventDefault === 'function') event.preventDefault()
      }
      setDrag({ ...drag, dx, dy })
    }

    const endDrag = (event, graph, node) => {
      if (!drag || drag.key !== node.key) return
      if (dragMoved.current) {
        const base = posOf(graph.key, node)
        if (typeof onNodeMove === 'function') {
          /* 松手吸附 40px 网格（与参考站 GRID_SIZE 一致），并且不许拖到画布左上角之外。 */
          onNodeMove(graph.key, node.id, {
            x: Math.max(0, snapToGrid(base.x + drag.dx)),
            y: Math.max(0, snapToGrid(base.y + drag.dy)),
          })
        }
      }
      setDrag(null)
    }

    /** 方向键走位：在同图节点里挑「朝那个方向、且横向偏移最小」的一个。 */
    const neighborOf = (graph, node, direction, at) => {
      const here = at(node)
      let best = null
      let bestScore = Infinity
      graph.nodes.forEach((other) => {
        if (other === node || other.ghost === true) return
        const there = at(other)
        const dx = there.x - here.x
        const dy = there.y - here.y
        const forward = direction === 'ArrowRight' ? dx : direction === 'ArrowLeft' ? -dx : direction === 'ArrowDown' ? dy : -dy
        if (forward <= 1) return
        const cross = (direction === 'ArrowRight' || direction === 'ArrowLeft') ? Math.abs(dy) : Math.abs(dx)
        const score = forward + cross * 2
        if (score < bestScore) { bestScore = score; best = other }
      })
      return best
    }

    const onNodeKeyDown = (event, graph, node, at) => {
      const key = String((event && event.key) || '')
      const stop = () => { if (typeof event.preventDefault === 'function') event.preventDefault() }
      if (key === 'Enter' || key === ' ' || key === 'Spacebar') {
        stop()
        if (typeof onOpenTask === 'function') onOpenTask(node.id, node)
        return
      }
      if (key === 'f' || key === 'F') {
        stop()
        if (typeof onFocusTask === 'function') onFocusTask(node.id)
        return
      }
      if (key === 'Escape') {
        stop()
        if (typeof onBlur === 'function') onBlur()
        return
      }
      if (key !== 'ArrowLeft' && key !== 'ArrowRight' && key !== 'ArrowUp' && key !== 'ArrowDown') return
      stop()
      const next = neighborOf(graph, node, key, at)
      if (!next) return
      if (typeof onFocusTask === 'function') onFocusTask(next.id)
      const el = nodeRefs.current[next.key]
      if (el && typeof el.focus === 'function') {
        try { el.focus() } catch (error) { /* 元素换了/没了就算了 */ }
      }
    }

    if (!list.length) {
      return h('div', { className: 'fo-placeholder' },
        h('div', { className: 'fo-placeholder-title' }, '这个范围里没有可画的图'),
        h('div', { className: 'fo-placeholder-body' }, '把项目拖进自定义目录，或者切回「全部任务」。'),
      )
    }

    return h('div', { className: 'fo-graphs' }, list.map((graph, index) => {
      const markerBase = `fo-arrow-${index}-${safeId(graph.key)}`
      const nodes = Array.isArray(graph.nodes) ? graph.nodes : []
      const edges = Array.isArray(graph.edges) ? graph.edges : []
      const ghosts = nodes.filter((node) => node.ghost === true)
      const taskCount = nodes.length - ghosts.length
      const legend = Array.isArray(graph.legend) ? graph.legend : []
      const viewBox = `0 ${graph.top || 0} ${Math.max(1, graph.width)} ${Math.max(1, graph.height)}`
      const label = graph.kind === 'ungrouped'
        ? `未分组：${taskCount} 个任务`
        : `${graph.label}：${(graph.projects || []).length} 个项目、${taskCount} 个任务${graph.kind === 'group' ? '画在同一张图里' : ''}`
      const localBag = nodePos && typeof nodePos === 'object' ? nodePos[graph.key] : null
      const hasLocal = !!localBag && typeof localBag === 'object' && Object.keys(localBag).length > 0
      const anyFocused = !!focusedId && nodes.some((node) => node.ghost !== true && node.id === focusedId)

      /* 拖动中的那个节点跟手（不吸附），其余用本地位置或布局位置。 */
      const at = (node) => {
        if (drag && drag.key === node.key) {
          const base = posOf(graph.key, node)
          return { x: base.x + drag.dx, y: base.y + drag.dy }
        }
        return posOf(graph.key, node)
      }
      const placed = nodes.map((node) => ({ node, pos: at(node) }))
      const byId = new Map()
      placed.forEach((row) => { byId.set(row.node.id, row) })

      /* 箭头：6×6 实心三角，fill 跟边同色（与参考站 WorkflowEditor 的 marker 一寸不差） */
      const defs = h('defs', null, ['depends_on', 'derived_from', 'temporal'].map((kind) => h('marker', {
        key: kind,
        id: `${markerBase}-${kind}`,
        viewBox: '0 0 6 6',
        refX: '5',
        refY: '3',
        markerWidth: '6',
        markerHeight: '6',
        markerUnits: 'userSpaceOnUse',
        orient: 'auto',
      }, h('path', { className: 'fo-arrow', 'data-kind': kind, d: 'M 0 0 L 6 3 L 0 6 z' }))))

      /* 边的端点跟着节点位置走：拖动时实时重算折线，别让线头留在原地。 */
      const edgeLayer = h('g', { 'aria-hidden': 'true' }, edges.map((edge) => {
        const from = byId.get(edge.from)
        const to = byId.get(edge.to)
        /* 端点缺了就退回 layout 给的 path（理论上不会发生，纯防御）。 */
        const geo = from && to
          ? edgePath(
            { x: from.pos.x, y: from.pos.y, w: from.node.w, h: from.node.h },
            { x: to.pos.x, y: to.pos.y, w: to.node.w, h: to.node.h },
          )
          : { path: edge.path }
        return h('path', {
          key: edge.key,
          className: `fo-edge${(selectedId && (edge.from === selectedId || edge.to === selectedId)) ? ' is-active' : ''}`,
          'data-kind': edge.kind,
          'data-from': edge.from,
          'data-to': edge.to,
          d: geo.path,
          'marker-end': `url(#${markerBase}-${edge.kind})`,
        })
      }))

      const nodeLayer = h('g', null, placed.map(({ node, pos }) => {
        const interactive = node.ghost !== true
        const selected = !!selectedId && interactive && node.id === selectedId
        const focused = !!focusedId && interactive && node.id === focusedId
        const dimmed = anyFocused && node.id !== focusedId
        const card = cardGeometry({ ...node, x: pos.x, y: pos.y })
        const activate = () => { if (interactive && typeof onOpenTask === 'function') onOpenTask(node.id, node) }
        const state = String(node.state || 'ghost')
        /* 三段的信息不能再重复：eyebrow 走编号/id，状态胶囊走状态词，meta 走计数 + 归属。 */
        const eyebrow = node.no > 0 ? `T${node.no}` : String(node.id).slice(0, 8).toUpperCase()
        const children = [
          h('title', { key: 'tip' }, `${node.fullTitle || node.id}${node.ghost ? (node.missing ? '（任务不存在，仅剩关系）' : '（属于其它分组）') : ''}`),
          h('rect', {
            key: 'bg',
            className: 'fo-node-bg',
            x: card.x, y: card.y, width: card.w, height: card.h, rx: card.radius,
          }),
        ]
        /* 项目分色：卡片左缘的 3px 色条（图例里那个颜色的唯一落点），状态色走 --fo-s。 */
        if (interactive) {
          children.push(h('rect', {
            key: 'spine',
            className: 'fo-node-spine',
            x: card.x + 1, y: card.y + 12, width: 3, height: Math.max(4, card.h - 24), rx: 1.5,
          }))
        }
        /* 中段：编号 eyebrow（状态色）+ 标题 + meta（前置/后置/阻塞计数 + 项目名） */
        children.push(h('text', {
          key: 'eyebrow', className: 'fo-node-eyebrow', x: card.text.x, y: card.text.eyebrow,
        }, eyebrow))
        children.push(h('text', { key: 'title', className: 'fo-node-title', x: card.text.x, y: card.text.title }, node.label || node.id))
        children.push(h('text', { key: 'meta', className: 'fo-node-meta', x: card.text.x, y: card.text.meta }, describeNodeCard(node)))
        /* 右段：状态胶囊（14% 底 + 34% 描边 + 状态色文字 + 带光晕的状态点） */
        children.push(h('rect', {
          key: 'status',
          className: 'fo-node-status',
          x: card.status.x, y: card.status.y, width: card.status.w, height: card.status.h, rx: card.status.radius,
        }))
        children.push(h('circle', {
          key: 'status-dot',
          className: 'fo-node-dot',
          cx: card.status.x + 8, cy: card.status.y + card.status.h / 2, r: 2.6,
        }))
        children.push(h('text', {
          key: 'status-text',
          className: 'fo-node-status-text',
          x: card.status.x + 15,
          y: card.status.y + card.status.h / 2 + 3,
        }, statusLabel(node)))
        /* 左段：竖排动作按钮（打开会话 / 聚焦到节点）。disabled 时 title 说明原因，不静默。 */
        if (interactive) {
          const sessionId = String(node.sessionId || '')
          const openReady = !!hostReady && !!sessionId
          const openTitle = !hostReady
            ? (String(hostReason || '') || '当前宿主不支持打开会话')
            : (!sessionId ? '这个任务没有绑定会话' : '打开会话')
          const actions = [
            {
              key: 'open',
              label: '打开会话',
              title: openTitle,
              disabled: !openReady,
              run: () => { if (openReady && typeof onOpenSession === 'function') onOpenSession(sessionId, node.fullTitle || node.label || '') },
            },
            {
              key: 'focus',
              label: '聚焦到节点',
              title: '聚焦到节点',
              disabled: false,
              run: () => { if (typeof onFocusTask === 'function') onFocusTask(node.id) },
            },
          ]
          card.action.buttons.forEach((box, boxIndex) => {
            const action = actions[boxIndex]
            if (!action) return
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
          })
        }

        return h('g', {
          key: node.key,
          ref: (el) => { nodeRefs.current[node.key] = el },
          className: `fo-node${node.ghost ? ' is-ghost' : ''}${selected ? ' is-selected' : ''}${dimmed ? ' is-dimmed' : ''}`,
          'data-id': node.id,
          'data-state': state,
          'data-focused': focused ? '1' : '0',
          'data-dimmed': dimmed ? '1' : '0',
          'aria-current': focused ? 'true' : undefined,
          tabIndex: interactive ? 0 : -1,
          role: interactive ? 'button' : 'img',
          'aria-label': describeNode(node),
          style: decoStyle(node.colorRef),
          onPointerDown: interactive ? (event) => beginDrag(event, graph, node) : undefined,
          onPointerMove: interactive ? (event) => moveDrag(event, graph, node) : undefined,
          onPointerUp: interactive ? (event) => endDrag(event, graph, node) : undefined,
          onClick: interactive ? () => {
            if (dragMoved.current) { dragMoved.current = false; return }
            activate()
          } : undefined,
          onKeyDown: interactive ? (event) => onNodeKeyDown(event, graph, node, at) : undefined,
        }, children)
      }))

      return h('section', {
        key: graph.key || index,
        className: 'fo-graph',
        'aria-label': label,
        style: { '--fo-i': Math.min(index, 7) },
      },
        h('div', { className: 'fo-graph-head' },
          h('span', { className: 'fo-graph-name' }, graph.kind === 'ungrouped' ? '未分组' : graph.label),
          h('div', { className: 'fo-graph-legend', 'aria-label': '项目图例' },
            legend.map((item) => h('span', { key: item.key, className: 'fo-legend-item', title: item.label },
              h('i', { className: 'fo-legend-dot', style: { '--fo-c': decoVar(item.colorRef) }, 'aria-hidden': 'true' }),
              h('span', { className: 'fo-legend-label' }, item.label),
              h('span', { className: 'fo-legend-count' }, String(item.count)),
            )),
          ),
          h('div', { className: 'fo-graph-actions' },
            h('button', {
              type: 'button',
              className: 'fo-btn',
              'data-size': 'sm',
              'data-variant': 'ghost',
              disabled: !hasLocal,
              title: hasLocal ? '清掉这张图的本地拖动位置，回到自动布局' : '这张图还没有拖动过',
              onClick: () => { if (typeof onResetLayout === 'function') onResetLayout(graph.key) },
            }, '复位布局'),
          ),
        ),
        /* 画布：网格层在最底、不拦点击；SVG 在上层。空图也显示网格（参考站画布一直在）。
           点空白（画布底/网格/SVG 空白处，不在任何节点里）= 取消聚焦。 */
        h('div', {
          className: 'fo-canvas',
          onClick: (event) => {
            if (typeof onBlur !== 'function') return
            if (insideNode(event && event.target, event && event.currentTarget)) return
            onBlur()
          },
        },
          h('div', { className: 'fo-grid', 'aria-hidden': 'true' }),
          nodes.length
            ? h('div', { className: 'fo-graph-body' },
              h('svg', {
                ref: (el) => { svgRefs.current[graph.key] = el },
                className: 'fo-svg',
                viewBox,
                /* 铺满画布：viewBox 仍是 layout 坐标系，交给浏览器按 meet 自适应缩放 */
                width: '100%',
                height: '100%',
                preserveAspectRatio: 'xMidYMid meet',
                /* role=group 而不是 img：图里的节点本身是可聚焦的 button，img 会把它们从无障碍树里挡掉。 */
                role: 'group',
                'aria-label': label,
                'data-graph': graph.key,
              }, defs, edgeLayer, nodeLayer))
            : h('div', { className: 'fo-placeholder' },
              h('div', { className: 'fo-placeholder-title' }, graph.kind === 'ungrouped' ? '没有未分组的项目' : '这个目录里还没有在场的工作区'),
              h('div', { className: 'fo-placeholder-body' }, graph.kind === 'ungrouped'
                ? '所有项目都已经归入某个自定义目录。'
                : '它的成员当前都不在任务集里（可能被删或改名）。把左栏的项目拖进这个目录即可。'),
            ),
        ),
      )
    }))
  }
}

/** 事件目标是不是落在某个节点卡片里（点空白才算「取消聚焦」）。 */
function insideNode(target, root) {
  let cur = target
  while (cur && cur !== root) {
    const cls = typeof cur.getAttribute === 'function' ? cur.getAttribute('class') : (typeof cur.className === 'string' ? cur.className : '')
    if (cls && String(cls).split(/\s+/).indexOf('fo-node') >= 0) return true
    cur = cur.parentNode
  }
  return false
}

export default createGraphView
