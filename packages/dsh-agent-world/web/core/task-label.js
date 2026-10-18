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
