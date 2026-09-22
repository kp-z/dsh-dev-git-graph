/**
 * 第 5 批采集草稿：动画与滚动进阶。
 *
 * 这一批的共同点是「时间轴的来源」——时间、滚动位置、指针，
 * 三者都能驱动同一个动画，而机制完全不同。
 *
 * 用法：
 *   node scripts/prepare-draft.mjs drafts/batch-05.mjs
 *   node scripts/ingest.mjs drafts/batch-05.mjs --dry-run
 *   node scripts/ingest.mjs drafts/batch-05.mjs
 */

const SINCE = '2026-09'

export default [
  /* ────────────────────────────── 动效 ────────────────────────────── */
  {
    slug: 'property-transition',
    title: '让自定义属性可过渡',
    category: '动效',
    tags: ['property', '自定义属性', '渐变角度'],
    since: SINCE,
    source: '机制来自 CSS Properties and Values API，自行实现',
    when: '渐变的角要转起来，或者自定义属性要参与过渡，但改了值只会硬跳',
    stage: 'dark',
    tier: 'core',
    params: [
      { name: 'dur', label: '一圈用时', type: 'range', min: 1, max: 12, step: 0.5, default: 4, unit: 's' },
    ],
    description: `一束锥形渐变绕着中心转，颜色随之扫过整块。

机制是 ==@property 给自定义属性一个类型，它才可以被插值==。默认的自定义属性是「无类型字符串」——浏览器拿到 \`0deg\` 和 \`360deg\` 不知道该怎么算中间值，所以 \`transition\` 与 \`animation\` 对它完全无效，值会直接跳变。用 \`@property\` 声明 \`syntax: '<angle>'\` 之后，它变成真正的角度，就有了中间态。

这是让渐变角度、颜色、长度这类**变量**能动起来的唯一途径。`,
    code: [
      {
        lang: 'html',
        body: `<div class="pt">
  <span class="pt-label">旋转的渐变</span>
</div>`,
      },
      {
        lang: 'css',
        body: `/* @mechanism 声明类型，自定义属性才有中间值 */
@property --pt-angle {
  syntax: "<angle>";
  inherits: false;
  initial-value: 0deg;
}

.pt {
  position: relative;
  display: grid;
  place-items: center;
  width: 190px;
  height: 190px;
  overflow: hidden;
  background: #0a0810;
  font: 500 15px/1 system-ui, sans-serif;
  color: #f0ead9;
}

.pt::before {
  content: "";
  position: absolute;
  inset: -30%;
  /* @mechanism 变量参与渐变，靠 @property 才能被动画插值 */
  background: conic-gradient(
    from var(--pt-angle),
    #b4462f,
    #d9a441,
    #7c5cff,
    #14b8a6,
    #b4462f
  );
  animation: pt-spin var(--dur, 4s) linear infinite;
}

.pt-label {
  position: relative;
  z-index: 1;
  padding: 7px 14px;
  background: rgb(10 8 16 / 0.72);
}

@keyframes pt-spin {
  to {
    --pt-angle: 360deg;
  }
}`,
      },
    ],
    caveats: [
      '不注册 `@property` 时，自定义属性的动画会**直接跳变**，而且不报错。这是最典型的「动画写了没反应」。',
      '`initial-value` 在没有它的情况下整条 `@property` 会被忽略（除非 `syntax` 是 `*`），症状和不写一模一样——很难从现象倒推回来。',
      '`inherits: false` 通常是想要的：渐变角度这类值不该往下传，传下去子元素的同名变量会互相干扰。',
      '它注册的是**自定义属性**，不是已有 CSS 属性。别指望用它让 `width` 这类属性能被某种新方式动画。',
      '每帧都要重算整块渐变，代价远高于 `transform`。能用 `transform: rotate()` 解决的场景就别用它——它真正的价值是给那些**本来无法动画**的值开口子。',
      '支持面上注意 Firefox 的版本，不支持的浏览器会退回「跳变」，动画看起来是静止的。',
    ],
    notes: [
      '同一招能让 `background-image` 里的颜色位置、`clip-path` 的百分比都动起来——凡是「写死在函数参数里的值」都有机会。',
      '它也是「渐变描边能旋转」的钥匙：把 `metal-foil` 里的 `from` 角度注册成 `<angle>` 就能转。',
    ],
    _rawRef: 'https://developer.mozilla.org/en-US/docs/Web/CSS/@property',
    _origin: 'crawl',
  },

  {
    slug: 'view-timeline',
    title: '滚到才播',
    category: '动效',
    tags: ['滚动驱动', '视图时间线', '入场'],
    since: SINCE,
    source: '机制来自 CSS Scroll-driven Animations 的 view()，自行实现',
    when: '元素滚进视口时才播放动画，不想引入 IntersectionObserver',
    stage: 'plain',
    tier: 'candidate',
    params: [
      { name: 'range', label: '触发进度', type: 'range', min: 20, max: 100, step: 5, default: 60, unit: '%' },
    ],
    description: `每块内容滚进视口下缘时才开始浮现，滚过头就停在那儿。

机制是 ==animation-timeline: view() 把动画进度绑到元素进入视口的比例上==。动画的驱动源不再是一个时钟，而是滚动位置：元素刚到视口下缘时进度是 0，走到 \`animation-range\` 指定的位置时是 100%。以前这套需要 \`IntersectionObserver\` 加类名，现在是纯 CSS。

这里没有 JS，也没有「滚到就播一次」的状态需要记——位置本身就是进度。`,
    code: [
      {
        lang: 'html',
        body: `<div class="vt-scroll">
  <p class="vt-hint">往下滚</p>
  <article class="vt-item">第一块</article>
  <article class="vt-item">第二块</article>
  <article class="vt-item">第三块</article>
  <article class="vt-item">第四块</article>
  <p class="vt-hint">到底了</p>
</div>`,
      },
      {
        lang: 'css',
        body: `.vt-scroll {
  width: min(360px, 80vw);
  height: 200px;
  overflow-y: auto;
  padding: 18px;
  background: rgb(255 255 255 / 0.3);
  border: 1px solid rgb(60 48 30 / 0.28);
}

.vt-item {
  margin-bottom: 14px;
  padding: 26px 18px;
  background: #efe9dd;
  border-left: 3px solid #b4462f;
  font: 500 15px/1 system-ui, sans-serif;
  color: #1c1a17;
  animation: vt-rise linear both;
  /* @mechanism 时间轴换成「元素进入视口的比例」 */
  animation-timeline: view();
  /* @mechanism 用进入过程的哪一段 */
  animation-range: entry 12% entry var(--range, 60%);
}

.vt-hint {
  margin: 0 0 12px;
  font: 400 13px/1.6 system-ui, sans-serif;
  color: rgb(28 26 23 / 0.55);
  text-align: center;
}

@keyframes vt-rise {
  from {
    opacity: 0;
    translate: 0 26px;
  }
  to {
    opacity: 1;
    translate: 0 0;
  }
}`,
      },
    ],
    caveats: [
      '它把驱动源从**时间**换成**滚动位置**：不滚动它就永远停在某一帧，不会自己播完。想要「滚到就播一次然后不管」，得用 `animation-timeline: view()` 配 `animation-fill-mode: both` 并接受它随滚动回退。',
      '`animation-range` 的区间名要选对。`entry` 是元素进入视口的阶段，`exit` 是离开，`cover` 是全程——用错区间会看到动画在屏幕外就播完了。',
      '`animation-fill-mode: both` 基本是必需的，否则区间之外元素会回到未动画的状态，出现闪烁。',
      '加了 `animation-timeline` 之后，`animation-delay` **不再表示时间**（它按进度算），原来的延迟意图会失效。',
      '支持面还不宽。不支持时 `animation-timeline` 被忽略，动画会退化成**按时间播放**——页面一加载全部播一遍，这不算优雅降级。要用 `@supports (animation-timeline: view())` 把整段包起来。',
    ],
    notes: [
      '`animation-timeline: scroll()` 是它的兄弟：参照的是**容器**的滚动位置，用来做进度条。',
      '同一元素上 `animation-range` 配 `exit` 区间就能做「滚出去时淡出」，不需要第二套规则。',
    ],
    _rawRef: 'https://developer.mozilla.org/en-US/docs/Web/CSS/animation-timeline',
    _origin: 'crawl',
  },

  {
    slug: 'offset-path-motion',
    title: '沿路径运动',
    category: '动效',
    tags: ['路径', '运动', 'offset'],
    since: SINCE,
    source: '机制来自 CSS Motion Path，自行实现',
    when: '元素要沿一条曲线走，而不是直线来回',
    stage: 'grid',
    tier: 'core',
    params: [
      { name: 'dur', label: '走一趟用时', type: 'range', min: 1, max: 8, step: 0.5, default: 3.6, unit: 's' },
    ],
    description: `一个小方块沿一条 S 形曲线滑过去，而且它自己会跟着曲线的方向转。

机制是 ==offset-path 给元素一条运动路径，offset-distance 表示走到路径的百分之几==。它的位置不再由 \`transform\` 的平移量描述，而是「路径上的一个点」。而且浏览器默认会让元素的朝向跟随路径切线（\`offset-rotate: auto\`），所以它自己会转过弯来。

\`transform\` 能做直线与旋转，做不了曲线——这就是它存在的地方。`,
    code: [
      {
        lang: 'html',
        body: `<div class="op">
  <div class="op-dot"></div>
</div>`,
      },
      {
        lang: 'css',
        body: `.op {
  position: relative;
  width: min(340px, 80vw);
  height: 180px;
  border: 1px dashed rgb(60 48 30 / 0.36);
  background: rgb(255 255 255 / 0.26);
}

.op-dot {
  width: 26px;
  height: 26px;
  background: #b4462f;
  /* @mechanism 一条曲线路径，元素的位置由路径决定 */
  offset-path: path("M 22 140 C 90 20, 170 170, 250 60");
  offset-rotate: auto;
  animation: op-travel var(--dur, 3.6s) ease-in-out infinite alternate;
}

@keyframes op-travel {
  to {
    /* @mechanism 走完路径的百分比，不是坐标 */
    offset-distance: 100%;
  }
}`,
      },
    ],
    caveats: [
      '`path()` 里的坐标是**元素所在坐标系**的绝对坐标，不是相对自身的偏移。路径从 `0 0` 起笔时元素会跑到容器左上角。',
      '`offset-rotate` 默认是 `auto`，元素会跟着切线转。只想要位置、不想要转弯时必须显式写 `offset-rotate: 0deg`。',
      '`path()` 直观但**不响应式**（坐标是死的）。容器一变宽，路径不会跟着变。要自适应得用 `circle()` / `ellipse()` 这类基本形状。',
      '它和 `transform` 同时用时，路径位移先于元素的 `transform` 生效。想让元素在路径上再自转，得把自转写进 `transform`，但要和 `offset-rotate` 协调好，否则两个旋转会叠加。',
      '路径是二维的。`offset-path` 不接受 3D 路径，配合透视也做不出「绕圈」的景深。',
    ],
    notes: [
      '`offset-distance` 是长度也可以是百分比，用百分比时路径变换会自适应——但 `path()` 的坐标仍然不会。',
      '配 `offset-anchor` 可以改「元素的哪个点贴在路径上」，默认是中心。',
    ],
    _rawRef: 'https://developer.mozilla.org/en-US/docs/Web/CSS/offset-path',
    _origin: 'crawl',
  },

  {
    slug: 'flip-3d-card',
    title: '3D 翻转卡片',
    category: '动效',
    tags: ['3D', '翻转', '背面'],
    since: SINCE,
    source: '机制来自 CSS Transforms 的 preserve-3d 与 backface-visibility，自行实现',
    when: '卡片正反面切换要有真实的翻面感，不是交叉淡入',
    stage: 'grid',
    tier: 'core',
    params: [],
    description: `卡片翻转过去，露出背面的内容——看到的是同一张卡在旋转，不是两块图叠着淡出淡入。

机制要三件事一起：==容器给 perspective 造出透视、内层用 preserve-3d 保住 3D 空间、每一面用 backface-visibility: hidden 让背朝自己时不画==。少了 \`preserve-3d\`，子元素会被压回平面，两个面就会重叠在一起。

\`rotateY\` 本身只是把元素压扁；「翻过去」是透视加深度共同给的。`,
    code: [
      {
        lang: 'html',
        body: `<div class="fc">
  <div class="fc-inner">
    <div class="fc-face fc-front">
      <b>正面</b>
      <span>指针移上去</span>
    </div>
    <div class="fc-face fc-back">
      <b>背面</b>
      <span>它转过来了</span>
    </div>
  </div>
</div>`,
      },
      {
        lang: 'css',
        body: `.fc {
  /* @mechanism 透视必须在外层容器上 */
  perspective: 900px;
  width: 190px;
  height: 190px;
}

.fc-inner {
  position: relative;
  width: 100%;
  height: 100%;
  /* @mechanism 保住子元素的 3D 空间，否则两面会被压平重叠 */
  transform-style: preserve-3d;
  transition: transform 0.62s cubic-bezier(0.4, 0.2, 0.2, 1);
}

.fc:hover .fc-inner {
  transform: rotateY(180deg);
}

.fc-face {
  position: absolute;
  inset: 0;
  display: grid;
  align-content: center;
  justify-items: center;
  gap: 6px;
  /* @mechanism 背朝自己时不绘制 */
  backface-visibility: hidden;
  border: 1px solid rgb(60 48 30 / 0.3);
  font: 400 13px/1.6 system-ui, sans-serif;
}

.fc-face b {
  font-size: 19px;
}

.fc-front {
  background: #efe9dd;
  color: #1c1a17;
}

.fc-back {
  /* @mechanism 背面要预先转过去，否则它本来就朝外 */
  transform: rotateY(180deg);
  background: #7c5cff;
  color: #f6f2ff;
}`,
      },
    ],
    caveats: [
      '`perspective` 必须写在外层容器上。写在参与旋转的元素自己身上，看到的是「压扁」而不是「转过去」。',
      '`transform-style: preserve-3d` 缺了的话两个面会被压平并重叠，看到的是两块内容糊在一起。',
      '`backface-visibility: hidden` 缺了的话背面元素会以镜像显示，看到反着的字。',
      '背面那一面必须预先 `rotateY(180deg)`，否则两面的初始朝向相同，翻过去看到的还是正面。',
      '`preserve-3d` 会被 `overflow: hidden`、`filter`、`opacity` 小于 1 打断——它们强制创建层叠上下文并把 3D 压平。这是最难查的一类「翻转忽然不转了」。',
      '两个面都要 `position: absolute` 并且父级 `position: relative`，否则高度得靠写死。',
    ],
    notes: [
      '`cubic-bezier` 在中间段更慢一点，翻面会显得有实体重量。线性过渡像在滑屏。',
      '把 `rotateY` 换成 `rotateX` 就是上下翻，换成两个轴组合就是斜翻——机制完全一样。',
    ],
    _rawRef: 'https://developer.mozilla.org/en-US/docs/Web/CSS/transform-style',
    _origin: 'crawl',
  },

  {
    slug: 'orbit-transform',
    title: '偏移原点的公转',
    category: '动效',
    tags: ['旋转', '公转', '变换原点'],
    since: SINCE,
    source: '自行实现',
    when: '元素要绕着另一个点转圈，而不是绕自己打转',
    stage: 'dark',
    tier: 'core',
    params: [
      { name: 'radius', label: '轨道半径', type: 'range', min: 20, max: 90, step: 5, default: 62, unit: 'px' },
    ],
    description: `一颗珠子绕着中心匀速转圈，而且它自己始终不倒——朝向不变。

机制是 ==旋转的是「臂」，珠子被 translate 推到臂的末端==。\`transform-origin\` 默认在元素中心，所以直接给一个圆点加旋转动画，它只会原地打转、看起来根本没动。把它从旋转中心推开，旋转才变成公转。

珠子还想保持朝向，就再给它一个**反向**的旋转动画，两者抵消。`,
    code: [
      {
        lang: 'html',
        body: `<div class="ob">
  <div class="ob-arm"></div>
  <div class="ob-core"></div>
</div>`,
      },
      {
        lang: 'css',
        body: `.ob {
  position: relative;
  display: grid;
  place-items: center;
  width: 190px;
  height: 190px;
}

.ob-core {
  width: 14px;
  height: 14px;
  border-radius: 50%;
  background: #d9a441;
}

.ob-arm {
  position: absolute;
  inset: 0;
  /* @mechanism 旋转这个臂（原点在中心），珠子挂在臂的末端 */
  animation: ob-spin 6s linear infinite;
}

.ob-arm::before {
  content: "";
  position: absolute;
  top: 50%;
  left: 50%;
  width: 18px;
  height: 18px;
  margin: -9px 0 0 -9px;
  border-radius: 50%;
  background: #b4462f;
  box-shadow: 0 0 14px rgb(180 70 47 / 0.6);
  /* @mechanism 推离旋转中心，旋转才会带着它绕圈 */
  translate: var(--radius, 62px) 0;
  /* @mechanism 反向自转，抵消公转带来的转动，朝向保持不变 */
  animation: ob-unspin 6s linear infinite;
}

@keyframes ob-spin {
  to {
    rotate: 1turn;
  }
}

@keyframes ob-unspin {
  to {
    rotate: -1turn;
  }
}`,
      },
    ],
    caveats: [
      '直接给一个圆点加旋转动画看不出任何变化——圆是旋转对称的，而且原点就在它自己中心。要么把它推离旋转中心，要么换成不对称的形状。',
      '现代独立属性 `translate` / `rotate` / `scale` 的应用顺序是**固定**的（先平移、再旋转、最后缩放），与你在 CSS 里的书写顺序无关。`transform` 简写则按书写顺序生效。两者不等价，混用时最容易搞错。',
      '反向自转的时长与缓动必须与公转**完全一致**，否则珠子会肉眼可见地晃。',
      '`transform-origin` 只影响 `rotate` 与 `scale`，**不影响 `translate`**。想靠它来挪位置是没用的。',
      '臂的尺寸决定了旋转中心的位置（这里是父级的几何中心）。父级没有明确尺寸时，原点落在哪是不确定的。',
      '这颗珠子在转，但它的**布局位置**没变。做碰撞检测或点击热区时，实际区域还在原地——位移全是视觉层的。',
    ],
    notes: [
      '用两颗珠子、反向的臂，就得到一个简单的原子模型；用三颗就是三重轨道。',
      '轨道半径做成变量后，改一个值整条轨道跟着变，不必逐个调 `translate`。',
    ],
    _rawRef: 'https://developer.mozilla.org/en-US/docs/Web/CSS/rotate',
    _origin: 'crawl',
  },

  {
    slug: 'multi-animation-stack',
    title: '一块元素叠两个动画',
    category: '动效',
    tags: ['多动画', '叠加', '属性冲突'],
    since: SINCE,
    source: '机制来自 CSS Animations 的多值语法，自行实现',
    when: '元素要一边做入场、一边持续呼吸，两件事同时进行',
    stage: 'dark',
    tier: 'core',
    params: [],
    description: `卡片升上来之后一直轻轻起伏——入场只播一次，呼吸永不停。

机制是 ==animation 用逗号分隔多组动画，每组各走各的时间轴==。\`animation\` 的每个子属性都可以写成列表，按位置一一对应。所以「0.6 秒的入场 + 2.4 秒的无限循环」可以同时挂在一个元素上。

唯一要守的规矩是：两组动画**不能碰同一个属性**。`,
    code: [
      {
        lang: 'html',
        body: `<div class="ms">
  <b>入场 + 呼吸</b>
  <span>两个动画同时跑</span>
</div>`,
      },
      {
        lang: 'css',
        body: `.ms {
  display: grid;
  align-content: center;
  justify-items: center;
  gap: 6px;
  width: min(240px, 76vw);
  height: 160px;
  border: 1px solid rgb(217 164 65 / 0.4);
  background: linear-gradient(160deg, #241d33, #120f1c);
  font: 400 13px/1.6 system-ui, sans-serif;
  color: #f0ead9;
  /* @mechanism 逗号分隔多组动画，各走各的时间轴 */
  animation:
    ms-rise 0.65s ease both,
    ms-breathe 2.6s ease-in-out 0.65s infinite;
}

.ms b {
  font-size: 17px;
}

@keyframes ms-rise {
  from {
    opacity: 0;
    transform: translateY(22px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

/* @mechanism 只碰 scale，与入场动画的 translate/opacity 不重叠 */
@keyframes ms-breathe {
  0%,
  100% {
    scale: 1;
  }
  50% {
    scale: 1.035;
  }
}`,
      },
    ],
    caveats: [
      '两组动画碰同一个属性时，**后声明的赢**（在重叠的时间段内）。这是「叠了动画但看起来只有一个」的原因。要分开就用不同属性——比如一个动 `translate`、另一个动 `scale`。',
      '`animation` 简写里两个 `<time>` 值按位置解析：**第一个是时长、第二个是延迟**。写反了不报错，但动画会以完全不同的节奏跑。',
      '`animation-fill-mode` 也是按组独立的。入场要 `both`、循环要 `none`，得分别写清楚。',
      '简写会**重置**该元素所有动画子属性。想保留某组动画的某个子属性，就得用完整写法补回来。',
      '动画数量越多，每帧的计算量越大。低端设备上多个 `transform` 动画叠加也会掉帧。',
      '配合 `animation-timeline` 时，时间轴同样是按组分的：只给一组加了滚动驱动，另一组仍按时间播放——这个组合很有用，但也很容易看错。',
    ],
    notes: [
      '入场用 `transform`、循环用独立属性 `scale`，是避免冲突最省心的分工方式。',
      '把「入场」和「循环」的动画名分开写，比在一个关键帧里既做位移又做缩放更好维护。',
    ],
    _rawRef: 'https://developer.mozilla.org/en-US/docs/Web/CSS/animation',
    _origin: 'crawl',
  },

  {
    slug: 'scene-parallax',
    title: '透视视差',
    category: '动效',
    tags: ['视差', '透视', '深度'],
    since: SINCE,
    source: '机制来自 CSS 3D Transforms 的 translateZ 与 perspective，自行实现',
    when: '滚动时前后景以不同速度移动，做出景深',
    stage: 'dark',
    tier: 'candidate',
    params: [
      { name: 'depth', label: '景深', type: 'range', min: 40, max: 220, step: 20, default: 120, unit: 'px' },
    ],
    description: `滚动时近处的层移动得快、远处的层移动得慢，画面因此有了厚度。

机制是 ==translateZ 把层推到透视空间的深处，透视让不同深度的层获得不同的表观速度==。这不是「给每层设一个不同的滚动速度」——那是 JS 的做法。这里是让浏览器按 3D 几何去算：越远的层，在同样滚动距离下位移越小。

推远之后层会变小，所以还要用 \`scale()\` 补回来。`,
    code: [
      {
        lang: 'html',
        body: `<div class="px-scene">
  <div class="px-layer px-far">远景</div>
  <div class="px-layer px-mid">中景</div>
  <div class="px-layer px-near">近景</div>
</div>`,
      },
      {
        lang: 'css',
        body: `.px-scene {
  position: relative;
  width: min(340px, 80vw);
  height: 190px;
  overflow-y: auto;
  /* @mechanism 透视定义在整个滚动容器上，所有层共享同一个空间 */
  perspective: 400px;
  background: #0a0810;
}

.px-layer {
  position: absolute;
  left: 0;
  right: 0;
  display: grid;
  place-items: center;
  height: 120px;
  font: 500 15px/1 system-ui, sans-serif;
  color: #f0ead9;
}

/* @mechanism 推远 + 放大补偿，同一滚动距离下位移更小 */
.px-far {
  transform: translateZ(calc(var(--depth, 120px) * -1)) scale(calc(1 + var(--depth, 120px) / 400));
  background: rgb(124 92 255 / 0.34);
  top: 10px;
}

.px-mid {
  transform: translateZ(calc(var(--depth, 120px) * -0.5)) scale(calc(1 + var(--depth, 120px) / 800));
  background: rgb(20 184 166 / 0.38);
  top: 130px;
}

.px-near {
  transform: translateZ(0) scale(1);
  background: rgb(180 70 47 / 0.6);
  top: 250px;
}`,
      },
    ],
    caveats: [
      '推远之后元素会变小，**必须**用 `scale()` 反向补偿。少了补偿，四周会露出背景，看起来像「层缩水了」。',
      '`scale` 的补偿量要与深度对应（大致是 `(透视距离 + 深度) / 透视距离`）。随便填一个数会得到「缩放不对版」的观感。',
      '`perspective` 要写在**滚动容器**上，让所有层共享一个空间。写在每个层上等于各自透视，深度关系就没了。',
      '它和浏览器自带的滚动惯性会打架：快速滚动时远层会「追不上」，出现明显的拖影。',
      '视差是**最容易引发前庭不适**的效果之一。正式项目必须配 `prefers-reduced-motion` 把它降级成无位移的静态版。',
      '`translateZ` 为正值会把层推到屏幕外（比自己更大），大多数情况下用负值把层推远。',
    ],
    notes: [
      '`perspective-origin` 能改透视的消失点，默认在容器中心。改它可以让视差从某一侧发散。',
      '它不是唯一做法：`background-attachment: fixed` 只有两层，但代价小得多；`translateZ` 方案层数不受限。',
    ],
    _rawRef: 'https://developer.mozilla.org/en-US/docs/Web/CSS/perspective',
    _origin: 'crawl',
  },

  {
    slug: 'reduced-motion-guard',
    title: '动效的等价替代',
    category: '动效',
    tags: ['无障碍', '动效', '媒体查询'],
    since: SINCE,
    source: '机制来自 Media Queries Level 5 的 prefers-reduced-motion，自行实现',
    when: '系统里关掉了动效，界面还必须有完整的反馈与内容',
    stage: 'plain',
    tier: 'core',
    params: [],
    description: `系统里关掉动效之后，元素不再位移，但该出现的内容照样出现、该有的状态照样变。

机制是 ==prefers-reduced-motion 问的是「系统里关掉动画了吗」，用它把位移换成不位移的等价反馈==。关键在**不要简单地把动画删掉**：删掉之后元素可能停在起始帧（\`opacity: 0\`、位移未归零），内容直接看不见。正确做法是把动画替换成一个「无位移的终态」。

要删的是**大幅位移、旋转、缩放、视差**；颜色与透明度的淡入通常可以保留。`,
    code: [
      {
        lang: 'html',
        body: `<div class="rm">
  <b>不会动的入场</b>
  <span>内容和状态一样完整</span>
</div>`,
      },
      {
        lang: 'css',
        body: `.rm {
  display: grid;
  align-content: center;
  justify-items: center;
  gap: 6px;
  width: min(240px, 76vw);
  height: 150px;
  background: #efe9dd;
  border: 1px solid rgb(60 48 30 / 0.3);
  font: 400 13px/1.6 system-ui, sans-serif;
  color: #1c1a17;
  animation: rm-slide 0.7s ease both;
  transition: translate 0.3s ease;
}

.rm:hover {
  translate: 0 -6px;
}

.rm b {
  font-size: 17px;
}

@keyframes rm-slide {
  from {
    opacity: 0;
    transform: translateY(28px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

/* @mechanism 换成无位移的等价终态，而不是把动画删掉 */
@media (prefers-reduced-motion: reduce) {
  .rm,
  .rm:hover {
    animation: none;
    transition: none;
    opacity: 1;
    transform: none;
    translate: none;
  }
}`,
      },
    ],
    caveats: [
      '**直接删掉 `animation` 而不处理填模式，元素会停在起始帧**（这里是 `opacity: 0`），内容彻底看不见。这是「无障碍处理」里最危险的一种写法。',
      '`reduce` 不等于「不要任何动静」。颜色变化与透明度淡入一般可以保留，要删的是大幅**位移、旋转、缩放与视差**。',
      '只处理 `animation` 不处理 `transition` 会漏掉一大半：悬停位移通常就是 `transition` 做的。',
      '这是**系统级**设置，不是浏览器偏好开关。它表达的不是「我不喜欢动画」，而是「这些效果可能让我不适」——值得认真对待。',
      '用 `no-preference` 做正向判断（只在明确允许时才上动效）通常比反向覆盖更稳，因为旧浏览器上这个查询的求值行为不统一。',
      '媒体查询改不了已经在 JS 里跑起来的动画。用脚本驱动的效果（比如递归 `requestAnimationFrame`）必须自己读 `matchMedia` 并停下。',
    ],
    notes: [
      '把「动效」与「状态变化」在设计上分开：前者可以被关掉，后者不行。这条边界清楚了，降级方案就是自然的。',
      '配 `@media (prefers-reduced-motion: no-preference)` 包住动效，比事后覆盖更不容易漏。',
    ],
    _rawRef: 'https://developer.mozilla.org/en-US/docs/Web/CSS/@media/prefers-reduced-motion',
    _origin: 'crawl',
  },

  /* ────────────────────────────── 交互 ────────────────────────────── */
  {
    slug: 'cursor-glow-follow',
    title: '跟着指针的光晕',
    category: '交互',
    tags: ['指针', '光晕', '变量桥'],
    since: SINCE,
    source: '自行实现',
    when: '一块面板上有一团光跟着鼠标走，但不想让脚本管样式',
    stage: 'dark',
    tier: 'core',
    params: [],
    description: `一团暖光跟着指针在面板上走，鼠标离开就淡掉。

机制是 ==JS 只做一件事：把指针位置写进 CSS 变量==。光晕的大小、颜色、模糊、淡入淡出全部由 CSS 负责。脚本与样式之间只有一个极窄的接口（两个变量），改视觉完全不用碰脚本。

这也是把「高频事件」变便宜的办法：脚本不做样式计算，只写变量。`,
    code: [
      {
        lang: 'html',
        body: `<div class="cg" id="sb-cg">
  <b>指针光晕</b>
  <span>把鼠标移进来</span>
</div>`,
      },
      {
        lang: 'css',
        body: `.cg {
  position: relative;
  display: grid;
  align-content: center;
  justify-items: center;
  gap: 6px;
  width: min(340px, 80vw);
  height: 190px;
  overflow: hidden;
  background: #0d0a14;
  font: 400 13px/1.6 system-ui, sans-serif;
  color: #f0ead9;
}

.cg::before {
  content: "";
  position: absolute;
  /* @mechanism 位置全部来自 JS 写进来的两个变量 */
  left: var(--mx, 50%);
  top: var(--my, 50%);
  width: 230px;
  height: 230px;
  translate: -50% -50%;
  background: radial-gradient(circle, rgb(217 164 65 / 0.4), transparent 66%);
  opacity: 0;
  transition: opacity 0.3s ease;
  /* @mechanism 光晕不能吃掉底下的悬停与点击 */
  pointer-events: none;
}

.cg:hover::before {
  opacity: 1;
}

.cg b,
.cg span {
  position: relative;
  z-index: 1;
}`,
      },
      {
        lang: 'js',
        body: `const panel = document.getElementById('sb-cg')
if (panel) {
  panel.addEventListener('pointermove', (event) => {
    // 只写变量，样式一律交给 CSS
    panel.style.setProperty('--mx', event.offsetX + 'px')
    panel.style.setProperty('--my', event.offsetY + 'px')
  })
  panel.addEventListener('pointerleave', () => {
    panel.style.removeProperty('--mx')
    panel.style.removeProperty('--my')
  })
}`,
      },
    ],
    caveats: [
      '`pointermove` 每秒能触发上百次。直接改 `left` / `top` 会每帧触发布局重算；写成 CSS 变量并让位移走 `translate`（合成器）便宜得多。',
      '光晕层必须 `pointer-events: none`，否则它会吃掉底下所有的悬停与点击——现象是「面板上的东西点不动」。',
      '要监听 `pointerleave` 把光晕复位/淡掉。不做这一步时，它会停在鼠标最后离开的那个位置。',
      '用 `event.offsetX` 省掉了 `getBoundingClientRect()`，也顺带绕开了「滚动后 rect 过期」的问题。用 `clientX` 就得每次重新读 rect。',
      '触屏没有指针移动，这套完全无效。必须准备一个静态的等价外观。',
      '它没有处理 `prefers-reduced-motion`。跟随类效果对敏感人群不友好，正式项目里应当退化成不跟随的静态光。',
    ],
    notes: [
      '这个「JS 写变量、CSS 画效果」的分工可以套在任何指针跟随效果上（倾斜、聚光、描边跟随）。',
      '阈值节流不划算：写 CSS 变量本身很便宜，节流反而会让光晕一顿一顿。真要省就该换成 CSS 的 `translate` 位移而不是改 `left`。',
    ],
    _rawRef: 'https://developer.mozilla.org/en-US/docs/Web/API/Element/pointermove_event',
    _origin: 'crawl',
  },

  {
    slug: 'tilt-3d-hover',
    title: '内层有深度的倾斜卡片',
    category: '交互',
    tags: ['3D', '倾斜', '深度'],
    since: SINCE,
    source: '机制来自 CSS translateZ 与 preserve-3d，自行实现',
    when: '悬浮时卡片倾向一边，而且里面的元素看起来有厚薄',
    stage: 'dark',
    tier: 'core',
    params: [],
    description: `指针移上去卡片微微侧倾，卡上的标题浮得比底色高一点，像一块真的牌子。

机制是 ==preserve-3d 让子元素各自有真实深度（translateZ）==。只倾斜外层，看到的是「一整张图被压歪」；给内层不同的 \`translateZ\`，透视就会让近的那层在倾斜时移动得更多，于是产生厚薄。

差别很细微，但一眼就能看出哪个是贴纸、哪个是实体。`,
    code: [
      {
        lang: "html",
        body: `<div class="tl">
  <div class="tl-card">
    <b class="tl-title">浮起来的标题</b>
    <span class="tl-sub">它在更靠前的一层</span>
  </div>
</div>`,
      },
      {
        lang: "css",
        body: `.tl {
  /* @mechanism 透视在外层，内层才有共同的深度空间 */
  perspective: 800px;
  width: min(260px, 78vw);
}

.tl-card {
  display: grid;
  align-content: center;
  justify-items: center;
  gap: 8px;
  height: 170px;
  /* @mechanism 保住子元素的 3D 位置 */
  transform-style: preserve-3d;
  border: 1px solid rgb(217 164 65 / 0.36);
  background: linear-gradient(150deg, #241d33, #120f1c);
  font: 400 13px/1.6 system-ui, sans-serif;
  color: #f0ead9;
  transition: transform 0.4s cubic-bezier(0.3, 0.7, 0.3, 1);
}

.tl:hover .tl-card {
  transform: rotateX(12deg) rotateY(-14deg) scale(1.03);
}

.tl-title {
  font-size: 18px;
  /* @mechanism 这一层比底色更靠前 */
  transform: translateZ(34px);
}

.tl-sub {
  opacity: 0.72;
  transform: translateZ(14px);
}`,
      },
    ],
    caveats: [
      '只倾斜外层、内层全在 `translateZ(0)`，看到的是「一张图被压歪」。深度差是这个效果的全部来源，`translateZ` 必须给到内层。',
      '`translateZ` 越大，元素在倾斜时的位移越明显。给太大（超过透视距离的一半）会让内容飘出卡片边界。',
      '内层元素超出卡片范围时**不会被裁掉**（除非卡片有 `overflow: hidden`），这可能正是想要的，也可能是没料到的。',
      '`preserve-3d` 会被卡片的 `overflow: hidden`、`filter`、`opacity` 小于 1 打断。这几个属性很容易在别处被顺手加上，然后 3D 就悄悄失效了。',
      '倾斜角度别太大（10–16 度之间）。再大就会像「卡片要倒了」，而不是「有厚度」。',
      '它是纯 CSS 的固定角度倾斜。要跟着指针方向变，得把指针位置写进 CSS 变量——那就是另一个条目了。',
    ],
    notes: [
      '标题比副标题更靠前是刻意的：层次拉开了，倾斜时的视差才看得出来。',
      '给卡片加一点阴影，倾斜时它也跟着变，厚薄感会更实。',
    ],
    _rawRef: 'https://developer.mozilla.org/en-US/docs/Web/CSS/translate',
    _origin: 'crawl',
  },

  {
    slug: 'press-ripple',
    title: '按下扩散的波纹',
    category: '交互',
    tags: ['点击', '波纹', '伪元素'],
    since: SINCE,
    source: '自行实现',
    when: '按钮按下去要有一圈从中间荡开的光，像水面',
    stage: 'dark',
    tier: 'core',
    params: [
      { name: 'dur', label: '扩散用时', type: 'range', min: 0.2, max: 1, step: 0.05, default: 0.5, unit: 's' },
    ],
    description: `按住按钮的瞬间，一圈光从中间荡开然后散掉。

机制是 ==把动画挂在 :active 上，每次「从没按到按下」都会重新触发一次==。\`:active\` 是一个瞬时状态，它在 false → true 的那一帧让浏览器重新开始这条动画。不需要 JS，也不需要「撤销/重播」的状态管理。

波纹本身是一个径向渐变的伪元素，从中心向外扩、同时淡出。`,
    code: [
      {
        lang: 'html',
        body: `<button class="pr">按住试试</button>`,
      },
      {
        lang: 'css',
        body: `.pr {
  position: relative;
  overflow: hidden;
  padding: 15px 30px;
  border: 1px solid rgb(217 164 65 / 0.5);
  background: rgb(217 164 65 / 0.12);
  font: 500 15px/1 system-ui, sans-serif;
  color: #f0ead9;
  cursor: pointer;
}

.pr::after {
  content: "";
  position: absolute;
  inset: 0;
  background: radial-gradient(circle at 50% 50%, rgb(255 240 200 / 0.65), transparent 62%);
  transform: scale(0);
  opacity: 0;
  /* @mechanism 波纹自己不该吃掉指针事件 */
  pointer-events: none;
}

/* @mechanism 动画挂在 :active 上，每次按下重新触发 */
.pr:active::after {
  animation: pr-spread var(--dur, 0.5s) ease-out;
}

@keyframes pr-spread {
  0% {
    transform: scale(0);
    opacity: 0.9;
  }
  100% {
    transform: scale(2.6);
    opacity: 0;
  }
}`,
      },
    ],
    caveats: [
      '动画挂在 `:active` 上，只在「从非按下变成按下」那一次触发。**按住不放不会重播**，快速连点若中间没松开也不会重播。',
      '伪元素要 `pointer-events: none`。少了它，伪元素盖住按钮后 `:active` 本身可能收不到，波纹变得时有时无。',
      '它只能从**中心**扩散。真正的「从指尖扩散」需要 JS 把点击坐标写进 CSS 变量——纯 CSS 做不到。',
      '波纹完成后必须以 `opacity: 0` 收尾，否则伪元素会一直留着，挡住按钮自己的悬停效果。',
      '`:active` 在触屏上同样会触发（触摸即按下），表现基本一致；但触屏上手指按住的感知不同，波纹时长可以更短。',
      '页面若设了 `user-select: none` 之类的规则，长按 `:active` 的行为在各平台上有差异，需要真机确认。',
    ],
    notes: [
      '同一招可以给「按下」加缩放反馈，只要把关键帧里的 `scale` 改成从 1 到 1.04——机制不变。',
      '波纹颜色用主题色的浅色版，比纯白柔和，深色主题上尤其明显。',
    ],
    _rawRef: 'https://developer.mozilla.org/en-US/docs/Web/CSS/:active',
    _origin: 'crawl',
  },

  {
    slug: 'drag-to-scroll',
    title: '按住拖动来横向滚动',
    category: '交互',
    tags: ['拖拽', '滚动', '指针捕获'],
    since: SINCE,
    source: '自行实现',
    when: '一排卡片要能按住拖，而不是只能滚轮或滚动条',
    stage: 'grid',
    tier: 'candidate',
    params: [],
    description: `按住卡片条往左右拖，内容跟着手指走——像触屏那样，但用的是鼠标。

机制是 ==把指针的横向位移映射到 scrollLeft，并用 setPointerCapture 把指针锁住==。\`setPointerCapture\` 是这套能不能成立的关键：没有它，指针一旦移出元素，\`pointermove\` 就收不到，拖动会中途断掉。

滚动本身仍是原生滚动，脚本只是换了一个输入方式。`,
    code: [
      {
        lang: 'html',
        body: `<div class="ds" id="sb-ds">
  <div class="ds-card">一</div>
  <div class="ds-card">二</div>
  <div class="ds-card">三</div>
  <div class="ds-card">四</div>
  <div class="ds-card">五</div>
  <div class="ds-card">六</div>
</div>`,
      },
      {
        lang: 'css',
        body: `.ds {
  display: flex;
  gap: 10px;
  width: min(380px, 84vw);
  overflow-x: auto;
  padding-bottom: 10px;
  cursor: grab;
  /* @mechanism 拖动时会选中文字，必须关掉 */
  user-select: none;
}

.ds.is-dragging {
  cursor: grabbing;
  /* @mechanism 拖动期间关掉平滑滚动，否则会和手动改 scrollLeft 打架 */
  scroll-behavior: auto;
}

.ds-card {
  flex: 0 0 110px;
  display: grid;
  place-items: center;
  height: 130px;
  border: 1px solid rgb(60 48 30 / 0.3);
  background: rgb(255 255 255 / 0.5);
  font: 600 20px/1 system-ui, sans-serif;
  color: #1c1a17;
  /* @mechanism 阻止浏览器自己的图片/文本拖拽 */
  -webkit-user-drag: none;
}`,
      },
      {
        lang: 'js',
        body: `const rail = document.getElementById('sb-ds')
if (rail) {
  let dragging = false
  let startX = 0
  let startScroll = 0

  rail.addEventListener('pointerdown', (event) => {
    // 只处理鼠标：触屏已有更好的原生惯性滚动
    if (event.pointerType !== 'mouse') return
    dragging = true
    startX = event.clientX
    startScroll = rail.scrollLeft
    rail.classList.add('is-dragging')
    // 关键：锁住指针，移出元素后仍然收得到 pointermove
    rail.setPointerCapture(event.pointerId)
  })

  rail.addEventListener('pointermove', (event) => {
    if (!dragging) return
    event.preventDefault()
    rail.scrollLeft = startScroll - (event.clientX - startX)
  })

  const stop = (event) => {
    if (!dragging) return
    dragging = false
    rail.classList.remove('is-dragging')
    if (rail.hasPointerCapture(event.pointerId)) {
      rail.releasePointerCapture(event.pointerId)
    }
  }

  rail.addEventListener('pointerup', stop)
  rail.addEventListener('pointercancel', stop)
}`,
      },
    ],
    caveats: [
      '**必须 `setPointerCapture`。**没有它，指针一移出元素就收不到 `pointermove`，拖动会突然断掉——这是这套实现最容易漏的一步。',
      '要关掉文本选择与原生拖拽（`user-select: none`、`-webkit-user-drag: none`），否则拖两下就选中一片文字或把卡片拖成幽灵图。',
      '容器若有 `scroll-behavior: smooth`，会和手动改 `scrollLeft` 打架。拖动期间要临时关掉。',
      '只给鼠标用（`pointerType === \'mouse\'`）。触屏已有原生惯性滚动，自己实现只会更差——没有惯性、没有回弹。',
      '它是**滚动增强**，不是替代。滚动条、滚轮、键盘方向键都必须继续可用——只把 `pointerdown` 挂上，不要 `preventDefault` 掉别的输入。',
      '拖动中若内容动态变化（懒加载插入卡片），`scrollLeft` 的基准会跳，需要在插入前后补偿。',
    ],
    notes: [
      '加一个「拖动时给容器加类」的做法，既改了光标也顺手关掉了平滑滚动，一处改动两个作用。',
      '放开后想有惯性，需要自己算速度并逐帧衰减——那是十几行的额外逻辑，多数场景不值得。',
    ],
    _rawRef: 'https://developer.mozilla.org/en-US/docs/Web/API/Element/setPointerCapture',
    _origin: 'crawl',
  },

  /* ────────────────────────────── 图形 ────────────────────────────── */
  {
    slug: 'morph-blob',
    title: '有机形状变形',
    category: '图形',
    tags: ['形状', '圆角', '变形'],
    since: SINCE,
    source: '机制来自 CSS border-radius 的斜杠语法，自行实现',
    when: '色块要像一团会呼吸的墨，而不是圆角矩形',
    stage: 'photo',
    tier: 'core',
    params: [
      { name: 'dur', label: '变形周期', type: 'range', min: 3, max: 20, step: 1, default: 9, unit: 's' },
    ],
    description: `一团色块慢慢变形，边在鼓、角在收，始终没有直角。

机制是 ==border-radius 的斜杠语法给每个角两个半径==：斜杠前是横向半径、斜杠后是纵向半径，四个角各一对。四对角的值互不相同时，边缘就被拉成了有机曲线；一变形，整块颜色像有生命。

如果四个角用同一个值，它就是圆角矩形——**「互不相同」才是这个效果的全部**。`,
    code: [
      {
        lang: 'html',
        body: `<div class="mb"></div>`,
      },
      {
        lang: 'css',
        body: `.mb {
  width: min(220px, 60vw);
  height: min(220px, 60vw);
  background: linear-gradient(140deg, #ff9a5a, #f43f5e 58%, #7c5cff);
  /* @mechanism 四个角各一对横纵半径，互不相同才有有机曲线 */
  border-radius: 62% 38% 46% 54% / 55% 42% 58% 45%;
  animation: mb-morph var(--dur, 9s) ease-in-out infinite;
}

@keyframes mb-morph {
  0%,
  100% {
    border-radius: 62% 38% 46% 54% / 55% 42% 58% 45%;
  }
  50% {
    border-radius: 38% 62% 58% 42% / 42% 58% 45% 55%;
  }
}`,
      },
    ],
    caveats: [
      '四个角用同一个值是**圆角矩形**，不是有机形状。想让它像墨点，每个角的横纵半径必须互不相同。',
      '两个关键帧里的半径**顺序要对齐**（都是 左上、右上、右下、左下）。顺序错位时看到的是形状在乱扭，而不是在呼吸。',
      '`border-radius` 的动画是逐值插值的，每帧都要重绘，代价高于 `transform`。大元素上会明显掉帧。',
      '它**不影响布局**：子元素仍然按原来的矩形排布，即使视觉上形状已经变了。文字放进 blob 会溢出边角，那需要另想办法。',
      '相邻角的半径之和超过边长时，浏览器会自动按比例缩小它们。设的值太大会得到一个和预期不同的形状。',
      '想要更自由的曲线（比如带凹口），`border-radius` 就无能为力了——那要 `clip-path: path()` 或 SVG。',
    ],
    notes: [
      '把两个关键帧写成「对角互换」的形态，变形过程会更像自然的呼吸，而不是来回摆。',
      '同一招配 `blur()` 能得到柔和的色雾，配 `filter: contrast()` 则会让边缘变硬。',
    ],
    _rawRef: 'https://developer.mozilla.org/en-US/docs/Web/CSS/border-radius',
    _origin: 'crawl',
  },

  {
    slug: 'long-shadow',
    title: '长阴影',
    category: '图形',
    tags: ['阴影', '等距', '叠加'],
    since: SINCE,
    source: '机制来自 CSS 多层同向偏移的 box-shadow，自行实现',
    when: '图标或标题要一条斜向拉长的实心投影，像等距视角',
    stage: 'photo',
    tier: 'core',
    // 不给「投影长度」滑杆：长度 = 阴影的层数，而 CSS 没有循环，
    // 层数只能靠手写（或用预处理器生成）。拖不动的滑杆比没有更糟。
    params: [],
    description: `一块色块往斜下方拖出一条实心的长影，边缘是硬的，像等距游戏里的投影。

机制是 ==很多层 box-shadow，每层比上一层多偏 1px==。单层阴影只能给一块模糊的暗面；把偏移量逐像素递增、并把模糊设成 0、颜色设成实色，几十层叠起来就拼成了一条连续的斜向带。

它不是「一个很长的阴影」，是很多个阴影首尾相接。`,
    code: [
      {
        lang: 'html',
        body: `<div class="ls-wrap">
  <div class="ls-box">咒</div>
</div>`,
      },
      {
        lang: 'css',
        body: `.ls-wrap {
  display: grid;
  place-items: center;
  width: min(320px, 78vw);
  height: 210px;
  background: #efe9dd;
}

.ls-box {
  display: grid;
  place-items: center;
  width: 86px;
  height: 86px;
  background: #b4462f;
  font: 700 30px/1 Georgia, serif;
  color: #f7f1e6;
  /* @mechanism 每层多偏 1px、模糊为 0，首尾相接拼成长影 */
  box-shadow:
    1px 1px 0 #8d3524,
    2px 2px 0 #8d3524,
    3px 3px 0 #8d3524,
    4px 4px 0 #8d3524,
    5px 5px 0 #8d3524,
    6px 6px 0 #8d3524,
    7px 7px 0 #8d3524,
    8px 8px 0 #8d3524,
    9px 9px 0 #8d3524,
    10px 10px 0 #8d3524,
    11px 11px 0 #8d3524,
    12px 12px 0 #8d3524,
    13px 13px 0 #8d3524,
    14px 14px 0 #8d3524,
    15px 15px 0 #8d3524,
    16px 16px 0 #8d3524,
    17px 17px 0 #8d3524,
    18px 18px 0 #8d3524,
    19px 19px 0 #8d3524,
    20px 20px 0 #8d3524,
    21px 21px 0 #8d3524,
    22px 22px 0 #8d3524,
    23px 23px 0 #8d3524,
    24px 24px 0 #8d3524;
}`,
      },
    ],
    caveats: [
      '每层偏移必须**递增 1px**。步长大于 1 会在层与层之间露出缝隙，看起来是「虚线」。',
      '模糊半径必须是 0、颜色必须完全不透明。任何一层带上模糊，长影的硬边就断了。',
      '层数等于长度。24 层意味着 24 个阴影，每帧都要合成——静态元素没事，一旦让它动起来就会很吃力。',
      '它是**同向等距**的，所以只有一条直线方向。想要阴影跟着曲线走（那种「飘带」感），得用 `clip-path` 或 SVG。',
      '长影会画出元素盒子之外，父级有 `overflow: hidden` 时会被裁掉，看起来像阴影被切断。',
      '深色主题上要改暗色为亮色（或者干脆反相），否则长影和背景糊在一起。',
      '**投影长度做不成 CSS 变量。**长度就等于阴影的**层数**，而 CSS 没有循环——层数只能手写或用预处理器生成。所以这一条没有滑杆。这是第三类「参数够不到」：前两类是 SVG 滤镜属性、和无法插值的无类型变量。',
    ],
    notes: [
      '用 CSS 预处理器或 `@property` 打表可以生成这几十层，手写只为演示清楚它的构造。',
      '斜向用 `1px 2px` 这样的比例就能改投影角度，不必都是 45 度。',
      '真正想让它可调，该把颜色或方向做成变量（那两样是能传进 `box-shadow` 的），而不是长度。',
    ],
    _rawRef: 'https://developer.mozilla.org/en-US/docs/Web/CSS/box-shadow',
    _origin: 'crawl',
  },
]
