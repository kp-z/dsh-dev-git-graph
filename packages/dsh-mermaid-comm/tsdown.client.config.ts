import type { UserConfig } from 'tsdown'

/**
 * 客户端主 bundle 构建。
 * 输出 lib/client.js：通过 window.__ModuleLoader__.load 注册，
 * dsh web 前端在启动时加载。不含 mermaid（mermaid 在独立 chunk 懒加载）。
 *
 * react 等平台库保持 external（__ModuleLoader__ 解析），
 * 其余依赖（@deepseek-ai/dsh-client-runtime 等）由 web 前端模块表解析。
 */
const config: UserConfig = {
  name: 'dsh-mermaid-comm/client',
  entry: { client: 'src/client/index.ts' },
  outDir: 'lib',
  format: 'cjs',
  platform: 'browser',
  target: 'es2022',
  dts: false,
  sourcemap: true,
  clean: false,
  external: [
    'react',
    'react/jsx-runtime',
    'react-dom',
    'react-dom/client',
    '@deepseek-ai/dsh-client-runtime/client',
    '@deepseek-ai/dsh-client-ui-slots',
    '@deepseek-ai/dsh-client-ui-primitives',
    '@deepseek-ai/dsh-client-ui-conversation',
  ],
  outputOptions: {
    entryFileNames: 'client.js',
    banner: 'window.__ModuleLoader__.load({ id: "dsh-mermaid-comm", factory: (require) => {',
    footer: 'return module.exports; } });',
    intro: 'var module = { exports: {} }; var exports = module.exports;',
  },
}

export default config
