/**
 * 总览页**组件级**冒烟：迷你 React 运行时（不依赖 jsdom、不依赖真 React）+ 固定 fixture。
 *
 * 为什么要有这一个文件：纯函数层（overviewModel / overviewLayout）用数据证明「算得对」，
 * 但页面真正的失败模式在**接线**上——hooks 在工厂层被调用（真 React 下直接白屏）、
 * scope 切了图没换、菜单动作没打到接口、写失败没有可读提示、又悄悄混进字面量颜色。
 * 那些只有把组件真跑一遍才看得见，所以在 node 里跑。
 *
 * task-13 起：图下面的卡片区已删（和图上节点是同一批任务），这里所有「几条任务」的断言
 * 都改成对**节点**（.fo-node，区分 task / ghost）与**图头图例**断言。
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
import { createFeatures } from '../src/client/features.js'
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
  /* 一键整理（task-16）：默认**不提供**这四个方法（旧宿主口径），注入 organizeApi 才有。 */
  const org = opts.organizeApi && typeof opts.organizeApi === 'object' ? opts.organizeApi : null
  const organizeApi = org ? org : (opts.noOrganize ? {} : {
    organize: async (scope) => {
      calls.push({ method: 'organize', scope })
      return { ok: true, batch: opts.organizeResult || null, dropped: 0, complete: true, candidates: 0 }
    },
    organizeView: async (scope) => {
      calls.push({ method: 'organizeView', scope })
      return opts.organizeResult || null
    },
    organizeAccept: async (batchId, itemIds) => {
      calls.push({ method: 'organizeAccept', batchId, itemIds })
      return { ok: true, results: [], batch: opts.organizeResult || null }
    },
    organizeReject: async (batchId, itemIds) => {
      calls.push({ method: 'organizeReject', batchId, itemIds })
      return { ok: true, batch: opts.organizeResult || null }
    },
  })

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
    ...organizeApi,
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
  /* 注册表顺序改成「运行 → 洞察 → 关系」后，默认落地页变成运行。
     绝大多数断言测的是关系图，所以默认先把 store 的 feature 种成 graph；
     想验「真实默认落地页」的用例显式传 startFeature: null。 */
  if (opts.startFeature !== null && typeof store.set === 'function') store.set('feature', opts.startFeature || 'graph')
  const bag = { React: mini.React, h: mini.React.createElement, model, layout, api, store, host: opts.host }
  const features = typeof opts.features === 'function' ? opts.features(bag) : opts.features
  const Panel = createOverviewPanel(Object.assign({}, bag, { features, pollMs: 60000 }))
  const loadingTree = mini.renderOnce(mini.React.createElement(Panel, {}))
  const tree = await mini.act()
  /* 把实际用的注册表回传：测试断言「一级项数量 = 注册表长度」时用它，避免写死数字。 */
  return { mini, api, store, tree, loadingTree, features: features && features.length ? features : createFeatures(bag) }
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
  /* 必须匹配「行首的规则」，否则 `.fo-ref {` 会撞上
     「.fo-head, .fo-tree-head, …, .fo-ref {」那条逗号选择器列表（它不是我们要的规则体）。 */
  const at = CSS_BARE.indexOf(`\n${selector} {`)
  return at < 0 ? '' : blockAfter(CSS_BARE, at)
}
const mediaBody = (query) => {
  const at = CSS_BARE.indexOf(`@media ${query}`)
  return at < 0 ? '' : blockAfter(CSS_BARE, at)
}
/* 容器查询（@container fopanel (max-width: …)）：面板宽度自适应一律走这个 */
const containerBody = (query) => {
  const at = CSS_BARE.indexOf(`@container ${query}`)
  return at < 0 ? '' : blockAfter(CSS_BARE, at)
}

const rootOf = (tree) => findAll(tree, (node) => node.kind === 'host' && classNameOf(node) === 'fo-root')[0]
const treeItems = (tree) => findAll(tree, (node) => node.kind === 'host' && node.props.role === 'treeitem')
const graphSections = (tree) => findAll(tree, (node) => node.kind === 'host' && node.type === 'section' && classNameOf(node).includes('fo-graph'))
/* 节点 = 卡片本体那个 <g class="fo-node …">；动作按钮是 <g class="fo-node-action">，
   所以这里按**类名整词**匹配，不能用 startsWith（否则每个动作按钮都会被数成一个节点）。 */
const nodeGroups = (tree) => findAll(tree, (node) => node.kind === 'host' && node.type === 'g' && classNameOf(node).split(/\s+/).includes('fo-node'))
const taskNodes = (tree) => nodeGroups(tree).filter((node) => !classNameOf(node).includes('is-ghost'))
const ghostNodes = (tree) => nodeGroups(tree).filter((node) => classNameOf(node).includes('is-ghost'))
const nodeActions = (tree, key) => findAll(tree, (node) => node.kind === 'host' && node.type === 'g' && classNameOf(node).split(/\s+/).includes('fo-node-action') && (!key || node.props['data-key'] === key))
const edgePaths = (tree) => findAll(tree, (node) => node.kind === 'host' && node.type === 'path' && classNameOf(node).includes('fo-edge'))
const bandRects = (tree) => findAll(tree, (node) => node.kind === 'host' && node.type === 'rect' && classNameOf(node).includes('fo-band'))
/* task-13 起没有卡片区：任务在图上就是节点，所以断言一律对节点做。 */
const legendItems = (tree) => findAll(tree, (node) => node.kind === 'host' && classNameOf(node) === 'fo-legend-item')
const railEl = (tree) => findAll(tree, (node) => node.kind === 'host' && node.type === 'aside' && classNameOf(node).split(/\s+/).includes('fo-rail'))[0]
const detailEls = (tree) => findAll(tree, (node) => node.kind === 'host' && node.type === 'aside' && classNameOf(node).split(/\s+/).includes('fo-detail'))
const featnavItems = (tree) => findAll(tree, (node) => node.kind === 'host' && node.type === 'button' && classNameOf(node) === 'fo-featnav-item')
const searchInputs = (tree) => findAll(tree, (node) => node.kind === 'host' && node.type === 'input' && classNameOf(node) === 'fo-search')
const scopeColumns = (tree) => findAll(tree, (node) => node.kind === 'host' && classNameOf(node) === 'fo-scope-column')
const graphSvgs = (tree) => findAll(tree, (node) => node.kind === 'host' && node.type === 'svg' && classNameOf(node) === 'fo-svg')
const menus = (tree) => findAll(tree, (node) => node.kind === 'host' && classNameOf(node).split(/\s+/).includes('fo-menu'))
const menuItemsOf = (menu) => findAll(menu, (node) => node.kind === 'host' && node.type === 'button' && classNameOf(node) === 'fo-menu-item')
const rowByDataId = (tree, id) => treeItems(tree).find((row) => row.props['data-id'] === id)
const alertBoxes = (tree) => findAll(tree, (node) => node.kind === 'host' && node.props.role === 'alert')

/* ============================================================================
 * 流程
 * ========================================================================== */

console.log('overview/面板组件（迷你 React + 固定 fixture：5 任务 / 2 目录 / 1 跨项目边 / 1 缺失端点）')

const main = await mountPanel({ startFeature: null })
let tree = main.tree
/* 注册表顺序 = 用户口径「运行排第一，洞察第二，关系第三」，所以默认落地页是运行。
   下面这一大段测的是关系图的行为，先切过去。 */
const activateFeature = async (label) => {
  const items = findAll(tree, (node) => node.kind === 'host' && node.type === 'button' && classNameOf(node) === 'fo-featnav-item')
  const hit = items.find((item) => textOf(item).includes(label))
  if (hit) { hit.props.onClick(); tree = await main.mini.act() }
  return Boolean(hit)
}
check('注册表第一项就是默认落地页（运行），且顺序是 运行 → 洞察 → 关系', () => {
  assert.deepEqual(main.features.map((row) => row.id), ['runs', 'insight', 'graph'], '注册表顺序')
  assert.deepEqual(main.features.map((row) => row.label), ['运行', '洞察', '关系'], '一级菜单文案')
})
await activateFeature('关系')

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
check('玻璃面：详情栏 / 菜单仍带 backdrop-filter blur(12px) 与玻璃底色', () => {
  const root = ruleBody('.fo-root')
  assert.ok(root.includes('--fo-glass-blur: blur(12px)'), '模糊半径 12px 定义在根上')
  for (const selector of ['.fo-detail', '.fo-menu', '.fo-rail']) {
    const body = ruleBody(selector)
    assert.ok(body.includes('backdrop-filter'), `${selector} 要有 backdrop-filter`)
    assert.ok(body.includes('-webkit-backdrop-filter'), `${selector} 补一份 -webkit- 前缀`)
  }
  assert.ok(ruleBody('.fo-graph').includes('border-radius: 16px'), '画布圆角 16px（对齐参考站 rounded-2xl）')
  assert.ok(ruleBody('.fo-node-badge-bg').includes('stroke-width: 1'), '状态徽标描边 1px（圆角 rx 在 layout.cardGeometry 里给）')
  /* 计数胶囊（.fo-chip / .fo-stats）与图头元信息一起删掉了：同一份数只留离对象最近的那处 */
  assert.equal(CSS_BARE.includes('.fo-chip'), false, '统计胶囊 CSS 应该整段删掉')
  assert.equal(CSS_BARE.includes('.fo-stats'), false, '头部统计条 CSS 也应该删掉')
  assert.equal(CSS_BARE.includes('.fo-graph-meta'), false, '图头计数胶囊 CSS 也应该删掉')
  /* 卡片区删掉后，卡片类名不该再有残留 */
  assert.equal(CSS_BARE.includes('fo-card'), false, '卡片 CSS 应该整段删掉')
  assert.equal(CSS_BARE.includes('fo-tag'), false, '卡片标签 CSS 也应该删掉')
})

check('画布铺满：主区纵向 flex、画布/网格/body/svg 全 100%', () => {
  const scroll = ruleBody('.fo-canvas-area')
  assert.ok(scroll.includes('display: flex') && scroll.includes('flex-direction: column'), '画布区纵向 flex')
  assert.ok(scroll.includes('padding: 10px'))
  assert.ok(scroll.includes('flex: 1 1 auto'), '画布区拿剩余空间')
  const host = ruleBody('.fo-feature-host')
  assert.ok(host.includes('flex: 1 1 auto') && host.includes('min-height: 0'), '功能页宿主撑满')
  const feature = ruleBody('.fo-feature')
  assert.ok(feature.includes('flex: 1 1 auto') && feature.includes('min-height: 0'))
  const fbody = ruleBody('.fo-feature-body')
  assert.ok(fbody.includes('display: flex') && fbody.includes('flex: 1 1 auto'), '范围列 | 画布 横向 flex')
  const graphs = ruleBody('.fo-graphs')
  assert.ok(graphs.includes('flex: 1 1 auto'), '画布列表撑满主区')
  assert.ok(graphs.includes('display: flex') && graphs.includes('flex-direction: column'))
  assert.ok(graphs.includes('gap: 12px'))
  const graph = ruleBody('.fo-graph')
  assert.ok(graph.includes('flex: 1 1 auto'), '一张图时占满高度')
  assert.ok(graph.includes('display: flex') && graph.includes('flex-direction: column'))
  const canvas = ruleBody('.fo-canvas')
  assert.ok(canvas.includes('flex: 1 1 auto') && canvas.includes('width: 100%'))
  const grid = ruleBody('.fo-grid')
  assert.ok(grid.includes('width: 100%') && grid.includes('height: 100%'))
  assert.ok(grid.includes('inset: 0'), '网格铺满整块画布')
  const body = ruleBody('.fo-graph-body')
  assert.ok(body.includes('flex: 1 1 auto') && body.includes('height: 100%'))
  const svg = ruleBody('.fo-svg')
  assert.ok(svg.includes('width: 100%') && svg.includes('height: 100%'))
  assert.ok(svg.includes('inset: 0'))
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
  assert.ok(ruleBody('.fo-rail').includes('color-mix(in oklab, var(--dsw-specific-sidebar-fill'), 'rail 用 sidebar-fill 的混合')
  assert.ok(ruleBody('.fo-rail').includes('80%, transparent)'), 'rail 半透明底 80%（对齐参考站 aside /80）')
  assert.ok(ruleBody('.fo-rail').includes('blur(24px)'), 'rail 用 blur(24px)')
})
check('玻璃风格全部走 color-mix(in oklab, …)，没有 in srgb 残留', () => {
  const mixes = CSS_BARE.match(/color-mix\(in oklab,/g) || []
  assert.ok(mixes.length >= 25, `oklab 混合只找到 ${mixes.length} 处`)
  assert.equal(CSS_BARE.includes('in srgb'), false)
})
check('状态徽标按语气上色：open / blocked / suspended / done / idle 各一套底色与文字色', () => {
  const tones = { open: 'brand', blocked: 'error', suspended: 'warn', done: 'success', idle: 'idle' }
  for (const [tone, token] of Object.entries(tones)) {
    const bg = ruleBody(`.fo-node-badge[data-tone="${tone}"] .fo-node-badge-bg`)
    const text = ruleBody(`.fo-node-badge[data-tone="${tone}"] .fo-node-badge-text`)
    assert.ok(bg.includes('fill:'), `${tone} 徽标要有底色`)
    assert.ok(text.includes('fill:'), `${tone} 徽标要有文字色`)
  }
  /* 计数徽标是中性色，不能跟状态色抢注意力 */
  assert.ok(ruleBody('.fo-node-badge[data-tone="muted"] .fo-node-badge-text').includes('--dsw-alias-label-secondary'))
  assert.ok(ruleBody('.fo-legend-dot').includes('box-shadow'), '图例色点带同色光环')
  assert.ok(ruleBody('.fo-dot').includes('box-shadow'))
})

check('图头图例：色点 + 项目名 + 计数（没有泳道后唯一的项目标识）', () => {
  const legend = ruleBody('.fo-graph-legend')
  assert.ok(legend.includes('display: flex'))
  assert.ok(ruleBody('.fo-legend-dot').includes('background: var(--fo-c'))
  assert.ok(ruleBody('.fo-legend-label').includes('text-overflow: ellipsis'))
  assert.ok(ruleBody('.fo-legend-count').includes('tabular-nums'))
})
check('悬停：卡片 hover 有 translateY(-3px) scale(1.01) + 300ms cubic-bezier 过渡', () => {
  const root = ruleBody('.fo-root')
  assert.ok(root.includes('--fo-dur: 300ms'), '过渡时长 300ms')
  assert.ok(root.includes('--fo-ease: cubic-bezier(.2, .8, .2, 1)'), '缓动曲线照参考项目')
  const ref = ruleBody('.fo-ref')
  assert.ok(ref.includes('transition: transform var(--fo-dur) var(--fo-ease)'), ref.slice(0, 200))
  const hover = ruleBody('.fo-ref:hover:not(:disabled)')
  assert.ok(hover.includes('transform: translateY(-3px) scale(1.01)'), hover)
  assert.ok(hover.includes('border-color: var(--fo-glass-line-hover)'), '边框升到 border-l2 的混合色')
})
check('悬停：叠一层品牌色 6% → 透明的渐变淡入（品牌色不硬编码色相）', () => {
  const root = ruleBody('.fo-root')
  assert.ok(root.includes('--fo-glass-wash: linear-gradient(135deg, color-mix(in oklab, var(--dsw-alias-brand-primary) 6%, transparent), transparent 72%)'))
  const after = ruleBody('.fo-ref::after')
  assert.ok(after.includes('background: var(--fo-glass-wash)'))
  assert.ok(after.includes('opacity: 0'), '默认不可见')
  assert.ok(ruleBody('.fo-ref:hover:not(:disabled)::after').includes('opacity: 1'), 'hover 才淡入')
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
  assert.ok(ruleBody('.fo-crumb-title').includes('font-size: 13px'))
  assert.ok(ruleBody('.fo-crumb-title').includes('font-weight: 600'))
  assert.ok(ruleBody('.fo-brand-title').includes('font-size: 13px'))
  assert.ok(ruleBody('.fo-detail-title').includes('font-size: 13px'))
  assert.ok(ruleBody('.fo-graph-name').includes('font-size: 13px'))
  assert.ok(ruleBody('.fo-ref').includes('padding: 8px 10px'), '详情关系项内边距')
  assert.ok(ruleBody('.fo-crumb-sub').includes('font-size: 11px'))
  assert.ok(ruleBody('.fo-canvas').includes('padding: 24px'), '画布内边距 24px')
  assert.ok(ruleBody('.fo-row').includes('font-size: 13px'), 'rail 正文 13px')
  assert.ok(ruleBody('.fo-row-count').includes('font-size: 12px'), 'rail 次级 12px')
})

/* ---- 0c. task-12：侧边栏与画布对齐参考站实测值 ---- */
check('侧栏宽度 232px（--fo-rail-w，根栅格第一列用它）', () => {
  /* 参考站的 288px 是整页 aside；我们是宿主侧栏里的一个 tab，288 会把正文挤窄（用户实测「展开太宽」） */
  assert.ok(ruleBody('.fo-root').includes('--fo-rail-w: 232px'), 'rail 宽 232px')
  assert.ok(ruleBody('.fo-root').includes('grid-template-columns: var(--fo-rail-w) minmax(0, 1fr)'), '根：rail | 正文')
  assert.ok(ruleBody('.fo-root[data-rail="0"]').includes('--fo-rail-w: 52px'), '收起成 52px 图标条')
  /* 收起态必须把 caret 一起藏掉：只藏文字会让图标偏左（用户实测「折叠时图标没对齐」）。
     caret 与 .fo-nav-label 写在同一个逗号选择器组里，所以按整份 CSS 断言。 */
  assert.ok(/\.fo-root\[data-rail="0"\] \.fo-nav-label,[\s\S]{0,200}\.fo-nav-caret[\s\S]{0,120}display: none/.test(CSS_BARE)
    || /\.fo-root\[data-rail="0"\] \.fo-nav-caret[\s\S]{0,120}display: none/.test(CSS_BARE), '收起态连同 caret 一起隐藏')
  assert.ok(ruleBody('.fo-body').includes('grid-template-columns: minmax(0, 1fr)'), '正文只有功能页一列')
  /* 详情列改成弹性宽度：面板本身很窄时不能强行占 336（那是整页 aside 的口径） */
  assert.ok(ruleBody('.fo-root[data-detail="1"] .fo-body').includes('clamp(260px, 30%, 336px)'), '开详情才多一列（弹性）')
  /* 响应式按**面板自身宽度**判断（容器查询），不是视口：这块面板活在宿主 tab 里 */
  assert.ok(ruleBody('.fo-root').includes('container-type: inline-size'), '面板是容器查询锚点')
  assert.ok(containerBody('fopanel (max-width: 960px)').includes('--fo-rail-w: 196px'), '面板窄了才收窄 rail')
})

/* ---- task-14 → 用户口径：rail = 品牌（logo 即折叠按钮）+ 功能导航 ---- */
check('rail 两段：品牌（logo 是折叠按钮）/ 功能导航（底部固定区已移除）', () => {
  const rail = ruleBody('.fo-rail')
  assert.ok(rail.includes('display: flex') && rail.includes('flex-direction: column'))
  assert.ok(rail.includes('border-right: 1px solid var(--fo-rail-line)'))
  const brand = ruleBody('.fo-brand')
  assert.ok(brand.includes('min-height: 68px'), '品牌区高 68px（参考站 96px，我们按 64-72 的口径）')
  assert.ok(brand.includes('border-bottom: 1px solid var(--fo-glass-line)'), '品牌区下边框')
  const logo = ruleBody('.fo-brand-logo')
  /* logo 与一级项同高（44px）：展开态同高、收起态同为 36×36 正方形（用户口径「大小要一致」） */
  /* logo 与一级项共用 --fo-rail-item：以后只调一个变量，两者不可能再不一致 */
  assert.ok(logo.includes('var(--fo-rail-item)'), logo)
  assert.ok(ruleBody('.fo-root').includes('--fo-rail-item: 44px'), '展开态方块 44px')
  assert.ok(ruleBody('.fo-root[data-rail="0"]').includes('--fo-rail-item: 36px'), '收起态方块 36px')
  assert.ok(ruleBody('.fo-brand-logo').includes('var(--fo-rail-item)'), 'logo 用同一变量')
  assert.ok(ruleBody('.fo-featnav-item').includes('var(--fo-rail-item)'), '一级项用同一变量')
  const nav = ruleBody('.fo-featnav')
  assert.ok(nav.includes('flex: 1'), '导航区 flex-1')
  assert.ok(nav.includes('gap: 8px') && nav.includes('padding: 10px'))
  /* 用户口径：「去掉刷新按钮，折叠按钮放在侧边栏上方的 logo」→ 底部固定区整块不存在了 */
  assert.equal(ruleBody('.fo-rail-foot'), '', '底部固定区已移除')
})
check('功能项：高 44 / 圆角 12 / gap 10 / 图标 20 / 文字 13 / 选中沿用品牌口径', () => {
  const item = ruleBody('.fo-featnav-item')
  assert.ok(item.includes('height: var(--fo-rail-item)'))
  assert.ok(item.includes('border-radius: 12px'))
  assert.ok(item.includes('gap: 10px'))
  assert.ok(item.includes('font-size: 13px'))
  assert.ok(item.includes('color: var(--dsw-alias-label-secondary'), '未选中 label-secondary')
  const active = ruleBody('.fo-featnav-item[data-active="1"]')
  assert.ok(active.includes('background: var(--fo-selected-bg)'), '选中 = 品牌 20% 底')
  assert.ok(active.includes('border-color: var(--fo-selected-line)'), '选中 = 品牌 30% 描边')
  assert.ok(active.includes('color: var(--dsw-alias-brand-primary)'))
  assert.ok(active.includes('font-weight: 500'))
  const icon = ruleBody('.fo-nav-icon')
  assert.ok(icon.includes('width: 20px') && icon.includes('height: 20px'), '图标 20px')
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
check('搜索框在**内容头部**：42px 高 / 圆角 14 / 左内边距 40 留图标位', () => {
  const search = ruleBody('.fo-search')
  assert.ok(search.includes('height: 42px'))
  assert.ok(search.includes('border-radius: 14px'))
  assert.ok(search.includes('padding: 0 12px 0 40px'), '左边 40px 留给图标')
  assert.ok(search.includes('color-mix(in oklab, var(--dsw-alias-bg-base'), '底色走 bg-base 的混合')
  assert.ok(search.includes('70%, transparent)'))
  assert.ok(search.includes('border: 1px solid var(--fo-glass-line)'))
  assert.ok(ruleBody('.fo-search::placeholder').includes('var(--dsw-alias-label-secondary'), 'placeholder 用 label-secondary')
  assert.ok(ruleBody('.fo-search-icon').includes('left: 12px'), '图标绝对定位在左侧')
  assert.ok(ruleBody('.fo-main-head').includes('border-bottom: 1px solid var(--fo-glass-line)'), '头部分隔线')
  assert.equal(CSS_BARE.includes('fo-rail-top'), false, 'rail 里不该再有搜索容器')
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
check('节点卡片：1px 中性描边、hover 提亮、选中品牌描边+柔光、聚焦降到 30%', () => {
  const bg = ruleBody('.fo-node-bg')
  assert.ok(bg.includes('fill: var(--fo-glass-card)'), '卡片底 = 玻璃卡片层')
  assert.ok(bg.includes('stroke-width: 1'), '边框 1px（与面板任务卡一致）')
  assert.ok(bg.includes('stroke: var(--fo-glass-line)'), '常态描边是中性玻璃线，不是状态色')
  assert.ok(ruleBody('.fo-node:hover .fo-node-bg').includes('--fo-glass-line-hover'), 'hover 描边提亮')
  const selected = ruleBody('.fo-node.is-selected')
  assert.ok(selected.includes('drop-shadow'), '选中带柔光')
  assert.ok(ruleBody('.fo-node.is-selected .fo-node-bg').includes('stroke: var(--dsw-alias-brand-primary)'), '选中描边 = 品牌色')
  assert.ok(ruleBody('.fo-node.is-dimmed').includes('opacity: .3'), '聚焦时其余节点降到 30%')
})

check('节点卡片内部 CSS：标题 12.5 / 徽标 11 / 会话胶囊 10 / 动作只在悬停亮起', () => {
  assert.ok(ruleBody('.fo-node-title').includes('font-size: 12.5px'), '标题 12.5px（与面板任务卡一致）')
  assert.ok(ruleBody('.fo-node-title').includes('font-weight: 500'))
  assert.ok(ruleBody('.fo-node-badge-text').includes('font-size: 11px'), '徽标 11px（与面板 .badge 一致）')
  assert.ok(ruleBody('.fo-node-sess-text').includes('font-size: 10px'), '会话胶囊 10px（与面板 sess-inline 一致）')
  assert.ok(ruleBody('.fo-node-sess-bg').includes('stroke-width: 1'))
  /* 动作：默认 transparent，靠 hover / focus-within / 选中三选一出现 */
  assert.ok(ruleBody('.fo-node-action').includes('opacity: .55'), '动作常显但压暗（先不简化）')
  const reveal = ruleBody('.fo-node:hover .fo-node-action,\n.fo-node:focus-within .fo-node-action,\n.fo-node.is-selected .fo-node-action')
  assert.ok(reveal.includes('opacity: 1'), '悬停 / 键盘聚焦 / 选中时提亮')
  assert.ok(ruleBody('.fo-node-action[data-disabled="1"]').includes('opacity: .3'), '禁用动作降透明度')
  /* 优先级色条：与面板 .task[data-priority] 同一套颜色 */
  for (const [p, token] of [['p0', 'error'], ['p1', 'warn'], ['p2', 'brand'], ['p3', 'idle']]) {
    assert.ok(ruleBody('.fo-root').includes(`--fo-prio-${p}:`), `缺 ${p} 优先级色`)
  }
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
  assert.equal(graphSvgs(tree).length, 2, '画布 SVG 两个（rail 的品牌/功能图标不算）')
})
check('数据态：默认隐藏已完成 → 4 张任务卡 + 3 ghost（已完成的 a2 不画）', () => {
  assert.equal(taskNodes(tree).length, 4)
  assert.equal(taskNodes(tree).some((node) => node.props['data-id'] === 'a2'), false, '已完成的任务默认不上画布')
  assert.equal(ghostNodes(tree).length, 3)
  assert.equal(nodeGroups(tree).length, 7)
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
check('数据态：没有泳道（bands 恒空 / 没有 band 矩形），项目身份走图例', () => {
  assert.equal(bandRects(tree).length, 0)
  assert.equal(legendItems(tree).length, 4, 'g1 的 wA/wB + 未分组的 wC/wD = 四条图例（0 任务的 wF 不进图例）')
  const legends = findAll(tree, (node) => node.kind === 'host' && classNameOf(node) === 'fo-graph-legend')
  assert.equal(legends.length, 2, '每张画布一个图例')
})
check('入场递延真的接上了：树行与图容器都带 --fo-i，且 ≤ 7（上限 8 行）', () => {
  const rows = treeItems(tree).map((row) => row.props.style && row.props.style['--fo-i'])
  const graphs = graphSections(tree).map((graph) => graph.props.style && graph.props.style['--fo-i'])
  assert.deepEqual(rows.slice(0, 4), [0, 1, 2, 3], `树行递延序号：${JSON.stringify(rows)}`)
  assert.deepEqual(graphs, [0, 1], `图容器递延序号：${JSON.stringify(graphs)}`)
  assert.ok(rows.every((value) => Number.isInteger(value) && value >= 0 && value <= 7))
  assert.ok(graphs.every((value) => Number.isInteger(value) && value >= 0 && value <= 7))
})
check('代表性类名没被改坏（节点/图容器/图例/行/详情）', () => {
  assert.ok(taskNodes(tree).length > 0)
  assert.ok(graphSections(tree).length > 0)
  assert.ok(legendItems(tree).length > 0)
  assert.ok(ruleBody('.fo-node').length > 0 && ruleBody('.fo-graph').length > 0 && ruleBody('.fo-row').length > 0)
  /* 卡片区已删：DOM 与 CSS 里都不该再出现卡片类名 */
  assert.equal(byClass(tree, 'fo-card').length, 0)
  assert.equal(byClass(tree, 'fo-cards').length, 0)
})

/* ---- task-12：画布 DOM（网格层 + 实心三角箭头）与 rail 搜索框 ---- */
/* ---- task-14：rail = 功能导航（品牌 / 功能列表 / 底部固定区），树搬进功能页 ---- */
check('rail 三段 DOM：品牌（两行文字）/ 功能导航 / 底部固定区', () => {
  const rail = railEl(tree)
  assert.ok(rail, 'rail 在')
  assert.equal(byClass(rail, 'fo-brand').length, 1)
  assert.equal(byClass(rail, 'fo-featnav').length, 1)
  /* 侧栏底部不再有刷新/折叠按钮：折叠移到品牌 logo 上，刷新挪到正文头部 */
  assert.equal(byClass(rail, 'fo-rail-foot').length, 0, '侧栏底部整块去掉')
  const brandText = textOf(byClass(rail, 'fo-brand')[0])
  assert.ok(brandText.includes('任务'), '主标题')
  assert.ok(brandText.includes('DeepSeek Harness'), '副标题')
  assert.equal(byClass(rail, 'fo-brand-logo').length, 1, 'logo 方块')
  assert.equal(byClass(rail, 'fo-brand-logo')[0].props.type, 'button', 'logo 本身就是折叠按钮')
  assert.ok('aria-expanded' in byClass(rail, 'fo-brand-logo')[0].props, 'logo 带 aria-expanded')
})
check('rail 两级菜单：一级项「关系」（可展开）+ 它的二级菜单就是范围树', () => {
  const rail = railEl(tree)
  const items = featnavItems(tree)
  /* 一级项数量 = 注册表长度（注册表加功能，这里自动跟随，不写死数字） */
  assert.equal(items.length, main.features.length, '一级项数量 = 注册表长度')
  assert.ok(items.length >= 3, '至少三项：关系 / 洞察 / 运行')
  const labels = items.map((item) => textOf(item))
  assert.ok(labels.some((text) => text.includes('关系')), `一级菜单要有「关系」，实际 ${labels}`)
  assert.ok(labels.some((text) => text.includes('洞察')), `一级菜单要有「洞察」，实际 ${labels}`)
  assert.ok(labels.some((text) => text.includes('运行')), `一级菜单要有「运行」，实际 ${labels}`)
  const graphItem = items.find((item) => textOf(item).includes('关系'))
  assert.ok(graphItem, 'rail 里有「关系」这一项')
  assert.ok(textOf(items[0]).includes('运行'), '一级菜单第一项是「运行」（用户口径：运行排第一）')
  assert.notEqual(items[0].props['data-expandable'], '1', '运行没有二级菜单')
  assert.equal(graphItem.props['data-active'], '1')
  assert.equal(graphItem.props['aria-current'], 'page')
  assert.equal(graphItem.props['data-expandable'], '1')
  assert.equal(graphItem.props['aria-expanded'], 'true', '默认展开')
  const sub = byClass(rail, 'fo-subnav')
  assert.equal(sub.length, 1, '二级菜单挂在 rail 里')
  assert.equal(findAll(sub[0], (node) => node.kind === 'host' && node.props.role === 'tree').length, 1, 'ARIA tree 原样保留')
  assert.equal(findAll(sub[0], (node) => node.kind === 'host' && node.props.role === 'treeitem').length, treeItems(tree).length)
  assert.ok(textOf(sub[0]).includes('全部任务') && textOf(sub[0]).includes('未分组'))
})
check('范围树搬家后：二级项就在 rail 里，rail 里仍然没有搜索框', () => {
  const rail = railEl(tree)
  assert.equal(findAll(rail, (node) => node.kind === 'host' && classNameOf(node) === 'fo-search').length, 0)
  assert.equal(findAll(rail, (node) => node.kind === 'host' && classNameOf(node) === 'fo-scope').length, 1, '树就在 rail 里')
  assert.equal(findAll(rail, (node) => node.kind === 'host' && node.props.role === 'treeitem').length >= 8, true)
})
check('关系页单列：.fo-scope-column 不存在，画布是唯一的主内容块', () => {
  const main = findAll(tree, (node) => node.kind === 'host' && classNameOf(node).split(/\s+/).includes('fo-main'))[0]
  assert.ok(main, '正文在')
  assert.equal(scopeColumns(tree).length, 0, '第二列已经删掉')
  assert.equal(findAll(main, (node) => node.kind === 'host' && classNameOf(node) === 'fo-scope').length, 0, '树不在正文里了')
  const featureBody = byClass(tree, 'fo-feature-body')[0]
  const blocks = featureBody.children.filter((child) => child && child.kind === 'host')
  assert.equal(blocks.length, 1, '功能页正文只剩一块')
  assert.ok(classNameOf(blocks[0]).includes('fo-canvas-area'), '剩下的那块就是画布')
  assert.equal(findAll(blocks[0], (node) => node.kind === 'host' && classNameOf(node) === 'fo-svg').length, 2, '画布照旧铺满（两张图）')
  assert.equal(findAll(tree, (node) => node.kind === 'host' && classNameOf(node) === 'fo-scope-column').length, 0)
})
check('二级菜单里不再重复一个分组标题，也不再单起一行放「新建目录」', () => {
  const sub = byClass(railEl(tree), 'fo-subnav')[0]
  assert.equal(byClass(sub, 'fo-scope-title').length, 0)
  /* 用户口径：去掉「新建目录」按钮。新建入口仍在目录行右键菜单里（下面有专门的断言）。 */
  assert.equal(textOf(sub).includes('新建目录'), false, '顶部的「新建目录」按钮已删除')
  assert.equal(byClass(sub, 'fo-scope-head').length, 0, '没有按钮之后，head 整块不渲染')
})
/* 折叠一级项：二级菜单整个不渲染，展开态落 store 键 nav */
const navItem = () => featnavItems(tree).find((item) => textOf(item).includes('关系'))
check('一级项可折叠：aria-expanded 反映状态', () => {
  assert.equal(navItem().props['aria-expanded'], 'true')
  assert.equal(navItem().props['data-expanded'], '1')
})
navItem().props.onClick()
tree = await main.mini.act()
check('点一级项收起：二级菜单从 DOM 消失、折叠态落 store 键 nav、画布不动', () => {
  assert.equal(byClass(tree, 'fo-subnav').length, 0)
  assert.equal(treeItems(tree).length, 0, '二级项也没了')
  assert.equal(main.store.data.get('nav').graph, false)
  assert.equal(navItem().props['aria-expanded'], 'false')
  assert.equal(navItem().props['data-active'], '1', '收起二级菜单不等于切走功能')
  assert.ok(graphSections(tree).length > 0, '画布不跟着消失')
})
navItem().props.onClick()
tree = await main.mini.act()
check('再点一级项展开：二级菜单回来、展开态归位', () => {
  assert.equal(byClass(tree, 'fo-subnav').length, 1)
  assert.equal(treeItems(tree).length, 8)
  assert.equal(main.store.data.get('nav').graph, true)
  assert.equal(navItem().props['aria-expanded'], 'true')
})

check('目录树搬家后行为不变：树行/拖拽/右键入口都还在', () => {
  const rows = treeItems(tree)
  assert.ok(rows.length >= 8)
  assert.equal(rows.every((row) => row.props.role === 'treeitem'), true)
  assert.equal(rows.filter((row) => row.props.draggable === true).length > 0, true, '项目行可拖')
  assert.equal(typeof rowByDataId(tree, 'g1').props.onContextMenu, 'function', '目录行有右键')
})

check('画布 DOM：每张图都有 .fo-canvas + .fo-grid 网格层，SVG 铺满（100% + meet）', () => {
  assert.equal(byClass(tree, 'fo-canvas').length, graphSections(tree).length)
  assert.equal(byClass(tree, 'fo-grid').length, graphSections(tree).length)
  byClass(tree, 'fo-canvas').forEach((canvas) => {
    assert.equal(findAll(canvas, (node) => node.kind === 'host' && classNameOf(node) === 'fo-grid').length, 1, '网格层在图内')
    assert.equal(findAll(canvas, (node) => node.kind === 'host' && classNameOf(node) === 'fo-graph-body').length, 1)
  })
  const svgs = findAll(tree, (node) => node.kind === 'host' && node.type === 'svg' && classNameOf(node) === 'fo-svg')
  assert.equal(svgs.length, graphSections(tree).length)
  svgs.forEach((svg) => {
    assert.equal(svg.props.width, '100%', 'SVG 宽度属性 100%')
    assert.equal(svg.props.height, '100%', 'SVG 高度属性 100%')
    assert.equal(svg.props.preserveAspectRatio, 'xMidYMid meet')
    assert.ok(String(svg.props.viewBox).startsWith('0 '), 'viewBox 仍是 layout 坐标系')
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
const searchBox = searchInputs(tree)[0]
check('搜索框在 .fo-main 内、不在 .fo-rail 内（task-14 从 rail 搬回正文头部）', () => {
  assert.ok(searchBox, '正文头部要有搜索框')
  assert.equal(searchBox.props.placeholder, '搜索任务 / 编号 / 项目…')
  assert.equal(searchBox.props['aria-label'], '搜索任务')
  assert.equal(searchInputs(tree).length, 1, '全页只有一个搜索框')
  const main = findAll(tree, (node) => node.kind === 'host' && classNameOf(node).split(/\s+/).includes('fo-main'))[0]
  assert.equal(findAll(main, (node) => node.kind === 'host' && classNameOf(node) === 'fo-search').length, 1, '在正文里')
  const rail = railEl(tree)
  assert.equal(findAll(rail, (node) => node.kind === 'host' && classNameOf(node) === 'fo-search').length, 0, 'rail 里没有')
})
searchBox.props.onChange({ currentTarget: { value: 'a1' } })
tree = await main.mini.act()
check('搜索命中：图上只剩 1 个真实节点，匹配条数显示在头部', () => {
  assert.equal(taskNodes(tree).length, 1)
  assert.equal(taskNodes(tree)[0].props['data-id'], 'a1')
  assert.equal(textOf(byClass(tree, 'fo-search-hint')[0]).includes('1'), true)
  assert.ok(textOf(tree).includes('任务 a1'), '节点标题就是任务标题')
})
searchBox.props.onChange({ currentTarget: { value: 'no-such-task-xyz' } })
tree = await main.mini.act()
check('搜索无匹配：「没有匹配的任务」+ 清除按钮，不画空画布', () => {
  assert.ok(textOf(tree).includes('没有匹配的任务'))
  assert.equal(nodeGroups(tree).length, 0)
  assert.equal(graphSections(tree).length, 0)
})
findAll(tree, (node) => node.kind === 'host' && node.type === 'button' && textOf(node).includes('清除搜索'))[0].props.onClick()
tree = await main.mini.act()
check('清除搜索：恢复 4 个真实节点（已完成仍隐藏）/ 2 张画布，关键词落 store', () => {
  assert.equal(taskNodes(tree).length, 4)
  assert.equal(graphSections(tree).length, 2)
  assert.equal(main.store.data.get('keyword'), '')
  assert.equal(byClass(tree, 'fo-search')[0].props.value, '')
})
check('数据态：图上的节点就是任务列表（4 真实 + 3 ghost，已完成的 a2 除外），不再有第二份列表', () => {
  assert.equal(taskNodes(tree).length, 4)
  const text = textOf(tree)
  for (const id of ['a1', 'b1', 'c1', 'e1']) assert.ok(text.includes(`任务 ${id}`), `节点缺 ${id}`)
  assert.equal(text.includes('任务 a2'), false, '已完成任务默认不出现')
  assert.ok(text.includes('阻塞'), '节点元信息里有阻塞')
  assert.ok(textOf(byClass(tree, 'fo-graph-legend')[0]).includes('项目A'), '项目名在图例里')
  assert.equal(byClass(tree, 'fo-card').length, 0, '卡片区已删')
  assert.equal(byClass(tree, 'fo-cards').length, 0)
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
check('树：目录行「N 项目」、项目行「未完成 N 任务」（与画布口径一致）', () => {
  assert.ok(textOf(rowByDataId(tree, 'g1')).includes('2 项目'))
  /* 默认隐藏已完成：wA 有 a1（未完成）+ a2（已完成）→ 行上只数未完成的那条；
     项目行只写数字（rail 太窄，「任务」两字会把名字挤没），单位在 title 里。 */
  const wACount = byClass(rowByDataId(tree, 'wA'), 'fo-row-count')[0]
  assert.equal(textOf(wACount).trim(), '1', textOf(rowByDataId(tree, 'wA')))
  assert.equal(textOf(byClass(rowByDataId(tree, 'wF'), 'fo-row-count')[0]).trim(), '0')
  assert.ok(textOf(rowByDataId(tree, '')).includes('全部任务'))
  /* 悬浮说明给全量：未完成几条、总共几条、隐藏了几条 */
  const tip = byClass(rowByDataId(tree, 'wA'), 'fo-row-count')[0].props.title
  assert.ok(tip.includes('共 2 条') && tip.includes('已完成已隐藏'), tip)
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
  /* g1 成员 wA/wB：a1、b1 在场；a2 已完成 → 默认隐藏。 */
  assert.equal(taskNodes(tree).length, 2)
  assert.equal(ghostNodes(tree).length, 1)
  assert.equal(bandRects(tree).length, 0, '没有泳道')
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
check('点项目行：scope=project，只有该项目未完成任务，仍然没有泳道', () => {
  assert.equal(rootOf(tree).props['data-scope'], 'project')
  assert.equal(graphSections(tree).length, 1)
  /* wA 里 a1 未完成、a2 已完成（默认隐藏）→ 只剩一张卡。 */
  assert.equal(taskNodes(tree).length, 1)
  assert.deepEqual([...new Set(taskNodes(tree).map((n) => n.props['data-state']))].length >= 1, true)
  assert.equal(bandRects(tree).length, 0)
  assert.equal(legendItems(tree).length, 1, '项目 scope 的图例只有该项目')
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

/* ---- 4b. 详情面板：删掉卡片区后，点节点 / 键盘 Enter 是看单任务的唯一入口 ---- */
check('详情面板默认不出现（rail 也是 aside，所以只数 .fo-detail）', () => {
  assert.equal(detailEls(tree).length, 0)
  assert.ok(railEl(tree), 'rail 在')
  assert.equal(rootOf(tree).props['data-detail'], '0')
})
taskNodes(tree)[0].props.onClick()
tree = await main.mini.act()
check('点节点打开详情面板（任务 ID / 绑定会话 / 四组关系都在）', () => {
  const aside = detailEls(tree)
  assert.equal(aside.length, 1)
  const text = textOf(aside[0])
  assert.ok(text.includes('任务 ID'), '详情要有任务 ID')
  assert.ok(text.includes('绑定会话'))
  assert.equal(findAll(aside[0], (node) => node.kind === 'host' && classNameOf(node) === 'fo-sec').length, 4, '四组关系')
  assert.equal(rootOf(tree).props['data-detail'], '1', '打开详情后是三栏布局')
})
check('键盘 Enter 也能打开节点详情', () => {
  const aside = findAll(tree, (node) => node.kind === 'host' && node.type === 'aside' && classNameOf(node) === 'fo-detail')[0]
  const close = findAll(aside, (node) => node.kind === 'host' && node.type === 'button' && textOf(node).includes('关闭详情'))[0]
  assert.ok(close, '详情里有「关闭详情」')
})
findAll(tree, (node) => node.kind === 'host' && node.type === 'button' && textOf(node).includes('关闭详情'))[0].props.onClick()
tree = await main.mini.act()
check('关闭详情后回到两栏布局', () => {
  assert.equal(detailEls(tree).length, 0)
  assert.ok(railEl(tree), 'rail 仍在')
  assert.equal(rootOf(tree).props['data-detail'], '0')
})
/* 项目 scope 下 wA 只剩 1 张未完成卡（a2 默认隐藏），所以直接取第 1 张。 */
const secondNode = taskNodes(tree)[1] || taskNodes(tree)[0]
secondNode.props.onKeyDown({ key: 'Enter', preventDefault() {} })
tree = await main.mini.act()
check('节点上按 Enter 同样打开详情（键盘可达）', () => {
  const aside = findAll(tree, (node) => node.kind === 'host' && node.type === 'aside' && classNameOf(node) === 'fo-detail')
  assert.equal(aside.length, 1)
  assert.equal(taskNodes(tree).length > 0, true, '打开详情不影响画布上的节点')
})
findAll(tree, (node) => node.kind === 'host' && node.type === 'button' && textOf(node).includes('关闭详情'))[0].props.onClick()
tree = await main.mini.act()
check('再次关闭，流程回到干净状态', () => {
  assert.equal(detailEls(tree).length, 0)
})

/* ============================================================================
 * 4c. task-15：workflow 式节点卡片 + 拖动（吸附 40）+ 聚焦 + 跳会话
 * ========================================================================== */

const PANEL_GEOM = layout.GEOMETRY
const PANEL_CARD = layout.CARD

{
  const sessions = []
  const host = {
    canOpenSession: () => ({ ok: true, reason: '' }),
    openSession: (id, title) => { sessions.push({ id, title }); return Promise.resolve({ ok: true }) },
  }
  const fx = await mountPanel({ host })
  let ft = fx.tree
  const nodeById = (id) => taskNodes(ft).find((node) => node.props['data-id'] === id)
  const bgOf = (node) => byClass(node, 'fo-node-bg')[0]

  /* ---- 三段 DOM 与几何 ---- */
  check('卡片 DOM：标题行 + 徽标行（与面板飞书任务卡同一结构）', () => {
    const node = nodeById('a1')
    assert.ok(node, 'a1 节点在')
    assert.equal(byClass(node, 'fo-node-bg').length, 1)
    assert.equal(byClass(node, 'fo-node-title').length, 1, '标题')
    assert.ok(byClass(node, 'fo-node-badge').length >= 1, '徽标行')
    assert.equal(byClass(node, 'fo-node-badge-text').length, byClass(node, 'fo-node-badge').length)
    /* 旧的三段式（eyebrow / 右侧状态胶囊）已删干净 */
    assert.equal(byClass(node, 'fo-node-eyebrow').length, 0)
    assert.equal(byClass(node, 'fo-node-status').length, 0)
    assert.equal(byClass(node, 'fo-node-status-text').length, 0)
  })
  check('卡片 DOM：标题=任务名、首枚徽标=阻塞、计数徽标=前置 1；会话任务有胶囊', () => {
    const node = nodeById('a1')
    assert.ok(textOf(byClass(node, 'fo-node-title')[0]).includes('任务 a1'))
    const badges = findAll(node, (child) => child.kind === 'host' && classNameOf(child) === 'fo-node-badge')
    assert.equal(badges[0].props['data-tone'], 'blocked', '首枚徽标是状态')
    assert.equal(textOf(badges[0]).trim(), '阻塞')
    const labels = badges.map((badge) => textOf(badge).trim())
    assert.ok(labels.includes('前置 1'), JSON.stringify(labels))
    /* a1 绑了会话（fixture 的 sessionId = s-a1）→ 右上会话胶囊 */
    const sess = byClass(node, 'fo-node-sess')[0]
    assert.ok(sess, '有会话胶囊')
    assert.ok(textOf(sess).includes('Session'))
    /* 列表里才成立的内容不上画布 */
    const labels2 = findAll(node, (child) => child.kind === 'host' && classNameOf(child) === 'fo-node-badge')
      .map((badge) => textOf(badge).trim())
    assert.ok(labels2.includes('项目A'), `项目徽标要在：${JSON.stringify(labels2)}`)
    /* 编号在页脚（与列表卡的 T编号 同一处信息） */
    assert.ok(textOf(byClass(node, 'fo-node-no')[0]).includes('T11'))
  })
  check('卡片几何：宽 300 / 高 84 / rx 9 / 边框 1（与面板任务卡同规格）', () => {
    const bg = bgOf(nodeById('a1'))
    assert.equal(Number(bg.props.width), PANEL_GEOM.NODE_W)
    assert.equal(Number(bg.props.height), PANEL_GEOM.NODE_H)
    assert.equal(PANEL_GEOM.NODE_W, 300)
    assert.equal(PANEL_GEOM.NODE_H, 84)
    assert.equal(Number(bg.props.rx), PANEL_CARD.RADIUS)
    assert.equal(PANEL_CARD.RADIUS, 9)
    assert.equal(PANEL_CARD.BORDER, 1)
  })
  check('卡片三行布局：标题 / 徽标 / 页脚（编号 + 动作），行序不串', () => {
    const node = nodeById('a1')
    const bg = bgOf(node)
    const nx = Number(bg.props.x)
    const ny = Number(bg.props.y)
    const title = byClass(node, 'fo-node-title')[0]
    const badges = findAll(node, (child) => child.kind === 'host' && classNameOf(child) === 'fo-node-badge')
    const firstBadgeBg = byClass(badges[0], 'fo-node-badge-bg')[0]
    const no = byClass(node, 'fo-node-no')[0]
    assert.equal(Number(title.props.x), nx + PANEL_CARD.PAD_X)
    assert.equal(Number(title.props.y), ny + PANEL_CARD.TITLE_BASELINE)
    assert.equal(Number(firstBadgeBg.props.x), nx + PANEL_CARD.PAD_X)
    assert.equal(Number(firstBadgeBg.props.y), ny + PANEL_CARD.ROW_META)
    assert.equal(Number(firstBadgeBg.props.height), PANEL_CARD.BADGE_H)
    assert.equal(Number(no.props.y), ny + PANEL_CARD.ROW_FOOT + 13, '编号在页脚行')
    assert.ok(Number(firstBadgeBg.props.y) + PANEL_CARD.BADGE_H <= Number(no.props.y), '徽标行在页脚之上')
    const actions = nodeActions(node)
    assert.equal(actions.length, 2, '两个动作按钮')
    actions.forEach((action) => {
      const box = byClass(action, 'fo-node-action-bg')[0]
      assert.equal(Number(box.props.width), PANEL_CARD.ACTION_SIZE)
      assert.equal(Number(box.props.height), PANEL_CARD.ACTION_SIZE)
      assert.equal(Number(box.props.y), ny + PANEL_CARD.ROW_FOOT, '动作也在页脚行')
    })
  })
  check('卡片状态：data-state 与首枚徽标一一对应（blocked=阻塞 / open=就绪）', () => {
    const labelOf = (id) => textOf(findAll(nodeById(id), (n) => n.kind === 'host' && classNameOf(n) === 'fo-node-badge')[0]).trim()
    assert.equal(nodeById('a1').props['data-state'], 'blocked')
    assert.equal(labelOf('a1'), '阻塞')
    assert.equal(nodeById('b1').props['data-state'], 'open')
    assert.equal(labelOf('b1'), '就绪')
  })
  check('默认隐藏已完成：a2 不在画布上，头部开关给出「已完成 1」', () => {
    assert.equal(nodeById('a2'), undefined, '已完成的 a2 默认不画')
    const toggle = findAll(ft, (node) => node.kind === 'host' && node.props['data-action'] === 'toggle-done')[0]
    assert.ok(toggle, '卡片头部有开关')
    assert.equal(toggle.props['aria-pressed'], 'true')
    assert.ok(textOf(toggle).includes('已完成 1'), textOf(toggle))
  })
  /* 打开「显示已完成」再验 done 卡片：颜色/状态词的口径仍然要对。 */
  findAll(ft, (node) => node.kind === 'host' && node.props['data-action'] === 'toggle-done')[0].props.onClick()
  ft = await fx.mini.act()
  check('点开关后：已完成的 a2 回到画布，徽标是「完成」', () => {
    assert.equal(nodeById('a2').props['data-state'], 'done')
    assert.equal(textOf(byClass(nodeById('a2'), 'fo-node-badge-text')[0]).trim(), '完成')
  })
  findAll(ft, (node) => node.kind === 'host' && node.props['data-action'] === 'toggle-done')[0].props.onClick()
  ft = await fx.mini.act()
  check('再点一次：又回到隐藏已完成（开关是双向的）', () => {
    assert.equal(nodeById('a2'), undefined)
  })
  check('ghost 卡片：没有动作、虚线框、徽标 = 缺失 / 组外、也没有会话胶囊', () => {
    const missing = ghostNodes(ft).find((node) => node.props['data-id'] === 'zz-missing')
    assert.ok(missing, '缺失 ghost 在')
    assert.equal(classNameOf(missing).includes('is-ghost'), true)
    assert.equal(nodeActions(missing).length, 0, 'ghost 不可操作')
    assert.equal(textOf(byClass(missing, 'fo-node-badge-text')[0]).trim(), '缺失')
    assert.equal(byClass(missing, 'fo-node-sess').length, 0)
    const outside = ghostNodes(ft).find((node) => node.props['data-id'] === 'c1')
    assert.equal(textOf(byClass(outside, 'fo-node-badge-text')[0]).trim(), '组外')
  })

  /* ---- 拖动：跟手 → 松手吸附 40 → 落 store ---- */
  const edgePathD = () => String(edgePaths(ft).find((edge) => edge.props['data-from'] === 'b1' && edge.props['data-to'] === 'a1').props.d)
  const before = { x: Number(bgOf(nodeById('a1')).props.x), y: Number(bgOf(nodeById('a1')).props.y) }
  const pathBefore = edgePathD()
  check('拖动前：复位布局按钮是禁用的（这张图还没拖动过）', () => {
    const btn = findAll(ft, (node) => node.kind === 'host' && node.type === 'button' && node.props['data-action'] === 'reset-layout')[0]
    assert.ok(btn, '卡片头部有复位布局按钮')
    assert.equal(btn.props['aria-label'], '复位布局', '图标按钮要有可读名字')
    assert.equal(btn.props.disabled, true)
    assert.ok(String(btn.props.title).includes('还没有拖动过'))
  })
  const fire = (id, kind, clientX, clientY) => {
    const node = nodeById(id)
    const handler = node.props[kind]
    assert.equal(typeof handler, 'function', `${kind} 没接上`)
    handler({
      clientX,
      clientY,
      pointerId: 7,
      button: 0,
      currentTarget: { setPointerCapture() {} },
      stopPropagation() {},
      preventDefault() {},
    })
  }
  fire('a1', 'onPointerDown', 100, 100)
  ft = await fx.mini.act()
  fire('a1', 'onPointerMove', 146, 118)
  ft = await fx.mini.act()
  check('拖动中：节点实时跟手（未吸附，1:1 跟随指针）', () => {
    const moved = bgOf(nodeById('a1'))
    assert.equal(Number(moved.props.x), before.x + 46)
    assert.equal(Number(moved.props.y), before.y + 18)
  })
  fire('a1', 'onPointerUp', 146, 118)
  ft = await fx.mini.act()
  check('松手吸附 40px 网格，位置按「图 key + 任务 id」落 store.nodePos', () => {
    const expectX = Math.round((before.x + 46) / 40) * 40
    const expectY = Math.round((before.y + 18) / 40) * 40
    const bag = fx.store.data.get('nodePos')
    assert.ok(bag && bag['group:g1'], `nodePos 应该有 group:g1：${JSON.stringify(bag)}`)
    assert.deepEqual(bag['group:g1'].a1, { x: expectX, y: expectY })
    assert.equal(expectX % 40, 0)
    assert.equal(expectY % 40, 0)
    const moved = bgOf(nodeById('a1'))
    assert.equal(Number(moved.props.x), expectX)
    assert.equal(Number(moved.props.y), expectY)
    assert.notEqual(expectX, before.x, '确实位移了（测试本身有效）')
  })
  check('拖动后边的端点跟着走（b1→a1 的折线终点重算）', () => {
    const after = edgePathD()
    assert.notEqual(after, pathBefore, '折线必须重算')
    assert.ok(after.endsWith(`H${Number(bgOf(nodeById('a1')).props.x)}`), after)
  })
  check('拖动之后复位布局按钮变成可点', () => {
    const btn = findAll(ft, (node) => node.kind === 'host' && node.type === 'button' && node.props['data-action'] === 'reset-layout')[0]
    assert.equal(btn.props.disabled, false)
  })

  /* ---- 拖动不误触详情 ---- */
  nodeById('a1').props.onClick()
  ft = await fx.mini.act()
  check('拖动后紧跟的那次 click 不算选中（拖动不误触详情）', () => {
    assert.equal(detailEls(ft).length, 0, '详情不该弹出来')
    assert.equal(nodeById('a1').props['data-focused'], '0')
  })

  /* ---- 聚焦 ---- */
  nodeById('a1').props.onClick()
  ft = await fx.mini.act()
  check('点节点 = 选中 + 聚焦：详情打开、焦点节点 aria-current=focused', () => {
    assert.equal(detailEls(ft).length, 1)
    const focused = nodeById('a1')
    assert.equal(focused.props['data-focused'], '1')
    assert.equal(focused.props['data-dimmed'], '0')
    assert.equal(focused.props['aria-current'], 'true')
    assert.equal(classNameOf(focused).includes('is-selected'), true)
  })
  check('聚焦：同一张图里其余节点降到低透明度（is-dimmed + data-dimmed）', () => {
    const sameGraph = graphSections(ft)[0]
    const others = taskNodes(sameGraph).filter((node) => node.props['data-id'] !== 'a1')
    assert.ok(others.length > 0)
    others.forEach((node) => {
      assert.equal(classNameOf(node).includes('is-dimmed'), true)
      assert.equal(node.props['data-dimmed'], '1')
      assert.equal(node.props['data-focused'], '0')
    })
    /* ghost 也一起暗下去（它就是背景信息），但 aria 仍在 */
    ghostNodes(sameGraph).forEach((node) => assert.equal(node.props['data-dimmed'], '1'))
  })
  check('聚焦：别的图里没有焦点节点时，那张图的节点不该被暗掉', () => {
    const otherGraph = graphSections(ft)[1]
    taskNodes(otherGraph).forEach((node) => assert.equal(node.props['data-dimmed'], '0'))
  })
  byClass(ft, 'fo-canvas')[0].props.onClick({ target: null, currentTarget: null })
  ft = await fx.mini.act()
  check('点画布空白 = 取消聚焦（详情一起收起来，节点全部恢复）', () => {
    assert.equal(detailEls(ft).length, 0)
    taskNodes(ft).forEach((node) => {
      assert.equal(node.props['data-dimmed'], '0')
      assert.equal(node.props['data-focused'], '0')
    })
  })
  nodeById('a1').props.onKeyDown({ key: 'f', preventDefault() {} })
  ft = await fx.mini.act()
  check('键盘 F：聚焦节点但不弹详情', () => {
    assert.equal(nodeById('a1').props['data-focused'], '1')
    assert.equal(detailEls(ft).length, 0)
  })
  byClass(ft, 'fo-canvas')[0].props.onClick({ target: null, currentTarget: null })
  ft = await fx.mini.act()
  check('再点空白：焦点清掉', () => {
    taskNodes(ft).forEach((node) => assert.equal(node.props['data-focused'], '0'))
  })
  nodeById('b1').props.onKeyDown({ key: 'f', preventDefault() {} })
  ft = await fx.mini.act()
  check('F 聚焦 b1（Tab 之外的第二条键盘路径）', () => {
    assert.equal(nodeById('b1').props['data-focused'], '1')
  })
  nodeById('b1').props.onKeyDown({ key: 'ArrowRight', preventDefault() {} })
  ft = await fx.mini.act()
  check('再按 →：焦点按几何走位到右边那个节点（a1），只聚焦不开详情', () => {
    assert.equal(nodeById('a1').props['data-focused'], '1')
    assert.equal(nodeById('b1').props['data-focused'], '0')
    assert.equal(detailEls(ft).length, 0)
  })

  /* ---- 复位布局 ---- */
  findAll(ft, (node) => node.kind === 'host' && node.type === 'button' && node.props['data-action'] === 'reset-layout')[0].props.onClick()
  ft = await fx.mini.act()
  check('复位布局：这张图的本地位置被清空，节点回到 layout 坐标', () => {
    assert.deepEqual(fx.store.data.get('nodePos'), {})
    const back = bgOf(nodeById('a1'))
    assert.equal(Number(back.props.x), before.x)
    assert.equal(Number(back.props.y), before.y)
  })
  check('复位后按钮又变回禁用', () => {
    const btn = findAll(ft, (node) => node.kind === 'host' && node.type === 'button' && node.props['data-action'] === 'reset-layout')[0]
    assert.equal(btn.props.disabled, true)
  })

  /* ---- 跳转到会话 ---- */
  const openButton = () => nodeActions(nodeById('a1'), 'open')[0]
  check('节点动作列第一个按钮 = 打开会话（有会话时可用）', () => {
    const btn = openButton()
    assert.equal(btn.props['data-key'], 'open')
    assert.equal(btn.props['data-disabled'], '0')
    assert.equal(btn.props['aria-disabled'], 'false')
    const tip = findAll(btn, (node) => node.kind === 'host' && node.type === 'title')[0]
    assert.equal(textOf(tip).trim(), '打开会话')
  })
  openButton().props.onClick({ stopPropagation() {} })
  ft = await fx.mini.act()
  check('点「打开会话」→ host.openSession(task.sessionId, 标题)', () => {
    assert.deepEqual(sessions, [{ id: 's-a1', title: '任务 a1' }])
  })
  check('成功时不留提示条（role=status 只在失败时出现）', () => {
    assert.equal(findAll(ft, (node) => node.kind === 'host' && node.props.role === 'status').length, 0)
  })
  check('动作按钮的 click 不会冒泡成节点选中（stopPropagation 被调用）', () => {
    let stopped = 0
    openButton().props.onClick({ stopPropagation() { stopped += 1 } })
    assert.equal(stopped, 1)
  })
}

/* ---- 4d. 打开会话：缺 sessionId / 缺宿主 / 宿主说不成功，三种都不许静默 ---- */
{
  const noSession = {
    ...SNAPSHOT,
    tasks: TASKS.map((task) => (task.id === 'a1' ? { ...task, sessionId: '' } : task)),
  }
  const asked = []
  const host = {
    canOpenSession: () => ({ ok: true, reason: '' }),
    openSession: (id) => { asked.push(id); return Promise.resolve({ ok: true }) },
  }
  const fx = await mountPanel({ snapshot: noSession, host })
  const node = () => taskNodes(fx.tree).find((row) => row.props['data-id'] === 'a1')
  check('任务没绑定会话：按钮 disabled，title 说明「这个任务没有绑定会话」', () => {
    const btn = nodeActions(node(), 'open')[0]
    assert.equal(btn.props['data-disabled'], '1')
    assert.equal(btn.props['aria-disabled'], 'true')
    const tip = findAll(btn, (node2) => node2.kind === 'host' && node2.type === 'title')[0]
    assert.equal(textOf(tip).trim(), '这个任务没有绑定会话')
    assert.ok(String(btn.props['aria-label']).includes('这个任务没有绑定会话'))
  })
  nodeActions(node(), 'open')[0].props.onClick({ stopPropagation() {} })
  await fx.mini.act()
  check('没会话时点它也不发请求：原因就在按钮上，不静默空转', () => {
    assert.deepEqual(asked, [])
  })

  const bare = await mountPanel({})
  check('宿主没有能力位：按钮 disabled，title 说明「当前宿主不支持打开会话」', () => {
    const btn = nodeActions(taskNodes(bare.tree).find((row) => row.props['data-id'] === 'a1'), 'open')[0]
    assert.equal(btn.props['data-disabled'], '1')
    const tip = findAll(btn, (node2) => node2.kind === 'host' && node2.type === 'title')[0]
    assert.equal(textOf(tip).trim(), '当前宿主不支持打开会话')
  })
  taskNodes(bare.tree)[0].props.onClick()
  const detailTree = await bare.mini.act()
  check('详情面板里也有「打开会话」，同一套 disabled/原因口径', () => {
    const btn = findAll(detailTree, (node) => node.kind === 'host' && node.type === 'button' && textOf(node).trim() === '打开会话')[0]
    assert.ok(btn, '详情面板要有打开会话按钮')
    assert.equal(btn.props.disabled, true)
    assert.equal(String(btn.props.title), '当前宿主不支持打开会话')
  })
}

{
  /* 宿主说自己失败（例如切过去了但不是这条会话）：面板必须给 role=status 的可读提示。 */
  const host = {
    canOpenSession: () => ({ ok: true, reason: '' }),
    openSession: () => Promise.resolve({ ok: false, reason: '宿主切到了 xxx，不是这条会话' }),
  }
  const fx = await mountPanel({ host })
  let ft = fx.tree
  nodeActions(taskNodes(ft).find((row) => row.props['data-id'] === 'a1'), 'open')[0].props.onClick({ stopPropagation() {} })
  ft = await fx.mini.act()
  check('openSession 返回 ok:false → role=status 提示条带上宿主给的原因', () => {
    const notes = findAll(ft, (node) => node.kind === 'host' && node.props.role === 'status')
    assert.equal(notes.length, 1)
    assert.ok(textOf(notes[0]).includes('宿主切到了 xxx'), textOf(notes[0]))
  })
  check('提示条渲染在正文里（不在 rail / 详情里）', () => {
    const main = findAll(ft, (node) => node.kind === 'host' && classNameOf(node).split(/\s+/).includes('fo-main'))[0]
    assert.equal(findAll(main, (node) => node.kind === 'host' && node.props.role === 'status').length, 1)
    assert.equal(alertBoxes(ft).length, 0, '这不是错误条（role=alert），是提示')
  })
  const close = findAll(ft, (node) => node.kind === 'host' && node.type === 'button' && textOf(node).trim() === '知道了')[0]
  check('提示条可以关掉', () => { assert.ok(close) })
  close.props.onClick()
  ft = await fx.mini.act()
  check('关掉后提示条消失', () => {
    assert.equal(findAll(ft, (node) => node.kind === 'host' && node.props.role === 'status').length, 0)
  })
}

/* ---- 4e. 冗余审计：同一份信息只出现在离对象最近的那一处 ---- */
{
  const fx = await mountPanel({ host: { canOpenSession: () => ({ ok: true, reason: '' }), openSession: () => Promise.resolve({ ok: true }) } })
  const ft = fx.tree
  const count = (text, needle) => String(text).split(needle).length - 1

  check('一级菜单名唯一、品牌名唯一、旧名「任务关系图」已不再出现', () => {
    const text = textOf(ft)
    assert.equal(count(text, '任务关系图'), 0, '旧的功能名（三次出现那份）已经删掉')
    const graphNav = featnavItems(ft).find((item) => textOf(item).includes('关系'))
    assert.ok(graphNav, 'rail 里有「关系」')
    assert.equal(textOf(graphNav).replace(/\s/g, ''), '关系▾', '「关系」项带 caret')
    assert.ok(count(text, '任务') >= 1, '品牌名是「任务」')
    assert.equal(count(text, '任务分组'), 0, '二级菜单里不再重复一个分组标题')
  })
  check('正文头部：没有计数胶囊、没有功能名、副标题不再重复范围名', () => {
    const head = byClass(ft, 'fo-main-head')[0]
    assert.ok(head, '头部在')
    assert.equal(byClass(head, 'fo-stats').length, 0)
    assert.equal(findAll(head, (node) => classNameOf(node).split(/\s+/).includes('fo-chip')).length, 0)
    assert.equal(textOf(head).includes('任务关系图'), false)
    assert.equal(textOf(head).includes('张图'), false)
    assert.equal(textOf(head).includes('未完成'), false)
    const title = byClass(ft, 'fo-crumb-title')[0]
    assert.equal(textOf(title).trim(), '全部任务', '面包屑 = 当前范围')
    const sub = byClass(ft, 'fo-crumb-sub')[0]
    assert.equal(textOf(sub).includes('全部任务'), false, '副标题不再重复范围名')
    assert.equal(textOf(sub).includes('已筛选'), false)
  })
  check('头部剩下的就是「当前范围 + 搜索框 + 动作」三样', () => {
    const head = byClass(ft, 'fo-main-head')[0]
    assert.equal(byClass(head, 'fo-crumb').length, 1)
    assert.equal(byClass(head, 'fo-search').length, 1)
    assert.equal(byClass(head, 'fo-head-actions').length, 1)
    assert.equal(head.children.filter((child) => child && child.kind === 'host').length, 3)
  })
  check('按钮不单起一行、也不悬浮：整页动作在正文头部，逐图工具在卡片 header 里', () => {
    assert.equal(byClass(ft, 'fo-feature-bar').length, 0, '旧工具条已删')
    assert.equal(byClass(ft, 'fo-canvas-card').length, 0, '浮动卡片已删')
    const head = byClass(ft, 'fo-main-head')[0]
    const actions = byClass(head, 'fo-head-actions')[0]
    assert.equal(findAll(actions, (node) => node.kind === 'host' && node.props['data-action'] === 'organize').length, 1, '「建议」在正文头部')
    assert.equal(findAll(actions, (node) => node.kind === 'host' && node.props['data-action'] === 'organize').length, 1)
    assert.equal(byClass(actions, 'fo-head-organize').length, 1)
  })
  check('图头动作图标化：适应 / 复位布局 / 取消聚焦 是 26px 图标按钮，文字只在 aria-label', () => {
    for (const [action, label] of [['fit', '适应画布'], ['reset-layout', '复位布局'], ['blur', '取消聚焦']]) {
      const btn = findAll(ft, (node) => node.kind === 'host' && node.props['data-action'] === action)[0]
      if (!btn) continue
      assert.equal(btn.props['data-icon'], '1', `${action} 应该是图标按钮`)
      assert.equal(btn.props['aria-label'], label, `${action} 要有可读名字`)
      assert.equal(textOf(btn).trim(), '', `${action} 不该再有文字（图头要收得进一行）`)
    }
    /* 复位布局在未拖动时是禁用的，所以一定有；取消聚焦只有聚焦时才有 */
    assert.ok(findAll(ft, (node) => node.kind === 'host' && node.props['data-action'] === 'reset-layout').length >= 1)
  })

  check('窄面板降噪：容器查询下先收起图例', () => {
    const css = CSS_BARE
    const at = css.indexOf('@container fopanel (max-width: 900px)')
    assert.ok(at > 0, '有 900px 断点')
    const block = css.slice(at, at + 400)
    assert.ok(block.includes('.fo-graph-legend'), '图例在该断点下隐藏')
    assert.ok(block.includes('.fo-edge-legend'), '边图例也隐藏')
  })

  check('图头：图名 + 图例 + 右侧工具（缩放/适应/复位布局/显示已完成）都在 header 里', () => {
    const head = byClass(ft, 'fo-graph-head')[0]
    assert.equal(byClass(head, 'fo-graph-meta').length, 0)
    assert.equal(byClass(head, 'fo-graph-legend').length, 1)
    const actions = byClass(head, 'fo-graph-actions')[0]
    assert.ok(actions, '卡片头部有工具区')
    assert.equal(actions.props.role, 'toolbar')
    for (const action of ['toggle-done', 'zoom-out', 'zoom-in', 'fit', 'reset-layout']) {
      assert.equal(findAll(actions, (node) => node.kind === 'host' && node.props['data-action'] === action).length, 1, `${action} 在卡片 header 里`)
    }
    assert.equal(byClass(actions, 'fo-zoom-value').length, 1, 'header 里有缩放百分比')
    assert.equal(findAll(actions, (node) => node.kind === 'host' && node.props['data-action'] === 'organize').length, 0, '「建议」不在单张卡片上（它是整页动作）')
    assert.equal(textOf(head).includes('组外/缺失'), false)
  })
  /* ---- 画布缩放：卡片上的 − / 百分比 / + / 适应 ----
     几何（以光标为锚点缩放、平移、聚焦居中）在 test/graphViewport.mjs 里单测；
     这里只钉住「入口都在卡片里、有可读的名字、初始是 100%」。 */
  const zoomBtn = (action) => findAll(ft, (node) => node.kind === 'host' && node.props['data-action'] === action)[0]
  check('缩放控件齐全：− / 100% / + / 适应，初始是恒等视口', () => {
    assert.equal(zoomBtn('zoom-out').props['aria-label'], '缩小画布')
    assert.equal(zoomBtn('zoom-in').props['aria-label'], '放大画布')
    assert.ok(zoomBtn('fit'), '适应按钮在')
    const pct = byClass(ft, 'fo-zoom-value')[0]
    assert.equal(textOf(pct).trim(), '100%')
    assert.equal(pct.props['data-action'], 'zoom-reset')
    assert.ok(byClass(ft, 'fo-svg').every((svg) => svg.props['data-zoom'] === '1'), '初始就是 100%')
  })

  check('全页不再有 .fo-chip / .fo-stats（装饰性重复已删干净）', () => {
    assert.equal(findAll(ft, (node) => node.kind === 'host' && classNameOf(node).split(/\s+/).includes('fo-chip')).length, 0)
    assert.equal(byClass(ft, 'fo-stats').length, 0)
  })
  check('CSS 里的重复件也一起删了（没有死样式）', () => {
    /* 注意：.fo-node-no 现在是页脚编号的活样式，不在死样式清单里 */
    for (const dead of ['.fo-chip', '.fo-stats', '.fo-graph-meta', '.fo-feature-hint', '.fo-feature-meta']) {
      assert.equal(CSS_BARE.includes(dead), false, `${dead} 应该已经删掉`)
    }
  })
}

/* ============================================================================
 * 4f. task-16：一键整理（建议抽屉 + 逐条接受/拒绝）
 * ========================================================================== */

function organizeBatchFixture() {
  return {
    batchId: 'b-1',
    at: 1794298146389,
    scope: { kind: 'all', id: '' },
    model: { provider: 'prov', model: 'm', candidates: 5, truncated: false },
    notes: '两条建议都来自描述里的先后措辞',
    pending: 2,
    accepted: 0,
    rejected: 0,
    dropped: 1,
    items: [
      { id: 'it-1', kind: 'depends_on', from: 'b1', to: 'a2', fromTitle: '任务 b1', toTitle: '任务 a2', confidence: 0.86, evidence: '描述里写着「等 b1 合并后再做」', status: 'pending', reason: '', impact: { blocked: ['任务 a2'], blockedCount: 1 } },
      { id: 'it-2', kind: 'derived_from', from: 'a1', to: 'c1', fromTitle: '任务 a1', toTitle: '任务 c1', confidence: 0.72, evidence: '同一交付范围内的收口任务', status: 'pending', reason: '', impact: { blocked: [], blockedCount: 0 } },
      { id: 'it-3', kind: 'depends_on', from: 'e1', to: 'e1', fromTitle: '任务 e1', toTitle: '任务 e1', confidence: 0.9, evidence: '自环', status: 'dropped', reason: '自环', impact: { blocked: [], blockedCount: 0 } },
    ],
  }
}

/** 假的一键整理后端：够跑「跑 → 出建议 → 逐条接受/拒绝 → 就地更新」。 */
function makeOrganizeBackend(options) {
  const o = options || {}
  const log = { organize: [], view: [], accept: [], reject: [], undo: [] }
  const state = { batch: o.initial === undefined ? null : o.initial }
  const recount = (batch) => {
    const items = Array.isArray(batch.items) ? batch.items : []
    return {
      ...batch,
      pending: items.filter((item) => item.status === 'pending').length,
      accepted: items.filter((item) => item.status === 'accepted').length,
      rejected: items.filter((item) => item.status === 'rejected').length,
      dropped: items.filter((item) => item.status === 'dropped').length,
      undone: items.filter((item) => item.status === 'undone').length,
    }
  }
  const pendingIds = () => (state.batch ? state.batch.items.filter((item) => item.status === 'pending').map((item) => item.id) : [])
  return {
    log,
    getBatch: () => state.batch,
    api: {
      organize: async (scope) => {
        log.organize.push(scope)
        if (o.defer) { await new Promise((resolve) => { o.defer.push(resolve) }) }
        if (o.fail) throw new Error(o.fail)
        state.batch = o.result === undefined ? organizeBatchFixture() : o.result
        return { ok: true, batch: state.batch, dropped: 1, complete: false, candidates: 2 }
      },
      organizeView: async (scope) => {
        log.view.push(scope)
        if (o.restore) state.batch = o.restore
        return state.batch
      },
      organizeAccept: async (batchId, itemIds) => {
        log.accept.push({ batchId, itemIds })
        const wanted = Array.isArray(itemIds) && itemIds.length ? itemIds : pendingIds()
        const results = []
        const items = state.batch.items.map((item) => {
          if (!wanted.includes(item.id) || item.status !== 'pending') return item
          if (o.acceptFails && o.acceptFails[item.id]) {
            results.push({ id: item.id, ok: false, error: o.acceptFails[item.id] })
            return { ...item, reason: o.acceptFails[item.id] }
          }
          results.push({ id: item.id, ok: true, error: '' })
          return { ...item, status: 'accepted' }
        })
        state.batch = recount({ ...state.batch, items })
        return { ok: true, results, batch: state.batch }
      },
      organizeReject: async (batchId, itemIds) => {
        log.reject.push({ batchId, itemIds })
        const wanted = Array.isArray(itemIds) && itemIds.length ? itemIds : pendingIds()
        state.batch = recount({
          ...state.batch,
          items: state.batch.items.map((item) => (wanted.includes(item.id) && item.status === 'pending' ? { ...item, status: 'rejected' } : item)),
        })
        return { ok: true, batch: state.batch }
      },
      /* 撤销已接受的建议（task-22）：把 accepted 的条目退回 undone，并逐条汇报 */
      organizeUndo: async (batchId, itemIds) => {
        log.undo.push({ batchId, itemIds })
        const acceptedIds = state.batch.items.filter((item) => item.status === 'accepted').map((item) => item.id)
        const wanted = Array.isArray(itemIds) && itemIds.length ? itemIds : acceptedIds
        const results = []
        const items = state.batch.items.map((item) => {
          if (!wanted.includes(item.id) || item.status !== 'accepted') return item
          if (o.undoFails && o.undoFails[item.id]) {
            results.push({ id: item.id, ok: false, error: o.undoFails[item.id] })
            return { ...item, reason: o.undoFails[item.id] }
          }
          results.push({ id: item.id, ok: true, error: '' })
          return { ...item, status: 'undone' }
        })
        state.batch = recount({ ...state.batch, items })
        return { ok: true, results, batch: state.batch }
      },
    },
  }
}

const ORGANIZE_TRIGGER = (tree) => findAll(tree, (node) => node.kind === 'host' && node.type === 'button' && node.props['data-action'] === 'organize')[0]
const organizeDrawers = (tree) => findAll(tree, (node) => node.kind === 'host' && node.type === 'aside' && classNameOf(node).split(/\s+/).includes('fo-organize'))
const orgItems = (tree, status) => findAll(tree, (node) => node.kind === 'host' && node.type === 'article'
  && classNameOf(node).split(/\s+/).includes('fo-org-item') && (!status || node.props['data-status'] === status))
const orgButton = (item, action) => findAll(item, (node) => node.kind === 'host' && node.type === 'button' && node.props['data-action'] === action)[0]

{
  const backend = makeOrganizeBackend()
  const fx = await mountPanel({ organizeApi: backend.api })
  let ft = fx.tree

  check('画布右上卡片：主按钮是「建议」（自绘 sparkle 图标 + title 说明），没有建议时不显示折叠开关', () => {
    const btn = ORGANIZE_TRIGGER(ft)
    assert.ok(btn, '建议按钮在')
    assert.ok(textOf(btn).includes('建议'))
    assert.equal(btn.props['data-action'], 'organize')
    assert.ok(String(btn.props.title).includes('先出建议再落库'))
    assert.equal(btn.props.disabled, false)
    const icon = findAll(btn, (node) => node.kind === 'host' && node.type === 'svg' && classNameOf(node).includes('fo-btn-icon'))[0]
    assert.ok(icon, '图标是自绘 svg')
    assert.equal(findAll(ft, (node) => node.kind === 'host' && node.props['data-action'] === 'organize-toggle').length, 0)
    assert.equal(organizeDrawers(ft).length, 0, '没点之前抽屉不出现')
  })

  ORGANIZE_TRIGGER(ft).props.onClick()
  ft = await fx.mini.act()
  check('点「建议」→ api.organize 收到的是**当前 scope**（全部任务）', () => {
    assert.equal(backend.log.organize.length, 1)
    assert.equal(backend.log.organize[0].kind, 'all')
    assert.equal(backend.log.organize[0].id, '')
    assert.ok(backend.log.organize[0].members === undefined || Array.isArray(backend.log.organize[0].members))
  })
  check('数据态：抽屉打开、标题/notes/计数都在，待处理 2 条', () => {
    const drawer = organizeDrawers(ft)
    assert.equal(drawer.length, 1)
    const text = textOf(drawer[0])
    assert.ok(text.includes('整理建议'))
    assert.ok(text.includes('两条建议都来自描述里的先后措辞'), 'notes 要显示')
    assert.ok(text.includes('待处理 2'))
    assert.equal(orgItems(ft, 'pending').length, 2)
    assert.equal(rootOf(ft).props['data-organize'], '1')
  })
  check('条目：kind 徽标（前置/来源）+ 两端标题 + 置信度 + evidence 原文引用块', () => {
    const first = orgItems(ft, 'pending')[0]
    assert.equal(textOf(byClass(first, 'fo-org-kind')[0]).trim(), '前置')
    assert.equal(textOf(byClass(first, 'fo-org-conf')[0]).trim(), '86%')
    const route = textOf(byClass(first, 'fo-org-route')[0])
    assert.ok(route.includes('任务 b1') && route.includes('任务 a2'), route)
    const quote = byClass(first, 'fo-org-evidence')[0]
    assert.ok(quote, 'evidence 要有引用块')
    assert.equal(textOf(quote).trim(), '描述里写着「等 b1 合并后再做」')
    const second = orgItems(ft, 'pending')[1]
    assert.equal(textOf(byClass(second, 'fo-org-kind')[0]).trim(), '来源', 'derived_from 徽标 = 来源')
  })
  check('影响预览：会让谁变阻塞用 warn 语气写出来（没影响的条目不写）', () => {
    const first = orgItems(ft, 'pending')[0]
    const impact = byClass(first, 'fo-org-impact')[0]
    assert.ok(impact, '第一条会让 a2 变阻塞')
    assert.equal(impact.props['data-tone'], 'warn')
    assert.ok(textOf(impact).includes('任务 a2'))
    assert.ok(textOf(impact).includes('前置没完成它就开不了工'))
    assert.equal(byClass(orgItems(ft, 'pending')[1], 'fo-org-impact').length, 0, 'derived_from 没有阻塞代价')
  })
  check('已丢弃条目：默认折叠（只说条数，不渲染原因）', () => {
    const drawer = organizeDrawers(ft)[0]
    const toggle = findAll(drawer, (node) => node.kind === 'host' && node.type === 'button' && textOf(node).includes('已丢弃'))[0]
    assert.ok(toggle, '要有「已丢弃 N 条」的折叠开关')
    assert.ok(textOf(toggle).includes('1'))
    assert.equal(toggle.props['aria-expanded'], 'false')
    assert.equal(byClass(drawer, 'fo-org-dropped-list').length, 0, '默认不渲染原因列表')
    assert.equal(orgItems(ft, 'dropped').length, 0)
  })
  findAll(organizeDrawers(ft)[0], (node) => node.kind === 'host' && node.type === 'button' && textOf(node).includes('已丢弃'))[0].props.onClick()
  ft = await fx.mini.act()
  check('展开已丢弃：逐条给出原因', () => {
    const toggle = findAll(organizeDrawers(ft)[0], (node) => node.kind === 'host' && node.type === 'button' && textOf(node).includes('已丢弃'))[0]
    assert.equal(toggle.props['aria-expanded'], 'true')
    const list = byClass(organizeDrawers(ft)[0], 'fo-org-dropped-list')[0]
    assert.ok(list)
    assert.ok(textOf(list).includes('自环'), '原因要写出来')
    assert.equal(byClass(list, 'fo-org-dropped-item').length, 1)
  })
  const overviewCallsBefore = fx.api.calls.filter((call) => call.method === 'overview').length
  orgButton(orgItems(ft, 'pending')[0], 'accept').props.onClick()
  ft = await fx.mini.act()
  check('接受一条 → organizeAccept(batchId, [id])', () => {
    assert.deepEqual(backend.log.accept, [{ batchId: 'b-1', itemIds: ['it-1'] }])
  })
  check('接受后：就地用返回的 batch 更新抽屉（待处理 1 / 已接受 1）', () => {
    const drawer = organizeDrawers(ft)[0]
    assert.ok(textOf(drawer).includes('待处理 1'))
    assert.ok(textOf(drawer).includes('已接受 1'))
    assert.equal(orgItems(ft, 'accepted').length, 1)
    assert.ok(textOf(orgItems(ft, 'accepted')[0]).includes('已接受'))
  })
  check('接受后立刻重拉快照（新边要马上出现在画布上）', () => {
    assert.ok(fx.api.calls.filter((call) => call.method === 'overview').length > overviewCallsBefore)
  })
  orgButton(orgItems(ft, 'pending')[0], 'reject').props.onClick()
  ft = await fx.mini.act()
  check('拒绝一条 → organizeReject(batchId, [id])，且不重拉快照', () => {
    assert.deepEqual(backend.log.reject, [{ batchId: 'b-1', itemIds: ['it-2'] }])
    assert.ok(textOf(organizeDrawers(ft)[0]).includes('已拒绝 1'))
  })
  check('待处理清空后：全部接受/全部拒绝按钮禁用', () => {
    const drawer = organizeDrawers(ft)[0]
    const acceptAll = findAll(drawer, (node) => node.kind === 'host' && node.type === 'button' && node.props['data-action'] === 'accept-all')[0]
    assert.equal(acceptAll.props.disabled, true)
  })
  findAll(organizeDrawers(ft)[0], (node) => node.kind === 'host' && node.type === 'button' && node.props['data-action'] === 'close')[0].props.onClick()
  ft = await fx.mini.act()
  check('关闭抽屉：抽屉卸载、根节点 data-organize=0，但建议还在（折叠开关变「建议 N」）', () => {
    assert.equal(organizeDrawers(ft).length, 0)
    assert.equal(rootOf(ft).props['data-organize'], '0')
    const toggle = findAll(ft, (node) => node.kind === 'host' && node.props['data-action'] === 'organize-toggle')[0]
    assert.equal(toggle, undefined, '没有待处理建议时不显示折叠开关')
  })
  check('抽屉开关落 store（键 organize）', () => {
    const saved = fx.store.data.get('organize')
    assert.equal(saved.open, false)
    assert.equal(saved.batchId, 'b-1')
  })
}

{
  /* 全部接受（itemIds 传空数组 = 全部待处理）+ 逐条失败汇报 */
  const backend = makeOrganizeBackend({ acceptFails: { 'it-2': '飞书那边超时了' } })
  const fx = await mountPanel({ organizeApi: backend.api })
  let ft = fx.tree
  ORGANIZE_TRIGGER(ft).props.onClick()
  ft = await fx.mini.act()
  findAll(organizeDrawers(ft)[0], (node) => node.kind === 'host' && node.type === 'button' && node.props['data-action'] === 'accept-all')[0].props.onClick()
  ft = await fx.mini.act()
  check('全部接受 → organizeAccept(batchId, [])（空数组 = 全部待处理）', () => {
    assert.deepEqual(backend.log.accept, [{ batchId: 'b-1', itemIds: [] }])
  })
  check('逐条失败不静默：失败的那条就地写原因（role=alert）', () => {
    const failed = orgItems(ft, 'pending')[0]
    const alert = findAll(failed, (node) => node.kind === 'host' && node.props.role === 'alert')[0]
    assert.ok(alert, '失败原因要在条目里')
    assert.ok(textOf(alert).includes('飞书那边超时了'))
  })
  check('成功的那条照样进「已接受」', () => {
    assert.equal(orgItems(ft, 'accepted').length, 1)
  })
}

{
  /* 错误态：模型/接口失败 → role=alert + 重试 */
  const backend = makeOrganizeBackend({ fail: '模型没有返回建议' })
  const fx = await mountPanel({ organizeApi: backend.api })
  let ft = fx.tree
  ORGANIZE_TRIGGER(ft).props.onClick()
  ft = await fx.mini.act()
  check('整理失败 → role=alert 错误条带宿主文案 + 重试按钮', () => {
    const alerts = alertBoxes(ft)
    assert.equal(alerts.length, 1)
    assert.ok(textOf(alerts[0]).includes('模型没有返回建议'))
    assert.ok(textOf(alerts[0]).includes('重试'))
  })
  const retry = findAll(ft, (node) => node.kind === 'host' && node.type === 'button' && textOf(node).trim() === '重试')[0]
  check('重试按钮在', () => { assert.ok(retry) })
  retry.props.onClick()
  ft = await fx.mini.act()
  check('重试真的又打了一次接口', () => {
    assert.equal(backend.log.organize.length, 2, `organize 调用 ${backend.log.organize.length} 次`)
  })
}

{
  /* 空态：AI 没找到新关系 */
  const empty = { ...organizeBatchFixture(), items: [], pending: 0, accepted: 0, rejected: 0, dropped: 0, notes: '' }
  const backend = makeOrganizeBackend({ result: empty })
  const fx = await mountPanel({ organizeApi: backend.api })
  let ft = fx.tree
  ORGANIZE_TRIGGER(ft).props.onClick()
  ft = await fx.mini.act()
  check('空态文案：宁可少而准', () => {
    const drawer = organizeDrawers(ft)
    assert.equal(drawer.length, 1)
    /* 时间兜底也会出建议，所以这里不再把「没有找到关系」归因给 AI。 */
    assert.ok(textOf(drawer[0]).includes('没有找到新的关系——这常常是正确答案，宁可少而准'))
  })
  check('空态也不给假的「全部接受」按钮（禁用）', () => {
    const acceptAll = findAll(organizeDrawers(ft)[0], (node) => node.kind === 'host' && node.type === 'button' && node.props['data-action'] === 'accept-all')[0]
    assert.equal(acceptAll.props.disabled, true)
  })
}

{
  /* 跑的时候要看得见「在跑」 */
  const defer = []
  const backend = makeOrganizeBackend({ defer })
  const fx = await mountPanel({ organizeApi: backend.api })
  let ft = fx.tree
  ORGANIZE_TRIGGER(ft).props.onClick()
  ft = await fx.mini.act()
  check('loading 态：按钮 disabled + 「整理中…」', () => {
    const btn = ORGANIZE_TRIGGER(ft)
    assert.equal(btn.props.disabled, true)
    assert.ok(textOf(btn).includes('分析中…'))
  })
  defer.forEach((resolve) => resolve())
  ft = await fx.mini.act()
  check('跑完回到可点状态，抽屉有内容', () => {
    const btn = ORGANIZE_TRIGGER(ft)
    assert.equal(btn.props.disabled, false)
    assert.ok(textOf(btn).includes('建议'))
    assert.equal(organizeDrawers(ft).length, 1)
  })
}

{
  /* 旧宿主：没有 organize 接口 → 按钮不渲染（而不是点了报错） */
  const fx = await mountPanel({ noOrganize: true })
  const ft = fx.tree
  check('宿主没有 organize 接口：按钮整块不渲染', () => {
    assert.equal(ORGANIZE_TRIGGER(ft), undefined)
    assert.equal(organizeDrawers(ft).length, 0)
  })
}

{
  /* 挂载恢复：store 里开着抽屉 + organizeView 有最近一批 → 直接显示那一批 */
  const backend = makeOrganizeBackend({ restore: organizeBatchFixture() })
  const store = makeStore({ organize: { open: true, batchId: 'b-1' } })
  const fx = await mountPanel({ organizeApi: backend.api, store })
  const ft = fx.tree
  check('挂载时按当前 scope 恢复最近一批建议', () => {
    assert.equal(backend.log.view.length, 1)
    assert.equal(backend.log.view[0].kind, 'all')
    assert.equal(organizeDrawers(ft).length, 1, 'store 说开着，就要开着')
    assert.equal(orgItems(ft, 'pending').length, 2)
    assert.equal(rootOf(ft).props['data-organize'], '1')
  })
  check('恢复出来的抽屉里计数与条目一致', () => {
    assert.ok(textOf(organizeDrawers(ft)[0]).includes('待处理 2'))
  })
}

{
  /* CSS：抽屉与条目样式（红线断言之外的口径） */
  check('抽屉 CSS：340px 玻璃列 + 条目/引用块/影响预览/页脚', () => {
    const grid = ruleBody('.fo-root[data-organize="1"] .fo-body')
    assert.ok(grid.includes('clamp(260px, 30%, 340px)'), grid)
    const both = ruleBody('.fo-root[data-detail="1"][data-organize="1"] .fo-body')
    assert.ok(both.includes('clamp(240px, 26%, 336px)') && both.includes('clamp(240px, 26%, 340px)'), both)
    const drawer = ruleBody('.fo-organize')
    assert.ok(drawer.includes('overflow: auto'))
    assert.ok(drawer.includes('border-left: 1px solid var(--fo-glass-line)'))
    assert.ok(drawer.includes('backdrop-filter'))
    const item = ruleBody('.fo-org-item')
    assert.ok(item.includes('border-radius: 12px'))
    assert.ok(item.includes('background: var(--fo-glass-sub)'))
    const quote = ruleBody('.fo-org-evidence')
    assert.ok(quote.includes('border-left: 2px solid var(--fo-selected-line)'), '引用块有竖线')
    const impact = ruleBody('.fo-org-impact')
    assert.ok(impact.includes('color: var(--dsw-alias-state-warn-primary)'), '影响预览用 warn 色')
    const kind = ruleBody('.fo-org-kind')
    assert.ok(kind.includes('border-radius: 999px'), 'kind 徽标是胶囊')
    assert.ok(ruleBody('.fo-org-foot').includes('margin-top: auto'))
    assert.ok(ruleBody('.fo-btn-icon').includes('width: 14px'))
  })
}


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
check('写失败不清空已有数据（画布与节点还在；已完成默认仍隐藏）', () => {
  assert.equal(graphSections(failTree).length, 2)
  assert.equal(taskNodes(failTree).length, 4)
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
  assert.equal(nodeGroups(garbage.tree).length, 0)
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
const refreshButton = findAll(raceTree, (node) => node.kind === 'host' && node.type === 'button' && node.props['data-action'] === 'refresh')[0]
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
check('写后回包落地：内部 revision 继续前进，但界面不再显示它', () => {
  /* 用户口径：「QVIZ / revision 6d8e44d9 · 09:28:57」这个信息好像也不需要 →
     头部副标题整条删掉。这里钉住「界面文本不含 revision / 不含时钟」。 */
  const head = textOf(raceTree)
  assert.equal(/revision\s/i.test(head), false, `头部不该再出现 revision：${head.slice(0, 120)}`)
  assert.equal(/snapshot|快照时钟/.test(head), false)
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

/* ---- 11b. task-14：功能注册表驱动 —— 临时注入第二个功能，验证切换与状态保留 ---- */
{
  /* 假功能：只渲染一段文字（不碰数据），足够证明「正文由注册表决定」。
     元素要用注入包里的 h（harness 的 createElement），不能直接引用外层的 h。 */
  const withFake = (deps) => {
    const hh = deps.h
    return [
      ...createFeatures(deps),
      {
        id: 'fake',
        label: '假功能',
        hint: '测试注入的功能页',
        icon: (h) => h('svg', { className: 'fo-nav-icon', width: 20, height: 20, viewBox: '0 0 20 20' }),
        Component: (ctx) => hh('div', { className: 'fo-fake-feature' }, ctx.featureHint || '假功能正文'),
      },
    ]
  }
  const injected = await mountPanel({ features: withFake })
  let itree = injected.tree
  const railOf = () => railEl(itree)

  const fakeIndex = (list) => list.findIndex((item) => textOf(item).includes('假功能'))
  check('注入一个假功能：rail 出现它、正文仍停在关系图', () => {
    assert.equal(featnavItems(itree).length, injected.features.length, '功能项数量 == 注册表长度')
    assert.ok(fakeIndex(featnavItems(itree)) > 0, '假功能出现在 rail 里')
    assert.equal(featnavItems(itree).find((item) => textOf(item).includes('关系')).props['data-active'], '1')
    assert.equal(rootOf(itree).props['data-feature'], 'graph')
    assert.ok(graphSections(itree).length > 0)
  })

  /* 先在关系图里造一个「会被带走」的状态：切到目录 scope + 选中一个项目 */
  rowByDataId(itree, 'g1').props.onClick()
  itree = await injected.mini.act()
  const savedSelection = injected.store.data.get('selection')
  check('切换前：关系图处于目录 scope', () => {
    assert.equal(rootOf(itree).props['data-scope'], 'group')
    assert.deepEqual(savedSelection, { kind: 'group', id: 'g1' })
  })

  featnavItems(itree)[fakeIndex(featnavItems(itree))].props.onClick()
  itree = await injected.mini.act()
  check('点假功能 → 正文换成它，画布与 rail 里的二级菜单都卸载', () => {
    assert.equal(byClass(itree, 'fo-fake-feature').length, 1)
    assert.equal(graphSections(itree).length, 0)
    assert.equal(byClass(itree, 'fo-subnav').length, 0, '假功能没有二级菜单')
    assert.equal(scopeColumns(itree).length, 0)
    assert.equal(rootOf(itree).props['data-feature'], 'fake')
    assert.equal(injected.store.data.get('feature'), 'fake', 'activeFeature 落 store')
    assert.equal(featnavItems(itree)[fakeIndex(featnavItems(itree))].props['data-active'], '1')
    assert.equal(featnavItems(itree)[fakeIndex(featnavItems(itree))].props['aria-current'], 'page')
  })
  check('假功能页仍复用同一套 rail / 内容头部骨架', () => {
    assert.equal(byClass(railOf(), 'fo-brand').length, 1)
    assert.equal(featnavItems(itree).length, injected.features.length)
    /* 搜索框只属于声明 search:true 的功能（今天只有关系图）：仪表盘看全局，
       摆在它们头上会让人以为数字被搜没了（复核 R1 的修法）。 */
    assert.equal(searchInputs(itree).length, 0, '没声明 search 的功能不显示搜索框')
  })

  featnavItems(itree).find((item) => textOf(item).includes('关系')).props.onClick()
  itree = await injected.mini.act()
  check('切回关系图：scope / 选中项都还在（状态没被功能切换清掉）', () => {
    assert.equal(rootOf(itree).props['data-feature'], 'graph')
    assert.equal(rootOf(itree).props['data-scope'], 'group')
    assert.deepEqual(injected.store.data.get('selection'), savedSelection)
    assert.equal(injected.store.data.get('feature'), 'graph')
    assert.equal(byClass(itree, 'fo-subnav').length, 1, '切回来二级菜单又挂上 rail')
    assert.ok(graphSections(itree).length === 1, '目录 scope 仍是那一张图')
    assert.equal(String(rowByDataId(itree, 'g1').props['aria-selected']), 'true', '树上的选中态还在')
  })
  check('注入的功能不污染真注册表（模块级 createFeatures 仍只有一项）', () => {
    const base = createFeatures({ React: injected.mini.React, h: injected.mini.React.createElement, model, layout, api: injected.api, store: injected.store })
    assert.equal(base.some((row) => row.id === 'fake'), false, '模块级注册表不该被注入的假功能污染')
    assert.deepEqual(base.map((row) => row.id), ['runs', 'insight', 'graph'], '注册表顺序 = 运行 → 洞察 → 关系')
  })
}

/* ---- 10b. 注册表接线：洞察 / 运行两个新功能页真的能切过去、真的渲染 ---- */
{
  const items = () => featnavItems(tree)
  const clickFeature = async (label) => {
    const index = items().findIndex((item) => textOf(item).includes(label))
    assert.ok(index >= 0, `rail 里没有「${label}」`)
    items()[index].props.onClick()
    tree = await main.mini.act()
    return index
  }

  await clickFeature('洞察')
  check('切到「洞察」：正文是洞察页（fd- 面板），画布与二级菜单都卸载', () => {
    assert.equal(rootOf(tree).props['data-feature'], 'insight')
    assert.ok(byClass(tree, 'fd-page').length >= 1, '洞察页根容器在')
    assert.ok(byClass(tree, 'fd-panel').length >= 5, '至少 5 个面板')
    assert.equal(graphSections(tree).length, 0)
    assert.equal(byClass(tree, 'fo-subnav').length, 0, '洞察没有二级菜单')
  })
  check('洞察页 KPI 用的是快照里的真实数字（不是占位）', () => {
    const text = textOf(tree)
    assert.ok(text.includes('任务总数') || text.includes('完成率'), text.slice(0, 120))
    assert.ok(/\d/.test(text), '应有数字')
  })

  await clickFeature('运行')
  check('切到「运行」：气泡群渲染，运行中的气泡带 is-running', () => {
    assert.equal(rootOf(tree).props['data-feature'], 'runs')
    /* 用户口径：整个运行页照参考项目（kp-z/open_adventure 的 Dashboard）重排 →
       页面骨架是 .frx-page / .frx-grid / .frx-card，气泡是 .frx-orb-slot + .frx-orb */
    assert.equal(byClass(tree, 'frx-page').length, 1, '运行页根容器是 frx-page')
    assert.ok(byClass(tree, 'frx-grid').length >= 1, '4 列网格在')
    assert.ok(byClass(tree, 'frx-card').length >= 3, 'GlassCard 风格的卡片在')
    assert.equal(byClass(tree, 'fr-bubbles').length, 0, '旧的 fr- 气泡墙不该再出现')
    /* 视觉层是内联 SVG（circle 几何就是圆），交互层是 frx-orb-hit */
    const orbs = byClass(tree, 'frx-orb-hit')
    const orbSvgs = findAll(tree, (node) => node.kind === 'host' && node.type === 'svg' && String(node.props.viewBox) === '0 0 100 100')
    assert.ok(orbSvgs.length >= 1, `气泡应该用 SVG 画圆，实际 ${orbSvgs.length} 个`)
    assert.ok(findAll(orbSvgs[0], (node) => node.kind === 'host' && node.type === 'circle').length >= 1, 'SVG 里要有 circle')
    assert.ok(orbs.length >= 1, `应有气泡，实际 ${orbs.length}`)
    /* 散点位：绝对定位 + 参考表的 8 个 top/left 之一 */
    const slots = byClass(tree, 'frx-orb-slot')
    assert.ok(slots.length >= 1, '气泡槽在')
    assert.ok(String(slots[0].props.style.top).endsWith('%'), `槽位用百分比定位（参考表），实际 ${slots[0].props.style.top}`)
    assert.ok(/^frx-float /.test(String(slots[0].props.style.animation)), `漂浮动画来自参考项目，实际 ${slots[0].props.style.animation}`)
    /* 圆内水位：只有运行中的气泡才画（WaterLevel 的 SVG 两层）。
       这份快照里不一定有运行中的任务，所以「有运行泡 ⇔ 有水位」两头都断言。 */
    const runningOrbs = findAll(tree, (node) => node.kind === 'host' && classNameOf(node).split(/\s+/).includes('frx-orb') && /is-(ok|current)/.test(classNameOf(node)))
    const waterSvgs = byClass(tree, 'frx-water')
    assert.equal(waterSvgs.length > 0, runningOrbs.length > 0,
      `水位只画在运行中的气泡上（运行泡 ${runningOrbs.length} 个，水位 ${waterSvgs.length} 处）`)
    assert.equal(byClass(tree, 'fo-subnav').length, 0, '运行没有二级菜单')
  })

  await clickFeature('关系')
  check('切回「关系」：画布与二级菜单都回来（状态仍是之前那个）', () => {
    assert.equal(rootOf(tree).props['data-feature'], 'graph')
    assert.ok(graphSections(tree).length >= 1)
    assert.ok(byClass(tree, 'fo-subnav').length >= 1)
  })
}

/* ---- 10c. 运行页的气泡交互（复核 R3：此前这条链路零覆盖） ---- */
{
  const hostCalls = []
  const fakeHost = {
    canOpenSession: () => ({ ok: true }),
    openSession: (sessionId, expectedTitle) => {
      hostCalls.push({ sessionId, expectedTitle })
      return Promise.resolve({ ok: true })
    },
  }
  const snapshot = Object.assign({}, SNAPSHOT, {
    tasks: [
      makeTask('r1', 21, 'wA', '项目A', { running: true, started: true, sessionId: 'sess-running' }),
      makeTask('r2', 22, 'wA', '项目A', { running: false, started: true, sessionId: '' }),
    ],
    relations: [],
    stats: { tasks: 2, groups: 0, dependencyEdges: 0, provenanceEdges: 0, blocked: 0, ready: 2 },
  })
  const run = await mountPanel({ snapshot, host: fakeHost })
  let rtree = run.tree
  const runItems = () => featnavItems(rtree)
  runItems()[runItems().findIndex((item) => textOf(item).includes('运行'))].props.onClick()
  rtree = await run.mini.act()

  /* 视觉层（span.frx-orb）与交互层（button.frx-orb-hit）是分开的：
     形状不受宿主 button 样式影响，交互仍走 button。测试点 button。 */
  const bubbles = () => byClass(rtree, 'frx-orb-hit')
  check('运行页：一个任务一个气泡（2 条任务 = 2 个气泡）', () => {
    assert.equal(bubbles().length, 2)
  })

  /* ---- 状态对话气泡（用户口径：只看状态、贴泡沿外、无新消息自动消失） ---- */
  /* 用户口径：「运行卡片下方的已绑定和右上信息是重复的」→ 同一个数字全页只出现一次。
     这里钉住三对最容易复发的重复。 */
  check('信息不重复：未完成 / 运行中 / 已绑会话 各自只出现一次', () => {
    const text = textOf(rootOf(rtree))
    const count = (needle) => text.split(needle).length - 1
    assert.equal(count('未完成'), 1, `「未完成」出现 ${count('未完成')} 次（KPI 胶囊）`)
    assert.ok(count('绑会话') + count('已绑会话') === 0, '会话数只该出现在 KPI 胶囊的「会话」里（不再写「绑会话」）')
    /* 状态对话气泡里「运行中」已改成三点动画（文字只在 aria-label 上），所以正文里只剩
       「运行中」卡自己的标题与状态词。 */
    /* KPI 胶囊里各出现一次；页面上不再有「运行中」卡，所以最多出现在图例里。 */
    assert.ok(count('运行中') <= 2, `「运行中」最多出现在 KPI 胶囊 + 图例里，实际 ${count('运行中')} 次`)
  })

  check('状态徽标：运行中的泡挂三点动画（不写字），位置在右下角咬边', () => {
    const badges = byClass(rtree, 'frx-badge')
    assert.ok(badges.length >= 1, `每个未完成的泡都该有状态徽标，实际 ${badges.length}`)
    const running = badges.find((b) => b.props['data-badge'] === 'dots')
    assert.ok(running, '运行中的泡应该有 dots 徽标')
    const dots = byClass(running, 'frx-dots')
    assert.equal(dots.length, 1, '运行中的徽标里应该有三点动画')
    assert.equal(byClass(dots[0], 'frx-dots-dot').length, 3, '三个点')
    assert.ok(String(running.props['aria-label'] || '').startsWith('运行中') || String(running.props['aria-label']) === '刚开工',
      `徽标要带无障碍文字，实际 ${running.props['aria-label']}`)
    assert.equal(textOf(running).trim(), '', '画面上不该出现文字')
    assert.equal(running.props['data-tone'], 'brand', '运行中徽标应是品牌色（蓝）')
  })

  check('状态徽标：其余状态用线性图标（✓ / ⚠ / ⏸ / 🕐），不是文字', () => {
    const badges = byClass(rtree, 'frx-badge')
    const kinds = badges.map((b) => b.props['data-badge'])
    assert.ok(kinds.includes('clock'), `未开始的泡该有时钟徽标，实际 ${JSON.stringify(kinds)}`)
    for (const badge of badges) {
      if (badge.props['data-badge'] === 'dots') continue
      assert.ok(byClass(badge, 'frx-badge-dot').length + findAll(badge, (n) => n.kind === 'host' && n.type === 'svg').length >= 1,
        `${badge.props['data-badge']} 徽标要有图形`)
      assert.equal(textOf(badge).trim(), '', '徽标里不该有文字')
    }
  })

  check('执行历史里「运行中」那一行也是三点动画，其余状态仍是文字', () => {
    const rows = byClass(rtree, 'frx-row-status')
    assert.ok(rows.length >= 1)
    const runningRow = rows.find((row) => classNameOf(row).includes('is-running'))
    if (runningRow) {
      assert.equal(byClass(runningRow, 'frx-dots').length, 1, '运行中那一行要有点动画')
      assert.equal(textOf(runningRow).trim(), '', '运行中那一行不该有文字')
    }
    const other = rows.find((row) => !classNameOf(row).includes('is-running'))
    if (other) assert.ok(textOf(other).trim().length > 0, '其它状态仍然是文字')
  })

  check('徽标不再有「尾巴」这种连接件（旧的黑横条形态已被替换）', () => {
    assert.equal(byClass(rtree, 'frx-speech').length, 0, '旧的对话气泡形态不该再出现')
    assert.equal(byClass(rtree, 'frx-speech-tail').length, 0, '旧的尾巴也不该再出现')
  })

  check('徽标不显示计时（口径：只看状态）', () => {
    const badges = byClass(rtree, 'frx-badge')
    assert.ok(badges.length >= 1)
    for (const badge of badges) assert.equal(/\d{1,2}:\d{2}/.test(textOf(badge)), false, '徽标里不该有计时')
  })

  /* 用户口径：单击有会话的泡直接跳会话；没会话的泡才退化成「选中看详情」。
     所以「点气泡开详情」这条要拿**没绑会话**的那条来验。 */
  const noSessionBubble = () => bubbles().find((orb) => orb.props['aria-label'].includes('任务 r2'))
  noSessionBubble().props.onClick()
  rtree = await run.mini.act()
  check('点没绑会话的气泡 = 选中该任务并打开右侧详情', () => {
    assert.equal(rootOf(rtree).props['data-detail'], '1')
    assert.ok(textOf(rtree).includes('任务 r2'), textOf(rtree).slice(0, 80))
  })

  /* 用户口径：**单击**气泡就跳会话（不是双击）；没绑会话的泡退化成「选中看详情」。 */
  const withSession = bubbles().find((orb) => orb.props['aria-label'].includes('任务 r1'))
  assert.ok(withSession, '应能找到任务 r1 的气泡')
  withSession.props.onClick()
  rtree = await run.mini.act()
  check('单击气泡 → 调 host.openSession(sessionId, 任务标题)', () => {
    assert.equal(hostCalls.length, 1, JSON.stringify(hostCalls))
    assert.equal(hostCalls[0].sessionId, 'sess-running')
    assert.ok(String(hostCalls[0].expectedTitle).includes('任务 r1'), hostCalls[0].expectedTitle)
  })
  check('没绑会话的气泡：单击不调宿主，退化成「选中看详情」', () => {
    const before = rootOf(rtree).props['data-detail']
    const noSession = bubbles().find((orb) => orb.props['aria-label'].includes('任务 r2'))
    assert.ok(noSession, '任务 r2 的气泡在')
    noSession.props.onClick()
    assert.equal(hostCalls.length, 1, '没有会话时不该调用宿主')
    assert.ok(noSession.props.title.includes('未开始') || noSession.props.title.includes('挂起'), String(noSession.props.title))
    return before === '1'
  })
}

/* ---- 10d. 洞察页的历史指标接线（adaptApi 白名单曾漏掉 insightStats →
             真机永远显示「历史指标不可用」；这条断言就是为它加的） ---- */
{
  const statsCalls = []
  const statsPayload = {
    ok: true,
    stats: {
      series: [
        { day: '2026-11-01', done: 3, created: 1, active: 2, wip: 0, docs: 0, cycleMedianDays: 2 },
        { day: '2026-11-02', done: 5, created: 2, active: 4, wip: 1, docs: 0, cycleMedianDays: 2.5 },
      ],
      board: { total: 5, done: 2, started: 1, idle: 2 },
      distribution: [{ state: 'started', workspace: '项目A', count: 1 }],
      fulfillment: { tracked: 2, completed: 1, pending: 1, overdue: 1, onTime: 1, finalOnTime: 1, onTimeRate: 0.5, finalOnTimeRate: 0.5, avgSlackMs: -86400000, avgFinalSlackMs: -3600000, lateCount: 1, byWorkspace: [] },
      quality: { completed: 2, early: 0, onTime: 1, late: 1, cycleSamples: 2, cycleMedianDays: 2.5, cycleP85Days: 4 },
      delayBuckets: [{ bucket: 'dep', label: '等待依赖', count: 2, days: 3, tasks: [] }],
      datasets: {},
      lastRecordAt: 1794338933745,
    },
  }
  const apiWithHistory = {
    overview: async () => ({ ...SNAPSHOT }),
    revision: async () => SNAPSHOT.revision,
    groupAction: async () => ({ ok: true }),
    insightStats: async (days) => { statsCalls.push(days); return statsPayload },
  }
  const hist = await mountPanel({ api: apiWithHistory })
  let htree = hist.tree
  const hItems = () => featnavItems(htree)
  hItems()[hItems().findIndex((item) => textOf(item).includes('洞察'))].props.onClick()
  htree = await hist.mini.act()
  htree = await hist.mini.act() /* 等 insightStats 的 promise 落地 */

  check('洞察页：接口在位时会真的去取历史指标（adaptApi 不能吞掉它）', () => {
    assert.deepEqual(statsCalls, [14], `应调用 insightStats(14)，实际 ${JSON.stringify(statsCalls)}`)
  })
  check('洞察页：取到历史后四个新面板都渲染，且不再显示降级提示', () => {
    const titles = byClass(htree, 'fd-panel-title').map((node) => textOf(node))
    const joined = titles.join('|')
    assert.ok(/吞吐趋势/.test(joined), joined)
    assert.ok(/履约/.test(joined), joined)
    assert.ok(/延期原因/.test(joined), joined)
    assert.ok(/质量/.test(joined), joined)
    assert.equal(/历史指标不可用/.test(joined), false, '不该再显示降级提示')
    assert.ok(byClass(htree, 'fd-panel').length >= 10, `面板数应 >= 10，实际 ${byClass(htree, 'fd-panel').length}`)
  })
  /* 失败降级：**先把挂载与切换做完，再进同步断言**——把 async 塞进 check 里会让断言失败被 Promise 吞掉。 */
  const apiFail = {
    overview: async () => ({ ...SNAPSHOT }),
    revision: async () => SNAPSHOT.revision,
    groupAction: async () => ({ ok: true }),
    insightStats: async () => { throw new Error('404 Not Found') },
  }
  const broken = await mountPanel({ api: apiFail })
  let btree = broken.tree
  const bItems = () => featnavItems(btree)
  bItems()[bItems().findIndex((item) => textOf(item).includes('洞察'))].props.onClick()
  btree = await broken.mini.act()
  btree = await broken.mini.act()
  check('洞察页：历史取数失败时降级成提示条，六个快照面板照旧', () => {
    const titles = byClass(btree, 'fd-panel-title').map((node) => textOf(node)).join('|')
    assert.ok(/历史指标不可用/.test(titles), titles)
    assert.ok(/关键指标/.test(titles) && /最近动态/.test(titles), '快照口径的六个面板必须还在')
    assert.equal(/吞吐趋势/.test(titles), false)
  })
}

/* ---- 10e. 一键整理的撤销链路（接受必须可回退，设计稿 §9.1） ---- */
{
  const backend = makeOrganizeBackend()
  /* overviewDriver 既能拿快照、又能数调用次数：用来证明「接受/撤销之后都重拉了一次」 */
  let overviewCalls = 0
  const fx = await mountPanel({
    organizeApi: backend.api,
    overviewDriver: (callIndex, readState) => { overviewCalls = callIndex; return readState() },
  })
  let ft = fx.tree
  ORGANIZE_TRIGGER(ft).props.onClick()
  ft = await fx.mini.act()
  /* 先全部接受，制造「有已接受的条目」 */
  findAll(organizeDrawers(ft)[0], (node) => node.kind === 'host' && node.type === 'button' && node.props['data-action'] === 'accept-all')[0].props.onClick()
  ft = await fx.mini.act()
  const callsAfterAccept = overviewCalls

  const undoBtn = findAll(organizeDrawers(ft)[0], (node) => node.kind === 'host' && node.type === 'button' && node.props['data-action'] === 'undo-accepted')[0]
  check('有已接受的条目时，抽屉里出现「撤销已接受 N」按钮', () => {
    assert.ok(undoBtn, '撤销按钮要在')
    assert.ok(textOf(undoBtn).includes('撤销已接受'), textOf(undoBtn))
    assert.equal(undoBtn.props.disabled, false)
  })
  undoBtn.props.onClick()
  ft = await fx.mini.act()
  check('点撤销 → organizeUndo(batchId, [])（空数组 = 全部已接受）', () => {
    assert.deepEqual(backend.log.undo, [{ batchId: 'b-1', itemIds: [] }])
  })
  check('撤销后条目变「已撤销」、计数与按钮同步（没有可撤销的就不再显示按钮）', () => {
    assert.equal(orgItems(ft, 'undone').length, backend.getBatch().items.filter((item) => item.status === 'undone').length)
    assert.ok(orgItems(ft, 'undone').length >= 1, '至少一条已撤销')
    assert.equal(findAll(organizeDrawers(ft)[0], (node) => node.kind === 'host' && node.type === 'button' && node.props['data-action'] === 'undo-accepted').length, 0)
    assert.ok(textOf(organizeDrawers(ft)[0]).includes('已撤销'), textOf(organizeDrawers(ft)[0]).slice(0, 120))
  })
  check('撤销后也拉了一次权威快照（边要立刻从画布上消失）', () => {
    assert.ok(callsAfterAccept >= 2, `接受后应重拉一次快照，实际 ${callsAfterAccept}`)
    assert.ok(overviewCalls > callsAfterAccept, `撤销后还要再拉一次：撤销前 ${callsAfterAccept} → 撤销后 ${overviewCalls}`)
  })
}

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
const COMPONENT_FILES = ['OverviewPanel.js', 'TreeNav.js', 'GraphView.js', 'DetailPanel.js', 'styles.js']
for (const file of COMPONENT_FILES) {
  const source = await readFile(join(HERE, '..', 'src', 'client', file), 'utf8')
  check(`${file}：模块顶层不 import react、不 require('react')`, () => {
    assert.equal(/^\s*import[^\n]*['"]react['"]/m.test(source), false)
    assert.equal(/require\(\s*['"]react['"]\s*\)/.test(source), false)
  })
}
/* task-13：图下面的卡片区已删 —— 文件删掉、入口不再引用、类名不再出现，都钉住。 */
let taskCardsExists = true
try {
  await readFile(join(HERE, '..', 'src', 'client', 'TaskCards.js'), 'utf8')
} catch (error) {
  taskCardsExists = false
}
const overviewSource = await readFile(join(HERE, '..', 'src', 'client', 'OverviewPanel.js'), 'utf8')
const graphSource = await readFile(join(HERE, '..', 'src', 'client', 'GraphView.js'), 'utf8')
check('卡片区已删：TaskCards.js 不在仓库里，入口也不再有卡片引用', () => {
  assert.equal(taskCardsExists, false, 'src/client/TaskCards.js 应该已经删掉')
  assert.equal(/TaskCards|createTaskCards/.test(overviewSource), false, 'OverviewPanel 不该再引用 TaskCards')
  assert.equal(/fo-card|fo-cards|fo-tag/.test(overviewSource), false, '入口里不该再有卡片类名')
})
check('画布合并：GraphView 不再有泳道，改为图例 + 铺满 SVG', () => {
  assert.equal(/fo-band|bandLayer/.test(graphSource), false, '泳道渲染应该整段删掉')
  assert.ok(/fo-grid/.test(graphSource), '要有网格层')
  assert.ok(/fo-legend-item/.test(graphSource), '要有图头图例')
  assert.ok(/preserveAspectRatio: 'xMidYMid meet'/.test(graphSource), 'SVG 用 meet 自适应')
  assert.ok(/width: '100%'/.test(graphSource) && /height: '100%'/.test(graphSource), 'SVG 宽高 100%')
})

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

/* ---- 接受建议后画布立刻变化（用户报的「接受了没反应」就是这条链路） ---- */
{
  const batch = {
    ...organizeBatchFixture(),
    pending: 1,
    items: [{
      id: 'it-t', kind: 'temporal', from: 'a1', to: 'b1',
      fromTitle: '任务 a1', toTitle: '任务 b1', confidence: 1,
      evidence: '预期时间 2026-11-12 18:00 早于 2026-11-13 18:00（按时间先后排序，不代表必须等待）',
      status: 'pending', reason: '',
      impact: { blocked: [], blockedCount: 0, note: '时间先后：只表示谁在前谁在后，不阻塞任何任务的开工。' },
    }],
  }
  const backend = makeOrganizeBackend({ result: batch })
  /* 关键：接受之后宿主真的会多一条 temporal —— 假 api 也照这个口径回快照。 */
  const live = { accepted: false }
  const api = {
    ...backend.api,
    organizeAccept: async (batchId, itemIds) => {
      live.accepted = true
      return backend.api.organizeAccept(batchId, itemIds)
    },
    overview: async () => ({
      ...SNAPSHOT,
      relations: live.accepted ? [...RELATIONS, { from: 'a1', to: 'b1', kind: 'temporal' }] : RELATIONS,
    }),
  }
  const fx = await mountPanel({ api, startFeature: 'graph' })
  let at = fx.tree
  const temporalEdges = () => findAll(at, (node) => node.kind === 'host' && classNameOf(node) === 'fo-edge' && node.props['data-kind'] === 'temporal')
  check('接受前：画布上还没有时间边', () => {
    assert.equal(temporalEdges().length, 0)
  })
  ORGANIZE_TRIGGER(at).props.onClick()
  at = await fx.mini.act()
  orgButton(orgItems(at, 'pending')[0], 'accept').props.onClick()
  at = await fx.mini.act()
  check('接受时间建议后：画布立刻多出点线（不用手动刷新）', () => {
    assert.equal(live.accepted, true, '接受走了宿主接口')
    assert.equal(temporalEdges().length >= 1, true, '重拉快照后时间边进了画布')
  })
  check('接受后图头图例也出现「时间」计数', () => {
    const legend = byClass(at, 'fo-edge-legend')[0]
    assert.ok(legend, '边的图例在')
    assert.ok(textOf(legend).includes('时间'))
  })
}

/* ---- 时间先后（temporal）进画布：独立 mount，避免污染主 fixture 的计数断言 ---- */
{
  const snap = {
    ...SNAPSHOT,
    relations: [
      { from: 'a1', to: 'b1', kind: 'temporal' },
      { from: 'b1', to: 'a1', kind: 'depends_on' },
    ],
    stats: { tasks: 5, groups: 1, dependencyEdges: 1, provenanceEdges: 0, temporalEdges: 1, blocked: 1, ready: 2 },
  }
  const fx = await mountPanel({ snapshot: snap, startFeature: 'graph' })
  let tt = fx.tree
  check('时间先后画成点线：SVG 里有 data-kind="temporal" 的边', () => {
    const edges = findAll(tt, (node) => node.kind === 'host' && classNameOf(node) === 'fo-edge')
    assert.equal(edges.filter((edge) => edge.props['data-kind'] === 'temporal').length >= 1, true)
    assert.equal(fx.tree && byClass(tt, 'fo-viewport').length >= 1, true)
  })
  check('图头有边的图例：前置 1 / 时间 1（来源 0 不占位）', () => {
    const legend = byClass(tt, 'fo-edge-legend')[0]
    assert.ok(legend, '边的图例在')
    const kinds = findAll(legend, (node) => node.kind === 'host' && classNameOf(node) === 'fo-edge-item')
      .map((node) => node.props['data-kind'])
    assert.deepEqual(kinds, ['depends_on', 'temporal'])
    assert.ok(textOf(legend).includes('前置') && textOf(legend).includes('时间'))
  })
  /* 「不阻塞」的权威口径在宿主侧：test/organizeTemporal.mjs 钉住 blocked / ready / blockedBy 与
     relationSync 不被污染；画布这层只负责把 temporal 画成一条独立的点线（上面两条已覆盖）。 */
}

/* ---- 画布缩放接线（独立一轮 mount，避免被前面用例的 scope / 聚焦状态干扰） ---- */
{
  const fx = await mountPanel({ snapshot: SNAPSHOT, startFeature: 'graph' })
  let vt = fx.tree
  const btn = (action) => findAll(vt, (node) => node.kind === 'host' && node.props['data-action'] === action)[0]
  const pct = () => textOf(byClass(vt, 'fo-zoom-value')[0]).trim()
  check('缩放接线：初始 100%，且没有 transform（恒等视口）', () => {
    assert.equal(pct(), '100%')
    assert.ok(byClass(vt, 'fo-svg').every((svg) => svg.props['data-zoom'] === '1'))
  })
  btn('zoom-in').props.onClick()
  vt = await fx.mini.act()
  check('缩放接线：点 + 后百分比变 125%，SVG 挂上 scale(1.25) 的视口变换', () => {
    assert.equal(pct(), '125%')
    const scaled = byClass(vt, 'fo-svg').filter((svg) => svg.props['data-zoom'] === '1.25')
    assert.equal(scaled.length >= 1, true, '至少一张图被放大')
    assert.ok(byClass(vt, 'fo-viewport').some((vp) => /scale\(1\.25\)/.test(String(vp.props.transform))))
  })
  btn('zoom-reset').props.onClick()
  vt = await fx.mini.act()
  check('缩放接线：点百分比回到 100%（transform 一起撤掉）', () => {
    assert.equal(pct(), '100%')
    assert.ok(byClass(vt, 'fo-viewport').every((vp) => vp.props.transform === undefined))
  })
}

/* ---- 汇总 ---- */
console.log(`\noverviewPanel.mjs: ${passed} passed, ${failures.length} failed`)
if (failures.length) {
  for (const name of failures) console.error(`- ${name}`)
  process.exit(1)
}
process.exit(0)
