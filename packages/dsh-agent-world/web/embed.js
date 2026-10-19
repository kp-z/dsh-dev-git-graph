/*
 * 把 Agent World 挂进 **DSH 主面板**（R161）。
 *
 * ## 为什么不是 iframe
 *
 * DSH 的 UI 规范明确：插件页面要用 React 组件渲染在 slot 里，**不要把 Host 吐的
 * HTML 塞进 iframe**——iframe 文档拿不到宿主的主题 token、语言与亮暗切换。
 * 所以这里做的是"把同一套 web 资源挂到任意容器"：
 *
 *   `mountEmbeddedApp(container, { baseUrl })`
 *     1. 取 `/agent-world/index.html` 里的 `.app`（去掉它自己的顶栏/底栏，宿主已有）；
 *     2. 把 `styles/*.css` 注入为 **@scope (#容器 id)**，避免污染宿主；
 *     3. 动态 import `./main.js` 的 `mountAgentWorld()`，以 `root=容器` 启动。
 *
 * 独立页面（`index.html` → `main.js` 自动挂载）和嵌入模式共用同一份装配代码。
 *
 * ## ⚠️ 只支持挂一份
 *
 * `main.js` 的装配状态是模块级的（`world`/`meta`/`scene2d`…）；DSH 的 main panel
 * 同一时刻只显示一个页面，所以一份就够。真要多实例，得把 `mountAgentWorld` 内部状态
 * 全部收进闭包（它已经是闭包，但 `globalThis.__agentWorld*` 门面是单例）。
 */

const STYLE_FILES = ['tokens', 'base', 'components', 'layout', 'sidebar']
const EMBEDDED_FLAG = '__AGENT_WORLD_EMBEDDED__'

/**
 * 把应用挂进一个容器。
 *
 * @param {HTMLElement} container - 宿主给的空容器（会被填满）。
 * @param {object} [options]
 * @param {string} [options.baseUrl] - 插件路由前缀，默认 `/agent-world`。
 * @returns {Promise<{dispose: () => void}>}
 */
export async function mountEmbeddedApp(container, options = {}) {
  if (container === null || container === undefined) throw new Error('mountEmbeddedApp: container 不能为空')
  const doc = container.ownerDocument ?? globalThis.document
  const baseUrl = normalizeBase(options.baseUrl ?? '/agent-world')
  const rootId = container.id === '' ? 'agent-world-root' : container.id
  container.id = rootId
  container.dataset.agentWorld = '1'

  // ── 1) 标记 + 取标记 + 去掉独立页自己的顶栏/底栏 ───────────────────────────
  globalThis[EMBEDDED_FLAG] = true
  const html = await fetchText(`${baseUrl}/index.html`)
  const parsed = new doc.defaultView.DOMParser().parseFromString(html, 'text/html')
  const app = parsed.querySelector('.app')
  if (app === null) throw new Error('Agent World 的 index.html 里找不到 .app（页面结构变了？）')
  // R162：顶栏**保留**（它现在也是会话名的 header），只去掉独立页的底栏状态条。
  app.querySelector('.footer')?.remove()

  // ── 2) 样式：tokens 放变量到容器上，其余全部 @scope 在容器内 ────────────────
  const cssFiles = await Promise.all(STYLE_FILES.map((name) => fetchText(`${baseUrl}/styles/${name}.css`)))
  const style = doc.createElement('style')
  style.dataset.agentWorldStyle = rootId
  style.textContent = buildScopedCss(cssFiles, rootId)
  doc.head.append(style)

  container.replaceChildren(app)

  // ── 3) 启动装配（main.js 的自动挂载被上面的 flag 关掉）──────────────────────
  const { mountAgentWorld } = await import('./main.js')
  const handle = mountAgentWorld({ root: container, baseUrl, embedded: true, document: doc })

  return {
    /** 把**左侧工作区当前会话**的名字交给 header（null = 没有选中）。 */
    setWorldSession(info) {
      handle.setWorldSession(info)
    },
    dispose() {
      try {
        handle.dispose()
      } finally {
        style.remove()
        container.replaceChildren()
        delete container.dataset.agentWorld
      }
    },
  }
}

function normalizeBase(value) {
  const text = String(value ?? '').trim()
  if (text === '' || text === '/') return ''
  return text.replace(/\/$/, '')
}

async function fetchText(url) {
  const response = await fetch(url, { credentials: 'same-origin' })
  if (response.ok !== true) throw new Error(`${url} 取不到（HTTP ${response.status}）`)
  return response.text()
}

/**
 * 把五份 CSS 变成"只作用于这个容器"的一段。
 *
 * - `tokens.css`：` :root` → `#rootId`（变量要落在容器上，子树才能继承；
 *   放进 `@scope` 的话根节点自己不在作用域里，变量会全部失效）；
 * - 其余四份：整体包进 `@scope (#rootId) { … }`，选择器一个都不改；
 * - 再补一小段"嵌入布局"覆盖：登录页的 `.app` 是整页网格（顶栏/舞台/底栏），
 *   嵌进 panel 之后没有顶栏和底栏，要改成 1 行 2 列、高度 100%。
 */
function buildScopedCss(files, rootId) {
  const [tokens, ...rest] = files
  const scopedTokens = tokens
    .replace(/:root\s*\{/g, `#${rootId} {`)
    .replace(/(^|\n)#board,/g, `$1#${rootId} #board,`)
    .replace(/(^|\n)#sidebar\s*\{/g, `$1#${rootId} #sidebar {`)
  const scopedRest = rest.map((css) => `@scope (#${rootId}) {\n${css}\n}`).join('\n')
  return `${scopedTokens}\n${scopedRest}\n${embeddedLayoutCss(rootId)}`
}

function embeddedLayoutCss(rootId) {
  return `
/* R161：嵌入 DSH main panel 后的布局覆盖。 */
#${rootId} {
  position: relative;
  width: 100%;
  height: 100%;
  overflow: hidden;
  background: var(--bg-0);
  color: var(--fg-0);
  font-family: var(--ui-font);
}
#${rootId} .app {
  height: 100%;
  padding: 0;
  gap: 0;
  grid-template-rows: 48px 1fr;
  grid-template-columns: 1fr var(--sidebar-w);
  --sidebar-w: clamp(320px, 42%, 560px);
  background: var(--bg-0);
}
#${rootId} .topbar {
  grid-row: 1;
  grid-column: 1 / -1;
  border-radius: 0;
  border-top: 0;
  border-left: 0;
  border-right: 0;
  box-shadow: none;
}
#${rootId} .stage {
  grid-row: 2;
  grid-column: 1;
  border: 0;
  border-radius: 0;
  box-shadow: none;
}
#${rootId} #sidebar {
  grid-row: 2;
  grid-column: 2;
  border: 0;
  box-shadow: none;
}
#${rootId} .app.is-sidebar-collapsed {
  grid-template-columns: 1fr;
}
`
}
