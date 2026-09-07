/**
 * dsh-dev-agent-mode —— agent-identity：确定性 Agent 身份派生（纯函数，无 DOM/无状态）。
 *
 * 设计：每个 workspace 对应一个 Agent。身份完全由 workspaceId（+ title/path）确定性派生：
 * - 同一 workspace 永远得到同一头像/名称，跨刷新稳定；
 * - 不落库、无服务端状态，卸载即消失；
 * - 纯函数便于单测（node:test）。
 *
 * 导出均为纯函数，严禁访问 window/document/localStorage。
 */

/**
 * FNV-1a 32 位哈希（确定性、快、碰撞率低）。
 * @param input 任意字符串
 * @returns 无符号 32 位整数
 */
export function fnv1a(input) {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = (h >>> 0) * 0x01000193;
  }
  return h >>> 0;
}

/** 可读性好的调色板（按 hue 分布，避免撞色难看的相邻色）。 */
const HUES = [210, 262, 325, 14, 152, 90, 190, 45, 275, 330, 165, 25];

/**
 * 从 workspaceId 派生头像色相（确定性）。
 * @param workspaceId 稳定 id（host 生成的 uuid）
 * @returns 0-360 的色相角
 */
export function hueFor(workspaceId) {
  if (typeof workspaceId !== 'string' || workspaceId.length === 0) return HUES[0];
  const h = fnv1a(workspaceId);
  return HUES[h % HUES.length];
}

/**
 * 从标题派生头像首字母（确定性）。
 * - 取 title 第一个非空白字符；
 * - 中文/全角字符原样保留（浏览器可显示）；
 * - 无标题（空串）回退 workspaceId 首字符；
 * - 两者都空回退 '?'。
 * @param title workspace 标题
 * @param workspaceId workspace id（空标题时的回退源）
 * @returns 单字符
 */
export function initialFor(title, workspaceId) {
  const t = String(title ?? '');
  const m = t.match(/\S/);
  if (m) return m[0].toUpperCase();
  const id = String(workspaceId ?? '');
  const mi = id.match(/\S/);
  if (mi) return mi[0].toUpperCase();
  return '?';
}

/**
 * 生成 Agent 头像的渐变背景（确定性）。
 * hue + 固定 S/L：同一 Agent 稳定；亮/暗主题都可见（用双 stop 渐变）。
 * @param workspaceId workspace id
 * @returns CSS linear-gradient 字符串
 */
export function gradientFor(workspaceId) {
  const hue = hueFor(workspaceId);
  return `linear-gradient(135deg, hsl(${hue} 62% 46%), hsl(${(hue + 40) % 360} 70% 60%))`;
}

/**
 * 组装完整 Agent 身份对象（一次调用拿全量）。
 * @param workspaceId workspace id
 * @param title workspace 标题
 * @returns {hue, initial, gradient}
 */
export function agentIdentity(workspaceId, title) {
  return {
    hue: hueFor(workspaceId),
    initial: initialFor(title, workspaceId),
    gradient: gradientFor(workspaceId),
  };
}
