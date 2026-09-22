/**
 * 第 4 批采集草稿：材质与布局。
 *
 * 材质靠「光的方位」活着，布局靠「网格语义」活着——这两件事的共同点是
 * 名字里都看不出来，用错时的现象又都很像样式没生效。
 *
 * 用法：
 *   node scripts/prepare-draft.mjs drafts/batch-04.mjs
 *   node scripts/ingest.mjs drafts/batch-04.mjs --dry-run
 *   node scripts/ingest.mjs drafts/batch-04.mjs
 */

const SINCE = '2026-09'

export default [
  /* ────────────────────────────── 材质 ────────────────────────────── */
  {
    slug: 'metal-foil',
    title: '金属箔',
    category: '材质',
    tags: ['金属', '锥形渐变', '高光'],
    since: SINCE,
    source: '机制来自 CSS 锥形渐变，自行实现',
    when: '徽章或标题要一片会反光的金属面，不想用贴图',
    stage: 'dark',
    tier: 'core',
    params: [
      { name: 'from', label: '高光角度', type: 'range', min: 0, max: 360, step: 10, default: 210, unit: 'deg' },
    ],
    description: `一片金色表面，高光沿一个方向拉长，转过某个角度立刻暗下去。

机制是 ==conic-gradient 配密集的明暗硬色标==。金属感的来源不是金色值，是**明暗交替的频率**：真正的金属高光窄而亮、暗部宽而缓，转一圈会有好几次亮暗跳变。锥形渐变让这些跳变绕着中心分布，正好模拟旋转视角下的反光。

把同一套配色放到 \`linear-gradient\` 上，它就只剩一条平滑的渐变 —— 完全不是金属。`,
    code: [
      {
        lang: 'html',
        body: `<div class="mf">
  <span class="mf-mark">MCMXXVI</span>
</div>`,
      },
      {
        lang: 'css',
        body: `.mf {
  display: grid;
  place-items: center;
  width: 150px;
  height: 150px;
  border-radius: 50%;
  /* @mechanism 明暗交替的频率才是金属感，配色只是次要 */
  background: conic-gradient(
    from var(--from, 210deg) at 50% 50%,
    #6b4e17 0%,
    #f7e39b 9%,
    #b8912f 20%,
    #fdf7d0 30%,
    #7a5b1e 42%,
    #e8c86a 54%,
    #a8811f 66%,
    #f4d98a 78%,
    #6b4e17 90%,
    #6b4e17 100%
  );
  box-shadow: inset 0 0 30px rgb(0 0 0 / 0.45);
}

.mf-mark {
  font: 700 17px/1 Georgia, "Times New Roman", serif;
  letter-spacing: 0.12em;
  color: #3b2a08;
  text-shadow: 0 1px 0 rgb(255 245 210 / 0.55);
}`,
      },
    ],
    caveats: [
      '关键是明暗的**频率与不均衡**，不是那一串金色值。色标如果均匀分布，得到的是一圈彩虹环；金属的高光总是窄而亮、暗部宽而缓，所以色标要一紧一松。',
      '`from` 的角度决定了高光的方向。金属是「有方向」的——角度一改，光源位置就变了，不要当成随便调的美化参数。',
      '锥形渐变绕**中心**分布。方形或长条元素上，渐变的中心会露出来，看起来像贴了一张图。圆形或接近圆形的形状最像金属。',
      '它完全静止。真金属的高光随视角移动，这里动不了。想让角度转起来要用 `@property` 把自定义属性注册成 `<angle>` 再过渡，代价是每帧重绘。',
      '深色底上金属最亮眼；浅色底上需要加一圈内阴影把边缘压住，否则像一张贴纸浮在纸上。',
    ],
    notes: [
      '内阴影（`box-shadow: inset`）在这里不是装饰，它给圆盘造出「有厚度」的错觉。',
      '同一套色标换个色系就是银、铜、铬——机制不变，只换颜色。',
    ],
    _rawRef: 'https://developer.mozilla.org/en-US/docs/Web/CSS/gradient/conic-gradient',
    _origin: 'crawl',
  },

  {
    slug: 'light-shaft',
    title: '斜射光柱',
    category: '材质',
    tags: ['光', '模糊', '斜切'],
    since: SINCE,
    source: '自行实现',
    when: '深色场景里要一束从上方斜射下来的光',
    stage: 'dark',
    tier: 'core',
    params: [
      { name: 'skew', label: '倾斜角', type: 'range', min: -40, max: 40, step: 2, default: -18, unit: 'deg' },
    ],
    description: `一束光从右上斜射下来，落在深色底上，边缘是散开的。

机制是 ==一条竖直的亮带 + skewX 拉斜 + 大半径模糊==。亮带本身只是 \`linear-gradient\` 从半透明的暖白渐变到全透明；\`skewX\` 把它压斜；模糊抹掉斜切留下的硬边。光的「射下来」感来自渐变在垂直方向的衰减——上亮下透。

那层模糊是必需的。少了它，你看到的是一块斜着的半透明矩形。`,
    code: [
      {
        lang: 'html',
        body: `<div class="ls">
  <b>一束光</b>
</div>`,
      },
      {
        lang: 'css',
        body: `.ls {
  position: relative;
  display: grid;
  place-items: center;
  width: min(360px, 80vw);
  height: 200px;
  overflow: hidden;
  background: #0a0810;
  font: 600 20px/1 system-ui, sans-serif;
  color: #f4efe2;
}

.ls::before {
  content: "";
  position: absolute;
  top: -35%;
  left: 46%;
  width: 46%;
  height: 170%;
  pointer-events: none;
  /* @mechanism 上亮下透的亮带，斜切后模糊，才像光 */
  background: linear-gradient(180deg, rgb(255 236 194 / 0.55) 0%, transparent 74%);
  transform: skewX(var(--skew, -18deg));
  filter: blur(24px);
  opacity: 0.6;
}`,
      },
    ],
    caveats: [
      '渐变必须**上亮下透明**。两端都亮就成了一根柱子，不是光——那是最容易犯的错。',
      '模糊半径要够大（20px 起）。半径小的时候能看到 `skewX` 留下的硬边，整块看起来是个斜的矩形。',
      '`overflow: hidden` 不能少。光带故意做得比容器高（`height: 170%`），超出的部分要裁掉。',
      '光层必须带 `pointer-events: none`，否则它会盖住下面所有可点、可悬停的东西——出问题时现象是「按钮点不动」。',
      '多条光柱叠在一起时亮度会相加。要更接近真实光，给光层加 `mix-blend-mode: screen`，它按「光的相加」而不是「颜料叠加」来算。',
    ],
    notes: [
      '一束不够就用两束：第二条换个角度、更窄更淡，马上有体积感。',
      '把亮带换成暖色与冷色各一条，就成了「冷暖对切」的舞台光。',
    ],
    _rawRef: 'https://developer.mozilla.org/en-US/docs/Web/CSS/filter-function/blur',
    _origin: 'crawl',
  },

  {
    slug: 'emboss-relief',
    title: '压印浮雕',
    category: '材质',
    tags: ['浮雕', '内阴影', '光向'],
    since: SINCE,
    source: '机制来自 CSS box-shadow 的双向 inset，自行实现',
    when: '按钮或面板要做成被压出来的样子，像纸上盖的钢印',
    stage: 'plain',
    tier: 'core',
    params: [
      { name: 'depth', label: '深浅', type: 'range', min: 1, max: 5, step: 0.5, default: 2, unit: 'px' },
    ],
    description: `一块同色的面板，四周像是从纸里压出来的，左上受光、右下背光。

机制是 ==两条方向相反的 inset 阴影，一明一暗，而且不带模糊==。左上亮、右下暗，等于假设光从左上方来——物体凸起时的受光方式就是这样。把两个方向对调，同一条规则立刻变成「凹下去」的效果。

真正决定成败的是**零模糊**。加一点点模糊半径，刻出来的边就变成了一团光晕，压印感全部消失。`,
    code: [
      {
        lang: 'html',
        body: `<div class="er">
  <button class="er-btn">凸起</button>
  <button class="er-btn er-btn-in">凹下</button>
</div>`,
      },
      {
        lang: 'css',
        body: `.er {
  display: flex;
  gap: 16px;
}

.er-btn {
  padding: 14px 26px;
  border: 0;
  background: #e4dbca;
  font: 600 15px/1 system-ui, sans-serif;
  color: #3a3125;
  cursor: pointer;
  /* @mechanism 两条零模糊的双向 inset 阴影，定的就是光的方向 */
  box-shadow:
    inset var(--depth, 2px) var(--depth, 2px) 0 #fffdf6,
    inset calc(var(--depth, 2px) * -1) calc(var(--depth, 2px) * -1) 0 rgb(60 48 30 / 0.4);
}

/* 同样两条阴影，方向对调就变成凹下 */
.er-btn-in {
  box-shadow:
    inset calc(var(--depth, 2px) * -1) calc(var(--depth, 2px) * -1) 0 #fffdf6,
    inset var(--depth, 2px) var(--depth, 2px) 0 rgb(60 48 30 / 0.4);
  color: rgb(58 49 37 / 0.72);
}`,
      },
    ],
    caveats: [
      '模糊半径必须是 **0**。加上模糊就从「刻出来的边」变成「发光」，是两种完全不同的东西。',
      '光的方向要全局一致。同一页里有的左上亮、有的右下亮，整块界面会显得脏——这是压印做砸最常见的原因。',
      '凸起与凹下是**同一组值的两个方向**。理解这一点就不必记两套参数：对调就是另一种。',
      '亮暗别用纯白纯黑。用同色系的一档亮、一档暗更像真实压印；纯白在深色主题上尤其像划痕。',
      '它靠的是「同色明暗差」，所以底色太浅或太深时对比会消失。底色与阴影色的明度差要够。',
    ],
    notes: [
      '压印与「描边」是两种语言：描边强调轮廓，压印强调体积。同一个按钮上不要都上。',
      '把它和内发光叠起来（压印在外、发光在内）能做出「透过玻璃看到的按钮」，是很多拟物风格的基础。',
    ],
    _rawRef: 'https://developer.mozilla.org/en-US/docs/Web/CSS/box-shadow',
    _origin: 'crawl',
  },

  {
    slug: 'neon-glow',
    title: '霓虹灯管',
    category: '材质',
    tags: ['霓虹', '发光', '文字'],
    since: SINCE,
    source: '机制来自 CSS 多层 text-shadow，自行实现',
    when: '深色招牌上要一行发光的字，像真灯管',
    stage: 'dark',
    tier: 'core',
    params: [
      { name: 'reach', label: '光晕半径', type: 'range', min: 20, max: 120, step: 10, default: 70, unit: 'px' },
    ],
    description: `深底上一行字自己在发光，近处是白亮的芯，远处散开成彩色的雾。

机制是 ==同一颜色叠多层 text-shadow，模糊半径按倍数递增==。真灯管的观感分三级：过曝发白的管芯、管外一圈紧贴的亮晕、更远处弥散的彩雾。一层阴影只能给一个距离的晕，所以必须叠——而且半径要**拉开倍数**，等差的几层会糊成一团分不出层次。

最内那两层用白色是「灯芯」的关键：灯管本体是被拍过曝的。`,
    code: [
      {
        lang: 'html',
        body: `<div class="ng">OPEN</div>`,
      },
      {
        lang: 'css',
        body: `.ng {
  font: 800 52px/1.2 system-ui, sans-serif;
  letter-spacing: 0.16em;
  color: #fff6f9;
  /* @mechanism 多层阴影、半径按倍数拉开，做出灯芯/亮晕/彩雾三级 */
  text-shadow:
    0 0 4px #fff,
    0 0 11px #fff,
    0 0 21px #ff2d95,
    0 0 calc(var(--reach, 70px) * 0.6) #ff2d95,
    0 0 var(--reach, 70px) #ff2d95;
}`,
      },
    ],
    caveats: [
      '**三层是下限。**只写一两层看起来是「有点模糊的字」，霓虹感出不来——发光效果的层次全靠叠。',
      '半径要按倍数递增（4 → 11 → 21 → 40 → 70），不是等差。等差的几层距离太近，晕会连成一片均匀的糊。',
      '最内层用白、外层用彩色，是「灯管」与「灯罩光」的区别。全用同一色会像字被染色了。',
      '文字本身仍是实色。想让笔画内部也发光，得配 `background-clip: text` 或半透明色，但那样对比度会掉、可读性变差。',
      '`text-shadow` 没有扩散半径，只有模糊——所以它永远画不出硬边的光，全是柔的。',
      '浅色底上这套完全不成立。霓虹的前提是深底，浅底上它看起来只是一行脏字。',
    ],
    notes: [
      '把最外层的颜色换成第二种色相（比如紫），会得到「灯管中心是暖的、外围偏冷」的层次，更像真的。',
      '同一招用在 `box-shadow` 上就是发光边框，但阴影不会渗进元素内部，效果不如文字饱满。',
    ],
    _rawRef: 'https://developer.mozilla.org/en-US/docs/Web/CSS/text-shadow',
    _origin: 'crawl',
  },

  {
    slug: 'carbon-weave',
    title: '碳纤维编织',
    category: '材质',
    tags: ['编织', '纹理', '交叉渐变'],
    since: SINCE,
    source: '机制来自 CSS repeating-linear-gradient 的交叉叠加，自行实现',
    when: '面板要一层细密的技术感底纹，不能太平',
    stage: 'dark',
    tier: 'core',
    params: [
      { name: 'cell', label: '花纹大小', type: 'range', min: 4, max: 24, step: 1, default: 10, unit: 'px' },
    ],
    description: `一片深色底纹，细看是一格亮一格暗的斜向编织。

机制是 ==两组方向相反、相位错开的 repeating-linear-gradient 叠加==。单一一组斜线只是「条纹」；两组 ±45° 交叉、并且一组的色标加白、另一组加黑，交叉处才会形成一格亮一格暗的格纹，看出编织的经纬。

\`background-size\` 决定花纹多大，\`repeating-linear-gradient\` 里的长度决定线多宽——两个自由度是分开的，不用互相迁就。`,
    code: [
      {
        lang: 'html',
        body: `<div class="cw">
  <b>编织底</b>
</div>`,
      },
      {
        lang: 'css',
        body: `.cw {
  display: grid;
  place-items: center;
  width: min(340px, 78vw);
  height: 170px;
  background-color: #16161a;
  /* @mechanism 两组反向斜线交叉，一格加白一格加黑才有编织感 */
  background-image:
    repeating-linear-gradient(45deg, rgb(255 255 255 / 0.055) 0 2px, transparent 2px 6px),
    repeating-linear-gradient(-45deg, rgb(0 0 0 / 0.4) 0 2px, transparent 2px 6px);
  /* @mechanism background-size 管花纹大小，与线宽无关 */
  background-size: var(--cell, 10px) var(--cell, 10px);
  font: 500 17px/1 system-ui, sans-serif;
  color: rgb(240 234 217 / 0.86);
}`,
      },
    ],
    caveats: [
      '只有一组斜线时是**条纹**，不是编织。必须两组交叉。',
      '两组的周期要一致。周期不同时交叉点会随位置漂移，看到的是乱纹而不是规整格纹。',
      '亮暗色标要一正一反：一组加白、一组加黑。两组都加白只会平平地叠出一片灰。',
      '线宽低于 1px 时在普通屏上会因取整变成一片灰。想要极细的纹，改用 SVG 的 `pattern` 更可控。',
      '它是一张纯平铺图，没有方向光——所以看起来「平」。要立体感得再叠一层 `linear-gradient` 做整体明暗。',
    ],
    notes: [
      '同一套结构把角度从 ±45° 换成 0°/90° 就是「帆布」，换成 ±60° 是「斜纹布」，机制完全一样。',
      '底色（`background-color`）单独写，改深浅的时候不会碰坏纹理。',
    ],
    _rawRef: 'https://developer.mozilla.org/en-US/docs/Web/CSS/gradient/repeating-linear-gradient',
    _origin: 'crawl',
  },

  /* ────────────────────────────── 图形 ────────────────────────────── */
  {
    slug: 'hand-drawn-wobble',
    title: '手绘抖线',
    category: '图形',
    tags: ['手绘', '滤镜', '位移'],
    since: SINCE,
    source: '机制来自 SVG feDisplacementMap，自行实现',
    when: '规整的边框和图形想变成手绘的，但不想重画路径',
    stage: 'plain',
    tier: 'candidate',
    // 不给「抖动幅度」滑杆：scale 是 SVG 滤镜属性，不是 CSS 属性，
    // 定义在外面的 <filter> 收不到元素的 CSS 变量。摆一个拖了没反应的滑杆更糟。
    params: [],
    description: `方框的边不再笔直，圆的轮廓不太圆，看起来是徒手画的。

机制是 ==feDisplacementMap 用一张噪声图去「挪」源图形的每个像素==。噪声的数值决定这一点往哪挪、挪多远，于是直线弯了、圆鼓了、边框抖了。用的是 \`fractalNoise\`（分形噪声），所以抖动本身粗细有层次，不像随机像素那么刺。

这是给**任意元素**加手绘感的最短路径：不用手绘 SVG 路径，也不用准备三套边框图片。`,
    code: [
      {
        lang: 'html',
        body: `<svg width="0" height="0" aria-hidden="true" focusable="false">
  <filter id="sb-wobble">
    <feTurbulence type="fractalNoise" baseFrequency="0.018" numOctaves="3" seed="7" result="noise" />
    <feDisplacementMap in="SourceGraphic" in2="noise" scale="5" xChannelSelector="R" yChannelSelector="G" />
  </filter>
</svg>

<div class="hw">
  <b>手绘方框</b>
  <p>它其实还是矩形，只是像素被挪了。</p>
</div>`,
      },
      {
        lang: 'css',
        body: `.hw {
  width: min(330px, 78vw);
  padding: 24px 26px;
  border: 3px solid #b4462f;
  background: rgb(255 255 255 / 0.42);
  font: 400 14px/1.7 system-ui, sans-serif;
  color: #1c1a17;
  /* @mechanism 噪声把像素挪开，直线因此变弯 */
  filter: url(#sb-wobble);
}

.hw b {
  display: block;
  margin-bottom: 6px;
  font-size: 19px;
  font-weight: 700;
}

.hw p {
  margin: 0;
  opacity: 0.7;
}`,
      },
    ],
    caveats: [
      '`scale` 是抖动幅度。2–6 之间才是「手绘」，超过 10 形状会散架，边框会断成几截。',
      '`baseFrequency` 决定抖动的**波长**：小值给长波（像徒手画的慢弯），大值给细毛边（像炭笔）。两个参数要配合着调，只调 `scale` 出不来笔感。',
      '位移作用在**整个元素**上，包括里面的文字。文字上只能用很小的值，否则笔画会粘连在一起糊掉。',
      'SVG 滤镜会创建新的合成层，在部分引擎上还会把结果栅格化——放大后能看到像素感，且大面积实时动画会明显掉帧。',
      '不同引擎的滤镜插值实现不同，输出**不会逐像素一致**。跨浏览器一样好看，但不可能一模一样。',
      '`filter` 会创建包含块，里面的 `position: fixed` 子元素会失效——滤镜的经典副作用。',
      '**抖动幅度做不成 CSS 变量。**`scale` 是 SVG 滤镜属性，不是 CSS 属性；定义在外面的 `<filter>` 也收不到使用元素的 CSS 变量。所以这一条没有滑杆——摆一个拖了不动的滑杆比没有更糟。要让它可调只能复制出几份不同参数的滤镜，按类名切换。',
    ],
    notes: [
      '`seed` 换个数字就是另一种手感，做多个「手绘」元素时给不同的种子，免得抖得一模一样。',
      '同一招也能用在图片上做「水彩边」：加大 `scale` 并配一个较大的 `baseFrequency`。',
      '和「滤镜噪点质感」是同一个根因：但凡是 SVG 滤镜里的参数，CSS 变量都够不到。',
    ],
    _rawRef: 'https://developer.mozilla.org/en-US/docs/Web/SVG/Element/feDisplacementMap',
    _origin: 'crawl',
  },

  /* ────────────────────────────── 布局 ────────────────────────────── */
  {
    slug: 'masonry-columns',
    title: '多列瀑布流',
    category: '布局',
    tags: ['瀑布流', '多列', '不等高'],
    since: SINCE,
    source: '机制来自 CSS Multi-column Layout，自行实现',
    when: '一组高矮不一的卡片要紧凑排成几列，不留大洞',
    stage: 'plain',
    tier: 'core',
    params: [
      { name: 'col', label: '列宽下限', type: 'range', min: 100, max: 240, step: 10, default: 150, unit: 'px' },
    ],
    description: `几张高矮不一的卡片排成三列，每列自己往下接，底部基本齐平。

机制是 ==columns 把内容切进若干列，浏览器按高度去均衡==。这不是 grid——grid 里同一行的卡片高度是统一的，做不出参差。多列布局的均衡是浏览器算的，不需要 JS 测高度。

代价在阅读顺序上：列是**先填满一列再填下一列**，不是从左往右逐行。`,
    code: [
      {
        lang: 'html',
        body: `<div class="mc">
  <article class="mc-card">一<br />短</article>
  <article class="mc-card mc-tall">二<br />高一些<br />再高一点</article>
  <article class="mc-card">三</article>
  <article class="mc-card mc-tall">四<br />也高</article>
  <article class="mc-card">五</article>
  <article class="mc-card">六</article>
</div>`,
      },
      {
        lang: 'css',
        body: `.mc {
  /* @mechanism 列数自适应，浏览器按高度均衡分配 */
  columns: var(--col, 150px);
  column-gap: 12px;
  width: min(500px, 86vw);
}

.mc-card {
  /* @mechanism 不加这条，卡片会被从中间劈到两列 */
  break-inside: avoid;
  margin: 0 0 12px;
  padding: 16px;
  border: 1px solid rgb(60 48 30 / 0.28);
  background: rgb(255 255 255 / 0.44);
  font: 400 14px/1.6 system-ui, sans-serif;
  color: #1c1a17;
}

.mc-tall {
  padding-bottom: 44px;
}`,
      },
    ],
    caveats: [
      '列是**从上往下填满一列再填下一列**，不是逐行从左到右。阅读顺序是竖着走的——要求按行顺序就不能用它，这是它最硬的限制。',
      '每一项必须 `break-inside: avoid`。少了它，一张卡片会被从中间劈开，上半截在一列底部、下半截在另一列顶部。',
      '它没有真正的跨列。`column-span` 只有 `all` 和 `none` 两个值，做不出「跨两列」的中间态。',
      '均衡是按**高度**算的。最后几项很少时会出现一列明显比其他列短，看着像没排满。',
      '`overflow: hidden` 或某些 `transform` 会改变断行行为，可能让卡片意外断裂或整体挪到下一列。',
      '顺序对读屏友好度不好：DOM 里第 2 项可能视觉上在第 3 项下面。要严格顺序就退回 grid。',
    ],
    notes: [
      '`columns` 写单个长度就是「列宽下限」，写两个值（`3 150px`）就是「最多 3 列、且每列不小于 150px」。',
      '同一招也是排版里做「多栏正文」的办法，把 `break-inside` 换成 `orphans`/`widows` 的控制即可。',
    ],
    _rawRef: 'https://developer.mozilla.org/en-US/docs/Web/CSS/columns',
    _origin: 'crawl',
  },

  {
    slug: 'dense-grid',
    title: '自动填空的网格',
    category: '布局',
    tags: ['网格', '密集', '自动放置'],
    since: SINCE,
    source: '机制来自 CSS Grid 的 grid-auto-flow: dense，自行实现',
    when: '网格里有大小不一的块，不希望大块后面留下空洞',
    stage: 'grid',
    tier: 'core',
    params: [],
    description: `大块占用两个格位，后面的小块会自动回头把大块留下的空洞填上。

机制是 ==grid-auto-flow: dense 允许自动放置算法回头扫描==。默认的 \`row\` 是「按顺序找下一个能放下的位置」，遇到放不下的就让开、留空；\`dense\` 让它回头去补前面的洞。这是同一个算法的两种策略，不是一个新特性。

代价很明确：视觉顺序与 DOM 顺序脱钩了。`,
    code: [
      {
        lang: 'html',
        body: `<div class="dg">
  <div class="dg-cell dg-wide">宽</div>
  <div class="dg-cell">1</div>
  <div class="dg-cell">2</div>
  <div class="dg-cell dg-tall">高</div>
  <div class="dg-cell">3</div>
  <div class="dg-cell">4</div>
  <div class="dg-cell dg-wide">宽</div>
  <div class="dg-cell">5</div>
  <div class="dg-cell">6</div>
  <div class="dg-cell">7</div>
</div>`,
      },
      {
        lang: 'css',
        body: `.dg {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  /* @mechanism 允许算法回头补前面的空洞 */
  grid-auto-flow: dense;
  grid-auto-rows: 56px;
  gap: 8px;
  width: min(420px, 84vw);
}

.dg-cell {
  display: grid;
  place-items: center;
  background: rgb(255 255 255 / 0.46);
  border: 1px solid rgb(60 48 30 / 0.26);
  font: 500 14px/1 system-ui, sans-serif;
  color: #1c1a17;
}

.dg-wide {
  grid-column: span 2;
}

.dg-tall {
  grid-row: span 2;
}`,
      },
    ],
    caveats: [
      '视觉顺序与 DOM 顺序会**不一致**：键盘 Tab 与读屏按 DOM 走，于是焦点会跳来跳去。这是它最实际的代价，无障碍上要慎重评估。',
      '它是「尽力填空」，不是「完美排列」。只有当确实存在能放下的项时才会回头补。',
      '洞太大、或剩下的项都放不进去时，洞依然留着。',
      '必须配 `grid-auto-rows`（或行高定义）才会有不等高的块；只定义列的话所有块一样高，就没有洞可补，`dense` 也就看不出作用。',
      '可预测性下降：做入场动画、滚动定位、或者「第 N 个元素」这类逻辑时，视觉位置与索引对不上。',
    ],
    notes: [
      '默认值是 `grid-auto-flow: row`。加 `dense` 之前先确认你真的愿意牺牲顺序——它治的是洞，不是排布难看。',
      '`column dense` 是另一个方向（按列填充并回头补），适合横向滚动的看板。',
    ],
    _rawRef: 'https://developer.mozilla.org/en-US/docs/Web/CSS/grid-auto-flow',
    _origin: 'crawl',
  },

  {
    slug: 'cqi-typescale',
    title: '跟着容器缩放的排版',
    category: '布局',
    tags: ['容器查询', '单位', '字号'],
    since: SINCE,
    source: '机制来自 CSS Containment 的容器查询长度单位，自行实现',
    when: '同一个卡片组件要放进宽窄不同的槽位，字号得跟着槽位走',
    stage: 'grid',
    tier: 'core',
    params: [
      { name: 'scale', label: '缩放比例', type: 'range', min: 1, max: 6, step: 0.5, default: 3, unit: 'cqi' },
    ],
    description: `同一个卡片放进窄栏时字号自动变小，放进全宽区块时跟着变大——跟着**容器**，不是窗口。

机制是 ==cqi 表示「容器宽度的百分之一」==。用 \`vw\` 时字号跟着视口走：一张 240px 宽的卡片放在大屏上会拿到按整屏算出来的巨大字号，直接撑破。\`cqi\` 把参照物换成最近的那个容器查询祖先，于是同一份 CSS 在任何宽度的槽位里都保持比例。

前提是祖先上要声明 \`container-type\`——不声明，\`cqi\` 会回退成视口单位，得到完全不是你想要的结果。`,
    code: [
      {
        lang: 'html',
        body: `<div class="cq-row">
  <div class="cq-slot cq-narrow">
    <div class="cq-card"><b>窄栏</b><p>字号跟着这一格走。</p></div>
  </div>
  <div class="cq-slot cq-wide">
    <div class="cq-card"><b>宽栏</b><p>同一份 CSS，字号更大。</p></div>
  </div>
</div>`,
      },
      {
        lang: 'css',
        body: `.cq-row {
  display: grid;
  grid-template-columns: 1fr 2fr;
  gap: 14px;
  width: min(520px, 86vw);
}

.cq-slot {
  /* @mechanism 没有这句，cqi 会回退成视口单位 */
  container-type: inline-size;
}

.cq-card {
  padding: 16px;
  border: 1px solid rgb(60 48 30 / 0.28);
  background: rgb(255 255 255 / 0.44);
  color: #1c1a17;
}

.cq-card b {
  display: block;
  /* @mechanism 字号按容器宽度算，再加 clamp 兜上下限 */
  font-size: clamp(14px, var(--scale, 3cqi), 30px);
  font-weight: 700;
}

.cq-card p {
  margin: 6px 0 0;
  font: 400 13px/1.6 system-ui, sans-serif;
  opacity: 0.7;
}`,
      },
    ],
    caveats: [
      '祖先必须声明 `container-type: inline-size`。少了它，`cqi` 会**回退成视口单位**——不报错，只是尺寸完全不对，这个坑很难自己看出来。',
      '`cqi` 参照的是**最近的**容器查询祖先。中间若嵌了另一个容器，参照物就换了，效果会莫名其妙地变小。',
      '`container-type: inline-size` 会让该元素的宽度**不再由内容决定**（只看外部约束）。对原本靠内容撑开的盒子是实打实的行为改变。',
      '单位本身没有上下限。不套 `clamp()` 的话，小容器里会小到看不清、大容器里会大到溢出。',
      '它在「同一组件放进多种槽位」时才比 `rem` + 断点更划算。普通正文用固定字号仍然是最稳的选择——别为了新而用。',
    ],
    notes: [
      '`cqi` 是宽度（inline 轴），`cqb` 是高度（block 轴）。做流式字号用 `cqi`，做「按高度缩放」的插图才用 `cqb`。',
      '配 `clamp()` 时下限用 `rem`（尊重用户字号设置）、中间用 `cqi`、上限用 `rem`，是无障碍上比较稳的组合。',
    ],
    _rawRef: 'https://developer.mozilla.org/en-US/docs/Web/CSS/CSS_containment/Container_queries',
    _origin: 'crawl',
  },

  {
    slug: 'full-bleed',
    title: '通栏突破',
    category: '布局',
    tags: ['通栏', '网格', '正文'],
    since: SINCE,
    source: '机制来自 CSS Grid 的命名列与跨列，自行实现',
    when: '正文要窄栏好读，但图、色块和引用要突破到整屏宽',
    stage: 'plain',
    tier: 'core',
    params: [
      { name: 'measure', label: '正文宽度', type: 'range', min: 30, max: 80, step: 2, default: 54, unit: 'ch' },
    ],
    description: `正文是窄窄一栏，读起来舒服；该通栏的图和色块一路铺到两边。

机制是 ==三列网格：内容默认走中间列，要突破的项跨三列==。中列定下阅读宽度，两侧的 \`1fr\` 是剩余空间（也就是留白）。同一套网格里于是有了「正文宽度」和「整屏宽度」两个语义，突破只是换一条 \`grid-column\`。

比负 margin 方案好在：不需要知道侧栏有多宽，也不用给每个通栏元素写单独的外层。`,
    code: [
      {
        lang: 'html',
        body: `<div class="fb">
  <p>正文落在中间那一列。窄栏读起来省力，这是排版的老规矩。</p>
  <p class="fb-wide">这一块跨了三列，于是它铺到了两边。</p>
  <p>回到正文。同一套网格里同时存在两种宽度。</p>
</div>`,
      },
      {
        lang: 'css',
        body: `.fb {
  display: grid;
  /* @mechanism 中列定阅读宽度，两侧 1fr 是留白 */
  grid-template-columns:
    1fr
    min(var(--measure, 54ch), 100% - 3rem)
    1fr;
  width: min(640px, 88vw);
  font: 400 15px/1.85 system-ui, sans-serif;
  color: #1c1a17;
}

.fb > * {
  grid-column: 2;
}

.fb-wide {
  /* @mechanism 跨三列 = 突破到通栏 */
  grid-column: 1 / -1;
  margin: 14px 0;
  padding: 20px 24px;
  background: #efe9dd;
  border-left: 3px solid #b4462f;
  font-weight: 600;
}`,
      },
    ],
    caveats: [
      '`min()` 里的 `100% - 3rem` 是**两侧合计**的留白，不是单侧。想要单侧 1.5rem 就得写 `100% - 3rem`，写 `1.5rem` 的话中列会贴着边。',
      '两侧的 `1fr` 是「剩余空间」。窄屏上没有剩余时它会被压成 0，留白就消失了——这就是 `min()` 里那个 `100% - 3rem` 存在的理由。',
      '它是接近全宽，但**不是严格的 100vw**（父容器决定了真实宽度）。要真贴视口边得配负 margin + `100vw`，而 `100vw` 在移动端包含滚动条宽度，会横向溢出。',
      '通栏元素是子元素，它的宽度由网格决定。塞进去一个自己的 `width: 100vw` 会立刻溢出——两者是替代关系。',
      '只写两列的话做不出「一侧突破」（比如图只往右伸）。那需要更多列或命名网格线，代码会长得多。',
    ],
    notes: [
      '把 `grid-template-columns` 换成命名线（`[full-start] ... [content-start] ... [content-end] ... [full-end]`）可读性会好很多，尤其是有多个突破层级时。',
      '`ch` 单位是按「0」的宽度算的，中文正文字数会与 `ch` 不符——中文场景用 `em` 或直接写 `rem` 更准。',
    ],
    _rawRef: 'https://developer.mozilla.org/en-US/docs/Web/CSS/grid-template-columns',
    _origin: 'crawl',
  },

  {
    slug: 'scroll-shadow',
    title: '有内容时自己出现的滚动阴影',
    category: '布局',
    tags: ['滚动', '阴影', '背景附着'],
    since: SINCE,
    source: '机制来自 CSS background-attachment 的 local 值，自行实现',
    when: '可滚动区域的上下边缘要提示「这里还有内容」，但滚到底时提示要自动消失',
    stage: 'plain',
    tier: 'core',
    params: [],
    description: `列表上方有一条阴影提示上面还有内容，滚到顶它自己消失；底部同理。

机制是 ==background-attachment: local 让背景跟着内容滚，scroll 让它钉在容器上==。前面两层 \`local\` 是不透明色块（遮挡层），后面两层 \`scroll\` 是阴影。内容没滚时，\`local\` 色块正好压在阴影位置上把它盖住；一旦滚动，色块跟着内容移开，阴影就露出来。

判断「能不能滚」这件事本来就是浏览器的强项。这里只是把它借过来当条件用，零 JS。`,
    code: [
      {
        lang: 'html',
        body: `<div class="ss">
  <p>上面的阴影只在能往上滚时出现。</p>
  <p>继续往下滚。</p>
  <p>再往下。</p>
  <p>滚到底部，下面的阴影会消失。</p>
  <p>而中间过程两侧都有。</p>
  <p>这是一段足够长的内容。</p>
  <p>最后一行。</p>
</div>`,
      },
      {
        lang: 'css',
        body: `.ss {
  width: min(340px, 78vw);
  height: 180px;
  overflow-y: auto;
  padding: 0 16px;
  /* @mechanism local 跟着内容滚、scroll 钉在容器上 */
  background:
    linear-gradient(#efe9dd 30%, rgb(239 233 221 / 0)) local,
    linear-gradient(rgb(239 233 221 / 0), #efe9dd 70%) local,
    radial-gradient(farthest-side at 50% 0, rgb(40 30 14 / 0.3), rgb(40 30 14 / 0)) scroll,
    radial-gradient(farthest-side at 50% 100%, rgb(40 30 14 / 0.3), rgb(40 30 14 / 0)) scroll;
  background-repeat: no-repeat;
  background-size: 100% 40px, 100% 40px, 100% 14px, 100% 14px;
  background-attachment: local, local, scroll, scroll;
  font: 400 14px/1.9 system-ui, sans-serif;
  color: #1c1a17;
}

.ss p {
  margin: 0 0 12px;
}`,
      },
    ],
    caveats: [
      '两层 `local`（遮挡）必须写在**前面**、两层 `scroll`（阴影）在后面。背景是前面的画在上面，顺序写反就什么都看不到。',
      '`background-size` 的高度（40px）必须**大于**阴影层的高度（14px），否则遮不住，阴影会一直露着。',
      '遮挡层必须是**不透明**的实色。半透明盖不住阴影——用 `rgb(239 233 221 / 0)` 而不是 `transparent` 是为了让过渡更平滑，但关键的那个色标位置要完全不透明。',
      '容器的 `background-color` 不能再写：它画在所有背景之下，会与这套冲突。底色直接并进遮挡层的渐变色里。',
      '横向滚动要另外加一组 `90deg` 的渐变，四边齐全就是八层背景，代码很啰嗦——只在真的需要时做。',
      '系统的滚动条样式会影响观感（overlay 滚动条不占宽度），但机制本身不受影响。',
    ],
    notes: [
      '这套是「纯 CSS 条件渲染」的经典案例：把「能不能滚」这个浏览器已知的状态，通过背景跟随与否转换成可见的差异。',
      '现代做法是 `scroll-driven animations` + `animation-timeline: scroll()`，但那个支持面比这套窄。',
    ],
    _rawRef: 'https://developer.mozilla.org/en-US/docs/Web/CSS/background-attachment',
    _origin: 'crawl',
  },

  {
    slug: 'aspect-ratio-box',
    title: '按比例占位，防抖动',
    category: '布局',
    tags: ['比例', '防抖动', '图片'],
    since: SINCE,
    source: '机制来自 CSS aspect-ratio，自行实现',
    when: '图片还没加载，但版面不能等它；加载完也不能把下面的内容顶走',
    stage: 'grid',
    tier: 'core',
    params: [
      { name: 'ratio', label: '高宽比', type: 'range', min: 0.5, max: 2, step: 0.05, default: 0.62 },
    ],
    description: `图片还没到，位置已经留好了；图片加载完，周围的东西纹丝不动。

机制是 ==给盒子声明一个只由宽度决定的高度比例==。图片加载前它的高度是 0，加载完高度突然出现，下面的内容被整体推下去——这就是布局位移。声明比例之后，高度在图片到达之前就已经确定，没有东西需要挪。

比例的作用不是「好看」，是**提前把高度定下来**。`,
    code: [
      {
        lang: 'html',
        body: `<div class="ar">
  <div class="ar-box">
    <div class="ar-inner">图片位</div>
  </div>
  <p>这块的高度在内容到达前就已经定了。</p>
</div>`,
      },
      {
        lang: 'css',
        body: `.ar {
  width: min(300px, 76vw);
  font: 400 14px/1.7 system-ui, sans-serif;
  color: #1c1a17;
}

.ar-box {
  /* @mechanism 比例把高度提前定下来，内容到达时不必重排 */
  aspect-ratio: var(--ratio, 1.6);
  width: 100%;
  border: 1px solid rgb(60 48 30 / 0.3);
  background: rgb(255 255 255 / 0.5);
  overflow: hidden;
}

.ar-inner {
  display: grid;
  place-items: center;
  height: 100%;
  background: repeating-linear-gradient(
    45deg,
    rgb(60 48 30 / 0.09) 0 8px,
    rgb(60 48 30 / 0) 8px 16px
  );
  font: 400 13px/1 system-ui, sans-serif;
  color: rgb(28 26 23 / 0.6);
}`,
      },
    ],
    caveats: [
      '`aspect-ratio` 的参照轴取决于**另一个轴是不是自动的**。宽高都写死了，比例就失效——它不是「强制」，是「补一个缺的值」。',
      '内容超出比例框时会**溢出**，不会把框撑大（`overflow: hidden` 能裁掉，但内容就没了）。它管的是盒子尺寸，不管内容。',
      '它是长期占位方案，**不能替代图片的 `width` / `height` 属性**。后者在图片字节到达前浏览器就能读到，防抖效果更早、更好。两者都写是最稳的。',
      '图片本体还要配 `object-fit: cover`，否则会被拉伸变形——比例框负责框，`object-fit` 负责图。',
      '比例写在**容器**上比写在 `<img>` 上更可控：图片被换掉时比例不会跟着变。',
    ],
    notes: [
      '`aspect-ratio: 16 / 9` 与 `aspect-ratio: 1.777` 等价，但分数写法更易读、也更精确。',
      '同一招给占位块用，就是骨架屏里防抖动的那一层。',
    ],
    _rawRef: 'https://developer.mozilla.org/en-US/docs/Web/CSS/aspect-ratio',
    _origin: 'crawl',
  },

  {
    slug: 'field-sizing',
    title: '输入框随内容自己变宽',
    category: '布局',
    tags: ['表单', '自适应', '输入框'],
    since: SINCE,
    source: '机制来自 CSS field-sizing，自行实现',
    when: '用户边打边看，输入框要跟着内容长，而不是把字藏起来',
    stage: 'plain',
    tier: 'candidate',
    params: [],
    description: `输入框一开始只有几个字宽，你越打它越长，打下的每一个字都在框里。

机制是 ==field-sizing: content 让输入类元素按内容算尺寸==。输入框默认的宽度由 \`size\` 属性定，是个固定值——文字超出就横向滚动，你看不全自己写的东西。这个属性把宽度交给内容决定，\`textarea\` 同时获得「按行数长高」的能力。

它是「内容决定尺寸」这条原则第一次进到表单控件里。`,
    code: [
      {
        lang: 'html',
        body: `<label class="fs">
  边打边长
  <input class="fs-input" value="打几个字试试" />
</label>
<label class="fs">
  多行也会长高
  <textarea class="fs-area" rows="1">换行看看</textarea>
</label>`,
      },
      {
        lang: 'css',
        body: `.fs {
  display: grid;
  gap: 6px;
  width: min(360px, 80vw);
  margin-bottom: 14px;
  font: 400 13px/1.5 system-ui, sans-serif;
  color: #1c1a17;
}

.fs-input,
.fs-area {
  /* @mechanism 宽度由内容决定，不再是固定值 */
  field-sizing: content;
  /* @mechanism 上下限不可少，否则会缩成一条线或撑破容器 */
  min-width: 8ch;
  max-width: 100%;
  padding: 10px 12px;
  border: 1px solid rgb(60 48 30 / 0.35);
  background: rgb(255 255 255 / 0.52);
  font: 400 15px/1.5 system-ui, sans-serif;
  color: #1c1a17;
  resize: none;
}`,
      },
    ],
    caveats: [
      '`min-width` 不能少。没有下限时，空输入框会缩成一条细线，用户连点都点不到——这是它最现实的坑。',
      '`max-width` 同样不能少，否则长文本会把容器撑破。两个上下限要一起给。',
      '支持面很新（Chrome 123 之后）。不支持时输入框保持原来的固定宽度，**不会破版**——可接受的降级。',
      '`textarea` 上它会同时长高，可能把下面的按钮顶走。只想要「宽」不想要「高」的话，这意味着它可能不适合你的表单。',
      '一排自动宽度的输入框会**参差不齐**（每个按自己的内容定宽）。要么接受这种错落，要么给它们一个共同的下限。',
    ],
    notes: [
      '它和 `size` 属性冲突：`size` 是固定值、`field-sizing: content` 是内容驱动，后者会盖过前者。',
      '做「标签即输入框」的界面（比如待办列表、标签编辑器）时它特别合适——每行宽度等于那行文字的长度。',
    ],
    _rawRef: 'https://developer.mozilla.org/en-US/docs/Web/CSS/field-sizing',
    _origin: 'crawl',
  },

  {
    slug: 'anchor-position',
    title: '声明式锚点定位',
    category: '布局',
    tags: ['锚点', '浮层', '定位'],
    since: SINCE,
    source: '机制来自 CSS Anchor Positioning 规范，自行实现',
    when: '提示气泡要贴住触发它的那个元素，而且放不下时要自动翻到另一边',
    stage: 'dark',
    tier: 'candidate',
    params: [],
    description: `提示气泡贴住按钮的右下角，靠边时自动翻到另一侧——定位这件事第一次不需要 JS 算坐标。

机制是 ==给触发元素起一个锚名，浮层用 anchor() 引用它的边==。\`anchor(bottom)\` 的含义是「那个元素的下边缘」，浮层不是在说「我在 (128, 340)」，而是在说「我的上边贴住它的下边」。位置关系变成声明式的，浏览器负责解算。

\`position-try-fallbacks\` 是这个机制真正的价值：溢出时自动换边，自己写要几百行。`,
    code: [
      {
        lang: 'html',
        body: `<div class="ap-row">
  <button class="ap-btn">触发器</button>
  <div class="ap-tip">我贴住它</div>
</div>`,
      },
      {
        lang: 'css',
        body: `.ap-row {
  position: relative;
  display: flex;
  justify-content: center;
  width: min(360px, 80vw);
  height: 170px;
  padding-top: 40px;
}

.ap-btn {
  /* @mechanism 给元素起锚名，浮层就能引用它的边 */
  anchor-name: --ap-trigger;
  align-self: flex-start;
  padding: 11px 20px;
  border: 1px solid rgb(255 255 255 / 0.22);
  background: rgb(255 255 255 / 0.07);
  font: 500 14px/1 system-ui, sans-serif;
  color: #f0ead9;
  cursor: pointer;
}

.ap-tip {
  /* @mechanism 用锚点的边定位，而不是算出来的坐标 */
  position: absolute;
  position-anchor: --ap-trigger;
  top: anchor(bottom);
  left: anchor(left);
  margin-top: 10px;
  /* @mechanism 放不下时自动翻到另一侧 */
  position-try-fallbacks: flip-block;
  padding: 9px 14px;
  border: 1px solid rgb(180 70 47 / 0.55);
  background: #1b1626;
  font: 400 13px/1.5 system-ui, sans-serif;
  color: #f0ead9;
  white-space: nowrap;
}`,
      },
    ],
    caveats: [
      '支持面还窄。不支持的浏览器会把 `anchor-name` 当未知属性忽略，浮层**掉回原来的定位**（这里是 `position: relative` 的行内位置）——必须给它一个合理的默认落脚点。',
      '`anchor(bottom)` 引用的是锚点的**边**，不是坐标或偏移量。它和 `bottom: 10px` 的语义完全不同，混起来会调不明白。',
      '锚点元素被移除时引用立即失效，浮层会回到默认位置。所以默认位置要能看，别把它当成「不会发生的情况」。',
      '它不改变裁剪行为：浮层若在某个 `overflow: hidden` 的祖先里，照样会被裁掉。（`popover` 走顶层，不受这个限制。）',
      '`position-try-fallbacks` 需要配合 `position-try-order` 或默认的空间判断才有效果；只写它、侧向空间又够的话，是看不出作用的。',
    ],
    notes: [
      '它和 `popover` 是天然一对：`popover` 负责顶层与关闭行为，锚点定位负责贴住触发元素。',
      '多锚点（浮层同时引用两个元素的边）是规范里更进阶的用法，做「在两点之间画一条连线」这类界面才需要。',
    ],
    _rawRef: 'https://developer.mozilla.org/en-US/docs/Web/CSS/CSS_anchor_positioning',
    _origin: 'crawl',
  },
]
