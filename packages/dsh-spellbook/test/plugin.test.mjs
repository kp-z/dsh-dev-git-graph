/**
 * dsh-spellbook 插件层的测试。
 *
 * 护两件事：
 *   1. 宿主那条静态路由 —— 找得到文件、翻不出 dist、只认 GET/HEAD。
 *      这条写错了不会抛错，只会整套 404，或者在最坏的情况下把包外的文件端出去。
 *   2. 客户端那半边给侧边栏注册的 tab —— id/标题/图标齐不齐。
 *      注册失败是本插件唯一的失败方式，而它是静默的（没有别的入口），所以必须钉住。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')

/** 造一对假的 req/res，把 handler 的响应收成结构化对象。 */
function fakeExchange(method, url) {
  const captured = { status: null, headers: null, body: null }
  const res = {
    writeHead(status, headers) {
      captured.status = status
      captured.headers = headers
    },
    end(body) {
      captured.body = body === undefined ? '' : String(body)
    },
  }
  return { req: { method, url }, res, captured }
}

/** 装上插件，拿到它注册到 webServer 上的那条路由。 */
async function mount() {
  const mod = await import(path.join(ROOT, 'lib', 'index.js'))
  let route = null
  const ctx = {
    inject(names, cb) {
      cb({ webServer: { register: (spec) => { route = spec; return () => {} } } })
    },
    on() {},
  }
  mod.apply(ctx)
  return { mod, route }
}

/** handler 是异步的（内部 void async IIFE），等一轮微任务再读结果。 */
async function call(route, method, url) {
  const { req, res, captured } = fakeExchange(method, url)
  route.handler(req, res)
  await new Promise((resolve) => setTimeout(resolve, 30))
  return captured
}

test('宿主注册的是 /dsh-spellbook 前缀路由', async () => {
  const { mod, route } = await mount()
  assert.equal(mod.name, 'dsh-spellbook')
  assert.deepEqual(mod.inject, ['webServer'])
  assert.equal(typeof mod.apply, 'function')
  assert.ok(route, 'apply 没有注册任何路由')
  assert.equal(route.kind, 'prefix')
  assert.equal(route.path, '/dsh-spellbook')
  assert.equal(typeof route.handler, 'function')
})

test('目录页与条目页都能取到，且是 HTML', async () => {
  const { route } = await mount()

  const index = await call(route, 'GET', '/dsh-spellbook/')
  assert.equal(index.status, 200)
  assert.match(index.headers['content-type'], /text\/html/)
  assert.match(index.body, /咒语书/)

  // 目录式链接（无扩展名、目录结尾）也要能落到 index.html
  const entry = await call(route, 'GET', '/dsh-spellbook/spell/liquid-glass/')
  assert.equal(entry.status, 200)
  assert.match(entry.body, /<html/i)
})

test('静态资源按扩展名给对的 MIME', async () => {
  const { route } = await mount()

  const css = await call(route, 'GET', '/dsh-spellbook/styles/spellbook.css')
  assert.equal(css.status, 200)
  assert.match(css.headers['content-type'], /text\/css/)

  const js = await call(route, 'GET', '/dsh-spellbook/site.js')
  assert.equal(js.status, 200)
  assert.match(js.headers['content-type'], /javascript/)

  const json = await call(route, 'GET', '/dsh-spellbook/search-index.json')
  assert.equal(json.status, 200)
  assert.match(json.headers['content-type'], /application\/json/)

  // 站点是构建产物、路径不带指纹，所以必须 no-store（重建后刷新就能看到新的）
  assert.equal(json.headers['cache-control'], 'no-store')
})

test('预览文档能取到，且自身不含 allow-same-origin', async () => {
  const { route } = await mount()

  const demo = await call(route, 'GET', '/dsh-spellbook/spell/liquid-glass/demo.html')
  assert.equal(demo.status, 200)
  assert.match(demo.headers['content-type'], /text\/html/)

  // 隔离边界在**外层那页**的 iframe 标签上（sandbox="allow-scripts"），
  // 不在 demo 文档自身里 —— 所以这里查的是「文档内没有同源字样」，
  // 而「包住它的 iframe 写着 allow-scripts」由 layout 测试与整站扫描守着。
  assert.equal(
    /allow-same-origin/.test(demo.body),
    false,
    '预览文档里出现了 allow-same-origin',
  )
})

test('翻不出 dist：各种越界写法都 404', async () => {
  const { route } = await mount()

  const attacks = [
    '/dsh-spellbook/../package.json',
    '/dsh-spellbook/../../package.json',
    '/dsh-spellbook/%2e%2e/package.json',
    '/dsh-spellbook/../content/effects/liquid-glass.md',
    '/dsh-spellbook/..%2f..%2fetc/passwd',
    '/dsh-spellbook/./../../serve.mjs',
  ]
  for (const url of attacks) {
    const out = await call(route, 'GET', url)
    assert.equal(out.status, 404, `${url} 没有被挡住（状态 ${out.status}）`)
    assert.equal(/spellbook"|"main"|process\.env/.test(out.body), false, `${url} 泄漏了包外内容`)
  }
})

test('前缀之外一律不管（不是本插件的路由）', async () => {
  const { route } = await mount()
  for (const url of ['/', '/spell/liquid-glass/', '/dsh-dev-git-graph/gg/']) {
    const out = await call(route, 'GET', url)
    assert.equal(out.status, 404, `${url} 不该由本插件处理`)
  }
})

test('不存在的东西 404，且 404 页面能回目录', async () => {
  const { route } = await mount()
  const out = await call(route, 'GET', '/dsh-spellbook/nope/nothing-here')
  assert.equal(out.status, 404)
  assert.match(out.body, /\/dsh-spellbook\//)
})

test('只认 GET 与 HEAD，其余 405 并带 Allow', async () => {
  const { route } = await mount()
  for (const method of ['POST', 'PUT', 'DELETE', 'PATCH']) {
    const out = await call(route, method, '/dsh-spellbook/')
    assert.equal(out.status, 405, `${method} 应当被拒`)
    assert.match(out.headers.allow, /GET/)
  }
})

test('HEAD 返回同样的头、但不带正文', async () => {
  const { route } = await mount()
  const head = await call(route, 'HEAD', '/dsh-spellbook/')
  assert.equal(head.status, 200)
  assert.match(head.headers['content-type'], /text\/html/)
  assert.equal(head.body, '')

  const get = await call(route, 'GET', '/dsh-spellbook/')
  assert.equal(head.headers['content-type'], get.headers['content-type'])
})

/* ----------------------------------------------- 客户端半边（侧边栏 tab） */

/** 把 client.js 在假宿主里跑一遍，收下它注册的 tab 与 pane。 */
function runClient() {
  const source = readFileSync(path.join(ROOT, 'lib', 'client.js'), 'utf8')
  let loaded = null
  const win = {
    __ModuleLoader__: { load: (spec) => { loaded = spec } },
    location: { origin: 'http://127.0.0.1:43120' },
    addEventListener() {},
  }
  // client.js 引用了 window / document / MutationObserver / URLSearchParams
  const doc = {
    body: null,
    head: { appendChild() {} },
    getElementById: () => null,
    createElement: () => ({ set textContent(v) {}, id: '' }),
    querySelectorAll: () => [],
  }
  const React = {
    createElement: (type, props, ...children) => ({ type, props, children }),
    useRef: (v) => ({ current: v }),
    useEffect: () => {},
  }
  const g = globalThis
  const saved = { window: g.window, document: g.document, MutationObserver: g.MutationObserver }
  g.window = win
  g.document = doc
  g.MutationObserver = class { observe() {} disconnect() {} }

  try {
    // eslint-disable-next-line no-new-func
    new Function('window', 'document', 'MutationObserver', source)(win, doc, g.MutationObserver)

    assert.ok(loaded, 'client.js 没有调用 __ModuleLoader__.load')
    assert.equal(loaded.id, 'dsh-spellbook')

    const tabs = []
    const panes = []
    const exportsObj = loaded.factory((name) => {
      if (name === 'react') return React
      throw new Error(`未知依赖 ${name}`)
    })
    const ctx = {
      betterSidebar: { registerTab: (spec) => { tabs.push(spec); return () => {} } },
      slots: {
        inject: (_name, cb) => cb(),
        register: (spec) => { panes.push(spec); return () => {} },
      },
      effect: () => {},
    }
    exportsObj.apply(ctx)
    return { exportsObj, tabs, panes }
  } finally {
    g.window = saved.window
    g.document = saved.document
    g.MutationObserver = saved.MutationObserver
  }
}

test('客户端给侧边栏注册了「咒语书」tab', () => {
  const { exportsObj, tabs } = runClient()
  assert.deepEqual(exportsObj.inject, ['slots', 'betterSidebar'])
  assert.equal(tabs.length, 1, `注册了 ${tabs.length} 个 tab，应当只有 1 个`)

  const tab = tabs[0]
  assert.equal(tab.id, 'spellbook')
  assert.equal(tab.title(), '咒语书')
  assert.equal(tab.single, true)
  assert.equal(typeof tab.order, 'number')
  assert.equal(typeof tab.component, 'function')
  // 图标要真的画出来（不是空 svg）
  const icon = tab.icon(16)
  assert.equal(icon.type, 'svg')
  assert.ok(icon.children.length >= 1, '图标里没有路径')
})

test('tab 组件渲染的是指向 /dsh-spellbook/ 的 iframe', () => {
  const { tabs } = runClient()
  // component() 返回的是 <SpellbookView/> 这个元素，要再调一次才是它渲染出的树
  const element = tabs[0].component({ scope: {} })
  assert.equal(typeof element.type, 'function')
  const tree = element.type({})

  const frame = tree.children[0]
  assert.ok(frame, '根 div 里没有 iframe')
  assert.equal(frame.type, 'iframe')
  assert.match(frame.props.src, /^\/dsh-spellbook\//)
  // embed=1 让站点收起书封那截刊头；theme 让首屏就跟宿主明暗一致
  assert.match(frame.props.src, /embed=1/)
  assert.match(frame.props.src, /theme=(dark|light)/)
  assert.equal(frame.props.title, '咒语书')

  // 关键：外层 iframe 绝不能带 sandbox —— 嵌套 sandbox 是往下取并集的，
  // 外层写了 allow-same-origin 就等于把那 332 个预览的隔离一并撤掉。
  assert.equal(frame.props.sandbox, undefined, '外层 iframe 不该有 sandbox 属性')
})

test('整站产物里没有 allow-same-origin', () => {
  // 咒语书的隔离底线：332 个预览文档全靠 `sandbox="allow-scripts"` 隔开。
  // 这条扫的是**构建产物**（而不是源码）—— 因为产物就是真正被端出去的东西，
  // 而源码里的注释提到这个词是正常的（client.js 里就有一段解释为什么不能用它）。
  //
  // 容错：开发服务器（serve.mjs）会在源码变动时重建 dist，而 build.mjs 是
  // 「先挪开再换上」的换目录式发布 —— 撞上那个窗口会读到半个目录（实测过一次：
  // 同一个测试在 69ms 内失败，而 grep 整个 dist 是 0 处命中）。
  // 所以这里遇到读不到就整轮重扫，而不是把「正在重建」误报成「产物不干净」。
  const scan = () => {
    const offenders = []
    const walk = (dir) => {
      for (const name of readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, name.name)
        if (name.isDirectory()) walk(full)
        else if (/\.(html|js|mjs|css)$/.test(name.name)) {
          if (/allow-same-origin/.test(readFileSync(full, 'utf8'))) {
            offenders.push(path.relative(ROOT, full))
          }
        }
      }
    }
    walk(path.join(ROOT, 'dist'))
    return offenders
  }

  let offenders = null
  let lastError = null
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      offenders = scan()
      break
    } catch (error) {
      // 目录被挪走的瞬间：等一下再来
      lastError = error
      const until = Date.now() + 300
      while (Date.now() < until) {
        /* 忙等：测试里没有 async 上下文，300ms 值得 */
      }
    }
  }

  assert.ok(offenders !== null, `dist/ 连扫三次都读不完整，可能构建一直在跑：${lastError?.message}`)
  assert.deepEqual(offenders, [], `这些产物里出现了 allow-same-origin：${offenders.join(', ')}`)
})

test('没装 better-sidebar 时静默退出，不抛错', () => {
  const source = readFileSync(path.join(ROOT, 'lib', 'client.js'), 'utf8')
  let loaded = null
  const win = { __ModuleLoader__: { load: (s) => { loaded = s } }, location: { origin: 'x' }, addEventListener() {} }
  const doc = {
    body: null, head: { appendChild() {} }, getElementById: () => null,
    createElement: () => ({ set textContent(v) {}, id: '' }), querySelectorAll: () => [],
  }
  const g = globalThis
  const saved = { window: g.window, document: g.document, MutationObserver: g.MutationObserver }
  g.window = win
  g.document = doc
  g.MutationObserver = class { observe() {} disconnect() {} }
  try {
    new Function('window', 'document', 'MutationObserver', source)(win, doc, g.MutationObserver)
    const React = { createElement: () => ({}), useRef: (v) => ({ current: v }), useEffect: () => {} }
    const exportsObj = loaded.factory((n) => (n === 'react' ? React : null))
    // 一个既没有 betterSidebar 也没有 slots 的 ctx
    assert.doesNotThrow(() => exportsObj.apply({}))
    assert.doesNotThrow(() => exportsObj.apply({ get: () => undefined }))
  } finally {
    g.window = saved.window
    g.document = saved.document
    g.MutationObserver = saved.MutationObserver
  }
})
