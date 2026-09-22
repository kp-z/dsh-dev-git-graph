/**
 * 第 7 批采集草稿：材质与布局进阶。
 *
 * 材质这一批的共同点是「光怎么落在表面上」——高光的位置、色相是否移动、
 * 表面是否有微结构。布局这一批是「宽度与顺序该由什么决定」。
 *
 * 用法：
 *   node scripts/prepare-draft.mjs drafts/batch-07.mjs
 *   node scripts/ingest.mjs drafts/batch-07.mjs --dry-run
 *   node scripts/ingest.mjs drafts/batch-07.mjs
 */

const SINCE = '2026-09'

export default [
  /* ────────────────────────────── 材质 ────────────────────────────── */
  {
    slug: 'dither-anti-banding',
    title: '用噪点打散色带',
    category: '材质',
    tags: ['噪点', '色带', '渐变色深'],
    since: SINCE,
    source: '机制来自 openColorIO 与 Dither 的经典做法，自行实现',
    when: '大面积渐变上出现一道道可见的同心色带',
    stage: 'dark',
    tier: 'core',
    params: [
      { name: 'amount', label: '噪点强度', type: 'range', min: 0, max: 20, step: 1, default: 7, unit: '%' },
    ],
    description: `大块渐变上的那一圈圈色带不见了，过渡变成连续的一片。

机制是 ==加一层极细的随机噪点，把色阶的边界打散==。色带的成因是色深：8 位通道只有 256 级，两个相邻色阶之间的跳变在这么大的面积上会被人眼连成一条线。噪点让每个像素在边界附近各自随机偏一点，人眼就把「线」读成了「颗粒」，而颗粒是连续的。

关键在**极细、极低透明度**。看得见噪点就说明加多了。`,
    code: [
      {
        lang: 'html',
        body: `<svg width="0" height="0" aria-hidden="true" focusable="false">
  <filter id="sb-dither">
    <feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" stitchTiles="stitch" />
  </filter>
</svg>

<div class="dt-panel">
  <div class="dt-band"></div>
  <span class="dt-hint">这块渐变上有一层噪点，只是看不见</span>
</div>`,
      },
      {
        lang: 'css',
        body: `.dt-panel {
  position: relative;
  display: grid;
  align-content: end;
  justify-items: center;
  width: min(360px, 82vw);
  height: 210px;
  overflow: hidden;
  background: #0a0810;
  font: 400 12px/1.6 system-ui, sans-serif;
  color: rgb(240 234 217 / 0.7);
}

.dt-band {
  position: absolute;
  inset: 0;
  background: radial-gradient(120% 90% at 30% 20%, #3b2f5e 0%, #0a0810 72%);
}

.dt-band::after {
  content: "";
  position: absolute;
  inset: 0;
  /* @mechanism 极细噪点打散色阶边界，人眼读成颗粒而非色带 */
  filter: url(#sb-dither);
  opacity: var(--amount, 7%);
  /* @mechanism overlay 让噪点只做明暗微扰，不改变整体色相 */
  mix-blend-mode: overlay;
}

.dt-hint {
  position: relative;
  margin-bottom: 14px;
  text-align: center;
}`,
      },
    ],
    caveats: [
      '噪点的量必须**极低**（5%–10%）。看得见颗粒就说明加多了，那就从「治色带」变成了「脏」。',
      '`mix-blend-mode: overlay` 让噪点只做明暗微扰、不动色相。换成普通叠加会整体变灰。',
      '它治的是**色深不足**造成的色带，不是所有色带。如果渐变本身有色标安排不当（比如两个色标挨得太近），加噪点只是把问题盖住。',
      '`stitchTiles="stitch"` 让滤镜平铺时接缝不露；大区域上不加它会在块的边界看到接缝。',
      '它是有代价的：滤镜会创建合成层，大面积上会占显存。治色带优先考虑的是**减少渐变面积或提高色标密度**，噪点是最后一步。',
    ],
    notes: [
      '这个做法在视频与游戏渲染里叫 dithering，已经有几十年历史——不是 CSS 的技巧，是通用的手段。',
      '它和「滤镜噪点质感」的分工：那一条要的是**看得见的材质颗粒**，这一条要的是**看不见的色阶平滑**。',
    ],
    _rawRef: 'https://developer.mozilla.org/en-US/docs/Web/CSS/mix-blend-mode',
    _origin: 'crawl',
  },

  {
    slug: 'specular-highlight',
    title: '镜面高光的位置',
    category: '材质',
    tags: ['高光', '光源', '拟物'],
    since: SINCE,
    source: '自行实现',
    when: '色块看起来是平的，想让它有一点「表面朝向」',
    stage: 'dark',
    tier: 'core',
    params: [
      { name: 'size', label: '高光大小', type: 'range', min: 20, max: 80, step: 5, default: 44, unit: '%' },
    ],
    description: `一块深色面板，左上角有一团柔和的白，看起来鼓起来了一点。

机制是 ==高光的形状是光源形状的镜像，位置则说明了表面的朝向==。一个圆润的亮斑放在受光侧的角上，人眼立刻把它读成「这块面朝左上」。这是拟物材质里成本最低、收益最明显的一步。

高光要**软**。硬边的高光看起来是贴了一张白纸，不是反光。`,
    code: [
      {
        lang: 'html',
        body: `<div class="sh">
  <span class="sh-hint">光从左上来</span>
</div>`,
      },
      {
        lang: 'css',
        body: `.sh {
  position: relative;
  display: grid;
  place-items: center;
  width: min(230px, 70vw);
  height: 160px;
  border-radius: 6px;
  /* @mechanism 高光斑放在受光侧的角上，表面就有了朝向 */
  background:
    radial-gradient(
      var(--size, 44%) var(--size, 44%) at 22% 16%,
      rgb(255 250 236 / 0.5) 0%,
      rgb(255 250 236 / 0.12) 42%,
      rgb(255 250 236 / 0) 72%
    ),
    linear-gradient(155deg, #2c2440 0%, #14101f 70%);
  box-shadow: 0 20px 40px rgb(0 0 0 / 0.42);
  font: 500 13px/1 system-ui, sans-serif;
  color: rgb(240 234 217 / 0.82);
}`,
      },
    ],
    caveats: [
      '高光必须放在**受光侧**，并且与阴影方向一致。放反了（高光在暗侧）会觉得「哪里不对」但一时说不出——这是最耗时间的返工。',
      '过渡段要长。两个色标挨得近就是硬边高光，看起来像贴了张纸；`42%` 这种中间档是必需的。',
      '高光亮度不要到纯白。留一点余地才有「反光」的质感，纯白像是表面破了洞。',
      '它只是一层视觉暗示，不改变元素的实际表面。元素被倾斜或旋转时，高光位置要跟着重新安排，否则光源方向就矛盾了。',
      '同一画面里所有元素的高光位置必须一致（同一个光源）。这一点做不到，整块界面就会显得脏——和压印浮雕是同一个道理。',
    ],
    notes: [
      '把高光从圆形改成沿边的一条（`linear-gradient` 在顶部一小段）就是「上边缘反光」，适合做卡片。',
      '高光 + 内阴影 + 外阴影三件套齐了，一个平面色块就有了完整的体积感。',
    ],
    _rawRef: 'https://developer.mozilla.org/en-US/docs/Web/CSS/radial-gradient',
    _origin: 'crawl',
  },

  {
    slug: 'iridescent',
    title: '虹彩珠光',
    category: '材质',
    tags: ['虹彩', '色相', '珠光'],
    since: SINCE,
    source: '自行实现',
    when: '一块表面要在转动时透出不同的颜色，像珠光漆或鲍鱼壳',
    stage: 'dark',
    tier: 'core',
    params: [
      { name: 'from', label: '起始角度', type: 'range', min: 0, max: 360, step: 15, default: 200, unit: 'deg' },
    ],
    description: `一块表面从紫到蓝再到青，颜色本身在移动，不是明暗在变。

机制是 ==虹彩是**色相**在变，金属是**同一色相的明暗**在变==。把 \`conic-gradient\` 里放一圈相邻色相（紫→蓝→青→绿），就得到珠光；而金属的色标是同一个金色反复明暗跳变。混了这两件事，结果就成了一块「脏金属」。

这是最容易说清、也最容易做混的一对。`,
    code: [
      {
        lang: 'html',
        body: `<div class="ir">
  <span>虹彩</span>
</div>`,
      },
      {
        lang: 'css',
        body: `.ir {
  display: grid;
  place-items: center;
  width: 190px;
  height: 190px;
  border-radius: 50%;
  /* @mechanism 色相本身在移动（不是同色明暗），这才是虹彩 */
  background: conic-gradient(
    from var(--from, 200deg),
    #7c5cff,
    #4f7cff,
    #14b8a6,
    #a3e635,
    #f43f5e,
    #7c5cff
  );
  box-shadow:
    inset 0 0 34px rgb(0 0 0 / 0.4),
    inset 0 8px 24px rgb(255 255 255 / 0.16);
  font: 600 15px/1 system-ui, sans-serif;
  color: rgb(255 255 255 / 0.86);
}`,
      },
    ],
    caveats: [
      '**金属与虹彩的区别在这里**：金属是同一色相的明暗交替（高光窄而亮），虹彩是色相本身在走。把金属的硬色标拿到这里就成了脏色块。',
      '色相要按顺序排（紫→蓝→青→绿→红）。跳着放会显得脏，因为相邻色之间没有可过渡的中间色。',
      '过渡段比金属宽、比普通渐变窄。太宽像彩虹糖，太窄又变成一块块色斑。',
      '它需要面积才看得出来。小图标上只剩一坨颜色，虹彩的感觉完全丢失。',
      '深色底上最明显。浅色底上要降低饱和度，否则像廉价的塑料玩具。',
      '内阴影是必要的：它给这块表面一点「弧度」，否则平涂的锥形渐变看着就是一张色卡。',
    ],
    notes: [
      '把 `conic-gradient` 换成 `linear-gradient` 就是「全息贴纸」的斜向虹彩，机制一样、方向单一。',
      '配 `@property` 注册角度就能让它缓慢转动，不过那就是另一个条目了。',
    ],
    _rawRef: 'https://developer.mozilla.org/en-US/docs/Web/CSS/gradient/conic-gradient',
    _origin: 'crawl',
  },

  {
    slug: 'velvet-sheen',
    title: '绒面光泽',
    category: '材质',
    tags: ['绒面', '光泽', '径向渐变'],
    since: SINCE,
    source: '自行实现',
    when: '一块深色区域要有天鹅绒那种「顺着摸会变色」的柔光',
    stage: 'dark',
    tier: 'core',
    params: [
      { name: 'soft', label: '光斑大小', type: 'range', min: 30, max: 100, step: 5, default: 62, unit: '%' },
    ],
    description: `深红的一块，靠近中间有一条很柔的亮，边缘沉下去——像绒布被压过。

机制是 ==多层径向渐变交叉，每一层都极低对比==。绒面的特征不是亮点，而是「一片大片区域在极小的明暗差里缓慢变化」。单层渐变做不出这种层次：一层的过渡是单调的，多层不同位置、不同尺寸的光斑叠起来，才有绒那种「各方向都在微微反光」的感觉。

对比度要压得很低。绒面之所以高级，就因为它**不亮**。`,
    code: [
      {
        lang: 'html',
        body: `<div class="vs">
  <span>绒面</span>
</div>`,
      },
      {
        lang: 'css',
        body: `.vs {
  display: grid;
  place-items: center;
  width: min(280px, 78vw);
  height: 175px;
  border-radius: 3px;
  /* @mechanism 多层极低对比的径向渐变交叉，才有绒的各向反光 */
  background:
    radial-gradient(var(--soft, 62%) 58% at 38% 32%, rgb(255 190 190 / 0.16), transparent 70%),
    radial-gradient(48% 46% at 68% 62%, rgb(255 150 170 / 0.12), transparent 72%),
    radial-gradient(70% 60% at 50% 100%, rgb(0 0 0 / 0.36), transparent 76%),
    linear-gradient(168deg, #6d1f30 0%, #4a1622 58%, #2c0d15 100%);
  font: 500 14px/1 system-ui, sans-serif;
  color: rgb(255 232 236 / 0.8);
}`,
      },
    ],
    caveats: [
      '关键是**对比度极低**。绒面的高级感来自它不亮——把光斑提亮到看得清边界，立刻变成塑料。',
      '至少三层渐变（两亮一暗）。单层渐变只能给出单调的一维过渡，做不出「各方向都在微微反光」。',
      '底色的明度不能太高。绒面需要深底，浅底上再怎么叠都像洒了果汁。',
      '光斑位置不要对称。对称的光斑读作「球体高光」，而绒面是没有清晰高光的。',
      '它完全静态。真绒面随视角变化，CSS 做不了——要动只能靠 `@property` 缓慢移动渐变位置，代价是每帧重绘。',
    ],
    notes: [
      '同一套结构换成深绿配米黄就是丝绒幕布，换成深蓝配青就是夜空绒。机制不变。',
      '再叠一层极细的噪点（`dither-anti-banding` 那一招）能让大面积绒更「实」，但那是另一条。',
    ],
    _rawRef: 'https://developer.mozilla.org/en-US/docs/Web/CSS/radial-gradient',
    _origin: 'crawl',
  },

  {
    slug: 'caustics',
    title: '水波焦散',
    category: '材质',
    tags: ['水', '焦散', '重复渐变'],
    since: SINCE,
    source: '自行实现',
    when: '深色水面上要有那种网状的、缓慢游动的光纹',
    stage: 'dark',
    tier: 'core',
    params: [
      { name: 'dur', label: '游动周期', type: 'range', min: 4, max: 30, step: 2, default: 14, unit: 's' },
    ],
    description: `深蓝的水面上浮着一层网状亮纹，缓慢地流动、变形。

机制是 ==两层 \`repeating-radial-gradient\` 的环，用不同的速度平移==。每一层给出等距的同心环；两层环以不同速度移动、互相错开，叠加处就形成了不断变化的网状亮纹——这正是水面把所有波纹的成像叠在一起的样子。

两层都要用 \`translate\` 移动，不要动 \`background-position\`。`,
    code: [
      {
        lang: 'html',
        body: `<div class="cx">
  <span class="cx-l1"></span>
  <span class="cx-l2"></span>
</div>`,
      },
      {
        lang: 'css',
        body: `.cx {
  position: relative;
  width: min(330px, 80vw);
  height: 190px;
  overflow: hidden;
  background: radial-gradient(120% 100% at 50% 0%, #0d3350 0%, #05121d 78%);
}

.cx span {
  position: absolute;
  /* 比容器大，移动时边缘不会露 */
  inset: -35%;
  /* @mechanism 一层等距同心环 */
  background: repeating-radial-gradient(
    circle at 32% 40%,
    transparent 0 9px,
    rgb(190 235 255 / 0.075) 10px 11px
  );
}

.cx-l1 {
  /* @mechanism 两层环以不同速度平移，叠加处形成游动的网 */
  animation: cx-drift-a var(--dur, 14s) linear infinite alternate;
}

.cx-l2 {
  background: repeating-radial-gradient(
    circle at 68% 58%,
    transparent 0 13px,
    rgb(150 220 255 / 0.055) 14px 15px
  );
  animation: cx-drift-b calc(var(--dur, 14s) * 1.4) linear infinite alternate;
}

@keyframes cx-drift-a {
  to {
    translate: 46px 30px;
  }
}

@keyframes cx-drift-b {
  to {
    translate: -54px 38px;
  }
}`,
      },
    ],
    caveats: [
      '两层环的**间距必须不同**（这里 9px 与 13px）。间距一样时两层会同步，看到的是整体平移，没有「网在变」的感觉。',
      '用 `translate` 移动，不要动 `background-position`。后者每帧重绘整块渐变；前者交给合成器。',
      '两层都要比容器大（`inset: -35%`），否则移动时会从边缘露出没画到的区域。',
      '环的亮度要极低（这里 5%–8%）。提亮之后就成了同心圆图案，不是水光。',
      '它完全不看内容。压在上面的文字要另加底色或阴影，否则会与光纹互相干扰。',
    ],
    notes: [
      '把 `alternate` 去掉、加个 `ease-in-out` 会让游动更「水」，但会出现周期性的停顿感。',
      '同一招用在浅色底上就是「阳光照进泳池」的墙面光斑，把底色换成暖白即可。',
    ],
    _rawRef: 'https://developer.mozilla.org/en-US/docs/Web/CSS/gradient/repeating-radial-gradient',
    _origin: 'crawl',
  },

  {
    slug: 'holographic-foil',
    title: '全息贴纸',
    category: '材质',
    tags: ['全息', '叠加', '金属'],
    since: SINCE,
    source: '自行实现',
    when: '一块表面要有镭射贴纸那种随角度变的彩色',
    stage: 'dark',
    tier: 'core',
    params: [
      { name: 'angle', label: '条纹角度', type: 'range', min: 0, max: 180, step: 15, default: 115, unit: 'deg' },
    ],
    description: `一块表面上有几道斜向的彩色条纹在互相叠加，颜色因位置而不同。

机制是 ==多层线性渐变 + 非普通的混合模式==。单层渐变只是一条可预测的色带；把两三层不同角度、不同周期的渐变叠加，并用 \`screen\` 或 \`overlay\` 混合，重叠处的颜色就会互相改变——这才是「镭射」的观感来源。

颜色不是被设计出来的，是**叠出来的**。`,
    code: [
      {
        lang: 'html',
        body: `<div class="hf">
  <span>全息</span>
</div>`,
      },
      {
        lang: 'css',
        body: `.hf {
  position: relative;
  display: grid;
  place-items: center;
  width: min(280px, 78vw);
  height: 170px;
  border-radius: 4px;
  overflow: hidden;
  background: #16121f;
  font: 700 16px/1 system-ui, sans-serif;
  color: rgb(255 255 255 / 0.9);
}

.hf::before,
.hf::after {
  content: "";
  position: absolute;
  inset: -20%;
  /* @mechanism 条纹角度与周期不同，重叠处才互相改变颜色 */
  background: repeating-linear-gradient(
    var(--angle, 115deg),
    rgb(255 90 150 / 0.5) 0 6px,
    rgb(120 220 255 / 0.5) 6px 13px,
    rgb(200 255 140 / 0.5) 13px 19px,
    transparent 19px 34px
  );
}

.hf::after {
  /* @mechanism 第二层换个角度并错开周期，叠加出不可预测的颜色 */
  background: repeating-linear-gradient(
    calc(var(--angle, 115deg) * -0.6),
    rgb(255 220 120 / 0.42) 0 9px,
    rgb(180 130 255 / 0.42) 9px 17px,
    transparent 17px 41px
  );
  mix-blend-mode: screen;
  opacity: 0.72;
}`,
      },
    ],
    caveats: [
      '两层条纹的**角度与周期都要不同**。角度一样时叠加只是把颜色加深，没有镭射感。',
      '混合模式决定了观感。`screen` 偏亮（像发光贴纸），`overlay` 保留底色的明暗（像烫印）。选错方向会得到一块脏色。',
      '透明度要压住。两层都按原色叠加会过曝成一片白，镭射的感觉全部丢失。',
      '这种效果**以不同的屏幕渲染会有明显差异**（尤其广色域屏），设计稿上的颜色不能当作精确目标。',
      '它看起来是「花」的，压在上面的文字必须有足够对比度——通常要加深色底或加描边。',
    ],
    notes: [
      '真正的镭射随视角变化，CSS 只能给一个固定的角度。要能动就得靠指针位置写进变量（那是「跟着指针的光晕」那条的路子）。',
      '同一机制换成两种金属色就是「双色烫印」，换成同色系就是「绸缎」。',
    ],
    _rawRef: 'https://developer.mozilla.org/en-US/docs/Web/CSS/mix-blend-mode',
    _origin: 'crawl',
  },

  /* ────────────────────────────── 布局 ────────────────────────────── */
  {
    slug: 'grid-named-areas',
    title: '用名字描述布局',
    category: '布局',
    tags: ['网格', '命名区域', '可读性'],
    since: SINCE,
    source: '机制来自 CSS Grid 的 grid-template-areas，自行实现',
    when: '布局要一眼看出结构，而不是靠一串列宽去推',
    stage: 'plain',
    tier: 'core',
    params: [],
    description: `CSS 里画出一张 ASCII 图，页面就长成那样。

机制是 ==grid-template-areas 用字符串矩阵描述布局==，每个名字代表一块区域，同名的格子会自动连成一块。它把「哪块在哪」从数字变成了图示——改布局时改的是图，不是列宽。

\`grid-area\` 把元素挂到某个名字上。布局的意图与实现终于是同一件事。`,
    code: [
      {
        lang: 'html',
        body: `<div class="ga">
  <header class="ga-head">头部</header>
  <nav class="ga-side">侧栏</nav>
  <main class="ga-main">主区</main>
  <footer class="ga-foot">页脚</footer>
</div>`,
      },
      {
        lang: 'css',
        body: `.ga {
  display: grid;
  /* @mechanism ASCII 图就是布局本身，同名格子自动连成一块 */
  grid-template-areas:
    "head head"
    "side main"
    "foot foot";
  grid-template-columns: 110px 1fr;
  grid-template-rows: auto 1fr auto;
  gap: 8px;
  width: min(440px, 86vw);
  height: 250px;
  font: 400 13px/1.5 system-ui, sans-serif;
  color: #1c1a17;
}

.ga > * {
  display: grid;
  place-items: center;
  border: 1px solid rgb(60 48 30 / 0.28);
  background: rgb(255 255 255 / 0.46);
}

/* @mechanism 元素按名字挂到区域上，不用写行号列号 */
.ga-head { grid-area: head; }
.ga-side { grid-area: side; }
.ga-main { grid-area: main; }
.ga-foot { grid-area: foot; }

/* 窄屏上直接换一张图 */
@media (max-width: 420px) {
  .ga {
    grid-template-areas:
      "head"
      "main"
      "side"
      "foot";
    grid-template-columns: 1fr;
  }
}`,
      },
    ],
    caveats: [
      '每一行的字符数必须**相等**，否则整条声明被丢弃。多一个空格就会让布局完全失效，而且不报错——这是它最常见的事故。',
      '同一个名字只能形成**一块矩形**区域。想要 L 形，必须用两个不同的名字（`side` 与 `side2`），再用选择器一起选中。',
      '点号 `.` 表示空格子。用它留白比塞一个空 div 好，不占 DOM。',
      '区域名与 `grid-area` 的对应是纯字符串匹配，改名时容易漏掉一处，结果是某个元素掉到自动放置的位置——现象是「它跑到最后一格去了」。',
      '它描述的是**二维**关系。只有一维需求（比如一排卡片）用 flex 更简单，别为了整齐硬上网格。',
      '窄屏换图时列定义也要跟着改（这里从两列变一列），只改图不改列会得到错位的布局。',
    ],
    notes: [
      '把媒体查询里的另一张图紧挨着原图写，改布局时两张图能对照着看，比数字好维护得多。',
      '配 `grid-template-columns: subgrid` 可以做到区域之间共享列，那是另一个条目。',
    ],
    _rawRef: 'https://developer.mozilla.org/en-US/docs/Web/CSS/grid-template-areas',
    _origin: 'crawl',
  },

  {
    slug: 'content-visibility-skip',
    title: '跳过屏幕外的渲染',
    category: '布局',
    tags: ['性能', '渲染', '长页面'],
    since: SINCE,
    source: '机制来自 CSS Containment 的 content-visibility，自行实现',
    when: '页面很长，滚动时明显发涩，但内容是静态的',
    stage: 'plain',
    tier: 'candidate',
    params: [
      { name: 'est', label: '预估高度', type: 'range', min: 40, max: 400, step: 20, default: 180, unit: 'px' },
    ],
    description: `一长列条目，屏幕外的那些浏览器压根不去渲染，滚动因此变顺。

机制是 ==content-visibility: auto 让浏览器跳过元素内部在视口之外时的渲染工作==。它不只是「延迟加载」——布局、绘制、样式计算全都可以跳过。代价是浏览器需要事先知道这块大概多高，否则滚动条会随着你滚动而不断变长变短。

\`contain-intrinsic-size\` 就是给它那个预估高度用的。`,
    code: [
      {
        lang: 'html',
        body: `<div class="cv">
  <section class="cv-item"><b>第一块</b><p>屏幕外的块不会被渲染。</p></section>
  <section class="cv-item"><b>第二块</b><p>滚动时才会真正画出来。</p></section>
  <section class="cv-item"><b>第三块</b><p>跳过的包括布局与绘制。</p></section>
  <section class="cv-item"><b>第四块</b><p>内容越多收益越大。</p></section>
</div>`,
      },
      {
        lang: 'css',
        body: `.cv {
  width: min(360px, 82vw);
  height: 220px;
  overflow-y: auto;
  border: 1px solid rgb(60 48 30 / 0.28);
  background: rgb(255 255 255 / 0.34);
  font: 400 13px/1.6 system-ui, sans-serif;
  color: #1c1a17;
}

.cv-item {
  padding: 16px 18px;
  border-bottom: 1px solid rgb(60 48 30 / 0.16);
  /* @mechanism 视口之外时跳过这块内部的渲染 */
  content-visibility: auto;
  /* @mechanism 给它一个预估高度，否则滚动条会一直跳 */
  contain-intrinsic-size: auto var(--est, 180px);
}

.cv-item b {
  display: block;
  margin-bottom: 4px;
  font-size: 15px;
}

.cv-item p {
  margin: 0;
  opacity: 0.7;
}`,
      },
    ],
    caveats: [
      '**必须配 `contain-intrinsic-size`。**没有它时浏览器按 0 或内容的实际尺寸算，滚动条会在滚动过程中不断变化——这个现象比性能问题更让人难受。',
      '写 `auto <长度>` 那个 `auto` 有实际作用：它让浏览器在渲染过一次之后**记住真实高度**，之后就用真值而不是预估值。',
      '跳过渲染意味着**元素在视口外时无法被测量**。`getBoundingClientRect()`、`offsetHeight` 之类的读法会拿到预估值，依赖精确尺寸的脚本（滚动锚定、虚拟列表）会算错。',
      '在元素上查找并聚焦的浏览器行为（页内锚点跳转、Ctrl+F 的查找）会**先强制渲染**那一块，可能有一次可感知的卡顿。',
      '它不适合内容会随时变化的小组件。频繁进出视口反而会带来反复的计算开销。',
      '支持面还不算宽。不支持时就是普通渲染——不会有功能问题，只是没有性能收益。',
    ],
    notes: [
      '收益和「块内复杂度」成正比，和块的数量也成正比。纯文本的块收益很小，带图表或大量 DOM 的块收益很大。',
      '同一族的 `contain: layout paint` 能手动指定要隔离的部分，但它不会自动跳过屏幕外的渲染。',
    ],
    _rawRef: 'https://developer.mozilla.org/en-US/docs/Web/CSS/content-visibility',
    _origin: 'crawl',
  },

  {
    slug: 'multi-column-prose',
    title: '多栏正文',
    category: '布局',
    tags: ['多栏', '正文', '断行'],
    since: SINCE,
    source: '机制来自 CSS Multi-column Layout，自行实现',
    when: '正文要分两栏排，但不想手工切成两个 div',
    stage: 'plain',
    tier: 'core',
    params: [
      { name: 'width', label: '栏宽下限', type: 'range', min: 140, max: 320, step: 20, default: 220, unit: 'px' },
    ],
    description: `一段长正文自动分成两栏，宽度不够时退回一栏。

机制是 ==\`columns\` 按给定的栏宽下限自动决定栏数，\`column-gap\` 定栏间距==。列切分与内容均衡都是浏览器做的：它不只是把文字倒进两个盒子，还会尽量让两栏等高。

正文分栏真正的学问在**断行控制**——标题不能被孤立在栏底、句子不能跨栏劈开。`,
    code: [
      {
        lang: 'html',
        body: `<div class="mp">
  <h4 class="mp-title">机制是承重墙</h4>
  <p>描述里最要紧的不是「这是什么效果」，而是「靠什么成立」。一句说得清的效果不值得入库，因为抄的人拿不到可以迁移的东西。</p>
  <p>栏数由栏宽下限算出来，宽度不足时自动退回一栏，不需要媒体查询。这也让它天然适配不同容器。</p>
  <p>标题用 column-span 跨越所有栏，否则它会缩在某一栏的顶部，看起来像漏排了。</p>
</div>`,
      },
      {
        lang: 'css',
        body: `.mp {
  /* @mechanism 栏数由栏宽下限算出来，不需要媒体查询 */
  columns: var(--width, 220px);
  column-gap: 26px;
  column-rule: 1px solid rgb(60 48 30 / 0.2);
  width: min(520px, 88vw);
  font: 400 14px/1.85 system-ui, sans-serif;
  color: #1c1a17;
}

.mp-title {
  margin: 0 0 10px;
  font-size: 17px;
  /* @mechanism 标题跨所有栏，否则会缩在某一栏顶部 */
  column-span: all;
}

.mp p {
  margin: 0 0 12px;
  /* @mechanism 避免落单行与孤行 */
  orphans: 2;
  widows: 2;
}`,
      },
    ],
    caveats: [
      '`orphans` 与 `widows` 控制的是「一段话被拆开时，留在栏底/栏顶的最少行数」。不设时可能出现栏底孤零零一行，很难看。',
      '`column-span: all` 只有 `all` 和 `none` 两个值，做不出「跨两栏」。要跨特定栏数只能用 grid。',
      '栏内的元素**不能**是定位包含块或带 `transform` 的，否则会被强制推到新栏，出现半栏空白。',
      '栏数是浏览器按内容量算的，与内容多少有关。同一套 CSS 在内容变短时可能从两栏变一栏——这通常是你想要的，但要有心理准备。',
      '阅读顺序仍是**先填满一栏再换下一栏**（竖着走）。要求按行阅读的场景不适用。',
      '中文正文的行长在 25–35 字之间比较舒服。栏宽换算成字数大概就是 220–300px 这个区间（14–16px 字号）。',
    ],
    notes: [
      '`column-rule` 是栏之间的分隔线，它不占宽度（与 `border` 不同），所以加了不会改变栏宽。',
      '想让它随容器宽度变栏数，配容器查询单位（`cqi`）比媒体查询更自然。',
    ],
    _rawRef: 'https://developer.mozilla.org/en-US/docs/Web/CSS/columns',
    _origin: 'crawl',
  },

  {
    slug: 'reading-measure',
    title: '拿字号量行长',
    category: '布局',
    tags: ['行长', '可读性', '单位'],
    since: SINCE,
    source: '机制来自排版的 measure 原则与 ch 单位，自行实现',
    when: '正文长度要靠字号来定，而不是写死一个像素宽度',
    stage: 'plain',
    tier: 'core',
    params: [
      { name: 'measure', label: '行长（字符）', type: 'range', min: 30, max: 90, step: 5, default: 62, unit: 'ch' },
    ],
    description: `正文的宽度随字号一起变——字号调大了，行也跟着变长一点，但每行仍然是那么多字。

机制是 ==\`ch\` 单位是「0」这个字符的宽度，用它量行长就等于按字数定宽==。阅读的舒适度取决于**每行多少个字**，不是多少像素。写死 \`600px\` 时，字号一改每行的字数就变了；写 \`62ch\` 则始终保持同样的节奏。

字号变了行长跟着变，这才是「以排版为中心」的写法。`,
    code: [
      {
        lang: 'html',
        body: `<article class="rm">
  <p>行长是排版里对可读性影响最大的单一变量。太宽，眼睛回行时容易串行；太窄，换行太频繁，读起来一顿一顿的。</p>
  <p>用字符数来量而不是像素，是为了让字号的变化不破坏这个节奏。字号调大，行也变长，每行仍然是差不多的字数。</p>
</article>`,
      },
      {
        lang: 'css',
        body: `.rm {
  /* @mechanism 用「0」的宽度当尺子，等于按字数定宽 */
  max-inline-size: var(--measure, 62ch);
  margin: 0 auto;
  padding: 0 4px;
  font: 400 15px/1.9 system-ui, sans-serif;
  color: #1c1a17;
}

.rm p {
  margin: 0 0 14px;
}

.rm p:last-child {
  margin-bottom: 0;
}`,
      },
    ],
    caveats: [
      '`ch` 是**数字「0」的宽度**，只在等宽字体下近似于「一个字符的宽度」。中文的字宽与 `ch` 不等（通常是 2 倍左右），所以中文场景用 `ch` 会得到比预期窄的行——可以用 `em` 或直接按字数换算。',
      '`max-inline-size` 是逻辑属性，在竖排书写模式下它管的是**高度**。用它做行长限制比 `max-width` 更正确。',
      '换字体时最优行长会变（不同字体的字宽与 x 高度都不同），所以这个值需要在选定字体之后调。',
      '行长只是可读性的一个变量。行高、字号、对比度、段间距同样重要——单靠行长调不出「好读」。',
      '`margin: 0 auto` 只在容器有明确宽度时能居中。父级是 flex/grid 项时，居中由父级控制，这里的 auto 不起作用。',
    ],
    notes: [
      '英文的舒适区间大约在 45–75 字符，中文大约 25–40 字。这两个区间对应的 `ch` 值不同，不能直接套用。',
      '把它和「通栏突破」配对很自然：中列用 `62ch` 定阅读宽度，通栏元素跨出去。',
    ],
    _rawRef: 'https://developer.mozilla.org/en-US/docs/Web/CSS/length#ch',
    _origin: 'crawl',
  },

  {
    slug: 'sidebar-fluid',
    title: '一侧固定一侧流式',
    category: '布局',
    tags: ['侧栏', 'flex', '自适应'],
    since: SINCE,
    source: '机制来自 CSS Flexbox 的 flex-grow 与 flex-wrap，自行实现',
    when: '侧栏宽度固定，主区吃掉剩余空间，窄屏时自动堆叠',
    stage: 'plain',
    tier: 'core',
    params: [
      { name: 'side', label: '侧栏宽度', type: 'range', min: 120, max: 320, step: 20, default: 200, unit: 'px' },
    ],
    description: `侧栏是它该有的宽度，主区把剩下的都吃掉；窄到一定程度，主区自己落到下一行。全程没有媒体查询。

机制是 ==主区给一个极大的 flex-grow，只要还放得下，它就一定和侧栏同一行==。侧栏的 \`flex-basis\` 是它的目标宽度，主区的 \`flex-basis\` 是一个百分比；两个 basis 加起来放不进一行时，\`flex-wrap\` 让主区换行并独自占满整行。

一个百分比同时决定了「多宽时并排」和「多窄时堆叠」——这就是它不需要断点的原因。`,
    code: [
      {
        lang: 'html',
        body: `<div class="sb">
  <aside class="sb-side">侧栏</aside>
  <div class="sb-main">主区吃掉剩下的空间</div>
</div>`,
      },
      {
        lang: 'css',
        body: `.sb {
  display: flex;
  /* @mechanism 允许换行，放不下时主区自己落到下一行 */
  flex-wrap: wrap;
  gap: 10px;
  width: min(520px, 88vw);
  font: 400 14px/1.7 system-ui, sans-serif;
  color: #1c1a17;
}

.sb > * {
  min-height: 90px;
  padding: 16px 18px;
  border: 1px solid rgb(60 48 30 / 0.28);
}

.sb-side {
  /* @mechanism 目标宽度就是侧栏的 flex-basis */
  flex: 1 1 var(--side, 200px);
  background: rgb(217 164 65 / 0.16);
}

.sb-main {
  /* @mechanism 极大的 grow 吃掉所有剩余宽度；basis 决定何时放不下 */
  flex: 999 1 45%;
  background: rgb(255 255 255 / 0.44);
}`,
      },
    ],
    caveats: [
      '主区的 `flex-basis` 是这套的**开关**：它同时决定了多宽时并排、多窄时堆叠。改它等于改断点，而且不用写媒体查询。',
      '`flex-grow: 999` 那个大数字不是随手写的。它要**远大于**侧栏的 grow，才能保证同行时剩余宽度全归主区；两侧 grow 相近时它们会平分剩余空间。',
      '`flex-wrap: wrap` 是必需的。默认的 `nowrap` 不换行，只会把元素压扁——现象是「窄屏下侧栏被挤成一条，字都竖起来了」。',
      '侧栏的 `flex-basis` 只是**目标**宽度，不是硬宽度。内容比它宽时它仍会被撑大（因为 `min-width: auto`），正是这一点让窄容器不横向溢出。要让它绝不被撑开得另外配 `min-width: 0`。',
      '这套本质是 flex 的分配规则，不是网格。要精确控制轨道与跨行跨列，grid 更合适；这里要的只是「一个会换行的两栏」。',
      '两个 basis 的比例决定堆叠时机，所以改宽度后要重新算一遍。这一点比媒体查询隐晦，属于它的代价。',
    ],
    notes: [
      '换行之后主区的 `flex-basis` 百分比是按**整行**算的，于是它自然占满整行——不需要为堆叠状态另写样式。',
      '同一招的经典用法是卡片列表自动排列：每张卡 `flex: 1 1 220px`，容器一变宽就自动多排几列。',
    ],
    _rawRef: 'https://developer.mozilla.org/en-US/docs/Web/CSS/flex-wrap',
    _origin: 'crawl',
  },

  {
    slug: 'sticky-header-shrink',
    title: '滚动时收缩的表头',
    category: '布局',
    tags: ['sticky', '收缩', '滚动驱动'],
    since: SINCE,
    source: '机制来自 position: sticky 与 scroll-driven animations 的组合，自行实现',
    when: '大表头滚上去之后要缩成一条细条，但不想监听滚动写 JS',
    stage: 'dark',
    tier: 'candidate',
    params: [],
    description: `页面顶上一个大表头，往下滚它就缩成一条窄条并粘在顶部。

机制分两件事：==\`position: sticky\` 负责粘住，\`animation-timeline: scroll()\` 负责让它随滚动量收缩==。前者让元素在滚动到边界时留在原位，后者把「滚了多少」变成一个可以驱动动画的进度值。两者合起来就是「粘住并变形」。

以前这套要写滚动监听，现在两行声明。`,
    code: [
      {
        lang: 'html',
        body: `<div class="sk-scroll">
  <header class="sk-head">咒语书</header>
  <p class="sk-body">往下滚，表头会缩起来。再往上滚回去，它又展开。</p>
  <p class="sk-body">这里是一段用来制造滚动空间的内容。</p>
  <p class="sk-body">继续往下。</p>
  <p class="sk-body">到底了。</p>
</div>`,
      },
      {
        lang: 'css',
        body: `.sk-scroll {
  width: min(380px, 82vw);
  height: 230px;
  overflow-y: auto;
  background: #0d0a14;
  font: 400 13px/1.8 system-ui, sans-serif;
  color: rgb(240 234 217 / 0.74);
}

.sk-head {
  display: grid;
  place-items: center;
  height: 74px;
  /* @mechanism sticky 负责粘住 */
  position: sticky;
  top: 0;
  z-index: 1;
  background: linear-gradient(150deg, #241d33, #120f1c);
  font: 700 19px/1 system-ui, sans-serif;
  color: #f0ead9;
  border-bottom: 1px solid rgb(180 70 47 / 0.5);
  /* @mechanism 滚动量驱动收缩，不需要 JS */
  animation: sk-shrink linear both;
  animation-timeline: scroll(nearest);
  animation-range: 0 90px;
}

.sk-body {
  margin: 0;
  padding: 16px 18px;
  border-bottom: 1px solid rgb(255 255 255 / 0.06);
}

@keyframes sk-shrink {
  to {
    height: 46px;
    font-size: 15px;
    letter-spacing: 0.08em;
  }
}`,
      },
    ],
    caveats: [
      '`position: sticky` 需要一个**滚动的祖先**才会生效。祖先没有滚动条（或 `overflow: visible`）时它就是个普通元素，看起来「完全没生效」。',
      '`sticky` 会被祖先的 `overflow: hidden` 打断——这一条极常见，因为清理溢出的样式常被随手加上。',
      '`animation-timeline: scroll(nearest)` 里的 `nearest` 指最近的滚动容器。写成 `root` 就参照整个文档，嵌在页面里的示例会失效。',
      '`animation-range: 0 90px` 表示「滚动 0 到 90px 之间完成动画」。单位也可以写百分比，但用在滚动距离上时长度更直观。',
      '`sticky` 与动画同时改 `height` 会引起重排。表头这类小元素可以接受，但别把它用到整屏元素上。',
      '滚动驱动的支持面还不宽。不支持时 `animation-timeline` 被忽略，动画会**按时间播一遍**——要配 `@supports` 兜底，否则表头会自己收缩一次。',
    ],
    notes: [
      '把 `height` 换成 `padding` 与 `font-size` 的组合，可以得到更自然的收缩（内容也跟着变小而不是被压扁）。',
      '同一机制可以做「滚动到顶部时才出现的返回按钮」「滚过半屏才浮现的工具栏」。',
    ],
    _rawRef: 'https://developer.mozilla.org/en-US/docs/Web/CSS/animation-timeline',
    _origin: 'crawl',
  },

  {
    slug: 'scroll-snap-gallery',
    title: '横向吸附画廊',
    category: '布局',
    tags: ['吸附', '横向滚动', '画廊'],
    since: SINCE,
    source: '机制来自 CSS Scroll Snap，自行实现',
    when: '一排卡片横滑时每一张都停在正中，而不是停在任意位置',
    stage: 'grid',
    tier: 'core',
    params: [
      { name: 'card', label: '卡片宽度', type: 'range', min: 100, max: 280, step: 10, default: 160, unit: 'px' },
    ],
    description: `横着滑一排卡片，松手时总有一张正好停在中间，边缘还露出前后半张。

机制是 ==\`scroll-snap-type\` 定在容器上、\`scroll-snap-align\` 定在子项上==。浏览器在滚动结束时把最近的吸附点对齐到容器边缘。它和滚动驱动的动画配合，还能做出「当前是第几张」的指示器，不需要监听滚动。

关键是**露出的半张**：它是「还能继续滑」的唯一提示。`,
    code: [
      {
        lang: 'html',
        body: `<div class="sg">
  <div class="sg-card">一</div>
  <div class="sg-card">二</div>
  <div class="sg-card">三</div>
  <div class="sg-card">四</div>
  <div class="sg-card">五</div>
</div>`,
      },
      {
        lang: 'css',
        body: `.sg {
  display: flex;
  gap: 12px;
  width: min(400px, 84vw);
  overflow-x: auto;
  padding: 4px 0 12px;
  /* @mechanism 容器上声明吸附轴与严格程度 */
  scroll-snap-type: x mandatory;
  scrollbar-width: thin;
}

.sg-card {
  /* @mechanism 子项声明对齐到哪条边 */
  scroll-snap-align: center;
  flex: 0 0 var(--card, 160px);
  display: grid;
  place-items: center;
  height: 150px;
  border: 1px solid rgb(60 48 30 / 0.3);
  background: rgb(255 255 255 / 0.5);
  font: 600 22px/1 system-ui, sans-serif;
  color: #1c1a17;
}`,
      },
    ],
    caveats: [
      '`scroll-snap-type` 必须写在**容器**上、`scroll-snap-align` 在**子项**上。写反了两边都不生效，也不报错。',
      '`mandatory` 是强制吸附（一定要停在某个点），`proximity` 是接近才吸附。**长内容用 `mandatory` 会很难受**：它不允许你停在两张卡片之间，用户无法浏览中间的过渡内容。',
      '吸附点对齐的是容器的 `start`/`center`/`end`。`center` 需要在容器两侧留出内边距，否则第一张与最后一张永远无法居中。',
      '`scroll-padding` 决定「容器的哪条边」算对齐基准。有固定表头或 padding 时必须设它，否则卡片会被压在表头下面。',
      '横向滚动容器要避免让整个页面也跟着横滑。`overscroll-behavior-x: contain` 能阻止滚动链传递到父级。',
      '触屏上惯性滑动与吸附的配合很好，鼠标滚轮横向滚动则依赖设备（多数鼠标没有横向滚轮），需要有可见的滚动条或拖拽支持。',
    ],
    notes: [
      '让最后一张卡片露出半张（给容器加内边距或者给卡片一个更窄的 `flex-basis`）是「还能滑」的关键提示。',
      '同一机制竖着用就是「整屏分页」——`scroll-snap-type: y mandatory` 加 `height: 100vh` 的子项。',
    ],
    _rawRef: 'https://developer.mozilla.org/en-US/docs/Web/CSS/scroll-snap-type',
    _origin: 'crawl',
  },

  {
    slug: 'logical-properties',
    title: '按书写方向写样式',
    category: '布局',
    tags: ['逻辑属性', 'RTL', '书写模式'],
    since: SINCE,
    source: '机制来自 CSS Logical Properties，自行实现',
    when: '同一套样式要同时支持从左到右、从右到左和竖排',
    stage: 'plain',
    tier: 'core',
    params: [],
    description: `同一段 CSS，在阿拉伯语环境下整个布局自动镜像，一行都不用改。

机制是 ==逻辑属性用「块向 / 行内」代替「上下左右」==。\`margin-inline-start\` 的含义是「行内方向的起点」——在横排从左到右时是左边，从右到左时是右边，竖排时是上边。物理属性（\`margin-left\`）描述的是屏幕上的方位，逻辑属性描述的是**书写流里的位置**。

把方向交给书写模式，而不是写死在样式里。`,
    code: [
      {
        lang: 'html',
        body: `<div class="lp">
  <div class="lp-row">
    <span class="lp-bullet"></span>
    <span>这一段用的是逻辑属性</span>
  </div>
  <div class="lp-row">
    <span class="lp-bullet"></span>
    <span>改一下 writing-mode 或 dir 它就镜像</span>
  </div>
</div>`,
      },
      {
        lang: 'css',
        body: `.lp {
  width: min(340px, 82vw);
  padding: 20px 22px;
  border: 1px solid rgb(60 48 30 / 0.28);
  background: rgb(255 255 255 / 0.42);
  font: 400 14px/1.7 system-ui, sans-serif;
  color: #1c1a17;
}

.lp-row {
  display: flex;
  align-items: center;
  gap: 10px;
  /* @mechanism 内边距加在「行内起点」而不是「左边」 */
  padding-inline-start: 12px;
  /* @mechanism 加在「块向终点」，不是「底边」 */
  padding-block-end: 10px;
  border-inline-start: 3px solid #b4462f;
}

.lp-bullet {
  inline-size: 8px;
  block-size: 8px;
  border-radius: 50%;
  background: #b4462f;
}`,
      },
    ],
    caveats: [
      '它不是「多写几个方向的样式」，而是**换了一套坐标**。理解成「不写死左右」只是表面——真正的收益是竖排与 RTL 都不用改样式。',
      '逻辑属性与物理属性混用时**后声明的赢**，与书写模式无关。旧代码里残留的 `margin-left` 会悄悄覆盖新的 `margin-inline-start`。',
      '`inset-inline-start` 对应 `left`（横排 LTR 下）。用它做绝对定位比 `left` 可靠，但要求父级的书写模式是对的。',
      '并非所有属性都有逻辑版本（比如 `background-position` 就没有）。缺的地方只能靠 `:dir()` 或分开写。',
      '老浏览器上不认逻辑属性时会**完全忽略**该声明。迁移期间要么两套都写，要么确认目标环境支持。',
      '`writing-mode` 改成竖排时逻辑属性的行为会变（行内方向变成从上到下），这是特性不是 bug，但要实际验证一遍。',
    ],
    notes: [
      '它和「竖排文字」是同一套坐标体系的两端：一个负责排版，一个负责布局。',
      '`inline-size` / `block-size` 是 `width` / `height` 的逻辑版本，配合竖排时特别直观。',
    ],
    _rawRef: 'https://developer.mozilla.org/en-US/docs/Web/CSS/CSS_logical_properties_and_values',
    _origin: 'crawl',
  },
]
