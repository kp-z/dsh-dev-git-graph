/**
 * Mermaid 渲染逻辑（mermaid 懒加载 chunk 内）。
 *
 * 注意：本文件会被 tsdown 打进独立的 client-mermaid.js chunk，内含完整 mermaid
 * （约 7MB）。chunk 通过 globalThis.__dshChunks__ 注册，仅在对话流首次出现
 * ```mermaid 围栏时才被 <script> 加载——不拖慢启动。
 *
 * 安全：mermaid 用 securityLevel:'strict' + htmlLabels:false（label 为真实 SVG
 * <text>，无 raw-HTML foreignObject），且渲染出的 SVG 再经 sanitizeSvg 净化后才
 * 进入 DOM（防 label 夹带 <img onerror> 等）。不启用 bindFunctions（静态图）。
 */
import mermaid from 'mermaid'

/** 单调递增的渲染 id（mermaid.render 要求 document-unique id）。 */
let mermaidSeq = 0

/** 配置 mermaid（幂等）。跟随当前配色方案。 */
function configureMermaid(): void {
  const dark = typeof matchMedia !== 'undefined' && matchMedia('(prefers-color-scheme: dark)').matches
  mermaid.initialize({
    startOnLoad: false,
    securityLevel: 'strict',
    htmlLabels: false,
    theme: dark ? 'dark' : 'default',
  })
}

/**
 * 净化 mermaid 渲染的 SVG 后再进入 DOM（防御纵深）。
 * 剥离 foreignObject（唯一能携带 raw HTML 的通道）、script、事件属性、href。
 * 返回 '' 表示净化失败/不可用（调用方显示错误占位）。
 */
const STRIP_ELEMENTS = new Set([
  'foreignobject', 'script', 'img', 'iframe', 'object', 'embed',
  'video', 'audio', 'input', 'button', 'form', 'link', 'meta', 'base',
])

export function sanitizeSvg(svg: string): string {
  if (typeof DOMParser === 'undefined' || typeof XMLSerializer === 'undefined') return ''
  let doc: Document
  try {
    doc = new DOMParser().parseFromString(svg, 'image/svg+xml')
  } catch {
    return ''
  }
  // XML 解析失败（含 <parsererror>）直接拒绝
  if (doc.querySelector('parsererror')) return ''
  const root = doc.documentElement
  if (root === null || root.tagName.toLowerCase() !== 'svg') return ''

  const walk = (el: Element): void => {
    if (STRIP_ELEMENTS.has(el.tagName.toLowerCase())) {
      el.remove()
      return
    }
    for (const attr of Array.from(el.attributes)) {
      const name = attr.name.toLowerCase()
      if (name.startsWith('on') || name === 'href' || name === 'xlink:href') {
        el.removeAttribute(attr.name)
      }
    }
    for (const child of Array.from(el.children)) walk(child)
  }
  walk(root)
  try {
    return new XMLSerializer().serializeToString(doc)
  } catch {
    return ''
  }
}

/** 渲染一个 mermaid 源码为净化的 SVG 字符串。失败返回错误信息。 */
export async function renderMermaidToSvg(code: string): Promise<{ ok: true; svg: string } | { ok: false; error: string }> {
  try {
    configureMermaid()
    mermaidSeq += 1
    const id = `dsh-mermaid-comm-${Date.now()}-${mermaidSeq}`
    const { svg } = await mermaid.render(id, code)
    const clean = sanitizeSvg(svg)
    if (clean === '') return { ok: false, error: 'SVG 净化失败（图可能含不受支持的内容）' }
    return { ok: true, svg: clean }
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    return { ok: false, error: message.split('\n').slice(0, 6).join('\n') }
  }
}
