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

initTheme()
initChapterNav()
initPlate()
initMechanismLink()
initCopy()
