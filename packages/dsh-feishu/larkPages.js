/** Bounded full-list reader: partial scans never masquerade as a successful snapshot. */
export async function listLarkPages(api, path, params = {}, validate = () => true, maxPages = 100, itemKey = 'items') {
  const items = [], cursors = new Set()
  let token = params?.page_token ?? '', hasMore = true, pages = 0
  const receipt = () => ({ items, incomplete: true, page_token: typeof token === 'string' ? token : '', pageToken: typeof token === 'string' ? token : '', has_more: hasMore, pages })
  const failed = (detail, res = {}) => ({ ...res, ok: false, ...receipt(), detail })
  if (params === null || typeof params !== 'object' || Array.isArray(params)) return failed('params 必须为对象')
  const pageSize = params.page_size ?? 100
  if (!Number.isInteger(maxPages) || maxPages < 1 || maxPages > 1000) return failed('maxPages 必须为 1–1000 的整数')
  if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > 1000) return failed('page_size 必须为 1–1000 的整数')
  if (typeof token !== 'string' || (token && !token.trim())) return failed('page_token 必须为有效字符串')
  try {
    for (let page = 0; page < maxPages; page++) {
      cursors.add(token)
      const res = await api('GET', path, { params: { ...params, page_size: pageSize, ...(token ? { page_token: token } : {}) }, timeoutMs: 120000 })
      if (!res?.ok) return failed(res?.detail || '列表读取失败', res)
      const data = res.data
      if (!data || !Array.isArray(data[itemKey]) || data[itemKey].length > pageSize || typeof data.has_more !== 'boolean' || !data[itemKey].every(validate)) return failed('列表分页结构无效')
      items.push(...data[itemKey]); pages++
      hasMore = data.has_more
      const next = data.page_token ?? ''
      if (typeof next !== 'string' || (next && !next.trim())) return failed('分页游标无效')
      token = next
      if (!hasMore) return { ok: true, ...receipt(), incomplete: false }
      if (!token || cursors.has(token)) return failed('分页游标缺失或循环')
    }
    return failed('超过完整分页保护上限')
  } catch (error) { return failed(error?.message || String(error)) }
}
