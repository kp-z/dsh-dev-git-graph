/**
 * 客户端那一半的装配测试。
 *
 * 客户端是纯 JS 的模块加载器负载，既不进 tsc 的类型检查，也没法在 node 里真跑渲染，所以它
 * 最容易悄悄坏掉——改错了 `inject`，面板页签就直接不出现，而服务端一切正常、日志也不报错。
 * 这里用假的 `window.__ModuleLoader__` 与假 React 把模块加载一遍，钉四件事：模块身份、
 * 依赖声明、**页签类型确实注册了**（这正是页签一直不出现的原因），以及页签内容用的 key
 * 与页签 id 一致。
 *
 * 环境只在文件加载时装一次，模块也只加载一次（ESM 有缓存，第二次 import 不会再执行；
 * 而 apply 里的 installStyles 也需要 document 一直在场）。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'

interface ClientModule {
  name: string
  inject: string[]
  apply: (ctx: unknown) => void
}

interface Loaded {
  id: string
  factory: (require: (name: string) => unknown) => ClientModule
}

const React = {
  createElement: (...args: unknown[]) => ({ args }),
  useState: (initial: unknown) => [initial, () => undefined],
  useEffect: () => undefined,
  useRef: () => ({ current: null }),
}

const stylesInstalled: string[] = []
const styleNodes = new Map<string, { id: string; textContent: string; remove(): void }>()

const globals = globalThis as unknown as Record<string, unknown>
globals.document = {
  getElementById: (id: string) => styleNodes.get(id) ?? null,
  createElement: () => {
    const node = {
      id: '',
      textContent: '',
      remove: () => {
        styleNodes.delete(node.id)
      },
    }
    return node
  },
  head: {
    appendChild: (node: { id: string; textContent: string }) => {
      styleNodes.set(node.id, node)
      stylesInstalled.push(node.id)
    },
  },
  body: { classList: { contains: () => false } },
}
globals.getComputedStyle = () => ({ colorScheme: 'light' })
globals.MutationObserver = class {
  observe(): void {}
  disconnect(): void {}
}

let loaded: Loaded | undefined
globals.window = {
  __ModuleLoader__: {
    load(spec: Loaded) {
      loaded = spec
    },
  },
  addEventListener: () => undefined,
}

await import('../lib/client.js')

function clientModule(): ClientModule {
  assert.ok(loaded, '客户端模块应当通过 __ModuleLoader__.load 注册自己')
  return loaded.factory((name) => {
    if (name === 'react') return React
    throw new Error(`没有预料的依赖：${name}`)
  })
}

test('客户端：模块身份与依赖声明正确', () => {
  assert.equal(loaded?.id, 'dsh-contract-butler')
  const module = clientModule()
  assert.equal(module.name, 'contract-butler')
  assert.deepEqual(module.inject, ['slots', 'sidebarRightTabs'])
  assert.equal(typeof module.apply, 'function')
})

test('客户端：apply 会注册页签类型，并把内容挂在同一个 id 上', () => {
  const module = clientModule()
  const tabTypes: { id: string; kind: string; title?: () => string; guide?: unknown[] }[] = []
  const slotRegs: { name: string; key?: string }[] = []

  const sidebarRightTabs = {
    register(definition: { id: string; kind: string; title?: () => string; guide?: unknown[] }) {
      tabTypes.push(definition)
      return () => undefined
    },
  }
  const slots = {
    inject(_name: string, cb: () => unknown) {
      cb()
      return () => undefined
    },
    register(spec: { name: string; key?: string }) {
      slotRegs.push(spec)
      return () => undefined
    },
  }

  module.apply({
    get: (name: string) => {
      if (name === 'slots') return slots
      if (name === 'sidebarRightTabs') return sidebarRightTabs
      return undefined
    },
    effect: (fn: () => unknown) => {
      fn()
      return () => undefined
    },
  })

  // 这是关键：只注册内容槽而不注册页签类型，右侧栏里什么都不会出现。
  assert.equal(tabTypes.length, 1, '必须注册一次页签类型')
  const type = tabTypes[0]!
  assert.equal(type.id, 'dsh-contract-butler')
  assert.ok(type.kind.length > 0, 'kind 不能为空')
  assert.equal(typeof type.title, 'function')
  assert.equal(type.title?.(), '契约')
  assert.ok(Array.isArray(type.guide) && type.guide.length > 0, 'guide 是侧栏添加页签里的入口')

  // 页签内容的名字与 key 必须与页签类型对得上，否则侧栏找不到内容。
  assert.equal(slotRegs.length, 1)
  assert.equal(slotRegs[0]!.name, 'sidebar.right.pane.tab')
  assert.equal(slotRegs[0]!.key, type.id)

  assert.deepEqual(stylesInstalled, ['dsh-contract-butler-style'])
})

test('客户端：宿主没有这些服务时安静退出，不抛错', () => {
  // 宿主版本不匹配时也应当只是不出来，而不是把整个界面带崩。
  clientModule().apply({ get: () => undefined, effect: () => () => undefined })
})

test('客户端：把当前会话的工作目录带进面板 URL', () => {
  // 右侧栏把 sessionId 交给页签内容，内容再去会话服务里取 cwd——面板靠它定位当前项目。
  const module = clientModule()
  let Panel: ((props: unknown) => unknown) | undefined
  const slots = {
    inject(_name: string, cb: () => unknown) {
      cb()
      return () => undefined
    },
    register(_spec: unknown, component: (props: unknown) => unknown) {
      Panel = component
      return () => undefined
    },
  }
  const snapshot = { byId: { 'session-7': { cwd: '/Users/kp/DEV/当前 项目' } } }
  module.apply({
    get: (name: string) => {
      if (name === 'slots') return slots
      if (name === 'sessions') return { list: { getSnapshot: () => snapshot } }
      return undefined
    },
    effect: (fn: () => unknown) => {
      fn()
      return () => undefined
    },
  })

  assert.ok(Panel, '页签内容组件应当被注册')

  /** 在假 React 造出的元素树里找 iframe 的 src。 */
  function findFrameSrc(node: unknown): string | undefined {
    const el = node as { args?: unknown[] } | undefined
    const args = el?.args
    if (!Array.isArray(args)) return undefined
    if (args[0] === 'iframe') return (args[1] as { src?: string }).src
    for (let i = 2; i < args.length; i++) {
      const found = findFrameSrc(args[i])
      if (found !== undefined) return found
    }
    return undefined
  }

  const src = findFrameSrc(Panel({ sessionId: 'session-7' }))
  assert.ok(src, '应当渲染出 iframe')
  assert.ok(src.startsWith('/dsh-contract-butler/panel?'), `URL 应当带查询参数：${src}`)
  assert.ok(src.includes('cwd=' + encodeURIComponent('/Users/kp/DEV/当前 项目')), `应当带当前目录：${src}`)

  // 没有 sessionId 时退回不带参数的 URL，而不是崩掉。
  const bare = findFrameSrc(Panel({}))
  assert.equal(bare, '/dsh-contract-butler/panel')
})