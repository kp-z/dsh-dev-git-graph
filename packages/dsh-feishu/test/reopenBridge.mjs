#!/usr/bin/env node
/** Isolated Host lifecycle regression: no real Feishu or session mutation. */
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { execFileSync } from 'node:child_process'
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
const HOME = await mkdtemp(join(tmpdir(), 'feishu-reopen-'))
process.env.DSH_HOME = HOME
const DATA = join(HOME, 'dsh-feishu'); await mkdir(DATA)
const CLI = join(HOME, 'cli'), PY = join(HOME, 'python'), RUNTIME = join(HOME, 'runtime.cjs'), REMOTE = join(HOME, 'remote.json'), LOG = join(HOME, 'calls.jsonl')
const completed = Date.now() - 10000
const tasks = ['done', 'held', 'retry', 'race', 'boot', 'early', 'completion-reload', 'reload', 'open'].map(id => ({ id, title: id, sessionId: 's-' + id, done: id !== 'open', completedAt: completed, endAt: completed, completedLocally: true, started: true, startedAt: 123, docs: [], members: [], customFields: [], meta: {} }))
await writeFile(join(DATA, 'state.json'), JSON.stringify({ tasks, suspensions: { held: { active: true } }, schedules: { done: { untouched: true } } }))
await writeFile(join(DATA, 'settings.json'), JSON.stringify({ cliPath: CLI, autoSync: false, comments: { enabled: false } }))
await writeFile(REMOTE, JSON.stringify({ fail: false, delay: 0 }))
await writeFile(RUNTIME, `const fs=require('node:fs');const log=${JSON.stringify(LOG)},remote=${JSON.stringify(REMOTE)};const args=process.argv.slice(3);if(process.argv[2]===${JSON.stringify(CLI)}){fs.appendFileSync(log,JSON.stringify({cli:args})+'\\n');if(args[0]==='version')console.log('feishu-sync 1.0');else if(args[1]==='complete')setTimeout(()=>console.log('{}'),JSON.parse(fs.readFileSync(remote)).completeDelay||0);else if(args[1]==='list' && JSON.parse(fs.readFileSync(remote)).list)console.log(JSON.stringify(JSON.parse(fs.readFileSync(remote)).list));else{process.exitCode=1;console.error('offline list failure')}}else{let raw='';process.stdin.on('data',c=>raw+=c);process.stdin.on('end',()=>{const p=JSON.parse(raw);fs.appendFileSync(log,JSON.stringify(p)+'\\n');const r=JSON.parse(fs.readFileSync(remote));setTimeout(()=>console.log(JSON.stringify({ok:true,actions:(p.actions||[]).map(a=>({op:a.op,ok:!r.fail,error:r.fail?'offline denied':null})),errors:[]})),r.delay)})}`)
const C = join(HOME, 'launcher.c')
await writeFile(C, `#include <unistd.h>\n#include <stdlib.h>\nint main(int n,char **v){char **a=calloc(n+3,sizeof(char*));a[0]=${JSON.stringify(process.execPath)};a[1]=${JSON.stringify(RUNTIME)};for(int i=1;i<n;i++)a[i+1]=v[i];execv(a[0],a);return 127;}`)
execFileSync('cc', [C, '-o', PY]); await writeFile(CLI, '#!' + PY + '\n')
// CLI needs executable mode, but Python is a compiled native launcher.
const { chmod } = await import('node:fs/promises'); await chmod(CLI, 0o700)
const { apply } = await import('../index.js')
const logs = async () => (await readFile(LOG, 'utf8').catch(() => '')).trim().split('\n').filter(Boolean).map(JSON.parse)
const writes = async () => (await logs()).flatMap(p => p.actions || []).filter(a => a.op === 'task_reopen')
async function until(check) { const end = Date.now() + 8000; while (!await check()) { if (Date.now() > end) throw Error('timeout'); await new Promise(r => setTimeout(r, 15)) } }
async function boot(running = false) {
 const routes=[], events=new Map(), tools=new Map(), effects=[]
 const services={agents:{list:()=>running?[{id:'s-boot',phase:{kind:'running'}}]:[]},sessionController:{inspect:async()=>({events:[{type:'turn/start',time:Date.now(),data:{turn:2}}]})}}
 const ctx={get:n=>services[n],logger:()=>({info(){},warn(){},error(){}}),on(n,f){events.set(n,f);return()=>events.delete(n)},effect(f){effects.push(f());},tools:{register(t){tools.set(t.name,t);return()=>{}},guard(){return()=>{}}},webServer:{register(r){routes.push(r);return()=>{}}}}
 apply(ctx,{})
 if (running === 'early') events.get('session/event')({id:'s-early'},{type:'turn/start',time:Date.now(),data:{turn:2}})
 await until(()=>routes.length && tools.has('feishu_task_report'))
 const server=createServer((q,s)=>routes[0].handler(q,s));await new Promise(r=>server.listen(0,'127.0.0.1',r));const url=`http://127.0.0.1:${server.address().port}/dsh-feishu/api/state`
 const state=async()=> (await (await fetch(url)).json()).state
 return {state,tools,events,url,event(id,type='turn/start',time=Date.now()){events.get('session/event')({id:'s-'+id},{type,time,data:{turn:2}})},async close(){for (const f of effects.reverse()) await f?.();server.closeAllConnections();await new Promise(r=>server.close(r))}}
}
let app = await boot()
try {
 const activityAbort = new AbortController()
 const stream = await fetch(app.url.replace('/state','/sessions/activity'), { signal: activityAbort.signal })
 assert.match(stream.headers.get('content-type'), /event-stream/)
 const reader = stream.body.getReader(), decoder = new TextDecoder()
 const readActivity = async () => { const {value} = await reader.read(); return JSON.parse(decoder.decode(value).split('data: ')[1].split('\n')[0]) }
 const baseline = await readActivity();assert.ok(baseline.sessions.some(s=>s.id==='s-open' && !s.alive))
 app.events.get('api-session/status')('s-open',true)
 const started = await readActivity();assert.equal(started.sessions.find(s=>s.id==='s-open').phase,'running')
 app.event('open','turn/end')
 const ended = await readActivity();assert.equal(ended.sessions.find(s=>s.id==='s-open').unread,true)
 app.events.get('api-session/removed')('s-open')
 const removed = await readActivity();assert.equal(removed.sessions.find(s=>s.id==='s-open').alive,false)
 activityAbort.abort();await reader.cancel().catch(()=>{})
 console.log('✓ actual Host SSE delivers baseline/start/end/unread/removal before task polling')
 app.event('done','session/created');await new Promise(r=>setTimeout(r,40));assert.equal((await writes()).length,0)
 app.event('held');app.event('open');app.event('missing');await new Promise(r=>setTimeout(r,40));assert.equal((await writes()).length,0)
 app.event('done','turn/start',completed-1);await new Promise(r=>setTimeout(r,40));assert.equal((await writes()).length,0)
 app.event('done');app.event('done');await until(async()=> (await app.state()).tasks.find(t=>t.id==='done').reopenPending===false)
 let t=(await app.state()).tasks.find(t=>t.id==='done');assert.equal(t.done,false);assert.equal(t.completedAt,0);assert.equal(t.endAt,0);assert.equal(t.sessionId,'s-done');assert.equal(t.startedAt,123);assert.equal(t.completionHistory.length,1);assert.equal((await writes()).length,1)
 assert.deepEqual((await app.state()).schedules.done,{untouched:true})
 console.log('✓ only new turn reopens original binding once; archive/open/held/unbound/stale events do not')
 await writeFile(REMOTE, JSON.stringify({fail:false,delay:0,list:[]}))
 await app.tools.get('feishu_sync').execute({})
 assert.equal((await app.state()).tasks.find(t=>t.id==='done').done,false)
 assert.equal((await app.state()).tasks.find(t=>t.id==='done').reopenAwaitingList,true)
 console.log('✓ successful PATCH survives an older unfinished list omitting the task')
 await writeFile(REMOTE,JSON.stringify({fail:true,delay:0}));app.event('retry');await until(async()=>!!(await app.state()).tasks.find(t=>t.id==='retry').reopenError)
 t=(await app.state()).tasks.find(t=>t.id==='retry');assert.equal(t.done,false);assert.equal(t.reopenPending,true)
 await app.close();app=await boot();assert.equal((await app.state()).tasks.find(t=>t.id==='retry').reopenPending,true)
 await writeFile(REMOTE,JSON.stringify({fail:false,delay:0}));app.event('retry');await until(async()=>!(await app.state()).tasks.find(t=>t.id==='retry').reopenPending)
 console.log('✓ failed write preserves local reopen and retries safely after restart')
 await writeFile(REMOTE,JSON.stringify({fail:false,delay:150}));app.event('race');await until(async()=> (await app.state()).tasks.find(t=>t.id==='race').reopenPending)
 await app.tools.get('feishu_task_report').execute({complete:true}, {agent:{id:'s-race'}})
 t=(await app.state()).tasks.find(t=>t.id==='race');assert.equal(t.done,true);assert.equal(t.reopenPending,false)
 console.log('✓ completion serializes after delayed reopen and wins')
 await app.close();app=await boot(true);assert.equal((await app.state()).tasks.find(t=>t.id==='boot').done,false)
 console.log('✓ reload reconciles running newer turn without prompting or changing binding')
 await writeFile(REMOTE,JSON.stringify({fail:false,delay:200}));app.event('reload')
 await until(async()=> (await app.state()).tasks.find(t=>t.id==='reload').reopenPending)
 const old=app;const closing=old.close();const newApp=await boot();await closing;app=newApp
 await app.tools.get('feishu_task_report').execute({complete:true},{agent:{id:'s-reload'}})
 assert.equal((await app.state()).tasks.find(t=>t.id==='reload').done,true)
 console.log('✓ new instance waits old in-flight PATCH and persistence before completion')
 await app.close();app=await boot('early');assert.equal((await app.state()).tasks.find(t=>t.id==='early').done,false)
 console.log('✓ turn before load is buffered even when no longer running at reconciliation')
 await writeFile(REMOTE,JSON.stringify({fail:true,delay:0}));app.event('completion-reload');
 await until(async()=>!!(await app.state()).tasks.find(t=>t.id==='completion-reload').reopenError)
 await writeFile(REMOTE,JSON.stringify({fail:false,delay:0,completeDelay:350}))
 const beforeComplete=(await logs()).filter(p=>p.cli?.[1]==='complete').length
 const completing=app.tools.get('feishu_task_report').execute({complete:true},{agent:{id:'s-completion-reload'}})
 await until(async()=>(await logs()).filter(p=>p.cli?.[1]==='complete').length>beforeComplete)
 const prior=app;const draining=prior.close();const replacement=await boot();await completing;await draining;app=replacement
 const completedTask=(await app.state()).tasks.find(t=>t.id==='completion-reload');assert.equal(completedTask.done,true);assert.equal(completedTask.reopenPending,false)
 console.log('✓ in-flight completion persists after disposal before new instance loads')
 assert.ok((await logs()).filter(p=>p.cli).every(p=>!(p.cli[0]==='task' && ['create','delete'].includes(p.cli[1]))))
 console.log('REOPEN_BRIDGE_OK')
} finally {await app.close()}
