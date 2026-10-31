import assert from 'node:assert/strict'
import { createCommentCoordinator } from '../comments.js'
let saved=null, items=[], busy=false, sends=[]
const task={id:'task',sessionId:'session',members:[{id:'owner',type:'user',role:'assignee'}]}
const config={enabled:true,ownerMode:'execute',otherMode:'reply'}
const c=createCommentCoordinator({load:async()=>saved,save:async s=>{saved=structuredClone(s)},getTask:()=>task,resolveTask:async()=>task,now:()=>1,listComments:async()=>({ok:true,complete:true,items}),isSessionBusy:(sid,options)=>{assert.ok(options);return busy},deliver:async e=>{sends.push(e);return {ok:true}},writeComment:async()=>({ok:true,commentId:'99'})})
items=[{id:'1',content:'historical',creator:{id:'owner',type:'user'}}]
await c.sync([task],config)
assert.equal(sends.length,0)
assert.equal((await c.diagnostic('task')).readCount,1)
assert.match((await c.diagnostic('task')).reason,/首次/)
busy=true
const submit=await c.submit('task','1',config)
assert.equal(submit.ok,true);assert.equal(submit.status,'pending');assert.match(submit.reason,/等待/)
assert.equal((await c.submit('task','1',config)).ok,false)
busy=false
await c.drain(config)
assert.equal(sends.length,1)
assert.match(sends[0].text,/historical/)
await c.markRunning('task','1','session',1)
await c.complete('1','session','answer',{taskId:'task'})
assert.equal((await c.submit('task','99',config)).ok,false)
await c.endTurn('task','1','session',1)
await c.dispose()
console.log('COMMENT_HISTORY_OK: first scan diagnostic, explicit historical submit, busy feedback, no duplicate dispatch, own echo rejection')
