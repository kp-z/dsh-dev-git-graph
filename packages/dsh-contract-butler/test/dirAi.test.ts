/**
 * 目录级 AI 中文。
 *
 * 这里压三件事：
 * 1) **目录口径**必须和面板逐字一致——`src/hooks` / `（根目录）` / `（运行时）`。两边一旦分叉，
 *    面板按 path 查表就永远查不到，用户看到的是"生成了但没显示"。
 * 2) **中文只能来自模型**：校验不过就整批拒绝、记进 missing，绝不本地编一句顶上去。
 * 3) **指纹**：成员没变就不该再问一遍（省时间也省钱）；成员的中文变了就得重问。
 *
 * 刻意不起宿主：`understandDirs` 只依赖"一张表 + 一个 caller"，用内存表就能把它压到底；
 * 路由那一段是接线，照 `generate.test.ts` 的老办法直接读源码断言。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  buildDirPromptParts,
  dirHashOf,
  dirNameOf,
  groupByDir,
  kindOfContract,
  understandDirs,
  validateDirGraph,
  validateDirPayload,
} from '../lib/dirAi.js'
import type { ContractRecord, DirAiRecord } from '../lib/types.js'
import type { TableLike } from '../lib/store.js'

/* ---------- 内存表：与宿主那张表同面（get / entries / put / update） ---------- */
function memoryTable<T>(): TableLike<T> & { dump: () => T[] } {
  const map = new Map<string, T>()
  return {
    get: (key: string) => map.get(key),
    entries: () => map.entries(),
    keys: () => map.keys(),
    get size() {
      return map.size
    },
    put: async (key: string, value: T) => {
      map.set(key, value)
    },
    delete: async (key: string) => map.delete(key),
    update: async (key: string, fn: (record: T) => T) => {
      const current = map.get(key)
      if (current === undefined) throw new Error(`没有这一行：${key}`)
      const next = fn(current)
      map.set(key, next)
      return next
    },
    dump: () => [...map.values()],
  }
}

/** 一个契约的最小样子：只有分组与种子要用的那几项。 */
function contract(id: string, file: string, extras: Partial<ContractRecord> = {}): ContractRecord {
  return {
    id,
    projectId: 'p1',
    file,
    symbol: id,
    title: id,
    kind: 'function',
    boundaryKind: 'module',
    ...extras,
  } as ContractRecord
}

/* ---------- 1) 口径 ---------- */

test('目录口径：两段以上取父目录，根目录与运行时各有一支', () => {
  assert.equal(dirNameOf('src/hooks/useX.ts'), 'src/hooks')
  assert.equal(dirNameOf('src/a/b/c.ts'), 'src/a/b')
  assert.equal(dirNameOf('shop.proto'), '（根目录）')
  assert.equal(dirNameOf(''), '（运行时）')
  assert.equal(dirNameOf('(generated)/x.ts'), '（运行时）')
})

test('分组：一个目录一组，目录顺序稳定', () => {
  const grouped = groupByDir([
    contract('c1', 'src/hooks/useX.ts'),
    contract('c2', 'src/hooks/useY.ts'),
    contract('c3', 'shop.proto'),
  ])
  assert.deepEqual([...grouped.keys()], ['src/hooks', '（根目录）'])
  assert.equal(grouped.get('src/hooks')?.length, 2)
  assert.equal(grouped.get('（根目录）')?.length, 1)
})

/* ---------- 2) 校验：不合格就整批拒绝 ---------- */

const GOOD = { dirs: [{ path: 'src/hooks', title: '钩子集合', note: '放各处复用的 React 钩子' }] }

test('校验：合格就放行，原样给出中文', () => {
  const checked = validateDirPayload(JSON.stringify(GOOD), ['src/hooks'])
  assert.equal(checked.ok, true)
  if (checked.ok) {
    assert.deepEqual(checked.items, [
      { path: 'src/hooks', title: '钩子集合', note: '放各处复用的 React 钩子', graph: '' },
    ])
  }
})

test('校验：缺一个目录 → 整批拒绝（不补、不猜）', () => {
  const checked = validateDirPayload(JSON.stringify(GOOD), ['src/hooks', 'src/store'])
  assert.equal(checked.ok, false)
  if (!checked.ok) assert.match(checked.why, /没给/)
})

test('校验：多出没请求的目录 → 拒绝（那是模型在编目录）', () => {
  const bad = { dirs: [...GOOD.dirs, { path: 'src/编的', title: '编的目录', note: '这条根本不在请求里' }] }
  const checked = validateDirPayload(JSON.stringify(bad), ['src/hooks'])
  assert.equal(checked.ok, false)
  if (!checked.ok) assert.match(checked.why, /不在这一批里/)
})

test('校验：全英文的 title / 过长的 note → 拒绝', () => {
  const ascii = { dirs: [{ path: 'src/hooks', title: 'hooks', note: '放各处复用的 React 钩子' }] }
  assert.equal(validateDirPayload(JSON.stringify(ascii), ['src/hooks']).ok, false)
  const long = { dirs: [{ path: 'src/hooks', title: '钩子集合', note: '一'.repeat(41) }] }
  assert.equal(validateDirPayload(JSON.stringify(long), ['src/hooks']).ok, false)
})

test('校验：不是 JSON / 不是对象 / 没有 dirs 数组 → 拒绝', () => {
  assert.equal(validateDirPayload('模型今天不想干活', ['src/hooks']).ok, false)
  assert.equal(validateDirPayload('[]', ['src/hooks']).ok, false)
  assert.equal(validateDirPayload(JSON.stringify({ items: [] }), ['src/hooks']).ok, false)
})

/* ---------- 3) 一轮跑完：分批、写回、缓存、指纹 ---------- */

function mount(): { table: ReturnType<typeof memoryTable<DirAiRecord>>; store: { dirAi: () => TableLike<DirAiRecord> } } {
  const table = memoryTable<DirAiRecord>()
  return { table, store: { dirAi: () => table } }
}

/** 照着请求里的 path 回中文：模型"看懂了"的样子。 */
function echoingCaller(state: { calls: number; drop?: string }): (turn: { system: string; user: string }) => Promise<{ text: string; channel: string; ms: number }> {
  return async (turn) => {
    state.calls += 1
    const parsed = JSON.parse(turn.user) as { dirs: { path: string }[] }
    const dirs = parsed.dirs
      .filter((item) => item.path !== state.drop)
      .map((item) => ({ path: item.path, title: '某处职责', note: '这个目录放的是这一类东西' }))
    return { text: JSON.stringify({ dirs }), channel: 'skynet · fake-model', ms: 1 }
  }
}

test('一轮跑完：按批问、逐行写回，指纹随成员变', async () => {
  const { table, store } = mount()
  const contracts = [
    contract('c1', 'src/hooks/useX.ts'),
    contract('c2', 'src/hooks/useY.ts'),
    contract('c3', 'src/store/a.ts'),
    contract('c4', 'shop.proto'),
  ]
  const state = { calls: 0 }
  const first = await understandDirs({
    store: store as never,
    projectId: 'p1',
    contracts,
    caller: echoingCaller(state) as never,
    batchSize: 2,
  })
  assert.equal(first.generated, 3, '三个目录都该有中文')
  assert.equal(first.cached, 0)
  assert.equal(first.failed, 0)
  assert.equal(state.calls, 2, '三个目录、每批两个 → 两批')
  assert.equal(table.size, 3)
  assert.ok(first.dirs.every((row) => row.titleZh.length > 0 && row.noteZh.length > 0))

  /* 再跑一次：指纹没变 → 一行都不该再问。 */
  const second = await understandDirs({
    store: store as never,
    projectId: 'p1',
    contracts,
    caller: echoingCaller(state) as never,
    batchSize: 2,
  })
  assert.equal(second.cached, 3)
  assert.equal(second.generated, 0)
  assert.equal(state.calls, 2, '缓存命中就不该再问模型')

  /* 成员的中文变了 → 只重问那一个目录。 */
  const afterAi = contracts.map((item) => (item.id === 'c1' ? { ...item, aiTitle: '取数的钩子' } : item))
  const third = await understandDirs({
    store: store as never,
    projectId: 'p1',
    contracts: afterAi,
    caller: echoingCaller(state) as never,
    batchSize: 2,
  })
  assert.equal(third.generated, 1, '只有变过的那一个目录重问')
  assert.equal(third.cached, 2)
  assert.equal(state.calls, 3)
})

test('模型漏给一个目录 → 那一批整批拒绝，记进 missing，零写回', async () => {
  const { table, store } = mount()
  const contracts = [contract('c1', 'src/hooks/useX.ts'), contract('c3', 'src/store/a.ts')]
  const state = { calls: 0, drop: 'src/store' }
  const summary = await understandDirs({
    store: store as never,
    projectId: 'p1',
    contracts,
    caller: echoingCaller(state) as never,
    batchSize: 8,
  })
  assert.equal(summary.generated, 0)
  assert.equal(summary.failed, 1)
  assert.deepEqual(summary.missing, ['src/hooks', 'src/store'], '整批拒绝时两个目录都算没成')
  assert.equal(table.size, 0, '不写半批：宁缺勿假')
})

test('force：忽略缓存，全部重问', async () => {
  const { store } = mount()
  const contracts = [contract('c1', 'src/hooks/useX.ts')]
  const state = { calls: 0 }
  await understandDirs({ store: store as never, projectId: 'p1', contracts, caller: echoingCaller(state) as never })
  const forced = await understandDirs({
    store: store as never,
    projectId: 'p1',
    contracts,
    caller: echoingCaller(state) as never,
    force: true,
  })
  assert.equal(forced.generated, 1)
  assert.equal(forced.cached, 0)
  assert.equal(state.calls, 2)
})

test('指纹只看成员与成员的中文', () => {
  const a = [contract('c1', 'src/x.ts')]
  const same = [contract('c1', 'src/x.ts')]
  const other = [contract('c1', 'src/x.ts', { symbol: '别的名字' })]
  assert.equal(dirHashOf('src', a), dirHashOf('src', same))
  assert.notEqual(dirHashOf('src', a), dirHashOf('src', other))
  assert.notEqual(dirHashOf('src', a), dirHashOf('src2', a))
})

/* ---------- 4) 路由接线（读源码：起宿主压不到这一层） ---------- */

test('路由接线：/dirs 只读出口、/understand 里目录那轮要点名才跑、响应带目录计数', () => {
  const src = fs.readFileSync(
    path.resolve(fileURLToPath(new URL('..', import.meta.url)), 'src', 'index.ts'),
    'utf8',
  )
  assert.ok(src.includes("path: '/dirs'"), '要有 GET /dirs')
  assert.ok(src.includes('current.dirAi().entries()'), '/dirs 从 dir_ai 表里读')
  assert.ok(src.includes('input.dirAi === true'), '目录那轮默认不跑，面板点名才跑（否则会多问模型）')
  assert.ok(src.includes('dirs: dirSummary'), '/understand 的响应里要带目录计数')
  assert.ok(src.includes('graphFailed: dirResult.graphFailed'), '图没画成也要如实上报，不能只说"补了中文"')
  assert.ok(src.includes("stage: 'dirs'"), '目录那轮要有自己的进度事件')
})

/* ---------- 5) 目录图上的实体关系边 ---------- */

function panelSource(): string {
  return fs.readFileSync(path.resolve(fileURLToPath(new URL('..', import.meta.url)), 'src', 'panel.html'), 'utf8')
}

type RelEdge = { from: string; to: string; rel: string; why: string; cross?: boolean }
type RelStat = { edges: RelEdge[]; total: number; undrawn: number; self: number; cross: number; hidden: number }

/** `dirRelEdges` 是纯函数（不碰 DOM），把源码抽出来在页面外直接量它。 */
function dirRelEdgesOf(): (drawn: unknown[], relsOf: (cid: string) => unknown, max?: number) => RelStat {
  const html = panelSource()
  const start = html.indexOf('function dirRelEdges')
  const end = html.indexOf('function dirGraphIR')
  assert.ok(start > 0 && end > start, '应当能从面板源码里取出 dirRelEdges 这一段')
  return new Function(html.slice(start, end) + '; return dirRelEdges')() as never
}

const DRAWN = [
  { nid: 'p0', cid: 'c1', band: 'dom0' },
  { nid: 'p1', cid: 'c2', band: 'dom1' },
  { nid: 'p2', cid: 'c3', band: 'dom0' },
]

test('关系边：两端都画出来才画，跨目录的标出来', () => {
  const fn = dirRelEdgesOf()
  const stat = fn(DRAWN, (cid) => (cid === 'c1' ? [{ to: 'c2', rel: 'imports', why: '调用了对方' }] : []))
  assert.equal(stat.edges.length, 1)
  assert.equal(stat.cross, 1, 'c1 与 c2 不在同一条带上')
  assert.deepEqual(
    { from: stat.edges[0]?.from, to: stat.edges[0]?.to, rel: stat.edges[0]?.rel },
    { from: 'p0', to: 'p1', rel: 'imports' },
  )
})

test('关系边：另一端没抽到图上 → 记一笔，不画半条边', () => {
  const fn = dirRelEdgesOf()
  const stat = fn(DRAWN, (cid) => (cid === 'c1' ? [{ to: 'c9', rel: 'emits' }] : []))
  assert.equal(stat.edges.length, 0)
  assert.equal(stat.undrawn, 1)
  assert.equal(stat.total, 1)
})

test('关系边：同一条关系说两遍只画一条，理由合并；自指不算边', () => {
  const fn = dirRelEdgesOf()
  const twice = fn(DRAWN, (cid) => (cid === 'c1'
    ? [{ to: 'c2', rel: 'imports', why: '甲' }, { to: 'c2', rel: 'imports', why: '乙' }]
    : []))
  assert.equal(twice.edges.length, 1)
  assert.equal(twice.edges[0]?.why, '甲；乙')
  const self = fn(DRAWN, (cid) => (cid === 'c1' ? [{ to: 'c1', rel: 'contains' }] : []))
  assert.equal(self.edges.length, 0)
  assert.equal(self.self, 1)
})

test('关系边：太密时先留跨目录的，并如实报出没画多少', () => {
  const fn = dirRelEdgesOf()
  const stat = fn(DRAWN, (cid) => (cid === 'c1'
    ? [{ to: 'c3', rel: 'imports' }, { to: 'c2', rel: 'emits' }, { to: 'c2', rel: 'defines' }]
    : []), 2)
  assert.equal(stat.edges.length, 2)
  assert.equal(stat.hidden, 1, '三条里只画了两条')
  assert.ok(stat.edges.some((edge) => edge.cross === true), '跨目录的那条要留下')
})

test('关系边：没跑过 AI（没有 aiRelations）就一条都不画，也不编', () => {
  const fn = dirRelEdgesOf()
  const stat = fn(DRAWN, () => undefined)
  assert.deepEqual({ edges: stat.edges.length, total: stat.total, undrawn: stat.undrawn }, { edges: 0, total: 0, undrawn: 0 })
})

test('目录图接线：关系边进 IR、说明里报口径、开关能关掉', () => {
  const html = panelSource()
  assert.ok(html.includes('function dirRelEdges'), '关系边的算法要在')
  assert.ok(html.includes('relStat.edges.forEach(function (e) { ir.edges.push(e); })'), '关系边要进 IR')
  assert.ok(html.includes("S.dirRel !== false && drawn.length > 1"), '关掉时一条都不画；只有一个节点时也不用算')
  assert.ok(html.includes('关系画了 '), '说明里要说画了几条（含跨目录与没画的）')
  assert.ok(html.includes('chip chip-tog'), '要有能关掉关系边的开关')
  assert.ok(html.includes('var G_RELEDGE_MAX'), '太密时的上限要有明确定义')
  /* 只抽"每条带露一条"的话，真实项目里关系几乎全落在"另一端没抽到图上" —— 那等于没展示关系。 */
  assert.ok(html.includes('邻居补位'), '挑节点时要把关系对端也抽进来')
  assert.ok(html.includes('再把关系对端补进来'), '说明里要如实交代挑选方式变了')
  assert.ok(html.includes('(nameOf[l.from] || l.from)'), '边的提示要说人话（实体名，不是 p0 → p1）')
  /* 关系边只加在目录图上：形状图那侧不许被带下去（它画的是字段之间）。 */
  const shape = html.indexOf('function shapeGraphIR')
  const shapeEnd = html.indexOf('function enumGraphIR')
  assert.ok(shape > 0 && shapeEnd > shape)
  assert.ok(!html.slice(shape, shapeEnd).includes('dirRelEdges'), '形状图不掺和目录图的关系边')
})


/* ---------- 6) AI 自己写的 Mermaid 图 ---------- */

const GRAPH_OK = [
  'flowchart LR',
  'c1["useX"]:::protocol',
  'c2["useY"]:::protocol',
  'c1-->|imports|c2',
].join('\n')

/** 两个实体、一条关系的目录：AI 要照着这个写图。 */
function graphDir(): ContractRecord[] {
  return [
    contract('c1', 'src/hooks/useX.ts', {
      input: { kind: 'object' } as never,
      output: { kind: 'object' } as never,
      aiRelations: [{ to: 'c2', rel: 'imports', why: '调用了 useY' }] as never,
    }),
    contract('c2', 'src/hooks/useY.ts', {
      input: { kind: 'object' } as never,
      output: { kind: 'object' } as never,
    }),
  ]
}

test('节点类型：口径与面板的 protocolKindOf 一致', () => {
  assert.equal(kindOfContract(contract('c1', 'a.ts')), 'gap', '没有形状就是缺口')
  assert.equal(kindOfContract(contract('c1', 'a.ts', {
    input: { kind: 'unknown' } as never,
    output: { kind: 'unknown' } as never,
  })), 'gap', '两边都读不动也是缺口')
  assert.equal(kindOfContract(contract('c1', 'a.ts', { input: { kind: 'object' } as never })), 'protocol')
})

test('图校验：空的就认（没什么可画的），合格的原样放行', () => {
  const allowed = new Set(['c1', 'c2'])
  const declared = new Set(['c1\u0000imports\u0000c2'])
  const kindOf = (id: string) => (allowed.has(id) ? 'protocol' : '')
  assert.deepEqual(validateDirGraph('', allowed, kindOf, declared), { ok: true, nodes: 0, edges: 0 })
  const good = validateDirGraph(GRAPH_OK, allowed, kindOf, declared)
  assert.equal(good.ok, true)
  if (good.ok) assert.deepEqual({ nodes: good.nodes, edges: good.edges }, { nodes: 2, edges: 1 })
})

test('图校验：首行不对 / 编契约 / 类型标错 / 编关系 / 看不懂的行 → 全拒', () => {
  const allowed = new Set(['c1', 'c2'])
  const declared = new Set(['c1\u0000imports\u0000c2'])
  const kindOf = (id: string) => (allowed.has(id) ? 'protocol' : '')
  const bad = (text: string) => {
    const checked = validateDirGraph(text, allowed, kindOf, declared)
    assert.equal(checked.ok, false, `这段本该被拒：${text}`)
    return checked.ok === false ? checked.why : ''
  }
  assert.match(bad('graph LR\nc1["a"]:::protocol'), /flowchart/)
  assert.match(bad('flowchart LR\nc9["编的"]:::protocol'), /不在这个目录/)
  assert.match(bad('flowchart LR\nc1["a"]:::gap'), /其实是 protocol/)
  assert.match(bad('flowchart LR\nc1["a"]:::protocol\nc2["b"]:::protocol\nc1-->|emits|c2'), /不在给定的关系里/)
  /* subgraph 现在允许一层（AI 可以按模块/模型分组），但必须闭合、不许嵌套、不许和实体撞名。 */
  assert.match(bad('flowchart LR\nc1["a"]:::protocol\nc2["b"]:::protocol\nsubgraph g["组"]'), /没有 end 关闭/)
  assert.match(bad('flowchart LR\nc1["a"]:::protocol\nc1["b"]:::protocol'), /声明了两遍/)
})

test('提示词：实体要带 id 与类型，关系要给全（边只能从这里面挑）', () => {
  const dirs = graphDir()
  const parts = buildDirPromptParts(['src/hooks'], new Map([['src/hooks', dirs]]), (c) => c.aiRelations ?? [])
  const parsed = JSON.parse(parts.user) as {
    dirs: { path: string; members: { id: string; kind: string }[]; relations: { from: string; rel: string; to: string; why?: string }[] }[]
  }
  const one = parsed.dirs[0]
  assert.equal(one?.path, 'src/hooks')
  assert.deepEqual(one?.members.map((m) => [m.id, m.kind]), [['c1', 'protocol'], ['c2', 'protocol']])
  assert.deepEqual(one?.relations, [{ from: 'c1', rel: 'imports', to: 'c2', why: '调用了 useY' }])
  assert.ok(parts.system.includes('flowchart LR'), '系统提示里要写清图怎么画')
})

/** 照请求回中文，并且顺手写一张合格的图。 */
function graphingCaller(state: { calls: number; graph?: string }) {
  return async (turn: { system: string; user: string }) => {
    state.calls += 1
    const parsed = JSON.parse(turn.user) as { dirs: { path: string; members: { id: string; kind: string }[]; relations: { from: string; rel: string; to: string }[] }[] }
    const dirs = parsed.dirs.map((dir) => {
      const lines = ['flowchart LR']
      dir.members.forEach((m) => lines.push(`${m.id}["${m.id}"]:::${m.kind}`))
      dir.relations.forEach((r) => lines.push(`${r.from}-->|${r.rel}|${r.to}`))
      return { path: dir.path, title: '钩子集合', note: '放各处复用的钩子', graph: state.graph ?? lines.join('\n') }
    })
    return { text: JSON.stringify({ dirs }), channel: 'skynet · fake-model', ms: 1 }
  }
}

test('存图：AI 给的图合格就写进这一行，再跑一次连图一起命中缓存', async () => {
  const { table, store } = mount()
  const contracts = graphDir()
  const state: { calls: number; graph?: string } = { calls: 0 }
  const first = await understandDirs({ store: store as never, projectId: 'p1', contracts, caller: graphingCaller(state) as never })
  assert.equal(first.generated, 1)
  assert.equal(first.graphFailed, 0)
  const row = table.dump()[0]
  assert.ok(row?.mermaid && row.mermaid.includes('c1-->|imports|c2'), '图要原样存下来')

  const second = await understandDirs({ store: store as never, projectId: 'p1', contracts, caller: graphingCaller(state) as never })
  assert.equal(second.cached, 1, '中文与图都在，就该一个请求都不发')
  assert.equal(state.calls, 1)
})

test('图不合格：留中文、不存图、如实计数，并且下次还会重问', async () => {
  const { table, store } = mount()
  const contracts = graphDir()
  const state = { calls: 0, graph: 'flowchart LR\nc1["x"]:::protocol\nc2["y"]:::protocol\nc1-->|emits|c2' }
  const first = await understandDirs({ store: store as never, projectId: 'p1', contracts, caller: graphingCaller(state) as never })
  assert.equal(first.generated, 1, '中文是好的，不该连中文一起丢')
  assert.equal(first.graphFailed, 1)
  assert.equal(table.dump()[0]?.titleZh, '钩子集合')
  assert.equal(table.dump()[0]?.mermaid, undefined, '没产出图就不许有图')

  /* 没有图的行不算命中：否则这一行会永远没有图。 */
  const again = await understandDirs({ store: store as never, projectId: 'p1', contracts, caller: graphingCaller(state) as never })
  assert.equal(again.cached, 0)
  assert.equal(state.calls, 2)
})

test('面板接线：AI 图优先渲染，读不动就退回分区图并把原因写出来', () => {
  const html = panelSource()
  assert.ok(html.includes('parseMermaidGraph(dai.mermaid)'), '目录视图要拿 AI 给的图去解析')
  assert.ok(html.includes('这张图是 AI 画的（Mermaid）'), '要交代这张图是谁画的')
  assert.ok(html.includes('AI 给的图读不动'), '解析不过要说明原因，不能静默换图')
  assert.ok(html.includes('function pickContractNode'), '点节点定位契约要提成同一个函数，两条路都用它')
  assert.equal((html.match(/pick: pickContractNode/g) ?? []).length, 2, '两张图（AI 图与分区图）都用它')
  assert.ok(html.includes("n.contractId = n.id"), '解析出来的节点要挂回契约才能点')
  assert.ok(html.includes("whyOf[e.from + '>' + e.rel + '>' + e.to]"), '关系的理由要从 aiRelations 找回来给悬浮提示')
})


test('图校验：允许一层 subgraph 分组，组名要中文、要闭合', () => {
  const allowed = new Set(['c1', 'c2'])
  const declared = new Set(['c1\u0000imports\u0000c2'])
  const kindOf = () => 'protocol'
  const grouped = [
    'flowchart LR',
    'subgraph g1["按模块"]',
    'c1["a"]:::protocol',
    'c2["b"]:::protocol',
    'end',
    'c1-->|imports|c2',
  ].join('\n')
  const ok = validateDirGraph(grouped, allowed, kindOf, declared)
  assert.equal(ok.ok, true, ok.ok === false ? ok.why : '')
  const bad = (text: string) => {
    const checked = validateDirGraph(text, allowed, kindOf, declared)
    return checked.ok === false ? checked.why : ''
  }
  assert.match(bad('flowchart LR\nsubgraph g1[""]'), /分组名要在 1-20 字之间/)
  assert.match(bad('flowchart LR\nsubgraph g1["名字很长很长很长很长很长很长很长很长很长很长很长"]'), /分组名要在 1-20 字之间/)
  assert.match(bad('flowchart LR\nsubgraph c1["跟实体撞名"]'), /已经是个实体了/)
})

test('样式：五种关系各有各的线型，不只靠颜色区分', () => {
  const html = panelSource()
  assert.ok(html.includes('var REL_REGISTRY = {'), '关系的样式要有一处登记表')
  assert.equal(html.includes('G_RELCOLOR'), false, '旧的硬编码色板要清掉，颜色只留一处定义')
  const box = html.slice(html.indexOf('var REL_REGISTRY = {'), html.indexOf('var G_RELORDER'));
  const rels = ['contains', 'imports', 'emits', 'defines', 'missing']
  const dashes = rels.map((rel) => {
    const at = box.indexOf(rel + ': {')
    assert.ok(at > 0, `登记表里要有 ${rel}`)
    const line = box.slice(at, box.indexOf('}', at))
    return line
  })
  assert.equal(new Set(dashes).size, 5, '五种关系的画法要各不相同')
  assert.ok(dashes.every((line) => line.includes('hue:') && line.includes('w:')), '每种关系都要有颜色和粗细')
  assert.ok(html.includes('relStyle(path, l.rel)'), '边要走登记表上样式')
  assert.ok(html.includes('pth.style.fill = relReg(rel).hue'), '箭头也要同色')
})

test('样式：数据来源与数据类型各带标签，判据是文件与形状本身', () => {
  const html = panelSource()
  assert.ok(html.includes('var MODEL_REGISTRY = {'), '数据来源要有登记表')
  assert.ok(html.includes('var DTYPE_REGISTRY = {'), '数据类型要有登记表')
  /* 判据是确定性事实：文件扩展名 / 形状的 kind，不问模型 */
  assert.ok(html.includes("/\\.proto$/"), 'proto 按扩展名判')
  assert.ok(html.includes('function modelOf(contract)'), '来源从契约的文件名算')
  assert.ok(html.includes('function dtypeOf(node)'), '类型从形状节点算')
  assert.ok(html.includes("n.model = modelOf(hit.contract)"), 'AI 图上的节点也要标来源')
  assert.ok(html.includes('pn.model = modelOf(c)'), '分区图上的节点也要标来源')
  assert.ok(html.includes('dtypeOf(f.node)'), '形状图的字段要标数据类型')
  assert.ok(html.includes("class: 'gmodel m-'"), '标签要画在卡片上')
  assert.ok(html.includes("class: 'gdtype t-'"), '类型标签要画在卡片上')
})

test('图例：只标图上真画了的东西，与卡片同源', () => {
  const html = panelSource()
  assert.ok(html.includes('function gLegend(ir)'), '要有图例')
  const box = html.slice(html.indexOf('function gLegend(ir)'), html.indexOf('function renderGraph(ir, opts)'))
  assert.ok(box.includes('ir.nodes.forEach'), '节点类型从图上的节点里取')
  assert.ok(box.includes('ir.edges.forEach'), '关系从图上的边里取 —— 没画的关系不许列进图例')
  assert.ok(box.includes("class: 'gmodel m-'") && box.includes("class: 'gdtype t-'"), '图例里的标签与卡片同一套样式')
  assert.ok(box.includes('relReg(rel)'), '图例里的线段与边同一套样式')
  assert.ok(html.includes('var legend = gLegend(capped.ir)'), '图例挂在图后面')
})
