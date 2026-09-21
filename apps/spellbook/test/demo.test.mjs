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
