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
  /* **容器查询的锚点**：这块面板活在宿主侧栏的 tab 里，宽度由宿主决定、与视口无关。
     所以响应式一律按「面板自己有多宽」判断（@container fopanel），不要用 @media（视口）——
     否则「桌面大屏 + 很窄的 tab」会让卡片挤爆、rail 又过宽。 */
  container-type: inline-size;
  container-name: fopanel;
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
  /* 玻璃三件套 */
  --fo-glass-card: ${GLASS.card};
  --fo-glass-sub: ${GLASS.sub};
  --fo-glass-line: ${GLASS.line};
  --fo-glass-line-hover: ${GLASS.lineHover};
  --fo-glass-shadow: ${GLASS.shadow};
  --fo-glass-wash: ${GLASS.wash};
  --fo-glass-blur: blur(12px);
  /* 侧栏宽度。参考站是 288px，但那是**整页**的 aside；我们这块是宿主侧栏里的一个 tab，
     288px 会把正文挤得很窄（用户实测「展开太宽」）。所以收到 232px：
     标签最长的「洞察」「运行」两字 + 图标 + caret 在这个宽度里仍然舒展。 */
  --fo-rail-w: 232px;
  /* rail 里「一个方块」的边长：logo 与一级项**共用**这一个值，
     以后只调这里，两者不可能再不一致（用户反复踩到的就是「改一处、另一处没跟上」）。 */
  --fo-rail-item: 44px;
  --fo-rail-line: ${g(T.border1, 40)};
  --fo-row-hover-bg: ${g(T.bgLayer2, 55)};
  --fo-selected-bg: ${g(T.brand, 20)};
  --fo-selected-line: ${g(T.brand, 30)};
  /* 画布：40px 网格 + 品牌调渐变底（参考站 WorkflowEditor 同款） */
  /* 优先级：画布左侧 3px 色条，颜色与面板任务卡（data-priority）的 border-left 一一对应。 */
  --fo-prio-p0: ${T.error};
  --fo-prio-p1: ${T.warn};
  --fo-prio-p2: ${T.brand};
  --fo-prio-p3: ${T.idle};
  --fo-grid-size: 40px;
  --fo-grid-line: ${g(T.border1, 12)};
  --fo-canvas-bg: linear-gradient(135deg, ${g(T.bgBase, 55)}, ${g(T.bgLayer1, 35)});
  --fo-canvas-line: ${g(T.border1, 35)};
  --fo-ease: cubic-bezier(.2, .8, .2, 1);
  --fo-dur: 300ms;

  display: grid;
  /* rail（功能导航）| 正文（功能页 + 详情） */
  grid-template-columns: var(--fo-rail-w) minmax(0, 1fr);
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
.fo-brand, .fo-featnav-item, .fo-row, .fo-graph, .fo-sec, .fo-ref, .fo-scope-head {
  animation: fo-rise 120ms var(--fo-ease) backwards;
  animation-delay: calc(var(--fo-i, 0) * 20ms);
}

/* ============ rail 三段：品牌 / 功能导航 / 底部固定区 ============ */
.fo-rail {
  display: flex; flex-direction: column; min-width: 0; min-height: 0;
  border-right: 1px solid var(--fo-rail-line);
  /* 参考站 aside 是「极深蓝黑 80% + blur(40px)」；这里用宿主的 sidebar-fill 铺同一层 80% 半透明底 */
  background: color-mix(in oklab, ${T.sidebar} 80%, transparent);
  backdrop-filter: blur(24px);
  -webkit-backdrop-filter: blur(24px);
}
.fo-brand {
  display: flex; align-items: center; gap: 10px;
  min-height: 68px; padding: 10px 16px;
  border-bottom: 1px solid var(--fo-glass-line);
}
/* logo 与一级项**同高**（44px）：展开态两者都是 44 高，收起态两者都是 36×36 正方形。
   只改一处尺寸会让「大小不一致」反复出现，所以这里按「和导航项对齐」定尺寸。 */
.fo-brand-logo {
  flex: 0 0 var(--fo-rail-item); width: var(--fo-rail-item); height: var(--fo-rail-item); border-radius: 12px;
  display: inline-flex; align-items: center; justify-content: center;
  color: ${T.brand};
  background: var(--fo-selected-bg);
  border: 1px solid var(--fo-selected-line);
}
.fo-brand-text { display: flex; flex-direction: column; min-width: 0; gap: 1px; }
.fo-brand-title { font-size: 13px; font-weight: 600; color: ${T.label1}; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.fo-brand-sub { font-size: 11px; color: ${T.label2}; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.fo-featnav {
  flex: 1; min-height: 0; overflow: auto; display: flex; flex-direction: column; gap: 8px; padding: 10px;
  scrollbar-width: thin; scrollbar-color: var(--fo-glass-line-hover) transparent;
}
.fo-featnav::-webkit-scrollbar, .fo-subnav .fo-scope-body::-webkit-scrollbar { width: 6px; }
.fo-featnav::-webkit-scrollbar-thumb, .fo-subnav .fo-scope-body::-webkit-scrollbar-thumb {
  background: var(--fo-glass-line-hover); border-radius: 3px;
}
.fo-featnav::-webkit-scrollbar-track, .fo-subnav .fo-scope-body::-webkit-scrollbar-track { background: transparent; }
.fo-featnav-item {
  display: flex; align-items: center; gap: 10px;
  width: 100%; min-width: 0; height: var(--fo-rail-item); padding: 0 12px;
  border: 1px solid transparent; border-radius: 12px;
  background: transparent; color: ${T.label2}; font: inherit; font-size: 13px; text-align: left;
  cursor: pointer;
  transition: background-color var(--fo-dur) var(--fo-ease), border-color var(--fo-dur) var(--fo-ease), color var(--fo-dur) var(--fo-ease);
}
.fo-featnav-item:hover { background: var(--fo-row-hover-bg); border-color: var(--fo-glass-line); color: ${T.label1}; }
.fo-featnav-item[data-active="1"] {
  background: var(--fo-selected-bg);
  border-color: var(--fo-selected-line);
  color: ${T.brand}; font-weight: 500;
}
.fo-nav-icon { flex: 0 0 20px; width: 20px; height: 20px; }
.fo-nav-label { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
/* 两级菜单：一级项 +（可展开项的）二级菜单。caret 是唯一的展开指示，不额外加文字。 */
.fo-featnav-group { display: flex; flex-direction: column; min-width: 0; }
.fo-nav-caret { margin-left: auto; flex: 0 0 auto; font-size: 10px; color: ${T.label2}; transition: transform .12s var(--fo-ease); }
.fo-nav-caret[data-open="1"] { transform: rotate(180deg); }
/* 二级菜单（「关系」下面是范围树）：不再自带侧栏底色/描边与 blur —— 它就是 rail 的一部分。
   行更矮（30px）、字号 12px、左侧缩进 24px 起（一级项 padding 是 12px），长文案用省略号。 */
.fo-subnav {
  display: flex; flex-direction: column; min-width: 0; padding: 2px 0 6px;
  border-top: 1px solid var(--fo-glass-line);
  margin-top: 2px;
}
.fo-subnav .fo-scope {
  border-right: 0; background: transparent;
  backdrop-filter: none; -webkit-backdrop-filter: none;
}
.fo-subnav .fo-scope-head { padding: 2px 10px 6px 24px; border-bottom: 0; }
.fo-subnav .fo-scope-body { padding: 0 10px 4px 0; }
.fo-subnav .fo-scope-list { gap: 2px; }
/* 行高 30 → 32：命中区域更接近可用下限（触控板/触屏更稳），顺带给两层导轨留出高度 */
.fo-subnav .fo-row { height: 32px; padding: 0 6px 0 8px; gap: 6px; border-radius: 8px; font-size: 12px; }
/* 计数**定宽**：hover 时只淡出、不改布局 —— 否则名字会突然变宽，整行文字抖一下（用户能看见的那种抖） */
.fo-subnav .fo-row-count { min-width: 44px; text-align: right; }
/* 缩进导轨：每层一条 1px 竖线，位置由 TreeNav 按 indentStep 算好 */
.fo-guide { position: absolute; top: 2px; bottom: 2px; width: 1px; background: ${g(T.label1, 8)}; pointer-events: none; }
.fo-row:hover .fo-guide, .fo-row[aria-selected="true"] .fo-guide { background: ${g(T.label1, 14)}; }
/* 「未分组」是系统桶而不是用户建的目录：虚线方点 + 整行降一档，避免被当成真目录 */
.fo-dot.is-bucket {
  width: 10px; height: 10px; border-radius: 3px; background: none;
  border: 1px dashed ${g(T.label2, 55)}; box-shadow: none;
}
.fo-row[data-bucket="1"] .fo-row-label { font-weight: 400; color: ${T.label2}; }
.fo-subnav .fo-row-menu { width: 20px; height: 20px; min-width: 20px; padding: 0; border-radius: 6px; font-size: 13px; line-height: 1; }
.fo-subnav .fo-row-count { font-size: 11px; }
.fo-subnav .fo-row-badge { font-size: 9px; }
.fo-subnav .fo-caret { flex: 0 0 10px; width: 10px; height: 10px; font-size: 8px; }
.fo-subnav .fo-dot {
  /* 项目行可以把色点换成图标（.is-logo）：保持同样的 8px 占位不跳动 */ flex: 0 0 6px; width: 6px; height: 6px; box-shadow: 0 0 0 2px color-mix(in oklab, var(--fo-c, ${T.idle}
.fo-dot.is-logo { display: inline-flex; align-items: center; justify-content: center; width: 14px; height: 14px; background: none; border: 0; }
) 22%, transparent); }
.fo-subnav .fo-scope-note { padding: 1px 8px 3px 30px; font-size: 10px; }
.fo-subnav .fo-input { height: 24px; }
/* rail 收成 56px 图标条时二级菜单整个藏起来（列不下，也没法操作） */
.fo-root[data-rail="0"] .fo-subnav { display: none; }
/* 说明：底部固定区（刷新/折叠）已按用户口径移除 —— 折叠在品牌 logo 上，刷新在正文头部。 */
/* rail 收起：只留 56px 图标条（按钮仍可点，能再展开） */
/* rail 收起：只留 52px 图标条。**caret 必须一起藏**——只藏文字、留着 ▾ 会让图标偏左，
   用户实测「折叠时图标没对齐」就是这么来的。 */
.fo-root[data-rail="0"] { --fo-rail-w: 52px; --fo-rail-item: 36px; }
/* 收起态：logo 与下面的一级项**同尺寸正方形**（36×36 / 圆角 10），整条 rail 只留图标列 */
.fo-root[data-rail="0"] .fo-brand { justify-content: center; padding: 8px 0; }
/* 收起态 logo：必须显式改 flex-basis —— 基础规则里的 flex 是 0 0 40px，
   只改 width/height 的话 flex 仍按 40px 排版，于是 logo 比一级项宽 4px（用户看到的「大小不一致」）。 */
.fo-root[data-rail="0"] .fo-brand-logo { padding: 0; border-radius: 10px; }
/* 收起态：文字与 caret 都隐藏（只藏文字会让图标偏左） */
.fo-root[data-rail="0"] .fo-brand-text,
.fo-root[data-rail="0"] .fo-nav-label,
.fo-root[data-rail="0"] .fo-nav-caret { display: none; }
/* 收起态：一级项是 36×36 的正方形，与 logo 同尺寸 */
.fo-root[data-rail="0"] .fo-featnav-item {
  justify-content: center; padding: 0; gap: 0;
  width: var(--fo-rail-item); height: var(--fo-rail-item); margin: 0 auto; border-radius: 10px;
}
/* 收起态：图标本身严格居中（不靠子元素宽度凑），并禁掉 caret 的旋转占位 */
.fo-root[data-rail="0"] .fo-featnav-item > svg,
.fo-root[data-rail="0"] .fo-featnav-item > .fo-nav-icon { margin: 0 auto; flex: 0 0 auto; }
.fo-root[data-rail="0"] .fo-featnav-item[data-active="1"]::before { left: 4px; }
.fo-root[data-rail="0"] .fo-rail-foot { justify-content: center; }

/* ============ 项目图标选择器（纯本地展示配置） ============ */
.fo-logo-backdrop {
  position: fixed; inset: 0; z-index: 61;
  display: flex; align-items: center; justify-content: center;
  background: color-mix(in oklab, var(--dsw-alias-bg-base) 55%, transparent);
  backdrop-filter: blur(2px);
}
.fo-logo-pop {
  width: min(420px, calc(100vw - 48px));
  padding: 16px; border-radius: 16px;
  background: color-mix(in oklab, var(--dsw-alias-bg-overlay) 96%, transparent);
  border: 1px solid var(--fo-glass-line);
  box-shadow: 0 24px 48px color-mix(in oklab, var(--dsw-alias-bg-base) 60%, transparent);
  display: flex; flex-direction: column; gap: 12px;
}
.fo-logo-head { display: flex; align-items: baseline; gap: 8px; }
.fo-logo-title { font-size: 13px; font-weight: 600; color: var(--dsw-alias-label-primary); }
.fo-logo-build { margin-left: auto; font-size: 10px; font-family: ui-monospace, Menlo, monospace; color: color-mix(in oklab, var(--dsw-alias-label-secondary) 70%, transparent); }
.fo-logo-sub { font-size: 11px; color: var(--dsw-alias-label-secondary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.fo-logo-search { display: flex; flex-direction: column; gap: 8px; }
.fo-logo-input {
  width: 100%; height: 34px; padding: 0 10px; border-radius: 9px; font: inherit; font-size: 12px;
  color: var(--dsw-alias-label-primary);
  background: color-mix(in oklab, var(--dsw-alias-bg-layer-2) 70%, transparent);
  border: 1px solid var(--fo-glass-line);
}
.fo-logo-input::placeholder { color: var(--dsw-alias-label-secondary); }
.fo-logo-tabs { display: flex; gap: 6px; }
.fo-logo-tab {
  padding: 4px 10px; border-radius: 8px; font: inherit; font-size: 12px; cursor: pointer;
  color: var(--dsw-alias-label-secondary); background: transparent;
  border: 1px solid var(--fo-glass-line);
}
.fo-logo-tab[data-active="1"] {
  color: var(--dsw-alias-label-primary);
  background: color-mix(in oklab, var(--dsw-alias-brand-primary) 20%, transparent);
  border-color: color-mix(in oklab, var(--dsw-alias-brand-primary) 45%, transparent);
}
.fo-logo-section { display: flex; flex-direction: column; gap: 6px; }
.fo-logo-section-title { font-size: 10px; letter-spacing: .08em; text-transform: uppercase; color: var(--dsw-alias-label-secondary); }
.fo-logo-grid { display: grid; grid-template-columns: repeat(8, 1fr); gap: 6px; }
.fo-logo-grid-scroll { max-height: 210px; overflow-y: auto; padding-right: 4px; }
.fo-logo-grid-scroll::-webkit-scrollbar { width: 6px; }
.fo-logo-grid-scroll::-webkit-scrollbar-thumb { background: color-mix(in oklab, var(--dsw-alias-label-secondary) 30%, transparent); border-radius: 999px; }
.fo-logo-emoji-scroll { max-height: 230px; overflow-y: auto; gap: 10px; }
.fo-logo-emoji-group { display: flex; flex-direction: column; gap: 4px; }
.fo-logo-emoji-grid { display: grid; grid-template-columns: repeat(10, 1fr); gap: 4px; }
.fo-logo-emoji-cell {
  height: 30px; border-radius: 8px; font-size: 17px; line-height: 1; cursor: pointer;
  background: transparent; border: 1px solid transparent;
}
.fo-logo-emoji-cell:hover { background: color-mix(in oklab, var(--dsw-alias-brand-primary) 16%, transparent); border-color: color-mix(in oklab, var(--dsw-alias-brand-primary) 40%, transparent); }
.fo-logo-colors { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.fo-logo-color {
  width: 22px; height: 22px; border-radius: 999px; cursor: pointer; font-size: 13px; line-height: 1;
  color: var(--dsw-alias-label-secondary);
  background: color-mix(in oklab, var(--dsw-alias-bg-layer-2) 60%, transparent);
  border: 1px solid var(--fo-glass-line);
}
.fo-logo-color[data-active="1"] {
  outline: 2px solid color-mix(in oklab, var(--dsw-alias-brand-primary) 75%, transparent);
  outline-offset: 1px;
}
.fo-logo-cell {
  display: flex; align-items: center; justify-content: center;
  height: 40px; border-radius: 10px; cursor: pointer;
  color: var(--dsw-alias-label-secondary);
  background: color-mix(in oklab, var(--dsw-alias-bg-layer-2) 60%, transparent);
  border: 1px solid transparent;
  transition: background-color var(--fo-dur) var(--fo-ease), color var(--fo-dur) var(--fo-ease), border-color var(--fo-dur) var(--fo-ease);
}
.fo-logo-cell:hover {
  color: var(--dsw-alias-label-primary);
  background: color-mix(in oklab, var(--dsw-alias-brand-primary) 18%, transparent);
  border-color: color-mix(in oklab, var(--dsw-alias-brand-primary) 45%, transparent);
}
.fo-logo-foot { display: flex; align-items: center; justify-content: space-between; gap: 8px; }

/* ============ 内容头部：面包屑/标题 + 搜索框 + 动作 ============ */
.fo-main-head {
  display: flex; align-items: center; gap: 12px; flex-wrap: wrap;
  min-height: 64px; padding: 10px 16px;
  border-bottom: 1px solid var(--fo-glass-line);
  background: color-mix(in oklab, ${T.bgBase} 40%, transparent);
}
.fo-crumb { display: flex; flex-direction: column; min-width: 0; gap: 1px; }
.fo-crumb-title { font-size: 13px; font-weight: 600; letter-spacing: .01em; }
.fo-crumb-sub { font-size: 11px; color: ${T.label2}; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
/* 搜索框在**正文头部**（参考站也是 main > header），左侧 40px 留给图标 */
.fo-search-wrap { position: relative; display: flex; align-items: center; gap: 8px; flex: 1 1 220px; min-width: 0; max-width: 460px; }
.fo-search-icon {
  position: absolute; left: 12px; top: 50%; transform: translateY(-50%);
  display: inline-flex; color: ${T.label2}; pointer-events: none;
}
.fo-search {
  width: 100%; min-width: 0; height: 42px;
  padding: 0 12px 0 40px; border-radius: 14px;
  font: inherit; font-size: 12px;
  color: ${T.label1};
  background: ${g(T.bgBase, 70)};
  border: 1px solid var(--fo-glass-line);
}
.fo-search::placeholder { color: ${T.label2}; }
.fo-search:focus-visible { border-color: var(--fo-selected-line); outline: none; }
.fo-search-hint { flex: 0 0 auto; font-size: 11px; color: ${T.label2}; white-space: nowrap; }
.fo-head-actions { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; margin-left: auto; }
/* 提示条（role=status）：动作没做成时给一句人话，别静默。与 role=alert 的错误条分开。 */
.fo-note {
  display: flex; align-items: center; gap: 8px;
  margin: 10px 10px 0; padding: 8px 12px;
  border-radius: 10px; font-size: 12px;
  color: ${T.label1};
  background: var(--fo-glass-sub);
  border: 1px solid var(--fo-glass-line);
}
.fo-note .fo-btn { margin-left: auto; }

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
/* 主按钮：**品牌色向底色靠一档当底 + label-primary 当字**。
   用户报「一键整理按钮，文字颜色看不到」，量出来是原方案（实心品牌底 + bgBase 文字）在
   **浅色主题**只有 ~3.5:1：因为 bgBase 在浅色主题是近白、在暗色主题是近黑，而品牌蓝在两个主题里
   都是偏亮的中间色，于是「深色字」在浅色主题才该用 —— 但单个令牌做不到跨主题都深/都浅。
   现在：底色 = brand 62% + bg-base 38%，文字 = label-primary，实测
   暗色 6.85:1、浅色 4.33:1（原方案 4.97 / 3.51），两个主题都过 AA 大字号线。 */
.fo-btn[data-variant="primary"] {
  background: color-mix(in oklab, ${T.brand} 62%, ${T.bgBase});
  border-color: color-mix(in oklab, ${T.brand} 78%, ${T.bgBase});
  color: ${T.label1};
}
.fo-btn[data-variant="primary"]:hover:not(:disabled) {
  background: color-mix(in oklab, ${T.brand} 74%, ${T.bgBase});
}
.fo-btn[data-variant="ghost"] { background: transparent; border-color: transparent; color: ${T.label2}; }
.fo-btn[data-variant="ghost"]:hover:not(:disabled) { background: var(--fo-glass-sub); color: ${T.label1}; border-color: var(--fo-glass-line); }
.fo-btn[data-size="sm"] { height: 22px; padding: 0 8px; font-size: 11px; }

/* ============ 主体三栏 ============ */
/* 正文区：功能页 | 详情（rail 由根栅格的第一列承担） */
.fo-body {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  min-height: 0;
  min-width: 0;
}
.fo-root[data-detail="1"] .fo-body { grid-template-columns: minmax(0, 1fr) clamp(260px, 30%, 336px); }
/* 一键整理抽屉：正文右边的玻璃抽屉；与详情同时开时是第三列（正文 | 详情 | 建议） */
.fo-root[data-organize="1"] .fo-body { grid-template-columns: minmax(0, 1fr) clamp(260px, 30%, 340px); }
.fo-root[data-detail="1"][data-organize="1"] .fo-body { grid-template-columns: minmax(0, 1fr) clamp(240px, 26%, 336px) clamp(240px, 26%, 340px); }
/* 视口不够时先压详情栏；rail 只在很窄时才收（288 是参考站口径） */
@container fopanel (max-width: 1180px) {
  .fo-root[data-detail="1"] .fo-body { grid-template-columns: minmax(0, 1fr) clamp(240px, 30%, 300px); }
  .fo-root[data-organize="1"] .fo-body { grid-template-columns: minmax(0, 1fr) clamp(240px, 30%, 320px); }
  .fo-root[data-detail="1"][data-organize="1"] .fo-body { grid-template-columns: minmax(0, 1fr) clamp(220px, 25%, 300px) clamp(220px, 25%, 320px); }
}
@container fopanel (max-width: 1040px) {
  .fo-root:not([data-rail="0"]) { --fo-rail-w: 212px; }
  .fo-root[data-detail="1"] .fo-body { grid-template-columns: minmax(0, 1fr) clamp(230px, 30%, 288px); }
}
@container fopanel (max-width: 960px) {
  .fo-root:not([data-rail="0"]) { --fo-rail-w: 196px; }
  .fo-root[data-detail="1"] .fo-body { grid-template-columns: minmax(0, 1fr) clamp(220px, 30%, 264px); }
}

/* ============ 功能页内的范围列（三层树，task-14 从 rail 搬进来） ============ */
.fo-scope {
  display: flex; flex-direction: column; min-width: 0; min-height: 0;
  border-right: 1px solid var(--fo-rail-line);
  /* 参考站 aside 是「极深蓝黑 80% + blur(40px)」。这里用宿主的 sidebar-fill（「宿主侧栏底」的令牌）
     铺同一层 80% 半透明底，模糊取 24px（性能与 40 取中） */
  background: color-mix(in oklab, ${T.sidebar} 80%, transparent);
  backdrop-filter: blur(24px);
  -webkit-backdrop-filter: blur(24px);
}
/* rail 顶部：搜索框（对齐参考站 "Search everything..." 的位置） */
.fo-scope-head {
  display: flex; align-items: center; gap: 8px;
  padding: 4px 16px 12px; border-bottom: 1px solid var(--fo-glass-line);
}
.fo-scope-title { font-size: 11px; font-weight: 600; color: ${T.label2}; letter-spacing: .06em; text-transform: uppercase; }
.fo-scope-head .fo-btn { margin-left: auto; }
.fo-scope-body { flex: 1; min-height: 0; overflow: auto; padding: 8px 16px 16px; }
.fo-scope-list { display: flex; flex-direction: column; gap: 4px; }
.fo-row {
  display: flex; align-items: center; gap: 10px;
  width: 100%; min-width: 0; height: 40px; padding: 0 12px;
  border: 1px solid transparent; border-radius: 12px;
  background: transparent; color: ${T.label2}; font: inherit; font-size: 13px; text-align: left;
  cursor: pointer;
  transition: transform var(--fo-dur) var(--fo-ease), border-color var(--fo-dur) var(--fo-ease), background-color var(--fo-dur) var(--fo-ease), color var(--fo-dur) var(--fo-ease);
}
.fo-row:hover { background: var(--fo-row-hover-bg); border-color: var(--fo-glass-line); color: ${T.label1}; }
.fo-row[aria-selected="true"] {
  background: var(--fo-selected-bg);
  border-color: var(--fo-selected-line);
  color: ${T.brand}; font-weight: 500;
  box-shadow: inset 2px 0 0 ${T.brand};
}
.fo-row.is-drop { border-color: ${T.brand}; background: ${g(T.brand, 20)}; }
.fo-row.is-drag { opacity: .45; }
.fo-row[data-kind="group"] { background: ${g(T.label1, 4)}; }
.fo-subnav .fo-row[data-kind="group"] {
  /* 目录行是分组骨架：给一层很浅的底块 + 上间距，让「几个项目属于它」一眼成块 */
  margin-top: 6px;
  height: 30px;
  background: ${g(T.label1, 5)};
  border-color: transparent;
}
.fo-subnav .fo-row[data-kind="group"]:first-child { margin-top: 0; }
.fo-row[data-kind="group"] .fo-row-label { font-weight: 600; color: ${T.label1}; }
/* 项目行是「可选项」：比目录轻一档，别和分组抢层级 */
.fo-row[data-kind="project"] .fo-row-label { color: ${T.label2}; }
.fo-row[data-kind="project"]:hover .fo-row-label,
.fo-row[data-kind="project"][aria-selected="true"] .fo-row-label { color: inherit; }
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
.fo-row-count {
  flex: 0 0 auto; font-size: 12px; color: ${T.label2};
  font-variant-numeric: tabular-nums;
  transition: opacity var(--fo-dur) var(--fo-ease);
}
.fo-subnav .fo-row-count[data-kind="project"] { color: ${T.label2}; opacity: .75; font-size: 11px; }
.fo-row-badge {
  flex: 0 0 6px; width: 6px; height: 6px; border-radius: 50%;
  background: ${T.error};
  box-shadow: 0 0 0 3px ${g(T.error, 18)};
}
.fo-row { position: relative; }
/* 行尾的「⋯」用绝对定位，不占行宽（rail 只有 232px，20px 就是两个汉字）；
   悬停时它淡入、计数淡出，两者不打架。 */
.fo-row-menu {
  position: absolute; right: 4px; top: 50%; transform: translateY(-50%);
  opacity: 0; transition: opacity var(--fo-dur) var(--fo-ease);
}
.fo-row:hover .fo-row-menu,
.fo-row:focus-within .fo-row-menu { opacity: 1; }
/* 只在真正悬停/聚焦时把计数让出去；选中行仍然显示计数（那是你在看的那个范围） */
.fo-row:hover .fo-row-count,
.fo-row:focus-within .fo-row-count { opacity: 0; }
.fo-scope-note { padding: 1px 8px 3px 34px; font-size: 11px; color: ${T.label2}; }
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

/* 功能页顶部的结论提示条（例如：接受建议后有几条落在默认隐藏的已完成任务上）。 */
.fo-note-bar {
  display: flex; align-items: center; gap: 8px;
  margin: 8px 10px 0; padding: 8px 12px;
  border-radius: 10px; font-size: 12px;
  color: ${T.label1};
  background: ${g(T.brand, 10)};
  border: 1px solid ${g(T.brand, 26)};
}
.fo-note-text { min-width: 0; flex: 1 1 auto; line-height: 1.5; }

/* ============ 中栏：功能页骨架（骨架不认识具体功能） ============ */
.fo-main { display: flex; flex-direction: column; min-width: 0; min-height: 0; background: ${T.bgBase}; }
.fo-feature-host { display: flex; flex-direction: column; flex: 1 1 auto; min-height: 0; }
.fo-feature { display: flex; flex-direction: column; flex: 1 1 auto; min-height: 0; }
/* 旧版顶部工具条（.fo-feature-bar）与画布浮动卡片（.fo-canvas-card）都已删：
   整页动作在正文头部（.fo-head-organize），逐图工具在每张卡片的 header（.fo-graph-actions）。 */
.fo-feature-body { display: flex; flex: 1 1 auto; min-height: 0; min-width: 0; }
/* task-17：范围树搬进 rail 之后，功能页只剩画布一块主内容（单列，画布拿全部宽度）。 */
.fo-canvas-area {
  position: relative;
  flex: 1 1 auto; min-width: 0; min-height: 0;
  overflow: hidden;
  padding: 10px; display: flex; flex-direction: column;
}
/* 画布舞台：图列表（每张卡片自己是独立的玻璃卡）。 */
.fo-canvas-stage {
  position: relative;
  flex: 1 1 auto; min-height: 0;
  display: flex; flex-direction: column;
}

/* ============ 卡片头部工具（.fo-graph-head 右侧） ============
   用户口径：「右上的按钮应该在卡片的 header 里而不是悬浮」——没有浮层，工具就长在卡片头上。
   视觉沿用 adventure WorkflowEditor 的分段控件口径：深底 + 细边 + 大圆角；
   整页的「建议」是主按钮口径（品牌色实心 + shadow），落在正文头部。 */
.fo-zoom-group {
  display: inline-flex; align-items: center; gap: 2px;
  padding: 3px; border-radius: 10px;
  background: ${g(T.bgBase, 45)};
  border: 1px solid ${g(T.border1, 26)};
}
.fo-zoom-value {
  height: 26px; min-width: 44px; padding: 0 4px;
  font-size: 11px; font-weight: 700; font-variant-numeric: tabular-nums; text-align: center;
  color: ${T.label2}; background: none; border: 0; border-radius: 8px;
  cursor: pointer;
}
.fo-zoom-value:hover { color: ${T.label1}; background: ${g(T.label1, 6)}; }
.fo-zoom-value:disabled { cursor: default; opacity: .45; }
/* 正文头部里的整理入口：走标准 primary 口径（底色=品牌、字色=bg-base，跟别处主按钮同一套），
   这里只补一层阴影和悬停放大。**不要再自定义字色** —— 之前写 label1 在浅色品牌底上等于白字白底。 */
.fo-head-organize { display: inline-flex; align-items: center; gap: 6px; }
.fo-head-organize .fo-btn[data-action="organize"] {
  box-shadow: 0 8px 18px -10px ${g(T.brand, 55)};
}
.fo-head-organize .fo-btn[data-action="organize"]:hover:not(:disabled) { transform: scale(1.03); }
.fo-banner {
  display: flex; align-items: center; gap: 8px;
  margin: 10px 10px 0; padding: 12px 16px;
  border-radius: 10px; font-size: 12px;
  color: ${T.error};
  background: ${g(T.error, 12)};
  border: 1px solid ${g(T.error, 30)};
}
.fo-banner .fo-btn { margin-left: auto; }

/* 画布列表：一张图时占满高度，多张时均分（撑满功能页的剩余空间） */
.fo-graphs { display: flex; flex-direction: column; gap: 12px; flex: 1 1 auto; min-height: 0; overflow: auto; }
/* 一张图 = 一块画布容器：16px 圆角 + border-l1 35% 描边 + 品牌调渐变底
   min-height 只做「不至于压成一条」的下限：多张图时靠 flex 均分撑满，不顶出滚动条
   （340px 时两张图会超出容器高度，画布反而出现滚动） */
.fo-graph {
  flex: 1 1 auto; min-height: 220px;
  display: flex; flex-direction: column;
  border: 1px solid var(--fo-canvas-line); border-radius: 16px;
  background: var(--fo-canvas-bg);
  overflow: hidden;
  transition: border-color var(--fo-dur) var(--fo-ease);
}
.fo-graph:hover { border-color: var(--fo-glass-line-hover); }
/* 多图折叠：收起时只留一行 header（不占画布高度），展开时和原来一样 */
.fo-graph.is-collapsed { flex: 0 0 auto; min-height: 0; }
.fo-graph.is-collapsed .fo-graph-head { border-bottom: 0; padding: 8px 12px; }
.fo-graph-toggle {
  display: flex; align-items: center; gap: 8px; min-width: 0; flex: 1 1 auto;
  padding: 0; border: 0; background: transparent; color: inherit;
  font: inherit; text-align: left; cursor: pointer;
}
.fo-graph-caret { flex: 0 0 auto; font-size: 10px; color: ${T.label2}; transition: transform .12s var(--fo-ease); }
.fo-graph-caret[data-collapsed="1"] { transform: rotate(-90deg); }
.fo-graph-summary {
  margin-left: auto; flex: 0 0 auto;
  font-size: 11px; color: ${T.label2}; font-variant-numeric: tabular-nums;
}
.fo-graph-head {
  display: flex; align-items: center; gap: 8px; flex-wrap: wrap;
  padding: 12px 16px; border-bottom: 1px solid var(--fo-glass-line);
}
.fo-graph-name { font-size: 13px; font-weight: 600; }
/* 边的图例（前置 / 来源 / 时间）：细线段 + 名称 + 数量，样式与画布上的线一一对应
   （实线 / 虚线 / 点线）。少了它，接受建议后「多了几条点线」很容易被当成没变化。 */
.fo-edge-legend { display: inline-flex; align-items: center; gap: 10px; min-width: 0; }
.fo-edge-item { display: inline-flex; align-items: center; gap: 5px; font-size: 11px; color: ${T.label2}; }
.fo-edge-swatch { width: 16px; height: 0; border-top: 2px solid var(--fo-glass-line-hover); flex: 0 0 16px; }
.fo-edge-swatch[data-kind="derived_from"] { border-top-style: dashed; border-top-color: ${T.idle}; }
.fo-edge-swatch[data-kind="temporal"] { border-top-style: dotted; border-top-color: ${T.idle}; opacity: .8; }
.fo-edge-count { font-variant-numeric: tabular-nums; }
/* 图例：没有泳道后，这是「哪个颜色 = 哪个项目」的唯一标识 */
.fo-graph-legend { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; min-width: 0; }
.fo-legend-item {
  display: inline-flex; align-items: center; gap: 5px; min-width: 0;
  font-size: 11px; color: ${T.label2};
}
.fo-legend-dot {
  width: 8px; height: 8px; border-radius: 50%; flex: 0 0 8px;
  background: var(--fo-c, ${T.brand});
  box-shadow: 0 0 0 2px color-mix(in oklab, var(--fo-c, ${T.brand}) 20%, transparent);
}
.fo-legend-label { max-width: 140px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.fo-legend-count { font-variant-numeric: tabular-nums; }
/* 图头右侧只剩**动作**；计数胶囊已删（同一份数在树上与节点上各有一份，离对象最近的那处胜出）。 */
.fo-graph-actions {
  display: flex; align-items: center; gap: 4px; margin-left: auto;
  flex-wrap: wrap; justify-content: flex-end; min-width: 0;
}
.fo-graph-actions .fo-btn {
  height: 26px; padding: 0 10px; border-radius: 8px;
  font-size: 11px; font-weight: 700; letter-spacing: .02em;
}
.fo-graph-actions .fo-btn[data-action="toggle-done"][aria-pressed="true"] { color: ${T.label1}; }
/* 图标按钮：26×26 方形，文字只在 title / aria-label 里（图头因此永远收得进一行） */
.fo-graph-actions .fo-btn[data-icon="1"] { width: 26px; min-width: 26px; padding: 0; display: inline-flex; align-items: center; justify-content: center; }
.fo-graph-actions .fo-btn[data-icon="1"] .fo-btn-icon { width: 14px; height: 14px; }
/* 窄面板：先让位给「名字 + 动作」，图例最后才上（信息密度优先给操作） */
@container fopanel (max-width: 900px) {
  .fo-graph-legend { display: none; }
  .fo-edge-legend { display: none; }
  .fo-graph-head { gap: 6px; }
}
@container fopanel (max-width: 700px) {
  .fo-graph-actions .fo-btn[data-action="toggle-done"] { max-width: 84px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .fo-graph-head { padding: 8px 10px; }
}

/* 画布区：占满图容器剩下的高度 + 24px 内边距；40px 双层网格铺满整块画布（不拦点击）。
   空白处按下拖动 = 平移（grab / grabbing 给手感），滚轮 = 以光标为锚点缩放。 */
.fo-canvas {
  position: relative; display: flex; flex-direction: column;
  flex: 1 1 auto; min-height: 0; width: 100%;
  padding: 24px;
  cursor: grab;
  touch-action: none;
  overscroll-behavior: contain;
}
.fo-canvas.is-panning { cursor: grabbing; }
.fo-viewport { transform-origin: 0 0; }
.fo-grid {
  position: absolute; inset: 0; width: 100%; height: 100%; pointer-events: none;
  background-image:
    linear-gradient(to right, var(--fo-grid-line) 1px, transparent 1px),
    linear-gradient(to bottom, var(--fo-grid-line) 1px, transparent 1px);
  background-size: var(--fo-grid-size) var(--fo-grid-size);
}
.fo-graph-body { position: relative; flex: 1 1 auto; min-height: 0; width: 100%; height: 100%; }
.fo-svg { position: absolute; inset: 0; width: 100%; height: 100%; display: block; }
.fo-edge {
  fill: none; stroke: var(--fo-glass-line-hover);
  stroke-width: 2; stroke-opacity: .7;
  pointer-events: stroke;
  transition: stroke-width var(--fo-dur) var(--fo-ease), stroke-opacity var(--fo-dur) var(--fo-ease), stroke var(--fo-dur) var(--fo-ease);
}
.fo-edge[data-kind="derived_from"] { stroke-dasharray: 5 4; stroke: ${T.idle}; }
/* 时间先后：点线 + 更淡的灰。它表达的是「谁在前谁在后」，不是必须等待——
   所以视觉上必须比依赖线弱一档，否则用户会把它当成阻塞关系。 */
.fo-edge[data-kind="temporal"] { stroke-dasharray: 1.5 5; stroke: ${T.idle}; stroke-opacity: .55; }
.fo-edge[data-kind="temporal"].is-active { stroke-opacity: 1; }
.fo-edge:hover, .fo-edge.is-active { stroke-width: 3; stroke-opacity: 1; }
.fo-edge.is-active { stroke: ${T.brand}; }
/* 箭头：6×6 实心三角，fill 跟边同色（参考站 markerWidth/Height=6、d="M 0 0 L 6 3 L 0 6 z"） */
.fo-arrow { fill: var(--fo-glass-line-hover); fill-opacity: .85; }
.fo-arrow[data-kind="derived_from"] { fill: ${T.idle}; }
.fo-arrow[data-kind="temporal"] { fill: ${T.idle}; fill-opacity: .55; }
/* ============ 画布节点 = workflow 式三段卡片（task-15） ============
   参考站 WorkflowEditor 的节点口径：rounded-xl + border-2 + shadow-xl + 玻璃底 +「左动作列 | 中信息 |
   右状态」。这里全落在 SVG 上：卡片 = rect（rx 12 / stroke 2），各段坐标由 layout.cardGeometry 给。
   状态色走 --fo-s（卡片描边 / 编号 eyebrow / 状态胶囊三者同色），项目分色仍走 --fo-c（左侧色条）。 */
/* ============ 节点卡片：与面板里的飞书任务卡同一套设计 ============
   口径照抄 panel.html 的 task 卡：1px 描边、9px 圆角、7/10 内边距、12.5px 标题、
   18px 徽标（radius 5）、会话胶囊（16 高、全圆角、10px 字）。 */
.fo-node { cursor: grab; transition: opacity var(--fo-dur) var(--fo-ease); }
.fo-node:active { cursor: grabbing; }
.fo-node-bg {
  fill: var(--fo-glass-card);
  stroke: var(--fo-glass-line);
  stroke-width: 1;
}
.fo-node:hover .fo-node-bg { stroke: var(--fo-glass-line-hover); }
/* 状态只给一个安静的提示：阻塞/挂起时描边带一点状态色，扫一眼画布就能找到卡住的那几张 */
.fo-node[data-state="blocked"] .fo-node-bg { stroke: ${g(T.error, 34)}; }
.fo-node[data-state="blocked"]:hover .fo-node-bg { stroke: ${g(T.error, 55)}; }
.fo-node[data-state="suspended"] .fo-node-bg { stroke: ${g(T.warn, 32)}; }
.fo-node[data-state="suspended"]:hover .fo-node-bg { stroke: ${g(T.warn, 52)}; }
.fo-node.is-selected .fo-node-bg { stroke: ${T.brand}; stroke-width: 1; }
/* 选中：1px 品牌描边 + 一圈柔光（面板 task-current 的等价物，但不做呼吸动画） */
.fo-node.is-selected { filter: drop-shadow(0 0 10px ${g(T.brand, 35)}); }
.fo-node.is-ghost .fo-node-bg {
  fill: transparent;
  stroke: ${g(T.idle, 55)};
  stroke-dasharray: 4 3;
}
/* 聚焦：选中的卡片是主角，其余降透明度（hover 回一点，仍可点） */
.fo-node.is-dimmed { opacity: .3; }
.fo-node.is-dimmed:hover { opacity: .75; }
.fo-node:focus-visible { outline: none; }
.fo-node:focus-visible .fo-node-bg { stroke: ${T.brand}; stroke-width: 2; }

/* 优先级徽标（面板 prio 徽标的 SVG 版）：P0 红 / P1 琥珀 / P2 蓝 / P3 灰 */
.fo-node-prio-bg { fill: var(--fo-prio-p3); }
.fo-node-prio-chip[data-value="P0"] .fo-node-prio-bg { fill: var(--fo-prio-p0); }
.fo-node-prio-chip[data-value="P1"] .fo-node-prio-bg { fill: var(--fo-prio-p1); }
.fo-node-prio-chip[data-value="P2"] .fo-node-prio-bg { fill: var(--fo-prio-p2); }
.fo-node-prio-chip[data-value="P3"] .fo-node-prio-bg { fill: var(--fo-prio-p3); }
.fo-node-prio-text { fill: var(--fo-glass-card-solid, ${T.bgBase}); font-size: 10.5px; font-weight: 700; letter-spacing: .03em; }
/* 页脚编号：列表卡里那个 T编号，mono 小字 */
.fo-node-no { fill: ${T.label2}; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 10px; letter-spacing: .02em; }

/* 标题行 */
.fo-node-title {
  fill: ${T.label1};
  font-size: 12.5px;
  font-weight: 500;
}
.fo-node.is-ghost .fo-node-title { fill: ${T.label2}; }
/* 会话胶囊：面板 sess-inline 胶囊的 SVG 版（16 高、全圆角、灯 + Session） */
.fo-node-sess-bg {
  fill: ${g(T.label1, 6)};
  stroke: var(--fo-glass-line);
  stroke-width: 1;
}
.fo-node-sess-lamp { fill: ${T.brand}; }
.fo-node-sess-text { fill: ${T.label2}; font-size: 10px; }
/* 徽标行：状态 / 前置 / 后置 / 时间，18 高、radius 5、11px */
.fo-node-badge-bg { stroke-width: 1; }
.fo-node-badge-text { font-size: 11px; font-weight: 500; }
.fo-node-badge[data-tone="open"] .fo-node-badge-bg { fill: ${g(T.brand, 10)}; stroke: ${g(T.brand, 26)}; }
.fo-node-badge[data-tone="open"] .fo-node-badge-text { fill: ${T.brand}; }
.fo-node-badge[data-tone="blocked"] .fo-node-badge-bg { fill: ${g(T.error, 12)}; stroke: ${g(T.error, 30)}; }
.fo-node-badge[data-tone="blocked"] .fo-node-badge-text { fill: ${T.error}; }
.fo-node-badge[data-tone="suspended"] .fo-node-badge-bg { fill: ${g(T.warn, 12)}; stroke: ${g(T.warn, 30)}; }
.fo-node-badge[data-tone="suspended"] .fo-node-badge-text { fill: ${T.warn}; }
.fo-node-badge[data-tone="done"] .fo-node-badge-bg { fill: ${g(T.success, 12)}; stroke: ${g(T.success, 28)}; }
.fo-node-badge[data-tone="done"] .fo-node-badge-text { fill: ${T.success}; }
.fo-node-badge[data-tone="idle"] .fo-node-badge-bg { fill: ${g(T.idle, 12)}; stroke: ${g(T.idle, 30)}; }
.fo-node-badge[data-tone="idle"] .fo-node-badge-text { fill: ${T.label2}; }
.fo-node-badge[data-tone="muted"] .fo-node-badge-bg { fill: ${g(T.label1, 5)}; stroke: ${g(T.label1, 10)}; }
.fo-node-badge[data-tone="muted"] .fo-node-badge-text { fill: ${T.label2}; }
.fo-node-badge[data-tone="project"] .fo-node-badge-bg { fill: transparent; stroke: ${g(T.label1, 13)}; }
.fo-node-badge[data-tone="project"] .fo-node-badge-text { fill: ${T.label2}; }
/* 动作：常显但压暗（用户口径：先不要简化）；悬停 / 键盘聚焦 / 选中时提亮 */
.fo-node-action { cursor: pointer; opacity: .55; transition: opacity var(--fo-dur) var(--fo-ease); }
.fo-node:hover .fo-node-action,
.fo-node:focus-within .fo-node-action,
.fo-node.is-selected .fo-node-action { opacity: 1; }
.fo-node-action-bg { fill: ${g(T.label1, 6)}; stroke: none; }
.fo-node-action-icon { fill: none; stroke: ${T.label1}; stroke-width: 1.4; stroke-linecap: round; stroke-linejoin: round; }
.fo-node-action:hover .fo-node-action-bg { fill: ${g(T.label1, 14)}; }
.fo-node-action[data-disabled="1"] { cursor: default; opacity: .3; }
.fo-node-action[data-disabled="1"]:hover .fo-node-action-bg { fill: ${g(T.label1, 6)}; }

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
.fo-ref-row { display: flex; align-items: center; gap: 4px; min-width: 0; }
.fo-ref-row .fo-ref { flex: 1 1 auto; min-width: 0; }
.fo-ref-del {
  flex: 0 0 20px; width: 20px; height: 20px; padding: 0;
  border: 1px solid transparent; border-radius: 6px;
  background: transparent; color: ${T.label2};
  font-size: 13px; line-height: 1; cursor: pointer;
  opacity: 0; transition: opacity var(--fo-dur) var(--fo-ease), color var(--fo-dur) var(--fo-ease);
}
.fo-ref-row:hover .fo-ref-del, .fo-ref-del:focus-visible { opacity: 1; }
.fo-ref-del:hover { color: ${T.error}; border-color: ${g(T.error, 30)}; background: ${g(T.error, 10)}; }
/* 手动加关系：类型 + 目标两个下拉 + 添加 */
.fo-rel-add-row { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
.fo-select {
  min-width: 0; height: 26px; padding: 0 6px;
  border-radius: 8px; font: inherit; font-size: 11.5px;
  color: ${T.label1}; background: ${T.bgLayer2};
  border: 1px solid var(--fo-glass-line);
}
.fo-select[data-role="rel-target"] { flex: 1 1 120px; }
.fo-ref-kind { flex: 0 0 auto; font-size: 10px; color: ${T.label2}; }
.fo-ref-label { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.fo-muted { margin: 0; font-size: 12px; color: ${T.label2}; }
.fo-detail-actions { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; margin-top: auto; padding-top: 8px; }

/* ============ 右栏：一键整理建议抽屉（task-16） ============
   每条建议 = 一次「改一条关系」的动作，所以卡片上必须同时有：类型徽标、两端标题、模型自评的把握、
   evidence 原文（引用块）、代价预览（会让谁变阻塞）。健康色/警告色都走宿主状态令牌。 */
.fo-organize {
  display: flex; flex-direction: column; gap: 10px;
  min-width: 0; min-height: 0; overflow: auto;
  padding: 14px;
  border-left: 1px solid var(--fo-glass-line);
  background: var(--fo-glass-card);
  backdrop-filter: var(--fo-glass-blur);
  -webkit-backdrop-filter: var(--fo-glass-blur);
}
.fo-org-head { display: flex; align-items: baseline; gap: 8px; flex-wrap: wrap; }
.fo-org-title { font-size: 13px; font-weight: 600; }
.fo-org-counts { margin-left: auto; font-size: 11px; color: ${T.label2}; font-variant-numeric: tabular-nums; }
.fo-org-notes { margin: 0; font-size: 12px; color: ${T.label2}; line-height: 1.5; }
.fo-org-list { display: flex; flex-direction: column; gap: 10px; }
.fo-org-item {
  display: flex; flex-direction: column; gap: 6px;
  padding: 10px 12px; border-radius: 12px;
  background: var(--fo-glass-sub);
  border: 1px solid var(--fo-glass-line);
}
.fo-org-item[data-status="accepted"] { border-color: ${g(T.success, 34)}; }
.fo-org-item[data-status="rejected"] { opacity: .6; }
.fo-org-top { display: flex; align-items: center; gap: 8px; }
.fo-org-kind {
  display: inline-flex; align-items: center; height: 18px; padding: 0 8px; border-radius: 999px;
  font-size: 10px; font-weight: 600; white-space: nowrap;
  color: ${T.brand}; background: var(--fo-selected-bg); border: 1px solid var(--fo-selected-line);
}
.fo-org-kind[data-kind="derived_from"] { color: ${T.idle}; background: ${g(T.idle, 16)}; border-color: ${g(T.idle, 32)}; }
.fo-org-kind[data-kind="temporal"] { color: ${T.idle}; background: ${g(T.idle, 12)}; border-color: ${g(T.idle, 24)}; }
.fo-org-conf { margin-left: auto; font-size: 11px; color: ${T.label2}; font-variant-numeric: tabular-nums; }
.fo-org-route { display: flex; align-items: center; gap: 6px; min-width: 0; font-size: 12px; }
.fo-org-from, .fo-org-to { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.fo-org-arrow { flex: 0 0 auto; color: ${T.brand}; }
.fo-org-evidence {
  margin: 0; padding: 6px 8px;
  border-left: 2px solid var(--fo-selected-line); border-radius: 0 8px 8px 0;
  background: ${g(T.bgBase, 60)};
  font-size: 11px; color: ${T.label2}; line-height: 1.5; word-break: break-word;
}
.fo-org-impact { margin: 0; font-size: 11px; color: ${T.warn}; }
.fo-org-impact[data-tone="idle"] { color: ${T.label2}; }
.fo-org-fail { margin: 0; font-size: 11px; color: ${T.error}; }
.fo-org-item-actions { display: flex; align-items: center; gap: 8px; }
.fo-org-done { font-size: 11px; color: ${T.label2}; }
.fo-org-empty { margin: 0; font-size: 12px; color: ${T.label2}; line-height: 1.5; }
.fo-org-dropped { display: flex; flex-direction: column; gap: 6px; }
.fo-org-dropped > .fo-btn { align-self: flex-start; }
.fo-org-dropped-list { display: flex; flex-direction: column; gap: 4px; }
.fo-org-dropped-item { display: flex; flex-direction: column; gap: 2px; padding: 6px 8px; border-radius: 8px; background: var(--fo-glass-sub); }
.fo-org-dropped-route { font-size: 11px; color: ${T.label2}; }
.fo-org-dropped-reason { font-size: 11px; color: ${T.label2}; }
.fo-org-foot {
  margin-top: auto; display: flex; align-items: center; gap: 8px; flex-wrap: wrap;
  padding-top: 8px; border-top: 1px solid var(--fo-glass-line);
}
.fo-btn-icon { flex: 0 0 auto; width: 14px; height: 14px; }

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
  .fo-ref:hover:not(:disabled), .fo-btn:hover:not(:disabled), .fo-row:hover { transform: none !important; }
  .fo-ref:hover:not(:disabled)::after { opacity: 0 !important; }
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
