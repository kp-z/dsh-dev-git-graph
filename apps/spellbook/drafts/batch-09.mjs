/**
 * 第 9 批采集草稿：真正来自开放许可开源项目的效果。
 *
 * 这一批是对前面八批的一处修正。回看时发现：前 8 批 113 条的出处几乎全是
 * developer.mozilla.org（机制依据），示例都是自己写的 —— 目标里的
 * 「从开放许可的开源项目采集」这一条其实没做到。
 *
 * 所以这一批只收两类来源，且每条都在 source 里点名项目、许可、原效果名：
 *   - miniMAC/magic（MIT，Christian Pucci）
 *   - tobiasahlin/SpinKit（MIT，Tobias Ahlin）
 *
 * 已排除（许可不合格）：
 *   - animate-css/animate.css —— Hippocratic License 2.1，非宽松许可
 *   - connoratherton/loaders.css、IanLunn/Hover —— 仓库内没有 LICENSE
 *
 * 用法：
 *   node scripts/prepare-draft.mjs drafts/batch-09.mjs
 *   node scripts/ingest.mjs drafts/batch-09.mjs --dry-run
 *   node scripts/ingest.mjs drafts/batch-09.mjs
 */

const SINCE = '2026-09'

/* 两个来源的署名，避免每条手写时写歪 */
const MAGIC = 'miniMAC/magic（MIT）'
const SPINKIT = 'tobiasahlin/SpinKit（MIT）'

export default [
  /* ═══════════════ miniMAC/magic（MIT）═══════════════ */
  {
    slug: 'door-open-3d',
    title: '像门一样推开',
    category: '动效',
    tags: ['3D', '变换原点', '铰链'],
    since: SINCE,
    source: `${MAGIC} — openDownLeft，改写为独立最小示例`,
    when: '一块面板要像被推开一扇门那样转出去，而不是原地自转',
    stage: 'dark',
    tier: 'core',
    params: [
      { name: 'angle', label: '推开角度', type: 'range', min: -180, max: 0, step: 10, default: -110, unit: 'deg' },
    ],
    description: `一块底板以左下角为轴转出去，像门被推开。

机制是 ==transform-origin 挪到角上，旋转就从「自转」变成「以那条边为轴铰接」==。默认原点在元素中心，\`rotate()\` 让它在原地打转；把原点放在 \`bottom left\`，同一个旋转就成了绕那条边的开合。

**同一个 \`rotate\`，只因为原点不同，读起来就是两件事。** 这个效果的全部就在这里。`,
    code: [
      {
        lang: 'html',
        body: `<div class="door-stage">
  <div class="door"></div>
</div>`,
      },
      {
        lang: 'css',
        body: `.door-stage {
  display: grid;
  place-items: center;
  width: min(320px, 80vw);
  height: 210px;
  background: #0a0810;
}

.door {
  width: 150px;
  height: 150px;
  background: linear-gradient(150deg, #b4462f, #6d1f30);
  box-shadow: 0 14px 30px rgb(0 0 0 / 0.5);
  /* @mechanism 原点放在左下角，旋转变成绕这条边铰接 */
  transform-origin: bottom left;
  animation: door-swing 2.8s cubic-bezier(0.4, 0, 0.2, 1) infinite alternate;
}

@keyframes door-swing {
  from {
    transform: rotate(0deg);
  }
  to {
    transform: rotate(var(--angle, -110deg));
  }
}`,
      },
    ],
    caveats: [
      '`transform-origin` 与 `rotate` **必须写在同一处**（这里是同一个关键帧规则里）。写在元素的基础规则上而旋转写在关键帧里，原点会在动画中被重置回默认值。',
      '原点决定「以哪里为轴」，这是从「自转」到「铰接」的唯一开关。原点在中心就是打转，在角上就是开门，在边中点上就是翻页。',
      '转出去的部分会**超出容器**。要裁掉就加 `overflow: hidden`，要让它探出去就别加——两者是完全不同的观感，得先想清楚。',
      '角度别超过 ±110 度左右。再多就转过界了，看着像「门被吹掉了」而不是「被推开」。',
      '它只影响**绘制**，不影响布局。门转出去之后，它原来的位置仍然占着（也仍然能点到）。',
      '如果用 `perspective` 添一点透视，会更像真的门；不加就是纯粹的平面旋转，也很干净。',
    ],
    notes: [
      `原实现（${MAGIC} 的 \`openDownLeft\`）还配了 \`openDownLeftReturn\` 作为回程；这里用 \`alternate\` 替代。`,
      '把原点换成 `top right` 就是从另一个方向开；换成 `center bottom` 就是从上往下倒。',
    ],
    _rawRef: 'https://github.com/miniMAC/magic',
    _origin: 'crawl',
  },

  {
    slug: 'perspective-unfold',
    title: '放倒一样的翻面',
    category: '动效',
    tags: ['透视', '翻转', '原点'],
    since: SINCE,
    source: `${MAGIC} — perspectiveDown，改写为独立最小示例`,
    when: '一张卡片要绕底边往后倒下去，像立牌被放倒',
    stage: 'dark',
    tier: 'core',
    params: [],
    description: `一张卡片绕底边往后栽下去，倒到贴平为止。

机制是 ==perspective() 写在 transform 里、原点放在底边，rotateX(180deg) 就把它放倒==。这里有个容易混的点：\`perspective()\` 是 **transform 的一个函数**（只作用于这一个元素自己的变换），而 \`perspective\` 是 **父级上的属性**（作用于所有子元素的空间关系）。这一条用的是前者。

原点在底边，所以倒的方向是「贴着那条边往后」。`,
    code: [
      {
        lang: 'html',
        body: `<div class="unfold-stage">
  <div class="unfold-card">
    <b>立牌</b>
  </div>
</div>`,
      },
      {
        lang: 'css',
        body: `.unfold-stage {
  display: grid;
  place-items: center;
  width: min(320px, 80vw);
  height: 220px;
  background: #0a0810;
}

.unfold-card {
  display: grid;
  place-items: center;
  width: 140px;
  height: 140px;
  background: linear-gradient(150deg, #241d33, #120f1c);
  border: 1px solid rgb(217 164 65 / 0.42);
  font: 600 17px/1 system-ui, sans-serif;
  color: #f0ead9;
  /* @mechanism 原点在底边，绕这条边往后倒 */
  transform-origin: 0 100%;
  animation: unfold 3s cubic-bezier(0.5, 0, 0.3, 1) infinite alternate;
}

@keyframes unfold {
  from {
    transform: perspective(800px) rotateX(0deg);
  }
  to {
    /* @mechanism perspective() 是 transform 的函数，只作用于本元素 */
    transform: perspective(800px) rotateX(-180deg);
  }
}`,
      },
    ],
    caveats: [
      '`perspective()` **函数**与`perspective` **属性**不是一回事。函数写在 `transform` 里、只作用于本元素自身；属性写在**父级**上、决定所有子元素共享的透视空间。用错位置会得到「压扁」而不是「倒下去」。',
      '`perspective()` 必须**写在 `rotate` 前面**（`transform: perspective(800px) rotateX(...)`）。写在后面等于先转再透视，效果完全不同。',
      '倒到 180 度时元素是**背面朝前**的，文字会镜像。要避免就给卡片单独设 `backface-visibility: hidden`，或者别倒满 180 度。',
      '透视距离（800px）决定「相机多远」。数值越小透视越夸张，太小时元素会变形到认不出。',
      '原点决定了倒向哪一侧：`0 100%` 是绕左下角，`50% 100%` 是绕底边中点，`100% 100%` 是绕右下角。这是三个不同的效果。',
      '和所有 3D 变换一样，它**不影响布局**，倒下去之后原位置还占着。',
    ],
    notes: [
      `原实现（${MAGIC} 的 \`perspectiveDown\`）配了 \`perspectiveDownReturn\` 做回程；这里用 \`alternate\`。`,
      '把 `rotateX` 换成 `rotateY`、原点换成左边，就是左右开合——机制完全对称。',
    ],
    _rawRef: 'https://github.com/miniMAC/magic',
    _origin: 'crawl',
  },

  {
    slug: 'scale-blur-out',
    title: '化开一样消失',
    category: '动效',
    tags: ['退场', '模糊', '缩放'],
    since: SINCE,
    source: `${MAGIC} — puffOut，改写为独立最小示例`,
    when: '元素消失时要有「化掉」的质感，而不是单纯淡出',
    stage: 'dark',
    tier: 'core',
    params: [
      { name: 'to', label: '放大到', type: 'range', min: 1.2, max: 3, step: 0.1, default: 2, unit: '×' },
    ],
    description: `一块色块在原位放大、同时糊掉、同时淡掉，像化开的水汽。

机制是 ==三个「消失信号」一起给：缩放、模糊、透明度==。单纯改透明度在视觉上很单薄——观众看到的是「颜色变浅了」。加上放大，元素显得在**靠近**；加上模糊，显得在**散开**。三个一起，才有「化掉」的材质感。

退场动画的弱点通常是只动透明度；补上另外两个是成本最低的改善。`,
    code: [
      {
        lang: 'html',
        body: `<div class="puff-stage">
  <div class="puff"></div>
</div>`,
      },
      {
        lang: 'css',
        body: `.puff-stage {
  display: grid;
  place-items: center;
  width: min(300px, 78vw);
  height: 200px;
  background: #0a0810;
  overflow: hidden;
}

.puff {
  width: 110px;
  height: 110px;
  border-radius: 50%;
  background: radial-gradient(circle at 36% 32%, #ff9a5a, #b4462f 72%);
  animation: puff-out 2.6s cubic-bezier(0.4, 0, 0.6, 1) infinite alternate;
}

@keyframes puff-out {
  from {
    opacity: 1;
    transform: scale(1);
    filter: blur(0);
  }
  to {
    /* @mechanism 缩放 + 模糊 + 透明度三件事一起给，才有「化开」感 */
    opacity: 0;
    transform: scale(var(--to, 2));
    filter: blur(9px);
  }
}`,
      },
    ],
    caveats: [
      '三个属性一起动画是**最贵的一种**：`filter: blur()` 每帧都要重算整个元素的像素，`opacity` 与 `transform` 反而便宜。掉帧通常就是模糊带来的。',
      '缩放与模糊要**协调**。放大到 3 倍还只糊 2px，看着像「变透明」；放大 1.2 倍就糊 10px，看着像「失焦的照片」。两者要同步加剧。',
      '放大时会**超出容器**。母版通常要 `overflow: hidden`，否则它会盖住旁边的元素。',
      '用 `transform: scale()` 而不是 `width`/`height`：后者每帧触发布局重算，而且会把内容也重排一遍。',
      '它适合小元素或装饰块。有大段文字的元素上不要用它——文字在放大与模糊中完全不可读。',
      '这是纯装饰动画，必须能被 `prefers-reduced-motion` 关掉；关掉之后元素应当直接以终态出现。',
    ],
    notes: [
      `原实现是 ${MAGIC} 的 \`puffOut\`（反着播就是 \`puffIn\` 的入场）。`,
      '把模糊去掉只留缩放与透明度，就从「化开」变成「冲过来」——三者中最影响气质的是模糊。',
    ],
    _rawRef: 'https://github.com/miniMAC/magic',
    _origin: 'crawl',
  },

  {
    slug: 'overshoot-enter',
    title: '过冲才有弹性',
    category: '动效',
    tags: ['过冲', '弹性', '关键帧'],
    since: SINCE,
    source: `${MAGIC} — boingInUp，改写为独立最小示例`,
    when: '元素入场要有回弹的劲儿，不想引入弹性库',
    stage: 'dark',
    tier: 'core',
    params: [],
    description: `一块牌匾从「躺平」的位置甩起来，中途过头了一点，再回到正位。

机制是 ==过冲：让动画中段越过终态再回来==。关键帧是 \`-90deg → +50deg → 0deg\`——中间那个 **+50 度就是「过头了」**。回弹的那一段就是弹性的来源。

浏览器不会替你做这件事：线性或缓动插值永远单调地走向终态，**过头必须自己写进关键帧**。`,
    code: [
      {
        lang: 'html',
        body: `<div class="boing-stage">
  <div class="boing-board">咒</div>
</div>`,
      },
      {
        lang: 'css',
        body: `.boing-stage {
  display: grid;
  place-items: center;
  width: min(300px, 78vw);
  height: 220px;
  background: #0a0810;
  perspective: 900px;
  overflow: hidden;
}

.boing-board {
  display: grid;
  place-items: center;
  width: 130px;
  height: 130px;
  background: linear-gradient(150deg, #d9a441, #a97c22);
  font: 700 34px/1 Georgia, serif;
  color: #241d33;
  /* @mechanism 原点在顶边，它像铰链一样甩起来 */
  transform-origin: 50% 0%;
  animation: boing-in 2.4s cubic-bezier(0.3, 0, 0.4, 1) infinite alternate;
}

@keyframes boing-in {
  0% {
    opacity: 0;
    transform: rotateX(-90deg);
  }
  50% {
    opacity: 1;
    /* @mechanism 这一帧「过头了」：越过终态再回来，才有回弹 */
    transform: rotateX(50deg);
  }
  100% {
    opacity: 1;
    transform: rotateX(0deg);
  }
}`,
      },
    ],
    caveats: [
      '过冲量决定「硬度」：50 度是明显的弹性，10 度就只是「轻微晃了一下」。这个数字是本效果唯一需要调的。',
      '用 **cubic-bezier** 也能做过冲（把第二或第三个控制点放到 [0,1] 之外），而且不用手写中间帧。但那样只能过冲一次且方向单一，关键帧方式能编排多次回弹。',
      '过冲会**短暂超出终态的边界**。容器有 `overflow: hidden` 时，过头的那一瞬会被切掉，弹性感就没了——这是最常踩的坑。',
      'origin 在 `50% 0%` 时元素像帘子一样翻下来。换成 `50% 50%` 就是绕中心翻，弹性感会弱一些。',
      '不要用在有大段文字的元素上。来回动的时候文字很难读，而且可能触发前庭不适。',
      '要给 `prefers-reduced-motion` 留退路：关掉时元素直接以终态出现。',
    ],
    notes: [
      `原实现是 ${MAGIC} 的 \`boingInUp\`（\`boingOutDown\` 是它的反向）。`,
      '过冲是「弹性」的唯一来源。想要弹性，就一定得有过头的帧——这不是风格问题，是机制问题。',
    ],
    _rawRef: 'https://github.com/miniMAC/magic',
    _origin: 'crawl',
  },

  {
    slug: 'paired-return-frames',
    title: '进出各写一套关键帧',
    category: '动效',
    tags: ['关键帧', '回程', '缓动'],
    since: SINCE,
    source: `${MAGIC} — slideDown / slideDownReturn 的成对命名法，改写为独立最小示例`,
    when: '元素进场和退场都想有自己的缓动，但不想写两份重复的位移',
    stage: 'dark',
    tier: 'core',
    params: [],
    description: `一块板子滑进来用减速、滑出去用加速——两个方向的手感不一样。

机制是 ==给「进入」和「退出」各自命名一套关键帧，而不是把其中一个用 reverse 播==。\`animation-direction: reverse\` 会把**缓动也一起反转**：本来「减速进场」的曲线，反着播就成了「加速退场」。物理上不对，观感也别扭。

共用位移量、分开命名与缓动，是这个问题的正解。`,
    code: [
      {
        lang: 'html',
        body: `<div class="pair-stage">
  <div class="pair-card">
    <b>进出各一套</b>
    <span>减速进来，加速出去</span>
  </div>
</div>`,
      },
      {
        lang: 'css',
        body: `.pair-stage {
  display: grid;
  place-items: center;
  width: min(320px, 80vw);
  height: 200px;
  background: #0a0810;
  overflow: hidden;
  --travel: 160px;
}

.pair-card {
  display: grid;
  gap: 5px;
  place-items: center;
  padding: 18px 24px;
  border: 1px solid rgb(217 164 65 / 0.4);
  background: #1b1626;
  font: 400 13px/1.6 system-ui, sans-serif;
  color: #f0ead9;
  /* @mechanism 退场用自己那套关键帧与缓动，不是把进场反着播 */
  animation: pair-out 1.1s cubic-bezier(0.5, 0, 0.9, 0.4) infinite alternate;
}

.pair-card b {
  font-size: 16px;
}

@keyframes pair-in {
  from {
    opacity: 0;
    transform: translateY(var(--travel));
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

/* @mechanism 同一段位移，单独一套缓动 */
@keyframes pair-out {
  from {
    opacity: 1;
    transform: translateY(0);
  }
  to {
    opacity: 0;
    transform: translateY(calc(var(--travel) * -1));
  }
}`,
      },
    ],
    caveats: [
      '`animation-direction: reverse` 反转的是**整条时间轴**，包括缓动。所以「减速进场」反着播会变成「加速退场」，与想要的正相反。',
      '这不是「非要写两遍」的问题：位移量可以放进 CSS 变量共享，需要分开的只有**关键帧的名字与缓动**。两处硬编码位移才是真的重复。',
      '两套关键帧要**同步维护**。改了一个忘了另一个，进出就会不对称——这是这套命名法的主要代价。',
      '要保留终态得配 `animation-fill-mode: both`，否则动画结束后元素会弹回未动画的状态。',
      '用 `translateY` 而不是 `top`：后者每帧触发布局重算，而且位移量的计算基准更容易出错。',
      '带 `alternate` 时两套关键帧会交替播放（这里是演示用）；真实场景通常由类名切换触发其中一套。',
    ],
    notes: [
      `原实现在 ${MAGIC} 里是一整套成对命名：\`slideDown\` / \`slideDownReturn\`、\`puffIn\` / \`puffOut\`、\`openDownLeft\` / \`openDownLeftOut\` / \`openDownLeftReturn\`。`,
      '「进场与退场用不同缓动」是动效设计里的基本原则——进场要快、退场要更快，或者反过来。reverse 做不到这件事。',
    ],
    _rawRef: 'https://github.com/miniMAC/magic',
    _origin: 'crawl',
  },

  {
    slug: 'origin-hop-in',
    title: '换个支点继续转',
    category: '动效',
    tags: ['变换原点', '滚入', '关键帧'],
    since: SINCE,
    source: `${MAGIC} — foolishIn，改写为独立最小示例`,
    when: '元素要「翻滚着」跳进来，而不是平滑地滑进来',
    stage: 'dark',
    tier: 'core',
    params: [],
    description: `一块方牌翻滚着跳进来，像骰子落地——每一下都在换支点。

机制是 ==在关键帧中途改变 transform-origin，元素会「换一个支点继续转」==。原实现是：从中心旋转 → 原点换到左下 → 再换到右下，同时缩放从 0 长到 1。支点一换，旋转的弧线也跟着换，于是有了「滚」的感觉。

**支点突变会让运动折一下**——平时这是「卡顿」，用对了就是「翻滚」。`,
    code: [
      {
        lang: 'html',
        body: `<div class="hop-stage">
  <div class="hop-tile">骰</div>
</div>`,
      },
      {
        lang: 'css',
        body: `.hop-stage {
  display: grid;
  place-items: center;
  width: min(300px, 78vw);
  height: 210px;
  background: #0a0810;
  overflow: hidden;
}

.hop-tile {
  display: grid;
  place-items: center;
  width: 110px;
  height: 110px;
  background: linear-gradient(150deg, #7c5cff, #4a2fa8);
  font: 700 30px/1 Georgia, serif;
  color: #f6f2ff;
  animation: origin-hop 2.6s ease-in-out infinite alternate;
}

@keyframes origin-hop {
  0% {
    opacity: 0;
    /* @mechanism 从中心的支点开始转 */
    transform-origin: 50% 50%;
    transform: scale(0) rotate(360deg);
  }
  35% {
    opacity: 1;
    /* @mechanism 支点换到左下角，旋转的弧线随之改变 */
    transform-origin: 0% 100%;
    transform: scale(0.6) rotate(0deg);
  }
  70% {
    opacity: 1;
    /* @mechanism 再换到右下角，于是看起来在「滚」 */
    transform-origin: 100% 100%;
    transform: scale(0.85) rotate(0deg);
  }
  100% {
    opacity: 1;
    transform-origin: 100% 100%;
    transform: scale(1) rotate(0deg);
  }
}`,
      },
    ],
    caveats: [
      '`transform-origin` 在关键帧之间**是突变而非插值**的（它不是一个可平滑过渡的连续量）。这正是「折一下」的来源——想要翻滚就靠它，不想要就会显得抖。',
      '支点只能在**关键帧**里改，且每个关键帧都要写全。漏写的那一帧会退回元素基础规则上的原点值，运动轨迹会突然跳掉。',
      '它是把「本会显得卡顿的东西」变成效果，所以对参数很敏感。支点换得太频繁会变成纯粹的抖动。',
      '同时缩放与旋转会让元素短暂**超出容器**。母版要 `overflow: hidden`，否则会盖到别处。',
      '这一条不太适合正文类内容。翻滚的文字完全无法阅读，它属于装饰性的入场。',
      '细节多、参数敏感，通常不如一个干净的 `cubic-bezier` 好维护。收它的价值在于**看清「支点」也是一个可动画的维度**。',
    ],
    notes: [
      `原实现是 ${MAGIC} 的 \`foolishIn\`（这一条保留了它的三段式支点变化）。`,
      '把三段的原点保持不动，同一个关键帧结构就变成普通的「缩放淡入」——差别全在原点。',
    ],
    _rawRef: 'https://github.com/miniMAC/magic',
    _origin: 'crawl',
  },

  {
    slug: 'origin-outside-orbit',
    title: '支点在元素之外',
    category: '动效',
    tags: ['变换原点', '公转', '甩出'],
    since: SINCE,
    source: `${MAGIC} — bombLeftOut，改写为独立最小示例`,
    when: '元素要像被甩出去一样画一条大弧离场',
    stage: 'dark',
    tier: 'core',
    params: [],
    description: `一块小方块被甩出去，走的是一条很大的弧线，同时模糊掉。

机制是 ==把 transform-origin 放到元素**外面**，旋转就成了绕远处一个点的公转==。原实现用的是 \`-100% 50%\`——原点的横坐标是元素的**左侧再往左一个元素宽度**的地方。

原点可以落在元素之外，这是「公转」与「自转」的分水岭；也是「甩」这个动作的全部来源。`,
    code: [
      {
        lang: 'html',
        body: `<div class="orbit-stage">
  <div class="orbit-chip"></div>
</div>`,
      },
      {
        lang: 'css',
        body: `.orbit-stage {
  display: grid;
  place-items: center;
  width: min(320px, 80vw);
  height: 220px;
  background: #0a0810;
  /* @mechanism 原点在元素外面，公转的弧会扫出很远，必须裁掉 */
  overflow: hidden;
}

.orbit-chip {
  width: 76px;
  height: 76px;
  border-radius: 14px;
  background: linear-gradient(150deg, #14b8a6, #0d6e63);
  /* @mechanism 原点落在元素左侧之外一个宽度处 —— 绕远处一个点公转 */
  transform-origin: -100% 50%;
  animation: chip-fling 2.6s cubic-bezier(0.4, 0, 0.8, 0.4) infinite alternate;
}

@keyframes chip-fling {
  from {
    opacity: 1;
    transform: rotate(0deg);
    filter: blur(0);
  }
  to {
    opacity: 0;
    transform: rotate(-160deg);
    filter: blur(6px);
  }
}`,
      },
    ],
    caveats: [
      '原点的**负百分比**含义是「元素外侧」。`-100% 50%` 指左边界再往左一个元素宽度处——这是最容易看错的地方，写 `-100px` 与 `-100%` 完全不是一回事。',
      '公转半径很大时会**扫出容器很远**。原实现靠容器的 `overflow: hidden` 裁掉，不加的话元素会盖住页面其他部分。',
      '它是「甩出去」而不是「滑出去」：弧线是支点偏离造成的。想要直线退场就别动原点。',
      '半径（原点距离）决定弧的弯曲程度。原点在元素内是自转，贴着边缘是小弧，离得远是大弧——**同一个 rotate 能给出三种完全不同的运动**。',
      '配 `filter: blur()` 会让它在飞出去的过程中「化掉」，代价是每帧重算像素。',
      '和所有位移类动画一样，它不影响布局；元素飞走之后原位置仍然占着。',
    ],
    notes: [
      `原实现是 ${MAGIC} 的 \`bombLeftOut\`（还有 \`bombRightOut\` 是对称的）。`,
      '把它和「偏移原点的公转」对比着看：那一条原点在容器中心、元素被推出去；这一条原点在元素之外、元素被甩出去。机制同源，方向相反。',
    ],
    _rawRef: 'https://github.com/miniMAC/magic',
    _origin: 'crawl',
  },

  /* ═══════════════ tobiasahlin/SpinKit（MIT）═══════════════ */
  {
    slug: 'diagonal-stagger',
    title: '沿对角线错开的波',
    category: '动效',
    tags: ['错开', '延迟', '网格'],
    since: SINCE,
    source: `${SPINKIT} — sk-grid，改写为独立最小示例`,
    when: '一片格子要有一道波斜着扫过，而不是整体一起动',
    stage: 'dark',
    tier: 'core',
    params: [
      { name: 'step', label: '相邻延迟', type: 'range', min: 0.05, max: 0.3, step: 0.05, default: 0.1, unit: 's' },
    ],
    description: `九个小方块依次缩下去又弹回来，那道波是**斜着**扫过去的。

机制是 ==延迟沿对角线递增==。原实现的九个延迟是：

\`\`\`
0.2  0.3  0.4
0.1  0.2  0.3
0.0  0.1  0.2
\`\`\`

看规律：**延迟 = (行 + 列) × 0.1s**。所以同一时刻，沿「左上到右下」那条线上所有方块的动作是同步的——人眼把这条同相位的线读成一道斜向的波。

「错开」不是简单地把延迟等差排下去，而是**按二维位置算**。`,
    code: [
      {
        lang: 'html',
        body: `<div class="dg">
  <i></i><i></i><i></i>
  <i></i><i></i><i></i>
  <i></i><i></i><i></i>
</div>`,
      },
      {
        lang: 'css',
        body: `.dg {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 7px;
  width: 108px;
  height: 108px;
}

.dg i {
  background: #d9a441;
  animation: dg-beat 1.3s ease-in-out infinite;
}

/* @mechanism 延迟 = (行 + 列) × step，同一条斜线同相位 → 斜向的波 */
.dg i:nth-child(1) { animation-delay: calc(var(--step, 0.1s) * 2); }
.dg i:nth-child(2) { animation-delay: calc(var(--step, 0.1s) * 3); }
.dg i:nth-child(3) { animation-delay: calc(var(--step, 0.1s) * 4); }
.dg i:nth-child(4) { animation-delay: calc(var(--step, 0.1s) * 1); }
.dg i:nth-child(5) { animation-delay: calc(var(--step, 0.1s) * 2); }
.dg i:nth-child(6) { animation-delay: calc(var(--step, 0.1s) * 3); }
.dg i:nth-child(7) { animation-delay: calc(var(--step, 0.1s) * 0); }
.dg i:nth-child(8) { animation-delay: calc(var(--step, 0.1s) * 1); }
.dg i:nth-child(9) { animation-delay: calc(var(--step, 0.1s) * 2); }

@keyframes dg-beat {
  0%,
  70%,
  100% {
    transform: scale(1);
  }
  35% {
    transform: scale(0);
  }
}`,
      },
    ],
    caveats: [
      '延迟要按**二维位置**算，不是按 `nth-child` 的顺序。按顺序排等差延迟得到的是「一行一行扫」，不是斜的。',
      '周期必须**明显长于总延迟跨度**（这里 1.3s 对 0.4s）。周期不够时所有方块还没错开完就开始下一轮，看着是一片乱闪。',
      '写九条 `nth-child` 是原实现的做法。列数变化时这套编号需要重算——这也是它不够工程化的地方，真实项目里通常由预处理器或 JS 生成。',
      '延迟用**正延迟**：动画开头会有一段「什么都没动」的空窗。用**负延迟**可以从中段切入，看起来是「已经在动了」。',
      '它是装饰性动画，格子的缩放会持续占用合成层。作为整屏背景时要留意代价。',
      '原实现用 `float: left` + 33.33% 宽度排版。用 grid 更稳，也就不需要清浮动了。',
    ],
    notes: [
      `原实现是 ${SPINKIT} 的 \`sk-grid\`（九个 \`sk-grid-cube\` + 九个 \`nth-child\` 延迟）。`,
      '把延迟改成 `(行 - 列) × step` 就是另一条对角线的方向——一个符号改变整道波的角度。',
    ],
    _rawRef: 'https://github.com/tobiasahlin/SpinKit',
    _origin: 'crawl',
  },

  {
    slug: 'folding-cube',
    title: '倾斜容器里的翻折',
    category: '动效',
    tags: ['翻折', '倾斜', '3D'],
    since: SINCE,
    source: `${SPINKIT} — sk-fold，改写为独立最小示例`,
    when: '四个方块像折纸一样依次翻面，整体还带着斜角',
    stage: 'dark',
    tier: 'core',
    params: [],
    description: `四个方块轮流翻折，整体是斜着的菱形。

机制分两层：==容器整体 \`rotateZ(45deg)\` 把正方形转成菱形==（这样四个方块看起来是「尖角朝上」的四个面），然后==每个方块各自绕自己的边翻折、并且有一半是半透明的==。倾斜的容器提供构图，每个面自己的旋转提供动作。

半透明是关键：没有它，翻折的面会互相遮挡，看不出「折」的关系。`,
    code: [
      {
        lang: 'html',
        body: `<div class="fold">
  <span class="fold-cube"></span>
  <span class="fold-cube"></span>
  <span class="fold-cube"></span>
  <span class="fold-cube"></span>
</div>`,
      },
      {
        lang: 'css',
        body: `.fold {
  position: relative;
  display: flex;
  flex-wrap: wrap;
  width: 120px;
  height: 120px;
  /* @mechanism 整体转 45 度，四个方块看起来才是尖角朝上的面 */
  transform: rotateZ(45deg);
}

.fold-cube {
  float: left;
  width: 50%;
  height: 50%;
  position: relative;
  transform: scale(1.1);
}

.fold-cube::before {
  content: "";
  position: absolute;
  inset: 0;
  /* @mechanism 半透明才能看见后面那层，翻折的关系才成立 */
  background: rgb(180 70 47 / 0.55);
  transform-origin: 100% 50%;
  animation: fold-angle 2.4s infinite ease-in-out;
}

.fold-cube:nth-child(1)::before { animation-delay: 0s; }
.fold-cube:nth-child(2)::before { animation-delay: 0.3s; }
.fold-cube:nth-child(3)::before { animation-delay: 0.9s; }
.fold-cube:nth-child(4)::before { animation-delay: 0.6s; }

@keyframes fold-angle {
  0%,
  10% {
    transform: perspective(140px) rotateX(-180deg);
    opacity: 0;
  }
  25%,
  75% {
    transform: perspective(140px) rotateX(0deg);
    opacity: 1;
  }
  90%,
  100% {
    transform: perspective(140px) rotateX(180deg);
    opacity: 0;
  }
}`,
      },
    ],
    caveats: [
      '**半透明不是可选项。**不透明的面翻过去之后会完全遮住后面的方块，「折」的空间关系就没了，看着只是几块色块在跳。',
      '容器 `rotateZ(45deg)` 之后，四个方块的**视觉朝向也转了**。所以每个面自己的 `rotateX` 轴不是屏幕的水平轴——这是理解它运动方向的必要一步。',
      '`transform-origin: 100% 50%` 让翻折的轴落在每个面的右边。四个面用同一个原点，折起来才是「合拢」而不是各转各的。',
      '延迟不是按顺序递增的：原实现是 `0 / 0.3 / 0.9 / 0.6`，**对角线下手、按「绕圈」的顺序排**——这是它看起来像折纸而不像流水线的关键。',
      '`perspective()` 值很小（140px）时透视很强，翻折感明显；值调大就接近平面旋转。',
      '它用了 `::before` 承载每一个面，所以方块本身可以是空的。真实场景要注意伪元素与内容层的堆叠顺序。',
    ],
    notes: [
      `原实现是 ${SPINKIT} 的 \`sk-fold\` / \`sk-fold-cube\`，延迟是 \`0 / 0.3 / 0.9 / 0.6\`。`,
      '那组「不按顺序」的延迟值得单独体会：它让四个面**分两批**动作，是折纸感的来源。',
    ],
    _rawRef: 'https://github.com/tobiasahlin/SpinKit',
    _origin: 'crawl',
  },

  {
    slug: 'nested-rotation-chase',
    title: '旋转套旋转',
    category: '动效',
    tags: ['嵌套旋转', '轨道', '追逐'],
    since: SINCE,
    source: `${SPINKIT} — sk-chase，改写为独立最小示例`,
    when: '几个点要沿一条轨道互相追逐，而不是一起转圈',
    stage: 'dark',
    tier: 'core',
    params: [
      { name: 'dur', label: '一圈用时', type: 'range', min: 1, max: 6, step: 0.5, default: 2.5, unit: 's' },
    ],
    description: `几个点沿着一个方框轨道互相追着跑，每个点自己还在转。

机制是 ==两层嵌套的旋转：外层容器整体转一圈，每个点自己也转，但周期不同、并用负延迟错开==。外层的旋转负责「位的移动」，内层的旋转负责「形的变化」，两者周期不成整数倍时，轨迹看上去就不是简单的圆。

原实现的两层周期是 **2.5s 与 2.0s**——刻意不成倍数，这样两个旋转的相对相位一直在变。`,
    code: [
      {
        lang: 'html',
        body: `<div class="chase">
  <span class="chase-dot"></span>
  <span class="chase-dot"></span>
  <span class="chase-dot"></span>
  <span class="chase-dot"></span>
  <span class="chase-dot"></span>
  <span class="chase-dot"></span>
</div>`,
      },
      {
        lang: 'css',
        body: `.chase {
  position: relative;
  width: 110px;
  height: 110px;
  /* @mechanism 外层负责「位的移动」 */
  animation: chase-spin var(--dur, 2.5s) infinite linear both;
}

.chase-dot {
  position: absolute;
  inset: 0;
  animation: chase-dot calc(var(--dur, 2.5s) * 0.8) infinite ease-in-out both;
}

.chase-dot::before {
  content: "";
  position: absolute;
  top: 0;
  left: 0;
  width: 26%;
  height: 26%;
  border-radius: 50%;
  background: #14b8a6;
}

/* @mechanism 负延迟错开相位：一个个追着走 */
.chase-dot:nth-child(1) { animation-delay: calc(var(--dur, 2.5s) * -0.44); }
.chase-dot:nth-child(2) { animation-delay: calc(var(--dur, 2.5s) * -0.40); }
.chase-dot:nth-child(3) { animation-delay: calc(var(--dur, 2.5s) * -0.36); }
.chase-dot:nth-child(4) { animation-delay: calc(var(--dur, 2.5s) * -0.32); }
.chase-dot:nth-child(5) { animation-delay: calc(var(--dur, 2.5s) * -0.28); }
.chase-dot:nth-child(6) { animation-delay: calc(var(--dur, 2.5s) * -0.24); }

@keyframes chase-spin {
  to {
    transform: rotate(360deg);
  }
}

/* @mechanism 内层负责「形的变化」，周期与外层刻意不成整数倍 */
@keyframes chase-dot {
  50% {
    transform: rotate(540deg);
  }
  100% {
    transform: rotate(1080deg);
  }
}`,
      },
    ],
    caveats: [
      '两层的**周期要有意错开**。原实现是 2.5s 与 2.0s（0.8 倍）——不是整数倍，所以相对相位一直在漂移，轨迹才不平淡。若取成 1:1 或 1:2，会看到明显的重复周期，一会儿就腻。',
      '每个点都是**绝对定位铺满外层**、再用 `::before` 画一个小圆。这样点的位置由外层旋转决定，而不是逐个去算坐标——这是它比「摆 6 个点」高明的地方。',
      '**负延迟**在这里是必需的。用正延迟时开头会有一大段「一个点都没有」的空窗；负延迟让所有点一开始就分布在不同相位上。',
      '内层的关键帧转到 **1080 度**（三圈）而不是 360 度。转的圈数越多，同样的时长里角速度越快，「追」的劲儿越足。',
      '它没有配 `prefers-reduced-motion`。旋转是诱发不适的主要动效类型之一，正式项目必须关掉它。',
      '原实现里 `::before` 也各带一份延迟（截图里能看到的 `:nth-child(n):before`），这里简化成只给 `.chase-dot` 加延迟——两者的相位效果一致。',
    ],
    notes: [
      `原实现是 ${SPINKIT} 的 \`sk-chase\`（外层 2.5s、内层 2.0s，负延迟 -1.1s 到 -0.6s）。`,
      '"旋转套旋转 + 周期不成倍数"是那种看起来复杂、机制却只有两行的手段。',
    ],
    _rawRef: 'https://github.com/tobiasahlin/SpinKit',
    _origin: 'crawl',
  },

  {
    slug: 'radial-placement-rotate',
    title: '用旋转来摆位',
    category: '动效',
    tags: ['旋转', '摆位', '圆周'],
    since: SINCE,
    source: `${SPINKIT} — sk-circle-fade，改写为独立最小示例`,
    when: '一圈点要均匀分布，但不想逐个算坐标',
    stage: 'dark',
    tier: 'core',
    params: [
      { name: 'fade', label: '淡出时长', type: 'range', min: 0.3, max: 2, step: 0.1, default: 1.2, unit: 's' },
    ],
    description: `一圈小点依次明灭，像钟面上的指针走过去。

机制是 ==用 \`rotate(n × 30deg)\` 把元素摆到圆周上==。每个点都是一个**铺满外框的方块**，方块的左上角画一个小圆——把这个方块转过 30 度的整数倍，那个小圆就被送到了圆周上的不同位置。

**摆位和旋转是同一个操作**。所以不需要写 12 组坐标，只需要 12 个旋转角度。

顶点位于方框左上角，绕中心转 30° 就落到圆的 30° 位置上——旋转一圈正好走完 12 个点。`,
    code: [
      {
        lang: 'html',
        body: `<div class="rf">
  <span class="rf-dot"></span><span class="rf-dot"></span>
  <span class="rf-dot"></span><span class="rf-dot"></span>
  <span class="rf-dot"></span><span class="rf-dot"></span>
  <span class="rf-dot"></span><span class="rf-dot"></span>
  <span class="rf-dot"></span><span class="rf-dot"></span>
  <span class="rf-dot"></span><span class="rf-dot"></span>
</div>`,
      },
      {
        lang: 'css',
        body: `.rf {
  position: relative;
  width: 108px;
  height: 108px;
}

.rf-dot {
  position: absolute;
  inset: 0;
}

.rf-dot::before {
  content: "";
  position: absolute;
  top: 0;
  left: 0;
  width: 24%;
  height: 24%;
  border-radius: 50%;
  background: #d9a441;
  animation: rf-fade var(--fade, 1.2s) infinite ease-in-out;
}

/* @mechanism 用旋转把点摆到圆周上：摆位与旋转是同一个操作 */
.rf-dot:nth-child(1)  { transform: rotate(0deg); }
.rf-dot:nth-child(2)  { transform: rotate(30deg); }
.rf-dot:nth-child(3)  { transform: rotate(60deg); }
.rf-dot:nth-child(4)  { transform: rotate(90deg); }
.rf-dot:nth-child(5)  { transform: rotate(120deg); }
.rf-dot:nth-child(6)  { transform: rotate(150deg); }
.rf-dot:nth-child(7)  { transform: rotate(180deg); }
.rf-dot:nth-child(8)  { transform: rotate(210deg); }
.rf-dot:nth-child(9)  { transform: rotate(240deg); }
.rf-dot:nth-child(10) { transform: rotate(270deg); }
.rf-dot:nth-child(11) { transform: rotate(300deg); }
.rf-dot:nth-child(12) { transform: rotate(330deg); }

/* @mechanism 延迟沿同一方向递增，看起来就是一圈依次明灭 */
.rf-dot:nth-child(1)::before  { animation-delay: calc(var(--fade, 1.2s) * 0.00); }
.rf-dot:nth-child(2)::before  { animation-delay: calc(var(--fade, 1.2s) * 0.08); }
.rf-dot:nth-child(3)::before  { animation-delay: calc(var(--fade, 1.2s) * 0.17); }
.rf-dot:nth-child(4)::before  { animation-delay: calc(var(--fade, 1.2s) * 0.25); }
.rf-dot:nth-child(5)::before  { animation-delay: calc(var(--fade, 1.2s) * 0.33); }
.rf-dot:nth-child(6)::before  { animation-delay: calc(var(--fade, 1.2s) * 0.42); }
.rf-dot:nth-child(7)::before  { animation-delay: calc(var(--fade, 1.2s) * 0.50); }
.rf-dot:nth-child(8)::before  { animation-delay: calc(var(--fade, 1.2s) * 0.58); }
.rf-dot:nth-child(9)::before  { animation-delay: calc(var(--fade, 1.2s) * 0.67); }
.rf-dot:nth-child(10)::before { animation-delay: calc(var(--fade, 1.2s) * 0.75); }
.rf-dot:nth-child(11)::before { animation-delay: calc(var(--fade, 1.2s) * 0.83); }
.rf-dot:nth-child(12)::before { animation-delay: calc(var(--fade, 1.2s) * 0.92); }

@keyframes rf-fade {
  0%,
  39%,
  100% {
    opacity: 0.15;
  }
  40% {
    opacity: 1;
  }
}`,
      },
    ],
    caveats: [
      '每个点的**形状必须是「从中心指向外」的**。原实现里每个方块都是铺满外框、小圆画在左上角——这样旋转 30° 才会把它送到圆上。如果小圆画在方块正中，转多少度它都在圆心，什么也不会发生。',
      '**旋转角度与延迟必须同向递增**。角度涨而延迟不涨，得到的是一圈同时明灭（看着像整体闪）；两者一致才是「依次走过」。',
      '`transform` 加在 `.rf-dot` 上、`animation` 加在它的 `::before` 上，两者必须分层。写在同一个元素上时，动画会覆盖掉 `transform`，点位全塌到圆心——这是最容易出错的一处。',
      '关键帧的 `40%` 处突变（前 39% 是暗的，40% 突然亮）是刻意的，它让「指针」看起来是跳着走的。把这一对改成平滑过渡，观感就从「指针」变成「呼吸」。',
      '点的数量与角度是绑死的：12 个点是 30 度一档。改成 8 个点就要改成 45 度一档，且延迟的步长也要跟着重算。',
      '同样没有配 `prefers-reduced-motion`。原仓库是个纯加载动画库，这类考虑本来就不在它范围内——我们收进来时要自己补。',
    ],
    notes: [
      `原实现是 ${SPINKIT} 的 \`sk-circle-fade\`（12 个 \`sk-circle-fade-dot\`，各 \`rotate(30deg × n)\`）。`,
      '"用变换来摆位"这个思路能迁移到很多地方：环形排列的菜单、放射状的光线、表盘刻度。',
    ],
    _rawRef: 'https://github.com/tobiasahlin/SpinKit',
    _origin: 'crawl',
  },

  {
    slug: 'half-turn-direction-pin',
    title: '把方向钉死的一帧',
    category: '动效',
    tags: ['旋转方向', '关键帧', '插值'],
    since: SINCE,
    source: `${SPINKIT} — sk-wander 里的 50% / 50.1% 那一对帧，改写为独立最小示例`,
    when: '旋转角度跨过 180 度时，转的方向和你写的相反',
    stage: 'dark',
    tier: 'core',
    params: [],
    description: `一个小方块绕圈走，方向就是写的那样，没有在中途反着转。

机制是 ==在两帧中间插一个几乎相同的关键帧，把「转到一半」这个状态钉死==。原实现在 \`50%\` 与 \`50.1%\` 两处写了几乎一样的值（\`-179deg\` 与 \`-180deg\`），中间只差 1 度。

这么做是因为**插值永远走最短路径**。从 \`0\` 到 \`-180\` 正好是一半，浏览器可以选顺时针也可以选逆时针；把中段用一对极近的帧锁住，方向就唯一了。

原实现这里留了一句注释：\`Make FF rotate in the right direction\`。`,
    code: [
      {
        lang: 'html',
        body: `<div class="pin-stage">
  <div class="pin-cube"></div>
</div>`,
      },
      {
        lang: 'css',
        body: `.pin-stage {
  display: grid;
  place-items: center;
  width: min(280px, 76vw);
  height: 190px;
  background: #0a0810;
}

.pin-cube {
  width: 54px;
  height: 54px;
  border-radius: 8px;
  background: linear-gradient(150deg, #7c5cff, #4a2fa8);
  animation: pin-walk 2.4s ease-in-out infinite;
}

@keyframes pin-walk {
  0% {
    transform: rotate(0deg);
  }
  /* @mechanism 50% 与 50.1% 写几乎一样的角度，把中段钉住 */
  50% {
    transform: rotate(-179deg);
  }
  /* @mechanism 这一帧只差 1 度，作用是锁死旋转方向而不是改变位置 */
  50.1% {
    transform: rotate(-180deg);
  }
  100% {
    transform: rotate(-360deg);
  }
}`,
      },
    ],
    caveats: [
      '这是为**方向不确定性**打的补丁，不是视觉设计。不了解「插值走最短路径」这条规则时，根本想不到要去查这里。',
      '触发条件是角度跨度**正好是 180 度或它的奇数倍**——这时两个方向一样短，浏览器只能自己挑。跨度小于 180 时方向本来就是确定的，不需要这个补丁。',
      '两帧的值必须**极近**（这里是 1 度）。差得多的话就变成真的改位置了，中间的过渡会看出来。',
      '它是按引擎行为调的。原注释点名 Firefox，说明不同引擎在同一处的取舍可能不同——这类写法要实测。',
      '更稳的替代方案是**避免正好转 180 度**：写成 `-181deg` 或分成两段各 90 度，方向就没有歧义了。收这一条的价值在于看清问题本身。',
      '它只影响中间过程，不影响首尾帧的位置。所以视觉上「结果一样、过程不同」，很隐蔽。',
    ],
    notes: [
      `原实现是 ${SPINKIT} 的 \`sk-wander\`，作者在这里留了 \`/* Make FF rotate in the right direction */\`。`,
      '通用思路：**当两个状态之间存在多条路径，而你想指定其中一条时，就在中间补一帧**。这和「支点突变」是一条路的两个用法。',
    ],
    _rawRef: 'https://github.com/tobiasahlin/SpinKit',
    _origin: 'crawl',
  },
]
