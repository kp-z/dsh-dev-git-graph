// 打包 git-graph web 前端：合并 media/*.js + styles/*.css -> media/gitgraph.js / gitgraph.css / index.html
import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const media = join(root, 'media')
const stylesDir = join(root, 'vendor/git-graph/web/styles')

const ORDER = ['utils.js', 'contextMenu.js', 'dialog.js', 'dropdown.js', 'findWidget.js', 'textFormatter.js', 'graph.js', 'settingsWidget.js', 'main.js']
const js = ORDER.map((f) => {
  const p = join(media, f)
  if (!existsSync(p)) throw new Error('缺少构建产物 ' + f + '（先跑 tsc -p web.tsconfig.json）')
  return readFileSync(p, 'utf8')
}).join('\n;\n')

const css = readdirSync(stylesDir).filter((f) => f.endsWith('.css')).map((f) => readFileSync(join(stylesDir, f), 'utf8')).join('\n')

// 亮色/暗色各一套纯调色板分支色（亮度自适应，非风格化）：
// 每色调取该色相在各自背景（亮底 #f8fafc / 深底 #0f172a）上对比度达 WCAG AA 且可区分度最高的饱和亮阶。
const GRAPH_COLOURS_LIGHT = ['#0e63b8', '#b8137c', '#3f8605', '#8a4a00', '#7a2bd6', '#b3261e', '#0a7d74', '#9c27b0', '#5c7a00', '#bf5000', '#6628a8', '#8a5a00'];
const GRAPH_COLOURS_DARK = ['#58a6ff', '#e477c2', '#7ad436', '#e0a63c', '#b994f6', '#ff7b72', '#39d3d3', '#e39ae0', '#b9d14a', '#ff9537', '#a67ff6', '#e6c547'];

const colorVars = (arr) => arr.map((c, i) => '--git-graph-color' + i + ':' + c).join(';');
const colorParams = GRAPH_COLOURS_LIGHT.map((_, i) => '[data-color="' + i + '"]{--git-graph-color:var(--git-graph-color' + i + ');}').join(' ');

// 每个 --vscode-* 映射到（DSH alias, 浅色兜底, 深色兜底）三元组；
// alias 词表以 dsh-client-ui-theme 的运行时定义为准，兜底取 VS Code 官方 light+/dark+ 主题值。
const HOST_FONT = '-apple-system, system-ui, "Segoe UI", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", "Helvetica Neue", Helvetica, Arial, sans-serif';
const MAP = [
  ['vscode-font-family',                 'dsw-alias-font-family',            HOST_FONT, HOST_FONT],
  ['vscode-editor-background',           'dsw-alias-bg-base',                '#ffffff', '#0d1117'],
  ['vscode-editor-foreground',           'dsw-alias-label-primary',          '#1f2328', '#e6edf3'],
  ['vscode-menu-background',             'dsw-alias-bg-layer-1',             '#f8fafc', '#1c2128'],
  ['vscode-menu-foreground',             'dsw-alias-label-primary',          '#1f2328', '#e6edf3'],
  ['vscode-menu-border',                 'dsw-alias-border-l2',              '#d1d9e0', '#2d333b'],
  ['vscode-menu-selectionBackground',    'dsw-alias-interactive-bg-active',  '#dbeafe', '#1f3a5f'],
  ['vscode-menu-selectionForeground',    'dsw-alias-label-primary',          '#0f172a', '#e6edf3'],
  ['vscode-menu-separatorBackground',    'dsw-alias-border-l1',              '#e5e7eb', '#21262d'],
  ['vscode-selection-background',        'dsw-alias-interactive-bg-active',  '#dbeafe', '#1f3a5f'],
  ['vscode-scrollbar-shadow',            'dsw-alias-bg-layer-1',             '#cbd5e1', '#0d1117'],
  ['vscode-widget-shadow',               'dsw-alias-shadow',                 'rgba(0,0,0,0.16)', 'rgba(1,4,9,0.85)'],
  ['vscode-input-background',            'dsw-alias-fill-l2',                '#f1f5f9', '#21262d'],
  ['vscode-input-foreground',            'dsw-alias-label-primary',          '#1f2328', '#e6edf3'],
  ['vscode-input-placeholderForeground', 'dsw-alias-label-tertiary',         '#64748b', '#768390'],
  ['vscode-input-border',                'dsw-alias-border-l2',              '#d1d9e0', '#2d333b'],
  ['vscode-focusBorder',                 'dsw-alias-brand-primary',          '#0969da', '#2f81f7'],
  ['vscode-textLink-foreground',         'dsw-alias-brand-primary',          '#0969da', '#58a6ff'],
  ['vscode-textLink-activeForeground',   'dsw-alias-brand-primary',          '#0550ae', '#79c0ff'],
  ['vscode-editor-findMatchHighlightBackground', 'dsw-alias-bg-highlight',   'rgba(234,179,8,0.35)', 'rgba(234,179,8,0.25)'],
  ['vscode-editor-findMatchHighlightBorder',     'dsw-alias-border-highlight', '#d97706', '#d97706'],
  ['vscode-editorWidget-background',     'dsw-alias-bg-layer-1',             '#f8fafc', '#1c2128'],
  ['vscode-editorWidget-border',         'dsw-alias-border-l2',              '#d1d9e0', '#2d333b'],
  ['vscode-button-background',           'dsw-alias-button-primary-fill',    '#1f883d', '#238636'],
  ['vscode-button-foreground',           'dsw-alias-button-contrast-fill',   '#ffffff', '#ffffff'],
  ['vscode-button-hoverBackground',      'dsw-alias-button-primary-hover',   '#1a7f37', '#2ea043'],
  ['vscode-button-secondaryBackground',  'dsw-alias-button-elevated-fill',   '#f1f5f9', '#21262d'],
  ['vscode-button-secondaryForeground',  'dsw-alias-label-primary',          '#1f2328', '#e6edf3'],
  ['vscode-button-secondaryHoverBackground', 'dsw-alias-button-floating-hover', '#e2e8f0', '#2d333b'],
  ['vscode-descriptionForeground',       'dsw-alias-label-secondary',        '#57606a', '#768390'],
  ['vscode-errorForeground',             'dsw-alias-state-error-primary',    '#cf222e', '#f85149'],
  ['vscode-editorSuggestWidget-foreground', 'dsw-alias-label-primary',       '#1f2328', '#e6edf3'],
  ['vscode-inputOption-activeBackground',   'dsw-alias-interactive-bg-active', '#dbeafe', '#1f3a5f'],
  ['vscode-inputOption-activeBorder',       'dsw-alias-brand-primary',       '#0969da', '#2f81f7'],
  ['vscode-inputValidation-errorBackground', 'dsw-alias-state-error-secondary', '#ffebe9', '#490202'],
  ['vscode-inputValidation-errorBorder',     'dsw-alias-state-error-primary',  '#cf222e', '#f85149'],
  ['vscode-gitDecoration-modifiedResourceForeground', 'dsw-alias-state-warn-primary',    '#9a6700', '#d29922'],
  ['vscode-gitDecoration-addedResourceForeground',    'dsw-alias-state-success-primary', '#1a7f37', '#3fb950'],
  ['vscode-gitDecoration-deletedResourceForeground',  'dsw-alias-state-error-primary',   '#cf222e', '#f85149'],
  ['vscode-gitDecoration-untrackedResourceForeground','dsw-alias-state-success-primary', '#1a7f37', '#3fb950'],
];

const ruleFor = (prefix) => MAP.map(([v, alias, l, d]) => `  --${v}: var(--${alias}, ${prefix === 'light' ? l : d});`).join('\n');

// 双模式主题：:root 为浅色基线；:root[data-ds-dark-theme]（宿主同步到 <html>）覆盖为深色。
// alias 优先（值由宿主 token 驱动），别名缺失时用 VS Code 对应模式的值兜底。
const themeCss = `:root{
  color-scheme: light;
${ruleFor('light')}
}
:root[data-ds-dark-theme]{
  color-scheme: dark;
${ruleFor('dark')}
}
body{${colorVars(GRAPH_COLOURS_LIGHT)}}
:root[data-ds-dark-theme] body{${colorVars(GRAPH_COLOURS_DARK)}}
${colorParams}
body{font-family:var(--vscode-font-family);color:var(--vscode-editor-foreground)}`

const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Git Graph</title>
<link rel="stylesheet" href="gitgraph.css">
<style>${themeCss}</style>
</head>
<body>
<div id="view" tabindex="-1">
  <div id="controls">
    <span id="repoControl"><span class="unselectable">Repo: </span><div id="repoDropdown" class="dropdown"></div></span>
    <span id="branchControl"><span class="unselectable">Branches: </span><div id="branchDropdown" class="dropdown"></div></span>
    <label id="showRemoteBranchesControl"><input type="checkbox" id="showRemoteBranchesCheckbox" tabindex="-1"><span class="customCheckbox"></span>Show Remote Branches</label>
    <div id="findBtn" title="Find"></div>
    <div id="terminalBtn" title="Open a Terminal for this Repository"></div>
    <div id="settingsBtn" title="Repository Settings"></div>
    <div id="fetchBtn"></div>
    <div id="refreshBtn"></div>
  </div>
  <div id="content">
    <div id="commitGraph"></div>
    <div id="commitTable"></div>
  </div>
  <div id="footer"></div>
</div>
<div id="scrollShadow"></div>
<script src="gitgraph.js"></script>
</body>
</html>
`

writeFileSync(join(media, 'gitgraph.js'), js)
writeFileSync(join(media, 'gitgraph.css'), css)
writeFileSync(join(media, 'index.html'), html)
for (const f of ORDER) writeFileSync(join(media, f), '')
console.log('packed media/gitgraph.js', js.length, 'bytes; gitgraph.css', css.length, 'bytes')
