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

import { cardGeometry, describeNode, edgePath, snapToGrid } from '../overview/layout.js'
import { createTaskNodeCard } from './TaskNodeCard.js'
import { decoVar } from './styles.js'

/* ============ 画布视口（缩放 / 平移）============
   纯函数放在模块顶层：组件只管把指针事件换算成「用户坐标」再丢进来，
   这样几何（尤其是「以光标为锚点缩放」）可以离线单测，不依赖 DOM。 */

export const IDENTITY_VIEW = Object.freeze({ k: 1, x: 0, y: 0 })
export const VIEW_ZOOM_MIN = 0.35
export const VIEW_ZOOM_MAX = 2.6

/** 缩放钳制：太小看不清线、太大只剩一个节点，都没有意义。 */
export function clampZoom(value) {
  const k = Number(value)
  if (!isFinite(k) || k <= 0) return 1
  return Math.min(VIEW_ZOOM_MAX, Math.max(VIEW_ZOOM_MIN, k))
}

/** 视口值归一：坏值一律退回恒等视口（不做半截缩放）。 */
export function normalizeView(raw) {
  if (!raw || typeof raw !== 'object') return IDENTITY_VIEW
  const k = Number(raw.k)
  const x = Number(raw.x)
  const y = Number(raw.y)
  if (!isFinite(k) || !isFinite(x) || !isFinite(y) || k <= 0) return IDENTITY_VIEW
  return { k: clampZoom(k), x, y }
}

/** 某个图的当前视口。 */
export function viewOf(views, key) {
  return normalizeView(views && typeof views === 'object' ? views[key] : null)
}

/**
 * 以 anchor（**视口坐标**，即 viewBox 里的位置）为锚点缩放。
 * 推导：user = content * k + t；要让 anchor 在缩放前后落在同一处，
 * 就得 t' = anchor - (anchor - t) * k'/k。
 */
export function zoomView(view, factor, anchor) {
  const cur = normalizeView(view)
  const nextK = clampZoom(cur.k * (Number(factor) || 1))
  const a = anchor && isFinite(Number(anchor.x)) && isFinite(Number(anchor.y)) ? anchor : { x: 0, y: 0 }
  const ratio = nextK / cur.k
  return { k: nextK, x: a.x - (a.x - cur.x) * ratio, y: a.y - (a.y - cur.y) * ratio }
}

/** 平移：dx/dy 是**视口坐标**下的位移（调用方负责把屏幕像素除以缩放比）。 */
export function panView(view, dx, dy) {
  const cur = normalizeView(view)
  const nx = Number(dx)
  const ny = Number(dy)
  if (!isFinite(nx) || !isFinite(ny)) return cur
  return { k: cur.k, x: cur.x + nx, y: cur.y + ny }
}

/** 让某个内容坐标点落在视口中心（聚焦时用）。 */
export function centerOn(view, point, box) {
  const cur = normalizeView(view)
  const b = box && typeof box === 'object' ? box : {}
  const width = Number(b.width) || 0
  const height = Number(b.height) || 0
  const top = Number(b.top) || 0
  const cx = Number(point && point.x)
  const cy = Number(point && point.y)
  if (!isFinite(cx) || !isFinite(cy) || !width || !height) return cur
  return { k: cur.k, x: width / 2 - cx * cur.k, y: top + height / 2 - cy * cur.k }
}

/** SVG 上的 transform：先缩放再平移（与上面所有公式同一口径）。 */
export function viewportTransform(view) {
  const v = normalizeView(view)
  if (v.k === 1 && v.x === 0 && v.y === 0) return undefined
  return `translate(${round(v.x)} ${round(v.y)}) scale(${round(v.k, 4)})`
}

const round = (value, digits = 2) => {
  const n = Number(value)
  if (!isFinite(n)) return 0
  const p = 10 ** digits
  return Math.round(n * p) / p
}

function safeId(value) {
  return String(value == null ? '' : value).replace(/[^A-Za-z0-9_-]/g, '_')
}

/** band / node 的分色：色槽来自 styles.js 的 --fo-deco-N（宿主令牌派生），组件不写死颜色。 */
function decoStyle(colorRef) {
  if (colorRef == null || !(Number(colorRef) >= 0)) return undefined
  return { '--fo-c': decoVar(colorRef) }
}

const ZOOM_STEP = 1.25

/** 边类型 / 来源的中文说法（悬停提示与图例共用一套词）。 */
export const EDGE_KIND_LABEL = { depends_on: '前置（必须等它完成）', derived_from: '来源（由它派生）', temporal: '时间先后（不阻塞）' }
export const EDGE_SOURCE_LABEL = { manual: '手动', ai: 'AI 整理', creation: '创建时记录', time: '按时间排序', feishu: '飞书原生依赖' }

/** 画布工具条的三个线性图标（20px viewBox，14px 呈现），文字退到 title/aria-label。 */
export function fitIcon(h) {
  return h('svg', { className: 'fo-btn-icon', width: 14, height: 14, viewBox: '0 0 20 20', fill: 'none', stroke: 'currentColor', strokeWidth: 1.6, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': 'true' },
    h('path', { d: 'M3 7V3h4M17 13v4h-4M3 3l5 5M17 17l-5-5' }))
}
export function resetIcon(h) {
  return h('svg', { className: 'fo-btn-icon', width: 14, height: 14, viewBox: '0 0 20 20', fill: 'none', stroke: 'currentColor', strokeWidth: 1.6, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': 'true' },
    h('path', { d: 'M4 10a6 6 0 1 0 2-4.5' }),
    h('path', { d: 'M4.4 3v3.2h3.2' }))
}
export function closeIcon(h) {
  return h('svg', { className: 'fo-btn-icon', width: 14, height: 14, viewBox: '0 0 20 20', fill: 'none', stroke: 'currentColor', strokeWidth: 1.6, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': 'true' },
    h('path', { d: 'M5 5l10 10M15 5L5 15' }))
}

/** 「一键整理」的图标：20px 线性 sparkle（自绘，不引图标字体/图片）。 */
export function sparkleIcon(h) {
  return h('svg', {
    className: 'fo-btn-icon',
    width: 14,
    height: 14,
    viewBox: '0 0 20 20',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.5,
    strokeLinecap: 'round',
    strokeLinejoin: 'round',
    'aria-hidden': 'true',
  },
    h('path', { d: 'M10 2.4l1.5 4.1 4.1 1.5-4.1 1.5L10 13.6 8.5 9.5 4.4 8l4.1-1.5z' }),
    h('path', { d: 'M15.6 13.4l.7 1.9 1.9.7-1.9.7-.7 1.9-.7-1.9-1.9-.7 1.9-.7z' }),
  )
}

const asArray = (value) => (Array.isArray(value) ? value : [])

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
  const { useCallback, useEffect, useRef, useState } = React
  const TaskNodeCard = createTaskNodeCard(deps)

  return function GraphView(props) {
    const {
      graphs, selectedId = '', focusedId = '', nodePos, onOpenTask, onFocusTask,
      onNodeMove, onResetLayout, onBlur, hostReady, hostReason, onOpenSession,
      hideDone = false, hiddenDone = 0, onToggleHideDone,
    } = props || {}
    const [views, setViews] = useState({})
    const list = Array.isArray(graphs) ? graphs : []
    const [drag, setDrag] = useState(null)
    /* 拖动过就不算点击：pointerup 之后浏览器还会补一个 click，用它把选中/详情挡掉。 */
    const dragMoved = useRef(false)
    const svgRefs = useRef({})
    const nodeRefs = useRef({})
    const canvasRefs = useRef({})
    /* 平移：空画布上按下左键拖动；超过 3px 才算拖动，避免和「点空白取消聚焦」打架。 */
    const [pan, setPan] = useState(null)
    const panMoved = useRef(false)
    /* 事件处理器里要读最新视口/回调，但不能每次 setState 都重新绑事件。 */
    const viewsRef = useRef(views)
    viewsRef.current = views

    const posOf = useCallback((graphKey, node) => {
      const bag = nodePos && typeof nodePos === 'object' ? nodePos[graphKey] : null
      const hit = bag && typeof bag === 'object' ? bag[node.id] : null
      if (!hit || !isFinite(Number(hit.x)) || !isFinite(Number(hit.y))) return { x: node.x, y: node.y }
      return { x: Number(hit.x), y: Number(hit.y) }
    }, [nodePos])

    /* 视图缩放：viewBox 是 layout 坐标系，元素是 CSS 尺寸，跟随指针要除以这个比例。
       画布自身的放大（视口 k）也要算进去：放大 2 倍时同样 10px 只该走一半的内容距离。 */
    const scaleOf = useCallback((graph) => {
      const k = viewOf(viewsRef.current, graph.key).k
      const el = svgRefs.current[graph.key]
      if (!el || typeof el.getBoundingClientRect !== 'function') return k
      let rect = null
      try { rect = el.getBoundingClientRect() } catch (error) { rect = null }
      if (!rect || !rect.width || !rect.height || !graph.width || !graph.height) return k
      const scale = Math.min(rect.width / graph.width, rect.height / graph.height)
      return isFinite(scale) && scale > 0 ? scale * k : k
    }, [])

    /* 屏幕坐标 → viewBox 坐标。preserveAspectRatio="xMidYMid meet" 会留边，
       所以要把「居中留边」也扣掉，否则滚轮缩放的锚点会偏。 */
    const userPointOf = useCallback((graph, el, clientX, clientY) => {
      const left = num(clientX, 0)
      const top = num(clientY, 0)
      if (!el || typeof el.getBoundingClientRect !== 'function') return null
      let rect = null
      try { rect = el.getBoundingClientRect() } catch (error) { return null }
      if (!rect || !rect.width || !rect.height || !graph.width || !graph.height) return null
      const scale = Math.min(rect.width / graph.width, rect.height / graph.height)
      if (!(scale > 0)) return null
      const offsetX = (rect.width - graph.width * scale) / 2
      const offsetY = (rect.height - graph.height * scale) / 2
      return {
        x: (left - rect.left - offsetX) / scale,
        y: (top - rect.top - offsetY) / scale + (Number(graph.top) || 0),
      }
    }, [])

    /* 视口状态就放在这里：缩放/平移/聚焦都在本组件内闭环，卡片也由它渲染
       （GraphFeature 只负责把 ctx 透传进来）。 */
    const setView = useCallback((graphKey, next) => {
      const key = String(graphKey || '')
      if (!key) return
      setViews((prev) => ({ ...(prev && typeof prev === 'object' ? prev : {}), [key]: next }))
    }, [])

    /* 滚轮缩放：必须用原生监听（React 的 onWheel 是 passive，preventDefault 无效，
       否则画布会跟着整页滚）。以光标为锚点，手感与常见画布一致。 */
    useEffect(() => {
      const cleanups = []
      list.forEach((graph) => {
        const el = canvasRefs.current[graph.key]
        if (!el || typeof el.addEventListener !== 'function') return
        const onWheel = (event) => {
          if (typeof event.preventDefault === 'function') event.preventDefault()
          const delta = num(event.deltaY, 0)
          if (!delta) return
          const factor = Math.exp(-delta * (event.ctrlKey ? 0.01 : 0.0016))
          const anchor = userPointOf(graph, el, event.clientX, event.clientY)
          const v = viewOf(viewsRef.current, graph.key)
          setView(graph.key, zoomView(v, factor, anchor || { x: graph.width / 2, y: (Number(graph.top) || 0) + graph.height / 2 }))
        }
        el.addEventListener('wheel', onWheel, { passive: false })
        cleanups.push(() => { try { el.removeEventListener('wheel', onWheel) } catch (error) { /* 元素没了就算了 */ } })
      })
      return () => cleanups.forEach((fn) => fn())
    })

    /* 聚焦：把聚焦节点送到视口中心（「聚焦」不只是调暗别人，还要看得见主角）。 */
    const lastFocused = useRef('')
    useEffect(() => {
      const id = String(focusedId || '')
      if (!id || id === lastFocused.current) return
      lastFocused.current = id
      const graph = list.find((item) => (item.nodes || []).some((node) => node.id === id && node.ghost !== true))
      if (!graph) return
      const node = graph.nodes.find((item) => item.id === id) || null
      if (!node) return
      const pos = posOf(graph.key, node)
      const box = { width: graph.width, height: graph.height, top: graph.top }
      setView(graph.key, centerOn(viewOf(viewsRef.current, graph.key), {
        x: pos.x + num(node.w, 0) / 2,
        y: pos.y + num(node.h, 0) / 2,
      }, box))
    }, [focusedId, list, posOf, setView])

    const beginPan = (event, graph) => {
      if (event.button != null && Number(event.button) !== 0) return
      panMoved.current = false
      setPan({
        graphKey: graph.key,
        clientX: num(event.clientX, 0),
        clientY: num(event.clientY, 0),
        base: viewOf(viewsRef.current, graph.key),
      })
    }

    const movePan = (event, graph) => {
      if (!pan || pan.graphKey !== graph.key) return
      const dx = num(event.clientX, 0) - pan.clientX
      const dy = num(event.clientY, 0) - pan.clientY
      if (Math.abs(dx) > 3 || Math.abs(dy) > 3) {
        panMoved.current = true
        if (typeof event.preventDefault === 'function') event.preventDefault()
      }
      if (!panMoved.current) return
      const scale = scaleOf(graph)
      if (!(scale > 0)) return
      setView(graph.key, panView(pan.base, dx / scale, dy / scale))
    }

    const endPan = () => {
      if (pan) setPan(null)
    }

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

    /* ---------------- 卡片头部工具 ----------------
       用户口径：按钮放进**卡片自己的 header**（.fo-graph-head），不再悬浮在画布上。
       这些控制是逐张图的（缩放 / 复位），所以每张卡片各有一套。 */
    const hasLocal = !!(nodePos && typeof nodePos === 'object' && Object.keys(nodePos).length > 0)
    const graphHas = (graph, id) => !!id && (graph.nodes || []).some((node) => node.id === id && node.ghost !== true)

    /** 单张图的缩放：以这张图 viewBox 的中心为锚点。 */
    const zoomGraph = (graph, factor) => {
      const anchor = {
        x: (Number(graph.width) || 0) / 2,
        y: (Number(graph.top) || 0) + (Number(graph.height) || 0) / 2,
      }
      setView(graph.key, zoomView(viewOf(viewsRef.current, graph.key), factor, anchor))
    }
    const resetGraphView = (graph) => setView(graph.key, { k: 1, x: 0, y: 0 })
    const resetLayoutGraph = (graph) => {
      if (typeof onResetLayout !== 'function') return
      onResetLayout(list.length > 1 ? '' : graph.key)
    }

    return h('div', { className: 'fo-canvas-stage' },
      h('div', { className: 'fo-graphs' }, list.map((graph, index) => {
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
      const view = viewOf(views, graph.key)
      const graphPercent = Math.round(view.k * 100)
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
        const kindLabel = EDGE_KIND_LABEL[edge.kind] || edge.kind
        /* 悬停能读到「这条线是什么、为什么存在」，不用点开详情去猜。 */
        const tip = [kindLabel, edge.source ? `来源：${EDGE_SOURCE_LABEL[edge.source] || edge.source}` : '', edge.reason ? edge.reason : '']
          .filter(Boolean).join(' · ')
        return h('path', {
          key: edge.key,
          className: `fo-edge${(selectedId && (edge.from === selectedId || edge.to === selectedId)) ? ' is-active' : ''}`,
          'data-kind': edge.kind,
          'data-from': edge.from,
          'data-to': edge.to,
          d: geo.path,
          'marker-end': `url(#${markerBase}-${edge.kind})`,
        }, h('title', { key: 'tip' }, tip))
      }))

      const nodeLayer = h('g', null, placed.map(({ node, pos }) => {
        const interactive = node.ghost !== true
        const selected = !!selectedId && interactive && node.id === selectedId
        const focused = !!focusedId && interactive && node.id === focusedId
        const dimmed = anyFocused && node.id !== focusedId
        const card = cardGeometry({ ...node, x: pos.x, y: pos.y })
        const activate = () => { if (interactive && typeof onOpenTask === 'function') onOpenTask(node.id, node) }
        const state = String(node.state || 'ghost')
        /* 卡片内容全部交给 TaskNodeCard：与面板里的飞书任务卡同一套设计，
           画布上只留标题 / 会话 / 状态与关系计数（见该文件的 GRAPH_CARD_FIELDS）。 */
        const openReady = !!hostReady && !!String(node.sessionId || '')
        const openTitle = !hostReady
          ? (String(hostReason || '') || '当前宿主不支持打开会话')
          : (!node.sessionId ? '这个任务没有绑定会话' : '打开会话')
        const actions = interactive
          ? [
            {
              key: 'open',
              label: '打开会话',
              title: openTitle,
              disabled: !openReady,
              run: () => { if (openReady && typeof onOpenSession === 'function') onOpenSession(String(node.sessionId), node.fullTitle || node.label || '') },
            },
            {
              key: 'focus',
              label: '聚焦到节点',
              title: '聚焦到节点',
              disabled: false,
              run: () => { if (typeof onFocusTask === 'function') onFocusTask(node.id) },
            },
          ]
          : []
        const children = [
          h('title', { key: 'tip' }, `${node.fullTitle || node.id}${node.ghost ? (node.missing ? '（任务不存在，仅剩关系）' : '（属于其它分组）') : ''}`),
          h('rect', {
            key: 'bg',
            className: 'fo-node-bg',
            x: card.x, y: card.y, width: card.w, height: card.h, rx: card.radius,
          }),
        ].concat(TaskNodeCard({ node, card, actions }))

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
          /* 边的图例：接受建议后画布变了，这里要能立刻看出「多了几条什么线」
             （时间先后是点线、颜色更淡，只靠眼睛扫画布很容易以为没变化）。 */
          h('div', { className: 'fo-edge-legend', 'aria-label': '关系图例' },
            [['depends_on', '前置'], ['derived_from', '来源'], ['temporal', '时间']].map(([kind, label]) => {
              const total = edges.filter((edge) => edge.kind === kind).length
              if (!total) return null
              return h('span', { key: kind, className: 'fo-edge-item', 'data-kind': kind },
                h('i', { className: 'fo-edge-swatch', 'data-kind': kind, 'aria-hidden': 'true' }),
                h('span', { className: 'fo-edge-label' }, label),
                h('span', { className: 'fo-edge-count' }, String(total)))
            }),
          ),
          h('div', { className: 'fo-graph-legend', 'aria-label': '项目图例' },
            legend.map((item) => h('span', { key: item.key, className: 'fo-legend-item', title: item.label },
              h('i', { className: 'fo-legend-dot', style: { '--fo-c': decoVar(item.colorRef) }, 'aria-hidden': 'true' }),
              h('span', { className: 'fo-legend-label' }, item.label),
              h('span', { className: 'fo-legend-count' }, String(item.count)),
            )),
          ),
          /* 动作就在卡片自己的 header 右侧：不悬浮、不占额外一行。 */
          h('div', { className: 'fo-graph-actions', role: 'toolbar', 'aria-label': '画布工具' },
            h('button', {
              type: 'button', className: 'fo-btn', 'data-size': 'sm', 'data-variant': 'ghost',
              'data-action': 'toggle-done',
              'aria-pressed': hideDone ? 'true' : 'false',
              title: hideDone
                ? `已完成的任务默认不画${hiddenDone > 0 ? `（这次隐藏了 ${hiddenDone} 条）` : ''}；点一下显示它们`
                : '点一下把已完成的任务从画布上收起来',
              onClick: () => { if (typeof onToggleHideDone === 'function') onToggleHideDone() },
            }, hideDone ? `已完成${hiddenDone > 0 ? ` ${hiddenDone}` : ''}` : '隐藏已完成'),
            h('div', { className: 'fo-zoom-group' },
              h('button', {
                type: 'button', className: 'fo-btn', 'data-size': 'sm', 'data-variant': 'ghost',
                'data-action': 'zoom-out', 'aria-label': '缩小画布', title: '缩小画布（也可以滚轮）',
                disabled: graphPercent <= Math.round(VIEW_ZOOM_MIN * 100),
                onClick: () => zoomGraph(graph, 1 / ZOOM_STEP),
              }, '−'),
              h('button', {
                type: 'button', className: 'fo-zoom-value', 'data-action': 'zoom-reset',
                'aria-label': `当前缩放 ${graphPercent}%，点击回到 100%`, title: '当前缩放；点击回到 100%',
                onClick: () => resetGraphView(graph),
              }, `${graphPercent}%`),
              h('button', {
                type: 'button', className: 'fo-btn', 'data-size': 'sm', 'data-variant': 'ghost',
                'data-action': 'zoom-in', 'aria-label': '放大画布', title: '放大画布（也可以滚轮）',
                disabled: graphPercent >= Math.round(VIEW_ZOOM_MAX * 100),
                onClick: () => zoomGraph(graph, ZOOM_STEP),
              }, '+'),
              h('button', {
                type: 'button', className: 'fo-btn', 'data-size': 'sm', 'data-variant': 'ghost',
                'data-action': 'fit', 'data-icon': '1', 'aria-label': '适应画布', title: '把这张图恢复到适应画布（100%）',
                onClick: () => resetGraphView(graph),
              }, fitIcon(h)),
            ),
            h('button', {
              type: 'button', className: 'fo-btn', 'data-size': 'sm', 'data-variant': 'ghost',
              'data-action': 'reset-layout', 'data-icon': '1', disabled: !hasLocal,
              'aria-label': '复位布局',
              title: hasLocal ? '清掉本地拖动位置，回到自动布局（不影响缩放）' : '还没有拖动过节点',
              onClick: () => resetLayoutGraph(graph),
            }, resetIcon(h)),
            focusedId && graphHas(graph, focusedId)
              ? h('button', {
                type: 'button', className: 'fo-btn', 'data-size': 'sm', 'data-variant': 'ghost',
                'data-action': 'blur', 'data-icon': '1', 'aria-label': '取消聚焦', title: '取消聚焦（Esc）',
                onClick: () => { if (typeof onBlur === 'function') onBlur() },
              }, closeIcon(h))
              : null,
          ),
        ),
        /* 画布：网格层在最底、不拦点击；SVG 在上层。空图也显示网格（参考站画布一直在）。
           点空白（画布底/网格/SVG 空白处，不在任何节点里）= 取消聚焦；
           拖动空白 = 平移；滚轮 = 以光标为锚点缩放（见上面 useEffect）。 */
        h('div', {
          ref: (el) => { canvasRefs.current[graph.key] = el },
          className: `fo-canvas${pan && pan.graphKey === graph.key ? ' is-panning' : ''}`,
          'data-zoom': String(round(view.k, 3)),
          onPointerDown: (event) => beginPan(event, graph),
          onPointerMove: (event) => movePan(event, graph),
          onPointerUp: endPan,
          onPointerLeave: endPan,
          onClick: (event) => {
            if (panMoved.current) { panMoved.current = false; return }
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
                'data-zoom': String(round(view.k, 3)),
              }, defs,
                /* 视口层：缩放/平移只作用在内容上，defs（箭头 marker）留在外面。 */
                h('g', { className: 'fo-viewport', transform: viewportTransform(view) }, edgeLayer, nodeLayer)))
            : h('div', { className: 'fo-placeholder' },
              h('div', { className: 'fo-placeholder-title' },
                hideDone && asArray(graph.tasks).length > 0
                  ? '这里的任务都已完成'
                  : (graph.kind === 'ungrouped' ? '没有未分组的项目' : '这个目录里还没有在场的工作区')),
              h('div', { className: 'fo-placeholder-body' },
                hideDone && asArray(graph.tasks).length > 0
                  ? '已完成的任务默认不画。点卡片头部右侧的「显示已完成」就能展开它们。'
                  : (graph.kind === 'ungrouped'
                    ? '所有项目都已经归入某个自定义目录。'
                    : '它的成员当前都不在任务集里（可能被删或改名）。把左栏的项目拖进这个目录即可。')),
            ),
        ),
      )
    })))
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
