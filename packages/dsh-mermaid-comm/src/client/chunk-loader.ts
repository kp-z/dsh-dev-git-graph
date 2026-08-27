/**
 * 懒加载 chunk loader：对话流首次出现 ```mermaid 围栏时，才通过 <script>
 * 注入 mermaid chunk（内含完整 mermaid，~7MB），避免拖慢启动。
 *
 * 机制（对齐 dsh-better-sidebar 已验证的方案）：
 * 1. 注入 <script src="/plugins/dsh-mermaid-comm/chunks/mermaid.js">
 *    （由本插件主机端 webServer 路由服务）。
 * 2. chunk 脚本注册 globalThis.__dshChunks__['mermaid-comm'] = (require) => {...}。
 * 3. 读取 factory，用平台 require 调用（通过 __DSH_MODULES__.import 解析
 *    react 等平台 external），拿到 chunk 导出。
 *
 * 缓存：内存单飞（一次 in-flight promise，失败即重试）。
 */

/** chunk 导出：一个命名导出表。 */
export type ChunkExports = Record<string, unknown>

/** 平台 external（chunk 构建时保持 external，运行时用 __DSH_MODULES__ 解析）。 */
const CHUNK_EXTERNALS = [
  'react',
  'react/jsx-runtime',
  'react-dom',
  'react-dom/client',
  '@deepseek-ai/dsh-client-ui-slots',
  '@deepseek-ai/dsh-client-ui-primitives',
  '@deepseek-ai/dsh-client-runtime/client',
]

/** chunk 的静态资源 URL（由主机端路由服务）。 */
export function chunkUrl(name: string): string {
  return `/plugins/dsh-mermaid-comm/chunks/${name}.js`
}

/** 读取全局 chunk 注册表。 */
function getChunkRegistry(): Record<string, (require: (spec: string) => unknown) => ChunkExports> {
  const g = globalThis as unknown as {
    __dshChunks__?: Record<string, (require: (spec: string) => unknown) => ChunkExports>
  }
  return g.__dshChunks__ ?? (g.__dshChunks__ = {})
}

/** 解析一个模块 spec：优先 __DSH_MODULES__，否则抛出。 */
function resolveModule(spec: string): unknown {
  const g = globalThis as unknown as {
    __DSH_MODULES__?: { import: (spec: string) => Promise<unknown>; require?: (spec: string) => unknown }
  }
  const modules = g.__DSH_MODULES__
  if (modules !== undefined) {
    // __DSH_MODULES__.import 是异步的，但 chunk factory 的 require 是同步的；
    // 这里用同步 require（若存在）或抛错由上层处理。
    if (typeof modules.require === 'function') return modules.require(spec)
    // 回退：返回一个懒代理不现实，直接抛错引导排查
    throw new Error(`[dsh-mermaid-comm] platform module "${spec}" 无法同步解析`)
  }
  throw new Error('[dsh-mermaid-comm] __DSH_MODULES__ 不可用，无法加载平台模块')
}

/** 加载一个 chunk（幂等、内存单飞）。 */
export async function loadChunk(name: 'mermaid-comm'): Promise<ChunkExports> {
  const registry = getChunkRegistry()
  const existing = registry[name]
  if (existing !== undefined) {
    // 已注册：构造 require 并调用
    return callFactory(existing)
  }

  // 注入 <script>
  await injectScript(chunkUrl(name))

  const factory = getChunkRegistry()[name]
  if (factory === undefined) {
    throw new Error(`[dsh-mermaid-comm] chunk "${name}" 加载后未注册 factory`)
  }
  return callFactory(factory)
}

function callFactory(factory: (require: (spec: string) => unknown) => ChunkExports): ChunkExports {
  return factory((spec) => {
    if (CHUNK_EXTERNALS.includes(spec)) return resolveModule(spec)
    // 非 external（应为 chunk 内联的模块）——若走到这里说明构建配置有误
    throw new Error(`[dsh-mermaid-comm] chunk 请求了未 external 的模块 "${spec}"`)
  })
}

function injectScript(src: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const existing = document.querySelector(`script[data-dsh-chunk="${src}"]`)
    if (existing !== null) {
      // 已存在但可能还没执行完：等它执行
      resolve()
      return
    }
    const script = document.createElement('script')
    script.src = src
    script.dataset.dshChunk = src
    script.onload = () => resolve()
    script.onerror = () => reject(new Error(`[dsh-mermaid-comm] 加载 chunk 失败: ${src}`))
    document.head.appendChild(script)
  })
}
