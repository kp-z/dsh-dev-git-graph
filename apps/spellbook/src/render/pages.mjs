/**
 * 页面渲染。
 *
 * 结构上只有两种页面：
 *   /            目录（tabula）—— 点引线，不是卡片栅格
 *   /spell/<slug>/  对开（opening）—— 左窄栏页边注，右宽栏正文
 *
 * 页边注里装的是真实元数据，左窄右宽是「注解 vs 正文」的真实层级。
 * 页面上唯一被强调的东西是「机制」：描述里的 ==…== 与代码里的 @mechanism
 * 共享 data-mech，悬停任一侧会点亮另一侧 —— 排版权重 = 迁移权重。
 */

import {
  chineseNumeral,
  escapeHtml,
  renderInline,
  renderParagraphs,
  roman,
  stripMechanismMarkers,
} from './text.mjs'
import { STAGES } from './demo.mjs'
import { fleuron, wandMark } from './marks.mjs'
import { CATEGORIES } from '../../shared/schema.mjs'

const SITE_NAME = '咒语书'
const SITE_TAGLINE = '前端效果库'

function layout({ title, description, body, root, isSpell = false }) {
  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<meta name="description" content="${escapeHtml(description)}">
<link rel="stylesheet" href="${root}styles/spellbook.css">
<script>try{var t=localStorage.getItem('spellbook:theme');if(t)document.documentElement.dataset.theme=t;}catch(e){}</script>
</head>
<body${isSpell ? ' class="is-spell"' : ''}>
<a class="skip" href="#main">跳到正文</a>
${body}
<script type="module" src="${root}site.js"></script>
</body>
</html>
`
}

function header({ root, current = null }) {
  return `<header class="masthead">
  <a class="wordmark" href="${root}">
    ${wandMark('wordmark-wand')}
    <span class="wordmark-name">${escapeHtml(SITE_NAME)}</span>
    <span class="wordmark-tagline">${escapeHtml(SITE_TAGLINE)}</span>
  </a>
  <button class="theme-toggle" type="button" data-theme-toggle aria-label="切换明暗">
    <span class="theme-toggle-mark" aria-hidden="true"></span>
    <span data-theme-label>明</span>
  </button>
${current ? `  <p class="masthead-current">${escapeHtml(current)}</p>` : ''}
</header>`
}

/* ------------------------------------------------------------------ *
 * 目录
 * ------------------------------------------------------------------ */

function renderTabulaRow(entry, ordinal) {
  const numeral = roman(ordinal)
  const href = `spell/${encodeURIComponent(entry.meta.slug)}/`
  return `<li class="row" data-category="${escapeHtml(entry.meta.category)}">
  <a class="row-link" href="${href}">
    <span class="row-numeral" aria-hidden="true">${numeral}</span>
    <span class="row-name">${escapeHtml(entry.meta.title)}</span>
    <span class="row-leader" aria-hidden="true"></span>
    <span class="row-preview" aria-hidden="true">
      <iframe class="row-preview-doc" src="${href}demo.html" loading="lazy" sandbox="allow-scripts" tabindex="-1" title=""></iframe>
    </span>
    <span class="row-when">${escapeHtml(entry.meta.when)}</span>
  </a>
</li>`
}

/**
 * 按 CATEGORIES 的顺序分章。
 * 目录导航与对开页的章节标识都必须走这一份，否则同一个分类在两处会算出不同章号。
 */
export function chaptersOf(entries) {
  return CATEGORIES.map((category) => ({
    category,
    items: entries.filter((entry) => entry.meta.category === category),
  }))
    .filter((chapter) => chapter.items.length > 0)
    .map((chapter, index) => ({ ...chapter, index: index + 1 }))
}

const PROLOGUE = `  <section class="prologue">
    <h1 class="prologue-lede">一条咒语 = 一段描述 + 一段示例代码。</h1>
    <p class="prologue-note">描述负责说清它靠什么机制成立，代码负责证明这件事真的能做到。图版里的预览是真在跑的，不是截图。</p>
  </section>`

const COLOPHON = `      <section class="colophon">
        <h2 class="colophon-head">收录标准</h2>
        <ul class="colophon-list">
          <li><strong>跑得起来</strong>——演示代码在图版里真的渲染，跑不通的不进。</li>
          <li><strong>说得清机制</strong>——描述里必须点名它靠什么成立，那是迁移时唯一不能被冲掉的部分。</li>
          <li><strong>记得住出处</strong>——来源与收录时间。</li>
          <li><strong>说得出场合</strong>——什么时候该用它。</li>
          <li><strong>一句话能说清的不收</strong>——「按钮加个圆角」这种，不说它也懂。</li>
        </ul>
      </section>`

export function renderIndex(entries) {
  const chapters = chaptersOf(entries)

  if (!chapters.length) {
    const body = `${header({ root: './' })}
<main id="main">
${PROLOGUE}
  <p class="empty">库还是空的。往 <code>content/effects/</code> 里放一个 <code>.md</code>，它就会出现在这里。</p>
</main>`
    return layout({
      title: `${SITE_NAME} · ${SITE_TAGLINE}`,
      description: '前端效果库：每条是一段描述加一段可运行的示例代码。',
      body,
      root: './',
    })
  }

  // 全书连续编号：章节只决定分组，条目序号 I、II、III 一路排下去
  let ordinal = 0
  const sections = chapters
    .map((chapter) => {
      const rows = chapter.items.map((entry) => renderTabulaRow(entry, ++ordinal)).join('\n')
      return `      <section class="chapter" id="chapter-${escapeHtml(chapter.category)}">
        <h2 class="chapter-head">
          <span class="chapter-label">第${chineseNumeral(chapter.index)}章</span>
          <span class="chapter-name">${escapeHtml(chapter.category)}</span>
          <span class="chapter-rule" aria-hidden="true"></span>
        </h2>
        <ol class="tabula">
${rows}
        </ol>
      </section>`
    })
    .join('\n\n')

  // 只有一章时不摆导航：一条目录不叫目录
  const withNav = chapters.length > 1
  const nav = withNav
    ? `        <nav class="chapter-nav" aria-label="章目">
          <h2 class="chapter-nav-head">章目</h2>
          <ol class="chapter-nav-list">
${chapters
  .map(
    (chapter) => `            <li><a class="chapter-nav-link" href="#chapter-${escapeHtml(chapter.category)}">
              <span class="chapter-nav-numeral">${chineseNumeral(chapter.index)}</span>
              <span class="chapter-nav-name">${escapeHtml(chapter.category)}</span>
              <span class="chapter-nav-count">${chapter.items.length}</span>
            </a></li>`,
  )
  .join('\n')}
          </ol>
        </nav>
`
    : ''

  const body = `${header({ root: './' })}
<main id="main">
${PROLOGUE}

${fleuron()}

  <div class="index-body${withNav ? ' has-nav' : ''}">
${nav}        <div class="chapters">
${sections}

${COLOPHON}
        </div>
  </div>
</main>`

  return layout({
    title: `${SITE_NAME} · ${SITE_TAGLINE}`,
    description: '前端效果库：每条是一段描述加一段可运行的示例代码。',
    body,
    root: './',
  })
}

/* ------------------------------------------------------------------ *
 * 对开页
 * ------------------------------------------------------------------ */

function renderControl(param) {
  const name = escapeHtml(param.name)
  const label = escapeHtml(param.label)
  const unit = param.unit ?? ''

  if (param.type === 'range') {
    return `      <label class="control">
        <span class="control-label">${label}</span>
        <input type="range" min="${param.min}" max="${param.max}" step="${param.step ?? 1}" value="${param.default}" data-param="${name}" data-unit="${escapeHtml(unit)}">
        <output class="control-value">${param.default}${escapeHtml(unit)}</output>
      </label>`
  }

  if (param.type === 'color') {
    return `      <label class="control control-color">
        <span class="control-label">${label}</span>
        <input type="color" value="${escapeHtml(param.default)}" data-param="${name}">
      </label>`
  }

  if (param.type === 'select') {
    return `      <label class="control control-select">
        <span class="control-label">${label}</span>
        <select data-param="${name}">
${(param.options ?? [])
  .map((option) => `          <option value="${escapeHtml(option)}"${option === param.default ? ' selected' : ''}>${escapeHtml(option)}</option>`)
  .join('\n')}
        </select>
      </label>`
  }

  return ''
}

function renderPlate(entry, ordinal) {
  const stage = entry.meta.stage ?? 'plain'
  const stageInfo = STAGES[stage] ?? { label: stage, note: '' }
  const controls = (entry.meta.params ?? []).map(renderControl).filter(Boolean)

  return `<figure class="plate">
    <div class="plate-frame">
      <iframe class="plate-doc" src="demo.html" sandbox="allow-scripts" loading="lazy" title="${escapeHtml(entry.meta.title)}的实时预览"></iframe>
      <noscript><p class="plate-noscript">实时预览需要 JavaScript。代码在下面，可以直接抄。</p></noscript>
    </div>
${controls.length ? `    <div class="plate-controls">
${controls.join('\n')}
      <button class="replay" type="button" data-replay>重播</button>
    </div>` : ''}
    <figcaption class="plate-caption">
      <span class="plate-numeral">图版 ${roman(ordinal)}</span>
      <span class="plate-stage" title="${escapeHtml(stageInfo.note)}">${escapeHtml(stageInfo.label)}</span>
    </figcaption>
  </figure>`
}

function renderCodeBlock(block) {
  const lines = block.lines
    .map((line, index) => {
      const isMechanism = block.mechanismLines.includes(index)
      const content = escapeHtml(line) || '&nbsp;'
      return isMechanism
        ? `<span class="line is-mech" data-mech>${content}</span>`
        : `<span class="line">${content}</span>`
    })
    .join('')

  return `    <div class="code-block">
      <div class="code-head">
        <span class="code-lang">${escapeHtml(block.lang)}</span>
        <button class="copy" type="button" data-copy>抄录</button>
      </div>
      <pre class="code-body"><code>${lines}</code></pre>
    </div>`
}

export function renderSpell(entry, { ordinal, total, chapter }) {
  const meta = entry.meta
  const description = (entry.description ?? '').trim()
  const firstSentence = description.split(/(?<=。)/)[0] ?? ''
  const numeral = roman(ordinal)

  const tagList = (meta.tags ?? [])
    .map((tag) => `<span class="tag">${escapeHtml(tag)}</span>`)
    .join('')

  const body = `${header({ root: '../../', current: meta.title })}
<main id="main">
  <article class="opening">
    <aside class="marginalia">
      <p class="marginalia-chapter">第${chineseNumeral(chapter.index)}章<span class="marginalia-chapter-sep">·</span>${escapeHtml(meta.category)}</p>
      <div class="marginalia-numeral" aria-hidden="true">${numeral}</div>
      <dl class="marginalia-meta">
        <div class="meta-pair"><dt>收录</dt><dd>${escapeHtml(meta.since)}</dd></div>
        <div class="meta-pair"><dt>出处</dt><dd>${escapeHtml(meta.source)}</dd></div>
      </dl>
      <div class="marginalia-tags">${tagList}</div>
      <p class="marginalia-ordinal">第 ${ordinal} / ${total} 条</p>
    </aside>

    <div class="column">
      <h1 class="title">${escapeHtml(meta.title)}</h1>
      <p class="when"><span class="when-label">用于</span>${escapeHtml(meta.when)}</p>

      <div class="desc">
${renderParagraphs(description)}
      </div>

${renderPlate(entry, ordinal)}

      <section class="source">
        <h2 class="section-head">代码</h2>
        <p class="section-note">示例，不是必须这么写 —— 它证明这个效果成立，并告诉你机制在哪一行。</p>
${entry.code.map(renderCodeBlock).join('\n')}
      </section>

      ${(entry.caveats ?? []).length ? `<section class="notes">
        <h2 class="section-head">边界</h2>
        <ul class="notes-list">
${entry.caveats.map((caveat) => `          <li>${renderInline(caveat)}</li>`).join('\n')}
        </ul>
      </section>

      ` : ''}${entry.notes.length ? `<section class="notes">
        <h2 class="section-head">备注</h2>
        <ul class="notes-list">
${entry.notes.map((note) => `          <li>${renderInline(note)}</li>`).join('\n')}
        </ul>
      </section>` : ''}
    </div>
  </article>
</main>`

  return layout({
    title: `${meta.title} · ${SITE_NAME}`,
    description: firstSentence || meta.when,
    body,
    root: '../../',
    isSpell: true,
  })
}

export { SITE_NAME, SITE_TAGLINE, stripMechanismMarkers }
