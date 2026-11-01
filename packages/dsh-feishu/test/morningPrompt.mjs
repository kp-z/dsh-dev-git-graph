import assert from 'node:assert/strict'
import { DEFAULT_MORNING_PROMPT, PROMPT_REV } from '../index.js'

/* 早会口述稿的契约：昨天逐条、每条先解释「这块是干嘛的」，听众只听得到项目名。 */
assert.ok(PROMPT_REV >= 13, 'prompt revision bumped so cached scripts regenerate')
for (const needle of [
  '一条条讲',
  '昨天做了 N 件事',
  '1. ',
  '这块是干嘛的',
  '听众只知道',
  '外行能懂',
  '2-4 条',
]) {
  assert.ok(DEFAULT_MORNING_PROMPT.includes(needle), 'morning prompt must require: ' + needle)
}
assert.ok(!DEFAULT_MORNING_PROMPT.includes('不要 bullet、不要编号'), 'itemized list is now required, not forbidden')
console.log('MORNING_PROMPT_OK: itemized yesterday script with plain-language project context')
