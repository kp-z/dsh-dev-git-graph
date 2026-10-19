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
 * @returns {Promise<{setWorldSession: (info: object|null) => void, setTeamProjection: (team: object|null) => void, dispose: () => void}>}
 */
export async function mountEmbeddedApp(container, options = {}) {
  if (container === null || container === undefined) throw new Error('mountEmbeddedApp: container 不能为空')
  const doc = container.ownerDocument ?? globalThis.document
  const baseUrl = normalizeBase(options.baseUrl ?? '/agent-world')
  const sessionId = typeof options.sessionId === 'string' ? options.sessionId : undefined
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
  const inner = mountAgentWorld({ root: container, baseUrl, embedded: true, document: doc, sessionId })

  return createEmbeddedHandle(inner, function cleanup() {
    style.remove()
    container.replaceChildren()
    delete container.dataset.agentWorld
  })
}

/**
 * 把 `mountAgentWorld` 的返回值包成 **稳定的 handle 契约**。
 *
 * 为什么需要这层：`main.js` 与 `embed.js` 是两个独立加载的模块（一个是动态 import 的
 * 装配代码，一个是宿主侧客户端），版本可能不一致——老页面返回的 handle 里没有
 * `setTeamProjection`，client 一调用就是 `handle.setTeamProjection is not a function`，
 * 异常从 React effect 里冒出去，整个 Agent World 变成错误浮层。
 *
 * 所以这里保证：**返回对象永远有 setWorldSession / setTeamProjection / dispose**；
 * 内部 hook 缺失、或页面实现里抛错，都静默降级（会话名与 team projection 只是附加信息，
 * 不该决定世界能不能起来）。`dispose` 同时做成幂等，React 严格模式/重复清理都安全。
 *
 * @param {object|null|undefined} inner - `mountAgentWorld` 的返回值。
 * @param {() => void} [cleanup] - 宿主容器级清理（样式、DOM）。
 * @returns {{setWorldSession: (info: object|null) => void, setTeamProjection: (team: object|null) => void, dispose: () => void}}
 */
export function createEmbeddedHandle(inner, cleanup = () => {}) {
  /** 调用 inner 上的可选 hook；不存在或抛错都静默跳过。 */
  const call = (name, value) => {
    const fn = inner === null || inner === undefined ? undefined : inner[name]
    if (typeof fn !== 'function') return
    try {
      fn.call(inner, value)
    } catch (error) {
      // 附加 hook（会话名 / projection）失败只影响信息展示，不打断世界本身。
    }
  }

  let disposed = false
  return {
    /** 把**左侧工作区当前会话**的名字交给 header（null = 没有选中）。 */
    setWorldSession(info) {
      call('setWorldSession', info)
    },
    /** 官方 agentTeam projection（members/tasks）交给页面；页面没接就什么都不做。 */
    setTeamProjection(team) {
      call('setTeamProjection', team)
    },
    dispose() {
      if (disposed) return
      disposed = true
      try {
        call('dispose')
      } finally {
        try {
          cleanup()
        } catch (error) {
          // 容器已经被宿主卸掉时清理会失败；此时没有可恢复的状态。
        }
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
