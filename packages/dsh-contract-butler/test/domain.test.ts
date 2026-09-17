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
import { descriptorOf } from '@deepseek-ai/dsh-storage-domain'
import {
  CONTRACT_BUTLER_DOMAIN,
  changeSchema,
  contractSchema,
  decisionSchema,
  observationSchema,
  projectSchema,
  snapshotSchema,
} from '../lib/domain.js'

test('真实实现接受本插件的领域规格，并认出六张表', () => {
  // `defineDomain` 在模块加载时就已经跑过了（domain.ts 顶层调用），这里确认投影结果。
  const descriptor = descriptorOf(CONTRACT_BUTLER_DOMAIN)
  assert.equal(descriptor.name, 'contract_butler')
  assert.equal(descriptor.version, 1)
  assert.equal(descriptor.layout, 'single')
  assert.equal(descriptor.hasGlobal, false)
  assert.deepEqual(
    [...descriptor.tables].sort(),
    ['changes', 'contracts', 'decisions', 'observations', 'projects', 'snapshots'],
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
