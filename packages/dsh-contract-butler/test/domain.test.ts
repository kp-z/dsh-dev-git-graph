/**
 * 存储域的契约测试：拿**真实**的 `@deepseek-ai/dsh-storage-domain` 来验。
 *
 * 这个文件存在的理由是一次真实的踩坑：记录 schema 必须用 **zod**（领域打开时会
 * `valueSchema.parse(raw)` 逐条校验），而我最初按 README 理解用了 schemastery；同时 zod
 * 会剥掉未声明的字段，导致记录里的 `id` 在落盘再读出后消失。这两个错都不会在类型层面报出来，
 * 只会在领域第一次打开时炸。
 *
 * 所以这里的断言刻意打在"真实现怎么用它"上，而不是"我的类型长什么样"。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { defineDomain as realDefineDomain, descriptorOf } from '@deepseek-ai/dsh-storage-domain'
import { defineDomain as inlineDefineDomain } from '../lib/spec.js'
import {
  CONTRACT_BUTLER_DOMAIN,
  aiSchema,
  changeSchema,
  contractSchema,
  decisionSchema,
  observationSchema,
  projectSchema,
  snapshotSchema,
} from '../lib/domain.js'

test('真实实现接受本插件的领域规格，并认出七张表', () => {
  // `defineDomain` 在模块加载时就已经跑过了（domain.ts 顶层调用），这里确认投影结果。
  const descriptor = descriptorOf(CONTRACT_BUTLER_DOMAIN)
  assert.equal(descriptor.name, 'contract_butler')
  assert.equal(descriptor.version, 1)
  assert.equal(descriptor.layout, 'single')
  assert.equal(descriptor.hasGlobal, false)
  assert.deepEqual(
    [...descriptor.tables].sort(),
    // `ai` 是 AI 理解结果的缓存表（跟着领域落盘）。加表**不动 version**：介质按这份清单逐张取，
    // 缺的那张初始化成空表，所以对已经在盘上的老数据是纯增量。
    ['ai', 'changes', 'contracts', 'decisions', 'observations', 'projects', 'snapshots'],
  )
  assert.equal(CONTRACT_BUTLER_DOMAIN.invalidRecords, 'backup-and-skip')
})

test('表 schema 是 zod：真实现调用的 parse / safeParse 都在', () => {
  for (const [name, schema] of Object.entries(CONTRACT_BUTLER_DOMAIN.tables)) {
    const valueSchema = schema.valueSchema as { parse?: unknown; safeParse?: unknown }
    assert.equal(typeof valueSchema.parse, 'function', `${name} 的 valueSchema 必须能 parse`)
    assert.equal(typeof valueSchema.safeParse, 'function', `${name} 的 valueSchema 必须能 safeParse`)
  }
})

test('每条记录都声明了自己的 id，落盘再读出不会丢', () => {
  const cases: { name: string; schema: { safeParse: (v: unknown) => { success: boolean } }; record: unknown }[] = [
    {
      name: 'projects',
      schema: projectSchema,
      record: {
        id: 'p_abc',
        root: '/tmp/x',
        title: 'demo',
        vcs: 'git',
        baselineSha: 'deadbeef',
        baselineHash: null,
        createdAt: 1,
        scannedAt: 2,
        scan: { excludeDirs: ['node_modules'], maxFiles: 2000 },
        include: ['c_1'],
      },
    },
    {
      name: 'contracts',
      schema: contractSchema,
      record: {
        id: 'c_abc',
        projectId: 'p_abc',
        file: 'proto/user.proto',
        boundary: 'proto:User',
        boundaryKind: 'proto',
        source: 'proto',
        title: 'User',
        symbol: 'User',
        input: null,
        output: { kind: 'object', fields: { id: { kind: 'string' } } },
        twins: [],
        evidence: { line: 3, hash: 'h' },
        confidence: 0.85,
        createdAt: 1,
        updatedAt: 1,
      },
    },
    {
      name: 'changes',
      schema: changeSchema,
      record: {
        id: 'ch_abc',
        projectId: 'p_abc',
        contractId: 'c_abc',
        sha: 'wt',
        at: 1,
        subject: '未提交的改动',
        kind: 'breaking',
        reasons: ['输出 $.name：字段被删除'],
        beforeHash: 'a>b',
        afterHash: 'c>d',
        createdAt: 1,
      },
    },
    {
      name: 'observations',
      schema: observationSchema,
      record: {
        id: 'ob_abc',
        projectId: 'p_abc',
        contractId: 'c_abc',
        at: 1,
        source: 'tools/result',
        subject: 'read_file',
        ok: false,
        reasons: ['参数.path：缺少声明的必填字段'],
        shapeHash: 'a>b',
        sample: '',
        bytes: 12,
      },
    },
    {
      name: 'decisions',
      schema: decisionSchema,
      record: {
        id: 'dc_abc',
        projectId: 'p_abc',
        targetKind: 'change',
        targetId: 'ch_abc',
        action: 'ack',
        by: 'local',
        at: 1,
        note: '',
      },
    },
    {
      name: 'snapshots',
      schema: snapshotSchema,
      record: {
        projectId: 'p_abc',
        contractId: 'c_abc',
        sha: 'deadbeef',
        at: 1,
        inputHash: '',
        outputHash: 'h',
        input: null,
        output: { kind: 'string' },
      },
    },
  ]

  for (const item of cases) {
    const parsed = item.schema.safeParse(item.record)
    assert.equal(parsed.success, true, `${item.name} 的合法记录应当通过`)
  }

  // key 字段是引用别处记录的依据，丢了整条链路就断了，所以单独钉一遍。
  const noId = contractSchema.safeParse({
    projectId: 'p_abc',
    file: 'a.proto',
    boundary: 'proto:X',
    boundaryKind: 'proto',
    source: 'proto',
    title: 'X',
    symbol: 'X',
    input: null,
    output: null,
    twins: [],
    evidence: { line: 1, hash: 'h' },
    confidence: 0.8,
    createdAt: 1,
    updatedAt: 1,
  })
  assert.equal(noId.success, false, '缺 id 的契约必须被拒绝')

  // 枚举字段越界也要被拒：这些值直接决定界面怎么渲染。
  assert.equal(
    changeSchema.safeParse({
      id: 'ch_1',
      projectId: 'p',
      contractId: 'c',
      sha: 'wt',
      at: 1,
      subject: '',
      kind: '没这个词',
      reasons: [],
      beforeHash: '',
      afterHash: '',
      createdAt: 1,
    }).success,
    false,
  )
  assert.equal(
    decisionSchema.safeParse({
      id: 'dc_1',
      projectId: 'p',
      targetKind: 'contract',
      targetId: 'c',
      action: '随便',
      by: 'local',
      at: 1,
      note: '',
    }).success,
    false,
  )
})

test('内联的 spec 必须被真的 defineDomain 接受（两边形状不许分叉）', () => {
  // 本插件自带一份 defineDomain/domainTable（见 src/spec.ts：那个包只在 app 的 node_modules
  // 里，profile 插件运行时解析不到）。自带一份的风险是"我抄的形状和人家要的不一样"，
  // 所以这里把产出的 spec 原样喂给真实现——它一旦拒收，说明形状已经分叉了。
  const accepted = realDefineDomain(CONTRACT_BUTLER_DOMAIN)
  assert.equal(accepted, CONTRACT_BUTLER_DOMAIN, '真实现应当原样收下')

  // 投影结果也要一致：这是宿主真正拿去开领域的东西。
  const descriptor = descriptorOf(CONTRACT_BUTLER_DOMAIN)
  assert.deepEqual(
    { name: descriptor.name, version: descriptor.version, hasGlobal: descriptor.hasGlobal },
    { name: 'contract_butler', version: 1, hasGlobal: false },
  )
})

test('内联的 defineDomain 与真实现的拒收口径一致', () => {
  const cases: { name: string; spec: Record<string, unknown>; label: string }[] = [
    { name: '域名字母大写', spec: { name: 'Butler', version: 1, tables: {} }, label: 'name 必须匹配 ^[a-z][a-z0-9_]*$' },
    { name: '版本是负数', spec: { name: 'ok_name', version: -1, tables: {} }, label: 'version 必须非负整数' },
    { name: '版本不是整数', spec: { name: 'ok_name', version: 1.5, tables: {} }, label: 'version 必须整数' },
    { name: '表名带横线', spec: { name: 'ok_name', version: 1, tables: { 'bad-table': {} } }, label: '表名必须匹配同一正则' },
    { name: 'layout 越界', spec: { name: 'ok_name', version: 1, tables: {}, layout: 'per-day' }, label: 'layout 只能是 single 或 per-record' },
    { name: 'invalidRecords 越界', spec: { name: 'ok_name', version: 1, tables: {}, invalidRecords: 'drop' }, label: '策略只能是 backup-and-skip' },
    { name: 'compatibleVersions 不小于 version', spec: { name: 'ok_name', version: 2, tables: {}, compatibleVersions: [2] }, label: '必须低于 version' },
  ]

  for (const item of cases) {
    let realRejected = false
    try {
      realDefineDomain(item.spec as never)
    } catch {
      realRejected = true
    }
    assert.equal(realRejected, true, `真实现应当拒收：${item.label}`)

    let mineRejected = false
    try {
      inlineDefineDomain(item.spec as never)
    } catch {
      mineRejected = true
    }
    assert.equal(mineRejected, true, `内联实现也应当拒收：${item.label}`)
  }
})

test('内联的 defineDomain 也拒绝「接受 null 的 global」', () => {
  // global 用了 null 当"从没写过"的哨兵，可空 global 会让"存过 null"和"没存过"分不清。
  const nullableGlobal = {
    name: 'ok_name',
    version: 1,
    tables: {},
    global: { schema: { safeParse: () => ({ success: true }) } },
  }
  assert.throws(() => inlineDefineDomain(nullableGlobal as never))
  assert.throws(() => realDefineDomain(nullableGlobal as never))

  const strictGlobal = {
    name: 'ok_name',
    version: 1,
    tables: {},
    global: { schema: { safeParse: () => ({ success: false }) } },
  }
  assert.doesNotThrow(() => inlineDefineDomain(strictGlobal as never))
  assert.doesNotThrow(() => realDefineDomain(strictGlobal as never))
})

/* ---------- 字段级中文：落盘不许丢 ----------
   这一组是**回归测试**，钉的是一次真实事故：契约记录的 schema 里漏声明了 `aiFields`，
   缓存行的 schema 里漏声明了 `fields`。宿主在领域打开时对每条记录调 `valueSchema.parse`
   （真包 `dsh-storage-domain` 的 `parseRecord`），而 zod 会**静默剥掉**未声明的键——
   于是 AI 明明写回了字段中文，落盘再打开就没了，界面表现成"外层中文有、每个字段的中文全空"。
   它不会在类型层面报出来，也不会被纯 Map 的存储替身（`memoryFacility`）抓到：只有在这里、
   对着**真实现的 parse** 才会现原形。 */

/** 一条合法的、带完整 AI 结果的契约记录（真实现要的必填项一个不少）。 */
function contractWithAiFields(): Record<string, unknown> {
  return {
    id: 'c_ai_1',
    projectId: 'p_ai',
    file: 'proto/user.proto',
    boundary: 'proto:User',
    boundaryKind: 'proto',
    source: 'proto',
    title: 'User',
    symbol: 'User',
    input: null,
    output: { kind: 'object', fields: { id: { kind: 'string' } } },
    twins: [],
    evidence: { line: 3, hash: 'h' },
    confidence: 0.85,
    createdAt: 1,
    updatedAt: 1,
    aiTitle: '用户',
    aiFamily: '契约存储',
    aiFields: [
      { name: 'id', zh: '用户 id' },
      { name: 'user_id', zh: '下单用户 id' },
    ],
    aiRelations: [],
    aiHash: 'abc123',
    aiAt: 2,
  }
}

test('契约记录：AI 字段级中文（aiFields）落盘再读出不许丢', () => {
  const record = contractWithAiFields()
  const parsed = contractSchema.parse(record) as { aiFields?: { name: string; zh: string }[] }
  assert.deepEqual(
    parsed.aiFields,
    [
      { name: 'id', zh: '用户 id' },
      { name: 'user_id', zh: '下单用户 id' },
    ],
    '漏声明 aiFields → zod 会把它剥掉，面板那一栏就成了空白',
  )
  // 名字与中文都必须逐字保住：面板是按名字精确匹配后才渲染的。
  assert.deepEqual(
    (parsed.aiFields ?? []).map((f) => f.name),
    ['id', 'user_id'],
    '字段名是面板匹配的依据，顺序也要原样回来',
  )
})

test('AI 缓存行：字段级中文（fields）落盘再读出不许丢', () => {
  const row = {
    id: 'ai_c_ai_1',
    projectId: 'p_ai',
    contractId: 'c_ai_1',
    hash: 'abc123',
    titleZh: '用户',
    family: '契约存储',
    relations: [],
    fields: [{ name: 'id', zh: '用户 id' }],
    at: 2,
    channel: 'fake · fake-model',
  }
  const parsed = aiSchema.parse(row) as { fields?: { name: string; zh: string }[] }
  assert.deepEqual(parsed.fields, [{ name: 'id', zh: '用户 id' }], '缓存行丢了 fields，缓存命中时就补不回字段中文')
})

test('AI 字段是后加的：老记录/老缓存行（没有这两项）仍然合法', () => {
  // 老数据必须照样能读出来（否则 invalidRecords: backup-and-skip 会把它们整条移走）。
  const record = contractWithAiFields()
  delete record.aiFields
  assert.equal(contractSchema.safeParse(record).success, true, '没有 aiFields 的老契约记录仍然合法')
  assert.equal(
    aiSchema.safeParse({
      id: 'ai_old',
      projectId: 'p_ai',
      contractId: 'c_old',
      hash: 'h',
      titleZh: '旧',
      family: '',
      relations: [],
      at: 1,
      channel: '',
    }).success,
    true,
    '没有 fields 的老缓存行仍然合法（由引擎判成"不算命中"，而不是判成坏记录）',
  )
})

test('AI 缓存行也走真实现的 round-trip（与其它六张表同一套判据）', () => {
  const parsed = aiSchema.safeParse({
    id: 'ai_c_1',
    projectId: 'p_1',
    contractId: 'c_1',
    hash: 'h1',
    titleZh: '用户',
    family: '契约存储',
    relations: [{ to: 'c_2', rel: 'imports', why: '' }],
    fields: [{ name: 'id', zh: '用户 id' }],
    at: 3,
    channel: 'fake · fake-model',
  })
  assert.equal(parsed.success, true, 'ai 表的一条合法记录应当通过')
  if (parsed.success) {
    assert.deepEqual((parsed.data as { fields?: unknown }).fields, [{ name: 'id', zh: '用户 id' }])
  }
})
