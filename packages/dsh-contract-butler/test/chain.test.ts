/**
 * 端到端链路测试：纳管 → 基线 → 演化 → 运行观测。
 *
 * 这是对"给一个项目初始化并监控"这条主链路的证明。测试跑在真实临时目录 + 真实 git 上，
 * 因为这条链路的正确性有一半取决于"归因到哪个提交"——那是靠 git 语义而不是靠我们的想象。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { commitInit, previewInit, projectIdOf } from '../lib/manage.js'
import { evolveProject, WORKTREE } from '../lib/evolve.js'
import { ButlerStore } from '../lib/store.js'
import { Observer } from '../lib/observe.js'
import { openApiExtractor, jsonSchemaExtractor } from '../lib/extract/jsonFiles.js'
import { protoExtractor } from '../lib/extract/proto.js'
import { tsPatternExtractor } from '../lib/extract/tsPattern.js'
import { candidatesFromTools } from '../lib/extract/tools.js'
import { memoryFacility } from './fake.ts'

const EXTRACTORS = [openApiExtractor, jsonSchemaExtractor, protoExtractor, tsPatternExtractor]

/** 跑一条 git 命令（带固定的作者身份，避免依赖本机 git 配置）。 */
function git(cwd: string, args: string[]): string {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: 'T',
      GIT_AUTHOR_EMAIL: 't@example.test',
      GIT_COMMITTER_NAME: 'T',
      GIT_COMMITTER_EMAIL: 't@example.test',
    },
  })
}

const PROTO_V1 = `syntax = "proto3";
package shop.v1;
message User {
  string id = 1;
  string name = 2;
}
`

/** 造一个已纳管前的临时项目：一个 proto、一个 OpenAPI。 */
function makeProject(protoText = PROTO_V1): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'butler-chain-'))
  fs.mkdirSync(path.join(root, 'proto'), { recursive: true })
  fs.writeFileSync(path.join(root, 'proto', 'user.proto'), protoText)
  fs.writeFileSync(
    path.join(root, 'api.json'),
    JSON.stringify({
      openapi: '3.0.0',
      paths: { '/ping': { get: { responses: { 200: { content: { 'application/json': { schema: { type: 'object', properties: { ok: { type: 'boolean' } } } } } } } } } },
    }),
  )
  git(root, ['-c', 'init.defaultBranch=main', 'init', '-q'])
  git(root, ['add', '-A'])
  git(root, ['commit', '-q', '-m', '初始化契约'])
  return root
}

test('纳管：预览无副作用，落库后项目、契约、基线快照齐备', async () => {
  const root = makeProject()
  const { facility, domain } = memoryFacility()
  const store = await ButlerStore.open(facility)

  const preview = await previewInit({ root, extractors: EXTRACTORS })
  assert.equal(preview.vcs, 'git')
  assert.ok(preview.head !== null, 'git 项目应当有基线提交')
  assert.ok(preview.candidates.length >= 2, `候选太少：${preview.candidates.length}`)

  // 预览阶段不该写任何东西。
  assert.equal(store.projects().size, 0)
  assert.equal(store.contracts().size, 0)

  const result = await commitInit(store, { root, title: '示例项目', extractors: EXTRACTORS })
  assert.equal(result.contracts, preview.candidates.length)
  assert.equal(result.skipped.length, 0)

  const project = store.projects().get(projectIdOf(root))
  assert.ok(project, '项目应当已落库')
  assert.equal(project.title, '示例项目')
  assert.equal(project.baselineSha, preview.head?.sha)
  assert.equal(project.baselineHash, null)
  assert.equal(project.include.length, result.contracts)
  assert.equal(project.scan.maxFiles, 2000)

  // 每条契约都应当有一条基线快照，且快照就是当时的形状。
  for (const [, contract] of store.contracts().entries()) {
    const snapshots = store.snapshotsOf(contract.id)
    assert.equal(snapshots.length, 1, `${contract.id} 应当有 1 条基线快照`)
    assert.equal(snapshots[0]?.sha, preview.head?.sha)
    assert.deepEqual(snapshots[0]?.output, contract.output)
  }

  // 存储重开后数据还在（内存替身不丢表）。
  const reopened = await ButlerStore.open(memoryFacility(domain).facility)
  assert.equal(reopened.projects().size, 1)
  assert.equal(reopened.contractsOf(project.id).length, result.contracts)
})

test('纳管：没有形状的候选被跳过，不写进契约', async () => {
  const root = makeProject()
  const store = await ButlerStore.open(memoryFacility().facility)
  const shapeless = {
    id: 'c_deadbeef0000',
    file: 'nothing.ts',
    boundary: 'type:Nothing',
    boundaryKind: 'schema' as const,
    source: 'x',
    title: 'Nothing',
    symbol: 'Nothing',
    input: null,
    output: null,
    twins: [],
    evidence: { line: 1, hash: 'h' },
    confidence: 0.5,
    note: '',
  }
  const result = await commitInit(store, {
    root,
    extractors: EXTRACTORS,
    runtimeCandidates: [shapeless],
  })
  assert.equal(result.skipped.length, 1)
  assert.equal(result.skipped[0]?.id, shapeless.id)
  assert.equal(store.contracts().get(shapeless.id), undefined)
})

test('演化：形状没变就不产生记录，改了才记一条破坏性演化', async () => {
  const root = makeProject()
  const store = await ButlerStore.open(memoryFacility().facility)
  const { project } = await commitInit(store, { root, extractors: EXTRACTORS })

  // 第一次重扫应当一无所获。
  const clean = await evolveProject({ store, project, extractors: EXTRACTORS })
  assert.deepEqual(clean.changes, [])
  assert.deepEqual(clean.changed, [])
  assert.equal(store.changes().size, 0)

  // 改 proto：删掉 name、加一个必填 email。文件还没提交 → 归因应当落在工作区。
  fs.writeFileSync(
    path.join(root, 'proto', 'user.proto'),
    `syntax = "proto3";
package shop.v1;
message User {
  string id = 1;
  string email = 3;
}
`,
  )
  const dirty = await evolveProject({
    store,
    project: store.projects().get(project.id) ?? project,
    extractors: EXTRACTORS,
    only: ['proto/user.proto'],
  })
  assert.equal(dirty.changes.length, 1, `期望 1 条演化，实际 ${JSON.stringify(dirty.changes.map((c) => c.reasons))}`)
  const change = dirty.changes[0]
  assert.ok(change, '应当有一条演化记录')
  assert.equal(change.kind, 'breaking')
  assert.equal(change.sha, WORKTREE, '未提交的改动应当归到工作区')
  assert.match(change.subject, /未提交/)
  const reasons = change.reasons.join(' ')
  assert.match(reasons, /name/, `结论里应当提到被删的 name：${reasons}`)
  assert.match(reasons, /email/, `结论里应当提到新增的 email：${reasons}`)

  // 契约本身的形状也要跟着更新。
  const updated = store.contracts().get(change.contractId)
  assert.equal(updated?.output?.fields?.name, undefined)
  assert.equal(updated?.output?.fields?.email?.kind, 'string')

  // 再扫一次不该重复记同一条演化（形状已经对齐了）。
  const again = await evolveProject({
    store,
    project: store.projects().get(project.id) ?? project,
    extractors: EXTRACTORS,
    only: ['proto/user.proto'],
  })
  assert.deepEqual(again.changes, [])
  assert.equal(store.changes().size, 1)
})

test('演化：提交之后的改动归因到那个提交，而不再是工作区', async () => {
  const root = makeProject()
  const store = await ButlerStore.open(memoryFacility().facility)
  const { project } = await commitInit(store, { root, extractors: EXTRACTORS })

  fs.writeFileSync(
    path.join(root, 'proto', 'user.proto'),
    `syntax = "proto3";
package shop.v1;
message User {
  string id = 1;
  string name = 2;
  int32 age = 4;
}
`,
  )
  git(root, ['add', '-A'])
  git(root, ['commit', '-q', '-m', '给 User 加 age'])
  const expected = git(root, ['rev-parse', 'HEAD']).trim()

  const result = await evolveProject({
    store,
    project: store.projects().get(project.id) ?? project,
    extractors: EXTRACTORS,
    only: ['proto/user.proto'],
  })
  assert.equal(result.changes.length, 1)
  assert.equal(result.changes[0]?.sha, expected)
  assert.match(result.changes[0]?.subject ?? '', /给 User 加 age/)
  assert.notEqual(result.changes[0]?.sha, WORKTREE)
})

test('演化：局部重扫不会把没扫到的契约误判为消失，全量才会', async () => {
  const root = makeProject()
  const store = await ButlerStore.open(memoryFacility().facility)
  const { project } = await commitInit(store, { root, extractors: EXTRACTORS })
  const before = store.contracts().size
  assert.ok(before >= 2)

  // 局部重扫只带一个文件：其它契约不该被判为"消失"。
  const partial = await evolveProject({
    store,
    project,
    extractors: EXTRACTORS,
    only: ['api.json'],
  })
  assert.deepEqual(partial.changes, [])

  // 真的把 proto 删掉，全量重扫才报告它消失。
  fs.rmSync(path.join(root, 'proto', 'user.proto'))
  const full = await evolveProject({ store, project, extractors: EXTRACTORS })
  assert.ok(full.changes.length >= 1, '删掉声明后全量重扫应当报告契约消失')
  assert.ok(full.changes.every((item) => item.kind === 'breaking'))
})

test('演化：新长出来的契约只作为候选上报，不自动纳管', async () => {
  const root = makeProject()
  const store = await ButlerStore.open(memoryFacility().facility)
  const { project } = await commitInit(store, { root, extractors: EXTRACTORS })
  const before = store.contracts().size

  fs.writeFileSync(
    path.join(root, 'proto', 'order.proto'),
    'syntax = "proto3";\nmessage Order { string id = 1; }\n',
  )
  const result = await evolveProject({ store, project, extractors: EXTRACTORS })
  assert.equal(result.newCandidates.length, 1)
  assert.equal(result.newCandidates[0]?.boundary, 'proto:Order')
  assert.equal(store.contracts().size, before, '新候选不该自动写进契约表')
})

test('运行观测：对得上不报，多出或缺少字段才报不符', async () => {
  const root = makeProject()
  const store = await ButlerStore.open(memoryFacility().facility)
  const toolCandidate = candidatesFromTools([
    {
      name: 'echo',
      description: '回显',
      parameters: { text: { type: 'string', required: true } },
      output: { schema: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] } },
    },
  ])[0]
  assert.ok(toolCandidate)
  await commitInit(store, {
    root,
    extractors: EXTRACTORS,
    runtimeCandidates: [toolCandidate],
    include: [toolCandidate.id],
  })

  const observer = new Observer(store, {
    store,
    payloadMaxBytes: 512,
    redactKeys: ['authorization'],
    capturePayloads: false,
    ringSize: 50,
  })
  const projectId = projectIdOf(root)

  const ok = await observer.observe({ subject: 'echo', args: { text: 'hi' }, value: { text: 'hi' }, failed: false })
  assert.equal(ok.ok, true, `不该报不符：${JSON.stringify(ok.reasons)}`)
  assert.equal(ok.projectId, projectId)
  assert.equal(ok.contractId, toolCandidate.id)
  assert.equal(ok.sample, '', '默认不采集载荷样本')

  const bad = await observer.observe({
    subject: 'echo',
    args: { text: 'hi', sneaky: 1 },
    value: { text: 'hi', extra: true },
    failed: false,
  })
  assert.equal(bad.ok, false)
  const reasons = bad.reasons.join(' ')
  assert.match(reasons, /sneaky/)
  assert.match(reasons, /extra/)

  // 工具自己失败时不判不符——出错时的载荷本来就不受声明约束。
  const failed = await observer.observe({ subject: 'echo', args: {}, value: undefined, failed: true })
  assert.equal(failed.ok, true)

  // 没纳管过的工具：记一条观测，但不编造判定。
  const unknown = await observer.observe({ subject: 'nope', args: {}, value: {}, failed: false })
  assert.equal(unknown.ok, true)
  assert.equal(unknown.projectId, '')
  assert.equal(unknown.contractId, '')
})

test('运行观测：环形缓冲只留最新若干条，并从存储里清掉旧的', async () => {
  const root = makeProject()
  const store = await ButlerStore.open(memoryFacility().facility)
  const toolCandidate = candidatesFromTools([
    { name: 'echo', parameters: { text: { type: 'string', required: true } } },
  ])[0]
  assert.ok(toolCandidate)
  await commitInit(store, {
    root,
    extractors: EXTRACTORS,
    runtimeCandidates: [toolCandidate],
    include: [toolCandidate.id],
  })
  const observer = new Observer(store, {
    store,
    payloadMaxBytes: 256,
    redactKeys: [],
    capturePayloads: false,
    ringSize: 3,
  })
  const projectId = projectIdOf(root)
  for (let index = 0; index < 6; index += 1) {
    await observer.observe({ subject: 'echo', args: { text: `v${index}` }, value: undefined, failed: false })
  }
  assert.equal(observer.recent(projectId).length, 3)
  assert.equal(store.observationsOf(projectId).length, 3, '被挤出缓冲的观测应当从存储里删掉')
})
