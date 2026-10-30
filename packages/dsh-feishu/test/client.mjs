/**
 * 客户端半体的单元测试：不装进浏览器，用假的 ModuleLoader / React / ctx 跑一遍 apply()。
 *
 * 验的是「注册口对不对」——历史上最贵的错误不是画错像素，而是
 * 对着一个不存在的服务名注册，页面一片安静、什么都不出现。
 *
 * 跑法：node test/client.mjs
 */
import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'

const HERE = dirname(fileURLToPath(import.meta.url))
const source = await readFile(join(HERE, '..', 'client.js'), 'utf8')

const projectStart = source.indexOf('    function workspaceContextOf(')
const projectEnd = source.indexOf('\n    var lastWorkspaceContext', projectStart)
const projectSandbox = {}
vm.createContext(projectSandbox)
vm.runInContext(source.slice(projectStart, projectEnd), projectSandbox)
const projectContext = projectSandbox.workspaceContextOf({ scope: { workspaceId: 'w1', cwd: '/one' } })
if (projectContext.workspaceId !== 'w1' || projectContext.workspacePath !== '/one') throw new Error('项目上下文未从scope传出')
if (!source.includes('workspaceId: lastWorkspaceContext.workspaceId') || !source.includes('workspace.workspacePath === lastWorkspaceContext.workspacePath')) throw new Error('同会话项目变更不会推送')

const captured = []
const registeredSlots = []

/* React 只用到 createElement / useState / useRef / useEffect / memo。 */
const ReactStub = {
  createElement: (type, props, ...children) => ({ type, props, children }),
  useState: (initial) => [typeof initial === 'function' ? initial() : initial, () => {}],
  useRef: (initial) => ({ current: initial }),
  useEffect: () => {},
  useCallback: (fn) => fn,
  memo: (fn) => fn,
}

const styleElement = { id: '', textContent: '' }
const fakeDocument = {
  head: { appendChild: () => {} },
  body: { classList: { contains: () => false } },
  documentElement: {},
  getElementById: () => null,
  createElement: () => styleElement,
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
    return undefined
  },
  effect(fn) {
    fn()
  },
}

let loaded
const messageListeners = []
const fakeWindow = {
  location: { origin: 'http://localhost' },
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
vm.runInContext(source, sandbox, { filename: 'client.js' })

if (!loaded) throw new Error('模块没有通过 __ModuleLoader__.load 注册')
if (loaded.id !== 'dsh-feishu') throw new Error(`模块 id 不对：${loaded.id}`)

const { exports } = loaded
if (!Array.isArray(exports.inject) || !exports.inject.includes('betterSidebar')) {
  throw new Error(`inject 没声明 betterSidebar：${JSON.stringify(exports.inject)}`)
}

exports.apply(ctx)
await new Promise((resolve) => setTimeout(resolve, 400))

if (captured.length !== 1) throw new Error(`registerTab 调用次数不对：${captured.length}`)
const tab = captured[0]
if (tab.id !== 'feishu') throw new Error(`tab id 不对：${tab.id}`)
if (tab.single !== true) throw new Error('tab 没有声明 single')
if (typeof tab.component !== 'function') throw new Error('tab 没有 component')
if (typeof tab.icon !== 'function') throw new Error('tab 没有 icon')
if (tab.title() !== '飞书') throw new Error(`title 不对：${tab.title()}`)
if (typeof tab.order !== 'number') throw new Error('tab 没有 order')

/* 组件必须能渲染出 iframe，且 src 指向宿主面板路由。 */
const tree = tab.component({})
if (tree.type !== 'iframe') throw new Error(`组件根节点不是 iframe：${tree.type}`)
if (!String(tree.props.src).startsWith('/dsh-feishu/panel')) throw new Error(`iframe src 不对：${tree.props.src}`)

/* 服务缺席时也不能抛（否则会把宿主打成错误页）。 */
const emptyCtx = { get: () => undefined, effect: () => {} }
exports.apply(emptyCtx)
await new Promise((resolve) => setTimeout(resolve, 100))

console.log(`✓ 模块 ${loaded.id}：inject=${JSON.stringify(exports.inject)}`)
console.log(`✓ registerTab：id=${tab.id} order=${tab.order} single=${tab.single} title=${tab.title()}`)
console.log(`✓ 组件渲染：<iframe src="${tree.props.src}">`)
console.log('✓ 服务缺席时 apply() 不抛')
/* 面板请求「打开会话」→ client 必须转给 uiWorkspace.openSession。 */
if (messageListeners.length === 0) throw new Error('没有注册 message 监听，面板无法请求跳转')
for (const fn of messageListeners) {
  fn({ origin: 'http://localhost', data: { type: 'dsh-feishu:open-session', sessionId: 'feishu-abc-1' } })
  fn({ origin: 'https://evil.example', data: { type: 'dsh-feishu:open-session', sessionId: 'feishu-should-ignore' } })
}
if (openedSessions.length !== 1 || openedSessions[0] !== 'feishu-abc-1') {
  throw new Error(`会话跳转桥不对：${JSON.stringify(openedSessions)}`)
}
console.log(`✓ 会话跳转：面板 postMessage → uiWorkspace.openSession('${openedSessions[0]}')，跨域消息被忽略`)
console.log('CLIENT_OK')
process.exit(0)
