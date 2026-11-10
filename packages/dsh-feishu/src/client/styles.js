/**
 * 飞书任务总览 · 样式（唯一来源）
 *
 * 风格取自参考项目 Claude Manager（kp-z/Claudeadventure，Figma Make 导出的 React+Tailwind 应用）：
 * **深色玻璃卡片** —— `bg-white/5` + `border-white/10` + `backdrop-blur-md` + 大圆角 + 大内边距 +
 * hover 上浮 + 品牌色→透明渐变淡入 + 紧凑字号。换算规则见
 * `docs/STYLE-borrowed-claude-manager.md`（那份文档是口径，本文件是落地）。
 *
 * 三条硬约束（我们的测试在钉，不许放宽）：
 * 1. **零字面量颜色**：参考项目的玻璃感靠 `rgba(255,255,255,.05)` 这类字面量，这里一律换成
 *    `color-mix(in oklab, <宿主令牌> X%, transparent)` —— 同样的透明度分层，明暗两套仍跟着宿主走。
 * 2. 令牌仍限定在那 14 个 `--dsw-*`（测试会断言「去重后恰好 14 个」，少一个多一个都红）。
 * 3. 类名唯一前缀 `fo-`，由入口注入一次（injectStyles 幂等）。
 *
 * 层级用**透明度**而不是灰阶：面板底 `bg-base` → 卡片 `bg-layer-1 92%` → 次级卡 `bg-layer-2 88%`。
 * 项目分色（--fo-deco-N）与状态光晕（--fo-glow-*）都是品牌/状态令牌的 color-mix 变体，
 * 属于「图形装饰」，不是新色板。
 *
 * ⚠️ 这个模块在 node 里也能 import（只导出字符串与纯函数，不碰 document）。
 */

export const STYLE_ID = 'dsh-feishu-overview-style'
/** 早期冻结名（lead 的入口按这个 import 也行）。 */
export const OVERVIEW_STYLE_ID = STYLE_ID

/** `color-mix(in oklab, <token> pct%, transparent)`：把「白色 5%」翻译成宿主令牌的透明度。 */
const g = (token, pct) => `color-mix(in oklab, ${token} ${pct}%, transparent)`

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

/** 玻璃三件套：卡片面 / 次级面 / 描边，加一个悬停描边与投影。 */
const GLASS = {
  card: g(T.bgLayer1, 92),
  sub: g(T.bgLayer2, 88),
  line: g(T.border1, 65),
  lineHover: g(T.border2, 82),
  shadow: `0 8px 24px ${g(T.label1, 10)}`,
  wash: `linear-gradient(135deg, ${g(T.brand, 6)}, transparent 72%)`,
}

export const CSS = `
/* ============ 根容器：玻璃层的所有变量都在这里定义，组件只引用 ============ */
.fo-root {
  /* 项目分色槽（品牌/状态令牌派生，图形装饰用） */
  --fo-deco-0: ${T.brand};
  --fo-deco-1: color-mix(in oklab, ${T.brand} 64%, ${T.success});
  --fo-deco-2: color-mix(in oklab, ${T.brand} 64%, ${T.warn});
  --fo-deco-3: color-mix(in oklab, ${T.brand} 60%, ${T.error});
  --fo-deco-4: color-mix(in oklab, ${T.brand} 40%, ${T.success});
  --fo-deco-5: color-mix(in oklab, ${T.brand} 40%, ${T.warn});
  --fo-deco-6: color-mix(in oklab, ${T.brand} 40%, ${T.error});
  --fo-deco-7: ${T.idle};
  /* 状态光晕：参考项目 rarity 光晕的等价物，35% 一档 */
  --fo-glow-brand: ${g(T.brand, 35)};
  --fo-glow-success: ${g(T.success, 35)};
  --fo-glow-warn: ${g(T.warn, 35)};
  --fo-glow-error: ${g(T.error, 35)};
  --fo-glow-idle: ${g(T.idle, 35)};
  /* 玻璃三件套 */
  --fo-glass-card: ${GLASS.card};
  --fo-glass-sub: ${GLASS.sub};
  --fo-glass-line: ${GLASS.line};
  --fo-glass-line-hover: ${GLASS.lineHover};
  --fo-glass-shadow: ${GLASS.shadow};
  --fo-glass-wash: ${GLASS.wash};
  --fo-glass-blur: blur(12px);
  --fo-selected-bg: ${g(T.brand, 14)};
  --fo-selected-line: ${g(T.brand, 34)};
  --fo-ease: cubic-bezier(.2, .8, .2, 1);
  --fo-dur: 300ms;

  display: grid;
  grid-template-rows: auto minmax(0, 1fr);
  height: 100%;
  min-height: 0;
  background: ${T.bgBase};
  color: ${T.label1};
  font-size: 12px;
  line-height: 1.5;
}
.fo-root *, .fo-root *::before, .fo-root *::after { box-sizing: border-box; }
.fo-root :focus-visible { outline: 2px solid ${T.brand}; outline-offset: 1px; }

/* ============ 入场：120ms 上浮淡入，逐行 20ms 递延（--fo-i 由组件给，上限 8 行）
   用 backwards 而不是 both —— both 会让最后一帧的 transform 一直生效，把 hover 的上浮吃掉。 ============ */
@keyframes fo-rise {
  from { opacity: 0; transform: translateY(4px); }
  to { opacity: 1; transform: none; }
}
.fo-head, .fo-tree-head, .fo-row, .fo-graph, .fo-card, .fo-sec, .fo-ref {
  animation: fo-rise 120ms var(--fo-ease) backwards;
  animation-delay: calc(var(--fo-i, 0) * 20ms);
}

/* ============ 头部 ============ */
.fo-head {
  display: flex; align-items: center; gap: 12px; flex-wrap: wrap;
  padding: 10px 16px;
  min-height: 52px;
  border-bottom: 1px solid var(--fo-glass-line);
  background: var(--fo-glass-card);
  backdrop-filter: var(--fo-glass-blur);
  -webkit-backdrop-filter: var(--fo-glass-blur);
}
.fo-head-main { display: flex; flex-direction: column; min-width: 0; gap: 1px; }
.fo-title { font-size: 13px; font-weight: 600; letter-spacing: .01em; }
.fo-sub { font-size: 11px; color: ${T.label2}; }
.fo-stats { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; margin-left: auto; }
.fo-chip {
  display: inline-flex; align-items: center; gap: 4px;
  height: 22px; padding: 0 10px; border-radius: 999px;
  font-size: 11px; font-variant-numeric: tabular-nums;
  background: var(--fo-glass-sub); color: ${T.label2};
  border: 1px solid transparent;
  white-space: nowrap;
}
.fo-chip[data-tone="brand"] { color: ${T.brand}; background: var(--fo-selected-bg); border-color: var(--fo-selected-line); }
.fo-chip[data-tone="danger"] { color: ${T.error}; background: ${g(T.error, 13)}; border-color: ${g(T.error, 30)}; }
.fo-chip[data-tone="warn"] { color: ${T.warn}; background: ${g(T.warn, 14)}; border-color: ${g(T.warn, 30)}; }
.fo-chip[data-tone="ok"] { color: ${T.success}; background: ${g(T.success, 13)}; border-color: ${g(T.success, 30)}; }
.fo-chip[data-tone="idle"] { color: ${T.idle}; background: ${g(T.idle, 16)}; border-color: ${g(T.idle, 32)}; }

/* ============ 按钮 ============ */
.fo-btn {
  display: inline-flex; align-items: center; justify-content: center; gap: 5px;
  height: 26px; padding: 0 10px; border-radius: 8px;
  font: inherit; font-size: 12px;
  color: ${T.label1};
  background: var(--fo-glass-sub);
  border: 1px solid var(--fo-glass-line);
  cursor: pointer;
  white-space: nowrap;
  transition: transform var(--fo-dur) var(--fo-ease), border-color var(--fo-dur) var(--fo-ease), background-color var(--fo-dur) var(--fo-ease);
}
.fo-btn:hover:not(:disabled) { border-color: var(--fo-glass-line-hover); transform: translateY(-1px); }
.fo-btn:disabled { opacity: .5; cursor: default; }
.fo-btn[data-variant="primary"] { background: ${T.brand}; border-color: transparent; color: ${T.bgBase}; }
.fo-btn[data-variant="primary"]:hover:not(:disabled) { background: color-mix(in oklab, ${T.brand} 88%, ${T.label1}); }
.fo-btn[data-variant="ghost"] { background: transparent; border-color: transparent; color: ${T.label2}; }
.fo-btn[data-variant="ghost"]:hover:not(:disabled) { background: var(--fo-glass-sub); color: ${T.label1}; border-color: var(--fo-glass-line); }
.fo-btn[data-size="sm"] { height: 22px; padding: 0 8px; font-size: 11px; }

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
  border-right: 1px solid var(--fo-glass-line);
  background: color-mix(in oklab, ${T.sidebar} 92%, transparent);
  backdrop-filter: var(--fo-glass-blur);
  -webkit-backdrop-filter: var(--fo-glass-blur);
}
.fo-tree-head {
  display: flex; align-items: center; gap: 8px;
  padding: 10px 12px; border-bottom: 1px solid var(--fo-glass-line);
}
.fo-tree-title { font-size: 11px; font-weight: 600; color: ${T.label2}; letter-spacing: .04em; text-transform: uppercase; }
.fo-tree-head .fo-btn { margin-left: auto; }
.fo-tree-body { flex: 1; min-height: 0; overflow: auto; padding: 8px 8px 16px; }
.fo-tree-list { display: flex; flex-direction: column; gap: 2px; }
.fo-row {
  display: flex; align-items: center; gap: 8px;
  width: 100%; min-width: 0; height: 26px; padding: 0 8px;
  border: 1px solid transparent; border-radius: 8px;
  background: transparent; color: inherit; font: inherit; text-align: left;
  cursor: pointer;
  transition: transform var(--fo-dur) var(--fo-ease), border-color var(--fo-dur) var(--fo-ease), background-color var(--fo-dur) var(--fo-ease);
}
.fo-row:hover { background: var(--fo-glass-sub); border-color: var(--fo-glass-line); transform: translateY(-1px); }
.fo-row[aria-selected="true"] {
  background: var(--fo-selected-bg);
  border-color: var(--fo-selected-line);
  color: ${T.label1}; font-weight: 600;
}
.fo-row.is-drop { border-color: ${T.brand}; background: ${g(T.brand, 20)}; }
.fo-row.is-drag { opacity: .45; }
.fo-row[data-kind="group"] .fo-row-label { font-weight: 600; }
.fo-caret {
  flex: 0 0 14px; width: 14px; height: 14px;
  display: inline-flex; align-items: center; justify-content: center;
  color: ${T.label2}; font-size: 9px; line-height: 1;
  transition: transform .12s var(--fo-ease);
}
.fo-caret[data-collapsed="1"] { transform: rotate(-90deg); }
.fo-caret[data-leaf="1"] { visibility: hidden; }
.fo-dot {
  flex: 0 0 8px; width: 8px; height: 8px; border-radius: 50%;
  background: var(--fo-c, ${T.idle});
  box-shadow: 0 0 0 3px color-mix(in oklab, var(--fo-c, ${T.idle}) 22%, transparent);
}
.fo-row-label {
  min-width: 0; flex: 1;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.fo-row-count { flex: 0 0 auto; font-size: 11px; color: ${T.label2}; font-variant-numeric: tabular-nums; }
.fo-row-badge {
  flex: 0 0 auto; font-size: 10px; padding: 0 6px; border-radius: 999px;
  color: ${T.error}; background: ${g(T.error, 14)}; border: 1px solid ${g(T.error, 30)};
}
.fo-row-menu { flex: 0 0 auto; }
.fo-tree-note { padding: 1px 8px 3px 34px; font-size: 11px; color: ${T.label2}; }
.fo-input {
  height: 26px; min-width: 0; width: 100%;
  padding: 0 8px; border-radius: 8px;
  font: inherit; font-size: 12px;
  color: ${T.label1}; background: ${T.bgBase};
  border: 1px solid ${T.brand};
}
.fo-create-row { display: flex; align-items: center; gap: 8px; padding: 4px 8px 4px 28px; }
.fo-create-row .fo-input { width: auto; flex: 1; }

/* ============ 右键菜单（玻璃浮层） ============ */
.fo-menu {
  position: fixed; z-index: 60;
  min-width: 184px; padding: 6px;
  border-radius: 10px;
  background: color-mix(in oklab, ${T.bgOverlay} 94%, transparent);
  backdrop-filter: var(--fo-glass-blur);
  -webkit-backdrop-filter: var(--fo-glass-blur);
  border: 1px solid var(--fo-glass-line);
  box-shadow: var(--fo-glass-shadow);
}
.fo-menu-item {
  display: flex; align-items: center; gap: 8px;
  width: 100%; height: 26px; padding: 0 8px;
  border: 0; border-radius: 8px; background: transparent;
  color: ${T.label1}; font: inherit; font-size: 12px; text-align: left;
  cursor: pointer;
  transition: background-color var(--fo-dur) var(--fo-ease);
}
.fo-menu-item:hover:not(:disabled), .fo-menu-item[data-open="1"] { background: var(--fo-selected-bg); }
.fo-menu-item:disabled { opacity: .45; cursor: default; }
.fo-menu-item[data-danger="1"] { color: ${T.error}; }
.fo-menu-check { width: 12px; flex: 0 0 12px; color: ${T.brand}; }
.fo-menu-more { margin-left: auto; font-size: 10px; color: ${T.label2}; }
.fo-menu-sep { height: 1px; margin: 4px 6px; background: var(--fo-glass-line); }
.fo-menu-sub { position: fixed; z-index: 61; }

/* ============ 中栏 ============ */
.fo-main { display: flex; flex-direction: column; min-width: 0; min-height: 0; background: ${T.bgBase}; }
.fo-main-scroll { flex: 1; min-height: 0; overflow: auto; padding: 16px; }
.fo-banner {
  display: flex; align-items: center; gap: 8px;
  margin: 0 0 12px; padding: 12px 16px;
  border-radius: 10px; font-size: 12px;
  color: ${T.error};
  background: ${g(T.error, 12)};
  border: 1px solid ${g(T.error, 30)};
}
.fo-banner .fo-btn { margin-left: auto; }

/* 一张图 = 一个玻璃容器（容器圆角 10px） */
.fo-graph {
  margin: 0 0 16px; border: 1px solid var(--fo-glass-line); border-radius: 10px;
  background: var(--fo-glass-card);
  backdrop-filter: var(--fo-glass-blur);
  -webkit-backdrop-filter: var(--fo-glass-blur);
  box-shadow: var(--fo-glass-shadow);
  overflow: hidden;
  transition: border-color var(--fo-dur) var(--fo-ease);
}
.fo-graph:hover { border-color: var(--fo-glass-line-hover); }
.fo-graph-head {
  display: flex; align-items: center; gap: 8px; flex-wrap: wrap;
  padding: 10px 16px; border-bottom: 1px solid var(--fo-glass-line);
}
.fo-graph-name { font-size: 13px; font-weight: 600; }
.fo-graph-meta { display: flex; align-items: center; gap: 8px; margin-left: auto; flex-wrap: wrap; }
.fo-graph-body { overflow: auto; padding: 6px; }
.fo-svg { display: block; }
.fo-band { fill: color-mix(in oklab, var(--fo-c, ${T.label2}) 6%, transparent); stroke: color-mix(in oklab, var(--fo-c, ${T.label2}) 30%, transparent); stroke-width: 1; }
.fo-band[data-external="1"] { fill: color-mix(in oklab, ${T.label2} 5%, transparent); stroke: var(--fo-glass-line-hover); stroke-dasharray: 4 4; }
.fo-band-label { fill: var(--fo-c, ${T.label2}); font-size: 11px; font-weight: 600; }
.fo-band-label[data-external="1"] { fill: ${T.label2}; font-weight: 400; }
.fo-edge { fill: none; stroke: var(--fo-glass-line-hover); stroke-width: 1.4; }
.fo-edge[data-kind="derived_from"] { stroke-dasharray: 5 4; stroke: ${T.idle}; }
.fo-edge.is-active { stroke: ${T.brand}; stroke-width: 2; }
.fo-arrow { fill: var(--fo-glass-line-hover); }
.fo-arrow[data-kind="derived_from"] { fill: ${T.idle}; }
.fo-node { cursor: pointer; }
.fo-node-bg { fill: var(--fo-glass-sub); stroke: var(--fo-glass-line); stroke-width: 1; }
.fo-node.is-ghost .fo-node-bg { fill: transparent; stroke: var(--fo-glass-line-hover); stroke-dasharray: 4 3; }
.fo-node:hover .fo-node-bg { stroke: var(--fo-glass-line-hover); }
.fo-node.is-selected .fo-node-bg { stroke: ${T.brand}; stroke-width: 2; }
.fo-node-spine { fill: var(--fo-c, ${T.idle}); }
.fo-node-dot { fill: var(--fo-c, ${T.idle}); }
.fo-node-no { fill: ${T.label2}; font-size: 10px; font-weight: 600; }
.fo-node-title { fill: ${T.label1}; font-size: 12px; }
.fo-node.is-ghost .fo-node-title { fill: ${T.label2}; }
.fo-node-meta { fill: ${T.label2}; font-size: 10px; }
.fo-node:focus-visible { outline: none; }
.fo-node:focus-visible .fo-node-bg { stroke: ${T.brand}; stroke-width: 2; }

/* ============ 任务卡片：玻璃卡片 + 悬停上浮 + 品牌渐变淡入 ============ */
.fo-cards-title {
  display: flex; align-items: center; gap: 8px;
  margin: 4px 2px 12px; font-size: 11px; font-weight: 600;
  color: ${T.label2}; letter-spacing: .04em; text-transform: uppercase;
}
.fo-cards { display: grid; grid-template-columns: repeat(auto-fill, minmax(240px, 1fr)); gap: 12px; }
.fo-card {
  position: relative; overflow: hidden;
  display: flex; flex-direction: column; gap: 8px;
  padding: 16px; min-width: 0;
  border: 1px solid var(--fo-glass-line); border-radius: 12px;
  background: var(--fo-glass-card);
  backdrop-filter: var(--fo-glass-blur);
  -webkit-backdrop-filter: var(--fo-glass-blur);
  box-shadow: var(--fo-glass-shadow);
  color: inherit; font: inherit; text-align: left;
  cursor: pointer;
  transition: transform var(--fo-dur) var(--fo-ease), border-color var(--fo-dur) var(--fo-ease), box-shadow var(--fo-dur) var(--fo-ease);
}
.fo-card::after {
  content: ''; position: absolute; inset: 0; border-radius: inherit;
  background: var(--fo-glass-wash);
  opacity: 0; pointer-events: none;
  transition: opacity var(--fo-dur) var(--fo-ease);
}
.fo-card:hover { transform: translateY(-3px) scale(1.01); border-color: var(--fo-glass-line-hover); }
.fo-card:hover::after { opacity: 1; }
/* 状态光晕：借参考项目「稀有度光晕」的写法，落到我们的四态上——卡片左侧一条 3px 光条。
   品牌/成功/警告/错误/idle 五个光晕色都来自状态令牌的 35% 混合，不新增颜色。 */
.fo-card[data-state="blocked"] { --fo-card-glow: var(--fo-glow-error); border-color: ${g(T.error, 30)}; }
.fo-card[data-state="suspended"] { --fo-card-glow: var(--fo-glow-warn); border-color: ${g(T.warn, 30)}; }
.fo-card[data-state="done"] { --fo-card-glow: var(--fo-glow-success); border-color: ${g(T.success, 24)}; }
.fo-card[data-state="open"] { --fo-card-glow: var(--fo-glow-brand); }
.fo-card::before {
  content: ''; position: absolute; left: 0; top: 14px; bottom: 14px; width: 3px;
  border-radius: 999px;
  background: var(--fo-card-glow, var(--fo-glow-idle));
}
.fo-card[aria-current="true"] { border-color: var(--fo-selected-line); background: var(--fo-selected-bg); }
.fo-card-top { display: flex; align-items: center; gap: 8px; }
.fo-card-no { font-size: 11px; color: ${T.label2}; font-variant-numeric: tabular-nums; }
.fo-card-title {
  font-size: 12px; color: ${T.label1};
  display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical;
  overflow: hidden;
}
.fo-card-foot { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; margin-top: 2px; }
.fo-tag {
  display: inline-flex; align-items: center; gap: 3px;
  max-width: 100%; height: 18px; padding: 0 8px;
  border-radius: 999px; font-size: 10px;
  color: ${T.label2}; background: var(--fo-glass-sub);
  border: 1px solid var(--fo-glass-line);
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.fo-tag[data-tone="danger"] { color: ${T.error}; background: ${g(T.error, 13)}; border-color: ${g(T.error, 30)}; }
.fo-tag[data-tone="ok"] { color: ${T.success}; background: ${g(T.success, 13)}; border-color: ${g(T.success, 30)}; }
.fo-tag[data-tone="warn"] { color: ${T.warn}; background: ${g(T.warn, 14)}; border-color: ${g(T.warn, 30)}; }
.fo-tag[data-tone="idle"] { color: ${T.idle}; background: ${g(T.idle, 16)}; border-color: ${g(T.idle, 32)}; }

/* ============ 右栏：详情（独立玻璃层） ============ */
.fo-detail {
  display: flex; flex-direction: column; gap: 12px;
  min-width: 0; min-height: 0; overflow: auto;
  padding: 16px;
  border-left: 1px solid var(--fo-glass-line);
  background: var(--fo-glass-card);
  backdrop-filter: var(--fo-glass-blur);
  -webkit-backdrop-filter: var(--fo-glass-blur);
}
.fo-detail-eyebrow { display: flex; align-items: center; gap: 8px; font-size: 11px; color: ${T.label2}; }
.fo-detail-title { margin: 0; font-size: 13px; font-weight: 600; line-height: 1.45; word-break: break-word; }
.fo-kv { display: grid; grid-template-columns: 76px minmax(0, 1fr); gap: 6px 10px; margin: 0; font-size: 12px; }
.fo-kv dt { color: ${T.label2}; }
.fo-kv dd { margin: 0; min-width: 0; overflow-wrap: anywhere; }
.fo-mono { font-family: ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace; font-size: 11px; }
.fo-sec { display: flex; flex-direction: column; gap: 8px; }
.fo-sec-label { font-size: 11px; font-weight: 600; color: ${T.label2}; }
.fo-refs { display: flex; flex-direction: column; gap: 6px; }
.fo-ref {
  position: relative; overflow: hidden;
  display: flex; align-items: center; gap: 8px;
  width: 100%; padding: 8px 10px;
  border: 1px solid var(--fo-glass-line); border-radius: 10px;
  background: var(--fo-glass-sub); color: inherit; font: inherit; font-size: 12px;
  text-align: left; cursor: pointer;
  transition: transform var(--fo-dur) var(--fo-ease), border-color var(--fo-dur) var(--fo-ease);
}
.fo-ref::after {
  content: ''; position: absolute; inset: 0; border-radius: inherit;
  background: var(--fo-glass-wash);
  opacity: 0; pointer-events: none;
  transition: opacity var(--fo-dur) var(--fo-ease);
}
.fo-ref:hover:not(:disabled) { transform: translateY(-3px) scale(1.01); border-color: var(--fo-glass-line-hover); }
.fo-ref:hover:not(:disabled)::after { opacity: 1; }
.fo-ref:disabled, .fo-ref[data-missing="1"] { cursor: default; color: ${T.label2}; border-style: dashed; background: transparent; }
.fo-ref-kind { flex: 0 0 auto; font-size: 10px; color: ${T.label2}; }
.fo-ref-label { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.fo-muted { margin: 0; font-size: 12px; color: ${T.label2}; }
.fo-detail-actions { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; margin-top: auto; padding-top: 8px; }

/* ============ 空态 / 加载态 ============ */
.fo-placeholder {
  display: flex; flex-direction: column; align-items: center; justify-content: center;
  gap: 12px; flex: 1; min-height: 180px; padding: 32px 20px; text-align: center;
}
.fo-placeholder-title { font-size: 13px; font-weight: 600; }
.fo-placeholder-body { max-width: 420px; font-size: 12px; color: ${T.label2}; }
.fo-skeleton { display: flex; flex-direction: column; gap: 12px; }
.fo-skeleton-row {
  height: 64px; border-radius: 12px;
  background: linear-gradient(90deg, var(--fo-glass-sub) 0%, ${g(T.bgLayer2, 40)} 50%, var(--fo-glass-sub) 100%);
  background-size: 200% 100%;
  animation: fo-shimmer 1.4s var(--fo-ease) infinite;
}
@keyframes fo-shimmer { 0% { background-position: 200% 0; } 100% { background-position: -200% 0; } }

/* ============ 尊重系统「减少动态效果」：位移与渐变过渡全部关掉 ============ */
@media (prefers-reduced-motion: reduce) {
  .fo-root *, .fo-root *::before, .fo-root *::after {
    animation: none !important;
    transition: none !important;
  }
  .fo-card:hover, .fo-ref:hover:not(:disabled), .fo-btn:hover:not(:disabled), .fo-row:hover { transform: none !important; }
  .fo-card:hover::after, .fo-ref:hover:not(:disabled)::after { opacity: 0 !important; }
}
`

/** 项目分色槽位 → CSS 变量引用（组件只用这个，永远不写死颜色）。 */
export function decoVar(index) {
  const n = Math.floor(Number(index))
  if (!isFinite(n) || n < 0) return 'var(--fo-deco-0)'
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
