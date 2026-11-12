/**
 * 运行页气泡的**静态不变量**（node test/runsOrbInvariants.mjs）。
 *
 * 为什么用「读源码做断言」而不是渲染：这几条都踩过一次真实事故，而且事故形态都是
 * 「DOM 里结构看着对、渲染出来却看不见」，普通渲染断言抓不到：
 *
 * 1. **SVG 的 fill/stroke 不接受 `color-mix()`** —— 水面矩形、水位波浪线、两层外发光全是这个写法，
 *    结果整块不可见（用户：「气泡里的水面动画和效果都失效了」）。这里禁止 orbSvg 区域出现 color-mix。
 * 2. **水位只在 running 时画** —— 真实数据里常年 0 条在跑，于是整片气泡都没有水面。
 *    这里禁止「水位外面套 running 三元」这种写法。
 * 3. **图标太大** —— 曾经占圆内 54/100，圆里显得糊；口径是约 1/3（32/100）。
 * 4. **放大档位** —— 用户明确说不要档位（「我要的是图标变小其他的都不变」），不该再回来。
 * 5. **页头统计行 / 卡片刷新按钮 / 头部 revision** —— 用户逐条要求删掉，不该复活。
 */

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const src = readFileSync(new URL('../src/client/RunsFeature.js', import.meta.url), 'utf8')
const panel = readFileSync(new URL('../src/client/OverviewPanel.js', import.meta.url), 'utf8')

let passed = 0
const failed = []
function check(name, fn) {
  try {
    fn()
    passed += 1
    console.log(`  ok  ${name}`)
  } catch (error) {
    failed.push([name, error])
    console.log(`  FAIL ${name}`)
    console.log(`       ${error.message.split('\n')[0]}`)
  }
}

/** 去掉注释：注释里会提到 color-mix()（解释为什么不能用），那不是代码 */
const stripComments = (text) => text
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .split('\n')
  .map((line) => line.replace(/^\s*\/\/.*$/, ''))
  .join('\n')

/** 气泡绘制区：orbInner（圆内内容）+ orbSvg（圆本身、水、发光） */
const orbBody = (() => {
  const start = src.indexOf('const orbInner = (o) => {')
  assert.ok(start > 0, '找不到 orbInner')
  const end = src.indexOf('/** 圆内水位', start)
  return stripComments(src.slice(start, end > 0 ? end : src.length))
})()

check('气泡 SVG 里不出现 color-mix()（表现属性不认，会整块不可见）', () => {
  assert.equal(orbBody.includes('color-mix('), false, 'orbSvg 里出现了 color-mix(')
})

check('水面画在每个泡上（不是只在运行中才画）', () => {
  /* orbBody 已去注释，所以按矩形定位水位段 */
  const water = orbBody.indexOf("h('rect'")
  assert.ok(water > 0, '找不到水位矩形')
  const tail = orbBody.slice(water, water + 700)
  assert.equal(/\brunning\s*\n?\s*\?/.test(tail.split('h(\'g\'')[0] || ''), false,
    '水位不该再套 running ? … : null —— 真实数据里常年 0 条在跑，那样整片气泡都没水面')
  assert.ok(tail.includes('h(\'rect\''), '水位必须有一个填充矩形')
  assert.ok(tail.includes('animate'), '波浪线必须带 SMIL 动画')
})

check('发光是两层外圈 + 一层内发光，并且不再画「顶部高光弧」', () => {
  assert.ok(orbBody.includes('glowOuter'), '缺第一层外发光')
  assert.ok(orbBody.includes('glowOuter2'), '缺第二层外发光')
  assert.ok(orbBody.includes('-innerglow'), '缺内发光渐变')
  /* 参考项目那条 `inset 0 1px 0 white/40` 只有 1px、几乎看不见；
     用 1.8 单位宽的 SVG 弧去模仿，会变成气泡顶上一条明显的灰线（用户点名过）。 */
  assert.equal(orbBody.includes('50 - R * 0.98'), false, '不要顶部高光弧线')
  assert.ok(orbBody.includes('blur1') && orbBody.includes('blur2'), '两层外发光都要带高斯模糊（柔光）')
})

check('发光/水面颜色用 rgba 原值（与参考项目一致），不依赖令牌表达式', () => {
  assert.ok(/rgba\(\$\{c\[0\]\}/.test(orbBody) || orbBody.includes('const rgba = (c, a)'), '颜色应走 rgba 助手')
  /* 口径（用户）：运行中=蓝、完成=绿、报错（阻塞）=黄；等待/未开工沿用绿。
     注意不要再回到「未开始=灰」——那会让整片泡看着没颜色。 */
  assert.ok(orbBody.includes('state === \'running\' ? [59, 130, 246]'), '运行中必须是蓝色')
  assert.ok(orbBody.includes('state === \'blocked\' ? [251, 191, 36]'), '阻塞（报错）必须是黄色')
  assert.ok(orbBody.includes(': [34, 197, 94]'), '完成/等待用绿色')
  assert.equal(orbBody.includes('156, 163, 175'), false, '不该再按「未开始=灰」分色')
})

check('圆内图标占约 1/3（32/100），不是曾经的 54/100', () => {
  assert.equal(orbBody.includes('32 / 24'), true, '图标缩放应基于 32/100')
  assert.equal(orbBody.includes('54 / 24'), false, '不该回到 54/100')
})

check('没有放大档位（用户明确不要）', () => {
  assert.equal(src.includes('frx-zoom'), false, 'RunsFeature 里不该再有放大档位')
  assert.equal(src.includes('orbZoom'), false, '不该再有 orbZoom 状态')
})

check('没有页头统计行（用户要求不显示）', () => {
  assert.equal(src.includes('frx-header'), false, '不该再有页头')
  assert.equal(src.includes('条已完成（不上页）'), false, '不该再有统计副标题')
})

check('运行状态卡片右上没有刷新按钮', () => {
  const start = src.indexOf('const statusCard = card(')
  const end = src.indexOf('/* AVAILABLE MODELS', start)
  const card = src.slice(start, end)
  assert.equal(card.includes('frx-icon-btn'), false, '卡片头部不该再有图标按钮')
  assert.equal(card.includes('onRefresh'), false, '卡片头部不该再挂刷新回调')
})

check('页面头部不再显示 revision / 快照时钟', () => {
  assert.equal(panel.includes('revision ${model.str'), false, '不该再拼 revision 文案')
  assert.equal(panel.includes('clockOf(data && data.now)'), false, '不该再拼快照时钟')
})

check('历史行的状态色口径：运行=蓝 / 阻塞=黄 / 完成=绿（样式表里三色都在）', () => {
  const css = readFileSync(new URL('../src/client/runsExactStyles.js', import.meta.url), 'utf8')
  assert.ok(css.includes('.frx-avatar-dot.is-running { background: #3b82f6; }'), '运行中小圆点应为蓝')
  assert.ok(css.includes('.frx-avatar-dot.is-blocked { background: #f59e0b; }'), '阻塞小圆点应为黄')
  assert.ok(css.includes('.frx-avatar-dot.is-done { background: #22c55e; }'), '完成小圆点应为绿')
  assert.ok(css.includes('.frx-row-status.is-blocked { color: #fbbf24; }'), '阻塞文字应为黄')
  assert.ok(css.includes('.frx-row-status.is-done { color: #4ade80; }'), '完成文字应为绿')
  assert.ok(src.includes("state === 'blocked' ? '阻塞'"), '历史行文案要能表达阻塞')
})

check('运行页自己是滚动容器（宿主 .fo-feature-host 不滚，页面比一屏高）', () => {
  const css = readFileSync(new URL('../src/client/runsExactStyles.js', import.meta.url), 'utf8')
  const start = css.indexOf('.frx-page {')
  const block = css.slice(start, css.indexOf('}', start))
  assert.ok(block.includes('overflow-y: auto'), '.frx-page 必须能纵向滚动（曾经被父层裁掉，用户说「页面无法滚动」）')
  assert.ok(block.includes('min-height: 0'), '.frx-page 要有 min-height:0，否则 flex 子项撑高、滚动条不出现')
  assert.ok(block.includes('overscroll-behavior: contain'), '滚到底不要带着宿主页面一起滚')
})

check('信息不重复：状态卡里不再有「未完成 N 条」和两个 KPI 盒子', () => {
  const card = stripComments(src.slice(src.indexOf("const statusCard = card('status'"), src.indexOf("/* ---------- 卡片 2")))
  assert.equal(card.includes('frx-version'), false, '状态卡头部不该再放「未完成 N 条」（与下方卡片重复）')
  assert.equal(card.includes('frx-boxes'), false, '状态卡底部不该再放「运行中 / 已绑会话」两个盒子（与下方卡片重复）')
  /* 每个数字只出现一次：绑会话只能出现在「运行中」卡里 */
  const total = stripComments(src.slice(src.indexOf("const totalCard = card('total'"), src.indexOf("/* ---------- 卡片 3")))
  assert.equal(total.includes('绑会话'), false, '「未完成任务」卡不该重复会话绑定数')
  assert.equal(total.includes('在跑'), false, '「未完成任务」卡不该重复在跑数（那是「运行中」卡的口径）')
})

console.log(`\nrunsOrbInvariants.mjs: ${passed} passed, ${failed.length} failed`)
if (failed.length) process.exitCode = 1
