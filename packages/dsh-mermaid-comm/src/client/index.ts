/**
 * dsh-mermaid-comm 客户端入口：对话流 Mermaid 渲染（B 支柱）。
 *
 * 策略（DOM 后处理，对齐 dsh-better-sidebar 已验证的渲染架构）：
 * - 用 MutationObserver 监听整个文档，找出 mermaid 代码块：
 *   `div.md-code-block` 里 banner 的 infostring 显示 "mermaid"
 *   （实测发现：真实对话渲染的 code 元素不带 language-mermaid class，
 *   语言信息在 banner；同时也兼容 code.language-mermaid 结构）。
 * - 懒加载 mermaid chunk（首次出现围栏时才加载 ~7MB 的 chunk），
 *   把代码文本渲染为净化的 SVG，替换 pre 的 children（保留 banner 和 host
 *   节点，避免 React reconciliation 丢失）。
 * - pre 的 data-mermaid-code 标记防重复处理；streaming 内容变化时
 *   MutationObserver 触发重新渲染。
 *
 * 注意：这是客户端插件，通过 window.__ModuleLoader__.load 加载，
 * dsh.client.inject 声明对官方 client 包的依赖。
 */
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import { loadChunk } from './chunk-loader.ts'

/** 当前是否正在渲染（避免并发重复渲染同一块）。 */
const rendering = new WeakSet<HTMLElement>()

/**
 * 从 code 元素向上找 md-code-block host（替换时保留它）。
 */
/**
 * 判断一个 md-code-block 是否是 mermaid 代码块。
 * 真实渲染里 code 元素不带 language-mermaid class，语言信息在 banner 的
 * infostring（显示 "mermaid"）。同时兼容 code.language-mermaid 结构。
 */
function isMermaidBlock(host: HTMLElement): boolean {
  // 兼容：code 带 language-mermaid class
  if (host.querySelector('code.language-mermaid') !== null) return true
  // 真实：banner infostring 显示 "mermaid"
  const info = host.querySelector('.infostring, [class*=infostring]')
  if (info !== null) {
    const text = info.textContent?.trim().toLowerCase() ?? ''
    return text === 'mermaid' || text.startsWith('mermaid')
  }
  // 兜底：banner 整体文本含 mermaid（CSS module class 可能不同）
  const banner = host.querySelector('[class*=banner]')
  if (banner !== null) {
    const text = banner.textContent?.trim().toLowerCase() ?? ''
    return text.includes('mermaid')
  }
  return false
}

/** 从 code 元素提取 mermaid 源码（去首尾空白）。 */
function extractCode(codeEl: Element): string {
  return (codeEl.textContent ?? '').trim()
}

/** 渲染一个 mermaid 代码块为 SVG，替换 pre 内容。 */
async function renderBlock(host: HTMLElement): Promise<void> {
  if (rendering.has(host)) return
  if (!isMermaidBlock(host)) return

  // 找 pre（body 容器）——替换它的 children 为图
  const pre = host.querySelector('pre')
  if (pre === null) return
  const preHost = pre as HTMLElement

  // 只从 pre > code 提取源码：
  // 已渲染的块 pre 里是 svg（无 code）→ 跳过；
  // 错误块 pre 里有隐藏 code（存原始源码）→ 支持重试。
  const codeEl = preHost.querySelector('code')
  if (codeEl === null) return
  const code = extractCode(codeEl)
  if (code === '') return

  // 防重：源码未变且非错误状态 → 跳过
  const lastCode = preHost.dataset.mermaidCode
  if (lastCode !== undefined) {
    if (lastCode === code) {
      // 无错误标记 → 已渲染/已处理，跳过
      if (!preHost.dataset.mermaidError) return
      // 有错误标记 → 重试，但限制频率（至少间隔 5s）
      const lastErr = Number(preHost.dataset.mermaidErrorAt ?? 0)
      if (Date.now() - lastErr < 5000) return
    } else {
      // 源码变化 → 清标记重渲染
      delete preHost.dataset.mermaidCode
      delete preHost.dataset.mermaidError
      delete preHost.dataset.mermaidErrorAt
      preHost.classList.remove('dsh-mermaid-rendered')
    }
  }

  rendering.add(host)
  try {
    // 懒加载 mermaid chunk
    const mod = await loadChunk('mermaid-comm')
    const render = mod.renderMermaidToSvg as ((c: string) => Promise<{ ok: true; svg: string } | { ok: false; error: string }>) | undefined
    if (render === undefined) {
      throw new Error('chunk 缺少 renderMermaidToSvg')
    }

    // 渲染前记录源码（内容未变则下次跳过；变化则触发重渲染）
    preHost.dataset.mermaidCode = code

    const result = await render(code)
    if (!result.ok) {
      showError(preHost, result.error)
      return
    }

    // 用净化后的 SVG 替换 pre 内容（保留 pre 节点本身）
    preHost.innerHTML = result.svg
    preHost.classList.add('dsh-mermaid-rendered')
    delete preHost.dataset.mermaidError
    delete preHost.dataset.mermaidErrorAt
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
    rendering.delete(host)
  }
}

/** 显示渲染错误占位（保留 banner）。pre 里保留一个隐藏 code 存源码，便于下次扫描重试。 */
function showError(preHost: HTMLElement, message: string): void {
  const lines = message.split('\n').slice(0, 4)
  const source = preHost.dataset.mermaidCode ?? ''
  preHost.innerHTML = ''
  const el = document.createElement('div')
  el.className = 'dsh-mermaid-error'
  el.setAttribute('role', 'alert')
  el.textContent = `⚠️ Mermaid 渲染失败：${lines.join(' ')}`
  preHost.appendChild(el)
  // 标记错误时间，限制重试频率
  preHost.dataset.mermaidError = '1'
  preHost.dataset.mermaidErrorAt = String(Date.now())
  if (source !== '') {
    // 保留隐藏 code，使 renderBlock 下次扫描能重新提取源码重试
    const hidden = document.createElement('code')
    hidden.style.display = 'none'
    hidden.textContent = source
    preHost.appendChild(hidden)
  }
}

/** 扫描文档里的 mermaid 代码块（以 .md-code-block 为单位）。 */
function scanMermaid(): void {
  const hosts = document.querySelectorAll('.md-code-block')
  for (const host of Array.from(hosts)) {
    const el = host as HTMLElement
    if (rendering.has(el)) continue
    void renderBlock(el)
  }
}

/** 启动渲染观察器。 */
function startObserver(): () => void {
  let debounce: number | undefined
  const scheduleScan = (): void => {
    if (debounce !== undefined) return
    debounce = window.setTimeout(() => {
      debounce = undefined
      scanMermaid()
    }, 300)
  }

  const observer = new MutationObserver((mutations) => {
    let needsScan = false
    for (const mut of mutations) {
      if (mut.type !== 'childList' && mut.type !== 'characterData') continue
      // 有新增节点（新消息/streaming 追加）
      if (mut.addedNodes.length > 0) {
        needsScan = true
        break
      }
      // 文本变化：若在已有 mermaid 块内（streaming 内容更新），需要重渲染
      if (mut.type === 'characterData') {
        const host = mut.target.parentElement?.closest?.('.md-code-block')
        if (host instanceof HTMLElement && isMermaidBlock(host)) {
          needsScan = true
          break
        }
      }
    }
    if (needsScan) scheduleScan()
  })
  observer.observe(document.body, { childList: true, subtree: true, characterData: true })
  // 初次扫描
  scanMermaid()
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
