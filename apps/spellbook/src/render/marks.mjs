/**
 * 书里的图形装置：魔法书、魔杖、花饰。
 *
 * 三条自律：
 *  1. 只用线稿，颜色一律走 currentColor —— 明暗两套主题不需要各写一份。
 *  2. 不画光晕、不画渐变、不用紫色。装饰要像印刷上去的，不像发光的。
 *  3. 线稿只有两种笔画：`mark-line`（描边）与 `mark-spark`（填实的火星）。
 *     三个装置共用这两种，所以名字不挂在某一个装置上 —— 书身上不该长着魔杖的零件。
 *
 * 「书」与「杖」的分工是这本书的立论：
 *   书是**物**（刊头那一枚：这本书自己），杖是**器械**（查词口那一枚：你用来说话的东西）。
 *   刊头放书不放杖，是因为刊头答的是「这是什么」，不是「你怎么用」。
 */

/**
 * 八点也不必要、四角星就够：外半径 r，内半径 r*0.3，凹边。
 *
 * 星只给一颗。在刊头那 22px 的尺寸下，再小的一颗会糊成一个点，看着像脏，
 * 而不像火星。
 */
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
 * 魔法书：一本合着的书（封面 + 书脊 + 书扣），右上角一颗火星。
 *
 * 为什么是合着的书而不是摊开的：22px 下摊开的书要画两页纸的弧度，
 * 那点弧度会糊成两条并列的横线，看着像等号。合着的书只有三条直线
 * —— 封面框、书脊、书扣 —— 小尺寸下轮廓反而最清楚。
 *
 * 书扣那一横是**故意捅出封面右边线**的：不捅出去，这本书读起来就是一个方框；
 * 捅出去 0.8 个单位，才认出是「扣着的书」。火星与封面右缘留 0.9 个单位的空隙，
 * 挨上的话两个形状会粘成一个墨疙瘩。
 */
export function bookMark(className = 'book') {
  return `<svg class="${className}" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <rect class="mark-line" x="3.8" y="4.2" width="11.8" height="16.4" rx="1.5"/>
      <path class="mark-line" d="M7.2 4.2v16.4"/>
      <path class="mark-line" d="M13.6 12.4h2.8"/>
      <path class="mark-spark" d="${star(20, 6.6, 3.5)}"/>
    </svg>`
}

/**
 * 魔杖：杖身与杖尾的圆头用墨色描边，杖尖与一颗火星用强调色填实。
 * 强调色是鎏金 —— 金只给器物，杖是器物。
 */
export function wandMark(className = 'wand') {
  return `<svg class="${className}" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path class="mark-line" d="M5.8 18.2 15.6 8.4"/>
      <circle class="mark-line" cx="4.4" cy="19.6" r="1.7"/>
      <path class="mark-spark" d="${star(18.4, 5.6, 4.3)}"/>
      <path class="mark-spark" d="${star(21, 13.2, 1.9)}"/>
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
