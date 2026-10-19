/**
 * 侧边栏重设计的**漂移守卫**（R152 / 用户："整体都需要重新设计下"）。
 *
 * 这一轮删掉的三样东西，每一样都曾经**活了很久**（成员开合 R46 起、溢出提示 R45 起），
 * 而且删除之后功能仍然"看起来正常"——所以它们很容易被下一次重构顺手加回来：
 *
 *   1. `membersToggle`（「收起/展开」）—— 用户拍板「成员看板不需要收起按钮」；
 *   2. `graphHint`（「（比可见区大 341×0px，图内可滚动）」）—— 调试读数，不该给用户看；
 *   3. 成员卡的左侧 3px 部门色竖条 —— 换成了头像块（同一信息，更小的面积）。
 *
 * 真机的判据在浏览器里（`__agentWorldSidebar.stats()` 与 DOM 查询，数字见 PROGRESS R152）；
 * 这个文件只守源码层面的"别再长回来"。只读文本，不引 DOM/浏览器。
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..')
const read = (rel) => readFileSync(join(ROOT, rel), 'utf8')

/**
 * 去掉注释再断言。
 *
 * 这些注释**故意**写着「R152 删掉了 membersToggle / 比可见区大」——留着是给下一个
 * 读代码的人解释"为什么这里没有它"。守卫要守的是**代码**，不是解释。
 */
function stripComments(source) {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
}

const BOARD = stripComments(read('web/ui/board.js'))
const SIDEBAR_JS = stripComments(read('web/ui/sidebar.js'))
const SIDEBAR_CSS = stripComments(read('web/styles/sidebar.css'))
const COMPONENTS = stripComments(read('web/styles/components.css'))

test('成员看板没有开合：源码里不再有 toggle / membersOpen', () => {
  for (const word of ['board-members-toggle', 'membersToggle', 'setMembersOpen', 'membersOpen', 'applyNarrowDefault']) {
    assert.equal(BOARD.includes(word), false, `board.js 里还留着 \`${word}\` —— 成员看板现在是常开的`)
  }
  assert.equal(COMPONENTS.includes('.board-members-toggle'), false, 'components.css 里还有开合按钮的样式')
  assert.equal(COMPONENTS.includes('.board-members.is-collapsed'), false, 'components.css 里还有"成员栏收起"的样式')
})

test('图头不再有溢出提示：源码与样式里都没有那句话', () => {
  for (const word of ['比可见区大', 'board-graph-hint', 'graphHint', '图内可滚动']) {
    assert.equal(BOARD.includes(word), false, `board.js 里还留着 \`${word}\``)
    assert.equal(COMPONENTS.includes(word), false, `components.css 里还留着 \`${word}\``)
  }
})

test('标题只有一层：侧边栏给 header + 计数位，看板不再自己写 h3', () => {
  assert.equal(BOARD.includes("'h3'"), false, 'board.js 里还在建 h3 —— 标题应该只在侧边栏外壳里出现一次')
  for (const word of ['sidebar-region-head', 'sidebar-region-meta', 'agentsMeta', 'graphMeta']) {
    assert.ok(SIDEBAR_JS.includes(word), `sidebar.js 缺少 ${word}（header + 计数位是 R152 的骨架）`)
  }
})

test('成员卡的部门色从"左侧竖条"改成"头像块"', () => {
  assert.equal(COMPONENTS.includes('.board-member::before'), false, '左边那条 3px 竖条的样式还在')
  assert.ok(COMPONENTS.includes('.board-member-avatar'), '缺少头像块样式')
  assert.ok(BOARD.includes('memberInitial'), 'board.js 没有用 memberInitial 生成头像字')
})

test('图画布是"点阵规划板"，节点按档位换密度', () => {
  const canvasRule = COMPONENTS.slice(COMPONENTS.indexOf('.board-canvas {'), COMPONENTS.indexOf('.board-fit {'))
  assert.ok(canvasRule.includes('background-image'), '画布缺少点阵底（背景图）')
  assert.ok(canvasRule.includes('overflow: auto'), '画布必须自己滚（M7-9 的纪律）')
  assert.ok(COMPONENTS.includes("[data-fit='tight']"), '节点缺少 tight 档的密度切换')
  const nodeRule = COMPONENTS.slice(COMPONENTS.indexOf('.board-node {'), COMPONENTS.indexOf('.board-node:hover'))
  assert.equal(nodeRule.includes('border-left'), false, '节点又加回了左侧彩色竖条')
})

test('侧边栏的滚动条/选区/焦点都按主题上色（craft floor 的 browser surfaces）', () => {
  assert.ok(SIDEBAR_CSS.includes('::-webkit-scrollbar-thumb'), '缺少滚动条主题样式')
  assert.ok(SIDEBAR_CSS.includes('::selection'), '缺少选区颜色')
  assert.ok(SIDEBAR_CSS.includes(':focus-visible'), '缺少焦点环')
})
