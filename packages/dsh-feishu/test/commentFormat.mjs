import assert from 'node:assert/strict'
import {formatAIComment,AI_COMMENT_HEADER,AI_COMMENT_RULE,AI_COMMENT_RAIL} from '../commentFormat.js'
const body='✅ 完成。\n🔎 说明：正文里的 🤖 不删除。'
const railed=body.split('\n').map((line)=>AI_COMMENT_RAIL+' '+line).join('\n')
const expected=AI_COMMENT_HEADER+'\n'+AI_COMMENT_RULE+'\n'+railed+'\n'+AI_COMMENT_RULE
assert.equal(formatAIComment(body),expected)
for(const prefix of ['🤖:🤖 ','🤖: ','[🤖AI 回复]\n--------------------\n','[🤖AI 回复]\n'+AI_COMMENT_RULE+'\n','[AI 回复 · DSH]\n','🤖 AI 回复 · DSH\n']) assert.equal(formatAIComment(prefix+body),expected,prefix)
assert.equal(formatAIComment(expected),expected)
assert.equal(formatAIComment('  '),'')
assert.equal(formatAIComment('🤖:'),'')
const long=formatAIComment('🧪'.repeat(4000));assert.equal(Array.from(long).length,3000);assert.ok(!long.includes('\ufffd'));assert.equal((long.match(/\[🤖AI 回复\]/g)||[]).length,1)
console.log('COMMENT_FORMAT_OK: single identity, visible card rules/rail, existing prefixes, body preserved, Unicode limit and idempotency')
