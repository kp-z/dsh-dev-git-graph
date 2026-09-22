import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { parse } from '../shared/parse.mjs'
import { buildDemoDocument } from '../src/render/demo.mjs'

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)))

async function realEntry(slug) {
  const source = await readFile(path.join(ROOT, 'content', 'effects', `${slug}.md`), 'utf8')
  return parse(source, `${slug}.md`)
}

function synthetic({ html = '', css = '', js = '', params = [] } = {}) {
  const blocks = []
  if (html) blocks.push({ lang: 'html', lines: html.split('\n'), mechanismLines: [] })
  if (css) blocks.push({ lang: 'css', lines: css.split('\n'), mechanismLines: [0] })
  if (js) blocks.push({ lang: 'js', lines: js.split('\n'), mechanismLines: [] })
  return {
    meta: { title: 't', slug: 't', stage: 'plain', params },
    description: '机制是 ==X==。',
    code: blocks,
    notes: [],
    mechanisms: ['X'],
  }
}

test('图版默认值带单位 —— blur(18) 是无效 CSS，这一条钉住那个 bug', async () => {
  const entry = await realEntry('liquid-glass')
  const doc = buildDemoDocument(entry)

  assert.match(doc, /"blur":"18px"/)
  assert.match(doc, /"tint":"?0\.55"?/)
  assert.doesNotMatch(doc, /"blur":"18"/)
})

test('用户脚本放在 text/plain 里，不会被当成脚本执行', async () => {
  const entry = await realEntry('liquid-glass')
  const doc = buildDemoDocument(entry)
  assert.match(doc, /<script type="text\/plain" id="spellbook-script">/)
})

test('演示里带舞台标记，舞台不是空白', async () => {
  const entry = await realEntry('liquid-glass')
  const doc = buildDemoDocument(entry)
  assert.match(doc, /data-stage="photo"/)
  assert.match(doc, /demo-backdrop/)
  assert.match(doc, /\[data-stage="photo"\]/)
})

test('用户 JS 里的 </script> 被转义，不能截断文档', () => {
  const doc = buildDemoDocument(
    synthetic({ html: '<p>hi</p>', css: '.a{}', js: 'const s = "</script>";' }),
  )
  assert.match(doc, /<\\\/script>/)
  assert.doesNotMatch(doc, /const s = "<\/script>"/)
})

test('用户 HTML 里的 </template> 被转义，不能截断模板', () => {
  const doc = buildDemoDocument(synthetic({ html: '<p>a</p></template><p>b</p>', css: '.a{}' }))
  assert.match(doc, /<\\\/template>/)
})

test('没有 JS 的条目也会生成完整的文档', async () => {
  const entry = await realEntry('liquid-glass')
  const doc = buildDemoDocument(entry)
  assert.match(doc, /^<!doctype html>/)
  assert.match(doc, /<\/html>\s*$/)
})

/*
 * 预览是沙箱 iframe，只跑得了网页三件套。一条咒语的示例若换了语言
 * —— React 组件、Vue 指令、SwiftUI、shader —— 这里什么都拼不出来。
 *
 * 旧写法会**悄悄**给出一张空白图版：缩略图、放大预览全空，
 * 而构建、测试、站点一个都不报错。预览渲染不了不是错误，装作渲染了才是。
 */
test('示例不是网页语言时，图版直说渲染不了，而不是给一张白图', () => {
  const entry = {
    meta: { title: '某个 React 效果', slug: 'r', stage: 'plain' },
    description: '描述。',
    code: [{ lang: 'tsx', lines: ['export const A = () => <div />'], mechanismLines: [] }],
    mechanisms: ['X'],
  }
  const doc = buildDemoDocument(entry)
  assert.match(doc, /不是网页语言写的/, '该明说渲染不了')
  assert.match(doc, /TSX/, '该把语言名列出来')
  assert.match(doc, /抄咒语照常/, '该说明代码仍在、抄咒语不受影响')
  // 不能带着一个空的舞台假装渲染
  assert.doesNotMatch(doc, /demo-stage/, '不该还有空舞台')
  assert.doesNotMatch(doc, /spellbook-markup/, '不该还有空模板')
})

test('只要沾了网页三件套里的任何一件，就照常渲染', () => {
  // 只有 CSS 也算 —— 有些条目本来就只有样式，没有结构也没有脚本
  const doc = buildDemoDocument({
    meta: { title: 't', slug: 't', stage: 'plain' },
    description: 'd',
    code: [{ lang: 'css', lines: ['.a{}'], mechanismLines: [] }],
    mechanisms: [],
  })
  assert.match(doc, /demo-stage/, '有 CSS 就该正常出图版')
  assert.doesNotMatch(doc, /不是网页语言写的/)
})
