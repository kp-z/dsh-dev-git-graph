import assert from 'node:assert/strict'
import {formatAIComment,AI_COMMENT_HEADER,AI_COMMENT_RULE} from '../commentFormat.js'
const body='✅ 完成。\n🔎 说明：正文里的 🤖 不删除。'
const expected=AI_COMMENT_HEADER+'\n'+AI_COMMENT_RULE+'\n'+body+'\n'+AI_COMMENT_RULE
assert.equal(formatAIComment(body),expected)
for(const prefix of ['🤖:🤖 ','🤖: ','[🤖AI 回复]\n--------------------\n','[AI 回复 · DSH]\n','🤖 AI 回复 · DSH\n']) assert.equal(formatAIComment(prefix+body),expected,prefix)
assert.equal(formatAIComment(expected),expected)
assert.equal(formatAIComment('  '),'')
assert.equal(formatAIComment('🤖:'),'')
const long=formatAIComment('🧪'.repeat(4000));assert.equal(Array.from(long).length,3000);assert.ok(!long.includes('\ufffd'));assert.equal((long.match(/\[🤖AI 回复\]/g)||[]).length,1)
console.log('COMMENT_FORMAT_OK: single identity, separators, existing prefixes, body preserved, Unicode limit and idempotency')
