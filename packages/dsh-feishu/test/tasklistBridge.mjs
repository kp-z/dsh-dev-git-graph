import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { execFileSync } from 'node:child_process'
import { mkdtemp, mkdir, writeFile, chmod, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
const home=await mkdtemp(join(tmpdir(),'feishu-managed-bridge-'))
process.env.DSH_HOME=home
const data=join(home,'dsh-feishu');await mkdir(data)
const runtime=join(home,'fake.cjs'),python=join(home,'fake-python'),cli=join(home,'fake-cli'),log=join(home,'calls.jsonl')
await writeFile(runtime,`const fs=require('fs');const args=process.argv.slice(3);const log=${JSON.stringify(log)};const add=x=>fs.appendFileSync(log,JSON.stringify(x)+'\\n');
if(process.argv[2]===${JSON.stringify(cli)}){add({cli:args});if(args[0]==='version')console.log('feishu-sync 1.0.0');else if(args[0]==='task'&&args[1]==='list')console.log('[]');else if(args[1]==='create')console.log(JSON.stringify({guid:'new-task'}));else console.log('{}');}
else{let s='';process.stdin.on('data',c=>s+=c);process.stdin.on('end',()=>{const p=JSON.parse(s);add(p);const actions=(p.actions||[]).map(a=>a.op==='ensure_tasklist'?{op:a.op,ok:true,guid:'managed-list',name:'DSH 任务清单',created:!a.guid}:a.op==='ensure_custom_field'?{op:a.op,ok:true,guid:'field-'+a.name,type:a.type}:{op:a.op,ok:true,items:[]});console.log(JSON.stringify({ok:true,actions,errors:[],fields:Object.fromEntries((p.fields||[]).map(id=>[id,[]])),tasklists:{},users:{}}));});}`)
const c=join(home,'launcher.c');await writeFile(c,`#include <unistd.h>\n#include <stdlib.h>\nint main(int n,char**v){char**a=calloc(n+3,sizeof(char*));a[0]=${JSON.stringify(process.execPath)};a[1]=${JSON.stringify(runtime)};for(int i=1;i<n;i++)a[i+1]=v[i];execv(a[0],a);return 127;}\n`)
execFileSync('cc',[c,'-o',python]);await chmod(python,0o700);await writeFile(cli,'#!'+python+'\n');await chmod(cli,0o700)
await writeFile(join(data,'settings.json'),JSON.stringify({autoSync:false,cliPath:cli,autoComment:false,managedTasklist:{enabled:true,name:'DSH 任务清单',guid:''}}))
const routes=[],effects=[],tools=new Map()
const ctx={logger:()=>({info(){},warn(){},error(){}}),get:()=>undefined,on:()=>()=>{},effect(f){const x=f();if(typeof x==='function')effects.push(x);return()=>{}},tools:{register(t){tools.set(t.name,t);return()=>{}}},webServer:{register(r){routes.push(r);return()=>{}}}}
const {apply}=await import('../index.js');apply(ctx,{})
const until=async(f)=>{const end=Date.now()+15000;while(!await f()){if(Date.now()>end)throw Error('Timeout');await new Promise(r=>setTimeout(r,20))}}
await until(()=>routes.length)
const server=createServer((q,s)=>routes[0].handler(q,s));await new Promise(r=>server.listen(0,'127.0.0.1',r));const base='http://127.0.0.1:'+server.address().port+'/dsh-feishu/api'
const request=async(path,body)=>{const r=await fetch(base+path,{...(body?{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(15000)});return r.json()}
try{
 await until(async()=> (await request('/state')).state.managedTasklist?.status==='ready')
 const state=(await request('/state')).state;assert.equal(state.managedTasklist.guid,'managed-list');assert.equal(state.managedTasklist.fields.length,12)
 const persisted=JSON.parse(await readFile(join(data,'settings.json'),'utf8'));assert.equal(persisted.managedTasklist.guid,'managed-list')
 await request('/auth/check',{})
 const calls=(await readFile(log,'utf8')).trim().split('\n').map(JSON.parse)
 const lists=calls.flatMap(p=>p.actions||[]).filter(a=>a.op==='ensure_tasklist')
 assert.ok(lists.length>=2);assert.ok(!('guid' in lists[0]));assert.ok(lists.slice(1).every(a=>a.guid==='managed-list'),'Later checks reuse persisted GUID')
 assert.ok(calls.flatMap(p=>p.actions||[]).filter(a=>a.op==='ensure_custom_field').length>=12)
 assert.ok(!calls.some(x=>x.cli?.[1]==='create'),'Authorization only initializes list, not tasks')
 console.log('TASKLIST_BRIDGE_OK: real Host apply + fresh fake CLI authorization initializes all fields and persists/reuses destination')
}finally{for(const f of effects.reverse())await f();server.closeAllConnections();await new Promise(r=>server.close(r))}
