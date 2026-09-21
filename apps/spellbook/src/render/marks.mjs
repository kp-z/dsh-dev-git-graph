/**
 * 书里的图形装置：魔杖与花饰。
 *
 * 两条自律：
 *  1. 只用线稿，颜色一律走 currentColor —— 明暗两套主题不需要各写一份。
 *  2. 不画光晕、不画渐变、不用紫色。装饰要像印刷上去的，不像发光的。
 *
 * 魔杖是这本书的「器械」：一句话就是咒语，魔杖就是那句话。
 */

/** 四角星：外半径 r，内半径 r*0.3，凹边。 */
function star(cx, cy, r) {
  const i = r * 0.3
  const n = (value) => Math.round(value * 100) / 100
  return [
    `M${n(cx)} ${n(cy - r)}`,
    `L${n(cx + i)} ${n(cy - i)}`,
    `L${n(cx + r)} ${n(cy)}`,
    `L${n(cx + i)} ${n(cy + i)}`,
    `L${n(cx)} ${n(cy + r)}`,
    `L${n(cx - i)} ${n(cy + i)}`,
    `L${n(cx - r)} ${n(cy)}`,
    `L${n(cx - i)} ${n(cy - i)}`,
    'Z',
  ].join(' ')
}

/**
 * 魔杖：杖身与杖尾的圆头用墨色描边，杖尖与一颗火星用强调色填实。
 * 强调色是群青 —— 与描述里的机制同色，因为魔杖点的就是机制。
 *
 * 只留一颗火星：在刊头那 21px 的尺寸下，更小的火星会糊成一个点，
 * 看着像脏，而不像火星。
 */
export function wandMark(className = 'wand') {
  return `<svg class="${className}" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path class="wand-shaft" d="M5.8 18.2 15.6 8.4"/>
      <circle class="wand-shaft" cx="4.4" cy="19.6" r="1.7"/>
      <path class="wand-spark" d="${star(18.4, 5.6, 4.3)}"/>
      <path class="wand-spark" d="${star(21, 13.2, 1.9)}"/>
    </svg>`
}

/** 花饰：细线—魔杖—细线。用在序言与正文之间，是印刷书里的分隔纹。 */
export function fleuron(className = 'fleuron') {
  return `<div class="${className}" aria-hidden="true">
      <span class="fleuron-rule"></span>
      ${wandMark('fleuron-wand')}
      <span class="fleuron-rule"></span>
    </div>`
}
