/**
 * 第 2 批采集草稿：交互与动效为主。
 *
 * 这一批挑的都是「机制不显然、而且用错时现象很迷惑」的东西——
 * 比如 :focus 与 :focus-visible 的差别、0fr→1fr 为什么能过渡、离散属性为什么默认不动。
 *
 * 用法：
 *   node scripts/prepare-draft.mjs drafts/batch-02.mjs
 *   node scripts/ingest.mjs drafts/batch-02.mjs --dry-run
 *   node scripts/ingest.mjs drafts/batch-02.mjs
 */

const SINCE = '2026-09'

export default [
  /* ────────────────────────────── 交互 ────────────────────────────── */
  {
    slug: 'focus-visible-ring',
    title: '只在键盘操作时显焦点环',
    category: '交互',
    tags: ['焦点', '无障碍', '键盘'],
    since: SINCE,
    source: '机制来自 CSS Selectors 规范的 :focus-visible，自行实现',
    when: '鼠标点击不要留下难看的焦点框，但键盘 Tab 时必须看得见自己在哪',
    stage: 'plain',
    tier: 'core',
    params: [
      { name: 'ring', label: '环宽', type: 'range', min: 0, max: 8, step: 1, default: 3, unit: 'px' },
    ],
    description: `用鼠标点按钮不留痕迹，用键盘 Tab 到它时却有一圈清楚的轮廓。

机制是 ==:focus-visible 只在浏览器判断「用户需要看到焦点」时才匹配==。它的判定依据是触发方式与元素性质：键盘 Tab 一定匹配，鼠标点击普通按钮一般不匹配，而文本输入框无论怎么获得焦点都会匹配（因为用户确实需要知道光标在哪）。

这是纯 CSS 做不到的分辨——\`:focus\` 只有「有焦点」这一个信息，分不出来是怎么来的。`,
    code: [
      {
        lang: 'html',
        body: `<button class="fv">点我，再按 Tab 试试</button>
<p class="fv-hint">鼠标点：没有环。按 Tab 移动：有环。</p>`,
      },
      {
        lang: 'css',
        body: `.fv {
  padding: 12px 22px;
  border: 1px solid rgb(60 48 30 / 0.4);
  border-radius: 2px;
  background: #efe9dd;
  font: 500 15px/1 system-ui, sans-serif;
  color: #1c1a17;
  cursor: pointer;
}

.fv:focus {
  outline: none; /* 先把浏览器的默认框去掉，下面自己给 */
}

/* @mechanism 只在键盘操作时匹配，鼠标点击不匹配 */
.fv:focus-visible {
  outline: var(--ring, 3px) solid #b4462f;
  outline-offset: 3px;
}

.fv-hint {
  margin: 18px 0 0;
  font: 400 13px/1.6 system-ui, sans-serif;
  color: rgb(28 26 23 / 0.6);
}`,
      },
    ],
    caveats: [
      '**绝不能只写 `outline: none` 就完事。**那样键盘用户会完全看不到自己在哪，是最常见的无障碍事故。上面那行 `outline: none` 后面必须紧跟着给 `:focus-visible` 一个替代的环。',
      '`:focus` 和 `:focus-visible` 不是一回事。用 `:focus` 会让鼠标点击也留下环；很多人因此去治 `outline`，结果把键盘可达性一起废掉了。',
      '判定由浏览器的启发式决定，我们控制不了全部。大致规律是：键盘触发一定匹配，鼠标点击按钮不匹配，文本输入类无论怎么获得焦点都匹配。',
      '用 `div` 冒充按钮（`role="button"`）时，必须同时给 `tabindex="0"` 才能获得焦点——否则它根本不可聚焦，样式无从谈起。',
      '`outline` 不占空间、跟随边框圆角，所以它比 `box-shadow` 更适合做焦点环：后者会被祖先的 `overflow: hidden` 裁掉。',
    ],
    notes: [
      '用 `outline-offset` 让环离开元素本身一点，在贴边的布局里更容易看清。',
      '如果确实不想要默认样式，用 `:focus-visible` 覆盖它，而不是全局 `outline: none`。',
    ],
    _rawRef: 'https://developer.mozilla.org/en-US/docs/Web/CSS/:focus-visible',
    _origin: 'crawl',
  },

  {
    slug: 'hover-only-device',
    title: '把悬停效果关在指针设备里',
    category: '交互',
    tags: ['悬停', '媒体查询', '触屏'],
    since: SINCE,
    source: '机制来自 Media Queries Level 4 的 hover / pointer 特性，自行实现',
    when: '卡片悬浮要浮起来，但手机上点一下不能一直粘在浮起状态',
    stage: 'grid',
    tier: 'core',
    params: [
      { name: 'lift', label: '浮起高度', type: 'range', min: 0, max: 24, step: 2, default: 10, unit: 'px' },
    ],
    description: `指针移上去卡片轻轻抬起，移开落回；触屏上点它则完全不会浮起来。

机制是 ==用 @media (hover: hover) and (pointer: fine) 把整段悬停样式包起来==。触屏没有「悬停」这个状态，\`:hover\` 在触摸后会**粘住**——点一下卡片就浮着不起来，直到你点别处。包上这道闸门，触屏设备压根不会读到这段规则。`,
    code: [
      {
        lang: 'html',
        body: `<div class="hv">
  <article class="hv-card"><b>一</b><span>指针移上去</span></article>
  <article class="hv-card"><b>二</b><span>它会抬起来</span></article>
  <article class="hv-card"><b>三</b><span>移开落回</span></article>
</div>`,
      },
      {
        lang: 'css',
        body: `.hv {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 12px;
  width: min(520px, 84vw);
}

.hv-card {
  display: grid;
  place-items: center;
  gap: 4px;
  height: 150px;
  border: 1px solid rgb(60 48 30 / 0.3);
  background: #efe9dd;
  font: 400 13px/1.5 system-ui, sans-serif;
  color: #1c1a17;
  /* 过渡写在基础状态上，不是写在 :hover 里，否则移开时没有回程动画 */
  transition: transform 0.28s ease, box-shadow 0.28s ease;
}

.hv-card b {
  font: 600 24px/1 system-ui, sans-serif;
}

/* @mechanism 整段悬停样式关在「真有指针」的设备里 */
@media (hover: hover) and (pointer: fine) {
  .hv-card:hover {
    transform: translateY(calc(var(--lift, 10px) * -1));
    box-shadow: 0 16px 30px rgb(40 30 14 / 0.22);
  }
}`,
      },
    ],
    caveats: [
      '触屏上的 `:hover` 不会自己消失，它会**粘住**。不加这道闸门，手机上点一下按钮就一直保持悬停态，看起来像卡死了。',
      '`(hover: hover)` 问的是**主**输入设备。带触屏的笔记本主设备仍是鼠标，所以仍然匹配——这道闸门不是万能的，真正的触屏检测很麻烦。',
      '`hover` 与 `pointer` 要一起判断：只判一个会漏掉「能悬停但精度低」或「不能悬停但精度高」的组合。',
      '反过来也要注意：不要把关键信息藏在悬停里。触屏永远看不到它，等于这些内容在手机上不存在。',
      '过渡必须写在基础状态上。写在 `:hover` 里面的话，移开时用的是基础状态的过渡（没写就是没有），回程会瞬间跳回去。',
    ],
    notes: [
      '浮起用 `transform` 而不是改 `margin-top`：前者在合成器上跑，后者每帧都要重排，一屏卡片同时动时差别很大。',
      '阴影也要跟着动。只动位置不动阴影，看起来像贴纸被平移；两者同步变化才有「离开桌面」的感觉。',
    ],
    _rawRef: 'https://developer.mozilla.org/en-US/docs/Web/CSS/@media/hover',
    _origin: 'crawl',
  },

  {
    slug: 'details-animate',
    title: '折叠面板的展开动画',
    category: '交互',
    tags: ['details', '折叠', '网格过渡'],
    since: SINCE,
    source: '机制来自 CSS Grid 的 fr 可插值特性，自行实现',
    when: '用原生 details 做折叠，但打开时想要一段展开动画而不是硬跳',
    stage: 'plain',
    tier: 'core',
    params: [
      { name: 'dur', label: '展开用时', type: 'range', min: 0.1, max: 1, step: 0.05, default: 0.35, unit: 's' },
    ],
    description: `点开标题，内容从 0 高度平滑长出来，而不是啪一下全出现。

机制是 ==grid-template-rows 从 0fr 过渡到 1fr==。这里的关键是：\`fr\` 是**长度**，两端都是长度才可插值。而 \`height: 0 → auto\` 不行——\`auto\` 不是一个可计算的数值，浏览器没有中间态可算，所以过渡直接不生效。

用一行网格轨道顶替「不知道有多高」的内容高度，就不必再用 JS 去测 \`scrollHeight\` 了。`,
    code: [
      {
        lang: 'html',
        body: `<details class="dt">
  <summary>展开看看</summary>
  <div class="dt-wrap">
    <div class="dt-body">
      <p>内容高度是未知的，但这不影响动画。</p>
      <p>因为这里动的是网格轨道，不是高度。</p>
      <p>再多一行，动画照样准确。</p>
    </div>
  </div>
</details>`,
      },
      {
        lang: 'css',
        body: `.dt {
  width: min(460px, 84vw);
  border: 1px solid rgb(60 48 30 / 0.32);
  background: rgb(255 255 255 / 0.36);
  font: 400 14px/1.7 system-ui, sans-serif;
  color: #1c1a17;
}

.dt summary {
  padding: 13px 16px;
  font-weight: 600;
  cursor: pointer;
  list-style: none;
}

.dt summary::-webkit-details-marker {
  display: none;
}

.dt-wrap {
  display: grid;
  grid-template-rows: 0fr;               /* @mechanism 收起来时是 0fr */
  transition: grid-template-rows var(--dur, 0.35s) ease;
}

.dt[open] .dt-wrap {
  grid-template-rows: 1fr;               /* @mechanism 展开时是 1fr，两端都是长度才能插值 */
}

.dt-body {
  overflow: hidden;                      /* @mechanism 没有它，轨道是 0 内容照样溢出可见 */
  padding: 0 16px;
}

.dt-body p {
  margin: 0 0 10px;
}`,
      },
    ],
    caveats: [
      '内层必须有 `overflow: hidden`。没有它时轨道虽然收成 0 高度、内容却照样画在外面，看起来像动画完全没生效。',
      '`height: 0 → auto` 是过渡不了的，浏览器没有可算的中间值。这就是必须绕道 `fr` 的原因——别在这条路上浪费时间。',
      '**关闭方向要额外处理。**`open` 一被移除，浏览器立刻把内容从渲染树里拿掉，收起动画根本来不及播。要双向都动，得给内容加 `transition-behavior: allow-discrete`。',
      '`summary` 默认自带三角标记，各引擎的隐藏方式不同（`::-webkit-details-marker` 只覆盖 WebKit），要跨浏览器一致就得自己画箭头。',
      '`<details>` 的 `open` 属性由浏览器管理，别用 `hidden` 去替代它——两者语义与可访问性都不同。',
    ],
    notes: [
      '同一招也能做「折叠侧栏」「折叠搜索框」，只要内容高度未知就适用。',
      '`0fr → 1fr` 只解决高度；宽度方向用 `0fr → 1fr` 配 `grid-template-columns` 一样成立。',
    ],
    _rawRef: 'https://developer.mozilla.org/en-US/docs/Web/CSS/grid-template-rows',
    _origin: 'crawl',
  },

  {
    slug: 'has-parent-state',
    title: '让父级跟着子级变',
    category: '交互',
    tags: ['has', '选择器', '状态'],
    since: SINCE,
    source: '机制来自 CSS Selectors Level 4 的 :has()，自行实现',
    when: '勾选之后整张卡片要换样子，但不想加 JS、也不想给父级加类名',
    stage: 'plain',
    tier: 'core',
    params: [
      { name: 'tint', label: '选中底色', type: 'range', min: 0, max: 100, step: 5, default: 55, unit: '%' },
    ],
    description: `勾上复选框，整张卡片连同边框一起换色——父级没有类名变化，也没有一行 JS。

机制是 ==:has() 让选择器能够「向上」匹配==。\`:has(input:checked)\` 的含义是「包含一个被勾选的 input 的元素」，于是我们可以从子级的状态反推父级的样式。CSS 诞生以来第一次能这样选。

这不是 \`:focus-within\` 的替代品——那个只能表达「有焦点」，\`:has()\` 能表达任意后代状态。`,
    code: [
      {
        lang: 'html',
        body: `<label class="hs">
  <input type="checkbox" checked />
  <span class="hs-text">勾选时整张卡片换色</span>
</label>
<label class="hs">
  <input type="checkbox" />
  <span class="hs-text">取消勾选试试</span>
</label>`,
      },
      {
        lang: 'css',
        body: `.hs {
  display: flex;
  align-items: center;
  gap: 12px;
  width: min(420px, 84vw);
  margin-bottom: 10px;
  padding: 14px 16px;
  border: 1px solid rgb(60 48 30 / 0.3);
  background: rgb(255 255 255 / 0.3);
  font: 400 14px/1.5 system-ui, sans-serif;
  color: #1c1a17;
  cursor: pointer;
  transition: border-color 0.2s, background 0.2s;
}

/* @mechanism 从子级状态反推父级样式 */
.hs:has(input:checked) {
  border-color: #b4462f;
  background: color-mix(in srgb, #b4462f var(--tint, 55%), #efe9dd);
}

.hs input {
  width: 18px;
  height: 18px;
  accent-color: #b4462f;
}`,
      },
    ],
    caveats: [
      '`:has()` 匹配的是「**某个后代**满足条件」，不只是直接子级。写 `:has(input)` 时，嵌套深处任意一层有 input 都会命中——范围比直觉大。',
      '它的匹配成本高于普通选择器，因为没法用简单的从右往左扫描。用在成百上千个元素上、又频繁改状态时会拖慢样式重算。',
      '不支持它的浏览器（Firefox 121 以前）会**整条规则丢弃**，所以不要把「只有选中时才可见」当唯一入口，否则旧浏览器上内容永远看不到。',
      '别写太深：`:has()` 里再套复杂选择器会让匹配范围难以预测，调试时现象是「莫名其妙也命中了」。',
    ],
    notes: [
      '把 `:has()` 作用在 `:focus-within` 上是很实用的组合：整块表单区域跟随「哪个输入框有焦点」高亮。',
      '`color-mix()` 让底色由主题色算出来，改一个颜色整块跟着变，比手写第二套色值好维护。',
    ],
    _rawRef: 'https://developer.mozilla.org/en-US/docs/Web/CSS/:has',
    _origin: 'crawl',
  },

  {
    slug: 'user-invalid-hint',
    title: '用户犯错了才标红',
    category: '交互',
    tags: ['表单', '校验', '提示'],
    since: SINCE,
    source: '机制来自 CSS Selectors Level 4 的 :user-invalid，自行实现',
    when: '表单刚打开时不要一片红，用户真的填错了才提示',
    stage: 'plain',
    tier: 'core',
    params: [],
    description: `页面一打开，空着的必填项安安静静；用户点进去又留空离开之后，它才变红提示。

机制是 ==:user-invalid 只在用户交互过、且当前值仍不合法时匹配==。\`:invalid\` 只问「值合法吗」——页面刚加载、用户一个字都没填，空必填项在它眼里就已经是「非法」了，于是一进来满屏红字。\`:user-invalid\` 多了一个「用户是否动过」的条件。`,
    code: [
      {
        lang: 'html',
        body: `<label class="ui">
  邮箱
  <input class="ui-input" type="email" required placeholder="name@example.com" />
</label>
<label class="ui">
  必填
  <input class="ui-input" required />
</label>
<p class="ui-hint">什么都不填时它们不红；点进去再放空，才标出来。</p>`,
      },
      {
        lang: 'css',
        body: `.ui {
  display: grid;
  gap: 6px;
  width: min(420px, 84vw);
  margin-bottom: 14px;
  font: 400 13px/1.5 system-ui, sans-serif;
  color: #1c1a17;
}

.ui-input {
  padding: 10px 12px;
  border: 1px solid rgb(60 48 30 / 0.35);
  background: rgb(255 255 255 / 0.5);
  font: 400 15px/1.4 system-ui, sans-serif;
  color: #1c1a17;
}

/* @mechanism 用户交互过且仍不合法才匹配 */
.ui-input:user-invalid {
  border-color: #b4462f;
  background: rgb(180 70 47 / 0.08);
}

.ui-hint {
  margin: 0;
  font: 400 13px/1.6 system-ui, sans-serif;
  color: rgb(28 26 23 / 0.6);
}`,
      },
    ],
    caveats: [
      '`:invalid` 会在页面一加载就把空必填项标红——用户还没动手就先被指责。这是最常见的表单体验事故，而 `:user-invalid` 就是为它准备的。',
      '各浏览器对「何时算交互过」的判定有差异（失焦、输入过、提交过都可能触发），所以标红出现的时机会略有不同。',
      '必须配 `required`、`type="email"`、`pattern` 之类的约束，否则任何值都合法，这条规则永远不会匹配。',
      '只靠颜色区分是不够的：红绿色觉障碍的人分不出来。要同时给边框、图标或文字提示。',
      '浏览器的原生校验气泡仍然会在提交时弹出，`:user-invalid` 只改样式，拦不住提交——真正的校验逻辑还得有。',
    ],
    notes: [
      '`:user-valid` 是它的镜像，用来在「用户填对了」时给出正向反馈。',
      '把提示文案放在 `<label>` 里而不是 `placeholder`：占位文字一输入就消失，用户回头看不到要求。',
    ],
    _rawRef: 'https://developer.mozilla.org/en-US/docs/Web/CSS/:user-invalid',
    _origin: 'crawl',
  },

  {
    slug: 'popover-native',
    title: '原生顶层弹层',
    category: '交互',
    tags: ['popover', '弹层', '顶层'],
    since: SINCE,
    source: '机制来自 HTML 规范的 popover 属性，自行实现',
    when: '要一个浮层，但不想处理 z-index、焦点陷阱与点外关闭',
    stage: 'dark',
    tier: 'candidate',
    params: [],
    description: `点按钮弹出一块浮层，点外面或按 Esc 自动关掉——三个属性，零 JS。

机制是 ==popover 属性把元素送进浏览器的「顶层」==。顶层是渲染顺序上独立的一层：它不受任何祖先的 \`overflow: hidden\` 或 \`transform\` 裁剪，也不需要 \`z-index: 9999\` 去压别人。点外关闭、Esc 关闭、焦点归还按钮，都是浏览器给的行为。`,
    code: [
      {
        lang: 'html',
        body: `<button class="po-btn" popovertarget="po-panel">打开浮层</button>

<div id="po-panel" class="po" popover>
  <b>我在顶层</b>
  <p>点外面或按 Esc 会关掉，不用写 JS。</p>
</div>`,
      },
      {
        lang: 'css',
        body: `.po-btn {
  padding: 11px 20px;
  border: 1px solid rgb(255 255 255 / 0.24);
  background: rgb(255 255 255 / 0.06);
  font: 500 15px/1 system-ui, sans-serif;
  color: #f0ead9;
  cursor: pointer;
}

.po {
  /* @mechanism 顶层元素：不受祖先裁剪，不需要 z-index */
  width: min(300px, 78vw);
  padding: 18px 20px;
  border: 1px solid rgb(180 70 47 / 0.6);
  background: #1b1626;
  font: 400 14px/1.7 system-ui, sans-serif;
  color: #f0ead9;
}

.po b {
  display: block;
  margin-bottom: 6px;
  font-size: 16px;
}

.po p {
  margin: 0;
  opacity: 0.74;
}`,
      },
    ],
    caveats: [
      '`popovertarget` 与 `popover` 要配对，靠 `id` 关联。id 写错时**完全没反应**，不报错、不警告，是最常见的坑。',
      '**旧浏览器不支持时，被标了 `popover` 的元素会直接显示在普通流里**（属性不生效就等于没写），整块内容摊在页面上破坏版面。上线要配 `@supports selector(:popover-open)` 兜底。',
      '它进的是浏览器顶层，所以祖先的 `overflow: hidden`、`transform`、`contain` 都管不到它。这既是优点也是意外——它不再受你的布局约束。',
      '默认位置是屏幕中间的固定套路，不是跟着按钮。要贴着触发元素就得用 CSS 锚点定位（anchor positioning）或自己测坐标。',
      '它是 `display: none` 与 `display: block` 的离散切换，所以默认没有过渡；加动画要配 `transition-behavior: allow-discrete` 与 `@starting-style`。',
    ],
    notes: [
      '`popover="manual"` 会去掉点外关闭，适合做常驻面板；默认值 `auto` 才有那套自动关闭行为。',
      '同一时间只有一个 `auto` 的 popover 是打开的，打开新的会自动关掉旧的——省掉了手写「点击别处关闭同类浮层」的逻辑。',
    ],
    _rawRef: 'https://developer.mozilla.org/en-US/docs/Web/HTML/Global_attributes/popover',
    _origin: 'crawl',
  },

  /* ────────────────────────────── 动效 ────────────────────────────── */
  {
    slug: 'stagger-enter',
    title: '依次入场',
    category: '动效',
    tags: ['入场', '延迟', '交错'],
    since: SINCE,
    source: '机制来自 CSS Animations 的 animation-fill-mode，自行实现',
    when: '一列元素要一个个出现，而不是同时冒出来',
    stage: 'plain',
    tier: 'core',
    params: [
      { name: 'step', label: '间隔', type: 'range', min: 20, max: 300, step: 10, default: 90, unit: 'ms' },
    ],
    description: `一排卡片从下方依次升起，一个接一个，不是一起冒出来。

机制是 ==递增的 animation-delay 配 animation-fill-mode: both==。\`both\` 让元素在延迟期间就保持住关键帧的起始状态（透明、位移），所以它不会先以最终样子闪一下再重播。这是**正**延迟的正当用法——与「负延迟错相」正好相反：那里是要相位偏移，这里要的就是等待。`,
    code: [
      {
        lang: 'html',
        body: `<div class="se">
  <article class="se-card">一</article>
  <article class="se-card">二</article>
  <article class="se-card">三</article>
  <article class="se-card">四</article>
  <article class="se-card">五</article>
</div>`,
      },
      {
        lang: 'css',
        body: `.se {
  display: flex;
  gap: 10px;
  width: min(520px, 84vw);
}

.se-card {
  flex: 1;
  display: grid;
  place-items: center;
  height: 130px;
  background: #efe9dd;
  border: 1px solid rgb(60 48 30 / 0.3);
  font: 600 20px/1 system-ui, sans-serif;
  color: #1c1a17;
  animation: se-rise 0.5s ease both; /* @mechanism both 让元素先保持在起始态 */
}

/* @mechanism 递增延迟 = 依次入场 */
.se-card:nth-child(1) { animation-delay: calc(var(--step, 90ms) * 0); }
.se-card:nth-child(2) { animation-delay: calc(var(--step, 90ms) * 1); }
.se-card:nth-child(3) { animation-delay: calc(var(--step, 90ms) * 2); }
.se-card:nth-child(4) { animation-delay: calc(var(--step, 90ms) * 3); }
.se-card:nth-child(5) { animation-delay: calc(var(--step, 90ms) * 4); }

@keyframes se-rise {
  from {
    opacity: 0;
    transform: translateY(18px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}`,
      },
    ],
    caveats: [
      '漏掉 `animation-fill-mode: both`（或 `backwards`）会先闪一下：延迟期间元素显示的是它**正常的**样子，动画一开始才跳回透明再升起来。',
      '延迟是「等待」，元素多了总时长线性增长。20 个元素、每个 90ms 就要等 1.8 秒——超过十来个就该封顶间隔或改用负延迟压缩总时长。',
      '动画只走 `opacity` 与 `transform` 才不重排。动 `height`、`margin`、`top` 会每帧重排，一屏元素同时跑会明显卡。',
      '这是「页面加载即播」的一次性动画，不是滚动到才播。要按可见性触发得配 `animation-timeline: view()` 或 IntersectionObserver。',
      '没有处理 `prefers-reduced-motion`：对前庭敏感的用户，整排元素同时位移会很不舒服。正式项目要把它关掉。',
    ],
    notes: [
      '延迟用 `calc(var(--step) * n)` 表达，改间隔时只动一个地方，不用逐个改数字。',
      '入场距离控制在 12–24px 之间最自然。超过 40px 就像在「飞」，注意力会被动画本身抢走。',
    ],
    _rawRef: 'https://developer.mozilla.org/en-US/docs/Web/CSS/animation-fill-mode',
    _origin: 'crawl',
  },

  {
    slug: 'starting-style-enter',
    title: '首次出现也能过渡',
    category: '动效',
    tags: ['starting-style', '入场', '过渡'],
    since: SINCE,
    source: '机制来自 CSS Transitions Level 2 的 @starting-style，自行实现',
    when: '元素从隐藏变可见时要淡入，但 transition 死活不触发',
    stage: 'plain',
    tier: 'core',
    params: [
      { name: 'dur', label: '淡入用时', type: 'range', min: 0.1, max: 1.2, step: 0.05, default: 0.45, unit: 's' },
    ],
    description: `一个一直存在的元素，第一次变得可见时能淡入，而不是硬生生出现。

机制是 ==@starting-style 给元素一个「还没有渲染过时的样式」==。过渡要成立，必须有「旧值」和「新值」两个状态；而元素第一次进入渲染树时没有旧值，两侧都是同一条规则算出来的，于是没得过渡。\`@starting-style\` 就是补上那个不存在的起点。`,
    code: [
      {
        lang: 'html',
        body: `<div class="ss-item">从隐藏变可见</div>
<div class="ss-item">第二块也一样</div>
<div class="ss-item">每块各自淡入</div>`,
      },
      {
        lang: 'css',
        body: `.ss-item {
  width: min(420px, 84vw);
  margin-bottom: 10px;
  padding: 14px 16px;
  border: 1px solid rgb(60 48 30 / 0.3);
  background: #efe9dd;
  font: 400 15px/1.5 system-ui, sans-serif;
  color: #1c1a17;
  transition: opacity var(--dur, 0.45s) ease, transform var(--dur, 0.45s) ease;
  animation: ss-cycle 4s ease infinite;
}

/* @mechanism 补上「还没有渲染过」的那个起点，过渡才有得插值 */
@starting-style {
  .ss-item {
    opacity: 0;
    transform: translateY(-14px);
  }
}

@keyframes ss-cycle {
  0%,
  100% {
    opacity: 1;
    transform: translateY(0);
  }
  50% {
    opacity: 0.25;
    transform: translateY(-6px);
  }
}`,
      },
    ],
    caveats: [
      '它管的是**元素第一次进入渲染树**的那一次。之后再把 `display` 从 `none` 改回来，`@starting-style` 不再参与——那种情况要配 `transition-behavior: allow-discrete`。',
      '`transition` 必须声明在**元素自己的最终状态**上。写进 `@starting-style` 里面完全不生效，而且不报错。',
      '旧浏览器不支持时，元素直接以最终状态出现（没有淡入）。这是可接受的降级，不会破版。',
      '起始值一定要和最终值不同，否则无从插值。把两者的 `opacity` 都写成 1，看起来就是「这属性没用」。',
    ],
    notes: [
      '它常和 `hidden` 属性、`content-visibility`、以及 popover/dialog 的显隐一起用——这些都是「元素重新进入渲染」的场景。',
      '`@starting-style` 可以写在选择器内部，也可以写在顶层配选择器；写在顶层更容易一眼看出它为哪条规则服务。',
    ],
    _rawRef: 'https://developer.mozilla.org/en-US/docs/Web/CSS/@starting-style',
    _origin: 'crawl',
  },

  {
    slug: 'allow-discrete',
    title: '让离散属性也能过渡',
    category: '动效',
    tags: ['离散属性', 'display', '过渡'],
    since: SINCE,
    source: '机制来自 CSS Transitions 规范的 transition-behavior，自行实现',
    when: '元素要淡出之后再消失，而不是淡出未完就已经不见',
    stage: 'dark',
    tier: 'candidate',
    params: [
      { name: 'dur', label: '淡出用时', type: 'range', min: 0.2, max: 2, step: 0.1, default: 0.7, unit: 's' },
    ],
    description: `一块浮层淡出到看不见，然后才从布局里消失——而 \`display\` 本身是没法平滑变化的。

机制是 ==transition-behavior: allow-discrete==。\`display\` 这类属性的值没有中间态（只能是 none 或 block），默认不参与过渡。\`allow-discrete\` 不创造中间值，它的作用是**把切换时机推迟到过渡结束**：过渡期间继续用旧值渲染，走完再切成新值。所以淡出能完整播完。`,
    code: [
      {
        lang: 'html',
        body: `<div class="ad">
  <span class="ad-dot"></span>
  <p>这块浮层靠 allow-discrete 才敢淡出。</p>
</div>`,
      },
      {
        lang: 'css',
        body: `.ad {
  width: min(340px, 78vw);
  padding: 20px 22px;
  border: 1px solid rgb(180 70 47 / 0.55);
  background: #1b1626;
  font: 400 15px/1.7 system-ui, sans-serif;
  color: #f0ead9;
  /* @mechanism allow-discrete 让 display 的切换推迟到过渡结束 */
  transition: opacity var(--dur, 0.7s) ease, transform var(--dur, 0.7s) ease,
    display var(--dur, 0.7s) allow-discrete;
  animation: ad-breathe 3.6s ease-in-out infinite;
}

.ad-dot {
  display: inline-block;
  width: 8px;
  height: 8px;
  margin-right: 8px;
  border-radius: 50%;
  background: #b4462f;
}

.ad p {
  margin: 8px 0 0;
  opacity: 0.76;
}

@keyframes ad-breathe {
  0%,
  100% {
    opacity: 1;
    transform: scale(1);
  }
  50% {
    opacity: 0.45;
    transform: scale(0.97);
  }
}`,
      },
    ],
    caveats: [
      '`allow-discrete` 不产生中间值。`display` 的「过渡」效果其实是**等待**：光学属性走完，才轮到它切换。别指望 `display` 本身有任何渐变。',
      '**关闭方向最容易失效。**元素一旦 `display: none` 就不再渲染，动画来不及播。要双向都成立，需要把 `@starting-style` 和它配合起来，或者把会切换到 `none` 的属性放在过渡列表的末尾。',
      '各引擎的支持进度不一致，退化的表现是「瞬间消失」——不破版，但动画没了，而且不报错。',
      '`overlay` 属性（让弹层在过渡期间留在顶层）也是同一招，但只对 popover、dialog 这类顶层元素有意义；写在普通元素上无效。',
      '一次过渡里把多个离散属性都加上，容易出现「这个走完那个才开始」的错位，要按实际观感逐个调。',
    ],
    notes: [
      '判断某属性是不是离散的：问它「两个值之间有没有中间值」。`opacity` 有，`display` 没有。',
      '同一套机制也是原生弹层做进出动画的正路——`popover` 与 `dialog` 的显隐都是离散切换。',
    ],
    _rawRef: 'https://developer.mozilla.org/en-US/docs/Web/CSS/transition-behavior',
    _origin: 'crawl',
  },

  {
    slug: 'steps-typing',
    title: '逐字打出',
    category: '动效',
    tags: ['steps', '打字机', '时序函数'],
    since: SINCE,
    source: '机制来自 CSS Easing Functions 的 steps()，自行实现',
    when: '一行字要一个字一个字出现，像有人在打',
    stage: 'plain',
    tier: 'core',
    params: [
      { name: 'chars', label: '字数', type: 'range', min: 4, max: 20, step: 1, default: 14 },
      { name: 'dur', label: '用时', type: 'range', min: 0.6, max: 5, step: 0.2, default: 2.4, unit: 's' },
    ],
    description: `文字从左到右一个字一个字冒出来，末尾还跟着一个闪烁的光标。

机制是 ==steps() 把连续动画量化成 N 段离散跳动==。宽度本来会平滑增长，但 \`steps(14)\` 把它切成 14 跳——每跳正好一个字宽，于是看起来是「打出来」而不是「拉开」。打字机感全部来自这个「离散」，跟内容无关。`,
    code: [
      {
        lang: 'html',
        body: `<div class="ty">
  <span class="ty-text">咒语书·逐字打出</span>
</div>`,
      },
      {
        lang: 'css',
        body: `.ty {
  display: flex;
  align-items: center;
  font: 400 20px/1.5 ui-monospace, "SF Mono", Menlo, monospace;
  color: #1c1a17;
}

.ty-text {
  display: inline-block;
  overflow: hidden;
  white-space: nowrap;
  width: 0;
  /* @mechanism steps 把宽度量化成离散跳动，打字感就来自这里 */
  animation: ty-type var(--dur, 2.4s) steps(var(--chars, 14)) forwards;
  border-right: 2px solid #b4462f;
  /* 光标闪烁是第二个动画，必须分开写，否则简写会互相覆盖 */
  animation-name: ty-type, ty-caret;
  animation-duration: var(--dur, 2.4s), 0.9s;
  animation-timing-function: steps(var(--chars, 14)), step-end;
  animation-iteration-count: 1, infinite;
  animation-fill-mode: forwards, none;
}

@keyframes ty-type {
  to {
    width: calc(var(--chars, 14) * 1ch);
  }
}

@keyframes ty-caret {
  50% {
    border-color: transparent;
  }
}`,
      },
    ],
    caveats: [
      '必须用 `steps()`。换成 `linear` 宽度会连续增长，看到的是元素被「拉开」，完全不像在打字。',
      '`steps(n)` 的 n 要与字数一致，宽度单位用 `ch`。两者对不上就会吞字（`n` 偏小）或打完之后还空着一段（`n` 偏大）。',
      '`ch` 是「0」这个字符的宽度，只在等宽字体下近似一个字宽。**中英混排时汉字与 `ch` 不相等**，会提前或滞后结束——要求精确就按实际字数算宽度。',
      '`white-space: nowrap` 不能少。少了它文本会换行，宽度动画就失去意义了。',
      '两个动画要分开写完整属性。用 `animation` 简写只会保留最后一个，光标或打字效果会有一个不生效。',
      '动画结束后的状态靠 `forwards` 保持。少了它，打完的瞬间文字会缩回宽度 0。',
    ],
    notes: [
      '光标用 `border-right` 而不是伪元素，省一层结构；缺点是无法单独控制它的垂直位置。',
      '真需要「一个字一个字出现、且换行正常」时，纯 CSS 的宽度动画会失效——那是必须上 JS 的场景，别硬撑。',
    ],
    _rawRef: 'https://developer.mozilla.org/en-US/docs/Web/CSS/easing-function/steps',
    _origin: 'crawl',
  },

  {
    slug: 'spring-curve',
    title: '会过冲的弹簧曲线',
    category: '动效',
    tags: ['缓动', '弹簧', 'linear'],
    since: SINCE,
    source: '机制来自 CSS Easing Functions Level 2 的 linear()，自行实现',
    when: '元素要冲过目标再弹回来，但 cubic-bezier 怎么调都弹不起来',
    stage: 'grid',
    tier: 'core',
    params: [
      { name: 'dur', label: '用时', type: 'range', min: 0.3, max: 1.6, step: 0.1, default: 0.8, unit: 's' },
    ],
    description: `方块冲过目标位置，再退回一点，最后停稳——有重量的感觉。

机制是 ==linear() 用一串采样点手写任意缓动曲线==。\`cubic-bezier\` 的两个控制点被规范限制在纵轴 0–1 之间，所以**它做不出超过 1 的过冲**。\`linear()\` 没有这个限制，可以给出 \`1.06\`、\`0.97\` 这样的值，于是能表达弹簧。`,
    code: [
      {
        lang: 'html',
        body: `<div class="sp-wrap">
  <div class="sp-box"></div>
</div>`,
      },
      {
        lang: 'css',
        body: `.sp-wrap {
  display: flex;
  align-items: center;
  width: min(420px, 84vw);
  height: 90px;
  padding: 0 10px;
  border: 1px dashed rgb(60 48 30 / 0.4);
  background: rgb(255 255 255 / 0.28);
}

.sp-box {
  width: 52px;
  height: 52px;
  background: #b4462f;
  /* @mechanism linear() 的采样点可以超过 1，这是贝塞尔做不到的过冲 */
  animation: sp-slide var(--dur, 0.8s) linear(0, 0.35 12%, 0.86 24%, 1.06 36%, 0.97 48%, 1.01 62%, 1) infinite alternate;
}

@keyframes sp-slide {
  from {
    transform: translateX(0);
  }
  to {
    transform: translateX(calc(100% + 280px));
  }
}`,
      },
    ],
    caveats: [
      '`cubic-bezier` 的纵轴被规范限制在 0–1，**做不出过冲**。这就是弹簧感必须用 `linear()` 的原因，不是风格偏好。',
      '采样点太少会一顿一顿的（`linear()` 本质是折线）。转折处给密一点，平缓段可以稀。',
      '过冲会让元素越出容器边界。父级有 `overflow: hidden` 时，超出部分直接被裁掉，看起来像「弹到一半消失了」。',
      '括号里的百分比是**时间轴**上的位置，不是数值占比。写错顺序（不是单调递增）会得到乱七八糟的跳动。',
      '它同样受 `prefers-reduced-motion` 影响：过冲对前庭敏感的人是明显的不适源，正式项目要能关掉。',
    ],
    notes: [
      '`linear()` 也能表达「分段停顿」，等价于把多个动画串在一个属性里，比叠加多个 keyframes 好调。',
      '弹簧参数（刚度、阻尼）通常由设计工具导出成采样点，直接贴进来即可，不必手推。',
    ],
    _rawRef: 'https://developer.mozilla.org/en-US/docs/Web/CSS/easing-function/linear',
    _origin: 'crawl',
  },

  /* ────────────────────────────── 材质 ────────────────────────────── */
  {
    slug: 'skeleton-shimmer',
    title: '骨架屏扫光',
    category: '材质',
    tags: ['骨架屏', '扫光', '加载'],
    since: SINCE,
    source: '自行实现',
    when: '内容还在加载，用一块灰底加一道扫光占住位置',
    stage: 'plain',
    tier: 'core',
    params: [
      { name: 'dur', label: '扫一次用时', type: 'range', min: 0.6, max: 4, step: 0.1, default: 1.6, unit: 's' },
    ],
    description: `几块灰色占位条上一道浅光缓缓扫过，提示「这里马上会有东西」。

机制是 ==用一个伪元素做亮带，动画它的 transform==。亮带是 \`linear-gradient\` 画的一条斜向高光，位移交给 \`transform\`。**不要动画 \`background-position\`**——那会让浏览器每一帧都重绘整块渐变，长列表里代价很大；而 \`transform\` 交给合成器，代价几乎为零。`,
    code: [
      {
        lang: 'html',
        body: `<div class="sk">
  <span class="sk-line sk-w60"></span>
  <span class="sk-line sk-w90"></span>
  <span class="sk-line sk-w45"></span>
</div>`,
      },
      {
        lang: 'css',
        body: `.sk {
  display: grid;
  gap: 12px;
  width: min(420px, 84vw);
  padding: 20px;
  border: 1px solid rgb(60 48 30 / 0.24);
  background: rgb(255 255 255 / 0.34);
}

.sk-line {
  position: relative;
  display: block;
  height: 15px;
  overflow: hidden;                 /* @mechanism 少了它，扫光会漏到块外 */
  background: rgb(60 48 30 / 0.14);
}

.sk-w60 { width: 60%; }
.sk-w90 { width: 90%; }
.sk-w45 { width: 45%; }

/* @mechanism 亮带是伪元素，位移用 transform 交给合成器 */
.sk-line::after {
  content: "";
  position: absolute;
  inset: 0;
  background: linear-gradient(
    100deg,
    transparent 32%,
    rgb(255 255 255 / 0.72) 50%,
    transparent 68%
  );
  transform: translateX(-100%);
  animation: sk-sweep var(--dur, 1.6s) ease-in-out infinite;
}

@keyframes sk-sweep {
  to {
    transform: translateX(100%);
  }
}`,
      },
    ],
    caveats: [
      '动画 `background-position` 每一帧都要重绘整块渐变。改用伪元素的 `transform` 位移，浏览器把它交给合成器（GPU），长列表里差别非常明显。',
      '伪元素所在的父级需要 `position: relative` 与 `overflow: hidden`，否则亮带会跑到块外面去。',
      '亮带的对比度要低。超过 70% 白会让它看起来像故障闪烁，而不是「正在加载」。',
      '没有处理 `prefers-reduced-motion`。持续不停的扫光对动效敏感的人很干扰，正式项目里应当退化成静态灰块。',
      '骨架块的尺寸要贴近真实内容。差太多的话，数据到达的瞬间会整体跳版，比不做骨架屏还难受。',
    ],
    notes: [
      '扫光只应出现在「确实在加载」的状态。加载失败还一直扫，会让用户一直等一个不会来的东西。',
      '同一招可以给按钮做「处理中」的进度感，但这些场景更推荐给用户明确的文字状态。',
    ],
    _rawRef: 'https://developer.mozilla.org/en-US/docs/Web/CSS/transform',
    _origin: 'crawl',
  },
]
