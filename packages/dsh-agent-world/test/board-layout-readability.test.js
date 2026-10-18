/**
 * 可读性的**漂移守卫**（R144 / task-20）。
 *
 * `NODE_TITLE_PX`（`web/core/board-layout.js`）与 `.board-node-title` 的 CSS 字号是**手工同步**的：
 * 一处改了另一处没改，`MIN_SCALE` 这条"可读下限"就会说谎——缩放到 0.8 时屏幕上的字不再是它以为的大小。
 *
 * 为什么不让 `board-layout.js` 直接读 CSS（Lead 裁定，R122）：它是纯模块，在 node 里跑单测、没有 DOM；
 * 让它读 CSS 就是用"自动化"换掉"可测性"。真机那一路已有 `readability()` 用 `getComputedStyle` 交叉核对，
 * 缺的只是**纯模块这一路**的守卫——就是这个文件：**只用 `node:fs` 读 CSS 文本，不引任何浏览器/DOM**。
 *
 * 解析要"顺着 `var()` 走到底"：真机上字号来自 `--fs-sub`，以后也可能再套一层；只匹配一层会让守卫在
 * 第一次重构 token 时就静默失效。所以下面有一条**解析器自检**用例，证明它真的能走多层、能用回退值。
 */
import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

import { MIN_SCALE, NODE_TITLE_PX, READABLE_MIN_PX } from '../web/core/board-layout.js'

const STYLES = join(fileURLToPath(new URL('.', import.meta.url)), '..', 'web', 'styles')
const TITLE = '.board-node-title'

/**
 * 把 CSS 文本拆成 `{ selector, decls }` 规则（处理 `@media` 等嵌套块；只取普通规则）。
 * 刻意写得小：这里不需要完整的 CSS 解析器，只需要"哪个选择器声明了什么"。
 */
function parseRules(css, file) {
  const text = css.replace(/\/\*[\s\S]*?\*\//g, '')
  const rules = []
  function walk(src) {
    let i = 0
    while (i < src.length) {
      const open = src.indexOf('{', i)
      if (open === -1) return
      const prelude = src.slice(i, open).trim()
      // 找到与之配对的 `}`
      let depth = 1
      let j = open + 1
      while (j < src.length && depth > 0) {
        if (src[j] === '{') depth += 1
        else if (src[j] === '}') depth -= 1
        j += 1
      }
      const body = src.slice(open + 1, j - 1)
      if (prelude.startsWith('@')) {
        walk(body) // @media / @supports：里面还是规则
      } else {
        const decls = []
        for (const part of body.split(';')) {
          const colon = part.indexOf(':')
          if (colon === -1) continue
          decls.push({ prop: part.slice(0, colon).trim(), value: part.slice(colon + 1).trim() })
        }
        rules.push({ file, selector: prelude, decls })
      }
      i = j
    }
  }
  walk(text)
  return rules
}

/** 选择器列表里有没有一项**正好**以 `.board-node-title` 这个类结尾（不匹配 `.board-node-title-x`）。 */
function targetsTitle(selector) {
  return selector.split(',').some((s) => /\.board-node-title$/.test(s.trim()))
}

/**
 * 顺着 `var()` 解析到最终值。`vars`：自定义属性名 → **所有**定义 `[{value, where}]`。
 * 只有**链上用到的**变量才要求各处定义一致——不相干的变量（如 `--sidebar-w` 的响应式覆盖）不该让守卫误报。
 * 支持回退值 `var(--x, 12px)`；深度上限防循环引用。
 */
function resolveValue(value, vars, depth = 0) {
  assert.ok(depth < 10, `var() 解析超过 10 层（循环引用？）：${value}`)
  const m = /^var\(\s*(--[\w-]+)\s*(?:,\s*(.+))?\)$/.exec(value.trim())
  if (m === null) return value.trim()
  const [, name, fallback] = m
  const defs = vars.get(name)
  if (defs !== undefined) {
    const values = [...new Set(defs.map((d) => d.value))]
    assert.equal(
      values.length,
      1,
      `${name} 在字号的解析链上，却被定义了多种值（${defs.map((d) => `${d.where} = ${d.value}`).join('；')}）——` +
        '作用域覆盖时这个文件级守卫判断不了实际生效的是哪一个，请把守卫改成按作用域解析',
    )
    return resolveValue(values[0], vars, depth + 1)
  }
  assert.ok(fallback !== undefined, `CSS 变量 ${name} 没有定义、也没有回退值`)
  return resolveValue(fallback, vars, depth + 1)
}

/** 读全部样式，算出 `.board-node-title` 的最终字号（像素）。有歧义就**直接失败并说明**，不替人挑一个。 */
function titleFontPx(rules) {
  const vars = new Map()
  for (const r of rules) {
    for (const d of r.decls) {
      if (!d.prop.startsWith('--')) continue
      if (!vars.has(d.prop)) vars.set(d.prop, [])
      vars.get(d.prop).push({ value: d.value, where: `${r.file} ${r.selector}` })
    }
  }
  const sizes = []
  for (const r of rules) {
    if (!targetsTitle(r.selector)) continue
    for (const d of r.decls) if (d.prop === 'font-size') sizes.push({ where: `${r.file}: ${r.selector}`, raw: d.value })
  }
  assert.ok(sizes.length > 0, `没有任何规则给 ${TITLE} 设 font-size——守卫没东西可守，类名改了吗？`)
  const resolved = sizes.map((s) => ({ ...s, px: resolveValue(s.raw, vars) }))
  const distinct = [...new Set(resolved.map((s) => s.px))]
  assert.equal(
    distinct.length,
    1,
    `${TITLE} 的 font-size 有多个不同的最终值：${resolved.map((s) => `${s.where} → ${s.raw} = ${s.px}`).join('；')}`,
  )
  const px = /^(\d+(?:\.\d+)?)px$/.exec(distinct[0])
  assert.ok(px !== null, `${TITLE} 的字号解析到 "${distinct[0]}"，不是像素值——守卫需要像素才能和 NODE_TITLE_PX 比`)
  return { px: Number(px[1]), trail: resolved.map((s) => `${s.where} → ${s.raw} = ${s.px}`) }
}

function loadAllRules() {
  const files = readdirSync(STYLES).filter((f) => f.endsWith('.css'))
  assert.ok(files.length > 0, `没找到样式文件：${STYLES}`)
  return files.flatMap((f) => parseRules(readFileSync(join(STYLES, f), 'utf8'), f))
}

test('解析器自检：顺着 var() **走到底**（多层 + 回退值），不是只匹配一层', () => {
  const rules = parseRules(
    `:root { --a: var(--b); --b: var(--c, 99px); --c: 12px; }
     @media (min-width: 1px) { .x .board-node-title { font-size: var(--a); } }
     .board-node-title-ish { font-size: 50px; }   /* 名字只是前缀相同，不许算进来 */`,
    'fixture.css',
  )
  assert.equal(titleFontPx(rules).px, 12, '三层 var() + @media 嵌套里的规则')
  const withFallback = parseRules(`.board-node-title { font-size: var(--missing, 11px); }`, 'f.css')
  assert.equal(titleFontPx(withFallback).px, 11, '变量缺失时用回退值')
  assert.throws(
    () => titleFontPx(parseRules(`:root{--s:13px} #a{--s:14px} .board-node-title{font-size:var(--s)}`, 'f.css')),
    /多种值/,
    '**链上的**变量有两种值 = 作用域歧义，必须报出来而不是随便挑一个',
  )
  // 不相干的变量（不在字号的解析链上）有多种值，不许让守卫误报——真机里 --sidebar-w 就有响应式覆盖。
  const unrelated = parseRules(`:root{--w:600px;--s:13px} @media (max-width:1px){:root{--w:520px}} .board-node-title{font-size:var(--s)}`, 'f.css')
  assert.equal(titleFontPx(unrelated).px, 13)
})

test('★ NODE_TITLE_PX 必须等于 `.board-node-title` 在 CSS 里的真实字号（两处该一起改）', () => {
  const { px, trail } = titleFontPx(loadAllRules())
  assert.equal(
    NODE_TITLE_PX,
    px,
    `NODE_TITLE_PX = ${NODE_TITLE_PX}，但 CSS 里 ${TITLE} 的字号是 ${px}px（${trail.join('；')}）。\n` +
      '这两处是手工同步的：改了 tokens/组件样式里的字号，就要同时改 web/core/board-layout.js 的 NODE_TITLE_PX——' +
      '否则 MIN_SCALE 算出来的"可读下限"会说谎（R120/R121）。',
  )
})

test('MIN_SCALE 落在 READABLE_MIN_PX / NODE_TITLE_PX 推出来的位置（不是写死的数）', () => {
  const ratio = READABLE_MIN_PX / NODE_TITLE_PX
  // 下限：缩到 MIN_SCALE 时，标题的屏幕高度不能低于可读下限。
  assert.ok(
    NODE_TITLE_PX * MIN_SCALE >= READABLE_MIN_PX,
    `MIN_SCALE=${MIN_SCALE} 时标题只有 ${NODE_TITLE_PX * MIN_SCALE}px，低于可读下限 ${READABLE_MIN_PX}px`,
  )
  // 取整规则：代码已定的关系是"向上取到一位小数"（board-layout.js 注释：0.769… → 0.8；Lead 裁定 R144 选 A）。
  // 若有人改了取整方式（比如改成两位小数 0.77），这条会红——那是改判据，要先拍板再改。
  assert.equal(
    MIN_SCALE,
    Math.ceil(ratio * 10) / 10,
    `MIN_SCALE 应等于 ceil(${READABLE_MIN_PX}/${NODE_TITLE_PX}×10)/10 = ${Math.ceil(ratio * 10) / 10}，实际 ${MIN_SCALE}`,
  )
})
