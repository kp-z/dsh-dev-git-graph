/**
 * 仪表盘/洞察页的样式层（与总览的 `fo-` 完全隔离，类前缀 `fd-`）。
 *
 * 红线（与 `fo-` 那套同样严格）：
 * - **零字面量颜色**：没有任何 #hex / rgb() / hsl()，半透明一律
 *   `color-mix(in oklab, var(--dsw-alias-*) X%, transparent)`；
 * - **只引用宿主那 14 个 `--dsw-*` 令牌**，不自造调色板；
 * - 所有选择器都以 `.fd-` 类为根。
 *
 * 注入方式与 `styles.js` 一致：`injectStyles(doc)` 幂等（按 id 判断），无 document 时返回 false。
 */

export const STYLE_ID = 'dsh-feishu-dashboard-style'

/** 半透明助手：宿主令牌 + 百分比 → color-mix，避免任何字面量颜色。 */
const g = (token, pct) => `color-mix(in oklab, var(--dsw-alias-${token}) ${pct}%, transparent)`

export const CSS = `
/* ============ 仪表盘根：auto-fit 网格填满主区（最后一列/行自动拉满） ============ */
.fd-page {
  --fd-line: ${g('border-l1', 55)};
  --fd-line-strong: ${g('border-l2', 70)};
  --fd-surface: ${g('bg-layer-1', 55)};
  --fd-surface-2: ${g('bg-layer-2', 50)};
  --fd-sunken: ${g('bg-base', 60)};
  --fd-text: var(--dsw-alias-label-primary);
  --fd-dim: var(--dsw-alias-label-secondary);
  --fd-brand: var(--dsw-alias-brand-primary);
  --fd-ok: var(--dsw-alias-state-success-primary);
  --fd-warn: var(--dsw-alias-state-warn-primary);
  --fd-danger: var(--dsw-alias-state-error-primary);
  --fd-idle: var(--dsw-alias-state-idle-primary);
  flex: 1 1 auto; min-height: 0; min-width: 0;
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
  grid-auto-rows: 1fr;
  gap: 12px;
  padding: 12px;
  overflow: auto;
  color: var(--fd-text);
}

/* ============ 面板：玻璃卡 + 头/体 ============ */
.fd-panel {
  display: flex; flex-direction: column; min-width: 0; min-height: 0;
  padding: 14px; border-radius: 14px;
  border: 1px solid var(--fd-line);
  background: var(--fd-surface);
  backdrop-filter: blur(8px);
  -webkit-backdrop-filter: blur(8px);
  overflow: hidden;
  animation: fd-rise 180ms cubic-bezier(.22, .61, .36, 1) backwards;
  animation-delay: calc(var(--fd-i, 0) * 24ms);
  transition: border-color 180ms cubic-bezier(.22, .61, .36, 1);
}
.fd-panel:hover { border-color: var(--fd-line-strong); }
.fd-panel[data-span="all"] { grid-column: 1 / -1; }
.fd-panel-head {
  display: flex; align-items: baseline; gap: 8px; flex-wrap: wrap;
  margin-bottom: 10px; min-width: 0;
}
.fd-panel-title { font-size: 12px; font-weight: 600; letter-spacing: .02em; }
.fd-panel-hint { font-size: 11px; color: var(--fd-dim); }
.fd-panel-extra { margin-left: auto; font-size: 11px; color: var(--fd-dim); white-space: nowrap; }
.fd-panel-body { flex: 1 1 auto; min-height: 0; min-width: 0; display: flex; flex-direction: column; gap: 8px; }
.fd-scroll { overflow: auto; min-height: 0; }

/* ============ 色调：一律走 --fd-tone，不许写死颜色 ============ */
.fd-tone-brand { --fd-tone: var(--fd-brand); }
.fd-tone-ok { --fd-tone: var(--fd-ok); }
.fd-tone-warn { --fd-tone: var(--fd-warn); }
.fd-tone-danger { --fd-tone: var(--fd-danger); }
.fd-tone-idle { --fd-tone: var(--fd-idle); }

/* ============ KPI 气泡行：圆形色圈 + 大数字 + 标签 + 细进度条 ============ */
.fd-kpis {
  display: grid; grid-template-columns: repeat(auto-fit, minmax(148px, 1fr));
  gap: 10px; align-content: start;
}
.fd-kpi {
  display: flex; align-items: center; gap: 10px; min-width: 0;
  padding: 8px 10px; border-radius: 12px;
  background: var(--fd-sunken);
  border: 1px solid var(--fd-line);
}
.fd-kpi-bubble {
  flex: 0 0 auto; width: 54px; height: 54px; border-radius: 50%;
  display: inline-flex; align-items: center; justify-content: center;
  font-size: 17px; font-weight: 600; letter-spacing: -.02em;
  font-variant-numeric: tabular-nums;
  color: var(--fd-tone, var(--fd-brand));
  /* 参考站是 rounded-full + border-2 + bg-<色>/20 + 同色光晕 */
  background: color-mix(in oklab, var(--fd-tone, var(--fd-brand)) 20%, transparent);
  border: 2px solid color-mix(in oklab, var(--fd-tone, var(--fd-brand)) 45%, transparent);
  box-shadow: 0 0 20px color-mix(in oklab, var(--fd-tone, var(--fd-brand)) 28%, transparent);
}
.fd-kpi-main { display: flex; flex-direction: column; gap: 4px; min-width: 0; flex: 1 1 auto; }
.fd-kpi-label { font-size: 11px; color: var(--fd-dim); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.fd-kpi-note { font-size: 10px; color: var(--fd-dim); }
.fd-bar {
  display: block; position: relative; height: 4px; border-radius: 999px; overflow: hidden;
  background: ${g('border-l1', 35)};
}
.fd-bar > i {
  display: block; height: 100%; border-radius: inherit; width: 0;
  background: var(--fd-tone, var(--fd-brand));
  transition: width 260ms cubic-bezier(.22, .61, .36, 1);
}

/* ============ 状态 donut ============ */
.fd-donut { display: flex; align-items: center; gap: 14px; min-height: 0; }
.fd-donut-svg { flex: 0 0 auto; width: 132px; height: 132px; display: block; }
.fd-donut-track { fill: none; stroke: ${g('border-l1', 40)}; stroke-width: 12; }
.fd-donut-arc {
  fill: none; stroke-width: 12; stroke-linecap: butt;
  stroke: var(--fd-tone, var(--fd-idle));
  transition: stroke-dasharray 320ms cubic-bezier(.22, .61, .36, 1);
}
.fd-donut-center { fill: var(--fd-text); font-size: 20px; font-weight: 600; }
.fd-donut-caption { fill: var(--fd-dim); font-size: 10px; }
.fd-legend { display: flex; flex-direction: column; gap: 7px; min-width: 0; flex: 1 1 auto; }
.fd-legend-row { display: flex; align-items: center; gap: 8px; min-width: 0; font-size: 11px; }
.fd-legend-dot {
  flex: 0 0 8px; width: 8px; height: 8px; border-radius: 50%;
  background: var(--fd-tone, var(--fd-idle));
  box-shadow: 0 0 0 2px color-mix(in oklab, var(--fd-tone, var(--fd-idle)) 22%, transparent);
}
.fd-legend-label { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.fd-legend-value { margin-left: auto; color: var(--fd-dim); font-variant-numeric: tabular-nums; }
.fd-legend-pct { flex: 0 0 34px; text-align: right; font-variant-numeric: tabular-nums; }

/* ============ 横向条（项目分布 / 阻塞榜 / 关系概览） ============ */
.fd-list { display: flex; flex-direction: column; gap: 8px; min-height: 0; }
.fd-list-row { display: flex; align-items: center; gap: 8px; min-width: 0; font-size: 11px; }
.fd-list-label { flex: 0 0 84px; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--fd-dim); }
.fd-list-bar { flex: 1 1 auto; min-width: 24px; }
.fd-list-value { flex: 0 0 56px; text-align: right; font-variant-numeric: tabular-nums; }
.fd-list-meta { flex: 0 0 auto; font-size: 10px; color: var(--fd-dim); font-variant-numeric: tabular-nums; }
/* 叠加完成率：细条里再画一段更亮的 */
.fd-bar-split { display: block; position: relative; height: 8px; border-radius: 999px; overflow: hidden; background: ${g('border-l1', 30)}; }
.fd-bar-split > i { position: absolute; inset: 0 auto 0 0; background: color-mix(in oklab, var(--fd-tone, var(--fd-brand)) 55%, transparent); }
.fd-bar-split > b { position: absolute; inset: 0 auto 0 0; background: var(--fd-tone, var(--fd-brand)); border-radius: 999px; }

/* ============ 关系概览：四行 KV ============ */
.fd-kv { display: grid; grid-template-columns: repeat(auto-fit, minmax(110px, 1fr)); gap: 8px; }
.fd-kv-item {
  display: flex; flex-direction: column; gap: 2px; min-width: 0;
  padding: 8px 10px; border-radius: 10px;
  background: var(--fd-sunken); border: 1px solid var(--fd-line);
}
.fd-kv-label { font-size: 10px; color: var(--fd-dim); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.fd-kv-value { font-size: 16px; font-weight: 600; font-variant-numeric: tabular-nums; color: var(--fd-tone, var(--fd-text)); }
.fd-kv-hint { font-size: 10px; color: var(--fd-dim); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }

/* ============ 阻塞榜 / 最近动态：可点行 ============ */
.fd-item {
  display: flex; align-items: center; gap: 8px; min-width: 0; width: 100%;
  padding: 6px 8px; border-radius: 9px; text-align: left;
  font: inherit; font-size: 11px; color: var(--fd-text);
  background: transparent; border: 1px solid transparent; cursor: pointer;
  transition: background-color 180ms cubic-bezier(.22, .61, .36, 1), border-color 180ms cubic-bezier(.22, .61, .36, 1);
}
.fd-item:hover { background: var(--fd-surface-2); border-color: var(--fd-line); }
.fd-item:focus-visible { outline: none; border-color: color-mix(in oklab, var(--fd-tone, var(--fd-brand)) 55%, transparent); }
.fd-item-rank {
  flex: 0 0 18px; height: 18px; border-radius: 6px;
  display: inline-flex; align-items: center; justify-content: center;
  font-size: 10px; font-variant-numeric: tabular-nums;
  color: var(--fd-tone, var(--fd-brand));
  background: color-mix(in oklab, var(--fd-tone, var(--fd-brand)) 18%, transparent);
}
.fd-item-main { min-width: 0; flex: 1 1 auto; display: flex; flex-direction: column; gap: 1px; }
.fd-item-title { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.fd-item-sub { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 10px; color: var(--fd-dim); }
.fd-item-badge {
  flex: 0 0 auto; font-size: 10px; padding: 1px 6px; border-radius: 999px;
  color: var(--fd-tone, var(--fd-dim));
  background: color-mix(in oklab, var(--fd-tone, var(--fd-dim)) 16%, transparent);
  border: 1px solid color-mix(in oklab, var(--fd-tone, var(--fd-dim)) 32%, transparent);
}
.fd-live-dot {
  flex: 0 0 6px; width: 6px; height: 6px; border-radius: 50%;
  background: var(--fd-ok);
  box-shadow: 0 0 0 3px color-mix(in oklab, var(--fd-ok) 22%, transparent);
}

/* ============ 最近动态：三列小清单 ============ */
.fd-recent { display: grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); gap: 10px; min-height: 0; }
.fd-recent-col { display: flex; flex-direction: column; gap: 6px; min-width: 0; min-height: 0; }
.fd-recent-title { font-size: 10px; letter-spacing: .06em; text-transform: uppercase; color: var(--fd-dim); }
.fd-empty-line { font-size: 11px; color: var(--fd-dim); padding: 4px 0; }

/* ============ 空态 ============ */
.fd-empty {
  grid-column: 1 / -1; display: flex; flex-direction: column; align-items: center; justify-content: center;
  gap: 8px; padding: 40px 20px; text-align: center; color: var(--fd-dim);
}
.fd-empty-title { font-size: 14px; font-weight: 600; color: var(--fd-text); }
.fd-empty-body { font-size: 12px; max-width: 420px; }

/* ============ 入场 ============ */
@keyframes fd-rise {
  from { opacity: 0; transform: translateY(6px); }
  to { opacity: 1; transform: none; }
}

/* ==========================================================================
   运行页（fr-）：气泡墙 / 运行概览 / 会话活跃度 / 运行时长 / 需要人看一眼
   与 fd- 同一套令牌约束：零字面量颜色 + 只引用宿主那 14 个 --dsw-* 令牌。
   ========================================================================== */
.fr-page {
  --fr-line: ${g('border-l1', 55)};
  --fr-line-strong: ${g('border-l2', 70)};
  --fr-surface: ${g('bg-layer-1', 55)};
  --fr-surface-2: ${g('bg-layer-2', 50)};
  --fr-sunken: ${g('bg-base', 60)};
  --fr-text: var(--dsw-alias-label-primary);
  --fr-dim: var(--dsw-alias-label-secondary);
  --fr-brand: var(--dsw-alias-brand-primary);
  --fr-ok: var(--dsw-alias-state-success-primary);
  --fr-warn: var(--dsw-alias-state-warn-primary);
  --fr-danger: var(--dsw-alias-state-error-primary);
  --fr-idle: var(--dsw-alias-state-idle-primary);
  flex: 1 1 auto; min-height: 0; min-width: 0;
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
  grid-auto-rows: 1fr;
  gap: 12px;
  padding: 12px;
  overflow: auto;
  color: var(--fr-text);
}

/* 面板 */
.fr-panel {
  display: flex; flex-direction: column; min-width: 0; min-height: 0;
  padding: 14px; border-radius: 14px;
  border: 1px solid var(--fr-line);
  background: var(--fr-surface);
  backdrop-filter: blur(8px);
  -webkit-backdrop-filter: blur(8px);
  overflow: hidden;
  animation: fr-rise 180ms cubic-bezier(.22, .61, .36, 1) backwards;
  animation-delay: calc(var(--fr-i, 0) * 24ms);
  transition: border-color 180ms cubic-bezier(.22, .61, .36, 1);
}
.fr-panel:hover { border-color: var(--fr-line-strong); }
.fr-panel[data-span="all"] { grid-column: 1 / -1; }
.fr-panel-head { display: flex; align-items: baseline; gap: 8px; flex-wrap: wrap; margin-bottom: 10px; min-width: 0; }
.fr-panel-title { font-size: 12px; font-weight: 600; letter-spacing: .02em; }
.fr-panel-hint { font-size: 11px; color: var(--fr-dim); }
.fr-panel-extra { margin-left: auto; font-size: 11px; color: var(--fr-dim); white-space: nowrap; }
.fr-panel-body { flex: 1 1 auto; min-height: 0; min-width: 0; display: flex; flex-direction: column; gap: 8px; }
.fr-scroll { overflow: auto; min-height: 0; }

/* 色调 */
.fr-tone-success { --fr-tone: var(--fr-ok); }
.fr-tone-error { --fr-tone: var(--fr-danger); }
.fr-tone-warn { --fr-tone: var(--fr-warn); }
.fr-tone-idle { --fr-tone: var(--fr-idle); }
.fr-tone-brand { --fr-tone: var(--fr-brand); }

/* ============ 气泡群（复现参考图 AVAILABLE MODELS 那片星座式气泡） ============
   - 三档直径由组件内联 --fr-d 给（108 / 78 / 44，大 = 小的 2.45 倍 ≈ 参考图 2.5 倍）
   - 位置由 runsView.buildBubbleCloud 算好（确定性、两排交错、不重叠）
   - 活跃（运行中）= 半透明绿填充 + 亮绿边 + 外发光 + 呼吸；其余 = 深灰暗态 + 1px 浅白描边
   ============================================================================ */
.fr-cloud-wrap { display: flex; flex-direction: column; align-items: center; gap: 10px; min-height: 0; flex: 1 1 auto; overflow: auto; }
.fr-cloud-legend { display: flex; align-items: center; gap: 14px; flex-wrap: wrap; justify-content: center; font-size: 10px; color: var(--fr-dim); }
.fr-cloud-legend-item { display: inline-flex; align-items: center; gap: 5px; white-space: nowrap; }
.fr-cloud-legend-dot { border-radius: 50%; background: color-mix(in oklab, var(--dsw-alias-label-primary) 10%, transparent); border: 1px solid color-mix(in oklab, var(--dsw-alias-label-primary) 22%, transparent); }
.fr-cloud-legend-large { width: 14px; height: 14px; }
.fr-cloud-legend-medium { width: 10px; height: 10px; }
.fr-cloud-legend-small { width: 7px; height: 7px; }
.fr-cloud-legend-rule { color: color-mix(in oklab, var(--dsw-alias-label-secondary) 70%, transparent); }

.fr-cloud { position: relative; flex: 0 0 auto; margin: 0 auto; }

/* ============================================================================
 * 气泡墙（从参考项目 kp-z/open_adventure 直接搬：
 *   components/ClaudeModelBubbles.tsx 的 DASHBOARD_POSITIONS / LAYOUT
 *   + components/WaterLevel.tsx 的圆内水位）
 * 只把 Tailwind 类与字面量颜色换成我们的 fr- 类与宿主令牌，几何/动画时长/层级照抄。
 * ========================================================================== */
.fr-bubbles-wrap { display: flex; align-items: center; justify-content: center; padding: 2px 0 6px; }
/* 参考卡片：气泡上方的 eyebrow（text-[10px] uppercase tracking-widest）*/
.fr-bubbles-eyebrow {
  font-size: 10px; font-weight: 700; letter-spacing: .12em; text-transform: uppercase;
  color: color-mix(in oklab, var(--dsw-alias-label-secondary) 80%, transparent);
  margin-bottom: 6px;
}
/* 参考卡片底部两个小盒（Health Score / Status）：bg-white/5 + rounded-xl + p-3 */
.fr-bubbles-boxes { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-top: 8px; }
.fr-bubbles-box {
  display: flex; flex-direction: column; gap: 2px; padding: 10px 12px; border-radius: 12px;
  background: color-mix(in oklab, var(--dsw-alias-label-primary) 5%, transparent);
}
.fr-bubbles-box-label {
  font-size: 10px; font-weight: 700; letter-spacing: .1em; text-transform: uppercase;
  color: color-mix(in oklab, var(--dsw-alias-label-secondary) 80%, transparent);
}
.fr-bubbles-box-value { font-size: 20px; font-weight: 700; line-height: 1.1; color: var(--dsw-alias-label-primary); }
.fr-bubbles-box-value.is-brand { color: color-mix(in oklab, var(--dsw-alias-brand-primary) 90%, transparent); }
.fr-bubbles-box-value.is-ok { color: color-mix(in oklab, var(--dsw-alias-state-success-primary) 92%, transparent); }
/* 参考项目 dashboard-desktop：容器 h-24（96px），气泡在其中绝对定位 */
/* 参考项目这张卡在大屏只占 4 列里的 2 列（约 520px），气泡是在窄框里成簇的。
   我们这块面板是通的，所以给一个上限并居中，否则 8 个点会被摊到 1000+ px 上、失去「一簇」的感觉。 */
.fr-bubbles { position: relative; width: 100%; max-width: 560px; height: 96px; margin: 0 auto; }
.fr-bubble-slot { position: absolute; }
.fr-bubble-slot:hover { z-index: 20; }

/* 圆本体：rounded-full + border-2 + 从左上到右下的白色渐变（做出球面） */
.fr-bubble-orb {
  position: relative; display: block; width: 100%; height: 100%; padding: 0;
  border-radius: 999px; border: 2px solid transparent; overflow: visible;
  background:
    linear-gradient(to bottom right,
      color-mix(in oklab, var(--dsw-alias-label-primary) 8%, transparent),
      color-mix(in oklab, var(--dsw-alias-label-primary) 4%, transparent),
      transparent);
  cursor: pointer; transition: transform .3s ease, box-shadow .3s ease, border-color .3s ease;
}
.fr-bubble-orb:hover, .fr-bubble-orb.is-hovered { transform: scale(1.1); }

/* 运行中（参考项目的 available 绿泡）：绿边 + 两圈外发光 + 内发光 + 顶部 1px 高光 */
.fr-bubble-orb.is-running {
  border-color: color-mix(in oklab, var(--dsw-alias-state-success-primary) 55%, transparent);
  box-shadow:
    0 0 20px color-mix(in oklab, var(--dsw-alias-state-success-primary) 42%, transparent),
    0 0 40px color-mix(in oklab, var(--dsw-alias-state-success-primary) 22%, transparent),
    inset 0 0 30px color-mix(in oklab, var(--dsw-alias-state-success-primary) 16%, transparent),
    inset 0 1px 0 color-mix(in oklab, var(--dsw-alias-label-primary) 40%, transparent);
  animation: fr-orb-breathe 2.4s ease-in-out infinite;
}
/* 挂起：暗态 + 一点点 warn 边（不抢绿色） */
.fr-bubble-orb.is-suspended {
  border-color: color-mix(in oklab, var(--dsw-alias-state-warn-primary) 38%, transparent);
  box-shadow: inset 0 1px 0 color-mix(in oklab, var(--dsw-alias-label-primary) 18%, transparent);
}
/* 未开始 / 等待中（参考项目的 unavailable 灰泡）：1px 浅白边 + 内侧高光 */
.fr-bubble-orb.is-idle {
  border-width: 1px;
  border-color: color-mix(in oklab, var(--dsw-alias-label-primary) 15%, transparent);
  box-shadow: inset 0 1px 0 color-mix(in oklab, var(--dsw-alias-label-primary) 18%, transparent);
}

/* 球面高光：左上那团模糊白光（参考项目 top-[18%] left-[28%] w-[30%] h-[30%] blur-[3px]） */
.fr-orb-shine {
  position: absolute; top: 18%; left: 28%; width: 30%; height: 30%; border-radius: 999px;
  background: linear-gradient(to bottom right,
    color-mix(in oklab, var(--dsw-alias-label-primary) 72%, transparent),
    color-mix(in oklab, var(--dsw-alias-label-primary) 28%, transparent),
    transparent);
  filter: blur(2.5px); pointer-events: none;
}
/* 右下小亮点（参考项目 top-[12%] right-[22%] w-[18%] h-[18%] blur-[1px]） */
.fr-orb-spark {
  position: absolute; top: 12%; right: 22%; width: 18%; height: 18%; border-radius: 999px;
  background: color-mix(in oklab, var(--dsw-alias-label-primary) 30%, transparent);
  filter: blur(1px); pointer-events: none;
}

/* 圆内文字：参考项目 text-[8px] font-bold drop-shadow-lg leading-tight px-1 */
.fr-orb-label {
  position: absolute; inset: 0; z-index: 5; display: flex; align-items: center; justify-content: center;
  padding: 0 4px; text-align: center; line-height: 1.15; font-weight: 700;
  font-size: var(--fr-orb-label, 8px);
  color: color-mix(in oklab, var(--dsw-alias-label-primary) 96%, transparent);
  text-shadow: 0 1px 3px color-mix(in oklab, var(--dsw-alias-bg-base) 80%, transparent);
  pointer-events: none; word-break: break-word;
}

/* 圆内水位（WaterLevel.tsx）：两层 SVG 铺满圆 */
.fr-water-svg { position: absolute; inset: 0; width: 100%; height: 100%; z-index: 20; pointer-events: none; }
.fr-water-fill-svg { position: absolute; inset: 0; width: 100%; height: 100%; }
/* 水位颜色按「剩余量」分档（参考项目：≥50% 绿 / ≥10% 黄 / 其余红） */
.fr-water-svg.fr-tone-ok .fr-water-liquid { fill: color-mix(in oklab, var(--dsw-alias-state-success-primary) 34%, transparent); }
.fr-water-svg.fr-tone-ok .fr-water-wave { stroke: color-mix(in oklab, var(--dsw-alias-state-success-primary) 95%, transparent); }
.fr-water-svg.fr-tone-warn .fr-water-liquid { fill: color-mix(in oklab, var(--dsw-alias-state-warn-primary) 42%, transparent); }
.fr-water-svg.fr-tone-warn .fr-water-wave { stroke: color-mix(in oklab, var(--dsw-alias-state-warn-primary) 80%, transparent); }
.fr-water-svg.fr-tone-low .fr-water-liquid { fill: color-mix(in oklab, var(--dsw-alias-state-error-primary) 42%, transparent); }
.fr-water-svg.fr-tone-low .fr-water-wave { stroke: color-mix(in oklab, var(--dsw-alias-state-error-primary) 80%, transparent); }

/* hover 浮层：参考项目的说明卡 + 小三角（气泡上方居中） */
.fr-orb-tip {
  position: absolute; left: 50%; bottom: 100%; z-index: 30;
  transform: translateX(-50%); margin-bottom: 8px;
  display: flex; flex-direction: column; gap: 2px;
  padding: 8px 10px; border-radius: 8px; white-space: nowrap;
  background: color-mix(in oklab, var(--dsw-alias-bg-overlay) 96%, transparent);
  border: 1px solid color-mix(in oklab, var(--dsw-alias-border-l1) 70%, transparent);
  box-shadow: 0 8px 24px color-mix(in oklab, var(--dsw-alias-bg-base) 70%, transparent);
  pointer-events: none;
}
.fr-orb-tip-name { font-weight: 700; font-size: 10px; color: var(--dsw-alias-label-primary); }
.fr-orb-tip-meta { font-size: 9px; color: var(--dsw-alias-label-secondary); }
.fr-orb-tip-hint { font-size: 8px; color: color-mix(in oklab, var(--dsw-alias-brand-primary) 85%, transparent); }

/* 漂浮：参考项目 @keyframes float 原样搬（-8/-4/-10px，横向 +3/-3/+2px） */
@keyframes fr-float {
  0%, 100% { transform: translateY(0) translateX(0); }
  25% { transform: translateY(-8px) translateX(3px); }
  50% { transform: translateY(-4px) translateX(-3px); }
  75% { transform: translateY(-10px) translateX(2px); }
}
@keyframes fr-orb-breathe {
  0%, 100% { box-shadow:
    0 0 20px color-mix(in oklab, var(--dsw-alias-state-success-primary) 42%, transparent),
    0 0 40px color-mix(in oklab, var(--dsw-alias-state-success-primary) 22%, transparent),
    inset 0 0 30px color-mix(in oklab, var(--dsw-alias-state-success-primary) 16%, transparent); }
  50% { box-shadow:
    0 0 28px color-mix(in oklab, var(--dsw-alias-state-success-primary) 55%, transparent),
    0 0 56px color-mix(in oklab, var(--dsw-alias-state-success-primary) 30%, transparent),
    inset 0 0 36px color-mix(in oklab, var(--dsw-alias-state-success-primary) 22%, transparent); }
}
.fr-bubble-item { position: absolute; }
.fr-bubble {
  position: relative;
  width: var(--fr-d, 78px); height: var(--fr-d, 78px);
  display: inline-flex; align-items: center; justify-content: center;
  border-radius: 50%; font: inherit; cursor: pointer; overflow: hidden;
  /* 深灰暗态（非活跃）：半透明底 + 1px 极细浅白描边 + 浅灰字 */
  background: color-mix(in oklab, var(--dsw-alias-bg-layer-2) 55%, transparent);
  border: 1px solid color-mix(in oklab, var(--dsw-alias-label-primary) 10%, transparent);
  color: var(--dsw-alias-label-secondary);
  transition: transform 160ms cubic-bezier(.22, .61, .36, 1), border-color 160ms cubic-bezier(.22, .61, .36, 1), box-shadow 160ms cubic-bezier(.22, .61, .36, 1);
}
.fr-bubble:hover { transform: translateY(-2px) scale(1.03); border-color: color-mix(in oklab, var(--dsw-alias-label-primary) 22%, transparent); }
.fr-bubble:focus-visible { outline: none; border-color: color-mix(in oklab, var(--dsw-alias-state-success-primary) 70%, transparent); }
/* 活跃：半透明绿 + 亮绿边 + 外发光晕（blur 20~30）+ 中心略亮的球感 */
.fr-bubble.is-running {
  --fr-tone: var(--dsw-alias-state-success-primary);
  color: var(--dsw-alias-label-primary);
  background:
    radial-gradient(circle at 50% 36%,
      color-mix(in oklab, var(--dsw-alias-state-success-primary) 30%, transparent),
      color-mix(in oklab, var(--dsw-alias-state-success-primary) 12%, transparent));
  border: 1px solid color-mix(in oklab, var(--dsw-alias-state-success-primary) 50%, transparent);
  box-shadow: 0 0 24px color-mix(in oklab, var(--dsw-alias-state-success-primary) 40%, transparent);
  animation: fr-breathe 2.4s ease-in-out infinite;
}
/* 挂起：仍是暗态，只给一点点 warn 边区分（不抢绿色） */
.fr-bubble.is-paused:not(.is-running) { border-color: color-mix(in oklab, var(--dsw-alias-state-warn-primary) 35%, transparent); }
.fr-bubble.is-selected {
  border-color: color-mix(in oklab, var(--fr-tone, var(--dsw-alias-brand-primary)) 85%, transparent);
  box-shadow: 0 0 0 3px color-mix(in oklab, var(--fr-tone, var(--dsw-alias-brand-primary)) 22%, transparent);
}
.fr-bubble-num {
  font-size: 11px; font-weight: 600; line-height: 1.15;
  font-variant-numeric: tabular-nums; letter-spacing: -.01em;
  max-width: 78%; text-align: center; word-break: break-all;
}
/* 三档字号：小 11 / 中 12 / 大 13（参考图圆内文字 11~13px） */
.fr-bubble-medium .fr-bubble-num { font-size: 12px; }
.fr-bubble-large .fr-bubble-num { font-size: 13px; }
/* 「打开会话」：平时隐起，hover/focus 才出现在右下角（圆外不挂常驻小字） */
.fr-bubble-go {
  position: absolute; right: -2px; bottom: -2px;
  width: 18px; height: 18px; border-radius: 50%;
  display: inline-flex; align-items: center; justify-content: center;
  font: inherit; font-size: 10px; line-height: 1;
  color: var(--fr-text); background: var(--fr-surface-2); cursor: pointer;
  border: 1px solid var(--fr-line);
  opacity: 0; pointer-events: none;
  transition: opacity 140ms cubic-bezier(.22, .61, .36, 1);
}
.fr-bubble-item:hover .fr-bubble-go, .fr-bubble-item:focus-within .fr-bubble-go { opacity: 1; pointer-events: auto; }
.fr-bubble-go:disabled { opacity: .45; cursor: not-allowed; }

@keyframes fr-breathe {
  0%, 100% { box-shadow: 0 0 20px color-mix(in oklab, var(--fr-tone, var(--dsw-alias-state-success-primary)) 32%, transparent); }
  50% { box-shadow: 0 0 30px color-mix(in oklab, var(--fr-tone, var(--dsw-alias-state-success-primary)) 50%, transparent); }
}
@keyframes fr-rise {
  from { opacity: 0; transform: translateY(6px); }
  to { opacity: 1; transform: none; }
}

/* fr- 子树统一 border-box：水位条 16px / 圆球 64px 都要是「含边框的实数」 */
.fr-page, .fr-page * { box-sizing: border-box; }
/* 水位 hero：16px 的「空气泡水位」（参考站 h-4 那条） */
.fr-level { display: flex; flex-direction: column; gap: 6px; margin-bottom: 12px; }
.fr-level-head { display: flex; align-items: baseline; justify-content: space-between; gap: 8px; min-width: 0; }
.fr-level-value { font-size: 11px; color: var(--fr-dim); font-variant-numeric: tabular-nums; white-space: nowrap; }

/* 顶部 KPI 行：圆球 + eyebrow + 数值 + 迷你水位条（adventure 首页形制） */
.fr-kpis { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 10px; align-content: start; }
.fr-kpi {
  display: flex; align-items: center; gap: 12px; min-width: 0;
  padding: 10px 12px; border-radius: 14px;
  background: var(--fr-sunken); border: 1px solid var(--fr-line);
}
.fr-kpi-ball {
  flex: 0 0 auto; width: 64px; height: 64px; border-radius: 50%;
  display: inline-flex; align-items: center; justify-content: center;
  font-size: 20px; font-weight: 600; font-variant-numeric: tabular-nums; letter-spacing: -.02em;
  color: var(--fr-tone, var(--fr-brand));
  background: color-mix(in oklab, var(--fr-tone, var(--fr-brand)) 20%, transparent);
  border: 2px solid color-mix(in oklab, var(--fr-tone, var(--fr-brand)) 55%, transparent);
  box-shadow: 0 0 20px color-mix(in oklab, var(--fr-tone, var(--fr-brand)) 28%, transparent);
}
.fr-kpi-ball.is-running { animation: fr-breathe 2.4s ease-in-out infinite; }
.fr-kpi-body { display: flex; flex-direction: column; gap: 4px; min-width: 0; flex: 1 1 auto; }
.fr-kpi-eyebrow {
  font-size: 10px; font-weight: 600; letter-spacing: .14em; text-transform: uppercase;
  color: var(--fr-tone, var(--fr-brand));
}
.fr-kpi-label { font-size: 12px; font-weight: 600; color: var(--fr-text); }
.fr-kpi-hint { font-size: 10px; color: var(--fr-dim); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }

/* ============ 空气泡水位条（复现 BaseView.tsx:87-97 的经验值条） ============ */
.fr-water {
  position: relative; width: 100%; height: 16px; border-radius: 999px; overflow: hidden;
  background: color-mix(in oklab, var(--dsw-alias-bg-base) 62%, transparent);
  border: 1px solid color-mix(in oklab, var(--dsw-alias-border-l1) 55%, transparent);
}
.fr-water-sm { height: 8px; }
.fr-water-fill {
  position: absolute; top: 0; bottom: 0; left: 0;
  width: var(--fr-water-pct, 0%); border-radius: 999px;
  /* 三段：左/中/右三个色标（中间那道换色相），与参考站 from-via-to 同构 */
  background: linear-gradient(90deg,
    color-mix(in oklab, var(--dsw-alias-brand-primary) 85%, transparent),
    color-mix(in oklab, var(--dsw-alias-state-warn-primary) 92%, transparent),
    color-mix(in oklab, var(--fr-tone, var(--dsw-alias-brand-primary)) 80%, transparent));
  /* 入场动画用 transform 缩放，**宽度本身只由 --fr-water-pct 决定**：
     把 var() 写进 @keyframes 的 width 里在 Chrome 上会解析成 fallback 0%，
     结果动画结束后水位条永远是空的（真机实测 0px，去掉动画才变回 50%）。 */
  transform-origin: left center;
  animation: fr-water-rise 1s cubic-bezier(.22, .61, .36, 1) both;
  animation-delay: .3s;
}
.fr-water-shine {
  position: absolute; inset: 0; border-radius: inherit;
  background: linear-gradient(90deg, transparent,
    color-mix(in oklab, var(--dsw-alias-label-primary) 30%, transparent), transparent);
  animation: fr-water-shine 2.4s ease-in-out infinite;
}
@keyframes fr-water-rise { from { transform: scaleX(0); } to { transform: scaleX(1); } }
@keyframes fr-water-shine {
  0%, 100% { transform: translateX(-70%); opacity: .35; }
  50% { transform: translateX(70%); opacity: 1; }
}

/* ============ 执行历史风格列表：头像块 + 状态点 + 标题 + 编号·时间 + 详情 ============ */
.fr-rows { display: flex; flex-direction: column; gap: 8px; min-height: 0; }
.fr-row {
  display: flex; align-items: center; justify-content: space-between; gap: 12px;
  min-width: 0; padding: 10px 12px; border-radius: 12px;
  background: var(--fr-surface-2); border: 1px solid transparent;
  transition: background-color 160ms cubic-bezier(.22, .61, .36, 1), border-color 160ms cubic-bezier(.22, .61, .36, 1);
}
.fr-row:hover { border-color: var(--fr-line); background: color-mix(in oklab, var(--dsw-alias-bg-layer-2) 70%, transparent); }
.fr-avatar {
  position: relative; flex: 0 0 auto; width: 40px; height: 40px; border-radius: 10px;
  display: inline-flex; align-items: center; justify-content: center;
  color: var(--fr-tone, var(--fr-brand));
  background: color-mix(in oklab, var(--fr-tone, var(--fr-brand)) 16%, transparent);
  border: 1px solid var(--fr-line);
}
.fr-avatar-glyph { font-size: 12px; font-weight: 600; font-variant-numeric: tabular-nums; }
.fr-avatar-dot {
  position: absolute; right: -3px; bottom: -3px; width: 10px; height: 10px; border-radius: 50%;
  background: var(--fr-tone, var(--fr-idle));
  border: 2px solid var(--dsw-alias-bg-base);
}
.fr-avatar-dot.is-running { animation: fr-breathe 2.4s ease-in-out infinite; }
.fr-row-main { display: flex; flex-direction: column; gap: 2px; min-width: 0; flex: 1 1 auto; }
.fr-row-title { font-size: 12px; color: var(--fr-text); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.fr-row-meta { font-size: 10px; letter-spacing: .06em; text-transform: uppercase; color: var(--fr-dim); font-variant-numeric: tabular-nums; }
.fr-row-action {
  flex: 0 0 auto; font: inherit; font-size: 11px; cursor: pointer;
  padding: 4px 10px; border-radius: 8px;
  color: var(--fr-text); background: transparent;
  border: 1px solid var(--fr-line);
  transition: border-color 160ms cubic-bezier(.22, .61, .36, 1), background-color 160ms cubic-bezier(.22, .61, .36, 1);
}
.fr-row-action:hover { border-color: var(--fr-line-strong); background: var(--fr-surface); }

/* ============ 双列小块（活跃度 / 时长） ============ */
.fr-split { display: grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); gap: 14px; min-height: 0; }
.fr-split-col { display: flex; flex-direction: column; gap: 6px; min-width: 0; min-height: 0; }
.fr-mini-head { font-size: 10px; color: var(--fr-dim); }
.fr-mini-list { display: flex; flex-direction: column; gap: 7px; min-height: 0; }
.fr-mini-row {
  display: flex; align-items: center; gap: 8px; min-width: 0;
  padding: 4px 6px; border-radius: 8px;
  font: inherit; font-size: 11px; color: var(--fr-text); text-align: left;
  background: transparent; border: 1px solid transparent;
}
.fr-mini-row-btn { cursor: pointer; }
.fr-mini-row-btn:hover { background: var(--fr-surface-2); border-color: var(--fr-line); }
.fr-mini-label { flex: 0 0 88px; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.fr-mini-bar { flex: 1 1 auto; min-width: 32px; display: flex; }
.fr-mini-value { flex: 0 0 auto; font-size: 10px; color: var(--fr-dim); font-variant-numeric: tabular-nums; }

/* 横向条 */
.fr-list { display: flex; flex-direction: column; gap: 8px; min-height: 0; }
.fr-list-row { display: flex; align-items: center; gap: 8px; min-width: 0; font-size: 11px; }
.fr-list-label { flex: 0 0 62px; color: var(--fr-dim); white-space: nowrap; }
.fr-list-bar { flex: 1 1 auto; min-width: 24px; }
.fr-list-value { flex: 0 0 28px; text-align: right; font-variant-numeric: tabular-nums; }
.fr-list-meta { flex: 0 0 auto; font-size: 10px; color: var(--fr-dim); }
.fr-bar { display: block; position: relative; height: 6px; border-radius: 999px; overflow: hidden; background: ${g('border-l1', 35)}; }
.fr-bar > i { display: block; height: 100%; border-radius: inherit; background: var(--fr-tone, var(--fr-brand)); transition: width 260ms cubic-bezier(.22, .61, .36, 1); }

/* 可点行（时长 Top5 / 告警） */
.fr-item {
  display: flex; align-items: center; gap: 8px; min-width: 0; width: 100%;
  padding: 6px 8px; border-radius: 9px; text-align: left;
  font: inherit; font-size: 11px; color: var(--fr-text);
  background: transparent; border: 1px solid transparent; cursor: pointer;
  transition: background-color 160ms cubic-bezier(.22, .61, .36, 1), border-color 160ms cubic-bezier(.22, .61, .36, 1);
}
.fr-item:hover { background: var(--fr-surface-2); border-color: var(--fr-line); }
.fr-item:focus-visible { outline: none; border-color: color-mix(in oklab, var(--fr-tone, var(--fr-brand)) 55%, transparent); }
.fr-item-main { min-width: 0; flex: 1 1 auto; display: flex; flex-direction: column; gap: 1px; }
.fr-item-title { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.fr-item-sub { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 10px; color: var(--fr-dim); }
.fr-item-bar { flex: 0 0 56px; }
.fr-item-value { flex: 0 0 auto; font-size: 10px; color: var(--fr-dim); font-variant-numeric: tabular-nums; }
.fr-item-badge {
  flex: 0 0 auto; font-size: 10px; padding: 1px 6px; border-radius: 999px;
  color: var(--fr-tone, var(--fr-dim));
  background: color-mix(in oklab, var(--fr-tone, var(--fr-dim)) 16%, transparent);
  border: 1px solid color-mix(in oklab, var(--fr-tone, var(--fr-dim)) 32%, transparent);
}
.fr-alert-list { display: flex; flex-direction: column; gap: 6px; min-height: 0; }

/* 空态 */
.fr-empty {
  grid-column: 1 / -1; display: flex; flex-direction: column; align-items: center; justify-content: center;
  gap: 8px; padding: 40px 20px; text-align: center; color: var(--fr-dim);
}
.fr-empty-title { font-size: 14px; font-weight: 600; color: var(--fr-text); }
.fr-empty-body { font-size: 12px; max-width: 420px; }
.fr-empty-line { font-size: 11px; color: var(--fr-dim); padding: 4px 0; }

/* ============ 尊重系统「减少动态效果」 ============ */
/* 减少动效：一律 !important —— 不能靠「块在文件最后 + 同特异度」生效，
   否则以后任何追加的动画规则（或特异度更高的选择器）会静默压过它（复核 R3）。
   与 styles.js 的 fo- 段同一口径。 */
@media (prefers-reduced-motion: reduce) {
  .fd-panel, .fr-panel { animation: none !important; }
  .fd-bar > i, .fd-bar-split > i, .fd-bar-split > b, .fd-donut-arc, .fr-bar > i { transition: none !important; }
  /* 用户口径：只在系统允许动效时才呼吸 */
  .fr-bubble.is-running, .fr-kpi-ball.is-running, .fr-avatar-dot.is-running { animation: none !important; }
  /* 水位条：入场动画关掉后宽度直接落位（width 变量），横扫高光也停 */
  .fr-water-fill, .fr-water-shine { animation: none !important; }
  .fr-bubble:hover { transform: none !important; }
  /* 气泡墙：漂浮与呼吸都停，避免前庭敏感用户看到一直晃的元素 */
  .fr-bubble-slot { animation: none !important; }
  .fr-bubble-orb.is-running { animation: none !important; }
  .fr-bubble-orb:hover, .fr-bubble-orb.is-hovered { transform: none !important; }
}
`

/** 幂等注入：宿主文档里已有同 id 的 <style> 就不重复插。 */
export function injectStyles(doc) {
  const d = doc && typeof doc.createElement === 'function' ? doc : (typeof document === 'undefined' ? null : document)
  if (!d || typeof d.getElementById !== 'function') return false
  if (d.getElementById(STYLE_ID)) return false
  const el = d.createElement('style')
  el.id = STYLE_ID
  el.textContent = CSS
  const host = d.head || d.documentElement
  if (!host) return false
  host.appendChild(el)
  return true
}

export default CSS
