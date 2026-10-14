/*
 * Agent World 面板 —— 2D 俯视图（M3-5 的最小可见版本）。
 *
 * 它**不是**最终的 3D 场景（那是 M4）。它存在的理由是两件事：
 *   1. 让模拟立刻"看得见"——在那之前只能读工具输出的文本；
 *   2. 当 3D 调不出来的时候，它是唯一能看清模拟对不对的窗口。
 * 所以这个俯视图**值得永久保留**，M4 之后作为"调试视图"切换。
 *
 * 约束（决策 D16 / D19）：面板只许与 `/agent-world/api/*` 说话，
 * 不许去读宿主内部，也不许自己解释内容库——配色由服务端的 `palette` 字段给。
 */

const API = './api/world'
const COMMAND_API = './api/command'
const POLL_MS = 400

const canvas = document.getElementById('town')
const ctx = canvas.getContext('2d')
const $status = document.getElementById('status')
const $roster = document.getElementById('roster')
const $tasks = document.getElementById('tasks')
const $content = document.getElementById('content')

let latest = null

/** 把设计尺寸写进 canvas 属性，避免高分屏下模糊。 */
function fitCanvas() {
  const rect = canvas.getBoundingClientRect()
  const dpr = window.devicePixelRatio || 1
  canvas.width = Math.max(320, Math.floor(rect.width * dpr))
  canvas.height = Math.max(320, Math.floor(rect.height * dpr))
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
}

/**
 * 解析一个颜色值。
 *
 * 内容库里存的是 token（形如 `skin.ground.engineering`），也可能是字面色值。
 * 面板不认识内容库，所以只做"去前缀查表、查不到用原值"这一件事。
 */
function color(value, palette, fallback) {
  if (typeof value !== 'string' || value === '') return fallback
  const bare = value.startsWith('skin.') ? value.slice('skin.'.length) : value
  return palette?.[bare] ?? palette?.[value] ?? (value.startsWith('#') ? value : fallback)
}

const STATE_LABEL = {
  idle: '待命',
  walking: '赶路',
  working: '干活',
  talking: '交谈',
  blocked: '受阻',
  celebrating: '庆祝',
  sleeping: '休息',
}
const TASK_LABEL = {
  pending: '待办',
  ready: '可领取',
  in_progress: '进行中',
  blocked: '受阻',
  done: '完成',
  failed: '失败',
}
const ROLE_LABEL = {
  lead: 'lead',
  engineer: '工程师',
  reviewer: '评审',
  researcher: '调研',
  ops: '运维',
  docs: '文档',
}

function draw(snapshot) {
  const world = snapshot.world
  const palette = snapshot.palette ?? {}
  const W = canvas.clientWidth
  const H = canvas.clientHeight

  ctx.clearRect(0, 0, W, H)

  // 世界坐标 [-half, half] → 画布，留 6% 边距。
  const half = Math.max(...world.districts.flatMap((d) => [Math.abs(d.bounds.min.x), Math.abs(d.bounds.max.x)]), 4)
  const pad = 0.06
  const scale = Math.min(W, H) / (half * 2 * (1 + pad))
  const toX = (x) => W / 2 + x * scale
  const toY = (z) => H / 2 + z * scale

  // 1) 地块
  for (const d of world.districts) {
    const x = toX(Math.min(d.bounds.min.x, d.bounds.max.x))
    const z = toY(Math.min(d.bounds.min.z, d.bounds.max.z))
    const w = Math.abs(d.bounds.max.x - d.bounds.min.x) * scale
    const h = Math.abs(d.bounds.max.z - d.bounds.min.z) * scale
    ctx.fillStyle = color(d.ground, palette, '#3a3a44')
    ctx.fillRect(x, z, w, h)
    ctx.strokeStyle = 'rgba(255,255,255,0.10)'
    ctx.lineWidth = 1
    ctx.strokeRect(x + 0.5, z + 0.5, w - 1, h - 1)
    ctx.fillStyle = 'rgba(255,255,255,0.55)'
    ctx.font = '11px system-ui, sans-serif'
    ctx.fillText(d.name, x + 8, z + 16)
  }

  // 2) 站点
  for (const s of world.stations) {
    const occupied = world.agents.some((a) => a.station === s.id || a.targetStation === s.id)
    const size = s.capacity > 1 ? 16 : 12
    ctx.fillStyle = color(s.color ?? palette[`station.${s.kind}`], palette, '#8a8aa0')
    ctx.fillRect(toX(s.anchor.x) - size / 2, toY(s.anchor.z) - size / 2, size, size)
    ctx.strokeStyle = occupied ? '#ffffff' : 'rgba(0,0,0,0.35)'
    ctx.lineWidth = occupied ? 2 : 1
    ctx.strokeRect(toX(s.anchor.x) - size / 2, toY(s.anchor.z) - size / 2, size, size)
  }

  // 3) 角色
  for (const a of world.agents) {
    const cx = toX(a.position.x)
    const cy = toY(a.position.z)
    const r = 7
    const fill = color(a.palette, palette, '#ffffff')
    ctx.beginPath()
    ctx.arc(cx, cy, r, 0, Math.PI * 2)
    if (a.state === 'walking') {
      // 空心 = 在路上。一眼能分辨"在站上"和"赶路中"。
      ctx.lineWidth = 2.5
      ctx.strokeStyle = fill
      ctx.stroke()
    } else {
      ctx.fillStyle = fill
      ctx.fill()
      ctx.lineWidth = 1.5
      ctx.strokeStyle = 'rgba(0,0,0,0.45)'
      ctx.stroke()
    }
    ctx.fillStyle = 'rgba(255,255,255,0.85)'
    ctx.font = '10px system-ui, sans-serif'
    ctx.textAlign = 'center'
    ctx.fillText(a.name, cx, cy - r - 4)
    ctx.textAlign = 'start'
  }
}

function renderSide(snapshot) {
  const world = snapshot.world

  $roster.innerHTML = world.agents
    .map((a) => {
      const where = a.station
        ? (world.stations.find((s) => s.id === a.station)?.name ?? a.station)
        : a.targetStation
          ? `→ ${world.stations.find((s) => s.id === a.targetStation)?.name ?? a.targetStation}`
          : '广场'
      const task = a.carrying ? (world.tasks.find((t) => t.id === a.carrying)?.title ?? a.carrying) : null
      return `<li><b>${a.name}</b> <span class="dim">${ROLE_LABEL[a.role] ?? a.role}</span> · ${STATE_LABEL[a.state] ?? a.state} @ ${where}${task ? ` · <i>${task}</i>` : ''}</li>`
    })
    .join('')

  const order = { in_progress: 0, ready: 1, pending: 2, blocked: 3, done: 4, failed: 5 }
  $tasks.innerHTML = [...world.tasks]
    .sort((x, y) => (order[x.status] ?? 9) - (order[y.status] ?? 9) || x.ordinal - y.ordinal)
    .map((t) => {
      const owner = t.owner ? (world.agents.find((a) => a.id === t.owner)?.name ?? t.owner) : '无人'
      const pct = t.status === 'in_progress' ? ` ${Math.round(t.progress * 100)}%` : ''
      return `<li class="t-${t.status}"><span class="badge">${TASK_LABEL[t.status] ?? t.status}${pct}</span> ${t.title} <span class="dim">· ${owner}</span></li>`
    })
    .join('')

  const libs = snapshot.content.libraries
    .filter((l) => l.count > 0)
    .map((l) => `${l.title} ${l.count}`)
    .join(' · ')
  $content.textContent = `${snapshot.content.packs.map((p) => `${p.id}@${p.version}`).join('、')} — ${libs}`

  const states = world.agents.reduce((acc, a) => ({ ...acc, [a.state]: (acc[a.state] ?? 0) + 1 }), {})
  const stateText = Object.entries(states)
    .map(([k, v]) => `${STATE_LABEL[k] ?? k} ${v}`)
    .join(' ')
  $status.innerHTML = [
    `tick <b>${world.tick}</b>`,
    world.paused ? '<b class="warn">已暂停</b>' : '<b class="ok">运行中</b>',
    `seq ${snapshot.seq}`,
    `事件 ${snapshot.runtime.diagnostics.ticks} 步`,
    snapshot.runtime.pending > 0 ? `待处理命令 ${snapshot.runtime.pending}` : '',
    stateText,
  ]
    .filter(Boolean)
    .join(' · ')
}

async function poll() {
  try {
    const res = await fetch(`${API}?t=${Date.now()}`, { cache: 'no-store' })
    if (!res.ok) {
      const body = await res.json().catch(() => ({}))
      $status.innerHTML = `<b class="warn">读不到世界（HTTP ${res.status}）</b> ${body.error ?? ''}`
      return
    }
    const snapshot = await res.json()
    latest = snapshot
    draw(snapshot)
    renderSide(snapshot)
  } catch (error) {
    $status.innerHTML = `<b class="warn">连接失败</b> ${error}`
  }
}

document.querySelectorAll('button[data-command]').forEach((button) => {
  button.addEventListener('click', async () => {
    const kind = button.dataset.command
    try {
      const res = await fetch(COMMAND_API, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ command: { kind } }),
      })
      const body = await res.json()
      if (!res.ok) $status.innerHTML = `<b class="warn">命令被拒</b> ${body.error ?? ''}`
      else poll()
    } catch (error) {
      $status.innerHTML = `<b class="warn">命令失败</b> ${error}`
    }
  })
})

window.addEventListener('resize', () => {
  fitCanvas()
  if (latest) draw(latest)
})

fitCanvas()
poll()
setInterval(poll, POLL_MS)
