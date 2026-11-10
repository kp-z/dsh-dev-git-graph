/**
 * 总览页**组件级**冒烟：迷你 React 运行时（不依赖 jsdom、不依赖真 React）+ 固定 fixture。
 *
 * 为什么要有这一个文件：纯函数层（overviewModel / overviewLayout）用数据证明「算得对」，
 * 但页面真正的失败模式在**接线**上——hooks 在工厂层被调用（真 React 下直接白屏）、
 * scope 切了图没换、菜单动作没打到接口、写失败没有可读提示、又悄悄混进字面量颜色。
 * 那些只有把组件真跑一遍才看得见，所以在 node 里跑。
 *
 * 三条刻意的设计：
 * 1. **固定 fixture**（5 个任务 / 2 个目录 / 1 条跨项目依赖 / 1 个缺失端点），不碰 live 数据，
 *    离线可复现、断言能写死数；
 * 2. **迷你 hook 运行时**按组件在树里的 path 持久化 hook 槽位，effect 只在 deps 变化时重跑，
 *    连续两遍没有新 setState 才算稳定——足以覆盖 useState/useRef/useEffect/useMemo/useCallback；
 * 3. 顺手把两条**防回退红线**钉在这里：渲染产物与 CSS 里没有字面量颜色（只用宿主令牌）、
 *    组件模块顶层不许 import react。
 *
 * 跑法：node test/overviewPanel.mjs
 */
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { createOverviewPanel } from '../src/client/OverviewPanel.js'
import { CSS, STYLE_ID, decoVar, injectStyles, stateVar } from '../src/client/styles.js'
import * as layout from '../src/overview/layout.js'
import * as model from '../src/overview/model.js'

const HERE = dirname(fileURLToPath(import.meta.url))

/* ============================================================================
 * 迷你 React：够跑受控组件树
 * ========================================================================== */

function createMiniReact() {
  const instances = new Map()
  let current = null
  let dirty = false

  const depsChanged = (a, b) => !a || !b || a.length !== b.length || a.some((v, i) => !Object.is(v, b[i]))

  function slot(kind, init) {
    if (!current) throw new Error('hook 只能在组件渲染期间调用（工厂层调用 hook 会让真 React 白屏）')
    const index = current.index++
    if (!current.hooks[index]) current.hooks[index] = { kind, value: typeof init === 'function' ? init() : init }
    return current.hooks[index]
  }

  const React = {
    createElement(type, props, ...children) {
      const merged = props ? { ...props } : {}
      merged.children = children.flat(Infinity).filter((c) => c !== null && c !== undefined && c !== false && c !== true)
      return { __el: true, type, props: merged, key: props && props.key != null ? props.key : undefined }
    },
    memo(fn) { return fn },
    Fragment: 'Fragment',
    useState(init) {
      const s = slot('state', init)
      return [s.value, (next) => {
        const value = typeof next === 'function' ? next(s.value) : next
        if (!Object.is(value, s.value)) { s.value = value; dirty = true }
      }]
    },
    useRef(init) { return slot('ref', { current: init }).value },
    useMemo(fn, deps) { const s = slot('memo', undefined); if (depsChanged(s.deps, deps)) { s.value = fn(); s.deps = deps } return s.value },
    useCallback(fn, deps) { const s = slot('cb', undefined); if (depsChanged(s.deps, deps)) { s.value = fn; s.deps = deps } return s.value },
    useEffect(fn, deps) {
      const s = slot('effect', undefined)
      if (depsChanged(s.deps, deps)) { s.fn = fn; s.run = true; s.deps = deps }
    },
  }

  const nameOf = (fn) => (fn && (fn.displayName || fn.name)) || 'Anonymous'

  function render(el, path) {
    if (el === null || el === undefined || el === false || el === true) return null
    if (typeof el === 'string' || typeof el === 'number') return { text: String(el), path }
    if (Array.isArray(el)) return el.map((child, i) => render(child, `${path}.${i}`)).filter(Boolean)
    if (!el.__el) return null
    const { type, props, key } = el
    if (typeof type === 'function') {
      const id = `${path}#${key != null ? key : nameOf(type)}`
      let inst = instances.get(id)
      if (!inst) { inst = { hooks: [], index: 0, id }; instances.set(id, inst) }
      const prev = current
      current = inst
      inst.index = 0
      const out = type(props)
      current = prev
      return { kind: 'component', type: nameOf(type), props, path: id, children: render(out, `${id}/`) }
    }
    return { kind: 'host', type: String(type), props, path, children: render(props.children, `${path}/`) }
  }

  function flushEffects() {
    for (const inst of instances.values()) {
      for (const h of inst.hooks) {
        if (!h || h.kind !== 'effect' || !h.run) continue
        h.run = false
        if (h.cleanup) h.cleanup()
        const out = h.fn()
        h.cleanup = typeof out === 'function' ? out : undefined
      }
    }
  }

  function pass() {
    dirty = false
    const tree = render(React.__root, 'root')
    flushEffects()
    return tree
  }

  return {
    React,
    /** 只渲染一遍（同步）：用来观察「promise 还没回来」的加载态。 */
    renderOnce(element) { React.__root = element; return pass() },
    /**
     * 反复渲染直到连续两遍没有新的 setState（给挂起的 promise 机会 resolve）。
     * 上限 60 遍，防呆；组件里若真有死循环，这里会以「没稳定」的名义被断言抓住。
     */
    async act() {
      let tree = null
      let stable = 0
      for (let i = 0; i < 60; i += 1) {
        tree = pass()
        await new Promise((resolve) => setImmediate(resolve))
        if (dirty) { stable = 0; continue }
        stable += 1
        if (stable >= 2) return tree
      }
      throw new Error('组件树在 60 遍渲染内没有稳定（可能存在自我触发的 setState 循环）')
    },
  }
}

/* ============================================================================
 * 产物树工具（只读遍历，不做 DOM 查询）
 * ========================================================================== */

function walk(tree, visit) {
  if (!tree) return
  if (Array.isArray(tree)) { tree.forEach((node) => walk(node, visit)); return }
  visit(tree)
  if (tree.children) walk(tree.children, visit)
}

function findAll(tree, predicate) {
  const out = []
  walk(tree, (node) => { if (node && predicate(node)) out.push(node) })
  return out
}

const classNameOf = (node) => String((node && node.props && node.props.className) || '')

const byClass = (tree, cls) => findAll(tree, (node) => node.kind === 'host' && classNameOf(node).split(/\s+/).includes(cls))

function textOf(tree) {
  let out = ''
  walk(tree, (node) => {
    if (node && node.kind === 'host' && Array.isArray(node.children)) {
      node.children.forEach((child) => { if (child && child.text) out += `${child.text} ` })
    }
  })
  return out
}

/* ============================================================================
 * 固定 fixture：5 任务 / 2 目录 / 1 跨项目边 / 1 缺失端点 / 1 个 0 任务项目
 * ========================================================================== */

function makeTask(id, no, workspaceKey, workspaceTitle, extra) {
  return Object.assign({
    id,
    no,
    title: `任务 ${id}`,
    done: false,
    workspaceKey,
    workspaceTitle,
    workspacePath: `/x/${workspaceKey}`,
    blocked: false,
    ready: true,
    started: false,
    suspended: false,
    sessionId: `s-${id}`,
    predecessors: [],
    successors: [],
    sourceTasks: [],
    derivedTasks: [],
    blockedBy: [],
  }, extra || {})
}

const TASKS = [
  makeTask('a1', 11, 'wA', '项目A', {
    blocked: true,
    ready: false,
    predecessors: [{ id: 'b1', title: '任务 b1' }],
    blockedBy: [{ id: 'b1', title: '任务 b1' }],
  }),
  makeTask('a2', 12, 'wA', '项目A', { done: true, ready: false }),
  makeTask('b1', 13, 'wB', '项目B', { successors: [{ id: 'a1', title: '任务 a1' }] }),
  makeTask('c1', 14, 'wC', '项目C', { sourceTasks: [{ id: 'a1', title: '任务 a1' }] }),
  makeTask('e1', 15, 'wD', '项目D', {
    blocked: true,
    ready: false,
    blockedBy: [{ id: 'zz-missing', title: '早就删掉的任务' }],
  }),
]

const RELATIONS = [
  { from: 'b1', to: 'a1', kind: 'depends_on' }, // 跨项目、同目录 → 同一张图里直连
  { from: 'a1', to: 'c1', kind: 'derived_from' }, // 跨目录 → 目标成组外 ghost
  { from: 'zz-missing', to: 'e1', kind: 'depends_on' }, // 端点任务表里没有 → 缺失 ghost
]

const GROUPS = [{ id: 'g1', name: 'QVIZ', members: ['wA', 'wB'], labels: {} }]

const WORKSPACES = [
  { key: 'wA', id: 'wA', path: '/x/wA', title: '项目A' },
  { key: 'wB', id: 'wB', path: '/x/wB', title: '项目B' },
  { key: 'wC', id: 'wC', path: '/x/wC', title: '项目C' },
  { key: 'wD', id: 'wD', path: '/x/wD', title: '项目D' },
  { key: 'wF', id: 'wF', path: '/x/wF', title: '空项目' }, // 有项目没任务：只进树，不进图
]

const SNAPSHOT = {
  ok: true,
  revision: 'rev-fixed-1',
  now: 1794298146389,
  groups: GROUPS,
  workspaces: WORKSPACES,
  tasks: TASKS,
  relations: RELATIONS,
  stats: { tasks: 5, groups: 1, dependencyEdges: 2, provenanceEdges: 1, blocked: 2, ready: 1 },
}

/* ============================================================================
 * 假 api / store：组件只认注入的接口
 * ========================================================================== */

function cloneGroups(groups) {
  return (Array.isArray(groups) ? groups : []).map((group) => ({
    id: group && group.id,
    name: group && group.name,
    members: Array.isArray(group && group.members) ? group.members.slice() : [],
    labels: group && typeof group.labels === 'object' && group.labels ? { ...group.labels } : {},
  }))
}

/**
 * 有状态的假 api：写操作真的改内部 groups 并推进 revision，overview 回**当前**状态。
 * 这一点很关键——组件在写成功后会立刻 load(true) 拉权威快照，若假 api 永远回初始快照，
 * 就会把本地 patch 又抹掉，测出来的行为与真实宿主不一致。
 * `overviewDriver(callIndex, readState)` 可以把回包**挂住**，用来构造「写后旧回包才回来」的竞态。
 */
function makeApi(snapshot, options) {
  const opts = options || {}
  const calls = []
  let groups = cloneGroups(snapshot && snapshot.groups)
  let revision = (snapshot && snapshot.revision) || 'rev-fixed-1'
  let overviewCount = 0
  const stateOf = () => ({ ...snapshot, groups: cloneGroups(groups), revision })

  return {
    calls,
    get revisionValue() { return revision },
    snapshotNow() { return stateOf() },
    overview: async () => {
      calls.push({ method: 'overview' })
      overviewCount += 1
      if (opts.overviewFails) throw new Error(opts.overviewFails)
      if (typeof opts.overviewDriver === 'function') return opts.overviewDriver(overviewCount, stateOf)
      if (opts.snapshot !== undefined) return opts.snapshot
      return stateOf()
    },
    revision: async () => ({ ok: true, revision }),
    groupAction: async (body) => {
      calls.push({ method: 'groupAction', body })
      if (opts.groupFails) throw new Error(opts.groupFails)
      if (body.action === 'create') {
        groups = groups.concat([{ id: 'g-new', name: body.name, members: body.members || [], labels: body.labels || {} }])
      } else if (body.action === 'delete') {
        groups = groups.filter((group) => group.id !== body.id)
      } else if (body.action === 'add') {
        groups = groups.map((group) => (group.id === body.id ? { ...group, members: group.members.concat([body.member.key]) } : group))
      } else if (body.action === 'remove') {
        groups = groups.map((group) => (group.id === body.id ? { ...group, members: group.members.filter((key) => key !== body.key) } : group))
      } else {
        groups = groups.map((group) => (group.id === body.id ? { ...group, name: body.name } : group))
      }
      revision = `rev-write-${calls.filter((call) => call.method === 'groupAction').length}`
      return { ok: true, group: groups.find((group) => group.id === body.id) || groups[0] || null, groups: cloneGroups(groups) }
    },
  }
}

function makeStore(initial) {
  const data = new Map(Object.entries(initial || {}))
  return {
    data,
    get(key, fallback) { return data.has(key) ? data.get(key) : fallback },
    set(key, value) { data.set(key, value) },
  }
}

/** 一次到位的面板挂载：渲染 → 等 promise → 稳定。 */
async function mountPanel(options) {
  const opts = options || {}
  const mini = createMiniReact()
  const api = opts.api || makeApi(opts.snapshot === undefined ? SNAPSHOT : opts.snapshot, opts)
  const store = opts.store && typeof opts.store.get === 'function' ? opts.store : makeStore(opts.store)
  const Panel = createOverviewPanel({
    React: mini.React,
    h: mini.React.createElement,
    model,
    layout,
    api,
    store,
    pollMs: 60000,
  })
  const loadingTree = mini.renderOnce(mini.React.createElement(Panel, {}))
  const tree = await mini.act()
  return { mini, api, store, tree, loadingTree }
}

/* ============================================================================
 * 断言 runner
 * ========================================================================== */

let passed = 0
const failures = []
function check(name, fn) {
  try {
    fn()
    passed += 1
    console.log(`  ok  ${name}`)
  } catch (error) {
    failures.push(name)
    console.log(`  FAIL ${name}`)
    console.log(String((error && error.stack) || error).split('\n').slice(0, 6).map((line) => `       ${line}`).join('\n'))
  }
}

/* CSS 断言的小工具：先剥掉注释，再按选择器 / @media 取规则体。
   不剥注释的话，注释里出现的 translateY/backwards 这类字眼会让断言「假绿」。 */
const CSS_BARE = CSS.replace(/\/\*[\s\S]*?\*\//g, '')
function blockAfter(text, start) {
  const open = text.indexOf('{', start)
  if (open < 0) return ''
  let depth = 0
  for (let i = open; i < text.length; i += 1) {
    if (text[i] === '{') depth += 1
    else if (text[i] === '}') {
      depth -= 1
      if (depth === 0) return text.slice(open + 1, i)
    }
  }
  return ''
}
const ruleBody = (selector) => {
  const at = CSS_BARE.indexOf(`${selector} {`)
  return at < 0 ? '' : blockAfter(CSS_BARE, at)
}
const mediaBody = (query) => {
  const at = CSS_BARE.indexOf(`@media ${query}`)
  return at < 0 ? '' : blockAfter(CSS_BARE, at)
}

const rootOf = (tree) => findAll(tree, (node) => node.kind === 'host' && classNameOf(node) === 'fo-root')[0]
const treeItems = (tree) => findAll(tree, (node) => node.kind === 'host' && node.props.role === 'treeitem')
const graphSections = (tree) => findAll(tree, (node) => node.kind === 'host' && node.type === 'section' && classNameOf(node).includes('fo-graph'))
const nodeGroups = (tree) => findAll(tree, (node) => node.kind === 'host' && node.type === 'g' && classNameOf(node).startsWith('fo-node'))
const taskNodes = (tree) => nodeGroups(tree).filter((node) => !classNameOf(node).includes('is-ghost'))
const ghostNodes = (tree) => nodeGroups(tree).filter((node) => classNameOf(node).includes('is-ghost'))
const edgePaths = (tree) => findAll(tree, (node) => node.kind === 'host' && node.type === 'path' && classNameOf(node).includes('fo-edge'))
const bandRects = (tree) => findAll(tree, (node) => node.kind === 'host' && node.type === 'rect' && classNameOf(node).includes('fo-band'))
const cardButtons = (tree) => findAll(tree, (node) => node.kind === 'host' && node.type === 'button' && classNameOf(node) === 'fo-card')
const menus = (tree) => findAll(tree, (node) => node.kind === 'host' && classNameOf(node).split(/\s+/).includes('fo-menu'))
const menuItemsOf = (menu) => findAll(menu, (node) => node.kind === 'host' && node.type === 'button' && classNameOf(node) === 'fo-menu-item')
const rowByDataId = (tree, id) => treeItems(tree).find((row) => row.props['data-id'] === id)
const alertBoxes = (tree) => findAll(tree, (node) => node.kind === 'host' && node.props.role === 'alert')

/* ============================================================================
 * 流程
 * ========================================================================== */

console.log('overview/面板组件（迷你 React + 固定 fixture：5 任务 / 2 目录 / 1 跨项目边 / 1 缺失端点）')

const main = await mountPanel()
let tree = main.tree

check('styles：STYLE_ID 稳定、CSS 是 fo- 前缀的一段字符串', () => {
  assert.equal(STYLE_ID, 'dsh-feishu-overview-style')
  assert.equal(typeof CSS, 'string')
  assert.ok(CSS.length > 1000)
  assert.ok(CSS.includes('.fo-root'))
})
check('styles：injectStyles 在没有 document 时安静返回 false（node 可 import）', () => {
  assert.equal(injectStyles(undefined), false)
})
check('styles：decoVar / stateVar 只产出宿主令牌引用', () => {
  assert.equal(decoVar(3), 'var(--fo-deco-3)')
  assert.ok(stateVar('blocked').includes('--dsw-alias-state-error-primary'))
  assert.ok(stateVar('done').includes('--dsw-alias-state-success-primary'))
  assert.equal(decoVar(-1), 'var(--fo-deco-0)')
})

/* ---- 0b. 借来的玻璃风格：全部落在 CSS 上，逐条钉住「像参考项目」的那几处 ---- */
check('玻璃卡片：卡片规则含 backdrop-filter blur(12px) 与玻璃底色', () => {
  const card = ruleBody('.fo-card')
  const img = card.indexOf('backdrop-filter')
  assert.ok(card.includes('background: var(--fo-glass-card)'), card.slice(0, 200))
  assert.ok(img > 0, '卡片规则里要有 backdrop-filter')
  assert.ok(card.includes('-webkit-backdrop-filter'), '补一份 -webkit- 前缀')
  assert.ok(ruleBody('.fo-root').includes('--fo-glass-blur: blur(12px)'), '模糊半径 12px 定义在根上')
  assert.ok(card.includes('border-radius: 12px'), '卡片圆角 12px')
  assert.ok(ruleBody('.fo-graph').includes('border-radius: 16px'), '画布圆角 16px（task-12：对齐参考站 rounded-2xl）')
  assert.ok(ruleBody('.fo-chip').includes('border-radius: 999px'), '胶囊圆角 999px')
})
check('玻璃分层：三层透明度 92% / 88%（面板底是不透明的 bg-base）', () => {
  const root = ruleBody('.fo-root')
  assert.ok(root.includes('--fo-glass-card: color-mix(in oklab, var(--dsw-alias-bg-layer-1) 92%, transparent)'))
  assert.ok(root.includes('--fo-glass-sub: color-mix(in oklab, var(--dsw-alias-bg-layer-2) 88%, transparent)'))
  /* border 令牌带一层「仍是宿主令牌」的回退链，所以这里钉住前缀与百分比，不逐字符比 */
  assert.ok(root.includes('--fo-glass-line: color-mix(in oklab, var(--dsw-alias-border-l1'))
  assert.ok(root.includes('65%, transparent)'))
  assert.ok(root.includes('--fo-glass-line-hover: color-mix(in oklab, var(--dsw-alias-border-l2'))
  assert.ok(root.includes('--fo-glass-shadow: 0 8px 24px color-mix(in oklab, var(--dsw-alias-label-primary) 10%, transparent)'))
  assert.ok(root.includes('background: var(--dsw-alias-bg-base'), '面板底仍是不透明的 bg-base')
  assert.ok(ruleBody('.fo-tree').includes('color-mix(in oklab, var(--dsw-specific-sidebar-fill'), '侧栏用 sidebar-fill 的混合')
  assert.ok(ruleBody('.fo-tree').includes('80%, transparent)'), 'rail 半透明底 80%（对齐参考站 aside /80）')
  assert.ok(ruleBody('.fo-tree').includes('blur(24px)'), 'rail 用 blur(24px)')
})
check('玻璃风格全部走 color-mix(in oklab, …)，没有 in srgb 残留', () => {
  const mixes = CSS_BARE.match(/color-mix\(in oklab,/g) || []
  assert.ok(mixes.length >= 25, `oklab 混合只找到 ${mixes.length} 处`)
  assert.equal(CSS_BARE.includes('in srgb'), false)
})
check('状态光晕：成功/警告/错误/idle 各一个 35% 混合（借参考项目的 rarity 光晕写法）', () => {
  const root = ruleBody('.fo-root')
  for (const state of ['success', 'warn', 'error', 'idle']) {
    assert.ok(root.includes(`--fo-glow-${state}: color-mix(in oklab, var(--dsw-alias-state-${state}-primary) 35%, transparent)`), `缺 ${state} 光晕`)
  }
  assert.ok(root.includes('--fo-glow-brand: color-mix(in oklab, var(--dsw-alias-brand-primary) 35%, transparent)'))
  /* 定义了就一定要用上（否则就是死 CSS）：五条光晕都出现在卡片状态光条上 */
  for (const state of ['success', 'warn', 'error', 'idle', 'brand']) {
    assert.ok(CSS_BARE.includes(`background: var(--fo-card-glow, var(--fo-glow-idle))`) || CSS_BARE.includes(`var(--fo-glow-${state})`), `${state} 光晕没被用到`)
  }
  for (const state of ['blocked', 'suspended', 'done', 'open']) {
    assert.ok(ruleBody(`.fo-card[data-state="${state}"]`).includes('--fo-card-glow'), `${state} 卡片没有光晕`)
  }
})
check('悬停：卡片 hover 有 translateY(-3px) scale(1.01) + 300ms cubic-bezier 过渡', () => {
  const root = ruleBody('.fo-root')
  assert.ok(root.includes('--fo-dur: 300ms'), '过渡时长 300ms')
  assert.ok(root.includes('--fo-ease: cubic-bezier(.2, .8, .2, 1)'), '缓动曲线照参考项目')
  const card = ruleBody('.fo-card')
  assert.ok(card.includes('transition: transform var(--fo-dur) var(--fo-ease)'), card.slice(0, 200))
  const hover = ruleBody('.fo-card:hover')
  assert.ok(hover.includes('transform: translateY(-3px) scale(1.01)'), hover)
  assert.ok(hover.includes('border-color: var(--fo-glass-line-hover)'), '边框升到 border-l2 的混合色')
})
check('悬停：叠一层品牌色 6% → 透明的渐变淡入（品牌色不硬编码色相）', () => {
  const root = ruleBody('.fo-root')
  assert.ok(root.includes('--fo-glass-wash: linear-gradient(135deg, color-mix(in oklab, var(--dsw-alias-brand-primary) 6%, transparent), transparent 72%)'))
  const after = ruleBody('.fo-card::after')
  assert.ok(after.includes('background: var(--fo-glass-wash)'))
  assert.ok(after.includes('opacity: 0'), '默认不可见')
  assert.ok(ruleBody('.fo-card:hover::after').includes('opacity: 1'), 'hover 才淡入')
})
check('入场动画：120ms 上浮淡入 + 逐行 20ms 递延（上限 8 行），用 backwards 不挡 hover', () => {
  const keyframes = blockAfter(CSS_BARE, CSS_BARE.indexOf('@keyframes fo-rise'))
  assert.ok(keyframes.includes('opacity: 0') && keyframes.includes('translateY(4px)'), keyframes)
  assert.ok(keyframes.includes('opacity: 1'))
  assert.ok(CSS_BARE.includes('animation: fo-rise 120ms var(--fo-ease) backwards'), '120ms + backwards 填充')
  assert.ok(CSS_BARE.includes('animation-delay: calc(var(--fo-i, 0) * 20ms)'), '逐行 20ms')
  assert.ok(CSS_BARE.includes('animation: none !important'), '不引动画库')
})
check('prefers-reduced-motion：关掉动画、过渡与位移，渐变也不再淡入', () => {
  const reduced = mediaBody('(prefers-reduced-motion: reduce)')
  assert.ok(reduced.length > 0, '缺 prefers-reduced-motion 分支')
  assert.ok(reduced.includes('animation: none !important'))
  assert.ok(reduced.includes('transition: none !important'))
  assert.ok(reduced.includes('transform: none !important'))
  assert.ok(reduced.includes('opacity: 0 !important'), '落影渐变在减弱动效下不出现')
})
check('紧密密度：正文 12px / 标题 13px / 卡片内边距 16px / 正文行 13px', () => {
  assert.ok(ruleBody('.fo-root').includes('font-size: 12px'))
  assert.ok(ruleBody('.fo-title').includes('font-size: 13px'))
  assert.ok(ruleBody('.fo-title').includes('font-weight: 600'))
  assert.ok(ruleBody('.fo-detail-title').includes('font-size: 13px'))
  assert.ok(ruleBody('.fo-graph-name').includes('font-size: 13px'))
  assert.ok(ruleBody('.fo-card').includes('padding: 16px'), '卡片内边距 16-20px')
  assert.ok(ruleBody('.fo-sub').includes('font-size: 11px'))
  assert.ok(ruleBody('.fo-cards').includes('gap: 12px'))
  assert.ok(ruleBody('.fo-row').includes('font-size: 13px'), 'rail 正文 13px')
  assert.ok(ruleBody('.fo-row-count').includes('font-size: 12px'), 'rail 次级 12px')
})

/* ---- 0c. task-12：侧边栏与画布对齐参考站实测值 ---- */
check('侧栏宽度 288px（--fo-rail-w，栅格用它）', () => {
  assert.ok(ruleBody('.fo-root').includes('--fo-rail-w: 288px'), 'rail 宽 288px')
  assert.ok(ruleBody('.fo-body').includes('grid-template-columns: var(--fo-rail-w) minmax(0, 1fr)'))
  assert.ok(ruleBody('.fo-root[data-detail="1"] .fo-body').includes('var(--fo-rail-w)'))
  assert.ok(mediaBody('(max-width: 1080px)').includes('--fo-rail-w: 248px'), '窄视口才收窄')
})
check('rail 行：高 ≥40px、圆角 ≥12px、padding 0 12px、gap 10px', () => {
  const row = ruleBody('.fo-row')
  const height = Number((/height:\s*([0-9.]+)px/.exec(row) || [])[1])
  const radius = Number((/border-radius:\s*([0-9.]+)px/.exec(row) || [])[1])
  assert.ok(height >= 40, `行高 ${height} < 40`)
  assert.ok(radius >= 12, `行圆角 ${radius} < 12`)
  assert.ok(row.includes('padding: 0 12px'))
  assert.ok(row.includes('gap: 10px'))
})
check('rail 选中态：品牌 20% 底 + 30% 描边 + 品牌色文字 + 字重 500', () => {
  const root = ruleBody('.fo-root')
  assert.ok(root.includes('--fo-selected-bg: color-mix(in oklab, var(--dsw-alias-brand-primary) 20%, transparent)'))
  assert.ok(root.includes('--fo-selected-line: color-mix(in oklab, var(--dsw-alias-brand-primary) 30%, transparent)'))
  const selected = ruleBody('.fo-row[aria-selected="true"]')
  assert.ok(selected.includes('background: var(--fo-selected-bg)'))
  assert.ok(selected.includes('border-color: var(--fo-selected-line)'))
  assert.ok(selected.includes('color: var(--dsw-alias-brand-primary)'))
  assert.ok(selected.includes('font-weight: 500'))
  const hover = ruleBody('.fo-row:hover')
  assert.ok(hover.includes('var(--fo-row-hover-bg)'), 'hover 走 bg-layer-2 55% 的混合')
  assert.ok(hover.includes('color: var(--dsw-alias-label-primary)'), 'hover 文字提亮')
  assert.ok(root.includes('--fo-row-hover-bg: color-mix(in oklab, var(--dsw-alias-bg-layer-2) 55%, transparent)'))
})
check('搜索框在 rail 顶部：32px 高 / 圆角 10px / bg-base 70% / 1px 边框', () => {
  const search = ruleBody('.fo-search')
  assert.ok(search.includes('height: 32px'))
  assert.ok(search.includes('border-radius: 10px'))
  assert.ok(search.includes('color-mix(in oklab, var(--dsw-alias-bg-base'), '底色走 bg-base 的混合')
  assert.ok(search.includes('70%, transparent)'))
  assert.ok(search.includes('border: 1px solid var(--fo-glass-line)'))
  assert.ok(ruleBody('.fo-search::placeholder').includes('var(--dsw-alias-label-secondary'), 'placeholder 用 label-secondary')
  assert.ok(ruleBody('.fo-rail-top').length > 0, 'rail 顶部有独立容器')
})
check('画布：16px 圆角 + border-l1 35% 描边 + 品牌调渐变底 + 24px 内边距', () => {
  const graph = ruleBody('.fo-graph')
  assert.ok(graph.includes('border-radius: 16px'))
  assert.ok(graph.includes('border: 1px solid var(--fo-canvas-line)'))
  assert.ok(graph.includes('background: var(--fo-canvas-bg)'))
  const root = ruleBody('.fo-root')
  assert.ok(root.includes('--fo-canvas-line: color-mix(in oklab, var(--dsw-alias-border-l1'))
  assert.ok(root.includes('--fo-canvas-bg: linear-gradient(135deg,'), '画布渐变底')
  assert.ok(ruleBody('.fo-canvas').includes('padding: 24px'), '画布内边距 24px')
})
check('画布网格：40px 双层 linear-gradient、线色 border-l1 12%、不拦点击', () => {
  const grid = ruleBody('.fo-grid')
  assert.ok(grid.includes('pointer-events: none'), '网格层不能拦点击')
  assert.equal((grid.match(/linear-gradient\(to (right|bottom)/g) || []).length, 2, '横竖各一层')
  assert.ok(grid.includes('1px, transparent 1px)'))
  assert.ok(grid.includes('background-size: var(--fo-grid-size) var(--fo-grid-size)'))
  const root = ruleBody('.fo-root')
  assert.ok(root.includes('--fo-grid-size: 40px'), '格 40px（与参考站 GRID_SIZE 一致）')
  assert.ok(root.includes('--fo-grid-line: color-mix(in oklab, var(--dsw-alias-border-l1'))
  assert.ok(root.includes('--fo-grid-line: color-mix(in oklab, var(--dsw-alias-border-l1, var(--dsw-alias-border-l2)) 12%, transparent)'))
})
check('节点：border-width 2px、常态 border-l1 60%、hover border-l2 80%、选中品牌外发光', () => {
  const bg = ruleBody('.fo-node-bg')
  assert.ok(bg.includes('stroke-width: 2'), '节点边框 2px')
  assert.ok(bg.includes('color-mix(in oklab, var(--dsw-alias-border-l1'))
  assert.ok(bg.includes('60%, transparent)'))
  const hover = ruleBody('.fo-node:hover .fo-node-bg')
  assert.ok(hover.includes('color-mix(in oklab, var(--dsw-alias-border-l2'))
  assert.ok(hover.includes('80%, transparent)'))
  assert.ok(ruleBody('.fo-node').includes('drop-shadow(0 8px 24px'), '节点品牌调投影')
  const selected = ruleBody('.fo-node.is-selected')
  assert.ok(selected.includes('drop-shadow(0 0 6px'), '选中外发光')
  assert.ok(selected.includes('25%, transparent)'))
})
check('边：常态 2px / opacity .7，hover 与选中 3px / 1', () => {
  const edge = ruleBody('.fo-edge')
  assert.ok(edge.includes('stroke-width: 2'))
  assert.ok(edge.includes('stroke-opacity: .7'))
  assert.ok(edge.includes('pointer-events: stroke'), '2px 线也要能 hover 到')
  const hover = ruleBody('.fo-edge:hover, .fo-edge.is-active')
  assert.ok(hover.includes('stroke-width: 3'))
  assert.ok(hover.includes('stroke-opacity: 1'))
  assert.ok(ruleBody('.fo-edge[data-kind="derived_from"]').includes('stroke-dasharray: 5 4'), '派生仍虚线')
})
check('箭头：实心三角（fill 非 none）+ 6×6 marker', () => {
  const arrow = ruleBody('.fo-arrow')
  assert.ok(arrow.includes('fill: var(--fo-glass-line-hover)'), '箭头实心：用 fill')
  assert.equal(arrow.includes('fill: none'), false)
  assert.ok(ruleBody('.fo-arrow[data-kind="derived_from"]').includes('fill:'), '派生箭头也是实心')
})

/* ---- 1. 加载态 → 数据态 ---- */
check('加载态：先出骨架，且此时还没有数据', () => {
  assert.equal(byClass(main.loadingTree, 'fo-skeleton-row').length, 3)
  assert.equal(graphSections(main.loadingTree).length, 0)
})
check('数据态：取过快照一次，骨架消失', () => {
  assert.equal(main.api.calls.filter((c) => c.method === 'overview').length, 1)
  assert.equal(byClass(tree, 'fo-skeleton-row').length, 0)
})
check('数据态：根节点 scope=all、data-detail=0', () => {
  const root = rootOf(tree)
  assert.ok(root)
  assert.equal(root.props['data-scope'], 'all')
  assert.equal(root.props['data-detail'], '0')
})
check('数据态：两个目录 → 两张图（同一画布纵向切片）', () => {
  assert.equal(graphSections(tree).length, 2)
  assert.equal(findAll(tree, (node) => node.kind === 'host' && node.type === 'svg').length, 2)
})
check('数据态：节点 8 个 = 5 任务 + 3 ghost（组外 c1 / a1 + 缺失 zz）', () => {
  assert.equal(taskNodes(tree).length, 5)
  assert.equal(ghostNodes(tree).length, 3)
  assert.equal(nodeGroups(tree).length, 8)
})
check('数据态：4 条边 = b1→a1 + zz→e1 + a1→c1 的两条腿（跨目录边在两张图里各以 ghost 锚点呈现）', () => {
  const edges = edgePaths(tree)
  assert.equal(edges.length, 4)
  assert.equal(edges.filter((e) => e.props['data-kind'] === 'depends_on').length, 2)
  assert.equal(edges.filter((e) => e.props['data-kind'] === 'derived_from').length, 2)
  assert.ok(edges.every((e) => String(e.props.d).startsWith('M') && String(e.props['marker-end']).startsWith('url(#fo-arrow-')))
})
check('数据态：跨项目边 b1→a1 在同一张图里直连（两端都不是 ghost）', () => {
  const graph = graphSections(tree)[0]
  const direct = edgePaths(graph).find((e) => e.props['data-from'] === 'b1' && e.props['data-to'] === 'a1')
  assert.ok(direct)
  const ids = taskNodes(graph).map((n) => n.props['data-id'])
  assert.ok(ids.includes('a1') && ids.includes('b1'))
})
check('数据态：泳道 6 条 = g1 两项目 + 未分组两项目 + 两条「组外·缺失」', () => {
  assert.equal(bandRects(tree).length, 6)
  assert.equal(bandRects(tree).filter((b) => b.props['data-external'] === '1').length, 2)
})
check('入场递延真的接上了：树行与卡片都带 --fo-i，且 ≤ 7（上限 8 行）', () => {
  const rows = treeItems(tree).map((row) => row.props.style && row.props.style['--fo-i'])
  const cards = cardButtons(tree).map((card) => card.props.style && card.props.style['--fo-i'])
  assert.deepEqual(rows.slice(0, 4), [0, 1, 2, 3], `树行递延序号：${JSON.stringify(rows)}`)
  assert.deepEqual(cards.slice(0, 3), [0, 1, 2], `卡片递延序号：${JSON.stringify(cards)}`)
  assert.ok(rows.every((value) => Number.isInteger(value) && value >= 0 && value <= 7))
  assert.ok(cards.every((value) => Number.isInteger(value) && value >= 0 && value <= 7))
})
check('代表性节点的玻璃类名没被改坏（卡片/图容器/行/详情）', () => {
  assert.ok(cardButtons(tree).length > 0)
  assert.ok(graphSections(tree).length > 0)
  assert.ok(ruleBody('.fo-card').length > 0 && ruleBody('.fo-graph').length > 0 && ruleBody('.fo-row').length > 0)
})

/* ---- task-12：画布 DOM（网格层 + 实心三角箭头）与 rail 搜索框 ---- */
check('画布 DOM：每张图都有 .fo-canvas + .fo-grid 网格层', () => {
  assert.equal(byClass(tree, 'fo-canvas').length, graphSections(tree).length)
  assert.equal(byClass(tree, 'fo-grid').length, graphSections(tree).length)
  byClass(tree, 'fo-canvas').forEach((canvas) => {
    assert.equal(findAll(canvas, (node) => node.kind === 'host' && classNameOf(node) === 'fo-grid').length, 1, '网格层在图内')
    assert.ok(findAll(canvas, (node) => node.kind === 'host' && classNameOf(node) === 'fo-graph-body').length === 1)
  })
})
check('画布 DOM：箭头是 6×6 实心闭合三角（fill 跟边同色）', () => {
  const markers = findAll(tree, (node) => node.kind === 'host' && node.type === 'marker')
  assert.ok(markers.length >= 2, `marker 数 ${markers.length}`)
  for (const marker of markers) {
    assert.equal(marker.props.markerWidth, '6')
    assert.equal(marker.props.markerHeight, '6')
    assert.equal(marker.props.viewBox, '0 0 6 6')
    const path = findAll(marker, (node) => node.kind === 'host' && node.type === 'path')[0]
    assert.ok(String(path.props.d).trim().endsWith('z'), '实心闭合三角而不是描边折线')
    assert.ok(classNameOf(path).includes('fo-arrow'))
  }
})
const searchBox = findAll(tree, (node) => node.kind === 'host' && node.type === 'input' && classNameOf(node) === 'fo-search')[0]
check('搜索框在 rail 顶部（全页只有这一个）', () => {
  assert.ok(searchBox, 'rail 里要有搜索框')
  assert.equal(searchBox.props.placeholder, '搜索任务…')
  assert.equal(searchBox.props['aria-label'], '搜索任务')
  const rail = byClass(tree, 'fo-tree')[0]
  assert.equal(findAll(rail, (node) => node.kind === 'host' && classNameOf(node) === 'fo-search').length, 1)
  assert.equal(byClass(tree, 'fo-search').length, 1)
})
searchBox.props.onChange({ currentTarget: { value: 'a1' } })
tree = await main.mini.act()
check('搜索命中：卡片收窄到 1 张，匹配条数显示在 rail 上', () => {
  assert.equal(cardButtons(tree).length, 1)
  assert.equal(textOf(byClass(tree, 'fo-rail-hint')[0]).includes('1'), true)
  assert.ok(textOf(cardButtons(tree)[0]).includes('任务 a1'))
})
searchBox.props.onChange({ currentTarget: { value: 'no-such-task-xyz' } })
tree = await main.mini.act()
check('搜索无匹配：「没有匹配的任务」+ 清除按钮，不画空图与空卡片', () => {
  assert.ok(textOf(tree).includes('没有匹配的任务'))
  assert.equal(cardButtons(tree).length, 0)
  assert.equal(graphSections(tree).length, 0)
})
findAll(tree, (node) => node.kind === 'host' && node.type === 'button' && textOf(node).includes('清除搜索'))[0].props.onClick()
tree = await main.mini.act()
check('清除搜索：恢复 5 张卡片 / 2 张图，关键词落 store', () => {
  assert.equal(cardButtons(tree).length, 5)
  assert.equal(graphSections(tree).length, 2)
  assert.equal(main.store.data.get('keyword'), '')
  assert.equal(byClass(tree, 'fo-search')[0].props.value, '')
})
check('数据态：任务卡片 5 张，标题与项目标签都在', () => {
  const cards = cardButtons(tree)
  assert.equal(cards.length, 5)
  const text = textOf(cards)
  for (const id of ['a1', 'a2', 'b1', 'c1', 'e1']) assert.ok(text.includes(`任务 ${id}`), `卡片缺 ${id}`)
  assert.ok(text.includes('项目A') && text.includes('项目D'))
  assert.ok(text.includes('阻塞'))
})

/* ---- 2. 树行数与 depth ---- */
check('树：1 根 + 2 目录 + 5 项目 = 8 行（含 0 任务的空项目）', () => {
  assert.equal(treeItems(tree).length, 8)
})
check('树：三层 depth = aria-level 1 / 2 / 3', () => {
  const all = rowByDataId(tree, '')
  assert.equal(all.props['aria-level'], 1)
  assert.equal(rowByDataId(tree, 'g1').props['aria-level'], 2)
  assert.equal(rowByDataId(tree, '__ungrouped__').props['aria-level'], 2)
  assert.equal(rowByDataId(tree, 'wA').props['aria-level'], 3)
  assert.equal(rowByDataId(tree, 'wF').props['aria-level'], 3)
  assert.equal(rowByDataId(tree, 'wF').props.draggable, true)
})
check('树：目录行显示「N 项目」、项目行显示「N 任务」，根行是全部任务', () => {
  assert.ok(textOf(rowByDataId(tree, 'g1')).includes('2 项目'))
  assert.ok(textOf(rowByDataId(tree, 'wA')).includes('2 任务'))
  assert.ok(textOf(rowByDataId(tree, 'wF')).includes('0 任务'))
  assert.ok(textOf(rowByDataId(tree, '')).includes('全部任务'))
})
check('树：阻塞计数出现在行上（wA 1 个阻塞）', () => {
  assert.ok(byClass(rowByDataId(tree, 'wA'), 'fo-row-badge').length === 1)
  assert.equal(byClass(rowByDataId(tree, 'wB'), 'fo-row-badge').length, 0)
})

/* ---- 3. 点目录行 → scope=group，只剩一张图 ---- */
rowByDataId(tree, 'g1').props.onClick()
tree = await main.mini.act()
check('点目录行：scope=group，只剩一张图', () => {
  assert.equal(rootOf(tree).props['data-scope'], 'group')
  assert.equal(graphSections(tree).length, 1)
  assert.equal(taskNodes(tree).length, 3)
  assert.equal(ghostNodes(tree).length, 1)
  assert.equal(bandRects(tree).length, 3)
  assert.equal(cardButtons(tree).length, 3)
})
check('点目录行：选中项写进注入的 store（不是 localStorage）', () => {
  assert.deepEqual(main.store.data.get('selection'), { kind: 'group', id: 'g1' })
})
check('目录 scope：跨项目边 b1→a1 仍在同一张图里直连（两端都不是 ghost）', () => {
  const direct = edgePaths(tree).find((e) => e.props['data-from'] === 'b1' && e.props['data-to'] === 'a1')
  assert.ok(direct)
  assert.equal(direct.props['data-kind'], 'depends_on')
})

/* ---- 4. 点项目行 → 只剩该项目节点 ---- */
rowByDataId(tree, 'wA').props.onClick()
tree = await main.mini.act()
check('点项目行：scope=project，只有该项目任务 + 恰好一条泳道', () => {
  assert.equal(rootOf(tree).props['data-scope'], 'project')
  assert.equal(graphSections(tree).length, 1)
  assert.equal(taskNodes(tree).length, 2)
  assert.deepEqual([...new Set(taskNodes(tree).map((n) => n.props['data-state']))].length >= 1, true)
  assert.equal(bandRects(tree).length, 1)
  assert.equal(cardButtons(tree).length, 2)
})
check('项目 scope：前置 b1 与后置 c1 都成了组外 ghost（missing=false 的锚点）', () => {
  assert.equal(ghostNodes(tree).length, 2)
  assert.ok(textOf(ghostNodes(tree)).includes('任务 b1') || ghostNodes(tree).some((n) => n.props['data-id'] === 'b1'))
  assert.ok(ghostNodes(tree).some((n) => n.props['data-id'] === 'c1'))
  // 缺失任务（zz-missing）与本项目无关：这条边两端都不在，不该画进来
  assert.equal(ghostNodes(tree).some((n) => n.props['data-id'] === 'zz-missing'), false)
})
check('项目 scope：选中项写进 store', () => {
  assert.deepEqual(main.store.data.get('selection'), { kind: 'project', id: 'wA' })
})

/* ---- 5. 展开 / 折叠：写 store ---- */
tree = await main.mini.act()
const treeRole = () => findAll(tree, (node) => node.kind === 'host' && node.props.role === 'tree')[0]
treeRole().props.onKeyDown({ key: 'Home', preventDefault() {} })
tree = await main.mini.act()
check('键盘 Home：游标回到根行（roving tabindex 只有一个 tabIndex=0）', () => {
  const focused = treeItems(tree).filter((row) => row.props.tabIndex === 0)
  assert.equal(focused.length, 1)
  assert.equal(focused[0].props['data-id'], '')
})
treeRole().props.onKeyDown({ key: 'ArrowDown', preventDefault() {} })
tree = await main.mini.act()
check('键盘 ↓：游标从根行移到第一个目录行（roving tabindex）', () => {
  const focused = treeItems(tree).filter((row) => row.props.tabIndex === 0)
  assert.equal(focused.length, 1)
  assert.equal(focused[0].props['data-id'], 'g1')
})
treeRole().props.onKeyDown({ key: 'ArrowLeft', preventDefault() {} })
tree = await main.mini.act()
check('键盘 ←：折叠目录 → 子行出 rows，但目录行自身还在，且写进 store', () => {
  assert.equal(rowByDataId(tree, 'g1') !== undefined, true)
  assert.equal(rowByDataId(tree, 'wA'), undefined, '折叠后项目行不该在可见行里')
  assert.equal(treeItems(tree).length, 6) // all + g1 + 未分组 + wD/wC/wF
  assert.equal(main.store.data.get('collapsed')['group:g1'], true)
})
treeRole().props.onKeyDown({ key: 'ArrowRight', preventDefault() {} })
tree = await main.mini.act()
check('键盘 →：展开目录 → 行数回到 8', () => {
  assert.equal(treeItems(tree).length, 8)
})
check('鼠标点 caret 也能折叠（并把根行折叠进 store）', () => {
  const caret = byClass(rowByDataId(tree, ''), 'fo-caret')[0]
  assert.ok(caret)
  caret.props.onClick({ stopPropagation() {} })
})
tree = await main.mini.act()
check('根行折叠后只剩 1 行，折叠态落 store', () => {
  assert.equal(treeItems(tree).length, 1)
  assert.equal(main.store.data.get('collapsed').all, true)
})
byClass(rowByDataId(tree, ''), 'fo-caret')[0].props.onClick({ stopPropagation() {} })
tree = await main.mini.act()
check('根行再次展开 → 回到 8 行', () => {
  assert.equal(treeItems(tree).length, 8)
})

/* ---- 6. 右键菜单项 ---- */
rowByDataId(tree, 'g1').props.onContextMenu({ preventDefault() {}, clientX: 30, clientY: 40 })
tree = await main.mini.act()
check('目录行右键：重命名 / 删除 / 分隔线 / 新建目录', () => {
  const menu = menus(tree)[0]
  assert.ok(menu)
  const items = menuItemsOf(menu)
  assert.deepEqual(items.map((item) => item.props['data-id']), ['rename', 'delete', 'new-group'])
  assert.equal(items[1].props['data-danger'], '1')
  assert.ok(textOf(menu).includes('重命名') && textOf(menu).includes('删除') && textOf(menu).includes('新建目录'))
})
check('未分组行右键：只有「新建目录」', () => {
  rowByDataId(tree, '__ungrouped__').props.onContextMenu({ preventDefault() {}, clientX: 20, clientY: 20 })
})
tree = await main.mini.act()
check('未分组菜单项 = [new-group]', () => {
  const items = menuItemsOf(menus(tree)[0])
  assert.deepEqual(items.map((item) => item.props['data-id']), ['new-group'])
})
/* 关掉当前菜单（点菜单外） */
menus(tree)[0].props.onKeyDown({ key: 'Escape', preventDefault() {} })
tree = await main.mini.act()

/* ---- 7. 菜单 rename → groupAction 被调用 ---- */
check('菜单已关闭', () => { assert.equal(menus(tree).length, 0) })
rowByDataId(tree, 'g1').props.onContextMenu({ preventDefault() {}, clientX: 30, clientY: 40 })
tree = await main.mini.act()
menuItemsOf(menus(tree)[0])[0].props.onClick()
tree = await main.mini.act()
check('点「重命名」→ 出现就地输入框（不是弹窗）', () => {
  const input = findAll(tree, (node) => node.kind === 'host' && node.type === 'input' && node.props['aria-label'] === '目录名')
  assert.equal(input.length, 1)
})
check('就地重命名：Enter 提交 → groupAction(rename) 打对了 id 和新名字', () => {
  const input = findAll(tree, (node) => node.kind === 'host' && node.type === 'input' && node.props['aria-label'] === '目录名')[0]
  input.props.onKeyDown({ key: 'Enter', preventDefault() {}, currentTarget: { value: 'QVIZ-新名' } })
})
tree = await main.mini.act()
check('rename 调用体正确', () => {
  const call = main.api.calls.filter((c) => c.method === 'groupAction').pop()
  assert.deepEqual(call.body, { action: 'rename', id: 'g1', name: 'QVIZ-新名' })
})
check('重命名成功后视图用返回的 groups 覆盖（行标题变了）', () => {
  const row = treeItems(tree).find((r) => r.props['data-kind'] === 'group' && r.props['data-id'] === 'g1')
  assert.ok(textOf(row).includes('QVIZ-新名'))
})

/* ---- 8. 拖拽 add → groupAction 被调用 ---- */
check('项目行可拖、目录行可放', () => {
  assert.equal(rowByDataId(tree, 'wC').props.draggable, true)
  assert.equal(rowByDataId(tree, 'g1').props.onDrop instanceof Function, true)
})
rowByDataId(tree, 'wC').props.onDragStart({ dataTransfer: { setData() {}, getData: () => '', effectAllowed: '' } })
tree = await main.mini.act()
check('拖起时源行有 is-drag 高亮', () => {
  assert.ok(classNameOf(rowByDataId(tree, 'wC')).includes('is-drag'))
})
rowByDataId(tree, 'g1').props.onDrop({ preventDefault() {}, dataTransfer: { getData: () => 'wC' } })
tree = await main.mini.act()
check('拖进目录：groupAction(add) 带上正确的目录 id 与项目 key/标签', () => {
  const call = main.api.calls.filter((c) => c.method === 'groupAction').pop()
  assert.deepEqual(call.body, { action: 'add', id: 'g1', member: { key: 'wC', label: '项目C' } })
})
check('拖拽结束后高亮清掉', () => {
  assert.equal(classNameOf(rowByDataId(tree, 'wC')).includes('is-drag'), false)
})

/* ---- 9. 写失败 → role=alert ---- */
const failing = await mountPanel({ groupFails: '目录名不能为空' })
let failTree = failing.tree
rowByDataId(failTree, 'g1').props.onContextMenu({ preventDefault() {}, clientX: 30, clientY: 40 })
failTree = await failing.mini.act()
menuItemsOf(menus(failTree)[0])[1].props.onClick() // 删除
failTree = await failing.mini.act()
check('groupAction 抛错 → 出现 role=alert 的提示条，且带宿主给的文案', () => {
  const alerts = alertBoxes(failTree)
  assert.equal(alerts.length, 1)
  assert.ok(textOf(alerts[0]).includes('目录名不能为空'))
  assert.ok(textOf(alerts[0]).includes('重试'))
})
check('写失败不清空已有数据（图和卡片还在）', () => {
  assert.equal(graphSections(failTree).length, 2)
  assert.equal(cardButtons(failTree).length, 5)
})

/* ---- 10. 读失败 / 坏快照都不炸 ---- */
const brokenLoad = await mountPanel({ overviewFails: '网络断了' })
check('overview 抛错 → 错误占位 + role=alert + 重试按钮', () => {
  assert.ok(textOf(brokenLoad.tree).includes('读不到飞书任务数据'))
  assert.ok(textOf(brokenLoad.tree).includes('重试'))
  assert.equal(alertBoxes(brokenLoad.tree).length, 1)
})
const badSnapshot = {
  ok: true,
  revision: 'rev-bad',
  groups: 'nope',
  workspaces: 3,
  tasks: [null, 1, {}],
  relations: [null, { from: 'x' }, { from: 'a', to: 'b', kind: 'nope' }],
}
const garbage = await mountPanel({ snapshot: badSnapshot })
check('坏快照（字段类型全错）：不抛，渲染成「还没有任何任务」的空态', () => {
  assert.ok(rootOf(garbage.tree))
  assert.equal(graphSections(garbage.tree).length, 0)
  assert.equal(cardButtons(garbage.tree).length, 0)
  assert.ok(textOf(garbage.tree).includes('还没有任何任务'))
})
const muddy = await mountPanel({
  snapshot: {
    ok: true,
    revision: 'rev-muddy',
    groups: [{ id: '', name: '' }, { id: 'g1', name: 'QVIZ', members: [null, 'wA'] }],
    workspaces: 'nope',
    tasks: [null, { id: 'x', no: 'nope', title: null, workspaceKey: 7 }, 'nope'],
    relations: [{ from: 'x', to: 'x', kind: 'depends_on' }, { from: 'x', to: 'yy', kind: 'depends_on' }],
  },
})
check('坏快照（字段半对）：坏行丢掉，剩下的一条照样画出来', () => {
  assert.equal(taskNodes(muddy.tree).length, 1)
  assert.equal(cardButtons(muddy.tree).length, 1)
  assert.equal(ghostNodes(muddy.tree).length, 1) // x→yy：yy 不存在 → 缺失 ghost
  assert.equal(ghostNodes(muddy.tree)[0].props['data-state'], 'ghost')
})
check('坏快照（字段半对）：空目录也留一张图（否则它连重命名/删除的入口都没有）', () => {
  assert.equal(graphSections(muddy.tree).length, 2)
  assert.equal(graphSections(muddy.tree).filter((graph) => nodeGroups(graph).length === 0).length, 1)
  assert.ok(textOf(muddy.tree).includes('这个目录里还没有在场的工作区'))
  assert.equal(treeItems(muddy.tree).length, 4) // all + g1 + 未分组 + project:7
})
const rejected = await mountPanel({ snapshot: { ok: false, error: '宿主不让你看' } })
check('ok:false 的快照被当成失败：alert 里带 error 文案', () => {
  assert.ok(textOf(rejected.tree).includes('宿主不让你看'))
  assert.equal(alertBoxes(rejected.tree).length, 1)
})

/* ---- 11. R2b 回归：写之后才回来的「写前回包」不能盖掉本地 patch ---- */
const queued = []
const raceApi = makeApi(SNAPSHOT, {
  overviewDriver: (callIndex, readState) => {
    if (callIndex === 1) return Promise.resolve(readState())
    return new Promise((resolve) => { queued.push({ resolve, readState, callIndex }) })
  },
})
const race = await mountPanel({ api: raceApi })
let raceTree = race.tree
check('竞态前置：首屏就绪（g1 = 2 项目）', () => {
  assert.ok(textOf(rowByDataId(raceTree, 'g1')).includes('2 项目'))
})
const refreshButton = findAll(raceTree, (node) => node.kind === 'host' && node.type === 'button' && textOf(node).trim() === '刷新')[0]
check('竞态前提前提：刷新按钮在（点它 = 发一次会悬着的 load）', () => { assert.ok(refreshButton) })
refreshButton.props.onClick()
raceTree = await race.mini.act()
check('写之前的那次 load 悬着没回（请求 2）', () => { assert.equal(queued.length, 1) })
rowByDataId(raceTree, 'wC').props.onDragStart({ dataTransfer: { setData() {}, getData: () => '', effectAllowed: '' } })
raceTree = await race.mini.act()
rowByDataId(raceTree, 'g1').props.onDrop({ preventDefault() {}, dataTransfer: { getData: () => 'wC' } })
raceTree = await race.mini.act()
check('写成功后立刻又拉了一次权威快照（请求 3，也悬着）', () => { assert.equal(queued.length, 2) })
check('写成功的乐观 patch 已经上屏（g1 = 3 项目，没等网络）', () => {
  assert.ok(textOf(rowByDataId(raceTree, 'g1')).includes('3 项目'))
})
const postWrite = queued[1]
const preWrite = queued[0]
postWrite.resolve(postWrite.readState()) // 写后的权威快照（新 revision）
raceTree = await race.mini.act()
check('写后回包落地：副标题里的 revision 更新成写后的值', () => {
  assert.ok(textOf(raceTree).includes('rev-writ'), textOf(raceTree).slice(0, 120))
})
preWrite.resolve({ ...SNAPSHOT, revision: 'rev-fixed-1' }) // 写之前发出的旧回包
raceTree = await race.mini.act()
check('R2b：旧回包被丢弃 —— 本地 patch 没被盖回去（g1 仍是 3 项目）', () => {
  assert.ok(textOf(rowByDataId(raceTree, 'g1')).includes('3 项目'), textOf(rowByDataId(raceTree, 'g1')))
})
check('R2b：旧回包也没把 revision.current 拉回写前值', () => {
  assert.equal(textOf(raceTree).includes('rev-fixe'), false)
})
check('R2b：两次悬着的请求都已返回，没有再堆积', () => { assert.equal(queued.length, 2) })

/* ---- 11. 防回退红线：没有字面量颜色 ---- */
const COLOR_RE = /#[0-9a-fA-F]{3,8}\b|\brgba?\(|\bhsla?\(/
check('渲染产物里没有字面量颜色（属性 + style，含自定义属性）', () => {
  const hits = []
  walk(tree, (node) => {
    if (!node || node.kind !== 'host') return
    for (const [key, value] of Object.entries(node.props || {})) {
      if (typeof value === 'string' && COLOR_RE.test(value)) hits.push(`${node.type}.${key}=${value}`)
      if (key === 'style' && value && typeof value === 'object') {
        for (const [sk, sv] of Object.entries(value)) if (typeof sv === 'string' && COLOR_RE.test(sv)) hits.push(`${node.type}.style.${sk}=${sv}`)
      }
    }
  })
  assert.deepEqual(hits, [])
})
check('CSS 里没有字面量颜色，也没有自造调色板（--p-* / --ov-*）', () => {
  assert.deepEqual(CSS.match(/#[0-9a-fA-F]{3,8}\b|\brgba?\(|\bhsla?\(/g) || [], [])
  assert.deepEqual(CSS.match(/--p-[a-z0-9-]+|--ov-[a-z0-9-]+/g) || [], [])
})
check('CSS 只引用宿主那 14 个令牌', () => {
  const allowed = new Set([
    '--dsw-alias-bg-base', '--dsw-alias-bg-layer-1', '--dsw-alias-bg-layer-2', '--dsw-alias-bg-overlay',
    '--dsw-alias-border-l1', '--dsw-alias-border-l2', '--dsw-alias-brand-primary',
    '--dsw-alias-label-primary', '--dsw-alias-label-secondary',
    '--dsw-alias-state-error-primary', '--dsw-alias-state-idle-primary',
    '--dsw-alias-state-success-primary', '--dsw-alias-state-warn-primary',
    '--dsw-specific-sidebar-fill',
  ])
  const used = [...new Set(CSS.match(/--dsw-[a-z0-9-]+/g) || [])]
  assert.deepEqual(used.filter((token) => !allowed.has(token)), [])
  assert.equal(used.length, 14)
})
check('CSS 的选择器都以 fo- 类为根（状态类只作为 .fo-x 的复合修饰，不污染宿主）', () => {
  const roots = [...new Set((CSS.match(/(?:^|[\s,>+~(])\.([a-zA-Z][a-zA-Z0-9_-]*)/gm) || []).map((hit) => hit.replace(/^[\s,>+~(.]*/, '')))]
  assert.ok(roots.length > 20)
  assert.deepEqual(roots.filter((name) => !name.startsWith('fo-')), [])
})

/* ---- 12. 防回退红线：模块顶层不 import react ---- */
const COMPONENT_FILES = ['OverviewPanel.js', 'TreeNav.js', 'GraphView.js', 'TaskCards.js', 'DetailPanel.js', 'styles.js']
for (const file of COMPONENT_FILES) {
  const source = await readFile(join(HERE, '..', 'src', 'client', file), 'utf8')
  check(`${file}：模块顶层不 import react、不 require('react')`, () => {
    assert.equal(/^\s*import[^\n]*['"]react['"]/m.test(source), false)
    assert.equal(/require\(\s*['"]react['"]\s*\)/.test(source), false)
  })
}
const modelSource = await readFile(join(HERE, '..', 'src', 'overview', 'model.js'), 'utf8')
check('model.js：零 import、零副作用（node 可直接 import）', () => {
  assert.deepEqual(modelSource.match(/^\s*import\s/gm) || [], [])
  assert.equal(/require\(/.test(modelSource), false)
  assert.equal(/document\b|window\b|localStorage\b|fetch\(/.test(modelSource), false)
})
const layoutSource = await readFile(join(HERE, '..', 'src', 'overview', 'layout.js'), 'utf8')
check('layout.js：只 import 同目录的 model.js，不碰 document/window/fetch', () => {
  const imports = (layoutSource.match(/^\s*import[\s\S]*?from\s+'([^']+)'/gm) || []).map((line) => line.replace(/[\s\S]*from\s+'/, '').replace(/'$/, ''))
  assert.deepEqual(imports, ['./model.js'])
  assert.equal(/document\b|window\b|localStorage\b|fetch\(/.test(layoutSource), false)
})

/* ---- 汇总 ---- */
console.log(`\noverviewPanel.mjs: ${passed} passed, ${failures.length} failed`)
if (failures.length) {
  for (const name of failures) console.error(`- ${name}`)
  process.exit(1)
}
process.exit(0)
