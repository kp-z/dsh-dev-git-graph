/*
 * 气泡定位（R39 / M7-11）—— **纯函数，不碰 DOM**。
 *
 * ── 要解决的问题（真机截图里一眼可见） ────────────────────────────────────────
 *
 * 气泡是 `#bubbles` 里的一层 DOM，位置由 `main.js` 每帧算。原来只做了一件事：
 * "把锚点（角色头顶）投影到画布坐标"。于是当角色走到画面右侧、而右侧浮动抽屉是打开的，
 * 气泡就**一半伸到玻璃抽屉底下**——看得见半句话，比看不见更糟（用户会以为面板坏了）。
 *
 * R32 已经给 3D 取景做过同一件事：`setViewInsets({right})` 让世界居中到"抽屉以外"。
 * 这里给气泡补上同一件事，而且**复用同一份量出来的右边距**（面板里两处各量一次必然漂移）。
 *
 * ── 两条设计决定（都写在这里，因为它们不是实现细节） ──────────────────────────
 *
 * 1. **锚点在抽屉下面时：贴到可见区右边缘 + 一个指向右边的小箭头**，而不是"干脆不显示"。
 *    理由：正因为他躲在抽屉底下，用户才看不见他；这时候**把他的话压掉等于双重损失**
 *    （人看不见、话也看不见）。贴上箭头至少回答了两个问题："他说了什么"和"他在哪个方向"。
 *    （另一个选项"不显示"更简单，但它把一个"看得见的活动"变成了"什么都没有"。）
 * 2. **纵向也要夹**：气泡画在锚点上方（CSS `translate(-50%,-100%)`），头顶贴到画面顶端时
 *    整块会被裁掉。这里把它压到可见区里；底部看板（展开时是一大块玻璃）也会顶开它。
 *
 * 输入输出都是纯数据，所以"1280/1024/800 下会不会被遮"可以**在单测里算**，不必每次开浏览器。
 */

/** 默认留边：气泡与可见区边缘之间至少这么多像素（贴边会看起来像被切了）。 */
export const DEFAULT_MARGIN = 8

function clamp(value, low, high) {
  if (!Number.isFinite(value)) return low
  return Math.min(Math.max(value, low), high)
}

/**
 * 算一个气泡该摆在哪。
 *
 * @param {object} input
 * @param {{x: number, y: number}} input.anchor - 角色头顶在**气泡层坐标**里的位置（画布相对像素）。
 * @param {{width: number, height: number}} input.size - 气泡自己的尺寸（实测；变了才量）。
 * @param {{width: number, height: number}} input.view - 可见层尺寸（`#bubbles` 的盒子 = 舞台）。
 * @param {number} [input.insetRight] - 右侧被抽屉占掉的宽度（**与 3D 取景用的是同一份**）。
 * @param {{top: number, bottom: number, left: number, right: number}|null} [input.board] - 底部看板的矩形（可选）。
 * @param {number} [input.margin]
 * @returns {{left: number, top: number, tailPercent: number, clamped: boolean, pinnedRight: boolean, tight: boolean, visible: boolean, occluded: boolean}}
 *   `left`/`top` 直接写进 `style.left`/`style.top`（配 CSS `translate(-50%,-100%)`）；
 *   `tailPercent` 是小箭头该指向的水平位置（气泡宽度的百分比）；
   `visible: false` 表示"可见区放不下这块气泡，别画它"（见下面的注释）。
 */
export function placeBubble(input = {}) {
  const anchor = input.anchor ?? { x: 0, y: 0 }
  const size = input.size ?? { width: 0, height: 0 }
  const view = input.view ?? { width: 0, height: 0 }
  const margin = Number.isFinite(input.margin) ? input.margin : DEFAULT_MARGIN
  const insetRight = Number.isFinite(input.insetRight) && input.insetRight > 0 ? input.insetRight : 0
  const board = input.board ?? null

  const visibleRight = Math.max(0, view.width - insetRight)
  const halfWidth = Math.max(0, size.width) / 2
  const boxMinLeft = margin + halfWidth
  const boxMaxLeft = visibleRight - margin - halfWidth
  // 可见区放不放得下整块气泡。
  //
  // 放不下时（`visible: false`）**这一块不显示**，因为"挤进去"的结果就是气泡一半在屏幕外、
  // 一半在抽屉下面——那正是这次要修的缺陷本身。什么时候会这样：极窄视口下抽屉会变成
  // **整幅宽的浮层**（`@media (max-width: 720px)` 把 `left/right` 都贴边），可见区几乎为零。
  // 那种情况下世界本身也被盖住了，"不说话"比"说半句"诚实。
  const fits = visibleRight >= Math.max(0, size.width) + 2 * margin
  const tight = boxMaxLeft < boxMinLeft

  let left
  let pinnedRight = false
  if (tight) {
    left = visibleRight / 2
  } else if (anchor.x > visibleRight) {
    // 锚点（人）在抽屉底下：贴右边缘 + 打箭头（决定 1）。
    left = boxMaxLeft
    pinnedRight = true
  } else if (anchor.x > boxMaxLeft) {
    left = boxMaxLeft
  } else if (anchor.x < boxMinLeft) {
    left = boxMinLeft
  } else {
    left = anchor.x
  }

  // 小箭头指向**真实的锚点**（贴边之后它不一定在气泡正中）。
  const boxLeft = left - halfWidth
  const tailPercent = size.width > 0 ? clamp(((anchor.x - boxLeft) / size.width) * 100, 4, 96) : 50

  // 纵向：气泡底边落在锚点上（锚点是头顶），所以要保证整块在可见区里。
  let top = Number.isFinite(anchor.y) ? anchor.y : 0
  const minTop = size.height + margin
  if (top < minTop) top = minTop
  if (board !== null && Number.isFinite(board.top)) {
    // 气泡横向与看板有交集、且会压到看板 → 抬到看板之上（看板是展开时的最大一块玻璃）。
    const overlapsBoard = left + halfWidth > board.left && left - halfWidth < board.right
    if (overlapsBoard && top > board.top - margin) top = board.top - margin
  }
  if (Number.isFinite(view.height)) top = Math.min(top, view.height - margin)

  // `clamped`：横向被夹住了（贴边）。这时"气泡在头顶正上方"这句话不再成立，
  // 所以要画一条指向真实头顶的小尾巴，否则看起来像"气泡飘到了别人头上"。
  const clamped = Math.abs(left - anchor.x) > 0.5
  return { left, top, tailPercent, clamped, pinnedRight, tight, visible: fits, occluded: anchor.x > visibleRight }
}

/**
 * 气泡有没有被抽屉遮住——给核验用（`__agentWorldBubbles.occluded()`）。
 *
 * 判据是**矩形相交**（气泡的盒子 vs 抽屉的盒子），不是"看起来像被遮"：
 * 贴边之后两者应当**完全不相交**，所以这个函数返回空数组才是合格的。
 *
 * @param {ReadonlyArray<{id: string, rect: {left: number, top: number, right: number, bottom: number}}>} bubbles
 * @param {{left: number, top: number, right: number, bottom: number}|null} drawer
 */
export function occludedBubbles(bubbles, drawer) {
  if (drawer === null || drawer === undefined) return []
  const out = []
  for (const bubble of bubbles ?? []) {
    const rect = bubble?.rect
    if (rect === undefined) continue
    const intersects =
      rect.right > drawer.left && rect.left < drawer.right && rect.bottom > drawer.top && rect.top < drawer.bottom
    if (intersects) {
      out.push({
        id: bubble.id,
        overlap: {
          x: Math.round(Math.min(rect.right, drawer.right) - Math.max(rect.left, drawer.left)),
          y: Math.round(Math.min(rect.bottom, drawer.bottom) - Math.max(rect.top, drawer.top)),
        },
      })
    }
  }
  return out
}
