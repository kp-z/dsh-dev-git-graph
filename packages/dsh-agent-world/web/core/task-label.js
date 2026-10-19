/*
 * 头顶工单行的**文本**（R123 / R5 收口）——纯函数，**不碰 Phaser**。
 *
 * ## 为什么单独一个文件
 *
 * `scene-phaser.js` 顶部 `import Phaser from 'phaser'`，而那份 phaser 是浏览器 vendor
 * （`web/vendor/phaser/...`，靠 index.html 的 importmap 解析）——**node 加载不了它**。
 * 于是"这个文件里的一切都无法单测"，包括这条纯文本逻辑。
 *
 * 而这条逻辑恰恰**必须**能单测：真机上它验不到。真实内容库的工单标题最长只有 **10 个字符**，
 * 而截断上限是 14——**"长标题会不会撑爆头顶"这件事靠真机永远碰不到**，
 * 要等某天接了外部系统、标题变长才会露出来。放这里就能在 node 里把那些情形跑一遍。
 *
 * （这也是项目一贯的分界：**"算"的逻辑进 `core/`，引擎那一半留在渲染层**。
 *   渲染层只负责"把算好的字画上去"。）
 */

/** 工单行最多显示多少个字（含短 id）——超了截断加省略号。 */
export const TASK_LABEL_MAX_CHARS = 14

/**
 * 工单行要显示的文字。
 *
 * 形如 `#27 定位问题边界`：短 id 让人能对上看板里的那一格，标题让人**不用去别处查**。
 * 超长截断——头顶标签是**提示**不是文档，把一行撑到半屏宽会盖住别人。
 *
 * @param {{id?: string, title?: string}} task
 * @returns {string} 没有任务时返回空串（调用方据此决定"不画这一行"）
 */
export function taskLabelText(task) {
  if (task === null || task === undefined) return ''
  const short = shortTaskIdOf(task.id)
  const title = typeof task.title === 'string' ? task.title.trim() : ''
  const head = short === '' ? '' : `#${short} `
  const room = TASK_LABEL_MAX_CHARS - head.length
  if (room <= 0) return head.trim()
  if (title === '') return head.trim()
  const clipped = title.length > room ? `${title.slice(0, Math.max(1, room - 1))}…` : title
  return `${head}${clipped}`
}

/** `task-27` → `27`（与看板里的短 id 同一个口径）。取不到数字就原样。 */
export function shortTaskIdOf(taskId) {
  const match = /(\d+)$/.exec(String(taskId ?? ''))
  return match === null ? String(taskId ?? '') : match[1]
}

/**
 * 错开时"相邻两行之间"的屏幕像素间距**下限**（≈ 一行标签高 + 一点缝）。
 *
 * ⚠️ 这只是**下限**：真机实测标签高 15.08px（13px 字号 + 描边），若固定用 15 当步长，
 * 错开一行后仍会**重叠 0.08px**，于是被判定"仍然相交"→ 第二行被藏掉 + 显示 `+1`。
 * 所以步长取 `max(本值, 组内最高标签 + 2)`，保证真的让开（见 `staggerStep`）。
 */
export const TASK_LABEL_LINE_GAP_PX = 15

/** 组内错开一行的实际步长：既要够一行高，也要留 2px 缝。 */
export function staggerStep(maxLabelHeight, lineGapPx = TASK_LABEL_LINE_GAP_PX) {
  const h = Number.isFinite(maxLabelHeight) ? maxLabelHeight : 0
  return Math.max(lineGapPx, h + 2)
}

/**
 * 组内最多往上错开几层（R148）。
 *
 * 为什么要封顶：错开位置是**离本人头顶多远**的度量——一个六人堆叠的组里，最后一个人会被挪到
 * 头顶 90px 以上，读者根本对不上"这行是谁的"。所以错到第 3 层就不再往上挪，
 * **再挤就进入"藏 + 计数"那条路**（`+N`），而不是让标签飞到天上。
 *
 * 副作用（正是我们要的）：三人同点这种极端重叠里，超过上限的人**仍然相交**，
 * 于是"藏多余的 + 留下的人带 `+N`"这条规则真的会被触发、也能被测到。
 */
export const TASK_LABEL_MAX_LEVELS = 3

/**
 * 头顶工单行的**错开布局**（R148 / task-24）——纯函数，可在 node 里单测。
 *
 * ## 为什么从"藏"改成"错开"
 *
 * R123 的降级方式是"两人靠近就把两行都**藏起来**"。方向（别糊成一团）是对的，
 * 但**降级方式选错了**：删信息 vs 挪位置。用户看到的是"这个人头顶没有工单行"，
 * 分不清**他没活**还是**被藏了**——信息无声消失。R124 把它记成遗留。
 *
 * ## 规则（Lead 定，不要改方向）
 *
 * 1. 屏幕距离近（横纵都 < `minGapPx`）的人归为**一组**；
 * 2. 组内按 **actor id 升序**稳定分配纵向错开位置：第 k 个往上挪 `k × lineGapPx`。
 *    用 id 排序（不用遍历顺序、不用距离）⇒ **同一现场每帧算出来完全一样**，不会抖；
 * 3. 错开后仍然重叠的（三人同点这种极端情况）才**藏多余的**：按 id 序保留靠前的，
 *    并把藏掉的数量回报给调用方（`hiddenCount`）——调用方在留下的那行后面加 `+N`，
 *    **不许静默消失**；
 * 4. 返回的是**屏幕像素**偏移；调用方按相机缩放折算回世界坐标。
 *
 * @param {ReadonlyArray<{id: string, x: number, y: number, width: number, height: number}>} items
 *   每个待布局的工单行：`x/y` 是**屏幕**坐标（标签底边中点），`width/height` 是标签尺寸。
 * @param {{minGapPx?: number, lineGapPx?: number}} [options]
 * @returns {ReadonlyArray<{id: string, offsetY: number, hidden: boolean, hiddenCount: number}>}
 *   `offsetY` 是相对基准位置的**屏幕**位移（负数 = 往上）；`hiddenCount > 0` 的那条要显示 `+N`。
 */
export function planTaskLabelStagger(items, options = {}) {
  const minGapPx = Number.isFinite(options.minGapPx) ? options.minGapPx : 72
  const lineGapPx = Number.isFinite(options.lineGapPx) ? options.lineGapPx : TASK_LABEL_LINE_GAP_PX
  const list = Array.isArray(items) ? items : []

  /** 按 id 升序——**稳定的全部来源**：不用遍历顺序、不用距离，同一现场每帧结果一致。 */
  const sorted = [...list].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))

  // ① 分组：横纵都近才算一组（上下分开的人不会撞标签）。
  const groups = []
  for (const item of sorted) {
    const group = groups.find((g) => g.some((m) => Math.abs(m.x - item.x) < minGapPx && Math.abs(m.y - item.y) < minGapPx))
    if (group === undefined) groups.push([item])
    else group.push(item)
  }

  const out = new Map()
  for (const item of sorted) out.set(item.id, { id: item.id, offsetY: 0, hidden: false, hiddenCount: 0 })

  for (const group of groups) {
    if (group.length < 2) continue
    // ② 组内按 id 序依次往上错开一行（封顶 `TASK_LABEL_MAX_LEVELS`，见常量注释）。
    //    步长按**组内最高的那个标签**算，保证错开后真的不相交（固定 15 会在 15.08 高的标签上差 0.08px）。
    //    `+ 0` 是为了消掉 `-0`：`-0 * step` 是 `-0`，而 `assert.deepEqual` 区分 `-0` 与 `0`。
    const step = staggerStep(Math.max(...group.map((item) => (Number.isFinite(item.height) ? item.height : 0))), lineGapPx)
    group.forEach((item, index) => {
      out.get(item.id).offsetY = -Math.min(index, TASK_LABEL_MAX_LEVELS - 1) * step + 0
    })
    // ③ 错开后仍然重叠的，按 id 序保留靠前的，其余藏掉并计数。
    //    先把"藏谁、被谁挡住"记下来，**最后**才把计数派给**仍然可见**的宿主：
    //    宿主自己也可能被后面的人挤掉，而藏起来的标签没法显示 `+N`（计数会凭空消失）。
    const kept = []
    const blockedBy = new Map()
    for (const item of group) {
      const entry = out.get(item.id)
      const y = item.y + entry.offsetY
      const clash = kept.find(
        (k) => Math.abs(k.x - item.x) < (k.width + item.width) / 2 && Math.abs(k.y - y) < (k.height + item.height) / 2,
      )
      if (clash !== undefined) {
        entry.hidden = true
        blockedBy.set(item.id, clash.id)
        continue
      }
      // ⚠️ 尺寸必须一起带上：上面的相交判断要读 `width/height`，
      // 少了它们 `Math.abs(...) < undefined` 恒为 false ⇒ **永远不相交、永远不藏、计数永远是 0**
      //（这个错我写的时候真踩了：重构 `kept` 的形状时忘了这里）。
      kept.push({ id: item.id, x: item.x, y, width: item.width, height: item.height })
    }
    for (const [blocked, hostId] of blockedBy) {
      const host = out.get(hostId)
      if (host !== undefined && host.hidden !== true) host.hiddenCount += 1
      else {
        // 宿主也被藏了：顺延给下一个可见的人，计数绝不能丢。
        const fallback = kept.find((k) => out.get(k.id).hidden !== true)
        if (fallback !== undefined) out.get(fallback.id).hiddenCount += 1
        void blocked
      }
    }
  }
  return sorted.map((item) => out.get(item.id))
}
