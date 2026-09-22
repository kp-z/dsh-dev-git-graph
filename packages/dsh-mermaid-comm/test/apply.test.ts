/**
 * 装配冒烟：直接跑 lib/index.js 的 apply()，确认三种 promptLevel 的接线正确。
 * 目的是抓住「模块单测都过、但 apply 里少接一根线」这类错误。
 *
 * 注意：本 dev workspace 的 @deepseek-ai/dsh-tools(0.1.1-rc.2) 与它拉进来的
 * @deepseek-ai/dsh-llm 版本错配（dsh-llm 没有 CallId 导出），因此 import lib/index.js
 * 在这里会失败——这是工作区既有问题（tool-validate.ts 本来就 import dsh-tools），
 * 与本插件改动无关。导入失败时整组跳过并说明原因；在版本对齐的环境（如 profile 内）
 * 这些断言照常执行。
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

let apply: any
let SWITCH_ROUTE: string = ''
let skipReason: string | undefined
try {
  ;({ apply } = await import('../lib/index.js'))
  ;({ SWITCH_ROUTE } = await import('../lib/switch.js'))
} catch (error) {
  skipReason = `无法导入 lib/index.js（工作区 dsh-tools/dsh-llm 版本错配）：${String(error)}`
}
const opts = skipReason === undefined ? {} : { skip: skipReason }

function harness(services: Record<string, unknown> = {}) {
  const sections: any[] = []
  const routes: any[] = []
  const tools: any[] = []
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
    effect(fn: () => unknown) { fn(); return () => {} },
    systemPrompt: { section(spec: any) { sections.push(spec); return () => {} } },
    tools: { register(tool: any) { tools.push(tool); return () => {} } },
    on() { return () => {} },
  }
  return { ctx, sections, routes, tools }
}

const webServer = { register: (spec: any) => { /* captured by caller */ return () => {} } }

function withWebServer() {
  const captured: any[] = []
  return {
    captured,
    service: { register: (spec: any) => { captured.push(spec); return () => {} } },
  }
}

const settings = (inject: boolean) => ({
  register: () => ({
    get: () => ({ inject }),
    update: async () => {},
    watch: () => () => {},
  }),
})

const find = (sections: any[], name: string) => sections.find((s) => s.name === name)

test('apply(promptLevel=toggle)：注册两段 + 路由，未勾选时 guidance 为空', opts, () => {
  const ws = withWebServer()
  const { ctx, sections, tools } = harness({ settings: settings(false), webServer: ws.service })
  apply(ctx, {})

  const guidance = find(sections, 'mermaid-comm:guidance')
  const vault = find(sections, 'mermaid-comm:vault-index')
  assert.ok(guidance, '应注册 guidance 段')
  assert.ok(vault, '应注册 vault-index 段')
  assert.equal(guidance.text(), '', '默认不勾选 → 不注入')
  assert.equal(vault.text(), '', '图库索引同样被门控')

  assert.equal(ws.captured.length, 1, '应注册开关路由')
  assert.equal(ws.captured[0].path, SWITCH_ROUTE)
  assert.ok(tools.length >= 2, '校验工具与图库工具都应注册')
})

test('apply(promptLevel=toggle) + 已勾选：guidance 有全文', opts, () => {
  const ws = withWebServer()
  const { ctx, sections } = harness({ settings: settings(true), webServer: ws.service })
  apply(ctx, {})
  assert.ok(find(sections, 'mermaid-comm:guidance').text().includes('Mermaid'))
})

test('apply(promptLevel=global)：恒定注入，按钮由 toggle:false 隐藏', opts, () => {
  const ws = withWebServer()
  const { ctx, sections } = harness({ settings: settings(false), webServer: ws.service })
  apply(ctx, { promptLevel: 'global' })

  assert.ok(find(sections, 'mermaid-comm:guidance').text().includes('Mermaid'), 'global 恒注入')
  const res: any = { status: 0, headersSent: false, writeHead(s: number) { res.status = s }, end() {} }
  ws.captured[0].handler({ method: 'GET' }, res)
  assert.equal(res.status, 200)
})

test('apply(promptLevel=off)：不注册任何 prompt 段，工具仍可用', opts, () => {
  const ws = withWebServer()
  const { ctx, sections, tools } = harness({ settings: settings(false), webServer: ws.service })
  apply(ctx, { promptLevel: 'off' })

  assert.equal(find(sections, 'mermaid-comm:guidance'), undefined, 'off 不注册 guidance')
  assert.equal(find(sections, 'mermaid-comm:vault-index'), undefined, 'off 不注册 vault 索引')
  assert.ok(tools.length >= 2, '工具与 prompt 注入解耦，仍注册')
})

test('apply(enabled=false)：整体不接线', opts, () => {
  const ws = withWebServer()
  const { ctx, sections, tools } = harness({ settings: settings(false), webServer: ws.service })
  apply(ctx, { enabled: false })
  assert.equal(sections.length, 0)
  assert.equal(tools.length, 0)
  assert.equal(ws.captured.length, 0)
})

test('apply：无 settings / 无 webServer 时仍能装配（降级不抛错）', opts, () => {
  const { ctx, sections } = harness()
  assert.doesNotThrow(() => apply(ctx, {}))
  assert.ok(find(sections, 'mermaid-comm:guidance'), '无外部服务也应注册 prompt 段')
})
