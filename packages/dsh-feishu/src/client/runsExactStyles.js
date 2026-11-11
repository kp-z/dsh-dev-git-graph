/**
 * 运行页「照抄参考项目」的样式表（<style id="dsh-feishu-runs-exact-style">）。
 *
 * ⚠️ 这一份**故意不遵守**「只用 14 个宿主令牌 / 零字面量颜色」那条红线。
 *
 * 原因：用户口径是「整个风格都不对……卡片的颜色估计要和参考项目完全一致」，而参考项目
 * （kp-z/open_adventure 的 `pages/Dashboard.tsx` + `components/GlassCard` + `ClaudeModelBubbles`
 * + `WaterLevel`）是一套固定的深色玻璃拟态皮肤：`bg-white/5`、`border-white/10`、
 * `rounded-2xl`、`backdrop-blur-md`、绿泡 `rgba(34,197,94,.4)` 光晕……
 * 用令牌调出来的永远是「像」，不是「一样」。所以这一张表按 Tailwind 的**原始取值**逐条抄下来，
 * 并且：
 *   1. 所有选择器都以 `.frx-` 开头（不会污染宿主，也不会和令牌版 `fr-` 混掉）；
 *   2. 只被运行页使用，其它页面继续走令牌；
 *   3. 独立的 style id，卸载时整块移除。
 *
 * 换句话说：**红线收敛到「不污染宿主」**，颜色保真优先（用户口径优先于我们的内部约定）。
 */

export const STYLE_ID = 'dsh-feishu-runs-exact-style'

export const CSS = `
/* ---------- 页面骨架（Dashboard.tsx 的 space-y-8 + 4 列网格） ---------- */
.frx-page {
  container-type: inline-size;
  container-name: frxpage;
  display: flex; flex-direction: column; gap: 24px;
  /* 侧边栏（rail）与卡片之间要留出呼吸位：左右各 20px + 上下 16/28px，
     否则卡片会贴着 rail 的边线，看起来像「挤在一起」。 */
  padding: 16px 20px 28px;
  color: var(--frx-text);

  /* 表面/文字/描边一律**从宿主令牌派生**：亮色深色自动跟着变，不需要我自己判断主题
     （上一版把文字色写死成浅灰，亮色模式下就是「浅灰字压白底」——用户实测反馈的问题）。
     只有气泡的品牌绿/蓝光晕保留参考项目的原始色值：那是语义色，亮暗两种模式下都成立。 */
  --frx-text: var(--dsw-alias-label-primary);
  --frx-text-strong: color-mix(in oklab, var(--dsw-alias-label-primary) 94%, transparent);
  --frx-text-dim: color-mix(in oklab, var(--dsw-alias-label-secondary) 92%, transparent);
  --frx-text-faint: color-mix(in oklab, var(--dsw-alias-label-secondary) 75%, transparent);
  --frx-surface: color-mix(in oklab, var(--dsw-alias-bg-layer-1) 82%, transparent);
  --frx-surface-hover: color-mix(in oklab, var(--dsw-alias-bg-layer-2) 92%, transparent);
  --frx-border: color-mix(in oklab, var(--dsw-alias-border-l1) 62%, transparent);
  --frx-border-hover: var(--dsw-alias-border-l2);
  --frx-inner: color-mix(in oklab, var(--dsw-alias-bg-layer-2) 70%, transparent);
  --frx-orb-bg-1: color-mix(in oklab, var(--dsw-alias-label-primary) 9%, transparent);
  --frx-orb-bg-2: color-mix(in oklab, var(--dsw-alias-label-primary) 4%, transparent);
  --frx-orb-dim-border: color-mix(in oklab, var(--dsw-alias-label-secondary) 40%, transparent);
  --frx-avatar-border: color-mix(in oklab, var(--dsw-alias-border-l1) 80%, transparent);
  --frx-avatar-bg: color-mix(in oklab, var(--dsw-alias-bg-layer-2) 60%, transparent);
  --frx-avatar-ring: var(--dsw-alias-bg-base);
  --frx-tip-bg: var(--dsw-alias-bg-overlay);
  --frx-tip-fg: var(--dsw-alias-label-primary);
  --frx-tip-meta: var(--dsw-alias-label-secondary);
  --frx-shadow: 0 1px 2px color-mix(in oklab, var(--dsw-alias-bg-base) 22%, transparent), 0 10px 22px -16px color-mix(in oklab, var(--dsw-alias-bg-base) 60%, transparent);
  --frx-scrollbar: color-mix(in oklab, var(--dsw-alias-label-secondary) 30%, transparent);
  /* 参考项目：lg:[--dashboard-row-h:clamp(320px,calc((100vh-220px)/3),520px)] */
  --frx-row-h: clamp(320px, calc((100vh - 220px) / 3), 520px);
}
.frx-header { display: flex; flex-direction: column; gap: 6px; padding-bottom: 4px; }
.frx-title {
  margin: 0; font-size: 20px; line-height: 1.1; font-weight: 700; letter-spacing: -0.01em; color: #f9fafb;
}
.frx-subtitle { margin: 0; font-size: 12px; line-height: 1.5; color: var(--frx-text-dim); }

/* ---------- 卡片（GlassCard：bg-white/5 + backdrop-blur-md + border-white/10 + rounded-2xl + p-6 + shadow-xl） ---------- */
.frx-grid {
  display: grid; grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 24px; align-items: stretch;
  height: var(--frx-row-h);
}
.frx-grid.is-tight { height: auto; }
.frx-card {
  position: relative; overflow: hidden; display: flex; flex-direction: column;
  padding: 20px; border-radius: 14px; cursor: default;
  background: var(--frx-surface);
  -webkit-backdrop-filter: blur(12px); backdrop-filter: blur(12px);
  border: 1px solid var(--frx-border);
  box-shadow: var(--frx-shadow);
  transition: border-color .3s ease, transform .3s ease;
}
.frx-card:hover { border-color: var(--frx-border-hover); }
.frx-card.is-span2 { grid-column: span 2; }
.frx-card.is-half-row { height: calc((var(--frx-row-h) - 24px) / 2); }
/* 参考项目卡片内那层 hover 才出现的蓝紫渐变 */
.frx-card-glow {
  position: absolute; inset: 0; pointer-events: none; opacity: 0;
  background: linear-gradient(to bottom right, rgba(59, 130, 246, 0.05), rgba(168, 85, 247, 0.05));
  transition: opacity .3s ease;
}
.frx-card:hover .frx-card-glow { opacity: 1; }
.frx-card-inner { position: relative; z-index: 10; display: flex; flex-direction: column; height: 100%; }

/* ---------- 卡片头（图标块 + 标题 + 版本 / 设置按钮） ---------- */
.frx-card-head { display: flex; align-items: flex-start; justify-content: space-between; margin-bottom: 24px; gap: 12px; }
.frx-card-head-left { display: flex; align-items: center; gap: 12px; min-width: 0; }
.frx-icon {
  width: 48px; height: 48px; border-radius: 12px; flex: 0 0 auto;
  display: flex; align-items: center; justify-content: center;
}
.frx-icon.is-ok { background: rgba(34, 197, 94, 0.2); border: 1px solid rgba(34, 197, 94, 0.5); color: #22c55e; }
.frx-icon.is-idle { background: rgba(156, 163, 175, 0.15); border: 1px solid rgba(156, 163, 175, 0.4); color: #9ca3af; }
.frx-icon.is-brand { background: rgba(59, 130, 246, 0.2); border: 1px solid rgba(59, 130, 246, 0.5); color: #60a5fa; }
.frx-card-title { margin: 0; font-size: 15px; font-weight: 700; color: #f9fafb; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.frx-card-sub { margin: 0; font-size: 12px; font-weight: 500; }
.frx-card-sub.is-ok { color: #22c55e; }
.frx-card-sub.is-idle { color: var(--frx-text-dim); }
.frx-version { text-align: right; }
.frx-version-label { margin: 0; font-size: 12px; color: var(--frx-text-dim); }
.frx-version-value { margin: 0; font-size: 14px; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; color: var(--frx-text); }
.frx-icon-btn {
  width: 32px; height: 32px; border-radius: 8px; display: inline-flex; align-items: center; justify-content: center;
  background: rgba(59, 130, 246, 0.2); border: 1px solid rgba(59, 130, 246, 0.5); color: #60a5fa;
  cursor: pointer; transition: background .2s ease;
}
.frx-icon-btn:hover { background: rgba(59, 130, 246, 0.3); }

/* ---------- 卡片底部两个小盒（Health Score / Status） ---------- */
.frx-boxes { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin-top: auto; }
.frx-box { background: var(--frx-surface); border-radius: 12px; padding: 12px; display: flex; flex-direction: column; }
.frx-box-label {
  margin: 0 0 4px; font-size: 10px; font-weight: 700; letter-spacing: .12em;
  text-transform: uppercase; color: var(--frx-text-dim);
}
.frx-box-value { margin: 0; margin-top: auto; font-size: 24px; line-height: 1.15; font-weight: 700; color: #60a5fa; }
.frx-box-value.is-purple { color: #c084fc; }
.frx-box-value.is-green { color: #4ade80; }
.frx-box-unit { font-size: 12px; color: var(--frx-text-faint); margin-left: 4px; }

/* ---------- 大数字卡（Total Skills / Agents Running） ---------- */
.frx-bigrow { display: flex; align-items: flex-start; justify-content: space-between; }
.frx-chip { padding: 8px; border-radius: 8px; display: inline-flex; }
.frx-chip.is-blue { background: rgba(59, 130, 246, 0.2); color: #60a5fa; }
.frx-chip.is-purple { background: rgba(168, 85, 247, 0.2); color: #c084fc; }
.frx-delta { font-size: 12px; font-weight: 700; }
.frx-delta.is-up { color: #22c55e; }
.frx-delta.is-flat { color: #9ca3af; }
.frx-stat-label { margin: 0; font-size: 14px; color: var(--frx-text-dim); }
.frx-stat-value { margin: 0; font-size: 30px; line-height: 1.1; font-weight: 700; color: var(--frx-text-strong); }
.frx-pills { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 12px; }
.frx-pill {
  display: inline-flex; align-items: center; gap: 6px; max-width: 100%;
  padding: 4px 8px; border-radius: 6px; font-size: 11px;
  background: var(--frx-inner); color: var(--frx-text-dim);
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.frx-pill em { font-style: normal; color: #93c5fd; font-weight: 700; }
.frx-spark { margin-top: auto; padding-top: 12px; }

/* ---------- 历史列表（History 卡） ---------- */
.frx-rows { display: flex; flex-direction: column; gap: 8px; overflow-y: auto; min-height: 0; }
.frx-row {
  display: flex; align-items: center; justify-content: space-between; gap: 12px;
  padding: 16px; border-radius: 12px; background: var(--frx-surface);
  transition: background .2s ease; cursor: pointer; text-align: left; border: 0; width: 100%;
  color: inherit;
}
.frx-row:hover { background: var(--frx-surface-hover); }
.frx-row-left { display: flex; align-items: center; gap: 12px; min-width: 0; }
.frx-avatar {
  position: relative; width: 40px; height: 40px; flex: 0 0 auto; border-radius: 10px; overflow: hidden;
  border: 1px solid var(--frx-avatar-border); display: flex; align-items: center; justify-content: center;
  background: var(--frx-avatar-bg); font-size: 12px; font-weight: 700; color: var(--frx-text);
}
.frx-avatar-dot {
  position: absolute; right: -2px; bottom: -2px; width: 12px; height: 12px; border-radius: 999px;
  border: 2px solid var(--frx-avatar-ring); background: #6b7280;
}
.frx-avatar-dot.is-running { background: #22c55e; }
.frx-avatar-dot.is-suspended { background: #f59e0b; }
.frx-row-main { min-width: 0; }
.frx-row-title { margin: 0; font-size: 13px; font-weight: 600; color: var(--frx-text-strong); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.frx-row-meta { margin: 0; font-size: 11px; color: var(--frx-text-dim); }
.frx-row-status { font-size: 11px; font-weight: 700; letter-spacing: .04em; }
.frx-row-status.is-running { color: #60a5fa; }
.frx-row-status.is-suspended { color: #fbbf24; }
.frx-row-status.is-idle { color: #9ca3af; }
.frx-row-btn {
  padding: 6px 12px; border-radius: 8px; font-size: 12px; cursor: pointer;
  background: var(--frx-inner); border: 1px solid var(--frx-border); color: var(--frx-text);
}
.frx-row-btn:hover { background: var(--frx-surface-hover); }

/* ---------- 气泡群（ClaudeModelBubbles dashboard-desktop） ---------- */
.frx-bubbles-label {
  margin: 0 0 12px; font-size: 10px; font-weight: 700; letter-spacing: .12em;
  text-transform: uppercase; color: var(--frx-text-dim);
}
.frx-bubbles { position: relative; width: 100%; max-width: 520px; height: 116px; margin: 4px auto 0; }
.frx-orb-slot { position: absolute; }
.frx-orb-slot:hover { z-index: 20; }
/* 圆本体：rounded-full + overflow-hidden + border-2 + bg-gradient-to-br from-white/8 via-white/4 to-transparent */
.frx-orb {
  position: relative; display: block; width: 100%; height: 100%; padding: 0; cursor: pointer;
  /* 强制正圆：宿主可能对 button 有通用圆角/尺寸样式，这里用 !important 钉死，
     否则实机上会出现「不是圆的」（用户实测反馈）。 */
  border-radius: 50% !important; aspect-ratio: 1 / 1; overflow: hidden; border: 2px solid transparent;
  background: linear-gradient(to bottom right, var(--frx-orb-bg-1), var(--frx-orb-bg-2), rgba(255, 255, 255, 0));
  transition: transform .3s ease, border-color .3s ease, box-shadow .3s ease;
}
.frx-orb:hover { transform: scale(1.1); }
/* 可用 / 运行中：绿边 .4 + 20px/40px 光晕 + 30px 内发光 + 顶部 1px 白线 */
.frx-orb.is-ok {
  border-color: rgba(34, 197, 94, 0.4);
  box-shadow:
    0 0 20px rgba(34, 197, 94, 0.4),
    0 0 40px rgba(34, 197, 94, 0.2),
    inset 0 0 30px rgba(34, 197, 94, 0.15),
    inset 0 1px 0 rgba(255, 255, 255, 0.4);
}
/* 当前 / 正在跑：蓝边 .6 + 25px/50px 光晕 + 35px 内发光 */
.frx-orb.is-current {
  border-color: rgba(59, 130, 246, 0.6);
  box-shadow:
    0 0 25px rgba(59, 130, 246, 0.6),
    0 0 50px rgba(59, 130, 246, 0.3),
    inset 0 0 35px rgba(59, 130, 246, 0.2),
    inset 0 1px 0 rgba(255, 255, 255, 0.4);
}
/* 不可用 / 未开始：1px 白 15% + 轻微投影 */
.frx-orb.is-dim {
  border-width: 1px;
  border-color: var(--frx-orb-dim-border);
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.05), inset 0 1px 0 rgba(255, 255, 255, 0.4);
}
/* 球面高光：左上 30% 的模糊白光 + 右上一个 18% 小亮点 */
.frx-orb-shine {
  position: absolute; top: 18%; left: 28%; width: 30%; height: 30%; border-radius: 9999px;
  background: linear-gradient(to bottom right, rgba(255, 255, 255, 0.5), rgba(255, 255, 255, 0.2), rgba(255, 255, 255, 0));
  filter: blur(3px); pointer-events: none;
}
.frx-orb-spark {
  position: absolute; top: 12%; right: 22%; width: 18%; height: 18%; border-radius: 9999px;
  background: rgba(255, 255, 255, 0.3); filter: blur(1px); pointer-events: none;
}
.frx-orb-label {
  /* 必须在水位之上（水位是 20/21）：否则数字被液体盖住、视觉上就「不在圆心」 */
  position: absolute; inset: 0; z-index: 22; display: flex; align-items: center; justify-content: center;
  padding: 0 4px; font-size: 9px; font-weight: 700; line-height: 1; text-align: center;
  /* 不再写死纯白：深色主题下用主文字色（近白），亮色主题下它自动变成深色，
     压在水位上的可读性两边都成立。 */
  color: var(--dsw-alias-label-primary);
  font-variant-numeric: tabular-nums; letter-spacing: .02em;
  text-shadow: 0 1px 2px color-mix(in oklab, var(--dsw-alias-bg-base) 65%, transparent);
  pointer-events: none; word-break: break-word;
}
/* 水位（WaterLevel.tsx）：两层 SVG，填充 + 波浪线，都被圆形裁剪 */
.frx-water { position: absolute; inset: 0; width: 100%; height: 100%; pointer-events: none; }
.frx-water.is-fill { z-index: 20; }
.frx-water.is-wave { z-index: 21; }
.frx-water-liquid { fill: rgba(34, 197, 94, 0.2); transition: fill 1s ease-out; }
.frx-water-wave { stroke: rgba(34, 197, 94, 0.6); transition: stroke 1s ease-out; }
/* hover 浮层（bg-black/95 + rounded-lg + 小三角） */
.frx-orb-tip {
  position: absolute; left: 50%; bottom: 100%; z-index: 30; transform: translateX(-50%);
  margin-bottom: 8px; display: flex; flex-direction: column; gap: 3px;
  padding: 8px 12px; border-radius: 8px; white-space: nowrap;
  background: var(--frx-tip-bg); border: 1px solid var(--frx-border);
  box-shadow: 0 10px 15px -3px rgba(0, 0, 0, 0.3);
  pointer-events: none;
}
.frx-orb-tip-name { font-size: 10px; font-weight: 700; color: var(--frx-tip-fg); }
.frx-orb-tip-meta { font-size: 9px; color: var(--frx-tip-meta); }
.frx-orb-tip-hint { font-size: 8px; color: #4ade80; }

/* 漂浮：参考项目 @keyframes float 原样（-8/-4/-10px，+3/-3/+2px） */
@keyframes frx-float {
  0%, 100% { transform: translateY(0) translateX(0); }
  25% { transform: translateY(-8px) translateX(3px); }
  50% { transform: translateY(-4px) translateX(-3px); }
  75% { transform: translateY(-10px) translateX(2px); }
}

/* 迷你柱图（Total Skills 卡底部那张图的替身）：把卡片下半部分填满 */
.frx-minichart { display: flex; align-items: flex-end; gap: 6px; height: 56px; margin-top: 12px; }
.frx-minibar {
  flex: 1 1 0; min-width: 0; border-radius: 4px 4px 2px 2px;
  background: linear-gradient(to top, rgba(59, 130, 246, 0.35), rgba(59, 130, 246, 0.9));
}

/* ---------- 快捷操作（Quick Actions） ---------- */
.frx-actions { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-top: auto; flex: 1 1 auto; align-content: stretch; }
.frx-action {
  display: flex; align-items: center; gap: 12px; padding: 16px; border-radius: 16px; min-width: 0; min-height: 84px;
  cursor: pointer; text-align: left; border: 1px solid transparent; color: #fff;
  transition: filter .2s ease;
}
.frx-action:hover { filter: brightness(1.15); }
.frx-action.is-blue { background: linear-gradient(to right, rgba(37, 99, 235, 0.9), rgba(59, 130, 246, 0.9)); }
.frx-action.is-purple { background: linear-gradient(to right, rgba(147, 51, 234, 0.9), rgba(219, 39, 119, 0.9)); }
/* ghost：参考项目那种「次要动作」——半透明底 + 细边框，铺满网格但视觉更轻 */
.frx-action.is-ghost {
  background: var(--frx-surface);
  border: 1px solid var(--frx-border);
  color: var(--frx-text);
}
.frx-action.is-ghost:hover { background: var(--frx-surface-hover); }
.frx-action-icon {
  width: 40px; height: 40px; border-radius: 12px; flex: 0 0 auto; display: flex; align-items: center; justify-content: center;
  background: rgba(255, 255, 255, 0.18);
}
.frx-action-title { margin: 0; font-size: 14px; font-weight: 700; }
.frx-action-sub { margin: 0; font-size: 11px; opacity: .85; }

/* ---------- 细滚动条 ---------- */
.frx-rows::-webkit-scrollbar { width: 6px; }
.frx-rows::-webkit-scrollbar-thumb { background: var(--frx-scrollbar); border-radius: 999px; }

/* ---------- 窄屏：参考项目的 md/lg 断点 ---------- */
@container frxpage (max-width: 1100px) {
  .frx-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); height: auto; }
  .frx-card.is-span2 { grid-column: span 2; }
}
@container frxpage (max-width: 640px) {
  .frx-grid { grid-template-columns: minmax(0, 1fr); }
  .frx-card.is-span2 { grid-column: span 1; }
}

/* ---------- 减少动效 ---------- */
@media (prefers-reduced-motion: reduce) {
  .frx-orb-slot { animation: none !important; }
  .frx-orb { transition: none !important; }
  .frx-orb:hover { transform: none !important; }
}
`

/** 注入这张表（幂等；卸载时由调用方按 STYLE_ID 移除）。 */
export function injectExactStyles(doc) {
  const d = doc || (typeof document === 'undefined' ? null : document)
  if (!d || typeof d.createElement !== 'function') return null
  const old = d.getElementById(STYLE_ID)
  if (old) old.remove()
  const node = d.createElement('style')
  node.id = STYLE_ID
  node.textContent = CSS
  const head = d.head || d.documentElement
  if (head) head.appendChild(node)
  return node
}
