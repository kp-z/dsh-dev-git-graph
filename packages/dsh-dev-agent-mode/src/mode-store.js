/**
 * dsh-dev-agent-mode —— mode-store：Agent 模式状态（可单测，纯逻辑）。
 *
 * 职责：
 * - 保存/读取「官方模式 ↔ Agent 模式」的全局偏好；
 * - 优先 localStorage（跨刷新持久），不可用时回退内存态（仍可切换）；
 * - 订阅通知（组件/开关联动）；
 * - 纯逻辑，不直接访问 DOM；存储介质通过参数注入（便于单测）。
 */

const STORAGE_KEY = 'dsh-dev-agent-mode.mode';
const DEFAULT_MODE = 'official';

/** 可用的模式值。 */
export const MODES = Object.freeze({ OFFICIAL: 'official', AGENT: 'agent' });

/**
 * 归一化任意输入为合法模式；非法输入回退默认值。
 * @param value 未知输入（localStorage 可能被篡改/损坏）
 * @returns 'official' | 'agent'
 */
export function normalizeMode(value) {
  return value === MODES.AGENT ? MODES.AGENT : MODES.OFFICIAL;
}

/**
 * 创建模式存储。
 * @param storage 存储介质（localStorage 风格：getItem/setItem/removeItem，可 null）
 * @returns ModeStore { get, set, subscribe }
 */
export function createModeStore(storage = null) {
  /** 内存态兜底：localStorage 不可用/损坏时仍可切换（刷新回默认，可接受）。 */
  let memory = DEFAULT_MODE;
  /** 是否可用外部存储（构造函数时探测一次）。 */
  let usable = false;
  if (storage !== null && storage !== undefined) {
    try {
      const probe = '__dsh_agent_mode_probe__';
      storage.setItem(probe, '1');
      storage.removeItem(probe);
      usable = true;
    } catch {
      usable = false; // 隐私模式/Safari 旧版等：静默降级内存态
    }
  }
  /** 当前持久化值（仅 usable 时有效）。 */
  let persisted = null;
  if (usable) {
    try {
      persisted = storage.getItem(STORAGE_KEY);
    } catch {
      persisted = null;
    }
  }

  const listeners = new Set();

  /** 读取当前模式：持久化值优先，损坏回退内存态。 */
  function get() {
    if (persisted !== null) return normalizeMode(persisted);
    return memory;
  }

  /**
   * 写入模式。
   * @param mode 'official' | 'agent'
   * @returns 是否成功持久化（false = 仅内存态）
   */
  function set(mode) {
    const next = normalizeMode(mode);
    memory = next;
    if (usable) {
      try {
        storage.setItem(STORAGE_KEY, next);
        persisted = next;
      } catch {
        persisted = null; // 写入失败：保持内存态
        for (const l of [...listeners]) {
          try {
            l();
          } catch {
            /* 监听器异常不阻断写入 */
          }
        }
        return false;
      }
    }
    for (const l of [...listeners]) {
      try {
        l();
      } catch {
        /* 监听器异常不阻断写入 */
      }
    }
    return usable;
  }

  /**
   * 订阅模式变化。
   * @param listener () => void
   * @returns 取消订阅函数（幂等）
   */
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

  return { get, set, subscribe };
}

/** 单例便捷工厂（客户端运行时用真实 localStorage；测试传 mock）。 */
export function createDefaultModeStore() {
  let storage = null;
  if (typeof globalThis !== 'undefined' && typeof globalThis.localStorage !== 'undefined') {
    storage = globalThis.localStorage;
  }
  return createModeStore(storage);
}
