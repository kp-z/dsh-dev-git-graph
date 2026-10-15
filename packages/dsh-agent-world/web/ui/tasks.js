/*
 * 工单板（R32）—— 徽章 + 进度条，而不是"状态 60%"这样的文字。
 *
 * DESIGN.md 第零节第 4 条（"状态只有文字"）与第 2 条（"没有留白与层级"）都落在这里：
 * 每一张单 = 徽章（状态，颜色与看板一致）+ 标题 + 一行元信息（谁在做）+ 一条进度条。
 *
 * 排序规则与调度器一致：**按 ordinal 而不是 id 字符串**——
 * `task-10` 的字符串序在 `task-2` 前面，那会让两处对任务的顺序判断悄悄分叉。
 */

/** 显示的优先顺序：正在做的排最前，然后是能领的、待办的、卡住的，最后是收尾的。 */
const ORDER = { in_progress: 0, ready: 1, blocked: 2, pending: 3, failed: 4, done: 5 }

import { taskStatusLabel } from './labels.js'

function esc(text) {
  return String(text).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c])
}

/**
 * 建工单板。
 *
 * @param {object} options
 * @param {HTMLElement} options.root - `<ul id="tasks">`。
 * @param {(taskId: string) => void} [options.onPick] - 点某张单（可选：让看板跟着选中）。
 * @param {Document} [options.document]
 */
export function createTasks(options) {
  const doc = options.document ?? globalThis.document
  const root = options.root
  const ready = root !== null && root !== undefined
  /** 抽屉底部的"内容概况"（快照级信息，见文件末尾的说明）。 */
  const updateContent = makeContentWriter(doc, options.contentRoot ?? doc.getElementById('content'))
  let lastSignature = null

  if (ready && typeof options.onPick === 'function') {
    root.addEventListener('click', (event) => {
      const row = event.target.closest?.('[data-task]')
      if (row !== null && row !== undefined) options.onPick?.(row.dataset.task)
    })
  }

  /** @param {{world: object, meta?: object, selectedTaskId?: string|null}} input */
  function update(input) {
    if (!ready) return
    const { world, meta, selectedTaskId } = input
    updateContent(meta)
    const rows = [...world.tasks].sort(
      (a, b) => (ORDER[a.status] ?? 9) - (ORDER[b.status] ?? 9) || (a.ordinal ?? 0) - (b.ordinal ?? 0),
    )
    const signature = rows
      .map((t) => `${t.id}:${t.status}:${t.owner}:${Math.round((t.progress ?? 0) * 100)}:${t.title}`)
      .join('|') + `#${selectedTaskId ?? ''}`
    if (signature === lastSignature) return
    lastSignature = signature

    root.innerHTML = rows
      .map((task) => {
        const owner = task.owner ? (world.agents.find((a) => a.id === task.owner)?.name ?? task.owner) : '未分配'
        const pct = Math.round(Math.min(1, Math.max(0, task.progress ?? 0)) * 100)
        // 完成/失败不发进度：进度条在那两种状态下没有信息量，只会让列表变吵。
        const showBar = task.status === 'in_progress' || (pct > 0 && task.status !== 'done' && task.status !== 'failed')
        return `
          <li class="task-row${task.id === selectedTaskId ? ' is-active' : ''}" data-task="${esc(task.id)}" data-status="${esc(task.status)}">
            <div class="task-head">
              <span class="badge badge-${esc(task.status)}">${esc(taskStatusLabel(task.status))}</span>
              <span class="task-title">${esc(task.title)}</span>
            </div>
            <div class="task-meta">
              <span class="mono">${esc(task.id)}</span>
              <span class="dim">${esc(owner)}</span>
              ${showBar ? `<span class="dim mono">${pct}%</span>` : ''}
            </div>
            ${showBar ? `<div class="progress"><i style="width:${pct}%"></i></div>` : ''}
          </li>`
      })
      .join('')
  }

  return { ready, update }
}

/**
 * 抽屉底部的"内容概况"（内容包 / 各内容库条数 / 主题）。
 *
 * 放在这里而不是 `tasks.update` 里现拼，是因为它是**快照级的静态信息**：
 * 一次快照只变一次，没必要每帧重算字符串。
 */
function makeContentWriter(doc, root) {
  let last = null
  return (meta) => {
    if (root === null || root === undefined || meta === null || meta === undefined) return
    const libs = (meta.libraries ?? [])
      .filter((l) => l.count > 0)
      .map((l) => `${l.title} ${l.count}`)
      .join(' · ')
    const theme = meta.theme
    const text =
      `${(meta.packs ?? []).map((p) => `${p.id}@${p.version}`).join('、')} — ${libs}` +
      (theme ? ` · 主题：${theme.name}` : '')
    if (text === last) return
    last = text
    root.textContent = text
  }
}
