/**
 * 罗马数字的排版宽度 —— 只为一件事存在：保证编号不会被挤到标题上去。
 *
 * 为什么非要有这个模块：
 * 目录里每一行都是一张**独立**的栅格（.row-link），所以「编号」那一栏必须是定宽，
 * 标题才能跨行对齐。可罗马数字的宽度是变的 —— 本书 125 条里最长的是 LXXXVIII，
 * 在 0.85rem 下要 69px，而那一栏只给了 42px。结果是 125 行里有 33 行的编号
 * 越出栏外、撞进标题里。定宽 + 变长内容 = 迟早会撞，且不会报错。
 *
 * 所以宽度不能靠拍脑袋写死，得算出来：先离线量一次每个罗马字母在该字体下的宽度，
 * 以后由构建期按当下的条目数算出「最长的那一个需要多宽」，交给 CSS 用。
 * 库长到 400 条时，这里会自己算出一个更宽的栏，而不是悄悄糊在一起。
 *
 * 字宽数据来自浏览器实测（Cinzel 0.85rem、无字距时的单字宽）。改字体或字号要重量一次。
 */

/** 各罗马字母在 REF_SIZE 下的单字宽（px，不含字距）。 */
const GLYPH_W = { I: 4.6, V: 10.07, X: 9.01, L: 7.65, C: 10.34, D: 10.98, M: 12.66 }

/** 上表量测时的字号。其余字号按线性缩放 —— 字体宽度随字号线性变化。 */
const REF_SIZE = 13.6

/** 十进制转罗马数字（1..3999）。 */
export function roman(n) {
  if (!Number.isInteger(n) || n < 1) return ''
  const table = [
    [1000, 'M'], [900, 'CM'], [500, 'D'], [400, 'CD'], [100, 'C'], [90, 'XC'],
    [50, 'L'], [40, 'XL'], [10, 'X'], [9, 'IX'], [5, 'V'], [4, 'IV'], [1, 'I'],
  ]
  let out = ''
  let rest = n
  for (const [value, sign] of table) {
    while (rest >= value) {
      out += sign
      rest -= value
    }
  }
  return out
}

/**
 * 一段罗马数字在给定字号下占多宽（px，含字距）。
 * `trackingEm` 对应 CSS 的 letter-spacing（em）。实测已核对：
 * LXXXVIII@13.6px/0.1em = 69.4px，DCCCLXXXVIII 同条件 = 116.9px。
 */
export function numeralWidth(text, fontSizePx, trackingEm = 0.1) {
  const scale = fontSizePx / REF_SIZE
  const glyphs = [...text].reduce((sum, ch) => sum + (GLYPH_W[ch] ?? 0), 0) * scale
  return glyphs + trackingEm * fontSizePx * text.length
}

/**
 * 在 1..count 里找出最宽的那个罗马数字。
 * 不是取 count 本身 —— 125 条的 CXXV 只有 44px，而 88 的 LXXXVIII 有 69px。
 */
export function widestNumeral(count, fontSizePx, trackingEm = 0.1) {
  let worst = { n: 0, text: '', width: 0 }
  for (let n = 1; n <= count; n += 1) {
    const text = roman(n)
    const width = numeralWidth(text, fontSizePx, trackingEm)
    if (width > worst.width) worst = { n, text, width }
  }
  return worst
}

/**
 * 算出一个「能装下最宽编号」的栏目宽度（rem）。
 * `slack` 是右侧留白，别让编号贴着标题起头。
 */
export function numeralColumnRem(count, { fontSizePx, trackingEm = 0.1, slackPx = 8, remPx = 16, floor = 2.6 } = {}) {
  const worst = widestNumeral(count, fontSizePx, trackingEm)
  const needed = worst.width + slackPx
  return Math.max(floor, Math.ceil((needed / remPx) * 20) / 20)
}

/**
 * 算出一个「能装下最宽编号」的字号（rem），用来给页边注那种大编号封顶。
 * 页边注的栏只有 176px（--rail-w），2.4rem 的 LXXXVIII 要 195px，是装不下的。
 */
export function numeralFontRem(count, { maxWidthPx, trackingEm = 0.06, remPx = 16, cap = 2.4 } = {}) {
  // 先按基线量一次不含 padding 的宽，再解出能塞进 maxWidthPx 的字号
  const base = widestNumeral(count, REF_SIZE, trackingEm)
  if (!base.width) return cap
  const fitted = (REF_SIZE * maxWidthPx) / base.width
  return Math.min(cap, Math.floor((fitted / remPx) * 20) / 20)
}
