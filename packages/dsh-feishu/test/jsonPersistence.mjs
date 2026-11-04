import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import vm from 'node:vm'
const source = await readFile(new URL('../index.js', import.meta.url), 'utf8')
const fn = source.match(/async function writeJson\([^]*?\n}/)?.[0]
assert.ok(fn)
const files = new Map(), events = []
let serial = 0, release, failNext = false
const gate = new Promise(resolve => { release = resolve })
let enterWrite
const entered = new Promise(resolve => { enterWrite = resolve })
const ctx = { jsonWriteQueues: new Map(), dirname: () => '/fake', randomUUID: () => String(++serial), mkdir: async () => {}, writeFile: async (file, text, options) => {
  assert.equal(options.mode, 0o600); events.push('write:' + file)
  if (file.endsWith('.1.tmp')) { enterWrite(); await gate }
  if (failNext) { failNext = false; throw new Error('save failed') }
  files.set(file, text)
}, rename: async (temp, file) => { assert.ok(files.has(temp)); files.set(file, files.get(temp)); files.delete(temp); events.push('rename:' + file) }, unlink: async file => { files.delete(file) } }
vm.createContext(ctx); vm.runInContext(fn, ctx)
const value = { revision: 1 }
const first = ctx.writeJson('/fake/state.json', value)
value.revision = 2
const second = ctx.writeJson('/fake/state.json', value)
await entered
assert.equal(events.length, 1, 'same-file writers are serialized')
release(); await Promise.all([first, second])
assert.equal(JSON.parse(files.get('/fake/state.json')).revision, 2)
assert.deepEqual(events, ['write:/fake/state.json.1.tmp', 'rename:/fake/state.json', 'write:/fake/state.json.2.tmp', 'rename:/fake/state.json'])
assert.equal(ctx.jsonWriteQueues.size, 0)
failNext = true
const failed = ctx.writeJson('/fake/state.json', { revision: 3 })
const next = ctx.writeJson('/fake/state.json', { revision: 4 })
await assert.rejects(failed, /save failed/); await next
assert.equal(JSON.parse(files.get('/fake/state.json')).revision, 4)
assert.equal(files.size, 1, 'failed temporary writes leave no state replacement or abandoned temp file')
console.log('JSON_PERSISTENCE_OK: immutable queued snapshots, atomic replacement, private mode, failure cleanup and subsequent writes')
