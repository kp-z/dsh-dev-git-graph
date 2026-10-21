/**
 * 手改碰撞体编辑器（R233）——`?edit=1`。
 *
 * 为什么要有它：从美术 alpha 自动推导碰撞体在"家具跨格/阴影/装饰"上会判断错，
 * 而这类错误只有人看一眼就知道。编辑器让人**直接画**：拖拽加一块、Alt+点击删一块，
 * 保存后写 `*-colliders-override.json`，宿主完全以它为准。
 *
 * 坐标：界面用世界像素，保存用**地图像素**（与 `*-colliders.json` 同一套）。
 */
const phaser = () => globalThis.__agentWorldPhaser
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function waitForSpace() {
  for (let i = 0; i < 120; i += 1) {
    const ph = phaser()
    const space = ph?.space?.()
    if (space?.nav && Array.isArray(space.obstacles)) return { ph, space }
    await sleep(100)
  }
  return null
}

function toolbar(count) {
  let root = document.getElementById('space-editor')
  if (root === null) {
    root = document.createElement('div')
    root.id = 'space-editor'
    root.style.cssText = [
      'position:fixed', 'right:14px', 'bottom:14px', 'z-index:9999',
      'background:rgba(20,22,28,.94)', 'color:#e8e8ea', 'border:1px solid #3a3f4b',
      'border-radius:10px', 'padding:10px 12px', 'font:12px/1.5 ui-sans-serif,system-ui',
      'box-shadow:0 8px 30px rgba(0,0,0,.35)', 'max-width:320px',
    ].join(';')
    document.body.appendChild(root)
  }
  root.innerHTML = ''
  const title = document.createElement('div')
  title.textContent = `碰撞体编辑器 · ${count} 块`
  title.style.cssText = 'font-weight:600;margin-bottom:6px'
  const hint = document.createElement('div')
  hint.textContent = '拖拽 = 加一块；Alt/右键点击 = 删一块；保存后立即生效。'
  hint.style.cssText = 'opacity:.75;margin-bottom:8px'
  const row = document.createElement('div')
  row.style.cssText = 'display:flex;gap:6px'
  const mk = (label, fn, primary) => {
    const b = document.createElement('button')
    b.textContent = label
    b.style.cssText = [
      'all:unset', 'cursor:pointer', 'padding:4px 9px', 'border-radius:6px',
      primary ? 'background:#3b82f6;color:#fff' : 'background:#2a2f3a;color:#dfe3ea',
    ].join(';')
    b.onclick = fn
    row.appendChild(b)
  }
  mk('保存', () => save(), true)
  mk('撤销', () => { if (rects.pop()) redraw() })
  mk('清空', () => { rects.length = 0; redraw() })
  mk('退出', () => {
    const u = new URL(location.href)
    u.searchParams.delete('edit')
    location.href = u.toString()
  })
  root.append(title, hint, row)
}

let ph = null
let space = null
let scene = null
let camera = null
let graphics = null
let rects = [] // 地图像素 [x,y,w,h]
let originX = 0
let originY = 0
let drag = null
let preview = null
let editable = true
let mapUrl = ''

const SNAP = 4

function snap(v) {
  return Math.round(v / SNAP) * SNAP
}

function toMap(worldX, worldY) {
  return { x: snap(worldX - originX), y: snap(worldY - originY) }
}

function drawOne(g, rect, color, alpha, fill) {
  const [x, y, w, h] = rect
  g.lineStyle(1, color, alpha)
  if (fill) g.fillStyle(color, 0.12)
  if (fill) g.fillRect(originX + x, originY + y, w, h)
  g.strokeRect(originX + x, originY + y, w, h)
}

function redraw() {
  if (graphics === null) return
  graphics.clear()
  for (const r of rects) drawOne(graphics, r, 0x34c759, 0.95, false)
  if (preview !== null) drawOne(graphics, preview, 0xfacc15, 1, true)
  toolbar(rects.length)
}

async function save() {
  const button = [...document.querySelectorAll('#space-editor button')][0]
  if (button) button.textContent = '保存中…'
  try {
    const res = await fetch('/agent-world/api/space-override', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ mapUrl, rects }),
    })
    const body = await res.json().catch(() => ({}))
    if (!res.ok) throw new Error(body?.error ?? res.status)
    location.reload()
  } catch (error) {
    if (button) button.textContent = '保存'
    toolbar(rects.length)
    hintError(String(error))
  }
}

function hintError(text) {
  const root = document.getElementById('space-editor')
  if (root === null) return
  const line = document.createElement('div')
  line.textContent = `保存失败：${text}`
  line.style.cssText = 'color:#fca5a5;margin-top:6px'
  root.appendChild(line)
}

async function boot() {
  const found = await waitForSpace()
  if (found === null) return
  ph = found.ph
  space = found.space
  scene = ph.scene?.()
  mapUrl = ph.mapUrl?.() ?? ''
  if (scene === null || mapUrl === '') return
  camera = scene.cameras.main

  const nav = space.nav
  originX = nav.originX * 16
  originY = nav.originZ * 16
  rects = space.obstacles.map((o) => [
    Math.round((o.x - nav.originX) * 16),
    Math.round((o.z - nav.originZ) * 16),
    Math.max(1, Math.round(o.w * 16)),
    Math.max(1, Math.round(o.h * 16)),
  ])

  graphics = scene.add.graphics()
  graphics.setDepth(4000)

  scene.input.on('pointerdown', (pointer) => {
    if (!editable) return
    const world = camera.getWorldPoint(pointer.x, pointer.y)
    if (pointer.event?.altKey || pointer.rightButtonDown()) {
      const hit = [...rects].reverse().find((r) => world.x - originX >= r[0] && world.x - originX <= r[0] + r[2] && world.y - originY >= r[1] && world.y - originY <= r[1] + r[3])
      if (hit) {
        rects.splice(rects.indexOf(hit), 1)
        redraw()
      }
      return
    }
    drag = toMap(world.x, world.y)
    preview = [drag.x, drag.y, 0, 0]
    redraw()
  })

  scene.input.on('pointermove', (pointer) => {
    if (drag === null) return
    const world = camera.getWorldPoint(pointer.x, pointer.y)
    const end = toMap(world.x, world.y)
    preview = [Math.min(drag.x, end.x), Math.min(drag.y, end.y), Math.abs(end.x - drag.x), Math.abs(end.y - drag.y)]
    redraw()
  })

  scene.input.on('pointerup', () => {
    if (drag === null) return
    if (preview !== null && preview[2] >= 4 && preview[3] >= 4) rects.push([...preview])
    drag = null
    preview = null
    redraw()
  })

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') { drag = null; preview = null; redraw() }
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's') {
      event.preventDefault()
      void save()
    }
  })

  redraw()
}

void boot()
