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
 */

/** 去掉描述里的 ==…== 标记，保留文字。 */
export function stripMarks(text) {
  return String(text ?? '').replace(/==([^=]+)==/g, '$1')
}

const LANG_LABEL = { html: 'HTML', css: 'CSS', js: 'JavaScript' }

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

  lines.push(`用 HTML/CSS 实现这个前端效果：${title}`)
  if (meta.category) lines.push(`类别：${meta.category}`)
  lines.push('')

  if (meta.when) {
    lines.push(`什么时候用它：${meta.when}`)
    lines.push('')
  }

  const description = stripMarks(entry.description ?? '').trim()
  if (description) {
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

  const code = entry.code ?? []
  if (code.length) {
    lines.push('参考实现（示例，不是唯一写法）：')
    for (const block of code) {
      const label = LANG_LABEL[block.lang] ?? block.lang
      lines.push(`--- ${label} ---`)
      // @mechanism 开头的行是站点自己的批注，对 AI 是实现细节的提示，留着有用，但去掉行首标记
      // 代码块在库里有两种形状：parse() 给 lines（构建期），vault.get() 给 body（插件）。
      // 两种都要认——只认一种会悄悄漏掉代码，而「描述 + 代码」缺一半就不叫咒语了。
      const body = typeof block.body === 'string' ? block.body : (block.lines ?? []).join('\n')
      lines.push(stripMechanismAnnotations(body))
      lines.push('')
    }
  }

  const caveats = entry.caveats ?? []
  if (caveats.length) {
    lines.push('容易失效的地方：')
    for (const c of caveats) lines.push(`- ${stripMarks(c)}`)
    lines.push('')
  }

  if (meta.source) lines.push(`出处：${meta.source}`)

  return `${lines.join('\n').replace(/\n{3,}/g, '\n\n').trim()}\n`
}
