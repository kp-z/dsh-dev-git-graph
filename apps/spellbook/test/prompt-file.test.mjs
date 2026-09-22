/**
 * 抄咒语留下的 prompt.txt 是完整的。
 *
 * 这是首页「抄咒语」真正交给用户的东西：一个纯文本文件，首页本身不加载它，
 * 但它是用户带走的全部内容，缺一段就等于抄走了半条咒语。
 *
 * 之前这里出过一次：生成器只认 block.lines，而库里的数据是 block.body，
 * 于是每一份 prompt.txt 的代码段都是空的 —— 文件在、标题在、代码没了，
 * 网站上看不出任何异常。
 *
 * 判空的写法要留神：prompt.txt 用的是「--- HTML ---」这种分节标记，**不是**
 * markdown 栅栏。我先前拿 ``` 去数「空代码块」，数出 124 份"空"，全是误报。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync, readFileSync, existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const SPELL = path.join(ROOT, 'dist', 'spell')

test('每一份 prompt.txt 的每个代码段都非空', () => {
  assert.ok(existsSync(SPELL), 'dist/spell 还没建，先跑 node build.mjs')
  const slugs = readdirSync(SPELL)

  const empty = []
  const noSection = []
  const leak = []

  for (const slug of slugs) {
    const file = path.join(SPELL, slug, 'prompt.txt')
    if (!existsSync(file)) {
      noSection.push(`${slug}（文件都没生成）`)
      continue
    }
    const text = readFileSync(file, 'utf8')

    // 「--- X ---」后面跟的正文不能是空的
    const parts = text.split(/^--- (.+?) ---$/m)
    for (let i = 1; i < parts.length; i += 2) {
      if (!(parts[i + 1] ?? '').trim()) empty.push(`${slug}:${parts[i]}`)
    }
    if (!/^--- /m.test(text)) noSection.push(`${slug}（一个代码段都没有）`)
    // 给模型的注释标记不该泄进给用户的文本里
    if (text.includes('@mechanism')) leak.push(slug)
  }

  assert.deepEqual(empty, [], `这些代码段是空的：${empty.join(', ')}`)
  assert.deepEqual(noSection, [], `这些没有代码段：${noSection.join(', ')}`)
  assert.deepEqual(leak, [], `@mechanism 泄进了正文：${leak.join(', ')}`)
})

test('每一份 prompt.txt 都带上了机制那一句 —— 它是迁移时唯一不能丢的部分', () => {
  assert.ok(existsSync(SPELL), 'dist/spell 还没建')
  const missing = []
  for (const slug of readdirSync(SPELL)) {
    const text = readFileSync(path.join(SPELL, slug, 'prompt.txt'), 'utf8')
    if (!/靠什么成立：/.test(text) || !/参考实现/.test(text)) missing.push(slug)
  }
  assert.deepEqual(missing, [], `缺少「靠什么成立」或「参考实现」：${missing.join(', ')}`)
})
