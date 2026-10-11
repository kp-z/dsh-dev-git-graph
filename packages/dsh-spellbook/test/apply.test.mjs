/**
 * 「应用到对话」这条桥的测试。
 *
 * 护的东西只有一样，但它最容易坏：**回执**。
 *
 * 站点那侧拿不到 composer 的 inputActions，只能把咒语正文 postMessage 给宿主，
 * 再由宿主插进输入框。于是「成功」这件事在站点那侧完全不可观测 —— 按钮只能
 * 靠宿主回话。回执一旦错了（回得太早、回给了别人、拒了却回成功），
 * 表现就是「点了有反应，输入框里却是空的」，而这条路不会抛任何异常。
 *
 * 所以逐条钉住：来源不对不理、原点不对不理、形状不对回 bad-request、
 * 没有会话回 no-sink、插不进去回 rejected，成功时**真的调了 insertText**，
 * 以及 mode=send 时会接着 submit。
 *
 * 另外钉两件构建产物上的事：embed 要跨页记住（站内跳转丢查询串，而丢了 embed
 * 就等于侧边栏里那截「书封」重新冒出来），以及应用按钮默认藏着（自己开标签页
 * 看站时没有对话可应用）。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const ORIGIN = 'http://127.0.0.1:43120'
/** 用 lib/ 而不是 src/：被真正端出去的是它，而它由 build 从 src 拷过来。 */
const CLIENT = path.join(ROOT, 'lib', 'client.js')

/**
 * 把 client.js 在一个假宿主里跑起来。
 *
 * 与 plugin.test.mjs 里那个跑法有两处不同，都是这条桥需要的：
 *   1. window.addEventListener 要**收下**监听器，否则没法派发消息；
 *   2. useEffect 不立刻跑，而是排队 —— SpellbookView 的 effect 要从 ref 里读
 *      那个 iframe，而 ref 得等组件树返回之后才拿得到。立刻跑的话它读到的
 *      永远是 null，spellbookFrame 也就永远设不上，整条桥在测试里根本不通；
 *      那样测出来的是一片假的绿。
 */
function bootClient() {
  const source = readFileSync(CLIENT, 'utf8')

  const listeners = new Map()
  let loaded = null
  const win = {
    __ModuleLoader__: { load: (spec) => { loaded = spec } },
    location: { origin: ORIGIN },
    addEventListener(type, fn) {
      if (!listeners.has(type)) listeners.set(type, new Set())
      listeners.get(type).add(fn)
    },
    removeEventListener(type, fn) {
      listeners.get(type)?.delete(fn)
    },
  }

  const effects = []
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
    useEffect: (fn) => { effects.push(fn) },
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
        // register 收的是 (spec, component)，组件也要留下 —— 不留下就没法
        // 把 inputActions 递给它，composerSink 也就永远是 null。
        register: (spec, component) => { panes.push({ ...spec, component }); return () => {} },
      },
      effect: () => {},
    }
    exportsObj.apply(ctx)

    return {
      exportsObj, tabs, panes, listeners, effects, React,
      restore() {
        g.window = saved.window
        g.document = saved.document
        g.MutationObserver = saved.MutationObserver
      },
    }
  } catch (error) {
    g.window = saved.window
    g.document = saved.document
    g.MutationObserver = saved.MutationObserver
    throw error
  }
}

/** 假的输入框能力：记下每次调用，便于断言「真的插了」。 */
function fakeInputActions({ insertSucceeds = true } = {}) {
  const calls = { capture: 0, insert: [], submit: 0 }
  return {
    calls,
    captureInsertion() {
      calls.capture += 1
      return { draftRef: 'span' + calls.capture }
    },
    insertText(text, span) {
      calls.insert.push({ text, span })
      return insertSucceeds
    },
    submit() { calls.submit += 1 },
    setDraft() {},
    addAttachments() {},
    removeAttachment() {},
    pruneAttachments() {},
  }
}

/** 跑掉排队中的 effect，并把清理函数收起来 —— 测卸载时要手动调它们。 */
function drainEffects(env) {
  const cleanups = []
  for (const fn of env.effects.splice(0)) {
    const cleanup = fn()
    if (typeof cleanup === 'function') cleanups.push(cleanup)
  }
  return cleanups
}

/** 挂上侧边栏 tab 那一半，拿到 message 监听器与那个 iframe。 */
function mountTab(env) {
  const { tabs, listeners } = env
  const element = tabs[0].component({ scope: {} })
  const tree = element.type({})
  const iframe = tree.children[0]
  const frameWindow = { postMessage() {} }
  iframe.props.ref.current = {
    contentWindow: frameWindow,
    contentDocument: { readyState: 'complete' },
    addEventListener() {}, removeEventListener() {},
  }
  drainEffects(env)

  const listener = [...(listeners.get('message') ?? [])][0]
  assert.ok(listener, '没有挂 message 监听器')

  const replies = []
  frameWindow.postMessage = (payload) => { replies.push(payload) }

  const ask = (data, overrides = {}) => listener({
    source: frameWindow,
    origin: ORIGIN,
    data: { type: 'spellbook:apply', ...data },
    ...overrides,
  })

  return { listener, replies, frameWindow, ask }
}

/**
 * 把桥立起来：composer 槽位与侧边栏 tab 各挂一次，再把排队的 effect 跑掉。
 * 跑完通道与 spellbookFrame 就都设上了，与真宿主里的先后一致。
 */
function mountBridge(env, { withComposer = true, insertSucceeds = true } = {}) {
  const { panes } = env
  const actions = fakeInputActions({ insertSucceeds })

  if (withComposer) {
    const seat = panes.find((p) => p.id === 'spellbook-apply-seat')
    assert.ok(seat, '没有注册 composer 槽位')
    assert.equal(typeof seat.component, 'function', 'composer 槽位没有组件')
    seat.component({ inputActions: actions })
    drainEffects(env)
  }

  return { ...mountTab(env), actions }
}

test('host 侧：注册了 composer 槽位，且位置让开 prompt-library', () => {
  const env = bootClient()
  try {
    const seat = env.panes.find((p) => p.id === 'spellbook-apply-seat')
    assert.ok(seat, '没有注册 spellbook-apply-seat')
    assert.equal(seat.name, 'conversation.input.left')
    assert.equal(typeof seat.order, 'number')
    assert.ok(seat.order > 11, `order=${seat.order} 会跟 prompt-library 的 10/11 撞位`)
  } finally {
    env.restore()
  }
})

test('host 侧：来源不是那个 iframe、或原点不对，一律不理', () => {
  const env = bootClient()
  try {
    const { ask, replies, frameWindow } = mountBridge(env)

    ask({ requestId: 'r1', prompt: '正文', mode: 'insert' }, { source: { tag: 'impostor' } })
    assert.equal(replies.length, 0, '听了冒充窗口的消息 —— 宿主页面上还有 300 多个同源的预览文档')

    ask({ requestId: 'r2', prompt: '正文', mode: 'insert' }, { origin: 'http://evil.example' })
    assert.equal(replies.length, 0, '听了别的原点的消息')

    // 非本协议的消息也不该有回音
    ask({ requestId: 'r3', prompt: '正文' }, { data: { type: 'something-else' } })
    assert.equal(replies.length, 0)

    void frameWindow
  } finally {
    env.restore()
  }
})

test('host 侧：没有会话时回 no-sink，而不是假装成功', () => {
  const env = bootClient()
  try {
    const { ask, replies } = mountBridge(env, { withComposer: false })

    ask({ requestId: 'n1', prompt: '咒语正文', mode: 'insert' })

    assert.equal(replies.length, 1, '没有回执 —— 站点那侧只能一直等到超时')
    assert.equal(replies[0].type, 'spellbook:apply-result')
    assert.equal(replies[0].requestId, 'n1')
    assert.equal(replies[0].ok, false)
    assert.equal(replies[0].reason, 'no-sink')
  } finally {
    env.restore()
  }
})

test('host 侧：成功时真的调了 insertText，回执 ok 且不带 reason', () => {
  const env = bootClient()
  try {
    const { ask, replies, actions } = mountBridge(env)

    ask({ requestId: 's1', prompt: '咒语正文', mode: 'insert' })

    assert.equal(actions.calls.insert.length, 1, 'insertText 没被调用')
    assert.equal(actions.calls.insert[0].text, '咒语正文', '插进去的不是那份正文')
    assert.equal(actions.calls.submit, 0, 'insert 模式不该顺手发送')

    assert.equal(replies.length, 1)
    assert.equal(replies[0].ok, true)
    assert.equal(replies[0].reason, undefined)
  } finally {
    env.restore()
  }
})

test('host 侧：mode=send 才 submit', () => {
  const env = bootClient()
  try {
    const { ask, replies, actions } = mountBridge(env)

    ask({ requestId: 'd1', prompt: '咒语正文', mode: 'send' })

    assert.equal(actions.calls.insert.length, 1)
    assert.equal(actions.calls.submit, 1, 'send 模式没有发送')
    assert.equal(replies[0].ok, true)
  } finally {
    env.restore()
  }
})

test('host 侧：插入被拒时重试一次，仍失败才回 rejected', () => {
  const env = bootClient()
  try {
    const { ask, replies, actions } = mountBridge(env, { insertSucceeds: false })

    ask({ requestId: 'j1', prompt: '咒语正文', mode: 'insert' })

    // 一次就放弃会让「点了没反应」变成常态，所以必须有第二次
    assert.equal(actions.calls.insert.length, 2, '没有重取 span 再试')
    assert.equal(actions.calls.capture, 2, '第二次没有重取新鲜的 span')
    assert.equal(replies[0].ok, false)
    assert.equal(replies[0].reason, 'rejected')
  } finally {
    env.restore()
  }
})

test('host 侧：形状不对回 bad-request，并原样带回 requestId', () => {
  const env = bootClient()
  try {
    const { ask, replies, actions } = mountBridge(env)

    ask({ requestId: 'b1', prompt: '', mode: 'insert' })
    ask({ requestId: 'b2', prompt: 123, mode: 'insert' })
    ask({ requestId: 7, prompt: '正文', mode: 'insert' })

    assert.equal(replies.length, 3, '形状不对的消息有的被吞了')
    for (const reply of replies) {
      assert.equal(reply.type, 'spellbook:apply-result')
      assert.equal(reply.ok, false)
      assert.equal(reply.reason, 'bad-request')
    }
    assert.equal(replies[0].requestId, 'b1')
    assert.equal(replies[1].requestId, 'b2')
    assert.equal(actions.calls.insert.length, 0, '坏请求不该碰到输入框')
  } finally {
    env.restore()
  }
})

test('两个 composer 实例同时在时，卸载先挂的那个不能把通道整条抹掉', () => {
  // 这个槽位是 session 作用域的：分屏或同时开着两个会话就会有两个实例。
  // 用单个变量存 sink 时，任何一个卸载都会把它置空 —— 另一个明明还活着，
  // 表现却是「点应用回『没有会话』，可会话就开着」。所以 sink 是个栈。
  const env = bootClient()
  try {
    const seat = env.panes.find((p) => p.id === 'spellbook-apply-seat')
    assert.ok(seat && typeof seat.component === 'function')

    // 先挂的
    const first = fakeInputActions()
    seat.component({ inputActions: first })
    const [firstCleanup] = drainEffects(env)
    assert.equal(typeof firstCleanup, 'function', 'effect 没有返回清理函数，卸载时摘不掉')

    // 后挂的 = 栈顶，该它说话
    const second = fakeInputActions()
    seat.component({ inputActions: second })
    drainEffects(env)

    const { ask, replies } = mountTab(env)

    // 把先挂的那个卸载掉 —— 它已不在栈顶
    firstCleanup()

    ask({ requestId: 'x1', prompt: '咒语正文', mode: 'insert' })

    assert.equal(second.calls.insert.length, 1, '没落到栈顶那个实例上')
    assert.equal(first.calls.insert.length, 0, '落到了已卸载的实例上')
    assert.equal(replies.length, 1)
    assert.equal(replies[0].ok, true, '先挂的实例一卸载，通道就整条断了')
  } finally {
    env.restore()
  }
})

test('只有一个实例时，它卸载后必须回落成 no-sink', () => {
  const env = bootClient()
  try {
    const seat = env.panes.find((p) => p.id === 'spellbook-apply-seat')
    seat.component({ inputActions: fakeInputActions() })
    const [cleanup] = drainEffects(env)

    const { ask, replies } = mountTab(env)
    cleanup()
    ask({ requestId: 'y1', prompt: '咒语正文', mode: 'insert' })

    assert.equal(replies.length, 1)
    assert.equal(replies[0].ok, false)
    assert.equal(replies[0].reason, 'no-sink')
  } finally {
    env.restore()
  }
})

test('每个「抄咒语 / 应用」按钮都必须带上它自己的取址属性', () => {
  // 这条是拿一次真实的回归换来的。
  //
  // 第 2 轮把 initPromptCopy 改成只读 data-prompt-url（理由是地址由模板给，
  // 不在 JS 里按 slug 拼 —— 目录页与条目页深度不同，拼法不同），却漏了
  // **site.js 里检索结果那一个按钮**。它在浏览器里 fetch(undefined) → 404
  // → 显示「没取到」，不报错。而当时的测试只断言了模板那一处，所以没拦住。
  //
  // 所以这里扫所有会出现这类按钮的地方：客户端模板、构建期模板、构建产物。
  const files = [
    path.join(ROOT, 'src', 'site.js'),
    path.join(ROOT, 'src', 'render', 'pages.mjs'),
    path.join(ROOT, 'dist', 'index.html'),
    path.join(ROOT, 'dist', 'spell', 'liquid-glass', 'index.html'),
  ]
  const pairs = [
    ['data-prompt=', 'data-prompt-url='],
    ['data-apply=', 'data-apply-url='],
  ]

  const problems = []
  let checked = 0
  for (const file of files) {
    const text = readFileSync(file, 'utf8')
    for (const tag of text.match(/<button\b[^>]*>/g) ?? []) {
      for (const [attr, urlAttr] of pairs) {
        if (!tag.includes(attr)) continue
        checked += 1
        if (!tag.includes(urlAttr)) {
          problems.push(`${path.relative(ROOT, file)} 缺 ${urlAttr}：${tag.slice(0, 100)}`)
        }
      }
    }
  }

  assert.deepEqual(problems, [], '有按钮没带上取址属性，点下去只会 404')
  assert.ok(checked >= 5, `只扫到 ${checked} 个按钮 —— 扫描本身大概失效了`)

  // 顺带确认真扫到了检索结果那一个（它没进 dist，只在 site.js 模板里）
  const siteSource = readFileSync(path.join(ROOT, 'src', 'site.js'), 'utf8')
  assert.match(siteSource, /class="hit-tool hit-apply"[^>]*data-apply-url=/, '检索结果里没有可用的应用按钮')
})

test('产物：embed 跨页记住，应用按钮默认藏着', () => {
  const indexHtml = path.join(ROOT, 'dist', 'index.html')
  const spellHtml = path.join(ROOT, 'dist', 'spell', 'liquid-glass', 'index.html')
  assert.ok(
    existsSync(indexHtml) && existsSync(spellHtml),
    'dist/ 还没构建，先跑 node build.mjs',
  )

  // 1. embed 要记进 sessionStorage ——
  //    站内跳转（目录 → 条目页）是普通导航，查询串会被丢掉；
  //    丢了 embed，侧边栏里那截「书封」刊头会重新冒出来，明暗也不再跟宿主。
  const index = readFileSync(indexHtml, 'utf8')
  assert.match(index, /sessionStorage\.setItem\('spellbook:embed'/, '入口页没有记住 embed')
  assert.match(index, /sessionStorage\.getItem\('spellbook:embed'/, '没有从 sessionStorage 取回 embed')

  const spell = readFileSync(spellHtml, 'utf8')
  assert.match(spell, /sessionStorage\.getItem\('spellbook:embed'/, '条目页没有取回 embed')

  // 2. 条目页要有应用按钮；取正文的地址由模板写在属性上，不在 JS 里按 slug 拼 ——
  //    两层深度（目录页 `spell/<slug>/prompt.txt`、条目页 `prompt.txt`）拼法不同，
  //    在 JS 里拼迟早会在另一层上拼错前缀，而拼错只表现为 404，没人当场发现。
  assert.match(spell, /data-apply="liquid-glass"/, '条目页没有应用按钮')
  assert.match(spell, /data-apply-mode="send"/, '条目页没有「应用并发送」')
  assert.match(spell, /data-apply-url="prompt\.txt"/, '条目页的咒语地址不对')

  // 3. 默认藏着，只在嵌入模式下显示
  const css = readFileSync(path.join(ROOT, 'dist', 'styles', 'spellbook.css'), 'utf8')
  assert.match(css, /\.apply-bar\s*\{\s*display:\s*none/, '应用按钮默认没有藏起来')
  assert.match(css, /:root\[data-embed\]\s+\.apply-bar\s*\{\s*display:\s*flex/, '嵌入模式下应用按钮没显示')
  // 检索结果里的那个也一样：自己开标签页看站时没有对话可应用
  assert.match(css, /\.hit-apply\s*\{\s*display:\s*none/, '检索结果的应用按钮默认没有藏起来')
  assert.match(css, /:root\[data-embed\]\s+\.hit-apply\s*\{\s*display:\s*inline-flex/, '嵌入模式下检索结果的应用按钮没显示')

  // 4. 目录页的「抄咒语」也改用模板给的地址
  assert.match(index, /data-prompt-url="spell\/[^"]+\/prompt\.txt"/, '抄咒语没有带咒语地址')
})
