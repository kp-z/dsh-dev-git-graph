#!/usr/bin/env node
/** 工作区里归档会话 → 绑定任务自动完成、绑定保留。离线：假 CLI、假归档流，不碰真飞书/真会话。
 * Run: node packages/dsh-feishu/test/archiveComplete.mjs
 */
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { chmod, mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const HOME = await mkdtemp(join(tmpdir(), 'dsh-feishu-archive-'))
process.env.DSH_HOME = HOME
const DATA = join(HOME, 'dsh-feishu')
await mkdir(DATA, { recursive: true })
const LOG = join(HOME, 'cli.log')
const CLI = join(HOME, 'fake-feishu-sync-cli')
await writeFile(CLI, `#!${process.execPath}\nconst fs=require('node:fs');const a=process.argv.slice(2);fs.appendFileSync(${JSON.stringify(LOG)},JSON.stringify(a)+'\\n');if(a[0]==='version')console.log('feishu-sync 0.0.0-offline');else if(a[1]==='complete')console.log('{}');else{console.error('offline');process.exitCode=1}\n`)
await chmod(CLI, 0o700)
await writeFile(join(DATA, 'settings.json'), JSON.stringify({ cliBackend: 'feishu-sync', autoSync: false, cliPath: CLI, comments: { enabled: false } }))
const base = { done: false, started: true, startedAt: 1, members: [], customFields: [], meta: {}, docs: [] }
const tasks = [
  { id: 'live', sessionId: 's-live' },
  { id: 'old', sessionId: 's-old' },
  { id: 'held', sessionId: 's-held' },
  { id: 'already', sessionId: 's-already', done: true, completedAt: 5, endAt: 5 },
  { id: 'free', no: 9, title: 'T9-未绑定的任务', started: false },
].map((task) => ({ title: `Fixture ${task.id}`, ...base, ...task }))
await writeFile(join(DATA, 'state.json'), JSON.stringify({ tasks, suspensions: { held: { active: true } }, bindings: {} }))

/* 假归档流：先发 baseline，之后按 push() 推帧。 */
const archived = new Set(['s-old'])
const waiters = []
const push = (frame) => { for (const w of waiters.splice(0)) w(frame) }
const calls = { archive: [] }
const controller = {
  async *follow(signal) {
    yield { type: 'baseline', value: { items: [], archivedSessionIds: [...archived], pinnedSessionIds: [] } }
    while (!signal.aborted) {
      const frame = await new Promise((resolve) => { waiters.push(resolve); signal.addEventListener('abort', () => resolve(null), { once: true }) })
      if (!frame) return
      yield frame
    }
  },
}
const registry = { async archiveSession(id) { calls.archive.push(id); archived.add(id) }, async unarchiveSession(id) { archived.delete(id) } }

const { apply } = await import('../index.js')
const routes = [], effects = [], tools = new Map()
const services = { workspaceController: controller, workspaceRegistry: registry, agents: { list: () => [] } }
const ctx = {
  get: (name) => services[name], logger: () => ({ info() {}, warn() {}, error() {} }),
  on() { return () => {} }, effect(fn) { effects.push(fn()) },
  tools: { register(tool) { tools.set(tool.name, tool); return () => {} }, guard() { return () => {} } },
  webServer: { register(route) { routes.push(route); return () => {} } },
}
apply(ctx, {})
async function until(check, ms = 8000) {
  const end = Date.now() + ms
  while (!(await check())) { if (Date.now() > end) throw new Error('timeout'); await new Promise((r) => setTimeout(r, 20)) }
}
await until(() => routes.length > 0)
const server = createServer((q, s) => routes[0].handler(q, s))
await new Promise((r) => server.listen(0, '127.0.0.1', r))
const url = `http://127.0.0.1:${server.address().port}/dsh-feishu/api/state`
const state = async () => (await (await fetch(url)).json()).state
const task = async (id) => (await state()).tasks.find((t) => t.id === id)

try {
  /* 1. 首次只记基线：历史上早就归档的 s-old 不会被补完成。 */
  await until(async () => Array.isArray((await state()).archivedSessionBaseline))
  assert.deepEqual((await state()).archivedSessionBaseline, ['s-old'])
  assert.equal((await task('old')).done, false)
  console.log('✓ first run records baseline only; pre-existing archives are not mass-completed')

  /* 2. 工作区里新归档 s-live / s-held / s-already → 只有 live 自动完成，绑定保留，不再重复归档。 */
  archived.add('s-live'); archived.add('s-held'); archived.add('s-already')
  push({ type: 'archived', value: { sessionId: 's-live' } })
  await until(async () => (await task('live')).done === true)
  const live = await task('live')
  assert.equal(live.sessionId, 's-live', 'binding kept')
  assert.equal(live.started, true)
  assert.ok(live.endAt > 0)
  assert.equal(live.completedLocally, true)
  assert.equal(calls.archive.length, 0, 'session not archived a second time')
  const cli = (await readFile(LOG, 'utf8')).trim().split('\n').map((l) => JSON.parse(l))
  assert.equal(cli.filter((a) => a[1] === 'complete').length, 1, 'only one Feishu completion written')
  assert.equal((await task('held')).done, false, 'suspended task untouched')
  assert.equal((await task('already')).completedAt, 5, 'already-done task untouched')
  const s = await state()
  assert.equal(s.bindings.live.sessionId, 's-live')
  assert.ok(s.archivedSessionBaseline.includes('s-live'))
  console.log('✓ newly archived session completes its bound task and keeps the binding')

  /* 3. 同一归档再来一帧：幂等，不重复写飞书。 */
  push({ type: 'archived', value: { sessionId: 's-live' } })
  await new Promise((r) => setTimeout(r, 1200))
  const again = (await readFile(LOG, 'utf8')).trim().split('\n').map((l) => JSON.parse(l))
  assert.equal(again.filter((a) => a[1] === 'complete').length, 1)
  console.log('✓ repeated archive frames are idempotent')

  /* 4. 未绑定会话的任务：模型工具按编号/标题即可置完成，不要求先开工绑定。 */
  const { resolveTaskRef } = await import('../index.js')
  const list = (await state()).tasks
  assert.equal(resolveTaskRef(list, 'T9').task.id, 'free')
  assert.equal(resolveTaskRef(list, '9').task.id, 'free')
  assert.equal(resolveTaskRef(list, '未绑定').task.id, 'free')
  assert.match(resolveTaskRef(list, 'Fixture').error, /命中 \d+ 条/)
  assert.match(resolveTaskRef(list, 'T99').error, /没找到编号/)
  await until(() => tools.has('feishu_task_report'))
  const reply = await tools.get('feishu_task_report').execute({ taskId: 'T9', complete: true }, { agent: { id: 'some-unbound-session' } })
  assert.match(String(reply), /已置完成/)
  const free = await task('free')
  assert.equal(free.done, true)
  assert.equal(free.sessionId ?? null, null)
  const hint = await tools.get('feishu_task_report').execute({ complete: true }, { agent: { id: 'some-unbound-session' } })
  assert.match(String(hint), /传 taskId/)
  console.log('✓ unbound task completes via feishu_task_report taskId (T<n> / title), no binding required')
} finally {
  for (const fn of effects.reverse()) await fn?.()
  server.closeAllConnections()
  await new Promise((r) => server.close(r))
}
