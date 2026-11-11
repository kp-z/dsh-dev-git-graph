/**
 * 生成 `src/client/lucideIcons.js`（内置图标数据）。
 *
 * 为什么要生成而不是运行时读 npm：插件客户端是单文件 IIFE，不能有运行时依赖，
 * 但也不该手抄上千个图标。所以**开发期**用 lucide-static 生成一份紧凑数据，产物入库。
 *
 * 用法：
 *   npm pack lucide-static@latest && tar -xzf lucide-static-*.tgz   # 得到 package/icons/*.svg
 *   node scripts/gen-lucide-icons.mjs <lucide-static>/icons
 *
 * 许可：Lucide 是 ISC，生成文件头会保留来源说明。
 */
import { readFileSync, readdirSync, writeFileSync } from 'node:fs'

const dir = process.argv[2]
if (!dir) {
  console.error('usage: node scripts/gen-lucide-icons.mjs <path-to-lucide-static/icons>')
  process.exit(1)
}

/* 保留「和项目/开发/数据/AI/设计/运维/常用」相关的一批 id */
const RULES = [
  /^(code|terminal|git|braces|binary|regex|variable|type|heading|text|file|folder|database|server|cloud|cpu|hard-drive|memory-stick|microchip|network|wifi|ethernet|router|cable|globe|earth|shield|lock|key|fingerprint|bug|rocket|flask|atom|dna|microscope|telescope|satellite|orbit|radar|signal|radio|antenna|chart|bar-chart|line-chart|pie-chart|activity|gauge|list|kanban|workflow|waypoints|route|milestone|flag|layers|box|package|blocks|component|puzzle|cog|settings|wrench|hammer|screwdriver|sparkles|brain|bot|zap|flame|star|heart|book|notebook|library|pen|pencil|brush|palette|image|video|camera|music|headphones|mic|gamepad|joystick|trophy|target|crosshair|map|compass|navigation|plane|car|bus|train|ship|truck|bike|home|building|factory|warehouse|store|shopping|wallet|credit-card|receipt|calendar|clock|timer|alarm|bell|mail|message|phone|send|share|link|download|upload|refresh|rotate|repeat|shuffle|play|pause|stop|skip|rewind|fast-forward|volume|search|filter|sort|arrow|chevron|plus|minus|check|x|alert|info|help|loader|circle|square|triangle|hexagon|octagon|more|menu|grid|layout|table|columns|rows|maximize|minimize|expand|shrink|eye|scan|qr|hash|at-sign|percent|dollar|bitcoin|scale|ruler|thermometer|battery|plug|power|sun|moon|wand|printer|monitor|tv|smartphone|tablet|laptop|keyboard|mouse|usb|disc|save|archive|trash|recycle|leaf|tree|sprout|flower|mountain|waves|wind|snowflake|droplet|umbrella|fire|tornado|user|users|contact|id-card|bookmark|tag|badge|award|medal|crown|gem|diamond|sticker)/i,
]
const EXTRA = ['clipboard-list', 'clipboard-check', 'file-text', 'file-code', 'file-json', 'file-cog', 'folder-tree', 'chart-spline', 'chart-scatter', 'chart-gantt', 'workflow', 'blocks', 'component', 'replace', 'log-in', 'log-out', 'sunrise', 'sunset']

const files = readdirSync(dir).filter((f) => f.endsWith('.svg'))
const keep = new Set(files.map((f) => f.replace('.svg', '')).filter((id) => RULES.some((r) => r.test(id))))
EXTRA.forEach((id) => { if (files.includes(`${id}.svg`)) keep.add(id) })
const ids = [...keep].sort()

const out = []
for (const id of ids) {
  const svg = readFileSync(`${dir}/${id}.svg`, 'utf8')
  const inner = svg.replace(/^[\s\S]*?<svg[^>]*>/, '').replace(/<\/svg>[\s\S]*$/, '').replace(/\s+/g, ' ').trim()
  /* 压成极简标记：<p d> / <c cx cy r> / <r x y w h rx> / <l ...> / <pl points> */
  const compact = inner
    .replace(/<path d="/g, '<p d="').replace(/<\/path>/g, '')
    .replace(/<circle /g, '<c ').replace(/<rect /g, '<r ')
    .replace(/<line /g, '<l ').replace(/<polyline /g, '<pl ').replace(/<polygon /g, '<pg ')
    .replace(/ width="/g, ' w="').replace(/ height="/g, ' h="')
    .replace(/\/>/g, '>').replace(/>\s+</g, '><')
  out.push(`  ${JSON.stringify(id)}: ${JSON.stringify(compact)},`)
}

const file = `/**
 * 内置图标数据（自动生成，别手改）—— 由 scripts/gen-lucide-icons.mjs 从 lucide-static 生成。
 *
 * 图标集：Lucide（https://lucide.dev，ISC License），24×24 线性、描边跟随 currentColor。
 * 数量：${ids.length} 个，覆盖开发/数据/AI/设计/运维/通用符号。
 *
 * 存的是**极简标记**（<p d> / <c> / <r> / <l> / <pl>），运行时由 projectIcons.js 解析成元素，
 * 这样一份 1300+ 图标的数据只有 ~240KB，而且没有运行时依赖。
 */
export const LUCIDE_ICON_COUNT = ${ids.length}

export const LUCIDE_ICONS = {
${out.join('\n')}
}
`
writeFileSync(new URL('../src/client/lucideIcons.js', import.meta.url), file)
console.log(`written src/client/lucideIcons.js — ${ids.length} icons`)
