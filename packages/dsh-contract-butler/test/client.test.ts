/**
 * 客户端那一半的装配测试。
 *
 * 客户端是纯 JS 的模块加载器负载，既不进 tsc 的类型检查，也没法在 node 里真跑渲染，所以它
 * 最容易悄悄坏掉——改错了 `inject`，面板页签就直接不出现，而服务端一切正常、日志也不报错。
 * 这里用假的 `window.__ModuleLoader__` 与假 React 把模块加载一遍，只钉三件事：模块身份、
 * 依赖声明、以及"确实注册了页签和标题"。
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
  assert.deepEqual(module.inject, ['slots'])
  assert.equal(typeof module.apply, 'function')
})

test('客户端：apply 会注册右侧栏的页签与它的标题', () => {
  const module = clientModule()
  const registrations: { name: string; key?: string }[] = []
  const slots = {
    inject(_name: string, cb: () => unknown) {
      cb()
      return () => undefined
    },
    register(spec: { name: string; key?: string }) {
      registrations.push(spec)
      return () => undefined
    },
  }
  module.apply({
    get: (name: string) => (name === 'slots' ? slots : undefined),
    effect: (fn: () => unknown) => {
      fn()
      return () => undefined
    },
  })

  const names = registrations.map((item) => item.name).sort()
  assert.deepEqual(names, ['sidebar.right.pane.tab', 'sidebar.right.pane.tab.title'])
  for (const item of registrations) assert.equal(item.key, 'dsh-contract-butler')
  // 样式只该装一次。
  assert.deepEqual(stylesInstalled, ['dsh-contract-butler-style'])
})

test('客户端：宿主没有 slots 服务时安静退出，不抛错', () => {
  // 宿主版本不匹配时也应当只是不出来，而不是把整个界面带崩。
  clientModule().apply({ get: () => undefined, effect: () => () => undefined })
})
