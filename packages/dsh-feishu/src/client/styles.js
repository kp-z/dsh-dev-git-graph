/**
 * 飞书任务总览 · 样式（唯一来源）
 *
 * 三条硬约束：
 * 1. **只用宿主的 14 个主题令牌**，不出现任何字面量颜色、不自造 --p-* / --ov-* 调色板；
 *    明暗主题由宿主令牌自己切，本文件不写 `[data-theme]` 之类的暗色分支。
 * 2. 全部类名以 `fo-` 开头（Fo = Feishu Overview），由入口注入**一次**（injectStyles 幂等）。
 * 3. 项目分色（--fo-deco-N）只用宿主令牌 + `color-mix` 派生 —— 它们是**图形装饰**槽位，
 *    不是新色板：每个槽位都能追到 brand-primary / state-* 令牌。
 *
 * 间距/字号/圆角口径对齐宿主列表页（Plugin Manager）：13px 正文、11px 辅助、6~10px 圆角、
 * 4/6/8/10/14 px 间距阶梯。
 *
 * ⚠️ 这个模块在 node 里也能 import（只导出字符串与纯函数，不碰 document）。
 */

export const STYLE_ID = 'dsh-feishu-overview-style'
/** 早期冻结名（lead 的入口按这个 import 也行）。 */
export const OVERVIEW_STYLE_ID = STYLE_ID

/** 令牌回退链：宿主某些版本里 border/layer 命名不同，回退的仍是宿主令牌，不是字面量。 */
const T = {
  bgBase: 'var(--dsw-alias-bg-base, var(--dsw-alias-bg-layer-1))',
  bgLayer1: 'var(--dsw-alias-bg-layer-1)',
  bgLayer2: 'var(--dsw-alias-bg-layer-2)',
  bgOverlay: 'var(--dsw-alias-bg-overlay, var(--dsw-alias-bg-layer-2))',
  border1: 'var(--dsw-alias-border-l1, var(--dsw-alias-border-l2))',
  border2: 'var(--dsw-alias-border-l2, var(--dsw-alias-border-l1))',
  brand: 'var(--dsw-alias-brand-primary)',
  label1: 'var(--dsw-alias-label-primary)',
  label2: 'var(--dsw-alias-label-secondary, var(--dsw-alias-label-primary))',
  error: 'var(--dsw-alias-state-error-primary)',
  idle: 'var(--dsw-alias-state-idle-primary)',
  success: 'var(--dsw-alias-state-success-primary)',
  warn: 'var(--dsw-alias-state-warn-primary)',
  sidebar: 'var(--dsw-specific-sidebar-fill, var(--dsw-alias-bg-layer-1))',
}

export const CSS = `
/* ============ 根容器：两行（头 + 主体），主体三栏（树 / 图 + 卡片 / 详情） ============ */
.fo-root {
  --fo-deco-0: ${T.brand};
  --fo-deco-1: color-mix(in srgb, ${T.brand} 64%, ${T.success});
  --fo-deco-2: color-mix(in srgb, ${T.brand} 64%, ${T.warn});
  --fo-deco-3: color-mix(in srgb, ${T.brand} 60%, ${T.error});
  --fo-deco-4: color-mix(in srgb, ${T.brand} 40%, ${T.success});
  --fo-deco-5: color-mix(in srgb, ${T.brand} 40%, ${T.warn});
  --fo-deco-6: color-mix(in srgb, ${T.brand} 40%, ${T.error});
  --fo-deco-7: ${T.idle};
  --fo-selected-bg: color-mix(in srgb, ${T.brand} 14%, transparent);
  --fo-selected-line: color-mix(in srgb, ${T.brand} 34%, transparent);
  --fo-soft: color-mix(in srgb, ${T.label2} 12%, transparent);
  display: grid;
  grid-template-rows: auto minmax(0, 1fr);
  height: 100%;
  min-height: 0;
  background: ${T.bgBase};
  color: ${T.label1};
  font-size: 13px;
  line-height: 1.5;
}
.fo-root *, .fo-root *::before, .fo-root *::after { box-sizing: border-box; }
.fo-root :focus-visible { outline: 2px solid ${T.brand}; outline-offset: 1px; }

/* ============ 头部 ============ */
.fo-head {
  display: flex; align-items: center; gap: 10px; flex-wrap: wrap;
  padding: 10px 14px;
  min-height: 46px;
  border-bottom: 1px solid ${T.border1};
  background: ${T.bgLayer1};
}
.fo-head-main { display: flex; flex-direction: column; min-width: 0; gap: 1px; }
.fo-title { font-size: 14px; font-weight: 600; letter-spacing: .01em; }
.fo-sub { font-size: 11px; color: ${T.label2}; }
.fo-stats { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; margin-left: auto; }
.fo-chip {
  display: inline-flex; align-items: center; gap: 4px;
  height: 22px; padding: 0 8px; border-radius: 999px;
  font-size: 11px; font-variant-numeric: tabular-nums;
  background: ${T.bgLayer2}; color: ${T.label2};
  border: 1px solid transparent;
  white-space: nowrap;
}
.fo-chip[data-tone="brand"] { color: ${T.brand}; background: color-mix(in srgb, ${T.brand} 14%, transparent); }
.fo-chip[data-tone="danger"] { color: ${T.error}; background: color-mix(in srgb, ${T.error} 13%, transparent); }
.fo-chip[data-tone="warn"] { color: ${T.warn}; background: color-mix(in srgb, ${T.warn} 14%, transparent); }
.fo-chip[data-tone="ok"] { color: ${T.success}; background: color-mix(in srgb, ${T.success} 13%, transparent); }
.fo-chip[data-tone="idle"] { color: ${T.idle}; background: color-mix(in srgb, ${T.idle} 16%, transparent); }

/* ============ 按钮 ============ */
.fo-btn {
  display: inline-flex; align-items: center; justify-content: center; gap: 5px;
  height: 26px; padding: 0 10px; border-radius: 6px;
  font: inherit; font-size: 12px;
  color: ${T.label1};
  background: ${T.bgLayer2};
  border: 1px solid ${T.border1};
  cursor: pointer;
  white-space: nowrap;
}
.fo-btn:hover:not(:disabled) { border-color: ${T.border2}; }
.fo-btn:disabled { opacity: .5; cursor: default; }
.fo-btn[data-variant="primary"] { background: ${T.brand}; border-color: transparent; color: ${T.bgBase}; }
.fo-btn[data-variant="ghost"] { background: transparent; border-color: transparent; color: ${T.label2}; }
.fo-btn[data-variant="ghost"]:hover:not(:disabled) { background: ${T.bgLayer2}; color: ${T.label1}; }
.fo-btn[data-size="sm"] { height: 22px; padding: 0 7px; font-size: 11px; }

/* ============ 主体三栏 ============ */
.fo-body {
  display: grid;
  grid-template-columns: 248px minmax(0, 1fr);
  min-height: 0;
  min-width: 0;
}
.fo-root[data-detail="1"] .fo-body { grid-template-columns: 248px minmax(0, 1fr) 336px; }
@media (max-width: 1280px) {
  .fo-body { grid-template-columns: 216px minmax(0, 1fr); }
  .fo-root[data-detail="1"] .fo-body { grid-template-columns: 216px minmax(0, 1fr) 300px; }
}

/* ============ 左栏：三层树 ============ */
.fo-tree {
  display: flex; flex-direction: column; min-width: 0; min-height: 0;
  border-right: 1px solid ${T.border1};
  background: ${T.sidebar};
}
.fo-tree-head {
  display: flex; align-items: center; gap: 8px;
  padding: 8px 10px; border-bottom: 1px solid ${T.border1};
}
.fo-tree-title { font-size: 11px; font-weight: 600; color: ${T.label2}; letter-spacing: .04em; text-transform: uppercase; }
.fo-tree-head .fo-btn { margin-left: auto; }
.fo-tree-body { flex: 1; min-height: 0; overflow: auto; padding: 6px 6px 12px; }
.fo-tree-list { display: flex; flex-direction: column; gap: 1px; }
.fo-row {
  display: flex; align-items: center; gap: 6px;
  width: 100%; min-width: 0; height: 28px; padding: 0 6px;
  border: 1px solid transparent; border-radius: 6px;
  background: transparent; color: inherit; font: inherit; text-align: left;
  cursor: pointer;
}
.fo-row:hover { background: ${T.bgLayer2}; }
.fo-row[aria-selected="true"] {
  background: var(--fo-selected-bg);
  border-color: var(--fo-selected-line);
  color: ${T.label1}; font-weight: 600;
}
.fo-row.is-drop { border-color: ${T.brand}; background: color-mix(in srgb, ${T.brand} 20%, transparent); }
.fo-row.is-drag { opacity: .45; }
.fo-row[data-kind="group"] .fo-row-label { font-weight: 600; }
.fo-caret {
  flex: 0 0 14px; width: 14px; height: 14px;
  display: inline-flex; align-items: center; justify-content: center;
  color: ${T.label2}; font-size: 9px; line-height: 1;
  transition: transform .12s ease;
}
.fo-caret[data-collapsed="1"] { transform: rotate(-90deg); }
.fo-caret[data-leaf="1"] { visibility: hidden; }
.fo-dot {
  flex: 0 0 8px; width: 8px; height: 8px; border-radius: 50%;
  background: var(--fo-c, ${T.idle});
}
.fo-row-label {
  min-width: 0; flex: 1;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.fo-row-count { flex: 0 0 auto; font-size: 11px; color: ${T.label2}; font-variant-numeric: tabular-nums; }
.fo-row-badge {
  flex: 0 0 auto; font-size: 10px; padding: 0 5px; border-radius: 999px;
  color: ${T.error}; background: color-mix(in srgb, ${T.error} 14%, transparent);
}
.fo-row-menu { flex: 0 0 auto; }
.fo-tree-note { padding: 1px 6px 3px 34px; font-size: 11px; color: ${T.label2}; }
.fo-input {
  height: 26px; min-width: 0; width: 100%;
  padding: 0 8px; border-radius: 6px;
  font: inherit; font-size: 12px;
  color: ${T.label1}; background: ${T.bgBase};
  border: 1px solid ${T.brand};
}
.fo-create-row { display: flex; align-items: center; gap: 6px; padding: 4px 6px 4px 26px; }
.fo-create-row .fo-input { width: auto; flex: 1; }

/* ============ 右键菜单 ============ */
.fo-menu {
  position: fixed; z-index: 60;
  min-width: 184px; padding: 4px;
  border-radius: 8px;
  background: ${T.bgOverlay};
  border: 1px solid ${T.border2};
  box-shadow: 0 6px 20px color-mix(in srgb, ${T.label1} 18%, transparent);
}
.fo-menu-item {
  display: flex; align-items: center; gap: 8px;
  width: 100%; height: 26px; padding: 0 8px;
  border: 0; border-radius: 5px; background: transparent;
  color: ${T.label1}; font: inherit; font-size: 12px; text-align: left;
  cursor: pointer;
}
.fo-menu-item:hover:not(:disabled), .fo-menu-item[data-open="1"] { background: var(--fo-selected-bg); }
.fo-menu-item:disabled { opacity: .45; cursor: default; }
.fo-menu-item[data-danger="1"] { color: ${T.error}; }
.fo-menu-check { width: 12px; flex: 0 0 12px; color: ${T.brand}; }
.fo-menu-more { margin-left: auto; font-size: 10px; color: ${T.label2}; }
.fo-menu-sep { height: 1px; margin: 4px 6px; background: ${T.border1}; }
.fo-menu-sub { position: fixed; z-index: 61; }

/* ============ 中栏 ============ */
.fo-main { display: flex; flex-direction: column; min-width: 0; min-height: 0; background: ${T.bgBase}; }
.fo-main-scroll { flex: 1; min-height: 0; overflow: auto; padding: 12px 14px 20px; }
.fo-banner {
  display: flex; align-items: center; gap: 8px;
  margin: 0 0 10px; padding: 8px 10px;
  border-radius: 8px; font-size: 12px;
  color: ${T.error};
  background: color-mix(in srgb, ${T.error} 12%, transparent);
  border: 1px solid color-mix(in srgb, ${T.error} 30%, transparent);
}
.fo-banner .fo-btn { margin-left: auto; }

.fo-graph {
  margin: 0 0 14px; border: 1px solid ${T.border1}; border-radius: 10px;
  background: ${T.bgLayer1}; overflow: hidden;
}
.fo-graph-head {
  display: flex; align-items: center; gap: 8px; flex-wrap: wrap;
  padding: 8px 12px; border-bottom: 1px solid ${T.border1};
}
.fo-graph-name { font-size: 13px; font-weight: 600; }
.fo-graph-meta { display: flex; align-items: center; gap: 6px; margin-left: auto; flex-wrap: wrap; }
.fo-graph-body { overflow: auto; padding: 4px; }
.fo-svg { display: block; }
.fo-band { fill: color-mix(in srgb, var(--fo-c, ${T.label2}) 6%, transparent); stroke: color-mix(in srgb, var(--fo-c, ${T.label2}) 30%, transparent); stroke-width: 1; }
.fo-band[data-external="1"] { fill: color-mix(in srgb, ${T.label2} 5%, transparent); stroke: ${T.border2}; stroke-dasharray: 4 4; }
.fo-band-label { fill: var(--fo-c, ${T.label2}); font-size: 11px; font-weight: 600; }
.fo-band-label[data-external="1"] { fill: ${T.label2}; font-weight: 400; }
.fo-edge { fill: none; stroke: ${T.border2}; stroke-width: 1.4; }
.fo-edge[data-kind="derived_from"] { stroke-dasharray: 5 4; stroke: ${T.idle}; }
.fo-edge.is-active { stroke: ${T.brand}; stroke-width: 2; }
.fo-arrow { fill: ${T.border2}; }
.fo-arrow[data-kind="derived_from"] { fill: ${T.idle}; }
.fo-node { cursor: pointer; }
.fo-node-bg { fill: ${T.bgLayer2}; stroke: ${T.border1}; stroke-width: 1; }
.fo-node.is-ghost .fo-node-bg { fill: transparent; stroke: ${T.border2}; stroke-dasharray: 4 3; }
.fo-node:hover .fo-node-bg { stroke: ${T.border2}; }
.fo-node.is-selected .fo-node-bg { stroke: ${T.brand}; stroke-width: 2; }
.fo-node-spine { fill: var(--fo-c, ${T.idle}); }
.fo-node-dot { fill: var(--fo-c, ${T.idle}); }
.fo-node-no { fill: ${T.label2}; font-size: 10px; font-weight: 600; }
.fo-node-title { fill: ${T.label1}; font-size: 12px; }
.fo-node.is-ghost .fo-node-title { fill: ${T.label2}; }
.fo-node-meta { fill: ${T.label2}; font-size: 10px; }
.fo-node:focus-visible { outline: none; }
.fo-node:focus-visible .fo-node-bg { stroke: ${T.brand}; stroke-width: 2; }

/* ============ 任务卡片 ============ */
.fo-cards-title {
  display: flex; align-items: center; gap: 8px;
  margin: 2px 2px 8px; font-size: 11px; font-weight: 600;
  color: ${T.label2}; letter-spacing: .04em; text-transform: uppercase;
}
.fo-cards { display: grid; grid-template-columns: repeat(auto-fill, minmax(232px, 1fr)); gap: 8px; }
.fo-card {
  display: flex; flex-direction: column; gap: 5px;
  padding: 9px 10px; min-width: 0;
  border: 1px solid ${T.border1}; border-radius: 8px;
  background: ${T.bgLayer1}; color: inherit; font: inherit; text-align: left;
  cursor: pointer;
}
.fo-card:hover { border-color: ${T.border2}; }
.fo-card[aria-current="true"] { border-color: ${T.brand}; background: var(--fo-selected-bg); }
.fo-card-top { display: flex; align-items: center; gap: 6px; }
.fo-card-no { font-size: 11px; color: ${T.label2}; font-variant-numeric: tabular-nums; }
.fo-card-title {
  font-size: 12px; color: ${T.label1};
  display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical;
  overflow: hidden;
}
.fo-card-foot { display: flex; align-items: center; gap: 5px; flex-wrap: wrap; }
.fo-tag {
  display: inline-flex; align-items: center; gap: 3px;
  max-width: 100%; height: 18px; padding: 0 6px;
  border-radius: 4px; font-size: 10px;
  color: ${T.label2}; background: ${T.soft};
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.fo-tag[data-tone="danger"] { color: ${T.error}; background: color-mix(in srgb, ${T.error} 13%, transparent); }
.fo-tag[data-tone="ok"] { color: ${T.success}; background: color-mix(in srgb, ${T.success} 13%, transparent); }
.fo-tag[data-tone="warn"] { color: ${T.warn}; background: color-mix(in srgb, ${T.warn} 14%, transparent); }
.fo-tag[data-tone="idle"] { color: ${T.idle}; background: color-mix(in srgb, ${T.idle} 16%, transparent); }

/* ============ 右栏：详情 ============ */
.fo-detail {
  display: flex; flex-direction: column; gap: 10px;
  min-width: 0; min-height: 0; overflow: auto;
  padding: 12px 14px 20px;
  border-left: 1px solid ${T.border1};
  background: ${T.bgLayer1};
}
.fo-detail-eyebrow { display: flex; align-items: center; gap: 6px; font-size: 11px; color: ${T.label2}; }
.fo-detail-title { margin: 0; font-size: 14px; font-weight: 600; line-height: 1.45; word-break: break-word; }
.fo-kv { display: grid; grid-template-columns: 72px minmax(0, 1fr); gap: 5px 10px; margin: 0; font-size: 12px; }
.fo-kv dt { color: ${T.label2}; }
.fo-kv dd { margin: 0; min-width: 0; overflow-wrap: anywhere; }
.fo-mono { font-family: ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace; font-size: 11px; }
.fo-sec { display: flex; flex-direction: column; gap: 5px; }
.fo-sec-label { font-size: 11px; font-weight: 600; color: ${T.label2}; }
.fo-refs { display: flex; flex-direction: column; gap: 4px; }
.fo-ref {
  display: flex; align-items: center; gap: 6px;
  width: 100%; padding: 5px 7px;
  border: 1px solid ${T.border1}; border-radius: 6px;
  background: ${T.bgLayer2}; color: inherit; font: inherit; font-size: 12px;
  text-align: left; cursor: pointer;
}
.fo-ref:hover:not(:disabled) { border-color: ${T.brand}; }
.fo-ref:disabled, .fo-ref[data-missing="1"] { cursor: default; color: ${T.label2}; border-style: dashed; background: transparent; }
.fo-ref-kind { flex: 0 0 auto; font-size: 10px; color: ${T.label2}; }
.fo-ref-label { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.fo-muted { margin: 0; font-size: 12px; color: ${T.label2}; }
.fo-detail-actions { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; margin-top: auto; padding-top: 6px; }

/* ============ 空态 / 加载态 ============ */
.fo-placeholder {
  display: flex; flex-direction: column; align-items: center; justify-content: center;
  gap: 8px; flex: 1; min-height: 180px; padding: 32px 20px; text-align: center;
}
.fo-placeholder-title { font-size: 13px; font-weight: 600; }
.fo-placeholder-body { max-width: 420px; font-size: 12px; color: ${T.label2}; }
.fo-skeleton { display: flex; flex-direction: column; gap: 10px; }
.fo-skeleton-row {
  height: 64px; border-radius: 10px;
  background: linear-gradient(90deg, ${T.bgLayer2} 0%, color-mix(in srgb, ${T.bgLayer2} 55%, transparent) 50%, ${T.bgLayer2} 100%);
  background-size: 200% 100%;
  animation: fo-shimmer 1.4s ease-in-out infinite;
}
@keyframes fo-shimmer { 0% { background-position: 200% 0; } 100% { background-position: -200% 0; } }
@media (prefers-reduced-motion: reduce) {
  .fo-root *, .fo-root *::before, .fo-root *::after { transition: none !important; animation: none !important; }
}
`

/** 项目分色槽位 → CSS 变量引用（组件只用这个，永远不写死颜色）。 */
export function decoVar(index) {
  const n = Math.floor(Number(index))
  if (!isFinite(n) || n < 0) return `var(--fo-deco-0)`
  return `var(--fo-deco-${n % 8})`
}

/** 品牌色令牌引用（「全部任务」这类中性高亮用）。 */
export function brandVar() { return T.brand }

/** 任务状态 → 宿主状态令牌引用。 */
export function stateVar(state) {
  if (state === 'done') return T.success
  if (state === 'blocked') return T.error
  if (state === 'suspended') return T.warn
  if (state === 'ghost') return T.idle
  return T.idle
}

/**
 * 幂等注入：同一个 document 只插一次 <style>。入口调用一次即可；
 * 没有 document（node 测试）时安静返回 false。
 */
export function injectStyles(doc) {
  const target = doc || (typeof document !== 'undefined' ? document : null)
  if (!target || !target.head || typeof target.createElement !== 'function') return false
  if (typeof target.getElementById === 'function' && target.getElementById(STYLE_ID)) return false
  const style = target.createElement('style')
  style.id = STYLE_ID
  style.setAttribute('data-plugin', 'dsh-feishu')
  style.textContent = CSS
  target.head.appendChild(style)
  return true
}

export const OVERVIEW_CSS = CSS
