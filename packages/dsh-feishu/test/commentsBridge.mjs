#!/usr/bin/env node
/** Real Host apply/HTTP/tools/events wiring with isolated native fake CLI. No Feishu IO. */
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { execFileSync } from 'node:child_process'
import { chmod, mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const HOME = await mkdtemp(join(tmpdir(), 'dsh-feishu-comments-'))
const previousHome = process.env.DSH_HOME
process.env.DSH_HOME = HOME
const DATA = join(HOME, 'dsh-feishu')
await mkdir(DATA, { recursive: true })
const CLI = join(HOME, 'fake-cli'), PYTHON = join(HOME, 'fake-python'), REMOTE = join(HOME, 'remote.json'), LOG = join(HOME, 'calls.jsonl'), RUNTIME = join(HOME, 'runtime.cjs')
const tasks = [{ id: 't', title: 'Comment task', sessionId: 's', done: false, started: true, tasklistGuid: 'list', members: [{ id: 'owner', role: 'assignee' }], customFields: [], meta: {} }, { id: 'other', title: 'Unbound', done: false, members: [], customFields: [], meta: {} }]
await writeFile(REMOTE, JSON.stringify({ items: [{ id: 'history', content: 'historical', creator: { id: 'owner', type: 'user' }, created_at: '1' }], done: false, incomplete: false, counter: 0, failWrite: false }))
await writeFile(join(DATA, 'state.json'), JSON.stringify({ tasks, schedules: {}, relations: [] }))
await writeFile(join(DATA, 'settings.json'), JSON.stringify({ cliPath: CLI, autoSync: false, autoStart: 'off', autoComment: true, comments: { enabled: true, ownerMode: 'execute', otherMode: 'reply', maxPerSync: 5 } }))
await writeFile(RUNTIME, `const fs=require('node:fs');
const file=${JSON.stringify(REMOTE)}, log=${JSON.stringify(LOG)};
const state=JSON.parse(fs.readFileSync(file,'utf8'));
const save=()=>fs.writeFileSync(file,JSON.stringify(state));
const args=process.argv.slice(3);
if(process.argv[2]===${JSON.stringify(CLI)}) {
 fs.appendFileSync(log,JSON.stringify({cli:args})+'\\n');
 if(args[0]==='version') console.log('feishu-sync 1.0.0');
 else if(args[0]==='task' && args[1]==='list') { console.error('intentional offline list failure: preserve local tasks'); process.exitCode=1; }
 else {console.error('unexpected fake CLI command'); process.exitCode=2;}
} else {
 let raw='';process.stdin.on('data',chunk=>raw+=chunk);process.stdin.on('end',()=>{
 const payload=JSON.parse(raw);fs.appendFileSync(log,JSON.stringify(payload)+'\\n');
 const actions=(payload.actions||[]).map(a=>{
 if(a.op==='task_get') return {op:a.op,ok:true,task:{guid:state.wrongGuid?'wrong-task':a.task,members:[{id:'owner',type:'user',role:'assignee'}],completed_at:state.done?'100':'0'}};
 if(a.op==='task_comments') return {op:a.op,ok:!state.incomplete,incomplete:state.incomplete,items:state.items};
 if(a.op==='task_comment') {
  if(state.failWrite)return {op:a.op,ok:false,unknownDelivery:true,error:'fake timeout'};
  const id='out-'+(++state.counter); state.items.push({id,content:a.text,creator:{id:'owner',type:'user'},created_at:String(100+state.counter)});save();
  return {op:a.op,ok:true,commentId:id,mentionSupported:false,warning:'native reply fallback'};
 }
 if(['task_subtasks','task_attachments','task_dependencies'].includes(a.op))return {op:a.op,ok:true,items:[]};
 return {op:a.op,ok:true};
 });console.log(JSON.stringify({ok:true,actions,errors:[],tasklists:{},fields:{},users:{}}));
 });
}
`)
// macOS does not allow executable script interpreter chains. A native launcher
// forwards both CLI and production feishu_api.py invocations to this Node fake.
const LAUNCHER = join(HOME, 'launcher.c')
await writeFile(LAUNCHER, `#include <unistd.h>\n#include <stdlib.h>\nint main(int argc,char **argv){char **a=calloc(argc+3,sizeof(char*));a[0]=${JSON.stringify(process.execPath)};a[1]=${JSON.stringify(RUNTIME)};for(int i=1;i<argc;i++)a[i+1]=argv[i];execv(a[0],a);return 127;}\n`)
execFileSync('cc', [LAUNCHER, '-o', PYTHON])
await chmod(PYTHON, 0o700)
await writeFile(CLI, `#!${PYTHON}\n`)
await chmod(CLI, 0o700)
const { apply } = await import('../index.js')
const remote = async () => JSON.parse(await readFile(REMOTE, 'utf8'))
const update = async (patch) => writeFile(REMOTE, JSON.stringify({ ...await remote(), ...patch }))
const calls = async () => (await readFile(LOG, 'utf8').catch(() => '')).trim().split('\n').filter(Boolean).map(JSON.parse)
const writes = async () => (await calls()).flatMap((p) => p.actions ?? []).filter((a) => a.op === 'task_comment')
async function until(check, label) {
  const deadline = Date.now() + 10000
  while (!(await check())) { if (Date.now() > deadline) throw new Error(`Timeout: ${label}`); await new Promise((resolve) => setTimeout(resolve, 20)) }
}
async function boot() {
  const routes = [], tools = new Map(), events = new Map(), guards = [], effects = [], errors = [], prompts = []
  const controls = { failPrompt: false }
  const services = {
    agents: { get: (id) => id === 's' ? { id, phase: { kind: 'idle' } } : undefined, list: () => [] },
    sessionController: { prompt: async (request) => { prompts.push(structuredClone(request)); if (controls.failPrompt) throw new Error('ACK timeout after accepting queue') }, inspect: async () => ({ session: { title: 'Comment task' } }) },
  }
  const ctx = {
    logger: () => ({ info() {}, warn() {}, error(message) { errors.push(message) } }),
    get: (name) => services[name],
    effect(fn) { const off = fn(); if (typeof off === 'function') effects.push(off); return () => {} },
    on(name, fn) { const rows = events.get(name) ?? []; rows.push(fn); events.set(name, rows); return () => { const index = rows.indexOf(fn); if (index >= 0) rows.splice(index, 1) } },
    tools: { register(tool) { tools.set(tool.name, tool); return () => tools.delete(tool.name) }, guard(fn) { guards.push(fn); return () => guards.splice(guards.indexOf(fn), 1) } },
    webServer: { register(route) { routes.push(route); return () => {} } },
  }
  apply(ctx, {})
  await until(() => routes.length && tools.has('feishu_comment_reply'), `apply registrations: ${errors}`)
  const server = createServer((req, res) => routes[0].handler(req, res))
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const base = `http://127.0.0.1:${server.address().port}/dsh-feishu`
  async function request(path, body) {
    const response = await fetch(base + path, { ...(body ? { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(10000) })
    return { status: response.status, body: await response.json() }
  }
  return { tools, events, guards, prompts, errors, controls, request,
    rows: async () => (await request('/api/comments')).body.entries,
    step: async (text, turn = 1) => events.get('agent/pre-step')[0]({ agent: { id: 's' }, turn }, async () => ({ kind: 'enter', messages: [{ role: 'user', content: [{ type: 'text', text }] }] })),
    guard: (name, args = {}, sid = 's') => guards[0]({ name, arguments: args, agent: { id: sid } }),
    event: (type, data = {}) => events.get('session/event').forEach((fn) => fn({ id: 's' }, { type, data })),
    async sync() {
      const before = (await request('/api/state')).body.state.lastSyncAt
      await request('/api/sync', {})
      await until(async () => { const state = (await request('/api/state')).body.state; return !state.syncing && state.lastSyncAt !== before }, 'manual sync completion')
    },
    async close() { effects.reverse().forEach((off) => off()); server.closeAllConnections(); await new Promise((resolve) => server.close(resolve)); await until(async () => { try { await readFile(join(DATA, 'comments.json.lock')); return false } catch { return true } }, 'comment lock disposal') },
  }
}
let checks = 0, app = await boot()
async function test(name, fn) { await fn(); checks++; console.log(`✓ ${name}`) }
try {
  await test('apply registers HTTP comment endpoints, scoped reply tool and Host guards', async () => {
    assert.equal(app.guards.length, 1); assert.equal(app.events.get('agent/pre-step').length, 1)
    assert.ok(app.tools.get('feishu_comment_reply').parameters.properties.commentId)
    const got = await app.request('/api/comments'); assert.equal(got.status, 200); assert.deepEqual(got.body.entries, [])
    const bad = await app.request('/api/comments/action', { action: 'other', taskId: 't', commentId: 'missing' }); assert.equal(bad.body.ok, false)
    const unscoped = await app.tools.get('feishu_comment_reply').execute({ commentId: 'missing', text: 'no' }, { agent: { id: 's' } }); assert.match(unscoped, /回复失败/)
  })
  await test('real sync wiring baselines all history, then queues only new comment in bound session', async () => {
    await app.sync(); assert.equal(app.prompts.length, 0); assert.deepEqual(await app.rows(), [])
    const r = await remote(); r.items.push({ id: 'question', content: '🤖: human question', creator: { type: 'user', id: 'someone' }, created_at: '2' }); await update(r)
    await app.sync(); assert.equal(app.prompts.length, 1)
    const prompt = app.prompts[0]; assert.equal(prompt.sessionId, 's'); assert.equal(prompt.mode, 'queue'); assert.match(prompt.requestId, /question/)
    assert.match(prompt.content[0].text, /human question/); assert.equal((await app.rows())[0].status, 'delivered')
    await app.sync(); assert.equal(app.prompts.length, 1)
  })
  await test('queued mismatch rejects rather than admitting an unguarded comment turn', async () => {
    assert.equal((await app.step('different user input', 1)).kind, 'reject')
    assert.equal((await app.step('prefix ' + app.prompts[0].content[0].text, 1)).kind, 'reject')
    assert.equal((await app.rows())[0].status, 'delivered')
  })
  await test('pre-step exact comment correlation activates reply-only guard for the entire turn', async () => {
    assert.equal((await app.step(app.prompts[0].content[0].text, 1)).kind, 'enter')
    await until(async () => (await app.rows())[0].status === 'running', 'durable markRunning')
    assert.match(app.guard('bash', { command: 'true' }), /非负责人/)
    assert.match(app.guard('session_event_read', {}), /非负责人/)
    assert.match(app.guard('feishu_task_detail', { taskId: 'other' }), /非负责人/)
    assert.equal(app.guard('feishu_task_detail', { taskId: 't' }), undefined)
    assert.equal(app.guard('feishu_comment_reply', { commentId: 'question', taskId: 't' }), undefined)
    assert.match(app.guard('feishu_comment_reply', { commentId: 'wrong', taskId: 't' }), /非负责人/)
    assert.equal((await app.step('other turn', 2)).kind, 'reject')
    assert.equal(app.guard('bash', {}, 'other-session'), undefined)
  })
  await test('explicit reply tool matches session/comment and stores outbound remote ID', async () => {
    const tool = app.tools.get('feishu_comment_reply')
    assert.match(await tool.execute({ commentId: 'wrong', text: 'answer' }, { agent: { id: 's' } }), /回复失败/)
    assert.match(await tool.execute({ commentId: 'question', text: 'answer' }, { agent: { id: 'other' } }), /回复失败/)
    assert.match(await tool.execute({ commentId: 'question', taskId: 't', text: 'answer' }, { agent: { id: 's' } }), /已回复评论 out-1/)
    const write = (await writes()).at(-1); assert.equal(write.reply_to_comment_id, 'question'); assert.deepEqual(write.mentionIds, ['someone']); assert.equal(write.allowMentionFallback, true); assert.equal(write.text, '🤖: answer')
    assert.equal((await app.rows())[0].outboundCommentId, 'out-1')
    assert.match(app.guard('bash', {}), /非负责人/)
  })
  await test('plugin reload restores durable reply-only turn guard without any redelivery', async () => {
    const prompts = app.prompts
    await app.close(); app = await boot(); app.prompts.push(...prompts)
    assert.equal((await app.step('unrelated turn', 99)).kind, 'reject')
    assert.equal((await app.step('resume current turn', 1)).kind, 'enter')
    assert.match(app.guard('bash', {}), /非负责人/)
    assert.equal((await app.rows())[0].status, 'replied')
    assert.equal(app.prompts.length, 1)
  })
  await test('comment turn end suppresses legacy autoComment and releases guard only after end', async () => {
    const before = (await writes()).length
    app.event('tool/call', { name: 'edit', args: { file_path: 'fake-file.js' } }); app.event('assistant/message', { content: [{ type: 'text', text: 'edited and tested' }] }); app.event('turn/end', { turn: 1, reason: 'complete' })
    await until(async () => (await app.rows())[0].turnEnded, 'durable turn end')
    assert.equal((await writes()).length, before); assert.equal(app.guard('bash', {}), undefined)
  })
  await test('fake API outbound ledger avoids echo loop without author or prefix filtering', async () => {
    await app.sync(); assert.equal(app.prompts.length, 1)
    const echo = (await app.rows()).find((entry) => entry.commentId === 'out-1'); assert.equal(echo.status, 'ignored'); assert.equal(echo.reason, 'outbound-ledger')
    const r = await remote(); r.items.push({ id: 'owner-new', content: '🤖: answer', creator: { id: 'owner', type: 'user' }, created_at: '200' }); await update(r)
    await app.sync(); assert.equal(app.prompts.length, 2)
    const newest = (await app.rows()).find((entry) => entry.commentId === 'owner-new'); assert.equal(newest.mode, 'execute'); assert.equal(newest.maxPermission, 'owner')
    await app.step(app.prompts[1].content[0].text, 2); assert.equal(app.guard('bash', {}), undefined)
    await until(async () => (await app.rows()).find((entry) => entry.commentId === 'owner-new').status === 'running', 'owner running')
    app.event('turn/end', { turn: 2 }); await until(async () => (await app.rows()).find((entry) => entry.commentId === 'owner-new').status === 'unknown', 'explicit missing completion')
    const ignored = await app.request('/api/comments/action', { action: 'ignore', taskId: 't', commentId: 'owner-new' }); assert.equal(ignored.body.ok, true)
  })
  await test('incomplete scans and remotely completed task produce no new delivery', async () => {
    const r = await remote(); r.items.push({ id: 'partial', content: 'new', creator: { id: 'owner', type: 'user' }, created_at: '300' }); await update({ ...r, incomplete: true }); await app.sync()
    assert.equal((await app.rows()).some((entry) => entry.commentId === 'partial'), false)
    await update({ incomplete: false, done: true }); await app.sync(); assert.equal(app.prompts.length, 2)
    await update({ done: false, wrongGuid: true }); await app.sync(); assert.equal(app.prompts.length, 2)
    assert.equal((await app.rows()).some((entry) => entry.commentId === 'partial'), false)
    await update({ wrongGuid: false }); await app.sync(); assert.equal(app.prompts.length, 3)
  })
  await test('restart rejects late delivery recovered from delivered to unknown without redelivery', async () => {
    const text = app.prompts[2].content[0].text
    await app.close(); app = await boot()
    assert.equal((await app.step(text, 3)).kind, 'reject')
    assert.equal((await app.rows()).find((row) => row.commentId === 'partial').status, 'unknown')
    await app.sync(); assert.equal(app.prompts.length, 0)
    assert.equal((await app.request('/api/comments/action', { action: 'ignore', taskId: 't', commentId: 'partial' })).body.ok, true)
  })
  await test('prompt timeout after queue acceptance rejects late execution and does not auto-redeliver', async () => {
    const r = await remote(); r.items.push({ id: 'late', content: 'untrusted question', creator: { id: 'someone', type: 'user' }, created_at: '400' }); await update(r)
    app.controls.failPrompt = true; await app.sync()
    assert.equal(app.prompts.length, 1)
    assert.equal((await app.rows()).find((row) => row.commentId === 'late').status, 'unknown')
    assert.equal((await app.step(app.prompts[0].content[0].text, 4)).kind, 'reject')
    assert.equal((await app.step(app.prompts[0].content[0].text, 4)).kind, 'reject')
    await app.sync(); assert.equal(app.prompts.length, 1)
  })
  await test('disabled collaboration restart still rejects persisted late comment before any API read', async () => {
    const text = app.prompts[0].content[0].text
    const settings = (await app.request('/api/state')).body.settings
    const disabled = await app.request('/api/settings', { ...settings, comments: { ...settings.comments, enabled: false } })
    assert.equal(disabled.body.settings.comments.enabled, false)
    await app.close(); app = await boot()
    // This must be the first coordinator-facing operation after restart: an HTTP
    // comments GET would initialize recovery first and hide the disabled bug.
    assert.equal((await app.step(text, 4)).kind, 'reject')
    assert.equal((await app.step(text, 4)).kind, 'reject')
    assert.equal((await app.rows()).find((row) => row.commentId === 'late').status, 'unknown')
    assert.equal((await app.request('/api/state')).body.settings.comments.enabled, false)
    await app.sync(); assert.equal(app.prompts.length, 0)
  })
  await test('test subprocesses are all fake and state lives only in isolated DSH_HOME', async () => {
    const logs = await calls(); assert.ok(logs.some((p) => p.cli?.[0] === 'version')); assert.ok(logs.some((p) => p.actions?.some((a) => a.op === 'task_get')))
    const disk = JSON.parse(await readFile(join(DATA, 'comments.json'), 'utf8')); assert.equal(disk.version, 1); assert.ok(Object.values(disk.outbound).some((row) => row.commentId === 'out-1'))
    assert.ok(HOME.startsWith(tmpdir())); assert.equal(process.env.DSH_HOME, HOME)
  })
  console.log(`\n${checks} offline comment Host wiring checks passed.`)
} finally {
  await app.close()
  if (previousHome == null) delete process.env.DSH_HOME; else process.env.DSH_HOME = previousHome
}
