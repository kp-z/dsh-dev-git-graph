/*
 * 工单产出（R45 / M10-9）—— **纯函数，不碰 DOM**。
 *
 * ── 为什么单独一块 ──────────────────────────────────────────────────────────
 *
 * R44 之后，一张单的结论/失败原因就躺在世界数据里（`task.output` / `task.failureReason`，
 * 真机实测单张 1091 ~ 2246 字）。界面之前完全看不到它——用户问的是"Agent 在执行什么任务、
 * 干出了什么"，而产出正是这件事的答案。
 *
 * 这里只做**判断与切分**，不做排版：判断有多少字、要不要给"展开"、没有产出时那句说明该怎么写。
 * 排版（折叠几行、展开多大、内部滚动）是 CSS 与 UI 层的事，但"要不要折叠"这个决定依赖字符数，
 * 所以必须能在单测里算。
 *
 * ── 三条口径 ────────────────────────────────────────────────────────────────
 *
 * 1. **文本原样保留换行**（`pre-wrap`），不做 Markdown 渲染：产出是模型写的**内容**，
 *    而我们唯一的渲染通道是 `textContent`。把它当富文本解析等于自己开一个注入面。
 * 2. **`failed` 与 `done` 都可能没有产出**：真机上很多早期单（R44 之前）做完就是没有 `output`。
 *    这时不能说"还没有产出"——那是在说它没做完，是错的。按状态分两句（见 `noteFor`）。
 * 3. **产出与失败原因可以同时存在**（一张单做了一半、最后一步失败）：所以返回值是**一组**段落，
 *    而不是"二选一"。
 */

/** 折叠时显示几行。5 行 ≈ 一眼看得到结论的开头，又不会把看板铺满。 */
export const PREVIEW_LINES = 5

/** 终态：这两种状态下"没有产出"和"还没做完"是两件事。 */
const TERMINAL_STATUSES = new Set(['done', 'failed'])

const STATUS_TEXT = {
  pending: '待办',
  ready: '可领取',
  in_progress: '进行中',
  blocked: '受阻',
  done: '完成',
  failed: '失败',
}

/** 文本 → 行数组。`\r\n` 与孤立 `\r` 都当换行（真机的产出是模型写的，混用很常见）。 */
export function splitOutputLines(text) {
  if (typeof text !== 'string' || text === '') return []
  return text.replace(/\r\n?/g, '\n').split('\n')
}

/**
 * 一段长文本的展示模型：要不要折叠、预览是什么、一共有多少字。
 *
 * @param {string} text
 * @param {{previewLines?: number}} [options]
 */
export function summarizeText(text, options = {}) {
  const previewLines = Number.isFinite(options.previewLines) ? Math.max(1, options.previewLines) : PREVIEW_LINES
  const value = typeof text === 'string' ? text : ''
  const lines = splitOutputLines(value)
  // 字符数按**去掉首尾空白**算：模型有时会在结论外面包一层空行，那不该算进"1787 字"里。
  const chars = value.trim().length
  const collapsible = lines.length > previewLines
  const preview = collapsible ? lines.slice(0, previewLines).join('\n') : value
  return { text: value, chars, lines: lines.length, previewLines, collapsible, preview }
}

/** 没有产出时那句说明——**按状态分**，因为"还没做完"和"做完了没留文本"不是一回事。 */
export function noteFor(status) {
  const label = STATUS_TEXT[status] ?? status
  if (status === 'failed') return '这张单失败了，但没有留下失败原因。'
  if (TERMINAL_STATUSES.has(status)) return `这张单已经「${label}」，但没有留下产出文本。`
  return `还没有产出：这张单还在「${label}」。`
}

/**
 * 一张单该显示的产出段落。
 *
 * @param {{output?: unknown, failureReason?: unknown, status?: string}} task
 * @param {{previewLines?: number}} [options]
 * @returns {{sections: ReadonlyArray<object>, note: string|null, chars: number, hasContent: boolean}}
 */
export function summarizeTaskOutput(task, options = {}) {
  const sections = []
  const output = typeof task?.output === 'string' ? task.output : ''
  const failure = typeof task?.failureReason === 'string' ? task.failureReason : ''
  if (output.trim() !== '') sections.push({ kind: 'output', label: '产出', ...summarizeText(output, options) })
  // 失败原因排在**后面**：它是"最后发生了什么"，读的顺序上在产出之后；
  // 而一张 failed 且没有 output 的单，读者先看到的仍然是失败原因（它是唯一一段）。
  if (failure.trim() !== '') sections.push({ kind: 'failure', label: '失败原因', ...summarizeText(failure, options) })
  return {
    sections,
    note: sections.length === 0 ? noteFor(task?.status) : null,
    chars: sections.reduce((sum, section) => sum + section.chars, 0),
    hasContent: sections.length > 0,
  }
}
