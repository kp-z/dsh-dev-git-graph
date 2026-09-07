/**
 * avatar-store 单测：默认值、读写往返、损坏回退、订阅。
 * 运行：pnpm --filter dsh-dev-agent-mode test
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeAvatarSpec,
  parseAvatarMap,
  createAvatarStore,
} from '../src/avatar-store.js';

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

test('normalizeAvatarSpec: 合法 color/emoji 保留，非法回退 null', () => {
  assert.deepEqual(normalizeAvatarSpec({ type: 'color', hue: 210 }), { type: 'color', hue: 210 });
  assert.deepEqual(normalizeAvatarSpec({ type: 'emoji', char: '🤖' }), { type: 'emoji', char: '🤖' });
  assert.equal(normalizeAvatarSpec(null), null);
  assert.equal(normalizeAvatarSpec(undefined), null);
  assert.equal(normalizeAvatarSpec('string'), null);
  assert.equal(normalizeAvatarSpec({ type: 'color', hue: 400 }), null); // hue 越界
  assert.equal(normalizeAvatarSpec({ type: 'color', hue: -5 }), null);
  assert.equal(normalizeAvatarSpec({ type: 'color', hue: 'x' }), null);
  assert.equal(normalizeAvatarSpec({ type: 'emoji', char: '' }), null);
  assert.equal(normalizeAvatarSpec({ type: 'emoji', char: 'toooo-long' }), null);
  assert.equal(normalizeAvatarSpec({ type: 'unknown' }), null);
});

test('parseAvatarMap: JSON 损坏回退空表', () => {
  assert.equal(parseAvatarMap('not-json{{{').size, 0);
  assert.equal(parseAvatarMap('').size, 0);
  assert.equal(parseAvatarMap(null).size, 0);
  assert.equal(parseAvatarMap('[1,2]').size, 0); // 数组非法
});

test('parseAvatarMap: 合法表解析 + 非法项剔除', () => {
  const map = parseAvatarMap(JSON.stringify({
    'ws-1': { type: 'color', hue: 210 },
    'ws-2': { type: 'emoji', char: '🦊' },
    'ws-3': { type: 'color', hue: 999 }, // 非法剔除
    'ws-4': 'garbage', // 非法剔除
  }));
  assert.equal(map.size, 2);
  assert.deepEqual(map.get('ws-1'), { type: 'color', hue: 210 });
  assert.deepEqual(map.get('ws-2'), { type: 'emoji', char: '🦊' });
});

test('createAvatarStore: 默认无偏好 (get 返回 null)', () => {
  const store = createAvatarStore(mockStorage());
  assert.equal(store.get('ws-1'), null);
});

test('createAvatarStore: set color/emoji -> get 往返 + 持久化', () => {
  const storage = mockStorage();
  const store = createAvatarStore(storage);
  assert.equal(store.set('ws-1', { type: 'color', hue: 120 }), true);
  assert.deepEqual(store.get('ws-1'), { type: 'color', hue: 120 });
  const raw = storage._dump()['dsh-dev-agent-mode.avatars'];
  assert.ok(raw.includes('"ws-1"'));
  // 新实例读到持久化值
  const store2 = createAvatarStore(storage);
  assert.deepEqual(store2.get('ws-1'), { type: 'color', hue: 120 });
});

test('createAvatarStore: reset 删除偏好回默认', () => {
  const storage = mockStorage();
  const store = createAvatarStore(storage);
  store.set('ws-1', { type: 'emoji', char: '🤖' });
  assert.deepEqual(store.get('ws-1'), { type: 'emoji', char: '🤖' });
  store.reset('ws-1');
  assert.equal(store.get('ws-1'), null);
});

test('createAvatarStore: 非法 workspaceId / spec 拒绝', () => {
  const store = createAvatarStore(mockStorage());
  assert.equal(store.set('', { type: 'color', hue: 10 }), false); // 空 id 拒绝
  // 非法 spec 等价「重置」：删除偏好（若有），持久化成功返回 true
  assert.equal(store.set('ws-1', { type: 'color', hue: 10 }), true);
  assert.deepEqual(store.get('ws-1'), { type: 'color', hue: 10 });
  const ret = store.set('ws-1', 'bad'); // 非法 spec -> 视为重置
  assert.equal(ret, true);
  assert.equal(store.get('ws-1'), null);
});

test('createAvatarStore: 订阅触发 + 退订幂等', () => {
  const store = createAvatarStore(mockStorage());
  let count = 0;
  const unsub = store.subscribe(() => count++);
  store.set('ws-1', { type: 'color', hue: 30 });
  assert.equal(count, 1);
  store.reset('ws-1');
  assert.equal(count, 2);
  unsub();
  store.set('ws-1', { type: 'emoji', char: '🐱' });
  assert.equal(count, 2);
  unsub(); // 幂等
});

test('createAvatarStore: subscribe 参数校验', () => {
  const store = createAvatarStore(mockStorage());
  assert.throws(() => store.subscribe('nope'), TypeError);
});

test('createAvatarStore: localStorage 损坏时内存态兜底', () => {
  const broken = mockStorage({}, { broken: true });
  const store = createAvatarStore(broken);
  assert.equal(store.get('ws-1'), null);
  const ok = store.set('ws-1', { type: 'color', hue: 90 });
  assert.equal(ok, false); // 写失败
  assert.deepEqual(store.get('ws-1'), { type: 'color', hue: 90 }); // 内存态生效
});

test('createAvatarStore: 无 storage 纯内存态', () => {
  const store = createAvatarStore(null);
  assert.equal(store.set('ws-1', { type: 'emoji', char: '🌟' }), false);
  assert.deepEqual(store.get('ws-1'), { type: 'emoji', char: '🌟' });
});
