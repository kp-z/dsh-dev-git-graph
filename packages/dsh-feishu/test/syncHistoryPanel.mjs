import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import vm from 'node:vm'

// Offline renderer contracts: never boot the iframe, synchronize or call a model.
const html = await readFile(new URL('../panel.html', import.meta.url), 'utf8')
const script = [...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)].map(m => m[1]).join('\n')
new vm.Script(script)
function extract(name) {
  const match = script.match(new RegExp('  function ' + name + '\\([^]*?\\n  }'))
  assert.ok(match, `missing ${name}`)
  return match[0]
}
class Node {
  constructor(tag = 'div') { this.tag = tag; this.attrs = {}; this.children = []; this._text = ''; this.open = false }
  set textContent(value) { this._text = String(value); this.children = [] }
  get textContent() { return this._text }
  set innerHTML(_) { throw new Error('dynamic history must use safe DOM text, never innerHTML') }
  get firstChild() { return this.children[0] }
  setAttribute(key, value) { this.attrs[key] = String(value) }
  getAttribute(key) { return this.attrs[key] }
  appendChild(node) { this.children.push(node); return node }
  removeChild(node) { this.children.splice(this.children.indexOf(node), 1) }
  querySelectorAll(selector) {
    assert.equal(selector, 'details[data-history-key]')
    return all(this).filter(node => node.tag === 'details' && Object.hasOwn(node.attrs, 'data-history-key'))
  }
}
const all = node => [node, ...node.children.flatMap(all)]
const text = node => [node.textContent, ...node.children.map(text)].join('\n')
const body = new Node(), summary = new Node()
const forbidden = () => { throw new Error('history view must not network, persist, synchronize or invoke models') }
const context = {
  app: { snap: {}, skew: 0 },
  document: { createElement: tag => new Node(tag), createTextNode: value => { const node = new Node('#text'); node.textContent = value; return node } },
  $: id => { assert.ok(['syncHistoryList', 'syncHistorySummary'].includes(id)); return id === 'syncHistoryList' ? body : summary },
  api: forbidden, fetch: forbidden, load: forbidden, onSync: forbidden, maybeAutoInsight: forbidden,
  setTimeout: forbidden, setInterval: forbidden, localStorage: { getItem: forbidden, setItem: forbidden },
}
vm.createContext(context)
const helpers = ['clear', 'el', 'emptyNode', 'pad2', 'fmtAbs', 'syncHistoryText', 'syncHistoryStatus', 'syncHistoryDuration', 'syncHistorySource', 'renderSyncHistory']
for (const name of helpers) vm.runInContext(extract(name), context)
for (const history of [undefined, null, {}, 'not-an-array', [], [null, false]]) {
  context.app.snap.syncHistory = history
  context.renderSyncHistory()
  assert.match(text(body), /暂无同步记录/)
  assert.match(text(body), /不补造历史/)
  assert.equal(all(body).filter(node => node.tag === 'article').length, 0)
  assert.equal(summary.textContent, '')
}
const record = {
  id: 'sync-1', source: 'manual', startedAt: 1700000000000, finishedAt: 1700000002500, durationMs: 2500, status: 'partial',
  counts: { tasks: 12, docs: 3, autoStarted: 2, commentsProcessed: 4, commentsDispatched: 1, attributions: 5 },
  ai: { attributionAttempts: 6, autoStarted: 2, commentsDispatched: 1 },
  stages: [{ name: '<img src=x onerror=alert(1)>', status: 'success', durationMs: 800, detail: '<script>stage</script>\nsecond line' }, { name: '评论协作', status: 'failed', durationMs: 1700 }],
  errors: ['<script>error</script>', { stage: 'comments', message: '<svg onload=alert(1)>' }],
}
const older = { ...record, id: 'sync-older', source: 'timer', status: 'success', stages: [], errors: [] }
const original = JSON.stringify([record, older])
context.app.snap.syncHistory = [record, older]
context.renderSyncHistory()
assert.equal(summary.textContent, '2 条')
const entries = all(body).filter(node => node.tag === 'article')
assert.match(text(entries[0]), /手动同步/)
assert.match(text(entries[1]), /定时同步/)
assert.match(text(entries[0]), /部分成功/)
assert.match(text(entries[0]), /开始：\d{4}-\d{2}-\d{2}/)
assert.match(text(entries[0]), /结束：\d{4}-\d{2}-\d{2}/)
assert.match(text(entries[0]), /耗时：2\.5 秒/)
for (const label of ['任务 12', '文档 3', '自动开工 2', '评论读取 4', '评论投递 1', '归因 5', '归因尝试 6']) assert.ok(text(entries[0]).includes(label), label)
for (const literal of ['<img src=x onerror=alert(1)>', '<script>stage</script>', '<script>error</script>', '<svg onload=alert(1)>']) assert.ok(text(body).includes(literal), 'untrusted data is literal text')
assert.equal(all(body).some(node => ['script', 'img', 'svg'].includes(node.tag)), false)
const details = body.querySelectorAll('details[data-history-key]')
assert.equal(details.length, 2)
assert.ok(details.every(node => !node.open), 'stages and errors default collapsed')
assert.equal(details[0].children[0].tag, 'summary')
assert.match(text(details[0]), /阶段（2）/)
assert.match(text(details[1]), /错误（2）/)
assert.match(text(details[0]), /成功 · 800 毫秒/)
assert.match(text(details[0]), /失败 · 1\.7 秒/)
details[0].open = true
details[1].open = true
context.renderSyncHistory()
assert.equal(body.children[0], entries[0], 'identical state preserves DOM identity and native disclosure focus')
record.durationMs = 2600
context.renderSyncHistory()
assert.ok(body.querySelectorAll('details[data-history-key]').every(node => node.open), 'disclosure state survives changing snapshots')
context.app.snap.syncHistory = [{ ...older, id: 'newest' }, record, older]
context.renderSyncHistory()
assert.ok(body.querySelectorAll('details[data-history-key]').every(node => node.open), 'newest-first inserts do not shift ID-keyed disclosure state')
assert.equal(JSON.stringify([record, older]), original.replace('"durationMs":2500', '"durationMs":2600'), 'renderer does not mutate records')
for (const [status, label] of Object.entries({ running: '进行中', success: '成功', partial: '部分成功', failed: '失败', interrupted: '已中断' })) {
  context.app.snap.syncHistory = [{ ...record, status, finishedAt: status === 'running' ? null : record.finishedAt }]
  context.renderSyncHistory()
  assert.match(text(body), new RegExp(label))
  const node = all(body).find(node => node.className === 'sync-history-status')
  assert.equal(node.attrs['data-status'], status)
  if (status === 'running') assert.match(text(body), /尚未结束/)
}
context.app.snap.syncHistory = [{ id: '__proto__', source: '<script>source</script>', status: '<script>status</script>', startedAt: 'bad', finishedAt: null, durationMs: -1, counts: {}, ai: {}, stages: [null], errors: [null] }]
context.renderSyncHistory()
assert.match(text(body), /<script>source<\/script>/)
assert.match(text(body), /<script>status<\/script>/)
assert.match(text(body), /开始：—/)
assert.match(text(body), /结束：— · 耗时：—/)
assert.match(text(body), /任务 —/)
assert.match(text(body), /归因尝试 —/)
assert.equal(all(body).find(node => node.className === 'sync-history-status').attrs['data-status'], 'unknown')
for (const bad of [undefined, null, '2500', NaN, Infinity, -2]) assert.equal(context.syncHistoryDuration(bad), '—')
assert.equal(context.syncHistoryDuration(0), '0 毫秒')
assert.equal(context.syncHistoryDuration(61500), '1 分 1 秒')
for (const [source, label] of Object.entries({ manual: '手动同步', panel: '面板同步', timer: '定时同步', schedule: '排期同步', 'task-sync': '任务同步', tool: '工具同步' })) assert.equal(context.syncHistorySource(source), label)
assert.equal(context.syncHistorySource('__proto__'), '__proto__')
assert.equal(context.syncHistoryStatus('__proto__'), '__proto__')
context.app.snap.syncHistory = Array.from({ length: 105 }, (_, i) => ({ ...older, id: `row-${i}`, source: `source-${i}` }))
context.renderSyncHistory()
assert.equal(all(body).filter(node => node.tag === 'article').length, 100)
assert.equal(summary.textContent, '100 条')
assert.equal(context.app.snap.syncHistory.length, 105, 'display cap never mutates Host state')
assert.match(text(body.children[0]), /source-0/)
assert.match(text(body.children.at(-1)), /source-99/)
assert.doesNotMatch(text(body), /source-100/)

// Invoke the real renderAll with only its existing sibling renderers stubbed.
for (const name of ['renderInsight', 'renderStatus', 'renderDocPrompt', 'renderAuth', 'renderSettings', 'renderTasks', 'renderDocs']) context[name] = () => {}
vm.runInContext(extract('renderAll'), context)
context.app.snap.syncHistory = [record]
context.renderAll()
assert.equal(summary.textContent, '1 条')
// Invoke real load using an offline state-only API. No boot/capability/AI paths.
context.app.serverFeatures = []
context.app.promptDefaults = {}
context.app.currentSessionId = 'active'
context.app.pendingSeenSession = ''
context.app.loadedOnce = false
context.maybeAutoInsight = () => {} // pre-existing load tail, not a history action
context.stablePanelSignature = JSON.stringify
vm.runInContext(extract('stateSignature') + '\n' + extract('load'), context)
const requests = []
context.api = (route, payload) => { requests.push([route, payload]); assert.equal(route, 'state'); return Promise.resolve({ state: { syncHistory: [older] }, settings: {} }) }
await context.load({ quiet: true })
assert.equal(requests.length, 1)
assert.equal(requests[0][1], undefined)
assert.match(text(body), /定时同步/)
await context.load({ quiet: true })
assert.equal(requests.length, 2)
context.api = () => Promise.resolve({ state: { syncHistory: [record] }, settings: {} })
await context.load({ quiet: true })
assert.match(text(body), /手动同步/)
for (const name of helpers.slice(5)) assert.doesNotMatch(extract(name), /innerHTML|fetch\(|api\(|load\(|setInterval|setTimeout|maybeAutoInsight|onSync|localStorage/)
assert.match(html, /纯数据同步是程序化操作，不消耗模型 token/)
assert.match(html, /逾期 AI 归因、自动开工和评论协作可能消耗模型 token/)
assert.match(html, /不是 token 用量/)
console.log('SYNC_HISTORY_PANEL_OK: empty/legacy state, newest-first/cap, timestamps/duration/status/counts/AI, safe text, collapsed stages/errors, disclosure retention, real renderAll/load refresh and no new requests')
