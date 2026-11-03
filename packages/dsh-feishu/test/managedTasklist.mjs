import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import vm from 'node:vm'
import { tasklistFields, schemaSignature, DEFAULT_TASKLIST_NAME, TASKLIST_SCHEMA_VERSION } from '../tasklistSchema.js'
const source=await readFile(new URL('../index.js',import.meta.url),'utf8')
const start=source.indexOf('  let tasklistFlight = null')
const end=source.indexOf('  const settingsHooks = []',start)
assert.ok(start>0 && end>start)
const calls=[];let persists=0;let failField=false;let failList=false
const bridgeMock=async(_,payload)=>{
 calls.push(payload)
 if(payload.fields)return {ok:true,fields:{'list-1':[]}}
 if(payload.actions[0].op==='ensure_tasklist')return {ok:!failList,actions:[failList?{ok:false,error:'denied'}:{ok:true,guid:'list-1',name:DEFAULT_TASKLIST_NAME}]}
 return {ok:true,actions:payload.actions.map((a,i)=>({ok:!failField||i!==2,guid:'field-'+i,type:a.type,warnings:a.name==='优先级'?['同名可见选项重复，写入这些值会被拒绝：P0']:undefined,error:failField&&i===2?'wrong type':undefined}))}
}
const context={
 settings:{cliBackend:'feishu-sync',managedTasklist:{enabled:true,name:DEFAULT_TASKLIST_NAME,guid:''},taskFields:{}},
 state:{tasks:[],managedTasklist:{},feishuFields:{}}, lifecycleDisposed:false,
 schemaSignature,tasklistFields,TASKLIST_SCHEMA_VERSION,randomUUID:()=> 'create-token',nowMs:Date.now,
 resolvePython:()=> 'fake-python',resolveCli:()=> 'fake-cli',workspaces:()=> [{title:'A'}],
 persistState:async()=> {persists++},writeJson:async()=> {},SETTINGS_FILE:'fake',safeSyncDetail:String,
 remoteCache:{fields:new Map()},
 runBridge:bridgeMock,runBridgeRaw:bridgeMock
}
vm.createContext(context);vm.runInContext(source.slice(start,end),context)
const result=await context.ensureManagedTasklist()
assert.equal(result.ok,true);assert.equal(context.settings.managedTasklist.guid,'list-1');assert.equal(context.state.managedTasklist.status,'ready')
assert.equal(context.state.managedTasklist.fields.length,12);assert.ok(persists>=3)
assert.deepEqual(context.state.managedTasklist.warnings,['同名可见选项重复，写入这些值会被拒绝：P0'])
assert.match(context.state.managedTasklist.fields.find(f=>f.name==='优先级').warning,/同名可见选项重复/)
assert.equal(context.state.managedTasklist.status,'ready','Warnings alone do not fail the list')
assert.ok(!('guid' in calls[0].actions[0]), 'Fresh initialization omits empty GUID so bridge selects create/reuse path')
const count=calls.length;await context.ensureManagedTasklist();assert.equal(calls.length,count,'TTL avoids repeated remote calls')
failField=true;const failed=await context.ensureManagedTasklist({force:true});assert.equal(failed.ok,false);assert.equal(context.state.managedTasklist.status,'failed');assert.ok(failed.errors.includes('wrong type'))
failField=false;assert.equal((await context.ensureManagedTasklist({force:true})).ok,true)
context.settings.taskFields={eta:'Different ETA'};await context.ensureManagedTasklist();assert.ok(calls.length>count)
context.settings.managedTasklist.enabled=false;assert.equal((await context.ensureManagedTasklist()).skipped,'disabled')
context.settings.managedTasklist.enabled=true;failList=true;assert.equal((await context.ensureManagedTasklist({force:true})).ok,false)
assert.match(source,/if \(!initialized\.ok\) return \{ ok: false, error: '任务清单未就绪/)
assert.match(source,/任务已创建但未加入清单，勿重复创建/)
context.lifecycleDisposed=true
const beforeDisposed=calls.length
assert.equal((await context.ensureManagedTasklist({force:true})).ok,false)
assert.equal(calls.length,beforeDisposed,'Disposed instance never starts initialization')
context.lifecycleDisposed=false;failList=false
const originalBridge=context.runBridgeRaw;let release
const blocked=new Promise(r=>release=r)
context.runBridgeRaw=async(p,payload)=>{if(payload.actions?.[0]?.op==='ensure_custom_field')await blocked;return originalBridge(p,payload)}
const racing=context.ensureManagedTasklist({force:true})
while(!context.state.managedTasklist || context.state.managedTasklist.status!=='checking')await Promise.resolve()
await new Promise(r=>setTimeout(r,0))
context.settings.taskFields={eta:'Changed during request'}
release()
assert.equal((await racing).ok,false,'Changed schema cannot become ready')
assert.notEqual(context.state.managedTasklist.status,'ready')
// 同一状态机走官方后端：不能加载 Python，也不能跳过完整字段检查。
context.settings.cliBackend='lark-cli'
context.backendFor=()=>({actions:async(_,actions)=>bridgeMock(null,{actions}),enrich:async(_,payload)=>bridgeMock(null,payload)})
context.resolvePython=()=>{throw new Error('official backend must not resolve Python')}
const beforeLark=calls.length
assert.equal((await context.ensureManagedTasklist({force:true})).ok,true)
assert.equal(context.state.managedTasklist.backend,'lark-cli')
assert.equal(context.state.managedTasklist.fields.length,12)
assert.ok(calls.length>beforeLark)
// 丢失的字段创建回执必须先通过完整定义读取对账，缺字段时不得重发 CREATE。
context.state.managedTasklist.unknownFields=['未确认字段']
const beforeUnknown=calls.length
assert.equal((await context.ensureManagedTasklist({force:true})).ok,false)
assert.equal(context.state.managedTasklist.status,'unknown')
assert.ok(calls.slice(beforeUnknown).every(payload=>!payload.actions?.some(a=>a.op==='ensure_custom_field')))
// Execute the actual write gate separately, with no remote API.
// 集成后闸门逻辑抽成了 managedFieldWriteBlocked（backend().actions 也复用它），两个函数一起取。
const gateHelper=source.match(/  function managedFieldWriteBlocked\(actions\) \{[\s\S]*?\n  }/)[0]
const gateSource=gateHelper+'\n'+source.match(/  async function runBridge\(python, payload\) \{[\s\S]*?\n  }/)[0]
let rawCalls=0
const gateContext={settings:{managedTasklist:{enabled:true,guid:'managed'}},state:{managedTasklist:{status:'failed'}},schemaSignature,workspaces:()=>[],runBridgeRaw:async()=>{rawCalls++;return{ok:true}}}
vm.createContext(gateContext);vm.runInContext(gateSource,gateContext)
assert.equal((await gateContext.runBridge('fake',{actions:[{op:'set_custom_field',tasklist:'managed'}]})).ok,false)
assert.equal(rawCalls,0)
gateContext.state.managedTasklist={status:'ready',signature:schemaSignature(gateContext.settings,[])}
assert.equal((await gateContext.runBridge('fake',{actions:[{op:'set_custom_field',tasklist:'managed'}]})).ok,true)
assert.equal(rawCalls,1)
gateContext.settings.taskFields={eta:'new'}
assert.equal((await gateContext.runBridge('fake',{actions:[{op:'set_custom_field',tasklist:'managed'}]})).ok,false)
assert.equal(rawCalls,1)
gateContext.settings.managedTasklist.enabled=false
assert.equal((await gateContext.runBridge('fake',{actions:[{op:'set_custom_field',tasklist:'managed'}]})).ok,true,'Disabling the managed contract restores legacy writes')
assert.equal(rawCalls,2)
gateContext.settings.managedTasklist.enabled=true
gateContext.state.managedTasklist={status:'failed',signature:schemaSignature(gateContext.settings,[]),fields:[{name:'优先级',ok:true},{name:'工作区',ok:false}]}
assert.equal((await gateContext.runBridge('fake',{actions:[{op:'set_custom_field',tasklist:'managed',name:'优先级'}]})).ok,true,'One failed field must not freeze a healthy field')
assert.equal((await gateContext.runBridge('fake',{actions:[{op:'set_custom_field',tasklist:'managed',name:'工作区'}]})).ok,false,'Ambiguous field stays blocked')
assert.equal((await gateContext.runBridge('fake',{fields:['managed']})).ok,true,'Read-only field query is not blocked')
console.log('MANAGED_TASKLIST_OK: complete schema, persisted destination, TTL, failure gate, disposal/config races and actual write readiness gate')
