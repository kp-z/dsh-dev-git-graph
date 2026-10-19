/**
 * 图例位置的**漂移守卫**（R151 / 用户："图例位置需要优化"）。
 *
 * 这一条为什么必须有测试：图例的位置不是一个"好不好看"的问题，而是一条**会被悄悄改回去**
 * 的历史。R65 把图例放进了 `.view-controls` 簇，`layout.css` 却一直留着它更早的
 * "舞台左下角浮层"写法（`position: absolute; left/bottom`）——于是它相对**簇**再偏
 * 16px / 74px；展开时是一整行 807px，1440×900 与 1024×768 都越出舞台 624px，
 * 被 `.stage` 的 `overflow: hidden` 裁掉（点了"图例"却只看见前三条）。
 *
 * 真正的证明在真浏览器里（`__agentWorldLegend.measure()`，判据 `insideStage` /
 * `overlap*`，数字见 PROGRESS R151）。这个文件只守**结构**：
 *   · 收起态必须在簇的流里（`.legend` 只许 `position: relative`，不许 left/right/top/bottom）；
 *   · 展开面板必须右对齐胶囊（`right: 0`）、向上浮出（`bottom: calc(100% …)`）、
 *     宽度有上限（`min(340px, …)`）——这三条一起保证它不越出舞台；
 *   · `#legend` 必须还在 `#view-controls` 里（防止有人把 DOM 搬回舞台角落却没改样式）。
 *
 * 只读 CSS/HTML 文本，不引浏览器与 DOM —— 和 `board-layout-readability.test.js` 同一路数。
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..')
const read = (rel) => readFileSync(join(ROOT, rel), 'utf8')

/** 把 CSS 文本拆成 `{ selector, decls }`；处理 `@media` 等嵌套块（只取普通规则）。 */
function parseRules(css) {
  const text = css.replace(/\/\*[\s\S]*?\*\//g, '')
  const rules = []
  function walk(src) {
    let i = 0
    while (i < src.length) {
      const open = src.indexOf('{', i)
      if (open === -1) return
      const prelude = src.slice(i, open).trim()
      let depth = 1
      let j = open + 1
      while (j < src.length && depth > 0) {
        if (src[j] === '{') depth += 1
        else if (src[j] === '}') depth -= 1
        j += 1
      }
      const body = src.slice(open + 1, j - 1)
      if (prelude.startsWith('@')) {
        walk(body)
      } else {
        const decls = []
        for (const part of body.split(';')) {
          const colon = part.indexOf(':')
          if (colon === -1) continue
          decls.push({ prop: part.slice(0, colon).trim(), value: part.slice(colon + 1).trim() })
        }
        rules.push({ selector: prelude, decls })
      }
      i = j
    }
  }
  walk(text)
  return rules
}

/** 选择器列表里**正好**包含 `want` 的元素（`a, b` 拆开后逐项精确比较）。 */
const targets = (selector, want) => selector.split(',').some((s) => s.trim() === want)

/** 取某选择器下所有声明（可能分散在多条同名规则里）。 */
function declsOf(rules, want) {
  return rules.filter((r) => targets(r.selector, want)).flatMap((r) => r.decls)
}

const COMPONENTS = parseRules(read('web/styles/components.css'))
const LAYOUT = parseRules(read('web/styles/layout.css'))

test('收起态：图例在视图控制簇的流里，不是绝对定位的浮层', () => {
  const decls = declsOf([...COMPONENTS, ...LAYOUT], '.legend')
  assert.ok(decls.length > 0, '找不到 .legend 的样式了')
  for (const decl of decls) {
    if (decl.prop === 'position') {
      assert.equal(
        decl.value,
        'relative',
        '收起态的图例只能是 position: relative（它住在 .view-controls 的 flex 流里）；' +
          'absolute 会复现 R151 之前的"相对簇再偏出去、展开被舞台裁掉"',
      )
    }
    assert.ok(
      !['left', 'right', 'top', 'bottom'].includes(decl.prop),
      `.legend 上不能再有 ${decl.prop}——收起态没有"浮在哪"这件事；展开面板的位置在 .legend-items 里`,
    )
  }
})

test('展开态：右对齐胶囊、向上浮出、宽度有上限（三条一起保证不越出舞台）', () => {
  const selector = '.legend:not(.is-collapsed) .legend-items'
  const decls = declsOf([...COMPONENTS, ...LAYOUT], selector)
  assert.ok(decls.length > 0, `找不到 ${selector} 的样式了`)
  const value = (prop) => decls.find((d) => d.prop === prop)?.value ?? null

  assert.equal(value('position'), 'absolute', '展开面板是浮层')
  assert.equal(value('right'), '0', '右边缘必须与胶囊对齐（用 right，不是 left 偏移）')
  assert.match(value('bottom') ?? '', /^calc\(100% \+ var\(--s-2\)\)$/, '必须从胶囊向上浮出（100% + 间距）')
  assert.match(value('width') ?? '', /^min\(\s*340px,/, '宽度必须有 340px 上限（否则整行 807px 越界）')
  assert.equal(value('display'), 'grid', '两列排版，避免一行铺满整条舞台')
  assert.equal(value('overflow'), 'auto', '纸条种类变多时给高度上限并滚动，而不是越界')
  assert.match(value('max-height') ?? '', /^min\(/, '高度必须封顶')

  const cols = value('grid-template-columns') ?? ''
  assert.match(cols, /repeat\(2,/, '两列：实测 8 条图例在 340px 内两列 4 行（122px 高）')
})

test('收起态不渲染图例列表（display: none 是唯一隐藏方式）', () => {
  const decls = declsOf([...COMPONENTS, ...LAYOUT], '.legend-items')
  const display = decls.find((d) => d.prop === 'display')?.value ?? null
  assert.equal(display, 'none', '收起态的 .legend-items 必须是 display: none')
  const collapsed = declsOf([...COMPONENTS, ...LAYOUT], '.legend:not(.is-collapsed) .legend-items')
  assert.ok(collapsed.some((d) => d.prop === 'display' && d.value === 'grid'), '展开态才把列表显示成 grid')
})

test('#legend 必须还在 #view-controls 这个簇里', () => {
  const html = read('web/index.html')
  const clusterAt = html.indexOf('id="view-controls"')
  const legendAt = html.indexOf('id="legend"')
  assert.ok(clusterAt !== -1 && legendAt !== -1, '#view-controls 或 #legend 不见了')
  assert.ok(legendAt > clusterAt, '#legend 掉到 #view-controls 后面了')
  const between = html.slice(clusterAt, legendAt)
  assert.equal(between.includes('</div>'), false, '#legend 已经不在视图控制簇内部了——搬 DOM 就要连样式与注释一起改')
})
