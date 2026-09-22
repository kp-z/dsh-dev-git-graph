/**
 * 第 8 批采集草稿：图形为主，动效与交互补位。
 *
 * 图形这一批的共同点是「绘制与布局是两件事」——clip-path / mask / shape-outside
 * 各管一段，改变的都是画出来的样子，不是盒子占的位置。
 *
 * 用法：
 *   node scripts/prepare-draft.mjs drafts/batch-08.mjs
 *   node scripts/ingest.mjs drafts/batch-08.mjs --dry-run
 *   node scripts/ingest.mjs drafts/batch-08.mjs
 */

const SINCE = '2026-09'

export default [
  /* ────────────────────────────── 图形 ────────────────────────────── */
  {
    slug: 'svg-stroke-draw',
    title: '把线画出来',
    category: '图形',
    tags: ['描边', '虚线', '路径'],
    since: SINCE,
    source: '机制来自 SVG 的 stroke-dasharray / stroke-dashoffset，自行实现',
    when: '图标或下划线要像被一笔画出来，而不是直接出现',
    stage: 'dark',
    tier: 'core',
    params: [
      { name: 'dur', label: '画完用时', type: 'range', min: 0.5, max: 6, step: 0.5, default: 2.4, unit: 's' },
    ],
    description: `一个圆圈被一笔一笔画出来，画完就停住。

机制是 ==stroke-dasharray 设成路径总长、stroke-dashoffset 从总长动到 0，线就像被画出来==。虚线长度等于周长时，整条路径被表示成「一段实线 + 一段等长的空隙」；偏移量等于周长时实线段被推到看不见的地方。把偏移量推到 0，实线段就沿路径铺开。

它不改变路径的形状，只改变**从哪一段开始可见**。`,
    code: [
      {
        lang: 'html',
        body: `<svg class="sd" viewBox="0 0 120 120" aria-label="被画出来的圆">
  <circle class="sd-track" cx="60" cy="60" r="50" />
  <circle class="sd-line" cx="60" cy="60" r="50" />
</svg>`,
      },
      {
        lang: 'css',
        body: `.sd {
  width: 150px;
  height: 150px;
  fill: none;
  stroke-linecap: round;
}

.sd-track {
  stroke: rgb(240 234 217 / 0.14);
  stroke-width: 6;
}

.sd-line {
  stroke: #b4462f;
  stroke-width: 6;
  /* 半径 50 的周长约 314 */
  /* @mechanism 虚线长度 = 路径总长，于是只有一段实线 */
  stroke-dasharray: 314;
  /* @mechanism 偏移等于总长时实线被推出视野 */
  stroke-dashoffset: 314;
  animation: sd-draw var(--dur, 2.4s) ease-in-out infinite alternate;
}

@keyframes sd-draw {
  to {
    stroke-dashoffset: 0;
  }
}`,
      },
    ],
    caveats: [
      '`stroke-dasharray` 必须**大于等于**路径总长。小于它时会出现多段虚线，看到的是「蚂蚁线绕着走」而不是「一笔画出来」。',
      '路径总长最好用 `getTotalLength()` 取真实值。凭经验填一个偏小的数字，会出现「画了两遍」的观感；填得偏大只会让开头多等一会儿，比填小安全。',
      '它只作用于 **stroke**，对 `fill` 无效。填充色不会跟着「画」出来——想要填充一起出现得另外叠一层透明度动画。',
      '多条路径依次画时要用 `animation-delay` 排阶梯，但每条总长不同，**同样的时长会让长的慢、短的快**。要视觉匀速，得按总长分别设时长。',
      '圆、矩形这类基本图形可以直接写数字；任意 `<path>` 只能靠 JS 拿总长，纯 CSS 无法计算。',
    ],
    notes: [
      '两个动画方向相反就是「画出来又擦掉」，`alternate` 一行就能得到。',
      '这一招是各类加载动画与签名动画的共同基础，机制只有一句话：用虚线偏移伪装出「长度」。',
    ],
    _rawRef: 'https://developer.mozilla.org/en-US/docs/Web/SVG/Attribute/stroke-dashoffset',
    _origin: 'crawl',
  },

  {
    slug: 'gooey-blob',
    title: '粘性融合',
    category: '图形',
    tags: ['滤镜', '融合', '阈值'],
    since: SINCE,
    source: '机制来自 feGaussianBlur + feColorMatrix 的经典组合，自行实现',
    when: '两个圆形靠近时要像水银一样粘在一起，而不是各是各的',
    stage: 'dark',
    tier: 'core',
    params: [
      { name: 'blur', label: '融合半径', type: 'range', min: 4, max: 28, step: 2, default: 14 },
    ],
    description: `两个圆靠近时中间连起一条腰、再慢慢分开——像水银。

机制是 ==先模糊、再把透明度「阈值化」，顺序不能反==。糊开之后两个圆之间的过渡区变成了半透明；阈值化把所有中间值推向两端（要么全不透明、要么全透明），于是那片半透明的连接区被判定成「实心」，两个圆就粘在了一起。

这里模糊由 CSS 的 \`blur()\` 负责、阈值由 SVG 的 \`feColorMatrix\` 负责，两者串在同一条 \`filter\` 声明里——**这样模糊半径才是一个能传进去的参数**。`,
    code: [
      {
        lang: 'html',
        body: `<svg width="0" height="0" aria-hidden="true" focusable="false">
  <filter id="sb-goo">
    <feColorMatrix in="SourceGraphic" mode="matrix"
      values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 19 -9" />
  </filter>
</svg>

<div class="goo">
  <span class="goo-a"></span>
  <span class="goo-b"></span>
</div>`,
      },
      {
        lang: 'css',
        body: `.goo {
  position: relative;
  width: min(300px, 80vw);
  height: 170px;
  /* @mechanism 模糊用 CSS、阈值用 SVG 滤镜，按书写顺序依次作用 */
  filter: blur(var(--blur, 14px)) url(#sb-goo);
  background: #0d0a14;
}

.goo span {
  position: absolute;
  top: 50%;
  width: 68px;
  height: 68px;
  margin-top: -34px;
  border-radius: 50%;
  background: #b4462f;
}

.goo-a {
  left: 60px;
  animation: goo-a 3.4s ease-in-out infinite alternate;
}

.goo-b {
  right: 60px;
  background: #d9a441;
  animation: goo-b 3.4s ease-in-out infinite alternate;
}

@keyframes goo-a {
  from { translate: 0 0; }
  to   { translate: 46px 0; }
}

@keyframes goo-b {
  from { translate: 0 0; }
  to   { translate: -46px 0; }
}`,
      },
    ],
    caveats: [
      '顺序不能反。先阈值化再模糊，得到的是边缘糊掉的普通圆——完全不粘。',
      '粘性的强弱由 **feColorMatrix 的 alpha 行**决定（这里是 `0 0 0 19 -9`）。那个 19 越大越容易粘，-9 是偏移。调它比调模糊半径更直接。',
      '模糊半径要**大于两者之间的间隙**才连得上。半径小于间隙时它们就是两个独立的圆，看起来像「滤镜没生效」。',
      '模糊半径是这一条**唯一能做成参数**的量。CSS 的 `filter` 允许把函数与 SVG 滤镜串在同一条里：`blur(...)` 负责糊、`url(#...)` 负责阈值，从左到右依次作用。反过来把模糊写进 `feGaussianBlur` 的 `stdDeviation` 就够不到了——**SVG 滤镜属性不接受 CSS 变量**（这是门禁拦下的第三类「参数够不到」）。',
      '滤镜必须加在**共同容器**上。分加在各自元素上时两者不会互相粘，因为每个元素自己糊自己的。',
      '滤镜会影响容器内的**所有**内容，包括文字（字也会被糊成一团）。文字必须放在滤镜容器之外。',
      '滤镜会创建合成层并可能裁剪边缘。容器要留出足够的内边距，否则圆的边缘会被切掉。',
    ],
    notes: [
      '同一套滤镜用在「三个圆依次靠近」上就是经典的加载动画，机制完全一样。',
      '它属于那种「参数只有一个、效果却很昂贵」的做法：看着是水墨，其实是模糊加阈值。',
    ],
    _rawRef: 'https://developer.mozilla.org/en-US/docs/Web/SVG/Element/feColorMatrix',
    _origin: 'crawl',
  },

  {
    slug: 'duotone-blend',
    title: '双色调',
    category: '图形',
    tags: ['混合模式', '双色调', '图片'],
    since: SINCE,
    source: '机制来自 CSS mix-blend-mode 与灰度滤镜的组合，自行实现',
    when: '一张彩色图片要压成只有两个颜色的风格化版本',
    stage: 'photo',
    tier: 'core',
    params: [
      { name: 'hi', label: '亮部色相', type: 'range', min: 0, max: 360, step: 15, default: 30, unit: 'deg' },
    ],
    description: `一张渐变图被压成了两种颜色：暗部是深紫，亮部是暖金，中间没有别的色。

机制是 ==先去掉颜色只留明暗，再用混合模式把亮部「染」上目标色==。底层放亮部色，上层放灰度图并设 \`mix-blend-mode: multiply\`——乘法会让暗处更暗、亮处保留底色，于是灰度信息变成了「取多少底色」的权重。

图片的信息没有消失，只是从**颜色**被搬到了**明暗**上。`,
    code: [
      {
        lang: 'html',
        body: `<div class="dt">
  <div class="dt-ink"></div>
  <div class="dt-img"></div>
</div>`,
      },
      {
        lang: 'css',
        body: `.dt {
  position: relative;
  width: min(320px, 80vw);
  height: 190px;
  overflow: hidden;
  background: #2a1740;
}

/* 底层：亮部要染成的颜色 */
.dt-ink {
  position: absolute;
  inset: 0;
  background: hsl(var(--hi, 30deg) 78% 62%);
}

/* 上层：灰度图用 multiply 染色 */
.dt-img {
  position: absolute;
  inset: 0;
  background: linear-gradient(135deg, #ffffff 0%, #8a8a8a 42%, #101010 100%);
  filter: grayscale(1) contrast(1.25);
  /* @mechanism multiply 让灰度成为「取多少底色」的权重 */
  mix-blend-mode: multiply;
}`,
      },
    ],
    caveats: [
      '它需要**两层配合**（底色的层 + 灰度层）。单层做不到双色调，这是最常见的误解。',
      '`mix-blend-mode` 混合的是**元素之间**，`background-blend-mode` 混合的是**同一元素的背景层之间**。用错位置就完全没有效果，而且不报错。',
      '混合会在最近的**层叠上下文**内发生。祖先带上 `transform`、`opacity`、`filter` 时会创建新的上下文，混合范围随之缩小——现象是「在某个容器里就变了样」。',
      '`multiply` 适合「暗底亮部」；反过来（亮底暗部）要用 `screen` 或 `lighten`。选错会把图片压成一片黑或一片白。',
      '它会丢掉原图的大部分颜色信息。压在双色调图上的文字必须有足够对比度，不能指望图片「反正比较暗」。',
      '灰度化用 `filter: grayscale(1)` 与「底层放灰」是两条不同的路：前者改的是元素自身的像素，后者靠混合。混用时要想清楚谁在起作用。',
    ],
    notes: [
      '把底层换成一个渐变（而不是纯色），就得到「双色调还带方向」的版本——机制不变，只是权重之外又多了一个变量。',
      '同一招可以用在文字上：灰底文字配彩色底层，得到双色标题。',
    ],
    _rawRef: 'https://developer.mozilla.org/en-US/docs/Web/CSS/mix-blend-mode',
    _origin: 'crawl',
  },

  {
    slug: 'mask-fade-edges',
    title: '遮罩渐隐边缘',
    category: '图形',
    tags: ['遮罩', '渐隐', '溢出提示'],
    since: SINCE,
    source: '机制来自 CSS Masking 的 mask-image，自行实现',
    when: '横向滚动的内容要在一侧淡出，暗示「还有更多」',
    stage: 'plain',
    tier: 'core',
    params: [
      { name: 'fade', label: '渐隐长度', type: 'range', min: 4, max: 30, step: 2, default: 14, unit: '%' },
    ],
    description: `一排卡片在最右边渐渐淡去，而不是被硬生生切断。

机制是 ==mask-image 用一张渐变图控制每个像素的可见度==。和 \`opacity\` 的差别在于它是**逐像素**的：同一块内容可以左边实、右边虚，\`opacity\` 只能整体一起变。

那张渐变图就是「可见度曲线」，写多长就淡多长。`,
    code: [
      {
        lang: 'html',
        body: `<div class="mf">
  <div class="mf-card">一</div>
  <div class="mf-card">二</div>
  <div class="mf-card">三</div>
  <div class="mf-card">四</div>
  <div class="mf-card">五</div>
</div>`,
      },
      {
        lang: 'css',
        body: `.mf {
  display: flex;
  gap: 12px;
  width: min(360px, 82vw);
  overflow-x: auto;
  /* @mechanism 渐变图就是可见度曲线，逐像素生效 */
  -webkit-mask-image: linear-gradient(
    to right,
    #000 0,
    #000 calc(100% - var(--fade, 14%)),
    transparent 100%
  );
  mask-image: linear-gradient(
    to right,
    #000 0,
    #000 calc(100% - var(--fade, 14%)),
    transparent 100%
  );
}

.mf-card {
  flex: 0 0 120px;
  display: grid;
  place-items: center;
  height: 130px;
  border: 1px solid rgb(60 48 30 / 0.3);
  background: rgb(255 255 255 / 0.5);
  font: 600 20px/1 system-ui, sans-serif;
  color: #1c1a17;
}`,
      },
    ],
    caveats: [
      '`mask-image` 要配 `-webkit-mask-image` 才能在部分旧版引擎生效。两套都写才安全。',
      '遮罩的取值方式由 `mask-mode` 决定：默认 `match-source`——**图片用 alpha、SVG 的 `<mask>` 用亮度**。用反了会得到完全反相的遮罩。',
      '它**不改变布局**：被遮掉的部分仍然占着位置、仍然参与滚动。所以「看不见但还能滑到」是正常的。',
      '被遮掉的区域**仍然可以点击**（这是它和 `clip-path` 的一个实际差别）。要让不可见部分不可交互，得另外配 `pointer-events`。',
      '遮罩会创建层叠上下文，子元素的 `position: fixed` 会被限制在这块区域内。',
      '渐变的色标位置决定淡出的速度。把停靠点放得太靠后（比如 `95%`）会得到一个极窄的淡出区，看着像硬边。',
    ],
    notes: [
      '两侧都渐隐就把 `mask-image` 写成两头黑中间透明以外的形状——本质上是「可见度曲线」，想怎么淡就怎么写。',
      '它和滚动阴影分工不同：滚动阴影是「有内容在滚才出现」，遮罩是「永远淡出」。两者叠在一起用最完整。',
    ],
    _rawRef: 'https://developer.mozilla.org/en-US/docs/Web/CSS/mask-image',
    _origin: 'crawl',
  },

  {
    slug: 'repeating-pattern',
    title: '纯 CSS 重复图案',
    category: '图形',
    tags: ['图案', '重复渐变', '背景'],
    since: SINCE,
    source: '机制来自 repeating-linear-gradient 的色标周期，自行实现',
    when: '背景要有斜纹或格纹，但不想引入图片',
    stage: 'grid',
    tier: 'core',
    params: [
      { name: 'size', label: '周期', type: 'range', min: 4, max: 40, step: 2, default: 14, unit: 'px' },
    ],
    description: `一片斜纹，密度可调，全是算出来的，没有一张图片。

机制是 ==repeating-linear-gradient 的色标总长超过 100% 时会被按周期重复==。写 \`0 6px, color 6px 12px\` 时周期就是 12px——浏览器沿着渐变轴每 12px 重复一遍。把两条周期和角度都相同的斜纹交叉叠起来，就是格纹。

图案不是图，只是一段可以算的数。`,
    code: [
      {
        lang: 'html',
        body: `<div class="rp"></div>`,
      },
      {
        lang: 'css',
        body: `.rp {
  width: min(300px, 78vw);
  height: 180px;
  /* @mechanism 色标总长就是周期，超过就重复 */
  background-image:
    repeating-linear-gradient(
      45deg,
      rgb(180 70 47 / 0.5) 0 calc(var(--size, 14px) / 2),
      transparent calc(var(--size, 14px) / 2) var(--size, 14px)
    ),
    repeating-linear-gradient(
      -45deg,
      rgb(217 164 65 / 0.34) 0 calc(var(--size, 14px) / 2),
      transparent calc(var(--size, 14px) / 2) var(--size, 14px)
    ),
    linear-gradient(160deg, #1d1730, #0d0a14);
  border: 1px solid rgb(60 48 30 / 0.3);
}`,
      },
    ],
    caveats: [
      '周期由**最后一组色标的终点**决定。写 `color 0 8px, transparent 8px 16px` 周期是 16px；漏掉终点时周期会变成渐变默认的全长。',
      '**角度会改变视觉条宽**。`45deg` 的斜纹，看上去的条宽要乘以 cos45，比声明的长度窄约 30%——所以调出的密度总比预期密，要用参数补偿。',
      '两条交叉斜纹的角度必须**互为相反数**（45 与 -45），周期也必须相同，否则交界处会错位成锯齿。',
      '`background-size` 与渐变自身的周期会**叠加**。做图案时通常让 `background-size` 等于渐变周期（或干脆不设），两个周期不一致时的结果很难预测。',
      '深色主题上对比度要压得很低。图案一旦比内容显眼，整块就变得很吵。',
      '它每帧都要重绘。静态没问题，一旦给带图案的元素加动画，代价比纯色高不少。',
    ],
    notes: [
      '把两层换成同一个角度、不同周期，就得到「宽窄相间的条纹」；换成 `repeating-radial-gradient` 就是同心圆纹。',
      '点阵用 `radial-gradient` 配 `background-size` 更简单——那是「尺寸重复」而不是「色标重复」，是另一条路。',
    ],
    _rawRef: 'https://developer.mozilla.org/en-US/docs/Web/CSS/gradient/repeating-linear-gradient',
    _origin: 'crawl',
  },

  {
    slug: 'conic-pie-chart',
    title: '锥形渐变的饼图',
    category: '图形',
    tags: ['饼图', '锥形渐变', '硬色标'],
    since: SINCE,
    source: '机制来自 conic-gradient 的硬色标，自行实现',
    when: '要一个饼图，但不想引入图表库',
    stage: 'dark',
    tier: 'core',
    params: [
      { name: 'from', label: '起始角度', type: 'range', min: 0, max: 360, step: 15, default: 0, unit: 'deg' },
    ],
    description: `一个四段饼图，每段的边界是锐利的，没有过渡色带。

机制是 ==conic-gradient 的色标放在同一个位置就得到硬边界==。\`color 25%\` 之后紧接 \`color2 25%\`，中间没有可插值的空间，于是 25% 处直接换色——这就是「一块」的边缘。

扇形不需要额外的元素，一段渐变就是一张饼。`,
    code: [
      {
        lang: 'html',
        body: `<div class="cp">
  <div class="cp-donut"></div>
  <ul class="cp-legend">
    <li><i style="background:#b4462f"></i>布局</li>
    <li><i style="background:#d9a441"></i>动效</li>
    <li><i style="background:#7c5cff"></i>排版</li>
    <li><i style="background:#14b8a6"></i>材质</li>
  </ul>
</div>`,
      },
      {
        lang: 'css',
        body: `.cp {
  display: flex;
  align-items: center;
  gap: 20px;
  font: 400 13px/1.7 system-ui, sans-serif;
  color: #f0ead9;
}

.cp-donut {
  width: 150px;
  height: 150px;
  border-radius: 50%;
  /* @mechanism 两个色标同位置 = 硬边界，没有过渡 */
  background: conic-gradient(
    from var(--from, 0deg),
    #b4462f 0 25%,
    #d9a441 25% 50%,
    #7c5cff 50% 75%,
    #14b8a6 75% 100%
  );
  /* @mechanism 中间挖空成甜甜圈 */
  -webkit-mask: radial-gradient(circle, transparent 0 42%, #000 42%);
  mask: radial-gradient(circle, transparent 0 42%, #000 42%);
}

.cp-legend {
  margin: 0;
  padding: 0;
  list-style: none;
}

.cp-legend li {
  display: flex;
  align-items: center;
  gap: 7px;
}

.cp-legend i {
  width: 10px;
  height: 10px;
  border-radius: 2px;
}`,
      },
    ],
    caveats: [
      '硬色标必须**同位置**：`color 0 25%, color2 25% 50%`。写成 `color 0 25%, color2 26%` 会露出一圈渐变，看着像脏边。',
      '它是**绘制**，不承载数据语义。读屏用户拿不到任何信息——必须配一份等价的列表或表格，图例不只是装饰。',
      '每一段的角度要在 CSS 里**硬算**（25% = 90deg）。数据一变就得重算，所以真实场景通常由 JS 生成这段渐变。',
      '它不能随数据变化做动画——除非用 `@property` 把角度注册成 `<angle>` 再动。硬色标的位置本身不可插值。',
      '扇形边缘会有锯齿。要平滑得靠提高分辨率或加一层极窄的同色过渡，而不是靠浏览器抗锯齿。',
      '甜甜圈用 `mask` 挖空，所以圆心是**真的空**（能透出下面的背景）。需要实心圆心时改用 `radial-gradient` 叠在锥形渐变上。',
    ],
    notes: [
      '把它和「锥形环」对比：那一条用的是渐变当装饰，这一条用的是硬色标当数据边界，机制同源、目的不同。',
      '整圆的 360 度换成 270 度（右侧留缺口）就是仪表盘，也是同一段渐变。',
    ],
    _rawRef: 'https://developer.mozilla.org/en-US/docs/Web/CSS/gradient/conic-gradient',
    _origin: 'crawl',
  },

  {
    slug: 'shape-outside-wrap',
    title: '文字绕着形状排',
    category: '图形',
    tags: ['绕排', '浮动', '形状'],
    since: SINCE,
    source: '机制来自 CSS Shapes 的 shape-outside，自行实现',
    when: '圆形图片旁边的文字要沿着弧形排，而不是留一块方形的空',
    stage: 'plain',
    tier: 'core',
    params: [],
    description: `一个圆形的图案，右边的文字沿着圆弧往回收，没有围着方框留空。

机制是 ==shape-outside 让浮动元素的「形状」不等于它的盒子==。浮动的基准是元素的外框（一个矩形），文字会绕开那个矩形；\`shape-outside: circle(50%)\` 把绕排的边界改成圆，文字于是贴着弧线排。

它改的是**文字怎么绕**，不改元素自己长什么样。`,
    code: [
      {
        lang: 'html',
        body: `<div class="so">
  <div class="so-orb"></div>
  <p>文字会沿着那个圆排。浮动的基准本来是元素的外框——一个方形，
  所以文字会围着一块方形的空白走。把绕排的边界换成圆，文字就贴上了弧线。</p>
  <p>它只改变文字绕行的路径，不改变这个圆本身的绘制。</p>
</div>`,
      },
      {
        lang: 'css',
        body: `.so {
  width: min(420px, 84vw);
  font: 400 14px/1.9 system-ui, sans-serif;
  color: #1c1a17;
}

.so-orb {
  /* @mechanism shape-outside 只对浮动元素生效 */
  float: inline-start;
  width: 130px;
  height: 130px;
  margin: 4px 20px 4px 0;
  border-radius: 50%;
  background: radial-gradient(circle at 34% 30%, #ff9a5a, #b4462f 70%);
  /* @mechanism 绕排边界改成圆：文字贴弧线，不留方形空 */
  shape-outside: circle(50%);
}

.so p {
  margin: 0 0 12px;
}`,
      },
    ],
    caveats: [
      '**必须配 `float`。**`shape-outside` 只对浮动元素生效——元素不是浮动时整条声明被忽略，也不报错。',
      '元素自己**仍然是矩形**。`shape-outside` 改的是「文字绕它时的边界」，不改它的边框、背景或命中区域。要让绘制也是圆的，得同时写 `border-radius` 或 `clip-path`。',
      '父级是 flex 或 grid 时浮动失效，`shape-outside` 跟着一起失效。它只能用在同一块级格式化上下文里。',
      '形状函数（`circle()`/`ellipse()`/`polygon()`/`inset()`）的坐标是**相对这个元素自己的盒子**，不是相对父级。',
      '它是**逐行**生效的：行高变了、字号变了、容器宽度变了，绕排结果都会变。响应式下形状要跟着调。',
      '`shape-margin` 可以给绕排边界加一点外扩距离，比给元素加 `margin` 更精确——后者改的是盒子而不是形状。',
    ],
    notes: [
      '配 `clip-path` 让绘制与绕排形状一致，是这类排版最完整的做法；只写一个会出现「看着是圆的、文字却绕方形」。',
      '`polygon()` 能让文字绕出一段不规则的弧形，是杂志式排版里最常用的一招。',
    ],
    _rawRef: 'https://developer.mozilla.org/en-US/docs/Web/CSS/shape-outside',
    _origin: 'crawl',
  },

  {
    slug: 'wipe-reveal',
    title: '擦拭揭示',
    category: '图形',
    tags: ['裁剪', '揭示', 'inset'],
    since: SINCE,
    source: '机制来自 CSS clip-path 的 inset()，自行实现',
    when: '内容要像被一块抹布擦出来，而不是整体淡入',
    stage: 'photo',
    tier: 'core',
    params: [
      { name: 'dur', label: '擦完用时', type: 'range', min: 0.4, max: 4, step: 0.2, default: 1.6, unit: 's' },
    ],
    description: `画面从左边被一条硬边推着揭示出来。

机制是 ==clip-path: inset() 的四条边各自可以动，把左边的内缩量从 100% 推到 0 就是单向擦拭==。\`inset(top right bottom left)\` 里的百分比是「从那条边往内缩多少」。它和 \`mask\` 的差别是**边界是硬的**——没有渐变过渡，就是一刀切过去。

硬边抹过去，比淡入更利落。`,
    code: [
      {
        lang: 'html',
        body: `<div class="wr"></div>`,
      },
      {
        lang: 'css',
        body: `.wr {
  width: min(320px, 80vw);
  height: 190px;
  background: linear-gradient(135deg, #7c5cff, #14b8a6 55%, #d9a441);
  /* @mechanism 只动左边那一条内缩量 = 单向擦拭 */
  clip-path: inset(0 100% 0 0);
  animation: wr-wipe var(--dur, 1.6s) cubic-bezier(0.65, 0, 0.35, 1) infinite alternate;
}

@keyframes wr-wipe {
  to {
    clip-path: inset(0 0 0 0);
  }
}`,
      },
    ],
    caveats: [
      '`inset()` 的四个值是**上、右、下、左**（顺时针），不是常见的上右下左写法顺序。写错第几位就动错了方向。',
      '**被裁掉的部分不可点击**——`clip-path` 会影响命中测试。这与 `mask` 正好相反，遮罩隐藏的区域仍然可点。',
      '它不改变布局：元素仍然占原来的空间，被裁掉的部分只是不画。',
      '祖先的 `overflow: hidden` 会与它**叠加**裁剪，出现「擦到一半就不见了」。',
      '每一帧都在重绘裁剪区域，代价低于动画 `filter`、高于 `transform`。大元素上会掉帧，能用 `transform` 平移来伪装的场合就别用它。',
      '想要柔和的揭示（边缘渐隐）得用 `mask`，`clip-path` 做不到软边——两者常一起用，硬的负责结构、软的负责质感。',
    ],
    notes: [
      '改成 `inset(0 0 0 100%)` 就是从右边擦过来，换一条边就是一个新方向。',
      '配 `steps()` 缓动还能做「百叶窗」式分段揭示——本质是让硬边一格一格跳。',
    ],
    _rawRef: 'https://developer.mozilla.org/en-US/docs/Web/CSS/clip-path',
    _origin: 'crawl',
  },

  /* ────────────────────────────── 动效 ────────────────────────────── */
  {
    slug: 'flip-layout-transition',
    title: '布局变化的平滑过渡',
    category: '动效',
    tags: ['视图过渡', '布局', '快照'],
    since: SINCE,
    source: '机制来自 View Transitions API，自行实现',
    when: '点一下要在两种布局间切换，希望变化是滑过去的而不是瞬间跳',
    stage: 'dark',
    tier: 'candidate',
    params: [],
    description: `点一下，一排卡片换个排法，每张卡片从旧位置滑到新位置。

机制是 ==\`startViewTransition()\` 在变化前后各截一张快照，再让新旧快照交叉过渡==。浏览器不需要知道你改了什么 CSS，它只是把「之前的样子」和「之后的样子」都画成静态图层，然后做动画。

关键是给元素起 \`view-transition-name\`：起了名字的元素会被**单独配对**，于是从旧位置滑到新位置，而不是整页淡入淡出。`,
    code: [
      {
        lang: 'html',
        body: `<div class="vt">
  <button class="vt-btn" id="sb-vt-btn">换一种排法</button>
  <div class="vt-grid" id="sb-vt">
    <div class="vt-card" style="view-transition-name: c1">一</div>
    <div class="vt-card" style="view-transition-name: c2">二</div>
    <div class="vt-card" style="view-transition-name: c3">三</div>
  </div>
</div>`,
      },
      {
        lang: 'css',
        body: `.vt {
  width: min(360px, 82vw);
  font: 400 13px/1.6 system-ui, sans-serif;
  color: #f0ead9;
}

.vt-btn {
  margin-bottom: 12px;
  padding: 10px 18px;
  border: 1px solid rgb(217 164 65 / 0.5);
  background: rgb(217 164 65 / 0.14);
  font: 500 13px/1 system-ui, sans-serif;
  color: #f0ead9;
  cursor: pointer;
}

.vt-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 10px;
  transition: none;
}

/* @mechanism 换布局就是换这一段，过渡由浏览器截图完成 */
.vt-grid.is-stacked {
  grid-template-columns: 1fr;
}

.vt-card {
  display: grid;
  place-items: center;
  height: 62px;
  border: 1px solid rgb(180 70 47 / 0.5);
  background: #1b1626;
  font: 600 17px/1 system-ui, sans-serif;
}`,
      },
      {
        lang: 'js',
        body: `const btn = document.getElementById('sb-vt-btn')
const grid = document.getElementById('sb-vt')
if (btn && grid && typeof document.startViewTransition === 'function') {
  btn.addEventListener('click', () => {
    // @mechanism 在回调里同步改 DOM，浏览器负责前后快照的过渡
    document.startViewTransition(() => {
      grid.classList.toggle('is-stacked')
    })
  })
}`,
      },
    ],
    caveats: [
      '`view-transition-name` 必须**全页唯一**。两个元素同名会让整个过渡直接失效（不是报错，是没动画）——这是它最常见的坑。同一元素在切换前后都保留同一个名字才对。',
      'DOM 的修改必须发生在传给 `startViewTransition` 的**回调里**。在回调外面改，浏览器截「旧快照」的时机已经过了，过渡看不出变化。',
      '它截的是**快照**，不是真实元素。过渡期间页面上的内容不能交互，长过渡会有「按不动」的感觉。',
      '默认只有交叉淡入。要「移动」的观感，必须给元素起名字——不起名字时整页一起淡，变化看起来软但不清。',
      '支持面还新，且各引擎的默认时长与缓动不同。要一致必须显式写 `::view-transition-group(*)` 的 `animation-duration`。',
      '它不是状态机动画：只在 A 到 B 之间过渡，做不出「回到中间态再走」的编排。复杂编排要回到关键帧。',
    ],
    notes: [
      '用 `@view-transition { navigation: auto }` 还能把它用到跨页面跳转上，机制一样。',
      '配 prefers-reduced-motion 关掉它，否则对敏感人群就是不必要的大幅位移。',
    ],
    _rawRef: 'https://developer.mozilla.org/en-US/docs/Web/API/Document/startViewTransition',
    _origin: 'crawl',
  },

  {
    slug: 'odometer-count',
    title: '数码管数字',
    category: '动效',
    tags: ['数字', '位移', '等宽'],
    since: SINCE,
    source: '自行实现',
    when: '计数器变化时数字要滚动着换，而不是直接跳成新值',
    stage: 'dark',
    tier: 'core',
    params: [
      { name: 'dur', label: '滚动用时', type: 'range', min: 0.2, max: 1.5, step: 0.1, default: 0.6, unit: 's' },
    ],
    description: `计数器从 3 变成 4 时，那一位数字向上滚了一格，像里程表。

机制是 ==把 0 到 9 竖排成一列，用 translateY 位移到目标数字的位置==。每位数字都有一整列 0–9，容器只露出其中一格；数值一变，整列向上平移一格，中间那个滚过去的瞬间就出现了运动感。

它把「换一个字符」变成「移动一段距离」——动画因此可以插值。`,
    code: [
      {
        lang: 'html',
        body: `<div class="od">
  <span class="od-cell">
    <span class="od-strip" id="sb-od">0 1 2 3 4 5 6 7 8 9</span>
  </span>
  <span class="od-unit">条咒语</span>
</div>`,
      },
      {
        lang: 'css',
        body: `.od {
  display: flex;
  align-items: baseline;
  gap: 8px;
  font: 600 34px/1 system-ui, sans-serif;
  color: #f0ead9;
}

.od-cell {
  display: inline-block;
  /* @mechanism 只露出一格的高度 */
  height: 1em;
  overflow: hidden;
  vertical-align: bottom;
}

.od-strip {
  display: block;
  /* @mechanism 用位移换数字，动画因此可以插值 */
  transition: translate var(--dur, 0.6s) cubic-bezier(0.5, 0, 0.2, 1);
  /* @mechanism 等宽数字，每一位的宽度才对得上 */
  font-variant-numeric: tabular-nums;
}

.od-unit {
  font-size: 13px;
  font-weight: 400;
  color: rgb(240 234 217 / 0.6);
}`,
      },
      {
        lang: 'js',
        body: `const strip = document.getElementById('sb-od')
if (strip) {
  // 把 0-9 拆成竖排的十行
  strip.textContent = ''
  for (let i = 0; i <= 9; i += 1) {
    const row = document.createElement('span')
    row.textContent = String(i)
    row.style.display = 'block'
    row.style.height = '1em'
    strip.append(row)
  }
  // 演示可以重播，旧的定时器要先清掉，否则会越跑越多
  if (window.__sbOdometer) clearInterval(window.__sbOdometer)
  let n = 3
  let up = true
  window.__sbOdometer = setInterval(() => {
    n = up ? n + 1 : n - 1
    if (n >= 9) up = false
    if (n <= 1) up = true
    // @mechanism 位移 = 格数 × 一格高度
    strip.style.translate = '0 ' + -n + 'em'
  }, 1400)
}`,
      },
    ],
    caveats: [
      '位移量必须等于**格数 × 一格高度**。用 `em` 做单位时它会跟着字号缩放，比自己算像素稳。',
      '容器要 `overflow: hidden` 且高度**正好一格**。高度偏大时会露出上下两个数字的边，看起来像没对齐。',
      '数字位数变化时（9 → 10）不能靠位移解决——多出的那一位需要另外一列，纯位移做不了。',
      '用 `translate` 而不是 `top`：后者每帧触发布局重算。',
      '必须用等宽数字（`tabular-nums`）。不同数字宽度不同时，位移的基准会偏，滚到一半会有横向抖动。',
      '它只是视觉。读屏仍然按 DOM 读，所以那 10 个数字会被逐个读出来——真实的无障碍做法是给容器 `aria-hidden` 并在旁边放一个可读的值。',
    ],
    notes: [
      '把 `transition` 换成 `animation` 配 `steps(1)` 就是「啪」地跳一格，硬但没有惯性。',
      '多位数就复制多列，每列一个 `transition-delay` 就能做出「从个位开始依次滚」的观感。',
    ],
    _rawRef: 'https://developer.mozilla.org/en-US/docs/Web/CSS/translate',
    _origin: 'crawl',
  },

  {
    slug: 'bar-grow-chart',
    title: '条形从底部生长',
    category: '动效',
    tags: ['图表', '缩放', '原点'],
    since: SINCE,
    source: '自行实现',
    when: '图表里的条要在出现时从底部往上长，而不是从中间撑开',
    stage: 'plain',
    tier: 'core',
    params: [
      { name: 'dur', label: '生长用时', type: 'range', min: 0.3, max: 3, step: 0.1, default: 1.1, unit: 's' },
    ],
    description: `几根条从底部往上长出来，长的长得更久一点。

机制是 ==\`scaleY()\` 配 \`transform-origin: bottom\`，让缩放的原点落在底部==。默认原点在中心，直接缩放会让条上下同时变化——看着像在跳，不像在生长。把原点挪到底部，缩放的唯一效果就是「高度在变」。

一个 \`transform-origin\` 决定了这块东西「以哪里为基准变化」。`,
    code: [
      {
        lang: 'html',
        body: `<div class="bg">
  <div class="bg-col"><span class="bg-bar" style="--h: 42%"></span><b>42</b></div>
  <div class="bg-col"><span class="bg-bar" style="--h: 68%"></span><b>68</b></div>
  <div class="bg-col"><span class="bg-bar" style="--h: 91%"></span><b>91</b></div>
  <div class="bg-col"><span class="bg-bar" style="--h: 57%"></span><b>57</b></div>
</div>`,
      },
      {
        lang: 'css',
        body: `.bg {
  display: flex;
  align-items: flex-end;
  gap: 16px;
  width: min(320px, 80vw);
  height: 190px;
  padding-bottom: 4px;
  border-bottom: 1px solid rgb(60 48 30 / 0.34);
  font: 600 12px/1 system-ui, sans-serif;
  color: #1c1a17;
}

.bg-col {
  display: grid;
  justify-items: center;
  gap: 6px;
  height: 100%;
  align-content: end;
}

.bg-bar {
  width: 46px;
  height: var(--h, 50%);
  background: linear-gradient(180deg, #b4462f, #8d3524);
  /* @mechanism 原点挪到底部，缩放才只影响高度 */
  transform-origin: bottom;
  transform: scaleY(0);
  animation: bg-grow var(--dur, 1.1s) cubic-bezier(0.2, 0.7, 0.3, 1) forwards;
}

@keyframes bg-grow {
  to {
    transform: scaleY(1);
  }
}`,
      },
    ],
    caveats: [
      '`transform-origin: bottom` 是**必需的**。默认的 `center` 会让条从中间往两头长，看起来像弹簧而不是生长。',
      '`scaleY` 会**拉伸内容**。条里如果有文字，字也会被拉长——正确做法是外层缩放、内容单独放一层并反向缩放（或干脆把标签放在条外面）。',
      '用 `height` 做动画会每帧触发布局重算，长列表上明显掉帧。`transform` 走合成器，代价低得多。',
      '条长是「数据到尺寸」的映射。用百分比时 `height: 42%` 的基准是**父级的高度**，父级没有明确高度时百分比会失效。',
      '数值标签要用等宽数字（`tabular-nums`），否则数字变化时标签自身的宽度会抖，条的位置跟着动。',
      '纯粹的装饰性动画应当能被 `prefers-reduced-motion` 关掉——关掉之后条要**直接以最终高度出现**，而不是停在 0（`forwards` 保证了终态，但关动画时要注意这一点）。',
    ],
    notes: [
      '用 `animation-delay` 给每根条错开一点，就有「依次长出来」的节奏——和交错入场是同一套做法。',
      '换成 `scaleX` 配 `transform-origin: left` 就是横向条形图，机制完全对称。',
    ],
    _rawRef: 'https://developer.mozilla.org/en-US/docs/Web/CSS/transform-origin',
    _origin: 'crawl',
  },

  /* ────────────────────────────── 交互 ────────────────────────────── */
  {
    slug: 'long-press-action',
    title: '长按触发',
    category: '交互',
    tags: ['长按', '指针', '定时器'],
    since: SINCE,
    source: '自行实现',
    when: '按住不放才能执行的操作，比如删除或拖动前的确认',
    stage: 'dark',
    tier: 'core',
    params: [
      { name: 'hold', label: '按住时长', type: 'range', min: 0.3, max: 1.5, step: 0.1, default: 0.6, unit: 's' },
    ],
    description: `按住不放，一条进度慢慢填满；填满的瞬间动作才执行。松手太早就取消。

机制是 ==pointerdown 起一个定时器，pointerup / pointercancel / pointerleave 上清掉它==。这四个事件缺一不可——少任何一个都会出现「手指滑走了它照样触发」。进度条用的是同一个时长，所以用户能看见还要按多久。

**必须有进度反馈**，否则长按就是靠猜。`,
    code: [
      {
        lang: 'html',
        body: `<button class="lp" id="sb-lp">
  <span class="lp-fill"></span>
  <span class="lp-text">按住不放</span>
</button>
<p class="lp-out" id="sb-lp-out">还没触发</p>`,
      },
      {
        lang: 'css',
        body: `.lp {
  position: relative;
  overflow: hidden;
  padding: 14px 26px;
  border: 1px solid rgb(217 164 65 / 0.5);
  background: rgb(217 164 65 / 0.12);
  font: 500 14px/1 system-ui, sans-serif;
  color: #f0ead9;
  cursor: pointer;
  /* @mechanism 长按会触发系统的选择与呼出菜单，必须关掉 */
  user-select: none;
  -webkit-touch-callout: none;
  -webkit-user-select: none;
}

.lp-fill {
  position: absolute;
  inset: 0;
  transform-origin: left;
  transform: scaleX(0);
  background: rgb(180 70 47 / 0.5);
  pointer-events: none;
}

/* @mechanism 进度用同一个时长，用户能看见还要按多久 */
.lp.is-holding .lp-fill {
  transition: transform var(--hold, 0.6s) linear;
  transform: scaleX(1);
}

.lp-text {
  position: relative;
}

.lp-out {
  margin: 12px 0 0;
  font: 400 13px/1.6 system-ui, sans-serif;
  color: rgb(240 234 217 / 0.6);
}`,
      },
      {
        lang: 'js',
        body: `const pad = document.getElementById('sb-lp')
const out = document.getElementById('sb-lp-out')
if (pad && out) {
  const HOLD = 600
  let timer = null
  let fired = false

  const clear = () => {
    if (timer !== null) clearTimeout(timer)
    timer = null
    pad.classList.remove('is-holding')
  }

  pad.addEventListener('pointerdown', (event) => {
    fired = false
    pad.classList.add('is-holding')
    timer = setTimeout(() => {
      fired = true
      out.textContent = '已触发'
      pad.classList.remove('is-holding')
      timer = null
    }, HOLD)
    pad.setPointerCapture(event.pointerId)
  })

  // @mechanism 四种情况都要清定时器，少一个就会「滑走了还触发」
  pad.addEventListener('pointerup', () => {
    if (!fired) out.textContent = '松手太早，已取消'
    clear()
  })
  pad.addEventListener('pointercancel', clear)
  pad.addEventListener('pointerleave', clear)
  pad.addEventListener('contextmenu', (event) => event.preventDefault())
}`,
      },
    ],
    caveats: [
      '要清定时器的情况有**四种**：`pointerup`、`pointercancel`、`pointerleave`、以及滚动开始。少任何一个都会出现「手指滑走了照样触发」。',
      '触发之后要**抑制随后的 click**，否则动作会执行两次（长按 + 松手时的点击）。用 `fired` 标记或 `preventDefault` 都行。',
      '时长通常取 500–600ms。低于 300ms 与普通点击难以区分，高于 800ms 会让人以为没反应。',
      '触屏上长按会触发系统的文本选择与上下文菜单，必须 `user-select: none` 与 `-webkit-touch-callout: none`，还要挡 `contextmenu`。',
      '**键盘用户用不了长按。**必须有等价的键盘路径（按 Enter 直接执行），否则这个功能对一部分人是不可达的。',
      '`setPointerCapture` 保证指针移出元素后仍收得到事件，这是「滑走了也不误触发」能成立的前提之一。',
    ],
    notes: [
      '进度指示是长按可用性的核心：没有它，用户不知道是「没反应」还是「按得不够久」。',
      '同一套结构加一个位移阈值就变成「拖动排序」——长按先激活，再跟手移动。',
    ],
    _rawRef: 'https://developer.mozilla.org/en-US/docs/Web/API/Element/pointercancel_event',
    _origin: 'crawl',
  },

  {
    slug: 'swipe-dismiss',
    title: '滑动关闭',
    category: '交互',
    tags: ['滑动', '阈值', '归位'],
    since: SINCE,
    source: '自行实现',
    when: '一条消息要能滑动划掉，松手时没划够就弹回去',
    stage: 'dark',
    tier: 'candidate',
    // 阈值是 JS 里的比较，不是 CSS 值，所以做不成滑杆（它够不到 var()）
    params: [],
    description: `一条通知跟着手指往右移，松手时划得够远就滑出去，不够就弹回来。

机制是 ==把指针的位移写进 translate，松手时看位移是否超过阈值决定两种归宿==。关键是这两种归宿要用**不同的过渡**：拖动过程中不能有过渡（否则跟手会滞涩），松手后要有过渡（才能弹回去或滑出去）。

拖动与归位是两种状态，一套 \`transition\` 不能同时满足。`,
    code: [
      {
        lang: 'html',
        body: `<div class="sw-wrap">
  <div class="sw" id="sb-sw">
    <b>滑动这条</b>
    <span>划得够远就关掉</span>
  </div>
</div>`,
      },
      {
        lang: 'css',
        body: `.sw-wrap {
  position: relative;
  width: min(320px, 80vw);
  overflow: hidden;
  border: 1px solid rgb(60 48 30 / 0.3);
  background: #1b1626;
}

.sw {
  display: grid;
  gap: 3px;
  padding: 16px 18px;
  background: #241d33;
  font: 400 13px/1.6 system-ui, sans-serif;
  color: #f0ead9;
  /* @mechanism 归位时要有过渡（弹回 / 滑出） */
  transition: translate 0.28s cubic-bezier(0.3, 0.8, 0.3, 1), opacity 0.28s;
  touch-action: pan-y;
  cursor: grab;
}

.sw b {
  font-size: 15px;
}

/* @mechanism 拖动过程中关掉过渡，否则跟手会滞涩 */
.sw.is-dragging {
  transition: none;
  cursor: grabbing;
}

.sw.is-gone {
  translate: 100% 0;
  opacity: 0;
}`,
      },
      {
        lang: 'js',
        body: `const card = document.getElementById('sb-sw')
if (card) {
  let startX = 0
  let startY = 0
  let dx = 0
  let dragging = false

  card.addEventListener('pointerdown', (event) => {
    startX = event.clientX
    startY = event.clientY
    dx = 0
    dragging = true
  })

  card.addEventListener('pointermove', (event) => {
    if (!dragging) return
    const mx = event.clientX - startX
    const my = event.clientY - startY
    // @mechanism 先判断主方向：纵向的滑动该让给列表滚动
    if (Math.abs(my) > Math.abs(mx) && dx === 0) {
      dragging = false
      return
    }
    dx = Math.max(0, mx)
    card.classList.add('is-dragging')
    card.style.translate = dx + 'px 0'
  })

  const release = () => {
    if (!dragging) return
    dragging = false
    card.classList.remove('is-dragging')
    card.style.translate = ''
    // @mechanism 超过阈值就滑出去，否则弹回原位
    if (dx > card.offsetWidth * 0.4) {
      card.classList.add('is-gone')
    }
  }

  card.addEventListener('pointerup', release)
  // @mechanism 系统打断（来电等）也要归位，否则卡片会卡在中间
  card.addEventListener('pointercancel', release)
}`,
      },
    ],
    caveats: [
      '要先判断**主方向**（比较水平与垂直位移）。纵向滑动应当让给列表滚动，否则横向划一下就把卡片带走了。',
      '拖动过程中要关掉 `transition`，松手后再打开。全程带着过渡会让跟手「拖不动」——这是最影响手感的一处。',
      '必须处理 `pointercancel`（系统打断、来电、手势被接管）。漏掉时卡片会永久停在中间位置。',
      '阈值一般取元素宽度的 30%–40%，或者一个固定的滑动速度。纯位移阈值对「轻轻快甩」不敏感，真实的滑动面板还要看速度。',
      '划出去之后元素**还在 DOM 里**（只是移出了可视区）。要从列表移除或标记状态，否则它仍占位、仍可被 Tab 聚焦。',
      '触屏上系统自带的边缘返回手势会与它冲突。靠近屏幕左右边缘的滑动可能被系统截获，容器两侧要留出安全距离。',
      '`touch-action: pan-y` 告诉浏览器这一块只允许纵向平移，横向留给脚本——少了它，拖动常与页面滚动打架。',
    ],
    notes: [
      '把阈值比较换成速度（位移 / 时间）能做出「快甩即关」，那是更接近原生手感的一层。',
      '同一套结构双向可用：`Math.max` 换成取绝对值就能左右都能划。',
    ],
    _rawRef: 'https://developer.mozilla.org/en-US/docs/Web/CSS/touch-action',
    _origin: 'crawl',
  },

  {
    slug: 'sticky-toc-highlight',
    title: '目录跟随滚动高亮',
    category: '交互',
    tags: ['目录', '观察器', '根边距'],
    since: SINCE,
    source: '机制来自 IntersectionObserver 与 rootMargin 的经典用法，自行实现',
    when: '长文旁边有目录，滚到哪里就高亮哪一项',
    stage: 'plain',
    tier: 'core',
    params: [],
    description: `右边目录里，当前正在读的那一节一直是亮的。

机制是 ==把观察器的「视口」用 rootMargin 收窄成一条横带，然后观察哪个小节穿过这条带==。默认的视口太高，同时有三四节可见，判断不出「当前」；收成一条带之后，同一时刻只有一个能命中。

用观察器而不是监听滚动，是为了不在每帧里读布局——那些读操作会强制浏览器同步重排。`,
    code: [
      {
        lang: 'html',
        body: `<div class="tc">
  <nav class="tc-nav" id="sb-tc-nav">
    <a class="tc-link is-active" href="#s1">第一节</a>
    <a class="tc-link" href="#s2">第二节</a>
    <a class="tc-link" href="#s3">第三节</a>
  </nav>
  <div class="tc-body">
    <section class="tc-sec" id="s1"><h4>第一节</h4><p>滚到哪一节，左边目录就亮哪一项。</p></section>
    <section class="tc-sec" id="s2"><h4>第二节</h4><p>靠的是把视口收窄成一条带。</p></section>
    <section class="tc-sec" id="s3"><h4>第三节</h4><p>同一时刻只有一个能穿过那条带。</p></section>
  </div>
</div>`,
      },
      {
        lang: 'css',
        body: `.tc {
  display: flex;
  gap: 16px;
  width: min(430px, 86vw);
  font: 400 13px/1.7 system-ui, sans-serif;
  color: #1c1a17;
}

.tc-nav {
  display: grid;
  align-content: start;
  gap: 4px;
  flex: 0 0 84px;
  position: sticky;
  top: 0;
}

.tc-link {
  padding: 5px 8px;
  border-inline-start: 2px solid rgb(60 48 30 / 0.2);
  color: rgb(28 26 23 / 0.55);
  text-decoration: none;
  transition: color 0.2s, border-color 0.2s;
}

.tc-link.is-active {
  border-inline-start-color: #b4462f;
  color: #b4462f;
  font-weight: 600;
}

.tc-body {
  height: 190px;
  overflow-y: auto;
  flex: 1;
}

.tc-sec {
  min-height: 150px;
  padding: 8px 0 18px;
  border-bottom: 1px solid rgb(60 48 30 / 0.14);
}

.tc-sec h4 {
  margin: 0 0 6px;
  font-size: 15px;
}

.tc-sec p {
  margin: 0;
  opacity: 0.72;
}`,
      },
      {
        lang: 'js',
        body: `const body = document.querySelector('.tc-body')
const links = Array.from(document.querySelectorAll('#sb-tc-nav .tc-link'))
if (body && links.length) {
  const sections = Array.from(body.querySelectorAll('.tc-sec'))
  const observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue
        links.forEach((a) => {
          a.classList.toggle('is-active', a.getAttribute('href') === '#' + entry.target.id)
        })
      }
    },
    {
      root: body,
      // @mechanism 把视口收窄成一条带，同一时刻只有一个能命中
      rootMargin: '-45% 0px -45% 0px',
      threshold: 0
    }
  )
  sections.forEach((s) => observer.observe(s))
  // 重播时旧观察器指向已经移除的节点，要断开
  if (window.__sbTocObserver) window.__sbTocObserver.disconnect()
  window.__sbTocObserver = observer
}`,
      },
    ],
    caveats: [
      '`rootMargin` 是这套的**核心**。默认整视口太高，多个小节同时可见时判断不出当前项；收成一条带（如 `-45%` 上下）才唯一。',
      '观察目标要覆盖**整节内容**（含正文），不能只观察标题。只观察标题时，标题滚出带之后这一节就不再是「当前」，高亮会跳到下一节。',
      '首屏（还没滚动时）可能没有任何小节穿过那条带，需要**默认高亮第一项**。',
      '最后一个短节可能永远滚不到带的位置（后面没有足够内容把它推上去），要给末尾留出额外高度或放宽阈值。',
      '高亮变化不要引起目录自身的高度或字重变化——那会让目录自己跳动，点起来很难受。用颜色与边框而不是 `font-weight` 加粗。',
      '用观察器而不是 `scroll` 事件，是为了避免每帧读 `getBoundingClientRect()`（会强制同步布局）。这一点是性能上的取舍，不是风格偏好。',
    ],
    notes: [
      '`root` 指定成滚动容器（这里是 `.tc-body`），`rootMargin` 才是相对它的。嵌在页面里的长文要把 `root` 留空（相对视口）。',
      '同一机制可以做「图片懒加载」「无限滚动触发」「广告可见性统计」——都是「某元素进入某区域」这一个问题的变体。',
    ],
    _rawRef: 'https://developer.mozilla.org/en-US/docs/Web/API/IntersectionObserver/rootMargin',
    _origin: 'crawl',
  },
]
