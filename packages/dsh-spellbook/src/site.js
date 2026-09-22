/**
 * 咒语书 —— 页面行为
 *
 * 五件事，每件都尽量小：
 *   1. 明暗切换（记住选择）
 *   2. 章目导航：滚动时高亮当前章
 *   3. 图版：参数 → iframe，重播
 *   4. 机制联动：描述里的机制短语 ↔ 代码里的机制行
 *   5. 抄录代码
 */

const html = document.documentElement

import { paramValues } from './param.mjs'

/* ------------------------------------------------------------ 明暗 */

function initTheme() {
  const toggle = document.querySelector('[data-theme-toggle]')
  if (!toggle) return

  const label = toggle.querySelector('[data-theme-label]')

  // 默认就是「夜」。这本书本来就该在夜里读，所以不跟随系统偏好——
  // 系统是亮的不代表你想要一本白天的魔法书。只有明确选过「昼」才变亮。
  const current = () => html.dataset.theme || 'dark'

  const paint = () => {
    if (label) label.textContent = current() === 'dark' ? '明' : '暗'
  }

  toggle.addEventListener('click', () => {
    const next = current() === 'dark' ? 'light' : 'dark'
    html.dataset.theme = next
    try {
      localStorage.setItem('spellbook:theme', next)
    } catch {
      /* 隐私模式下写不了，不影响使用 */
    }
    paint()
  })

  paint()
}

/* ------------------------------------------------------ 条列 / 卡片 */

/**
 * 目录的两种排法。
 *
 *   条列（默认）—— 一行一条，缩略图是「页码」，钉在右边距上，配一条引导线走到底。
 *   卡片        —— 一行四张上下叠的小牌，缩略图放大成主角，扫一眼能看很多条。
 *
 * 两种都留着，因为找东西有两种动作：**认出**（在卡片里瞥见那个效果）和
 * **读到**（在条列里顺着 `when` 那句读完再决定）。缩略图越大越靠「认出」，
 * 文字越宽越靠「读到」，没有一种排法能同时做到底。
 *
 * 开关状态和明暗一样存 localStorage —— 这不是临时筛选，是「我怎么读这本书」。
 */
function initView() {
  const toggle = document.querySelector('[data-view-toggle]')
  if (!toggle) return

  const label = toggle.querySelector('[data-view-label]')

  const current = () => html.dataset.view || 'list'

  const paint = () => {
    // 标签写的是**按下去会得到什么**，和明暗开关同一套规矩：
    // 现在是条列，就写着「卡」，按下去变成卡片。
    if (label) label.textContent = current() === 'list' ? '卡' : '列'
  }

  toggle.addEventListener('click', () => {
    const next = current() === 'list' ? 'card' : 'list'
    html.dataset.view = next
    try {
      localStorage.setItem('spellbook:view', next)
    } catch {
      /* 隐私模式下写不了，不影响使用 */
    }
    paint()
    // 缩略图是 iframe，切排法时它们的尺寸会变。浏览器会自己重排，
    // 但滚动位置常常落在一张已经换了位置的卡片上 —— 把锚点交还给浏览器。
    requestAnimationFrame(() => {
      const focused = document.activeElement
      if (focused && focused !== document.body && focused.scrollIntoView) {
        focused.scrollIntoView({ block: 'nearest' })
      }
    })
  })

  paint()
}

/* -------------------------------------------------------- 按标签筛 */

/**
 * `?tag=玻璃` —— 只看带这个标签的咒语。
 *
 * 为什么不复用查词口：那是**全文检索**，查「玻璃」会把正文里提了一句玻璃的
 * 条目也捞进来（实测 14 条命中，而真正带 `玻璃` 标签的是 8 条）。全文检索适合
 * 「我想找那个大概跟玻璃有关的东西」，标签筛选回答的是另一个问题 ——
 * 「带这个标签的都有哪些」。两个都要，所以两个都留着。
 *
 * 标签是受控词表里的枚举值，所以这里是**精确匹配整个标签**，不是子串包含：
 * 点「标签」不该把「标签页」也带出来。
 *
 * 筛选在客户端做（每一行都带着自己的 data-tags），不走检索、不请求任何东西 ——
 * 于是「点标签 → 看到结果」是零延迟的。
 */
function initTagFilter() {
  const bar = document.querySelector('[data-tag-filter]')
  if (!bar) return

  const rows = [...document.querySelectorAll('.row')]
  if (!rows.length) return

  // 每个标签都是完整的词，用空格分隔；精确比较，不做子串匹配
  const tagOf = (row) => (row.dataset.tags || '').split(' ').filter(Boolean)

  const apply = (tag) => {
    if (!tag) return
    let shown = 0
    for (const row of rows) {
      const hit = tagOf(row).includes(tag)
      row.hidden = !hit
      if (hit) shown++
    }
    // 一条都没有的分类不该留着一个空的章标题
    for (const chapter of document.querySelectorAll('.chapter')) {
      chapter.hidden = !chapter.querySelector('.row:not([hidden])')
    }
    // 章目导航与「第 N 章」都是按分类数的，筛完就对不上了 —— 整条收起
    const nav = document.querySelector('.chapter-nav')
    if (nav) nav.hidden = true

    const name = bar.querySelector('[data-tag-filter-name]')
    const count = bar.querySelector('[data-tag-filter-count]')
    if (name) name.textContent = tag
    if (count) count.textContent = `${shown} 条`
    bar.hidden = false
    document.title = `${tag} · ${document.title}`
  }

  apply(new URLSearchParams(location.search).get('tag'))
}

/* ---------------------------------------------------------- 章目高亮 */

/**
 * 章目导航是跳转，不是筛选 —— 全书始终完整可读。
 * 判定线取视口顶部往下 130px：标题一旦越过这条线，就算进入了这一章。
 */
function initChapterNav() {
  const links = [...document.querySelectorAll('.chapter-nav-link')]
  if (!links.length) return

  const entries = links
    .map((link) => {
      const id = (link.getAttribute('href') ?? '').slice(1)
      const section = id ? document.getElementById(id) : null
      return section ? { link, section } : null
    })
    .filter(Boolean)

  if (!entries.length) return

  let queued = false

  const paint = () => {
    queued = false

    const doc = document.documentElement
    // 视口比整页还高时（大竖屏、整页截图）根本滚不动，
    // 不加这个前提，触底判定会一直成立，最后一章从头到尾都是高亮的。
    const scrollable = doc.scrollHeight - window.innerHeight > 40
    const scrolledToEnd = scrollable && window.innerHeight + window.scrollY >= doc.scrollHeight - 4

    let current = entries[0]
    if (scrolledToEnd) {
      current = entries[entries.length - 1]
    } else {
      const line = 130
      for (const item of entries) {
        if (item.section.getBoundingClientRect().top <= line) current = item
      }
    }

    for (const item of entries) item.link.classList.toggle('is-current', item === current)
  }

  const schedule = () => {
    if (queued) return
    queued = true
    window.requestAnimationFrame(paint)
  }

  window.addEventListener('scroll', schedule, { passive: true })
  window.addEventListener('resize', schedule, { passive: true })
  paint()
}

/* ------------------------------------------------------------ 图版 */

function initPlate() {
  const plate = document.querySelector('.plate')
  if (!plate) return

  const doc = plate.querySelector('.plate-doc')
  if (!doc) return

  const inputs = [...plate.querySelectorAll('[data-param]')]
  let ready = false

  // 参数元数据从 DOM 读回来，单位规则与构建时用的是同一份 shared/param.mjs
  const params = inputs.map((input) => ({
    name: input.dataset.param,
    type: input.type === 'range' ? 'range' : 'text',
    unit: input.dataset.unit || undefined,
  }))

  const values = () => {
    const raw = {}
    for (const input of inputs) {
      raw[input.dataset.param] = input.type === 'range' ? Number(input.value) : input.value
    }
    return paramValues(params, raw)
  }

  const post = (message) => {
    if (!doc.contentWindow) return
    doc.contentWindow.postMessage(message, '*')
  }

  const push = () => post({ type: 'spellbook:params', values: values() })

  const paintValue = (input) => {
    const output = input.parentElement?.querySelector('.control-value')
    if (output) output.textContent = `${input.value}${input.dataset.unit ?? ''}`
  }

  for (const input of inputs) {
    paintValue(input)
    input.addEventListener('input', () => {
      paintValue(input)
      push()
    })
  }

  // iframe 还没加载完就发消息会丢，所以等 load 之后再推一次
  doc.addEventListener('load', () => {
    ready = true
    push()
  })
  if (doc.contentDocument?.readyState === 'complete') {
    ready = true
    push()
  }

  const replay = plate.querySelector('[data-replay]')
  replay?.addEventListener('click', () => {
    post({ type: 'spellbook:replay' })
    if (ready) window.setTimeout(push, 60)
  })
}

/* -------------------------------------------------------- 机制联动 */

function initMechanismLink() {
  const marks = [...document.querySelectorAll('[data-mech]')]
  if (marks.length < 2) return

  const light = (on) => {
    for (const mark of marks) mark.classList.toggle('is-lit', on)
  }

  for (const mark of marks) {
    mark.addEventListener('mouseenter', () => light(true))
    mark.addEventListener('mouseleave', () => light(false))
    mark.addEventListener('focus', () => light(true))
    mark.addEventListener('blur', () => light(false))
  }
}

/* ------------------------------------------------------------ 抄录 */

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    // 非安全上下文或没权限时退回到老办法
    const area = document.createElement('textarea')
    area.value = text
    area.setAttribute('readonly', '')
    area.style.position = 'fixed'
    area.style.opacity = '0'
    document.body.appendChild(area)
    area.select()
    const ok = document.execCommand('copy')
    area.remove()
    return ok
  }
}

function initCopy() {
  for (const button of document.querySelectorAll('[data-copy]')) {
    const block = button.closest('.code-block')
    const code = block?.querySelector('.code-body code')

    button.addEventListener('click', async () => {
      if (!code) return
      // 每行一个 .line，用换行重新拼回原文，避免复制时带上行号或丢换行
      const lines = [...code.querySelectorAll('.line')]
      const text = (lines.length ? lines.map((line) => line.textContent) : [code.textContent]).join('\n')

      const done = await copyText(text)
      button.textContent = done ? '已抄录' : '没抄成'
      button.classList.toggle('is-done', done)
      window.setTimeout(() => {
        button.textContent = '抄录'
        button.classList.remove('is-done')
      }, 1400)
    })
  }
}

/* ------------------------------------------------------------ 检索 */

/**
 * 检索为什么放在浏览器里：
 *   这是静态站，没有后端。索引是构建期生成的一个 JSON（244KB，gzip 后小得多），
 *   排序用的是 shared/rank.mjs —— 与库里 FTS5 同一套分词与列权重。
 *   索引与排序模块都**按需加载**：不碰搜索框的人不必为它付流量。
 */
let ranker = null
let indexPromise = null

function loadSearch() {
  if (indexPromise) return indexPromise
  indexPromise = Promise.all([
    import('./rank.mjs'),
    fetch('./search-index.json', { cache: 'force-cache' }).then((r) => {
      if (!r.ok) throw new Error(`索引取不到（${r.status}）`)
      return r.json()
    }),
  ]).then(([mod, data]) => {
    ranker = { mod, index: mod.buildIndex(data.docs), docs: data.docs }
    return ranker
  })
  return indexPromise
}

/** 命中词描红。用 <mark> 而不是自己画样式 —— 深浅两色下都交给 CSS 的 mark 规则。 */
function markTerms(text, query, terms) {
  const safe = escapeHtml(text)
  if (!terms.length) return safe
  // 长的先替换，避免「玻璃」被「玻」先吃掉一半
  const ordered = [...terms].sort((a, b) => b.length - a.length)
  let out = safe
  for (const term of ordered) {
    if (term.length < 1) continue
    const pattern = new RegExp(`(${escapeRegExp(escapeHtml(term))})`, 'gi')
    out = out.replace(pattern, '<mark>$1</mark>')
  }
  return out
}

function escapeHtml(text) {
  return String(text ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function escapeRegExp(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function initSearch() {
  const input = document.querySelector('.concordance-input')
  const status = document.querySelector('[data-search-status]')
  const results = document.querySelector('[data-search-results]')
  const browse = document.querySelector('[data-browse]')
  const clear = document.querySelector('[data-search-clear]')
  if (!input || !results || !browse) return

  let terms = []
  let current = []
  let selected = -1
  // 上一轮是不是在检索。只用来认「刚进入检索」这个瞬间。
  let wasSearching = false

  const setStatus = (text) => {
    if (status) status.textContent = text
  }

  const render = () => {
    const query = input.value.trim()

    if (!query) {
      results.hidden = true
      results.replaceChildren()
      browse.hidden = false
      if (clear) clear.hidden = true
      current = []
      selected = -1
      wasSearching = false
      // 不查的时候状态行空着。它只在检索时报事（取索引 / 命中数 / 出错），
      // 「共 N 条」那句是常驻说明，首屏不需要第二行字。
      setStatus('')
      return
    }

    if (clear) clear.hidden = false

    if (!ranker) {
      setStatus('正在取索引…')
      loadSearch()
        .then(() => render())
        .catch((error) => setStatus(`搜索不可用：${error.message}`))
      return
    }

    const hits = ranker.mod.rank(ranker.index, query, { limit: 40 })
    terms = ranker.mod.units ? ranker.mod.units(query).map((u) => u.join('')) : []
    current = hits
    selected = -1

    browse.hidden = true
    results.hidden = false

    if (!hits.length) {
      results.innerHTML = `<p class="search-empty">没有匹配的咒语。</p>
        <p class="search-empty-hint">试试换个说法，或者只留一个关键词。比如「跟随」「玻璃」「条纹」「绕排」。</p>`
      setStatus('0 条命中')
      return
    }

    results.innerHTML = `<ol class="hits">${hits.map(renderHit).join('')}</ol>`
    setStatus(`${hits.length} 条命中${hits.length >= 40 ? '，只显示前 40 条' : ''}`)

    /* 刚进入检索时，把结果的顶端挪到吸顶刊头底下。
       不这么做的话：用户滚到第 6000 行才开始打字，而结果区在页面最上面，
       他敲完却看着一片与搜索无关的旧内容。命中少的时候目录一收、页面塌下来，
       浏览器顺手把他夹回顶部，看着像"能用"；可一命中 40 条、页面还是几千行高，
       他就会停在结果中段。这是撞运气，得写明。
       只在"刚进入检索"这一刻做，逐字输入时不抢滚动条。 */
    if (!wasSearching) {
      const bar = document.querySelector('.masthead')
      const barH = bar ? bar.getBoundingClientRect().height : 0
      const top = results.getBoundingClientRect().top + window.scrollY - barH - 12
      // 已经在画面里就别动了
      if (results.getBoundingClientRect().top < barH) {
        window.scrollTo({ top: Math.max(0, top), behavior: 'instant' })
      }
    }
    wasSearching = true
  }

  const renderHit = (hit) => {
    const doc = ranker.docs.find((d) => d.slug === hit.slug)
    if (!doc) return ''
    const href = `spell/${encodeURIComponent(doc.slug)}/`
    const why = hit.why
      ? `<p class="hit-why"><span class="hit-why-label">${escapeHtml(hit.why.label)}</span><em>${markTerms(hit.why.text, input.value, terms)}</em></p>`
      : ''
    // 结果里不放 iframe。125 条目录已经是懒加载的图版，每敲一个字再挂 40 个会很沉。
    // 想看动的就点「预览」，那时只挂一个。
    return `<li class="hit" data-slug="${escapeHtml(doc.slug)}">
      <a class="hit-link" href="${href}">
        <span class="hit-name">${markTerms(doc.title, input.value, terms)}</span>
        <span class="hit-cat">${escapeHtml(doc.category)}</span>
      </a>
      ${why}
      <p class="hit-when">${markTerms(doc.when_text, input.value, terms)}</p>
      <span class="hit-tools">
        <button class="hit-tool" type="button" data-peek="${escapeHtml(doc.slug)}">预览</button>
        <button class="hit-tool" type="button" data-prompt="${escapeHtml(doc.slug)}">抄咒语</button>
      </span>
    </li>`
  }

  // 首次进入搜索状态时才去取索引：不查的人不必下载。
  // 载入完成后必须重画一次 —— 首屏那次 render() 跑在索引还没到的时候，
  // 状态行会停在「共  条咒语」这种空计数上。
  let warmed = false
  const warm = () => {
    if (warmed) return
    warmed = true
    loadSearch()
      .then(() => render())
      .catch((error) => setStatus(`搜索不可用：${error.message}`))
  }
  input.addEventListener('focus', warm, { once: true })
  input.addEventListener('pointerdown', warm, { once: true })

  // 从条目页点标签过来会带 ?q=<标签>：把词填进查词口并当场查一遍。
  // 于是标签不只是「这条咒语被标了什么」，而是一个能一路点下去的入口 ——
  // 这是标签系统真正省事的地方：不用先把词抄进查词口。
  const initial = new URLSearchParams(location.search).get('q')
  if (initial) {
    input.value = initial
    render()
  }

  input.addEventListener('input', render)

  input.addEventListener('keydown', (event) => {
    const links = [...results.querySelectorAll('.hit-link')]
    if (event.key === 'ArrowDown' && links.length) {
      event.preventDefault()
      selected = Math.min(selected + 1, links.length - 1)
      links[selected].focus()
    } else if (event.key === 'Escape') {
      input.value = ''
      render()
      input.blur()
    }
  })

  // 结果列表里继续用上下键走，走到底再回到输入框
  results.addEventListener('keydown', (event) => {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return
    const links = [...results.querySelectorAll('.hit-link')]
    const at = links.indexOf(document.activeElement)
    if (at === -1) return
    event.preventDefault()
    const next = event.key === 'ArrowDown' ? at + 1 : at - 1
    if (next < 0) input.focus()
    else if (next < links.length) links[next].focus()
  })

  clear?.addEventListener('click', () => {
    input.value = ''
    render()
    input.focus()
  })

  // 「/」或 ⌘K 直接落到查词口。已经在输入控件里时不抢。
  window.addEventListener('keydown', (event) => {
    const tag = document.activeElement?.tagName
    const typing = tag === 'INPUT' || tag === 'TEXTAREA' || document.activeElement?.isContentEditable
    if (event.key === '/' && !typing) {
      event.preventDefault()
      input.focus()
      input.select()
    } else if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
      event.preventDefault()
      input.focus()
      input.select()
    }
  })

  render()
}

/* ------------------------------------------------------- 抄一整条咒语 */

/**
 * 复制的是构建期生成的 prompt.txt，与「看这一条的全文」用的是同一份内容，
 * 所以复制到的不可能和页面上的不一致。
 */
function initPromptCopy() {
  document.addEventListener('click', async (event) => {
    const button = event.target.closest('[data-prompt]')
    if (!button) return

    const slug = button.dataset.prompt
    const original = button.textContent
    button.disabled = true
    button.textContent = '取…'

    try {
      const response = await fetch(`spell/${encodeURIComponent(slug)}/prompt.txt`, {
        cache: 'force-cache',
      })
      if (!response.ok) throw new Error(String(response.status))
      const text = await response.text()
      const done = await copyText(text)
      button.textContent = done ? '已抄走' : '没抄成'
      button.classList.toggle('is-done', done)
    } catch {
      button.textContent = '没取到'
    }

    window.setTimeout(() => {
      button.textContent = original
      button.disabled = false
      button.classList.remove('is-done')
    }, 1600)
  })
}

/* ---------------------------------------------------------- 放大预览 */

/**
 * 点击缩略图 → 弹一个放大的活预览。
 *
 * 用 <dialog> 而不是自建遮罩：焦点圈禁、Esc 关闭、背景 inert 都由浏览器负责，
 * 自己写这三样很容易漏掉其中一样。
 */
function initPeek() {
  const dialog = document.querySelector('[data-peek-dialog]')
  if (!dialog) return

  const stage = dialog.querySelector('[data-peek-stage]')
  const title = dialog.querySelector('[data-peek-title]')
  const why = dialog.querySelector('[data-peek-why]')
  const more = dialog.querySelector('[data-peek-more]')

  const close = () => {
    // 关掉时把 iframe 卸掉：否则里面的动画会一直在后台跑
    stage.replaceChildren()
    dialog.close()
  }

  document.addEventListener('click', (event) => {
    const trigger = event.target.closest('[data-peek]')
    if (!trigger) return
    event.preventDefault()

    const slug = trigger.dataset.peek
    const row = trigger.closest('.row, .hit')
    const name = row?.querySelector('.row-name, .hit-name')?.textContent ?? slug
    const matched = row?.querySelector('.hit-why')?.textContent ?? ''

    title.textContent = name
    why.textContent = matched ? `搜索命中：${matched.replace(/^[^：]*：/, '')}` : ''
    more.href = `spell/${encodeURIComponent(slug)}/`

    const frame = document.createElement('iframe')
    frame.className = 'peek-doc'
    frame.src = `spell/${encodeURIComponent(slug)}/demo.html`
    frame.setAttribute('sandbox', 'allow-scripts')
    frame.title = `放大预览：${name}`
    stage.replaceChildren(frame)

    dialog.showModal()
  })

  dialog.querySelector('[data-peek-close]')?.addEventListener('click', close)
  // 点遮罩（dialog 自身）关闭
  dialog.addEventListener('click', (event) => {
    if (event.target === dialog) close()
  })
  dialog.addEventListener('close', () => stage.replaceChildren())
}

/**
 * 把吸顶刊头的真实高度写进 --masthead-h。
 *
 * 章目导航也要吸顶，它得让开刊头那一段。可刊头多高是内容定的 ——
 * 查词口、书名的字号、字体加载前后都会变，写死一个数迟早错位
 * （先前写 78px，实测 89px，于是两级吸顶只差 5px 就贴上了）。
 * 所以量一次写进变量，字号变了、字体到了、窗口缩放了都重量。
 */
function syncMastheadHeight() {
  const masthead = document.querySelector('.masthead')
  if (!masthead) return
  const height = Math.round(masthead.getBoundingClientRect().height)
  if (height > 0) {
    document.documentElement.style.setProperty('--masthead-h', `${height}px`)
  }
}

initTheme()
initView()
syncMastheadHeight()
window.addEventListener('resize', syncMastheadHeight)
// 自托管字体是后到的，落位后刊头可能变高，得再量一次
if (document.fonts?.ready) document.fonts.ready.then(syncMastheadHeight).catch(() => {})
initChapterNav()
initPlate()
initMechanismLink()
initCopy()
initSearch()
initTagFilter()
initPromptCopy()
initPeek()
