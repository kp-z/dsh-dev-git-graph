/**
 * 项目图标（本地内置的一套精选图标）。
 *
 * ## 为什么是「内置」而不是「下载一套」
 *
 * 调研过主流开源图标集，结论：
 *
 * | 图标集 | 许可 | 体量 | 适不适合内置 |
 * | --- | --- | --- | --- |
 * | **Lucide** | ISC | ~1600 个，单个 ≈ 0.4–1KB path | ✅ 最合适：24×24 线性、路径极简、可只挑需要的 |
 * | Tabler Icons | MIT | ~5900 个 | 大而全，但插件只需要十几种 |
 * | Phosphor | MIT | 多字重、9000+ | 设计感强，但体积与字重带来额外复杂度 |
 * | Heroicons | MIT | 300 个（含实心） | 可选，线性版与 Lucide 风格接近 |
 * | simple-icons | CC0 | 3000+ 品牌 logo | 是「品牌商标」，不适合代表内部项目 |
 *
 * 插件页面是**离线可选**的：不能要求用户联网拉图标、也不想引入一个 npm 依赖（会让
 * `lib/client.iife.js` 多出几百 KB）。所以这里**只内置 18 个**最常用的线性图标，
 * 路径数据取自 Lucide（ISC），按 Lucide 的要求在此标注来源。
 *
 * 图标一律 24×24 viewBox、`stroke="currentColor"`、`fill="none"`，所以它天然跟随宿主主题色，
 * 不需要为亮/暗各准备一套。
 */

/** 每个图标：id → { label, paths: ['d 字符串', ...] }（全部 24×24，线性） */
export const PROJECT_ICONS = {
  folder: { label: '目录', paths: ['M4 20a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h5l2 3h7a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2z'] },
  code: { label: '代码', paths: ['m16 18 6-6-6-6', 'm8 6-6 6 6 6'] },
  terminal: { label: '终端', paths: ['m4 17 6-6-6-6', 'M12 19h8'] },
  cpu: { label: '芯片', paths: ['M9 2v2', 'M15 2v2', 'M9 20v2', 'M15 20v2', 'M2 9h2', 'M2 15h2', 'M20 9h2', 'M20 15h2', 'M5 5h14v14H5z', 'M9 9h6v6H9z'] },
  database: { label: '数据', paths: ['M12 8c4.4 0 8-1.3 8-3s-3.6-3-8-3-8 1.3-8 3 3.6 3 8 3z', 'M20 12c0 1.7-3.6 3-8 3s-8-1.3-8-3', 'M4 5v14c0 1.7 3.6 3 8 3s8-1.3 8-3V5'] },
  cloud: { label: '云端', paths: ['M17.5 19a4.5 4.5 0 0 0 0-9 6 6 0 0 0-11.6-1.5A4 4 0 0 0 7 19z'] },
  bug: { label: '缺陷', paths: ['M8 6h8', 'M9 6V4h6v2', 'M12 21a5 5 0 0 0 5-5v-3a5 5 0 0 0-10 0v3a5 5 0 0 0 5 5z', 'M3 13h2', 'M19 13h2', 'M4 7l2 2', 'M18 7l-2 2', 'M4 19l2-2', 'M18 19l-2-2'] },
  rocket: { label: '发布', paths: ['M12 3c3 2 5 5.5 5 9l-3 3H10l-3-3c0-3.5 2-7 5-9z', 'M10 15l-3 5 4-1', 'M14 15l3 5-4-1', 'M12 9.5v.01'] },
  flask: { label: '实验', paths: ['M9 3h6', 'M10 3v5l-5 8a2 2 0 0 0 1.7 3h10.6a2 2 0 0 0 1.7-3l-5-8V3', 'M7 14h10'] },
  chart: { label: '图表', paths: ['M3 3v18h18', 'M7 15v-4', 'M12 17V7', 'M17 13V9'] },
  book: { label: '文档', paths: ['M4 4h7a3 3 0 0 1 3 3v13a2 2 0 0 0-2-2H4z', 'M20 4h-3a3 3 0 0 0-3 3v13a2 2 0 0 1 2-2h4z'] },
  gamepad: { label: '游戏', paths: ['M6 12h4', 'M8 10v4', 'M15 12h.01', 'M18 10h.01', 'M7 6h10a4 4 0 0 1 4 4v4a4 4 0 0 1-7 2.6L13 16h-2l-1-1.4A4 4 0 0 1 3 14v-4a4 4 0 0 1 4-4z'] },
  wrench: { label: '构建', paths: ['M14.7 6.3a4 4 0 1 0 5 5l-9 9a3 3 0 1 1-4.2-4.2l9-9z'] },
  layers: { label: '服务', paths: ['m12 3 9 5-9 5-9-5z', 'm3 13 9 5 9-5', 'm3 17 9 5 9-5'] },
  box: { label: '制品', paths: ['M21 8v8a2 2 0 0 1-1 1.7l-7 4a2 2 0 0 1-2 0l-7-4A2 2 0 0 1 3 16V8a2 2 0 0 1 1-1.7l7-4a2 2 0 0 1 2 0l7 4A2 2 0 0 1 21 8z', 'm3.3 7 8.7 5 8.7-5', 'M12 22V12'] },
  globe: { label: '前端', paths: ['M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z', 'M3 12h18', 'M12 3a15 15 0 0 1 0 18 15 15 0 0 1 0-18z'] },
  shield: { label: '安全', paths: ['M12 3l8 3v6c0 4-3.4 7.4-8 9-4.6-1.6-8-5-8-9V6z'] },
  sparkles: { label: 'AI', paths: ['M12 3l1.8 4.2L18 9l-4.2 1.8L12 15l-1.8-4.2L6 9l4.2-1.8z', 'M18 15l.9 2.1L21 18l-2.1.9L18 21l-.9-2.1L15 18l2.1-.9z'] },
}

/** 稳定顺序（选择器按这个顺序铺格子；新增图标追加到末尾，不打乱已有配色/位置） */
export const ICON_IDS = Object.keys(PROJECT_ICONS)

/** 默认图标：项目没配时用「目录」，气泡上则不画图标而是回退到任务编号（更具体） */
export const DEFAULT_ICON = ''

/** 校验：不是已知 id 一律当「没配」，避免脏数据把气泡画成空白 */
export function normalizeIconId(value) {
  const id = String(value || '').trim()
  return Object.prototype.hasOwnProperty.call(PROJECT_ICONS, id) ? id : ''
}

/** 图标存在性（供宿主做入参校验） */
export function isIconId(value) {
  return Object.prototype.hasOwnProperty.call(PROJECT_ICONS, normalizeIconId(value))
}

/**
 * 生成一个图标元素（React `h`）：24×24、线性、颜色跟随 currentColor。
 * @param {object} deps { h }
 * @param {string} id 图标 id（未知 → 返回 null，由调用方回退）
 * @param {number} size 像素尺寸
 */
export function renderIcon(deps, id, size) {
  const h = deps && deps.h
  const icon = PROJECT_ICONS[normalizeIconId(id)]
  if (!h || !icon) return null
  const s = Math.max(8, Number(size) || 16)
  return h('svg', {
    width: s, height: s, viewBox: '0 0 24 24', fill: 'none',
    stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round', strokeLinejoin: 'round',
    'aria-hidden': 'true', focusable: 'false', style: { display: 'block' },
  }, icon.paths.map((d, i) => h('path', { key: i, d })))
}
