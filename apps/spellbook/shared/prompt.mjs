/**
 * 咒语书 —— 把一条条目拼成一段「可直接抄走的咒语」
 *
 * 为什么单独成模块：
 *   站点上「一键复制」抄走的东西，和构建时写进 prompt.txt 的东西必须是同一份，
 *   否则页面上显示的和复制到的不一致 —— 又是一个两个真相。
 *
 * 咒语的形状：一条咒语 = 描述 + 示例代码（库的立论）。
 * 所以拼出来的文本必须同时带上「说什么」与「怎么做到」，并且：
 *   - 去掉 ==机制== 这对标记（那是排版权重的记号，对 AI 是噪音）
 *   - 把机制单独拎出来放在显眼处（它是迁移时唯一不能被冲掉的部分）
 *   - 带上边界（否则 AI 会把一个会失效的做法当通用解）
 *   - 点明代码是**示例**而不是唯一写法（这是库的既定立场）
 *
 * ── 这是给 AI 的任务书，不是一段要照抄的代码 ────────────────────────
 *
 * 这一层原先写错过：开头是「用 HTML/CSS 实现这个前端效果：」，等于替对方把
 * 技术栈定死了。可落到什么栈上，取决于**对方手里那个项目** —— 库里的示例是
 * HTML/CSS，只因为「描述 + 代码」总要挑一种语言把机制演示出来，不因为它是对的
 * 那一栈。一条咒语拿去做 React 组件、Vue 指令、SwiftUI 还是 shader，都该成立。
 *
 * 所以提示分两层，且程序上分开：
 *   承重的一层 —— 效果、机制、边界，与技术栈无关，一条都不能丢；
 *   演示的一层 —— 示例代码，带**它自己那份语言的名字**，随时可以被改写。
 *
 * 顺序也是这一层的意思：约束排在示例**前面**。给 AI 的任务书该先说清要什么、
 * 什么会坏，再给一个参考 —— 把代码摆在最后，它读起来才像例子而不像模板。
 */

/** 去掉描述里的 ==…== 标记，保留文字。 */
export function stripMarks(text) {
  return String(text ?? '').replace(/==([^=]+)==/g, '$1')
}

/**
 * 代码块的语言名。
 *
 * 查表只为把 `js` 写成 `JavaScript` 好看一点；**查不到就用原样** —— 这个兜底
 * 是故意的：库迟早会收进 html/css 之外的东西，那时不该因为这里漏配一个键，
 * 就把人家的语言名吞掉或写错。
 */
const LANG_LABEL = {
  html: 'HTML',
  css: 'CSS',
  js: 'JavaScript',
  jsx: 'JSX',
  ts: 'TypeScript',
  tsx: 'TSX',
  vue: 'Vue',
  svelte: 'Svelte',
  astro: 'Astro',
  svg: 'SVG',
  glsl: 'GLSL',
  wgsl: 'WGSL',
  json: 'JSON',
  sh: 'Shell',
  bash: 'Shell',
}

export function langLabel(lang) {
  const key = String(lang ?? '').trim().toLowerCase()
  return LANG_LABEL[key] ?? String(lang ?? '').trim()
}

/**
 * 把代码里站内自己的机制批注清成「人对 AI 说的话」。
 *
 * 库里的写法是 `/* @mechanism 说明 *​/`。带说明的那些是真提示，留着；
 * 光秃秃的 `/* @mechanism *​/` 只是一个记号，对拿到提示的人毫无意义，连同注释一起删掉。
 * 不清的话，复制出去的提示里会混进一本站内约定手册。
 */
export function stripMechanismAnnotations(code) {
  return String(code ?? '')
    // /* @mechanism 有说明 */ → /* 有说明 */
    .replace(/(\/\*\s*)@mechanism\s+([\s\S]*?)\s*\*\//g, '$1$2 */')
    // /* @mechanism */（无说明）→ 整段删掉，连带紧跟的空格
    .replace(/[ \t]*\/\*\s*@mechanism\s*\*\/[ \t]*/g, '')
    .replace(/[ \t]*\/\*\s*@mechanism\s*\*\/[ \t]*/g, '')
    // // @mechanism 有说明 → // 有说明
    .replace(/(\/\/\s*)@mechanism\s+([^\n]*)/g, '$1$2')
    // // @mechanism（无说明）→ 删掉整行
    .replace(/^[ \t]*\/\/\s*@mechanism\s*$\n?/gm, '')
    .replace(/[ \t]*@mechanism\s*\*\/[ \t]*/g, '')
}

/**
 * @param {object} entry 与 vault.get() 同形：{ meta/slug/title/category/when/description/mechanisms/code/caveats/notes/source/since }
 * @returns {string} 可直接复制的纯文本
 */
export function buildPrompt(entry) {
  const meta = entry.meta ?? entry
  const title = meta.title ?? meta.slug
  const lines = []

  lines.push(`任务：把「${title}」这个效果做进我的项目。`)
  lines.push('')
  // 开场三句是这份提示最要紧的部分：它把「什么可搬、什么不可搬」先说了。
  // 不写这三句，AI 会把示例当规格照抄，而示例里的栈、类名、尺寸全是碰巧。
  lines.push('要拿走的是效果、机制、边界这三样；代码只是其中一种落法。')
  lines.push('用哪个栈、哪个框架、兼容到什么程度，取决于你手里这个项目：先看清它，再按它改写。')
  lines.push('示例里的类名、尺寸、结构都是随手取的，不是接口。')
  lines.push('')

  if (meta.category) lines.push(`类别：${meta.category}`)
  if (meta.when) lines.push(`什么时候用它：${meta.when}`)
  if (meta.category || meta.when) lines.push('')

  const description = stripMarks(entry.description ?? '').trim()
  if (description) {
    lines.push('要的效果：')
    lines.push(description)
    lines.push('')
  }

  // 机制单独拎出来。描述里已经含它，但它是承重墙，值得在提示里再说一次。
  const mechanisms = entry.mechanisms ?? []
  if (mechanisms.length) {
    lines.push('靠什么成立：')
    for (const m of mechanisms) lines.push(`- ${stripMarks(m)}`)
    lines.push('')
  }

  // 边界排示例**前面**：约束该在动手之前读到，而不是写完代码才看见。
  const caveats = entry.caveats ?? []
  if (caveats.length) {
    lines.push('容易失效的地方：')
    for (const c of caveats) lines.push(`- ${stripMarks(c)}`)
    lines.push('')
  }

  const code = entry.code ?? []
  if (code.length) {
    // 语言名单从数据里现算，不写死。哪一天库里收了 React、Vue、shader，
    // 这一句自己就跟着变，不需要有人记得回来改提示生成器。
    const langs = [...new Set(code.map((block) => langLabel(block.lang)))]
    lines.push(`参考实现：示例用 ${langs.join('、')} 写成，能直接跑 —— 它示范的是上面那条机制。`)
    for (const block of code) {
      lines.push(`--- ${langLabel(block.lang)} ---`)
      // @mechanism 开头的行是站点自己的批注，对 AI 是实现细节的提示，留着有用，但去掉行首标记
      // 代码块在库里有两种形状：parse() 给 lines（构建期），vault.get() 给 body（插件）。
      // 两种都要认——只认一种会悄悄漏掉代码，而「描述 + 代码」缺一半就不叫咒语了。
      const body = typeof block.body === 'string' ? block.body : (block.lines ?? []).join('\n')
      lines.push(stripMechanismAnnotations(body))
      lines.push('')
    }
  }

  if (meta.source) lines.push(`出处：${meta.source}`)

  return `${lines.join('\n').replace(/\n{3,}/g, '\n\n').trim()}\n`
}
