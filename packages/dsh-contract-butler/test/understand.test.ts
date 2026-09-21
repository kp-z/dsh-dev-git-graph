import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  applyAiItems,
  buildPrompt,
  contentHash,
  seedFieldNames,
  understand,
  validateAiPayload,
  type AiItem,
  type ContractSeed,
} from '../src/understand.ts'
import { fieldsFromPrompt } from './aiFixture.ts'

const seeds: ContractSeed[] = [
  { id: 'c1', name: 'ContractRecord', file: 'src/store.ts', fields: ['id', 'title', 'file'] },
  { id: 'c2', name: 'ToolLike', file: 'src/extract.ts', fields: ['name', 'description'] },
  { id: 'c3', name: 'RefResolver', file: 'src/extract.ts', fields: ['resolve'] },
]

/**
 * 字段级的"合同"：这一批每条契约有哪些字段。
 *
 * 直接从种子算（`seedFieldNames`），而不是手抄一份——引擎那一侧就是这么算的，抄一份就会分叉。
 */
const fieldContract = new Map<string, readonly string[]>(
  seeds.slice(0, 2).map((seed) => [seed.id, seedFieldNames(seed)] as const),
)

/** 一条契约的三条字段中文（c1 的种子里正好是这三个）。 */
const c1Fields = [
  { name: 'id', zh: '标识' },
  { name: 'title', zh: '标题' },
  { name: 'file', zh: '来源文件' },
]

test('校验：id 不在本批 → 整批拒绝', () => {
  const res = validateAiPayload({ items: [{ id: 'c9', titleZh: '外来者' }] }, ['c1', 'c2'])
  assert.equal(res.ok, false)
  if (!res.ok) assert.match(res.why, /不属于本批/)
})

test('校验：关系词非法 → 拒绝', () => {
  const res = validateAiPayload(
    { items: [{ id: 'c1', titleZh: '契约记录', relations: [{ to: 'c2', rel: 'depends-on' }] }] },
    ['c1', 'c2'],
  )
  assert.equal(res.ok, false)
  if (!res.ok) assert.match(res.why, /关系不合法/)
})

test('校验：关系指向本批之外 → 拒绝', () => {
  const res = validateAiPayload(
    { items: [{ id: 'c1', titleZh: '契约记录', relations: [{ to: 'c7', rel: 'imports' }] }] },
    ['c1', 'c2'],
  )
  assert.equal(res.ok, false)
})

test('校验：标题带 HTML 或为空 → 拒绝', () => {
  assert.equal(validateAiPayload({ items: [{ id: 'c1', titleZh: '<b>契约</b>' }] }, ['c1']).ok, false)
  assert.equal(validateAiPayload({ items: [{ id: 'c1', titleZh: '   ' }] }, ['c1']).ok, false)
})

test('校验：合法返回被接受，并带上族名与关系', () => {
  const res = validateAiPayload(
    {
      items: [
        { id: 'c1', titleZh: '契约记录 · 一条契约的定义', family: '契约存储', relations: [{ to: 'c2', rel: 'defines', why: '定义了工具形状' }] },
      ],
    },
    ['c1', 'c2'],
  )
  assert.equal(res.ok, true)
  if (res.ok) {
    assert.equal(res.items[0]?.family, '契约存储')
    assert.equal(res.items[0]?.relations?.[0]?.rel, 'defines')
  }
})

/* ---------- 字段级中文：种子里每个字段都得有一条中文 ---------- */

test('校验：一条契约少一个字段 → 整批拒绝（半份字段中文比没有更糟）', () => {
  const res = validateAiPayload(
    {
      items: [
        { id: 'c1', titleZh: '契约记录', fields: c1Fields },
        /* c2 只答了 name：种子里还有 description。整批都该被拒，而不是"就那一条没中文"。 */
        { id: 'c2', titleZh: '工具形状', fields: [{ name: 'name', zh: '名字' }] },
      ],
    },
    ['c1', 'c2'],
    { seedFields: fieldContract },
  )
  assert.equal(res.ok, false, '一条不合格 → 整批不合格')
  if (!res.ok) {
    assert.match(res.why, /c2/, '要说清是哪条契约')
    /* 原因得点名缺的是哪个字段——只回一句"字段不齐"，人就不知道该去补哪一条。 */
    assert.match(res.why, /c2 的字段 description 缺少中文解释/)
  }
})

test('校验：字段条目在但 zh 是空的 / 干脆没写 zh / 整份没写 fields → 一律拒绝，并点名那个字段', () => {
  const cases: { name: string; fields: unknown; want: RegExp }[] = [
    { name: 'zh 是空串', fields: [{ name: 'id', zh: '标识' }, { name: 'title', zh: '标题' }, { name: 'file', zh: '   ' }], want: /字段 file 的 zh 为空/ },
    { name: '条目里没有 zh', fields: [{ name: 'id', zh: '标识' }, { name: 'title', zh: '标题' }, { name: 'file' }], want: /字段 file 的 zh 为空/ },
    /* 整份没写：按种子的顺序报第一个缺的，不能只说一句"字段不齐"。 */
    { name: '整份没写 fields', fields: undefined, want: /字段 id 缺少中文解释/ },
  ]
  for (const item of cases) {
    const res = validateAiPayload({ items: [{ id: 'c1', titleZh: '契约记录', fields: item.fields }] }, ['c1'], {
      seedFields: fieldContract,
    })
    assert.equal(res.ok, false, item.name)
    if (!res.ok) assert.match(res.why, item.want, `${item.name}：原因要点名缺的是哪个字段，实际是 ${res.why}`)
  }
})

test('校验：编一个种子里没有的字段 → 拒绝（那是模型在编字段）', () => {
  const res = validateAiPayload(
    { items: [{ id: 'c1', titleZh: '契约记录', fields: [...c1Fields, { name: '不存在的字段', zh: '中文' }] }] },
    ['c1'],
    { seedFields: fieldContract },
  )
  assert.equal(res.ok, false)
  if (!res.ok) {
    assert.match(res.why, /不存在的字段/)
    assert.match(res.why, /不在种子给出的字段里/)
  }
})

test('校验：字段中文不含中文 → 拒绝（要的是中文解释，不是字段名的音译）', () => {
  const payload = {
    items: [{ id: 'c1', titleZh: '契约记录', fields: [{ name: 'id', zh: 'identifier' }, { name: 'title', zh: 'title' }, { name: 'file', zh: 'file' }] }],
  }
  /* 口径由调用方给：没要求中文时英文也收（默认全关，不改单测里直接调校验器的老语义）。 */
  assert.equal(validateAiPayload(payload, ['c1'], { seedFields: fieldContract }).ok, true)
  const strict = validateAiPayload(payload, ['c1'], { seedFields: fieldContract, requireChinese: true })
  assert.equal(strict.ok, false)
  if (!strict.ok) assert.match(strict.why, /字段 id 的 zh 不含中文/)
})

test('校验：字段中文齐了就通过，并按种子的顺序写回（重复也算不合格）', () => {
  const res = validateAiPayload(
    {
      items: [
        {
          id: 'c1',
          titleZh: '契约记录',
          /* 故意乱序：写回的顺序跟种子走，不跟模型的顺序走。 */
          fields: [{ name: 'file', zh: '来源文件' }, { name: 'id', zh: '标识' }, { name: 'title', zh: '标题' }],
        },
      ],
    },
    ['c1'],
    { seedFields: fieldContract },
  )
  assert.equal(res.ok, true)
  if (res.ok) assert.deepEqual(res.items[0]?.fields, c1Fields, '顺序是种子的：id / title / file')

  /* 同一个字段名出现两次：渲染时不知道该用哪句中文，照样是整批拒绝。 */
  const twice = validateAiPayload(
    { items: [{ id: 'c1', titleZh: '契约记录', fields: [{ name: 'id', zh: '标识' }, { name: 'id', zh: '又一个标识' }] }] },
    ['c1'],
    { seedFields: fieldContract },
  )
  assert.equal(twice.ok, false)
  if (!twice.ok) assert.match(twice.why, /重复出现/)
})

test('校验：种子里没有字段（占位行）→ 不写 fields 也算合格（要求就是"没有字段"）', () => {
  const none = seedFieldNames({ id: 'c0', name: 'X', file: 'a.ts', fields: ['（抽取器没有记录到字段）'] })
  assert.deepEqual(none, [], '占位行不是字段：否则没有字段的契约永远过不了这一关')
  const res = validateAiPayload({ items: [{ id: 'c0', titleZh: '没有字段的一条' }] }, ['c0'], {
    seedFields: new Map([['c0', none]]),
  })
  assert.equal(res.ok, true)
  if (res.ok) assert.equal(res.items[0]?.fields, undefined, '没有字段就别写这一项')
})

test('种子字段名：进来 / 出去 只说方向，裸名照收，两侧同名只算一个', () => {
  const of = (fields: string[]): string[] => seedFieldNames({ id: 'c1', name: 'X', file: 'a.ts', fields })
  assert.deepEqual(of(['进来 user_id:string（可缺省）', '出去 ok:boolean']), ['user_id', 'ok'], '前缀只说方向，不进球名')
  assert.deepEqual(of(['id']), ['id'], '裸名字也是字段')
  assert.deepEqual(of(['进来 id', '出去 id']), ['id'], '同一个字段名的两侧，一条中文就够')
})

test('理解：分批调用、写回缓存；第二次全部命中缓存不再问 AI', async () => {
  const cache = new Map<string, AiItem>()
  let calls = 0
  const caller = async (prompt: string, ids: readonly string[]) => {
    calls += 1
    /* 字段中文照提示词里给出的字段回一份：种子里的字段一个都不能少，少一个整批拒绝。 */
    const fields = fieldsFromPrompt(prompt)
    return { items: ids.map((id) => ({ id, titleZh: `中文职责 ${id}`, family: '测试族', fields: fields.get(id) ?? [] })) }
  }
  const first = await understand(seeds, { caller, cache, batchSize: 2 })
  assert.equal(first.ok, true)
  assert.equal(first.batches, 2, '三条 + 每批两条 = 两批')
  assert.equal(first.written, 3)
  assert.equal(first.cached, 0)
  assert.equal(calls, 2)

  const second = await understand(seeds, { caller, cache, batchSize: 2 })
  assert.equal(second.ok, true)
  assert.equal(second.cached, 3, '内容没变 → 全部命中缓存')
  assert.equal(second.asked, 0)
  assert.equal(calls, 2, '第二次没有再问 AI')
})

test('理解：内容变了才会重新问 AI', async () => {
  const cache = new Map<string, AiItem>()
  let calls = 0
  const caller = async (prompt: string, ids: readonly string[]) => {
    calls += 1
    /* 字段中文照提示词回：不合格的答案不写缓存，那样"只有变过的那条重新问"就测不出来了。 */
    const fields = fieldsFromPrompt(prompt)
    return { items: ids.map((id) => ({ id, titleZh: `职责 ${id}`, fields: fields.get(id) ?? [] })) }
  }
  const first = await understand(seeds, { caller, cache })
  assert.equal(first.ok, true)
  const changed: ContractSeed[] = [seeds[0] as ContractSeed, { ...(seeds[1] as ContractSeed), fields: ['name', 'description', 'parameters'] }]
  const second = await understand(changed, { caller, cache })
  assert.equal(second.ok, true)
  assert.equal(second.asked, 1, '没变的那条命中缓存，只有变过的那条要问')
  assert.equal(calls, 2, '只有变过的那条重新问')
})

test('理解：AI 返回不合格 → 停止且不写缓存、不补写', async () => {
  const cache = new Map<string, AiItem>()
  const res = await understand(seeds, {
    caller: async () => ({ items: [{ id: 'c1', titleZh: '契约记录', relations: [{ to: 'c2', rel: 'depends-on' }] }] }),
    cache,
    batchSize: 2,
  })
  assert.equal(res.ok, false)
  assert.equal(res.written, 0)
  assert.equal(cache.size, 0, '不合格不写缓存')
  assert.match(res.why ?? '', /关系不合法/)
})

test('写回：原始符号名不被覆盖，AI 结果作为附加字段', () => {
  const records = [{ id: 'c1', title: 'ContractRecord', kind: 'interface' }]
  const out = applyAiItems(records, [{ id: 'c1', titleZh: '契约记录 · 一条契约的定义', family: '契约存储' }])
  assert.equal(out[0]?.title, 'ContractRecord', '原始符号名保留')
  assert.equal(out[0]?.kind, 'interface')
  assert.equal(out[0]?.aiTitle, '契约记录 · 一条契约的定义')
  assert.equal(out[0]?.aiFamily, '契约存储')
})

test('提示词：只给事实，不含任何预设中文答案', () => {
  const p = buildPrompt(seeds)
  assert.ok(p.includes('ContractRecord') && p.includes('src/extract.ts'))
  assert.ok(!p.includes('契约记录'), '提示词里不许夹带现成中文职责')
  assert.ok(p.includes('titleZh'))
})

test('内容哈希：字段顺序无关以外的东西变了就变', () => {
  assert.equal(contentHash(seeds[0] as ContractSeed), contentHash({ ...(seeds[0] as ContractSeed) }))
  assert.notEqual(contentHash(seeds[0] as ContractSeed), contentHash({ ...(seeds[0] as ContractSeed), fields: ['id', 'title'] }))
})
