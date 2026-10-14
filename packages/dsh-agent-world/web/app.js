/*
 * Agent World 面板 —— 2D 俯视图（M3-5 的最小可见版本）。
 *
 * 它**不是**最终的 3D 场景（那是 M4）。它存在的理由是两件事：
 *   1. 让模拟立刻"看得见"——在那之前只能读工具输出的文本；
 *   2. 当 3D 调不出来的时候，它是唯一能看清模拟对不对的窗口。
 * 所以这个俯视图**值得永久保留**，M4 之后作为"调试视图"切换。
 *
 * ── 它只吃两样东西 ───────────────────────────────────────────────────────────
 *
 * - `snapshot.scene`（**ScenePlan**）：要摆什么。地块、站点、角色，颜色**已经解析好**。
 * - `snapshot.world`：花名册与工单板这类文本内容。
 *
 * 关键在于：**这里没有任何 token 解析**。以前的版本要自己剥 `skin.` 前缀再查
 * `palette`，现在不用了——那份活归服务端（决策 D22）。所以将来换成 three.js，
 * 换掉的只是"怎么把 ScenePlan 画出来"，不会碰到上游任何一层。
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

/**
 * 画一帧。
 *
 * 只依赖 `scene`，不读 `world` 的几何字段——这就是"渲染层是哑客户端"的样子。
 */
function draw(scene) {
  const W = canvas.clientWidth
  const H = canvas.clientHeight
  ctx.clearRect(0, 0, W, H)

  // 世界坐标 [-half, half] → 画布，留 6% 边距。半径来自内容（小镇多大是内容说了算）。
  const half = scene.extent.half
  const pad = 0.06
  const scale = Math.min(W, H) / (half * 2 * (1 + pad))
  const toX = (x) => W / 2 + x * scale
  const toY = (z) => H / 2 + z * scale

  // 1) 地面
  ctx.font = '11px system-ui, sans-serif'
  for (const g of scene.ground) {
    const x = toX(g.x - g.width / 2)
    const y = toY(g.z - g.depth / 2)
    ctx.fillStyle = g.color
    ctx.fillRect(x, y, g.width * scale, g.depth * scale)
    ctx.strokeStyle = 'rgba(255,255,255,0.10)'
    ctx.lineWidth = 1
    ctx.strokeRect(x + 0.5, y + 0.5, g.width * scale - 1, g.depth * scale - 1)
    ctx.fillStyle = 'rgba(255,255,255,0.55)'
    ctx.fillText(g.name, x + 8, y + 16)
  }

  // 2) 站点
  for (const p of scene.props) {
    const size = p.capacity > 1 ? 16 : 12
    const x = toX(p.x) - size / 2
    const y = toY(p.z) - size / 2
    ctx.fillStyle = p.color
    ctx.fillRect(x, y, size, size)
    ctx.strokeStyle = p.occupied ? '#ffffff' : 'rgba(0,0,0,0.35)'
    ctx.lineWidth = p.occupied ? 2 : 1
    ctx.strokeRect(x, y, size, size)
  }

  // 3) 角色
  for (const a of scene.actors) {
    const cx = toX(a.x)
    const cy = toY(a.z)
    const r = 7
    ctx.beginPath()
    ctx.arc(cx, cy, r, 0, Math.PI * 2)
    if (a.state === 'walking') {
      // 空心 = 在路上。一眼能分辨"在站上"和"赶路中"。
      ctx.lineWidth = 2.5
      ctx.strokeStyle = a.color
      ctx.stroke()
    } else {
      ctx.fillStyle = a.color
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
  const theme = snapshot.scene?.theme
  $content.textContent = `${snapshot.content.packs.map((p) => `${p.id}@${p.version}`).join('、')} — ${libs}${theme ? ` · 主题：${theme.name}（${theme.camera.projection} ${theme.camera.yawDeg}°/${theme.camera.pitchDeg}°）` : ''}`

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
    draw(snapshot.scene)
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
  if (latest) draw(latest.scene)
})

fitCanvas()
poll()
setInterval(poll, POLL_MS)
