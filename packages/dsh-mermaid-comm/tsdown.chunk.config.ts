import type { UserConfig } from 'tsdown'

/**
 * mermaid 懒加载 chunk 构建。
 * 输出 lib/client-mermaid.js：注册 globalThis.__dshChunks__['mermaid-comm']，
 * 内含完整 mermaid（~7MB），由客户端 chunk-loader 在首次出现 ```mermaid 时注入。
 *
 * 平台 external（react 等）保持 external，由 __DSH_MODULES__ 在运行时解析。
 * mermaid 及其传递依赖全部内联进单文件（inlineDynamicImports 关掉代码分割）。
 */
const config: UserConfig = {
  name: 'dsh-mermaid-comm/chunk',
  entry: { chunk: 'src/client/chunk-entry.ts' },
  outDir: 'lib',
  format: 'cjs',
  platform: 'browser',
  target: 'es2022',
  dts: false,
  sourcemap: false,
  clean: false,
  external: [
    'react',
    'react/jsx-runtime',
    'react-dom',
    'react-dom/client',
    '@deepseek-ai/dsh-client-ui-slots',
    '@deepseek-ai/dsh-client-ui-primitives',
    '@deepseek-ai/dsh-client-runtime/client',
  ],
  // mermaid 及其全部传递依赖（@mermaid-js/parser 等）强制内联进单文件 chunk。
  // 平台 external（react / @deepseek-ai/*）保持 external（external 优先于 noExternal）。
  noExternal: (id: string) => id.startsWith('react') || id.startsWith('@deepseek-ai/') ? undefined : true,
  outputOptions: {
    entryFileNames: 'client-mermaid.js',
    inlineDynamicImports: true,
    banner: 'globalThis.__dshChunks__ = globalThis.__dshChunks__ || {};\nglobalThis.__dshChunks__["mermaid-comm"] = (require) => {',
    footer: 'return module.exports; };',
    intro: 'var module = { exports: {} }; var exports = module.exports;',
  },
}

export default config
