/**
 * 头顶工单行的文本（R123 / R5 收口）。
 *
 * 为什么值得单测：这一行的**截断**在真机上根本触发不到——真实内容库的工单标题最长只有
 * **10 个字符**，而上限是 14。也就是说"长标题会不会撑爆头顶"这件事，
 * **靠真机永远验不到**（要等到某天接了外部系统、标题变长才会露出来）。
 * 纯函数能在 node 里把那些情形跑一遍，这正是把它从渲染层里拆出来的理由。
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'

import { shortTaskIdOf, taskLabelText } from '../web/core/task-label.js'

test('短 id：`task-27` → `27`，认不出就原样（不猜）', () => {
  assert.equal(shortTaskIdOf('task-27'), '27')
  assert.equal(shortTaskIdOf('task-1'), '1')
  assert.equal(shortTaskIdOf('外部-ABC'), '外部-ABC')
  assert.equal(shortTaskIdOf(null), '')
})

test('工单行：短 id + 标题（真机上读出来就是 `#33 定位问题边界`）', () => {
  assert.equal(taskLabelText({ id: 'task-33', title: '定位问题边界' }), '#33 定位问题边界')
})

test('工单行：**长标题截断**并加省略号（真机验不到的那条）', () => {
  const long = '把整个调度器的重试策略重新设计一遍并补齐所有边界条件的回归测试'
  const text = taskLabelText({ id: 'task-99', title: long })
  assert.ok(text.startsWith('#99 '), `要保留短 id，实际：${text}`)
  assert.ok(text.endsWith('…'), `截断要留省略号（否则看不出被截了），实际：${text}`)
  assert.ok(text.length <= 14, `总长不该超过上限 14，实际 ${text.length}：${text}`)
})

test('工单行：没有单 / 没有标题都不炸，且不留下半截 id', () => {
  assert.equal(taskLabelText(null), '')
  assert.equal(taskLabelText(undefined), '')
  assert.equal(taskLabelText({ id: 'task-7' }), '#7')
  assert.equal(taskLabelText({ id: 'task-7', title: '   ' }), '#7')
  assert.equal(taskLabelText({ title: '只有标题没有 id' }), '只有标题没有 id')
})
