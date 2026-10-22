#!/usr/bin/env node
/**
 * 把 better-sidebar 的 SubagentView（含 React/DOM/CSS Modules）打成独立 ESM。
 *
 * 产出：
 *   lib/web/vendor/subagent-view.js
 *   lib/web/vendor/subagent-view.css
 *
 * UI primitives 用本地 shim：这些是宿主的视觉 primitives，不能把整套 DSH
 * 运行时拖进插件；SubagentView 的布局/交互/数据仍然来自它自己的源码。
 */
import { build } from 'esbuild'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const pkg = resolve(here, '..')
const outdir = resolve(pkg, 'lib/web')

await build({
  entryPoints: [resolve(pkg, 'scripts/subagent-view/entry.jsx')],
  outfile: resolve(outdir, 'subagent-view.js'),
  bundle: true,
  format: 'esm',
  platform: 'browser',
  jsx: 'automatic',
  loader: { '.css': 'local-css', '.png': 'dataurl', '.svg': 'dataurl' },
  alias: {
    '@deepseek-ai/dsh-client-ui-primitives': resolve(pkg, 'scripts/subagent-view/primitives-stub.jsx'),
  },
  metafile: true,
  logLevel: 'info',
})
