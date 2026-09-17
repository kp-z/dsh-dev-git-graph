/**
 * 面板静态资源：面板是一张自包含的 HTML，由宿主路由直接吐给浏览器。
 *
 * 为什么是"宿主路由 + iframe"而不是宿主内建组件：面板要画的东西（树、卡片、时光轴、
 * 实时流）跟宿主现有组件的形态差得远，塞进宿主的渲染树只会两边都别扭。走一条自己的路由，
 * 面板就只是一个网页——可以用 `curl` 看、可以在浏览器里调、可以独立迭代，不必跟着宿主的
 * 组件契约走。代价是主题需要自己同步（宿主注入的 CSS 变量在 iframe 里取不到）。
 */
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

/** 面板 HTML 的磁盘位置。构建时 `src/panel.html` 会被复制到 `lib/panel.html`。 */
export function panelPath(): string {
  return fileURLToPath(new URL('./panel.html', import.meta.url))
}

/**
 * 读出面板 HTML。
 * @returns 面板内容。
 * @throws 文件缺失或读不动时抛出（调用方负责翻成 HTTP 状态码）。
 */
export async function readPanel(): Promise<string> {
  return await readFile(panelPath(), 'utf8')
}
