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
import { dirHashOf, dirNameOf, groupByDir, understandDirs, validateDirPayload } from '../lib/dirAi.js'
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
  if (checked.ok) assert.deepEqual(checked.items, [{ path: 'src/hooks', title: '钩子集合', note: '放各处复用的 React 钩子' }])
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
  assert.ok(src.includes("stage: 'dirs'"), '目录那轮要有自己的进度事件')
})