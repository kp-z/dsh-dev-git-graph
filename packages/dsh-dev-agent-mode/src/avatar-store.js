/**
 * dsh-dev-agent-mode —— avatar-store：workspace 头像偏好（可单测，纯逻辑）。
 *
 * 职责：
 * - 每个 workspace（按 workspaceId）的头像偏好：默认（确定性色块）/ 自定义色相 / emoji / 上传图片；
 * - 持久化到 localStorage（键 dsh-dev-agent-mode.avatars），不可用时内存态兜底；
 * - 订阅通知（头像变更联动 UI）；
 * - 纯逻辑：存储介质通过参数注入（便于单测）。
 */

const STORAGE_KEY = 'dsh-dev-agent-mode.avatars';
const MAX_AVATARS = 200; // 防御：防 localStorage 被写爆
/** 图片头像 dataURL 上限（200KB），防 localStorage 爆。 */
export const MAX_IMAGE_DATA_URL = 200_000;

/**
 * 归一化任意输入为合法 avatarSpec；非法输入回退 null（= 用默认派生）。
 * @param value 未知输入（localStorage 可能被篡改/损坏）
 * @returns {type:'color',hue} | {type:'emoji',char} | {type:'image',dataUrl} | null
 */
export function normalizeAvatarSpec(value) {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'object') return null;
  if (value.type === 'color') {
    const hue = Number(value.hue);
    if (Number.isFinite(hue) && hue >= 0 && hue < 360) {
      return { type: 'color', hue: Math.round(hue) };
    }
    return null;
  }
  if (value.type === 'emoji') {
    const char = String(value.char ?? '');
    if (char.length > 0 && char.length <= 4) {
      return { type: 'emoji', char };
    }
    return null;
  }
  if (value.type === 'image') {
    const dataUrl = String(value.dataUrl ?? '');
    // 必须是 data:image/ 前缀且不超上限
    if (dataUrl.startsWith('data:image/') && dataUrl.length > 0 && dataUrl.length <= MAX_IMAGE_DATA_URL) {
      return { type: 'image', dataUrl };
    }
    return null;
  }
  return null;
}

/**
 * 解析 localStorage 里的头像表（容错：整表损坏回退空表）。
 * @param raw 原始字符串
 * @returns Map<workspaceId, avatarSpec>
 */
export function parseAvatarMap(raw) {
  const out = new Map();
  if (typeof raw !== 'string' || raw.length === 0) return out;
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return out; // JSON 损坏：空表
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return out;
  let count = 0;
  for (const [id, spec] of Object.entries(parsed)) {
    const norm = normalizeAvatarSpec(spec);
    if (norm !== null && typeof id === 'string' && id.length > 0 && id.length <= 128) {
      out.set(id, norm);
      count += 1;
      if (count >= MAX_AVATARS) break; // 防写爆
    }
  }
  return out;
}

/**
 * 创建头像偏好存储。
 * @param storage localStorage 风格（getItem/setItem/removeItem，可 null）
 * @returns AvatarStore { get, set, reset, subscribe }
 */
export function createAvatarStore(storage = null) {
  let usable = false;
  if (storage !== null && storage !== undefined) {
    try {
      const probe = '__dsh_avatar_probe__';
      storage.setItem(probe, '1');
      storage.removeItem(probe);
      usable = true;
    } catch {
      usable = false; // 隐私模式/Safari 旧版：内存态兜底
    }
  }
  let raw = null;
  if (usable) {
    try {
      raw = storage.getItem(STORAGE_KEY);
    } catch {
      raw = null;
    }
  }
  let map = parseAvatarMap(raw);
  const listeners = new Set();

  /** 读取某 workspace 的头像偏好；无偏好返回 null（= 用默认派生）。 */
  function get(workspaceId) {
    return map.get(workspaceId) ?? null;
  }

  /** 写头像偏好；spec 为 null 等价重置。返回是否持久化成功。 */
  function set(workspaceId, spec) {
    if (typeof workspaceId !== 'string' || workspaceId.length === 0) return false;
    const norm = normalizeAvatarSpec(spec);
    if (norm === null) map.delete(workspaceId);
    else map.set(workspaceId, norm);
    const persisted = persist();
    notify();
    return persisted;
  }

  /** 重置某 workspace 头像（删偏好，回默认派生）。 */
  function reset(workspaceId) {
    return set(workspaceId, null);
  }

  /** 持久化当前表；失败静默（内存态仍生效）。 */
  function persist() {
    if (!usable) return false;
    try {
      if (map.size === 0) storage.removeItem(STORAGE_KEY);
      else storage.setItem(STORAGE_KEY, JSON.stringify(Object.fromEntries(map)));
      return true;
    } catch {
      return false;
    }
  }

  function notify() {
    for (const l of [...listeners]) {
      try {
        l();
      } catch {
        /* 监听器异常不阻断 */
      }
    }
  }

  /** 订阅头像变化。返回幂等退订函数。 */
  function subscribe(listener) {
    if (typeof listener !== 'function') throw new TypeError('subscribe(listener) needs a function');
    listeners.add(listener);
    let disposed = false;
    return () => {
      if (disposed) return;
      disposed = true;
      listeners.delete(listener);
    };
  }

  return { get, set, reset, subscribe };
}

/** 单例便捷工厂（客户端运行时用真实 localStorage）。 */
export function createDefaultAvatarStore() {
  let storage = null;
  if (typeof globalThis !== 'undefined' && typeof globalThis.localStorage !== 'undefined') {
    storage = globalThis.localStorage;
  }
  return createAvatarStore(storage);
}
