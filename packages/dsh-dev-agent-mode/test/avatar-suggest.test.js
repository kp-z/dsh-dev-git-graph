/**
 * avatar-suggest host 路由单测：
 * 路由/校验/服务降级/LLM 聚合/净化/大小，全链路可测。
 * 运行：pnpm --filter dsh-dev-agent-mode test
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  sanitizeSvg,
  registerAvatarSuggestRoutes,
  MAX_SVG_TEXT_LEN,
} from '../lib/avatar-suggest.js';

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
function mockReq(body, method = 'POST') {
  const listeners = {};
  return {
    method,
    url: '/dsh-dev-agent-mode/api/avatar-suggest',
    on(ev, cb) { listeners[ev] = cb; },
    destroy() {},
    _emit() {
      process.nextTick(() => {
        if (body !== null) listeners.data?.(Buffer.from(JSON.stringify(body)));
        listeners.end?.();
      });
    },
  };
}
function mockWebServer() {
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
    async call(path, body, method = 'POST') {
      const route = routes.find((r) => r.path === path);
      assert.ok(route, `route ${path} registered`);
      const req = mockReq(body, method);
      const res = mockRes();
      req._emit?.();
      await route.handler(req, res);
      // 等 handle 异步链完成
      for (let i = 0; i < 50 && res.status === 0; i++) {
        await new Promise((r) => setTimeout(r, 10));
      }
      return res;
    },
  };
}
const OK_SVG = '<svg viewBox="0 0 64 64"><circle cx="32" cy="32" r="30" fill="#2653eb"/></svg>';

// ---------- sanitizeSvg ----------
test('sanitizeSvg: 合法 SVG 保留核心结构', () => {
  const out = sanitizeSvg(OK_SVG);
  assert.ok(out !== null);
  assert.ok(out.includes('<svg'));
  assert.ok(out.includes('viewBox="0 0 64 64"'));
  assert.ok(out.includes('xmlns="http://www.w3.org/2000/svg"')); // 渲染必需（缺则浏览器 broken-image）
  assert.ok(out.includes('<circle'));
  assert.ok(out.includes('fill="#2653eb"'));
});
test('sanitizeSvg: LLM 裸输出（无 xmlns）自动注入 xmlns', () => {
  const out = sanitizeSvg('<svg viewBox="0 0 64 64"><circle cx="32" cy="32" r="30" fill="#369"/></svg>');
  assert.ok(out !== null);
  assert.ok(out.includes('xmlns="http://www.w3.org/2000/svg"'));
  // 不重复注入
  assert.equal((out.match(/xmlns=/g) || []).length, 1);
});
test('sanitizeSvg: 剥 script/事件/href/外部 url', () => {
  const dirty = '<svg viewBox="0 0 64 64" onload="alert(1)"><script>alert(2)</script><a href="http://evil"><circle cx="32" cy="32" r="10" fill="url(http://evil/x)"/></a></svg>';
  const out = sanitizeSvg(dirty);
  assert.ok(out !== null);
  // 去掉 xmlns 的标准 w3.org 命名空间 URI 后再断言无危险协议
  const sansXmlns = out.replace('xmlns="http://www.w3.org/2000/svg"', '');
  assert.ok(!/script|onload|http:|href|javascript:/i.test(sansXmlns), 'out: ' + out);
  assert.ok(out.includes('xmlns="http://www.w3.org/2000/svg"')); // 渲染必需
  assert.ok(out.includes('<circle')); // 图形保留
});
test('sanitizeSvg: 无 viewBox 自动注入 0 0 64 64', () => {
  const out = sanitizeSvg('<svg><rect width="10" height="10" fill="red"/></svg>');
  assert.ok(out !== null);
  assert.ok(out.includes('viewBox="0 0 64 64"'));
});
test('sanitizeSvg: 无图形元素回退 null', () => {
  assert.equal(sanitizeSvg('<svg viewBox="0 0 64 64"></svg>'), null);
  assert.equal(sanitizeSvg('<svg viewBox="0 0 64 64"><defs/></svg>'), null);
});
test('sanitizeSvg: 非 SVG / 空串 / 无闭合回退 null', () => {
  assert.equal(sanitizeSvg('hello'), null);
  assert.equal(sanitizeSvg(''), null);
  assert.equal(sanitizeSvg('<svg><rect'), null);
});
test('sanitizeSvg: markdown 围栏里的 SVG 能提取', () => {
  const out = sanitizeSvg('好的，画好了：\n```svg\n' + OK_SVG + '\n```\n希望喜欢！');
  assert.ok(out !== null);
});
test('sanitizeSvg: 超长直接拒', () => {
  const big = '<svg viewBox="0 0 64 64"><rect width="64" height="64" fill="red"/>' + 'x'.repeat(MAX_SVG_TEXT_LEN * 3) + '</svg>';
  assert.equal(sanitizeSvg(big), null);
});
test('sanitizeSvg: 内部渐变 url(#) 允许，javascript: 拒', () => {
  const out = sanitizeSvg('<svg viewBox="0 0 64 64"><defs><linearGradient id="g"><stop offset="0" stop-color="#f00"/></linearGradient></defs><rect width="64" height="64" fill="url(#g)"/></svg>');
  assert.ok(out !== null);
  assert.ok(out.includes('url(#g)'));
  const bad = sanitizeSvg('<svg viewBox="0 0 64 64"><rect width="64" height="64" fill="javascript:alert(1)"/></svg>');
  assert.ok(bad === null || !bad.includes('javascript:'));
});
test('sanitizeSvg: 自闭合与嵌套标签闭合正确', () => {
  const out = sanitizeSvg('<svg viewBox="0 0 64 64"><g transform="translate(1 2)"><circle cx="5" cy="5" r="4" fill="#fff"/></g></svg>');
  assert.ok(out !== null);
  assert.ok(out.includes('</g>'));
  assert.ok(out.includes('transform="translate(1 2)"'));
});

// ---------- 路由 ----------
test('路由: 注册 exact 路由（avatar-models + avatar-suggest）', async () => {
  const webServer = mockWebServer();
  const disposers = registerAvatarSuggestRoutes({ webServer, streamText: async () => OK_SVG, currentSelection: () => ({ provider: 'p', model: 'm' }), listModels: null });
  assert.equal(webServer.routes.length, 2);
  const paths = webServer.routes.map((r) => r.path).sort();
  assert.deepEqual(paths, ['/dsh-dev-agent-mode/api/avatar-models', '/dsh-dev-agent-mode/api/avatar-suggest']);
  assert.ok(webServer.routes.every((r) => r.kind === 'exact'));
  disposers.forEach((d) => d());
  assert.equal(webServer.routes.length, 0);
});
test('路由: GET /avatar-models 返回模型候选 + 当前默认选中', async () => {
  const webServer = mockWebServer();
  registerAvatarSuggestRoutes({
    webServer,
    streamText: async () => OK_SVG,
    currentSelection: () => ({ provider: 'deepseek', model: 'deepseek-chat' }),
    listModels: async () => [
      { provider: 'deepseek', providerName: 'DeepSeek', models: [{ id: 'deepseek-chat', name: 'deepseek-chat' }, { id: 'deepseek-reasoner', name: 'deepseek-reasoner' }] },
      { provider: 'pi-ai', providerName: 'PI AI', models: [{ id: 'pi-model', name: 'PI Model' }] },
    ],
  });
  const res = await webServer.call('/dsh-dev-agent-mode/api/avatar-models', null, 'GET');
  assert.equal(res.status, 200);
  const body = res.json();
  assert.equal(body.providers.length, 2);
  assert.equal(body.providers[0].provider, 'deepseek');
  assert.equal(body.providers[0].models.length, 2);
  assert.deepEqual(body.selection, { provider: 'deepseek', model: 'deepseek-chat' });
});
test('路由: GET /avatar-models 无 llm 时返回空列表', async () => {
  const webServer = mockWebServer();
  registerAvatarSuggestRoutes({ webServer, streamText: async () => OK_SVG, currentSelection: () => ({ provider: 'p', model: 'm' }), listModels: null });
  const res = await webServer.call('/dsh-dev-agent-mode/api/avatar-models', null, 'GET');
  assert.equal(res.status, 200);
  const body = res.json();
  assert.deepEqual(body.providers, []);
});
test('路由: 显式指定 provider/model 覆盖默认模型', async () => {
  const webServer = mockWebServer();
  let captured = null;
  registerAvatarSuggestRoutes({
    webServer,
    streamText: async (opts) => { captured = opts; return OK_SVG; },
    currentSelection: () => ({ provider: 'p1', model: 'm1' }),
    listModels: null,
  });
  const res = await webServer.call('/dsh-dev-agent-mode/api/avatar-suggest', { prompt: '蓝色机器人', provider: 'p2', model: 'm2' });
  assert.equal(res.status, 200);
  assert.equal(captured.provider, 'p2');
  assert.equal(captured.model, 'm2');
});
test('路由: 显式模型只给 provider 不给 model 时用默认', async () => {
  const webServer = mockWebServer();
  let captured = null;
  registerAvatarSuggestRoutes({
    webServer,
    streamText: async (opts) => { captured = opts; return OK_SVG; },
    currentSelection: () => ({ provider: 'p1', model: 'm1' }),
    listModels: null,
  });
  const res = await webServer.call('/dsh-dev-agent-mode/api/avatar-suggest', { prompt: '猫', provider: 'p2' });
  assert.equal(res.status, 200);
  assert.equal(captured.provider, 'p1'); // 回退默认
  assert.equal(captured.model, 'm1');
});
test('路由: GET 方法 405', async () => {
  const webServer = mockWebServer();
  registerAvatarSuggestRoutes({ webServer, streamText: async () => OK_SVG, currentSelection: () => ({ provider: 'p', model: 'm' }) });
  const res = await webServer.call('/dsh-dev-agent-mode/api/avatar-suggest', null, 'GET');
  assert.equal(res.status, 405);
});
test('路由: prompt 缺失/空/超长 400', async () => {
  const webServer = mockWebServer();
  registerAvatarSuggestRoutes({ webServer, streamText: async () => OK_SVG, currentSelection: () => ({ provider: 'p', model: 'm' }) });
  for (const body of [{}, { prompt: '' }, { prompt: '   ' }, { prompt: 'x'.repeat(401) }, { prompt: 123 }]) {
    const res = await webServer.call('/dsh-dev-agent-mode/api/avatar-suggest', body);
    assert.equal(res.status, 400, JSON.stringify(body).slice(0, 40));
    assert.equal(res.json()?.error, 'bad-prompt');
  }
});
test('路由: 无 LLM 服务 503 no-model', async () => {
  const webServer = mockWebServer();
  registerAvatarSuggestRoutes({ webServer, streamText: null, currentSelection: () => ({ provider: 'p', model: 'm' }) });
  const res = await webServer.call('/dsh-dev-agent-mode/api/avatar-suggest', { prompt: '小狐狸' });
  assert.equal(res.status, 503);
  assert.equal(res.json()?.error, 'no-model');
});
test('路由: 无默认模型选择 503 no-model', async () => {
  const webServer = mockWebServer();
  registerAvatarSuggestRoutes({ webServer, streamText: async () => OK_SVG, currentSelection: null });
  const res = await webServer.call('/dsh-dev-agent-mode/api/avatar-suggest', { prompt: '小狐狸' });
  assert.equal(res.status, 503);
});
test('路由: 默认模型选择为空对象 503', async () => {
  const webServer = mockWebServer();
  registerAvatarSuggestRoutes({ webServer, streamText: async () => OK_SVG, currentSelection: () => null });
  const res = await webServer.call('/dsh-dev-agent-mode/api/avatar-suggest', { prompt: '小狐狸' });
  assert.equal(res.status, 503);
});
test('路由: 合法请求 → 200 + data:image/svg+xml', async () => {
  const webServer = mockWebServer();
  registerAvatarSuggestRoutes({ webServer, streamText: async () => '这是头像：\n' + OK_SVG, currentSelection: () => ({ provider: 'deepseek', model: 'deepseek-chat' }) });
  const res = await webServer.call('/dsh-dev-agent-mode/api/avatar-suggest', { prompt: '蓝色机器人' });
  assert.equal(res.status, 200);
  const body = res.json();
  assert.ok(body?.dataUrl?.startsWith('data:image/svg+xml'), body?.dataUrl?.slice(0, 60));
  assert.ok(decodeURIComponent(body.dataUrl).includes('<circle'));
  assert.equal(body.promptEcho, '蓝色机器人');
});
test('路由: LLM 输出无 SVG → 422', async () => {
  const webServer = mockWebServer();
  registerAvatarSuggestRoutes({ webServer, streamText: async () => '抱歉我不会画', currentSelection: () => ({ provider: 'p', model: 'm' }) });
  const res = await webServer.call('/dsh-dev-agent-mode/api/avatar-suggest', { prompt: '猫' });
  assert.equal(res.status, 422);
  assert.equal(res.json()?.error, 'no-svg');
});
test('路由: LLM 抛限流错误 → 429', async () => {
  const webServer = mockWebServer();
  registerAvatarSuggestRoutes({ webServer, streamText: async () => { throw new Error('rate limit exceeded (429)'); }, currentSelection: () => ({ provider: 'p', model: 'm' }) });
  const res = await webServer.call('/dsh-dev-agent-mode/api/avatar-suggest', { prompt: '猫' });
  assert.equal(res.status, 429);
  assert.equal(res.json()?.error, 'rate-limited');
});
test('路由: LLM 抛其它错误 → 502', async () => {
  const webServer = mockWebServer();
  registerAvatarSuggestRoutes({ webServer, streamText: async () => { throw new Error('connection reset'); }, currentSelection: () => ({ provider: 'p', model: 'm' }) });
  const res = await webServer.call('/dsh-dev-agent-mode/api/avatar-suggest', { prompt: '猫' });
  assert.equal(res.status, 502);
  assert.equal(res.json()?.error, 'llm-failed');
});
test('路由: prompt 透传给 LLM（含 system 约束）', async () => {
  const webServer = mockWebServer();
  let captured = null;
  registerAvatarSuggestRoutes({
    webServer,
    streamText: async (opts) => { captured = opts; return OK_SVG; },
    currentSelection: () => ({ provider: 'p1', model: 'm1' }),
  });
  await webServer.call('/dsh-dev-agent-mode/api/avatar-suggest', { prompt: '紫色太空猫' });
  assert.equal(captured.provider, 'p1');
  assert.equal(captured.model, 'm1');
  assert.ok(captured.prompt.includes('紫色太空猫'));
  assert.ok(captured.system.includes('64x64'));
  assert.ok(captured.system.includes('SVG'));
});
