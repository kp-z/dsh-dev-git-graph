/**
 * 工单产出测试（R45 / M10-9）。
 *
 * ## 为什么这些案例是真机抄来的
 *
 * 单张产出 1091 ~ 2246 字（R44 真机 `task-14/27/28`）、失败的只有 `failureReason`（`task-18`）、
 * 早期单**做完也没有 `output`**（`task-1`，R44 之前没有这个字段）、`output` 可能是 `null`。
 * 这四种情况都要有确定的显示结果——"空白"是最糟的一种（用户不知道是没产出还是面板坏了）。
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'

import { PREVIEW_LINES, noteFor, splitOutputLines, summarizeTaskOutput, summarizeText } from '../web/core/task-output.js'

/** 真机那种带小标题与换行的长结论。 */
const LONG = ['结论：这条流水线不存在可复现的缺陷。', '', '判定依据（三方一致）：', '1. 小铁书面确认：手上零原始报障', '2. agent_world_content：tasks 库仅 2 条', '3. 队长派这话的原话是「验证工具」', '', '复现并缩小的范围：'].join('\n')

test('长文本：能数清字数、行数，并给出前几行预览', () => {
  const s = summarizeText(LONG)
  assert.equal(s.lines, 8)
  assert.equal(s.chars, LONG.trim().length)
  assert.equal(s.collapsible, true, '超过预览行数就该给"展开"')
  assert.equal(s.preview.split('\n').length, PREVIEW_LINES)
  assert.ok(LONG.startsWith(s.preview), '预览必须是原文的开头（不是重排过的文本）')
})

test('短文本不折叠（没有"展开"这个多余动作）', () => {
  const s = summarizeText('修好了。')
  assert.equal(s.collapsible, false)
  assert.equal(s.preview, '修好了。')
  assert.equal(s.chars, 4)
})

test('保留换行：`\\r\\n` 与孤立 `\\r` 都算换行（模型写的文本常混用）', () => {
  assert.deepEqual(splitOutputLines('a\r\nb\rc\nd'), ['a', 'b', 'c', 'd'])
  assert.deepEqual(splitOutputLines(''), [])
  assert.deepEqual(splitOutputLines(null), [], '不是字符串 → 空，不炸')
  // 预览里的换行要**原样留着**（渲染层用 pre-wrap 呈现，不靠 <br> 拼）
  assert.ok(summarizeText('1\n2\n3\n4\n5\n6').preview.includes('\n'))
})

test('有产出：一段「产出」，字数按去掉首尾空白算', () => {
  const out = summarizeTaskOutput({ status: 'done', output: `\n\n${LONG}\n\n` })
  assert.equal(out.sections.length, 1)
  assert.equal(out.sections[0].kind, 'output')
  assert.equal(out.sections[0].label, '产出')
  assert.equal(out.chars, LONG.trim().length, '外面包的空行不该算进字数')
  assert.equal(out.note, null)
  assert.equal(out.hasContent, true)
})

test('失败且只有 failureReason：显示「失败原因」（真机 task-18 的样子）', () => {
  const out = summarizeTaskOutput({ status: 'failed', output: null, failureReason: '这一轮没做成：结论：**零行改动**。' })
  assert.equal(out.sections.length, 1)
  assert.equal(out.sections[0].kind, 'failure')
  assert.equal(out.sections[0].label, '失败原因')
  assert.ok(out.sections[0].chars > 0)
  assert.equal(out.note, null)
})

test('产出与失败原因同时存在：**两段都显示**（产出在前，失败原因在后）', () => {
  const out = summarizeTaskOutput({ status: 'failed', output: '做了 80%：接口已改完，测试没跑。', failureReason: '测试环境起不来。' })
  assert.deepEqual(out.sections.map((s) => s.kind), ['output', 'failure'])
  assert.equal(out.chars, '做了 80%：接口已改完，测试没跑。'.length + '测试环境起不来。'.length)
})

test('没有产出：**按状态**给不同的说明（不能说"还没做完"其实是做完了）', () => {
  // 真机 task-1 就是这种：done 但没有 output（R44 之前没有这个字段）
  assert.match(noteFor('done'), /已经「完成」.*没有留下产出文本/)
  assert.match(noteFor('failed'), /失败.*没有留下失败原因/)
  assert.match(noteFor('in_progress'), /还没有产出.*进行中/)
  assert.match(noteFor('pending'), /还没有产出.*待办/)
  assert.equal(noteFor('某个新状态'), '还没有产出：这张单还在「某个新状态」。', '未知状态原样嵌进去，不显示空白')

  const done = summarizeTaskOutput({ status: 'done', output: null })
  assert.equal(done.hasContent, false)
  assert.equal(done.sections.length, 0)
  assert.ok(done.note.length > 0, '没有产出也必须有话说：空白会被当成"面板坏了"')
})

test('空白产出等于没有产出（`output: "   \\n  "` 不该算有内容）', () => {
  const out = summarizeTaskOutput({ status: 'in_progress', output: '   \n  ' })
  assert.equal(out.hasContent, false)
  assert.match(out.note, /还没有产出/)
})

test('产出文本**原样**保留（不做 Markdown 解析、不裁剪内容）', () => {
  const raw = '# 标题\n- [ ] 待办\n<script>alert(1)</script>\n**粗体**'
  const out = summarizeTaskOutput({ status: 'done', output: raw })
  assert.equal(out.sections[0].text, raw, '文本要一字不动地交给渲染层（它只用 textContent）')
})

test('纯函数：同一份输入给同一份输出', () => {
  const task = { status: 'done', output: LONG, failureReason: 'x' }
  assert.deepEqual(summarizeTaskOutput(task), summarizeTaskOutput(task))
})
