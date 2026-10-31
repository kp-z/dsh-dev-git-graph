import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { createActivityFeed } from '../activity.js'
class Response extends EventEmitter {
  frames=[];writableLength=0;destroyed=false;writableEnded=false
  writeHead(code,headers){this.code=code;this.headers=headers}
  write(frame){this.frames.push(frame)}
  end(){this.writableEnded=true;this.emit('close')}
}
let rows=[{id:'s',alive:true,phase:'idle',turn:0,unread:false}]
const feed=createActivityFeed(()=>rows),res=new Response()
feed.open({},res)
assert.equal(res.code,200);assert.match(res.headers['content-type'],/event-stream/)
const payload=frame=>JSON.parse(frame.split('data: ')[1])
assert.equal(payload(res.frames[0]).sessions[0].phase,'idle')
rows=[{id:'s',alive:true,phase:'running',turn:1,unread:false}]
feed.changed();feed.changed();await Promise.resolve()
assert.equal(res.frames.length,2);assert.equal(payload(res.frames[1]).sessions[0].phase,'running')
assert.equal(payload(res.frames[1]).revision,1)
rows=[{id:'s',alive:true,phase:'idle',turn:1,unread:true}];feed.changed();await Promise.resolve()
assert.equal(payload(res.frames.at(-1)).sessions[0].unread,true)
const second=new Response();feed.open({},second);assert.equal(payload(second.frames[0]).generation,payload(res.frames[0]).generation)
second.writableLength=100000;feed.changed();await Promise.resolve();assert.equal(second.writableEnded,true)
res.end();const before=res.frames.length;feed.changed();await Promise.resolve();assert.equal(res.frames.length,before)
const third=new Response();feed.open({},third);feed.dispose();assert.equal(third.writableEnded,true)
const offline=new Response();feed.open({},offline);assert.equal(offline.code,503)
console.log('ACTIVITY_FEED_OK: immediate baseline, coalesced updates, unread/end, reconnect generation, backpressure/disconnect/unload cleanup')
