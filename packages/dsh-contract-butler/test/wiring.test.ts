/**
 * 装配测试：把插件当成插件跑一遍。
 *
 * 前面的测试都在测模块，这个文件测的是"它作为插件到底能不能用"——服务名、注入时机、路由
 * 路径、事件订阅、HTTP 出入参，这些只有整体装起来才看得出来。用假 ctx 是因为真实的
 * cordis 应用要在进程里挂起整条存储栈；而宿主那一侧的三个关键假设（服务名 `storageDomain`
 * / `webServer`、事件名 `tools/result`）已经对着真包核对过了。
 *
 * 覆盖的就是最要紧的那条链路：**给一个项目初始化，然后一直盯着它。**
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { apply } from '../lib/index.js'
import { fakeCtx, type RouteSpec } from './fakeHost.ts'
import { memoryFacility } from './fake.ts'

/* ---------- 临时项目 ---------- */

const PROTO_V1 = `syntax = "proto3";
package shop.v1;
message User {
  string id = 1;
  string name = 2;
}
`

function makeProject(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'butler-wiring-'))
  fs.writeFileSync(path.join(root, 'user.proto'), PROTO_V1)
  const env = {
    ...process.env,
    GIT_AUTHOR_NAME: 'T',
    GIT_AUTHOR_EMAIL: 't@example.test',
    GIT_COMMITTER_NAME: 'T',
    GIT_COMMITTER_EMAIL: 't@example.test',
  }
  execFileSync('git', ['-c', 'init.defaultBranch=main', 'init', '-q'], { cwd: root, env })
  execFileSync('git', ['add', '-A'], { cwd: root, env })
  execFileSync('git', ['commit', '-q', '-m', '初始化'], { cwd: root, env })
  return root
}

/** 装好一个可用的插件实例。 */
async function mountPlugin(): Promise<{ fake: FakeCtx; root: string }> {
  const root = makeProject()
  const fake = fakeCtx()
  const { facility } = memoryFacility()
  apply(fake.ctx as never, { watchEnabled: false, introspectTools: true })
  fake.mount('storageDomain', facility)
  fake.mount('webServer', {
    register(spec: RouteSpec) {
      fake.routes.push(spec)
      return () => undefined
    },
  })
  fake.mount('tools', {
    schemas: () => [
      {
        name: 'echo',
        description: '回显',
        parameters: { text: { type: 'string', required: true } },
      },
    ],
    get: (name: string) =>
      name === 'echo'
        ? {
            name: 'echo',
            description: '回显',
            parameters: { text: { type: 'string', required: true } },
            output: { schema: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] } },
          }
        : undefined,
  })
  // 等领域打开（apply 内部是异步的）。
  for (let index = 0; index < 40; index += 1) {
    await new Promise((resolve) => setTimeout(resolve, 5))
    if (fake.logs.some((line) => line.includes('存储就绪'))) break
  }
  assert.ok(fake.logs.some((line) => line.includes('存储就绪')), `存储没就绪，日志：${fake.logs.join(' | ')}`)
  return { fake, root }
}

/* ---------- 用例 ---------- */

test('装配：路由、存储、工具订阅都挂上了', async () => {
  const { fake } = await mountPlugin()
  const paths = fake.routes.map((item) => item.path).sort()
  for (const wanted of [
    '/dsh-contract-butler/projects',
    '/dsh-contract-butler/contracts',
    '/dsh-contract-butler/init',
    '/dsh-contract-butler/rescan',
    '/dsh-contract-butler/decisions',
    '/dsh-contract-butler/observations',
    '/dsh-contract-butler/status',
    '/dsh-contract-butler/panel',
    '/dsh-contract-butler/events',
  ]) {
    assert.ok(paths.includes(wanted), `缺路由 ${wanted}，实际：${paths.join(', ')}`)
  }
  // 面板是前缀注册以外的精确路由，且能吐出真正的 HTML。
  const panel = await fake.call('GET', '/dsh-contract-butler/panel')
  assert.equal(panel.status, 200)
  assert.match(panel.headers['Content-Type'] ?? '', /text\/html/)
  assert.match(panel.body, /协议管家/)
})

test('装配：空状态 / 状态查询可用', async () => {
  const { fake } = await mountPlugin()
  const projects = await fake.call('GET', '/dsh-contract-butler/projects')
  assert.equal(projects.status, 200)
  assert.deepEqual(JSON.parse(projects.body).projects, [])

  const status = await fake.call('GET', '/dsh-contract-butler/status')
  const parsed = JSON.parse(status.body)
  assert.equal(parsed.watchEnabled, false)
  assert.equal(parsed.capturePayloads, false)
  assert.ok(Array.isArray(parsed.excludeDirs) && parsed.excludeDirs.includes('node_modules'))
})

test('装配：纳管走两段——先预览（无副作用），再确认落库', async () => {
  const { fake, root } = await mountPlugin()

  const preview = await fake.call('POST', '/dsh-contract-butler/init', { root })
  assert.equal(preview.status, 200)
  const pv = JSON.parse(preview.body).preview
  assert.equal(pv.vcs, 'git')
  assert.ok(pv.head && pv.head.sha, '应当认到基线提交')
  const boundaries = pv.candidates.map((c: { boundary: string }) => c.boundary)
  assert.ok(boundaries.includes('proto:shop.v1.User'), `候选里应当有 proto:shop.v1.User，实际 ${boundaries.join(', ')}`)
  const target = pv.candidates.find((c: { boundary: string }) => c.boundary === 'proto:shop.v1.User')
  assert.ok(target && typeof target.id === 'string' && target.id.startsWith('c_'), '候选应当带一个 key 安全的 id')

  // 预览不该写任何东西。
  const afterPreview = JSON.parse((await fake.call('GET', '/dsh-contract-butler/projects')).body)
  assert.deepEqual(afterPreview.projects, [], '预览阶段不该落任何项目')

  // `include` 收的是候选 id，不是边界名——界面勾选的就是候选本身。
  const confirm = await fake.call('POST', '/dsh-contract-butler/init', { root, confirm: true, include: [target.id] })
  assert.equal(confirm.status, 200)
  const result = JSON.parse(confirm.body).result
  assert.ok(result.project.id.startsWith('p_'))
  assert.equal(result.project.baselineSha, pv.head.sha)
  assert.equal(result.contracts, 1, '只勾了一条，就只该落一条')

  const projects = JSON.parse((await fake.call('GET', '/dsh-contract-butler/projects')).body)
  assert.equal(projects.projects.length, 1)
  assert.equal(projects.projects[0].contractCount, 1)
  assert.equal(projects.projects[0].findingCount, 0)
})

test('装配：契约查询带上"这次对比之内"的标记', async () => {
  const { fake, root } = await mountPlugin()
  const confirm = await fake.call('POST', '/dsh-contract-butler/init', { root, confirm: true })
  const projectId = JSON.parse(confirm.body).result.project.id

  const list = JSON.parse((await fake.call('GET', `/dsh-contract-butler/contracts?project=${projectId}`)).body)
  assert.ok(list.contracts.length >= 1, '应当至少纳管了一条契约')
  for (const item of list.contracts) {
    assert.equal(typeof item.contract.id, 'string')
    assert.equal(item.contract.projectId, projectId)
    assert.ok(Array.isArray(item.changes))
    assert.ok(Array.isArray(item.findings))
  }
  // 刚纳管、什么都没改：不该有任何"变过"。
  const fresh = list.contracts.flatMap((item: { changes: { fresh?: boolean }[] }) => item.changes)
  assert.equal(fresh.filter((ch: { fresh?: boolean }) => ch.fresh === true).length, 0)
})

test('装配：重扫发现改动，并把它标成这次对比之内的', async () => {
  const { fake, root } = await mountPlugin()
  const confirm = await fake.call('POST', '/dsh-contract-butler/init', { root, confirm: true })
  const projectId = JSON.parse(confirm.body).result.project.id

  // 先扫一次：没改过，应当零演化。
  const clean = JSON.parse((await fake.call('POST', '/dsh-contract-butler/rescan', { project: projectId })).body)
  assert.equal(clean.result.changes.length, 0)

  // 改形状：删 name、加必填 email（还没提交 → 归到工作区）。
  fs.writeFileSync(
    path.join(root, 'user.proto'),
    `syntax = "proto3";
package shop.v1;
message User {
  string id = 1;
  string email = 3;
}
`,
  )
  const dirty = JSON.parse((await fake.call('POST', '/dsh-contract-butler/rescan', { project: projectId })).body)
  assert.equal(dirty.result.changes.length, 1, `期望 1 条演化：${JSON.stringify(dirty.result.changes)}`)
  assert.equal(dirty.result.changes[0].sha, 'wt')
  assert.equal(dirty.result.changes[0].kind, 'breaking')

  // 面板靠这个标记决定要不要画"变过"。
  const list = JSON.parse((await fake.call('GET', '/dsh-contract-butler/contracts')).body)
  const withChange = list.contracts.filter((item: { changes: { fresh?: boolean }[] }) =>
    item.changes.some((ch) => ch.fresh === true),
  )
  assert.equal(withChange.length, 1)
  assert.equal(withChange[0].contract.boundary, 'proto:shop.v1.User')
})

test('装配：运行观测经 tools/result 落库，不符能被查出来', async () => {
  const { fake, root } = await mountPlugin()
  // 把运行时工具边界也纳管进来。
  const confirm = await fake.call('POST', '/dsh-contract-butler/init', { root, confirm: true })
  const projectId = JSON.parse(confirm.body).result.project.id
  const contracts = JSON.parse((await fake.call('GET', '/dsh-contract-butler/contracts')).body).contracts
  const toolItem = contracts.filter((item: { contract: { boundary: string } }) =>
    item.contract.boundary === 'tool:echo',
  )
  assert.equal(toolItem.length, 1, '运行时内省应当把 echo 也变成一条可纳管的契约')

  const toolContractId = toolItem[0].contract.id

  // 一次对得上的调用。
  fake.emit('tools/result', { name: 'echo', callId: 'c1', agent: 'a', arguments: { text: 'hi' } }, { value: { text: 'hi' } })
  // 一次多带字段的调用。
  fake.emit('tools/result', { name: 'echo', callId: 'c2', agent: 'a', arguments: { text: 'hi', extra: 1 } }, { value: { text: 'hi' } })
  await new Promise((resolve) => setTimeout(resolve, 80))

  const observations = JSON.parse((await fake.call('GET', `/dsh-contract-butler/observations?project=${projectId}`)).body)
  assert.equal(observations.observations.length, 2)
  const bad = observations.observations.filter((item: { ok: boolean }) => !item.ok)
  assert.equal(bad.length, 1, `应当恰好一条不符：${JSON.stringify(observations.observations.map((o: { ok: boolean; reasons: string[] }) => o.reasons))}`)
  assert.match(bad[0].reasons.join(' '), /extra/)
  assert.equal(bad[0].contractId, toolContractId)

  // 契约详情里能看到这条观测。
  const detail = JSON.parse((await fake.call('GET', `/dsh-contract-butler/contracts/${toolContractId}`)).body)
  assert.equal(detail.findings.length, 1)
})

test('装配：决策能落库，接受新基线会推动基线', async () => {
  const { fake, root } = await mountPlugin()
  const confirm = await fake.call('POST', '/dsh-contract-butler/init', { root, confirm: true })
  const projectId = JSON.parse(confirm.body).result.project.id
  const contracts = JSON.parse((await fake.call('GET', '/dsh-contract-butler/contracts')).body).contracts
  const contractId = contracts[0].contract.id
  const initialBaseline = JSON.parse((await fake.call('GET', '/dsh-contract-butler/projects')).body).projects[0].baselineSha

  const bad = await fake.call('POST', '/dsh-contract-butler/decisions', {
    project: projectId,
    targetKind: 'contract',
    targetId: contractId,
    action: 'ack',
  })
  assert.equal(bad.status, 200)
  assert.equal(JSON.parse(bad.body).record.action, 'ack')

  // 决策必须落在真实对象上：指向空处的决策会让后来的人以为"这事已经处理过了"。
  const dangling = await fake.call('POST', '/dsh-contract-butler/decisions', {
    project: projectId,
    targetKind: 'contract',
    targetId: 'c_不存在',
    action: 'ack',
  })
  assert.equal(dangling.status, 404)

  const moved = await fake.call('POST', '/dsh-contract-butler/decisions', {
    project: projectId,
    targetKind: 'contract',
    targetId: contractId,
    action: 'accept-baseline',
  })
  assert.equal(moved.status, 200)
  assert.equal(JSON.parse(moved.body).record.action, 'accept-baseline')

  // 提交一个新版本，基线才可能真的动。
  const env = { ...process.env, GIT_AUTHOR_NAME: 'T', GIT_AUTHOR_EMAIL: 't@example.test', GIT_COMMITTER_NAME: 'T', GIT_COMMITTER_EMAIL: 't@example.test' }
  fs.writeFileSync(path.join(root, 'other.proto'), 'syntax = "proto3";\npackage shop.v1;\nmessage Other { string a = 1; }\n')
  execFileSync('git', ['add', '-A'], { cwd: root, env })
  execFileSync('git', ['commit', '-q', '-m', '再加一个'], { cwd: root, env })

  const move = await fake.call('POST', '/dsh-contract-butler/decisions', {
    project: projectId,
    targetKind: 'contract',
    targetId: contractId,
    action: 'accept-baseline',
  })
  assert.equal(move.status, 200)
  const after = JSON.parse((await fake.call('GET', '/dsh-contract-butler/projects')).body).projects[0]
  assert.notEqual(after.baselineSha, initialBaseline, '接受新基线应当把基线推到当前 HEAD')

  // 非法动作要被挡住，而不是悄悄落一条看不懂的记录。
  const invalid = await fake.call('POST', '/dsh-contract-butler/decisions', {
    project: projectId,
    action: '乱写',
  })
  assert.equal(invalid.status, 400)
})

test('装配：SSE 连接先收到 ready 事件', async () => {
  const { fake } = await mountPlugin()
  const res = await fake.call('GET', '/dsh-contract-butler/events')
  assert.equal(res.status, 200)
  assert.match(res.headers['Content-Type'] ?? '', /text\/event-stream/)
  assert.match(res.body, /event: ready/)
})

test('装配：输入不合法时给明确错误，不是 500', async () => {
  const { fake } = await mountPlugin()
  assert.equal((await fake.call('POST', '/dsh-contract-butler/init', {})).status, 400)
  assert.equal((await fake.call('POST', '/dsh-contract-butler/init', { root: 'relative/path' })).status, 400)
  assert.equal((await fake.call('GET', '/dsh-contract-butler/changes?project=nope')).status, 404)
  assert.equal((await fake.call('GET', '/dsh-contract-butler/contracts/nope')).status, 404)
  const err = JSON.parse((await fake.call('POST', '/dsh-contract-butler/init', {})).body)
  assert.ok(typeof err.error === 'string' && err.error.length > 0)
})

test('装配：变化被提交后，归因会从"工作区"修正为那个提交', async () => {
  const { fake, root } = await mountPlugin()
  const confirm = await fake.call('POST', '/dsh-contract-butler/init', { root, confirm: true })
  const projectId = JSON.parse(confirm.body).result.project.id

  // 先改但不提交：应当归到工作区。
  fs.writeFileSync(
    path.join(root, 'user.proto'),
    `syntax = "proto3";
package shop.v1;
message User {
  string id = 1;
  string email = 3;
}
`,
  )
  await fake.call('POST', '/dsh-contract-butler/rescan', { project: projectId })
  const before = JSON.parse((await fake.call('GET', '/dsh-contract-butler/contracts')).body).contracts[0].changes[0]
  assert.equal(before.sha, 'wt', '还没提交时应当归到工作区')

  // 提交，再扫一次：归因要回头修正，否则时间轴会一直说这是"未提交的改动"。
  const env = { ...process.env, GIT_AUTHOR_NAME: 'T', GIT_AUTHOR_EMAIL: 't@example.test', GIT_COMMITTER_NAME: 'T', GIT_COMMITTER_EMAIL: 't@example.test' }
  execFileSync('git', ['add', '-A'], { cwd: root, env })
  execFileSync('git', ['commit', '-q', '-m', '删掉 name'], { cwd: root, env })

  const rescanned = JSON.parse((await fake.call('POST', '/dsh-contract-butler/rescan', { project: projectId })).body)
  assert.equal(rescanned.result.changes.length, 0, '形状没再变，不该产生新的演化记录')
  assert.equal(rescanned.result.settled, 1, '应当把那条"未提交"的记录重新归因到提交上')

  const after = JSON.parse((await fake.call('GET', '/dsh-contract-butler/contracts')).body).contracts[0].changes[0]
  assert.notEqual(after.sha, 'wt')
  assert.equal(after.subject, '删掉 name')
  // 记录还是那一条：只是归因变了，不是多了一条。
  assert.equal(after.id, before.id)
  // 基线没动，所以它仍然算"这次对比之内变过"。
  assert.equal(after.fresh, true)
})
