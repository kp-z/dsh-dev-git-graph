#!/usr/bin/env node
/** Offline relations HTTP/tool wiring and restart persistence regression. */
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { execFileSync } from 'node:child_process'
import { chmod, mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const HOME = await mkdtemp(join(tmpdir(), 'dsh-feishu-relations-'))
process.env.DSH_HOME = HOME
const DATA = join(HOME, 'dsh-feishu')
await mkdir(DATA, { recursive: true })
const CLI = join(HOME, 'fake-cli')
const CLI_LOG = join(HOME, 'cli-calls.log')
const PYTHON = join(HOME, 'fake-python')
const BRIDGE_LOG = join(HOME, 'bridge-calls.jsonl')
const REMOTE = join(HOME, 'remote.json')
await writeFile(REMOTE, JSON.stringify({ tasks: {}, failWrites: false, counter: 0 }))
// Real subprocess entry: CLI shebang resolves to this executable; bridge passes
// feishu_api.py as argv[2], but no production Python/token/network code runs.
const FAKE_RUNTIME = join(HOME, 'fake-runtime.cjs')
await writeFile(FAKE_RUNTIME, `const fs = require('node:fs');
const remotePath = ${JSON.stringify(REMOTE)};
const logPath = ${JSON.stringify(BRIDGE_LOG)};
const state = JSON.parse(fs.readFileSync(remotePath, 'utf8'));
const save = () => fs.writeFileSync(remotePath, JSON.stringify(state));
const args = process.argv.slice(3);
if (process.argv[2] === ${JSON.stringify(CLI)}) {
  fs.appendFileSync(${JSON.stringify(CLI_LOG)}, args.join(' ') + '\\n');
  if (args[0] === 'task' && args[1] === 'create') {
    const guid = 'created-' + (++state.counter); save();
    console.log(JSON.stringify({guid}));
  } else if (args[0] === 'task' && args[1] === 'update') console.log('{}');
  else process.exitCode = 1; // list deliberately fails: preserve local snapshot
} else {
  let raw = ''; process.stdin.on('data', chunk => raw += chunk);
  process.stdin.on('end', () => {
    const payload = JSON.parse(raw); fs.appendFileSync(logPath, JSON.stringify(payload) + '\\n');
    const actions = (payload.actions || []).map(action => {
      const deps = state.tasks[action.task] || [];
      if (action.op === 'task_dependencies') return {op: action.op, ok: true, items: deps};
      if (['add_dependencies', 'remove_dependencies'].includes(action.op)) {
        if (state.failWrites) return {op: action.op, ok: false, error: 'mock write denied'};
        if (action.op === 'add_dependencies') state.tasks[action.task] = [...deps, ...action.dependencies];
        else state.tasks[action.task] = deps.filter(dep => !action.dependencies.some(item => item.task_guid === dep.task_guid));
        save(); return {op: action.op, ok: true};
      }
      return {op: action.op, ok: true};
    });
    console.log(JSON.stringify({ok: true, actions, errors: [], tasklists: {}, fields: {}, users: {}}));
  });
}
`)
// macOS rejects a script-interpreter shebang chain (ENOEXEC). Compile a tiny
// native launcher so CLI -> fake-python is executable, then dispatch Node.
const LAUNCHER = join(HOME, 'fake-python.c')
await writeFile(LAUNCHER, `#include <unistd.h>\n#include <stdlib.h>\nint main(int argc, char **argv) {\n  char **args = calloc(argc + 3, sizeof(char *));\n  args[0] = ${JSON.stringify(process.execPath)}; args[1] = ${JSON.stringify(FAKE_RUNTIME)};\n  for (int i = 1; i < argc; i++) args[i + 1] = argv[i];\n  execv(args[0], args); return 127;\n}\n`)
execFileSync('cc', [LAUNCHER, '-o', PYTHON])
await chmod(PYTHON, 0o700)
// Existing explicit path prevents resolveCli falling back to a real installed CLI.
await writeFile(CLI, `#!${PYTHON}\n`)
await chmod(CLI, 0o700)
const tasks = [
  { id: 'a', title: 'Prepare', done: false, tasklistGuid: 'list', sessionId: 'bound-session' },
  { id: 'b', title: 'Build', done: false, tasklistGuid: 'list' },
  { id: 'c', title: 'Completed research', done: true, tasklistGuid: 'list' },
  { id: 'd', title: 'Publish', done: false, tasklistGuid: 'list' },
  { id: 'outside', title: 'Other project', done: false, tasklistGuid: 'other' },
].map((task) => ({ ...task, members: [], customFields: [], meta: {} }))
await writeFile(join(DATA, 'state.json'), JSON.stringify({ tasks, schedules: {}, relations: [] }))
await writeFile(join(DATA, 'settings.json'), JSON.stringify({ autoSync: false, cliPath: CLI }))
const { apply } = await import('../index.js')
let modelText = ''
const modelCalls = []
let checks = 0
const ids = (items) => items.map((item) => item.id)
const cliCalls = async () => (await readFile(CLI_LOG, 'utf8').catch(() => '')).split('\n').filter(Boolean)
async function test(name, run) {
  await run()
  checks += 1
  console.log(`✓ ${name}`)
}
async function boot() {
  const routes = []
  const tools = new Map()
  const effects = []
  const errors = []
  const services = {
    llm: { async *stream(request) {
      modelCalls.push(request)
      const midpoint = Math.floor(modelText.length / 2)
      yield { type: 'text-delta', text: modelText.slice(0, midpoint) }
      yield { type: 'text-delta', text: modelText.slice(midpoint) }
    } },
    agentDefaultModel: { currentSelection: () => ({ provider: 'fake', model: 'offline' }) },
  }
  const ctx = {
    logger: () => ({ info() {}, warn() {}, error(message) { errors.push(message) } }),
    get: (name) => services[name],
    effect(fn) { const dispose = fn(); if (typeof dispose === 'function') effects.push(dispose); return () => {} },
    on: () => () => {},
    tools: { register(tool) { tools.set(tool.name, tool); return () => tools.delete(tool.name) } },
    webServer: { register(route) { routes.push(route); return () => {} } },
  }
  apply(ctx, {})
  const deadline = Date.now() + 5000
  while (!routes.length || !tools.has('feishu_task_create')) {
    if (Date.now() >= deadline) throw new Error(`Routes/tools not mounted: ${errors.join('; ')}`)
    await new Promise((resolve) => setTimeout(resolve, 20))
  }
  const server = createServer((req, res) => routes[0].handler(req, res))
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const base = `http://127.0.0.1:${server.address().port}/dsh-feishu`
  return {
    tools,
    services,
    async state() { return (await (await fetch(`${base}/api/state`, { signal: AbortSignal.timeout(5000) })).json()).state },
    async post(body) {
      const res = await fetch(`${base}/api/tasks/relations`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(5000) })
      return { status: res.status, body: await res.json() }
    },
    async close() { effects.reverse().forEach((dispose) => dispose()); server.closeAllConnections(); await new Promise((resolve) => server.close(resolve)) },
  }
}
let app = await boot()
try {
  await test('set local merge exposes all incident directions and metadata in snapshot', async () => {
    const result = await app.post({ action: 'set', taskId: 'b', predecessorIds: ['a'], successorIds: ['d'], sourceTaskIds: ['c'], reason: 'explicit evidence', sessionId: 'session-origin', writeBack: false })
    assert.equal(result.status, 200)
    assert.equal(result.body.ok, true)
    assert.deepEqual(result.body.remote, { ok: true, localOnly: true })
    assert.deepEqual(ids(result.body.relations.predecessors), ['a'])
    assert.deepEqual(ids(result.body.relations.successors), ['d'])
    assert.deepEqual(ids(result.body.relations.sourceTasks), ['c'])
    const state = await app.state()
    assert.equal(state.relations.length, 3)
    assert.ok(state.relations.every((edge) => edge.source === 'manual' && edge.reason === 'explicit evidence' && edge.sessionId === 'session-origin' && edge.createdAt > 0))
    assert.deepEqual(ids(state.tasks.find((task) => task.id === 'c').relations.derivedTasks), ['b'])
    assert.deepEqual(state.relationStats, { dependencyEdges: 2, provenanceEdges: 1, blockedTasks: 2, readyTasks: 2 })
  })
  await test('get does not refresh or mutate; repeated merge preserves provenance/session metadata', async () => {
    const before = (await app.state()).relations
    const got = await app.post({ action: 'get', id: 'b' })
    assert.equal(got.status, 200)
    assert.equal(got.body.remote, null)
    assert.equal(got.body.relations.ready, false)
    assert.deepEqual(ids(got.body.relations.blockedBy), ['a'])
    await app.post({ action: 'set', taskId: 'b', predecessorIds: ['a', 'a'], source: 'ai', reason: 'changed', sessionId: 'changed', writeBack: false })
    assert.deepEqual((await app.state()).relations, before)
  })
  await test('replace only specified incident class; completed predecessors unblock current task', async () => {
    const result = await app.post({ action: 'set', taskId: 'b', mode: 'replace', predecessorIds: ['c'], writeBack: false })
    assert.equal(result.status, 200)
    assert.deepEqual(ids(result.body.relations.predecessors), ['c'])
    assert.deepEqual(ids(result.body.relations.sourceTasks), ['c'])
    assert.deepEqual(ids(result.body.relations.successors), ['d'])
    assert.equal(result.body.relations.ready, true)
    const cleared = await app.post({ action: 'set', taskId: 'b', mode: 'replace', successorIds: [], writeBack: false })
    assert.deepEqual(cleared.body.relations.successors, [])
    assert.deepEqual(ids(cleared.body.relations.predecessors), ['c'])
  })
  await test('invalid/cyclic relation writes return 400 without state changes', async () => {
    const before = (await app.state()).relations
    for (const input of [{ predecessorIds: ['missing'] }, { successorIds: ['b'] }, { sourceTaskIds: [123] }, { successorIds: ['c'] }, { taskId: 'missing' }]) {
      const result = await app.post({ action: 'set', taskId: 'b', ...input, writeBack: false })
      assert.equal(result.status, 400)
      assert.equal(result.body.ok, false)
      assert.deepEqual((await app.state()).relations, before)
    }
  })
  await test('fake llm suggestion restricts candidates and remains a preview until explicit set', async () => {
    const before = (await app.state()).relations
    modelText = JSON.stringify({ predecessorIds: ['a'], successorIds: ['d'], sourceTaskIds: ['c'], reason: 'explicit task evidence' })
    const result = await app.post({ action: 'suggest', taskId: 'b' })
    assert.equal(result.status, 200)
    assert.deepEqual(result.body.proposal, JSON.parse(modelText))
    assert.deepEqual((await app.state()).relations, before)
    const request = modelCalls.findLast((request) => request.system?.includes('任务关系分析器'))
    assert.equal(request.purpose, 'session-title')
    const prompt = JSON.parse(request.messages[0].content[0].text)
    assert.deepEqual(prompt.candidates.map((task) => task.id), ['a', 'c', 'd'])
    assert.ok(!request.messages[0].content[0].text.includes('Other project'))
    const saved = await app.post({ action: 'set', taskId: 'b', ...result.body.proposal, source: 'ai', sessionId: 'ai-session', writeBack: false })
    assert.equal(saved.status, 200)
    const added = (await app.state()).relations.find((edge) => edge.from === 'a' && edge.to === 'b')
    assert.equal(added.source, 'ai')
    assert.equal(added.sessionId, 'ai-session')
  })
  await test('AI unknown candidates, malformed JSON and cyclic proposals reject atomically', async () => {
    const before = (await app.state()).relations
    for (const text of [JSON.stringify({ predecessorIds: ['outside'], successorIds: [], sourceTaskIds: [], reason: '' }), 'not JSON', JSON.stringify({ predecessorIds: [], successorIds: ['c'], sourceTaskIds: [], reason: '' })]) {
      modelText = text
      const result = await app.post({ action: 'suggest', taskId: 'b' })
      assert.equal(result.status, 400)
      assert.deepEqual((await app.state()).relations, before)
    }
    const callsBefore = modelCalls.length
    const isolated = await app.post({ action: 'suggest', taskId: 'outside' })
    assert.equal(isolated.status, 200)
    assert.deepEqual(isolated.body.proposal.predecessorIds, [])
    assert.equal(modelCalls.length, callsBefore)
  })
  await test('bound create tool forwards followUp/relations and rejects invalid GUID before CLI', async () => {
    const tool = app.tools.get('feishu_task_create')
    assert.ok(tool.parameters.properties.followUp)
    const before = await cliCalls()
    const normal = await tool.execute({ summary: 'Follow-up' }, { agent: { id: 'bound-session' } })
    assert.match(normal, /followUp=true/)
    for (const field of ['predecessorIds', 'successorIds', 'sourceTaskIds']) {
      const result = await tool.execute({ summary: 'Follow-up', followUp: true, [field]: ['missing-guid'] }, { agent: { id: 'bound-session' } })
      assert.match(result, /不存在的任务/)
      assert.doesNotMatch(result, /followUp=true|创建任务失败/)
    }
    assert.deepEqual(await cliCalls(), before)
    assert.equal((await app.state()).tasks.find((task) => task.id === 'a').sessionId, 'bound-session')
  })
  await test('relation data and metadata survive plugin unload/reload from disk', async () => {
    const expected = await app.state()
    const disk = JSON.parse(await readFile(join(DATA, 'state.json'), 'utf8'))
    assert.deepEqual(disk.relations, expected.relations)
    await app.close()
    app = await boot()
    const restarted = await app.state()
    assert.deepEqual(restarted.relations, expected.relations)
    assert.deepEqual(restarted.relationStats, expected.relationStats)
    assert.deepEqual(restarted.tasks.find((task) => task.id === 'b').relations, expected.tasks.find((task) => task.id === 'b').relations)
  })
  const remoteState = async () => JSON.parse(await readFile(REMOTE, 'utf8'))
  const bridgeCalls = async () => (await readFile(BRIDGE_LOG, 'utf8').catch(() => '')).split('\n').filter(Boolean).map(JSON.parse).flatMap((payload) => payload.actions || [])
  await test('default writeBack first GETs and merges remote dependencies without deleting omitted successors', async () => {
    // Earlier local-only writes intentionally leave pending=true; use a clean
    // sync marker to exercise the first remote merge rather than pending retry.
    await app.close()
    const clean = JSON.parse(await readFile(join(DATA, 'state.json'), 'utf8'))
    delete clean.relationSync.b
    await writeFile(join(DATA, 'state.json'), JSON.stringify(clean))
    app = await boot()
    const remote = await remoteState()
    remote.tasks.b = [{ task_guid: 'c', type: 'prev' }, { task_guid: 'd', type: 'next' }]
    await writeFile(REMOTE, JSON.stringify(remote))
    const before = (await bridgeCalls()).length
    const result = await app.post({ action: 'set', taskId: 'b', predecessorIds: ['a'] })
    assert.equal(result.status, 200)
    assert.equal(result.body.remote.ok, true)
    assert.deepEqual(ids(result.body.relations.predecessors), ['c', 'a'])
    assert.deepEqual(ids(result.body.relations.successors), ['d'])
    const calls = (await bridgeCalls()).slice(before)
    assert.deepEqual(calls.map((action) => action.op), ['task_dependencies', 'task_dependencies', 'add_dependencies'])
    assert.deepEqual(calls.at(-1).dependencies, [{ task_guid: 'a', type: 'prev' }])
    assert.equal((await app.state()).relationSync.b.pending, false)
  })
  await test('default replace removes only specified predecessor class; provenance does not become remote dependency', async () => {
    const before = (await bridgeCalls()).length
    const result = await app.post({ action: 'set', taskId: 'b', mode: 'replace', predecessorIds: [], sourceTaskIds: ['c'] })
    assert.equal(result.status, 200)
    assert.deepEqual(result.body.relations.predecessors, [])
    assert.deepEqual(ids(result.body.relations.successors), ['d'])
    assert.deepEqual(ids(result.body.relations.sourceTasks), ['c'])
    const calls = (await bridgeCalls()).slice(before)
    assert.deepEqual(calls.map((action) => action.op), ['task_dependencies', 'task_dependencies', 'remove_dependencies'])
    assert.deepEqual(calls.at(-1).dependencies.map((dep) => dep.task_guid), ['c', 'a'])
    assert.deepEqual((await remoteState()).tasks.b, [{ task_guid: 'd', type: 'next' }])
  })
  await test('remote write failure retains local pending changes and refresh cannot overwrite them', async () => {
    const remote = await remoteState()
    remote.failWrites = true
    await writeFile(REMOTE, JSON.stringify(remote))
    const result = await app.post({ action: 'set', taskId: 'b', predecessorIds: ['a'] })
    assert.equal(result.status, 200)
    assert.equal(result.body.ok, true)
    assert.equal(result.body.remote.ok, false)
    assert.match(result.body.remote.error, /mock write denied/)
    const state = await app.state()
    assert.equal(state.relationSync.b.pending, true)
    const got = await app.post({ action: 'get', taskId: 'b', refresh: true })
    assert.deepEqual(ids(got.body.relations.predecessors), ['a'])
    assert.deepEqual((await app.state()).relations, state.relations)
    const disk = JSON.parse(await readFile(join(DATA, 'state.json'), 'utf8'))
    assert.equal(disk.relationSync.b.pending, true)
    remote.failWrites = false
    await writeFile(REMOTE, JSON.stringify(remote))
  })
  await test('successful followUp uses real mock CLI/bridge, creates GUID/source and preserves original binding', async () => {
    app.services.workspaceRegistry = { list: () => [{ id: 'workspace-new', title: 'New project', path: '/new-project', sessionIds: ['bound-session'] }] }
    const tool = app.tools.get('feishu_task_create')
    const result = await tool.execute({ summary: 'Follow-up success', followUp: true, predecessorIds: ['c'], reason: 'follow-up evidence' }, { agent: { id: 'bound-session' } })
    assert.doesNotMatch(result, /创建失败/)
    const state = await app.state()
    const created = state.tasks.find((task) => task.id === 'created-1')
    assert.ok(created)
    assert.equal(created.sessionId, null)
    assert.equal(created.workspaceId, 'workspace-new')
    assert.equal(created.workspaceTitle, 'New project')
    assert.equal(state.workspaceLinks['created-1'].id, 'workspace-new')
    assert.equal(state.tasks.find((task) => task.id === 'a').sessionId, 'bound-session')
    assert.deepEqual(ids(created.relations.sourceTasks), ['a'])
    assert.deepEqual(ids(created.relations.predecessors), ['c'])
    const source = state.relations.find((edge) => edge.kind === 'derived_from' && edge.to === created.id)
    assert.equal(source.from, 'a')
    assert.equal(source.source, 'creation')
    assert.equal(source.sessionId, 'bound-session')
    assert.equal(source.reason, 'follow-up evidence')
    assert.ok(state.relations.every((edge) => !edge.from.startsWith('draft:') && !edge.to.startsWith('draft:')))
  })
  await test('explicit autoRelate model unavailable does not undo successful followUp creation', async () => {
    // Null means an immediately available but unusable service, avoiding 15s awaitService polling.
    app.services.llm = null
    const result = await app.tools.get('feishu_task_create').execute({ summary: 'Follow-up without model', followUp: true, autoRelate: true }, { agent: { id: 'bound-session' } })
    assert.doesNotMatch(result, /创建失败/)
    const state = await app.state()
    assert.ok(state.tasks.find((task) => task.id === 'created-2'))
    assert.deepEqual(ids(state.tasks.find((task) => task.id === 'created-2').relations.sourceTasks), ['a'])
    assert.equal(state.tasks.find((task) => task.id === 'a').sessionId, 'bound-session')
    const disk = JSON.parse(await readFile(join(DATA, 'state.json'), 'utf8'))
    assert.ok(disk.tasks.find((task) => task.id === 'created-2'))
  })
  console.log(`\n${checks} relation bridge groups passed\nRELATIONS_BRIDGE_OK`)
} finally {
  await app.close()
}
