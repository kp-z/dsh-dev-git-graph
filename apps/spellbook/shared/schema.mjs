/**
 * 咒语书 —— 条目校验
 *
 * 构建期跑，坏数据一律 fail loud，并且必须指出「哪个文件、哪个字段、为什么」。
 * 与 parse.mjs 一样，这里不依赖任何第三方库 —— 未来的 DSH 插件要复用同一套规则。
 */

export const CATEGORIES = ['材质', '动效', '排版', '交互', '布局', '图形']

/**
 * 图版的舞台。玻璃、模糊、混合模式在白底上看不出效果，所以舞台是必填项。
 *   plain  无背景内容（对照用，专给不需要背景的条目）
 *   photo  有内容的彩色背景 —— 让模糊、饱和、混合模式显形
 *   grid   细网格 —— 看对齐、位移、跟随
 *   dark   暗场 —— 看发光、阴影、半透明
 */
export const STAGES = ['plain', 'photo', 'grid', 'dark']

export const PARAM_TYPES = ['range', 'color', 'select', 'text']

/**
 * 分层。库求全，推送求准：
 *   core       手工过筛的核心条目，自动提议只从这里出
 *   candidate  收了但还没策展，可以搜到，不主动推
 *   archive    不再推荐，但记录留着——归档不是删除
 */
export const TIERS = ['core', 'candidate', 'archive']

const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
const DATE_RE = /^\d{4}-\d{2}$/

/**
 * 校验一条已解析的咒语。
 * @returns {string[]} 人类可读的问题列表，空数组表示通过。
 */
export function validateEntry(entry, { file = '<unknown>', expectedSlug } = {}) {
  const problems = []
  const meta = entry.meta ?? {}
  const req = (key, label = key) => {
    const value = meta[key]
    if (value === undefined || value === null || value === '') {
      problems.push(`缺少必填字段 ${label}`)
      return false
    }
    return true
  }

  if (req('title')) {
    if (typeof meta.title !== 'string') problems.push('title 必须是字符串')
  }
  if (req('slug')) {
    if (typeof meta.slug !== 'string' || !SLUG_RE.test(meta.slug)) {
      problems.push('slug 只能是小写字母、数字与连字符')
    } else if (expectedSlug && meta.slug !== expectedSlug) {
      problems.push(`slug "${meta.slug}" 与文件名 "${expectedSlug}" 不一致`)
    }
  }
  if (req('category')) {
    if (!CATEGORIES.includes(meta.category)) {
      problems.push(`category "${meta.category}" 不在允许值里（${CATEGORIES.join(' / ')}）`)
    }
  }
  if (req('since')) {
    if (typeof meta.since !== 'string' || !DATE_RE.test(meta.since)) {
      problems.push('since 必须是 YYYY-MM 形式')
    }
  }
  req('source')
  req('when')

  if (meta.tier !== undefined) {
    if (!TIERS.includes(meta.tier)) {
      problems.push(`tier "${meta.tier}" 不在允许值里（${TIERS.join(' / ')}）`)
    }
  }

  if (req('stage')) {
    if (!STAGES.includes(meta.stage)) {
      problems.push(`stage "${meta.stage}" 不在允许值里（${STAGES.join(' / ')}）`)
    }
  }

  if (meta.tags !== undefined) {
    if (!Array.isArray(meta.tags) || meta.tags.some((t) => typeof t !== 'string' || !t.trim())) {
      problems.push('tags 必须是非空字符串数组')
    }
  }

  // 参数
  const params = meta.params
  if (params !== undefined) {
    if (!Array.isArray(params)) {
      problems.push('params 必须是数组')
    } else {
      const seen = new Set()
      params.forEach((param, index) => {
        const at = `params[${index}]`
        if (!param || typeof param !== 'object' || Array.isArray(param)) {
          problems.push(`${at} 必须是对象`)
          return
        }
        if (!param.name || typeof param.name !== 'string') {
          problems.push(`${at} 缺少 name`)
        } else if (seen.has(param.name)) {
          problems.push(`${at} 的 name "${param.name}" 重复`)
        } else {
          seen.add(param.name)
        }
        if (!param.label || typeof param.label !== 'string') {
          problems.push(`${at} 缺少 label（界面上的显示名）`)
        }
        if (!PARAM_TYPES.includes(param.type)) {
          problems.push(`${at} 的 type "${param.type}" 不在允许值里（${PARAM_TYPES.join(' / ')}）`)
        }
        if (param.type === 'range') {
          if (typeof param.min !== 'number') problems.push(`${at} 是 range，缺少数字 min`)
          if (typeof param.max !== 'number') problems.push(`${at} 是 range，缺少数字 max`)
          if (typeof param.default !== 'number') problems.push(`${at} 是 range，缺少数字 default`)
          if (
            typeof param.min === 'number' &&
            typeof param.max === 'number' &&
            param.min > param.max
          ) {
            problems.push(`${at} 的 min 大于 max`)
          }
        }
        if (param.type === 'select') {
          if (!Array.isArray(param.options) || param.options.length === 0) {
            problems.push(`${at} 是 select，缺少 options`)
          }
        }
      })
    }
  }

  // 正文
  if (!entry.description?.trim()) problems.push('## 描述 是空的')
  if (!entry.mechanisms?.length) problems.push('描述里没有标出 ==机制==')
  if (!entry.code?.length) problems.push('## 代码 里没有代码块')

  // 参数应该在代码里真的被用到，否则滑杆是假的
  if (Array.isArray(params) && params.length && entry.code?.length) {
    const source = entry.code.map((b) => b.lines.join('\n')).join('\n')
    for (const param of params) {
      if (param?.name && !source.includes(`--${param.name}`)) {
        problems.push(`参数 ${param.name} 在代码里没有对应的 var(--${param.name})，滑杆不会有作用`)
      }
    }
  }

  // 作者漏掉 @mechanism 时，parse 已经抛错；这里只兜底
  const mechanismLines = entry.code?.reduce((n, b) => n + b.mechanismLines.length, 0) ?? 0
  if (entry.code?.length && mechanismLines === 0) {
    problems.push('代码里没有 @mechanism 标记')
  }

  return problems.filter(Boolean).map((p) => `${file}: ${p}`)
}

/** 批量校验，返回 { ok, errors }。 */
export function validateAll(entries) {
  const errors = []
  const slugs = new Map()
  for (const { entry, file, slug } of entries) {
    errors.push(...validateEntry(entry, { file, expectedSlug: slug }))
    const seen = slugs.get(entry.meta?.slug)
    if (seen) errors.push(`${file}: slug "${entry.meta.slug}" 与 ${seen} 重复`)
    else slugs.set(entry.meta?.slug, file)
  }
  return { ok: errors.length === 0, errors }
}
