/**
 * 侧边栏文案（R152）—— 纯函数，node 里直接测。
 *
 * 两个函数都在 R152 的重设计里承担了「一眼能认出谁/哪条流水线」的职责，
 * 所以各给一组真名做判据，而不是只测 `''` 这种边界：
 *   · `memberInitial` —— 8 个成员里有 7 个叫「小X」，不剥前缀的话头像全是「小」；
 *   · `groupDisplayName` —— 数字从名字里拆出来做成徽章之后，名字不能再带「· 3 张」。
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'

import { groupDisplayName, groupViewLabel, memberInitial } from '../web/ui/labels.js'

test('memberInitial：去掉 小/老/阿 前缀，取最有辨识度的一个字', () => {
  assert.equal(memberInitial('小蓝'), '蓝')
  assert.equal(memberInitial('小紫'), '紫')
  assert.equal(memberInitial('工头阿金'), '工', '不以 小/老/阿 开头的名字取首字，不硬剥')
  assert.equal(memberInitial('阿金'), '金')
  assert.equal(memberInitial('老王'), '王')
})

test('memberInitial：英文名首字母大写；空名字给 ?（不渲染空白头像）', () => {
  assert.equal(memberInitial('alice'), 'A')
  assert.equal(memberInitial('  alice  '), 'A')
  assert.equal(memberInitial(''), '?')
  assert.equal(memberInitial(null), '?')
  assert.equal(memberInitial(undefined), '?')
})

test('groupDisplayName：名字里不再带数量（数量是 chip 右侧的独立徽章）', () => {
  assert.equal(groupDisplayName({ id: 'all', name: '', total: 10, unfinished: 3 }), '全部')
  assert.equal(groupDisplayName({ id: 'task.quick-fix', name: '快速修一个 bug', total: 3, unfinished: 3 }), '快速修一个 bug')
  assert.equal(groupDisplayName({ id: 'task.x', name: '', total: 2, unfinished: 1 }), '未分组')
})

test('groupViewLabel：完整读数仍保留给 title / aria-label', () => {
  assert.equal(groupViewLabel({ id: 'all', name: '', total: 10, unfinished: 3 }), '全部 · 10 张（3 未完成）')
  assert.equal(groupViewLabel({ id: 'task.done', name: '快速修一个 bug', total: 3, unfinished: 0 }), '快速修一个 bug · 3 张')
})
