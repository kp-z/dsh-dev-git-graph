import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import vm from 'node:vm'
const source = await readFile(new URL('../index.js', import.meta.url), 'utf8')
const fn = source.match(/async function larkJson\([^]*?\n}/)?.[0]
assert.ok(fn)
let output
const ctx = { runLarkCmd: async () => output, asString: value => value == null ? '' : String(value), parseJson: text => { try { return JSON.parse(text) } catch { return undefined } } }
vm.createContext(ctx); vm.runInContext(fn, ctx)
output = { ok: true, stdout: '{"ok":true,"data":{"comment":{"id":7702456459723833364,"reply_to_comment_id":7702456459723833365,"content":"body"}}}', stderr: '' }
let r = await ctx.larkJson({}, [])
assert.equal(r.ok, true); assert.equal(r.data.comment.id, '7702456459723833364'); assert.equal(r.data.comment.reply_to_comment_id, '7702456459723833365')
for (const stdout of ['not JSON', '[]', '{"code":99991663,"msg":"invalid token"}', '{"ok":false,"error":{"type":"authorization","code":403,"message":"denied"}}']) {
  output = { ok: true, stdout, stderr: '' }; r = await ctx.larkJson({}, []); assert.equal(r.ok, false, stdout)
}
output = { ok: false, stdout: '', stderr: '', detail: 'Command timed out' }
r = await ctx.larkJson({}, []); assert.equal(r.ok, false); assert.equal(r.transportOk, false)
output = { ok: true, stdout: JSON.stringify({ ok: true, data: { content: '正文里是 "id":7702456459723833364' } }), stderr: '' }
r = await ctx.larkJson({}, []); assert.equal(r.data.content, '正文里是 "id":7702456459723833364')
assert.match(source, /cliBackend: 'feishu-sync'/, 'main default backend/authorization stays intact')
console.log('LARK_JSON_OK: large numeric comment IDs, malformed output, structured rejection, timeout and legacy backend default')
