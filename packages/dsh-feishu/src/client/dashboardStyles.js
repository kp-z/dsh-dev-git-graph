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

/* 分组：运行中 / 等待 / 阻塞 / 挂起 / 已完成 / 未开始 */
.fr-groups { display: flex; flex-direction: column; gap: 14px; }
.fr-group { display: flex; flex-direction: column; gap: 8px; min-width: 0; }
.fr-group-head { display: flex; align-items: center; gap: 6px; }
.fr-group-dot { width: 7px; height: 7px; border-radius: 50%; background: var(--fr-tone, var(--fr-idle)); }
.fr-group-title { font-size: 11px; font-weight: 600; letter-spacing: .04em; color: var(--fr-dim); text-transform: uppercase; }
.fr-group-count {
  font-size: 10px; padding: 0 6px; border-radius: 999px; font-variant-numeric: tabular-nums;
  color: var(--fr-tone, var(--fr-dim));
  background: color-mix(in oklab, var(--fr-tone, var(--fr-dim)) 16%, transparent);
}
.fr-wall { display: flex; flex-wrap: wrap; gap: 14px 12px; align-items: flex-start; }

/* 气泡：圆形 + 2px 描边 + 20% 底 + 同色光晕（参考站 rounded-full/border-2/bg-20/shadow） */
.fr-bubble-item { display: flex; flex-direction: column; align-items: center; gap: 6px; width: 96px; min-width: 0; }
.fr-bubble {
  position: relative;
  width: var(--fr-size, 64px); height: var(--fr-size, 64px);
  flex: 0 0 auto;
  display: inline-flex; align-items: center; justify-content: center;
  border-radius: 50%;
  font: inherit; cursor: pointer;
  color: var(--fr-tone, var(--fr-idle));
  background: color-mix(in oklab, var(--fr-tone, var(--fr-idle)) 20%, transparent);
  border: 2px solid color-mix(in oklab, var(--fr-tone, var(--fr-idle)) 50%, transparent);
  box-shadow: 0 0 20px color-mix(in oklab, var(--fr-tone, var(--fr-idle)) 26%, transparent);
  transition: transform 160ms cubic-bezier(.22, .61, .36, 1), border-color 160ms cubic-bezier(.22, .61, .36, 1);
}
.fr-bubble:hover { transform: translateY(-2px) scale(1.03); border-color: color-mix(in oklab, var(--fr-tone, var(--fr-idle)) 80%, transparent); }
.fr-bubble:focus-visible { outline: none; border-color: color-mix(in oklab, var(--fr-tone, var(--fr-idle)) 85%, transparent); }
.fr-bubble.is-selected {
  border-color: var(--fr-tone, var(--fr-brand));
  box-shadow: 0 0 0 4px color-mix(in oklab, var(--fr-tone, var(--fr-brand)) 22%, transparent), 0 0 24px color-mix(in oklab, var(--fr-tone, var(--fr-brand)) 40%, transparent);
}
.fr-bubble.is-idle { border-style: dashed; }
.fr-bubble-num { font-size: 15px; font-weight: 600; font-variant-numeric: tabular-nums; letter-spacing: -.01em; }
/* 呼吸：运行中才有（用户口径：在跑就是绿色 + 呼吸） */
.fr-bubble.is-running { animation: fr-breathe 2.4s ease-in-out infinite; }
.fr-bubble-pulse {
  position: absolute; inset: -5px; border-radius: 50%;
  border: 2px solid color-mix(in oklab, var(--fr-tone, var(--fr-ok)) 45%, transparent);
  animation: fr-ping 2.4s ease-out infinite;
  pointer-events: none;
}
@keyframes fr-breathe {
  0%, 100% { box-shadow: 0 0 20px color-mix(in oklab, var(--fr-tone, var(--fr-ok)) 26%, transparent); }
  50% { box-shadow: 0 0 30px color-mix(in oklab, var(--fr-tone, var(--fr-ok)) 50%, transparent); }
}
@keyframes fr-ping {
  0% { transform: scale(.94); opacity: .85; }
  70% { transform: scale(1.25); opacity: 0; }
  100% { transform: scale(1.25); opacity: 0; }
}
@keyframes fr-rise {
  from { opacity: 0; transform: translateY(6px); }
  to { opacity: 1; transform: none; }
}

/* 气泡下方：标题（两行截断）+ 项目名 + 时长 */
.fr-bubble-caption { display: flex; flex-direction: column; gap: 1px; width: 100%; min-width: 0; text-align: center; }
.fr-bubble-title {
  font-size: 12px; line-height: 1.25; color: var(--fr-text);
  display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical;
  overflow: hidden; word-break: break-word;
}
.fr-bubble-meta { display: flex; align-items: center; justify-content: center; gap: 4px; font-size: 10px; color: var(--fr-dim); min-width: 0; }
.fr-bubble-ws { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.fr-bubble-time { flex: 0 0 auto; font-variant-numeric: tabular-nums; }
.fr-bubble-go {
  align-self: center; margin-top: 1px;
  font: inherit; font-size: 10px; line-height: 1;
  padding: 2px 6px; border-radius: 999px; cursor: pointer;
  color: var(--fr-dim); background: transparent;
  border: 1px solid var(--fr-line);
}
.fr-bubble-go:not(:disabled):hover { color: var(--fr-text); border-color: var(--fr-line-strong); background: var(--fr-surface-2); }
.fr-bubble-go:disabled { opacity: .45; cursor: not-allowed; }

/* 运行概览：四个气泡式计数卡 */
.fr-stats { display: grid; grid-template-columns: repeat(auto-fit, minmax(132px, 1fr)); gap: 10px; align-content: start; }
.fr-stat {
  display: flex; align-items: center; gap: 10px; min-width: 0;
  padding: 8px 10px; border-radius: 12px;
  background: var(--fr-sunken); border: 1px solid var(--fr-line);
}
.fr-stat-ring {
  flex: 0 0 auto; width: 46px; height: 46px; border-radius: 50%;
  display: inline-flex; align-items: center; justify-content: center;
  font-size: 16px; font-weight: 600; font-variant-numeric: tabular-nums;
  color: var(--fr-tone, var(--fr-brand));
  background: color-mix(in oklab, var(--fr-tone, var(--fr-brand)) 20%, transparent);
  border: 2px solid color-mix(in oklab, var(--fr-tone, var(--fr-brand)) 45%, transparent);
  box-shadow: 0 0 18px color-mix(in oklab, var(--fr-tone, var(--fr-brand)) 24%, transparent);
}
.fr-stat-ring.is-running { animation: fr-breathe 2.4s ease-in-out infinite; }
.fr-stat-main { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
.fr-stat-label { font-size: 11px; color: var(--fr-text); white-space: nowrap; }
.fr-stat-hint { font-size: 10px; color: var(--fr-dim); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }

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

/* 窄屏：气泡收到 56px（用户口径 64 / 窄屏 56） */
@media (max-width: 780px) {
  .fr-bubble { width: 56px; height: 56px; }
  .fr-bubble-num { font-size: 13px; }
  .fr-bubble-item { width: 84px; }
}

/* ============ 尊重系统「减少动态效果」 ============ */
@media (prefers-reduced-motion: reduce) {
  .fd-panel, .fr-panel { animation: none; }
  .fd-bar > i, .fd-bar-split > i, .fd-bar-split > b, .fd-donut-arc, .fr-bar > i { transition: none; }
  /* 用户口径：只在系统允许动效时才呼吸 */
  .fr-bubble.is-running, .fr-stat-ring.is-running, .fr-bubble-pulse { animation: none; }
  .fr-bubble:hover { transform: none; }
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
