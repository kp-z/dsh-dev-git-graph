/**
 * 仪表盘样式表（`dashboardStyles.js`）的防回退红线测试。
 *
 * 为什么单独一个文件：`test/overviewPanel.mjs` 里的红线断言只 import 了 `styles.js` 的 `CSS`，
 * 而仪表盘那份 22KB / 360+ 条规则是**另一张样式表**（独立 style id、独立前缀 fd-/fr-）。
 * 复核（docs/REVIEW-tab-pages-round1.md R2）指出：这张表今天合规，但**没有人守**——
 * 以后谁往它里面写一个 #hex，或者用了一个白名单外的令牌，测试不会红。
 *
 * 跑法：node test/dashboardStyles.mjs
 */
import assert from 'node:assert/strict'

import { CSS, STYLE_ID, injectStyles } from '../src/client/dashboardStyles.js'

let passed = 0
const failures = []
function check(name, fn) {
  try {
    fn()
    passed += 1
    console.log(`  ok  ${name}`)
  } catch (error) {
    failures.push(name)
    console.log(`  FAIL ${name}`)
    console.log(String((error && error.stack) || error).split('\n').slice(0, 5).map((line) => `       ${line}`).join('\n'))
  }
}

/* 宿主令牌白名单：与 client/Theme 的 BUILTIN_INSPECT_TOKENS 一致（13 个 alias + 1 个 specific）。 */
const HOST_TOKENS = [
  '--dsw-alias-bg-base',
  '--dsw-alias-bg-layer-1',
  '--dsw-alias-bg-layer-2',
  '--dsw-alias-bg-overlay',
  '--dsw-alias-border-l1',
  '--dsw-alias-border-l2',
  '--dsw-alias-brand-primary',
  '--dsw-alias-label-primary',
  '--dsw-alias-label-secondary',
  '--dsw-alias-state-error-primary',
  '--dsw-alias-state-idle-primary',
  '--dsw-alias-state-success-primary',
  '--dsw-alias-state-warn-primary',
  '--dsw-specific-sidebar-fill',
]

/** 剥掉注释再判：注释里出现「#hex / rgb()」这种举例不该算违规（上一轮就被它误伤过）。 */
const stripComments = (css) => css.replace(/\/\*[\s\S]*?\*\//g, '')

const CSS_CODE = stripComments(CSS)

check('style id 与前缀约定：dsh-feishu-dashboard-style + fd-/fr-', () => {
  assert.equal(STYLE_ID, 'dsh-feishu-dashboard-style')
  assert.equal(typeof injectStyles, 'function')
})

check('零字面量颜色（剥掉注释后仍然一个都没有）', () => {
  assert.deepEqual(CSS_CODE.match(/#[0-9a-fA-F]{3,8}\b|\brgba?\(|\bhsla?\(/g) || [], [])
  /* 同样的判定在没剥注释时也只允许出现在注释里（这里反向证明：剥注释前后差异只来自注释） */
  const withComments = CSS.match(/#[0-9a-fA-F]{3,8}\b|\brgba?\(|\bhsla?\(/g) || []
  assert.ok(withComments.length === 0, `带注释时也应没有（实际 ${withComments.length} 处）`)
})

check('只引用宿主那 14 个令牌：没有自造变量、没有别名拼错', () => {
  /* `g(token, pct)` 助手会拼成 var(--dsw-alias-${token})，所以还要把它的调用点也算进来 */
  const direct = CSS_CODE.match(/--dsw-[a-z0-9-]+/g) || []
  const suffix = [...CSS_CODE.matchAll(/\bg\('([a-z0-9-]+)'/g)].map((match) => `--dsw-alias-${match[1]}`)
  const used = [...new Set([...direct, ...suffix])]
  const unknown = used.filter((token) => !HOST_TOKENS.includes(token))
  assert.deepEqual(unknown, [], `用了白名单外的令牌：${unknown.join(', ')}`)
  assert.ok(used.length >= 8, `令牌用得太少（${used.length}），是不是样式被删了？`)
  assert.deepEqual(CSS_CODE.match(/--p-[a-z0-9-]+|--ov-[a-z0-9-]+/g) || [], [], '不许出现自造调色板')
})

check('所有规则都长在插件前缀下（.fd- / .fr-），不污染宿主', () => {
  const selectors = [...CSS_CODE.matchAll(/(^|\})\s*([^{}@]+)\{/g)]
    .map((match) => match[2].trim())
    .filter(Boolean)
    /* @keyframes 的 from / to / 50% 不是选择器，别当成「没有前缀」。 */
    .filter((selector) => !/^(from|to|\d+%)$/.test(selector))
  const bad = selectors.filter((selector) => !/^\.(fd|fr)-/.test(selector))
  assert.deepEqual(bad, [], `这些选择器没有插件前缀：${bad.slice(0, 5).join(' | ')}`)
  assert.ok(selectors.length >= 100, `规则数偏少（${selectors.length}），估计解析方式失效了`)
})

check('减少动效：呼吸/脉冲一律 !important 关掉（不能靠源码顺序）', () => {
  const block = CSS_CODE.match(/@media \(prefers-reduced-motion: reduce\) \{([\s\S]*?)\n\}/)
  assert.ok(block, '没有 prefers-reduced-motion 分支')
  const body = block[1]
  assert.ok(/\.fr-bubble\.is-running[^{]*\{[^}]*animation: none !important/.test(body), '运行中气泡要 animation: none !important')
  assert.ok(/\.fr-bubble-pulse[^{]*\{[^}]*animation: none !important/.test(body), '外圈脉冲要关')
  assert.ok(/animation: none !important/.test(body) && /transition: none !important/.test(body), '动效与过渡都要关')
})

check('运行中气泡真的接了呼吸动画（正反向都钉住）', () => {
  assert.ok(/@keyframes fr-breathe/.test(CSS_CODE), '要有 fr-breathe 关键帧')
  assert.ok(/\.fr-bubble\.is-running[^{]*\{[^}]*animation: fr-breathe/.test(CSS_CODE), '运行中气泡要用 fr-breathe')
  /* 已完成不能呼吸：done 状态不带 is-running（组件侧决定），这里钉住 CSS 不会「凡气泡皆呼吸」 */
  const anyBubbleAnimation = CSS_CODE.match(/\.fr-bubble\s*\{[^}]*animation: fr-breathe/)
  assert.equal(anyBubbleAnimation, null, '普通气泡不该无条件呼吸')
})

check('填满：网格是 auto-fit + 1fr 行高（不是固定列数）', () => {
  assert.ok(/grid-template-columns: repeat\(auto-fit, minmax\(240px, 1fr\)\)/.test(CSS_CODE))
  assert.ok(/grid-auto-rows: 1fr/.test(CSS_CODE))
})

console.log(`\ndashboardStyles.js: ${passed} passed, ${failures.length} failed`)
if (failures.length) process.exit(1)
console.log('DASHBOARD_STYLES_OK')
