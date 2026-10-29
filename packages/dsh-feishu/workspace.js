/**
 * 工作区绑定：纯匹配逻辑（无 IO、无 fs），给 `index.js` 的 resolveWorkspace 用。
 *
 * 为什么单独一层：工作区**名字是可修改的**，也是不唯一的（DSH 允许不同目录共用 title）。
 * 所以「名字 → 工作区」不能靠猜，必须先看本地绑定的 id/path，名字只在第一次绑定时当输入。
 *
 * 返回的 `via` 说清这次是凭什么认出来的，便于日志与迁移统计：
 *   id / path（已绑定，改名不断链） → title / path-text / normalized（首次绑定）
 * 认不出来就报错，**不再有「包含匹配」和「绝对路径兜底」**——那两种会静默开错目录。
 */

/** 归一化：去括号/标点/空白，小写。`[DSH] 插件开发` ≈ `DSH插件开发`。 */
export function normalizeWorkspaceName(value) {
  return String(value ?? '')
    .toLowerCase()
    .replace(/[[\]（）()【】<>《》\s_\-·]+/g, '')
}

/** 看起来像个绝对路径（用于提示「可登记」；是否存在交给调用方判断）。 */
export function looksLikeAbsolutePath(value) {
  return /^\//.test(String(value ?? '').trim())
}

/**
 * 在登记表里认一个工作区。
 *
 * @param {object} input
 * @param {Array<{id:string,title:string,path:string}>} input.list 已登记工作区
 * @param {{id?:string,path?:string,title?:string}|null} [input.binding] 本地绑定（主键）
 * @param {string} [input.text] 飞书上的文字（名字或路径）
 * @returns {{hit:{id:string,title:string,path:string}, via:string, ambiguous?:boolean}
 *          | {error:string, hint?:string, candidates?:Array}}
 */
export function matchWorkspace(input = {}) {
  const list = (Array.isArray(input.list) ? input.list : []).filter((w) => w && (w.id || w.path))
  const binding = input.binding && typeof input.binding === 'object' ? input.binding : null
  const text = String(input.text ?? '').trim()

  const byId = (id) => list.find((w) => w.id && String(w.id) === String(id))
  const byPath = (path) => list.find((w) => w.path && String(w.path) === String(path))

  /* 1. 已绑定：id 是主键。id 还在但目录被改指向 → 视为失效，不跟着走。 */
  if (binding?.id) {
    const hit = byId(binding.id)
    if (hit) {
      if (binding.path && hit.path !== binding.path) {
        return { error: `工作区「${hit.title || hit.path}」的目录已变成 ${hit.path}（绑定的是 ${binding.path}），请重新选择`, hint: 'stale' }
      }
      return { hit, via: 'id' }
    }
    /* id 不在了（工作区被删/被重建）：下面用 path 接。 */
  }

  /* 2. path 兜底：工作区被删掉重建时 id 会变，path 不变。 */
  if (binding?.path) {
    const hit = byPath(binding.path)
    if (hit) return { hit, via: 'path' }
  }

  /* 3. 首次绑定：名字/路径的精确匹配。 */
  if (text) {
    const exactTitle = list.filter((w) => String(w.title || '').trim() === text)
    if (exactTitle.length === 1) return { hit: exactTitle[0], via: 'title' }
    if (exactTitle.length > 1) {
      /* 同名不同目录：DSH 允许，但这里不能替用户选——给出候选让他确认。 */
      return { error: `有 ${exactTitle.length} 个工作区都叫「${text}」，无法确定是哪一个（请用绝对路径指定）`, hint: 'ambiguous', candidates: exactTitle }
    }

    const exactPath = byPath(text)
    if (exactPath) return { hit: exactPath, via: 'path-text' }

    const wanted = normalizeWorkspaceName(text)
    if (wanted) {
      const fuzzy = list.filter((w) => normalizeWorkspaceName(w.title) === wanted)
      if (fuzzy.length === 1) return { hit: fuzzy[0], via: 'normalized' }
      if (fuzzy.length > 1) {
        return { error: `有 ${fuzzy.length} 个工作区名字归一化后相同（「${text}」），无法确定是哪一个`, hint: 'ambiguous', candidates: fuzzy }
      }
    }

    if (looksLikeAbsolutePath(text)) {
      return { error: `路径「${text}」还没有登记成工作区`, hint: 'unregistered-path' }
    }
  }

  const known = list.map((w) => w.title || w.path).filter(Boolean)
  return {
    error: text
      ? `没找到工作区「${text}」（已登记：${known.slice(0, 6).join('、') || '无'}）`
      : `没有指定工作区（已登记：${known.slice(0, 6).join('、') || '无'}）`,
    hint: 'not-found',
  }
}

/** 改名检测：绑定的 title 与 registry 当前 title 不一致时，返回需要同步的新名字。 */
export function titleChangeOf(binding, list) {
  if (!binding?.id) return null
  const hit = (Array.isArray(list) ? list : []).find((w) => w.id && String(w.id) === String(binding.id))
  if (!hit) return null
  const next = String(hit.title || '').trim()
  const prev = String(binding.title || '').trim()
  if (!next || next === prev) return null
  return { id: binding.id, from: prev, to: next, path: hit.path }
}
