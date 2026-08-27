/**
 * dsh-mermaid-comm 客户端入口：对话流 Mermaid 渲染（B 支柱）。
 *
 * 策略（DOM 后处理，对齐 dsh-better-sidebar 已验证的渲染架构）：
 * - 用 MutationObserver 监听整个文档，找出 `pre > code.language-mermaid`
 *   （` ```mermaid ` 块在 primitives 里渲染为 pre > code.language-mermaid，
 *   shiki 无 mermaid grammar，走 plain 分支）。
 * - 懒加载 mermaid chunk（首次出现围栏时才加载 ~7MB 的 chunk），
 *   把代码文本渲染为净化的 SVG，替换 pre 的 children（保留 banner 和 host
 *   节点，避免 React reconciliation 丢失）。
 * - data-mermaid-processed 标记防重复处理；streaming 时内容变化会触发
 *   MutationObserver，重新渲染。
 *
 * 注意：这是客户端插件，通过 window.__ModuleLoader__.load 加载，
 * dsh.client.inject 声明对官方 client 包的依赖。
 */
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import { loadChunk } from './chunk-loader.ts'

/** 已处理标记（放 code 上，React 重渲染后由 observer 重新发现）。 */
const PROCESSED_ATTR = 'data-mermaid-comm-processed'

/** 当前是否正在渲染（避免并发重复渲染同一块）。 */
const rendering = new WeakSet<Element>()

/**
 * 从 code 元素向上找 md-code-block host（替换时保留它）。
 */
function findHost(codeEl: Element): HTMLElement | null {
  const host = codeEl.closest('.md-code-block')
  return host instanceof HTMLElement ? host : null
}

/** 提取 mermaid 源码文本（code 的 textContent 去尾换行）。 */
function extractCode(codeEl: Element): string {
  const text = codeEl.textContent ?? ''
  return text.endsWith('\n') ? text.slice(0, -1) : text
}

/** 渲染一个 mermaid 代码块为 SVG，替换 pre 内容。 */
async function renderBlock(codeEl: HTMLElement): Promise<void> {
  if (rendering.has(codeEl)) return
  const host = findHost(codeEl)
  if (host === null) return

  // 找 pre（body 容器）——替换它的 children 为图
  const pre = host.querySelector('pre')
  if (pre === null) return
  const preHost = pre as HTMLElement

  const code = extractCode(codeEl)

  // 已在处理/已渲染
  if (codeEl.getAttribute(PROCESSED_ATTR) === '1') {
    // 内容变化时清除标记，让 observer 重新处理
    const current = preHost.dataset.mermaidCode
    if (current === code) return // 未变化
    delete preHost.dataset.mermaidCode
  }

  rendering.add(codeEl)
  try {
    // 懒加载 mermaid chunk
    const mod = await loadChunk('mermaid-comm')
    const render = mod.renderMermaidToSvg as ((c: string) => Promise<{ ok: true; svg: string } | { ok: false; error: string }>) | undefined
    if (render === undefined) {
      throw new Error('chunk 缺少 renderMermaidToSvg')
    }

    // 渲染前先给 host 打标记（防止 observer 循环）
    preHost.dataset.mermaidCode = code
    codeEl.setAttribute(PROCESSED_ATTR, '1')

    const result = await render(code)
    if (!result.ok) {
      showError(preHost, result.error)
      return
    }

    // 用净化后的 SVG 替换 pre 内容（保留 pre 节点本身）
    preHost.innerHTML = result.svg
    preHost.classList.add('dsh-mermaid-rendered')
    // 让 SVG 自适应宽度
    const svg = preHost.querySelector('svg')
    if (svg !== null) {
      svg.style.maxWidth = '100%'
      svg.style.height = 'auto'
    }
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    showError(preHost, message)
  } finally {
    rendering.delete(codeEl)
  }
}

/** 显示渲染错误占位（保留 banner）。 */
function showError(preHost: HTMLElement, message: string): void {
  const lines = message.split('\n').slice(0, 4)
  preHost.innerHTML = ''
  const el = document.createElement('div')
  el.className = 'dsh-mermaid-error'
  el.setAttribute('role', 'alert')
  el.textContent = `⚠️ Mermaid 渲染失败：${lines.join(' ')}`
  preHost.appendChild(el)
}

/** 扫描指定子树里的 mermaid 代码块。 */
function scanMermaid(subtree: ParentNode, root: Document | HTMLElement): void {
  // 用文档级查询（code.language-mermaid 可能在任意深度）
  const codes = (subtree.querySelectorAll?.('code.language-mermaid') ?? [])
  for (const code of Array.from(codes)) {
    const el = code as HTMLElement
    if (rendering.has(el)) continue
    void renderBlock(el)
  }
  // 处理 subtree 本身是 code 的情况（MutationObserver addedNodes 可能直接是 code）
  if (subtree instanceof HTMLElement && subtree.matches('code.language-mermaid')) {
    if (!rendering.has(subtree)) void renderBlock(subtree)
  }
}

/** 启动渲染观察器。 */
function startObserver(): () => void {
  let debounce: number | undefined
  const scheduleScan = (): void => {
    if (debounce !== undefined) return
    debounce = window.setTimeout(() => {
      debounce = undefined
      scanMermaid(document, document)
    }, 300)
  }

  const observer = new MutationObserver((mutations) => {
    let needsScan = false
    for (const mut of mutations) {
      if (mut.type !== 'childList' && mut.type !== 'characterData') continue
      // 有新增节点 或 文本变化（streaming）
      if (mut.addedNodes.length > 0) {
        needsScan = true
        break
      }
      if (mut.type === 'characterData') {
        const parent = mut.target.parentElement
        if (parent?.classList?.contains('language-mermaid')) {
          needsScan = true
          break
        }
      }
    }
    if (needsScan) scheduleScan()
  })
  observer.observe(document.body, { childList: true, subtree: true, characterData: true })
  // 初次扫描
  scanMermaid(document, document)
  return () => observer.disconnect()
}

/** 客户端插件入口。仅用 ctx.effect（context 基础能力），无需额外 service。 */
export const inject: string[] = []

export function apply(ctx: ClientContext): void {
  ctx.effect(() => {
    const dispose = startObserver()
    return dispose
  }, 'dsh-mermaid-comm: chat mermaid renderer')
}
