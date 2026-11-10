/**
 * 主视图：关系图（一个自定义目录 = 恰好一张图、一套坐标系）—— 工厂组件，模块顶层不 import react。
 *
 * 一张图里：
 * - 横向列 = 依赖深度（只在 depends_on 上分层）；行 = 泳道内的贪心打包结果；
 * - 泳道（band）区分同一目录里的不同项目，**不切坐标空间**，所以跨项目的边是直连的；
 * - 实线箭头 = depends_on，虚线 = derived_from；端点在图外的补 ghost 节点（虚线框，不可点选）；
 * - 节点可点、可 Tab、可 Enter/Space，选中项与它相连的边一起高亮。
 *
 * props：
 *   graphs      layoutScope(...).graphs（每张图自带 nodes/edges/bands/width/height/top）
 *   selectedId  当前选中的任务 id（高亮相连边）
 *   onOpenTask(taskId, node)
 */

import { describeNode, describeNodeMeta } from '../overview/layout.js'
import { decoVar, stateVar } from './styles.js'

function safeId(value) {
  return String(value == null ? '' : value).replace(/[^A-Za-z0-9_-]/g, '_')
}

/** band / node 的分色：色槽来自 styles.js 的 --fo-deco-N（宿主令牌派生），组件不写死颜色。 */
function decoStyle(colorRef) {
  if (colorRef == null || !(Number(colorRef) >= 0)) return undefined
  return { '--fo-c': decoVar(colorRef) }
}

export function createGraphView(deps) {
  const { h } = deps || {}

  return function GraphView(props) {
    const { graphs, selectedId = '', onOpenTask } = props || {}
    const list = Array.isArray(graphs) ? graphs : []

    if (!list.length) {
      return h('div', { className: 'fo-placeholder' },
        h('div', { className: 'fo-placeholder-title' }, '这个范围里没有可画的图'),
        h('div', { className: 'fo-placeholder-body' }, '把项目拖进自定义目录，或者切回「全部任务」。'),
      )
    }

    return h('div', null, list.map((graph, index) => {
      const markerBase = `fo-arrow-${index}-${safeId(graph.key)}`
      const bands = Array.isArray(graph.bands) ? graph.bands : []
      const nodes = Array.isArray(graph.nodes) ? graph.nodes : []
      const edges = Array.isArray(graph.edges) ? graph.edges : []
      const ghosts = nodes.filter((node) => node.ghost === true)
      const taskCount = nodes.length - ghosts.length
      const blocked = nodes.filter((node) => node.state === 'blocked').length
      const missingMembers = Array.isArray(graph.missingMembers) ? graph.missingMembers : []
      const viewBox = `0 ${graph.top || 0} ${Math.max(1, graph.width)} ${Math.max(1, graph.height)}`
      const label = graph.kind === 'ungrouped'
        ? `未分组：${taskCount} 个任务`
        : `${graph.label}：${(graph.projects || []).length} 个项目、${taskCount} 个任务${graph.kind === 'group' ? '画在同一张图里' : ''}`

      const defs = h('defs', null, ['depends_on', 'derived_from'].map((kind) => h('marker', {
        key: kind,
        id: `${markerBase}-${kind}`,
        viewBox: '0 0 8 8',
        refX: '7',
        refY: '4',
        markerWidth: '7',
        markerHeight: '7',
        orient: 'auto',
      }, h('path', { className: 'fo-arrow', 'data-kind': kind, d: 'M0 1.2 L7 4 L0 6.8 z' }))))

      const bandLayer = h('g', { 'aria-hidden': 'true' }, bands.map((band) => {
        const external = band.external === true
        const style = external ? undefined : decoStyle(band.colorRef)
        return h('g', { key: `band:${band.key}` },
          h('rect', {
            className: 'fo-band',
            'data-external': external ? '1' : '0',
            x: band.x,
            y: band.y,
            width: band.w,
            height: band.h,
            rx: 12,
            style,
          }),
          h('text', {
            className: 'fo-band-label',
            'data-external': external ? '1' : '0',
            x: band.x + 10,
            y: band.y + 18,
            style,
          }, external ? `${band.label}（${band.count}）` : `${band.label} · ${band.count} 任务`),
        )
      }))

      const edgeLayer = h('g', { 'aria-hidden': 'true' }, edges.map((edge) => h('path', {
        key: edge.key,
        className: `fo-edge${(selectedId && (edge.from === selectedId || edge.to === selectedId)) ? ' is-active' : ''}`,
        'data-kind': edge.kind,
        'data-from': edge.from,
        'data-to': edge.to,
        d: edge.path,
        'marker-end': `url(#${markerBase}-${edge.kind})`,
      })))

      const nodeLayer = h('g', null, nodes.map((node) => {
        const interactive = node.ghost !== true
        const selected = selectedId && node.id === selectedId
        const activate = () => { if (interactive && typeof onOpenTask === 'function') onOpenTask(node.id, node) }
        const children = [
          h('title', { key: 'tip' }, `${node.fullTitle || node.id}${node.ghost ? (node.missing ? '（任务不存在，仅剩关系）' : '（属于其它分组）') : ''}`),
          h('rect', { key: 'bg', className: 'fo-node-bg', x: node.x, y: node.y, width: node.w, height: node.h, rx: 12 }),
        ]
        if (!node.ghost) children.push(h('rect', { key: 'spine', className: 'fo-node-spine', x: node.x, y: node.y + 10, width: 3, height: node.h - 20, rx: 1.5 }))
        children.push(h('circle', { key: 'dot', className: 'fo-node-dot', cx: node.x + 18, cy: node.y + 22, r: 3.6, style: { '--fo-c': stateVar(node.state) } }))
        children.push(h('text', { key: 'no', className: 'fo-node-no', x: node.x + 30, y: node.y + 26 },
          node.no > 0 ? `T${node.no}` : (node.ghost ? (node.missing ? '缺失' : '组外') : String(node.id).slice(0, 8))))
        children.push(h('text', { key: 'title', className: 'fo-node-title', x: node.x + 16, y: node.y + 48 }, node.label || node.id))
        children.push(h('text', { key: 'meta', className: 'fo-node-meta', x: node.x + 16, y: node.y + 64 }, describeNodeMeta(node)))

        return h('g', {
          key: node.key,
          className: `fo-node${node.ghost ? ' is-ghost' : ''}${selected ? ' is-selected' : ''}`,
          'data-id': node.id,
          'data-state': node.state,
          tabIndex: interactive ? 0 : -1,
          role: interactive ? 'button' : 'img',
          'aria-label': describeNode(node),
          style: decoStyle(node.colorRef),
          onClick: activate,
          onKeyDown: (event) => {
            if (event.key === 'Enter' || event.key === ' ' || event.key === 'Spacebar') { event.preventDefault(); activate() }
          },
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
          h('div', { className: 'fo-graph-meta' },
            h('span', { className: 'fo-chip' }, `${taskCount} 任务`),
            h('span', { className: 'fo-chip' }, `${edges.length} 关系`),
            blocked ? h('span', { className: 'fo-chip', 'data-tone': 'danger' }, `${blocked} 阻塞`) : null,
            ghosts.length ? h('span', { className: 'fo-chip', 'data-tone': 'idle' }, `${ghosts.length} 组外/缺失`) : null,
            missingMembers.length
              ? h('span', {
                className: 'fo-chip',
                'data-tone': 'warn',
                title: missingMembers.map((row) => row.label).join('、'),
              }, `${missingMembers.length} 成员不在场`)
              : null,
          ),
        ),
        nodes.length
          ? h('div', { className: 'fo-graph-body' },
            h('svg', {
              className: 'fo-svg',
              viewBox,
              width: graph.width,
              height: graph.height,
              /* role=group 而不是 img：图里的节点本身是可聚焦的 button，img 会把它们从无障碍树里挡掉。 */
              role: 'group',
              'aria-label': label,
            }, defs, bandLayer, edgeLayer, nodeLayer))
          : h('div', { className: 'fo-placeholder' },
            h('div', { className: 'fo-placeholder-title' }, graph.kind === 'ungrouped' ? '没有未分组的项目' : '这个目录里还没有在场的工作区'),
            h('div', { className: 'fo-placeholder-body' }, graph.kind === 'ungrouped'
              ? '所有项目都已经归入某个自定义目录。'
              : '它的成员当前都不在任务集里（可能被删或改名）。把左栏的项目拖进这个目录即可。'),
          ),
      )
    }))
  }
}

export default createGraphView
