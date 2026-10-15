/*
 * 图例（R32）—— 左下角一枚可收起的小胶囊。
 *
 * 原来那行图例是"调试遗留物"：一直占着一行、颜色写死在 CSS 里、和内容库对不上。
 * 现在它：
 * · 默认**收起**成"图例"两字，点开才展开（DESIGN 第零节第 3 条）；
 * · 色值**从当前场景（`ScenePlan`）里取**——图例与画面永远是同一份真相，
 *   换皮肤时图例跟着变，不需要改代码；
 * · 只列画面里真的会出现的东西（没有纸条就不列纸条）。
 */

function esc(text) {
  return String(text).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c])
}

/**
 * 建图例。
 *
 * @param {object} options
 * @param {HTMLElement} options.root - 图例容器。
 * @param {Document} [options.document]
 */
export function createLegend(options) {
  const doc = options.document ?? globalThis.document
  const root = options.root
  const ready = root !== null && root !== undefined
  let collapsed = true
  let lastSignature = null

  if (ready) {
    const button = doc.createElement('button')
    button.type = 'button'
    button.className = 'legend-toggle'
    button.addEventListener('click', (event) => {
      event.stopPropagation()
      setCollapsed(!collapsed)
    })
    root.append(button)
    const list = doc.createElement('div')
    list.className = 'legend-items'
    root.append(list)
    setCollapsed(true)
  }

  function setCollapsed(next) {
    collapsed = next
    if (!ready) return
    root.classList.toggle('is-collapsed', collapsed)
    const button = root.querySelector('.legend-toggle')
    if (button !== null) {
      button.textContent = collapsed ? '图例' : '图例 ·'
      button.title = collapsed ? '展开图例' : '收起图例'
    }
  }

  /** @param {{scene: object}} input */
  function update(input) {
    if (!ready) return
    const scene = input.scene
    if (scene === null || scene === undefined) return
    const items = []
    const firstGround = scene.ground?.[0]
    if (firstGround !== undefined) items.push({ color: firstGround.color, label: '地块' })
    const firstProp = scene.props?.[0]
    if (firstProp !== undefined) items.push({ color: firstProp.color, label: '站点' })
    const firstActor = scene.actors?.[0]
    if (firstActor !== undefined) items.push({ color: firstActor.color, label: '角色（空心=在路上）' })
    for (const [kind, color] of Object.entries(scene.noteColors ?? {})) {
      items.push({ color, label: `纸条 · ${kind}` })
    }

    const signature = items.map((i) => `${i.color}:${i.label}`).join('|')
    if (signature === lastSignature) return
    lastSignature = signature
    const list = root.querySelector('.legend-items')
    if (list === null) return
    list.innerHTML = items
      .map((item) => `<span class="legend-item"><i class="legend-swatch" style="--swatch:${esc(item.color)}"></i>${esc(item.label)}</span>`)
      .join('')
  }

  return { ready, update, setCollapsed, isCollapsed: () => collapsed }
}
