/**
 * 第 1 批采集草稿：布局为主，兼顾动效 / 图形 / 排版 / 材质。
 *
 * 每条都过同一道硬门槛：跑得起来、记得住出处、说得清机制、写得出边界。
 * `_rawRef` 是出处 URL，会落进不可重建的收件箱；`source` 会写进 md 的 frontmatter。
 *
 * 用法：
 *   node scripts/ingest.mjs drafts/batch-01.mjs --dry-run
 *   node scripts/ingest.mjs drafts/batch-01.mjs
 */

const SINCE = '2026-09'

export default [
  /* ────────────────────────────── 布局 ────────────────────────────── */
  {
    slug: 'auto-fit-grid',
    title: '自动填充网格',
    category: '布局',
    tags: ['网格', '响应式', '无媒体查询'],
    since: SINCE,
    source: '机制来自 CSS Grid 规范的 auto-fit 关键字，自行实现',
    when: '一排卡片要随容器宽度自动增减列数，又不想写一串媒体查询',
    stage: 'grid',
    tier: 'core',
    params: [
      { name: 'min', label: '最小列宽', type: 'range', min: 80, max: 240, step: 10, default: 140, unit: 'px' },
    ],
    description: `列数不用你决定，容器自己算：宽了就多排一列，窄了就少排一列，永远刚好塞满。

机制是 ==repeat(auto-fit, minmax(最小列宽, 1fr))==。浏览器先按最小列宽算出「最多能放几列」，再把剩下的空间用 \`1fr\` 平分给它们。整个过程没有断点、没有媒体查询，也不需要知道容器有多宽。`,
    code: [
      {
        lang: 'html',
        body: `<ul class="af-grid">
  <li>一</li>
  <li>二</li>
  <li>三</li>
  <li>四</li>
  <li>五</li>
</ul>`,
      },
      {
        lang: 'css',
        body: `.af-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(var(--min, 140px), 1fr)); /* @mechanism */
  gap: 10px;
  width: min(620px, 84vw);
  margin: 0;
  padding: 0;
  list-style: none;
}

.af-grid li {
  display: grid;
  place-items: center;
  min-height: 78px;
  border: 1px solid rgb(60 48 30 / 0.35);
  background: rgb(255 255 255 / 0.42);
  font: 500 15px/1 system-ui, sans-serif;
  color: #1c1a17;
}`,
      },
    ],
    caveats: [
      '`auto-fit` 会把空轨道折叠掉，所以**只剩一个子项时它会拉满整行**。想让它保持最小列宽，换 `auto-fill`（保留空轨道）或给子项加 `max-width`。',
      '`minmax()` 里的最小值别用百分比或 `fr`——在自动填充里百分比相对容器计算，会自我放大成无限宽；用固定长度或 `min()`。',
      '子项数量少于算出来的列数时才看得出 `auto-fit` 与 `auto-fill` 的差别，只测「刚好填满」的用例会把两者测成一样。',
    ],
    notes: [
      '`gap` 会参与列宽计算，所以实际列宽不是「容器宽度 ÷ 列数」，而是先扣掉间隙再平分。',
      '不要同时给子项写 `width`：`1fr` 已经把宽度定死了，两者打架时以 `fr` 为准，容易看错。',
    ],
    _rawRef: 'https://developer.mozilla.org/en-US/docs/Web/CSS/repeat',
    _origin: 'crawl',
  },

  {
    slug: 'sticky-stack',
    title: '滚动堆叠卡片',
    category: '布局',
    tags: ['粘性定位', '堆叠', '滚动'],
    since: SINCE,
    source: '机制来自 CSS position: sticky，自行实现',
    when: '几张卡片要一张张钉在顶部，被下一张盖住，像翻一叠牌',
    stage: 'plain',
    tier: 'core',
    params: [
      { name: 'offset', label: '钉住位置', type: 'range', min: 0, max: 60, step: 2, default: 14, unit: 'px' },
    ],
    description: `每张卡片滚到顶部就停在那里不动，下一张继续往上滚，最后把上一张盖住。

机制是 ==position: sticky 配一个滚动容器==。sticky 的元素在「自己和滚动容器之间」的范围内是普通元素，一旦到达 \`top\` 指定的位置就变成钉住，直到容器边界把它推走。卡片一张张钉在同一个位置，自然叠成一摞。`,
    code: [
      {
        lang: 'html',
        body: `<div class="stk">
  <article class="stk-card"><h3>第一张</h3><p>滚到顶部就钉住。</p></article>
  <article class="stk-card"><h3>第二张</h3><p>它会把上一张盖住。</p></article>
  <article class="stk-card"><h3>第三张</h3><p>以此类推。</p></article>
  <article class="stk-card"><h3>第四张</h3><p>到底为止。</p></article>
</div>`,
      },
      {
        lang: 'css',
        body: `.stk {
  width: min(460px, 84vw);
  height: min(330px, 56vh);
  overflow-y: auto;
  border: 1px solid rgb(60 48 30 / 0.3);
  background: rgb(255 255 255 / 0.3);
  scroll-behavior: smooth;
}

.stk-card {
  position: sticky;              /* @mechanism 每张都钉在同一个位置 */
  top: var(--offset, 14px);
  min-height: 168px;
  margin: 0 0 10px;
  padding: 16px 18px;
  border: 1px solid rgb(60 48 30 / 0.32);
  background: #efe9dd;
  box-shadow: 0 10px 24px rgb(40 30 14 / 0.18);
  font: 400 14px/1.6 system-ui, sans-serif;
  color: #1c1a17;
}

.stk-card h3 {
  margin: 0 0 6px;
  font: 600 17px/1.3 system-ui, sans-serif;
}

.stk-card p {
  margin: 0;
  opacity: 0.72;
}`,
      },
    ],
    caveats: [
      '**必须有一个真正能滚的祖先。**页面本身不滚（或容器没设高度、`overflow` 是 visible）时，sticky 一点效果都没有——现象是「完全没反应」，不报错，最难查。',
      '祖先只要带了 `overflow: hidden`、`overflow: clip` 或 `overflow: auto`，sticky 就被限制在那个祖先里活动。这个经典坑通常来自外层某个「顺手加的」`overflow: hidden`。',
      '让每张露出一点的做法是让 `top` 递增（第一章 0、第二章 12px……），全都写同一个值才是完全盖住。',
      '卡片高度为 0 或没有内容时钉不住——sticky 是相对元素盒子生效的。',
    ],
    notes: [
      '柱状图之外，同一个容器里 `position: sticky` 的层叠顺序按 DOM 顺序，后面的盖住前面的；要改顺序得动 `z-index`，别动 DOM。',
      '`scroll-behavior: smooth` 只影响程序化滚动（锚点跳转），不会让用户的手动滚变顺滑。',
    ],
    _rawRef: 'https://developer.mozilla.org/en-US/docs/Web/CSS/position',
    _origin: 'crawl',
  },

  {
    slug: 'container-card',
    title: '按自身宽度换布局',
    category: '布局',
    tags: ['容器查询', '组件', '自适应'],
    since: SINCE,
    source: '机制来自 CSS Containment 规范的容器查询，自行实现',
    when: '同一个卡片组件，放在窄侧栏要竖排、放在宽主区要横排',
    stage: 'grid',
    tier: 'core',
    params: [
      { name: 'width', label: '容器宽度', type: 'range', min: 200, max: 620, step: 10, default: 560, unit: 'px' },
    ],
    description: `拖动宽度滑杆，卡片会在竖排和横排之间翻一次——而它自己并不知道窗口有多大。

机制是 ==container-type: inline-size 配 @container 查询==。父元素声明自己是「查询容器」，子元素就可以用 \`@container (min-width: …)\` 问「我有多宽」，而不是问「窗口有多宽」。组件从此不关心自己被放在哪里。

这是媒体查询做不到的事：同一页面上，侧栏里的卡片竖排、主区里的卡片横排，两者用的是同一份 CSS。`,
    code: [
      {
        lang: 'html',
        body: `<div class="cq-wrap">
  <div class="cq-card">
    <span class="cq-badge">图</span>
    <div class="cq-body">
      <h3>容器查询卡片</h3>
      <p>容器够宽时，图和文字并排；不够宽时，自动改成上下堆叠。</p>
    </div>
  </div>
</div>`,
      },
      {
        lang: 'css',
        body: `.cq-wrap {
  container-type: inline-size; /* @mechanism 声明自己是查询容器 */
  width: min(var(--width, 560px), 84vw);
  padding: 12px;
  border: 1px dashed rgb(60 48 30 / 0.45);
  background: rgb(255 255 255 / 0.3);
}

.cq-card {
  display: grid;
  gap: 14px;
  padding: 16px;
  border: 1px solid rgb(60 48 30 / 0.3);
  background: #efe9dd;
  font: 400 14px/1.6 system-ui, sans-serif;
  color: #1c1a17;
}

.cq-badge {
  display: grid;
  place-items: center;
  width: 56px;
  height: 56px;
  background: #b4462f;
  color: #f7f1e6;
  font: 600 15px/1 system-ui, sans-serif;
}

.cq-body h3 {
  margin: 0 0 4px;
  font: 600 17px/1.3 system-ui, sans-serif;
}

.cq-body p {
  margin: 0;
  opacity: 0.72;
}

@container (min-width: 380px) {
  .cq-card {
    grid-template-columns: 56px 1fr;
    align-items: center;
  }
}`,
      },
    ],
    caveats: [
      '`container-type: size`（两个轴）会让元素**长宽都不再由内容决定**，没给显式高度就塌成 0——「加了容器查询我的 div 消失了」几乎都是这个。只想查宽度就用 `inline-size`。',
      '`@container` 找的是**最近的**有 `container-type` 的祖先。一个都没有时查询不匹配，且**不报错**，只是样式不生效。',
      '给元素加 `container-type` 会同时让它成为包含块（类似 `position: relative` 的作用），里面原本相对页面的 `position: fixed` 会改成相对它定位。',
      '容器查询查的是**内容盒**宽度，`padding` 与 `border` 不算在内，所以断点值要比设计稿上看到的小一圈。',
    ],
    notes: [
      '命名容器（`container-name`）在有嵌套容器时很有用，能把「问哪一层」写明确。',
      '容器查询单位（`cqw` / `cqi`）可以拿来直接写字号，配合 `clamp()` 就是随组件缩放的排版。',
    ],
    _rawRef: 'https://developer.mozilla.org/en-US/docs/Web/CSS/CSS_containment/Container_queries',
    _origin: 'crawl',
  },

  {
    slug: 'subgrid-form',
    title: '子网格对齐',
    category: '布局',
    tags: ['subgrid', '对齐', '表单'],
    since: SINCE,
    source: '机制来自 CSS Grid 规范的 subgrid 关键字，自行实现',
    when: '多行表单的标签宽度要互相对齐，但每行又是独立的一块',
    stage: 'plain',
    tier: 'candidate',
    params: [
      { name: 'gap', label: '列间距', type: 'range', min: 6, max: 40, step: 2, default: 18, unit: 'px' },
    ],
    description: `每一行在自己的标签列里宽度不同，但所有行的标签右边缘恰好对齐在同一条线上。

机制是 ==grid-template-columns: subgrid==。父级定义好轨道，每行声明自己要继承父级的这些轨道，于是宽度不再由各行自己决定，而是回到父级统一算。用嵌套 grid 做不出这个效果——那样每行各算各的。`,
    code: [
      {
        lang: 'html',
        body: `<div class="sg">
  <div class="sg-row"><label>名称</label><span>咒语书</span></div>
  <div class="sg-row"><label>用途说明</label><span>前端效果速查</span></div>
  <div class="sg-row"><label>收录条数</label><span>持续增加</span></div>
  <div class="sg-row"><label>甲</label><span>最窄的标签也在同一条准线上</span></div>
</div>`,
      },
      {
        lang: 'css',
        body: `.sg {
  display: grid;
  grid-template-columns: auto 1fr; /* 父级定轨道 @mechanism */
  gap: 10px var(--gap, 18px);
  width: min(520px, 84vw);
  padding: 16px 18px;
  border: 1px solid rgb(60 48 30 / 0.3);
  background: rgb(255 255 255 / 0.34);
  font: 400 14px/1.6 system-ui, sans-serif;
  color: #1c1a17;
}

.sg-row {
  display: grid;
  grid-template-columns: subgrid; /* @mechanism 继承父级轨道 */
  grid-column: 1 / -1;
}

.sg-row label {
  opacity: 0.62;
}

.sg-row span {
  font-weight: 500;
}`,
      },
    ],
    caveats: [
      '父级的轨道必须是**显式**的。`repeat(auto-fit, …)` 或 `min-content` 这类动态轨道没有可继承的固定线，subgrid 会失效。',
      '子网格元素必须横跨父级全部列（`grid-column: 1 / -1`），否则它继承到的轨道是被截断的，对不齐也看不出原因。',
      'Safari 16 之前、Chrome 117 之前的版本不支持，退化后子网格不会继承，行内容会全部挤进第一列——不是错位，是整块塌掉，所以要配 `@supports` 兜底。',
    ],
    notes: [
      '`subgrid` 同样可以继承行轨道（`grid-template-rows: subgrid`），做「多列等高且行与行对齐」的卡片列表时比手算高度可靠。',
      '它不是万能的对齐方案：真正需要的只是「标签右对齐」时，`grid-template-columns: max-content 1fr` 一层就够了，不用 subgrid。',
    ],
    _rawRef: 'https://developer.mozilla.org/en-US/docs/Web/CSS/CSS_grid_layout/Subgrid',
    _origin: 'crawl',
  },

  {
    slug: 'snap-carousel',
    title: '吸附轮播',
    category: '布局',
    tags: ['滚动吸附', '横向滚动', '轮播'],
    since: SINCE,
    source: '机制来自 CSS Scroll Snap 规范，自行实现',
    when: '横向滑动一排卡片，松手后要自己停在整张上，不要停在两张之间',
    stage: 'grid',
    tier: 'core',
    params: [
      { name: 'item', label: '卡片宽度', type: 'range', min: 40, max: 90, step: 2, default: 68, unit: '%' },
    ],
    description: `手指松开后，卡片自己往最近的整张上吸一下，停在恰好对齐的位置。

机制是 ==滚动容器声明 scroll-snap-type，子项声明 scroll-snap-align==。吸附由浏览器在滚动结束时完成，没有 JS、不监听 \`scroll\`、不计算偏移量。滑起来还保留原生滚动的惯性手感——这是用 transform 手写轮播永远做不出来的。`,
    code: [
      {
        lang: 'html',
        body: `<div class="snap">
  <article class="snap-card"><b>一</b><span>松手吸住</span></article>
  <article class="snap-card"><b>二</b><span>停在整张</span></article>
  <article class="snap-card"><b>三</b><span>惯性还在</span></article>
  <article class="snap-card"><b>四</b><span>没有 JS</span></article>
</div>`,
      },
      {
        lang: 'css',
        body: `.snap {
  display: flex;
  gap: 10px;
  width: min(560px, 84vw);
  overflow-x: auto;
  scroll-snap-type: x mandatory; /* @mechanism 吸附发生在滚动容器上 */
  overscroll-behavior-x: contain;
  padding: 12px;
  border: 1px solid rgb(60 48 30 / 0.3);
  background: rgb(255 255 255 / 0.3);
}

.snap-card {
  flex: 0 0 var(--item, 68%);
  scroll-snap-align: center; /* @mechanism 吸附位置写在子项上 */
  display: grid;
  align-content: center;
  justify-items: center;
  gap: 6px;
  height: 180px;
  border: 1px solid rgb(60 48 30 / 0.32);
  background: #efe9dd;
  font: 400 14px/1.5 system-ui, sans-serif;
  color: #1c1a17;
}

.snap-card b {
  font: 600 26px/1 system-ui, sans-serif;
}`,
      },
    ],
    caveats: [
      '`mandatory` 会强制每次滚动都吸附，滚轮或触控板精细滚动时会被「抢走」——内容比容器窄或需要停在中间位置时改用 `proximity`。',
      '要配 `overscroll-behavior-x: contain`，否则滑到头会触发浏览器的后退手势，整页跳走。',
      '`scroll-snap-type` 必须写在**滚动容器**上、`scroll-snap-align` 写在**子项**上。写反了整条规则静默失效。',
      '子项上的 `scroll-snap-stop: always` 才能防止一次滑动跳过好几张，默认是允许跳过的。',
    ],
    notes: [
      '`scroll-padding` 能控制吸附时留出的内边距，做「卡片左边缘对齐」比给子项加 margin 干净。',
      '整块滚动的动画不需要 `scroll-behavior: smooth`——那是给程序化滚动用的，手指滑动本来就带惯性。',
    ],
    _rawRef: 'https://developer.mozilla.org/en-US/docs/Web/CSS/CSS_scroll_snap',
    _origin: 'crawl',
  },

  /* ────────────────────────────── 动效 ────────────────────────────── */
  {
    slug: 'neg-delay-wave',
    title: '负延迟造波',
    category: '动效',
    tags: ['动画延迟', '相位', '交错'],
    since: SINCE,
    source: '机制取自 SpinKit（MIT）的 sk-wave，自行实现',
    when: '一排元素要依次动起来，形成波浪，但只想写一套关键帧',
    stage: 'plain',
    tier: 'core',
    params: [
      { name: 'dur', label: '一个周期', type: 'range', min: 0.4, max: 3, step: 0.1, default: 1.1, unit: 's' },
    ],
    description: `五根柱子依次起伏，走过去像一道波。但整段关键帧只有一份。

机制是 ==把 animation-delay 写成负数==。负延迟不是「等一会儿再开始」，而是「这段动画假装已经跑了这么久」——于是每个元素都从同一套关键帧的不同位置上开始，彼此错开相位。用正延迟的话第一轮会先集体静止等待，看起来像卡住了。`,
    code: [
      {
        lang: 'html',
        body: `<div class="nd">
  <span></span>
  <span></span>
  <span></span>
  <span></span>
  <span></span>
</div>`,
      },
      {
        lang: 'css',
        body: `.nd {
  display: flex;
  align-items: center;
  gap: 7px;
  height: 84px;
}

.nd span {
  width: 11px;
  height: 100%;
  background: #b4462f;
  transform-origin: center;
  animation: nd-wave var(--dur, 1.1s) ease-in-out infinite; /* @mechanism 一套关键帧 */
}

/* @mechanism 负数延迟 = 相位偏移，不用拆成五套关键帧 */
.nd span:nth-child(1) { animation-delay: calc(var(--dur, 1.1s) * -0.00); }
.nd span:nth-child(2) { animation-delay: calc(var(--dur, 1.1s) * -0.12); }
.nd span:nth-child(3) { animation-delay: calc(var(--dur, 1.1s) * -0.24); }
.nd span:nth-child(4) { animation-delay: calc(var(--dur, 1.1s) * -0.36); }
.nd span:nth-child(5) { animation-delay: calc(var(--dur, 1.1s) * -0.48); }

@keyframes nd-wave {
  0%,
  40%,
  100% {
    transform: scaleY(0.35);
  }
  20% {
    transform: scaleY(1);
  }
}`,
      },
    ],
    caveats: [
      '负延迟只有在**循环闭合**的关键帧上才成立。首尾不一致时，起点会跳一下——因为这个「已经跑了一半」的动画和真正从头开始的动画对不上。',
      '把延迟写成正数是这里最常见的误用：第一轮五个元素会先一起静止不动，等各自的延迟走完才动，看起来像加载卡住。',
      '负延迟不能让元素定格。要停在某个状态就用 `animation-play-state: paused` 或 `animation-fill-mode: both`，别靠调延迟硬凑。',
      '元素必须真的在动才有相位可言；`display: inline` 的元素上 `transform` 不生效，会表现成「延迟没起作用」。',
    ],
    notes: [
      '这套机制与「旋转的容器里再放一圈脉冲点」叠加起来，就是常见的环形加载器——同一招用两次，代价还是零 JS。',
      '错开量取周期的十分之一到九分之一时最像波；超过一半就看不出是一个整体了。',
    ],
    _rawRef: 'https://github.com/tobiasahlin/SpinKit',
    _origin: 'crawl',
  },

  {
    slug: 'fold-plane',
    title: '单元素翻折',
    category: '动效',
    tags: ['3D', '透视', '变换'],
    since: SINCE,
    source: '机制取自 SpinKit（MIT）的 sk-plane，自行实现',
    when: '一个方块要有真实的翻折立体感，但不想加容器、不想加 JS'
    ,
    stage: 'grid',
    tier: 'candidate',
    params: [
      { name: 'dur', label: '一个周期', type: 'range', min: 0.6, max: 3, step: 0.1, default: 1.4, unit: 's' },
      { name: 'depth', label: '透视距离', type: 'range', min: 80, max: 900, step: 20, default: 260, unit: 'px' },
    ],
    description: `一个方块像纸片一样绕自己的轴翻过来，中间有一瞬几乎看不见。

机制是 ==把 perspective() 直接写进 transform==。透视距离越短，近处放大得越夸张，翻折感越强。不写它、只写 \`rotateY\` 的话，得到的是一个横向被压扁的平行四边形，看起来像「缩窄」而不是「翻面」。`,
    code: [
      {
        lang: 'html',
        body: `<div class="fp"></div>`,
      },
      {
        lang: 'css',
        body: `.fp {
  width: 96px;
  height: 96px;
  background: #b4462f;
  animation: fp-fold var(--dur, 1.4s) ease-in-out infinite; /* @mechanism */
}

@keyframes fp-fold {
  0% {
    transform: perspective(var(--depth, 260px)) rotateX(0deg) rotateY(0deg);
  }
  50% {
    transform: perspective(var(--depth, 260px)) rotateX(-180deg) rotateY(0deg);
  }
  100% {
    transform: perspective(var(--depth, 260px)) rotateX(-180deg) rotateY(-180deg);
  }
}`,
      },
    ],
    caveats: [
      '`perspective()` 写在 `transform` 列表里时**必须放在最前面**，否则后面的变换已经在平面里算完了，透视不起作用。',
      '翻到 90° 时投影宽度归零，会短暂「消失」一瞬。这是几何必然，不是渲染问题——嫌太突兀就在关键帧里避开 90°，或让前后两段不同步。',
      '`perspective` 属性（写在祖先上）与 `perspective()` 函数（写在元素上）语义不同：前者共享一个消失点，后者各算各的。一个元素要显得在空间里，两个相邻元素必须用属性版。',
      '`backface-visibility` 默认是可见的，所以翻过背面时看到的是镜像的正面。要么接受它，要么设成 `hidden` 让背面透明。',
    ],
    notes: [
      '把 `duration` 调长、`ease-in-out` 换掉，翻折的性格会完全变——同样的关键帧能做出很不一样的东西。',
      '加 `-webkit-` 前缀已经没必要了：现代浏览器都原生支持 3D 变换。',
    ],
    _rawRef: 'https://github.com/tobiasahlin/SpinKit',
    _origin: 'crawl',
  },

  {
    slug: 'scroll-progress',
    title: '滚动驱动进度条',
    category: '动效',
    tags: ['滚动驱动', '时间线', '进度'],
    since: SINCE,
    source: '机制来自 CSS Scroll-driven Animations 规范，自行实现',
    when: '一条进度条要跟着滚动位置长出来，但不想监听 scroll 事件',
    stage: 'dark',
    tier: 'candidate',
    params: [
      { name: 'thick', label: '条粗', type: 'range', min: 2, max: 16, step: 1, default: 5, unit: 'px' },
    ],
    description: `往下滚，顶上的条跟着变长，滚到底正好走满一整条。

机制是 ==animation-timeline: scroll()==。动画的进度不再由时间驱动，而是由滚动位置驱动：滚到 0% 就是关键帧的 0%，滚到底就是 100%。没有 \`scroll\` 事件、没有 \`requestAnimationFrame\`，浏览器在合成器上直接算——所以滚动时不会掉帧。`,
    code: [
      {
        lang: 'html',
        body: `<div class="sp">
  <i class="sp-bar"></i>
  <div class="sp-body">
    <p>往下滚，顶部的条会长出来。</p>
    <p>它的长度就是滚动进度。</p>
    <p>整段没有任何 JavaScript。</p>
    <p>也没有监听 scroll 事件。</p>
    <p>滚到底，条正好走满。</p>
    <p>再滚回去，它会退回去。</p>
    <p>——到这里就到底了。</p>
  </div>
</div>`,
      },
      {
        lang: 'css',
        body: `.sp {
  position: relative;
  width: min(460px, 84vw);
  height: min(320px, 54vh);
  overflow-y: auto;
  border: 1px solid rgb(255 255 255 / 0.18);
  background: rgb(0 0 0 / 0.28);
  font: 400 15px/1.7 system-ui, sans-serif;
  color: #f0ead9;
}

.sp-bar {
  position: sticky;
  top: 0;
  display: block;
  height: var(--thick, 5px);
  background: #b4462f;
  transform-origin: left center;
  animation: sp-grow linear both;    /* @mechanism 由滚动位置驱动 */
  animation-timeline: scroll(nearest);
}

.sp-body {
  padding: 18px 20px 24px;
}

.sp-body p {
  margin: 0 0 14px;
}

@keyframes sp-grow {
  from {
    transform: scaleX(0);
  }
  to {
    transform: scaleX(1);
  }
}`,
      },
    ],
    caveats: [
      '**Safari 与 Firefox 目前还不支持**（Chromium 115+ 才有）。不支持的浏览器会把它当成普通动画：时长缺省、时间线不成立，结果是条静止不动——不报错，所以线上很难发现。上线前要包一层 `@supports (animation-timeline: scroll())`。',
      '`scroll(nearest)` 找的是最近的**可滚动祖先**。条必须在滚动容器内部（这里靠 `position: sticky` 留在顶部），放到容器外面时间线永远是 0。',
      '进度用 `transform: scaleX()` 而不是 `width`。`width` 每帧都要重排，滚动时正好是最不能重排的时候。',
      '`animation-duration` 必须写成 `auto` 或不写——写了具体秒数就不再是滚动驱动了，那是回退行为。',
    ],
    notes: [
      '`scroll(root)` 查的是整个页面，`scroll(self)` 查元素自己滚动。写错时现象都是「进度一直是 0」。',
      '同一套时间线也能驱动 `opacity`，做「滚到才淡入」的入场也用它，比 IntersectionObserver 省一半代码。',
    ],
    _rawRef: 'https://developer.mozilla.org/en-US/docs/Web/CSS/animation-timeline',
    _origin: 'crawl',
  },

  /* ────────────────────────────── 图形 ────────────────────────────── */
  {
    slug: 'conic-ring',
    title: '锥形渐变环',
    category: '图形',
    tags: ['锥形渐变', '遮罩', '环'],
    since: SINCE,
    source: '机制来自 CSS conic-gradient 与 mask，自行实现',
    when: '要一个多色渐变的圆环，但不想用 SVG、不想切图',
    stage: 'dark',
    tier: 'core',
    params: [
      { name: 'hole', label: '中空比例', type: 'range', min: 20, max: 88, step: 2, default: 62, unit: '%' },
    ],
    description: `一圈颜色绕着中心均匀转过去，中间是空的。

机制是 ==conic-gradient 画满圆盘，再用 mask 挖掉圆心==。\`conic-gradient\` 的色标按**角度**分布，不是按距离——所以它天然是绕圈的，\`linear-gradient\` 无论怎么转都做不出这个。\`border-radius: 50%\` 只裁外轮廓，不挖中间，所以必须靠 \`mask\` 把圆心透出来。`,
    code: [
      {
        lang: 'html',
        body: `<div class="cr"></div>`,
      },
      {
        lang: 'css',
        body: `.cr {
  width: 150px;
  aspect-ratio: 1;
  border-radius: 50%;
  /* @mechanism 色标按角度绕圈分布 */
  background: conic-gradient(from 210deg, #b4462f, #d9a441, #14b8a6, #7c5cff, #b4462f);
  /* @mechanism mask 挖空圆心，做出环 */
  mask: radial-gradient(circle at 50% 50%, transparent var(--hole, 62%), #000 calc(var(--hole, 62%) + 1%));
}`,
      },
    ],
    caveats: [
      '`mask` 在部分浏览器上仍需要 `-webkit-mask` 前缀；只写标准属性时，旧版 Safari 会退化成一个实心彩色圆盘。',
      '`radial-gradient` 的两个色标要留一点点差值（这里用了 `+1%`）。写成同一个值会让边缘出现锯齿，因为抗锯齿需要至少一个像素的过渡带。',
      '`conic-gradient` 是从 12 点方向、顺时针开始的。`from` 只在需要把某个色标对齐到特定方向时才写，不写默认从顶部起。',
      '在两个色标之间直接跳到下一个颜色会出现硬边。想要柔和的过渡，两个色标之间必须留出一段距离让浏览器插值。',
    ],
    notes: [
      '`aspect-ratio: 1` 换来正方形，比同时写 `width` 和 `height` 更好改——只动一个值就能缩放整环。',
      '同一个 `conic-gradient` 配 `@property` 声明角度、再动画 `from` 的角度，就能让环转起来；不声明 `@property` 的话角度是离散的，动画会突兀地跳。',
    ],
    _rawRef: 'https://developer.mozilla.org/en-US/docs/Web/CSS/gradient/conic-gradient',
    _origin: 'crawl',
  },

  {
    slug: 'turbulence-grain',
    title: '滤镜噪点质感',
    category: '图形',
    tags: ['噪点', '滤镜', '质感', '颗粒'],
    since: SINCE,
    source: '机制来自 SVG feTurbulence 滤镜，自行实现',
    when: '要一层颗粒感把过于干净的色块压旧一点，但不想引入任何图片文件',
    stage: 'photo',
    tier: 'core',
    params: [
      { name: 'amount', label: '颗粒强度', type: 'range', min: 0, max: 100, step: 5, default: 45, unit: '%' },
      // 不提供「颗粒细度」滑杆：baseFrequency 是 SVG 属性，CSS 变量够不到它。
      // 摆一个拖了没反应的滑杆，比没有滑杆更糟。
    ],
    description: `一层细密的颗粒铺在色块上，把数字味的纯净压成有质感的表面。

机制是 ==SVG 的 feTurbulence 滤镜==。它在浏览器里现算分形噪声，不需要任何图片文件——一个 \`<svg>\` 写进 HTML 就够了。配 \`mix-blend-mode: overlay\` 后，颗粒只在明暗交界处显现，暗部和不亮的地方几乎不动，所以看起来像材质而不是脏点。`,
    code: [
      {
        lang: 'html',
        body: `<div class="gr">
  <svg class="gr-noise" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
    <filter id="gr-filter">
      <feTurbulence type="fractalNoise" baseFrequency="0.85" numOctaves="3" />
    </filter>
    <rect width="100%" height="100%" filter="url(#gr-filter)" />
  </svg>
</div>`,
      },
      {
        lang: 'css',
        body: `.gr {
  position: relative;
  width: min(300px, 70vw);
  aspect-ratio: 3 / 2;
  overflow: hidden;
  background: linear-gradient(135deg, #b4462f 0%, #6b3550 55%, #2a2440 100%);
}

.gr-noise {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  opacity: var(--amount, 45%); /* @mechanism 颗粒强度就是这一层的透明度 */
  mix-blend-mode: overlay;
  filter: contrast(140%);
}`,
      },
    ],
    caveats: [
      '`feTurbulence` 是**每次需要重绘时现算**的。铺满整个视口、又叠在会动的元素上时，GPU 会明显吃紧；做法是把它平铺成一张小尺寸的背景（`background-repeat`）而不是拉伸到全屏。',
      '滤镜的 `id` 是**全局**的。同一个页面里出现两个 `id="gr-filter"` 会互相抢，第二个会拿到第一个的滤镜——从组件里搬出来时要给 id 加前缀。',
      '`mix-blend-mode: overlay` 需要底图本身有明暗对比。铺在纯白或纯中灰上几乎什么都看不见，会让人误以为没生效。',
      '颗粒放大会露出方块感。`baseFrequency` 越小颗粒越大，超过 0.5 左右就已经能看出像素格子。',
      '`baseFrequency` 是写死在 SVG 属性里的，CSS 变量管不到它——想让它可调，只能用 JS 写属性，或者准备几档滤镜切换。',
    ],
    notes: [
      '把 `opacity` 控制在 30%–50% 之间最像胶片颗粒；超过 60% 就成了电视雪花，不再是质感。',
      '`numOctaves` 加大会让噪声更细但更慢。3 是质感和性能的平衡点，4 以上收益很小。',
      '同一招也能给纯色背景加「纸纹」：把 `overlay` 换成 `multiply`，颗粒会往下压暗，更像旧纸。',
    ],
    _rawRef: 'https://developer.mozilla.org/en-US/docs/Web/SVG/Element/feTurbulence',
    _origin: 'crawl',
  },

  /* ────────────────────────────── 排版 ────────────────────────────── */
  {
    slug: 'fluid-clamp',
    title: '流式字号',
    category: '排版',
    tags: ['clamp', '流式', '响应式'],
    since: SINCE,
    source: '机制来自 CSS clamp() 函数，自行实现',
    when: '标题要随屏幕连续变大变小，而不是在断点处跳一下',
    stage: 'plain',
    tier: 'core',
    params: [
      { name: 'min', label: '最小字号', type: 'range', min: 14, max: 40, step: 1, default: 22, unit: 'px' },
      { name: 'max', label: '最大字号', type: 'range', min: 32, max: 110, step: 2, default: 68, unit: 'px' },
    ],
    description: `字号跟着窗口宽度连续长，到上下限就停住，中间没有任何断点。

机制是 ==clamp(下限, 视口相对值, 上限)==。中间项必须是一个随视口变化的量（\`vw\`、\`vi\`、\`cqi\` 都行），它决定变化的速度；两端的常量只在越界时兜底。三个值缺一不可：去掉 \`vw\` 项就退化成固定字号，去掉上下限就会在大屏上失控。`,
    code: [
      {
        lang: 'html',
        body: `<p class="fl">咒语书</p>`,
      },
      {
        lang: 'css',
        body: `.fl {
  margin: 0;
  /* @mechanism 中间项是视口相对值，决定变化速度 */
  font-size: clamp(var(--min, 22px), 4.6vw + 0.4rem, var(--max, 68px));
  font-weight: 600;
  line-height: 1.05;
  letter-spacing: -0.02em;
  color: #1c1a17;
}`,
      },
    ],
    caveats: [
      '中间项写成固定值（`clamp(22px, 40px, 68px)`）就完全失去意义了——它永远是 40px，看起来「没生效」。',
      '中间项一开始就超过上限时，字号立刻封顶、曲线是平的，会让人以为 `vw` 系数写小了。用两三条不同窗口宽度实测才知道真实曲线。',
      '用 `vw` 时移动端地址栏伸缩会改变视口宽度，字号跟着跳。要稳就换成 `cqi` 配容器查询——那样它跟的是容器而不是窗口。',
      '两条曲线的拐点（比如 `4vw + 1rem`）写不好会出现「小屏变大屏反而字号减小」的倒挂，改系数时要按实际尺寸算一遍。',
    ],
    notes: [
      '`rem` 与 `vw` 混用是为了尊重用户的根字号设置：纯 `vw` 会无视无障碍放大的需求。',
      '给标题用 `line-height: 1.05`、`letter-spacing` 收一点负值，大字号下才不会显得松散——字号越大，默认行距和字距越显得空。',
    ],
    _rawRef: 'https://developer.mozilla.org/en-US/docs/Web/CSS/clamp',
    _origin: 'crawl',
  },

  {
    slug: 'text-wrap-balance',
    title: '平衡换行',
    category: '排版',
    tags: ['换行', '标题', 'text-wrap'],
    since: SINCE,
    source: '机制来自 CSS Text 规范的 text-wrap，自行实现',
    when: '短标题换行后末行只剩一两个字，看着别扭',
    stage: 'plain',
    tier: 'core',
    params: [
      { name: 'width', label: '文字宽度', type: 'range', min: 180, max: 520, step: 10, default: 340, unit: 'px' },
    ],
    description: `两行的标题，两行长度差不多——不再是第一行满满当当、第二行孤零零两三个字。

机制是 ==text-wrap: balance==。浏览器在排版时反过来调整断行位置，让各行的长度尽量接近。这跟 \`pretty\` 不是一回事：\`pretty\` 只管把最后一行从孤字救回来，\`balance\` 是让整段均匀。`,
    code: [
      {
        lang: 'html',
        body: `<h3 class="tw">一条咒语要同时说清它靠什么成立、又什么时候不管用</h3>`,
      },
      {
        lang: 'css',
        body: `.tw {
  width: min(var(--width, 340px), 84vw);
  margin: 0;
  text-wrap: balance; /* @mechanism 反推断行位置，让各行等长 */
  font: 600 25px/1.28 system-ui, sans-serif;
  color: #1c1a17;
}`,
      },
    ],
    caveats: [
      '`balance` **只对短文本有效**。浏览器为了性能限制了行数（Chromium 是 6 行左右，且逐块递减），超出的部分直接忽略——效果「时有时无」就是这个原因，不是 CSS 写错了。',
      '正文段落不该用它。长段落要的是「避免最后一行孤单」，那是 `text-wrap: pretty`；用 `balance` 会把整段的行长掐齐，读起来反而更累。',
      '它会让元素高度变化，因此放在 flex 或 grid 布局里可能引发布局抖动；已知高度依赖的地方要留意。',
      '对已经手动断行的文本（含 `<br>`）无效——手动断行优先级更高。',
    ],
    notes: [
      '现在三个引擎都支持了，但降级行为是「静默不生效」，不需要 `@supports` 兜底，也不会破版。',
      '它和 `max-width` 是搭档：先限制行长到易读的范围内，再让 `balance` 分配这两三行。',
    ],
    _rawRef: 'https://developer.mozilla.org/en-US/docs/Web/CSS/text-wrap',
    _origin: 'crawl',
  },

  /* ────────────────────────────── 材质 ────────────────────────────── */
  {
    slug: 'mesh-gradient',
    title: '网格渐变',
    category: '材质',
    tags: ['渐变', '径向', '背景'],
    since: SINCE,
    source: '机制来自 CSS 多重背景叠加，自行实现',
    when: '要一块柔和流动的彩色底，但不想用图片、也不想上 WebGL',
    stage: 'plain',
    tier: 'core',
    params: [
      { name: 'soft', label: '柔和度', type: 'range', min: 30, max: 90, step: 5, default: 62, unit: '%' },
    ],
    description: `几团颜色在角落互相晕开，边界全化掉了，像颜料在湿纸上渗。

机制是 ==多个 radial-gradient 叠在一层背景里，每个都用 transparent 收边==。单层径向渐变只能做一个光斑；叠三层、各自定在不同位置，颜色在重叠区互相加强，就出现了只有「网格渐变」工具才做得出的那种过渡。整件事没有图片，也没有滤镜。`,
    code: [
      {
        lang: 'html',
        body: `<div class="mg"></div>`,
      },
      {
        lang: 'css',
        body: `.mg {
  width: min(340px, 74vw);
  aspect-ratio: 4 / 3;
  /* @mechanism 多层径向渐变叠加；每层都必须收成 transparent，否则露出硬边圆 */
  background-color: #241a3d;
  background-image:
    radial-gradient(circle at 20% 24%, #ff9a5a 0%, transparent var(--soft, 62%)),
    radial-gradient(circle at 80% 30%, #7c5cff 0%, transparent var(--soft, 62%)),
    radial-gradient(circle at 58% 88%, #14b8a6 0%, transparent var(--soft, 62%));
}`,
      },
    ],
    caveats: [
      '每一层都必须收到 `transparent`。写成具体颜色的话，会看到三个边缘锐利的圆盘叠在一起——那是「三个圆」不是「网格渐变」。',
      '层数多又铺满整个视口时，滚动会明显掉帧：多层大面积渐变在某些浏览器上会反复光栅化。固定尺寸的卡片没事，全屏背景要压层数或加 `will-change` 谨慎试探。',
      '它是**叠出来的静态图**，没法用 `transition` 直接过渡。CSS 不能在两个渐变之间插值——要动只能整体位移、缩放或改透明度，或者用 `@property` 把颜色拆成可插值的变量。',
      '色相跨度过大时中间会出现灰带（互补色调和的结果）。三个颜色选相近色相、或者接受那个灰调。',
    ],
    notes: [
      '`background-color` 是兜底底色，要选三层里最深的那支，这样收边处不会透出白底。',
      '加一层极淡的噪点再叠上去，能压掉渐变算法带来的色带（banding）——那种一条条的同心纹在深色大面积上尤其明显。',
    ],
    _rawRef: 'https://developer.mozilla.org/en-US/docs/Web/CSS/gradient/radial-gradient',
    _origin: 'crawl',
  },
]
