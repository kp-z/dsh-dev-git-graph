#!/usr/bin/env node
/** Card comment HTTP regression: real Host apply + native fake Python/CLI only.
 * Never runs smoke, credentials, the real Feishu CLI, or a real Feishu API.
 * Each subprocess and all durable state are confined to a fresh DSH_HOME.
 */
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { execFileSync } from 'node:child_process'
import { chmod, mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const HOME = await mkdtemp(join(tmpdir(), 'dsh-feishu-card-comments-'))
const previousHome = process.env.DSH_HOME
process.env.DSH_HOME = HOME
const DATA = join(HOME, 'dsh-feishu')
await mkdir(DATA, { recursive: true })
const CLI = join(HOME, 'fake-cli'), PYTHON = join(HOME, 'fake-python')
const REMOTE = join(HOME, 'remote.json'), LOG = join(HOME, 'calls.jsonl'), RUNTIME = join(HOME, 'runtime.cjs')
const key = (taskId, commentId) => JSON.stringify([taskId, commentId])
const human = (id, content, author = 'owner', created_at = '1') => ({ id, content, creator: { id: author, type: 'user' }, created_at })
const tasks = [
  { id: 't', title: 'Card comments', sessionId: 's', done: false, started: true, tasklistGuid: 'list', members: [{ id: 'owner', role: 'assignee', type: 'user' }], customFields: [], meta: {} },
  { id: 'unbound', title: 'Unbound', done: false, members: [], customFields: [], meta: {} },
  { id: 'done', title: 'Completed', sessionId: 'done-session', done: true, members: [], customFields: [], meta: {} },
]
const seedEntry = (id, seq, extra) => ({ key: key('t', id), seq, taskId: 't', commentId: id, sessionId: 's', text: id, authorId: 'someone', authorType: 'user', owner: false, mode: 'reply', requestId: `feishu-comment:${key('t', id)}`, createdAt: 1, ...extra })
await writeFile(REMOTE, JSON.stringify({
  items: [human('owner-history', '负责人历史评论'), human('human-history', '🤖: 这是人的历史问题', 'someone', '2'), human('ignored-history', '曾因模式关闭而忽略', 'someone', '3'), human('replied-history', '已经回复', 'someone', '4'), human('own-ai', '🤖: 插件自己的回复', 'owner', '5'), { id: 'bot', content: 'app comment', creator: { id: 'bot', type: 'app' }, created_at: '6' }, { id: 'anonymous', content: 'missing author', creator: { type: 'user' }, created_at: '7' }],
  done: false, incomplete: false, counter: 0, wrongGuid: false,
}))
await writeFile(join(DATA, 'state.json'), JSON.stringify({ tasks, schedules: {}, relations: [] }))
await writeFile(join(DATA, 'settings.json'), JSON.stringify({ cliPath: CLI, autoSync: false, autoStart: 'off', autoComment: true, comments: { enabled: true, ownerMode: 'execute', otherMode: 'reply', maxPerSync: 5 } }))
await writeFile(join(DATA, 'comments.json'), JSON.stringify({
  version: 1, nextSeq: 3, tasks: { [key('t', '')]: { baseline: false, seen: {} } },
  inbox: [seedEntry('ignored-history', 1, { status: 'ignored', reason: 'mode-off' }), seedEntry('replied-history', 2, { status: 'replied', outboundCommentId: 'own-ai', turnEnded: true, turn: 0 })],
  outbound: { [key('t', 'fixture-reply')]: { taskId: 't', key: 'fixture-reply', status: 'sent', commentId: 'own-ai', payload: { text: '🤖: 插件自己的回复', replyTo: 'replied-history', mentionIds: ['someone'] }, createdAt: 1 } },
}))
await writeFile(RUNTIME, `const fs=require('node:fs');
const file=${JSON.stringify(REMOTE)},log=${JSON.stringify(LOG)};
const state=JSON.parse(fs.readFileSync(file,'utf8'));
const args=process.argv.slice(3);
if(process.argv[2]===${JSON.stringify(CLI)}) {
 fs.appendFileSync(log,JSON.stringify({cli:args})+'\\n');
 if(args[0]==='version')console.log('feishu-sync 1.0.0');
 else if(args[0]==='task'&&args[1]==='list'){console.error('offline fixture: preserve local tasks');process.exitCode=1;}
 else {console.error('unexpected fake CLI command');process.exitCode=2;}
} else {
 let raw='';process.stdin.on('data',chunk=>raw+=chunk);process.stdin.on('end',()=>{
 const payload=JSON.parse(raw);fs.appendFileSync(log,JSON.stringify(payload)+'\\n');
 const actions=(payload.actions||[]).map(a=>{
  if(!a.task||a.task==='undefined'||a.task==='null')throw new Error('P0: unsafe task ID reached fake API: '+JSON.stringify(a));
  if(a.op==='task_get')return {op:a.op,ok:true,task:{guid:state.wrongGuid?'wrong-task':a.task,members:[{id:'owner',type:'user',role:'assignee'}],completed_at:state.done?'100':'0'}};
  if(a.op==='task_comments')return {op:a.op,ok:!state.incomplete,incomplete:state.incomplete,has_more:state.incomplete,page_token:state.incomplete?'next-page':'',items:state.items};
  if(a.op==='task_comment'){
   const id='out-'+(++state.counter);state.items.push({id,content:a.text,creator:{id:'owner',type:'user'},created_at:String(100+state.counter),reply_to_comment_id:a.reply_to_comment_id});
   fs.writeFileSync(file,JSON.stringify(state));return {op:a.op,ok:true,commentId:id,mentionSupported:false,warning:'native fake reply fallback'};
  }
  if(['task_subtasks','task_attachments','task_dependencies'].includes(a.op))return {op:a.op,ok:true,items:[]};
  throw new Error('Unexpected fake API action '+a.op);
 });console.log(JSON.stringify({ok:true,actions,errors:[],tasklists:{},fields:{},users:{}}));
 });
}
`)
// Native launcher avoids macOS executable-script interpreter chains. It routes
// production feishu_api.py invocations directly into the Node fake above.
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
const actions = async () => (await calls()).flatMap((p) => p.actions ?? [])
const writes = async () => (await actions()).filter((a) => a.op === 'task_comment')
const disk = async () => JSON.parse(await readFile(join(DATA, 'comments.json'), 'utf8'))
async function until(check, label) {
  const deadline = Date.now() + 10000
  while (!(await check())) { if (Date.now() > deadline) throw new Error(`Timeout: ${label}`); await new Promise((resolve) => setTimeout(resolve, 20)) }
}
async function fakeRuntime() {
  const routes = [], tools = new Map(), events = new Map(), guards = [], effects = [], prompts = [], errors = [], urls = []
  const controls = { busy: false }
  const services = {
    agents: { get: (id) => id === 's' ? { id, phase: { kind: controls.busy ? 'running' : 'idle' } } : undefined, list: () => [] },
    sessionController: { prompt: async (request) => { prompts.push(structuredClone(request)) }, inspect: async () => ({ session: { title: 'Card comments' } }) },
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
  const server = createServer((req, res) => { urls.push(req.url); routes[0].handler(req, res) })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const base = `http://127.0.0.1:${server.address().port}/dsh-feishu`
  async function request(path, body) {
    const response = await fetch(base + path, { ...(body !== undefined ? { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(10000) })
    return { status: response.status, body: await response.json() }
  }
  return { tools, events, guards, prompts, controls, urls, request,
    history: async (id = 't', refresh = true) => request(`/api/tasks/comments?taskId=${encodeURIComponent(id)}${refresh ? '&refresh=true' : ''}`),
    submit: (commentId, taskId = 't') => request('/api/comments/action', { action: 'submit', taskId, commentId }),
    rows: async () => (await request('/api/comments')).body.entries,
    async settings(patch) {
      const current = (await request('/api/state')).body.settings
      const result = await request('/api/settings', { ...current, comments: { ...current.comments, ...patch } })
      assert.equal(result.status, 200); return result.body.settings
    },
    step: (text, turn) => events.get('agent/pre-step')[0]({ agent: { id: 's' }, turn }, async () => ({ kind: 'enter', messages: [{ role: 'user', content: [{ type: 'text', text }] }] })),
    guard: (name, args = {}) => guards[0]({ name, arguments: args, agent: { id: 's' } }),
    event: (type, data = {}) => events.get('session/event').forEach((fn) => fn({ id: 's' }, { type, data })),
    async sync() {
      const before = (await request('/api/state')).body.state.lastSyncAt
      await request('/api/sync', {})
      await until(async () => { const state = (await request('/api/state')).body.state; return !state.syncing && state.lastSyncAt !== before }, 'manual offline sync')
    },
    async close() {
      effects.reverse().forEach((off) => off()); server.closeAllConnections(); await new Promise((resolve) => server.close(resolve))
      await until(async () => { try { await readFile(join(DATA, 'comments.json.lock')); return false } catch { return true } }, 'comment lock disposal')
    },
  }
}
let checks = 0
const failures = []
const app = await fakeRuntime()
async function test(name, fn) {
  try { await fn(); checks++; console.log(`✓ ${name}`) }
  catch (error) { failures.push({ name, error }); console.error(`✗ ${name}\n${error.stack}`) }
}
async function reject(commentId, taskId = 't') {
  const before = app.prompts.length, beforeWrites = (await writes()).length
  const result = await app.submit(commentId, taskId)
  assert.equal(result.status, 400); assert.equal(result.body.ok, false)
  assert.equal(app.prompts.length, before); assert.equal((await writes()).length, beforeWrites)
  return result.body
}
async function finish(commentId, prompt, turn, permission) {
  assert.equal((await app.step(prompt.content[0].text, turn)).kind, 'enter')
  await until(async () => (await app.rows()).find((row) => row.commentId === commentId)?.status === 'running', `${commentId} running`)
  const entry = (await app.rows()).find((row) => row.commentId === commentId)
  assert.equal(entry.maxPermission, permission)
  if (permission === 'reply') assert.match(app.guard('bash', { command: 'true' }), /非负责人/)
  else assert.equal(app.guard('bash', { command: 'true' }), undefined)
  const result = await app.tools.get('feishu_comment_reply').execute({ taskId: 't', commentId, text: 'isolated test answer' }, { agent: { id: 's' } })
  assert.match(result, /已回复评论 out-/)
  app.event('assistant/message', { content: [{ type: 'text', text: 'done' }] })
  app.event('turn/end', { turn, reason: 'complete' })
  await until(async () => (await app.rows()).find((row) => row.commentId === commentId)?.turnEnded, `${commentId} ended`)
}
try {
  await test('GET complete history includes durable ignored/replied + own-ledger overlay and never processes', async () => {
    const before = await disk(), result = await app.history()
    assert.equal(result.status, 200); assert.equal(result.body.ok, true)
    assert.equal(result.body.comments.ok, true); assert.equal(result.body.comments.complete, true)
    assert.equal(result.body.comments.items.length, 7)
    assert.equal(result.body.sessionId, 's'); assert.equal(result.body.enabled, true)
    assert.equal(result.body.comments.items.find((row) => row.id === 'human-history').content, '🤖: 这是人的历史问题')
    assert.equal(result.body.entries.find((row) => row.commentId === 'ignored-history').status, 'ignored')
    assert.equal(result.body.entries.find((row) => row.commentId === 'replied-history').status, 'replied')
    const own = result.body.entries.filter((row) => row.commentId === 'own-ai')
    assert.equal(own.length, 1); assert.equal(own[0].status, 'ignored'); assert.equal(own[0].reason, 'outbound-ledger')
    assert.equal(result.body.diagnostic.baseline, false)
    assert.equal(app.prompts.length, 0); assert.equal((await writes()).length, 0)
    assert.deepEqual(await disk(), before, 'GET must not scan/mark seen/baseline or persist overlay')
    await app.history(); assert.deepEqual(await disk(), before); assert.equal(app.prompts.length, 0)
  })
  await test('first offline sync baselines history and diagnostics without dispatch', async () => {
    await app.sync()
    assert.equal(app.prompts.length, 0)
    const result = (await app.history()).body
    assert.equal(result.diagnostic.baseline, true); assert.equal(result.diagnostic.complete, true)
    assert.equal(result.diagnostic.readCount, 7); assert.equal(result.diagnostic.newCount, 0)
    assert.match(result.diagnostic.reason, /首次/)
    assert.equal((await app.rows()).length, 2); assert.equal((await writes()).length, 0)
  })
  await test('POST rejects missing task/comment IDs and invalid bindings without unsafe API requests', async () => {
    const before = (await actions()).length
    for (const body of [{ action: 'submit', commentId: 'owner-history' }, { action: 'submit', taskId: 't' }, { action: 'submit' }]) {
      const response = await app.request('/api/comments/action', body)
      assert.equal(response.status, 400); assert.equal(response.body.ok, false)
    }
    for (const path of ['/api/tasks/comments', '/api/tasks/comments?taskId=', '/api/tasks/comments?taskId=undefined']) {
      const response = await app.request(path); assert.equal(response.status, 400); assert.equal(response.body.ok, false)
    }
    await reject('owner-history', 'unbound'); await reject('owner-history', 'done'); await reject('owner-history', 'missing')
    assert.equal(app.prompts.length, 0)
    assert.ok((await actions()).slice(before).every((row) => row.task && row.task !== 'undefined' && row.task !== 'null'))
  })
  await test('POST checks current enabled/owner/other modes, not client mode or checked bypass', async () => {
    await app.settings({ enabled: false }); await reject('owner-history')
    await app.settings({ enabled: true, ownerMode: 'off', otherMode: 'off' })
    await reject('owner-history'); await reject('human-history')
    const bypass = await app.request('/api/comments/action', { action: 'submit', taskId: 't', commentId: 'owner-history', mode: 'execute', checked: true })
    assert.equal(bypass.status, 400); assert.equal(bypass.body.ok, false); assert.equal(app.prompts.length, 0)
    await app.settings({ ownerMode: 'execute', otherMode: 'reply' })
  })
  await test('POST rejects incomplete scans, completed/wrong remote GUID, absent author and nonhuman author', async () => {
    await update({ incomplete: true }); await reject('owner-history')
    const partial = await app.history(); assert.equal(partial.status, 200)
    assert.equal(partial.body.comments.complete, false); assert.equal(partial.body.comments.ok, false)
    assert.equal(partial.body.comments.items.length, 7)
    await update({ incomplete: false, done: true }); await reject('owner-history')
    await update({ done: false, wrongGuid: true }); await reject('owner-history')
    await update({ wrongGuid: false }); await reject('anonymous'); await reject('bot'); await reject('missing-comment')
  })
  await test('historical POST enters busy pending, repeats never duplicate, later sync delivers once', async () => {
    app.controls.busy = true
    const first = await app.submit('human-history')
    assert.equal(first.status, 200); assert.equal(first.body.ok, true); assert.equal(first.body.status, 'pending'); assert.match(first.body.reason, /等待/)
    assert.equal(app.prompts.length, 0)
    const entry = (await app.rows()).find((row) => row.commentId === 'human-history')
    assert.equal(entry.manual, true); assert.equal(entry.sessionId, 's'); assert.equal(entry.mode, 'reply')
    await reject('human-history'); await app.sync(); assert.equal(app.prompts.length, 0)
    const beforeRead = await disk(); const waiting = await app.history()
    assert.equal(waiting.body.entries.find((row) => row.commentId === 'human-history').status, 'pending')
    assert.deepEqual(await disk(), beforeRead, 'GET must not drain busy pending entries')
    app.controls.busy = false
    const beforeIdleRead = await disk()
    await app.history()
    assert.equal(app.prompts.length, 0, 'GET must not drain pending entries even when the session is now idle')
    assert.deepEqual(await disk(), beforeIdleRead)
    await app.sync()
    assert.equal(app.prompts.length, 1); assert.equal(app.prompts[0].sessionId, 's'); assert.equal(app.prompts[0].mode, 'queue')
    assert.match(app.prompts[0].content[0].text, /这是人的历史问题/)
    await reject('human-history'); await app.sync(); assert.equal(app.prompts.length, 1)
    assert.equal((await app.rows()).filter((row) => row.commentId === 'human-history').length, 1)
    await finish('human-history', app.prompts[0], 1, 'reply')
  })
  await test('replied and AI-owned comments cannot resubmit; newly sent own ID overlays GET without echo', async () => {
    await reject('human-history'); await reject('replied-history'); await reject('own-ai'); await reject('out-1')
    const before = await disk(), beforePrompts = app.prompts.length, beforeWrites = (await writes()).length
    const history = (await app.history()).body
    assert.equal(history.comments.items.length, 8)
    const overlay = history.entries.filter((row) => row.commentId === 'out-1')
    assert.equal(overlay.length, 1); assert.equal(overlay[0].status, 'ignored'); assert.equal(overlay[0].reason, 'outbound-ledger')
    assert.deepEqual(await disk(), before); assert.equal(app.prompts.length, beforePrompts); assert.equal((await writes()).length, beforeWrites)
    const write = (await writes())[0]
    assert.equal(write.task, 't'); assert.equal(write.reply_to_comment_id, 'human-history'); assert.deepEqual(write.mentionIds, ['someone'])
  })
  await test('historical owner mode executes in the valid bound session with no duplicate submit', async () => {
    const result = await app.submit('owner-history')
    assert.equal(result.status, 200); assert.equal(result.body.ok, true); assert.equal(result.body.status, 'delivered')
    assert.equal(app.prompts.length, 2)
    const entry = (await app.rows()).find((row) => row.commentId === 'owner-history')
    assert.equal(entry.owner, true); assert.equal(entry.mode, 'execute'); assert.equal(entry.maxPermission, 'owner')
    assert.equal(entry.sessionId, 's'); await reject('owner-history')
    await finish('owner-history', app.prompts[1], 2, 'owner'); await reject('owner-history')
  })
  await test('ignored history may be explicitly submitted after checked mode enables, never twice', async () => {
    const result = await app.submit('ignored-history')
    assert.equal(result.status, 200); assert.equal(result.body.ok, true)
    assert.equal(app.prompts.length, 3)
    const rows = (await app.rows()).filter((row) => row.commentId === 'ignored-history')
    assert.equal(rows.length, 1); assert.equal(rows[0].manual, true); assert.equal(rows[0].mode, 'reply')
    await reject('ignored-history'); await finish('ignored-history', app.prompts[2], 3, 'reply')
  })
  await test('test uses isolated fake runtime and no undefined API task or HTTP URL is emitted', async () => {
    assert.equal(process.env.DSH_HOME, HOME); assert.ok(HOME.startsWith(tmpdir()))
    assert.ok((await calls()).some((row) => row.cli?.[0] === 'version'))
    assert.ok((await actions()).some((row) => row.op === 'task_get'))
    assert.ok((await actions()).every((row) => row.task && !['undefined', 'null'].includes(row.task)))
    // The one literal taskId=undefined URL above is an intentional hostile input,
    // not a generated request. Reject it without forwarding to the remote bridge.
    assert.ok(app.urls.filter((url) => url !== '/dsh-feishu/api/tasks/comments?taskId=undefined').every((url) => !url.includes('undefined')))
    assert.equal((await writes()).length, 3)
  })
  console.log(`\n${checks} offline card-comment Host checks passed; ${failures.length} failed.`)
  if (failures.length) throw new AggregateError(failures.map((row) => row.error), failures.map((row) => row.name).join('; '))
} finally {
  await app.close()
  if (previousHome == null) delete process.env.DSH_HOME; else process.env.DSH_HOME = previousHome
}
