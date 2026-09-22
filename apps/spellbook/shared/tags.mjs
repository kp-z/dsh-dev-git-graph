/**
 * 标签词表 —— 咒语书的标签系统。
 *
 * 为什么要有词表：原来 332 条咒语上挂着 631 个不同的标签，其中 458 个只出现过一次。
 * 那不是系统，是随手写的关键词 —— 「吸附」与「滚动吸附」并排，「SVG 滤镜」与
 * 「SVG滤镜」只差一个空格。这种标签既筛不了也数不出，等于没有。
 *
 * 所以要一份**受控词表**：标签只能从下面这些值里取，写别的直接校验不过。
 *
 * 分四个轴，因为「找一条咒语」有四种问法：
 *
 *   机制 mech —— 靠什么做出来的？   「用 mask 做的都有哪些」
 *   观感 look —— 看起来像什么？     「玻璃质感」
 *   场合 use  —— 用在哪？           「表单控件的」
 *   触发 how  —— 什么让它动起来？   「滚动驱动的」
 *
 * 四个轴是正交的：一条「滚动时玻璃卡片逐张入场」的咒语，机制是 filter、观感是玻璃、
 * 场合是卡片、触发是滚动 —— 四种问法都能找到它。
 *
 * 注意机制轴**不重复**描述里的「机制是 ==…==」那句话：那句话是给人和 AI 读的散文，
 * 已经以最高权重进了检索；标签是给人**筛**的枚举值，要能数出来「mask 有 9 条」。
 *
 * 加新值是可以的，但要在这里加 —— 而不是在某一篇 md 里随手写一个。
 * 看当前词表：node scripts/tags.mjs
 */

/** 轴的顺序就是页面上的显示顺序，也是「从具体到抽象」的顺序。 */
export const TAG_AXES = [
  {
    key: 'mech',
    label: '机制',
    hint: '靠什么做出来的（平台能力）',
    values: [
      // 滤镜与光
      'filter',
      'backdrop-filter',
      'blur',
      'drop-shadow',
      'box-shadow',
      'text-shadow',
      'svg-filter',
      'feTurbulence',
      'feDisplacementMap',
      'feMorphology',
      'feConvolveMatrix',
      'feLighting',
      'feColorMatrix',
      // 混合与层叠
      'blend-mode',
      'isolation',
      'background-clip',
      'z-index',
      'stacking-context',
      'layer',
      'scope',
      // 渐变与颜色
      'gradient',
      'conic-gradient',
      'radial-gradient',
      'repeating-gradient',
      'morphing-gradient',
      'color-mix',
      'oklch',
      'relative-color',
      'light-dark',
      'color-scheme',
      'forced-colors',
      // 裁切与遮罩
      'mask',
      'clip-path',
      'border-radius',
      'corner-shape',
      'border-image',
      'shape-outside',
      'float',
      'overflow',
      // 布局
      'grid',
      'subgrid',
      'flex',
      'container-query',
      'style-query',
      'media-query',
      'aspect-ratio',
      'clamp',
      'logical-property',
      'writing-mode',
      'multi-column',
      'table-layout',
      // 定位
      'position',
      'sticky',
      'anchor-position',
      'containing-block',
      'margin',
      // 滚动
      'scroll-snap',
      'scroll-driven',
      'scroll-anchor',
      'overscroll',
      'scrollbar',
      // 动效
      'transition',
      'keyframes',
      'animation-composition',
      'view-transition',
      'starting-style',
      'transform',
      'offset-path',
      '3d',
      'easing',
      'discrete-transition',
      // 自定义属性
      'custom-property',
      'property',
      // 文字与字形
      'text-wrap',
      'font-variant',
      'font-face',
      'unicode-range',
      'font-palette',
      'counter-style',
      'hyphens',
      'text-overflow',
      'initial-letter',
      'first-letter',
      'selection',
      'text-align',
      'letter-spacing',
      'vertical-align',
      'line-height',
      'bidi',
      'ruby',
      'hanging-punctuation',
      'text-decoration',
      'font-weight',
      // 元件与交互
      'popover',
      'dialog',
      'details',
      'form-validation',
      'select',
      'appearance',
      'display-contents',
      'pointer-events',
      'setPointerCapture',
      'intersection-observer',
      'content-visibility',
      'inert',
      'focus',
      'target',
      'has-selector',
      'clipboard',
      // 图形与位图
      'svg',
      'canvas',
      'stroke',
      'paint-order',
      'object-fit',
      'object-view-box',
      'image-rendering',
      'background-repeat',
      'background-size',
      // 渲染与性能
      'will-change',
      'contain',
    ],
  },
  {
    key: 'look',
    label: '观感',
    hint: '看起来像什么',
    values: [
      '玻璃',
      '金属',
      '箔金',
      '铬',
      '霓虹',
      '发光',
      '珠光',
      '虹彩',
      '全息',
      '绒面',
      '纸感',
      '颗粒',
      '锈蚀',
      '液体',
      '烟雾',
      '极光',
      '光晕',
      '胶片',
      '像素',
      '手绘',
      '描边',
      '阴影',
      '浮雕',
      '凹刻',
      '渐隐',
      '纹理',
      '图案',
      '几何',
      '有机',
      '色彩',
    ],
  },
  {
    key: 'use',
    label: '场合',
    hint: '用在哪',
    values: [
      '按钮',
      '表单',
      '输入',
      '选择',
      '开关',
      '滑杆',
      '导航',
      '目录',
      '标签页',
      '面包屑',
      '页头',
      '表头',
      '表格',
      '列表',
      '标签',
      '卡片',
      '画廊',
      '背景',
      '弹窗',
      '提示',
      '浮层',
      '菜单',
      '加载',
      '进度',
      '骨架屏',
      '空状态',
      '错误态',
      '标题',
      '正文',
      '引用',
      '代码',
      '数字',
      '标点',
      '图片',
      '头像',
      '图标',
      '图表',
      '看板',
      '步骤',
      '徽章',
      '时间线',
      '容器',
    ],
  },
  {
    key: 'how',
    label: '触发',
    hint: '什么让它动起来',
    values: [
      '悬停',
      '点击',
      '滚动',
      '拖拽',
      '键盘',
      '指针',
      '焦点',
      '长按',
      '自动',
      '定时',
      '加载时',
      '入场',
      '退场',
      '切换',
    ],
  },
]

/** tag → 轴 key。校验和分组都走这一份，避免两处各算各的。 */
/*
 * 词表自检：同一个标签不许出现在两个轴里。
 *
 * 这条是被咬出来才加的 —— 「输入」原先同时挂在 use（输入框这个场合）和 how（input
 * 事件触发）两个轴上。而 TAG_INDEX 是 flatMap 出来的，后定义的那个轴会**静默**覆盖
 * 前面的：写 `输入` 的人心里想的是「输入框」，查出来却归在 how 轴。没有报错，没有
 * 警告，只是筛选结果悄悄不对。
 *
 * 所以跨轴重名一律在模块加载时就炸掉，而不是等到有人拿它筛出错误结果。
 */
{
  const seen = new Map()
  for (const axis of TAG_AXES) {
    for (const value of axis.values) {
      const previous = seen.get(value)
      if (previous) {
        throw new Error(`标签词表有错：「${value}」同时出现在 ${previous} 与 ${axis.key} 两个轴`)
      }
      seen.set(value, axis.key)
    }
  }
}

export const TAG_INDEX = new Map(
  TAG_AXES.flatMap((axis) => axis.values.map((value) => [value, axis.key])),
)

export const ALL_TAGS = [...TAG_INDEX.keys()]

/** 每个轴的值集合，给「这条缺哪个轴」这类提示用。 */
export const TAGS_BY_AXIS = new Map(TAG_AXES.map((axis) => [axis.key, axis.values]))

/**
 * 校验一条咒语的标签。
 *
 * 规则（每一条都是被「随手写的标签」咬过才定的）：
 *   - 只能取自词表。写词表外的值直接报错 —— 这是整个系统能成立的前提。
 *   - 不许重复。同一篇里写两遍「玻璃」，数出来的条数就是假的。
 *   - 必须有一个机制：每条咒语都得说得清靠什么成立。
 *   - 必须有一个场合或观感：只说机制不说用途，等于没说这条是干什么的。
 *   - 3–6 个。少于 3 个筛不出东西；多于 6 个每个都变噪声，权重一样却互相稀释。
 */
export function validateTags(tags) {
  if (!Array.isArray(tags) || tags.length === 0) return ['tags 必须是非空的标签数组']
  const problems = []
  const seen = new Set()
  for (const tag of tags) {
    if (typeof tag !== 'string' || !tag.trim()) {
      problems.push('标签必须是非空字符串')
      continue
    }
    if (seen.has(tag)) problems.push(`标签重复：${tag}`)
    seen.add(tag)
    if (!TAG_INDEX.has(tag)) {
      const near = nearestTags(tag)
      problems.push(
        `标签不在词表里：${tag}${near.length ? `（相近的：${near.join(' / ')}）` : ''} —— 用 node scripts/tags.mjs 看完整词表`,
      )
    }
  }
  const axes = new Set(tags.map((t) => TAG_INDEX.get(t)).filter(Boolean))
  if (!axes.has('mech')) problems.push('至少要有一个「机制」标签（靠什么成立）')
  if (!axes.has('use') && !axes.has('look')) problems.push('至少要有一个「场合」或「观感」标签')
  if (tags.length < 3) problems.push(`标签太少：${tags.length} 个，至少要 3 个`)
  if (tags.length > 6) problems.push(`标签太多：${tags.length} 个，最多 6 个`)
  return problems
}

/**
 * 词表外的标签，猜几个可能是想写的。校验报错时带上，
 * 省得写的人再去翻一遍词表 —— 「斜纹」报错时能提示「图案」。
 */
function nearestTags(tag) {
  const lower = tag.toLowerCase()
  const hits = ALL_TAGS.filter((t) => {
    if (t === tag) return false
    if (t.toLowerCase() === lower) return true
    return [...lower].some((ch) => /[\u4e00-\u9fa5]/.test(ch) && t.includes(ch)) && t.length <= tag.length + 3
  })
  return hits.slice(0, 4)
}

/** 把一条的标签按轴分组，页面上按这个顺序显示。 */
export function tagsByAxis(tags) {
  return TAG_AXES.map((axis) => ({
    key: axis.key,
    label: axis.label,
    tags: (tags ?? []).filter((t) => TAG_INDEX.get(t) === axis.key),
  })).filter((group) => group.tags.length > 0)
}
