/**
 * agents-store host 单测：存储读写 / 动漫命名 / API 路由全链路。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  AGENTS_API_BASE,
  defaultAgentName,
  registerAgentsRoutes,
  fnv1a,
} from '../lib/agents-store.js';

// ---------- helpers ----------
function mockRes() {
  return {
    status: 0,
    headers: {},
    bodyText: '',
    headersSent: false,
    writeHead(code, headers = {}) {
      this.status = code;
      this.headers = { ...this.headers, ...headers };
      this.headersSent = true;
    },
    end(text = '') {
      this.bodyText = typeof text === 'string' ? text : String(text);
    },
    json() {
      try { return JSON.parse(this.bodyText); } catch { return null; }
    },
  };
}
function mockReq(body, method = 'GET') {
  const listeners = {};
  return {
    method,
    url: AGENTS_API_BASE,
    on(ev, cb) { listeners[ev] = cb; },
    destroy() {},
    _emit() {
      process.nextTick(() => {
        if (body !== null && body !== undefined) listeners.data?.(Buffer.from(JSON.stringify(body)));
        listeners.end?.();
      });
    },
  };
}
function mockWebServer(fileStore) {
  const routes = [];
  return {
    routes,
    register(spec) {
      routes.push(spec);
      return () => {
        const i = routes.indexOf(spec);
        if (i >= 0) routes.splice(i, 1);
      };
    },
    async call(path, body, method = 'GET') {
      const route = routes.find((r) => r.path === AGENTS_API_BASE);
      assert.ok(route, `route ${AGENTS_API_BASE} registered`);
      const req = mockReq(body, method);
      req.url = path;
      const res = mockRes();
      req._emit?.();
      await route.handler(req, res);
      for (let i = 0; i < 50 && res.status === 0; i++) {
        await new Promise((r) => setTimeout(r, 10));
      }
      return res;
    },
    fileStore,
  };
}
function memFileStore() {
  let data = null;
  return {
    readFile: async () => JSON.parse(data ?? 'null'),
    writeFile: async (d) => { data = JSON.stringify(d); },
    dump: () => data,
  };
}

// ---------- 动漫命名 ----------
test('defaultAgentName: 确定性（同一 id 恒定）', () => {
  const a = defaultAgentName('ws-abc');
  const b = defaultAgentName('ws-abc');
  assert.equal(a, b);
  assert.ok(a.length >= 2);
});
test('defaultAgentName: 不同 id 大概率不同', () => {
  const names = new Set(['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'].map((x) => defaultAgentName('ws-' + x)));
  assert.ok(names.size >= 4, '太少去重: ' + [...names].join(','));
});
test('fnv1a: 与已知值一致（32 位无符号）', () => {
  assert.equal(fnv1a('hello'), 0xa82fb4a1 >>> 0);
});

// ---------- 存储与路由 ----------
test('路由: GET /api/agents 空存储返回空表', async () => {
  const store = memFileStore();
  const ws = mockWebServer(store);
  registerAgentsRoutes({ webServer: ws, ...store });
  const res = await ws.call(AGENTS_API_BASE, null, 'GET');
  assert.equal(res.status, 200);
  const body = res.json();
  assert.deepEqual(body.tables.agents, {});
  assert.equal(body.unit.name, 'agents');
});
test('路由: PUT /api/agents/:id 创建档案（默认名+avatarSpec）', async () => {
  const store = memFileStore();
  const ws = mockWebServer(store);
  registerAgentsRoutes({ webServer: ws, ...store });
  const res = await ws.call(AGENTS_API_BASE + '/ws-1', { name: '灵巧小狐', avatarSpec: { type: 'color', hue: 210 } }, 'PUT');
  assert.equal(res.status, 200);
  const p = res.json();
  assert.equal(p.workspaceId, 'ws-1');
  assert.equal(p.name, '灵巧小狐');
  assert.equal(p.avatarSpec.type, 'color');
  assert.equal(p.persona, null); // 预留字段
  assert.equal(p.memoryRef, null);
  assert.ok(p.createdAt && p.updatedAt);
});
test('路由: PUT 无 name 时用确定性默认名', async () => {
  const store = memFileStore();
  const ws = mockWebServer(store);
  registerAgentsRoutes({ webServer: ws, ...store });
  const res = await ws.call(AGENTS_API_BASE + '/ws-xyz', {}, 'PUT');
  assert.equal(res.status, 200);
  const p = res.json();
  assert.equal(p.name, defaultAgentName('ws-xyz'));
});
test('路由: PUT 部分更新保留既有字段', async () => {
  const store = memFileStore();
  const ws = mockWebServer(store);
  registerAgentsRoutes({ webServer: ws, ...store });
  await ws.call(AGENTS_API_BASE + '/ws-1', { name: '初始名', avatarSpec: { type: 'color', hue: 10 } }, 'PUT');
  // 只改名
  const res = await ws.call(AGENTS_API_BASE + '/ws-1', { name: '新名' }, 'PUT');
  assert.equal(res.status, 200);
  const p = res.json();
  assert.equal(p.name, '新名');
  assert.equal(p.avatarSpec.hue, 10); // 保留
  assert.equal(p.persona, null);
});
test('路由: GET /api/agents/:id 返回档案 / 不存在 404', async () => {
  const store = memFileStore();
  const ws = mockWebServer(store);
  registerAgentsRoutes({ webServer: ws, ...store });
  await ws.call(AGENTS_API_BASE + '/ws-1', { name: 'A' }, 'PUT');
  const ok = await ws.call(AGENTS_API_BASE + '/ws-1', null, 'GET');
  assert.equal(ok.status, 200);
  assert.equal(ok.json().name, 'A');
  const miss = await ws.call(AGENTS_API_BASE + '/nope', null, 'GET');
  assert.equal(miss.status, 404);
});
test('路由: DELETE /api/agents/:id 删除后 404', async () => {
  const store = memFileStore();
  const ws = mockWebServer(store);
  registerAgentsRoutes({ webServer: ws, ...store });
  await ws.call(AGENTS_API_BASE + '/ws-1', { name: 'A' }, 'PUT');
  const del = await ws.call(AGENTS_API_BASE + '/ws-1', null, 'DELETE');
  assert.equal(del.status, 204);
  const miss = await ws.call(AGENTS_API_BASE + '/ws-1', null, 'GET');
  assert.equal(miss.status, 404);
});
test('路由: PUT name 空/超长 400', async () => {
  const store = memFileStore();
  const ws = mockWebServer(store);
  registerAgentsRoutes({ webServer: ws, ...store });
  for (const body of [{ name: '   ' }, { name: 'x'.repeat(61) }, { name: 123 }]) {
    const res = await ws.call(AGENTS_API_BASE + '/ws-1', body, 'PUT');
    assert.equal(res.status, 400, JSON.stringify(body).slice(0, 30));
  }
});
test('路由: 真实文件系统读写（tmp 目录）', async () => {
  const dir = await fs.mkdtemp(join(tmpdir(), 'dsh-agent-'));
  const filePath = join(dir, 'agents.json');
  const ws = mockWebServer({});
  registerAgentsRoutes({ webServer: ws, filePath });
  const res = await ws.call(AGENTS_API_BASE + '/ws-fs', { name: '文件测试' }, 'PUT');
  assert.equal(res.status, 200);
  const onDisk = JSON.parse(await fs.readFile(filePath, 'utf8'));
  assert.equal(onDisk.tables.agents['ws-fs'].name, '文件测试');
  assert.equal(onDisk.unit.version, 1);
});
