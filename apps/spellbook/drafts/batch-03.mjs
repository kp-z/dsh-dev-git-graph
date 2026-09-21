/**
 * 第 3 批采集草稿：排版与图形。
 *
 * 前两批把布局与动效铺开了，这两个分类各只有 2 条，是明显的短板。
 * 这一批挑的是「一眼看得出设计感」、而且机制本身很干净的那些。
 *
 * 用法：
 *   node scripts/prepare-draft.mjs drafts/batch-03.mjs
 *   node scripts/ingest.mjs drafts/batch-03.mjs --dry-run
 *   node scripts/ingest.mjs drafts/batch-03.mjs
 */

const SINCE = '2026-09'

export default [
  /* ────────────────────────────── 排版 ────────────────────────────── */
  {
    slug: 'gradient-text',
    title: '渐变文字',
    category: '排版',
    tags: ['渐变', '文字', '背景裁切'],
    since: SINCE,
    source: '机制来自 CSS background-clip，自行实现',
    when: '标题要一段颜色渐变，不想切图、不想用 SVG',
    stage: 'dark',
    tier: 'core',
    params: [
      { name: 'angle', label: '渐变角度', type: 'range', min: 0, max: 360, step: 15, default: 100, unit: 'deg' },
    ],
    description: `字面上就有颜色在流动，从一个色相过渡到另一个。

机制是 ==把背景裁到文字的形状上，再把字本身变成透明的==。背景其实是画在**文字盒子**上的一个矩形，\`background-clip: text\` 只让它在字形的像素里显示出来；此时字仍然是不透明的实色、会盖住背景，所以还得把 \`color\` 设成透明，让底下的渐变透上来。

关键在于：真正做渐变的是背景，不是文字。理解了这点，后面那些「为什么没生效」都有答案。`,
    code: [
      {
        lang: 'html',
        body: `<h2 class="gt">咒语书</h2>
<p class="gt-sub">一条咒语一个效果</p>`,
      },
      {
        lang: 'css',
        body: `.gt {
  margin: 0;
  font: 700 54px/1.1 system-ui, sans-serif;
  letter-spacing: -0.02em;
  /* @mechanism 渐变画在背景上 */
  background-image: linear-gradient(
    var(--angle, 100deg),
    #ff9a5a 0%,
    #f43f5e 38%,
    #7c5cff 72%,
    #14b8a6 100%
  );
  /* @mechanism 把背景裁到字形里 */
  background-clip: text;
  -webkit-background-clip: text;
  /* @mechanism 文字本身必须透明，否则实色盖住背景 */
  color: transparent;
}

.gt-sub {
  margin: 10px 0 0;
  font: 400 14px/1.6 system-ui, sans-serif;
  color: rgb(240 234 217 / 0.6);
}`,
      },
    ],
    caveats: [
      '**`color: transparent` 不能少。**少了它，文字的不透明色会盖在渐变上，看到的是纯色字——这是最常见的「渐变没生效」。',
      '背景是画在文字**盒子**上的矩形，不是字形上。`line-height` 留的空白会一起被渐变覆盖，所以行高很大时字看起来偏淡：渐变被拉到了空处。',
      '打印时几乎打不出来。文字是透明的、颜色来自背景图，而打印机默认不印背景。要出印刷稿得在 `@media print` 里还给文字一个实色。',
      '别叠 `text-shadow`：阴影基于文字盒子绘制，会整块染色，把渐变糊掉。要发光得用 `filter: drop-shadow()`。',
    ],
    notes: [
      '`background-clip: text` 现在各引擎都认，但 `-webkit-` 前缀那一行仍要留着照顾旧版 Safari。',
      '渐变角度做成参数很划算：同一段文字，换个角度气质就完全不同。',
    ],
    _rawRef: 'https://developer.mozilla.org/en-US/docs/Web/CSS/background-clip',
    _origin: 'crawl',
  },

  {
    slug: 'text-stroke-outline',
    title: '描边空心字',
    category: '排版',
    tags: ['描边', '文字', '空心'],
    since: SINCE,
    source: '机制来自 CSS Text Decoration 与 -webkit-text-stroke，自行实现',
    when: '标题要只有轮廓、中间透空，像版画或霓虹管',
    stage: 'dark',
    tier: 'core',
    params: [
      { name: 'stroke', label: '描边粗细', type: 'range', min: 0.5, max: 4, step: 0.5, default: 1.5, unit: 'px' },
    ],
    description: `字只剩下轮廓线，中间的填充是空的，能透出背后的东西。

机制是 ==-webkit-text-stroke 给字形描一圈边，再把 color 设成透明==。描边是**居中**的：一半在字形轮廓里侧、一半在外侧。所以描边越粗，字形的实际笔画被吃掉得越多——细字重上尤其明显，粗到一定程度字会糊成一团。

想让填充压在描边上面（更接近版画的层次），加 \`paint-order: stroke fill\`。`,
    code: [
      {
        lang: 'html',
        body: `<h2 class="tso">咒语书</h2>
<p class="tso-fill">一半描边，一半填充</p>`,
      },
      {
        lang: 'css',
        body: `.tso {
  margin: 0;
  font: 800 56px/1.1 system-ui, sans-serif;
  letter-spacing: 0.02em;
  /* @mechanism 描边是居中画的，一半吃掉字形内部 */
  -webkit-text-stroke: var(--stroke, 1.5px) #d9a441;
  color: transparent;
}

.tso-fill {
  margin: 14px 0 0;
  font: 800 40px/1.1 system-ui, sans-serif;
  -webkit-text-stroke: var(--stroke, 1.5px) #d9a441;
  /* @mechanism 填充压在描边上，做出层次 */
  paint-order: stroke fill;
  color: #b4462f;
}`,
      },
    ],
    caveats: [
      '描边是**居中**的，不是向外扩。同一粗细在细字重上会把笔画吃掉一半，看起来像字变瘦了——这不是渲染问题。',
      '描边宽度用 `px` 时，字号一改比例就变了；用 `em` 才能让描边随字号缩放。标题与正文共用一套样式时必须注意。',
      '`text-stroke` 这个标准属性至今没有落地，实际能用的仍是 `-webkit-text-stroke`。要写前缀，否则不生效。',
      '`paint-order` 对 `text-stroke` 的效果各引擎不完全一致：它原本是为 SVG 文字设计的，用在 HTML 文字上属于「能用但别依赖」。',
      '描边很细时边缘会有灰边（抗锯齿的半透明像素）。深底浅字时尤其明显，想干净就只用整数像素宽度。',
    ],
    notes: [
      '空心字在深色底上最出效果——浅色描边有霓虹感，浅色底上则像没印实。',
      '同一招配 `background-clip: text` 就能做出「描边 + 内有渐变填充」的组合，比纯空心更有质感。',
    ],
    _rawRef: 'https://developer.mozilla.org/en-US/docs/Web/CSS/-webkit-text-stroke',
    _origin: 'crawl',
  },

  {
    slug: 'drop-cap',
    title: '首字下沉',
    category: '排版',
    tags: ['首字', '段落', '书籍感'],
    since: SINCE,
    source: '机制来自 CSS Pseudo-Elements 的 ::first-letter，自行实现',
    when: '正文开头要一个大写的首字母，像旧书那样压住前三行',
    stage: 'plain',
    tier: 'core',
    params: [
      { name: 'size', label: '首字倍率', type: 'range', min: 2, max: 5, step: 0.2, default: 3.4, unit: 'em' },
    ],
    description: `段落的第一个字突然变大，占住左边三行的位置，后面的文字绕它排。

机制是 ==::first-letter 配 float: left==。\`::first-letter\` 能选到第一个字（包括它前面的标点），把字号放大之后它还是个行内元素、会把行撑高；再加 \`float: left\` 让它脱离行流变成块级，后面的文字就会绕着它排。

真正难的不是这几个属性，是把首字的基线与第一行的基线对齐——那全靠 \`line-height\` 与 \`margin\` 手调。`,
    code: [
      {
        lang: 'html',
        body: `<p class="dc">咒语书要收的是那些一句话说不清的效果。一句话能说清的，不值得占一条。这里放一段够长的正文，好看清首字是怎么压住前三行的。</p>`,
      },
      {
        lang: 'css',
        body: `.dc {
  width: min(460px, 84vw);
  margin: 0;
  font: 400 15px/1.85 system-ui, sans-serif;
  color: #1c1a17;
  text-align: justify;
}

/* @mechanism 放大的首字再加 float，脱离行流让后续文字环绕 */
.dc::first-letter {
  float: left;
  font-size: var(--size, 3.4em);
  font-weight: 700;
  line-height: 0.82;
  margin: 0.06em 0.1em 0 0;
  color: #b4462f;
}`,
      },
    ],
    caveats: [
      '`line-height` 与 `margin` 必须手调。默认值下首字会与首行基线错开，这是这个效果最容易翻车的地方——换字体、换字号都要重调一次。',
      '`::first-letter` 只对**块级**元素生效。写在 `display: inline` 的元素上完全不匹配，也不报错。',
      '它选的是「第一个字符」，**包括前置标点**。中文段落以引号开头时，下沉的会是那个引号而不是第一个字。',
      '更省事的 `initial-letter: 3` 语法简洁得多，但支持面还窄（Safari 与较新版 Chrome 可用）。稳妥做法是把它写在 `@supports` 里，让 `float` 方案兜底。',
      '首字放大后行高会撑开，`text-align: justify` 下会出现一处明显的疏密突变，视觉上要接受或改回左对齐。',
    ],
    notes: [
      '中文语境里「首字」通常也想下沉两个字。那更适合用两个字符的容器或 `::first-line` 配合，`::first-letter` 只能拿一个。',
      '下沉字用朱批红而不加粗到极黑，更接近旧书的味道——过重的字会把整页压偏。',
    ],
    _rawRef: 'https://developer.mozilla.org/en-US/docs/Web/CSS/::first-letter',
    _origin: 'crawl',
  },

  {
    slug: 'vertical-text',
    title: '竖排文字',
    category: '排版',
    tags: ['竖排', '书写模式', '东亚'],
    since: SINCE,
    source: '机制来自 CSS Writing Modes 的 writing-mode，自行实现',
    when: '要一行从右往左竖着排的字，像旧书封面或牌匾',
    stage: 'dark',
    tier: 'core',
    params: [],
    description: `文字从上往下排，一行行从右往左走，整块像一块匾。

机制是 ==writing-mode: vertical-rl 把整条排版轴转 90 度==。它转的不是这几个字，而是**整个书写方向**：行内轴变成从上到下，块轴变成从右到左。所有依赖轴的属性都跟着变——\`width\` 量的是行宽，\`height\` 量的是行数，直觉完全反过来。

这也是为什么东亚文字的竖排不能靠 \`transform: rotate\` 凑：那样标点不会转正、拉丁字母会躺着。`,
    code: [
      {
        lang: 'html',
        body: `<div class="vt">咒语书　前端效果速查</div>`,
      },
      {
        lang: 'css',
        body: `.vt {
  /* @mechanism 换书写模式，不是旋转文字 */
  writing-mode: vertical-rl;
  text-orientation: mixed;
  width: min(340px, 74vw);
  max-height: 300px;
  padding: 16px 18px;
  border: 1px solid rgb(217 164 65 / 0.45);
  background: rgb(0 0 0 / 0.24);
  font: 500 22px/1.6 "Songti SC", "SimSun", serif;
  letter-spacing: 0.18em;
  color: #f0ead9;
}`,
      },
    ],
    caveats: [
      '它改变的是**尺寸与轴的语义**，不只是视觉。原来的 `width` 现在表示一行的长度，`height` 表示能放几行；写响应式时所有尺寸要重新想。',
      '`text-orientation: upright` 会把拉丁字母也一个个立起来，读起来很别扭。中英混排一般用 `mixed`，让西文保持侧躺。',
      'flex 与 grid 的主轴会跟着书写模式走。`flex-direction: row` 在这里变成从上到下排列——布局不只是「看起来转了」。',
      '两位数字要占一格（竖排数字的正确排法）得靠 `text-combine-upright: digits 2`，不写的话「26」会各占一格竖起来。',
      '竖排字体依赖字体的竖排字形。系统宋体通常没问题，无衬线字体常常直接退化成横排字形。',
    ],
    notes: [
      '标点的竖排压缩（句号挪到右上角）由字体与浏览器共同处理，用对字体就自动对。',
      '做牌匾时配 `letter-spacing` 拉开字距，比加粗更接近刻字的感觉。',
    ],
    _rawRef: 'https://developer.mozilla.org/en-US/docs/Web/CSS/writing-mode',
    _origin: 'crawl',
  },

  {
    slug: 'highlight-marker',
    title: '荧光笔高亮',
    category: '排版',
    tags: ['高亮', '渐变', '强调'],
    since: SINCE,
    source: '机制来自 CSS 多重色标背景，自行实现',
    when: '一句话要像被荧光笔划过，但又不想盖住整个字',
    stage: 'plain',
    tier: 'core',
    params: [
      { name: 'cover', label: '覆盖高度', type: 'range', min: 30, max: 90, step: 5, default: 55, unit: '%' },
    ],
    description: `文字下半截有一道颜色，像真的被人用荧光笔从字腰划过——上半截还是纸。

机制是 ==在一个渐变里把两个色标写在同一个位置==，得到一个硬边，把高亮限制在某个高度以下。\`transparent\` 到 \`--cover\` 这一段是透明的，从这里开始立刻上色。真正的荧光笔不会盖住整个字，那道「只覆盖下半截」的边就是全部效果所在。

用一整块纯色背景就做不出这个——那是「选中」，不是「划过」。`,
    code: [
      {
        lang: 'html',
        body: `<p class="hl">机制不是一句话能说清的，但<span class="hl-mark">这句话值得被划出来</span>，因为它是整段的重点。</p>`,
      },
      {
        lang: 'css',
        body: `.hl {
  width: min(460px, 84vw);
  margin: 0;
  font: 400 16px/2 system-ui, sans-serif;
  color: #1c1a17;
}

.hl-mark {
  /* @mechanism 两个色标写在同一位置 = 硬边，高亮只到字腰 */
  background-image: linear-gradient(
    to top,
    rgb(217 164 65 / 0.72) var(--cover, 55%),
    transparent var(--cover, 55%)
  );
  background-repeat: no-repeat;
  padding: 0 3px;
}`,
      },
    ],
    caveats: [
      '两个色标必须写在**同一个位置**才有硬边。差一点点就变成渐变，看起来是晕染开的一团，不是划出来的一道。',
      '背景是画在文字盒子上的矩形，**跨行时每行各画一次**。多行文本的高亮会在行末断开、下一行重头开始，还会露出半截行距的空白。',
      '它的高度是相对整个行盒算的，所以 `line-height` 越大，高亮离字越远——调 `--cover` 只能改比例，改不了基准。',
      '深色主题下要调亮高亮色并降低透明度，否则像一块脏印子；浅色纸上则要压暗一点才有笔感。',
      '`background-size` 过渡会触发重绘。要让它「划过来」，元素多时改用伪元素的 `transform: scaleX`。',
    ],
    notes: [
      '给高亮两端加一点内边距（`padding: 0 3px`），看起来像笔尖有厚度，比严丝合缝更像手写。',
      '同一招换个色就变成「铅笔底纹」或「马克笔重涂」，颜色透明度在 0.5–0.75 之间最像笔。',
    ],
    _rawRef: 'https://developer.mozilla.org/en-US/docs/Web/CSS/linear-gradient',
    _origin: 'crawl',
  },

  {
    slug: 'blend-text',
    title: '与背景反相的文字',
    category: '排版',
    tags: ['混合模式', '对比', '文字'],
    since: SINCE,
    source: '机制来自 CSS Compositing 的 mix-blend-mode，自行实现',
    when: '文字要压在明暗不定的图上，而且不管底下是什么颜色都看得清',
    stage: 'photo',
    tier: 'candidate',
    params: [],
    description: `白字压在浅色上也看得见，压在深色上也看得见——因为它的颜色会跟着底下的明暗反过来。

机制是 ==mix-blend-mode: difference==。混合模式把文字的颜色与底下像素逐通道相减：压在白底上得到反相的黑，压在黑底上得到白。于是同一段文字跨越明暗边界时，每一处都自动取到对比度最高的那个颜色。

这是纯 CSS 里唯一不需要知道背景是什么、也能保证可读性的办法。`,
    code: [
      {
        lang: 'html',
        body: `<div class="bt-wrap">
  <span class="bt-text">咒语书 SPELLBOOK</span>
</div>`,
      },
      {
        lang: 'css',
        body: `.bt-wrap {
  display: grid;
  place-items: center;
  width: min(420px, 80vw);
  height: 200px;
  background: linear-gradient(115deg, #f4efe4 0%, #f4efe4 48%, #14101c 52%, #14101c 100%);
}

.bt-text {
  font: 800 30px/1 system-ui, sans-serif;
  letter-spacing: 0.04em;
  color: #f4efe4;
  /* @mechanism difference 让每一处都取到对比度最高的一侧 */
  mix-blend-mode: difference;
}`,
      },
    ],
    caveats: [
      '`mix-blend-mode` 只在**同一个层叠上下文**里混合。父级一旦有 `isolation: isolate`、`transform`、`opacity` 小于 1 或 `filter`，混合范围就被切开，结果会和你预期的不一样——这是最常见的「突然不混了」。',
      '`difference` 在**中灰（约 #808080）**上几乎不变色。文字压在过去恰好是中灰的区域会直接「消失」，这是数学上的必然，不是渲染问题。',
      '不支持混合模式的旧环境会退化成「纯色文字压在图上」，可能完全看不清。所以底图要选明暗对比大的，别指望它在任意图上都好用。',
      '它和 `filter` 同时用的时候结果依赖应用顺序，调起来会很别扭。要发光就换成 `drop-shadow` 并单独测。',
    ],
    notes: [
      '`difference` 做「反相」，`exclusion` 更柔和（对比没那么硬），`overlay` 则保留底图明暗只做染色。',
      '同一招用在纯色块上会得到严格的互补色，做双色海报的标题很省事。',
    ],
    _rawRef: 'https://developer.mozilla.org/en-US/docs/Web/CSS/mix-blend-mode',
    _origin: 'crawl',
  },

  {
    slug: 'gradient-underline',
    title: '渐变下划线',
    category: '排版',
    tags: ['下划线', '渐变', '链接'],
    since: SINCE,
    source: '机制来自 CSS 背景定位，自行实现',
    when: '链接要一条彩色下划线，而且想让它从细变粗或从无到有',
    stage: 'plain',
    tier: 'core',
    params: [
      { name: 'thick', label: '线粗', type: 'range', min: 1, max: 8, step: 1, default: 3, unit: 'px' },
    ],
    description: `链接底下一条从红到金的细线，悬浮时从左侧长出来。

机制是 ==把线做成一张背景图，用 background-size 与 background-position 摆到底边==。\`border-bottom\` 只能是单色、也没法只画一部分；背景图既能上渐变，又能通过改 \`background-size\` 让它「长出来」。

这里动的是背景而不是伪元素，代价是动画会触发重绘；只在文字量小的链接上划算。`,
    code: [
      {
        lang: 'html',
        body: `<p class="gu-p">机制要说得清，出处要记得住。<a class="gu" href="#">这条链接的下划线是渐变的</a>，鼠标移上去它会从左边长出来。</p>`,
      },
      {
        lang: 'css',
        body: `.gu-p {
  width: min(460px, 84vw);
  margin: 0;
  font: 400 16px/2 system-ui, sans-serif;
  color: #1c1a17;
}

.gu {
  color: inherit;
  text-decoration: none;
  /* @mechanism 线是背景图，贴到底边 */
  background-image: linear-gradient(90deg, #b4462f 0%, #d9a441 62%, #7c5cff 100%);
  background-repeat: no-repeat;
  background-position: 0 100%;
  background-size: 0% var(--thick, 3px);
  transition: background-size 0.36s ease;
  padding-bottom: 2px;
}

.gu:hover {
  background-size: 100% var(--thick, 3px);
}`,
      },
    ],
    caveats: [
      '`background-position: 0 100%` 贴的是**元素盒子**的底边，不是文字基线。`line-height` 大时下划线会离字很远，要靠 `padding-bottom` 把它推回来。',
      '元素是行内的话，**跨行时每一行片段各画一次**，下划线会在换行处断开并重新从左边长起。长链接尤其明显，`box-decoration-break` 也只能部分缓解。',
      '动画 `background-size` 会触发重绘。链接一多就明显，改成伪元素做 `transform: scaleX` 能把这份开销交给合成器。',
      '`text-decoration: none` 必须给：否则浏览器自带的装饰线会和这条叠在一起，看起来是双线。',
      '去掉下划线就削弱了「这是链接」的信号。颜色或字重上得给一点别的提示，否则可访问性会退步。',
    ],
    notes: [
      '`background-size` 从 `0%` 到 `100%` 是「长出来」；反过来从 `100%` 到 `0%` 是「收回去」。想要收回去要从右边开始，改 `background-position: 100% 100%`。',
      '线粗做成参数时记得它的单位是 `px`，跟字号无关——标题链接要用更粗的值。',
    ],
    _rawRef: 'https://developer.mozilla.org/en-US/docs/Web/CSS/background-size',
    _origin: 'crawl',
  },

  /* ────────────────────────────── 图形 ────────────────────────────── */
  {
    slug: 'conic-border',
    title: '渐变描边',
    category: '图形',
    tags: ['渐变', '边框', '背景裁切'],
    since: SINCE,
    source: '机制来自 CSS background-clip 的双层裁切，自行实现',
    when: '卡片要一圈彩色描边，但 border 只能给单色',
    stage: 'dark',
    tier: 'core',
    params: [
      { name: 'width', label: '描边宽度', type: 'range', min: 1, max: 12, step: 1, default: 3, unit: 'px' },
    ],
    description: `卡片四周一圈从红到金再到紫的渐变边，像镶了道金属。

机制是 ==两层背景 + 两种裁切范围==。第一层是一块实色，裁到 \`padding-box\`（只在内容区显示），用来盖住中间；第二层是渐变，裁到 \`border-box\`（一直铺到边框外沿）。中间被实色挡住，于是渐变只在边框那圈露出来。

\`border: Npx solid transparent\` 是前提——透明边框占着位置但不画颜色，正好把那一圈让给背景。`,
    code: [
      {
        lang: 'html',
        body: `<div class="cb">
  <b>镶边卡片</b>
  <p>渐变只露在边框那一圈。</p>
</div>`,
      },
      {
        lang: 'css',
        body: `.cb {
  width: min(320px, 78vw);
  padding: 22px 24px;
  /* @mechanism 透明边框占住那一圈，让给背景去画 */
  border: var(--width, 3px) solid transparent;
  border-radius: 4px;
  /* @mechanism 双层背景：内层盖内容区，外层铺到边框外沿 */
  background:
    linear-gradient(#1b1626, #1b1626) padding-box,
    conic-gradient(from 140deg, #b4462f, #d9a441, #7c5cff, #14b8a6, #b4462f) border-box;
  font: 400 14px/1.7 system-ui, sans-serif;
  color: #f0ead9;
}

.cb b {
  display: block;
  margin-bottom: 6px;
  font-size: 17px;
}

.cb p {
  margin: 0;
  opacity: 0.72;
}`,
      },
    ],
    caveats: [
      '`border-style` 必须是 `solid` 且颜色为 `transparent`。写成实色，第二层背景就被盖住，看到的还是单色边。',
      '内层那块实色是必需的，所以**内容区没法做到真正透明**。想让卡片透出页面背景，这个技巧就用不了，得换成 `mask` 方案。',
      '两层的顺序与 `background-clip` 的值要一一对应：写在前面的层画在上面。顺序写反，看到的是被渐变整块糊住的卡片。',
      '圆角处部分浏览器会有细缝或锯齿，因为两层裁切的圆角是分别算的。加 `border-radius` 时把描边调粗一点更容易看出。',
      '它和 `box-shadow` 叠加时阴影会从**元素盒子**外侧算起，与视觉上的描边外沿差了一个边框宽，看起来像阴影浮着。',
    ],
    notes: [
      '把内层从实色改成半透明色，就能得到「描边清晰、内容半透」的效果——但页面底色会透上来，颜色会变。',
      '`conic-gradient` 做描边比 `linear-gradient` 更好看：角上的明暗过渡更像金属倒角。',
    ],
    _rawRef: 'https://developer.mozilla.org/en-US/docs/Web/CSS/background-clip',
    _origin: 'crawl',
  },

  {
    slug: 'clip-polygon',
    title: '多边形裁切',
    category: '图形',
    tags: ['裁切', '形状', '斜切'],
    since: SINCE,
    source: '机制来自 CSS Shapes 的 clip-path，自行实现',
    when: '色块要有斜切口或非矩形的轮廓，不想用 SVG、也不想透明图片',
    stage: 'grid',
    tier: 'core',
    params: [
      { name: 'skew', label: '斜切量', type: 'range', min: 0, max: 18, step: 1, default: 8, unit: '%' },
    ],
    description: `色块的右上角被斜着切掉一块，整块看起来像贴着角飞出去的纸片。

机制是 ==clip-path: polygon() 用一个点序列定义可见区域==。点在元素盒子里的百分比坐标上给出，连起来围成的多边形之外的像素全部不画。任意多边形都行，不需要图片、不需要 SVG，也不用为了形状多包一层。

配合 \`calc()\` 与自定义属性，切角量还能做成可调的。`,
    code: [
      {
        lang: 'html',
        body: `<div class="cp">
  <b>斜切块</b>
  <p>裁掉的地方不显示，但仍然占着布局空间。</p>
</div>`,
      },
      {
        lang: 'css',
        body: `.cp {
  width: min(340px, 78vw);
  padding: 26px 26px 22px;
  /* @mechanism 点序列围出的区域才可见 */
  clip-path: polygon(
    0 0,
    calc(100% - var(--skew, 8%)) 0,
    100% var(--skew, 8%),
    100% 100%,
    0 100%
  );
  background: linear-gradient(150deg, #b4462f 0%, #6b3550 100%);
  font: 400 14px/1.7 system-ui, sans-serif;
  color: #f7f1e6;
}

.cp b {
  display: block;
  margin-bottom: 6px;
  font-size: 18px;
}

.cp p {
  margin: 0;
  opacity: 0.82;
}`,
      },
    ],
    caveats: [
      '`clip-path` **只裁显示，不改变布局占用**。被切掉的部分依然占着原来的空间，周围的元素不会靠过来填补。',
      '被裁掉的区域**也点不到**——指针事件跟着可见区域走。按钮上用它时要确认可点范围还够用。',
      '它不跟随 `border-radius`。两者同时写时以 `clip-path` 为准，圆角会被无声忽略。',
      '`box-shadow` 会被一起裁掉（阴影画在元素盒子之外），所以斜切块做不出投影。要投影得给父级加 `filter: drop-shadow()`，它会按裁切后的轮廓算。',
      '百分比是相对元素**自己的盒子**，不是父级。用一个固定的 `%` 做斜切时，容器一变形斜角角度就变了——想要恒定角度得用 `calc()` 配固定长度。',
    ],
    notes: [
      '给元素留出足够的内边距，否则文字会被斜边切到。',
      '`polygon()` 的点可以用 `calc()` 计算，这一条让它从「固定形状」变成「可参数化的形状」。',
    ],
    _rawRef: 'https://developer.mozilla.org/en-US/docs/Web/CSS/clip-path',
    _origin: 'crawl',
  },

  {
    slug: 'dot-matrix',
    title: '点阵底纹',
    category: '图形',
    tags: ['点阵', '纹理', '径向渐变'],
    since: SINCE,
    source: '机制来自 CSS 径向渐变平铺，自行实现',
    when: '要一层规整的点阵把空地填住，但不想用图片',
    stage: 'grid',
    tier: 'core',
    params: [
      { name: 'gap', label: '点距', type: 'range', min: 8, max: 40, step: 2, default: 16, unit: 'px' },
    ],
    description: `一层等距的小圆点铺满整块，像制图纸或漫画的网点底。

机制是 ==画一个圆点，然后用 background-size 平铺它==。\`radial-gradient\` 给出的是一张「一个点 + 周围透明」的最小图块，\`background-size\` 把它复制成整面墙。改间距只动这一个值，改点的大小只动色标——两层信息各管各的，不用重画。

\`background-size\` 比点直径大出多少，就是留白多少。`,
    code: [
      {
        lang: 'html',
        body: `<div class="dm">
  <b>点阵底</b>
  <p>一个点，平铺成一面。</p>
</div>`,
      },
      {
        lang: 'css',
        body: `.dm {
  width: min(360px, 80vw);
  padding: 26px;
  /* @mechanism 画一个点，再用 background-size 平铺 */
  background-image: radial-gradient(
    circle,
    rgb(60 48 30 / 0.42) 1.6px,
    transparent 1.7px
  );
  background-size: var(--gap, 16px) var(--gap, 16px);
  background-position: center;
  border: 1px solid rgb(60 48 30 / 0.28);
  font: 400 14px/1.7 system-ui, sans-serif;
  color: #1c1a17;
}

.dm b {
  display: block;
  margin-bottom: 6px;
  font-size: 18px;
}

.dm p {
  margin: 0;
  opacity: 0.68;
}`,
      },
    ],
    caveats: [
      '两个色标要差一点点（`1.6px` → `1.7px`）。写同一个值会得到锯齿边缘，因为抗锯齿需要至少一个像素的过渡带。',
      '`background-size` 至少要有点直径的两倍，否则点会连成一片、看不出是点阵。',
      '平铺默认从左上角起算，容器边缘会出现**半个点**。加 `background-position: center` 让它从中心起算，两端对称切半，看起来整齐得多。',
      '点很小时在高 dpi 屏上会偏灰。这不是显示错误，是抗锯齿把 1–2 像素的点摊开了；要更实就把点做大或加深颜色。',
    ],
    notes: [
      '把 `circle` 换成 `ellipse` 或加角度就能做斜向点阵，同一招换形不换结构。',
      '两点间距与点径的比例控制在 5:1 左右最像制图纸；越小越密，最后会变成一块灰。',
    ],
    _rawRef: 'https://developer.mozilla.org/en-US/docs/Web/CSS/radial-gradient',
    _origin: 'crawl',
  },

  {
    slug: 'blueprint-grid',
    title: '蓝图网格',
    category: '图形',
    tags: ['网格', '纹理', '技术感'],
    since: SINCE,
    source: '机制来自 CSS 线性渐变平铺，自行实现',
    when: '要一层技术图纸那样的细网格，做深色底或图版背衬',
    stage: 'dark',
    tier: 'core',
    params: [
      { name: 'cell', label: '格子边长', type: 'range', min: 8, max: 48, step: 2, default: 26, unit: 'px' },
    ],
    description: `一层淡淡的网格线铺在深色底上，像工程图纸或者绘图软件的画布。

机制是 ==两条 1px 的线性渐变，各管一个方向，再靠 background-size 定格子大小==。一条 \`linear-gradient\` 画水平线、一条画垂直线，两条都不重复（\`no-repeat\` 不写也能工作，因为平铺的就是这张最小图块）。格子边长由 \`background-size\` 一个值控制，纵横同时生效。`,
    code: [
      {
        lang: 'html',
        body: `<div class="bp">
  <b>蓝图底</b>
  <p>两条渐变，一层网格。</p>
</div>`,
      },
      {
        lang: 'css',
        body: `.bp {
  width: min(380px, 80vw);
  padding: 30px;
  background-color: #0d1a24;
  /* @mechanism 两条 1px 渐变，一个方向一条 */
  background-image:
    linear-gradient(rgb(120 190 255 / 0.24) 1px, transparent 1px),
    linear-gradient(90deg, rgb(120 190 255 / 0.24) 1px, transparent 1px);
  /* @mechanism 一个值同时定纵横格子 */
  background-size: var(--cell, 26px) var(--cell, 26px);
  font: 400 14px/1.7 system-ui, sans-serif;
  color: #cfe4f5;
}

.bp b {
  display: block;
  margin-bottom: 6px;
  font-size: 18px;
}

.bp p {
  margin: 0;
  opacity: 0.66;
}`,
      },
    ],
    caveats: [
      '1px 的线在高 dpi 屏上会因为像素取整而时粗时细。要绝对均匀就写 `0.5px`，或者让网格间距是设备像素的整数倍。',
      '网格从左上角起算，容器出现半格时看起来像「没对齐」。要么用 `background-position` 挪到中心，要么让容器尺寸是格子边长的整数倍。',
      '两条渐变的顺序决定谁画在上面。它们颜色相同时看不出差别，加了两种颜色做「主次网格」才需要留意。',
      '深底浅线看得清，浅底深线在低对比屏幕上容易消失。做浅色主题时透明度要往上调。',
    ],
    notes: [
      '加第三条更大间距、更亮的线，就能做出「每五格一条粗线」的工程图纸效果——经典的三层网格。',
      '`background-color` 与 `background-image` 分开写，改底色的时不会碰坏网格。',
    ],
    _rawRef: 'https://developer.mozilla.org/en-US/docs/Web/CSS/linear-gradient',
    _origin: 'crawl',
  },

  {
    slug: 'aurora-glow',
    title: '极光流动',
    category: '图形',
    tags: ['光晕', '模糊', '动效背景'],
    since: SINCE,
    source: '自行实现',
    when: '首屏背景要一片缓慢流动的彩色光，但不想上 WebGL、也不想视频',
    stage: 'dark',
    tier: 'core',
    params: [
      { name: 'blur', label: '模糊半径', type: 'range', min: 20, max: 120, step: 5, default: 70, unit: 'px' },
    ],
    description: `深色底上几团颜色互相晕开又缓慢游走，边界全化掉了。

机制是 ==把一块彩色渐变放大到超出容器，用大半径 blur 糊掉硬边，再慢慢旋转它==。\`conic-gradient\` 会给出一圈分明的色带；模糊把这些硬边化成流体的过渡。旋转让同一块色斑在视野里移动，看起来像在流动。

好看的关键全在模糊半径够不够大。半径小的时候，它就是一个「模糊的彩色圆盘」，没有那股气。`,
    code: [
      {
        lang: 'html',
        body: `<div class="au">
  <b>极光底色</b>
  <p>一块模糊的锥形渐变在慢慢转。</p>
</div>`,
      },
      {
        lang: 'css',
        body: `.au {
  position: relative;
  isolation: isolate;
  display: grid;
  align-content: center;
  justify-items: center;
  gap: 6px;
  width: min(400px, 82vw);
  height: 220px;
  overflow: hidden;
  background: #0a0810;
  font: 400 14px/1.7 system-ui, sans-serif;
  color: #f0ead9;
}

.au::before {
  content: "";
  position: absolute;
  /* 必须比容器大，否则边缘会露出一圈没糊到的硬边 */
  inset: -45%;
  z-index: -1;
  /* @mechanism 分明的色带被大半径模糊化成流体 */
  background: conic-gradient(from 0deg, #14b8a6, #7c5cff, #f43f5e, #ff9a5a, #14b8a6);
  filter: blur(var(--blur, 70px));
  animation: au-spin 18s linear infinite;
}

.au b {
  font-size: 18px;
}

.au p {
  margin: 0;
  opacity: 0.7;
}

@keyframes au-spin {
  to {
    transform: rotate(1turn);
  }
}`,
      },
    ],
    caveats: [
      '模糊层必须**比容器大**（这里用 `inset: -45%`）。正好铺满的话，四边会露出一圈没有糊到的硬边，看起来像没对齐。',
      `半径小于 40px 左右就没有「气」了，只剩一块模糊的彩色斑。值要设得比直觉大得多，这是这个效果的全部成本所在。`,
      '大半径 blur 很吃 GPU，动起来更甚。铺满整屏时移动端会明显发热掉帧——把模糊层面积收小，或者减速到 30 秒以上一圈。',
      '`overflow: hidden` 不可少，模糊后的层会溢出容器边界，把周围全糊住。',
      '没有处理 `prefers-reduced-motion`。持续旋转的背景对前庭敏感的人很不友好，正式项目里应当停掉动画只留静态底。',
    ],
    notes: [
      '`z-index: -1` 加父级 `isolation: isolate` 把模糊层压在内容之下，同时不让它混到页面背景上去。',
      '把 `conic-gradient` 换成几层 `radial-gradient` 会得到更柔的「云团」感，锥形则更接近极光的条带。',
    ],
    _rawRef: 'https://developer.mozilla.org/en-US/docs/Web/CSS/filter-function/blur',
    _origin: 'crawl',
  },

  {
    slug: 'halftone-mask',
    title: '半调网点渐隐',
    category: '图形',
    tags: ['半调', '遮罩', '网点'],
    since: SINCE,
    source: '机制来自 CSS mask-image，自行实现',
    when: '点阵要往下逐渐消失，像漫画里从实到虚的网点',
    stage: 'plain',
    tier: 'candidate',
    params: [
      { name: 'cell', label: '网点间距', type: 'range', min: 6, max: 24, step: 1, default: 10, unit: 'px' },
    ],
    description: `整齐的圆点从上到下越来越淡，最后化进背景里。

机制是 ==点阵本身完全均匀，用 mask 的渐变控制哪一段显示==。点的大小和间距是不变的——渐隐是靠遮罩的透明度做出来的。这也解释了为什么它比「越往下点越小」的做法省事：点阵只需要一个可平铺的图块，渐变交给遮罩，两者互不干扰。`,
    code: [
      {
        lang: 'html',
        body: `<div class="ht"></div>`,
      },
      {
        lang: 'css',
        body: `.ht {
  width: min(320px, 78vw);
  height: 190px;
  /* @mechanism 均匀的点阵，一个图块平铺 */
  background-image: radial-gradient(circle, #b4462f 36%, transparent 37%);
  background-size: var(--cell, 10px) var(--cell, 10px);
  /* @mechanism 渐隐完全由遮罩负责，点阵本身不变 */
  -webkit-mask-image: linear-gradient(180deg, #000 0%, rgb(0 0 0 / 0.35) 62%, transparent 100%);
  mask-image: linear-gradient(180deg, #000 0%, rgb(0 0 0 / 0.35) 62%, transparent 100%);
}`,
      },
    ],
    caveats: [
      '`mask` 的透明区是**彻底不显示**，不是变淡。所以渐隐效果靠的是渐变里的 alpha 值，`transparent` 与 `rgb(0 0 0 / 0.35)` 这两档要按实际观感调。',
      '需要 `-webkit-mask-image` 前缀照顾旧版 Safari，两行都要写。',
      '点阵间距（`background-size`）与遮罩的过渡区间要对上：过渡太窄会看到「上面一整块点、下面一刀切」。',
      '`mask` 会创建新的层叠上下文，并可能触发额外的合成层。大面积使用时留意一下性能。',
      '点很小时 anti-aliasing 会让它偏灰；`36%` 这个色标位置是点径与格子的比例，调它会同时改变点的实心度。',
    ],
    notes: [
      '遮罩的方向换成任意角度就是斜向渐隐，改 `linear-gradient` 的角度即可，点阵完全不用动。',
      '同一招也能给图片做「从实到虚」的过渡，把 `background-image` 换成 `url()` 就行。',
    ],
    _rawRef: 'https://developer.mozilla.org/en-US/docs/Web/CSS/mask-image',
    _origin: 'crawl',
  },

  /* ────────────────────────────── 材质 ────────────────────────────── */
  {
    slug: 'inner-glow',
    title: '内发光',
    category: '材质',
    tags: ['发光', '阴影', '质感'],
    since: SINCE,
    source: '机制来自 CSS box-shadow 的 inset，自行实现',
    when: '深色面板要有一圈从边缘渗进去的光，像里面有东西在亮',
    stage: 'dark',
    tier: 'core',
    params: [
      { name: 'spread', label: '渗入深度', type: 'range', min: 4, max: 40, step: 2, default: 16, unit: 'px' },
    ],
    description: `面板边缘有一圈柔光往里渗，中间反而更暗，看着像凹进去或者里面有光源。

机制是 ==box-shadow 加 inset==。默认的阴影画在盒子外面，\`inset\` 把它翻到里面——于是阴影从边缘向内投射，形成内发光。可以用逗号叠好几层，一层管近处的锐利光边、一层管远处的弥散，质感比单层好得多。

关键是底下那层不能是纯黑：要有底色，光才有东西可以落在上面。`,
    code: [
      {
        lang: 'html',
        body: `<div class="ig">
  <b>内发光</b>
  <p>光从边缘往里渗。</p>
</div>`,
      },
      {
        lang: 'css',
        body: `.ig {
  width: min(320px, 78vw);
  padding: 26px 28px;
  border: 1px solid rgb(217 164 65 / 0.3);
  background: radial-gradient(120% 120% at 50% 0%, #241d33 0%, #120f1c 72%);
  /* @mechanism inset 把阴影翻到盒子里面，从边缘向内投 */
  box-shadow:
    inset 0 0 var(--spread, 16px) rgb(217 164 65 / 0.3),
    inset 0 0 calc(var(--spread, 16px) * 3) rgb(124 92 255 / 0.18);
  font: 400 14px/1.7 system-ui, sans-serif;
  color: #f0ead9;
}

.ig b {
  display: block;
  margin-bottom: 6px;
  font-size: 18px;
}

.ig p {
  margin: 0;
  opacity: 0.72;
}`,
      },
    ],
    caveats: [
      '底色不能是纯黑。内发光是「光落在底色上」，`#000` 上什么都不显示——看到的现象是「内发光没生效」，其实是没东西可照。',
      '`inset` 与普通阴影不能在同一条 `box-shadow` 里混着写同一组值，语义完全不同：一个向内一个向外。要叠就分条写。',
      '模糊半径与扩展半径的作用不同：模糊半径让光变柔，扩展半径让光带变宽。只调前者会得到「贴边的亮线」，只调后者会得到「一整块灰」。',
      '内发光对边框是**画在边框里面**的。有 `border` 时那圈边框会盖住发光的内侧，看起来发光是从边框内沿开始的。',
      '多层 `inset` 阴影会逐层合成，层数多了成本上升。超过三层建议改用 `radial-gradient` 直接画。',
    ],
    notes: [
      '两层不同颜色（暖金 + 冷紫）叠出来的光比单色有层次，也更像有实体光源。',
      '同一招把 `inset` 去掉就是外发光。外发光配 `border-radius` 能做出霓虹管的边缘光。',
    ],
    _rawRef: 'https://developer.mozilla.org/en-US/docs/Web/CSS/box-shadow',
    _origin: 'crawl',
  },
]
