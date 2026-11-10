/**
 * Client 半体的契约测试：装进假的 ModuleLoader / React / ctx 跑一遍 apply()。
 *
 * 从「整页 HTML + iframe」改成「宿主页面里的 React 组件」之后，这一层要钉住两件事：
 *   1. 右侧栏页签还是老样子（iframe → /dsh-feishu/panel），别被重写碰坏；
 *   2. 左侧栏总览走 **slots 注册的 React 组件**，iframe 那条路彻底消失。
 *
 * 跑法：node test/client.mjs（需要先 `pnpm run build:client` 生成 lib/client.iife.js）
 */
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createSidebarHalf } from '../src/client/sidebar-tab.js'

const BUNDLE = new URL('../lib/client.iife.js', import.meta.url)
let source = ''
try {
  source = await readFile(BUNDLE, 'utf8')
} catch (error) {
  throw new Error('缺少构建产物 lib/client.iife.js，请先跑 pnpm run build:client')
}

/* 静态口径：产物必须是经典脚本，且总览不再有整页路由。 */
assert.ok(source.includes('__ModuleLoader__.load'), '产物必须自己注册到 ModuleLoader')
assert.ok(source.includes('/dsh-feishu/panel'), '右侧栏面板路由必须还在')
assert.ok(!source.includes('/dsh-feishu/overview'), '总览不该再有整页路由（iframe 版已删除）')
assert.ok(!source.includes('dfe-overview-frame'), '总览不该再有 iframe 容器')
console.log('✓ 产物：经典脚本 + 只有右侧栏面板路由，没有总览整页路由/iframe')

/* 同会话项目上下文：源码层单测（行为与反射都不依赖构建产物）。 */
const half = createSidebarHalf({ React: { createElement: () => ({}) }, h: () => ({}) })
const projectContext = half.workspaceContextOf({ scope: { workspaceId: 'w1', cwd: '/one' } })
assert.equal(projectContext.workspaceId, 'w1')
assert.equal(projectContext.workspacePath, '/one')
console.log('✓ 源码：workspaceContextOf 从 scope 读出项目上下文')

/* 总览面板的宿主能力位：面板在宿主页面里，开不了 iframe 那套 postMessage，
   「打开会话」直接走 uiWorkspace —— 这条接线断了按钮就是死的，所以钉在源码层。 */
const clientSrc = await readFile(new URL('../src/client/client.js', import.meta.url), 'utf8')
assert.match(clientSrc, /createOverviewPanel\(\{[^}]*\bhost\b/, '总览面板要拿到 host 能力位')
assert.match(clientSrc, /host\.__ctx = ctx/, 'apply 时要把 ctx 晚绑定给 host（factory 里没有 ctx）')
assert.match(clientSrc, /openSession\(sessionId/, 'host 要提供 openSession')
assert.match(clientSrc, /canOpenSession\(\)/, 'host 要能回答「当前宿主支不支持打开会话」')
console.log('✓ 源码：总览面板的 host 能力位（openSession / canOpenSession）已接线')

const captured = []
const slotRegistrations = []
const slots = {
  inject(name, factory) {
    const dispose = factory()
    return typeof dispose === 'function' ? dispose : () => {}
  },
  register(options, component) {
    slotRegistrations.push({ options, component })
    return () => {}
  },
}
const betterSidebar = {
  registerTab(descriptor) {
    captured.push(descriptor)
    return () => {}
  },
}
const openedSessions = []
const uiWorkspace = { openSession: (id) => openedSessions.push(id) }
const ctx = {
  get(name) {
    if (name === 'betterSidebar') return betterSidebar
    if (name === 'uiWorkspace') return uiWorkspace
    if (name === 'slots') return slots
    return undefined
  },
  effect(fn) { fn() },
}

/* React 只用到 createElement / useState / useRef / useEffect / useCallback / useMemo / memo。 */
const ReactStub = {
  createElement: (type, props, ...children) => ({ type, props, children }),
  useState: (initial) => [typeof initial === 'function' ? initial() : initial, () => {}],
  useRef: (initial) => ({ current: initial }),
  useEffect: () => {},
  useCallback: (fn) => fn,
  useMemo: (fn) => fn(),
  memo: (fn) => fn,
}

const styleElement = { id: '', textContent: '' }
const appendedStyles = []
/* 宿主页面里 createElement('style') 出来的对象要能 setId/setAttribute，测试里补齐这两个。 */
function makeElement() {
  const node = { id: '', textContent: '', attrs: {} }
  node.setAttribute = (key, value) => {
    node.attrs[key] = String(value)
    if (key === 'id') node.id = String(value)
  }
  node.getAttribute = (key) => (key in node.attrs ? node.attrs[key] : null)
  node.appendChild = () => {}
  return node
}
const fakeDocument = {
  head: { appendChild: (node) => appendedStyles.push(node) },
  body: { classList: { contains: () => false } },
  documentElement: {},
  getElementById: () => null,
  createElement: () => makeElement(),
}

let loaded
const messageListeners = []
const fakeWindow = {
  location: { origin: 'http://localhost' },
  localStorage: { getItem: () => null, setItem: () => {} },
  addEventListener: (type, fn) => { if (type === 'message') messageListeners.push(fn) },
  removeEventListener: (type, fn) => {
    const i = messageListeners.indexOf(fn)
    if (i >= 0) messageListeners.splice(i, 1)
  },
  __ModuleLoader__: {
    load: ({ id, factory }) => {
      loaded = { id, exports: factory((name) => (name === 'react' ? ReactStub : (() => ({})))) }
    },
  },
}
const vm = await import('node:vm')
const sandbox = {
  window: fakeWindow,
  document: fakeDocument,
  MutationObserver: class {
    observe() {}
    disconnect() {}
  },
  getComputedStyle: () => ({ colorScheme: 'light' }),
  console,
  setTimeout,
  clearTimeout,
}
sandbox.globalThis = sandbox
vm.createContext(sandbox)
vm.runInContext(source, sandbox, { filename: 'client.iife.js' })

assert.ok(loaded, '模块没有通过 __ModuleLoader__.load 注册')
assert.equal(loaded.id, 'dsh-feishu')
const { exports } = loaded
assert.ok(Array.isArray(exports.inject) && exports.inject.includes('slots'), `inject 没声明 slots：${JSON.stringify(exports.inject)}`)
/* betterSidebar 必须**不进** inject：否则没有右侧栏插件的 profile 里总览也会被门控掉（运行时探测即可）。 */
assert.ok(!exports.inject.includes('betterSidebar'), `betterSidebar 不该进 inject（可选能力，运行时探测）：${JSON.stringify(exports.inject)}`)

exports.apply(ctx)
await new Promise((resolve) => setTimeout(resolve, 400))

/* 右侧栏页签：老口径。 */
assert.equal(captured.length, 1, `registerTab 调用次数不对：${captured.length}`)
const tab = captured[0]
assert.equal(tab.id, 'feishu')
assert.equal(tab.single, true)
assert.equal(typeof tab.component, 'function')
assert.equal(typeof tab.icon, 'function')
assert.equal(tab.title(), '飞书')
const tree = tab.component({})
assert.equal(tree.type, 'iframe')
assert.ok(String(tree.props.src).startsWith('/dsh-feishu/panel'), `页签 iframe src 不对：${tree.props.src}`)
console.log(`✓ 右侧栏页签：id=${tab.id} title=${tab.title()} → <iframe src="${tree.props.src}">`)

/* 左侧栏总览：React 组件 + 同 key 的 main 面板。 */
const panellist = slotRegistrations.find((row) => row.options.name === 'sidebar.panellist')
const mainPanel = slotRegistrations.find((row) => row.options.name === 'main')
assert.ok(panellist, '没有注册 sidebar.panellist（左侧栏不会有「飞书任务集」入口）')
assert.ok(mainPanel, '没有注册 main 面板')
assert.equal(panellist.options.id, mainPanel.options.key, 'sidebar.panellist.id 与 main.key 必须一致')
assert.equal(panellist.options.id, 'feishu-overview')
assert.equal(typeof panellist.options.label, 'function', 'label 要用 thunk（宿主会重读，日后可跟随 locale）')
assert.equal(panellist.options.label(), '飞书任务集')
assert.equal(typeof panellist.options.order, 'number')
assert.equal(typeof panellist.component, 'function')
assert.ok(typeof mainPanel.component === 'function', 'main 面板必须是组件（不能是 iframe 容器）')
console.log(`✓ 左侧栏总览：id=${panellist.options.id} label=${panellist.options.label} → React 组件（非 iframe）`)

/* 样式：宿主页面里只注入样式表，不再有 iframe 传递主题。 */
const styleIds = appendedStyles.map((node) => node.id)
assert.ok(styleIds.includes('dsh-feishu-style'), `缺少容器样式表：${styleIds.join(',')}`)
console.log(`✓ 样式注入：${styleIds.filter(Boolean).join(', ')}`)

/* 服务缺席时不能抛（否则会把宿主打成错误页）。 */
const emptyCtx = { get: () => undefined, effect: () => {} }
exports.apply(emptyCtx)
await new Promise((resolve) => setTimeout(resolve, 100))
console.log('✓ 服务缺席时 apply() 不抛')

/* 会话跳转桥：面板 postMessage → uiWorkspace.openSession，跨域消息忽略。 */
assert.ok(messageListeners.length > 0, '没有注册 message 监听，面板无法请求跳转')
for (const fn of messageListeners) {
  fn({ origin: 'http://localhost', data: { type: 'dsh-feishu:open-session', sessionId: 'feishu-abc-1' } })
  fn({ origin: 'https://evil.example', data: { type: 'dsh-feishu:open-session', sessionId: 'feishu-should-ignore' } })
}
assert.equal(openedSessions.length, 1)
assert.equal(openedSessions[0], 'feishu-abc-1')
console.log('✓ 会话跳转：面板 postMessage → uiWorkspace.openSession，跨域消息被忽略')
if (!styleIds.includes('dsh-feishu-overview-style')) {
  /* 总览样式表由 styles.js 的 injectStyles 负责；这里只确认没有第二套调色板被注入。 */
  console.log('· 总览样式表由 src/client/styles.js 注入（不在本测试口径内）')
}
console.log('CLIENT_OK')
process.exit(0)
