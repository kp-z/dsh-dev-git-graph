import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import vm from 'node:vm'
const html = await readFile(new URL('../panel.html', import.meta.url), 'utf8')
const script = [...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)].map(m => m[1]).join('\n')
new vm.Script(script)
class Node {
  constructor(tag, attrs) { this.tag=tag;this.attrs=attrs;this.children=[];this.listeners={};this.style={setProperty(){}} }
  getAttribute(k) { return this.attrs[k] }
  setAttribute(k,v) { this.attrs[k]=v }
  appendChild(n) { this.children.push(n) }
  addEventListener(k,f) { this.listeners[k]=f }
}
const calls=[]
const root=new Node('span',{})
const ctx={document:{createElementNS:(ns,tag)=>{assert.equal(ns,'http://www.w3.org/2000/svg');return new Node(tag,{})}},el:(tag,attrs={})=>new Node(tag,attrs),openPriorityMenu:()=>calls.push('menu'),setPriority(){},$:()=>root,clear:n=>{n.children=[]}}
vm.createContext(ctx)
const start=script.indexOf('  function priorityChip('),end=script.indexOf('\n  function setPriority',start)
vm.runInContext(script.slice(start,end),ctx)
const running=ctx.priorityChip({sessionAlive:true,sessionPhase:'running',sessionUnread:true},'P1')
assert.match(running.attrs.class,/is-running/);assert.doesNotMatch(running.attrs.class,/is-unread/)
assert.equal(running.attrs['data-value'],'P1');assert.match(running.attrs['aria-label'],/正在运行/)
const unread=ctx.priorityChip({sessionAlive:true,sessionPhase:'idle',sessionUnread:true},'P0')
assert.match(unread.attrs.class,/is-unread/);assert.doesNotMatch(unread.attrs.class,/is-running/)
assert.match(unread.attrs.title,/运行结束，尚未查看/)
const seen=ctx.priorityChip({sessionAlive:true,sessionPhase:'idle',sessionUnread:false},'P3')
assert.doesNotMatch(seen.attrs.class,/is-unread|is-running/)
assert.doesNotMatch(ctx.priorityChip({sessionAlive:false,sessionPhase:'running',sessionUnread:true},'').attrs.class,/is-running|is-unread/)
unread.listeners.click({stopPropagation(){}});assert.deepEqual(calls,['menu'])
const peopleStart=script.indexOf('    function personGroup('),peopleEnd=script.indexOf('\n    var ',peopleStart+10)
vm.runInContext(script.slice(peopleStart,peopleEnd),ctx)
const group=ctx.personGroup('负责人',[{name:'Aaron',id:'a',avatar:'offline-avatar'},...Array.from({length:4},(_,i)=>({name:'Person '+i,id:String(i)}))])
assert.equal(group.attrs['aria-label'],'负责人');assert.equal(group.children.length,6)
assert.equal(group.children[0].children[0].tag,'svg');assert.equal(group.children[0].children[0].attrs.stroke,'currentColor');assert.match(group.children[0].attrs.title,/负责人：Aaron、Person 0/)
assert.ok(group.children.slice(1).every(n=>n.attrs.class==='avatar'||n.attrs.class==='avatar more'))
assert.equal(group.children[1].attrs.title,'负责人：Aaron');assert.equal(group.children[1].attrs.tabindex,'0')
assert.equal(group.children[1].children[0].tag,'img');assert.match(group.children[5].attrs.title,/负责人：Person 3/)
const followers=ctx.personGroup('关注人',[{id:'f',name:'Follower'}])
assert.equal(followers.children[0].children[0].tag,'svg');assert.notEqual(followers.children[0].children[0].children[0].attrs.d,group.children[0].children[0].children[0].attrs.d);assert.equal(followers.children[1].attrs.title,'关注人：Follower')
assert.doesNotMatch(html,/people-names|people-label/)
assert.match(html,/\.prio\.is-running::before[\s\S]*?pointer-events: none/)
assert.match(html,/@media \(prefers-reduced-motion: reduce\)\s*\{\s*\.prio\.is-running::before \{ animation: none/)
assert.match(html,/\.prio\.is-unread::after[\s\S]*?top: -4px;[\s\S]*?right: -4px;[\s\S]*?background: var\(--p-ok\)/)
const activityStart=script.indexOf('  function renderTaskActivity('),activityEnd=script.indexOf('  /* 宿主旧代码',activityStart)
vm.runInContext(script.slice(activityStart,activityEnd),ctx)
const runningTasks=Array.from({length:4},(_,i)=>({id:'run-'+i,title:'Task '+i,sessionAlive:true,sessionPhase:'running'}))
ctx.renderTaskActivity([...runningTasks,{id:'idle',sessionAlive:true,sessionPhase:'idle'}],2)
assert.equal(root.children[0].children.length,4)
assert.match(root.attrs['aria-label'],/正在运行 4 个任务；当前显示 2 个，共 5 个/)
const oldBars=root.children[0];ctx.renderTaskActivity([...runningTasks,{id:'idle'}],2);assert.equal(root.children[0],oldBars)
ctx.renderTaskActivity([],0);assert.equal(root.children[0].attrs.text,'空闲');assert.equal(root.children.length,1)
assert.match(html,/transform-origin: bottom; animation: task-equalize/)
console.log('TASK_ACTIVITY_PANEL_OK: running/unread/read/dead, priority click preserved, avatar-only roles/hover/focus/overflow and reduced motion')
