/**
 * 「一键整理」建议抽屉 —— 工厂组件，模块顶层不 import react。
 *
 * 一块抽屉 = 一批 AI 整理建议（`api.organize` 的产出，**零副作用**：只出建议，落库要人点）。
 * 每条建议都是「改一条关系」，所以抽屉要把**判断依据（evidence 原文）**和**代价（会让谁变阻塞）**
 * 摊在同一张卡上，再用「接受 / 拒绝」把决定权交回人手里。
 *
 * 纯展示 + 回调：数据、请求、store 全在宿主 OverviewPanel（本组件不取数据、不碰 store）。
 *
 * props：
 *   open          抽屉开着没
 *   batch         { batchId, at, scope, model, notes, pending, accepted, rejected, dropped, items[] }
 *   status        'idle' | 'ready' | 'running'
 *   failed        { 建议 id: 失败原因 }（逐条接受时宿主逐条汇报，不静默）
 *   droppedOpen   被丢弃那一段展开没（默认折叠：坏建议会淹没好建议）
 *   onAccept(ids) onReject(ids) onClose() onToggleDropped() onToggleItem(id)
 */

import * as modelModule from '../overview/model.js'

const KIND_LABEL = { depends_on: '前置', derived_from: '来源' }

/** 置信度 → 百分比。模型有时给 0~1、有时手滑给 0~100，两种都认。 */
export function confidenceText(value) {
  const n = Number(value)
  if (!isFinite(n) || n <= 0) return ''
  const pct = Math.max(1, Math.min(100, Math.round(n > 1 ? n : n * 100)))
  return `${pct}%`
}

/** 计数：批次里给了就用给的，没给就按 items 数；坏值一律退回 items。 */
function countOf(batch, items, key, status) {
  const raw = batch ? batch[key] : undefined
  const n = Number(raw)
  if (raw !== null && raw !== undefined && raw !== '' && isFinite(n) && n >= 0) return n
  return items.filter((item) => item.status === status).length
}

export function createOrganizeDrawer(deps) {
  const { h } = deps || {}
  const model = (deps && deps.model) || modelModule

  return function OrganizeDrawer(props) {
    const p = props || {}
    if (p.open !== true) return null
    const { batch, status = 'idle', failed, droppedOpen = false } = p
    const onAccept = typeof p.onAccept === 'function' ? p.onAccept : () => {}
    const onReject = typeof p.onReject === 'function' ? p.onReject : () => {}
    const onUndo = typeof p.onUndo === 'function' ? p.onUndo : null
    const items = Array.isArray(batch && batch.items) ? batch.items : []
    const pending = items.filter((item) => item.status === 'pending')
    const dropped = items.filter((item) => item.status === 'dropped')
    const running = status === 'running'
    const counts = {
      pending: countOf(batch, items, 'pending', 'pending'),
      accepted: countOf(batch, items, 'accepted', 'accepted'),
      rejected: countOf(batch, items, 'rejected', 'rejected'),
    }

    const itemNode = (item) => {
      const kindLabel = KIND_LABEL[item.kind] || model.str(item.kind)
      const conf = confidenceText(item.confidence)
      const impact = model.isObj(item.impact) ? item.impact : {}
      const blocked = Array.isArray(impact.blocked) ? impact.blocked.filter((row) => model.str(row)) : []
      const failure = failed && typeof failed === 'object' ? failed[item.id] : ''
      const isPending = item.status === 'pending'
      const children = [
        h('div', { key: 'top', className: 'fo-org-top' },
          h('span', { className: 'fo-org-kind', 'data-kind': item.kind }, kindLabel),
          conf ? h('span', { className: 'fo-org-conf', title: '模型自评的把握' }, conf) : null,
        ),
        h('div', { key: 'route', className: 'fo-org-route' },
          h('span', { className: 'fo-org-from', title: item.from || '' }, model.str(item.fromTitle) || model.str(item.from)),
          h('span', { className: 'fo-org-arrow', 'aria-hidden': 'true' }, '→'),
          h('span', { className: 'fo-org-to', title: item.to || '' }, model.str(item.toTitle) || model.str(item.to)),
        ),
      ]
      if (model.str(item.evidence)) {
        children.push(h('blockquote', { key: 'evidence', className: 'fo-org-evidence' }, model.str(item.evidence)))
      }
      if (blocked.length) {
        children.push(h('p', { key: 'impact', className: 'fo-org-impact', 'data-tone': 'warn' },
          `会让《${blocked[0]}》变成阻塞：前置没完成它就开不了工`))
      }
      if (failure) {
        children.push(h('p', { key: 'fail', className: 'fo-org-fail', role: 'alert' }, `没落库：${failure}`))
      }
      if (isPending) {
        children.push(h('div', { key: 'actions', className: 'fo-org-item-actions' },
          h('button', {
            type: 'button', className: 'fo-btn', 'data-size': 'sm', 'data-action': 'accept', disabled: running,
            onClick: () => onAccept([item.id]),
          }, '接受'),
          h('button', {
            type: 'button', className: 'fo-btn', 'data-size': 'sm', 'data-variant': 'ghost', 'data-action': 'reject', disabled: running,
            onClick: () => onReject([item.id]),
          }, '拒绝'),
        ))
      } else {
        children.push(h('span', { key: 'done', className: 'fo-org-done' },
          item.status === 'accepted' ? '已接受'
            : (item.status === 'undone' ? '已撤销'
              : (item.status === 'rejected' ? '已拒绝' : ''))))
      }
      return h('article', {
        key: item.id,
        className: 'fo-org-item',
        'data-id': item.id,
        'data-kind': item.kind,
        'data-status': item.status,
      }, children)
    }

    return h('aside', { className: 'fo-organize', 'aria-label': '整理建议', 'aria-busy': running ? 'true' : 'false' },
      h('div', { className: 'fo-org-head' },
        h('span', { className: 'fo-org-title' }, '整理建议'),
        h('span', { className: 'fo-org-counts' },
          `待处理 ${counts.pending} · 已接受 ${counts.accepted} · 已拒绝 ${counts.rejected}`
          + (counts.undone ? ` · 已撤销 ${counts.undone}` : '')),
      ),
      model.str(batch && batch.notes)
        ? h('p', { className: 'fo-org-notes' }, model.str(batch.notes))
        : null,
      h('div', { className: 'fo-org-list' },
        pending.length
          ? pending.map(itemNode)
          : h('p', { className: 'fo-org-empty' }, !batch
            ? '还没有跑过整理：点画布工具条上的「一键整理」，让 AI 先出建议。'
            : (items.length
              ? '待处理的建议都处理完了。'
              : 'AI 没有找到新的关系——这常常是正确答案，宁可少而准')),
      ),
      items.filter((item) => item.status === 'accepted' || item.status === 'rejected' || item.status === 'undone').map(itemNode),
      dropped.length
        ? h('div', { className: 'fo-org-dropped' },
          h('button', {
            type: 'button', className: 'fo-btn', 'data-size': 'sm', 'data-variant': 'ghost',
            'aria-expanded': droppedOpen ? 'true' : 'false',
            onClick: () => { if (typeof p.onToggleDropped === 'function') p.onToggleDropped() },
          }, `已丢弃 ${dropped.length} 条（含原因）`),
          droppedOpen
            ? h('div', { className: 'fo-org-dropped-list' }, dropped.map((item) => h('div', {
              key: item.id, className: 'fo-org-dropped-item', 'data-id': item.id,
            },
              h('span', { className: 'fo-org-dropped-route' }, `${model.str(item.from) || '?'} → ${model.str(item.to) || '?'}`),
              h('span', { className: 'fo-org-dropped-reason' }, model.str(item.reason) || '未通过校验'),
            )))
            : null,
        )
        : null,
      h('div', { className: 'fo-org-foot' },
        h('button', {
          type: 'button', className: 'fo-btn', 'data-size': 'sm', 'data-action': 'accept-all',
          disabled: running || !pending.length,
          onClick: () => onAccept([]),
        }, '全部接受'),
        h('button', {
          type: 'button', className: 'fo-btn', 'data-size': 'sm', 'data-variant': 'ghost', 'data-action': 'reject-all',
          disabled: running || !pending.length,
          onClick: () => onReject([]),
        }, '全部拒绝'),
        /* 接受必须可回退：写错一条 depends_on 会让后继永远开不了工（设计稿 §9.1）。 */
        onUndo && counts.accepted
          ? h('button', {
            type: 'button', className: 'fo-btn', 'data-size': 'sm', 'data-variant': 'ghost', 'data-action': 'undo-accepted',
            disabled: running,
            title: '把已接受的关系从飞书与本地一起撤掉',
            onClick: () => onUndo([]),
          }, `撤销已接受 ${counts.accepted}`)
          : null,
        h('button', {
          type: 'button', className: 'fo-btn', 'data-size': 'sm', 'data-variant': 'ghost', 'data-action': 'close',
          onClick: () => { if (typeof p.onClose === 'function') p.onClose() },
        }, '关闭'),
      ),
    )
  }
}

export default createOrganizeDrawer
