import assert from 'node:assert/strict'
import { createCommentCoordinator } from '../comments.js'
import { readFile } from 'node:fs/promises'
import vm from 'node:vm'
let saved=null, fail=true
const calls=[]
const task={id:'task',sessionId:'session',members:[{id:'owner',type:'user',role:'assignee'}]}
const c=createCommentCoordinator({load:async()=>saved,save:async s=>{saved=structuredClone(s)},getTask:()=>task,resolveTask:async()=>task,now:()=>1,listComments:async()=>({ok:true,complete:true,items:[]}),isSessionBusy:()=>false,deliver:async()=>({ok:true}),writeComment:async(t,text,o)=>{calls.push(o);return fail?{ok:false,definitive:true,error:'no old scope'}:{ok:true,commentId:'123',mentionSupported:true}}})
await c.drain({enabled:true,mentionMode:'task-v1'})
const opts={key:'reply',replyTo:'1',mentionIds:['ou_author']}
assert.equal((await c.writeOutbound('task','answer',opts)).ok,false)
await c.drain({enabled:true,mentionMode:'native'})
fail=false
assert.equal((await c.writeOutbound('task','answer',opts)).ok,true)
assert.equal(calls.length,2)
assert.ok(calls.every(o=>o.mentionMode==='task-v1'),'retry retains original transport, never fallback after config change')
await c.dispose()
const html=await readFile(new URL('../panel.html',import.meta.url),'utf8')
assert.match(html,/id="commentMentionMode"/)
assert.match(html,/mentionMode: \$\('commentMentionMode'\)\.value/)
const js=html.match(/<script>([\s\S]*?)<\/script>/)[1];new vm.Script(js)
const host=await readFile(new URL('../index.js',import.meta.url),'utf8')
assert.match(host,/mentionMode: next\.comments\?\.mentionMode === 'task-v1' \? 'task-v1' : 'native'/)
assert.match(host,/mentionMode: options\.mentionMode, allowMentionFallback: options\.mentionMode !== 'task-v1'/)
console.log('MENTION_MODE_OK: explicit setting, immutable writer transport, no silent fallback, panel/Host wiring')
