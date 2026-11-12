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

check('发光是两层外圈 + 一层内发光 + 顶部内高光（对齐参考项目的 box-shadow 配方）', () => {
  assert.ok(orbBody.includes('glowOuter'), '缺第一层外发光')
  assert.ok(orbBody.includes('glowOuter2'), '缺第二层外发光')
  assert.ok(orbBody.includes('-innerglow'), '缺内发光渐变')
  assert.ok(orbBody.includes('50 - R * 0.5'), '缺顶部内高光弧线')
})

check('发光/水面颜色用 rgba 原值（与参考项目一致），不依赖令牌表达式', () => {
  assert.ok(/rgba\(\$\{c\[0\]\}/.test(orbBody) || orbBody.includes('const rgba = (c, a)'), '颜色应走 rgba 助手')
  assert.ok(orbBody.includes('const accent = running ?'), '发光颜色应随状态走（运行/挂起/中性）')
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

console.log(`\nrunsOrbInvariants.mjs: ${passed} passed, ${failed.length} failed`)
if (failed.length) process.exitCode = 1
