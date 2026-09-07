/**
 * agent-identity 单测：确定性、碰撞率、首字母边界。
 * 运行：pnpm --filter dsh-dev-agent-mode test
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  fnv1a,
  hueFor,
  initialFor,
  gradientFor,
  agentIdentity,
} from '../src/agent-identity.js';

test('fnv1a: 确定性（同输入同输出）', () => {
  assert.equal(fnv1a('abc'), fnv1a('abc'));
  assert.equal(fnv1a(''), fnv1a(''));
});

test('fnv1a: 不同输入大概率不同', () => {
  const set = new Set();
  for (let i = 0; i < 1000; i++) set.add(fnv1a('id-' + i));
  assert.ok(set.size > 950, `期望低碰撞，实际 ${set.size}/1000`);
});

test('hueFor: 确定性 + 空输入回退', () => {
  const id = '550e8400-e29b-41d4-a716-446655440000';
  assert.equal(hueFor(id), hueFor(id));
  assert.equal(hueFor(''), 210); // HUES[0]
  assert.equal(hueFor(undefined), 210);
  assert.equal(hueFor(null), 210);
});

test('hueFor: 输出限定在调色板内', () => {
  const HUES = [210, 262, 325, 14, 152, 90, 190, 45, 275, 330, 165, 25];
  for (let i = 0; i < 500; i++) {
    const h = hueFor('ws-' + i);
    assert.ok(HUES.includes(h), `hue ${h} 不在调色板`);
  }
});

test('initialFor: 常规标题取首字母大写', () => {
  assert.equal(initialFor('dsh-plugins', 'id'), 'D');
  assert.equal(initialFor('agent-mode', 'id'), 'A');
});

test('initialFor: 中文/全角保留', () => {
  assert.equal(initialFor('你好世界', 'id'), '你');
  assert.equal(initialFor('。标点', 'id'), '。');
});

test('initialFor: 空标题回退 workspaceId', () => {
  assert.equal(initialFor('', 'my-workspace'), 'M');
  assert.equal(initialFor('   ', 'my-workspace'), 'M');
});

test('initialFor: 全空回退 ?', () => {
  assert.equal(initialFor('', ''), '?');
  assert.equal(initialFor(undefined, undefined), '?');
});

test('initialFor: 数字开头', () => {
  assert.equal(initialFor('123abc', 'id'), '1');
});

test('gradientFor: 确定性 + 合法 CSS', () => {
  const id = 'ws-42';
  const g1 = gradientFor(id);
  const g2 = gradientFor(id);
  assert.equal(g1, g2);
  assert.match(g1, /^linear-gradient\(135deg, hsl\(/);
  assert.ok(g1.includes('hsl('));
});

test('agentIdentity: 组装完整身份', () => {
  const ident = agentIdentity('ws-1', 'My Agent');
  assert.equal(ident.hue, hueFor('ws-1'));
  assert.equal(ident.initial, 'M');
  assert.equal(ident.gradient, gradientFor('ws-1'));
});
