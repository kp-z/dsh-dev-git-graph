/**
 * mermaid chunk 入口：把渲染逻辑导出给主 bundle 的 chunk-loader 调用。
 * 构建为 lib/client-mermaid.js（内含完整 mermaid），懒加载。
 */
export { renderMermaidToSvg, sanitizeSvg } from './mermaid.ts'
