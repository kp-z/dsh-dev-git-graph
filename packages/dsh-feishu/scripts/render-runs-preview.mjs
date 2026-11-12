/**
 * 离线渲染运行页预览（node scripts/render-runs-preview.mjs > .runs-preview.html）。
 *
 * 为什么需要它：本机浏览器预览依赖 esm.sh 上的 React，网络一断就没法看页面效果；
 * 而「改了到底长什么样」恰恰是最需要复核的事。这里用一个 ~60 行的迷你 React（只支持本项目用到的
 * useState / useRef / useMemo / useCallback / useEffect）把 RunsFeature 真正渲染一遍，
 * 拼上真实样式表，产出一个纯静态 HTML —— 之后用本地 Chrome 截图即可，不需要任何网络。
 *
 * 注意：这是**开发期工具**，不是产品代码，也不参与 npm test。
 */
import { writeFileSync } from 'node:fs'
import { CSS as PANEL_CSS } from '../src/client/styles.js'
import { CSS as RUNS_CSS } from '../src/client/runsExactStyles.js'
import { createFeatures } from '../src/client/features.js'

/* ---------------- 迷你 React ---------------- */
function createMiniReact() {
  let current = null
  let dirty = false
  const instances = new Map()
  const slot = (kind, init) => {
    const inst = current
    const idx = inst.index++
    if (!inst.hooks[idx]) inst.hooks[idx] = { kind, init, value: init, deps: undefined, run: false, cleanup: undefined }
    const h = inst.hooks[idx]
    if (h.kind === 'state' && h.value === undefined && init !== undefined) h.value = init
    if (h.kind === 'ref' && h.value === undefined) h.value = { current: init }
    return h
  }
  const depsChanged = (a, b) => !a || !b || a.length !== b.length || a.some((v, i) => !Object.is(v, b[i]))
  const React = {
    createElement(type, props, ...children) {
      const kids = children.length ? children : (props && props.children)
      return { __el: true, type, props: { ...(props || {}), children: kids === undefined ? (props && props.children) : kids }, key: props && props.key }
    },
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
    useEffect(fn, deps) { const s = slot('effect', undefined); if (depsChanged(s.deps, deps)) { s.fn = fn; s.run = true; s.deps = deps } },
  }
  const nameOf = (fn) => (fn && (fn.displayName || fn.name)) || 'Anonymous'
  function render(el, path) {
    if (el === null || el === undefined || el === false || el === true) return null
    if (typeof el === 'string' || typeof el === 'number') return { text: String(el) }
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
      return render(out, `${id}/`)
    }
    return { kind: 'host', type: String(type), props, children: render(props.children, `${path}/`) }
  }
  const flushEffects = () => {
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
  return { React, mount(element) { React.__root = element; return render(element, 'root') }, act() { dirty = false; const t = render(React.__root, 'root'); flushEffects(); return t } }
}

/* ---------------- 树 → HTML ---------------- */
const VOID = new Set(['br', 'hr', 'img', 'input', 'path', 'circle', 'rect', 'line', 'polyline', 'polygon', 'stop', 'animate', 'feGaussianBlur'])
const escapeHtml = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
function styleOf(obj) {
  if (!obj || typeof obj !== 'object') return ''
  return Object.entries(obj).filter(([, v]) => v != null && v !== '').map(([k, v]) => `${k.startsWith('--') ? k : k.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`)}:${v}`).join(';')
}
function toHtml(node) {
  if (!node) return ''
  /* children 里可能嵌着数组（render() 遇到 children 数组会产出嵌套数组），必须显式摊平，
     否则整块内容会被静默丢掉 —— 第一版就因为这个「状态泡在树里、产物里却没有」。 */
  if (Array.isArray(node)) return node.map(toHtml).join('')
  if (node.text != null) return escapeHtml(node.text)
  if (!node.kind) return (node.children || []).map(toHtml).join('')
  const { type, props } = node
  const attrs = []
  for (const [k, v] of Object.entries(props || {})) {
    if (v == null || v === false || k === 'children' || k === 'key') continue
    if (k === 'className') { attrs.push(`class="${escapeHtml(v)}"`); continue }
    if (k === 'style') { const s = styleOf(v); if (s) attrs.push(`style="${escapeHtml(s)}"`); continue }
    if (k === 'defaultValue' || k === 'autoFocus' || k === 'focusable') continue
    if (/^on[A-Z]/.test(k)) continue
    if (v === true) { attrs.push(k); continue }
    attrs.push(`${k}="${escapeHtml(v)}"`)
  }
  const inner = (node.children || []).map(toHtml).join('')
  return VOID.has(type) ? `<${type} ${attrs.join(' ')}>` : `<${type} ${attrs.join(' ')}>${inner}</${type}>`
}

/* ---------------- 数据与渲染 ---------------- */
const NOW = Date.now()
const HOUR = 3600 * 1000
const task = (id, no, ws, title, extra) => {
  const wsKey = ws.split(' ')[0].replace(/[[\]]/g, '')
  return Object.assign({
    id, no, workspaceKey: wsKey, workspaceTitle: ws, workspacePath: `/Users/kp/DEV/${wsKey}`,
    title, done: false, blocked: false, ready: true, started: false, suspended: false,
    sessionId: `s-${id}`, running: false, sessionTurn: 0, createdAt: 0, startedAt: 0,
    completedAt: 0, suspendedAt: 0, predecessors: [], successors: [], sourceTasks: [], derivedTasks: [], blockedBy: [],
  }, extra || {})
}
const snapshot = {
  revision: 'rev-preview',
  now: NOW,
  groups: [{ id: 'g1', name: 'QVIZ', members: ['QVIZ'], labels: { QVIZ: 'QVIZ' }, colorOf: { QVIZ: 0 } }],
  workspaces: [
    { key: 'QVIZ', id: 'QVIZ', title: '[QVIZ] 后端工作区', path: '/Users/kp/DEV/QVIZ', logo: 'lucide:database' },
    { key: 'DSH', id: 'DSH', title: '[DSH] 插件开发', path: '/Users/kp/DEV/DSH', logo: 'lucide:puzzle' },
  ],
  tasks: [
    task('a1', 516418, 'QVIZ 后端工作区', 'topic_timelines 接口新增 MCAP 支持', { running: true, started: true, startedAt: NOW - 42 * 60 * 1000, sessionTurn: 12, done: true, completedAt: NOW - 1000 }),
    task('b1', 516451, 'DSH 插件开发', '飞书任务集开发', { running: true, started: true, startedAt: NOW - 8 * 60 * 1000, sessionTurn: 12 }),
    task('c1', 516350, 'DSH 插件开发', '总览页写回飞书评论', { blocked: true, ready: false, blockedBy: [{ id: 'zz', title: '早就删掉的任务', done: false }] }),
    task('d1', 516418, 'QVIZ 后端工作区', '拆分 tile 渲染管线', { started: true, startedAt: NOW - 3 * HOUR, sessionTurn: 4 }),
    /* 刚做完（5 秒前）：应该以绿泡短暂留在墙上，并挂一句「已完成」状态泡 */
    task('e1', 516500, 'DSH 插件开发', '刚跑完的一条任务', { done: true, completedAt: NOW - 5 * 1000, startedAt: NOW - 2 * HOUR, sessionTurn: 9 }),
  ],
  relations: [],
  stats: { tasks: 5, groups: 1, dependencyEdges: 1, provenanceEdges: 0, temporalEdges: 0, blocked: 1, ready: 3 },
  /* 与 RunsFeature 的 RECENT_DONE_MS 对齐：刚做完的绿泡上墙 */
  recentDoneMs: 25 * 1000,
}

const { React, mount, act } = createMiniReact()
globalThis.EventSource = undefined
const h = React.createElement
const features = createFeatures({ React, h })
const ctx = {
  snapshot,
  trees: [], graphs: [], selectedId: '', focusedId: '', nodePos: {}, hostReady: false, hostReason: '',
  insightStats: null,
  onOpenSession: () => {}, onOpenTask: () => {}, onRefresh: () => {}, onFocusTask: () => {},
  onNodeMove: () => {}, onResetLayout: () => {}, onBlur: () => {},
  organize: { available: false, running: false, open: false, pending: 0, onRun: () => {}, onToggle: () => {} },
}

/** 逐页渲染；某一页需要更多 ctx 时不要让整个预览挂掉，把它写进页面里 */
const panels = features.map((feature) => {
  try {
    const tree = mount(h(feature.Component, ctx))
    void act()
    return { id: feature.id, label: feature.label, tree, error: '' }
  } catch (error) {
    console.log(`页面 ${feature.id} 渲染失败：${error.message}`)
    return { id: feature.id, label: feature.label, tree: null, error: String(error && error.message) }
  }
})

/* 每页各自渲染，失败只影响那一页（把错误写进产物，方便定位缺哪个 ctx） */
const hostTokens = `
  html,body{margin:0;background:var(--dsw-alias-bg-base);font:13px/1.5 -apple-system,'PingFang SC',sans-serif}
  body{
    --dsw-alias-bg-base: oklch(0.19 0.008 285);
    --dsw-alias-bg-layer-1: oklch(0.23 0.010 285);
    --dsw-alias-bg-layer-2: oklch(0.27 0.012 285);
    --dsw-alias-bg-overlay: oklch(0.21 0.010 285);
    --dsw-alias-border-l1: oklch(0.36 0.012 285);
    --dsw-alias-border-l2: oklch(0.46 0.014 285);
    --dsw-alias-brand-primary: oklch(0.62 0.17 262);
    --dsw-alias-label-primary: oklch(0.95 0.004 285);
    --dsw-alias-label-secondary: oklch(0.72 0.006 285);
    --dsw-alias-state-success-primary: oklch(0.72 0.15 155);
    --dsw-alias-state-warn-primary: oklch(0.78 0.14 75);
    --dsw-alias-state-error-primary: oklch(0.68 0.18 25);
    --dsw-alias-state-idle-primary: oklch(0.60 0.01 285);
    --dsw-specific-sidebar-fill: oklch(0.21 0.009 285);
  }
  body{padding:0 0 40px}
  .preview-head{display:flex;flex-direction:column;gap:4px;padding:16px 22px;border-bottom:1px solid var(--dsw-alias-border-l1)}
  .preview-head b{font-size:14px}
  .preview-head span{font-size:11px;color:var(--dsw-alias-label-secondary)}
  .frame{padding:14px 22px 0;display:flex;flex-direction:column;gap:8px}
  .frame h2{margin:0;font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:var(--dsw-alias-label-secondary)}
  .err{margin:0;padding:12px;border-radius:10px;background:rgba(239,68,68,.12);border:1px solid rgba(239,68,68,.4);font-size:12px}
  .viewport{width:1100px;height:620px;display:flex;flex-direction:column;background:var(--dsw-alias-bg-base);border:1px solid var(--dsw-alias-border-l1);border-radius:12px;overflow:hidden}
  .viewport > *{flex:1 1 auto;min-height:0}
`

const frames = panels.map((panel) => {
  if (panel.error) return `<section class="frame"><h2>${panel.label}</h2><p class="err">渲染失败：${escapeHtml(panel.error)}</p></section>`
  if (!panel.tree) return ''
  return `<section class="frame"><h2>${panel.label}</h2><div class="viewport">${toHtml(panel.tree)}</div></section>`
}).join('')

writeFileSync(new URL('../.runs-preview.html', import.meta.url), `<!doctype html><html lang="zh"><head><meta charset="utf-8">
<title>离线预览：运行 / 洞察 / 关系</title>
<style>${hostTokens}</style>
<style>${PANEL_CSS}</style>
<style>${RUNS_CSS}</style>
</head><body><header class="preview-head"><b>dsh-feishu 离线预览</b><span>真实组件 + 真实样式，由迷你 React 在 Node 里渲染；不需要网络</span></header>${frames}</body></html>`)
console.log('written packages/dsh-feishu/.runs-preview.html（离线渲染，不依赖网络）')
/* RunsFeature 里有一个 1 秒的结算定时器（prunePulses），它会吊住 Node；
   这是开发期的一次性渲染脚本，写完就退出。 */
process.exit(0)
