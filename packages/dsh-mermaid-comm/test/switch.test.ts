/**
 * 注入开关（switch.ts）+ prompt 门控（prompt.ts）单测。
 *
 * 覆盖：settings 持久化路径与降级路径、watch 跟随、HTTP 路由的 GET/POST/非法体/非法方法、
 * 非 toggle 模式下 POST 不生效、以及 prompt 段在未勾选时确实产出空串（= 不注入）。
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Readable } from 'node:stream'
import { registerInjectSwitch, registerSwitchRoutes, SWITCH_ROUTE } from '../lib/switch.js'
import { registerMermaidPrompt } from '../lib/prompt.js'

/** 最小 cordis ctx 替身：只实现本插件用到的 inject / effect / systemPrompt.section。 */
function fakeCtx(services: Record<string, unknown> = {}) {
  const sections: any[] = []
  const effects: Array<() => unknown> = []
  const ctx: any = {
    inject(deps: string[], cb: (host: any) => void) {
      const host: any = {}
      for (const dep of deps) {
        if (services[dep] === undefined) return () => {}
        host[dep] = services[dep]
      }
      cb(host)
      return () => {}
    },
    effect(fn: () => unknown) {
      effects.push(fn())
      return () => {}
    },
    systemPrompt: {
      section(spec: any) { sections.push(spec); return () => {} },
    },
  }
  return { ctx, sections, effects }
}

/** 假 settings：记录 update，暴露 watch 回调。 */
function fakeSettings(initial: boolean) {
  const updates: object[] = []
  let watcher: ((next: { inject: boolean }) => void) | undefined
  const service = {
    register(_ns: string, _schema: unknown, _opts?: unknown) {
      return {
        get: () => ({ inject: initial }),
        update: async (patch: object) => { updates.push(patch) },
        watch: (cb: (next: { inject: boolean }) => void) => { watcher = cb; return () => {} },
      }
    },
  }
  return { service, updates, fire: (next: { inject: boolean }) => watcher?.(next) }
}

function fakeRes() {
  const res: any = { status: 0, headers: {} as any, body: '', headersSent: false }
  res.writeHead = (status: number, headers?: any) => {
    res.status = status
    res.headers = headers ?? {}
    res.headersSent = true
  }
  res.end = (chunk?: string) => { if (chunk) res.body += chunk }
  return res
}

function fakeReq(method: string, body?: unknown) {
  // 真实 IncomingMessage 的 chunk 是 Buffer，假件也照此（readJsonBody 按字节计长）。
  const req: any = body === undefined
    ? new Readable({ read() {} })
    : Readable.from([Buffer.from(JSON.stringify(body), 'utf8')])
  req.method = method
  return req
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 10))

// ---------- prompt 门控 ----------

test('prompt 段：未勾选时产出空串（= 不注入），勾选后产出全文', () => {
  let on = false
  const { ctx, sections } = fakeCtx()
  registerMermaidPrompt(ctx, { diagramTypes: [], validateBeforeRender: true, isOn: () => on })

  const spec = sections.find((s) => s.name === 'mermaid-comm:guidance')
  assert.ok(spec, '应注册 mermaid-comm:guidance 段')
  assert.equal(spec.text(), '', '未勾选 → 空串')
  on = true
  assert.ok(spec.text().includes('Mermaid'), '勾选后 → 全文')
})

test('prompt 段：不传 isOn 时保持老行为（恒定注入）', () => {
  const { ctx, sections } = fakeCtx()
  registerMermaidPrompt(ctx, { diagramTypes: [], validateBeforeRender: false })
  const spec = sections.find((s) => s.name === 'mermaid-comm:guidance')
  assert.ok(spec.text().includes('Mermaid'))
})

// ---------- 开关状态 ----------

test('开关：settings 可用时以已存值为准，watch 跟随，set 落盘', async () => {
  const { service, updates, fire } = fakeSettings(true)
  const { ctx } = fakeCtx({ settings: service })
  const sw = registerInjectSwitch(ctx, { defaultInject: false })

  assert.equal(sw.isOn(), true, '已存 true 覆盖 defaultInject false')

  fire({ inject: false })
  assert.equal(sw.isOn(), false, 'watch 把外部改动同步进来')

  await sw.set(true)
  assert.equal(sw.isOn(), true, 'set 立刻改进程内真值')
  assert.deepEqual(updates.at(-1), { inject: true }, 'set 同时落盘')
})

test('开关：settings 缺失时降级为进程内状态，功能仍可用', async () => {
  const { ctx } = fakeCtx()
  const sw = registerInjectSwitch(ctx, { defaultInject: false })
  assert.equal(sw.isOn(), false)
  await sw.set(true)
  assert.equal(sw.isOn(), true)
})

test('开关：settings.register 抛错时降级而不炸掉插件', async () => {
  const service = { register() { throw new Error('namespace taken') } }
  const { ctx } = fakeCtx({ settings: service })
  const sw = registerInjectSwitch(ctx, { defaultInject: true })
  assert.equal(sw.isOn(), true)
  await sw.set(false)
  assert.equal(sw.isOn(), false)
})

// ---------- HTTP 路由 ----------

function routeOf(sw: { isOn(): boolean; set(on: boolean): Promise<void> }, toggle: boolean) {
  const registered: any[] = []
  const { ctx } = fakeCtx({ webServer: { register: (spec: any) => { registered.push(spec); return () => {} } } })
  registerSwitchRoutes(ctx, sw, { toggle })
  return registered[0]
}

test('路由：GET 返回 {toggle, inject}，路径与约定一致', async () => {
  const route = routeOf({ isOn: () => true, set: async () => {} }, true)
  assert.equal(route.path, SWITCH_ROUTE)
  assert.equal(route.kind, 'exact')

  const res = fakeRes()
  route.handler(fakeReq('GET'), res)
  assert.equal(res.status, 200)
  assert.deepEqual(JSON.parse(res.body), { toggle: true, inject: true })
})

test('路由：POST 写入并回读真值', async () => {
  let flag = false
  const route = routeOf({ isOn: () => flag, set: async (v) => { flag = v } }, true)

  const res = fakeRes()
  route.handler(fakeReq('POST', { inject: true }), res)
  await tick()
  assert.equal(res.status, 200)
  assert.deepEqual(JSON.parse(res.body), { toggle: true, inject: true })
})

test('路由：POST 非法体 → 400 且不改状态', async () => {
  let flag = false
  const route = routeOf({ isOn: () => flag, set: async (v) => { flag = v } }, true)

  const res = fakeRes()
  route.handler(fakeReq('POST', { inject: 'yes' }), res)
  await tick()
  assert.equal(res.status, 400)
  assert.equal(flag, false)
})

test('路由：非 toggle 模式（promptLevel=global/off）POST 不生效，仅回读', async () => {
  let flag = false
  const route = routeOf({ isOn: () => flag, set: async (v) => { flag = v } }, false)

  const res = fakeRes()
  route.handler(fakeReq('POST', { inject: true }), res)
  await tick()
  assert.equal(res.status, 200)
  assert.deepEqual(JSON.parse(res.body), { toggle: false, inject: false })
  assert.equal(flag, false, '配置钉死 promptLevel 时客户端不能改写')
})

test('路由：非法方法 → 405', () => {
  const route = routeOf({ isOn: () => false, set: async () => {} }, true)
  const res = fakeRes()
  route.handler(fakeReq('DELETE'), res)
  assert.equal(res.status, 405)
})

test('路由：无 webServer 服务时不注册、不抛错', () => {
  const { ctx } = fakeCtx()
  assert.doesNotThrow(() => registerSwitchRoutes(ctx, { isOn: () => false, set: async () => {} }, { toggle: true }))
})
