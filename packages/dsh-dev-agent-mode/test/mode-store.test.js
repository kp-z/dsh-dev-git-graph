/**
 * mode-store 单测：默认值、切换往返、订阅、localStorage 损坏回退。
 * 运行：pnpm --filter dsh-dev-agent-mode test
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createModeStore, normalizeMode, MODES } from '../src/mode-store.js';

/** 内存版 localStorage mock（含损坏/抛错模拟）。 */
function mockStorage(initial = {}, { broken = false } = {}) {
  const store = new Map(Object.entries(initial));
  return {
    getItem(key) {
      if (broken) throw new Error('storage broken');
      return store.has(key) ? store.get(key) : null;
    },
    setItem(key, value) {
      if (broken) throw new Error('storage broken');
      store.set(key, String(value));
    },
    removeItem(key) {
      if (broken) throw new Error('storage broken');
      store.delete(key);
    },
    _dump: () => Object.fromEntries(store),
  };
}

test('normalizeMode: 合法值保留，非法回退 official', () => {
  assert.equal(normalizeMode('agent'), MODES.AGENT);
  assert.equal(normalizeMode('official'), MODES.OFFICIAL);
  assert.equal(normalizeMode(undefined), MODES.OFFICIAL);
  assert.equal(normalizeMode('hacker'), MODES.OFFICIAL);
  assert.equal(normalizeMode(null), MODES.OFFICIAL);
  assert.equal(normalizeMode(123), MODES.OFFICIAL);
});

test('createModeStore: 默认 official', () => {
  const store = createModeStore(mockStorage());
  assert.equal(store.get(), MODES.OFFICIAL);
});

test('createModeStore: set→get 往返 + 持久化', () => {
  const storage = mockStorage();
  const store = createModeStore(storage);
  assert.equal(store.set(MODES.AGENT), true);
  assert.equal(store.get(), MODES.AGENT);
  assert.equal(storage._dump()['dsh-dev-agent-mode.mode'], 'agent');
  // 新实例读到持久化值
  const store2 = createModeStore(storage);
  assert.equal(store2.get(), MODES.AGENT);
});

test('createModeStore: 非法 set 值归一化', () => {
  const storage = mockStorage();
  const store = createModeStore(storage);
  store.set('bogus');
  assert.equal(store.get(), MODES.OFFICIAL);
});

test('createModeStore: 订阅触发 + 退订', () => {
  const store = createModeStore(mockStorage());
  let count = 0;
  const unsub = store.subscribe(() => count++);
  store.set(MODES.AGENT);
  assert.equal(count, 1);
  store.set(MODES.OFFICIAL);
  assert.equal(count, 2);
  unsub();
  store.set(MODES.AGENT);
  assert.equal(count, 2); // 退订后不再通知
  unsub(); // 幂等
});

test('createModeStore: subscribe 参数校验', () => {
  const store = createModeStore(mockStorage());
  assert.throws(() => store.subscribe('not-a-function'), TypeError);
});

test('createModeStore: localStorage 损坏时回退内存态，仍可切换', () => {
  const broken = mockStorage({}, { broken: true });
  const store = createModeStore(broken);
  assert.equal(store.get(), MODES.OFFICIAL); // 读失败回退
  const ok = store.set(MODES.AGENT);
  assert.equal(ok, false); // 写失败返回 false
  assert.equal(store.get(), MODES.AGENT); // 内存态生效
  assert.equal(store.set(MODES.OFFICIAL), false);
  assert.equal(store.get(), MODES.OFFICIAL);
});

test('createModeStore: 无 storage 时纯内存态', () => {
  const store = createModeStore(null);
  assert.equal(store.get(), MODES.OFFICIAL);
  assert.equal(store.set(MODES.AGENT), false);
  assert.equal(store.get(), MODES.AGENT);
});

test('createModeStore: 持久化值损坏时回退默认', () => {
  const storage = mockStorage({ 'dsh-dev-agent-mode.mode': '###corrupt###' });
  const store = createModeStore(storage);
  assert.equal(store.get(), MODES.OFFICIAL);
});
