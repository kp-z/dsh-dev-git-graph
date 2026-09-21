/**
 * 第 6 批采集草稿：排版与交互深化。
 *
 * 这一批的共同点是「浏览器已经知道的状态」——空不空、有效不有效、焦点在哪、
 * 输入设备是手指还是鼠标。把这些状态接出来，就不必自己维护一份影子状态。
 *
 * 用法：
 *   node scripts/prepare-draft.mjs drafts/batch-06.mjs
 *   node scripts/ingest.mjs drafts/batch-06.mjs --dry-run
 *   node scripts/ingest.mjs drafts/batch-06.mjs
 */

const SINCE = '2026-09'

export default [
  /* ────────────────────────────── 排版 ────────────────────────────── */
  {
    slug: 'line-height-unitless',
    title: '无单位行高',
    category: '排版',
    tags: ['行高', '继承', '字号'],
    since: SINCE,
    source: '机制来自 CSS 行高的计算值继承规则，自行实现',
    when: '正文的行高挺好，但里面字号不同的元素行距全乱了',
    stage: 'plain',
    tier: 'core',
    params: [],
    description: `父级设了行高，里面的小字与大标题各自保持合适的行距。

机制是 ==无单位行高在继承时传的是「倍数」，带单位的传的是「算好的长度」==。\`line-height: 1.6\` 传给子元素后，子元素按**自己的**字号再乘一次；而 \`line-height: 24px\` 传下去就是一个固定的 24px——子元素字号只剩 12px 时，那 24px 就成了 2 倍行高，文字散开。

一句话：**无单位是公式，带单位是结果**。公式会随字号重新求值，结果不会。`,
    code: [
      {
        lang: 'html',
        body: `<div class="lh">
  <p>正文的行高是 1.7。这一段话够长，可以看清行距关系。</p>
  <h3>里面的标题</h3>
  <p>标题的字号比正文大，但行距并没有被它带偏。</p>
</div>`,
      },
      {
        lang: 'css',
        body: `.lh {
  width: min(420px, 84vw);
  padding: 20px 22px;
  border: 1px solid rgb(60 48 30 / 0.28);
  background: rgb(255 255 255 / 0.4);
  font-family: system-ui, sans-serif;
  color: #1c1a17;
  /* @mechanism 无单位：继承的是倍数，子元素按自己的字号重算 */
  line-height: 1.7;
}

.lh p {
  margin: 0 0 10px;
  font-size: 15px;
}

.lh h3 {
  margin: 16px 0 6px;
  font-size: 24px;
  /* 标题可以单独收紧——它继承的是倍数，所以这里给 1.25 就是 30px */
  line-height: 1.25;
}`,
      },
    ],
    caveats: [
      '带单位（或百分比）的行高继承的是**计算结果**。子元素字号一变，行距比例就失调——这是「标题上方忽然多出一大块空白」最常见的原因。',
      '百分比与带单位的行为相同（都继承计算值），只有**无单位**的才是倍数。三者看起来像一回事，继承行为完全不同。',
      '无单位行高没有上限，但过小时会被规范按 `1` 处理。这不代表 1 就够用——中文设 1 会让行间几乎贴上。',
      '它影响的是**行盒**高度，不是字号。把行高设小并不会让字变小，只会让行挤在一起。',
      '按钮、表格单元格这类内部有自己的行高规则，继承下来的值可能与预期不同，需要单独覆盖。',
    ],
    notes: [
      '全局 `body { line-height: 1.6 }` 配正文 1.7、标题 1.2，是稳妥的分层方式。',
      '排版里判断「行距是否失调」只看一件事：字号变化处是否出现了比例突变。',
    ],
    _rawRef: 'https://developer.mozilla.org/en-US/docs/Web/CSS/line-height',
    _origin: 'crawl',
  },

  {
    slug: 'tabular-numbers',
    title: '等宽数字',
    category: '排版',
    tags: ['数字', '表格', '对齐'],
    since: SINCE,
    source: '机制来自 OpenType 的 tnum 特性与 font-variant-numeric，自行实现',
    when: '计时器、计数器或表格里的数字一变，整行就在左右抖',
    stage: 'plain',
    tier: 'core',
    params: [],
    description: `数字每秒跳一次，但整行纹丝不动。

机制是 ==font-variant-numeric: tabular-nums 让每个数字占同样的宽度==。默认的成比例数字里「1」比「0」窄，字数一样但总宽度却总在变，于是右边的所有内容跟着抖。等宽数字把每个数字锁定在同宽字格里，数字变动就成了原地替换。

表格、计时器、金额、计数器——凡是数字会变的地方都该开它。`,
    code: [
      {
        lang: 'html',
        body: `<div class="tn">
  <div class="tn-row">
    <span class="tn-label">成比例（默认）</span>
    <b class="tn-num">1,111.11</b>
  </div>
  <div class="tn-row">
    <span class="tn-label">等宽数字</span>
    <b class="tn-num tn-fixed">1,111.11</b>
  </div>
</div>`,
      },
      {
        lang: 'css',
        body: `.tn {
  width: min(360px, 82vw);
  border: 1px solid rgb(60 48 30 / 0.28);
  background: rgb(255 255 255 / 0.4);
  font: 400 15px/1.5 system-ui, sans-serif;
  color: #1c1a17;
}

.tn-row {
  display: flex;
  justify-content: space-between;
  padding: 13px 16px;
  border-bottom: 1px solid rgb(60 48 30 / 0.16);
}

.tn-row:last-child {
  border-bottom: 0;
}

.tn-num {
  font-variant-numeric: proportional-nums;
}

.tn-fixed {
  /* @mechanism 每个数字占同一宽度，数字变动不再撑动整行 */
  font-variant-numeric: tabular-nums;
  color: #b4462f;
}`,
      },
    ],
    caveats: [
      '它依赖**字体本身**提供 `tnum` 特性。字体不支持时规则被无声忽略——没有任何提示，只能靠眼睛看出「还是没对齐」。',
      '这是**字形级**的切换：等宽数字通常比成比例数字略宽，所以开启后整行的总宽度会变一点。布局紧的地方要留意。',
      '只对数字生效，不影响字母与标点。要对齐小数点还得靠等宽数字加右对齐，属性本身不管对齐。',
      '与之相对的是 `oldstyle-nums`（旧式数字，有升有降），正文字体里更雅致，但**绝不能用在表格里**——它的目的就是让数字不齐。',
      '`font-feature-settings: "tnum"` 也能开同一个特性，但那是底层接口、会覆盖其他特性设置。优先用 `font-variant-numeric`，别两个同时写。',
    ],
    notes: [
      '等宽数字是「让变化的东西不引起版面变化」这条原则的一个具体落法，和防布局抖动的思路一致。',
      '代码与终端里所有字体默认就是等宽的，所以在等宽字体里这个属性没有可见效果。',
    ],
    _rawRef: 'https://developer.mozilla.org/en-US/docs/Web/CSS/font-variant-numeric',
    _origin: 'crawl',
  },

  {
    slug: 'text-box-trim',
    title: '裁掉行高留白',
    category: '排版',
    tags: ['行盒', '间距', '对齐'],
    since: SINCE,
    source: '机制来自 CSS Inline Layout 的 text-box-trim，自行实现',
    when: '标题上方总有一块看不见的空，怎么调 margin 都对不齐',
    stage: 'plain',
    tier: 'candidate',
    params: [],
    description: `标题与上边界的距离正好是眼睛看到的距离，没有藏在行盒里的那一截。

机制是 ==text-box-trim 把行盒顶部与底部多余的留白裁掉==。字体为了容纳升部、降部以及更极端的字符，会在字形的上下各预留空间。所以文字块的上方永远有一块看不见的空——调 \`margin\` 时你在跟它较劲。这个属性让行盒贴合实际字形的高度。

它不改变盒模型，改变的是**行盒内部**文字所占的高度。`,
    code: [
      {
        lang: 'html',
        body: `<div class="bt-box">
  <h3 class="bt-h">上边距是真实的</h3>
  <p class="bt-p">这两块之间的距离就是眼睛看到的距离。</p>
</div>`,
      },
      {
        lang: 'css',
        body: `.bt-box {
  width: min(380px, 82vw);
  padding: 22px 24px;
  border: 1px solid rgb(60 48 30 / 0.3);
  background: rgb(255 255 255 / 0.42);
  font-family: system-ui, sans-serif;
  color: #1c1a17;
}

.bt-h {
  margin: 0;
  font-size: 26px;
  line-height: 1.2;
  /* @mechanism 行盒裁到字形高度，上方的隐形留白没了 */
  text-box-trim: trim-both;
  text-box-edge: cap alphabetic;
}

.bt-p {
  margin: 14px 0 0;
  font-size: 15px;
  line-height: 1.7;
  text-box-trim: trim-both;
  text-box-edge: cap alphabetic;
}`,
      },
    ],
    caveats: [
      '支持面还窄。不支持时留白照旧——**不破版**，只是「怎么调都不对」的问题依然在。',
      '`text-box-edge` 决定裁到哪：`cap alphabetic` 按大写字母顶端与基线，`ex alphabetic` 按小写 x 高度。**中文字形的度量与拉丁不同**，裁掉之后中文往往显得上紧下松。',
      '它改变的是行盒内部的排布，不影响盒模型的尺寸。所以与下一个元素的视觉距离变短了，但 `margin` 的数值没变——协作时要说明白。',
      '多行文本上只会裁首行与末行，中间行不变。这是它的设计意图，不是缺陷。',
      '字体一换，理想的首行位置就变了。它让排版更精确，同时也让「同一样式在不同字体下的垂直位置」更难预测。',
    ],
    notes: [
      '它解决的是「文字块与容器之间的视觉间距」这一老问题，比 `padding` 猜数值可靠得多。',
      '配 `line-height: 1` 一起用时效果最明显——那正是留白最突兀的情况。',
    ],
    _rawRef: 'https://developer.mozilla.org/en-US/docs/Web/CSS/text-box-trim',
    _origin: 'crawl',
  },

  {
    slug: 'hanging-punctuation',
    title: '标点悬挂',
    category: '排版',
    tags: ['标点', '中文排版', '对齐'],
    since: SINCE,
    source: '机制来自 CSS Text 的 hanging-punctuation，自行实现',
    when: '段落以引号开头，整行被推进去一格，左右边线不齐',
    stage: 'plain',
    tier: 'candidate',
    params: [],
    description: `段落开头的引号探出版心之外，正文的第一列仍然笔直。

机制是 ==hanging-punctuation 让标点悬挂到版心之外==。中文排版里行首的引号、括号不该把正文挤进去——传统做法就是让它探出边线。这个属性让浏览器做这件事，而不必用负 \`text-indent\` 去猜该挪多少。

它是「版心」与「标点」之间关系的正解。`,
    code: [
      {
        lang: 'html',
        body: `<div class="hp">
  <p class="hp-on">「机制要说得清，出处要记得住。」这一段的首字是引号，它探出了左边线。</p>
  <p>后面这一段以正文字开头，左边线自然对齐。</p>
</div>`,
      },
      {
        lang: 'css',
        body: `.hp {
  width: min(420px, 84vw);
  padding: 20px 24px;
  border: 1px solid rgb(60 48 30 / 0.28);
  background: rgb(255 255 255 / 0.4);
  font: 400 15px/2 "Songti SC", "SimSun", serif;
  color: #1c1a17;
}

.hp p {
  margin: 0 0 14px;
}

.hp-on {
  /* @mechanism 行首标点挂到版心之外，正文保持齐头 */
  hanging-punctuation: first last;
}`,
      },
    ],
    caveats: [
      '支持面**极窄**（基本只有 Safari）。写进库是为了把机制说清楚，实际项目要用 `@supports (hanging-punctuation: first)` 兜底，退回负 `text-indent` 方案。',
      '`first` 管行首、`last` 管行末、`allow-end` 是行末的宽松处理。不写就都不管，默认值不是「智能开启」。',
      '它依赖浏览器知道字体的**标点压缩信息**。中文字体一般有，拉丁字体几乎没有——所以在西文里它基本不发生。',
      '行首禁止标点（避头尾）是另一套规则（`line-break: strict`），与悬挂不是一回事，中排场景常常要一起配。',
      '悬挂出去的标点会超出容器边界。父级有 `overflow: hidden` 时会被裁掉，看起来像标点缺了一半。',
    ],
    notes: [
      '用负 `text-indent` 的经典替代方案：`text-indent: -0.5em` 配 `padding-left: 0.5em`，机制不同但视觉接近。',
      '悬挂的实际价值在「多列正文」里最明显——两列之间的边线齐了，整块就稳了。',
    ],
    _rawRef: 'https://developer.mozilla.org/en-US/docs/Web/CSS/hanging-punctuation',
    _origin: 'crawl',
  },

  {
    slug: 'font-size-adjust',
    title: '换字体不改视觉大小',
    category: '排版',
    tags: ['字体', 'x 高度', '回退'],
    since: SINCE,
    source: '机制来自 CSS Fonts 的 font-size-adjust，自行实现',
    when: '回退字体一加载，整页文字看起来忽然变大或变小',
    stage: 'plain',
    tier: 'candidate',
    params: [],
    description: `两种字体并排，字号属性一样，看起来也一样大。

机制是 ==font-size-adjust 按「x 高度占字号的比例」校正实际渲染尺寸==。不同字体的 x 高度差异很大：同样 16px，有的看起来明显更大。这个属性让浏览器把渲染尺寸校正到给定的比例，于是**换字体时视觉尺寸不跳**。

它调的是渲染尺寸，不是 \`font-size\` 的值——从计算样式里看不出变化。`,
    code: [
      {
        lang: 'html',
        body: `<div class="fa">
  <p class="fa-a">Aa 未校正的字体</p>
  <p class="fa-b">Aa 校正之后</p>
</div>`,
      },
      {
        lang: 'css',
        body: `.fa {
  width: min(380px, 82vw);
  padding: 22px 24px;
  border: 1px solid rgb(60 48 30 / 0.28);
  background: rgb(255 255 255 / 0.42);
  color: #1c1a17;
}

.fa p {
  margin: 0 0 10px;
  font: 400 28px/1.3 Georgia, "Times New Roman", serif;
}

.fa-a {
  font-size-adjust: none;
}

.fa-b {
  /* @mechanism 按 x 高度比例校正渲染尺寸，换字体视觉大小不跳 */
  font-size-adjust: 0.52;
  color: #b4462f;
}`,
      },
    ],
    caveats: [
      '它调的是**渲染尺寸**，`font-size` 的计算值完全不变。用「计算样式里字号没变」来判断它有没有生效是错的。',
      '值填的是**目标 x 高度比例**（如 0.52），不是字号。填错会让文字整体偏大或偏小，而且不易察觉是这个属性造成的。',
      '字体本身没有 x 高度度量信息时无效。系统自带的等宽字体或某些极端字体可能缺这项数据。',
      '渲染尺寸变了，**行高表现也跟着变**。视觉上文字变大时行距会显得更紧，要一并检查。',
      '支持面有限（Firefox 支持最好）。不支持时退回正常渲染——不会破版，只是字体回退时的尺寸跳变还在。',
      '它是为「字体回退」设计的，不是做缩放的工具。想做响应式缩放应当用 `clamp()` 改字号。',
    ],
    notes: [
      '它的第二个用途是给 `font-family` 列表里差异很大的字体做视觉统一，比如中文回退到系统字体时。',
      '配 `size-adjust`（`@font-face` 描述符）可以做到更精细的字形缩放，但那是字体级而不是元素级的设置。',
    ],
    _rawRef: 'https://developer.mozilla.org/en-US/docs/Web/CSS/font-size-adjust',
    _origin: 'crawl',
  },

  {
    slug: 'text-underline-offset',
    title: '下划线的位置与粗细',
    category: '排版',
    tags: ['下划线', '装饰线', '链接'],
    since: SINCE,
    source: '机制来自 CSS Text Decoration 的三个独立属性，自行实现',
    when: '默认下划线贴着字、穿过字母尾巴，看着很挤',
    stage: 'plain',
    tier: 'core',
    params: [
      { name: 'offset', label: '离字距离', type: 'range', min: 0, max: 0.4, step: 0.02, default: 0.2, unit: 'em' },
    ],
    description: `下划线离文字有点距离、粗细均匀，而且遇到 g、j 的尾巴会自动让开。

机制是 ==下划线由三个独立属性控制：粗细、位置、以及「是否避开字母降部」==。\`text-decoration-skip-ink: auto\` 是印刷里一直有的做法——装饰线在字母的尾巴处断开，读起来更干净。三者都是独立属性，可以分别调。

默认值在各浏览器上并不一致，所以要跨浏览器一致就得显式写全。`,
    code: [
      {
        lang: 'html',
        body: `<p class="uo">机制要说得清，出处要记得住。看看 <a class="uo-link" href="#">这条链接</a> 的下划线，它的位置和粗细都是显式给的。</p>`,
      },
      {
        lang: 'css',
        body: `.uo {
  width: min(440px, 84vw);
  margin: 0;
  font: 400 17px/1.9 system-ui, sans-serif;
  color: #1c1a17;
}

.uo-link {
  color: #b4462f;
  text-decoration: underline;
  /* @mechanism 三个独立属性：粗细、位置、避让 */
  text-decoration-thickness: 2px;
  text-underline-offset: var(--offset, 0.2em);
  text-decoration-skip-ink: auto;
  text-decoration-color: rgb(180 70 47 / 0.55);
  transition: text-decoration-color 0.2s;
}

.uo-link:hover {
  text-decoration-color: #b4462f;
}`,
      },
    ],
    caveats: [
      '`text-underline-offset` 用带单位的相对值（`em`）才随字号缩放。用 `px` 时字号一换位置就错——这是「小字下划线离得远、大字贴得近」的原因。',
      '`text-decoration-skip-ink: none` 会让线穿过 g、j、p、q 的尾巴，看起来脏。但某些 CJK 场景下让开反而奇怪，要按语种决定。',
      '`text-decoration-thickness: auto` 时各引擎给的粗细不同。要跨浏览器一致必须显式写厚度，不能靠默认值。',
      '装饰线的能力就到颜色、粗细、位置、线型为止——**做不出渐变、圆头或虚线动画**。渐变下划线只能用背景图方案（那是另一个条目）。',
      '覆盖 UA 样式时不要顺手 `text-decoration: none` 把链接的下划线彻底去掉。去掉之后链接只剩颜色可辨，对色觉障碍用户不友好。',
    ],
    notes: [
      '`text-decoration-color` 通常设得比文字色淡一点，视觉上更安静；悬停时再提饱和，是很轻的反馈。',
      '`text-underline-position: under` 与 `text-underline-offset` 是两套定位方式，混用时以其中一个为准。',
    ],
    _rawRef: 'https://developer.mozilla.org/en-US/docs/Web/CSS/text-underline-offset',
    _origin: 'crawl',
  },

  {
    slug: 'text-wrap-pretty',
    title: '避免末行只剩一个字',
    category: '排版',
    tags: ['换行', '段落', '孤字'],
    since: SINCE,
    source: '机制来自 CSS Text 的 text-wrap 取值，自行实现',
    when: '段落最后一行总是掉下来一个词，看着难受',
    stage: 'plain',
    tier: 'candidate',
    params: [],
    description: `段落最后一行不会只剩一个词孤零零地挂着。

机制是 ==text-wrap: pretty 让浏览器在换行时避开末行孤字这类难看结果==。它和 \`balance\` 目标不同：\`balance\` 求**每行长度尽量相等**（适合标题，行数少），\`pretty\` **只优化末行**（适合正文，代价低得多）。

同一族属性、两种取向：短的用 \`balance\`，长的用 \`pretty\`。`,
    code: [
      {
        lang: 'html',
        body: `<div class="tw">
  <p class="tw-wrap">这是一段用来观察末行的文字，它的长度被刻意安排成容易在最后掉下一个词的样子，好让你看清差别。</p>
  <p class="tw-wrap tw-pretty">这是一段用来观察末行的文字，它的长度被刻意安排成容易在最后掉下一个词的样子，好让你看清差别。</p>
</div>`,
      },
      {
        lang: 'css',
        body: `.tw {
  width: min(420px, 84vw);
  padding: 20px 22px;
  border: 1px solid rgb(60 48 30 / 0.28);
  background: rgb(255 255 255 / 0.4);
  font: 400 15px/1.7 system-ui, sans-serif;
  color: #1c1a17;
}

.tw p {
  margin: 0 0 16px;
  text-wrap: wrap;
}

.tw-pretty {
  /* @mechanism 只优化末行，代价比 balance 低 */
  text-wrap: pretty;
  color: #b4462f;
}`,
      },
    ],
    caveats: [
      '`balance` 求各行等长、`pretty` 只治末行。**用错类别会得到奇怪的断行**——标题用 `pretty` 不会变整齐，正文用 `balance` 会被它的行数上限截断。',
      '`balance` 有行数上限（通常在 6 行左右），超过就退回普通换行。这也是它只适合标题的原因。',
      '`pretty` 仍会评估整个段落，只是范围比 `balance` 小。极长段落里依然会带来额外的布局计算。',
      '支持面较新。不支持时退回默认换行——不破版，只是孤字还在。',
      '它是为**词间有空格的文字**设计的。中文没有空格，断行点更密，这个属性的优化效果远不如西文明显。',
    ],
    notes: [
      '把它放在 `body` 上做全局默认是安全的——不支持就忽略，支持就自动变好。',
      '标题上仍应显式用 `text-wrap: balance`，两者职责不同，别指望一个属性包办。',
    ],
    _rawRef: 'https://developer.mozilla.org/en-US/docs/Web/CSS/text-wrap',
    _origin: 'crawl',
  },

  /* ────────────────────────────── 交互 ────────────────────────────── */
  {
    slug: 'float-label',
    title: '浮动标签',
    category: '交互',
    tags: ['表单', '占位', '伪类'],
    since: SINCE,
    source: '机制来自 CSS 的 :placeholder-shown，自行实现',
    when: '标签要在框里当占位、有内容时缩到上面去，但不想用 JS 判断空值',
    stage: 'plain',
    tier: 'core',
    params: [],
    description: `输入框空着时，标签就在框里当提示；一开始打字，标签缩到上边、文字在下面。

机制是 ==:placeholder-shown 匹配「此刻正显示着占位文字」的元素==，也就是「输入框是空的」。有了这个「是否为空」的信号，纯 CSS 就能做浮动标签——不需要监听 \`input\` 事件，也不需要维护一份影子状态。

光标聚焦时也浮起来（用户正要开始输入），所以选择器要同时写 \`:focus\` 与 \`:not(:placeholder-shown)\`。`,
    code: [
      {
        lang: 'html',
        body: `<div class="fl-field">
  <input class="fl-input" id="sb-fl" placeholder=" " />
  <label class="fl-label" for="sb-fl">你的名字</label>
</div>`,
      },
      {
        lang: 'css',
        body: `.fl-field {
  position: relative;
  width: min(300px, 78vw);
}

.fl-input {
  width: 100%;
  padding: 22px 14px 8px;
  border: 1px solid rgb(60 48 30 / 0.35);
  background: rgb(255 255 255 / 0.5);
  font: 400 16px/1.4 system-ui, sans-serif;
  color: #1c1a17;
}

.fl-label {
  position: absolute;
  left: 14px;
  top: 15px;
  font: 400 15px/1 system-ui, sans-serif;
  color: rgb(28 26 23 / 0.5);
  /* @mechanism 标签不能吃掉输入框的点击 */
  pointer-events: none;
  transition: top 0.2s ease, font-size 0.2s ease, color 0.2s ease;
}

/* @mechanism :placeholder-shown = 此刻是空的；所以浮起条件取它的反面 */
.fl-input:focus + .fl-label,
.fl-input:not(:placeholder-shown) + .fl-label {
  top: 7px;
  font-size: 12px;
  color: #b4462f;
}`,
      },
    ],
    caveats: [
      '输入框**必须有非空的 `placeholder`**。写 `placeholder=" "`（一个空格）就行，但完全不给的话 `:placeholder-shown` 永远不匹配，标签不会浮动。',
      '标签必须用 `+` 或 `~` 跟在输入框**后面**。CSS 只能往后选，DOM 顺序反了就选不到——`for` 属性在这里帮不上忙。',
      '`pointer-events: none` 不能少，否则标签浮在输入框上方时会挡住点击，用户点不进去。',
      '浮起的条件要同时包含 `:focus`。只写 `:not(:placeholder-shown)` 的话，聚焦一个空框时标签不会让位。',
      '浏览器自动填充时 `:placeholder-shown` 的行为各版本有过差异，需要实测——自动填好的值若没让标签浮起，会与输入的文字重叠。',
    ],
    notes: [
      '这套的通用价值在于：**把浏览器已知的状态接出来，而不是自己再记一份**。`value.length > 0` 这类影子状态能省就省。',
      '同一机制可以做「清空按钮只在有内容时出现」：`.input:not(:placeholder-shown) ~ .clear { display: block }`。',
    ],
    _rawRef: 'https://developer.mozilla.org/en-US/docs/Web/CSS/:placeholder-shown',
    _origin: 'crawl',
  },

  {
    slug: 'dialog-modal',
    title: '原生模态对话框',
    category: '交互',
    tags: ['dialog', '模态', '焦点'],
    since: SINCE,
    source: '机制来自 HTML 的 dialog 元素与 showModal()，自行实现',
    when: '要一个真正的模态弹窗，但不想自己写焦点陷阱与背景遮罩',
    stage: 'dark',
    tier: 'core',
    params: [],
    description: `点开按钮弹出一个对话框，背景不能再点、Tab 只在框内循环、按 Esc 自动关闭。

机制是 ==showModal() 让 dialog 进入顶层，并把页面其余部分标记为 inert==。焦点陷阱、背景不可交互、Esc 关闭这三件事都是浏览器给的。\`open\` 属性只是「显示」，\`showModal()\` 才有模态语义——这个区别是这一条的全部。

自己写模态最容易翻车的三处，浏览器都替你处理了。`,
    code: [
      {
        lang: 'html',
        body: `<button class="dlg-btn" id="sb-dlg-open">打开对话框</button>

<dialog class="dlg" id="sb-dlg">
  <h3>原生模态</h3>
  <p>背景不可点，Tab 只在框内走，Esc 会关掉它。</p>
  <form method="dialog">
    <button class="dlg-close">知道了</button>
  </form>
</dialog>`,
      },
      {
        lang: 'css',
        body: `.dlg-btn {
  padding: 12px 22px;
  border: 1px solid rgb(217 164 65 / 0.5);
  background: rgb(217 164 65 / 0.12);
  font: 500 15px/1 system-ui, sans-serif;
  color: #f0ead9;
  cursor: pointer;
}

.dlg {
  /* @mechanism 顶层元素，覆盖 UA 默认的边框与内边距 */
  width: min(320px, 80vw);
  padding: 24px 26px;
  border: 1px solid rgb(180 70 47 / 0.55);
  background: #1b1626;
  font: 400 14px/1.7 system-ui, sans-serif;
  color: #f0ead9;
}

.dlg::backdrop {
  background: rgb(6 4 10 / 0.72);
  backdrop-filter: blur(3px);
}

.dlg h3 {
  margin: 0 0 8px;
  font-size: 19px;
}

.dlg p {
  margin: 0 0 18px;
  opacity: 0.76;
}

.dlg-close {
  width: 100%;
  padding: 11px;
  border: 1px solid rgb(217 164 65 / 0.5);
  background: rgb(217 164 65 / 0.16);
  font: 500 14px/1 system-ui, sans-serif;
  color: #f0ead9;
  cursor: pointer;
}`,
      },
      {
        lang: 'js',
        body: `const dialog = document.getElementById('sb-dlg')
const opener = document.getElementById('sb-dlg-open')
if (dialog && opener) {
  opener.addEventListener('click', () => dialog.showModal())
}`,
      },
    ],
    caveats: [
      '`open` 属性与 `showModal()` **不是一回事**。加 `open` 只是显示（背景仍可交互、没有焦点陷阱）；必须调 `showModal()` 才拿到模态的全部待遇。',
      '背景 inert 会让页面其余部分**完全不可聚焦**，包括你自己做的滚动容器。长页面上要另外处理滚动锁定，否则用户滚不动背景。',
      '`<dialog>` 自带 UA 的边框、内边距与最大宽度，各浏览器不一致。要一致必须显式覆盖。',
      '进出的过渡要配 `@starting-style` 与 `transition-behavior: allow-discrete`——`display` 是离散属性，默认不参与过渡。',
      '关闭路径有三条：Esc、`<form method="dialog">`、调用 `close()`。要确认都覆盖到了；Esc 可以用 `cancel` 事件拦截。',
      '`::backdrop` 只能设颜色、背景与滤镜，做不出内边距之类的盒模型属性。',
    ],
    notes: [
      '`<form method="dialog">` 让表单提交直接关闭对话框并带回 `returnValue`，省掉一个关闭按钮的事件处理。',
      '这一条与之前的 `popover-native` 分工不同：`popover` 是非模态浮层，`dialog` 是模态。要挡住背景交互就用后者。',
    ],
    _rawRef: 'https://developer.mozilla.org/en-US/docs/Web/HTML/Element/dialog',
    _origin: 'crawl',
  },

  {
    slug: 'hover-intent-delay',
    title: '给指针留出穿越时间',
    category: '交互',
    tags: ['悬停', '延迟', '方向'],
    since: SINCE,
    source: '机制来自 CSS transition-delay 的分状态声明，自行实现',
    when: '触发区和面板之间有一道缝，鼠标穿过去时面板总会先消失',
    stage: 'grid',
    tier: 'core',
    params: [
      { name: 'grace', label: '穿越时间', type: 'range', min: 0.1, max: 0.6, step: 0.05, default: 0.25, unit: 's' },
    ],
    description: `鼠标从按钮移向面板，中间跨过一道空隙，面板稳稳地开着；移开之后才缓缓收起。

机制是 ==transition-delay 可以在两个状态里分别声明==。展开时不给延迟——操作跟着手走；收起时给一个延迟——这就给了指针从触发区穿到面板上的时间。中间那段空隙不再导致面板提前消失。

难点在于延迟要写在**收起状态**（基础规则）上，而不是展开状态上。`,
    code: [
      {
        lang: 'html',
        body: `<div class="hi">
  <div class="hi-trigger">悬停这里</div>
  <div class="hi-panel">
    <b>面板</b>
    <span>指针可以穿过缝隙过来</span>
  </div>
</div>`,
      },
      {
        lang: 'css',
        body: `.hi {
  width: min(280px, 76vw);
  font: 400 13px/1.6 system-ui, sans-serif;
}

.hi-trigger {
  padding: 12px 16px;
  border: 1px solid rgb(60 48 30 / 0.32);
  background: rgb(255 255 255 / 0.5);
  color: #1c1a17;
  cursor: default;
}

.hi-panel {
  margin-top: 10px;
  padding: 14px 16px;
  border: 1px solid rgb(180 70 47 / 0.5);
  background: #1b1626;
  color: #f0ead9;
  opacity: 0;
  visibility: hidden;
  /* @mechanism 收起时延迟——留给指针穿越缝隙的时间 */
  transition: opacity 0.2s ease, visibility 0.2s ease;
  transition-delay: var(--grace, 0.25s);
}

.hi-panel b {
  display: block;
  margin-bottom: 3px;
}

.hi-panel span {
  opacity: 0.72;
}

.hi:hover .hi-panel,
.hi:focus-within .hi-panel {
  opacity: 1;
  visibility: visible;
  /* @mechanism 展开时零延迟，操作跟手 */
  transition-delay: 0s;
}`,
      },
    ],
    caveats: [
      '延迟必须写在**收起状态**（基础规则）上，展开状态里再覆盖成 `0s`。写反了会得到「展开很慢、收起很急」——与想要的正好相反。',
      '`visibility` 要参与过渡。它会延迟到过渡结束才切换，这样面板在淡出的过程中仍可交互；用 `display: none` 完全不行（离散属性，会立刻消失）。',
      '延迟不能太长。超过 300ms 就显得迟钝，用户会以为界面卡住；太短又穿不过空隙。200–300ms 是个稳妥区间。',
      '这是鼠标专属技巧。触屏没有 hover，整段要包在 `@media (hover: hover)` 里。',
      '收起有延迟意味着「确实要关掉」也慢了一点。面板里若有关键操作，延迟要调小，或者让它只在指针移开时延迟、键盘 Esc 立即关闭。',
      '用 `:focus-within` 一起写能让键盘用户也打开面板，否则这个面板对键盘完全不可达。',
    ],
    notes: [
      '同一招也能治「悬停时图标闪动」：给状态变化加一点点延迟，抖动就被吸收掉了。',
      '这个「延迟的方向不同」是过渡状态机的本质属性，值得记住——凡是需要「进入快、离开慢」的地方都是同一套写法。',
    ],
    _rawRef: 'https://developer.mozilla.org/en-US/docs/Web/CSS/transition-delay',
    _origin: 'crawl',
  },

  {
    slug: 'pointer-coarse-target',
    title: '给手指更大的靶子',
    category: '交互',
    tags: ['触摸', '命中区域', '无障碍'],
    since: SINCE,
    source: '机制来自 Media Queries Level 4 的 pointer 特性，自行实现',
    when: '桌面端合适的按钮在手机上总是点不中',
    stage: 'grid',
    tier: 'core',
    params: [],
    description: `同一排按钮，桌面端紧凑，触屏上每个都胖了一圈——外观没变，但好点多了。

机制是 ==pointer: coarse 表示主输入设备精度低（手指）==，拿它把可点区域放大到能可靠命中的尺寸。44 CSS px 这个下限不是随便定的，Apple 与 WCAG 的触控目标建议都在这个量级。

它是「同一套 UI 在触摸端给更大靶子」的最短路径。`,
    code: [
      {
        lang: 'html',
        body: `<div class="pc">
  <button class="pc-btn">确定</button>
  <button class="pc-btn">取消</button>
</div>`,
      },
      {
        lang: 'css',
        body: `.pc {
  display: flex;
  gap: 10px;
}

.pc-btn {
  position: relative;
  padding: 9px 16px;
  border: 1px solid rgb(60 48 30 / 0.34);
  background: rgb(255 255 255 / 0.52);
  font: 500 14px/1 system-ui, sans-serif;
  color: #1c1a17;
  cursor: pointer;
}

/* @mechanism 手指精度低，把命中区域撑到能可靠点中的尺寸 */
@media (pointer: coarse) {
  .pc-btn {
    min-width: 44px;
    min-height: 44px;
    padding: 12px 22px;
  }

  /* 相邻目标之间也要留缝，否则会互相误触 */
  .pc {
    gap: 14px;
  }
}`,
      },
    ],
    caveats: [
      '`pointer: coarse` 只看**主**输入设备。带触屏的笔记本主设备仍是鼠标，这条不匹配——触屏上依然是小靶子。这是它的固有局限。',
      '放大的是**命中区域**，不一定是视觉尺寸。用伪元素扩张热区（`::after { inset: -10px }`）能不改变外观就扩大可点范围。',
      '相邻目标之间也要留间距。只放大单个目标会让它们挤在一起，误触反而更多。',
      '触屏上 `:hover` 会粘住，反馈要用 `:active` 而不是 `:hover`。',
      '还有 `any-pointer: coarse`：它问的是「是否存在精度低的输入设备」而不是主设备。混合设备上用它才能覆盖到触屏。',
      '别把它当成「手机端」判断。`pointer` 描述的是输入能力，不是屏幕大小——屏幕大小要看宽度媒体查询。',
    ],
    notes: [
      '`(pointer: coarse)` 与 `(hover: none)` 常常一起用：前者管靶子大小，后者管去不掉悬停效果。',
      '热区扩张用伪元素时记得伪元素本身不可见，视觉上完全无感——这是「无形中变得好用了」的做法。',
    ],
    _rawRef: 'https://developer.mozilla.org/en-US/docs/Web/CSS/@media/pointer',
    _origin: 'crawl',
  },

  {
    slug: 'selection-style',
    title: '自定义选中色',
    category: '交互',
    tags: ['选中', '伪元素', '品牌色'],
    since: SINCE,
    source: '机制来自 CSS Pseudo-Elements 的 ::selection，自行实现',
    when: '选中文字时的那片高亮要用品牌色，而不是系统默认的蓝',
    stage: 'plain',
    tier: 'core',
    params: [],
    description: `用鼠标划过的文字是一层铜红，而不是系统的蓝。

机制是 ==::selection 是唯一能给「用户选中的文字」上样式的伪元素==。它由浏览器在选中期间临时绘制成一层覆盖，所以能改的属性非常有限——基本只有颜色类。这也解释了为什么 \`padding\`、\`border\` 之类的写法毫无反应。

它不需要任何标记或类名，作用范围就是被选中的那一段。`,
    code: [
      {
        lang: 'html',
        body: `<p class="sl">用鼠标划过这句话看看。选中的颜色是自己定的，不是系统的蓝。也可以只选中其中一个词。</p>`,
      },
      {
        lang: 'css',
        body: `.sl {
  width: min(420px, 84vw);
  margin: 0;
  font: 400 16px/1.9 system-ui, sans-serif;
  color: #1c1a17;
}

/* @mechanism 选中高亮由浏览器临时绘制，只有颜色类属性生效 */
::selection {
  background: #b4462f;
  color: #fdf6ec;
}

/* 旧版 Firefox 仍需要前缀 */
::-moz-selection {
  background: #b4462f;
  color: #fdf6ec;
}`,
      },
    ],
    caveats: [
      '它不是普通伪元素：**只有少数属性生效**（背景色、文字色、`text-shadow` 等）。`padding`、`border`、`font-size`、`margin` 一律无效，而且不报错。',
      '选中色的**对比度**要够。品牌色常常太亮或太暗，直接当底色会让文字读不清——要按 `color` 调整明度。',
      '设了它之后，系统级的选择色（以及用户为高对比模式设的色）会被完全覆盖。这是要意识到的取舍。',
      '深色与浅色主题应当各写一套。一套色值很难同时满足两种背景下的对比度要求。',
      '规则写在全局会影响所有文本，包括输入框里的选中文字。想只对某块生效就要限定作用范围。',
    ],
    notes: [
      '这是成本极低、辨识度很高的一处品牌细节——用户每次选中文字都会看到它。',
      '把它和链接、按钮的悬停色放在同一套色板上，整体才会像一套东西。',
    ],
    _rawRef: 'https://developer.mozilla.org/en-US/docs/Web/CSS/::selection',
    _origin: 'crawl',
  },

  {
    slug: 'focus-within-group',
    title: '整块区域跟随焦点',
    category: '交互',
    tags: ['焦点', '容器', '键盘'],
    since: SINCE,
    source: '机制来自 CSS Selectors 的 :focus-within，自行实现',
    when: '焦点落在框里的某个输入项时，整块区域都该有提示',
    stage: 'plain',
    tier: 'core',
    params: [],
    description: `Tab 进某个输入框时，整块表单区一起亮起边框，用户一眼知道自己在哪一块。

机制是 ==:focus-within 匹配「内部有元素获得焦点」的容器==。它是 \`:has(:focus)\` 的专用版，但出现更早、支持更广、语义更明确。用它给整行、整张卡片、整块表单一个统一的聚焦提示。

键盘用户的定位感主要就靠这类整体反馈建立。`,
    code: [
      {
        lang: 'html',
        body: `<div class="fw">
  <div class="fw-group">
    <label class="fw-label">第一组</label>
    <input class="fw-input" placeholder="点我或 Tab 到我" />
  </div>
  <div class="fw-group">
    <label class="fw-label">第二组</label>
    <input class="fw-input" placeholder="整组会一起亮" />
  </div>
</div>`,
      },
      {
        lang: 'css',
        body: `.fw {
  display: grid;
  gap: 12px;
  width: min(360px, 82vw);
}

.fw-group {
  display: grid;
  gap: 6px;
  padding: 14px 16px;
  border: 1px solid rgb(60 48 30 / 0.26);
  background: rgb(255 255 255 / 0.42);
  transition: border-color 0.2s, box-shadow 0.2s;
}

/* @mechanism 容器内的元素获得焦点时，容器本身匹配 */
.fw-group:focus-within {
  border-color: #b4462f;
  box-shadow: 0 0 0 3px rgb(180 70 47 / 0.14);
}

.fw-label {
  font: 500 12px/1 system-ui, sans-serif;
  color: rgb(28 26 23 / 0.6);
}

.fw-input {
  padding: 9px 11px;
  border: 1px solid rgb(60 48 30 / 0.3);
  background: rgb(255 255 255 / 0.7);
  font: 400 15px/1.4 system-ui, sans-serif;
  color: #1c1a17;
}`,
      },
    ],
    caveats: [
      '嵌套容器会**同时**匹配：外层分组与内层分组都亮起来。需要显式把外层关掉，否则会看到两圈边框叠着。',
      '它分不出键盘与鼠标——鼠标点进输入框同样会匹配。要只在键盘操作时提示，得用 `:has(:focus-visible)`。',
      '它不会把焦点「移」到容器上，只是样式。焦点始终在内部那个可聚焦元素上。',
      '容器本身若不可聚焦，它只反映内部状态——键盘用户跳过整组时不会有任何提示，这是它的正常表现。',
      '它比 `:has()` 可靠得多（支持面更广、语义更专一）。能用 `:focus-within` 表达的意图就别用 `:has()`。',
    ],
    notes: [
      '配 `:has(:focus-visible)` 可以做到「鼠标点不亮、Tab 进来才亮」，是更讲究的一层。',
      '把提示做成整体变化（边框 + 外圈）而不是只改输入框本身，定位感会强很多。',
    ],
    _rawRef: 'https://developer.mozilla.org/en-US/docs/Web/CSS/:focus-within',
    _origin: 'crawl',
  },

  {
    slug: 'form-disable-submit',
    title: '表单无效时才提示提交',
    category: '交互',
    tags: ['表单', '校验', 'has'],
    since: SINCE,
    source: '机制来自 CSS Selectors 的 :has(:user-invalid)，自行实现',
    when: '提交按钮不该在用户还没动手时就变灰',
    stage: 'plain',
    tier: 'candidate',
    params: [],
    description: `表单刚打开时按钮一切正常；用户真的填错了，提示才出现。

机制是 ==用 :has() 从表单整体判断「里面有没有出错的字段」==，于是按钮的状态变成纯 CSS。关键是选 \`:user-invalid\` 而不是 \`:invalid\`——后者在页面一加载就把空必填项算作非法，按钮一开始就是灰的。

这里体现的是同一条原则：**用浏览器的状态，但要挑语义正确的那一个**。`,
    code: [
      {
        lang: 'html',
        body: `<form class="fd" novalidate>
  <label class="fd-field">
    邮箱
    <input class="fd-input" type="email" required placeholder="name@example.com" />
  </label>
  <p class="fd-hint">填错之后，按钮才会给出提示样式。</p>
  <button class="fd-submit" type="submit">提交</button>
</form>`,
      },
      {
        lang: 'css',
        body: `.fd {
  display: grid;
  gap: 12px;
  width: min(340px, 80vw);
  padding: 20px 22px;
  border: 1px solid rgb(60 48 30 / 0.28);
  background: rgb(255 255 255 / 0.42);
  font: 400 13px/1.6 system-ui, sans-serif;
  color: #1c1a17;
}

.fd-field {
  display: grid;
  gap: 6px;
  font-weight: 500;
}

.fd-input {
  padding: 10px 12px;
  border: 1px solid rgb(60 48 30 / 0.34);
  background: rgb(255 255 255 / 0.66);
  font: 400 15px/1.4 system-ui, sans-serif;
  color: #1c1a17;
}

.fd-input:user-invalid {
  border-color: #b4462f;
  background: rgb(180 70 47 / 0.08);
}

.fd-hint {
  margin: 0;
  color: rgb(28 26 23 / 0.58);
}

.fd-submit {
  padding: 12px;
  border: 1px solid rgb(60 48 30 / 0.34);
  background: rgb(60 48 30 / 0.1);
  font: 500 15px/1 system-ui, sans-serif;
  color: #1c1a17;
  cursor: pointer;
}

/* @mechanism 从表单整体判断有没有出错字段 */
.fd:has(:user-invalid) .fd-submit {
  border-color: rgb(180 70 47 / 0.6);
  background: rgb(180 70 47 / 0.12);
  color: #8d3524;
}`,
      },
    ],
    caveats: [
      '用 `:invalid` 会让表单**一打开按钮就是异常态**（空必填项已经非法）。要用 `:user-invalid`——它多一个「用户是否动过」的条件。',
      '这里只改样式、**不禁用**按钮。用 `pointer-events: none` 挡不住键盘的 Enter 提交；真要禁用得用 `disabled` 属性，而那只能由 JS 控制。',
      '禁用提交按钮本身有可访问性问题：键盘用户看到按钮灰着却不知道哪里错了。更好的做法是允许提交，然后明确指出错误。',
      '`:has()` 在旧浏览器上整条规则被丢弃，按钮就一直是正常态——这个降级方向是安全的，可以接受。',
      '表单有效性只在字段值变化时重算，所以提示出现会有极短的延迟。',
      '`novalidate` 关掉了浏览器的原生气泡提示。想要原生提示就别加它，两者可以共存。',
    ],
    notes: [
      '同一条规则可以顺手把错误汇总区显示出来：`.fd:has(:user-invalid) .fd-errors { display: block }`。',
      '「不阻塞提交、只指出错误」通常比「禁用按钮」体验好，因为它不会让用户猜。',
    ],
    _rawRef: 'https://developer.mozilla.org/en-US/docs/Web/CSS/:user-invalid',
    _origin: 'crawl',
  },
]
