/*
 * 花名册（R32）—— 角色卡片，点一下就是"跟他说话"。
 *
 * ── 卡片而不是列表行 ────────────────────────────────────────────────────────
 *
 * 花名册要同时回答三件事：**他是谁 / 他在哪 / 他现在在干什么（以及有没有话没回）**。
 * 一行文字塞不下，所以做成卡片：色点（内容里的职业色）+ 名字 + 职业 + 站位 + 状态徽章。
 *
 * ── 两条延续下来的规矩 ──────────────────────────────────────────────────────
 *
 * 1. **"他在想…"必须落在这一行上**：对话面板可能已经关了、或者你在看别人，
 *    但"我发出去的那句话还没回"是用户最需要知道的状态；
 * 2. 名字/职业/站位**全部来自世界数据**（D37：人设是内容，代码里没有角色名）。
 */

import { agentStateLabel, agentStateTone, roleLabel } from './labels.js'

function esc(text) {
  return String(text).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c])
}

/**
 * 建花名册。
 *
 * @param {object} options
 * @param {HTMLElement} options.root - `<ul id="roster">`。
 * @param {(agentId: string) => void} options.onPick - 点卡片。
 * @param {Document} [options.document]
 */
export function createRoster(options) {
  const root = options.root
  const ready = root !== null && root !== undefined
  let lastSignature = null

  if (ready) {
    // **事件委托**：卡片每次数据变化都会重建，挂在卡片上的监听器会跟着丢
    //（而那种 bug 看起来像"点了没反应"）。
    root.addEventListener('click', (event) => {
      const card = event.target.closest?.('[data-agent]')
      if (card !== null && card !== undefined) options.onPick?.(card.dataset.agent)
    })
  }

  /**
   * @param {object} input
   * @param {object} input.world
   * @param {Set<string>} [input.thinkingIds] - 正在等回复的角色（画"他在想…"）。
   * @param {string|null} [input.activeId] - 当前对话对象。
   * @param {Map<string, string>} [input.colorById] - 内容里的职业色（来自 ScenePlan）。
   */
  function update(input) {
    if (!ready) return
    const { world, thinkingIds, activeId, colorById } = input
    const thinking = thinkingIds ?? new Set()
    const signature =
      world.agents.map((a) => `${a.id}:${a.state}:${a.station}:${a.targetStation}:${a.carrying}:${thinking.has(a.id)}`).join('|') +
      `#${activeId ?? ''}`
    if (signature === lastSignature) return
    lastSignature = signature

    root.innerHTML = world.agents
      .map((agent) => {
        const stationName = agent.station
          ? (world.stations.find((s) => s.id === agent.station)?.name ?? agent.station)
          : agent.targetStation
            ? `→ ${world.stations.find((s) => s.id === agent.targetStation)?.name ?? agent.targetStation}`
            : '广场'
        const carrying = agent.carrying ? world.tasks.find((t) => t.id === agent.carrying) : null
        const tone = agentStateTone(agent.state)
        const color = colorById?.get(agent.id) ?? 'var(--fg-2)'
        const pending = thinking.has(agent.id)
          ? '<span class="badge badge-ready agent-pending">他在想…</span>'
          : `<span class="badge badge-${tone}">${esc(agentStateLabel(agent.state))}</span>`
        return `
          <li class="agent-card${agent.id === activeId ? ' is-active' : ''}" data-agent="${esc(agent.id)}" title="点一下跟他说话">
            <span class="agent-dot" style="--dot:${esc(color)}"></span>
            <div class="agent-main">
              <div class="agent-line">
                <b class="agent-name">${esc(agent.name)}</b>
                <span class="agent-role">${esc(roleLabel(agent.role))}</span>
              </div>
              <div class="agent-sub">
                <span class="dim">${esc(stationName)}</span>
                ${carrying === null || carrying === undefined ? '' : `<span class="agent-task">${esc(carrying.title)}</span>`}
              </div>
            </div>
            ${pending}
          </li>`
      })
      .join('')
  }

  return { ready, update }
}
